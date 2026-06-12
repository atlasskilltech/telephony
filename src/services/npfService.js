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
// SystemConfig keys (group 'npf') that override the env-based defaults, so the
// integration can be enabled from the app UI without touching server env.
const DB_KEYS = {
  enabled: 'npf_enabled',
  secretKey: 'npf_secret_key',
  accessKey: 'npf_access_key',
  activityConfigId: 'npf_activity_config_id',
  baseUrl: 'npf_base_url',
  timezone: 'npf_timezone',
};

class NpfService {
  constructor() {
    // Start from env; DB overrides are merged in lazily via refresh().
    this._apply(this._fromEnv());
    this._loadedFromDb = false;
    if (!this.enabled) {
      logger.warn('NPF service starting without keys — will use DB-stored credentials if present, else stub mode.');
    }
  }

  _fromEnv() {
    return {
      enabled: config.npf.enabled,
      baseUrl: config.npf.baseUrl,
      secretKey: config.npf.secretKey,
      accessKey: config.npf.accessKey,
      activityConfigId: config.npf.activityConfigId,
      timezone: config.npf.timezone,
    };
  }

  /**
   * Normalise a pasted key: trim whitespace and strip a single pair of
   * surrounding quotes (a common copy/paste artifact — NoPaperForms keys never
   * contain quotes, so sending `"abc"` instead of `abc` yields a 401).
   */
  static sanitizeKey(v) {
    if (v == null) return v;
    let s = String(v).trim();
    if (
      s.length >= 2 &&
      ((s[0] === '"' && s[s.length - 1] === '"') || (s[0] === "'" && s[s.length - 1] === "'"))
    ) {
      s = s.slice(1, -1).trim();
    }
    return s;
  }

  /** Re-apply a resolved config, recomputing `enabled` and the axios client. */
  _apply(cfg) {
    // Sanitise keys regardless of source so stray quotes never reach NPF.
    cfg = {
      ...cfg,
      secretKey: NpfService.sanitizeKey(cfg.secretKey),
      accessKey: NpfService.sanitizeKey(cfg.accessKey),
    };
    this.cfg = cfg;
    this.enabled = !!(cfg.enabled && cfg.secretKey && cfg.accessKey);
    this.client = this.enabled
      ? axios.create({
          baseURL: String(cfg.baseUrl).replace(/\/+$/, ''),
          // Keep well under typical gateway timeouts: lookup + activity can
          // stack, so each must fail fast rather than hang into a 502.
          timeout: 8000,
          headers: {
            'Content-Type': 'application/json',
            'secret-key': cfg.secretKey,
            'access-key': cfg.accessKey,
          },
        })
      : null;
  }

  /**
   * Coerce a stored/env flag to a boolean. Handles real booleans, the usual
   * truthy strings ('1','true','yes','on') and treats blank/undefined as the
   * given fallback — so a stray empty `npf_enabled` row never disables a
   * fully-configured integration.
   */
  static toFlag(v, fallback) {
    if (v === undefined || v === null || v === '') return fallback;
    if (typeof v === 'boolean') return v;
    return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
  }

  /** Merge SystemConfig (group 'npf') over env defaults and re-apply. */
  async refresh() {
    const env = this._fromEnv();
    try {
      const rows = await db.SystemConfig.findAll({ where: { group: 'npf' } });
      const o = {};
      rows.forEach((r) => { o[r.key] = r.value; });
      const pick = (k, fallback) => {
        const v = o[DB_KEYS[k]];
        return v === undefined || v === null || v === '' ? fallback : v;
      };
      // Whoever actually supplies the secret/access key pair owns the enable
      // flag. This keeps the in-app (DB-stored) flow working while ensuring a
      // leftover DB row can never silently disable keys configured via env
      // (the env-managed deployment) — and vice-versa.
      const dbSecret = NpfService.sanitizeKey(pick('secretKey', ''));
      const dbAccess = NpfService.sanitizeKey(pick('accessKey', ''));
      const dbManaged = !!(dbSecret && dbAccess);
      this._apply({
        enabled: dbManaged
          ? NpfService.toFlag(o[DB_KEYS.enabled], true)
          : NpfService.toFlag(env.enabled, true),
        baseUrl: pick('baseUrl', env.baseUrl),
        secretKey: dbManaged ? dbSecret : env.secretKey,
        accessKey: dbManaged ? dbAccess : env.accessKey,
        activityConfigId: pick('activityConfigId', env.activityConfigId),
        timezone: pick('timezone', env.timezone),
      });
      this._loadedFromDb = true;
    } catch (err) {
      // Table missing / DB hiccup: keep env-based config.
      this._apply(env);
    }
    return this.enabled;
  }

