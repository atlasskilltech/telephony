'use strict';

const express = require('express');
const { body } = require('express-validator');
const db = require('../../../models');
const { success } = require('../../../utils/apiResponse');
const asyncHandler = require('../../../utils/asyncHandler');
const validate = require('../../../middlewares/validate');

const router = express.Router();

router.get(
  '/',
  asyncHandler(async (req, res) => success(res, { data: req.user }))
);

router.put(
  '/',
  validate([
    body('name').optional().trim().notEmpty(),
    body('phone').optional().trim(),
    body('avatar_url').optional().isURL(),
  ]),
  asyncHandler(async (req, res) => {
    const fields = ['name', 'phone', 'avatar_url'];
    const changes = {};
    fields.forEach((f) => {
      if (req.body[f] !== undefined) changes[f] = req.body[f];
    });
    await db.User.update(changes, { where: { id: req.user.id } });
    const user = await db.User.findByPk(req.user.id, { include: [{ model: db.Role, as: 'role' }] });
    return success(res, { data: user, message: 'Profile updated' });
  })
);

module.exports = router;
