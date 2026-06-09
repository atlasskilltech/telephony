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

  // 1. Download the audio.
  const response = await axios.get(sourceUrl, { responseType: 'arraybuffer', timeout: 60000 });
  const buffer = Buffer.from(response.data);

  // 2. Archive to durable storage with a date-partitioned key.
  const filename = `call-${callId}.mp3`;
  const key = storageService.buildRecordingKey(filename, new Date());
  const stored = await storageService.putObject(key, buffer, 'audio/mpeg');
  await recording.update({
    storage_driver: stored.driver,
    storage_key: stored.key,
    file_size_bytes: buffer.length,
    status: 'archived',
    archived_at: new Date(),
  });

  // 3. Transcribe.
  const transcript = await db.CallTranscript.create({ call_id: callId, status: 'processing' });
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
