'use strict';

const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const { getRedisClient } = require('../config/redis');
const config = require('../config');

/**
 * Redis-backed rate limiters so limits hold across multiple PM2 / container
 * instances. Falls back to in-memory store if Redis is unavailable.
 */
function buildStore(prefix) {
  try {
    const client = getRedisClient();
    return new RedisStore({
      prefix,
      sendCommand: (...args) => client.call(...args),
    });
  } catch (e) {
    return undefined;
  }
}

const apiLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  store: buildStore('rl:api:'),
  message: { success: false, message: 'Too many requests, please try again later.' },
});

// Stricter limiter for auth endpoints to slow brute-force attempts.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  store: buildStore('rl:auth:'),
  message: { success: false, message: 'Too many login attempts, please try again later.' },
});

module.exports = { apiLimiter, authLimiter };
