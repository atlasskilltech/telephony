'use strict';

const express = require('express');
const publicController = require('../../../controllers/publicController');

const router = express.Router();

/**
 * PUBLIC (no JWT) endpoints. Access is gated by an unguessable resource uuid,
 * not a session — used by the shareable, login-free call report page.
 */
router.get('/calls/:uuid', publicController.callReport);
router.get('/calls/:uuid/recording', publicController.callRecording);

module.exports = router;
