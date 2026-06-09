'use strict';

const { body } = require('express-validator');

const strongPassword = (field) =>
  body(field)
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters')
    .matches(/[A-Za-z]/)
    .withMessage('Password must contain a letter')
    .matches(/\d/)
    .withMessage('Password must contain a number');

module.exports = {
  login: [
    body('email').isEmail().withMessage('Valid email required').normalizeEmail(),
    body('password').notEmpty().withMessage('Password required'),
  ],
  googleLogin: [body('id_token').notEmpty().withMessage('id_token is required')],
  forgotPassword: [body('email').isEmail().withMessage('Valid email required').normalizeEmail()],
  resetPassword: [
    body('token').notEmpty().withMessage('Reset token required'),
    strongPassword('new_password'),
  ],
  changePassword: [
    body('current_password').notEmpty().withMessage('Current password required'),
    strongPassword('new_password'),
  ],
};
