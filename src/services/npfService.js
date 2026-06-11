'use strict';

const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');
const db = require('../models');

/**
 * NoPaperForms (NPF) lead-CRM integration.
 *
 * After a call is transcribed and analysed we:
 *   1. look the lead up by mobile (getDetailsByMobileNumber),
 *   2. build a public, login-free transcript/report URL, and
 *   3. push a Dynamic Activity (create, or update on retry) carrying the
 *      transcript URL + call scores, assigned to the counselor's owner id.
 *
 * Without secret/access keys the service runs in stub mode: every call is
 * logged and skipped so the analysis pipeline stays fully runnable in dev.
 */
class NpfService {
  constructor() {
    this.enabled = config.npf.enabled && !!config.npf.secretKey && !!config.npf.accessKey;
    if (this.enabled) {
      this.client = axios.create({
        baseURL: config.npf.baseUrl.replace(/\/+$/, ''),
        // Keep well under typical reverse-proxy/gateway timeouts: two calls
        // (lookup + activity) can stack, so each must fail fast if NPF is slow
        // or unreachable rather than hanging the request into a 502.
        timeout: 8000,
        headers: {
          'Content-Type': 'application/json',
          'secret-key': config.npf.secretKey,
          'access-key': config.npf.accessKey,
        },
      });
    } else {
      logger.warn('NPF service running in stub mode (no NPF_SECRET_KEY/NPF_ACCESS_KEY). Activities are skipped.');
    }
  }

  /** Last-10-digit local mobile (NPF stores numbers without a country code). */
  static normalizeMobile(raw) {
    const digits = String(raw || '').replace(/\D/g, '');
    if (!digits) return null;
    return digits.length > 10 ? digits.slice(-10) : digits;
  }

  /** `YYYY-MM-DDTHH:MM` in the configured NPF timezone (default Asia/Kolkata). */
  static formatActivityDate(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: config.npf.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const g = (t) => (parts.find((p) => p.type === t) || {}).value || '00';
    return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
  }

  /** Public, login-free report URL for a call (posted as cf_call_transcript_url). */
  static transcriptUrl(call) {
    const base = config.app.url.replace(/\/+$/, '');
    return `${base}/r/${call.uuid}`;
  }

  /** Compact, human-readable score string for cf_call_scores. */
  static buildScores(analysis) {
    if (!analysis) return '';
    const overall = Math.round(
      Number(analysis.call_quality_score ?? analysis.agent_score ?? analysis.interest_score ?? 0)
    );
    const parts = [`Overall ${overall}/100`];
    let qa = analysis.qa_scores;
    if (typeof qa === 'string') {
      try { qa = JSON.parse(qa); } catch (e) { qa = null; }
    }
    if (qa && typeof qa === 'object') {
      const detail = Object.entries(qa)
        .map(([k, v]) => `${k.replace(/_/g, ' ')} ${Math.round((Number(v) || 0) * 10)}`)
        .join(', ');
      if (detail) parts.push(detail);
    }
    if (analysis.sentiment) parts.push(`sentiment ${analysis.sentiment}`);
    return parts.join(' | ');
  }

  /** Best-effort extraction of an NPF lead id from a variety of response shapes. */
  static extractLeadId(payload) {
    if (!payload) return null;
    const data = payload.data ?? payload;
    const record = Array.isArray(data) ? data[0] : data;
    if (!record || typeof record !== 'object') return null;
    const key = ['lead_id', 'leadId', 'id', 'user_id', 'userId'].find(
      (k) => record[k] != null && record[k] !== ''
    );
    return key ? String(record[key]) : null;
  }

  async getDetailsByMobileNumber(mobile, fields = ['name', 'mobile', 'lead_stage', 'email', 'course']) {
    const normalized = NpfService.normalizeMobile(mobile);
    if (!this.enabled || !normalized) return null;
    const { data } = await this.client.post('/getDetailsByMobileNumber', {
      mobile: Number(normalized),
      fields,
    });
    return data;
  }

  async createDynamicActivity(payload) {
    const { data } = await this.client.post('/postDynamicActivity/', payload);
    return data;
  }

  async updateDynamicActivity(payload) {
    const { data } = await this.client.post('/updateDynamicActivity/', payload);
    return data;
  }

  /** Pull an activity id out of a create/update response. */
  static extractActivityId(payload) {
    if (!payload) return null;
    const data = payload.data ?? payload;
    const record = Array.isArray(data) ? data[0] : data;
    const src = record && typeof record === 'object' ? record : payload;
    const key = ['id', 'activity_id', 'activityId'].find((k) => src[k] != null && src[k] !== '');
    return key ? String(src[key]) : null;
  }

  /**
   * Resolve the counselor's NPF owner id: prefer the value already on the user
   * row, otherwise fall back to the name mapping (npf_owner_map).
   */
  async resolveOwnerId(agent) {
    if (!agent) return null;
    if (agent.npf_owner_id) return String(agent.npf_owner_id);
    const nameKey = String(agent.name || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!nameKey) return null;
    try {
      const map = await db.NpfOwnerMap.findOne({ where: { name_key: nameKey } });
      return map ? String(map.owner_id) : null;
    } catch (err) {
      // Missing table / DB hiccup must not abort the sync — just skip assignment.
      logger.warn(`NPF owner-id lookup failed for "${agent.name}": ${err.message}`);
      return null;
    }
  }

