'use strict';
const express = require('express');
const router  = express.Router();

const { dbGet, dbRun, dbAll }                              = require('../db');
const { getMarketPrices }                                  = require('../services/market');
const { getBlockchainBalance, validateWalletAddress,
        WALLET_CACHE_TTL }                                 = require('../services/blockchain');
const { getLocalTime }                                     = require('../utils/time');
const { getClientIP }                                      = require('../utils/ip');
const { requireAuth }                                      = require('../middleware/auth');

// ==================== PORTFOLIO ROUTES ====================

router.get('/api/portfolio', requireAuth, async (req, res) => {
    try {
        const user         = dbGet('SELECT real_balance FROM users WHERE id = ?', [req.session.userId]);
        const accountType  = 'real';
        const wallets      = dbAll('SELECT * FROM wallets WHERE user_id = ?', [req.session.userId]);
        const holdingsRows = dbAll('SELECT * FROM holdings WHERE user_id = ?', [req.session.userId]);
        const transactions = dbAll('SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 20', [req.session.userId]);
        const prices       = await getMarketPrices();

        const balance = user.real_balance || 0;
        let totalValue = balance;

        // Trading holdings (from buy/sell orders)
        const holdings = holdingsRows.map(h => {
            const currentPrice = prices[h.currency]?.price || 0;
            const value = h.amount * currentPrice;
            const costBasis = h.amount * h.avg_buy_price;
            const pnl = value - costBasis;
            const pnlPercent = costBasis > 0 ? (pnl / costBasis) * 100 : 0;
            totalValue += value;
            return {
                currency: h.currency,
                amount: h.amount,
                avgBuyPrice: h.avg_buy_price,
                currentPrice,
                value,
                pnl,
                pnlPercent,
                source: 'trading'
            };
        });

        // External wallets
        const externalHoldings = wallets.map(wallet => {
            const currentPrice = prices[wallet.currency]?.price || 0;
            const value = wallet.balance * currentPrice;
            totalValue += value;
            return {
                ...wallet,
                currentPrice,
                value,
                source: 'external'
            };
        });

        const allHoldings = [...holdings, ...externalHoldings];

        res.json({
            balance,
            demoBalance: balance,
            realBalance: balance,
            activeAccount: 'real',
            totalValue,
            holdings: allHoldings,
            transactions,
            allocation: allHoldings.filter(h => h.value > 0).map(h => ({
                currency: h.currency,
                percentage: totalValue > 0 ? (h.value / totalValue * 100).toFixed(2) : 0
            }))
        });
    } catch (error) {
        console.error('Portfolio error:', error);
        res.status(500).json({ error: 'Failed to fetch portfolio' });
    }
});

router.get('/api/portfolio/performance', requireAuth, async (req, res) => {
    try {
        const userId      = req.session.userId;
        const user        = dbGet('SELECT real_balance FROM users WHERE id = ?', [userId]);
        const accountType = 'real';
        const snapshots   = dbAll('SELECT month, total_value, profit_loss FROM portfolio_snapshots WHERE user_id = ? ORDER BY month DESC LIMIT 6', [userId]);

        // Calculate current total from real holdings
        const holdingsRows = dbAll('SELECT * FROM holdings WHERE user_id = ? AND account_type = ?', [userId, accountType]);
        const prices = await getMarketPrices();

        let currentTotal = user.real_balance || 0;
        holdingsRows.forEach(h => {
            currentTotal += h.amount * (prices[h.currency]?.price || 0);
        });

        const initialDeposit = 0;

        if (snapshots.length === 0) {
            // Build performance from order history instead of random data
            const months = [];
            const now = new Date();

            // Get the oldest order to know when trading started
            const oldestOrder = dbGet(
                'SELECT created_at FROM orders WHERE user_id = ? AND account_type = ? AND status = ? ORDER BY created_at ASC LIMIT 1',
                [userId, accountType, 'filled']
            );

            for (let i = 5; i >= 0; i--) {
                const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                const monthStr = d.toISOString().slice(0, 7);
                const monthName = d.toLocaleString('en-US', { month: 'short' }).toUpperCase();

                if (i === 0) {
                    // Current month — use real data
                    months.push({
                        month: monthStr,
                        monthName,
                        totalValue: currentTotal,
                        profitLoss: currentTotal - initialDeposit
                    });
                } else if (oldestOrder) {
                    // Calculate value at end of that month from order history
                    const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString();
                    const ordersUpToMonth = dbAll(
                        'SELECT side, amount, price, symbol FROM orders WHERE user_id = ? AND account_type = ? AND status = ? AND filled_at <= ?',
                        [userId, accountType, 'filled', monthEnd]
                    );

                    // Approximate: start with initial deposit, apply all trades
                    let balance = initialDeposit;
                    ordersUpToMonth.forEach(o => {
                        const total = o.price * o.amount;
                        if (o.side === 'buy') balance -= total;
                        else balance += total;
                    });

                    // For past months, we don't have historical prices, so use balance as approximation
                    months.push({
                        month: monthStr,
                        monthName,
                        totalValue: Math.max(0, balance),
                        profitLoss: balance - initialDeposit
                    });
                } else {
                    // No orders yet — flat at initial deposit
                    months.push({
                        month: monthStr,
                        monthName,
                        totalValue: initialDeposit,
                        profitLoss: 0
                    });
                }
            }

            return res.json({ performance: months, currentValue: currentTotal });
        }

        const performance = snapshots.reverse().map(s => {
            const d = new Date(s.month + '-01');
            return {
                month: s.month,
                monthName: d.toLocaleString('en-US', { month: 'short' }).toUpperCase(),
                totalValue: s.total_value,
                profitLoss: s.profit_loss
            };
        });

        res.json({ performance, currentValue: performance[performance.length - 1]?.totalValue || 0 });
    } catch (error) {
        console.error('Portfolio performance error:', error);
        res.status(500).json({ error: 'Failed to fetch performance data' });
    }
});

