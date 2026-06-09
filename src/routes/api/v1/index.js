'use strict';

const express = require('express');
const authenticate = require('../../../middlewares/authenticate');
const auditLogger = require('../../../middlewares/auditLogger');

const authRoutes = require('./auth.routes');
const telephonyRoutes = require('./telephony.routes');
const dashboardRoutes = require('./dashboard.routes');
const leadRoutes = require('./leads.routes');
const callRoutes = require('./calls.routes');
const followupRoutes = require('./followups.routes');
const notificationRoutes = require('./notifications.routes');
const reportRoutes = require('./reports.routes');
const profileRoutes = require('./profile.routes');

const router = express.Router();

router.get('/health', (req, res) => res.json({ success: true, status: 'ok', ts: Date.now() }));

// Public: authentication + provider webhooks.
router.use('/auth', authRoutes);
router.use('/telephony', telephonyRoutes);

// Everything below requires a valid access token.
router.use(authenticate());
router.use(auditLogger);

router.use('/dashboard', dashboardRoutes);
router.use('/leads', leadRoutes);
router.use('/calls', callRoutes);
router.use('/followups', followupRoutes);
router.use('/notifications', notificationRoutes);
router.use('/reports', reportRoutes);
router.use('/profile', profileRoutes);

module.exports = router;
