'use strict';

const db = require('../../models');
const aiService = require('../../services/aiService');
const npfService = require('../../services/npfService');
const logger = require('../../utils/logger');

/**
 * Analysis job: run GPT over the transcript to produce interest/sentiment,
 * objections, summary, follow-up recommendation and the QA scorecard, then
 * roll the key signals up onto the lead.
 */
module.exports = async function analysisJob(job) {
  const { callId, transcriptId } = job.data;
  const transcript = await db.CallTranscript.findByPk(transcriptId);
  if (!transcript || !transcript.text) throw new Error('Transcript not available for analysis');

  const call = await db.CallLog.findByPk(callId, {
    include: [
      { model: db.Lead, as: 'lead' },
      { model: db.User, as: 'agent' },
    ],
  });
  const context = {
    course: call?.lead?.course,
    city: call?.lead?.city,
  };

  const analysisRow = await db.CallAnalysis.findOrCreate({
    where: { call_id: callId },
    defaults: { call_id: callId, status: 'processing' },
  }).then(([row]) => row);

  try {
    const a = await aiService.analyzeTranscript(transcript.text, context);
    const qa = a.qa_scores || {};
    await analysisRow.update({
      interest_score: a.interest_score,
      admission_probability: a.admission_probability,
      sentiment: a.sentiment,
      sentiment_score: a.sentiment_score,
      risk_score: a.risk_score,
      summary: a.summary,
      next_action: a.next_action,
      followup_recommendation: a.followup_recommendation,
      objections: a.objections,
      keywords: a.keywords,
      intent: a.intent,
      qa_scores: qa,
      call_quality_score: a.call_quality_score,
      agent_score: a.agent_score,
      improvement_suggestions: a.improvement_suggestions,
      positive_points: a.positive_points,
      negative_points: a.negative_points,
      recommendations: a.recommendations,
      sentiment_arc: a.sentiment_arc,
      model: a.model,
      status: 'completed',
    });

    // Surface AI signals on the lead for list/sorting.
    if (call?.lead) {
      await call.lead.update({
        ai_interest_score: a.interest_score,
        ai_admission_probability: a.admission_probability,
        last_contacted_at: new Date(),
      });
    }
    logger.info(`Analysed call ${callId}: interest ${a.interest_score}, sentiment ${a.sentiment}`);

    // Push the public transcript URL + scores to NoPaperForms. This is a
    // best-effort side effect — npfService never throws, so a CRM outage or
    // missing lead does not fail (or re-run) the analysis job.
    await npfService.syncCallActivity({ call, analysis: analysisRow, agent: call.agent });
  } catch (err) {
    await analysisRow.update({ status: 'failed', error: err.message.slice(0, 500) });
    throw err;
  }

  return { callId };
};
