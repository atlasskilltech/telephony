'use strict';

process.env.JWT_ACCESS_SECRET = 'test_access';
process.env.JWT_REFRESH_SECRET = 'test_refresh';

const request = require('supertest');
const app = require('../../src/app');

describe('API smoke tests', () => {
  it('GET /api/v1/health returns ok', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, status: 'ok' });
  });

  it('rejects protected routes without a token', async () => {
    const res = await request(app).get('/api/v1/leads');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('returns 422 on invalid login payload', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'not-an-email' });
    expect(res.status).toBe(422);
  });

  it('returns 404 for unknown routes', async () => {
    const res = await request(app).get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
  });
});
