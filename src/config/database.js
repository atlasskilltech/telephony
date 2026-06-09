'use strict';

const { Sequelize } = require('sequelize');
const config = require('./index');
const { withPrefix } = require('./tablePrefix');
const logger = require('../utils/logger');

/**
 * Single shared Sequelize instance for the whole application.
 * Connection pooling is tuned for high lead volume (100k+/month).
 */
const sequelize = new Sequelize(config.db.name, config.db.user, config.db.password, {
  host: config.db.host,
  port: config.db.port,
  dialect: config.db.dialect,
  logging: config.db.logging ? (msg) => logger.debug(msg) : false,
  timezone: '+05:30',
  pool: {
    max: config.db.poolMax,
    min: config.db.poolMin,
    acquire: 30000,
    idle: 10000,
  },
  dialectOptions: {
    charset: 'utf8mb4',
    dateStrings: true,
    typeCast: true,
  },
  define: {
    underscored: true,
    timestamps: true,
    paranoid: true, // soft deletes via deleted_at
    charset: 'utf8mb4',
    collate: 'utf8mb4_unicode_ci',
  },
});

// Namespace every model's table with the configured prefix (default
// `telephony_`). Models keep declaring bare table names (`users`, `leads`, …);
// this hook rewrites them once, centrally, so the prefix stays in one place.
// Associations resolve through each model's resolved tableName, so they pick
// up the prefix automatically.
sequelize.addHook('beforeDefine', (attributes, options) => {
  if (options.tableName) {
    options.tableName = withPrefix(options.tableName);
  }
});

async function connectDatabase() {
  await sequelize.authenticate();
  logger.info('MySQL connection established successfully.');
  return sequelize;
}

module.exports = { sequelize, connectDatabase };
