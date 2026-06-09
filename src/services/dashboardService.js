'use strict';

const { Op, fn, col, literal } = require('sequelize');
const db = require('../models');
const { ROLES } = require('../utils/constants');

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

const parseJson = (v) => {
  if (v == null) return null;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch (e) { return null; }
};
const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
const scoreOf = (r) => {
  const a = r.analysis;
  if (!a) return null;
  const v = a.call_quality_score ?? a.agent_score ?? a.interest_score;
  return v == null || v === '' ? null : Number(v);
};

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

  /**
   * Call-analysis dashboard: aggregate QA metrics, score trend, sentiment
   * split, QA-parameter radar, agent leaderboard and recent calls over the
   * last N days (with deltas vs. the preceding N-day window).
   */
  async callAnalytics(user, days = 30) {
    const agentScope = this._agentScope(user);
    const now = new Date();
    const since = new Date(now.getTime() - days * 86400000);
    const prevSince = new Date(now.getTime() - 2 * days * 86400000);

    const baseInclude = [
      {
        model: db.CallAnalysis,
        as: 'analysis',
        attributes: ['sentiment', 'call_quality_score', 'agent_score', 'interest_score', 'qa_scores', 'intent', 'status'],
      },
      { model: db.User, as: 'agent', attributes: ['id', 'name'] },
      {
        model: db.Lead,
        as: 'lead',
        attributes: ['id', 'course'],
        include: [{ model: db.Student, as: 'student', attributes: ['first_name', 'last_name'] }],
      },
    ];

    const [rows, prevRows] = await Promise.all([
      db.CallLog.findAll({
        where: { ...agentScope, started_at: { [Op.gte]: since } },
        attributes: ['id', 'started_at', 'talk_time_seconds', 'duration_seconds', 'status', 'is_missed', 'direction', 'to_number', 'agent_id'],
        include: baseInclude,
        order: [['started_at', 'DESC']],
      }),
      db.CallLog.findAll({
        where: { ...agentScope, started_at: { [Op.gte]: prevSince, [Op.lt]: since } },
        attributes: ['id', 'talk_time_seconds', 'status'],
        include: [{ model: db.CallAnalysis, as: 'analysis', attributes: ['sentiment', 'call_quality_score', 'agent_score', 'interest_score'] }],
      }),
    ]);

    const basics = (list) => {
      const total = list.length;
      const scores = list.map(scoreOf).filter((v) => v != null && !Number.isNaN(v));
      const analyzed = list.filter((r) => r.analysis && r.analysis.sentiment);
      const positive = analyzed.filter((r) => r.analysis.sentiment === 'positive').length;
      const completed = list.filter((r) => r.status === 'completed').length;
      return {
        totalCalls: total,
        avgScore: scores.length ? Math.round(avg(scores)) : 0,
        avgHandleSeconds: total ? Math.round(avg(list.map((r) => Number(r.talk_time_seconds) || 0))) : 0,
        csat: analyzed.length ? Math.round((positive / analyzed.length) * 100) : 0,
        resolution: total ? Math.round((completed / total) * 100) : 0,
      };
    };

    const cur = basics(rows);
    const prev = basics(prevRows);
    const dir = (d) => (d > 0 ? 'up' : d < 0 ? 'down' : 'flat');
    const metric = (key, unit) => {
      const delta = cur[key] - prev[key];
      return { value: cur[key], delta, dir: dir(delta), unit };
    };
    const metrics = {
      totalCalls: metric('totalCalls'),
      avgScore: metric('avgScore'),
      avgHandleSeconds: metric('avgHandleSeconds'),
      csat: metric('csat', '%'),
      resolution: metric('resolution', '%'),
    };

    // Weekly score trend + volume.
    const weeks = Math.max(1, Math.ceil(days / 7));
    const buckets = Array.from({ length: weeks }, () => ({ calls: 0, sum: 0, n: 0 }));
    rows.forEach((r) => {
      const idx = Math.min(weeks - 1, Math.floor((new Date(r.started_at).getTime() - since.getTime()) / (7 * 86400000)));
      if (idx < 0) return;
      buckets[idx].calls += 1;
      const s = scoreOf(r);
      if (s != null) { buckets[idx].sum += s; buckets[idx].n += 1; }
    });
    const scoreTrend = buckets.map((b, i) => ({
      label: `W${i + 1}`, calls: b.calls, avgScore: b.n ? Math.round(b.sum / b.n) : null,
    }));

    // Sentiment split.
    const sent = { positive: 0, neutral: 0, negative: 0 };
    rows.forEach((r) => { const s = r.analysis && r.analysis.sentiment; if (s && sent[s] != null) sent[s] += 1; });
    const sentTotal = sent.positive + sent.neutral + sent.negative;
    const pct = (n) => (sentTotal ? Math.round((n / sentTotal) * 100) : 0);
    const sentimentSplit = {
      counts: sent,
      percent: { positive: pct(sent.positive), neutral: pct(sent.neutral), negative: pct(sent.negative) },
    };

    // QA parameter radar (qa_scores are 0-10 -> 0-100).
    const qaKeys = ['greeting', 'requirement_gathering', 'product_knowledge', 'communication', 'objection_handling', 'closing'];
    const qSum = {}; const qN = {};
    rows.forEach((r) => {
      const q = parseJson(r.analysis && r.analysis.qa_scores);
      if (!q) return;
      qaKeys.forEach((k) => { if (q[k] != null) { qSum[k] = (qSum[k] || 0) + Number(q[k]); qN[k] = (qN[k] || 0) + 1; } });
    });
    const qaRadar = qaKeys.map((k) => ({
      label: k.replace(/_/g, ' '), value: qN[k] ? Math.round((qSum[k] / qN[k]) * 10) : 0,
    }));

    // Agent leaderboard.
    const byAgent = {};
    rows.forEach((r) => {
      if (!r.agent_id) return;
      const o = byAgent[r.agent_id] || (byAgent[r.agent_id] = { name: r.agent ? r.agent.name : `#${r.agent_id}`, calls: 0, sum: 0, n: 0 });
      o.calls += 1;
      const s = scoreOf(r);
      if (s != null) { o.sum += s; o.n += 1; }
    });
    const agentLeaderboard = Object.values(byAgent)
      .map((o) => ({ name: o.name, calls: o.calls, avgScore: o.n ? Math.round(o.sum / o.n) : 0 }))
      .sort((a, b) => b.avgScore - a.avgScore)
      .slice(0, 8);

    // Recent calls.
    const recentCalls = rows.slice(0, 8).map((r) => ({
      id: r.id,
      agent: r.agent ? r.agent.name : '—',
      who: r.lead && r.lead.student ? r.lead.student.first_name : r.to_number,
      type: (r.analysis && r.analysis.intent) || (r.lead && r.lead.course) || r.direction,
      durationSeconds: r.talk_time_seconds || r.duration_seconds || 0,
      sentiment: r.analysis ? r.analysis.sentiment : null,
      score: scoreOf(r),
      outcome: r.is_missed ? 'missed' : r.status,
    }));

    return {
      rangeDays: days,
      analyzedCount: rows.filter((r) => r.analysis && r.analysis.status === 'completed').length,
      metrics,
      scoreTrend,
      sentimentSplit,
      qaRadar,
      agentLeaderboard,
      recentCalls,
    };
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
