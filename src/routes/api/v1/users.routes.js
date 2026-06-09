'use strict';

const express = require('express');
const userController = require('../../../controllers/userController');
const { requirePermission } = require('../../../middlewares/authorize');

const router = express.Router();

// Role list for the create/edit form. /roles before /:id (none here, but keep tidy).
router.get('/roles', requirePermission('users.view'), userController.roles);
router.get('/', requirePermission('users.view'), userController.list);
router.post('/', requirePermission('users.create'), userController.store);
router.put('/:id', requirePermission('users.update'), userController.update);
router.delete('/:id', requirePermission('users.delete'), userController.destroy);

module.exports = router;
