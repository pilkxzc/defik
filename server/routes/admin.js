'use strict';
const express = require('express');
const bcrypt  = require('bcryptjs');
const router  = express.Router();

const { dbGet, dbAll, dbRun, saveDatabase } = require('../db');
const { requireAuth, requireRole }          = require('../middleware/auth');
const { getClientIP }                       = require('../utils/ip');
const { getLocalTime, getLocalTimeDaysAgo } = require('../utils/time');
const { siteSettings, saveSettings }        = require('../config');
const { logAdminAction }                    = require('../services/notifications');

function createNotification(...args) {
    return require('../services/notifications').createNotification(...args);
}

// ==================== STATS ====================

router.get('/api/admin/stats', requireAuth, requireRole('admin', 'moderator'), (req, res) => {
    try {
        const totalUsers          = dbGet('SELECT COUNT(*) as count FROM users');
        const activeUsers         = dbGet('SELECT COUNT(*) as count FROM users WHERE last_login > ?', [getLocalTimeDaysAgo(7)]);
        const bannedUsers         = dbGet('SELECT COUNT(*) as count FROM users WHERE is_banned = 1');
        const totalTransactions   = dbGet('SELECT COUNT(*) as count FROM transactions');
        const totalBots           = dbGet('SELECT COUNT(*) as count FROM bots');
        const activeBots          = dbGet('SELECT COUNT(*) as count FROM bots WHERE is_active = 1');
        const recentRegistrations = dbGet('SELECT COUNT(*) as count FROM users WHERE created_at > ?', [getLocalTimeDaysAgo(30)]);
        const totalVolume         = dbGet('SELECT COALESCE(SUM(usd_value), 0) as total FROM transactions');

        res.json({
            totalUsers: totalUsers?.count || 0,
            activeUsers: activeUsers?.count || 0,
            bannedUsers: bannedUsers?.count || 0,
            totalTransactions: totalTransactions?.count || 0,
            totalBots: totalBots?.count || 0,
            activeBots: activeBots?.count || 0,
            recentRegistrations: recentRegistrations?.count || 0,
            totalVolume: totalVolume?.total || 0
        });
    } catch (error) {
        console.error('Admin stats error:', error);
        res.status(500).json({ error: 'Failed to fetch admin stats' });
    }
});







// CSV Export Helper
function convertToCSV(data) {
    if (!data || data.length === 0) {
        return '';
    }

    // Get headers from first object
    const headers = Object.keys(data[0]);

    // Create CSV header row
    const csvHeaders = headers.join(',');

    // Create CSV data rows
    const csvRows = data.map(row => {
        return headers.map(header => {
            const value = row[header];
            // Escape quotes and wrap in quotes if contains comma, quote, or newline
            if (value === null || value === undefined) {
                return '';
            }
            const stringValue = String(value);
            if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
                return `"${stringValue.replace(/"/g, '""')}"`;
            }
            return stringValue;
        }).join(',');
    });

    return [csvHeaders, ...csvRows].join('\n');
}

router.get('/api/admin/analytics/export', requireAuth, requireRole('admin', 'moderator'), (req, res) => {
    try {
        const type = req.query.type || 'users';
        const days = parseInt(req.query.days) || 30;
        const cutoffDate = getLocalTimeDaysAgo(days);

        let data = [];
        let filename = `${type}_export_${new Date().toISOString().split('T')[0]}.csv`;

        switch (type) {
            case 'users':
                data = dbAll(`
                    SELECT
                        id,
                        email,
                        full_name,
                        balance,
                        demo_balance,
                        real_balance,
                        active_account,
                        subscription_plan,
                        role,
                        is_banned,
                        totp_enabled,
                        created_at,
                        last_login
                    FROM users
                    WHERE created_at > ?
                    ORDER BY created_at DESC
                `, [cutoffDate]);
                break;

            case 'bots':
                data = dbAll(`
                    SELECT
                        b.id,
                        b.user_id,
                        u.email as user_email,
                        b.name,
                        b.type,
                        b.pair,
                        b.investment,
                        b.profit,
                        b.is_active,
                        b.mode,
                        b.account_type,
                        b.selected_symbol,
                        b.created_at,
                        b.updated_at
                    FROM bots b
                    LEFT JOIN users u ON b.user_id = u.id
                    WHERE b.created_at > ?
                    ORDER BY b.created_at DESC
                `, [cutoffDate]);
                break;

            case 'transactions':
                data = dbAll(`
                    SELECT
                        t.id,
                        t.user_id,
                        u.email as user_email,
                        t.type,
                        t.amount,
                        t.currency,
                        t.usd_value,
                        t.status,
                        t.tx_hash,
                        t.created_at,
                        t.updated_at
                    FROM transactions t
                    LEFT JOIN users u ON t.user_id = u.id
                    WHERE t.created_at > ?
                    ORDER BY t.created_at DESC
                `, [cutoffDate]);
                break;

            case 'trades':
                data = dbAll(`
                    SELECT
                        bt.id,
                        bt.bot_id,
                        b.name as bot_name,
                        bt.user_id,
                        u.email as user_email,
                        bt.symbol,
                        bt.side,
                        bt.type,
                        bt.amount,
                        bt.price,
                        bt.total,
                        bt.profit,
                        bt.status,
                        bt.created_at
                    FROM bot_trades bt
                    LEFT JOIN bots b ON bt.bot_id = b.id
                    LEFT JOIN users u ON bt.user_id = u.id
                    WHERE bt.created_at > ?
                    ORDER BY bt.created_at DESC
                `, [cutoffDate]);
                break;

            default:
                return res.status(400).json({ error: 'Invalid export type. Use: users, bots, transactions, or trades' });
        }

        // Convert to CSV
        const csv = convertToCSV(data);

        // Set headers for CSV download
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csv);

    } catch (error) {
        console.error('Data export error:', error);
        res.status(500).json({ error: 'Failed to export data' });
    }
});

function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

    return parts.join(' ');
}

// ==================== MAINTENANCE ====================

router.get('/api/admin/maintenance', requireAuth, requireRole('admin', 'moderator'), (req, res) => {
    res.json({
        enabled:   siteSettings.maintenanceMode,
        message:   siteSettings.maintenanceMessage,
        enabledBy: siteSettings.maintenanceEnabledBy,
        enabledAt: siteSettings.maintenanceEnabledAt
    });
});

router.post('/api/admin/maintenance', requireAuth, requireRole('admin', 'moderator'), (req, res) => {
    try {
        const { enabled, message } = req.body;
        const user = dbGet('SELECT full_name, email FROM users WHERE id = ?', [req.session.userId]);

        siteSettings.maintenanceMode = !!enabled;
        if (message) siteSettings.maintenanceMessage = message;

        if (enabled) {
            siteSettings.maintenanceEnabledBy = user?.full_name || user?.email || 'Unknown';
            siteSettings.maintenanceEnabledAt = getLocalTime();
        } else {
            siteSettings.maintenanceEnabledBy = null;
            siteSettings.maintenanceEnabledAt = null;
        }

        saveSettings();

        logAdminAction(
            req.session.userId,
            enabled ? 'maintenance_enabled' : 'maintenance_disabled',
            'system', null, message || null, getClientIP(req)
        );

        res.json({ success: true, enabled: siteSettings.maintenanceMode, message: siteSettings.maintenanceMessage });
    } catch (error) {
        console.error('Maintenance toggle error:', error);
        res.status(500).json({ error: 'Failed to toggle maintenance mode' });
    }
});

// ==================== TELEGRAM SETTINGS ====================

router.get('/api/admin/telegram-settings', requireAuth, requireRole('admin'), (req, res) => {
    const { getTelegramBot } = require('../services/telegram');
    res.json({
        enabled:    siteSettings.telegramBotEnabled,
        token:      siteSettings.telegramBotToken ? '***' + siteSettings.telegramBotToken.slice(-6) : '',
        hasToken:   !!siteSettings.telegramBotToken,
        username:   siteSettings.telegramBotUsername || '',
        isConnected: !!getTelegramBot()
    });
});

router.post('/api/admin/telegram-settings', requireAuth, requireRole('admin'), async (req, res) => {
    try {
        const { token, enabled } = req.body;
        const { initTelegramBot, getTelegramBot } = require('../services/telegram');

        if (token && token !== '***' + siteSettings.telegramBotToken.slice(-6)) {
            siteSettings.telegramBotToken = token;
        }
        if (typeof enabled === 'boolean') {
            siteSettings.telegramBotEnabled = enabled;
        }

        saveSettings();

        if (siteSettings.telegramBotEnabled && siteSettings.telegramBotToken) {
            const bot = getTelegramBot();
            if (bot) {
                try { await bot.stopPolling(); } catch (e) {}
            }
            await initTelegramBot();
        } else {
            const bot = getTelegramBot();
            if (bot) {
                try { await bot.stopPolling(); } catch (e) {}
            }
        }

        logAdminAction(
            req.session.userId, 'telegram_settings_update', 'settings', null,
            JSON.stringify({ enabled: siteSettings.telegramBotEnabled }), getClientIP(req)
        );

        res.json({
            success: true,
            enabled: siteSettings.telegramBotEnabled,
            username: siteSettings.telegramBotUsername || '',
            isConnected: !!getTelegramBot()
        });
    } catch (error) {
        console.error('Telegram settings error:', error);
        res.status(500).json({ error: 'Failed to update Telegram settings' });
    }
});

router.get('/api/admin/telegram-users', requireAuth, requireRole('admin', 'moderator'), (req, res) => {
    try {
        const { getTelegramBot } = require('../services/telegram');
        const linkedUsers = dbAll(`
            SELECT id, email, full_name, telegram_id, telegram_username, telegram_verified, last_login
            FROM users
            WHERE telegram_id IS NOT NULL AND telegram_verified = 1
            ORDER BY last_login DESC
        `);
        const totalUsers = dbGet('SELECT COUNT(*) as count FROM users');

        res.json({
            stats: {
                totalLinked: linkedUsers.length,
                totalUsers: totalUsers?.count || 0,
                botEnabled: siteSettings.telegramBotEnabled,
                botConnected: !!getTelegramBot(),
                botUsername: siteSettings.telegramBotUsername || ''
            },
            users: linkedUsers.map(u => ({
                id: u.id, email: u.email, fullName: u.full_name,
                telegramId: u.telegram_id, telegramUsername: u.telegram_username, lastLogin: u.last_login
            }))
        });
    } catch (error) {
        console.error('Telegram users error:', error);
        res.status(500).json({ error: 'Failed to fetch Telegram users' });
    }
});

// ==================== USERS ====================

