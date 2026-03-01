'use strict';
const { dbGet } = require('../db');

const requireAuth = (req, res, next) => {
    if (!req.session || !req.session.userId) {
        console.log(`[requireAuth] 401 — session.userId=${req.session?.userId}, session.id=${req.session?.id}, path=${req.path}`);
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = dbGet('SELECT is_banned, ban_reason FROM users WHERE id = ?', [req.session.userId]);
    if (!user) {
        req.session.destroy(() => {});
        return res.status(401).json({ error: 'Unauthorized' });
    }
    if (user.is_banned) {
        req.session.destroy((err) => {});
        return res.status(403).json({
            error: 'Account banned',
            reason: user.ban_reason || 'Your account has been banned',
            banned: true
        });
    }

    next();
};

const requireRole = (...roles) => {
    return (req, res, next) => {
        const user = dbGet('SELECT role FROM users WHERE id = ?', [req.session.userId]);
        if (!user || !roles.includes(user.role)) {
            return res.status(403).json({ error: 'Access denied. Insufficient permissions.' });
        }
        next();
    };
};

const requirePermission = (permissionName) => {
    return (req, res, next) => {
        const user = dbGet('SELECT role FROM users WHERE id = ?', [req.session.userId]);

        if (user && user.role === 'admin') {
            return next();
        }

        const hasPermission = dbGet(`
            SELECT up.id FROM user_permissions up
            JOIN permissions p ON up.permission_id = p.id
            WHERE up.user_id = ? AND p.name = ?
        `, [req.session.userId, permissionName]);

        if (!hasPermission) {
            return res.status(403).json({ error: 'Access denied. Missing permission: ' + permissionName });
        }
        next();
    };
};

module.exports = { requireAuth, requireRole, requirePermission };
