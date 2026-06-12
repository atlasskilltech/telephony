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

  describe('overallScore', () => {
    it('rounds the first present score field', () => {
      expect(NpfService.overallScore({ call_quality_score: 84.6 })).toBe(85);
      expect(NpfService.overallScore({ agent_score: 70 })).toBe(70);
    });
    it('defaults to 0 when nothing is present', () => {
      expect(NpfService.overallScore(null)).toBe(0);
      expect(NpfService.overallScore({})).toBe(0);
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
    it('drills into a mobile-keyed record (the lead_not_found regression)', () => {
      const payload = {
        data: {
          '8999421165': {
            name: 'Shreyash Chavan',
            mobile: '8999421165',
            lead_id: 'a416925433a6473d94272044ea71e6ea',
          },
        },
      };
      expect(NpfService.extractLeadId(payload)).toBe('a416925433a6473d94272044ea71e6ea');
    });
  });

  describe('describeHttpError', () => {
    const htmlForbidden = '<html>\r\n<head><title>403 Forbidden</title></head>\r\n<body>\r\n<center><h1>403 Forbidden</h1></center>\r\n</body>\r\n</html>\r\n';
    it('flags an HTML 403 gateway block as an IP-whitelist issue', () => {
      const msg = NpfService.describeHttpError(403, htmlForbidden);
      expect(msg).toMatch(/whitelist/i);
      expect(msg).toMatch(/outbound IP/i);
    });
    it('returns null for a normal JSON API error', () => {
      expect(NpfService.describeHttpError(400, { error: 'bad activity_config_id' })).toBeNull();
    });
    it('describes an HTML 5xx as a temporary upstream error', () => {
      expect(NpfService.describeHttpError(502, '<html><title>502 Bad Gateway</title></html>')).toMatch(/temporary/i);
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

  describe('write endpoints (403 / post-data regression)', () => {
    it('posts createDynamicActivity to a path with no trailing slash', async () => {
      const post = jest.fn().mockResolvedValue({ data: { id: 'act1' } });
      const svc = new NpfService();
      svc.client = { post };
      await svc.createDynamicActivity({ lead_id: 'x' });
      expect(post).toHaveBeenCalledWith('/postDynamicActivity', { lead_id: 'x' });
    });

    it('posts updateDynamicActivity to a path with no trailing slash', async () => {
      const post = jest.fn().mockResolvedValue({ data: { id: 'act1' } });
      const svc = new NpfService();
      svc.client = { post };
      await svc.updateDynamicActivity({ id: 'act1' });
      expect(post).toHaveBeenCalledWith('/updateDynamicActivity', { id: 'act1' });
    });

    it('sends search_criteria as the literal "lead_id", with the id in lead_id', async () => {
      const post = jest.fn((url) =>
        url === '/getDetailsByMobileNumber'
          ? Promise.resolve({ data: { data: { '6263469021': { lead_id: 'LID9' } } } })
          : Promise.resolve({ data: { id: 'act1' } })
      );
      const svc = new NpfService();
      svc.enabled = true;
      svc.refresh = jest.fn().mockResolvedValue(true);
      svc.cfg = { activityConfigId: 'cfg', timezone: 'Asia/Kolkata' };
      svc.client = { post };
      svc.resolveOwnerId = jest.fn().mockResolvedValue(null);

      const call = { id: 1, uuid: 'u1', direction: 'outbound', to_number: '6263469021', meta: {}, update: jest.fn() };
      await svc.syncCallActivity({ call, analysis: { call_quality_score: 85 }, agent: { name: 'Urvashi' } });

      const createCall = post.mock.calls.find((c) => c[0] === '/postDynamicActivity');
      expect(createCall).toBeDefined();
      expect(createCall[1].search_criteria).toBe('lead_id');
      expect(createCall[1].lead_id).toBe('LID9');
      // cf_call_scores is a bare numeric string; cf_called_by is the agent name.
      expect(createCall[1].dynamic_fields.cf_call_scores).toBe('85');
      expect(createCall[1].dynamic_fields.cf_called_by).toBe('Urvashi');
    });
  });
});