router.get('/api/admin/users', requireAuth, requireRole('admin', 'moderator'), (req, res) => {
    try {
        const page   = parseInt(req.query.page) || 1;
        const limit  = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;
        const search = req.query.search || '';

        let query      = 'SELECT id, email, full_name, phone, demo_balance, real_balance, role, is_banned, ban_reason, created_at, last_login, is_verified FROM users';
        let countQuery = 'SELECT COUNT(*) as count FROM users';
        let params     = [];

        if (search) {
            query      += ' WHERE email LIKE ? OR full_name LIKE ?';
            countQuery += ' WHERE email LIKE ? OR full_name LIKE ?';
            params = [`%${search}%`, `%${search}%`];
        }

        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';

        const totalResult = dbGet(countQuery, params);
        const users       = dbAll(query, [...params, limit, offset]);

        res.json({
            users: users.map(u => ({
                id: u.id, email: u.email, fullName: u.full_name, phone: u.phone,
                demoBalance: u.demo_balance, realBalance: u.real_balance,
                role: u.role || 'user', isBanned: !!u.is_banned, banReason: u.ban_reason,
                createdAt: u.created_at, lastLogin: u.last_login, isVerified: !!u.is_verified
            })),
            total: totalResult?.count || 0,
            page,
            totalPages: Math.ceil((totalResult?.count || 0) / limit)
        });
    } catch (error) {
        console.error('Admin users error:', error);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

router.get('/api/admin/users/:id', requireAuth, requireRole('admin', 'moderator'), (req, res) => {
    try {
        const user = dbGet(`
            SELECT id, email, full_name, phone, demo_balance, real_balance, role,
                   is_banned, ban_reason, created_at, last_login, is_verified, verification_level
            FROM users WHERE id = ?
        `, [req.params.id]);

        if (!user) return res.status(404).json({ error: 'User not found' });

        const activity     = dbAll('SELECT * FROM activity_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 20', [req.params.id]);
        const transactions = dbAll('SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 20', [req.params.id]);
        const bots         = dbAll('SELECT * FROM bots WHERE user_id = ?', [req.params.id]);

        res.json({
            user: {
                id: user.id, email: user.email, fullName: user.full_name, phone: user.phone,
                demoBalance: user.demo_balance, realBalance: user.real_balance,
                role: user.role || 'user', isBanned: !!user.is_banned, banReason: user.ban_reason,
                createdAt: user.created_at, lastLogin: user.last_login,
                isVerified: !!user.is_verified, verificationLevel: user.verification_level
            },
            activity, transactions, bots
        });
    } catch (error) {
        console.error('Admin user details error:', error);
        res.status(500).json({ error: 'Failed to fetch user details' });
    }
});

router.patch('/api/admin/users/:id', requireAuth, requireRole('admin'), (req, res) => {
    try {
        const { fullName, phone, demoBalance, realBalance } = req.body;
        const userId = req.params.id;

        const user = dbGet('SELECT * FROM users WHERE id = ?', [userId]);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const updates = [], params = [];
        if (fullName !== undefined)    { updates.push('full_name = ?');    params.push(fullName); }
        if (phone !== undefined)       { updates.push('phone = ?');         params.push(phone); }
        if (demoBalance !== undefined) { updates.push('demo_balance = ?');  params.push(demoBalance); }
        if (realBalance !== undefined) { updates.push('real_balance = ?');  params.push(realBalance); }

        if (updates.length > 0) {
            params.push(userId);
            dbRun(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);
            logAdminAction(req.session.userId, 'user_updated', 'user', userId, JSON.stringify(req.body), getClientIP(req));
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Admin update user error:', error);
        res.status(500).json({ error: 'Failed to update user' });
    }
});

router.patch('/api/admin/users/:id/password', requireAuth, requireRole('admin'), async (req, res) => {
    try {
        const { password } = req.body;
        const userId = parseInt(req.params.id);

        if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

        const targetUser = dbGet('SELECT id FROM users WHERE id = ?', [userId]);
        if (!targetUser) return res.status(404).json({ error: 'User not found' });

        const hashedPassword = await bcrypt.hash(password, 10);
        dbRun('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, userId]);

        logAdminAction(req.session.userId, 'password_changed', 'user', userId, 'Admin changed user password', getClientIP(req));

        res.json({ success: true });
    } catch (error) {
        console.error('Change password error:', error);
        res.status(500).json({ error: 'Failed to change password' });
    }
});

router.patch('/api/admin/users/:id/role', requireAuth, requireRole('admin'), (req, res) => {
    try {
        const { role } = req.body;
        const userId = parseInt(req.params.id);

        if (!['user', 'moderator', 'admin'].includes(role)) return res.status(400).json({ error: 'Invalid role' });

        const targetUser = dbGet('SELECT * FROM users WHERE id = ?', [userId]);
        if (!targetUser) return res.status(404).json({ error: 'User not found' });
        if (userId === req.session.userId && role !== 'admin') return res.status(400).json({ error: 'You cannot demote yourself' });

        dbRun('UPDATE users SET role = ? WHERE id = ?', [role, userId]);
        logAdminAction(req.session.userId, 'role_changed', 'user', userId, `Role changed to: ${role}`, getClientIP(req));

        res.json({ success: true, newRole: role });
    } catch (error) {
        console.error('Admin change role error:', error);
        res.status(500).json({ error: 'Failed to change role' });
    }
});

router.post('/api/admin/users/:id/ban', requireAuth, requireRole('admin', 'moderator'), (req, res) => {
    try {
        const { reason } = req.body;
        const userId = parseInt(req.params.id);
        const targetUser = dbGet('SELECT * FROM users WHERE id = ?', [userId]);

        if (!targetUser) return res.status(404).json({ error: 'User not found' });
        if (targetUser.role === 'admin') return res.status(400).json({ error: 'Cannot ban administrators' });
        if (userId === req.session.userId) return res.status(400).json({ error: 'You cannot ban yourself' });

        dbRun('UPDATE users SET is_banned = 1, ban_reason = ? WHERE id = ?', [reason || 'No reason provided', userId]);
        logAdminAction(req.session.userId, 'user_banned', 'user', userId, `Reason: ${reason || 'No reason provided'}`, getClientIP(req));

        res.json({ success: true });
    } catch (error) {
        console.error('Admin ban user error:', error);
        res.status(500).json({ error: 'Failed to ban user' });
    }
});

router.post('/api/admin/users/:id/unban', requireAuth, requireRole('admin', 'moderator'), (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const targetUser = dbGet('SELECT * FROM users WHERE id = ?', [userId]);
        if (!targetUser) return res.status(404).json({ error: 'User not found' });

        dbRun('UPDATE users SET is_banned = 0, ban_reason = NULL WHERE id = ?', [userId]);
        logAdminAction(req.session.userId, 'user_unbanned', 'user', userId, null, getClientIP(req));

        res.json({ success: true });
    } catch (error) {
        console.error('Admin unban user error:', error);
        res.status(500).json({ error: 'Failed to unban user' });
    }
});

// ==================== PERMISSIONS ====================

router.get('/api/admin/users/:id/permissions', requireAuth, requireRole('admin'), (req, res) => {
    try {
        const permissions = dbAll(`
            SELECT p.id, p.name, p.description, up.granted_at, u.email as granted_by_email
            FROM user_permissions up
            JOIN permissions p ON up.permission_id = p.id
            LEFT JOIN users u ON up.granted_by = u.id
            WHERE up.user_id = ?
        `, [req.params.id]);

        const allPermissions = dbAll('SELECT * FROM permissions');
        res.json({ userPermissions: permissions, allPermissions });
    } catch (error) {
        console.error('Admin get permissions error:', error);
        res.status(500).json({ error: 'Failed to fetch permissions' });
    }
});

router.post('/api/admin/users/:id/permissions', requireAuth, requireRole('admin'), (req, res) => {
    try {
        const { permissionId } = req.body;
        const userId = parseInt(req.params.id);

        const existing = dbGet('SELECT * FROM user_permissions WHERE user_id = ? AND permission_id = ?', [userId, permissionId]);
        if (existing) return res.status(400).json({ error: 'Permission already granted' });

        dbRun('INSERT INTO user_permissions (user_id, permission_id, granted_by) VALUES (?, ?, ?)',
            [userId, permissionId, req.session.userId]);
        logAdminAction(req.session.userId, 'permission_granted', 'user', userId, `Permission ID: ${permissionId}`, getClientIP(req));

        res.json({ success: true });
    } catch (error) {
        console.error('Admin grant permission error:', error);
        res.status(500).json({ error: 'Failed to grant permission' });
    }
});

router.delete('/api/admin/users/:id/permissions/:permissionId', requireAuth, requireRole('admin'), (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const permissionId = parseInt(req.params.permissionId);

        dbRun('DELETE FROM user_permissions WHERE user_id = ? AND permission_id = ?', [userId, permissionId]);
        logAdminAction(req.session.userId, 'permission_revoked', 'user', userId, `Permission ID: ${permissionId}`, getClientIP(req));

        res.json({ success: true });
    } catch (error) {
        console.error('Admin revoke permission error:', error);
        res.status(500).json({ error: 'Failed to revoke permission' });
    }
});

// ==================== TRANSACTIONS ====================

router.get('/api/admin/transactions', requireAuth, requireRole('admin', 'moderator'), (req, res) => {
    try {
        const page   = parseInt(req.query.page) || 1;
        const limit  = parseInt(req.query.limit) || 50;
        const offset = (page - 1) * limit;
        const userId = req.query.userId;

        let query      = 'SELECT t.*, u.email, u.full_name FROM transactions t JOIN users u ON t.user_id = u.id';
        let countQuery = 'SELECT COUNT(*) as count FROM transactions';
        let params     = [];

        if (userId) {
            query      += ' WHERE t.user_id = ?';
            countQuery += ' WHERE user_id = ?';
            params.push(userId);
        }
        query += ' ORDER BY t.created_at DESC LIMIT ? OFFSET ?';

        const totalResult  = dbGet(countQuery, params);
        const transactions = dbAll(query, [...params, limit, offset]);

        res.json({
            transactions: transactions.map(t => ({
                id: t.id, userId: t.user_id, userEmail: t.email, userName: t.full_name,
                type: t.type, currency: t.currency, amount: t.amount,
                usdValue: t.usd_value, status: t.status, accountType: t.account_type, createdAt: t.created_at
            })),
            total: totalResult?.count || 0,
            page,
            totalPages: Math.ceil((totalResult?.count || 0) / limit)
        });
    } catch (error) {
        console.error('Admin transactions error:', error);
        res.status(500).json({ error: 'Failed to fetch transactions' });
    }
});

// ==================== BOTS ====================

router.get('/api/admin/bots', requireAuth, requireRole('admin', 'moderator'), (req, res) => {
    try {
        const bots = dbAll('SELECT b.*, u.email, u.full_name FROM bots b JOIN users u ON b.user_id = u.id ORDER BY b.created_at DESC');
        res.json({
            bots: bots.map(b => ({
                id: b.id, userId: b.user_id, userEmail: b.email, userName: b.full_name,
                name: b.name, type: b.type, pair: b.pair, categoryId: b.category_id || null,
                investment: b.investment, profit: b.profit, isActive: !!b.is_active, createdAt: b.created_at
            }))
        });
    } catch (error) {
        console.error('Admin bots error:', error);
        res.status(500).json({ error: 'Failed to fetch bots' });
    }
});

router.patch('/api/admin/bots/:id', requireAuth, requireRole('admin'), (req, res) => {
    try {
        const { isActive } = req.body;
        dbRun('UPDATE bots SET is_active = ? WHERE id = ?', [isActive ? 1 : 0, req.params.id]);
        logAdminAction(req.session.userId, 'bot_toggled', 'bot', req.params.id,
            `Set to: ${isActive ? 'active' : 'inactive'}`, getClientIP(req));
        res.json({ success: true });
    } catch (error) {
        console.error('Admin toggle bot error:', error);
        res.status(500).json({ error: 'Failed to toggle bot' });
    }
});

router.delete('/api/admin/bots/:id', requireAuth, requireRole('admin'), (req, res) => {
    try {
        dbRun('DELETE FROM bots WHERE id = ?', [req.params.id]);
        logAdminAction(req.session.userId, 'bot_deleted', 'bot', req.params.id, null, getClientIP(req));
        res.json({ success: true });
    } catch (error) {
        console.error('Admin delete bot error:', error);
        res.status(500).json({ error: 'Failed to delete bot' });
    }
});

// ==================== BOT CATEGORIES ====================

router.get('/api/admin/bot-categories', requireAuth, requireRole('admin', 'moderator'), (req, res) => {
    try {
        const categories = dbAll('SELECT * FROM bot_categories ORDER BY sort_order');
        res.json({ categories });
    } catch (error) {
        console.error('Bot categories error:', error);
        res.status(500).json({ error: 'Failed to fetch categories' });
    }
});

router.post('/api/admin/bot-categories', requireAuth, requireRole('admin'), (req, res) => {
    try {
        const { name, color, icon, sort_order, is_visible } = req.body;
        if (!name) return res.status(400).json({ error: 'Name is required' });
        const result = dbRun(
            'INSERT INTO bot_categories (name, color, icon, sort_order, is_visible) VALUES (?, ?, ?, ?, ?)',
            [name, color || '#10B981', icon || 'bot', sort_order || 0, is_visible !== undefined ? is_visible : 1]
        );
        res.json({ success: true, id: result.lastInsertRowid });
    } catch (error) {
        console.error('Create category error:', error);
        res.status(500).json({ error: 'Failed to create category' });
    }
});

router.put('/api/admin/bot-categories/:id', requireAuth, requireRole('admin'), (req, res) => {
    try {
        const { name, color, icon, sort_order, is_visible } = req.body;
        dbRun(
            'UPDATE bot_categories SET name=?, color=?, icon=?, sort_order=?, is_visible=? WHERE id=?',
            [name, color, icon, sort_order, is_visible, req.params.id]
        );
        res.json({ success: true });
    } catch (error) {
        console.error('Update category error:', error);
        res.status(500).json({ error: 'Failed to update category' });
    }
});

router.delete('/api/admin/bot-categories/:id', requireAuth, requireRole('admin'), (req, res) => {
    try {
        dbRun('UPDATE bots SET category_id = NULL WHERE category_id = ?', [req.params.id]);
        dbRun('DELETE FROM bot_categories WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (error) {
        console.error('Delete category error:', error);
        res.status(500).json({ error: 'Failed to delete category' });
    }
});

router.patch('/api/admin/bots/:id/category', requireAuth, requireRole('admin'), (req, res) => {
    try {
        const { category_id } = req.body;
        dbRun('UPDATE bots SET category_id = ? WHERE id = ?', [category_id || null, req.params.id]);
        res.json({ success: true });
    } catch (error) {
        console.error('Set bot category error:', error);
        res.status(500).json({ error: 'Failed to set category' });
    }
});

// ==================== AUDIT LOGS ====================

router.get('/api/admin/audit-logs', requireAuth, requireRole('admin', 'moderator'), (req, res) => {
    try {
        const page   = parseInt(req.query.page) || 1;
        const limit  = parseInt(req.query.limit) || 50;
        const offset = (page - 1) * limit;

        const totalResult = dbGet('SELECT COUNT(*) as count FROM admin_audit_log');
        const logs = dbAll(`
            SELECT l.*, u.email as admin_email, u.full_name as admin_name
            FROM admin_audit_log l
            JOIN users u ON l.admin_id = u.id
            ORDER BY l.created_at DESC LIMIT ? OFFSET ?
        `, [limit, offset]);

        res.json({
            logs: logs.map(l => ({
                id: l.id, adminId: l.admin_id, adminEmail: l.admin_email, adminName: l.admin_name,
                action: l.action, targetType: l.target_type, targetId: l.target_id,
                details: l.details, ipAddress: l.ip_address, createdAt: l.created_at
            })),
            total: totalResult?.count || 0,
            page,
            totalPages: Math.ceil((totalResult?.count || 0) / limit)
        });
    } catch (error) {
        console.error('Admin audit logs error:', error);
        res.status(500).json({ error: 'Failed to fetch audit logs' });
    }
});

// ==================== NEWS ====================

function formatTimeAgo(dateString) {
    if (!dateString) return '';
    const now  = new Date();
    const date = new Date(dateString);
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    const hours   = Math.floor(diff / 3600000);
    const days    = Math.floor(diff / 86400000);

    if (minutes < 60)  return minutes <= 1 ? 'Just now' : `${minutes} minutes ago`;
    if (hours < 24)    return hours === 1   ? '1 hour ago' : `${hours} hours ago`;
    if (days < 7)      return days === 1    ? '1 day ago'  : `${days} days ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

router.get('/api/news', (req, res) => {
    try {
        const { category, source, limit = 50 } = req.query;
        let sql    = 'SELECT n.*, u.full_name as author_name FROM news n LEFT JOIN users u ON n.created_by = u.id WHERE n.is_published = 1';
        const params = [];

        if (category && category !== 'all') {
            sql += ' AND n.category = ?';
            params.push(category);
        }
        if (source && source !== 'all') {
            if (source === 'manual') {
                sql += ' AND (n.source IS NULL OR n.source = "")';
            } else {
                sql += ' AND n.source = ?';
                params.push(source);
            }
        }
        sql += ' ORDER BY n.created_at DESC LIMIT ?';
        params.push(parseInt(limit));

        const news = dbAll(sql, params);
        res.json({
            news: news.map(n => ({
                id: n.id, title: n.title, excerpt: n.excerpt, content: n.content,
                category: n.category, imageUrl: n.image_url, authorName: n.author_name,
                source: n.source || null,
                createdAt: n.created_at, time: formatTimeAgo(n.created_at)
            }))
        });
    } catch (error) {
        console.error('Get news error:', error);
        res.status(500).json({ error: 'Failed to fetch news' });
    }
});

// Manual trigger — responds immediately, runs in background
router.post('/api/admin/news/collect', requireAuth, requireRole('admin', 'moderator'), (req, res) => {
    res.json({ success: true, message: 'Збір запущено у фоні' });
    const { collectNow } = require('../services/newsCollector');
    collectNow().catch(err => console.error('[NewsCollector] Manual collect error:', err));
});

router.get('/api/news/:id', (req, res) => {
    try {
        const news = dbGet(`
            SELECT n.*, u.full_name as author_name
            FROM news n LEFT JOIN users u ON n.created_by = u.id
            WHERE n.id = ? AND n.is_published = 1
        `, [req.params.id]);

        if (!news) return res.status(404).json({ error: 'News not found' });

        res.json({
            id: news.id, title: news.title, excerpt: news.excerpt, content: news.content,
            category: news.category, imageUrl: news.image_url, authorName: news.author_name, createdAt: news.created_at
        });
    } catch (error) {
        console.error('Get news item error:', error);
        res.status(500).json({ error: 'Failed to fetch news item' });
    }
});

router.get('/api/admin/news', requireAuth, requireRole('admin', 'moderator'), (req, res) => {
    try {
        const page        = parseInt(req.query.page) || 1;
        const limit       = parseInt(req.query.limit) || 20;
        const offset      = (page - 1) * limit;
        const totalResult = dbGet('SELECT COUNT(*) as count FROM news');
        const news = dbAll(`
            SELECT n.*, u.full_name as author_name, u.email as author_email
            FROM news n LEFT JOIN users u ON n.created_by = u.id
            ORDER BY n.created_at DESC LIMIT ? OFFSET ?
        `, [limit, offset]);

        res.json({
            news: news.map(n => ({
                id: n.id, title: n.title, excerpt: n.excerpt, category: n.category,
                isPublished: !!n.is_published, authorName: n.author_name,
                authorEmail: n.author_email, createdAt: n.created_at
            })),
            total: totalResult?.count || 0,
            page,
            totalPages: Math.ceil((totalResult?.count || 0) / limit)
        });
    } catch (error) {
        console.error('Admin get news error:', error);
        res.status(500).json({ error: 'Failed to fetch news' });
    }
});

router.post('/api/admin/news', requireAuth, requireRole('admin', 'moderator'), (req, res) => {
    try {
        const { title, excerpt, content, category, imageUrl, isPublished } = req.body;

        if (!title?.trim()) return res.status(400).json({ error: 'Title is required' });
        if (!category)      return res.status(400).json({ error: 'Category is required' });

        const validCategories = ['update', 'market', 'alert', 'feature'];
        if (!validCategories.includes(category)) return res.status(400).json({ error: 'Invalid category' });

        const result = dbRun(`
            INSERT INTO news (title, excerpt, content, category, image_url, is_published, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [title.trim(), excerpt?.trim() || null, content?.trim() || null, category,
            imageUrl?.trim() || null, isPublished !== false ? 1 : 0, req.session.userId]);

        logAdminAction(req.session.userId, 'create_news', 'news', result.lastInsertRowid, `Created news: ${title}`, getClientIP(req));

        res.json({ success: true, newsId: result.lastInsertRowid, message: 'News created successfully' });
    } catch (error) {
        console.error('Create news error:', error);
        res.status(500).json({ error: 'Failed to create news' });
    }
});

router.patch('/api/admin/news/:id', requireAuth, requireRole('admin', 'moderator'), (req, res) => {
    try {
        const { title, excerpt, content, category, imageUrl, isPublished } = req.body;

        const existing = dbGet('SELECT id FROM news WHERE id = ?', [req.params.id]);
        if (!existing) return res.status(404).json({ error: 'News not found' });

        const updates = [], params = [];
        if (title     !== undefined) { updates.push('title = ?');      params.push(title.trim()); }
        if (excerpt   !== undefined) { updates.push('excerpt = ?');    params.push(excerpt?.trim() || null); }
        if (content   !== undefined) { updates.push('content = ?');    params.push(content?.trim() || null); }
        if (imageUrl  !== undefined) { updates.push('image_url = ?');  params.push(imageUrl?.trim() || null); }
        if (isPublished !== undefined) { updates.push('is_published = ?'); params.push(isPublished ? 1 : 0); }
        if (category  !== undefined) {
            const valid = ['update', 'market', 'alert', 'feature'];
            if (!valid.includes(category)) return res.status(400).json({ error: 'Invalid category' });
            updates.push('category = ?');
            params.push(category);
        }

        if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

        updates.push('updated_at = ?');
        params.push(getLocalTime());
        params.push(req.params.id);

        dbRun(`UPDATE news SET ${updates.join(', ')} WHERE id = ?`, params);
        logAdminAction(req.session.userId, 'update_news', 'news', req.params.id, `Updated news ID ${req.params.id}`, getClientIP(req));

        res.json({ success: true, message: 'News updated successfully' });
    } catch (error) {
        console.error('Update news error:', error);
        res.status(500).json({ error: 'Failed to update news' });
    }
});

router.delete('/api/admin/news/:id', requireAuth, requireRole('admin', 'moderator'), (req, res) => {
    try {
        const existing = dbGet('SELECT id, title FROM news WHERE id = ?', [req.params.id]);
        if (!existing) return res.status(404).json({ error: 'News not found' });

        dbRun('DELETE FROM news WHERE id = ?', [req.params.id]);
        logAdminAction(req.session.userId, 'delete_news', 'news', req.params.id, `Deleted news: ${existing.title}`, getClientIP(req));

        res.json({ success: true, message: 'News deleted successfully' });
    } catch (error) {
        console.error('Delete news error:', error);
        res.status(500).json({ error: 'Failed to delete news' });
    }
});

// ==================== SUBSCRIPTIONS (ADMIN) ====================

router.get('/api/admin/subscriptions', requireAuth, requireRole('admin', 'moderator'), (req, res) => {
    try {
        const page   = parseInt(req.query.page) || 1;
        const limit  = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;
        const search = req.query.search || '';

        let query      = 'SELECT id, email, full_name, subscription_plan, subscription_expires_at, created_at, is_banned FROM users WHERE 1=1';
        let countQuery = 'SELECT COUNT(*) as count FROM users WHERE 1=1';
        const params   = [];

        if (search) {
            query      += ' AND (email LIKE ? OR full_name LIKE ?)';
            countQuery += ' AND (email LIKE ? OR full_name LIKE ?)';
            params.push(`%${search}%`, `%${search}%`);
        }

        const totalResult = dbGet(countQuery, params);
        query += ' ORDER BY subscription_expires_at DESC NULLS LAST, id DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        const users = dbAll(query, params);

        res.json({
            users: users.map(u => ({
                id: u.id, email: u.email, fullName: u.full_name,
                subscriptionPlan: u.subscription_plan || 'free',
                subscriptionExpiresAt: u.subscription_expires_at,
                createdAt: u.created_at, isBanned: u.is_banned === 1
            })),
            page,
            totalPages: Math.ceil((totalResult?.count || 0) / limit),
            total: totalResult?.count || 0
        });
    } catch (error) {
        console.error('Get subscriptions error:', error);
        res.status(500).json({ error: 'Failed to get subscriptions' });
    }
});

router.post('/api/admin/users/:id/subscription', requireAuth, requireRole('admin'), (req, res) => {
    try {
        const { id } = req.params;
        const { plan, days } = req.body;

        if (!plan || !['free', 'pro', 'enterprise'].includes(plan)) {
            return res.status(400).json({ error: 'Invalid plan. Must be: free, pro, or enterprise' });
        }

        const user = dbGet('SELECT id, email, full_name, subscription_plan FROM users WHERE id = ?', [id]);
        if (!user) return res.status(404).json({ error: 'User not found' });

        let expiresAt = null;
        if (plan !== 'free') {
            const daysToAdd = parseInt(days) || 30;
            const now = new Date();
            const currentExpires = dbGet('SELECT subscription_expires_at FROM users WHERE id = ?', [id]);
            let startDate = now;
            if (currentExpires?.subscription_expires_at) {
                const expDate = new Date(currentExpires.subscription_expires_at);
                if (expDate > now) startDate = expDate;
            }
            expiresAt = new Date(startDate.getTime() + daysToAdd * 24 * 60 * 60 * 1000).toISOString();
        }

        dbRun('UPDATE users SET subscription_plan = ?, subscription_expires_at = ? WHERE id = ?',
            [plan, expiresAt, id]);
        saveDatabase();

        createNotification(id, 'system', 'Subscription Updated',
            plan === 'free'
                ? 'Your subscription has been cancelled by administrator.'
                : `You have been granted a ${plan.toUpperCase()} subscription for ${days || 30} days.`
        );

        logAdminAction(req.session.userId, 'grant_subscription', 'user', parseInt(id),
            `Granted ${plan} subscription (${days || 30} days) to ${user.email}`, getClientIP(req));

        res.json({ success: true, message: `Subscription ${plan} granted successfully`, subscription: { plan, expiresAt } });
    } catch (error) {
        console.error('Grant subscription error:', error);
        res.status(500).json({ error: 'Failed to grant subscription' });
    }
});

router.delete('/api/admin/users/:id/subscription', requireAuth, requireRole('admin'), (req, res) => {
    try {
        const { id } = req.params;
        const user = dbGet('SELECT id, email, subscription_plan FROM users WHERE id = ?', [id]);

        if (!user) return res.status(404).json({ error: 'User not found' });
        if (user.subscription_plan === 'free') return res.status(400).json({ error: 'User already has free plan' });

        dbRun('UPDATE users SET subscription_plan = ?, subscription_expires_at = NULL WHERE id = ?', ['free', id]);
        saveDatabase();

        createNotification(id, 'system', 'Subscription Cancelled', 'Your subscription has been cancelled by administrator.');

        logAdminAction(req.session.userId, 'revoke_subscription', 'user', parseInt(id),
            `Revoked ${user.subscription_plan} subscription from ${user.email}`, getClientIP(req));

        res.json({ success: true, message: 'Subscription revoked successfully' });
    } catch (error) {
        console.error('Revoke subscription error:', error);
        res.status(500).json({ error: 'Failed to revoke subscription' });
    }
});

// ==================== DATABASE BROWSER ====================

const ADMIN_TABLES = [
    'users', 'orders', 'transactions', 'bots', 'wallets',
    'activity_log', 'payment_methods', 'notifications',
    'passkeys', 'news', 'admin_audit_log', 'permissions',
    'user_permissions', 'portfolio_snapshots', 'bot_order_history'
];

router.get('/api/admin/tables', requireAuth, requireRole('admin'), (req, res) => {
    try {
        const tables = ADMIN_TABLES.map(name => {
            const countResult = dbGet(`SELECT COUNT(*) as count FROM ${name}`);
            return { name, rowCount: countResult ? countResult.count : 0 };
        });
        res.json({ tables });
    } catch (error) {
        console.error('Get tables error:', error);
        res.status(500).json({ error: 'Failed to get tables' });
    }
});

router.get('/api/admin/tables/:name/schema', requireAuth, requireRole('admin'), (req, res) => {
    try {
        const tableName = req.params.name;
        if (!ADMIN_TABLES.includes(tableName)) return res.status(400).json({ error: 'Invalid table name' });

        const columns = dbAll(`PRAGMA table_info(${tableName})`);
        res.json({
            table: tableName,
            columns: columns.map(col => ({
                name: col.name, type: col.type,
                notNull: col.notnull === 1, defaultValue: col.dflt_value, primaryKey: col.pk === 1
            }))
        });
    } catch (error) {
        console.error('Get schema error:', error);
        res.status(500).json({ error: 'Failed to get table schema' });
    }
});

router.get('/api/admin/tables/:name', requireAuth, requireRole('admin'), (req, res) => {
    try {
        const tableName = req.params.name;
        const { page = 1, limit = 50, search = '', sortBy = 'id', sortOrder = 'DESC' } = req.query;

        if (!ADMIN_TABLES.includes(tableName)) return res.status(400).json({ error: 'Invalid table name' });

        const offset         = (parseInt(page) - 1) * parseInt(limit);
        const validSortOrder = ['ASC', 'DESC'].includes(sortOrder.toUpperCase()) ? sortOrder.toUpperCase() : 'DESC';

        const columns    = dbAll(`PRAGMA table_info(${tableName})`);
        const columnNames = columns.map(c => c.name);
        const validSortBy = columnNames.includes(sortBy) ? sortBy : 'id';

        let query = `SELECT * FROM ${tableName}`, countQuery = `SELECT COUNT(*) as count FROM ${tableName}`;
        const params = [], countParams = [];

        if (search) {
            const textCols = columnNames.filter(col =>
                ['TEXT', 'VARCHAR', 'CHAR'].some(t => columns.find(c => c.name === col)?.type?.toUpperCase().includes(t))
            );
            if (textCols.length > 0) {
                const where = ` WHERE ${textCols.map(col => `${col} LIKE ?`).join(' OR ')}`;
                query      += where;
                countQuery += where;
                textCols.forEach(() => { params.push(`%${search}%`); countParams.push(`%${search}%`); });
            }
        }

        query += ` ORDER BY ${validSortBy} ${validSortOrder} LIMIT ? OFFSET ?`;
        params.push(parseInt(limit), offset);

        const rows        = dbAll(query, params);
        const totalResult = dbGet(countQuery, countParams);

        logAdminAction(req.session.userId, 'VIEW_TABLE', tableName, null, `Viewed ${tableName} table`, getClientIP(req));

        res.json({
            table: tableName,
            columns: columns.map(c => ({ name: c.name, type: c.type })),
            rows,
            total: totalResult.count,
            page: parseInt(page),
            limit: parseInt(limit),
            totalPages: Math.ceil(totalResult.count / parseInt(limit))
        });
    } catch (error) {
        console.error('Get table data error:', error);
        res.status(500).json({ error: 'Failed to get table data' });
    }
});

router.put('/api/admin/tables/:name/:id', requireAuth, requireRole('admin'), (req, res) => {
    try {
        const { name: tableName, id: recordId } = req.params;
        if (!ADMIN_TABLES.includes(tableName)) return res.status(400).json({ error: 'Invalid table name' });

        const columns     = dbAll(`PRAGMA table_info(${tableName})`);
        const columnNames = columns.map(c => c.name);

        const validUpdates = {};
        for (const [key, value] of Object.entries(req.body)) {
            if (columnNames.includes(key) && key !== 'id' && key !== 'created_at') {
                validUpdates[key] = value;
            }
        }
        if (Object.keys(validUpdates).length === 0) return res.status(400).json({ error: 'No valid fields to update' });

        const setClause = Object.keys(validUpdates).map(k => `${k} = ?`).join(', ');
        const values    = [...Object.values(validUpdates), recordId];
        dbRun(`UPDATE ${tableName} SET ${setClause} WHERE id = ?`, values);

        logAdminAction(req.session.userId, 'UPDATE_RECORD', tableName, recordId, JSON.stringify(validUpdates), getClientIP(req));
        saveDatabase();

        const updated = dbGet(`SELECT * FROM ${tableName} WHERE id = ?`, [recordId]);
        res.json({ success: true, record: updated });
    } catch (error) {
        console.error('Update record error:', error);
        res.status(500).json({ error: 'Failed to update record' });
    }
});

router.post('/api/admin/tables/:name', requireAuth, requireRole('admin'), (req, res) => {
    try {
        const tableName = req.params.name;
        if (!ADMIN_TABLES.includes(tableName)) return res.status(400).json({ error: 'Invalid table name' });

        const columns     = dbAll(`PRAGMA table_info(${tableName})`);
        const columnNames = columns.map(c => c.name);

        const validData = {};
        for (const [key, value] of Object.entries(req.body)) {
            if (columnNames.includes(key) && key !== 'id') validData[key] = value;
        }
        if (Object.keys(validData).length === 0) return res.status(400).json({ error: 'No valid fields provided' });

        const columnList  = Object.keys(validData).join(', ');
        const placeholders = Object.keys(validData).map(() => '?').join(', ');
        const result = dbRun(`INSERT INTO ${tableName} (${columnList}) VALUES (${placeholders})`, Object.values(validData));

        logAdminAction(req.session.userId, 'CREATE_RECORD', tableName, result.lastInsertRowid, JSON.stringify(validData), getClientIP(req));
        saveDatabase();

        const created = dbGet(`SELECT * FROM ${tableName} WHERE id = ?`, [result.lastInsertRowid]);
        res.json({ success: true, record: created });
    } catch (error) {
        console.error('Create record error:', error);
        res.status(500).json({ error: 'Failed to create record' });
    }
});

router.delete('/api/admin/tables/:name/:id', requireAuth, requireRole('admin'), (req, res) => {
    try {
        const { name: tableName, id: recordId } = req.params;
        if (!ADMIN_TABLES.includes(tableName)) return res.status(400).json({ error: 'Invalid table name' });

        const record = dbGet(`SELECT * FROM ${tableName} WHERE id = ?`, [recordId]);
        if (!record) return res.status(404).json({ error: 'Record not found' });

        dbRun(`DELETE FROM ${tableName} WHERE id = ?`, [recordId]);
        logAdminAction(req.session.userId, 'DELETE_RECORD', tableName, recordId, JSON.stringify(record), getClientIP(req));
        saveDatabase();

        res.json({ success: true, message: 'Record deleted' });
    } catch (error) {
        console.error('Delete record error:', error);
        res.status(500).json({ error: 'Failed to delete record' });
    }
});

// ==================== ANALYTICS ====================

router.get('/api/admin/analytics/users', requireAuth, requireRole('admin', 'moderator'), (req, res) => {
    try {
        const days = parseInt(req.query.days) || 30;
        const cutoffDate = getLocalTimeDaysAgo(days);

        const newUsers = dbGet('SELECT COUNT(*) as count FROM users WHERE created_at > ?', [cutoffDate]);

        const dau = dbGet('SELECT COUNT(DISTINCT user_id) as count FROM activity_log WHERE DATE(timestamp) = DATE("now", "localtime")');
        const wau = dbGet('SELECT COUNT(DISTINCT user_id) as count FROM activity_log WHERE timestamp > ?', [getLocalTimeDaysAgo(7)]);
        const mau = dbGet('SELECT COUNT(DISTINCT user_id) as count FROM activity_log WHERE timestamp > ?', [getLocalTimeDaysAgo(30)]);

        const registrationTrends = dbAll(`
            SELECT DATE(created_at) as date, COUNT(*) as count
            FROM users
            WHERE created_at > ?
            GROUP BY DATE(created_at)
            ORDER BY date ASC
        `, [cutoffDate]);

        res.json({
            summary: {
                newUsers: newUsers?.count || 0,
                dau: dau?.count || 0,
                wau: wau?.count || 0,
                mau: mau?.count || 0
            },
            registrationTrends: registrationTrends.map(row => ({
                date: row.date,
                count: row.count
            }))
        });
    } catch (error) {
        console.error('User analytics error:', error);
        res.status(500).json({ error: 'Failed to fetch user analytics' });
    }
});

router.get('/api/admin/analytics/bots/funnel', requireAuth, requireRole('admin', 'moderator'), (req, res) => {
    try {
        const totalUsers = dbGet('SELECT COUNT(*) as count FROM users');
        const usersWithBots = dbGet('SELECT COUNT(DISTINCT user_id) as count FROM bots');
        const usersWithDemoBots = dbGet('SELECT COUNT(DISTINCT user_id) as count FROM bots WHERE mode = "demo" AND is_active = 1');
        const usersWithLiveBots = dbGet('SELECT COUNT(DISTINCT user_id) as count FROM bots WHERE mode = "live" AND is_active = 1');

        const totalBotsCount = dbGet('SELECT COUNT(*) as count FROM bots');
        const configuredBots = dbGet('SELECT COUNT(*) as count FROM bots WHERE binance_api_key IS NOT NULL AND binance_api_key != ""');
        const demoActiveBots = dbGet('SELECT COUNT(*) as count FROM bots WHERE mode = "demo" AND is_active = 1');
        const liveActiveBots = dbGet('SELECT COUNT(*) as count FROM bots WHERE mode = "live" AND is_active = 1');

        const total = totalUsers?.count || 0;
        const created = usersWithBots?.count || 0;
        const configured = usersWithDemoBots?.count || usersWithLiveBots?.count || 0;
        const demoActive = usersWithDemoBots?.count || 0;
        const liveActive = usersWithLiveBots?.count || 0;

        res.json({
            stages: [
                {
                    name: 'Створено ботів',
                    count: created,
                    percentage: total > 0 ? ((created / total) * 100).toFixed(1) : '0.0'
                },
                {
                    name: 'Налаштовано',
                    count: configured,
                    percentage: created > 0 ? ((configured / created) * 100).toFixed(1) : '0.0'
                },
                {
                    name: 'Активні (Demo)',
                    count: demoActive,
                    percentage: configured > 0 ? ((demoActive / configured) * 100).toFixed(1) : '0.0'
                },
                {
                    name: 'Активні (Live)',
                    count: liveActive,
                    percentage: demoActive > 0 ? ((liveActive / demoActive) * 100).toFixed(1) : '0.0'
                }
            ],
            summary: {
                totalUsers: total,
                usersWithBots: created,
                totalBots: totalBotsCount?.count || 0,
                configuredBots: configuredBots?.count || 0,
                demoActiveBots: demoActiveBots?.count || 0,
                liveActiveBots: liveActiveBots?.count || 0,
                overallConversion: total > 0 ? ((liveActive / total) * 100).toFixed(1) : '0.0'
            }
        });
    } catch (error) {
        console.error('Bot funnel analytics error:', error);
        res.status(500).json({ error: 'Failed to fetch bot funnel analytics' });
    }
});

router.get('/api/admin/analytics/subscriptions/funnel', requireAuth, requireRole('admin', 'moderator'), (req, res) => {
    try {
        const totalUsers = dbGet('SELECT COUNT(*) as count FROM users');
        const freeUsers = dbGet('SELECT COUNT(*) as count FROM users WHERE subscription_plan = "free" OR subscription_plan IS NULL');
        const trialUsers = dbGet('SELECT COUNT(*) as count FROM users WHERE subscription_plan = "trial"');
        const proUsers = dbGet('SELECT COUNT(*) as count FROM users WHERE subscription_plan = "pro"');
        const enterpriseUsers = dbGet('SELECT COUNT(*) as count FROM users WHERE subscription_plan = "enterprise"');

        const total = totalUsers?.count || 0;
        const free = freeUsers?.count || 0;
        const trial = trialUsers?.count || 0;
        const pro = proUsers?.count || 0;
        const enterprise = enterpriseUsers?.count || 0;

        const paidUsers = trial + pro + enterprise;

        res.json({
            stages: [
                {
                    name: 'Free',
                    count: free,
                    percentage: total > 0 ? ((free / total) * 100).toFixed(1) : '0.0'
                },
                {
                    name: 'Trial',
                    count: trial,
                    percentage: total > 0 ? ((trial / total) * 100).toFixed(1) : '0.0'
                },
                {
                    name: 'Pro',
                    count: pro,
                    percentage: trial > 0 ? ((pro / trial) * 100).toFixed(1) : '0.0'
                },
                {
                    name: 'Enterprise',
                    count: enterprise,
                    percentage: pro > 0 ? ((enterprise / pro) * 100).toFixed(1) : '0.0'
                }
            ],
            summary: {
                totalUsers: total,
                freeUsers: free,
                trialUsers: trial,
                proUsers: pro,
                enterpriseUsers: enterprise,
                paidUsers: paidUsers,
                conversionRate: total > 0 ? ((paidUsers / total) * 100).toFixed(1) : '0.0'
            }
        });
    } catch (error) {
        console.error('Subscription funnel analytics error:', error);
        res.status(500).json({ error: 'Failed to fetch subscription funnel analytics' });
    }
});

// Trading Volume Analytics
router.get('/api/admin/analytics/trading/volume', requireAuth, requireRole('admin', 'moderator'), (req, res) => {
    try {
        const days = parseInt(req.query.days) || 30;
        const cutoffDate = getLocalTimeDaysAgo(days);

        // Get total trades and volume
        const totalTrades = dbGet('SELECT COUNT(*) as count FROM bot_trades WHERE opened_at > ?', [cutoffDate]);
        const totalVolume = dbGet('SELECT SUM(quantity * price) as volume FROM bot_trades WHERE opened_at > ?', [cutoffDate]);

        // Get demo vs live volume
        const demoVolume = dbGet(`
            SELECT SUM(bt.quantity * bt.price) as volume
            FROM bot_trades bt
            JOIN bots b ON bt.bot_id = b.id
            WHERE bt.opened_at > ? AND (b.mode = 'test' OR b.mode = 'demo')
        `, [cutoffDate]);

        const liveVolume = dbGet(`
            SELECT SUM(bt.quantity * bt.price) as volume
            FROM bot_trades bt
            JOIN bots b ON bt.bot_id = b.id
            WHERE bt.opened_at > ? AND b.mode = 'live'
        `, [cutoffDate]);

        // Get daily volume trends with demo/live split
        const volumeTrends = dbAll(`
            SELECT
                DATE(bt.opened_at) as date,
                SUM(CASE WHEN b.mode = 'live' THEN bt.quantity * bt.price ELSE 0 END) as liveVolume,
                SUM(CASE WHEN b.mode = 'test' OR b.mode = 'demo' THEN bt.quantity * bt.price ELSE 0 END) as demoVolume,
                SUM(bt.quantity * bt.price) as totalVolume
            FROM bot_trades bt
            JOIN bots b ON bt.bot_id = b.id
            WHERE bt.opened_at > ?
            GROUP BY DATE(bt.opened_at)
            ORDER BY date ASC
        `, [cutoffDate]);

        const avgTradeSize = totalTrades?.count > 0 ? (totalVolume?.volume || 0) / totalTrades.count : 0;

        res.json({
            summary: {
                totalTrades: totalTrades?.count || 0,
                totalVolume: totalVolume?.volume || 0,
                demoVolume: demoVolume?.volume || 0,
                liveVolume: liveVolume?.volume || 0,
                avgTradeSize: avgTradeSize
            },
            volumeTrends: volumeTrends.map(row => ({
                date: row.date,
                liveVolume: row.liveVolume || 0,
                demoVolume: row.demoVolume || 0,
                totalVolume: row.totalVolume || 0
            }))
        });
    } catch (error) {
        console.error('Trading volume analytics error:', error);
        res.status(500).json({ error: 'Failed to fetch trading volume analytics' });
    }
});

// Retention Cohort Analytics
router.get('/api/admin/analytics/retention', requireAuth, requireRole('admin', 'moderator'), (req, res) => {
    try {
        const weeks = parseInt(req.query.weeks) || 12;

        // Get all users with their registration and last login dates
        const allUsers = dbAll(`
            SELECT
                id,
                strftime('%Y-%W', created_at) as cohort_week,
                created_at,
                last_login
            FROM users
            WHERE created_at > ?
        `, [getLocalTimeDaysAgo(weeks * 7)]);

        // Build cohort data structure
        const cohortMap = {};
        allUsers.forEach(user => {
            if (!cohortMap[user.cohort_week]) {
                cohortMap[user.cohort_week] = {
                    cohortWeek: user.cohort_week,
                    cohortSize: 0,
                    users: []
                };
            }
            cohortMap[user.cohort_week].cohortSize++;
            cohortMap[user.cohort_week].users.push(user);
        });

        // Calculate retention for each cohort
        const cohortData = Object.values(cohortMap).map(cohort => {
            const retention = [];

            // Calculate retention for each week (0-11)
            for (let weekOffset = 0; weekOffset < weeks; weekOffset++) {
                const cohortStartDate = new Date(cohort.users[0].created_at);
                const weekStartDate = new Date(cohortStartDate.getTime() + (weekOffset * 7 * 24 * 60 * 60 * 1000));
                const weekEndDate = new Date(weekStartDate.getTime() + (7 * 24 * 60 * 60 * 1000));

                const activeUsers = cohort.users.filter(user => {
                    if (!user.last_login) return false;
                    const lastLogin = new Date(user.last_login);
                    return lastLogin >= weekStartDate && lastLogin < weekEndDate;
                }).length;

                const retentionRate = cohort.cohortSize > 0
                    ? Math.round((activeUsers / cohort.cohortSize) * 100)
                    : 0;

                retention.push({
                    week: weekOffset,
                    activeUsers: activeUsers,
                    retentionRate: retentionRate
                });
            }

            return {
                cohortWeek: cohort.cohortWeek,
                cohortSize: cohort.cohortSize,
                retention: retention
            };
        });

        // Sort by cohort week (most recent first)
        cohortData.sort((a, b) => b.cohortWeek.localeCompare(a.cohortWeek));

        res.json({
            cohorts: cohortData,
            totalCohorts: cohortData.length,
            weeksAnalyzed: weeks
        });
    } catch (error) {
        console.error('Retention cohort analytics error:', error);
        res.status(500).json({ error: 'Failed to fetch retention cohort analytics' });
    }
});

// System Health Metrics
router.get('/api/admin/analytics/system/health', requireAuth, requireRole('admin', 'moderator'), (req, res) => {
    try {
        // Get database statistics
        const userCount = dbGet('SELECT COUNT(*) as count FROM users');
        const botCount = dbGet('SELECT COUNT(*) as count FROM bots');
        const tradeCount = dbGet('SELECT COUNT(*) as count FROM bot_trades');
        const transactionCount = dbGet('SELECT COUNT(*) as count FROM transactions');

        // Get active bots count
        const activeBots = dbGet('SELECT COUNT(*) as count FROM bots WHERE is_active = 1');

        // Get recent activity (last hour)
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const recentLogins = dbGet('SELECT COUNT(*) as count FROM users WHERE last_login > ?', [oneHourAgo]);
        const recentTrades = dbGet('SELECT COUNT(*) as count FROM bot_trades WHERE created_at > ?', [oneHourAgo]);

        // Get bot health metrics
        const activeBotsList = dbAll('SELECT id, name, is_active, mode FROM bots WHERE is_active = 1');
        const totalActiveBots = activeBotsList.length;
        const demoBots = activeBotsList.filter(b => b.mode === 'demo').length;
        const liveBots = activeBotsList.filter(b => b.mode === 'live').length;

        // Calculate error rates (checking for bots with issues)
        const recentErrorTrades = dbGet(`
            SELECT COUNT(*) as count
            FROM bot_trades
            WHERE created_at > ?
            AND (status = 'failed' OR status = 'error')
        `, [oneHourAgo]);

        const totalRecentTrades = recentTrades?.count || 0;
        const errorTrades = recentErrorTrades?.count || 0;
        const errorRate = totalRecentTrades > 0
            ? ((errorTrades / totalRecentTrades) * 100).toFixed(2)
            : 0;

        // System uptime (process uptime in hours)
        const uptimeHours = (process.uptime() / 3600).toFixed(1);

        // Overall health status
        const healthScore = errorRate < 5 ? 'healthy' : errorRate < 15 ? 'degraded' : 'unhealthy';

        res.json({
            database: {
                users: userCount?.count || 0,
                bots: botCount?.count || 0,
                trades: tradeCount?.count || 0,
                transactions: transactionCount?.count || 0
            },
            bots: {
                total: totalActiveBots,
                demo: demoBots,
                live: liveBots,
                healthStatus: totalActiveBots > 0 ? 'active' : 'inactive'
            },
            activity: {
                recentLogins: recentLogins?.count || 0,
                recentTrades: totalRecentTrades,
                errorRate: parseFloat(errorRate),
                errorCount: errorTrades
            },
            system: {
                uptime: uptimeHours,
                status: healthScore,
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('System health analytics error:', error);
        res.status(500).json({ error: 'Failed to fetch system health metrics' });
    }
});

// ==================== GOOGLE & BACKUP SETTINGS ====================

const { google } = require('googleapis');
const { getOAuth2Client, getBaseUrl, performBackup, startBackupSchedule, stopBackupSchedule } = require('../services/backup');

// Get Google settings
router.get('/api/admin/google-settings', requireAuth, requireRole('admin'), (req, res) => {
    res.json({
        googleClientId: siteSettings.googleClientId || '',
        googleClientSecret: siteSettings.googleClientSecret ? '••••••••' : '',
        googleOAuthEnabled: siteSettings.googleOAuthEnabled || false,
        googleDriveConnected: !!siteSettings.googleDriveTokens
    });
});

// Save Google settings
router.post('/api/admin/google-settings', requireAuth, requireRole('admin'), (req, res) => {
    try {
        const { googleClientId, googleClientSecret, googleOAuthEnabled } = req.body;

        if (googleClientId !== undefined) siteSettings.googleClientId = googleClientId;
        if (googleClientSecret !== undefined && googleClientSecret !== '••••••••') {
            siteSettings.googleClientSecret = googleClientSecret;
        }
        if (googleOAuthEnabled !== undefined) siteSettings.googleOAuthEnabled = googleOAuthEnabled;

        saveSettings();
        logAdminAction(req.session.userId, 'update_google_settings', 'settings', null, 'Updated Google OAuth settings', getClientIP(req));
        res.json({ success: true });
    } catch (error) {
        console.error('Save Google settings error:', error);
        res.status(500).json({ error: 'Failed to save settings' });
    }
});

// Initiate Google Drive OAuth
router.get('/api/admin/backup/google/auth', requireAuth, requireRole('admin'), (req, res) => {
    const { googleClientId, googleClientSecret } = siteSettings;
    if (!googleClientId || !googleClientSecret) {
        return res.status(400).json({ error: 'Google Client ID and Secret are required' });
    }

    const oauth2Client = new google.auth.OAuth2(
        googleClientId,
        googleClientSecret,
        `${getBaseUrl()}/api/admin/backup/google/callback`
    );

    const url = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: ['https://www.googleapis.com/auth/drive.file'],
        prompt: 'consent'
    });

    res.redirect(url);
});

// Google Drive OAuth callback
router.get('/api/admin/backup/google/callback', requireAuth, requireRole('admin'), async (req, res) => {
    try {
        const { code } = req.query;
        if (!code) {
            return res.redirect('/admin?tab=backup&drive=error');
        }

        const oauth2Client = new google.auth.OAuth2(
            siteSettings.googleClientId,
            siteSettings.googleClientSecret,
            `${getBaseUrl()}/api/admin/backup/google/callback`
        );

        const { tokens } = await oauth2Client.getToken(code);
        siteSettings.googleDriveTokens = tokens;
        saveSettings();

        logAdminAction(req.session.userId, 'connect_google_drive', 'settings', null, 'Connected Google Drive for backups', getClientIP(req));

        res.redirect('/admin?tab=backup&drive=connected');
    } catch (error) {
        console.error('Google Drive callback error:', error);
        res.redirect('/admin?tab=backup&drive=error');
    }
});

// Disconnect Google Drive
router.post('/api/admin/backup/disconnect', requireAuth, requireRole('admin'), (req, res) => {
    siteSettings.googleDriveTokens = null;
    siteSettings.googleDriveBackupEnabled = false;
    stopBackupSchedule();
    saveSettings();
    logAdminAction(req.session.userId, 'disconnect_google_drive', 'settings', null, 'Disconnected Google Drive', getClientIP(req));
    res.json({ success: true });
});

// Get backup settings
router.get('/api/admin/backup/settings', requireAuth, requireRole('admin'), (req, res) => {
    res.json({
        enabled: siteSettings.googleDriveBackupEnabled || false,
        time: siteSettings.googleDriveBackupTime || '03:00',
        folderId: siteSettings.googleDriveBackupFolderId || '',
        driveConnected: !!siteSettings.googleDriveTokens
    });
});

// Save backup settings
router.post('/api/admin/backup/settings', requireAuth, requireRole('admin'), (req, res) => {
    try {
        const { enabled, time, folderId } = req.body;

        if (enabled !== undefined) siteSettings.googleDriveBackupEnabled = enabled;
        if (time !== undefined) siteSettings.googleDriveBackupTime = time;
        if (folderId !== undefined) siteSettings.googleDriveBackupFolderId = folderId;

        saveSettings();

        // Restart schedule
        if (siteSettings.googleDriveBackupEnabled) {
            startBackupSchedule();
        } else {
            stopBackupSchedule();
        }

        logAdminAction(req.session.userId, 'update_backup_settings', 'settings', null, `Backup ${enabled ? 'enabled' : 'disabled'}, time: ${time}`, getClientIP(req));
        res.json({ success: true });
    } catch (error) {
        console.error('Save backup settings error:', error);
        res.status(500).json({ error: 'Failed to save settings' });
    }
});

// Trigger manual backup
router.post('/api/admin/backup/trigger', requireAuth, requireRole('admin'), async (req, res) => {
    try {
        const result = await performBackup('manual');
        logAdminAction(req.session.userId, 'manual_backup', 'backup', null, `Manual backup: ${result.filename}`, getClientIP(req));
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('Manual backup error:', error);
        res.status(500).json({ error: error.message || 'Backup failed' });
    }
});

// Get backup history
router.get('/api/admin/backup/history', requireAuth, requireRole('admin'), (req, res) => {
    const history = dbAll('SELECT * FROM backup_history ORDER BY created_at DESC LIMIT 50');
    res.json(history);
});

// ==================== SERVER MANAGEMENT ====================

const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Restart server via PM2
router.post('/api/admin/server/restart', requireAuth, requireRole('admin'), (req, res) => {
    logAdminAction(req.session.userId, 'server_restart', 'server', null, 'Initiated server restart', getClientIP(req));
    res.json({ success: true, message: 'Server restarting...' });

    // Delay restart slightly so the response gets sent
    setTimeout(() => {
        exec('pm2 restart all', (error) => {
            if (error) console.error('PM2 restart failed:', error);
        });
    }, 500);
});

// Get server info
router.get('/api/admin/server/info', requireAuth, requireRole('admin'), (req, res) => {
    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const memUsage = process.memoryUsage();

    res.json({
        uptime: `${hours}г ${minutes}хв`,
        uptimeSeconds: uptime,
        memory: {
            rss: (memUsage.rss / 1024 / 1024).toFixed(1) + ' MB',
            heapUsed: (memUsage.heapUsed / 1024 / 1024).toFixed(1) + ' MB',
            heapTotal: (memUsage.heapTotal / 1024 / 1024).toFixed(1) + ' MB'
        },
        nodeVersion: process.version,
        pid: process.pid,
        platform: process.platform
    });
});

// Live logs — stream PM2 logs via SSE
router.get('/api/admin/server/logs', requireAuth, requireRole('admin'), (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    });

    res.write('data: [Connected to log stream]\n\n');

    const lines = parseInt(req.query.lines) || 100;
    const logProcess = spawn('pm2', ['logs', '--raw', '--lines', String(lines), '--nostream'], {
        shell: true
    });

    let initialSent = false;
    logProcess.stdout.on('data', (data) => {
        const lines = data.toString().split('\n').filter(l => l.trim());
        lines.forEach(line => {
            res.write(`data: ${line}\n\n`);
        });
        initialSent = true;
    });

    logProcess.stderr.on('data', (data) => {
        const lines = data.toString().split('\n').filter(l => l.trim());
        lines.forEach(line => {
            res.write(`data: ${line}\n\n`);
        });
    });

    logProcess.on('close', () => {
        // After initial logs, start streaming live
        const liveProcess = spawn('pm2', ['logs', '--raw'], { shell: true });

        liveProcess.stdout.on('data', (data) => {
            const lines = data.toString().split('\n').filter(l => l.trim());
            lines.forEach(line => {
                res.write(`data: ${line}\n\n`);
            });
        });

        liveProcess.stderr.on('data', (data) => {
            const lines = data.toString().split('\n').filter(l => l.trim());
            lines.forEach(line => {
                res.write(`data: ${line}\n\n`);
            });
        });

        req.on('close', () => {
            liveProcess.kill();
        });
    });

    req.on('close', () => {
        logProcess.kill();
    });
});

// List backups from Google Drive
router.get('/api/admin/backup/drive-files', requireAuth, requireRole('admin'), async (req, res) => {
    try {
        if (!siteSettings.googleDriveTokens) {
            return res.status(400).json({ error: 'Google Drive not connected' });
        }

        const auth = getOAuth2Client();
        const drive = google.drive({ version: 'v3', auth });

        const query = "name contains 'yamato-backup' and mimeType = 'application/gzip' and trashed = false";
        const params = { q: query, fields: 'files(id, name, size, createdTime)', orderBy: 'createdTime desc', pageSize: 30 };

        if (siteSettings.googleDriveBackupFolderId) {
            params.q += ` and '${siteSettings.googleDriveBackupFolderId}' in parents`;
        }

        const result = await drive.files.list(params);
        res.json(result.data.files || []);
    } catch (error) {
        console.error('Drive files list error:', error);
        res.status(500).json({ error: error.message || 'Failed to list Drive files' });
    }
});

// Scan Google Drive folder for backups (works with shared folder link — no OAuth needed)
router.get('/api/admin/backup/scan-drive', requireAuth, requireRole('admin'), async (req, res) => {
    try {
        // Try OAuth-connected drive first
        if (siteSettings.googleDriveTokens) {
            try {
                const auth = getOAuth2Client();
                const drive = google.drive({ version: 'v3', auth });

                // Search for backup files by name patterns
                const namePatterns = ["name contains 'backup'", "name contains 'database'", "name contains 'yamato'"];
                const typePatterns = ["mimeType = 'application/gzip'", "mimeType = 'application/x-sqlite3'", "mimeType = 'application/octet-stream'"];
                const query = `(${namePatterns.join(' or ')}) and (${typePatterns.join(' or ')}) and trashed = false`;

                const params = {
                    q: query,
                    fields: 'files(id, name, size, createdTime, webContentLink)',
                    orderBy: 'createdTime desc',
                    pageSize: 50
                };

                if (siteSettings.googleDriveBackupFolderId) {
                    params.q += ` and '${siteSettings.googleDriveBackupFolderId}' in parents`;
                }

                const result = await drive.files.list(params);
                const files = (result.data.files || []).map(f => ({
                    id: f.id,
                    name: f.name,
                    size: parseInt(f.size) || 0,
                    createdTime: f.createdTime,
                    downloadUrl: f.webContentLink || `https://drive.google.com/uc?export=download&id=${f.id}`
                }));
                return res.json({ files, source: 'oauth' });
            } catch (oauthErr) {
                console.log('OAuth scan failed, trying public:', oauthErr.message);
            }
        }

        // Fallback: if a folder ID is set, try public API key access
        const folderId = siteSettings.googleDriveBackupFolderId || req.query.folderId;
        if (!folderId) {
            return res.status(400).json({ error: 'Google Drive не підключений і не вказано ID папки. Підключіть Google Drive або вставте посилання вручну.' });
        }

        // Use public Google Drive API (no auth, works for publicly shared folders)
        const axios = require('axios');
        const apiUrl = `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+trashed=false&fields=files(id,name,size,createdTime)&orderBy=createdTime+desc&pageSize=50&key=${siteSettings.googleClientId ? '' : ''}`;

        // Without API key, use the folder listing page scraping as fallback
        return res.status(400).json({ error: 'Google Drive не підключений. Вставте посилання на файл вручну у поле вище.' });
    } catch (error) {
        console.error('Scan drive error:', error);
        res.status(500).json({ error: error.message || 'Scan failed' });
    }
});

// Restore database from Google Drive backup
router.post('/api/admin/backup/restore', requireAuth, requireRole('admin'), async (req, res) => {
    try {
        const { fileId, fileName } = req.body;
        if (!fileId) return res.status(400).json({ error: 'File ID required' });

        if (!siteSettings.googleDriveTokens) {
            return res.status(400).json({ error: 'Google Drive not connected' });
        }

        const auth = getOAuth2Client();
        const drive = google.drive({ version: 'v3', auth });

        // Download file
        const tmpDir = path.join(__dirname, '..', 'tmp');
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

        const tmpFile = path.join(tmpDir, `restore-${Date.now()}.tar.gz`);
        const dest = fs.createWriteStream(tmpFile);

        const response = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });

        await new Promise((resolve, reject) => {
            response.data.pipe(dest);
            dest.on('finish', resolve);
            dest.on('error', reject);
        });

        // Extract archive
        const extractDir = path.join(tmpDir, `restore-${Date.now()}`);
        fs.mkdirSync(extractDir, { recursive: true });

        await new Promise((resolve, reject) => {
            exec(`tar -xzf "${tmpFile}" -C "${extractDir}"`, (error) => {
                if (error) reject(error);
                else resolve();
            });
        });

        // Restore all known files from archive
        const { DB_PATH, SESSIONS_PATH, SETTINGS_PATH } = require('../config');
        const serverDir = path.dirname(DB_PATH);
        const ts = Date.now();

        // Backup current files
        const backupOfCurrent = DB_PATH + '.pre-restore.' + ts;
        if (fs.existsSync(DB_PATH)) fs.copyFileSync(DB_PATH, backupOfCurrent);
        if (fs.existsSync(SESSIONS_PATH)) fs.copyFileSync(SESSIONS_PATH, SESSIONS_PATH + '.pre-restore.' + ts);
        if (fs.existsSync(SETTINGS_PATH)) fs.copyFileSync(SETTINGS_PATH, SETTINGS_PATH + '.pre-restore.' + ts);

        const filesToRestore = [
            { name: 'database.sqlite', dest: DB_PATH },
            { name: 'sessions.json', dest: SESSIONS_PATH },
            { name: 'settings.json', dest: SETTINGS_PATH },
            { name: 'candles.sqlite', dest: path.join(serverDir, 'candles.sqlite') },
        ];

        const restored = [];
        for (const f of filesToRestore) {
            const src = path.join(extractDir, f.name);
            if (fs.existsSync(src)) {
                fs.copyFileSync(src, f.dest);
                restored.push(f.name);
            }
        }

        if (restored.length === 0) {
            try { fs.unlinkSync(tmpFile); } catch(e) {}
            try { fs.rmSync(extractDir, { recursive: true }); } catch(e) {}
            return res.status(400).json({ error: 'Архів не містить жодного відомого файлу' });
        }

        // Cleanup temp files
        try { fs.unlinkSync(tmpFile); } catch(e) {}
        try { fs.rmSync(extractDir, { recursive: true }); } catch(e) {}

        logAdminAction(req.session.userId, 'restore_backup', 'backup', null, `Restored from: ${fileName || fileId} | Files: ${restored.join(', ')}`, getClientIP(req));

        res.json({ success: true, message: `Відновлено: ${restored.join(', ')}. Потрібен перезапуск сервера.`, backupOfPrevious: backupOfCurrent, restored });
    } catch (error) {
        console.error('Restore backup error:', error);
        res.status(500).json({ error: error.message || 'Restore failed' });
    }
});

