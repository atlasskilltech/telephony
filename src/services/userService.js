'use strict';

const crypto = require('crypto');
const { Op } = require('sequelize');
const db = require('../models');
const ApiError = require('../utils/ApiError');

const SAFE_ATTRS = { exclude: ['password', 'reset_token', 'reset_token_expires'] };

/**
 * User management: list/create/update users and expose the role list. Sign-in
 * is Google-only, so a created user does not need a password — a random one is
 * stored to satisfy the schema; they authenticate via Google by email.
 */
class UserService {
  async list({ search, role, status, page = 1, limit = 20 } = {}) {
    const where = {};
    if (status) where.status = status;
    if (search) {
      where[Op.or] = [
        { name: { [Op.like]: `%${search}%` } },
        { email: { [Op.like]: `%${search}%` } },
      ];
    }
    const roleInclude = { model: db.Role, as: 'role', attributes: ['id', 'name', 'slug'] };
    if (role) roleInclude.where = { slug: role };

    const p = Math.max(1, parseInt(page, 10) || 1);
    const l = Math.min(100, parseInt(limit, 10) || 20);
    const { rows, count } = await db.User.findAndCountAll({
      where,
      include: [roleInclude],
      attributes: SAFE_ATTRS,
      order: [['created_at', 'DESC']],
      limit: l,
      offset: (p - 1) * l,
      distinct: true,
    });
    return { rows, count, page: p, limit: l };
  }

  roles() {
    return db.Role.findAll({ attributes: ['id', 'name', 'slug'], order: [['id', 'ASC']] });
  }

  findById(id) {
    return db.User.findByPk(id, {
      include: [{ model: db.Role, as: 'role', attributes: ['id', 'name', 'slug'] }],
      attributes: SAFE_ATTRS,
    });
  }

  async _resolveRole({ role_id: roleId, role_slug: roleSlug }) {
    let role = null;
    if (roleId) role = await db.Role.findByPk(roleId);
    else if (roleSlug) role = await db.Role.findOne({ where: { slug: roleSlug } });
    if (!role) throw ApiError.badRequest('A valid role is required');
    return role;
  }

  async create(payload, actor) {
    const name = String(payload.name || '').trim();
    const email = String(payload.email || '').toLowerCase().trim();
    if (!name) throw ApiError.badRequest('Name is required');
    if (!/^\S+@\S+\.\S+$/.test(email)) throw ApiError.badRequest('A valid email is required');

    const exists = await db.User.findOne({ where: { email } });
    if (exists) throw ApiError.conflict('A user with this email already exists');

    const role = await this._resolveRole(payload);
    // Google-only sign-in: no password needed — store a random one.
    const password = payload.password || crypto.randomBytes(24).toString('hex');

    const user = await db.User.create({
      name,
      email,
      phone: payload.phone || null,
      password,
      role_id: role.id,
      agent_extension: payload.agent_extension || null,
      team_leader_id: payload.team_leader_id || null,
      status: payload.status || 'active',
      created_by: actor ? actor.id : null,
    });
    return this.findById(user.id);
  }

  async update(id, payload) {
    const user = await db.User.findByPk(id);
    if (!user) throw ApiError.notFound('User not found');

    const changes = {};
    ['name', 'phone', 'agent_extension', 'team_leader_id', 'status'].forEach((f) => {
      if (payload[f] !== undefined) changes[f] = payload[f];
    });
    if (payload.role_id || payload.role_slug) {
      const role = await this._resolveRole(payload);
      changes.role_id = role.id;
    }
    if (payload.password) changes.password = payload.password;

    await user.update(changes);
    return this.findById(id);
  }

  /** Deactivate (soft) — we keep the row and history, just block sign-in. */
  async deactivate(id, actor) {
    const user = await db.User.findByPk(id);
    if (!user) throw ApiError.notFound('User not found');
    if (actor && actor.id === user.id) throw ApiError.badRequest('You cannot deactivate yourself');
    await user.update({ status: 'inactive' });
    return this.findById(id);
  }
}

module.exports = new UserService();
