'use strict';

/**
 * Consistent JSON envelope for every API response so the mobile app and
 * web clients can rely on a stable shape.
 */
function success(res, { data = null, message = 'Success', meta = null, status = 200 } = {}) {
  const payload = { success: true, message, data };
  if (meta) payload.meta = meta;
  return res.status(status).json(payload);
}

function created(res, opts = {}) {
  return success(res, { ...opts, status: 201, message: opts.message || 'Created' });
}

function fail(res, { message = 'Error', status = 400, details = null } = {}) {
  const payload = { success: false, message };
  if (details) payload.errors = details;
  return res.status(status).json(payload);
}

/**
 * Build a pagination meta block from query params and a total count.
 */
function paginate({ page = 1, limit = 20, total = 0 }) {
  const p = Math.max(1, parseInt(page, 10) || 1);
  const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  return {
    page: p,
    limit: l,
    total,
    totalPages: Math.ceil(total / l) || 1,
    offset: (p - 1) * l,
  };
}

module.exports = { success, created, fail, paginate };