// Restore database from Google Drive public link (no OAuth required)
router.post('/api/admin/backup/restore-url', requireAuth, requireRole('admin'), async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) return res.status(400).json({ error: 'URL is required' });

        // Extract file ID from various Google Drive URL formats
        let fileId = null;
        const patterns = [
            /\/file\/d\/([a-zA-Z0-9_-]+)/,       // /file/d/FILE_ID/
            /[?&]id=([a-zA-Z0-9_-]+)/,            // ?id=FILE_ID
            /\/open\?id=([a-zA-Z0-9_-]+)/,        // /open?id=FILE_ID
            /^([a-zA-Z0-9_-]{20,})$/,             // raw file ID
        ];
        for (const p of patterns) {
            const m = url.match(p);
            if (m) { fileId = m[1]; break; }
        }
        if (!fileId) return res.status(400).json({ error: 'Could not extract file ID from URL. Use a Google Drive share link.' });

        const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;

        const tmpDir = path.join(__dirname, '..', 'tmp');
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
        const tmpFile = path.join(tmpDir, `restore-url-${Date.now()}`);

        // Download file (follow redirects for large files)
        const axios = require('axios');
        let downloadResp;
        try {
            downloadResp = await axios.get(downloadUrl, {
                responseType: 'stream', timeout: 120000, maxRedirects: 5,
                headers: { 'User-Agent': 'Mozilla/5.0' }
            });
        } catch (dlErr) {
            // Try with confirm param for large files
            try {
                downloadResp = await axios.get(downloadUrl + '&confirm=t', {
                    responseType: 'stream', timeout: 120000, maxRedirects: 5,
                    headers: { 'User-Agent': 'Mozilla/5.0' }
                });
            } catch (dlErr2) {
                return res.status(400).json({ error: 'Failed to download file from Google Drive. Make sure the link is public.' });
            }
        }

        const dest = fs.createWriteStream(tmpFile);
        await new Promise((resolve, reject) => {
            downloadResp.data.pipe(dest);
            dest.on('finish', resolve);
            dest.on('error', reject);
        });

        const fileSize = fs.statSync(tmpFile).size;
        if (fileSize < 1000) {
            // Probably an HTML error page, not a real file
            const content = fs.readFileSync(tmpFile, 'utf8').slice(0, 500);
            try { fs.unlinkSync(tmpFile); } catch(e) {}
            if (content.includes('<!DOCTYPE') || content.includes('<html')) {
                return res.status(400).json({ error: 'Google Drive returned an HTML page. Make sure the file is shared publicly (anyone with the link).' });
            }
            return res.status(400).json({ error: 'Downloaded file is too small (' + fileSize + ' bytes). Check the link.' });
        }

        // Detect file type: .sqlite, .tar.gz, or .gz
        const { DB_PATH, SESSIONS_PATH, SETTINGS_PATH } = require('../config');
        const serverDir = path.dirname(DB_PATH);
        const ts = Date.now();

        // Backup current files before restoring
        const backupOfCurrent = DB_PATH + '.pre-restore.' + ts;
        if (fs.existsSync(DB_PATH)) fs.copyFileSync(DB_PATH, backupOfCurrent);
        if (fs.existsSync(SESSIONS_PATH)) fs.copyFileSync(SESSIONS_PATH, SESSIONS_PATH + '.pre-restore.' + ts);
        if (fs.existsSync(SETTINGS_PATH)) fs.copyFileSync(SETTINGS_PATH, SETTINGS_PATH + '.pre-restore.' + ts);

        const { exec } = require('child_process');
        const isTarGz = await new Promise(resolve => {
            exec(`file "${tmpFile}"`, (err, stdout) => {
                resolve(stdout && (stdout.includes('gzip') || stdout.includes('tar')));
            });
        });

        const restored = [];

        if (isTarGz) {
            const extractDir = path.join(tmpDir, `restore-url-extract-${ts}`);
            fs.mkdirSync(extractDir, { recursive: true });
            try {
                await new Promise((resolve, reject) => {
                    exec(`tar -xzf "${tmpFile}" -C "${extractDir}"`, (error) => {
                        if (error) reject(error); else resolve();
                    });
                });

                // Restore all known files from archive
                const filesToRestore = [
                    { name: 'database.sqlite', dest: DB_PATH },
                    { name: 'sessions.json', dest: SESSIONS_PATH },
                    { name: 'settings.json', dest: SETTINGS_PATH },
                    { name: 'candles.sqlite', dest: path.join(serverDir, 'candles.sqlite') },
                ];

                for (const f of filesToRestore) {
                    let src = path.join(extractDir, f.name);
                    if (!fs.existsSync(src)) {
                        // Search recursively
                        const found = await new Promise(resolve => {
                            exec(`find "${extractDir}" -name "${f.name}" -type f | head -1`, (err, stdout) => {
                                resolve(stdout ? stdout.trim() : null);
                            });
                        });
                        if (found) src = found;
                        else continue;
                    }
                    fs.copyFileSync(src, f.dest);
                    restored.push(f.name);
                }

                if (restored.length === 0) {
                    try { fs.unlinkSync(tmpFile); } catch(e) {}
                    try { fs.rmSync(extractDir, { recursive: true }); } catch(e) {}
                    return res.status(400).json({ error: 'Архів не містить жодного відомого файлу (database.sqlite, settings.json, тощо)' });
                }

                try { fs.rmSync(extractDir, { recursive: true }); } catch(e) {}
            } catch (extractErr) {
                // Not a tar.gz — maybe it's a raw .sqlite file
                fs.copyFileSync(tmpFile, DB_PATH);
                restored.push('database.sqlite (raw)');
            }
        } else {
            // Assume raw sqlite file
            fs.copyFileSync(tmpFile, DB_PATH);
            restored.push('database.sqlite (raw)');
        }

        try { fs.unlinkSync(tmpFile); } catch(e) {}

        logAdminAction(req.session.userId, 'restore_backup_url', 'backup', null, `Restored from URL: ${url.slice(0, 80)} | Files: ${restored.join(', ')}`, getClientIP(req));

        res.json({ success: true, message: `Відновлено: ${restored.join(', ')}. Потрібен перезапуск сервера.`, backupOfPrevious: backupOfCurrent, fileSize, restored });
    } catch (error) {
        console.error('Restore from URL error:', error);
        res.status(500).json({ error: error.message || 'Restore failed' });
    }
});

