'use strict';

const express = require('express');
const authController = require('../../../controllers/authController');
const authValidator = require('../../../validators/authValidator');
const validate = require('../../../middlewares/validate');
const authenticate = require('../../../middlewares/authenticate');
const { authLimiter } = require('../../../middlewares/rateLimiter');

const router = express.Router();

/**
 * @route   /api/v1/auth
 * Public authentication endpoints are rate-limited to deter brute force.
 */
router.post('/login', authLimiter, validate(authValidator.login), authController.login);
// Mobile Google Sign-In — app posts the Google ID token, server verifies it.
router.post('/google', authLimiter, validate(authValidator.googleLogin), authController.googleLogin);
router.post('/refresh', authController.refresh);
router.post('/logout', authController.logout);
router.post(
  '/forgot-password',
  authLimiter,
  validate(authValidator.forgotPassword),
  authController.forgotPassword
);
router.post(
  '/reset-password',
  authLimiter,
  validate(authValidator.resetPassword),
  authController.resetPassword
);

// Authenticated session management.
router.use(authenticate());
router.get('/me', authController.me);
router.get('/sessions', authController.sessions);
router.post('/logout-all', authController.logoutAll);
router.post(
  '/change-password',
  validate(authValidator.changePassword),
  authController.changePassword
);

module.exports = router;
