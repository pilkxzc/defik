'use strict';
const express = require('express');
const crypto  = require('crypto');
const router  = express.Router();

const { dbGet, dbAll, dbRun, saveDatabase } = require('../db');
const { requireAuth }                        = require('../middleware/auth');
const { getClientIP }                        = require('../utils/ip');
const { siteSettings }                       = require('../config');

function createNotification(...args) {
    return require('../services/notifications').createNotification(...args);
}
function sendTelegramNotification(...args) {
    return require('../services/telegram').sendTelegramNotification(...args);
}

// ==================== PROFILE ====================

router.get('/api/profile', requireAuth, (req, res) => {
    const user = dbGet(
        'SELECT id, email, full_name, phone, real_balance, created_at, is_verified, verification_level, role, avatar, telegram_id, telegram_username, telegram_verified, google_id, google_avatar FROM users WHERE id = ?',
        [req.session.userId]
    );

    const paymentMethods = dbAll('SELECT * FROM payment_methods WHERE user_id = ?', [req.session.userId]);
    const activityLog    = dbAll(
        'SELECT * FROM activity_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 10',
        [req.session.userId]
    );

    const balance = user.real_balance || 0;

    res.json({
        user: {
            id: user.id,
            email: user.email,
            fullName: user.full_name,
            phone: user.phone,
            balance,
            demoBalance: balance,
            realBalance: balance,
            activeAccount: 'real',
            createdAt: user.created_at,
            isVerified: user.is_verified,
            verificationLevel: user.verification_level,
            role: user.role || 'user',
            avatar: user.avatar || null,
            telegramLinked: !!user.telegram_id && user.telegram_verified === 1,
            telegramUsername: user.telegram_username || null,
            googleLinked: !!user.google_id,
            googleAvatar: user.google_avatar || null
        },
        paymentMethods,
        activityLog
    });
});

router.patch('/api/profile', requireAuth, (req, res) => {
    try {
        const { fullName, phone } = req.body;
        const updates = [], params = [];

        if (fullName !== undefined) { updates.push('full_name = ?'); params.push(fullName); }
        if (phone !== undefined)    { updates.push('phone = ?');     params.push(phone); }

        if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

        params.push(req.session.userId);
        dbRun(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);

        dbRun(
            'INSERT INTO activity_log (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [req.session.userId, 'Profile Updated', 'User updated profile information', getClientIP(req)]
        );

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update profile' });
    }
});

// ==================== PAYMENT METHODS ====================

router.post('/api/profile/payment-methods', requireAuth, (req, res) => {
    try {
        const { type, cardLastFour, expiryDate } = req.body;
        const result = dbRun(
            'INSERT INTO payment_methods (user_id, type, card_last_four, expiry_date) VALUES (?, ?, ?, ?)',
            [req.session.userId, type, cardLastFour, expiryDate]
        );
        res.json({ success: true, paymentMethodId: result.lastInsertRowid });
    } catch (error) {
        res.status(500).json({ error: 'Failed to add payment method' });
    }
});

