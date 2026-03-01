'use strict';
const express = require('express');
const axios   = require('axios');
const router  = express.Router();

const { dbGet, dbAll, dbRun, saveDatabase } = require('../db');
const { requireAuth }                        = require('../middleware/auth');
const { getClientIP }                        = require('../utils/ip');
const { getLocalTime }                       = require('../utils/time');
const { getMarketPrices }                    = require('../services/market');

async function getMarketPrice(symbol) {
    try {
        const response = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}USDT`);
        return parseFloat(response.data.price);
    } catch (error) {
        console.error('Error fetching price:', error.message);
        return null;
    }
}

// Helper: get holdings for a user
function getUserHoldings(userId, accountType) {
    return dbAll('SELECT * FROM holdings WHERE user_id = ? AND account_type = ?', [userId, accountType]);
}

// Create a new order
router.post('/api/orders', requireAuth, async (req, res) => {
    try {
        const { symbol, side, type, price, amount } = req.body;

        if (!symbol || !side || !type || !amount) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        if (!['buy', 'sell'].includes(side.toLowerCase())) {
            return res.status(400).json({ error: 'Invalid order side' });
        }
        if (!['market', 'limit'].includes(type.toLowerCase())) {
            return res.status(400).json({ error: 'Invalid order type' });
        }

        const user = dbGet('SELECT demo_balance, real_balance, active_account FROM users WHERE id = ?', [req.session.userId]);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const accountType     = user.active_account || 'demo';
        const currentBalance  = accountType === 'demo' ? user.demo_balance : user.real_balance;

        let executionPrice = price;
        if (type.toLowerCase() === 'market') {
            executionPrice = await getMarketPrice(symbol);
            if (!executionPrice) return res.status(400).json({ error: 'Could not fetch market price' });
        }

        const totalCost = executionPrice * amount;

        if (side.toLowerCase() === 'buy' && currentBalance < totalCost) {
            return res.status(400).json({ error: 'Insufficient balance', required: totalCost, available: currentBalance });
        }

        // Sell validation: check holdings
        if (side.toLowerCase() === 'sell') {
            const holding = dbGet(
                'SELECT amount FROM holdings WHERE user_id = ? AND currency = ? AND account_type = ?',
                [req.session.userId, symbol.toUpperCase(), accountType]
            );
            const heldAmount = holding ? holding.amount : 0;
            if (heldAmount < amount) {
                return res.status(400).json({
                    error: 'Insufficient holdings',
                    required: amount,
                    available: heldAmount,
                    currency: symbol.toUpperCase()
                });
            }
        }

        if (type.toLowerCase() === 'market') {
            const balanceField = accountType === 'demo' ? 'demo_balance' : 'real_balance';

            if (side.toLowerCase() === 'buy') {
                // Deduct USD
                dbRun(`UPDATE users SET ${balanceField} = ${balanceField} - ? WHERE id = ?`, [totalCost, req.session.userId]);

                // Upsert holdings: update avg_buy_price and amount
                const now = getLocalTime();
                dbRun(`
                    INSERT INTO holdings (user_id, currency, amount, avg_buy_price, account_type, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT(user_id, currency, account_type)
                    DO UPDATE SET
                        avg_buy_price = (holdings.avg_buy_price * holdings.amount + ? * ?) / (holdings.amount + ?),
                        amount = holdings.amount + ?,
                        updated_at = ?
                `, [
                    req.session.userId, symbol.toUpperCase(), amount, executionPrice, accountType, now,
                    executionPrice, amount, amount,
                    amount, now
                ]);
            } else {
                // Sell: credit USD
                dbRun(`UPDATE users SET ${balanceField} = ${balanceField} + ? WHERE id = ?`, [totalCost, req.session.userId]);

                // Deduct from holdings
                const now = getLocalTime();
                dbRun(
                    'UPDATE holdings SET amount = amount - ?, updated_at = ? WHERE user_id = ? AND currency = ? AND account_type = ?',
                    [amount, now, req.session.userId, symbol.toUpperCase(), accountType]
                );

                // Clean up zero holdings
                dbRun(
                    'DELETE FROM holdings WHERE user_id = ? AND currency = ? AND account_type = ? AND amount <= 0.00000001',
                    [req.session.userId, symbol.toUpperCase(), accountType]
                );
            }

            const result = dbRun(
                'INSERT INTO orders (user_id, symbol, side, type, price, amount, filled, status, account_type, filled_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [req.session.userId, symbol.toUpperCase(), side.toLowerCase(), type.toLowerCase(), executionPrice, amount, amount, 'filled', accountType, getLocalTime()]
            );

            dbRun(
                'INSERT INTO transactions (user_id, type, currency, amount, usd_value, status, account_type) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [req.session.userId, side.toLowerCase(), symbol.toUpperCase(), amount, totalCost, 'completed', accountType]
            );

            dbRun(
                'INSERT INTO activity_log (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
                [req.session.userId, `${side.toUpperCase()} Order`, `${side} ${amount} ${symbol} at $${executionPrice.toFixed(2)}`, getClientIP(req)]
            );

            const updatedUser = dbGet('SELECT demo_balance, real_balance FROM users WHERE id = ?', [req.session.userId]);
            const newBalance  = accountType === 'demo' ? updatedUser.demo_balance : updatedUser.real_balance;

            // Get updated holdings for response
            const holdings = getUserHoldings(req.session.userId, accountType);

            saveDatabase();

            // Emit socket events if available
            try {
                const { getIo } = require('../socket');
                const io = getIo();
                if (io) {
                    const room = `user_${req.session.userId}`;
                    io.to(room).emit('orderFilled', {
                        id: result.lastInsertRowid,
                        symbol: symbol.toUpperCase(),
                        side: side.toLowerCase(),
                        price: executionPrice,
                        amount,
                        total: totalCost
                    });
                    io.to(room).emit('holdingsUpdate', { holdings });
                    io.to(room).emit('balanceUpdate', { balance: newBalance });
                }
            } catch (e) { /* socket not available */ }

            return res.json({
                success: true,
                order: {
                    id: result.lastInsertRowid,
                    symbol: symbol.toUpperCase(),
                    side: side.toLowerCase(),
                    type: type.toLowerCase(),
                    price: executionPrice,
                    amount,
                    filled: amount,
                    status: 'filled',
                    total: totalCost
                },
                newBalance,
                holdings
            });
        }

        // Limit order
        const result = dbRun(
            'INSERT INTO orders (user_id, symbol, side, type, price, amount, status, account_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [req.session.userId, symbol.toUpperCase(), side.toLowerCase(), type.toLowerCase(), price, amount, 'open', accountType]
        );

        saveDatabase();

        res.json({
            success: true,
            order: {
                id: result.lastInsertRowid,
                symbol: symbol.toUpperCase(),
                side: side.toLowerCase(),
                type: type.toLowerCase(),
                price,
                amount,
                filled: 0,
                status: 'open'
            }
        });
    } catch (error) {
        console.error('Create order error:', error);
        res.status(500).json({ error: 'Failed to create order' });
    }
});

// Get user's orders
router.get('/api/orders', requireAuth, (req, res) => {
    try {
        const { status, limit = 50 } = req.query;
        const user = dbGet('SELECT active_account FROM users WHERE id = ?', [req.session.userId]);
        const accountType = user?.active_account || 'demo';

        let query  = 'SELECT * FROM orders WHERE user_id = ? AND account_type = ?';
        const params = [req.session.userId, accountType];

        if (status) {
            query += ' AND status = ?';
            params.push(status);
        }
        query += ' ORDER BY created_at DESC LIMIT ?';
        params.push(parseInt(limit));

        res.json({ orders: dbAll(query, params) });
    } catch (error) {
        console.error('Get orders error:', error);
        res.status(500).json({ error: 'Failed to get orders' });
    }
});

// Get order history
router.get('/api/orders/history', requireAuth, (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);
        const user = dbGet('SELECT active_account FROM users WHERE id = ?', [req.session.userId]);
        const accountType = user?.active_account || 'demo';

        const orders = dbAll(
            'SELECT * FROM orders WHERE user_id = ? AND account_type = ? AND status IN (?, ?) ORDER BY created_at DESC LIMIT ? OFFSET ?',
            [req.session.userId, accountType, 'filled', 'cancelled', parseInt(limit), offset]
        );
        const totalResult = dbGet(
            'SELECT COUNT(*) as count FROM orders WHERE user_id = ? AND account_type = ? AND status IN (?, ?)',
            [req.session.userId, accountType, 'filled', 'cancelled']
        );

        res.json({
            orders,
            total: totalResult.count,
            page: parseInt(page),
            totalPages: Math.ceil(totalResult.count / parseInt(limit))
        });
    } catch (error) {
        console.error('Get order history error:', error);
        res.status(500).json({ error: 'Failed to get order history' });
    }
});

// Cancel an order
router.delete('/api/orders/:id', requireAuth, (req, res) => {
    try {
        const order = dbGet('SELECT * FROM orders WHERE id = ? AND user_id = ?', [req.params.id, req.session.userId]);
        if (!order) return res.status(404).json({ error: 'Order not found' });
        if (order.status !== 'open') return res.status(400).json({ error: 'Can only cancel open orders' });

        dbRun('UPDATE orders SET status = ? WHERE id = ?', ['cancelled', req.params.id]);
        saveDatabase();
        res.json({ success: true, message: 'Order cancelled' });
    } catch (error) {
        console.error('Cancel order error:', error);
        res.status(500).json({ error: 'Failed to cancel order' });
    }
});

// ==================== HOLDINGS ENDPOINTS ====================

// Get all holdings for current user
router.get('/api/holdings', requireAuth, async (req, res) => {
    try {
        const user = dbGet('SELECT active_account FROM users WHERE id = ?', [req.session.userId]);
        const accountType = user?.active_account || 'demo';
        const holdings = dbAll(
            'SELECT * FROM holdings WHERE user_id = ? AND account_type = ?',
            [req.session.userId, accountType]
        );

        const prices = await getMarketPrices();
        let totalValue = 0;

        const enriched = holdings.map(h => {
            const currentPrice = prices[h.currency]?.price || 0;
            const usdValue = h.amount * currentPrice;
            const costBasis = h.amount * h.avg_buy_price;
            const pnl = usdValue - costBasis;
            const pnlPercent = costBasis > 0 ? (pnl / costBasis) * 100 : 0;
            totalValue += usdValue;

            return {
                currency: h.currency,
                amount: h.amount,
                avgBuyPrice: h.avg_buy_price,
                currentPrice,
                usdValue,
                pnl,
                pnlPercent
            };
        });

        res.json({ holdings: enriched, totalValue });
    } catch (error) {
        console.error('Get holdings error:', error);
        res.status(500).json({ error: 'Failed to get holdings' });
    }
});

// Get single holding for a specific currency
router.get('/api/holdings/:currency', requireAuth, (req, res) => {
    try {
        const user = dbGet('SELECT active_account FROM users WHERE id = ?', [req.session.userId]);
        const accountType = user?.active_account || 'demo';
        const holding = dbGet(
            'SELECT * FROM holdings WHERE user_id = ? AND currency = ? AND account_type = ?',
            [req.session.userId, req.params.currency.toUpperCase(), accountType]
        );

        if (!holding) {
            return res.json({ currency: req.params.currency.toUpperCase(), amount: 0, avgBuyPrice: 0 });
        }

        res.json({
            currency: holding.currency,
            amount: holding.amount,
            avgBuyPrice: holding.avg_buy_price
        });
    } catch (error) {
        console.error('Get holding error:', error);
        res.status(500).json({ error: 'Failed to get holding' });
    }
});

module.exports = router;
