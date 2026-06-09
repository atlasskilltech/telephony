'use strict';

const express = require('express');
const callController = require('../../../controllers/callController');
const { requirePermission } = require('../../../middlewares/authorize');

const router = express.Router();

router.get('/', requirePermission('calls.view'), callController.list);
router.post('/click-to-call', requirePermission('calls.create'), callController.clickToCall);
router.get('/recordings/stream', requirePermission('calls.recording.view'), callController.streamRecording);
router.get('/:id', requirePermission('calls.view'), callController.show);
router.get('/:id/recording-url', requirePermission('calls.recording.view'), callController.recordingUrl);

module.exports = router;
