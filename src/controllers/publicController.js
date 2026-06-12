'use strict';

const db = require('../models');
const storageService = require('../services/storageService');
const { audioMime } = require('../utils/mime');
const { success } = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');

// Mask all but the last 4 digits of a phone number for the public report.
const maskNumber = (num) => {
  if (!num) return null;
  const s = String(num);
  if (s.length <= 4) return s;
  return s.slice(0, Math.max(0, s.length - 8)).replace(/\d/g, '') + '••••' + s.slice(-4);
};

/**
 * Public, login-free call report — looked up by the call's unguessable uuid.
 * Returns only the fields the report view needs (analysis + transcript), with
 * the dialled number masked. No authentication: the uuid is the capability.
 */
const callReport = asyncHandler(async (req, res) => {
  const call = await db.CallLog.findOne({
    where: { uuid: req.params.uuid },
    include: [
      { model: db.CallTranscript, as: 'transcript' },
      { model: db.CallAnalysis, as: 'analysis' },
      { model: db.CallRecording, as: 'recording' },
      { model: db.Lead, as: 'lead', include: [{ model: db.Student, as: 'student' }] },
    ],
  });
  if (!call) throw ApiError.notFound('Report not found');

  const a = call.analysis;
  if (!a || a.status !== 'completed') throw ApiError.notFound('Report is not ready yet');

  const t = call.transcript;
  const rec = call.recording;
  const student = call.lead && call.lead.student;

  // Shape mirrors what callReportMixin.buildReport() expects, sanitised.
  const data = {
    id: call.id,
    uuid: call.uuid,
    direction: call.direction,
    status: call.status,
    talk_time_seconds: call.talk_time_seconds,
    duration_seconds: call.duration_seconds,
    to_number: maskNumber(call.to_number),
    lead: student ? { student: { first_name: student.first_name } } : null,
    // Login-free audio: only expose the stream URL (keyed by the same uuid),
    // never the storage key. Null when there's no archived recording to play.
    recording_url: rec && rec.storage_key ? `/api/v1/public/calls/${call.uuid}/recording` : null,
    transcript: t ? { segments: t.segments, text: t.text } : null,
    analysis: {
      status: a.status,
      sentiment: a.sentiment,
      risk_score: a.risk_score,
      summary: a.summary,
      interest_score: a.interest_score,
      agent_score: a.agent_score,
      call_quality_score: a.call_quality_score,
      qa_scores: a.qa_scores,
      sentiment_arc: a.sentiment_arc,
      positive_points: a.positive_points,
      negative_points: a.negative_points,
      objections: a.objections,
      improvement_suggestions: a.improvement_suggestions,
      recommendations: a.recommendations,
      followup_recommendation: a.followup_recommendation,
    },
  };

  return success(res, { data });
});

/**
 * Public, login-free audio stream for a call recording — gated by the same
 * unguessable uuid as the report (no auth, no storage key exposed). Streams the
 * archived file from local disk or S3 via the storage service. Supports a
 * single Range request so browsers can seek within the recording.
 */
const callRecording = asyncHandler(async (req, res) => {
  const call = await db.CallLog.findOne({
    where: { uuid: req.params.uuid },
    attributes: ['id'],
    include: [{ model: db.CallRecording, as: 'recording' }],
  });
  const rec = call && call.recording;
  if (!rec || !rec.storage_key) throw ApiError.notFound('Recording not available');

  res.setHeader('Content-Type', audioMime(rec.storage_key));
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('Accept-Ranges', 'bytes');

  const size = Number(rec.file_size_bytes) || null;
  const range = req.headers.range;
  // Honour a simple "bytes=start-end" range so seeking works; fall back to the
  // whole file when the size is unknown or no range was requested.
  if (range && size) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (m) {
      const start = m[1] ? parseInt(m[1], 10) : 0;
      const end = m[2] ? parseInt(m[2], 10) : size - 1;
      if (start <= end && end < size) {
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
        res.setHeader('Content-Length', end - start + 1);
        const partial = await storageService.getObjectStream(rec.storage_key, { start, end });
        partial.on('error', () => res.destroy());
        return partial.pipe(res);
      }
    }
  }

  if (size) res.setHeader('Content-Length', size);
  const stream = await storageService.getObjectStream(rec.storage_key);
  stream.on('error', () => res.destroy());
  return stream.pipe(res);
});

module.exports = { callReport, callRecording };
