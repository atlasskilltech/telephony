'use strict';

const telephonyService = require('../services/telephonyService');
const storageService = require('../services/storageService');
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
  if (!req.file) throw ApiError.badRequest('No recording file uploaded (field "recording")');
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

const list = asyncHandler(async (req, res) => {
  const where = {};
  if (req.user.role?.slug === ROLES.COUNSELOR) where.agent_id = req.user.id;
  if (req.query.lead_id) where.lead_id = req.query.lead_id;
  if (req.query.status) where.status = req.query.status;

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
  show,
  retryTranscription,
  recordingUrl,
  streamRecording,
  webhook,
};
