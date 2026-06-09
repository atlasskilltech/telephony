'use strict';

const telephonyService = require('../services/telephonyService');
const storageService = require('../services/storageService');
const db = require('../models');
const { success, created, paginate } = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { ROLES } = require('../utils/constants');

const clickToCall = asyncHandler(async (req, res) => {
  const call = await telephonyService.clickToCall({
    agent: req.user,
    leadId: req.body.lead_id,
    toNumber: req.body.to_number,
  });
  return created(res, { data: call, message: 'Call initiated' });
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
  res.setHeader('Content-Type', 'audio/mpeg');
  stream.pipe(res);
});

// Provider status-callback webhook (no auth; verified by provider signature).
const webhook = asyncHandler(async (req, res) => {
  await telephonyService.handleWebhook(req.params.provider, req);
  return res.status(200).json({ received: true });
});

module.exports = { clickToCall, list, show, recordingUrl, streamRecording, webhook };
