'use strict';

const { body, param } = require('express-validator');

module.exports = {
  create: [
    body('first_name').trim().notEmpty().withMessage('First name is required'),
    body('phone')
      .trim()
      .matches(/^[0-9+\-\s]{7,15}$/)
      .withMessage('Valid phone number is required'),
    body('email').optional({ checkFalsy: true }).isEmail().withMessage('Invalid email'),
    body('source_id').optional({ checkFalsy: true }).isInt(),
    body('status_id').optional({ checkFalsy: true }).isInt(),
    body('priority').optional().isIn(['low', 'medium', 'high', 'hot']),
  ],
  update: [
    param('id').isInt(),
    body('priority').optional().isIn(['low', 'medium', 'high', 'hot']),
    body('status_id').optional({ checkFalsy: true }).isInt(),
  ],
  assign: [
    param('id').isInt(),
    body('user_id').optional({ checkFalsy: true }).isInt(),
    body('strategy')
      .optional()
      .isIn(['round_robin', 'course_wise', 'city_wise', 'team_wise', 'manual']),
  ],
  note: [param('id').isInt(), body('note').trim().notEmpty().withMessage('Note is required')],
  merge: [param('id').isInt(), body('duplicate_id').isInt().withMessage('duplicate_id is required')],
};
