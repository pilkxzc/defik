'use strict';
const express = require('express');
const axios   = require('axios');
const router  = express.Router();

const { dbGet, dbAll, dbRun, dbTransaction, saveDatabase } = require('../db');
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

        if (!symbol || !side || !type || amount === undefined || amount === null) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Input validation
        const parsedAmount = parseFloat(amount);
        if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
            return res.status(400).json({ error: 'Amount must be a positive number' });
        }
        if (typeof symbol !== 'string' || symbol.trim().length === 0 || symbol.trim().length > 20) {
            return res.status(400).json({ error: 'Invalid symbol' });
        }
        if (!['buy', 'sell'].includes(side.toLowerCase())) {
            return res.status(400).json({ error: 'Invalid order side' });
        }
        if (!['market', 'limit'].includes(type.toLowerCase())) {
            return res.status(400).json({ error: 'Invalid order type' });
        }
        if (type.toLowerCase() === 'limit' && (!price || !Number.isFinite(parseFloat(price)) || parseFloat(price) <= 0)) {
            return res.status(400).json({ error: 'Limit orders require a valid positive price' });
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

        const totalCost = executionPrice * parsedAmount;

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
            if (heldAmount < parsedAmount) {
                return res.status(400).json({
                    error: 'Insufficient holdings',
                    required: parsedAmount,
                    available: heldAmount,
                    currency: symbol.toUpperCase()
                });
            }
        }

        if (type.toLowerCase() === 'market') {
            const balanceField = accountType === 'demo' ? 'demo_balance' : 'real_balance';
            const now = getLocalTime();
            const symbolUpper = symbol.toUpperCase();
            const sideLower = side.toLowerCase();
            const typeLower = type.toLowerCase();

            // Build transaction operations atomically to prevent double-spend
            const operations = [];

            if (sideLower === 'buy') {
                // Deduct USD
                operations.push({
                    sql: `UPDATE users SET ${balanceField} = ${balanceField} - ? WHERE id = ? AND ${balanceField} >= ?`,
                    params: [totalCost, req.session.userId, totalCost]
                });
                // Upsert holdings: update avg_buy_price and amount
                operations.push({
                    sql: `INSERT INTO holdings (user_id, currency, amount, avg_buy_price, account_type, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT(user_id, currency, account_type)
                    DO UPDATE SET
                        avg_buy_price = (holdings.avg_buy_price * holdings.amount + ? * ?) / (holdings.amount + ?),
                        amount = holdings.amount + ?,
                        updated_at = ?`,
                    params: [
                        req.session.userId, symbolUpper, parsedAmount, executionPrice, accountType, now,
                        executionPrice, parsedAmount, parsedAmount,
                        parsedAmount, now
                    ]
                });
            } else {
                // Sell: credit USD
                operations.push({
                    sql: `UPDATE users SET ${balanceField} = ${balanceField} + ? WHERE id = ?`,
                    params: [totalCost, req.session.userId]
                });
                // Deduct from holdings
                operations.push({
                    sql: 'UPDATE holdings SET amount = amount - ?, updated_at = ? WHERE user_id = ? AND currency = ? AND account_type = ? AND amount >= ?',
                    params: [parsedAmount, now, req.session.userId, symbolUpper, accountType, parsedAmount]
                });
                // Clean up zero holdings
                operations.push({
                    sql: 'DELETE FROM holdings WHERE user_id = ? AND currency = ? AND account_type = ? AND amount <= 0.00000001',
                    params: [req.session.userId, symbolUpper, accountType]
                });
            }

            // Insert order record
            operations.push({
                sql: 'INSERT INTO orders (user_id, symbol, side, type, price, amount, filled, status, account_type, filled_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                params: [req.session.userId, symbolUpper, sideLower, typeLower, executionPrice, parsedAmount, parsedAmount, 'filled', accountType, now]
            });

            // Insert transaction record
            operations.push({
                sql: 'INSERT INTO transactions (user_id, type, currency, amount, usd_value, status, account_type) VALUES (?, ?, ?, ?, ?, ?, ?)',
                params: [req.session.userId, sideLower, symbolUpper, parsedAmount, totalCost, 'completed', accountType]
            });

            // Insert activity log
            operations.push({
                sql: 'INSERT INTO activity_log (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
                params: [req.session.userId, `${side.toUpperCase()} Order`, `${side} ${parsedAmount} ${symbol} at $${executionPrice.toFixed(2)}`, getClientIP(req)]
            });

            // Execute all operations atomically
            let txResults;
            try {
                txResults = dbTransaction(operations);
            } catch (txError) {
                console.error('Order transaction failed:', txError.message);
                return res.status(500).json({ error: 'Order execution failed, no changes were made' });
            }

            // The order INSERT is at index: buy=2, sell=3 (after balance + holdings ops)
            const orderResultIndex = sideLower === 'buy' ? 2 : 3;
            const orderInsertId = txResults[orderResultIndex]?.lastInsertRowid;

            const updatedUser = dbGet('SELECT demo_balance, real_balance FROM users WHERE id = ?', [req.session.userId]);
            const newBalance  = accountType === 'demo' ? updatedUser.demo_balance : updatedUser.real_balance;

            // Get updated holdings for response
            const holdings = getUserHoldings(req.session.userId, accountType);

            // Emit socket events only after successful transaction
            try {
                const { getIo } = require('../socket');
                const io = getIo();
                if (io) {
                    const room = `user_${req.session.userId}`;
                    io.to(room).emit('orderFilled', {
                        id: orderInsertId,
                        symbol: symbolUpper,
                        side: sideLower,
                        price: executionPrice,
                        amount: parsedAmount,
                        total: totalCost
                    });
                    io.to(room).emit('holdingsUpdate', { holdings });
                    io.to(room).emit('balanceUpdate', { balance: newBalance });
                }
            } catch (e) { /* socket not available */ }

            return res.json({
                success: true,
                order: {
                    id: orderInsertId,
                    symbol: symbolUpper,
                    side: sideLower,
                    type: typeLower,
                    price: executionPrice,
                    amount: parsedAmount,
                    filled: parsedAmount,
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
            [req.session.userId, symbol.toUpperCase(), side.toLowerCase(), type.toLowerCase(), parseFloat(price), parsedAmount, 'open', accountType]
        );

        saveDatabase();

        res.json({
            success: true,
            order: {
                id: result.lastInsertRowid,
                symbol: symbol.toUpperCase(),
                side: side.toLowerCase(),
                type: type.toLowerCase(),
                price: parseFloat(price),
                amount: parsedAmount,
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
