'use strict';

const { Op } = require('sequelize');
const BaseRepository = require('./BaseRepository');
const db = require('../models');

/**
 * Lead-specific data access, including the heavily-filtered list query used
 * by the web dashboard and mobile app.
 */
class LeadRepository extends BaseRepository {
  constructor() {
    super(db.Lead);
  }

  defaultInclude() {
    return [
      { model: db.Student, as: 'student' },
      { model: db.LeadSource, as: 'source' },
      { model: db.LeadStatus, as: 'status' },
      { model: db.User, as: 'counselor', attributes: ['id', 'name', 'email'] },
    ];
  }

  /** Translate API filter params into a Sequelize where clause. */
  buildWhere(filters = {}) {
    const where = {};
    if (filters.status_id) where.status_id = filters.status_id;
    if (filters.source_id) where.source_id = filters.source_id;
    if (filters.assigned_to) where.assigned_to = filters.assigned_to;
    if (filters.pipeline_stage) where.pipeline_stage = filters.pipeline_stage;
    if (filters.course) where.course = { [Op.like]: `%${filters.course}%` };
    if (filters.city) where.city = { [Op.like]: `%${filters.city}%` };
    if (filters.priority) where.priority = filters.priority;
    if (filters.from || filters.to) {
      where.created_at = {};
      if (filters.from) where.created_at[Op.gte] = new Date(filters.from);
      if (filters.to) where.created_at[Op.lte] = new Date(`${filters.to}T23:59:59`);
    }
    return where;
  }

  async list(filters = {}, { page, limit } = {}) {
    const where = this.buildWhere(filters);
    const include = this.defaultInclude();

    // Free-text search across student name / phone / email.
    if (filters.search) {
      const term = `%${filters.search}%`;
      include[0].where = {
        [Op.or]: [
          { first_name: { [Op.like]: term } },
          { last_name: { [Op.like]: term } },
          { phone: { [Op.like]: term } },
          { email: { [Op.like]: term } },
        ],
      };
      include[0].required = true;
    }

    return this.paginate({ where, include, page, limit });
  }

  findFullById(id) {
    return db.Lead.findByPk(id, {
      include: [
        ...this.defaultInclude(),
        { model: db.Followup, as: 'followups', separate: true, order: [['scheduled_at', 'DESC']] },
        {
          model: db.CallLog,
          as: 'calls',
          separate: true,
          order: [['started_at', 'DESC']],
          include: [{ model: db.CallAnalysis, as: 'analysis' }],
        },
      ],
    });
  }

  /** Detect a likely duplicate lead by the student's phone number. */
  findDuplicateByPhone(phone) {
    return db.Lead.findOne({
      include: [{ model: db.Student, as: 'student', where: { phone }, required: true }],
      order: [['created_at', 'DESC']],
    });
  }
}

module.exports = new LeadRepository();
