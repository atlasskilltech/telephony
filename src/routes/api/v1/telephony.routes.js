'use strict';

const express = require('express');
const callController = require('../../../controllers/callController');

const router = express.Router();

/**
 * Provider webhooks are PUBLIC (no JWT) — authenticity is verified per
 * provider via signature/secret inside the controller/service.
 */
router.post('/webhook/:provider', callController.webhook);
// Some providers send GET callbacks.
router.get('/webhook/:provider', (req, res, next) => {
  req.body = { ...req.query, ...req.body };
  return callController.webhook(req, res, next);
});

module.exports = router;
