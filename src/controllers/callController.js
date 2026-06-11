'use strict';

const { Op } = require('sequelize');
const telephonyService = require('../services/telephonyService');
const storageService = require('../services/storageService');
const npfService = require('../services/npfService');
const db = require('../models');
const { success, created, paginate } = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { ROLES } = require('../utils/constants');
const { audioMime } = require('../utils/mime');

const clickToCall = asyncHandler(async (req, res) => {
  const call = await telephonyService.clickToCall({
    agent: req.user,
    leadId: req.body.lead_id,
    toNumber: req.body.to_number,
  });
  return created(res, { data: call, message: 'Call initiated' });
});

// Mobile dialer upload: stores the recorded audio + call metadata. No
// telephony provider involved — the agent calls from their phone and the
// app posts the recording here as multipart/form-data ('recording' file).
const uploadRecording = asyncHandler(async (req, res) => {
  // A missed call has no audio to upload, so the recording file is optional
  // in that case; otherwise it is required.
  const missed = req.body.is_missed === true || req.body.is_missed === 'true'
    || req.body.is_missed === '1' || req.body.status === 'missed';
  if (!req.file && !missed) {
    throw ApiError.badRequest('No recording file uploaded (field "recording")');
  }
  const call = await telephonyService.recordMobileCall({
    agent: req.user,
    file: req.file,
    leadId: req.body.lead_id,
    toNumber: req.body.to_number,
    fromNumber: req.body.from_number,
    direction: req.body.direction,
    status: req.body.status,
    durationSeconds: req.body.duration_seconds,
    talkTimeSeconds: req.body.talk_time_seconds,
    startedAt: req.body.started_at,
    endedAt: req.body.ended_at,
    isMissed: req.body.is_missed,
    clientCallId: req.body.client_call_id,
  });
  return created(res, { data: call, message: 'Call recording stored' });
});

// Live NoPaperForms integration status (non-secret) for the calls page, so the
// UI reflects the running server's actual config rather than a stale render.
const npfStatus = asyncHandler(async (req, res) => success(res, { data: npfService.status() }));

// Active agents for the calls filter dropdown.
const agents = asyncHandler(async (req, res) => {
  const rows = await db.User.findAll({
    where: { status: 'active' },
    attributes: ['id', 'name'],
    order: [['name', 'ASC']],
  });
  return success(res, { data: rows });
});

const list = asyncHandler(async (req, res) => {
  const where = {};
  // Counselors are locked to their own calls; others may filter by agent.
  if (req.user.role?.slug === ROLES.COUNSELOR) where.agent_id = req.user.id;
  else if (req.query.agent_id) where.agent_id = req.query.agent_id;

  if (req.query.lead_id) where.lead_id = req.query.lead_id;
  if (req.query.status) where.status = req.query.status;

  // Date range on started_at (from/to are ISO strings; default to today).
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const from = req.query.from ? new Date(req.query.from) : startOfToday;
  const to = req.query.to ? new Date(req.query.to) : now;
  if (!Number.isNaN(from.getTime()) || !Number.isNaN(to.getTime())) {
    where.started_at = {};
    if (!Number.isNaN(from.getTime())) where.started_at[Op.gte] = from;
    if (!Number.isNaN(to.getTime())) where.started_at[Op.lte] = to;
  }

  // Free-text search across dialled number and the linked student.
  const search = (req.query.search || '').trim();
  if (search) {
    const like = { [Op.like]: `%${search}%` };
    where[Op.or] = [
      { to_number: like },
      { from_number: like },
      { '$lead.student.first_name$': like },
      { '$lead.student.last_name$': like },
      { '$lead.student.phone$': like },
    ];
  }

  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, parseInt(req.query.limit, 10) || 20);
  const { rows, count } = await db.CallLog.findAndCountAll({
    where,
    include: [
      { model: db.User, as: 'agent', attributes: ['id', 'name'] },
      { model: db.Lead, as: 'lead', include: [{ model: db.Student, as: 'student' }] },
      { model: db.CallRecording, as: 'recording' },
      { model: db.CallAnalysis, as: 'analysis' },
    ],
    order: [['started_at', 'DESC']],
    limit,
    offset: (page - 1) * limit,
    // All includes are one-to-one, so a flat query keeps the nested `$...$`
    // search filter working correctly with LIMIT.
    subQuery: false,
    distinct: true,
  });
  return success(res, { data: rows, meta: paginate({ page, limit, total: count }) });
});

