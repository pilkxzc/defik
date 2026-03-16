'use strict';
const express = require('express');
const router  = express.Router();

const { dbGet, dbRun } = require('../db');
const { requireAuth }  = require('../middleware/auth');

function createNotification(...args) {
    return require('../services/notifications').createNotification(...args);
}

// Get current subscription
router.get('/api/subscription', requireAuth, (req, res) => {
    try {
        const user = dbGet('SELECT subscription_plan, subscription_expires_at FROM users WHERE id = ?', [req.session.userId]);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const botsCount = dbGet('SELECT COUNT(*) as count FROM bots WHERE user_id = ?', [req.session.userId]);
        const now = new Date();
        let plan = user.subscription_plan || 'free';

        if (user.subscription_expires_at && new Date(user.subscription_expires_at) < now) {
            plan = 'free';
        }

        res.json({
            subscription: {
                plan,
                expiresAt: user.subscription_expires_at,
                botsCount: botsCount?.count || 0
            }
        });
    } catch (error) {
        console.error('Get subscription error:', error);
        res.status(500).json({ error: 'Failed to get subscription' });
    }
});

// Create subscription checkout (mock)
router.post('/api/subscription/checkout', requireAuth, (req, res) => {
    try {
        const { plan, period } = req.body;

        if (!plan || !['pro', 'enterprise'].includes(plan)) {
            return res.status(400).json({ error: 'Invalid plan' });
        }

        const now = new Date();
        const expiresAt = period === 'yearly'
            ? new Date(now.setFullYear(now.getFullYear() + 1))
            : new Date(now.setMonth(now.getMonth() + 1));

        dbRun('UPDATE users SET subscription_plan = ?, subscription_expires_at = ? WHERE id = ?', [
            plan, expiresAt.toISOString(), req.session.userId
        ]);

        createNotification(req.session.userId, 'system', 'Subscription Activated',
            `You have successfully subscribed to ${plan.charAt(0).toUpperCase() + plan.slice(1)}!`, 'star');

        res.json({ success: true, subscription: { plan, expiresAt: expiresAt.toISOString() } });
    } catch (error) {
        console.error('Checkout error:', error);
        res.status(500).json({ error: 'Failed to process checkout' });
    }
});

// Cancel subscription
router.post('/api/subscription/cancel', requireAuth, (req, res) => {
    try {
        const user = dbGet('SELECT subscription_plan, subscription_expires_at FROM users WHERE id = ?', [req.session.userId]);
        if (!user || user.subscription_plan === 'free') {
            return res.status(400).json({ error: 'No active subscription to cancel' });
        }

        dbRun("UPDATE users SET subscription_plan = 'free', subscription_expires_at = NULL WHERE id = ?", [req.session.userId]);

        createNotification(req.session.userId, 'system', 'Subscription Cancelled',
            'Your subscription has been cancelled and reverted to the free plan.', 'info');

        res.json({ success: true, message: 'Subscription has been cancelled' });
    } catch (error) {
        console.error('Cancel subscription error:', error);
        res.status(500).json({ error: 'Failed to cancel subscription' });
    }
});

module.exports = router;
