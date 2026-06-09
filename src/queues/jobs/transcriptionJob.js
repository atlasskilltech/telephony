'use strict';

const axios = require('axios');
const db = require('../../models');
const aiService = require('../../services/aiService');
const storageService = require('../../services/storageService');
const logger = require('../../utils/logger');
const { analysisQueue } = require('../index');

/**
 * Transcription job: download the provider recording, archive it to S3/local,
 * run Whisper, persist the transcript, then enqueue AI analysis.
 */
module.exports = async function transcriptionJob(job) {
  const { callId, recordingId, sourceUrl } = job.data;
  const recording = await db.CallRecording.findByPk(recordingId);
  if (!recording) throw new Error(`Recording ${recordingId} not found`);

  // 1 + 2. Download the provider audio and archive it to durable storage with a
  // date-partitioned key. On failure mark the recording failed (the job still
  // throws so BullMQ can retry) instead of leaving it stuck in 'pending'.
  const filename = `call-${callId}.mp3`;
  let buffer;
  try {
    const response = await axios.get(sourceUrl, { responseType: 'arraybuffer', timeout: 60000 });
    buffer = Buffer.from(response.data);

    const key = storageService.buildRecordingKey(filename, new Date());
    const stored = await storageService.putObject(key, buffer, 'audio/mpeg');
    await recording.update({
      storage_driver: stored.driver,
      storage_key: stored.key,
      file_size_bytes: buffer.length,
      status: 'archived',
      archived_at: new Date(),
    });
  } catch (err) {
    await recording.update({ status: 'failed' });
    logger.error(`Failed to archive recording ${recordingId} for call ${callId}: ${err.message}`);
    throw err;
  }

  // 3. Transcribe. findOrCreate keeps retries from inserting duplicate rows
  // (the CallLog -> transcript association is hasOne).
  const [transcript] = await db.CallTranscript.findOrCreate({
    where: { call_id: callId },
    defaults: { call_id: callId, status: 'processing' },
  });
  try {
    const result = await aiService.transcribe(buffer, filename);
    await transcript.update({
      language: result.language,
      text: result.text,
      segments: result.segments,
      speaker_map: { agent: 'Counselor', customer: 'Student' },
      confidence: result.confidence,
      model: result.model,
      processing_ms: result.processingMs,
      status: 'completed',
    });
    logger.info(`Transcribed call ${callId} (${result.text.length} chars)`);
  } catch (err) {
    await transcript.update({ status: 'failed', error: err.message.slice(0, 500) });
    throw err;
  }

  // 4. Queue analysis.
  await analysisQueue.add('analyze', { callId, transcriptId: transcript.id });
  return { callId, transcriptId: transcript.id };
};
