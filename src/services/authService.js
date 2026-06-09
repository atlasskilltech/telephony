'use strict';

const crypto = require('crypto');
const axios = require('axios');
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

  /** Build the Google OAuth consent URL to redirect the user to. */
  googleAuthUrl({ state }) {
    if (!config.google.clientId) throw ApiError.badRequest('Google sign-in is not configured');
    const params = new URLSearchParams({
      client_id: config.google.clientId,
      redirect_uri: config.google.callbackUrl,
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'online',
      include_granted_scopes: 'true',
      prompt: 'select_account',
      state,
    });
    if (config.google.hostedDomain) params.set('hd', config.google.hostedDomain);
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  /**
   * Complete the Google OAuth code flow and sign the user in. Existing users
   * only — the Google email must already match an active account.
   */
  async loginWithGoogle(code, ctx = {}) {
    if (!config.google.clientId || !config.google.clientSecret) {
      throw ApiError.badRequest('Google sign-in is not configured');
    }

    // 1. Exchange the authorization code for tokens.
    let accessToken;
    try {
      const tokenRes = await axios.post(
        'https://oauth2.googleapis.com/token',
        new URLSearchParams({
          code,
          client_id: config.google.clientId,
          client_secret: config.google.clientSecret,
          redirect_uri: config.google.callbackUrl,
          grant_type: 'authorization_code',
        }).toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 }
      );
      accessToken = tokenRes.data.access_token;
    } catch (e) {
      throw ApiError.unauthorized('Google authentication failed');
    }
    if (!accessToken) throw ApiError.unauthorized('Google authentication failed');

    // 2. Fetch the verified profile.
    let profile;
    try {
      const profileRes = await axios.get('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 15000,
      });
      profile = profileRes.data || {};
    } catch (e) {
      throw ApiError.unauthorized('Could not read your Google profile');
    }

    const email = (profile.email || '').toLowerCase().trim();
    if (!email || profile.email_verified === false) {
      throw ApiError.unauthorized('Your Google email could not be verified');
    }
    if (config.google.hostedDomain && !email.endsWith(`@${config.google.hostedDomain}`)) {
      throw ApiError.forbidden(`Please sign in with your @${config.google.hostedDomain} account`);
    }

    // 3. Existing users only — no auto-provisioning.
    const user = await db.User.scope(null).findOne({
      where: { email },
      include: [{ model: db.Role, as: 'role' }],
    });
    if (!user) {
      throw ApiError.unauthorized('No account exists for this Google email. Contact your administrator.');
    }
    if (user.status !== 'active') throw ApiError.forbidden('Your account is not active');

    user.last_login_at = new Date();
    if (!user.avatar_url && profile.picture) user.avatar_url = profile.picture;
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
