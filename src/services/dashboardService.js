'use strict';

const { Op, fn, col, literal } = require('sequelize');
const db = require('../models');
const { ROLES } = require('../utils/constants');

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Aggregated metrics for the counselor dashboard and management KPIs.
 * Counselors see only their own numbers; leaders/managers see team-wide data.
 */
class DashboardService {
  _agentScope(user) {
    return user.role && user.role.slug === ROLES.COUNSELOR ? { agent_id: user.id } : {};
  }

  _leadScope(user) {
    return user.role && user.role.slug === ROLES.COUNSELOR ? { assigned_to: user.id } : {};
  }

  async counselorStats(user) {
    const today = startOfToday();
    const leadScope = this._leadScope(user);
    const agentScope = this._agentScope(user);

    const [
      todaysLeads,
      todaysCalls,
      connectedCalls,
      missedCalls,
      followupsDue,
      admissionsClosed,
      totalLeads,
      talkTime,
    ] = await Promise.all([
      db.Lead.count({ where: { ...leadScope, created_at: { [Op.gte]: today } } }),
      db.CallLog.count({ where: { ...agentScope, started_at: { [Op.gte]: today } } }),
      db.CallLog.count({
        where: { ...agentScope, status: 'completed', started_at: { [Op.gte]: today } },
      }),
      db.CallLog.count({ where: { ...agentScope, is_missed: true, started_at: { [Op.gte]: today } } }),
      db.Followup.count({
        where: {
          ...(user.role?.slug === ROLES.COUNSELOR ? { user_id: user.id } : {}),
          status: 'pending',
          scheduled_at: { [Op.lte]: new Date() },
        },
      }),
      db.Admission.count({
        where: {
          ...(user.role?.slug === ROLES.COUNSELOR ? { counselor_id: user.id } : {}),
          status: { [Op.in]: ['confirmed', 'enrolled'] },
        },
      }),
      db.Lead.count({ where: leadScope }),
      db.CallLog.sum('talk_time_seconds', { where: { ...agentScope, started_at: { [Op.gte]: today } } }),
    ]);

    const conversion = totalLeads ? Number(((admissionsClosed / totalLeads) * 100).toFixed(2)) : 0;

    return {
      todaysLeads,
      todaysCalls,
      connectedCalls,
      missedCalls,
      followupsDue,
      admissionsClosed,
      conversionRate: conversion,
      talkTimeSeconds: talkTime || 0,
    };
  }

  /** Lead counts grouped by pipeline stage — feeds the funnel chart & Kanban. */
  async pipelineFunnel(user) {
    const rows = await db.Lead.findAll({
      attributes: ['pipeline_stage', [fn('COUNT', col('id')), 'count']],
      where: this._leadScope(user),
      group: ['pipeline_stage'],
      raw: true,
    });
    return rows.map((r) => ({ stage: r.pipeline_stage, count: Number(r.count) }));
  }

  /** Daily call volume for the last N days for the activity chart. */
  async callTrend(user, days = 14) {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const rows = await db.CallLog.findAll({
      attributes: [
        [fn('DATE', col('started_at')), 'date'],
        [fn('COUNT', col('id')), 'total'],
        [fn('SUM', literal("status = 'completed'")), 'connected'],
      ],
      where: { ...this._agentScope(user), started_at: { [Op.gte]: since } },
      group: [fn('DATE', col('started_at'))],
      order: [[fn('DATE', col('started_at')), 'ASC']],
      raw: true,
    });
    return rows.map((r) => ({
      date: r.date,
      total: Number(r.total),
      connected: Number(r.connected || 0),
    }));
  }
}

module.exports = new DashboardService();
