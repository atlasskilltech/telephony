'use strict';

const followupService = require('../services/followupService');
const { success, created } = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');

const list = asyncHandler(async (req, res) =>
  success(res, { data: await followupService.list(req.user, req.query) })
);

const store = asyncHandler(async (req, res) =>
  created(res, { data: await followupService.create(req.user, req.body), message: 'Follow-up created' })
);

const update = asyncHandler(async (req, res) =>
  success(res, { data: await followupService.update(req.user, req.params.id, req.body), message: 'Follow-up updated' })
);

const destroy = asyncHandler(async (req, res) => {
  await followupService.remove(req.params.id);
  return success(res, { message: 'Follow-up deleted' });
});

module.exports = { list, store, update, destroy };
