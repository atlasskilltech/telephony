'use strict';

const express = require('express');
const notificationController = require('../../../controllers/notificationController');

const router = express.Router();

router.get('/', notificationController.list);
router.post('/read-all', notificationController.markAllRead);
router.post('/:id/read', notificationController.markRead);

module.exports = router;
