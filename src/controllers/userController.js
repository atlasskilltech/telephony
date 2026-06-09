'use strict';

const userService = require('../services/userService');
const { success, created, paginate } = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');

const list = asyncHandler(async (req, res) => {
  const { rows, count, page, limit } = await userService.list(req.query);
  return success(res, { data: rows, meta: paginate({ page, limit, total: count }) });
});

const roles = asyncHandler(async (req, res) =>
  success(res, { data: await userService.roles() })
);

const store = asyncHandler(async (req, res) =>
  created(res, { data: await userService.create(req.body, req.user), message: 'User created' })
);

const update = asyncHandler(async (req, res) =>
  success(res, { data: await userService.update(req.params.id, req.body), message: 'User updated' })
);

const destroy = asyncHandler(async (req, res) =>
  success(res, { data: await userService.deactivate(req.params.id, req.user), message: 'User deactivated' })
);

module.exports = { list, roles, store, update, destroy };
