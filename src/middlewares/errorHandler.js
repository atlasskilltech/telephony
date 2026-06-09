'use strict';

const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const config = require('../config');

// 404 fallthrough for unmatched routes.
function notFound(req, res, next) {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}

// Central error handler — normalises Sequelize/JWT errors into ApiError shape.
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  let error = err;

  if (err.name === 'SequelizeUniqueConstraintError') {
    error = ApiError.conflict('A record with these details already exists', {
      fields: err.errors ? err.errors.map((e) => e.path) : undefined,
    });
  } else if (err.name === 'SequelizeValidationError') {
    error = ApiError.unprocessable(
      'Validation failed',
      err.errors.map((e) => ({ field: e.path, message: e.message }))
    );
  } else if (!(err instanceof ApiError)) {
    error = ApiError.internal(err.message || 'Something went wrong');
  }

  if (!error.isOperational || error.statusCode >= 500) {
    logger.error(`${error.statusCode} ${req.method} ${req.originalUrl} - ${err.message}\n${err.stack}`);
  }

  // Render an error page for non-API (web) requests.
  const wantsHtml = req.accepts(['json', 'html']) === 'html' && !req.originalUrl.startsWith('/api');
  if (wantsHtml) {
    return res.status(error.statusCode).render('pages/error', {
      title: `Error ${error.statusCode}`,
      statusCode: error.statusCode,
      message: error.message,
      layout: 'layouts/blank',
    });
  }

  const body = { success: false, message: error.message };
  if (error.details) body.errors = error.details;
  if (!config.isProd && error.statusCode >= 500) body.stack = err.stack;
  return res.status(error.statusCode).json(body);
}

module.exports = { notFound, errorHandler };
