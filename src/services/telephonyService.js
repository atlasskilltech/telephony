'use strict';

const db = require('../models');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const { getProvider } = require('./telephony');
const { transcriptionQueue, notificationQueue } = require('../queues');
const { NOTIFICATION_EVENTS } = require('../utils/constants');

/**
 * Orchestrates outbound dialling and inbound webhook processing, persisting
 * call_logs and kicking off the recording -> transcription -> analysis chain.
 */
class TelephonyService {
  /** Click-to-call: dial the agent then bridge to the lead's number. */
  async clickToCall({ agent, leadId, toNumber }) {
    const lead = leadId
      ? await db.Lead.findByPk(leadId, { include: [{ model: db.Student, as: 'student' }] })
      : null;
    const customerNumber = toNumber || (lead && lead.student && lead.student.phone);
    if (!customerNumber) throw ApiError.badRequest('No destination number for this call');
    if (!agent.agent_extension && !agent.phone) {
      throw ApiError.badRequest('Agent has no phone/extension configured');
    }

    const provider = getProvider();
    const result = await provider.clickToCall({
      agentNumber: agent.agent_extension || agent.phone,
      customerNumber,
      leadId,
    });

    const call = await db.CallLog.create({
      provider: provider.name,
      provider_call_id: result.providerCallId,
      lead_id: leadId || null,
      agent_id: agent.id,
      direction: 'outbound',
      from_number: agent.agent_extension || agent.phone,
      to_number: customerNumber,
      status: result.status,
      started_at: new Date(),
    });

    await db.ActivityLog.create({
      user_id: agent.id,
      subject_type: 'lead',
      subject_id: leadId || 0,
      action: 'call.initiated',
      description: `Outbound call initiated to ${customerNumber}`,
    });

    return call;
  }

  /**
   * Process a provider status-callback webhook: update the call, store the
   * recording reference and enqueue transcription when the call completes.
   */
  async handleWebhook(providerName, req) {
    const provider = getProvider(providerName);
    if (!provider.verifyWebhook(req)) throw ApiError.unauthorized('Invalid webhook signature');

    const event = provider.parseWebhook(req.body);
    if (!event.providerCallId) {
      logger.warn('Telephony webhook missing call id');
      return null;
    }

    const [call] = await db.CallLog.findOrCreate({
      where: { provider_call_id: event.providerCallId },
      defaults: {
        provider: provider.name,
        lead_id: event.leadId || null,
        direction: event.direction,
        from_number: event.from,
        to_number: event.to,
        status: event.status,
      },
    });

    await call.update({
      status: event.status,
      direction: event.direction || call.direction,
      duration_seconds: event.duration || call.duration_seconds,
      talk_time_seconds: event.talkTime || call.talk_time_seconds,
      is_missed: event.isMissed || false,
      recording_url: event.recordingUrl || call.recording_url,
      ended_at: event.endedAt || call.ended_at,
      meta: { ...(call.meta || {}), lastWebhook: event.raw },
    });

    // Missed inbound call -> notify the assigned counselor.
    if (event.isMissed && call.agent_id) {
      await notificationQueue.add(NOTIFICATION_EVENTS.MISSED_CALL, {
        userId: call.agent_id,
        type: NOTIFICATION_EVENTS.MISSED_CALL,
        title: 'Missed call',
        body: `Missed call from ${event.from}`,
        data: { callId: call.id, leadId: call.lead_id },
      });
    }

    // Completed call with a recording -> archive + transcribe asynchronously.
    if (event.status === 'completed' && event.recordingUrl) {
      const recording = await db.CallRecording.create({
        call_id: call.id,
        source_url: event.recordingUrl,
        duration_seconds: event.talkTime || event.duration || null,
        status: 'pending',
      });
      await transcriptionQueue.add('transcribe', {
        callId: call.id,
        recordingId: recording.id,
        sourceUrl: event.recordingUrl,
      });
    }

    return call;
  }
}

module.exports = new TelephonyService();