router.delete('/api/profile/payment-methods/:id', requireAuth, (req, res) => {
    try {
        dbRun('DELETE FROM payment_methods WHERE id = ? AND user_id = ?', [req.params.id, req.session.userId]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete payment method' });
    }
});

router.get('/api/profile/payment-methods', requireAuth, (req, res) => {
    try {
        const methods = dbAll('SELECT * FROM payment_methods WHERE user_id = ?', [req.session.userId]);
        res.json(methods.map(m => ({
            id: m.id, type: m.type,
            cardLastFour: m.card_last_four, expiryDate: m.expiry_date, createdAt: m.created_at
        })));
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch payment methods' });
    }
});

// ==================== AVATAR ====================

router.post('/api/profile/avatar', requireAuth, (req, res) => {
    try {
        const { avatar } = req.body;
        if (!avatar) return res.status(400).json({ error: 'No avatar provided' });
        if (!avatar.startsWith('data:image/')) return res.status(400).json({ error: 'Invalid image format' });
        if (avatar.length > 2800000) return res.status(400).json({ error: 'Image too large. Max 2MB' });

        const userId = req.session.userId;
        const { getDb } = require('../db');
        getDb().run('UPDATE users SET avatar = ? WHERE id = ?', [avatar, userId]);
        saveDatabase();

        const verify = dbGet('SELECT avatar FROM users WHERE id = ?', [userId]);
        if (!verify?.avatar) {
            console.error('Avatar was not saved properly!');
            return res.status(500).json({ error: 'Failed to save avatar' });
        }

        dbRun(
            'INSERT INTO activity_log (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [userId, 'Avatar updated', 'Profile picture changed', getClientIP(req)]
        );

        res.json({ success: true, avatar });
    } catch (error) {
        console.error('Avatar upload error:', error);
        res.status(500).json({ error: 'Failed to upload avatar' });
    }
});

router.get('/api/profile/avatar', requireAuth, (req, res) => {
    try {
        const user = dbGet('SELECT avatar FROM users WHERE id = ?', [req.session.userId]);
        res.json({ avatar: user?.avatar || null });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch avatar' });
    }
});

router.delete('/api/profile/avatar', requireAuth, (req, res) => {
    try {
        dbRun('UPDATE users SET avatar = NULL WHERE id = ?', [req.session.userId]);
        saveDatabase();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete avatar' });
    }
});

router.post('/api/profile/avatar/from-telegram', requireAuth, async (req, res) => {
    try {
        const user = dbGet('SELECT telegram_id, telegram_verified FROM users WHERE id = ?', [req.session.userId]);
        if (!user?.telegram_id || !user.telegram_verified) {
            return res.status(400).json({ error: 'Telegram not linked' });
        }

        const { getTelegramBot } = require('../services/telegram');
        const bot = getTelegramBot();
        if (!bot) return res.status(400).json({ error: 'Telegram bot not available' });

        const photos = await bot.getUserProfilePhotos(user.telegram_id, { limit: 1 });
        if (!photos.total_count) return res.status(404).json({ error: 'No Telegram profile photo' });

        const fileId = photos.photos[0][photos.photos[0].length - 1].file_id;
        const file = await bot.getFile(fileId);
        const photoUrl = `https://api.telegram.org/file/bot${siteSettings.telegramBotToken}/${file.file_path}`;

        const response = await fetch(photoUrl);
        if (!response.ok) throw new Error('Failed to download Telegram photo');
        const buffer = Buffer.from(await response.arrayBuffer());
        const base64 = `data:image/jpeg;base64,${buffer.toString('base64')}`;

        if (base64.length > 2800000) return res.status(400).json({ error: 'Image too large' });

        const { getDb } = require('../db');
        getDb().run('UPDATE users SET avatar = ? WHERE id = ?', [base64, req.session.userId]);
        saveDatabase();

        res.json({ success: true, avatar: base64 });
    } catch (error) {
        console.error('Telegram avatar error:', error);
        res.status(500).json({ error: 'Failed to set Telegram avatar' });
    }
});

router.post('/api/profile/avatar/from-google', requireAuth, async (req, res) => {
    try {
        const user = dbGet('SELECT google_id, google_avatar FROM users WHERE id = ?', [req.session.userId]);
        if (!user?.google_id) return res.status(400).json({ error: 'Google not linked' });
        if (!user.google_avatar) return res.status(404).json({ error: 'No Google avatar available' });

        const response = await fetch(user.google_avatar);
        if (!response.ok) throw new Error('Failed to download Google avatar');
        const buffer = Buffer.from(await response.arrayBuffer());
        const contentType = response.headers.get('content-type')?.split(';')[0] || 'image/jpeg';
        const base64 = `data:${contentType};base64,${buffer.toString('base64')}`;

        if (base64.length > 2800000) return res.status(400).json({ error: 'Image too large' });

        const { getDb } = require('../db');
        getDb().run('UPDATE users SET avatar = ? WHERE id = ?', [base64, req.session.userId]);
        saveDatabase();

        res.json({ success: true, avatar: base64 });
    } catch (error) {
        console.error('Google avatar error:', error);
        res.status(500).json({ error: 'Failed to set Google avatar' });
    }
});

// ==================== TELEGRAM INTEGRATION ====================

router.get('/api/telegram/status', requireAuth, async (req, res) => {
    try {
        const user = dbGet('SELECT telegram_id, telegram_verified, telegram_username FROM users WHERE id = ?', [req.session.userId]);
        const { getTelegramBot } = require('../services/telegram');
        const bot = getTelegramBot();
        const linked = !!user.telegram_id && user.telegram_verified === 1;

        let photoUrl = null;
        if (linked && bot && user.telegram_id) {
            try {
                const photos = await bot.getUserProfilePhotos(user.telegram_id, { limit: 1 });
                if (photos.total_count > 0) {
                    const fileId = photos.photos[0][photos.photos[0].length - 1].file_id;
                    const file = await bot.getFile(fileId);
                    photoUrl = `https://api.telegram.org/file/bot${siteSettings.telegramBotToken}/${file.file_path}`;
                }
            } catch(e) {}
        }

        res.json({
            linked,
            botUsername: siteSettings.telegramBotUsername || '',
            botEnabled: siteSettings.telegramBotEnabled && !!bot,
            username: user.telegram_username || null,
            photoUrl
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get Telegram status' });
    }
});

router.post('/api/telegram/link', requireAuth, (req, res) => {
    try {
        const code = crypto.randomBytes(3).toString('hex').toUpperCase();
        dbRun('UPDATE users SET telegram_code = ? WHERE id = ?', [code, req.session.userId]);
        saveDatabase();

        const botLink = siteSettings.telegramBotUsername
            ? `https://t.me/${siteSettings.telegramBotUsername}?start=${code}`
            : null;

        res.json({
            code,
            botLink,
            botUsername: siteSettings.telegramBotUsername || '',
            expiresIn: 300
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to generate link code' });
    }
});

router.post('/api/telegram/unlink', requireAuth, (req, res) => {
    try {
        dbRun('UPDATE users SET telegram_id = NULL, telegram_code = NULL, telegram_verified = 0 WHERE id = ?',
            [req.session.userId]);
        saveDatabase();

        createNotification(req.session.userId, 'system', 'Telegram Unlinked',
            'Your Telegram account has been unlinked from Yamato', '📱');

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to unlink Telegram' });
    }
});

router.post('/api/telegram/test', requireAuth, async (req, res) => {
    try {
        const user = dbGet('SELECT telegram_id, telegram_verified, full_name FROM users WHERE id = ?', [req.session.userId]);
        if (!user.telegram_id || !user.telegram_verified) {
            return res.status(400).json({ error: 'Telegram not linked' });
        }

        const sent = await sendTelegramNotification(
            req.session.userId,
            'Test Notification',
            `Hello, ${user.full_name}! This is a test notification from Yamato.`,
            '🔔'
        );

        if (sent) {
            res.json({ success: true, message: 'Test notification sent' });
        } else {
            res.status(500).json({ error: 'Failed to send test notification' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Failed to send test notification' });
    }
});

// ==================== ACTIVITY ====================

router.get('/api/activity', requireAuth, (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 20;
        const activities = dbAll(
            'SELECT * FROM activity_log WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
            [req.session.userId, limit]
        );
        res.json(activities.map(a => ({
            id: a.id, action: a.action, details: a.details,
            ipAddress: a.ip_address, createdAt: a.created_at
        })));
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch activity' });
    }
});

module.exports = router;
