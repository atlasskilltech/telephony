'use strict';

const authService = require('../services/authService');
const { success } = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');
const { emailQueue } = require('../queues');

function requestContext(req) {
  return {
    ip: req.ip,
    userAgent: (req.headers['user-agent'] || '').slice(0, 255),
    deviceName: req.body.device_name,
    deviceId: req.body.device_id,
  };
}

// 30 days in ms for the refresh cookie maxAge.
const REFRESH_COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000;

function setAuthCookies(res, tokens) {
  const secure = process.env.NODE_ENV === 'production';
  res.cookie('access_token', tokens.accessToken, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    maxAge: 15 * 60 * 1000,
  });
  res.cookie('refresh_token', tokens.refreshToken, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    maxAge: REFRESH_COOKIE_MAX_AGE,
  });
}

const login = asyncHandler(async (req, res) => {
  const result = await authService.login(req.body, requestContext(req));
  setAuthCookies(res, result);
  return success(res, {
    message: 'Logged in successfully',
    data: {
      user: result.user,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    },
  });
});

const refresh = asyncHandler(async (req, res) => {
  const token = req.body.refresh_token || (req.cookies && req.cookies.refresh_token);
  const result = await authService.refresh(token, requestContext(req));
  setAuthCookies(res, result);
  return success(res, {
    message: 'Token refreshed',
    data: { accessToken: result.accessToken, refreshToken: result.refreshToken },
  });
});

const logout = asyncHandler(async (req, res) => {
  const token = req.body.refresh_token || (req.cookies && req.cookies.refresh_token);
  await authService.logout(token);
  res.clearCookie('access_token');
  res.clearCookie('refresh_token');
  return success(res, { message: 'Logged out' });
});

const logoutAll = asyncHandler(async (req, res) => {
  await authService.logoutAll(req.user.id);
  res.clearCookie('access_token');
  res.clearCookie('refresh_token');
  return success(res, { message: 'Logged out from all devices' });
});

const me = asyncHandler(async (req, res) =>
  success(res, {
    data: { user: req.user, permissions: Array.from(req.userPermissions || []) },
  })
);

const sessions = asyncHandler(async (req, res) =>
  success(res, { data: await authService.listSessions(req.user.id) })
);

const changePassword = asyncHandler(async (req, res) => {
  await authService.changePassword(req.user.id, req.body.current_password, req.body.new_password);
  return success(res, { message: 'Password changed. Please log in again.' });
});

const forgotPassword = asyncHandler(async (req, res) => {
  const { token, user } = await authService.forgotPassword(req.body.email);
  if (token && user) {
    // Dispatch the reset email asynchronously via the queue.
    await emailQueue.add('password_reset', {
      to: user.email,
      template: 'password_reset',
      context: { name: user.name, token },
    });
  }
  return success(res, {
    message: 'If that email exists, a password reset link has been sent.',
  });
});

const resetPassword = asyncHandler(async (req, res) => {
  await authService.resetPassword(req.body.token, req.body.new_password);
  return success(res, { message: 'Password reset successful. Please log in.' });
});

module.exports = {
  login,
  refresh,
  logout,
  logoutAll,
  me,
  sessions,
  changePassword,
  forgotPassword,
  resetPassword,
  setAuthCookies,
};
