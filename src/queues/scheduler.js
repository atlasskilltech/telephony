'use strict';

const { Op } = require('sequelize');
const db = require('../models');
const followupService = require('../services/followupService');
const { notificationQueue } = require('./index');
const { NOTIFICATION_EVENTS } = require('../utils/constants');
const logger = require('../utils/logger');

/**
 * Lightweight in-process scheduler for periodic maintenance:
 *  - flag overdue follow-ups
 *  - push "follow-up due" reminders for items due within the next 30 minutes
 * For larger deployments swap this for BullMQ repeatable jobs in the worker.
 */
const FIVE_MINUTES = 5 * 60 * 1000;

async function tick() {
  try {
    const overdue = await followupService.markOverdue();
    if (overdue) logger.debug(`Marked ${overdue} follow-ups overdue`);

    const soon = new Date(Date.now() + 30 * 60 * 1000);
    const due = await db.Followup.findAll({
      where: {
        status: 'pending',
        reminder_sent: false,
        scheduled_at: { [Op.lte]: soon, [Op.gte]: new Date(Date.now() - FIVE_MINUTES) },
      },
      limit: 200,
    });
    for (const f of due) {
      await notificationQueue.add(NOTIFICATION_EVENTS.FOLLOWUP_DUE, {
        userId: f.user_id,
        type: NOTIFICATION_EVENTS.FOLLOWUP_DUE,
        title: 'Follow-up due soon',
        body: f.title,
        data: { followupId: f.id, leadId: f.lead_id },
      });
      await f.update({ reminder_sent: true });
    }
  } catch (err) {
    logger.error(`Scheduler tick failed: ${err.message}`);
  }
}

function startScheduler() {
  setInterval(tick, FIVE_MINUTES).unref();
  logger.info('In-process scheduler started (5m interval)');
}

module.exports = { startScheduler, tick };
