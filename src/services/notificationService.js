'use strict';

const db = require('../models');
const { emitToUser } = require('../sockets');

/**
 * Persists a notification and pushes it to the user in real time over
 * Socket.IO. Used directly and from the notification queue worker.
 */
class NotificationService {
  async notify({ userId, type, title, body, data = null }) {
    const notification = await db.Notification.create({
      user_id: userId,
      type,
      title,
      body,
      data,
    });
    emitToUser(userId, 'notification', notification.toJSON());
    return notification;
  }

  async markRead(userId, id) {
    const n = await db.Notification.findOne({ where: { id, user_id: userId } });
    if (!n) return null;
    n.read_at = new Date();
    await n.save();
    return n;
  }

  async markAllRead(userId) {
    await db.Notification.update(
      { read_at: new Date() },
      { where: { user_id: userId, read_at: null } }
    );
  }

  list(userId, { unreadOnly = false } = {}) {
    const where = { user_id: userId };
    if (unreadOnly) where.read_at = null;
    return db.Notification.findAll({ where, order: [['created_at', 'DESC']], limit: 50 });
  }

  unreadCount(userId) {
    return db.Notification.count({ where: { user_id: userId, read_at: null } });
  }
}

module.exports = new NotificationService();
