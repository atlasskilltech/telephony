'use strict';

require('dotenv').config();

/**
 * Centralised, typed configuration object.
 * Every module reads from here instead of touching process.env directly,
 * which keeps environment handling in one place and easy to validate.
 */
const toBool = (v, def = false) =>
  v === undefined ? def : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
const toInt = (v, def) => (v === undefined || v === '' ? def : parseInt(v, 10));
const toList = (v, def = []) =>
  v ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : def;

const config = {
  env: process.env.NODE_ENV || 'development',
  isProd: (process.env.NODE_ENV || 'development') === 'production',
  app: {
    name: process.env.APP_NAME || 'Admission CRM',
    url: process.env.APP_URL || 'http://localhost:3000',
    port: toInt(process.env.PORT, 3000),
    corsOrigins: toList(process.env.CORS_ORIGINS, ['*']),
  },
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: toInt(process.env.DB_PORT, 3306),
    name: process.env.DB_NAME || 'admission_crm',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    dialect: process.env.DB_DIALECT || 'mysql',
    tablePrefix: require('./tablePrefix').tablePrefix,
    poolMax: toInt(process.env.DB_POOL_MAX, 20),
    poolMin: toInt(process.env.DB_POOL_MIN, 2),
    logging: toBool(process.env.DB_LOGGING, false),
  },
  redis: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: toInt(process.env.REDIS_PORT, 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    db: toInt(process.env.REDIS_DB, 0),
  },
  queue: {
    // Run the BullMQ consumers inside the web process so a single `npm start`
    // handles transcription/analysis with no separate `npm run worker`. Set
    // INLINE_WORKERS=false when running a dedicated worker process at scale.
    inlineWorkers: toBool(process.env.INLINE_WORKERS, true),
  },
  google: {
    // Google OAuth (web sign-in). Set these in the environment.
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    callbackUrl:
      process.env.GOOGLE_CALLBACK_URL ||
      `${process.env.APP_URL || 'http://localhost:3000'}/google/callback`,
    // Restrict to a Google Workspace domain (used as the `hd` hint and an
    // extra server-side guard). Empty string disables the restriction.
    hostedDomain: process.env.GOOGLE_HOSTED_DOMAIN || 'atlasuniversity.edu.in',
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || 'dev_access_secret',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev_refresh_secret',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
    sessionSecret: process.env.SESSION_SECRET || 'dev_session_secret',
    bcryptRounds: toInt(process.env.BCRYPT_ROUNDS, 12),
  },
  ai: {
    enabled: toBool(process.env.AI_ENABLED, true),
    apiKey: process.env.OPENAI_API_KEY || '',
    transcribeModel: process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1',
    analysisModel: process.env.OPENAI_ANALYSIS_MODEL || 'gpt-4o-mini',
  },
  storage: {
    driver: process.env.STORAGE_DRIVER || 'local',
    localPath: process.env.LOCAL_STORAGE_PATH || './storage',
    aws: {
      region: process.env.AWS_REGION || 'ap-south-1',
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      bucket: process.env.AWS_S3_BUCKET || '',
    },
  },
  telephony: {
    provider: process.env.TELEPHONY_PROVIDER || 'exotel',
    webhookSecret: process.env.TELEPHONY_WEBHOOK_SECRET || '',
    exotel: {
      sid: process.env.EXOTEL_SID || '',
      apiKey: process.env.EXOTEL_API_KEY || '',
      apiToken: process.env.EXOTEL_API_TOKEN || '',
      callerId: process.env.EXOTEL_CALLER_ID || '',
      subdomain: process.env.EXOTEL_SUBDOMAIN || 'api.exotel.com',
    },
  },
  rateLimit: {
    windowMs: toInt(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
    max: toInt(process.env.RATE_LIMIT_MAX, 300),
  },
};

module.exports = config;
