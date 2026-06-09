'use strict';

const db = require('../models');
const logger = require('../utils/logger');

// Methods that mutate state are worth auditing.
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Records an audit row for every authenticated mutating request after the
 * response is sent, so auditing never blocks the request path.
 */
module.exports = function auditLogger(req, res, next) {
  if (!MUTATING.has(req.method)) return next();

  res.on('finish', () => {
    // Skip noisy or unauthenticated traffic.
    if (!req.user || req.originalUrl.startsWith('/api/v1/auth/refresh')) return;
    db.AuditLog.create({
      user_id: req.user.id,
      action: `${req.method.toLowerCase()}:${req.baseUrl || ''}${req.route ? req.route.path : req.path}`,
      entity: req.auditEntity || null,
      entity_id: req.auditEntityId || (req.params && req.params.id) || null,
      ip_address: req.ip,
      user_agent: (req.headers['user-agent'] || '').slice(0, 255),
      method: req.method,
      path: req.originalUrl.slice(0, 255),
      status_code: res.statusCode,
    }).catch((err) => logger.warn(`Audit log failed: ${err.message}`));
  });

  return next();
};
