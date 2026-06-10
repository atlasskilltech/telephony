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
        durationSeconds: null,
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

    const rawSegments = res.segments || [];
    const segments = rawSegments.map((s, i) => ({
      id: i,
      // Provisional label; refined by diarizeSegments() using content + direction.
      speaker: i % 2 === 0 ? 'agent' : 'customer',
      start: s.start,
      end: s.end,
      text: s.text.trim(),
    }));

    // True audio length straight from the file. verbose_json exposes `duration`;
    // fall back to the last segment's end time when it's absent. Used to correct
    // a wrong client-supplied call duration (mobile dialers often mis-report it).
    const lastEnd = rawSegments.length ? rawSegments[rawSegments.length - 1].end : null;
    const audioDuration = Number.isFinite(res.duration) ? res.duration : lastEnd;

    return {
      text: res.text,
      language: config.ai.translateToEnglish ? 'en' : (res.language || 'en'),
      segments,
      durationSeconds: Number.isFinite(audioDuration) ? Math.round(audioDuration) : null,
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
   * Collapse runs of consecutive segments by the same speaker into one turn,
   * concatenating the text and spanning the timestamps. Whisper over-splits a
   * single speaker into many tiny segments, so this yields a readable, turn-by-
   * turn transcript instead of dozens of one-line fragments.
   */
  _mergeConsecutiveTurns(segments = []) {
    const merged = [];
    for (const s of segments) {
      const last = merged[merged.length - 1];
      if (last && last.speaker === s.speaker) {
        last.text = `${last.text} ${s.text}`.trim();
        last.end = s.end;
      } else {
        merged.push({ ...s });
      }
    }
    return merged.map((s, i) => ({ ...s, id: i }));
  }

  /**
   * Assign each transcript segment to the agent (university counselor) or the
   * customer (student) using conversational cues and the call direction.
   * Whisper has no speaker info, so this is content-based diarisation; falls
   * back to a direction-aware heuristic when AI is off or the call fails.
   * Consecutive same-speaker segments are merged into clean turns.
   */
  async diarizeSegments(segments = [], { direction } = {}) {
    if (!segments.length) return segments;
    if (!this.enabled) {
      return this._mergeConsecutiveTurns(this._heuristicSpeakers(segments, direction));
    }

    const lines = segments.map((s, i) => `${i}: ${s.text}`).join('\n');
    const system =
      'You are diarising a two-party admission phone call for an Indian university ' +
      '(Atlas). Exactly two people speak and they take turns. Label each utterance:\n' +
      '- "agent": the university counselor / admission helpline who RUNS the call. They ' +
      'greet on behalf of the university, give step-by-step instructions ("go to the ' +
      'website", "click on continue application", "login with your application id", "you ' +
      'will get the fee payment option"), quote fees, ask qualifying questions and confirm ' +
      'next steps. They say things like "this is the helpline number" and "listen to my ' +
      'instructions".\n' +
      '- "customer": the prospective student or parent. They explain their situation ("I ' +
      'already applied / got the offer letter", "I had not made the payment yet"), ask ' +
      'questions, report problems and follow the agent\'s instructions.\n' +
      'METHOD: first decide from the WHOLE conversation which of the two voices is the ' +
      'agent, then label EVERY line consistently with that single decision. The two roles ' +
      'never swap identity mid-call, and the same person usually speaks for several ' +
      'consecutive lines. Respond ONLY with JSON {"speakers": [...]} containing exactly one ' +
      'value ("agent" or "customer") per line index, in order, with the same number of ' +
      'entries as the input lines.';
    const user =
      `Call direction: ${direction || 'unknown'} ` +
      '(outbound = the agent dialled the student; inbound = the student called the helpline). ' +
      `${segments.length} lines:\n${lines.slice(0, 16000)}`;

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
      const labeled = segments.map((s, i) => ({
        ...s,
        speaker: speakers[i] === 'agent' || speakers[i] === 'customer'
          ? speakers[i]
          : fallback[i].speaker,
      }));
      // Degenerate result (every line one speaker) is not a real 2-party
      // diarisation — prefer the alternating heuristic in that case.
      const distinct = new Set(labeled.map((s) => s.speaker));
      const final = distinct.size < 2 ? fallback : labeled;
      return this._mergeConsecutiveTurns(final);
    } catch (e) {
      logger.warn(`Diarisation failed, using heuristic: ${e.message}`);
      return this._mergeConsecutiveTurns(this._heuristicSpeakers(segments, direction));
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
