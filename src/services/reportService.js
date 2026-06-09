'use strict';

const { Op, fn, col, literal } = require('sequelize');
const db = require('../models');

/**
 * Management reporting aggregations: counselor performance, lead-source and
 * course performance, and the admission funnel. Designed to be exported to
 * CSV/Excel by the controller layer.
 */
class ReportService {
  dateWhere(from, to, column = 'created_at') {
    const where = {};
    if (from || to) {
      where[column] = {};
      if (from) where[column][Op.gte] = new Date(from);
      if (to) where[column][Op.lte] = new Date(`${to}T23:59:59`);
    }
    return where;
  }

  async counselorPerformance({ from, to } = {}) {
    const calls = await db.CallLog.findAll({
      attributes: [
        'agent_id',
        [fn('COUNT', col('CallLog.id')), 'total_calls'],
        [fn('SUM', literal("status = 'completed'")), 'connected_calls'],
        [fn('SUM', col('talk_time_seconds')), 'talk_time'],
      ],
      where: { agent_id: { [Op.ne]: null }, ...this.dateWhere(from, to, 'started_at') },
      group: ['agent_id'],
      include: [{ model: db.User, as: 'agent', attributes: ['id', 'name', 'email'] }],
      raw: true,
      nest: true,
    });

    const admissions = await db.Admission.findAll({
      attributes: ['counselor_id', [fn('COUNT', col('id')), 'admissions']],
      where: { counselor_id: { [Op.ne]: null }, ...this.dateWhere(from, to) },
      group: ['counselor_id'],
      raw: true,
    });
    const admissionMap = Object.fromEntries(admissions.map((a) => [a.counselor_id, Number(a.admissions)]));

    return calls.map((c) => ({
      counselor: c.agent,
      totalCalls: Number(c.total_calls),
      connectedCalls: Number(c.connected_calls || 0),
      talkTimeSeconds: Number(c.talk_time || 0),
      admissions: admissionMap[c.agent_id] || 0,
    }));
  }

  async leadSourcePerformance({ from, to } = {}) {
    const rows = await db.Lead.findAll({
      attributes: ['source_id', [fn('COUNT', col('Lead.id')), 'leads']],
      where: this.dateWhere(from, to),
      group: ['source_id', 'source.id'],
      include: [{ model: db.LeadSource, as: 'source', attributes: ['name'] }],
      raw: true,
      nest: true,
    });
    return rows.map((r) => ({ source: r.source?.name || 'Unknown', leads: Number(r.leads) }));
  }

  async coursePerformance({ from, to } = {}) {
    const rows = await db.Lead.findAll({
      attributes: ['course', [fn('COUNT', col('id')), 'leads']],
      where: { course: { [Op.ne]: null }, ...this.dateWhere(from, to) },
      group: ['course'],
      order: [[literal('leads'), 'DESC']],
      raw: true,
    });
    return rows.map((r) => ({ course: r.course, leads: Number(r.leads) }));
  }

  async admissionFunnel() {
    const rows = await db.Lead.findAll({
      attributes: ['pipeline_stage', [fn('COUNT', col('id')), 'count']],
      group: ['pipeline_stage'],
      raw: true,
    });
    return rows.map((r) => ({ stage: r.pipeline_stage, count: Number(r.count) }));
  }
}

module.exports = new ReportService();