// ==================== BUG REPORTS ====================

const BUG_REPORTS_DIR = path.join(__dirname, '..', '..', 'uploads', 'bug-reports');

function ensureBugReportsDir() {
    if (!fs.existsSync(BUG_REPORTS_DIR)) {
        fs.mkdirSync(BUG_REPORTS_DIR, { recursive: true });
    }
}

async function notifyAdminsNewBugReport(reportId, reporter, pageUrl, description) {
    try {
        const { getTelegramBot } = require('../services/telegram');
        const bot = getTelegramBot();
        if (!bot) return;

        const admins = dbAll(
            "SELECT telegram_id FROM users WHERE role = 'admin' AND telegram_id IS NOT NULL AND telegram_verified = 1"
        );
        if (!admins.length) return;

        const shortDesc = description ? description.substring(0, 300) : 'No description';
        const message =
            `[Bug Report #${reportId}]\n\n` +
            `Reporter: ${reporter?.full_name || 'Unknown'} (${reporter?.email || 'anonymous'})\n` +
            `Page: ${pageUrl || 'N/A'}\n\n` +
            `Description:\n${shortDesc}\n\n` +
            `View in Admin Panel -> Bug Reports tab`;

        for (const admin of admins) {
            try {
                await bot.sendMessage(admin.telegram_id, message);
            } catch (err) {
                console.error('[BugReport] Telegram notify error:', err.message);
            }
        }
    } catch (err) {
        console.error('[BugReport] notifyAdmins error:', err.message);
    }
}

