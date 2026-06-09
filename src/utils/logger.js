'use strict';

const path = require('path');
const winston = require('winston');
require('winston-daily-rotate-file');

const isProd = (process.env.NODE_ENV || 'development') === 'production';

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  isProd
    ? winston.format.json()
    : winston.format.printf(({ level, message, timestamp, stack }) =>
        `${timestamp} [${level.toUpperCase()}] ${stack || message}`)
);

const transports = [
  new winston.transports.Console({
    format: isProd
      ? logFormat
      : winston.format.combine(winston.format.colorize(), logFormat),
  }),
];

if (isProd) {
  transports.push(
    new winston.transports.DailyRotateFile({
      dirname: path.join(process.cwd(), 'logs'),
      filename: 'app-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: '30d',
      maxSize: '20m',
    })
  );
}

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (isProd ? 'info' : 'debug'),
  format: logFormat,
  transports,
  exitOnError: false,
});

module.exports = logger;
