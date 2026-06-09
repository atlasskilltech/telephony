'use strict';

const { Op } = require('sequelize');
const db = require('../models');
const ApiError = require('../utils/ApiError');
const { ROLES } = require('../utils/constants');

/**
 * Follow-up scheduling with calendar/list/kanban data, overdue detection and
 * simple recurrence (next occurrence created on completion).
 */
class FollowupService {
  scope(user) {
    return user.role && user.role.slug === ROLES.COUNSELOR ? { user_id: user.id } : {};
  }

  async list(user, { status, from, to, view } = {}) {
    const where = { ...this.scope(user) };
    if (status) where.status = status;
    if (from || to) {
      where.scheduled_at = {};
      if (from) where.scheduled_at[Op.gte] = new Date(from);
      if (to) where.scheduled_at[Op.lte] = new Date(`${to}T23:59:59`);
    }
    const rows = await db.Followup.findAll({
      where,
      include: [
        { model: db.Lead, as: 'lead', include: [{ model: db.Student, as: 'student' }] },
        { model: db.User, as: 'counselor', attributes: ['id', 'name'] },
      ],
      order: [['scheduled_at', 'ASC']],
      limit: 500,
    });
    if (view === 'kanban') {
      const board = { pending: [], completed: [], overdue: [], cancelled: [] };
      rows.forEach((r) => board[r.status]?.push(r));
      return board;
    }
    return rows;
  }

  async create(user, payload) {
    const lead = await db.Lead.findByPk(payload.lead_id);
    if (!lead) throw ApiError.notFound('Lead not found');
    const followup = await db.Followup.create({
      lead_id: payload.lead_id,
      user_id: payload.user_id || user.id,
      title: payload.title,
      notes: payload.notes,
      channel: payload.channel || 'call',
      scheduled_at: payload.scheduled_at,
      recurrence: payload.recurrence || null,
    });
    await lead.update({ next_followup_at: payload.scheduled_at });
    return followup;
  }

  async update(user, id, payload) {
    const followup = await db.Followup.findByPk(id);
    if (!followup) throw ApiError.notFound('Follow-up not found');
    await followup.update(payload);

    // On completion, spawn the next occurrence for recurring follow-ups.
    if (payload.status === 'completed' && followup.recurrence) {
      await this._scheduleNext(followup);
    }
    return followup;
  }

  async _scheduleNext(followup) {
    const next = new Date(followup.scheduled_at);
    const map = { daily: 1, weekly: 7, biweekly: 14, monthly: 30 };
    next.setDate(next.getDate() + (map[followup.recurrence] || 1));
    await db.Followup.create({
      lead_id: followup.lead_id,
      user_id: followup.user_id,
      title: followup.title,
      notes: followup.notes,
      channel: followup.channel,
      scheduled_at: next,
      recurrence: followup.recurrence,
    });
  }

  async remove(id) {
    const ok = await db.Followup.destroy({ where: { id } });
    if (!ok) throw ApiError.notFound('Follow-up not found');
    return true;
  }

  /** Mark past-due pending follow-ups as overdue (called by the scheduler). */
  async markOverdue() {
    const [count] = await db.Followup.update(
      { status: 'overdue' },
      { where: { status: 'pending', scheduled_at: { [Op.lt]: new Date() } } }
    );
    return count;
  }
}

module.exports = new FollowupService();
