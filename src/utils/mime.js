'use strict';

const path = require('path');

/**
 * Minimal audio MIME helpers for call-recording uploads. Mobile dialers
 * produce a range of formats (m4a/aac/amr/3gp on Android & iOS, plus the
 * usual mp3/wav/ogg), so we keep a small lookup rather than pulling in a
 * heavyweight mime dependency.
 */
const EXT_TO_MIME = Object.freeze({
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  aac: 'audio/aac',
  amr: 'audio/amr',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  webm: 'audio/webm',
  '3gp': 'audio/3gpp',
  '3gpp': 'audio/3gpp',
  flac: 'audio/flac',
});

const MIME_TO_EXT = Object.freeze({
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/amr': 'amr',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/ogg': 'ogg',
  'audio/webm': 'webm',
  'audio/3gpp': '3gp',
  'audio/flac': 'flac',
});

/** Normalised lowercase extension (no dot) for a filename or path/key. */
function extFromName(name) {
  return path.extname(String(name || '')).replace(/^\./, '').toLowerCase();
}

/** Content-type for a file extension or filename/key. Falls back to octet-stream. */
function audioMime(extOrName) {
  const raw = String(extOrName || '');
  const ext = raw.includes('.') ? extFromName(raw) : raw.toLowerCase();
  return EXT_TO_MIME[ext] || 'application/octet-stream';
}

/**
 * Resolve a storage extension for a multer file: prefer the original
 * filename's extension, fall back to the declared mimetype, default mp3.
 */
function extFromUpload(file = {}) {
  const fromName = extFromName(file.originalname);
  if (fromName && EXT_TO_MIME[fromName]) return fromName;
  return MIME_TO_EXT[file.mimetype] || 'mp3';
}

module.exports = { audioMime, extFromUpload, extFromName, EXT_TO_MIME };
