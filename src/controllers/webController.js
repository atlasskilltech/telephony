'use strict';

const crypto = require('crypto');
const authService = require('../services/authService');
const { setAuthCookies } = require('./authController');
const asyncHandler = require('../utils/asyncHandler');
const config = require('../config');

const renderLoginError = (res, error, status = 401) =>
  res.status(status).render('auth/login', { title: 'Sign in', layout: 'layouts/blank', error });

// Render helpers for the server-rendered dashboard. Page data itself is
// hydrated client-side from the JSON API using the httpOnly cookie token.

const loginPage = (req, res) => {
  if (req.cookies && req.cookies.access_token) return res.redirect('/dashboard');
  return res.render('auth/login', { title: 'Sign in', layout: 'layouts/blank', error: null });
};

const doLogin = asyncHandler(async (req, res) => {
  try {
    const result = await authService.login(req.body, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      deviceName: 'Web',
    });
    setAuthCookies(res, result);
    return res.redirect('/dashboard');
  } catch (err) {
    return res.status(401).render('auth/login', {
      title: 'Sign in',
      layout: 'layouts/blank',
      error: err.message || 'Invalid credentials',
    });
  }
});

// Begin Google OAuth: set a CSRF state cookie and redirect to consent.
const googleStart = (req, res) => {
  if (!config.google.clientId) {
    return renderLoginError(res, 'Google sign-in is not configured.', 503);
  }
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie('g_state', state, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: 'lax',
    maxAge: 10 * 60 * 1000,
  });
  return res.redirect(authService.googleAuthUrl({ state }));
};

// Google OAuth callback: verify state, exchange code, sign in (existing users only).
const googleCallback = asyncHandler(async (req, res) => {
  const { code, state, error } = req.query;
  const expected = req.cookies && req.cookies.g_state;
  res.clearCookie('g_state');

  if (error) return renderLoginError(res, 'Google sign-in was cancelled.');
  if (!code || !state || !expected || state !== expected) {
    return renderLoginError(res, 'Invalid or expired sign-in attempt. Please try again.', 400);
  }
  try {
    const result = await authService.loginWithGoogle(code, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      deviceName: 'Web (Google)',
    });
    setAuthCookies(res, result);
    return res.redirect('/dashboard');
  } catch (err) {
    return renderLoginError(res, err.message || 'Google sign-in failed');
  }
});

const doLogout = asyncHandler(async (req, res) => {
  await authService.logout(req.cookies && req.cookies.refresh_token);
  res.clearCookie('access_token');
  res.clearCookie('refresh_token');
  return res.redirect('/login');
});

// Public, login-free call report. Renders a standalone page that hydrates from
// the public API using the call uuid in the URL.
const publicReport = (req, res) =>
  res.render('pages/publicReport', {
    title: 'Call report',
    layout: 'layouts/public',
    uuid: req.params.uuid,
  });

// Authenticated pages — req.user is set by the web authenticate middleware.
const page = (view, title) => (req, res) =>
  res.render(`pages/${view}`, { title, user: req.user, roleSlug: req.roleSlug, active: view });

// Calls page also needs to know whether the NoPaperForms integration is
// configured, so the UI can reflect/disable the manual "Post" action.
const calls = (req, res) =>
  res.render('pages/calls', {
    title: 'Call Details',
    user: req.user,
    roleSlug: req.roleSlug,
    active: 'calls',
    npfEnabled: require('../services/npfService').isConfigured(),
  });

module.exports = {
  loginPage,
  doLogin,
  googleStart,
  googleCallback,
  doLogout,
  publicReport,
  dashboard: page('dashboard', 'Dashboard'),
  leads: page('leads', 'Call Database'),
  pipeline: page('pipeline', 'Pipeline'),
  calls,
  followups: page('followups', 'Follow-ups'),
  reports: page('reports', 'Reports'),
  users: page('users', 'Users'),
};