router.get('/api/portfolio/allocation', requireAuth, async (req, res) => {
    try {
        const userId      = req.session.userId;
        const user        = dbGet('SELECT real_balance FROM users WHERE id = ?', [userId]);
        const accountType = 'real';
        const wallets     = dbAll('SELECT * FROM wallets WHERE user_id = ?', [userId]);
        const holdingsRows = dbAll('SELECT * FROM holdings WHERE user_id = ? AND account_type = ?', [userId, accountType]);
        const prices      = await getMarketPrices();

        const accountBalance = user.real_balance || 0;
        let totalValue = accountBalance;
        const currencyTotals = {};

        // Include trading holdings
        holdingsRows.forEach(h => {
            const value = h.amount * (prices[h.currency]?.price || 0);
            totalValue += value;
            currencyTotals[h.currency] = (currencyTotals[h.currency] || 0) + value;
        });

        // Include external wallets
        wallets.forEach(wallet => {
            const value = wallet.balance * (prices[wallet.currency]?.price || 0);
            totalValue += value;
            currencyTotals[wallet.currency] = (currencyTotals[wallet.currency] || 0) + value;
        });

        if (accountBalance > 0) {
            currencyTotals['USDT'] = (currencyTotals['USDT'] || 0) + accountBalance;
        }

        const colors = { 'BTC': '#FF3B30', 'ETH': '#627EEA', 'SOL': '#10B981', 'USDT': '#26A17B', 'ADA': '#0033AD', 'DOT': '#E6007A', 'DOGE': '#C2A633', 'XRP': '#23292F' };

        const allocations = [];
        Object.entries(currencyTotals).forEach(([currency, value]) => {
            if (value > 0) {
                allocations.push({
                    currency, value,
                    percentage: totalValue > 0 ? ((value / totalValue) * 100).toFixed(1) : 0,
                    color: colors[currency] || '#8CA8FF'
                });
            }
        });

        allocations.sort((a, b) => b.value - a.value);
        res.json({ allocations, totalValue, assetCount: allocations.length });
    } catch (error) {
        console.error('Portfolio allocation error:', error);
        res.status(500).json({ error: 'Failed to fetch allocation data' });
    }
});

// ==================== WALLETS ====================