  /**
   * Merge a patch into `call.meta.npf` so every NPF outcome (synced, skipped or
   * failed) is persisted on the call alongside the app log. Best-effort: a
   * persistence failure is logged but never propagated.
   */
  static async recordState(call, patch) {
    try {
      const prior = (call.meta && call.meta.npf) || {};
      await call.update({
        meta: { ...(call.meta || {}), npf: { ...prior, ...patch, updatedAt: new Date().toISOString() } },
      });
    } catch (err) {
      logger.error(`Failed to persist NPF state for call ${call.id}: ${err.message}`);
    }
  }

  /**
   * Push (or update) the post-call Dynamic Activity for a completed analysis.
   * Never throws — NPF being unreachable must not fail the analysis job.
   * Every outcome is logged AND persisted to `call.meta.npf`.
   *
   * @returns {Promise<{ skipped?: boolean, reason?: string, activityId?: string }>}
   */
  async syncCallActivity({ call, analysis, agent }) {
    if (!this.enabled) return { skipped: true, reason: 'stub_mode' };
    try {
      // Outbound: the lead is the dialled (to) number; inbound: the caller.
      const mobile = call.direction === 'inbound' ? call.from_number : call.to_number;
      const normalized = NpfService.normalizeMobile(mobile);
      if (!normalized) {
        logger.warn(`NPF activity skipped for call ${call.id}: no usable mobile number`);
        await NpfService.recordState(call, { status: 'skipped', reason: 'no_mobile', lastError: null });
        return { skipped: true, reason: 'no_mobile' };
      }

      const detail = await this.getDetailsByMobileNumber(normalized).catch((err) => {
        logger.warn(`NPF lookup failed for call ${call.id}: ${err.message}`);
        return null;
      });
      const leadId = NpfService.extractLeadId(detail);

      const transcriptUrl = NpfService.transcriptUrl(call);
      const scores = NpfService.buildScores(analysis);
      const ownerId = await this.resolveOwnerId(agent);
      const description = `AI call analysis · ${scores}`.slice(0, 1000);
      const dynamicFields = {
        cf_call_transcript_url: transcriptUrl,
        cf_call_scores: scores,
      };

      const prior = (call.meta && call.meta.npf) || {};
      let response;
      let activityId = prior.activityId || null;

      if (activityId) {
        // Update the existing activity (e.g. after a re-analysis/retry).
        response = await this.updateDynamicActivity({
          id: activityId,
          activity_config_id: config.npf.activityConfigId,
          ...(ownerId ? { activity_assign: ownerId } : {}),
          description,
          dynamic_fields: dynamicFields,
        });
      } else {
        if (!leadId) {
          logger.warn(`NPF activity skipped for call ${call.id}: lead not found for mobile ${normalized}`);
          await NpfService.recordState(call, {
            status: 'skipped',
            reason: 'lead_not_found',
            mobile: normalized,
            lastError: null,
          });
          return { skipped: true, reason: 'lead_not_found' };
        }
        response = await this.createDynamicActivity({
          activity_config_id: config.npf.activityConfigId,
          search_criteria: leadId,
          lead_id: leadId,
          activity_date: {
            timezone: config.npf.timezone,
            date: NpfService.formatActivityDate(call.started_at ? new Date(call.started_at) : new Date()),
          },
          ...(ownerId ? { activity_assign: ownerId } : {}),
          description,
          dynamic_fields: dynamicFields,
        });
        activityId = NpfService.extractActivityId(response) || activityId;
      }

      // Persist the linkage so a retry updates instead of duplicating, and
      // clear any prior error so the call shows a clean, synced state.
      await NpfService.recordState(call, {
        status: 'synced',
        action: prior.activityId ? 'update' : 'create',
        activityId: activityId || prior.activityId || null,
        leadId: leadId || prior.leadId || null,
        ownerId: ownerId || prior.ownerId || null,
        transcriptUrl,
        syncedAt: new Date().toISOString(),
        lastError: null,
        lastErrorAt: null,
      });

      logger.info(`NPF activity synced for call ${call.id} (lead ${leadId || 'n/a'}, activity ${activityId || 'n/a'})`);
      return { activityId };
    } catch (err) {
      // Surface the failure in the app log AND persist it on the call so it is
      // visible/queryable without trawling logs.
      const httpStatus = err.response ? err.response.status : null;
      const detail = err.response ? JSON.stringify(err.response.data) : err.message;
      logger.error(
        `NPF activity sync failed for call ${call.id}${httpStatus ? ` [HTTP ${httpStatus}]` : ''}: ${detail}`
      );
      await NpfService.recordState(call, {
        status: 'failed',
        reason: 'error',
        lastErrorStatus: httpStatus,
        lastError: String(detail).slice(0, 1000),
        lastErrorAt: new Date().toISOString(),
      });
      return { skipped: true, reason: 'error' };
    }
  }
}

const npfService = new NpfService();
// Expose the class so the pure helpers can be unit-tested in isolation.
npfService.NpfService = NpfService;
module.exports = npfService;
