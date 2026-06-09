'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const logger = require('./logger');
const { extFromName } = require('./mime');

/**
 * Audio formats OpenAI Whisper accepts natively. Anything else (amr, 3gp,
 * aac, opus, caf, …) produced by mobile dialers must be transcoded first.
 */
const WHISPER_FORMATS = new Set([
  'flac', 'm4a', 'mp3', 'mp4', 'mpeg', 'mpga', 'oga', 'ogg', 'wav', 'webm',
]);

function isWhisperCompatible(ext) {
  return WHISPER_FORMATS.has(String(ext || '').toLowerCase());
}

/**
 * Transcode an audio buffer to mono 16 kHz MP3 (ideal for speech-to-text)
 * using the bundled static ffmpeg. Uses temp files so container formats that
 * need seeking (m4a/3gp/mp4) decode reliably. Returns a Buffer.
 */
function transcodeToMp3(buffer, sourceExt = 'bin') {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      return reject(new Error('ffmpeg binary not available (ffmpeg-static)'));
    }
    const id = crypto.randomBytes(8).toString('hex');
    const inPath = path.join(os.tmpdir(), `rec-${id}.${sourceExt || 'bin'}`);
    const outPath = path.join(os.tmpdir(), `rec-${id}.mp3`);
    const cleanup = () => {
      fs.promises.unlink(inPath).catch(() => {});
      fs.promises.unlink(outPath).catch(() => {});
    };

    fs.promises
      .writeFile(inPath, buffer)
      .then(() => {
        execFile(
          ffmpegPath,
          ['-y', '-i', inPath, '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-q:a', '4', outPath],
          { timeout: 120000, maxBuffer: 1024 * 1024 * 10 },
          (err) => {
            if (err) {
              cleanup();
              return reject(new Error(`ffmpeg transcode failed: ${err.message}`));
            }
            fs.promises
              .readFile(outPath)
              .then((out) => {
                cleanup();
                resolve(out);
              })
              .catch((e) => {
                cleanup();
                reject(e);
              });
          }
        );
      })
      .catch(reject);
  });
}

/**
 * Ensure an audio buffer is in a Whisper-compatible format. If it already is,
 * returns it unchanged; otherwise transcodes to mp3.
 * @returns {Promise<{buffer: Buffer, ext: string, filename: string}>}
 */
async function ensureWhisperCompatible(buffer, extOrName, baseName = 'recording') {
  const ext = (String(extOrName || '').includes('.') ? extFromName(extOrName) : String(extOrName || '')).toLowerCase();
  if (isWhisperCompatible(ext)) {
    return { buffer, ext, filename: `${baseName}.${ext}` };
  }
  logger.info(`Transcoding "${ext || 'unknown'}" recording to mp3 for transcription`);
  const out = await transcodeToMp3(buffer, ext || 'bin');
  return { buffer: out, ext: 'mp3', filename: `${baseName}.mp3` };
}

module.exports = { ensureWhisperCompatible, transcodeToMp3, isWhisperCompatible, WHISPER_FORMATS };
