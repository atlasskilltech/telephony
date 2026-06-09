'use strict';

const express = require('express');
const dashboardController = require('../../../controllers/dashboardController');
const { requirePermission } = require('../../../middlewares/authorize');

const router = express.Router();

router.get('/', requirePermission('dashboard.view'), dashboardController.overview);
router.get('/stats', requirePermission('dashboard.view'), dashboardController.stats);
router.get('/funnel', requirePermission('dashboard.view'), dashboardController.funnel);
router.get('/call-trend', requirePermission('dashboard.view'), dashboardController.callTrend);

module.exports = router;
