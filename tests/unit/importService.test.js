'use strict';

// importService pulls in models (Sequelize instance, no connection needed to
// require). We only exercise pure helpers here.
const importService = require('../../src/services/importService');

describe('importService.suggestMapping', () => {
  it('maps common header variants to canonical fields', () => {
    const mapping = importService.suggestMapping([
      'First Name',
      'Phone Number',
      'Email Address',
      'City',
      'Random Column',
    ]);
    expect(mapping['First Name']).toBe('first_name');
    expect(mapping['Phone Number']).toBe('phone');
    expect(mapping['Email Address']).toBe('email');
    expect(mapping.City).toBe('city');
    expect(mapping['Random Column']).toBeUndefined();
  });
});

describe('importService row validation', () => {
  it('flags missing name and invalid phone', () => {
    const errors = importService._validateRow({ phone: 'abc' });
    expect(errors).toContain('first_name is required');
    expect(errors.some((e) => e.includes('phone'))).toBe(true);
  });

  it('accepts a valid row', () => {
    const errors = importService._validateRow({
      first_name: 'Asha',
      phone: '9876543210',
      email: 'asha@example.com',
    });
    expect(errors).toHaveLength(0);
  });
});

describe('importService CSV parsing', () => {
  it('parses CSV buffer into headers and rows', async () => {
    const csv = 'first_name,phone\nAsha,9876543210\nRavi,9123456780\n';
    const result = await importService.parseFile({
      originalname: 'leads.csv',
      buffer: Buffer.from(csv),
    });
    expect(result.headers).toEqual(['first_name', 'phone']);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].first_name).toBe('Asha');
  });
});
