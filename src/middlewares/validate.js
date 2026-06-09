'use strict';

const { validationResult } = require('express-validator');
const ApiError = require('../utils/ApiError');

/**
 * Runs an array of express-validator chains then aggregates errors into a
 * single 422 ApiError, keeping controllers free of validation boilerplate.
 */
module.exports = function validate(validations) {
  return async (req, res, next) => {
    await Promise.all(validations.map((v) => v.run(req)));
    const result = validationResult(req);
    if (result.isEmpty()) return next();
    const details = result.array().map((e) => ({ field: e.path, message: e.msg }));
    return next(ApiError.unprocessable('Validation failed', details));
  };
};
