'use strict';

const express = require('express');
const webController = require('../../controllers/webController');
const authenticate = require('../../middlewares/authenticate');

const router = express.Router();
const auth = authenticate({ web: true });

// Public auth pages.
router.get('/', (req, res) => res.redirect('/dashboard'));
router.get('/login', webController.loginPage);
router.post('/login', webController.doLogin);
// Google OAuth (primary sign-in). Callback registered with Google as
// {APP_URL}/google/callback.
router.get('/google', webController.googleStart);
router.get('/google/callback', webController.googleCallback);
router.post('/logout', webController.doLogout);
router.get('/logout', webController.doLogout);

// Authenticated dashboard pages.
router.get('/dashboard', auth, webController.dashboard);
router.get('/leads', auth, webController.leads);
router.get('/calls', auth, webController.calls);
router.get('/users', auth, webController.users);

// Hidden pages — kept out of the UI; direct URLs redirect to the dashboard.
router.get(['/pipeline', '/followups', '/reports'], (req, res) => res.redirect('/dashboard'));

module.exports = router;
