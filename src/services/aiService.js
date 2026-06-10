'use strict';

const { toFile } = require('openai');
const OpenAI = require('openai');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * Wraps OpenAI Whisper (transcription) and GPT (analysis + QA) so the rest
 * of the app deals in plain domain objects. When AI is disabled or no API
 * key is set, deterministic stub data keeps the pipeline runnable in dev.
 */
class AiService {
  constructor() {
    this.enabled = config.ai.enabled && !!config.ai.apiKey;
    if (this.enabled) {
      this.client = new OpenAI({ apiKey: config.ai.apiKey });
    } else {
      logger.warn('AI service running in stub mode (no OPENAI_API_KEY). Using mock outputs.');
    }
  }

  /**
   * Transcribe an audio buffer with Whisper, returning text, segments and a
   * naive 2-speaker diarisation derived from segment ordering.
   */
  async transcribe(buffer, filename = 'recording.mp3') {
    const started = Date.now();
    if (!this.enabled) {
      return {
        text: '[stub] Counselor introduced the program; student asked about fees and hostel.',
        language: 'en',
        segments: [],
        confidence: 0.0,
        model: 'stub',
        processingMs: Date.now() - started,
      };
    }

    const file = await toFile(buffer, filename);
    // Translation task → always English text (handles Hindi/mixed audio).
    // Transcription task → keeps the spoken language.
    const res = config.ai.translateToEnglish
      ? await this.client.audio.translations.create({
          file,
          model: config.ai.transcribeModel,
          response_format: 'verbose_json',
        })
      : await this.client.audio.transcriptions.create({
          file,
          model: config.ai.transcribeModel,
          response_format: 'verbose_json',
          timestamp_granularities: ['segment'],
        });

    const segments = (res.segments || []).map((s, i) => ({
      id: i,
      // Provisional label; refined by diarizeSegments() using content + direction.
      speaker: i % 2 === 0 ? 'agent' : 'customer',
      start: s.start,
      end: s.end,
      text: s.text.trim(),
    }));

    return {
      text: res.text,
      language: config.ai.translateToEnglish ? 'en' : (res.language || 'en'),
      segments,
      confidence: this._avgConfidence(res.segments),
      model: config.ai.transcribeModel,
      processingMs: Date.now() - started,
    };
  }

