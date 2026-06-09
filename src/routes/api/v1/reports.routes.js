'use strict';

const express = require('express');
const reportController = require('../../../controllers/reportController');
const { requirePermission } = require('../../../middlewares/authorize');

const router = express.Router();

router.get('/:type', requirePermission('reports.view'), reportController.get);
router.get('/:type/export', requirePermission('reports.export'), reportController.exportReport);

module.exports = router;