const show = asyncHandler(async (req, res) => {
  const call = await db.CallLog.findByPk(req.params.id, {
    include: [
      { model: db.CallRecording, as: 'recording' },
      { model: db.CallTranscript, as: 'transcript' },
      { model: db.CallAnalysis, as: 'analysis' },
      { model: db.Lead, as: 'lead', include: [{ model: db.Student, as: 'student' }] },
    ],
  });
  if (!call) throw ApiError.notFound('Call not found');
  return success(res, { data: call });
});

// Manually push (or re-push) the call's analysis to NoPaperForms. Returns the
// outcome plus the persisted call.meta.npf state so the UI can show whether the
// Dynamic Activity was created/updated, skipped or failed (with the reason).
const postNpf = asyncHandler(async (req, res) => {
  const call = await db.CallLog.findByPk(req.params.id, {
    include: [
      { model: db.CallAnalysis, as: 'analysis' },
      { model: db.User, as: 'agent' },
    ],
  });
  if (!call) throw ApiError.notFound('Call not found');
  if (!call.analysis || call.analysis.status !== 'completed') {
    throw ApiError.badRequest('Call has no completed analysis to post yet');
  }
  // Bound the request: the sync makes outbound calls to NoPaperForms, so if
  // that is slow/unreachable we still respond promptly (the sync keeps running
  // in the background and persists its outcome to call.meta.npf) instead of
  // hanging until the gateway returns a 502.
  const timeout = new Promise((resolve) => {
    setTimeout(() => resolve({ skipped: true, reason: 'timeout' }), 12000).unref();
  });
  const result = await Promise.race([
    npfService.syncCallActivity({ call, analysis: call.analysis, agent: call.agent }),
    timeout,
  ]);
  return success(res, {
    data: { result, npf: (call.meta && call.meta.npf) || null },
    message: 'NoPaperForms sync triggered',
  });
});

// Re-queue transcription + analysis for an existing recording (no re-upload).
const retryTranscription = asyncHandler(async (req, res) => {
  await telephonyService.retryTranscription(Number(req.params.id));
  return success(res, { message: 'Transcription re-queued' });
});

// Time-limited recording URL (presigned for S3 / app route for local).
const recordingUrl = asyncHandler(async (req, res) => {
  const recording = await db.CallRecording.findOne({ where: { call_id: req.params.id } });
  if (!recording || !recording.storage_key) throw ApiError.notFound('Recording not available');
  const url = await storageService.getSignedUrl(recording.storage_key);
  return success(res, { data: { url } });
});

// Local-storage recording stream (used when STORAGE_DRIVER=local).
const streamRecording = asyncHandler(async (req, res) => {
  const key = req.query.key;
  if (!key) throw ApiError.badRequest('Missing key');
  const stream = await storageService.getObjectStream(key);
  res.setHeader('Content-Type', audioMime(key));
  stream.pipe(res);
});

// Provider status-callback webhook (no auth; verified by provider signature).
const webhook = asyncHandler(async (req, res) => {
  await telephonyService.handleWebhook(req.params.provider, req);
  return res.status(200).json({ received: true });
});

module.exports = {
  clickToCall,
  uploadRecording,
  list,
  agents,
  npfStatus,
  show,
  postNpf,
  retryTranscription,
  recordingUrl,
  streamRecording,
  webhook,
};