  /**
   * Persist NoPaperForms credentials to SystemConfig (so they survive restarts
   * and don't depend on server env), then refresh. Only non-empty fields are
   * written, so a blank secret/access key leaves the stored value untouched.
   */
  async saveConfig({ secretKey, accessKey, activityConfigId, enabled } = {}) {
    const set = async (key, value, isSecret = false) => {
      const full = DB_KEYS[key];
      const existing = await db.SystemConfig.findOne({ where: { key: full } });
      if (existing) await existing.update({ value, group: 'npf', is_secret: isSecret });
      else await db.SystemConfig.create({ key: full, value, group: 'npf', is_secret: isSecret });
    };
    const clean = (v) => (typeof v === 'string' ? v.trim() : v);
    if (NpfService.sanitizeKey(secretKey)) await set('secretKey', NpfService.sanitizeKey(secretKey), true);
    if (NpfService.sanitizeKey(accessKey)) await set('accessKey', NpfService.sanitizeKey(accessKey), true);
    if (clean(activityConfigId)) await set('activityConfigId', clean(activityConfigId));
    if (enabled !== undefined) await set('enabled', !!enabled);
    await this.refresh();
    return this.status();
  }

  /** Whether the NoPaperForms integration has usable credentials. */
  isConfigured() {
    return this.enabled;
  }

  /**
   * Non-secret diagnostic view of the live config so the UI can tell the user
   * exactly why posting is/isn't enabled (e.g. which key the server is missing).
   */
  // Masked hint (first 3 + last 4 + length) so an admin can verify which key
  // is stored/sent without the full secret ever leaving the server.
  static maskKey(v) {
    if (!v) return null;
    const s = String(v);
    return s.length <= 8 ? `•••• (len ${s.length})` : `${s.slice(0, 3)}…${s.slice(-4)} (len ${s.length})`;
  }

  status() {
    const c = this.cfg || this._fromEnv();
    return {
      enabled: this.enabled,
      flagEnabled: c.enabled,
      hasSecretKey: !!c.secretKey,
      hasAccessKey: !!c.accessKey,
      secretKeyHint: NpfService.maskKey(c.secretKey),
      accessKeyHint: NpfService.maskKey(c.accessKey),
      source: this._loadedFromDb ? 'db+env' : 'env',
      baseUrl: c.baseUrl,
      activityConfigId: c.activityConfigId,
      timezone: c.timezone,
    };
  }

  /** Remove DB-stored credentials so the service falls back to server env. */
  async clearConfig() {
    try {
      await db.SystemConfig.destroy({ where: { group: 'npf' } });
    } catch (err) {
      logger.warn(`Failed to clear NPF DB config: ${err.message}`);
    }
    await this.refresh();
    return this.status();
  }

  /** Last-10-digit local mobile (NPF stores numbers without a country code). */
  static normalizeMobile(raw) {
    const digits = String(raw || '').replace(/\D/g, '');
    if (!digits) return null;
    return digits.length > 10 ? digits.slice(-10) : digits;
  }

  /** `YYYY-MM-DDTHH:MM` in the configured NPF timezone (default Asia/Kolkata). */
  static formatActivityDate(date = new Date(), tz = config.npf.timezone) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
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

