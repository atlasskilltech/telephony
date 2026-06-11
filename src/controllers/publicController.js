'use strict';

const db = require('../models');
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
      { model: db.Lead, as: 'lead', include: [{ model: db.Student, as: 'student' }] },
    ],
  });
  if (!call) throw ApiError.notFound('Report not found');

  const a = call.analysis;
  if (!a || a.status !== 'completed') throw ApiError.notFound('Report is not ready yet');

  const t = call.transcript;
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

module.exports = { callReport };
