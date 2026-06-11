'use strict';

const express = require('express');
const multer = require('multer');
const callController = require('../../../controllers/callController');
const { requirePermission } = require('../../../middlewares/authorize');
const ApiError = require('../../../utils/ApiError');

const router = express.Router();

// Audio upload for mobile-dialer call recordings (kept in memory then streamed
// to S3/local). Generous cap — long calls in lossless formats can be sizeable.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok =
      /^audio\//.test(file.mimetype) ||
      /\.(mp3|m4a|mp4|aac|amr|wav|ogg|oga|opus|webm|3gp|3gpp|flac)$/i.test(file.originalname);
    cb(ok ? null : ApiError.badRequest('Unsupported audio format'), ok);
  },
});

router.get('/', requirePermission('calls.view'), callController.list);
router.get('/agents', requirePermission('calls.view'), callController.agents);
router.get('/npf-status', requirePermission('calls.view'), callController.npfStatus);
router.put('/npf-config', requirePermission('settings.update'), callController.setNpfConfig);
router.post('/npf-test', requirePermission('settings.update'), callController.npfTest);
router.post('/click-to-call', requirePermission('calls.create'), callController.clickToCall);
router.post(
  '/upload-recording',
  requirePermission('calls.create'),
  upload.single('recording'),
  callController.uploadRecording
);
router.get('/recordings/stream', requirePermission('calls.recording.view'), callController.streamRecording);
router.get('/:id', requirePermission('calls.view'), callController.show);
router.get('/:id/npf-lead', requirePermission('calls.view'), callController.npfLeadDetails);
router.post('/:id/retry-transcription', requirePermission('calls.create'), callController.retryTranscription);
router.post('/:id/npf-sync', requirePermission('calls.create'), callController.postNpf);
router.get('/:id/recording-url', requirePermission('calls.recording.view'), callController.recordingUrl);

module.exports = router;
