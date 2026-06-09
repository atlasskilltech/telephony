'use strict';

const IORedis = require('ioredis');
const config = require('./index');
const logger = require('../utils/logger');

/**
 * Shared Redis connection factory.
 * BullMQ requires `maxRetriesPerRequest: null`, so we expose a dedicated
 * options object for queue connections vs. the general-purpose client.
 */
const baseOptions = {
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  db: config.redis.db,
  lazyConnect: false,
};

const bullConnection = {
  ...baseOptions,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
};

let client;
function getRedisClient() {
  if (!client) {
    client = new IORedis(baseOptions);
    client.on('connect', () => logger.info('Redis client connected.'));
    client.on('error', (err) => logger.error(`Redis error: ${err.message}`));
  }
  return client;
}

module.exports = { getRedisClient, bullConnection, baseOptions };
