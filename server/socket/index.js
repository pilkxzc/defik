'use strict';
const { Server } = require('socket.io');
const { getMarketPrices } = require('../services/market');

let io = null;
let priceInterval = null;
const SERVER_BUILD_ID = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function initSocket(httpServer, sessionMiddleware) {
    io = new Server(httpServer, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"],
            credentials: true
        }
    });

    // Share session with Socket.io
    io.use((socket, next) => {
        sessionMiddleware(socket.request, {}, next);
    });

    // Track connected users by their user ID
    const connectedUsers = new Map(); // userId -> Set of socket IDs

    io.on('connection', (socket) => {
        const session = socket.request.session;
        const userId = session?.userId;

        // Send current build ID so client can detect server restarts
        socket.emit('server_build', { buildId: SERVER_BUILD_ID });

        if (userId) {
            if (!connectedUsers.has(userId)) {
                connectedUsers.set(userId, new Set());
            }
            connectedUsers.get(userId).add(socket.id);

            // Join user's personal room
            socket.join(`user_${userId}`);
            console.log(`User ${userId} connected via Socket.io (${socket.id})`);

            socket.on('disconnect', () => {
                const userSockets = connectedUsers.get(userId);
                if (userSockets) {
                    userSockets.delete(socket.id);
                    if (userSockets.size === 0) {
                        connectedUsers.delete(userId);
                    }
                }
                console.log(`User ${userId} disconnected (${socket.id})`);
            });
        }
    });

    // Price broadcast every 3 seconds
    priceInterval = setInterval(async () => {
        try {
            const prices = await getMarketPrices();
            if (prices && Object.keys(prices).length > 0) {
                io.emit('priceUpdate', { prices });
            }
        } catch (e) {
            // Silently ignore — market service handles its own errors
        }
    }, 3000);

    return io;
}

function getIo() { return io; }

/**
 * Send a notification object to all sockets belonging to a specific user.
 * No-op if Socket.IO hasn't been initialised yet.
 */
function sendUserNotification(userId, notification) {
    getIo()?.to(`user_${userId}`).emit('notification', notification);
}

module.exports = { initSocket, getIo, sendUserNotification };