  _avgConfidence(segments = []) {
    if (!segments.length) return null;
    // Whisper exposes avg_logprob per segment; map to a rough 0-1 confidence.
    const vals = segments.map((s) => Math.exp(s.avg_logprob ?? -1));
    return Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(4));
  }

  /** Direction-aware fallback when AI diarisation is unavailable. */
  _heuristicSpeakers(segments = [], direction) {
    // Outbound/unknown: the agent typically speaks first; inbound: the student.
    const agentFirst = direction !== 'inbound';
    return segments.map((s, i) => ({
      ...s,
      speaker: (i % 2 === 0) === agentFirst ? 'agent' : 'customer',
    }));
  }

  /**
   * Assign each transcript segment to the agent (university counselor) or the
   * customer (student) using conversational cues and the call direction.
   * Whisper has no speaker info, so this is content-based diarisation; falls
   * back to a direction-aware heuristic when AI is off or the call fails.
   */
  async diarizeSegments(segments = [], { direction } = {}) {
    if (!segments.length) return segments;
    if (!this.enabled) return this._heuristicSpeakers(segments, direction);

    const lines = segments.map((s, i) => `${i}: ${s.text}`).join('\n');
    const system =
      'You label each utterance in an admission/sales phone call as the speaker: ' +
      '"agent" (the university counselor who handles admissions/fees/process) or ' +
      '"customer" (the prospective student/parent enquiring). Use conversational ' +
      'cues — the agent guides the process, quotes fees, asks qualifying questions; ' +
      'the customer asks about programs, reports problems, gives personal choices. ' +
      'Respond ONLY with JSON {"speakers": [...]} of exactly one value ("agent" or ' +
      '"customer") per line index, in order.';
    const user =
      `Call direction: ${direction || 'unknown'} ` +
      '(outbound = the agent called the student; inbound = the student called in). ' +
      `Utterances:\n${lines.slice(0, 12000)}`;

    try {
      const res = await this.client.chat.completions.create({
        model: config.ai.analysisModel,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        response_format: { type: 'json_object' },
        temperature: 0,
      });
      const parsed = JSON.parse(res.choices[0].message.content);
      const speakers = Array.isArray(parsed.speakers) ? parsed.speakers : [];
      const fallback = this._heuristicSpeakers(segments, direction);
      return segments.map((s, i) => ({
        ...s,
        speaker: speakers[i] === 'agent' || speakers[i] === 'customer'
          ? speakers[i]
          : fallback[i].speaker,
      }));
    } catch (e) {
      logger.warn(`Diarisation failed, using heuristic: ${e.message}`);
      return this._heuristicSpeakers(segments, direction);
    }
  }

  /**
   * Analyse a transcript and return interest/sentiment/objections plus a
   * counselor QA scorecard, as strict JSON.
   */
  async analyzeTranscript(transcriptText, context = {}) {
    if (!this.enabled) {
      return this._stubAnalysis();
    }

    const system =
      'You are an expert admission-call analyst for a university. Analyse the ' +
      'counselor-student call transcript and respond ONLY with valid JSON matching ' +
      'the provided schema. Scores are 0-100 unless noted. Be objective.';

    const schema = `{
      "interest_score": number, "admission_probability": number,
      "sentiment": "positive|neutral|negative", "sentiment_score": number,
      "risk_score": number, "intent": string,
      "summary": string, "next_action": string, "followup_recommendation": string,
      "objections": string[], "keywords": string[],
      "qa_scores": { "greeting": number, "requirement_gathering": number,
        "product_knowledge": number, "communication": number,
        "objection_handling": number, "closing": number },
      "call_quality_score": number, "agent_score": number,
      "improvement_suggestions": string[],
      "positive_points": string[], "negative_points": string[],
      "recommendations": string[],
      "sentiment_arc": number[] }`;

    const user = `Course context: ${context.course || 'N/A'}, City: ${context.city || 'N/A'}.
Transcript:
"""
${transcriptText.slice(0, 12000)}
"""
Return JSON exactly in this schema (qa_scores values are 0-10; sentiment_arc is
6-10 numbers from -1 to 1 showing how customer sentiment moved through the call):
${schema}`;

    const res = await this.client.chat.completions.create({
      model: config.ai.analysisModel,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    });

    const parsed = JSON.parse(res.choices[0].message.content);
    parsed.model = config.ai.analysisModel;
    return parsed;
  }

  _stubAnalysis() {
    return {
      interest_score: 72,
      admission_probability: 58,
      sentiment: 'positive',
      sentiment_score: 65,
      risk_score: 30,
      intent: 'fee_and_hostel_enquiry',
      summary: '[stub] Student showed interest in the B.Tech program, concerned about fees.',
      next_action: 'Share fee structure and schedule campus visit',
      followup_recommendation: 'Call back in 2 days with scholarship options',
      objections: ['fees too high'],
      keywords: ['B.Tech', 'fees', 'hostel', 'scholarship'],
      qa_scores: {
        greeting: 8,
        requirement_gathering: 7,
        product_knowledge: 8,
        communication: 7,
        objection_handling: 6,
        closing: 6,
      },
      call_quality_score: 70,
      agent_score: 72,
      improvement_suggestions: ['Address fee objection with scholarship info earlier'],
      positive_points: [
        'Warm greeting and clear introduction',
        'Empathised with the fee concern',
        'Offered a concrete next step (campus visit)',
      ],
      negative_points: [
        'Did not gather the student’s preferred intake',
        'Scholarship options mentioned only at the end',
      ],
      recommendations: [
        'Share the fee structure and scholarship sheet within 24h',
        'Schedule a campus visit and confirm by SMS',
      ],
      sentiment_arc: [0.2, -0.3, 0.1, 0.4, 0.6, 0.7],
      model: 'stub',
    };
  }
}

module.exports = new AiService();
