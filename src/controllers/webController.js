'use strict';

const authService = require('../services/authService');
const { setAuthCookies } = require('./authController');
const asyncHandler = require('../utils/asyncHandler');

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

const doLogout = asyncHandler(async (req, res) => {
  await authService.logout(req.cookies && req.cookies.refresh_token);
  res.clearCookie('access_token');
  res.clearCookie('refresh_token');
  return res.redirect('/login');
});

// Authenticated pages — req.user is set by the web authenticate middleware.
const page = (view, title) => (req, res) =>
  res.render(`pages/${view}`, { title, user: req.user, roleSlug: req.roleSlug, active: view });

module.exports = {
  loginPage,
  doLogin,
  doLogout,
  dashboard: page('dashboard', 'Dashboard'),
  leads: page('leads', 'Leads'),
  pipeline: page('pipeline', 'Pipeline'),
  calls: page('calls', 'Calls'),
  followups: page('followups', 'Follow-ups'),
  reports: page('reports', 'Reports'),
};
