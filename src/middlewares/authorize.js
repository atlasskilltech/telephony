'use strict';

const ApiError = require('../utils/ApiError');
const { ROLES } = require('../utils/constants');

/**
 * RBAC guards. `requirePermission` checks the resolved permission set;
 * `requireRole` checks the role slug. Super admin bypasses all checks.
 */
function requirePermission(...slugs) {
  return (req, res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (req.roleSlug === ROLES.SUPER_ADMIN) return next();
    const perms = req.userPermissions || new Set();
    const ok = slugs.some((slug) => perms.has(slug));
    if (!ok) return next(ApiError.forbidden('You do not have permission to perform this action'));
    return next();
  };
}

function requireRole(...roleSlugs) {
  return (req, res, next) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (req.roleSlug === ROLES.SUPER_ADMIN) return next();
    if (!roleSlugs.includes(req.roleSlug)) return next(ApiError.forbidden());
    return next();
  };
}

module.exports = { requirePermission, requireRole };
