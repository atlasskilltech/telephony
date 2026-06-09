'use strict';

const ApiError = require('../utils/ApiError');
const { verifyAccessToken } = require('../utils/token');
const db = require('../models');

/**
 * Authenticates API requests via Bearer JWT, or web requests via the
 * `access_token` cookie. Attaches the resolved user (with role + permissions)
 * to req.user for downstream RBAC checks.
 */
async function loadUser(userId) {
  return db.User.findByPk(userId, {
    include: [
      { model: db.Role, as: 'role', include: [{ model: db.Permission, as: 'permissions' }] },
      { model: db.Permission, as: 'permissions' },
    ],
  });
}

function collectPermissions(user) {
  const rolePerms = (user.role && user.role.permissions) || [];
  const direct = user.permissions || [];
  const denied = new Set(
    direct.filter((p) => p.UserPermission && p.UserPermission.effect === 'deny').map((p) => p.slug)
  );
  const allowed = new Set(rolePerms.map((p) => p.slug));
  direct
    .filter((p) => !p.UserPermission || p.UserPermission.effect === 'allow')
    .forEach((p) => allowed.add(p.slug));
  denied.forEach((slug) => allowed.delete(slug));
  return allowed;
}

function extractToken(req) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.slice(7);
  if (req.cookies && req.cookies.access_token) return req.cookies.access_token;
  return null;
}

module.exports = function authenticate({ web = false } = {}) {
  return async (req, res, next) => {
    try {
      const token = extractToken(req);
      if (!token) {
        if (web) return res.redirect('/login');
        throw ApiError.unauthorized('Authentication token missing');
      }
      const decoded = verifyAccessToken(token);
      const user = await loadUser(decoded.sub);
      if (!user || user.status !== 'active') {
        if (web) return res.redirect('/login');
        throw ApiError.unauthorized('Invalid or inactive account');
      }
      req.user = user;
      req.userPermissions = collectPermissions(user);
      req.roleSlug = user.role ? user.role.slug : null;
      return next();
    } catch (err) {
      if (web) return res.redirect('/login');
      if (err.name === 'TokenExpiredError') return next(ApiError.unauthorized('Token expired'));
      if (err.name === 'JsonWebTokenError') return next(ApiError.unauthorized('Invalid token'));
      return next(err);
    }
  };
};

module.exports.collectPermissions = collectPermissions;
