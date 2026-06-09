'use strict';

const crypto = require('crypto');
const { Op } = require('sequelize');
const db = require('../models');
const config = require('../config');
const ApiError = require('../utils/ApiError');
const {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  hashToken,
} = require('../utils/token');

/**
 * Encapsulates all authentication logic: credential checks, JWT issuance,
 * refresh-token rotation, session/device management and password resets.
 */
class AuthService {
  buildTokens(user) {
    const payload = { sub: user.id, role: user.role ? user.role.slug : null, uuid: user.uuid };
    return {
      accessToken: signAccessToken(payload),
      refreshToken: signRefreshToken({ sub: user.id }),
    };
  }

  async persistRefreshToken(user, refreshToken, ctx = {}) {
    const decoded = verifyRefreshToken(refreshToken);
    await db.RefreshToken.create({
      user_id: user.id,
      token_hash: hashToken(refreshToken),
      device_name: ctx.deviceName,
      device_id: ctx.deviceId,
      ip_address: ctx.ip,
      user_agent: ctx.userAgent,
      expires_at: new Date(decoded.exp * 1000),
    });
  }

  async login({ email, password }, ctx = {}) {
    const user = await db.User.scope(null).findOne({
      where: { email: email.toLowerCase().trim() },
      include: [{ model: db.Role, as: 'role' }],
    });
    if (!user) throw ApiError.unauthorized('Invalid email or password');
    if (user.status !== 'active') throw ApiError.forbidden('Your account is not active');

    const valid = await user.validatePassword(password);
    if (!valid) throw ApiError.unauthorized('Invalid email or password');

    user.last_login_at = new Date();
    await user.save();

    const tokens = this.buildTokens(user);
    await this.persistRefreshToken(user, tokens.refreshToken, ctx);
    return { user, ...tokens };
  }

  async refresh(refreshToken, ctx = {}) {
    if (!refreshToken) throw ApiError.unauthorized('Refresh token required');
    let decoded;
    try {
      decoded = verifyRefreshToken(refreshToken);
    } catch (e) {
      throw ApiError.unauthorized('Invalid refresh token');
    }

    const stored = await db.RefreshToken.findOne({
      where: { token_hash: hashToken(refreshToken), user_id: decoded.sub, revoked_at: null },
    });
    if (!stored || stored.expires_at < new Date()) {
      throw ApiError.unauthorized('Refresh token expired or revoked');
    }

    const user = await db.User.findByPk(decoded.sub, { include: [{ model: db.Role, as: 'role' }] });
    if (!user || user.status !== 'active') throw ApiError.unauthorized('Account unavailable');

    // Rotate: revoke the used token and issue a fresh pair.
    stored.revoked_at = new Date();
    await stored.save();
    const tokens = this.buildTokens(user);
    await this.persistRefreshToken(user, tokens.refreshToken, ctx);
    return { user, ...tokens };
  }

  async logout(refreshToken) {
    if (!refreshToken) return;
    await db.RefreshToken.update(
      { revoked_at: new Date() },
      { where: { token_hash: hashToken(refreshToken), revoked_at: null } }
    );
  }

  // Revoke every active session for a user (logout from all devices).
  async logoutAll(userId) {
    await db.RefreshToken.update(
      { revoked_at: new Date() },
      { where: { user_id: userId, revoked_at: null } }
    );
  }

  listSessions(userId) {
    return db.RefreshToken.findAll({
      where: { user_id: userId, revoked_at: null, expires_at: { [Op.gt]: new Date() } },
      attributes: ['id', 'device_name', 'device_id', 'ip_address', 'user_agent', 'created_at', 'expires_at'],
      order: [['created_at', 'DESC']],
    });
  }

  async changePassword(userId, currentPassword, newPassword) {
    const user = await db.User.findByPk(userId);
    if (!user) throw ApiError.notFound('User not found');
    const valid = await user.validatePassword(currentPassword);
    if (!valid) throw ApiError.badRequest('Current password is incorrect');
    user.password = newPassword;
    await user.save();
    await this.logoutAll(userId); // force re-login everywhere
  }

  async forgotPassword(email) {
    const user = await db.User.findOne({ where: { email: email.toLowerCase().trim() } });
    // Always behave the same to avoid leaking which emails exist.
    if (!user) return { token: null };
    const rawToken = crypto.randomBytes(32).toString('hex');
    user.reset_token = hashToken(rawToken);
    user.reset_token_expires = new Date(Date.now() + 60 * 60 * 1000); // 1h
    await user.save();
    return { token: rawToken, user };
  }

  async resetPassword(rawToken, newPassword) {
    const user = await db.User.findOne({
      where: { reset_token: hashToken(rawToken), reset_token_expires: { [Op.gt]: new Date() } },
    });
    if (!user) throw ApiError.badRequest('Invalid or expired reset token');
    user.password = newPassword;
    user.reset_token = null;
    user.reset_token_expires = null;
    await user.save();
    await this.logoutAll(user.id);
  }
}

module.exports = new AuthService();
