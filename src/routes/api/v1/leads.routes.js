'use strict';

const express = require('express');
const multer = require('multer');
const leadController = require('../../../controllers/leadController');
const importController = require('../../../controllers/importController');
const leadValidator = require('../../../validators/leadValidator');
const validate = require('../../../middlewares/validate');
const { requirePermission } = require('../../../middlewares/authorize');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB import cap
});

router.get('/', requirePermission('leads.view'), leadController.list);
router.post('/', requirePermission('leads.create'), validate(leadValidator.create), leadController.store);

// Excel/CSV import: preview (column mapping) then commit.
router.post(
  '/import/preview',
  requirePermission('leads.import'),
  upload.single('file'),
  importController.preview
);
router.post(
  '/import',
  requirePermission('leads.import'),
  upload.single('file'),
  importController.commit
);

// Assignment helpers (registered before /:id so the literal paths win).
router.get('/assignees', requirePermission('leads.assign'), leadController.assignees);
router.post('/assign-bulk', requirePermission('leads.assign'), leadController.assignBulk);

router.get('/:id', requirePermission('leads.view'), leadController.show);
router.put('/:id', requirePermission('leads.update'), validate(leadValidator.update), leadController.update);
router.delete('/:id', requirePermission('leads.delete'), leadController.destroy);
router.get('/:id/timeline', requirePermission('leads.view'), leadController.timeline);
router.post('/:id/notes', requirePermission('leads.update'), validate(leadValidator.note), leadController.addNote);
router.post('/:id/assign', requirePermission('leads.assign'), validate(leadValidator.assign), leadController.assign);
router.post('/:id/merge', requirePermission('leads.merge'), validate(leadValidator.merge), leadController.merge);

module.exports = router;
