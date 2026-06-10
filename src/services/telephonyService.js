'use strict';

const crypto = require('crypto');
const db = require('../models');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const storageService = require('./storageService');
const { getProvider } = require('./telephony');
const { transcriptionQueue, notificationQueue } = require('../queues');
const { NOTIFICATION_EVENTS, CALL_DIRECTIONS, CALL_STATUSES } = require('../utils/constants');
const { audioMime, extFromUpload } = require('../utils/mime');

const toInt = (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};
const toBool = (v) => v === true || v === 'true' || v === '1' || v === 1;

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
   * Store a call placed from an agent's mobile dialer. There is no telephony
   * provider in this flow — the mobile app records the call locally and uploads
   * the audio plus metadata here. We archive the recording, persist the
   * call_logs / call_recordings rows and run the transcription + analysis
   * pipeline, so mobile calls show up exactly like provider calls in the UI.
   *
   * Idempotent on `client_call_id` so a retried upload does not duplicate.
   */
  async recordMobileCall({
    agent,
    file,
    leadId,
    toNumber,
    fromNumber,
    direction,
    status,
    durationSeconds,
    talkTimeSeconds,
    startedAt,
    endedAt,
    isMissed,
    clientCallId,
  }) {
    // A missed call carries no audio, so the recording file is optional there.
    // For any connected call the recording is still required.
    const missed = toBool(isMissed) || status === CALL_STATUSES.MISSED;
    if (!missed && (!file || !file.buffer || !file.buffer.length)) {
      throw ApiError.badRequest('No recording file uploaded');
    }

    const lead = leadId
      ? await db.Lead.findByPk(leadId, { include: [{ model: db.Student, as: 'student' }] })
      : null;
    if (leadId && !lead) throw ApiError.notFound('Lead not found');

    const customerNumber = toNumber || (lead && lead.student && lead.student.phone);
    if (!customerNumber) {
      throw ApiError.badRequest('to_number is required when no lead phone is available');
    }

    const dir = direction === CALL_DIRECTIONS.INBOUND ? CALL_DIRECTIONS.INBOUND : CALL_DIRECTIONS.OUTBOUND;
    const start = startedAt ? new Date(startedAt) : new Date();
    const duration = toInt(durationSeconds);
    const talk = talkTimeSeconds != null ? toInt(talkTimeSeconds) : duration;
    const ended = endedAt ? new Date(endedAt) : new Date(start.getTime() + duration * 1000);
    const providerCallId = `mobile-${clientCallId || crypto.randomUUID()}`;

    // Idempotent create keyed on the (unique) provider_call_id.
    const [call, isNew] = await db.CallLog.findOrCreate({
      where: { provider_call_id: providerCallId },
      defaults: {
        provider: 'mobile',
        provider_call_id: providerCallId,
        lead_id: lead ? lead.id : null,
        agent_id: agent.id,
        direction: dir,
        from_number: fromNumber || agent.phone || agent.agent_extension || null,
        to_number: customerNumber,
        status: status || CALL_STATUSES.COMPLETED,
        duration_seconds: duration,
        talk_time_seconds: talk,
        is_missed: toBool(isMissed),
        started_at: start,
        ended_at: ended,
      },
    });

    const hasRecording = Boolean(file && file.buffer && file.buffer.length);

    // Already processed (retry) — return the existing call + recording.
    if (!isNew) {
      const existing = await db.CallRecording.findOne({ where: { call_id: call.id } });
      if (existing) {
        call.setDataValue('recording', existing);
        return call;
      }
      // A missed call has no recording; the idempotent retry just returns it.
      if (!hasRecording) return call;
    }

    // Missed call without audio — log it and stop; nothing to archive or transcribe.
    if (!hasRecording) {
      await db.ActivityLog.create({
        user_id: agent.id,
        subject_type: 'lead',
        subject_id: lead ? lead.id : 0,
        action: 'call.recorded',
        description: `Missed mobile call logged for ${customerNumber}`,
      });
      return call;
    }

    // Archive the uploaded audio under a date-partitioned key.
    const ext = extFromUpload(file);
    const key = storageService.buildRecordingKey(`call-${call.id}.${ext}`, start);
    const stored = await storageService.putObject(key, file.buffer, audioMime(ext));

    const recording = await db.CallRecording.create({
      call_id: call.id,
      storage_driver: stored.driver,
      storage_key: stored.key,
      file_size_bytes: file.size || file.buffer.length,
      duration_seconds: duration || null,
      format: ext,
      status: 'archived',
      archived_at: new Date(),
    });

    await db.ActivityLog.create({
      user_id: agent.id,
      subject_type: 'lead',
      subject_id: lead ? lead.id : 0,
      action: 'call.recorded',
      description: `Mobile call recording uploaded for ${customerNumber}`,
    });

    // A connected call marks the lead "Called" and auto-advances the stage.
    const connected = !toBool(isMissed) && (status || CALL_STATUSES.COMPLETED) !== CALL_STATUSES.MISSED;
    if (lead && connected) {
      const patch = { last_contacted_at: new Date() };
      if (lead.pipeline_stage === 'new_lead') patch.pipeline_stage = 'contacted';
      await lead.update(patch);
    }

    // Transcribe + analyse off the request path (stub output if AI disabled).
    await transcriptionQueue.add('transcribe', { callId: call.id, recordingId: recording.id });

    call.setDataValue('recording', recording);
    return call;
  }

  /**
   * Re-run the transcription + analysis pipeline for an existing call without
   * re-uploading. Used to recover calls whose jobs failed (e.g. an audio
   * format Whisper couldn't read before the transcode fix).
   */
  async retryTranscription(callId) {
    const recording = await db.CallRecording.findOne({ where: { call_id: callId } });
    if (!recording) throw ApiError.notFound('No recording found for this call');
    if (!recording.storage_key && !recording.source_url) {
      throw ApiError.badRequest('Recording has no stored audio to transcribe');
    }

    // Reset statuses so the UI reflects reprocessing.
    await recording.update({ status: recording.storage_key ? 'archived' : 'pending' });
    await db.CallTranscript.update(
      { status: 'processing', error: null },
      { where: { call_id: callId } }
    );
    await db.CallAnalysis.update(
      { status: 'processing', error: null },
      { where: { call_id: callId } }
    );

    await transcriptionQueue.add('transcribe', {
      callId,
      recordingId: recording.id,
      sourceUrl: recording.source_url || undefined,
    });
    return recording;
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