  /**
   * Fetch + normalise a lead's NoPaperForms details by mobile, for the on-demand
   * "Lead details" button. Never throws — returns a structured result the UI
   * can render (record, lead id) or an error (rejected/unreachable).
   */
  /** Pull the lead record out of the various shapes NPF may return. */
  static pickRecord(raw) {
    if (!raw || typeof raw !== 'object') return null;
    let d = raw.data !== undefined ? raw.data : raw;
    if (Array.isArray(d)) return d.length ? d[0] : null;
    if (d && typeof d === 'object') {
      // Direct lead object (has recognisable lead fields)?
      const leadish = ['name', 'mobile', 'email', 'lead_stage', 'course', 'lead_id'];
      if (leadish.some((k) => k in d)) return d;
      // Otherwise it may be keyed by mobile/id → an object of objects.
      const vals = Object.values(d).filter((v) => v && typeof v === 'object');
      if (vals.length) return Array.isArray(vals[0]) ? vals[0][0] : vals[0];
      return Object.keys(d).length ? d : null;
    }
    return null;
  }

  async fetchLeadDetails(mobile, fields) {
    await this.refresh();
    if (!this.enabled) return { ok: false, reason: 'not_configured' };
    const num = NpfService.normalizeMobile(mobile);
    if (!num) return { ok: false, reason: 'no_mobile' };
    try {
      const raw = await this.getDetailsByMobileNumber(num, fields);
      const record = NpfService.pickRecord(raw);
      logger.info(`NPF lead lookup ${num}: ${record ? 'found' : 'no record'} — ${JSON.stringify(raw).slice(0, 500)}`);
      return {
        ok: true,
        mobile: num,
        leadId: NpfService.extractLeadId(raw),
        record: record && typeof record === 'object' ? record : null,
        // Always include the raw response so the UI can show what NPF returned.
        raw,
      };
    } catch (err) {
      const httpStatus = err.response ? err.response.status : null;
      const message = err.response ? JSON.stringify(err.response.data) : (err.code || err.message);
      return {
        ok: false,
        reason: httpStatus ? 'rejected' : 'unreachable',
        httpStatus,
        message: String(message).slice(0, 300),
      };
    }
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
    // Pick up DB-stored credentials without a restart.
    await this.refresh();
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
          activity_config_id: this.cfg.activityConfigId,
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
          activity_config_id: this.cfg.activityConfigId,
          search_criteria: leadId,
          lead_id: leadId,
          activity_date: {
            timezone: this.cfg.timezone,
            date: NpfService.formatActivityDate(
              call.started_at ? new Date(call.started_at) : new Date(),
              this.cfg.timezone
            ),
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
      return { skipped: true, reason: 'error', httpStatus, message: String(detail).slice(0, 300) };
    }
  }

  /**
   * Connectivity/credential check: make one real call to NoPaperForms and
   * report whether it succeeded, the HTTP status and any error body. Lets a
   * Super Admin confirm egress + key validity independent of lead matching.
   */
  async testConnection(mobile) {
    await this.refresh();
    if (!this.enabled) return { ok: false, reason: 'not_configured' };
    const num = NpfService.normalizeMobile(mobile) || '9999999999';
    // What's actually being transmitted (masked) so an admin can verify the
    // stored values + lengths match the real keys from NoPaperForms.
    const sent = {
      endpoint: `${String(this.cfg.baseUrl).replace(/\/+$/, '')}/getDetailsByMobileNumber`,
      secretKey: NpfService.maskKey(this.cfg.secretKey),
      accessKey: NpfService.maskKey(this.cfg.accessKey),
    };
    const started = Date.now();
    try {
      const data = await this.getDetailsByMobileNumber(num);
      return { ok: true, httpStatus: 200, ms: Date.now() - started, leadFound: !!NpfService.extractLeadId(data), sent };
    } catch (err) {
      const httpStatus = err.response ? err.response.status : null;
      const message = err.response ? JSON.stringify(err.response.data) : (err.code || err.message);
      return {
        ok: false,
        reason: httpStatus ? 'rejected' : 'unreachable',
        httpStatus,
        message: String(message).slice(0, 300),
        ms: Date.now() - started,
        sent,
      };
    }
  }
}

const npfService = new NpfService();
// Expose the class so the pure helpers can be unit-tested in isolation.
npfService.NpfService = NpfService;
module.exports = npfService;
