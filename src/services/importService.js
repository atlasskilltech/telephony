'use strict';

const ExcelJS = require('exceljs');
const { parse: parseCsv } = require('csv-parse/sync');
const leadService = require('./leadService');
const db = require('../models');
const ApiError = require('../utils/ApiError');

/**
 * Parses CSV/XLS/XLSX uploads into rows, supports header->field column
 * mapping, validates and de-duplicates, and bulk-creates leads with an
 * error report for rows that fail.
 */
class ImportService {
  // Fields a column can be mapped to.
  static FIELDS = [
    'first_name', 'last_name', 'email', 'phone', 'alternate_phone',
    'city', 'state', 'qualification', 'course', 'intake', 'priority',
  ];

  async parseFile(file) {
    const name = (file.originalname || '').toLowerCase();
    if (name.endsWith('.csv')) return this._parseCsv(file.buffer);
    if (name.endsWith('.xlsx') || name.endsWith('.xls')) return this._parseExcel(file.buffer);
    throw ApiError.badRequest('Unsupported file type. Upload CSV, XLS or XLSX.');
  }

  _parseCsv(buffer) {
    const records = parseCsv(buffer, { columns: true, skip_empty_lines: true, trim: true });
    const headers = records.length ? Object.keys(records[0]) : [];
    return { headers, rows: records };
  }

  async _parseExcel(buffer) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = wb.worksheets[0];
    const headers = [];
    ws.getRow(1).eachCell((cell, col) => {
      headers[col - 1] = String(cell.value || '').trim();
    });
    const rows = [];
    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const obj = {};
      row.eachCell((cell, col) => {
        obj[headers[col - 1]] = cell.value == null ? '' : String(cell.value).trim();
      });
      rows.push(obj);
    });
    return { headers, rows };
  }

  /** Suggest a mapping by fuzzy-matching headers to known fields. */
  suggestMapping(headers) {
    const mapping = {};
    headers.forEach((h) => {
      const norm = h.toLowerCase().replace(/[^a-z]/g, '');
      const match = ImportService.FIELDS.find(
        (f) => norm === f.replace(/_/g, '') || norm.includes(f.replace(/_/g, ''))
      );
      if (match) mapping[h] = match;
    });
    return mapping;
  }

  _applyMapping(row, mapping) {
    const mapped = {};
    Object.entries(mapping).forEach(([header, field]) => {
      if (field && row[header] !== undefined) mapped[field] = row[header];
    });
    return mapped;
  }

  _validateRow(mapped) {
    const errors = [];
    if (!mapped.first_name) errors.push('first_name is required');
    if (!mapped.phone || !/^[0-9+\-\s]{7,15}$/.test(mapped.phone)) {
      errors.push('valid phone is required');
    }
    if (mapped.email && !/^\S+@\S+\.\S+$/.test(mapped.email)) errors.push('invalid email');
    return errors;
  }

  /**
   * Dry-run: return a preview with suggested mapping, validation results and
   * duplicate flags without writing anything.
   */
  async preview(file) {
    const { headers, rows } = await this.parseFile(file);
    const mapping = this.suggestMapping(headers);
    const phones = rows
      .map((r) => this._applyMapping(r, mapping).phone)
      .filter(Boolean)
      .map((p) => String(p).trim());

    const existing = phones.length
      ? await db.Student.findAll({ where: { phone: phones }, attributes: ['phone'] })
      : [];
    const existingSet = new Set(existing.map((s) => s.phone));

    const preview = rows.slice(0, 50).map((row, i) => {
      const mapped = this._applyMapping(row, mapping);
      const errors = this._validateRow(mapped);
      return {
        rowNumber: i + 2,
        data: mapped,
        errors,
        isDuplicate: existingSet.has(String(mapped.phone || '').trim()),
        valid: errors.length === 0,
      };
    });

    return {
      headers,
      suggestedMapping: mapping,
      availableFields: ImportService.FIELDS,
      totalRows: rows.length,
      sample: preview,
    };
  }

  /**
   * Commit the import. Skips invalid rows and (optionally) duplicates,
   * returning counts plus a per-row error report.
   */
  async commit(file, { mapping, sourceId, skipDuplicates = true, actor } = {}) {
    const { rows } = await this.parseFile(file);
    if (!mapping || !Object.keys(mapping).length) {
      throw ApiError.badRequest('Column mapping is required');
    }

    const report = { total: rows.length, imported: 0, skipped: 0, failed: 0, errors: [] };

    for (let i = 0; i < rows.length; i += 1) {
      const mapped = this._applyMapping(rows[i], mapping);
      const errors = this._validateRow(mapped);
      if (errors.length) {
        report.failed += 1;
        report.errors.push({ rowNumber: i + 2, errors });
        continue;
      }
      try {
        if (skipDuplicates) {
          const dup = await db.Student.findOne({ where: { phone: String(mapped.phone).trim() } });
          if (dup) {
            report.skipped += 1;
            continue;
          }
        }
        await leadService.create({ ...mapped, source_id: sourceId }, { actor, autoAssign: true });
        report.imported += 1;
      } catch (e) {
        report.failed += 1;
        report.errors.push({ rowNumber: i + 2, errors: [e.message] });
      }
    }

    return report;
  }
}

module.exports = new ImportService();
