'use strict';

const axios = require('axios');
const BaseProvider = require('./BaseProvider');
const { CALL_STATUSES } = require('../../utils/constants');

/**
 * Exotel adapter. Uses the Connect API for click-to-call and maps Exotel's
 * passthru/status-callback payloads onto our canonical call shape.
 */
class ExotelProvider extends BaseProvider {
  constructor(config) {
    super(config);
    this.name = 'exotel';
  }

  _client() {
    const { sid, apiKey, apiToken, subdomain } = this.config;
    return axios.create({
      baseURL: `https://${apiKey}:${apiToken}@${subdomain}/v1/Accounts/${sid}`,
      timeout: 15000,
    });
  }

  async clickToCall({ agentNumber, customerNumber, callerId, leadId }) {
    const params = new URLSearchParams({
      From: agentNumber,
      To: customerNumber,
      CallerId: callerId || this.config.callerId,
      Record: 'true',
      StatusCallback: `${process.env.APP_URL || ''}/api/v1/telephony/webhook/exotel`,
      CustomField: leadId ? String(leadId) : '',
    });

    const res = await this._client().post('/Calls/connect.json', params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    const call = res.data.Call || {};
    return {
      providerCallId: call.Sid,
      status: this._mapStatus(call.Status),
      raw: res.data,
    };
  }

  _mapStatus(status) {
    const map = {
      'in-progress': CALL_STATUSES.IN_PROGRESS,
      completed: CALL_STATUSES.COMPLETED,
      busy: CALL_STATUSES.BUSY,
      'no-answer': CALL_STATUSES.NO_ANSWER,
      failed: CALL_STATUSES.FAILED,
      ringing: CALL_STATUSES.RINGING,
    };
    return map[(status || '').toLowerCase()] || CALL_STATUSES.INITIATED;
  }

  parseWebhook(payload) {
    const status = this._mapStatus(payload.Status || payload.CallStatus);
    const duration = parseInt(payload.ConversationDuration || payload.DialCallDuration || '0', 10);
    return {
      providerCallId: payload.CallSid,
      status,
      direction: (payload.Direction || 'outbound-api').includes('inbound') ? 'inbound' : 'outbound',
      from: payload.From,
      to: payload.To,
      duration: parseInt(payload.Duration || '0', 10) || duration,
      talkTime: duration,
      recordingUrl: payload.RecordingUrl || null,
      isMissed: ['no-answer', 'busy', 'failed'].includes((payload.Status || '').toLowerCase()),
      leadId: payload.CustomField || null,
      startedAt: payload.StartTime ? new Date(payload.StartTime) : null,
      endedAt: payload.EndTime ? new Date(payload.EndTime) : null,
      raw: payload,
    };
  }

  verifyWebhook(req) {
    const secret = this.config.webhookSecret;
    if (!secret) return true; // not enforced if unset
    return req.query.token === secret || req.headers['x-webhook-token'] === secret;
  }
}

module.exports = ExotelProvider;
