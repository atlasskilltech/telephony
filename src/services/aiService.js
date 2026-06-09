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
    const res = await this.client.audio.transcriptions.create({
      file,
      model: config.ai.transcribeModel,
      response_format: 'verbose_json',
      timestamp_granularities: ['segment'],
    });

    const segments = (res.segments || []).map((s, i) => ({
      id: i,
      // Heuristic speaker labelling; replace with a diarisation model if needed.
      speaker: i % 2 === 0 ? 'agent' : 'customer',
      start: s.start,
      end: s.end,
      text: s.text.trim(),
    }));

    return {
      text: res.text,
      language: res.language || 'en',
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
      "improvement_suggestions": string[] }`;

    const user = `Course context: ${context.course || 'N/A'}, City: ${context.city || 'N/A'}.
Transcript:
"""
${transcriptText.slice(0, 12000)}
"""
Return JSON exactly in this schema (qa_scores values are 0-10):
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
      model: 'stub',
    };
  }
}

module.exports = new AiService();
