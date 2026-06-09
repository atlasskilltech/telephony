'use strict';

const { Op, fn, col } = require('sequelize');
const db = require('../models');
const { getRedisClient } = require('../config/redis');
const { ROLES, ASSIGNMENT_STRATEGIES } = require('../utils/constants');
const logger = require('../utils/logger');

/**
 * Lead assignment engine supporting round-robin, course-wise, city-wise,
 * team-wise and manual strategies. Round-robin position is tracked in Redis
 * so it is consistent across multiple app instances.
 */
class AssignmentService {
  async activeCounselors(filter = {}) {
    const role = await db.Role.findOne({ where: { slug: ROLES.COUNSELOR } });
    if (!role) return [];
    const where = { role_id: role.id, status: 'active', ...filter };
    return db.User.findAll({ where, attributes: ['id', 'name', 'team_leader_id', 'meta'] });
  }

  async _roundRobinPick(counselors) {
    if (!counselors.length) return null;
    const redis = getRedisClient();
    const idx = await redis.incr('assign:rr:cursor');
    return counselors[idx % counselors.length];
  }

  /** Pick the counselor with the fewest currently-open leads (load balance). */
  async _leastLoadedPick(counselors) {
    if (!counselors.length) return null;
    const ids = counselors.map((c) => c.id);
    const counts = await db.Lead.findAll({
      attributes: ['assigned_to', [fn('COUNT', col('id')), 'cnt']],
      where: { assigned_to: { [Op.in]: ids } },
      group: ['assigned_to'],
      raw: true,
    });
    const countMap = Object.fromEntries(counts.map((r) => [r.assigned_to, Number(r.cnt)]));
    return counselors.reduce((best, c) =>
      (countMap[c.id] || 0) < (countMap[best.id] || 0) ? c : best
    );
  }

  /**
   * Resolve the counselor for a lead given a strategy.
   * @returns {Promise<User|null>}
   */
  async resolveAssignee(lead, strategy = ASSIGNMENT_STRATEGIES.ROUND_ROBIN, options = {}) {
    if (strategy === ASSIGNMENT_STRATEGIES.MANUAL) {
      return options.userId ? db.User.findByPk(options.userId) : null;
    }

    let counselors = await this.activeCounselors();

    if (strategy === ASSIGNMENT_STRATEGIES.TEAM_WISE && options.teamLeaderId) {
      counselors = counselors.filter((c) => c.team_leader_id === options.teamLeaderId);
    }

    // Course/city-wise: prefer counselors whose meta lists the course/city,
    // then fall back to least-loaded among that pool (or everyone).
    if (strategy === ASSIGNMENT_STRATEGIES.COURSE_WISE && lead.course) {
      const pool = counselors.filter((c) => (c.meta?.courses || []).includes(lead.course));
      return this._leastLoadedPick(pool.length ? pool : counselors);
    }
    if (strategy === ASSIGNMENT_STRATEGIES.CITY_WISE && lead.city) {
      const pool = counselors.filter((c) => (c.meta?.cities || []).includes(lead.city));
      return this._leastLoadedPick(pool.length ? pool : counselors);
    }

    return this._roundRobinPick(counselors);
  }

  /**
   * Assign a lead and record the assignment history row.
   */
  async assign(lead, { strategy, userId, assignedBy, teamLeaderId, note } = {}) {
    const assignee = await this.resolveAssignee(lead, strategy, { userId, teamLeaderId });
    if (!assignee) {
      logger.warn(`No counselor available to assign lead ${lead.id}`);
      return null;
    }

    // Deactivate previous active assignment(s).
    await db.LeadAssignment.update(
      { is_active: false },
      { where: { lead_id: lead.id, is_active: true } }
    );

    await db.LeadAssignment.create({
      lead_id: lead.id,
      assigned_to: assignee.id,
      assigned_by: assignedBy || null,
      strategy: strategy || ASSIGNMENT_STRATEGIES.ROUND_ROBIN,
      note,
    });

    lead.assigned_to = assignee.id;
    await lead.save();
    return assignee;
  }
}

module.exports = new AssignmentService();
