'use strict';

const importService = require('../services/importService');
const { success } = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');

const preview = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('No file uploaded');
  return success(res, { data: await importService.preview(req.file) });
});

const commit = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('No file uploaded');
  // Mapping may arrive as a JSON string in multipart form data.
  let mapping = req.body.mapping;
  if (typeof mapping === 'string') {
    try {
      mapping = JSON.parse(mapping);
    } catch (e) {
      throw ApiError.badRequest('Invalid mapping JSON');
    }
  }
  const report = await importService.commit(req.file, {
    mapping,
    sourceId: req.body.source_id || null,
    skipDuplicates: req.body.skip_duplicates !== 'false',
    actor: req.user,
  });
  return success(res, { data: report, message: 'Import completed' });
});

module.exports = { preview, commit };
