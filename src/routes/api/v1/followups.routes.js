'use strict';

const express = require('express');
const { body } = require('express-validator');
const followupController = require('../../../controllers/followupController');
const validate = require('../../../middlewares/validate');
const { requirePermission } = require('../../../middlewares/authorize');

const router = express.Router();

const createRules = [
  body('lead_id').isInt().withMessage('lead_id is required'),
  body('title').trim().notEmpty().withMessage('title is required'),
  body('scheduled_at').isISO8601().withMessage('valid scheduled_at is required'),
];

router.get('/', requirePermission('followups.view'), followupController.list);
router.post('/', requirePermission('followups.create'), validate(createRules), followupController.store);
router.put('/:id', requirePermission('followups.update'), followupController.update);
router.delete('/:id', requirePermission('followups.delete'), followupController.destroy);

module.exports = router;
