'use strict';

const axios = require('axios');
const db = require('../../models');
const aiService = require('../../services/aiService');
const storageService = require('../../services/storageService');
const logger = require('../../utils/logger');
const { audioMime } = require('../../utils/mime');
const { ensureWhisperCompatible } = require('../../utils/audioTranscode');
const { analysisQueue } = require('../index');

/**
 * Transcription job: obtain the recording audio (read back a mobile upload
 * that is already archived, or download + archive a provider recording),
 * run Whisper, persist the transcript, then enqueue AI analysis.
 */
module.exports = async function transcriptionJob(job) {
  const { callId, recordingId, sourceUrl } = job.data;
  const recording = await db.CallRecording.findByPk(recordingId);
  if (!recording) throw new Error(`Recording ${recordingId} not found`);

  // 1 + 2. Obtain the audio buffer. Mobile uploads arrive already archived
  // (storage_key set), so we read it straight back from storage. Provider
  // webhooks give a source_url to download and then archive. On failure mark
  // the recording failed (the job still throws so BullMQ can retry) instead of
  // leaving it stuck in 'pending'.
  const ext = recording.format || 'mp3';
  const filename = `call-${callId}.${ext}`;
  let buffer;
  try {
    if (recording.storage_key) {
      buffer = await storageService.getObjectBuffer(recording.storage_key);
    } else {
      const url = sourceUrl || recording.source_url;
      const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 60000 });
      buffer = Buffer.from(response.data);

      const key = storageService.buildRecordingKey(filename, new Date());
      const stored = await storageService.putObject(key, buffer, audioMime(ext));
      await recording.update({
        storage_driver: stored.driver,
        storage_key: stored.key,
        file_size_bytes: buffer.length,
        status: 'archived',
        archived_at: new Date(),
      });
    }
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
    // Mobile dialers emit formats Whisper can't read (amr/3gp/aac/opus) — make
    // sure we hand it a compatible file, transcoding to mp3 when necessary.
    const audio = await ensureWhisperCompatible(buffer, ext, `call-${callId}`);
    const result = await aiService.transcribe(audio.buffer, audio.filename);
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
