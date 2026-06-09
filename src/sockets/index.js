'use strict';

const { Server } = require('socket.io');
const { verifyAccessToken } = require('../utils/token');
const config = require('../config');
const logger = require('../utils/logger');

let io = null;

/**
 * Attaches a JWT-authenticated Socket.IO server to the HTTP server. Each
 * authenticated user joins a personal room (`user:<id>`) and a role room so
 * the app can target notifications precisely.
 */
function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: config.app.corsOrigins, credentials: true },
  });

  io.use((socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        (socket.handshake.headers.authorization || '').replace('Bearer ', '');
      if (!token) return next(new Error('Authentication required'));
      const decoded = verifyAccessToken(token);
      socket.userId = decoded.sub;
      socket.role = decoded.role;
      return next();
    } catch (e) {
      return next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(`user:${socket.userId}`);
    if (socket.role) socket.join(`role:${socket.role}`);
    logger.debug(`Socket connected: user ${socket.userId}`);

    socket.on('disconnect', () => logger.debug(`Socket disconnected: user ${socket.userId}`));
  });

  return io;
}

function getIo() {
  if (!io) throw new Error('Socket.IO not initialised');
  return io;
}

// Safe emit helpers used by services/workers.
function emitToUser(userId, event, payload) {
  if (io) io.to(`user:${userId}`).emit(event, payload);
}
function emitToRole(role, event, payload) {
  if (io) io.to(`role:${role}`).emit(event, payload);
}

module.exports = { initSocket, getIo, emitToUser, emitToRole };