// Public: check if bug reporting is enabled (no auth required)
router.get('/api/admin/bug-reporting-enabled', (req, res) => {
    res.json({ enabled: !!siteSettings.bugReportingEnabled });
});

// Admin: toggle bug reporting
router.post('/api/admin/bug-reporting-toggle', requireAuth, requireRole('admin'), (req, res) => {
    try {
        const { enabled } = req.body;
        siteSettings.bugReportingEnabled = !!enabled;
        saveSettings();
        logAdminAction(
            req.session.userId, 'bug_reporting_toggle', 'settings', null,
            `Bug reporting ${enabled ? 'enabled' : 'disabled'}`, getClientIP(req)
        );
        res.json({ success: true, enabled: siteSettings.bugReportingEnabled });
    } catch (error) {
        console.error('Bug reporting toggle error:', error);
        res.status(500).json({ error: 'Failed to toggle bug reporting' });
    }
});

// Submit bug report (works with or without auth)
router.post('/api/bug-report', express.json({ limit: '20mb' }), async (req, res) => {
    try {
        if (!siteSettings.bugReportingEnabled) {
            return res.status(403).json({ error: 'Bug reporting is disabled' });
        }

        const { description, logs, screenshot, page_url, user_agent } = req.body;
        const userId = req.session && req.session.userId;
        const user = userId ? dbGet('SELECT id, email, full_name FROM users WHERE id = ?', [userId]) : null;

        ensureBugReportsDir();

        let screenshotPath = null;
        if (screenshot && screenshot.startsWith('data:image/')) {
            const base64Data = screenshot.replace(/^data:image\/\w+;base64,/, '');
            const buffer = Buffer.from(base64Data, 'base64');
            const filename = `screenshot-${Date.now()}-${req.session.userId}.png`;
            screenshotPath = `uploads/bug-reports/${filename}`;
            fs.writeFileSync(path.join(BUG_REPORTS_DIR, filename), buffer);
        }

        const result = dbRun(
            `INSERT INTO bug_reports (user_id, user_email, user_name, description, logs, screenshot_path, page_url, user_agent)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                user?.id || null,
                user?.email || null,
                user?.full_name || null,
                description || null,
                logs ? JSON.stringify(logs) : null,
                screenshotPath,
                page_url || null,
                user_agent || null
            ]
        );

        const reportId = result.lastInsertRowid;
        await notifyAdminsNewBugReport(reportId, user, page_url, description);

        res.json({ success: true, reportId });
    } catch (error) {
        console.error('Bug report submit error:', error);
        res.status(500).json({ error: 'Failed to submit bug report' });
    }
});

// Upload video for a bug report
router.post('/api/bug-report/:id/video',
    requireAuth,
    express.raw({ type: ['video/webm', 'video/mp4', 'application/octet-stream'], limit: '200mb' }),
    (req, res) => {
        try {
            const reportId = parseInt(req.params.id);
            if (!reportId) return res.status(400).json({ error: 'Invalid report ID' });

            const report = dbGet('SELECT id FROM bug_reports WHERE id = ?', [reportId]);
            if (!report) return res.status(404).json({ error: 'Report not found' });

            ensureBugReportsDir();

            const filename = `video-${reportId}-${Date.now()}.webm`;
            const filePath = path.join(BUG_REPORTS_DIR, filename);
            fs.writeFileSync(filePath, req.body);

            dbRun('UPDATE bug_reports SET video_path = ? WHERE id = ?',
                [`uploads/bug-reports/${filename}`, reportId]);

            res.json({ success: true });
        } catch (error) {
            console.error('Bug report video upload error:', error);
            res.status(500).json({ error: 'Failed to upload video' });
        }
    }
);

// Admin: list all bug reports
router.get('/api/admin/bug-reports', requireAuth, requireRole('admin', 'moderator'), (req, res) => {
    try {
        const reports = dbAll(`
            SELECT id, user_email, user_name, description, page_url, status, created_at,
                   CASE WHEN screenshot_path IS NOT NULL THEN 1 ELSE 0 END AS has_screenshot,
                   CASE WHEN video_path IS NOT NULL THEN 1 ELSE 0 END AS has_video
            FROM bug_reports
            ORDER BY created_at DESC
            LIMIT 200
        `);
        res.json(reports);
    } catch (error) {
        console.error('Bug reports list error:', error);
        res.status(500).json({ error: 'Failed to fetch bug reports' });
    }
});

// Admin: get single bug report detail
router.get('/api/admin/bug-reports/:id', requireAuth, requireRole('admin', 'moderator'), (req, res) => {
    try {
        const report = dbGet('SELECT * FROM bug_reports WHERE id = ?', [req.params.id]);
        if (!report) return res.status(404).json({ error: 'Report not found' });
        res.json(report);
    } catch (error) {
        console.error('Bug report detail error:', error);
        res.status(500).json({ error: 'Failed to fetch report' });
    }
});

// Admin: update report status
router.put('/api/admin/bug-reports/:id/status', requireAuth, requireRole('admin', 'moderator'), (req, res) => {
    try {
        const { status } = req.body;
        const allowed = ['new', 'in_progress', 'resolved', 'closed'];
        if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });
        dbRun('UPDATE bug_reports SET status = ? WHERE id = ?', [status, req.params.id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update status' });
    }
});

// Admin: delete bug report
router.delete('/api/admin/bug-reports/:id', requireAuth, requireRole('admin'), (req, res) => {
    try {
        const report = dbGet('SELECT * FROM bug_reports WHERE id = ?', [req.params.id]);
        if (!report) return res.status(404).json({ error: 'Report not found' });

        if (report.screenshot_path) {
            try { fs.unlinkSync(path.join(__dirname, '..', '..', report.screenshot_path)); } catch (e) {}
        }
        if (report.video_path) {
            try { fs.unlinkSync(path.join(__dirname, '..', '..', report.video_path)); } catch (e) {}
        }

        dbRun('DELETE FROM bug_reports WHERE id = ?', [req.params.id]);
        logAdminAction(req.session.userId, 'delete_bug_report', 'bug_reports', report.id,
            `Deleted report from ${report.user_email}`, getClientIP(req));

        res.json({ success: true });
    } catch (error) {
        console.error('Bug report delete error:', error);
        res.status(500).json({ error: 'Failed to delete report' });
    }
});

module.exports = router;
