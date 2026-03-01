'use strict';
const express = require('express');
const router  = express.Router();

const { dbGet, dbRun } = require('../db');
const { requireAuth }  = require('../middleware/auth');
const { getClientIP }  = require('../utils/ip');
const { getLocalTimeAgo } = require('../utils/time');

// Get faucet status
router.get('/api/faucet/status', requireAuth, (req, res) => {
    try {
        const claimed = dbGet(`
            SELECT COALESCE(SUM(amount), 0) as total
            FROM transactions
            WHERE user_id = ? AND type = 'faucet' AND created_at > ?
        `, [req.session.userId, getLocalTimeAgo(24)]);

        const totalClaimed = claimed ? claimed.total : 0;
        const remaining    = Math.max(0, 100 - totalClaimed);

        res.json({ claimedLast24h: totalClaimed, remaining, maxPerDay: 100, canClaim: remaining > 0 });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get faucet status' });
    }
});

// Claim test funds
router.post('/api/faucet/claim', requireAuth, (req, res) => {
    try {
        const { amount, currency } = req.body;
        const claimAmount = parseFloat(amount);

        if (!claimAmount || claimAmount <= 0 || claimAmount > 100) {
            return res.status(400).json({ error: 'Invalid amount (1-100)' });
        }

        const claimed = dbGet(`
            SELECT COALESCE(SUM(amount), 0) as total
            FROM transactions
            WHERE user_id = ? AND type = 'faucet' AND account_type = 'demo' AND created_at > ?
        `, [req.session.userId, getLocalTimeAgo(24)]);

        const totalClaimed = claimed ? claimed.total : 0;
        const remaining    = 100 - totalClaimed;

        if (claimAmount > remaining) {
            return res.status(400).json({
                error: `Limit exceeded. You can claim max $${remaining.toFixed(2)} more today.`
            });
        }

        dbRun(
            'INSERT INTO transactions (user_id, type, currency, amount, usd_value, status, account_type) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [req.session.userId, 'faucet', currency || 'USDT', claimAmount, claimAmount, 'completed', 'demo']
        );
        dbRun('UPDATE users SET demo_balance = demo_balance + ? WHERE id = ?', [claimAmount, req.session.userId]);
        dbRun(
            'INSERT INTO activity_log (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [req.session.userId, 'Faucet Claim', `Claimed $${claimAmount} ${currency || 'USDT'} (Demo)`, getClientIP(req)]
        );

        const user = dbGet('SELECT demo_balance FROM users WHERE id = ?', [req.session.userId]);

        res.json({
            success: true,
            claimed: claimAmount,
            currency: currency || 'USDT',
            newBalance: user.demo_balance,
            remainingToday: remaining - claimAmount
        });
    } catch (error) {
        console.error('Faucet error:', error);
        res.status(500).json({ error: 'Failed to claim funds' });
    }
});

module.exports = router;