router.get('/api/wallets', requireAuth, async (req, res) => {
    try {
        const wallets = dbAll('SELECT * FROM wallets WHERE user_id = ?', [req.session.userId]);
        const prices  = await getMarketPrices();

        const walletsWithBalances = await Promise.all(wallets.map(async (wallet) => {
            const now         = Date.now();
            const lastUpdated = wallet.last_updated ? new Date(wallet.last_updated).getTime() : 0;
            const needsUpdate = (now - lastUpdated) > WALLET_CACHE_TTL;
            let balance = wallet.balance;

            if (needsUpdate) {
                try {
                    balance = await getBlockchainBalance(wallet.address, wallet.currency);
                    const price    = prices[wallet.currency]?.price || 0;
                    const usdValue = balance * price;
                    dbRun('UPDATE wallets SET balance = ?, usd_value = ?, last_updated = ? WHERE id = ?',
                        [balance, usdValue, getLocalTime(), wallet.id]);
                } catch (e) {
                    console.error('Balance fetch error for wallet', wallet.id, e.message);
                }
            }

            const price    = prices[wallet.currency]?.price || 0;
            const usdValue = balance * price;
            const change24h = prices[wallet.currency]?.change24h || 0;

            return { ...wallet, balance, usdValue, price, change24h };
        }));

        res.json(walletsWithBalances);
    } catch (error) {
        console.error('Get wallets error:', error);
        res.status(500).json({ error: 'Failed to fetch wallets' });
    }
});

router.post('/api/wallets', requireAuth, async (req, res) => {
    try {
        const { name, address, currency } = req.body;

        if (!name || !address || !currency) {
            return res.status(400).json({ error: 'Name, address, and currency are required' });
        }

        const curr = currency.toUpperCase();

        if (!validateWalletAddress(address, curr)) {
            return res.status(400).json({ error: `Invalid ${curr} wallet address format` });
        }

        const existing = dbGet('SELECT id FROM wallets WHERE user_id = ? AND address = ?', [req.session.userId, address]);
        if (existing) return res.status(400).json({ error: 'This wallet address is already added' });

        let balance = 0;
        let usdValue = 0;
        try {
            balance = await getBlockchainBalance(address, curr);
            const prices = await getMarketPrices();
            usdValue = balance * (prices[curr]?.price || 0);
        } catch (e) {
            console.error('Initial balance fetch error:', e.message);
        }

        const result = dbRun(
            'INSERT INTO wallets (user_id, name, address, currency, balance, usd_value, last_updated) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [req.session.userId, name, address, curr, balance, usdValue, getLocalTime()]
        );

        dbRun('INSERT INTO activity_log (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [req.session.userId, 'Wallet Added', `Added ${curr} wallet: ${name}`, getClientIP(req)]);

        res.json({ success: true, walletId: result.lastInsertRowid, balance, usdValue });
    } catch (error) {
        console.error('Add wallet error:', error);
        res.status(500).json({ error: 'Failed to add wallet' });
    }
});

router.delete('/api/wallets/:id', requireAuth, (req, res) => {
    try {
        const wallet = dbGet('SELECT * FROM wallets WHERE id = ? AND user_id = ?', [req.params.id, req.session.userId]);
        if (!wallet) return res.status(404).json({ error: 'Wallet not found' });

        dbRun('DELETE FROM wallets WHERE id = ?', [req.params.id]);
        dbRun('INSERT INTO activity_log (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [req.session.userId, 'Wallet Removed', `Removed ${wallet.currency} wallet: ${wallet.name}`, getClientIP(req)]);

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete wallet' });
    }
});

router.post('/api/wallets/:id/refresh', requireAuth, async (req, res) => {
    try {
        const wallet = dbGet('SELECT * FROM wallets WHERE id = ? AND user_id = ?', [req.params.id, req.session.userId]);
        if (!wallet) return res.status(404).json({ error: 'Wallet not found' });

        const balance  = await getBlockchainBalance(wallet.address, wallet.currency);
        const prices   = await getMarketPrices();
        const price    = prices[wallet.currency]?.price || 0;
        const usdValue = balance * price;

        dbRun('UPDATE wallets SET balance = ?, usd_value = ?, last_updated = ? WHERE id = ?',
            [balance, usdValue, getLocalTime(), req.params.id]);

        res.json({ success: true, balance, usdValue, price });
    } catch (error) {
        console.error('Refresh wallet error:', error);
        res.status(500).json({ error: 'Failed to refresh wallet' });
    }
});

// ==================== TRANSACTIONS ROUTES ====================

router.get('/api/transactions', requireAuth, (req, res) => {
    const limit  = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;

    const transactions = dbAll(
        'SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
        [req.session.userId, limit, offset]
    );

    res.json(transactions);
});

module.exports = router;
