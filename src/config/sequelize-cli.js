'use strict';

// Configuration consumed by sequelize-cli (migrations & seeders).
// Mirrors the runtime config but in the shape the CLI expects.
require('dotenv').config();

const base = {
  username: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'admission_crm',
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  dialect: process.env.DB_DIALECT || 'mysql',
  dialectOptions: {
    charset: 'utf8mb4',
    dateStrings: true,
    typeCast: true,
  },
  timezone: '+05:30',
  define: {
    underscored: true,
    timestamps: true,
    paranoid: true,
  },
  logging: false,
};

module.exports = {
  development: base,
  staging: base,
  test: { ...base, database: `${base.database}_test` },
  production: { ...base, logging: false },
};
