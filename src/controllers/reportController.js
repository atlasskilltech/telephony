'use strict';

const ExcelJS = require('exceljs');
const reportService = require('../services/reportService');
const { success } = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');

const REPORTS = {
  'counselor-performance': (q) => reportService.counselorPerformance(q),
  'lead-source': (q) => reportService.leadSourcePerformance(q),
  'course': (q) => reportService.coursePerformance(q),
  'admission-funnel': () => reportService.admissionFunnel(),
};

const get = asyncHandler(async (req, res) => {
  const fn = REPORTS[req.params.type];
  if (!fn) throw ApiError.notFound('Unknown report');
  const data = await fn(req.query);
  return success(res, { data });
});

// Export any report as CSV or Excel.
const exportReport = asyncHandler(async (req, res) => {
  const fn = REPORTS[req.params.type];
  if (!fn) throw ApiError.notFound('Unknown report');
  const rows = await fn(req.query);
  const format = (req.query.format || 'csv').toLowerCase();
  const flat = rows.map((r) => flatten(r));
  const headers = flat.length ? Object.keys(flat[0]) : [];

  if (format === 'excel' || format === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Report');
    ws.columns = headers.map((h) => ({ header: h, key: h }));
    flat.forEach((r) => ws.addRow(r));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.type}.xlsx"`);
    await wb.xlsx.write(res);
    return res.end();
  }

  // CSV
  const csv = [headers.join(',')]
    .concat(flat.map((r) => headers.map((h) => csvCell(r[h])).join(',')))
    .join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.type}.csv"`);
  return res.send(csv);
});

function flatten(obj, prefix = '') {
  const out = {};
  Object.entries(obj).forEach(([k, v]) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, flatten(v, `${prefix}${k}_`));
    } else {
      out[`${prefix}${k}`] = Array.isArray(v) ? v.join('; ') : v;
    }
  });
  return out;
}
function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

module.exports = { get, exportReport };
