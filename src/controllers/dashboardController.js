'use strict';

const dashboardService = require('../services/dashboardService');
const { success } = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');

const stats = asyncHandler(async (req, res) =>
  success(res, { data: await dashboardService.counselorStats(req.user) })
);

const funnel = asyncHandler(async (req, res) =>
  success(res, { data: await dashboardService.pipelineFunnel(req.user) })
);

const callTrend = asyncHandler(async (req, res) =>
  success(res, { data: await dashboardService.callTrend(req.user, Number(req.query.days) || 14) })
);

const callAnalytics = asyncHandler(async (req, res) => {
  // from === '' (all-time) maps to null; otherwise pass through ISO strings.
  const from = req.query.from === '' ? null : req.query.from;
  return success(res, { data: await dashboardService.callAnalytics(req.user, { from, to: req.query.to }) });
});

const overview = asyncHandler(async (req, res) => {
  const [s, f, t] = await Promise.all([
    dashboardService.counselorStats(req.user),
    dashboardService.pipelineFunnel(req.user),
    dashboardService.callTrend(req.user, 14),
  ]);
  return success(res, { data: { stats: s, funnel: f, callTrend: t } });
});

module.exports = { stats, funnel, callTrend, callAnalytics, overview };
