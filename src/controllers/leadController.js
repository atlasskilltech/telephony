'use strict';

const leadService = require('../services/leadService');
const { success, created, paginate } = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');

const list = asyncHandler(async (req, res) => {
  const { rows, count, page, limit } = await leadService.list(req.user, req.query, {
    page: req.query.page,
    limit: req.query.limit,
  });
  return success(res, {
    data: rows,
    meta: paginate({ page, limit, total: count }),
  });
});

const show = asyncHandler(async (req, res) =>
  success(res, { data: await leadService.getById(req.user, req.params.id) })
);

const store = asyncHandler(async (req, res) => {
  const lead = await leadService.create(req.body, {
    actor: req.user,
    autoAssign: req.body.auto_assign !== false,
    strategy: req.body.strategy,
  });
  return created(res, { data: lead, message: 'Lead created' });
});

const update = asyncHandler(async (req, res) =>
  success(res, { data: await leadService.update(req.user, req.params.id, req.body), message: 'Lead updated' })
);

const assign = asyncHandler(async (req, res) =>
  success(res, {
    data: await leadService.assign(req.user, req.params.id, {
      userId: req.body.user_id,
      strategy: req.body.strategy,
      note: req.body.note,
    }),
    message: 'Lead assigned',
  })
);

const assignees = asyncHandler(async (req, res) =>
  success(res, { data: await leadService.assignees() })
);

const assignBulk = asyncHandler(async (req, res) =>
  success(res, {
    data: await leadService.assignBulk(req.user, {
      ids: req.body.ids,
      userId: req.body.user_id,
      strategy: req.body.strategy,
      note: req.body.note,
    }),
    message: 'Leads assigned',
  })
);

const addNote = asyncHandler(async (req, res) =>
  created(res, { data: await leadService.addNote(req.user, req.params.id, req.body.note), message: 'Note added' })
);

const timeline = asyncHandler(async (req, res) =>
  success(res, { data: await leadService.timeline(req.params.id) })
);

const merge = asyncHandler(async (req, res) =>
  success(res, {
    data: await leadService.merge(Number(req.params.id), Number(req.body.duplicate_id)),
    message: 'Leads merged',
  })
);

const destroy = asyncHandler(async (req, res) => {
  await leadService.remove(req.user, req.params.id);
  return success(res, { message: 'Lead deleted' });
});

module.exports = {
  list, show, store, update, assign, assignees, assignBulk, addNote, timeline, merge, destroy,
};
