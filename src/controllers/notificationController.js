'use strict';

const notificationService = require('../services/notificationService');
const { success } = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');

const list = asyncHandler(async (req, res) =>
  success(res, {
    data: await notificationService.list(req.user.id, { unreadOnly: req.query.unread === 'true' }),
    meta: { unread: await notificationService.unreadCount(req.user.id) },
  })
);

const markRead = asyncHandler(async (req, res) =>
  success(res, { data: await notificationService.markRead(req.user.id, req.params.id) })
);

const markAllRead = asyncHandler(async (req, res) => {
  await notificationService.markAllRead(req.user.id);
  return success(res, { message: 'All notifications marked read' });
});

module.exports = { list, markRead, markAllRead };
