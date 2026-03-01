'use strict';
const { dbRun } = require('../db');
const { getLocalTime } = require('../utils/time');

function createNotification(userId, type, title, message, icon = null) {
    const result = dbRun(
        'INSERT INTO notifications (user_id, type, title, message, icon, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [userId, type, title, message, icon, getLocalTime()]
    );

    const notification = {
        id:         result.lastInsertRowid,
        type,
        title,
        message,
        icon,
        is_read:    0,
        created_at: getLocalTime()
    };

    // Lazy require to avoid circular dependency with socket/index.js
    const { sendUserNotification } = require('../socket');
    sendUserNotification(userId, notification);

    // Lazy require to avoid circular dependency with services/telegram.js
    const { sendTelegramNotification } = require('./telegram');
    sendTelegramNotification(userId, title, message, icon);

    return notification;
}

function logAdminAction(adminId, action, targetType, targetId, details, ipAddress) {
    dbRun(
        'INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, details, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
        [adminId, action, targetType, targetId, details, ipAddress]
    );
}

module.exports = { createNotification, logAdminAction };
