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
