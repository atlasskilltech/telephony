'use strict';

// db (models) is pulled in by npfService; stub it so the unit test stays
// pure and never touches a database connection.
jest.mock('../../src/models', () => ({ NpfOwnerMap: { findOne: jest.fn() } }));

const npfService = require('../../src/services/npfService');

const { NpfService } = npfService;

describe('NpfService helpers', () => {
  describe('normalizeMobile', () => {
    it('keeps the last 10 digits of an international number', () => {
      expect(NpfService.normalizeMobile('+916263469021')).toBe('6263469021');
    });
    it('strips non-digits', () => {
      expect(NpfService.normalizeMobile('(062) 634-69021')).toBe('6263469021');
    });
    it('returns null for empty input', () => {
      expect(NpfService.normalizeMobile('')).toBeNull();
    });
  });

  describe('buildScores', () => {
    it('renders overall + per-parameter scores (0-10 scaled to 0-100)', () => {
      const s = NpfService.buildScores({
        call_quality_score: 65,
        qa_scores: { greeting: 8, closing: 6 },
        sentiment: 'neutral',
      });
      expect(s).toContain('Overall 65/100');
      expect(s).toContain('greeting 80');
      expect(s).toContain('closing 60');
      expect(s).toContain('sentiment neutral');
    });
    it('parses a stringified qa_scores object', () => {
      const s = NpfService.buildScores({ agent_score: 70, qa_scores: '{"closing":5}' });
      expect(s).toContain('Overall 70/100');
      expect(s).toContain('closing 50');
    });
  });

  describe('sanitizeKey', () => {
    it('strips surrounding double quotes (the 401 cause)', () => {
      expect(NpfService.sanitizeKey('"e3abc078"')).toBe('e3abc078');
    });
    it('strips surrounding single quotes and whitespace', () => {
      expect(NpfService.sanitizeKey("  'abc123'  ")).toBe('abc123');
    });
    it('leaves a clean key untouched', () => {
      expect(NpfService.sanitizeKey('e3abc078')).toBe('e3abc078');
    });
    it('does not strip quotes that are not a matching pair', () => {
      expect(NpfService.sanitizeKey('"abc')).toBe('"abc');
    });
  });

  describe('toFlag', () => {
    it('treats blank/undefined as the fallback (so a stray flag never disables keys)', () => {
      expect(NpfService.toFlag(undefined, true)).toBe(true);
      expect(NpfService.toFlag(null, true)).toBe(true);
      expect(NpfService.toFlag('', true)).toBe(true);
    });
    it('honours real booleans', () => {
      expect(NpfService.toFlag(false, true)).toBe(false);
      expect(NpfService.toFlag(true, false)).toBe(true);
    });
    it('parses the usual truthy/falsy strings', () => {
      expect(NpfService.toFlag('true', false)).toBe(true);
      expect(NpfService.toFlag('1', false)).toBe(true);
      expect(NpfService.toFlag('on', false)).toBe(true);
      expect(NpfService.toFlag('false', true)).toBe(false);
      expect(NpfService.toFlag('0', true)).toBe(false);
      expect(NpfService.toFlag('no', true)).toBe(false);
    });
  });

  describe('extractLeadId', () => {
    it('reads lead_id from a data array', () => {
      expect(NpfService.extractLeadId({ data: [{ lead_id: 42 }] })).toBe('42');
    });
    it('falls back to id on a bare object', () => {
      expect(NpfService.extractLeadId({ id: 7 })).toBe('7');
    });
    it('returns null when nothing matches', () => {
      expect(NpfService.extractLeadId({ data: [] })).toBeNull();
    });
  });

  describe('formatActivityDate', () => {
    it('formats as YYYY-MM-DDTHH:MM in Asia/Kolkata', () => {
      // 2026-06-11T00:00Z -> 05:30 IST
      const out = NpfService.formatActivityDate(new Date('2026-06-11T00:00:00Z'));
      expect(out).toBe('2026-06-11T05:30');
    });
  });

  describe('transcriptUrl', () => {
    it('builds a /r/:uuid url from the app url', () => {
      const url = NpfService.transcriptUrl({ uuid: 'abc-123' });
      expect(url).toMatch(/\/r\/abc-123$/);
    });
  });
});
