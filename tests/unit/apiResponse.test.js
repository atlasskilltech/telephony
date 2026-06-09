'use strict';

const { paginate } = require('../../src/utils/apiResponse');

describe('paginate', () => {
  it('computes pages and offset', () => {
    const meta = paginate({ page: 3, limit: 20, total: 105 });
    expect(meta).toMatchObject({ page: 3, limit: 20, total: 105, totalPages: 6, offset: 40 });
  });

  it('clamps limit to 100 and page to >=1', () => {
    expect(paginate({ page: 0, limit: 999, total: 10 }).limit).toBe(100);
    expect(paginate({ page: -5, limit: 10, total: 10 }).page).toBe(1);
  });

  it('defaults to at least one page when empty', () => {
    expect(paginate({ total: 0 }).totalPages).toBe(1);
  });
});
