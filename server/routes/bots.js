'use strict';
const express = require('express');
const axios   = require('axios');
const crypto  = require('crypto');
const router  = express.Router();

const { dbGet, dbAll, dbRun, dbTransaction, saveDatabase } = require('../db');
const { requireAuth, requireRole }          = require('../middleware/auth');
const { getClientIP }                       = require('../utils/ip');
const { sendUserNotification, getIo }       = require('../socket');
const { createNotification }                = require('../services/notifications');

// Rate-limit repetitive Binance API error logs (once per 60 s per error code)
const _binanceErrLog = {};
function logBinanceError(label, err) {
    const key  = label + ':' + (err?.code || err?.response?.data?.code || '?');
    const now  = Date.now();
    if (!_binanceErrLog[key] || now - _binanceErrLog[key] > 60_000) {
        _binanceErrLog[key] = now;
        console.error(label, err?.response?.data || err?.message || err);
    }
}

// ── Multi-account helpers ────────────────────────────────────────────────────

function getMultiCredentials(bot) {
    try {
        const ts = JSON.parse(bot.trading_settings || '{}');
        if (ts.multi_credentials && Array.isArray(ts.multi_credentials) && ts.multi_credentials.length > 0) {
            return ts.multi_credentials;
        }
    } catch (e) {}
    return null;
}

/** Returns array of {apiKey, apiSecret} for a bot — works for both single and multi-account */
function getBotCredentialPairs(bot) {
    const multi = getMultiCredentials(bot);
    if (multi) return multi.map(c => ({ apiKey: c.tk, apiSecret: c.tk_secret }));
    if (bot.binance_api_key && bot.binance_api_secret) return [{ apiKey: bot.binance_api_key, apiSecret: bot.binance_api_secret }];
    return [];
}

/** Check if bot has ANY credentials configured (single or multi) */
function botHasCredentials(bot) {
    return getBotCredentialPairs(bot).length > 0;
}

/** Make a signed Binance Futures request with given credentials */
async function makeBinanceSignedReq(apiKey, apiSecret, endpoint, params = {}) {
    if (_binanceBanUntil > Date.now()) {
        throw new Error('Binance IP temporarily banned, retrying later');
    }
    const baseUrl   = 'https://fapi.binance.com';
    const timestamp = await getBinanceServerTime('futures');
    const qs        = new URLSearchParams({ ...params, timestamp }).toString();
    const signature = crypto.createHmac('sha256', apiSecret).update(qs).digest('hex');
    try {
        const r = await axios.get(`${baseUrl}${endpoint}?${qs}&signature=${signature}`, {
            headers: { 'X-MBX-APIKEY': apiKey }, timeout: 10000
        });
        return r.data;
    } catch (error) {
        const status = error.response?.status;
        if (status === 418 || status === 429) {
            const banMsg = error.response?.data?.msg || '';
            const banMatch = banMsg.match(/until\s+(\d+)/);
            _binanceBanUntil = banMatch ? parseInt(banMatch[1]) : Date.now() + 120_000;
        }
        throw error;
    }
}

/** Run a signed request across ALL bot credentials in parallel, return merged array of results */
async function forEachBotCred(bot, fn) {
    const creds = getBotCredentialPairs(bot);
    if (creds.length === 0) return [];
    const results = await Promise.allSettled(creds.map(c => fn(c.apiKey, c.apiSecret)));
    return results.filter(r => r.status === 'fulfilled').map(r => r.value);
}

/**
 * Fetch futures data from multiple Binance accounts in parallel and merge
 * into a single virtual account view.
 */
async function fetchMultiAccountFuturesData(credentials) {
    const results = await Promise.allSettled(
        credentials.map(c => fetchBinanceFuturesData(c.tk, c.tk_secret))
    );

    const merged = {
        account: { totalWalletBalance: 0, totalUnrealizedProfit: 0, totalMarginBalance: 0, availableBalance: 0 },
        positions: [],
        openOrders: [],
        limitOrders: [],
        stopOrders: [],
        takeProfitOrders: [],
        recentTrades: [],
        incomeHistory: []
    };

    let successCount = 0;
    for (const r of results) {
        if (r.status !== 'fulfilled') continue;
        const d = r.value;
        successCount++;
        merged.account.totalWalletBalance    += d.account.totalWalletBalance;
        merged.account.totalUnrealizedProfit += d.account.totalUnrealizedProfit;
        merged.account.totalMarginBalance    += d.account.totalMarginBalance;
        merged.account.availableBalance      += d.account.availableBalance;
        merged.positions.push(...(d.positions || []));
        merged.openOrders.push(...(d.openOrders || []));
        merged.limitOrders.push(...(d.limitOrders || []));
        merged.stopOrders.push(...(d.stopOrders || []));
        merged.takeProfitOrders.push(...(d.takeProfitOrders || []));
        merged.recentTrades.push(...(d.recentTrades || []));
        merged.incomeHistory.push(...(d.incomeHistory || []));
    }

    if (successCount === 0) throw new Error('All Binance accounts failed to respond');

    // Sort by time descending
    merged.recentTrades.sort((a, b) => b.time - a.time);
    merged.incomeHistory.sort((a, b) => b.time - a.time);
    merged.limitOrders.sort((a, b) => b.time - a.time);
    merged.openOrders.sort((a, b) => b.time - a.time);

    // Trim
    merged.recentTrades  = merged.recentTrades.slice(0, 50);
    merged.incomeHistory = merged.incomeHistory.slice(0, 100);

    return merged;
}

// ── In-memory cache to prevent Binance rate-limit (429/418) ─────────────────
const _serverTimeCache       = { value: null, ts: 0 };       // TTL 30s
const _rawBinanceCache       = {};                            // keyed by apiKey — raw Binance responses
const _rawBinanceInFlight    = {};                            // dedup concurrent raw fetches
const _allOrdersCache        = {};                            // keyed by `${apiKey}:${symbol}`
const _allOrdersInFlight     = {};                            // dedup concurrent allOrders fetches
let _binanceBanUntil = 0;                                     // IP ban expiry timestamp (ms)
const RAW_CACHE_TTL          = 30_000;                        // 30 seconds
const ALL_ORDERS_CACHE_TTL   = 60_000;                        // 60 seconds

// ── Binance helpers ───────────────────────────────────────────────────────────

async function getBinanceServerTime(accountType = 'futures') {
    const now = Date.now();

    // If IP is banned, don't even try — use local time
    if (_binanceBanUntil > now) {
        return now;
    }

    // Cache server time for 30 seconds — avoids hammering /time endpoint
    if (_serverTimeCache.value && (now - _serverTimeCache.ts) < 30_000) {
        return _serverTimeCache.value + (now - _serverTimeCache.ts);
    }
    try {
        const base     = accountType === 'futures' ? 'https://fapi.binance.com' : 'https://api.binance.com';
        const endpoint = accountType === 'futures' ? '/fapi/v1/time' : '/api/v3/time';
        const response = await axios.get(`${base}${endpoint}`, { timeout: 5000 });
        _serverTimeCache.value = response.data.serverTime;
        _serverTimeCache.ts    = now;
        return response.data.serverTime;
    } catch (error) {
        // Detect IP ban (418) or rate limit (429)
        const status = error.response?.status;
        if (status === 418 || status === 429) {
            const banMsg = error.response?.data?.msg || '';
            const banMatch = banMsg.match(/until\s+(\d+)/);
            _binanceBanUntil = banMatch ? parseInt(banMatch[1]) : now + 120_000;
            console.error(`Binance IP banned until ${new Date(_binanceBanUntil).toISOString()}`);
        } else {
            console.error('Failed to get Binance server time:', error.message);
        }
        return now;
    }
}

async function testBinanceCredentials(apiKey, apiSecret, accountType = 'futures') {
    try {
        const base      = accountType === 'futures' ? 'https://fapi.binance.com' : 'https://api.binance.com';
        const timestamp = await getBinanceServerTime(accountType);
        const qs        = `timestamp=${timestamp}`;
        const signature = crypto.createHmac('sha256', apiSecret).update(qs).digest('hex');
        const endpoint  = accountType === 'futures' ? '/fapi/v2/account' : '/api/v3/account';
        const response  = await axios.get(`${base}${endpoint}?${qs}&signature=${signature}`, {
            headers: { 'X-MBX-APIKEY': apiKey }
        });
        return { success: true, data: response.data };
    } catch (error) {
        console.error('Binance test error:', error.response?.data || error.message);
        return { success: false, error: error.response?.data?.msg || error.message };
    }
}

/**
 * Centralized raw Binance data fetcher — cached 30s, deduplicated.
 * Returns raw API responses: { account, openOrders, userTrades, income }
 * ALL endpoints should use this instead of making direct Binance API calls.
 */
async function fetchRawBinanceData(apiKey, apiSecret) {
    const now = Date.now();
    if (_rawBinanceCache[apiKey] && (now - _rawBinanceCache[apiKey].ts) < RAW_CACHE_TTL) {
        return _rawBinanceCache[apiKey].data;
    }
    if (_rawBinanceInFlight[apiKey]) return _rawBinanceInFlight[apiKey];

    const promise = _doFetchRawBinanceData(apiKey, apiSecret)
        .then(data => {
            _rawBinanceCache[apiKey] = { data, ts: Date.now() };
            delete _rawBinanceInFlight[apiKey];
            return data;
        })
        .catch(err => {
            delete _rawBinanceInFlight[apiKey];
            throw err;
        });

    _rawBinanceInFlight[apiKey] = promise;
    return promise;
}

async function _doFetchRawBinanceData(apiKey, apiSecret) {
    if (_binanceBanUntil > Date.now()) throw new Error('Binance IP temporarily banned');
    try {
        const baseUrl   = 'https://fapi.binance.com';
        const timestamp = await getBinanceServerTime('futures');
        const sign      = (qs) => crypto.createHmac('sha256', apiSecret).update(qs).digest('hex');
        const makeReq   = async (endpoint, params = {}) => {
            const qs = new URLSearchParams({ ...params, timestamp }).toString();
            const r  = await axios.get(`${baseUrl}${endpoint}?${qs}&signature=${sign(qs)}`, {
                headers: { 'X-MBX-APIKEY': apiKey }, timeout: 10000
            });
            return r.data;
        };

        const account    = await makeReq('/fapi/v2/account');
        const openOrders = await makeReq('/fapi/v1/openOrders');
        let userTrades = [], income = [];
        try { userTrades = await makeReq('/fapi/v1/userTrades', { limit: 50 }); } catch (e) {}
        try { income     = await makeReq('/fapi/v1/income',     { limit: 100 }); } catch (e) {}

        return { account, openOrders, userTrades, income };
    } catch (error) {
        const status = error.response?.status;
        if (status === 418 || status === 429) {
            const banMsg = error.response?.data?.msg || '';
            const banMatch = banMsg.match(/until\s+(\d+)/);
            _binanceBanUntil = banMatch ? parseInt(banMatch[1]) : Date.now() + 120_000;
        }
        logBinanceError('Raw Binance data fetch error:', error);
        throw new Error(error.response?.data?.msg || 'Failed to fetch Binance data');
    }
}

/**
 * Fetch allOrders for a specific symbol — cached 60s, deduplicated.
 * Only used by /chart-data endpoint.
 */
async function fetchCachedAllOrders(apiKey, apiSecret, symbol) {
    const cacheKey = `${apiKey}:${symbol}`;
    const now = Date.now();
    if (_allOrdersCache[cacheKey] && (now - _allOrdersCache[cacheKey].ts) < ALL_ORDERS_CACHE_TTL) {
        return _allOrdersCache[cacheKey].data;
    }
    if (_allOrdersInFlight[cacheKey]) return _allOrdersInFlight[cacheKey];

    const promise = (async () => {
        if (_binanceBanUntil > Date.now()) throw new Error('Binance IP temporarily banned');
        const timestamp = await getBinanceServerTime('futures');
        const qs   = new URLSearchParams({ symbol, limit: 100, timestamp }).toString();
        const sign = crypto.createHmac('sha256', apiSecret).update(qs).digest('hex');
        const r    = await axios.get(`https://fapi.binance.com/fapi/v1/allOrders?${qs}&signature=${sign}`, {
            headers: { 'X-MBX-APIKEY': apiKey }, timeout: 10000
        });
        return r.data;
    })()
        .then(data => {
            _allOrdersCache[cacheKey] = { data, ts: Date.now() };
            delete _allOrdersInFlight[cacheKey];
            return data;
        })
        .catch(err => {
            delete _allOrdersInFlight[cacheKey];
            throw err;
        });

    _allOrdersInFlight[cacheKey] = promise;
    return promise;
}

/**
 * Fetch formatted Binance Futures data (used by /data endpoint).
 * Consumes from the centralized raw cache — no duplicate API calls.
 */
async function fetchBinanceFuturesData(apiKey, apiSecret) {
    const raw = await fetchRawBinanceData(apiKey, apiSecret);
    const { account, openOrders, userTrades: recentTrades, income: incomeHistory } = raw;

    const positions        = account.positions?.filter(p => parseFloat(p.positionAmt) !== 0) || [];
    const limitOrders      = openOrders.filter(o => o.type === 'LIMIT');
    const stopOrders       = openOrders.filter(o => o.type.includes('STOP'));
    const takeProfitOrders = openOrders.filter(o => o.type.includes('TAKE_PROFIT'));

    return {
        account: {
            totalWalletBalance:     parseFloat(account.totalWalletBalance) || 0,
            totalUnrealizedProfit:  parseFloat(account.totalUnrealizedProfit) || 0,
            totalMarginBalance:     parseFloat(account.totalMarginBalance) || 0,
            availableBalance:       parseFloat(account.availableBalance) || 0
        },
        positions: positions.map(p => ({
            symbol:           p.symbol,
            side:             parseFloat(p.positionAmt) > 0 ? 'LONG' : 'SHORT',
            positionAmt:      Math.abs(parseFloat(p.positionAmt)),
            entryPrice:       parseFloat(p.entryPrice),
            markPrice:        parseFloat(p.markPrice),
            unrealizedProfit: parseFloat(p.unrealizedProfit),
            leverage:         p.leverage,
            marginType:       p.marginType
        })),
        limitOrders:      limitOrders.map(o => ({ symbol: o.symbol, side: o.side, price: parseFloat(o.price), quantity: parseFloat(o.origQty), status: o.status, time: o.time })),
        stopOrders:       stopOrders.map(o => ({ symbol: o.symbol, side: o.side, stopPrice: parseFloat(o.stopPrice), quantity: parseFloat(o.origQty), type: o.type, status: o.status, time: o.time })),
        takeProfitOrders: takeProfitOrders.map(o => ({ symbol: o.symbol, side: o.side, stopPrice: parseFloat(o.stopPrice), quantity: parseFloat(o.origQty), type: o.type, status: o.status, time: o.time })),
        recentTrades:     recentTrades.slice(0, 20).map(t => ({ symbol: t.symbol, side: t.side, price: parseFloat(t.price), quantity: parseFloat(t.qty), realizedPnl: parseFloat(t.realizedPnl), time: t.time })),
        incomeHistory:    incomeHistory.slice(0, 50).map(i => ({ symbol: i.symbol, incomeType: i.incomeType, income: parseFloat(i.income), time: i.time, info: i.info }))
    };
}

/**
 * Resolve (or auto-create) a strategy ID for a given bot + symbol.
 * strategy name defaults to 'default' — admin can rename later.
 */
function resolveStrategyId(botId, symbol, strategyName) {
    const name = strategyName || 'default';
    const existing = dbGet(
        'SELECT id FROM bot_strategies WHERE bot_id = ? AND strategy = ? AND symbol = ?',
        [botId, name, symbol]
    );
    if (existing) return existing.id;
    const result = dbRun(
        'INSERT INTO bot_strategies (bot_id, strategy, symbol) VALUES (?, ?, ?)',
        [botId, name, symbol]
    );
    return result.lastInsertRowid;
}

/** Find strategy_id by bot_id + symbol (any strategy name). Returns first match or null. */
function findStrategyBySymbol(botId, symbol) {
    const row = dbGet('SELECT id FROM bot_strategies WHERE bot_id = ? AND symbol = ? LIMIT 1', [botId, symbol]);
    return row ? row.id : null;
}

function _calcStats(closedTrades) {
    const winningTrades = closedTrades.filter(t => t.pnl > 0).length;
    const losingTrades  = closedTrades.filter(t => t.pnl < 0).length;
    const totalPnl      = closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const bestTrade     = closedTrades.length > 0 ? Math.max(...closedTrades.map(t => t.pnl || 0)) : 0;
    const worstTrade    = closedTrades.length > 0 ? Math.min(...closedTrades.map(t => t.pnl || 0)) : 0;
    return { total: closedTrades.length, winningTrades, losingTrades, totalPnl, bestTrade, worstTrade };
}

function updateBotStats(botId) {
    // 1. Global bot stats (bot_id level, strategy_id IS NULL) — backward compat
    const allTrades    = dbAll('SELECT * FROM bot_trades WHERE bot_id = ?', [botId]);
    const allClosed    = allTrades.filter(t => t.status === 'closed');
    const globalStats  = _calcStats(allClosed);

    const existing = dbGet('SELECT id FROM bot_stats WHERE bot_id = ? AND strategy_id IS NULL', [botId]);
    if (existing) {
        dbRun(
            'UPDATE bot_stats SET total_trades = ?, winning_trades = ?, losing_trades = ?, total_pnl = ?, best_trade = ?, worst_trade = ?, last_updated = CURRENT_TIMESTAMP WHERE id = ?',
            [globalStats.total, globalStats.winningTrades, globalStats.losingTrades, globalStats.totalPnl, globalStats.bestTrade, globalStats.worstTrade, existing.id]
        );
    } else {
        dbRun(
            'INSERT INTO bot_stats (bot_id, strategy_id, total_trades, winning_trades, losing_trades, total_pnl, best_trade, worst_trade) VALUES (?, NULL, ?, ?, ?, ?, ?, ?)',
            [botId, globalStats.total, globalStats.winningTrades, globalStats.losingTrades, globalStats.totalPnl, globalStats.bestTrade, globalStats.worstTrade]
        );
    }

    // 2. Per-strategy stats
    const strategies = dbAll('SELECT id FROM bot_strategies WHERE bot_id = ?', [botId]);
    for (const s of strategies) {
        const sTrades = dbAll('SELECT * FROM bot_trades WHERE bot_id = ? AND strategy_id = ?', [botId, s.id]);
        const sClosed = sTrades.filter(t => t.status === 'closed');
        const st      = _calcStats(sClosed);

        const sExisting = dbGet('SELECT id FROM bot_stats WHERE bot_id = ? AND strategy_id = ?', [botId, s.id]);
        if (sExisting) {
            dbRun(
                'UPDATE bot_stats SET total_trades = ?, winning_trades = ?, losing_trades = ?, total_pnl = ?, best_trade = ?, worst_trade = ?, last_updated = CURRENT_TIMESTAMP WHERE id = ?',
                [st.total, st.winningTrades, st.losingTrades, st.totalPnl, st.bestTrade, st.worstTrade, sExisting.id]
            );
        } else {
            dbRun(
                'INSERT INTO bot_stats (bot_id, strategy_id, total_trades, winning_trades, losing_trades, total_pnl, best_trade, worst_trade) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [botId, s.id, st.total, st.winningTrades, st.losingTrades, st.totalPnl, st.bestTrade, st.worstTrade]
            );
        }
    }
}

// Rebuild position blocks: group consecutive same-side trades per symbol
function rebuildPositionBlocks(botId) {
    const MAX_BLOCKS = 5000;
    const trades = dbAll(
        'SELECT id, symbol, side, position_side, quantity, price, pnl, status, opened_at, closed_at, strategy_id FROM bot_trades WHERE bot_id = ? ORDER BY opened_at ASC',
        [botId]
    );

    function getSide(t) {
        const ps = (t.position_side || '').toUpperCase();
        if (ps === 'LONG' || ps === 'SHORT') return ps;
        const s = (t.side || '').toUpperCase();
        return (s === 'BUY' || s === 'LONG') ? 'LONG' : 'SHORT';
    }

    // Group by symbol
    const bySymbol = {};
    trades.forEach(t => {
        const sym = t.symbol || 'UNKNOWN';
        if (!bySymbol[sym]) bySymbol[sym] = [];
        bySymbol[sym].push(t);
    });

    const allBlocks = [];
    for (const [sym, symTrades] of Object.entries(bySymbol)) {
        let blockTrades = [];
        let curSide = null;

        for (const t of symTrades) {
            const side = getSide(t);
            if (blockTrades.length === 0 || side === curSide) {
                blockTrades.push(t);
                curSide = side;
            } else {
                allBlocks.push(buildBlockObj(sym, curSide, blockTrades));
                blockTrades = [t];
                curSide = side;
            }
        }
        if (blockTrades.length > 0) {
            allBlocks.push(buildBlockObj(sym, curSide, blockTrades));
        }
    }

    // Sort by started_at ASC
    allBlocks.sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime());

    // Keep only last MAX_BLOCKS
    const kept = allBlocks.slice(-MAX_BLOCKS);

    // Replace all blocks in DB
    dbRun('DELETE FROM bot_position_blocks WHERE bot_id = ?', [botId]);
    for (const b of kept) {
        dbRun(
            `INSERT INTO bot_position_blocks (bot_id, strategy_id, symbol, side, trade_count, total_qty, avg_entry, avg_exit, total_pnl, is_open, started_at, ended_at, trade_ids)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [botId, b.strategy_id || null, b.symbol, b.side, b.trade_count, b.total_qty, b.avg_entry, b.avg_exit, b.total_pnl, b.is_open ? 1 : 0, b.started_at, b.ended_at, b.trade_ids]
        );
    }
    saveDatabase();
    return kept.length;
}

function buildBlockObj(sym, side, trades) {
    const totalPnl = trades.reduce((s, t) => s + (t.pnl || 0), 0);
    const totalQty = trades.reduce((s, t) => s + (t.quantity || 0), 0);

    let sumEntry = 0, sumEntryW = 0;
    trades.forEach(t => {
        const q = t.quantity || 0;
        const p = t.price || 0;
        if (p > 0 && q > 0) { sumEntry += p * q; sumEntryW += q; }
    });
    const avgEntry = sumEntryW > 0 ? sumEntry / sumEntryW : 0;

    let sumExit = 0, sumExitW = 0;
    trades.filter(t => t.status === 'closed').forEach(t => {
        const q = t.quantity || 0;
        const p = t.price || 0;
        const pnl = t.pnl || 0;
        if (p > 0 && q > 0) {
            const exitP = side === 'LONG' ? p + pnl / q : p - pnl / q;
            sumExit += exitP * q;
            sumExitW += q;
        }
    });
    const avgExit = sumExitW > 0 ? sumExit / sumExitW : 0;

    const startedAt = trades[0].opened_at || trades[0].closed_at;
    const lastT = trades[trades.length - 1];
    const endedAt = lastT.closed_at || lastT.opened_at;
    const isOpen = trades.some(t => t.status === 'open');
    const tradeIds = trades.map(t => t.id).join(',');

    // Use strategy_id from first trade in block (all trades in a symbol block share the same strategy)
    const strategyId = trades[0].strategy_id || null;
    return { symbol: sym, side, trade_count: trades.length, total_qty: totalQty, avg_entry: avgEntry, avg_exit: avgExit, total_pnl: totalPnl, is_open: isOpen, started_at: startedAt, ended_at: endedAt, trade_ids: tradeIds, strategy_id: strategyId };
}

// Fix orphaned trades: pair open entries with standalone closed exits by time/symbol/side
function repairOrphanedTrades(botId) {
    // Standalone closed trades: inserted as closed with no matching open (binance_close_trade_id set, no binance_trade_id)
    const standaloneClosedIds = dbAll(
        `SELECT id, symbol, side, position_side, opened_at, closed_at, pnl, binance_close_trade_id
         FROM bot_trades
         WHERE bot_id = ? AND status = 'closed'
           AND (binance_trade_id IS NULL OR binance_trade_id = '')
           AND (binance_close_trade_id IS NOT NULL AND binance_close_trade_id != '')
         ORDER BY opened_at ASC`,
        [botId]
    );

    // Orphaned open trades: inserted as open but never closed
    const orphanedOpens = dbAll(
        `SELECT id, symbol, side, position_side, opened_at, binance_trade_id
         FROM bot_trades
         WHERE bot_id = ? AND status = 'open'
           AND (binance_trade_id IS NOT NULL AND binance_trade_id != '')
         ORDER BY opened_at ASC`,
        [botId]
    );

    if (standaloneClosedIds.length === 0 || orphanedOpens.length === 0) return 0;

    let fixed = 0;
    for (const closed of standaloneClosedIds) {
        // In Hedge Mode: match by same position_side (LONG open + LONG close)
        // In One-Way Mode: match by opposite side (BUY open + SELL close)
        const closedPosSide = closed.position_side;
        let match;
        if (closedPosSide === 'LONG' || closedPosSide === 'SHORT') {
            match = orphanedOpens.find(o =>
                o.symbol === closed.symbol &&
                (o.position_side || o.side) === closedPosSide &&
                o.opened_at <= closed.opened_at
            );
        } else {
            const openSide = closed.side === 'SELL' ? 'BUY' : 'SELL';
            match = orphanedOpens.find(o =>
                o.symbol === closed.symbol &&
                o.side === openSide &&
                o.opened_at <= closed.opened_at
            );
        }
        if (match) {
            // Merge: update the open entry to become the complete closed trade
            const closeId = closed.binance_close_trade_id;
            const existingClose = closeId ? dbGet('SELECT id FROM bot_trades WHERE bot_id = ? AND binance_close_trade_id = ? AND id != ?', [botId, closeId, match.id]) : null;
            if (existingClose) {
                dbRun(`UPDATE bot_trades SET status = 'closed', pnl = ?, closed_at = ? WHERE id = ?`,
                    [closed.pnl, closed.closed_at, match.id]);
            } else {
                dbRun(`UPDATE bot_trades SET status = 'closed', pnl = ?, closed_at = ?, binance_close_trade_id = ? WHERE id = ?`,
                    [closed.pnl, closed.closed_at, closeId, match.id]);
            }
            // Delete the duplicate standalone closed entry
            dbRun('DELETE FROM bot_trades WHERE id = ?', [closed.id]);
            // Remove matched open from the pool
            const idx = orphanedOpens.indexOf(match);
            orphanedOpens.splice(idx, 1);
            fixed++;
        }
    }

    if (fixed > 0) console.log(`[Bot ${botId}] repairOrphanedTrades: fixed ${fixed} orphaned pairs`);
    return fixed;
}

const _syncThrottle = {};  // { [botId]: lastSyncTimestamp }
const SYNC_THROTTLE_MS = 300_000;  // 5 minutes

async function syncBinanceTrades(botId) {
    // Throttle: skip if synced recently (prevents API spam from polling)
    const now = Date.now();
    if (_syncThrottle[botId] && (now - _syncThrottle[botId]) < SYNC_THROTTLE_MS) {
        return { saved: 0, symbols: [], throttled: true };
    }
    _syncThrottle[botId] = now;

    try {
        const bot = dbGet('SELECT * FROM bots WHERE id = ?', [botId]);
        if (!bot) return { saved: 0, symbols: [] };
        const credPairs = getBotCredentialPairs(bot);
        if (credPairs.length === 0) return { saved: 0, symbols: [] };

        const baseUrl  = 'https://fapi.binance.com';

        function buildMakeReq(apiKey, apiSecret) {
            return async (endpoint, params = {}) => {
                const p  = { ...params, timestamp: Date.now() };
                const qs = new URLSearchParams(p).toString();
                const sig = crypto.createHmac('sha256', apiSecret).update(qs).digest('hex');
                const r  = await axios.get(`${baseUrl}${endpoint}?${qs}&signature=${sig}`, {
                    headers: { 'X-MBX-APIKEY': apiKey }, timeout: 15000
                });
                return r.data;
            };
        }

        const discoveredSymbols = new Set();

        // Discover symbols from ALL accounts in parallel
        await Promise.allSettled(credPairs.map(async (cred) => {
            const makeReq = buildMakeReq(cred.apiKey, cred.apiSecret);
            try {
                const income = await makeReq('/fapi/v1/income', { limit: 1000, incomeType: 'REALIZED_PNL' });
                income.forEach(i => { if (i.symbol) discoveredSymbols.add(i.symbol); });
            } catch (e) {}
            try {
                const acct = await makeReq('/fapi/v2/account');
                (acct.positions || []).forEach(p => {
                    if (parseFloat(p.positionAmt) !== 0) discoveredSymbols.add(p.symbol);
                });
            } catch (e) {}
        }));

        discoveredSymbols.add(bot.selected_symbol || 'BTCUSDT');
        dbAll('SELECT DISTINCT symbol FROM bot_trades WHERE bot_id = ?', [botId]).forEach(r => discoveredSymbols.add(r.symbol));

        const symbols = [...discoveredSymbols];
        console.log(`[Bot ${botId}] Syncing ${symbols.length} symbols`);

        let totalSaved = 0;
        const newTrades = []; // Collect new trades for subscriber notifications
        for (const symbol of symbols) {
            try {
                // Resolve strategy_id for this bot+symbol (auto-creates if needed)
                const strategyId = resolveStrategyId(botId, symbol);

                // Paginate backwards to fetch ALL historical trades from ALL accounts
                const trades = [];
                const seenIds = new Set();

                for (const cred of credPairs) {
                    const makeReq = buildMakeReq(cred.apiKey, cred.apiSecret);
                    let endTime = undefined;
                    for (let page = 0; page < 20; page++) {
                        const params = { symbol, limit: 1000 };
                        if (endTime !== undefined) params.endTime = endTime;

                        let batch;
                        try { batch = await makeReq('/fapi/v1/userTrades', params); } catch(e) { break; }
                    if (!batch || batch.length === 0) break;

                    let newCount = 0;
                    for (const t of batch) {
                        if (!seenIds.has(t.id)) {
                            seenIds.add(t.id);
                            trades.push(t);
                            newCount++;
                        }
                    }

                    if (batch.length < 1000 || newCount === 0) break; // reached beginning of history

                    // Move endTime to just before the oldest trade in this batch
                    endTime = Math.min(...batch.map(t => t.time)) - 1;

                    // Small delay to respect rate limits between pages
                    await new Promise(r => setTimeout(r, 150));
                    }
                } // end credPairs loop

                // Process oldest-first so entry fills are inserted before their exit fills
                trades.sort((a, b) => a.time - b.time);

                if (trades.length > 0) {
                    console.log(`[Bot ${botId}] ${symbol}: processing ${trades.length} trades (strategy=${strategyId})`);
                }

                for (const t of trades) {
                    const tradeId = t.id.toString();
                    const exists = dbGet(
                        'SELECT id FROM bot_trades WHERE bot_id = ? AND (binance_trade_id = ? OR binance_close_trade_id = ?)',
                        [botId, tradeId, tradeId]
                    );
                    if (!exists) {
                        const pnl       = parseFloat(t.realizedPnl) || 0;
                        const tradeTime = new Date(t.time).toISOString();
                        const posSide   = t.positionSide || 'BOTH'; // LONG, SHORT, or BOTH

                        // Determine the position side for matching
                        // Hedge mode: positionSide is LONG or SHORT
                        // One-way mode: positionSide is BOTH
                        const isBuy = t.side === 'BUY';
                        let isEntry;
                        if (posSide === 'LONG')       isEntry = isBuy;    // LONG+BUY=open, LONG+SELL=close
                        else if (posSide === 'SHORT')  isEntry = !isBuy;   // SHORT+SELL=open, SHORT+BUY=close
                        else                           isEntry = pnl === 0; // BOTH: use pnl

                        // The side we store = position side (LONG/SHORT), not order side (BUY/SELL)
                        const storeSide = posSide === 'LONG' ? 'LONG' :
                                          posSide === 'SHORT' ? 'SHORT' :
                                          (isBuy ? 'BUY' : 'SELL');

                        if (!isEntry && pnl !== 0) {
                            // This is an exit fill — find matching open trade
                            // In hedge mode, match by position_side; in one-way, match by opposite side
                            let openRow;
                            if (posSide === 'LONG' || posSide === 'SHORT') {
                                openRow = dbGet(
                                    'SELECT id FROM bot_trades WHERE bot_id = ? AND symbol = ? AND position_side = ? AND status = ? ORDER BY opened_at DESC LIMIT 1',
                                    [botId, t.symbol, posSide, 'open']
                                );
                                // Fallback: try matching by side field for older records without position_side
                                if (!openRow) {
                                    openRow = dbGet(
                                        'SELECT id FROM bot_trades WHERE bot_id = ? AND symbol = ? AND side = ? AND status = ? ORDER BY opened_at DESC LIMIT 1',
                                        [botId, t.symbol, storeSide, 'open']
                                    );
                                }
                            } else {
                                const openSide = isBuy ? 'SELL' : 'BUY';
                                openRow = dbGet(
                                    'SELECT id FROM bot_trades WHERE bot_id = ? AND symbol = ? AND side = ? AND status = ? ORDER BY opened_at DESC LIMIT 1',
                                    [botId, t.symbol, openSide, 'open']
                                );
                            }
                            if (openRow) {
                                dbRun('UPDATE bot_trades SET status = ?, pnl = ?, closed_at = ?, binance_close_trade_id = ? WHERE id = ?',
                                    ['closed', pnl, tradeTime, tradeId, openRow.id]);
                            } else {
                                dbRun(
                                    'INSERT INTO bot_trades (bot_id, strategy_id, binance_close_trade_id, symbol, side, type, quantity, price, pnl, pnl_percent, status, opened_at, closed_at, position_side) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                                    [botId, strategyId, tradeId, t.symbol, storeSide, 'MARKET', parseFloat(t.qty), parseFloat(t.price), pnl, 0, 'closed', tradeTime, tradeTime, posSide]
                                );
                            }
                        } else {
                            // Entry fill
                            dbRun(
                                'INSERT INTO bot_trades (bot_id, strategy_id, binance_trade_id, symbol, side, type, quantity, price, pnl, pnl_percent, status, opened_at, position_side) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                                [botId, strategyId, tradeId, t.symbol, storeSide, 'MARKET', parseFloat(t.qty), parseFloat(t.price), 0, 0, 'open', tradeTime, posSide]
                            );
                        }
                        newTrades.push({
                            symbol: t.symbol,
                            side: storeSide,
                            price: parseFloat(t.price),
                            qty: parseFloat(t.qty),
                            pnl,
                            isEntry,
                            strategyId
                        });
                        totalSaved++;
                    }
                }
            } catch (symErr) {
                console.log(`[Bot ${botId}] Sync skip ${symbol}:`, symErr.message);
            }
        }

        // Repair any orphaned open/closed pairs created by out-of-order processing
        const repaired = repairOrphanedTrades(botId);

        // Fix closed trades missing closed_at timestamp
        const missingCloseTime = dbAll(
            "SELECT id, opened_at FROM bot_trades WHERE bot_id = ? AND status = 'closed' AND (closed_at IS NULL OR closed_at = '')",
            [botId]
        );
        if (missingCloseTime.length > 0) {
            missingCloseTime.forEach(t => {
                dbRun('UPDATE bot_trades SET closed_at = ? WHERE id = ?', [t.opened_at || new Date().toISOString(), t.id]);
            });
            console.log(`[Bot ${botId}] Fixed ${missingCloseTime.length} closed trades missing closed_at`);
        }

        // Backfill strategy_id for old trades that don't have one yet
        const orphanedStrategyTrades = dbAll(
            'SELECT DISTINCT symbol FROM bot_trades WHERE bot_id = ? AND strategy_id IS NULL',
            [botId]
        );
        for (const row of orphanedStrategyTrades) {
            const sId = resolveStrategyId(botId, row.symbol);
            dbRun('UPDATE bot_trades SET strategy_id = ? WHERE bot_id = ? AND symbol = ? AND strategy_id IS NULL', [sId, botId, row.symbol]);
        }

        if (totalSaved > 0 || repaired > 0 || symbols.length > 0 || missingCloseTime.length > 0 || orphanedStrategyTrades.length > 0) {
            updateBotStats(botId);
            rebuildPositionBlocks(botId);
        }

        // Reconcile any remaining open trades against actual Binance positions
        const reconciled = await reconcileOpenTrades(botId);

        // Notify subscribers about new trades
        if (newTrades.length > 0) {
            notifyBotSubscribers(botId, newTrades);
        }

        console.log(`[Bot ${botId}] Sync complete: ${totalSaved} new, ${repaired} repaired, ${reconciled} reconciled`);
        return { saved: totalSaved, repaired, reconciled, symbols };
    } catch (err) {
        console.error('syncBinanceTrades error:', err.message);
        return { saved: 0, symbols: [] };
    }
}

// Notify all active subscribers of a bot about new trades
function notifyBotSubscribers(botId, newTrades) {
    try {
        const bot = dbGet('SELECT id, name FROM bots WHERE id = ?', [botId]);
        if (!bot) return;

        const subscribers = dbAll(
            "SELECT user_id FROM bot_subscribers WHERE bot_id = ? AND status = 'active'",
            [botId]
        );
        if (subscribers.length === 0) return;

        // Group trades: count entries and exits
        let entries = 0, exits = 0, totalPnl = 0;
        const symbols = new Set();
        for (const t of newTrades) {
            symbols.add(t.symbol);
            if (t.isEntry) entries++;
            else { exits++; totalPnl += t.pnl; }
        }

        // Build notification message
        const botName = bot.name || `Bot #${botId}`;
        const symbolList = [...symbols].slice(0, 3).join(', ') + (symbols.size > 3 ? ` +${symbols.size - 3}` : '');
        let title, message;

        if (entries > 0 && exits === 0) {
            title = `${botName} відкрив угоди`;
            message = `${entries} нов${entries === 1 ? 'а угода' : 'их угод'} · ${symbolList}`;
        } else if (exits > 0 && entries === 0) {
            const pnlStr = totalPnl >= 0 ? `+$${totalPnl.toFixed(2)}` : `-$${Math.abs(totalPnl).toFixed(2)}`;
            title = `${botName} закрив угоди`;
            message = `${exits} угод закрито · PnL: ${pnlStr} · ${symbolList}`;
        } else {
            const pnlStr = totalPnl >= 0 ? `+$${totalPnl.toFixed(2)}` : `-$${Math.abs(totalPnl).toFixed(2)}`;
            title = `${botName} — нова активність`;
            message = `${entries} відкрито, ${exits} закрито · PnL: ${pnlStr} · ${symbolList}`;
        }

        // Send to each subscriber (respecting their notification settings)
        for (const sub of subscribers) {
            const settings = dbGet(
                'SELECT * FROM bot_notification_settings WHERE user_id = ? AND bot_id = ?',
                [sub.user_id, botId]
            );

            // If settings exist, check if the relevant notification type is enabled
            if (settings) {
                if (entries > 0 && !settings.notify_new_trade) continue;
                if (exits > 0 && !settings.notify_close_trade) continue;
            }

            createNotification(sub.user_id, 'bot', title, message, '🤖');
        }

        console.log(`[Bot ${botId}] Notified ${subscribers.length} subscribers about ${newTrades.length} new trades`);
    } catch (err) {
        console.error(`[Bot ${botId}] Failed to notify subscribers:`, err.message);
    }
}

// Close orphaned open trades: DB has status='open' but Binance position is actually closed
async function reconcileOpenTrades(botId) {
    try {
        const bot = dbGet('SELECT * FROM bots WHERE id = ?', [botId]);
        if (!bot) return 0;
        const credPairs = getBotCredentialPairs(bot);
        if (credPairs.length === 0) return 0;

        const openTrades = dbAll('SELECT * FROM bot_trades WHERE bot_id = ? AND status = ?', [botId, 'open']);
        if (openTrades.length === 0) return 0;

        // Fetch positions from ALL accounts and merge
        const allPositions = [];
        const multiCreds = getMultiCredentials(bot);
        if (multiCreds) {
            const merged = await fetchMultiAccountFuturesData(multiCreds);
            allPositions.push(...(merged.positions || []));
        } else {
            const binData = await fetchBinanceFuturesData(bot.binance_api_key, bot.binance_api_secret);
            allPositions.push(...(binData.positions || []));
        }

        // Build a set of active position keys: "SYMBOL:SIDE" for hedge mode
        const activePositionKeys = new Set();
        const activeSymbols = new Set();
        allPositions
            .filter(p => parseFloat(p.positionAmt) !== 0)
            .forEach(p => {
                activeSymbols.add(p.symbol);
                const side = p.side || (parseFloat(p.positionAmt) > 0 ? 'LONG' : 'SHORT');
                activePositionKeys.add(`${p.symbol}:${side}`);
            });

        // Find open trades in DB where Binance has no matching active position
        const orphaned = openTrades.filter(t => {
            const posSide = t.position_side || t.side;
            // If we know the position side, check specific side
            if (posSide === 'LONG' || posSide === 'SHORT') {
                return !activePositionKeys.has(`${t.symbol}:${posSide}`);
            }
            // Fallback: BUY = LONG, SELL = SHORT
            const mappedSide = (posSide === 'BUY') ? 'LONG' : 'SHORT';
            return !activePositionKeys.has(`${t.symbol}:${mappedSide}`);
        });
        if (orphaned.length === 0) return 0;

        console.log(`[Bot ${botId}] reconcileOpenTrades: ${orphaned.length} orphaned open trades`);

        // Group by symbol to minimise API calls
        const bySymbol = {};
        orphaned.forEach(t => { (bySymbol[t.symbol] = bySymbol[t.symbol] || []).push(t); });

        let fixed = 0;
        for (const [symbol, trades] of Object.entries(bySymbol)) {
            try {
                // Fetch fills from ALL accounts and merge
                const allFills = [];
                for (const cred of credPairs) {
                    try {
                        const f = await makeBinanceSignedReq(cred.apiKey, cred.apiSecret, '/fapi/v1/userTrades', { symbol, limit: 200 });
                        allFills.push(...f);
                    } catch (e) {}
                }
                const fills = allFills;

                for (const trade of trades) {
                    const openMs = new Date(trade.opened_at).getTime() || 0;
                    const tradePosSide = trade.position_side || trade.side;

                    // Find the best closing fill: pnl≠0, happened after this trade opened
                    // In Hedge Mode, also match positionSide to avoid cross-matching LONG/SHORT
                    const closingFill = fills
                        .filter(f => {
                            if (f.time <= openMs || parseFloat(f.realizedPnl) === 0) return false;
                            if (tradePosSide === 'LONG' || tradePosSide === 'SHORT') {
                                return f.positionSide === tradePosSide;
                            }
                            return true;
                        })
                        .sort((a, b) => a.time - b.time)[0]; // earliest close after open

                    if (closingFill) {
                        const pnl      = parseFloat(closingFill.realizedPnl);
                        const closedAt = new Date(closingFill.time).toISOString();
                        const closeId  = closingFill.id.toString();
                        // Check if this close ID is already used by another trade
                        const existing = dbGet('SELECT id FROM bot_trades WHERE bot_id = ? AND binance_close_trade_id = ? AND id != ?', [botId, closeId, trade.id]);
                        if (existing) {
                            // Close without the duplicate binance_close_trade_id
                            dbRun('UPDATE bot_trades SET status = ?, pnl = ?, closed_at = ? WHERE id = ?',
                                ['closed', pnl, closedAt, trade.id]);
                        } else {
                            dbRun('UPDATE bot_trades SET status = ?, pnl = ?, closed_at = ?, binance_close_trade_id = ? WHERE id = ?',
                                ['closed', pnl, closedAt, closeId, trade.id]);
                        }
                        console.log(`[Bot ${botId}] reconcile: closed trade ${trade.id} (${symbol}) pnl=${pnl}`);
                    } else {
                        // No closing fill found in recent history — still force-close so it doesn't stay stuck
                        dbRun(
                            'UPDATE bot_trades SET status = ?, closed_at = ? WHERE id = ?',
                            ['closed', new Date().toISOString(), trade.id]
                        );
                        console.log(`[Bot ${botId}] reconcile: force-closed trade ${trade.id} (${symbol}) — no fill found`);
                    }
                    fixed++;
                }

                // Small delay between symbols
                await new Promise(r => setTimeout(r, 120));
            } catch (symErr) {
                console.log(`[Bot ${botId}] reconcile skip ${symbol}:`, symErr.message);
            }
        }

        if (fixed > 0) {
            updateBotStats(botId);
            rebuildPositionBlocks(botId);
            console.log(`[Bot ${botId}] reconcileOpenTrades: fixed ${fixed} trades`);
        }
        return fixed;
    } catch (err) {
        console.error('reconcileOpenTrades error:', err.message);
        return 0;
    }
}

// ── Routes ────────────────────────────────────────────────────────────────────

router.get('/api/bots/tree', requireAuth, (req, res) => {
    try {
        const cats = dbAll('SELECT * FROM bot_categories WHERE is_visible=1 ORDER BY sort_order');
        const bots = dbAll(`
            SELECT b.id, b.name, b.category_id, b.is_active, b.selected_symbol,
                   b.profit, b.investment, b.mode, b.community_visible,
                   bs.total_trades, bs.winning_trades
            FROM bots b LEFT JOIN bot_stats bs ON bs.bot_id = b.id AND bs.strategy_id IS NULL ORDER BY b.id
        `);

        // Check which bots the current user is subscribed to
        const userSubscriptions = new Set();
        if (req.session.userId) {
            const subs = dbAll("SELECT bot_id FROM bot_subscribers WHERE user_id = ? AND status = 'active'", [req.session.userId]);
            subs.forEach(s => userSubscriptions.add(s.bot_id));
        }

        // For each bot: get last trade time + currently active symbol (last opened/closed)
        const botActivity = {};
        bots.forEach(b => {
            const lastTrade = dbGet(
                `SELECT symbol, COALESCE(closed_at, opened_at) as last_time
                 FROM bot_trades WHERE bot_id = ?
                 ORDER BY COALESCE(closed_at, opened_at) DESC LIMIT 1`,
                [b.id]
            );
            const openTrade = dbGet(
                `SELECT symbol FROM bot_trades WHERE bot_id = ? AND status = 'open' ORDER BY opened_at DESC LIMIT 1`,
                [b.id]
            );
            botActivity[b.id] = {
                lastTradeAt: lastTrade?.last_time || null,
                activeSymbol: openTrade?.symbol || lastTrade?.symbol || null,
                hasOpenTrade: !!openTrade
            };
        });

        // Check if current user is admin
        const currentUser = req.session.userId ? dbGet('SELECT role FROM users WHERE id = ?', [req.session.userId]) : null;
        const isAdmin = currentUser && (currentUser.role === 'admin' || currentUser.role === 'moderator');

        // Preload symbol visibility settings
        const botSymbolVisibility = {};
        const allVisSettings = dbAll('SELECT bot_id, symbol, is_visible FROM bot_symbol_settings');
        allVisSettings.forEach(v => {
            if (!botSymbolVisibility[v.bot_id]) botSymbolVisibility[v.bot_id] = {};
            botSymbolVisibility[v.bot_id][v.symbol] = !!v.is_visible;
        });

        // Preload traded symbols, open trades and per-symbol stats for each bot
        const botInstruments = {};
        const botOpenSymbols = {};
        const botSymbolStats = {};
        bots.forEach(b => {
            // Get symbols from trades
            const tradedSymbols = dbAll('SELECT DISTINCT symbol FROM bot_trades WHERE bot_id = ?', [b.id]).map(r => r.symbol);
            // Get configured symbols from selected_symbol field
            const configuredSymbols = (b.selected_symbol || '').split(',').map(s => s.trim()).filter(Boolean);
            // Merge: configured first, then any traded symbols not in config
            const allSymbols = [...new Set([...configuredSymbols, ...tradedSymbols])];
            botInstruments[b.id] = allSymbols;

            const openSyms = dbAll("SELECT DISTINCT symbol FROM bot_trades WHERE bot_id = ? AND status = 'open'", [b.id]);
            botOpenSymbols[b.id] = new Set(openSyms.map(r => r.symbol));
            const stats = dbAll(`SELECT symbol,
                COALESCE(SUM(pnl), 0) as pnl,
                COUNT(*) as trades,
                SUM(quantity * price) as volume,
                SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) as wins,
                MIN(opened_at) as first_trade_at
                FROM bot_trades WHERE bot_id = ? GROUP BY symbol`, [b.id]);
            const map = {};
            stats.forEach(s => {
                map[s.symbol] = {
                    pnl: s.pnl || 0,
                    trades: s.trades || 0,
                    volume: s.volume || 0,
                    winRate: s.trades > 0 ? Math.round((s.wins / s.trades) * 100) : 0,
                    commission: s.commission || 0,
                    startDate: s.first_trade_at || null
                };
            });
            botSymbolStats[b.id] = map;
        });

        // Preload strategies per bot
        const botStrategies = {};
        const allStrategies = dbAll(`
            SELECT s.id, s.bot_id, s.strategy, s.symbol, s.is_active,
                   bs.total_trades, bs.winning_trades, bs.total_pnl
            FROM bot_strategies s
            LEFT JOIN bot_stats bs ON bs.strategy_id = s.id AND bs.bot_id = s.bot_id
        `);
        allStrategies.forEach(s => {
            if (!botStrategies[s.bot_id]) botStrategies[s.bot_id] = [];
            botStrategies[s.bot_id].push(s);
        });

        const toCard = b => {
            const act = botActivity[b.id] || {};
            const lastMs = act.lastTradeAt ? new Date(act.lastTradeAt).getTime() : 0;
            const now = Date.now();

            // Real status logic:
            // 'live'    — has open trade right now (actively in position)
            // 'idle'    — is_active + had a trade in last 24h (bot is running, waiting for signal)
            // 'stopped' — is_active but no trades for 24h+ (likely not working)
            // 'off'     — is_active = false (manually disabled)
            let realStatus;
            if (!b.is_active) {
                realStatus = 'off';
            } else if (act.hasOpenTrade) {
                realStatus = 'live';
            } else if (lastMs > now - 24 * 60 * 60 * 1000) {
                realStatus = 'idle';
            } else {
                realStatus = 'stopped';
            }

            // Build instruments with open status, stats, and visibility
            // Parse trading_settings once per bot
            let ts = {};
            try { ts = JSON.parse(b.trading_settings || '{}'); } catch(e) {}
            const visMap = botSymbolVisibility[b.id] || {};
            const instruments = (botInstruments[b.id] || [])
                .map(sym => {
                    const st = (botSymbolStats[b.id] || {})[sym] || {};
                    const visible = visMap[sym] !== undefined ? visMap[sym] : false;
                    return {
                        symbol: sym,
                        hasOpenTrade: botOpenSymbols[b.id]?.has(sym) || false,
                        pnl: st.pnl || 0,
                        trades: st.trades || 0,
                        volume: st.volume || 0,
                        winRate: st.winRate || 0,
                        commission: st.commission || 0,
                        startDate: st.startDate || null,
                        isVisible: visible
                    };
                })
                .filter(inst => isAdmin || inst.isVisible);

            // Uptime: time since bot creation
            const createdAt = b.created_at || null;

            // Strategies for this bot
            const strategies = (botStrategies[b.id] || []).map(s => ({
                id: s.id,
                strategy: s.strategy,
                symbol: s.symbol,
                isActive: !!s.is_active,
                totalTrades: s.total_trades || 0,
                winRate: s.total_trades > 0 ? Math.round(((s.winning_trades || 0) / s.total_trades) * 100) : 0,
                totalPnl: s.total_pnl || 0
            }));

            return {
                id: b.id, name: b.name, is_active: !!b.is_active,
                realStatus,
                symbol: b.selected_symbol || '',
                activeSymbol: act.activeSymbol || b.selected_symbol || '',
                hasOpenTrade: act.hasOpenTrade || false,
                lastTradeAt: act.lastTradeAt || null,
                profit: b.profit || 0, investment: b.investment || 0, mode: b.mode,
                winRate: b.total_trades > 0 ? Math.round((b.winning_trades / b.total_trades) * 100) : null,
                totalTrades: b.total_trades || 0,
                instruments,
                strategies,
                isSubscribed: userSubscriptions.has(b.id),
                createdAt,
                leverage: ts.leverage || null,
                spread: ts.spread || null,
                balance: b.investment || 0,
                community_visible: b.community_visible !== undefined ? !!b.community_visible : true,
            };
        };
        const visibleBots = isAdmin ? bots : bots.filter(b => b.community_visible !== 0);
        const tree = cats.map(c => ({ ...c, bots: visibleBots.filter(b => b.category_id === c.id).map(toCard) }));
        const uncat = visibleBots.filter(b => !b.category_id);
        if (uncat.length) tree.push({ id: null, name: 'Інші', color: '#6B7280', icon: 'folder', bots: uncat.map(toCard) });
        res.json({ tree });
    } catch (error) {
        console.error('Bots tree error:', error);
        res.status(500).json({ error: 'Failed to fetch bots tree' });
    }
});

router.get('/api/bots', requireAuth, (req, res) => {
    const user = dbGet('SELECT role FROM users WHERE id = ?', [req.session.userId]);
    const isAdmin = user && (user.role === 'admin' || user.role === 'moderator');
    const allBots = dbAll('SELECT * FROM bots ORDER BY created_at DESC', []);
    const bots = isAdmin ? allBots : allBots.filter(b => b.community_visible !== 0);
    const botsWithTime = bots.map(bot => {
        const created = new Date(bot.created_at);
        const now     = new Date();
        const diff    = now - created;
        const days    = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours   = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        return {
            ...bot,
            runningTime: `${days}d ${hours}h`,
            dailyPL: bot.investment > 0 ? ((bot.profit / bot.investment) * 100 / Math.max(days, 1)).toFixed(2) : 0
        };
    });
    res.json(botsWithTime);
});

router.post('/api/bots', requireAuth, requireRole('admin', 'moderator'), (req, res) => {
    try {
        const { name, type, pair, investment } = req.body;
        const result = dbRun(
            'INSERT INTO bots (user_id, name, type, pair, investment, is_active) VALUES (?, ?, ?, ?, ?, 1)',
            [req.session.userId, name, type, pair, investment]
        );
        res.json({ success: true, botId: result.lastInsertRowid });
    } catch (error) {
        res.status(500).json({ error: 'Failed to create bot' });
    }
});

router.patch('/api/bots/:id/toggle', requireAuth, requireRole('admin', 'moderator'), (req, res) => {
    try {
        const bot = dbGet('SELECT * FROM bots WHERE id = ?', [req.params.id]);
        if (!bot) return res.status(404).json({ error: 'Bot not found' });
        dbRun('UPDATE bots SET is_active = ? WHERE id = ?', [bot.is_active ? 0 : 1, req.params.id]);
        res.json({ success: true, isActive: !bot.is_active });
    } catch (error) {
        res.status(500).json({ error: 'Failed to toggle bot' });
    }
});

router.get('/api/bots/stats', requireAuth, (req, res) => {
    const activeBots   = dbAll('SELECT * FROM bots WHERE is_active = 1', []);
    const allBots      = dbAll('SELECT * FROM bots', []);

    // Calculate real total profit from closed trades across all active bots
    const activeIds = activeBots.map(b => b.id);
    let totalProfit = 0;
    let activeAllocation = 0;

    if (activeIds.length > 0) {
        const placeholders = activeIds.map(() => '?').join(',');
        const profitRow = dbAll(
            `SELECT COALESCE(SUM(pnl), 0) as total FROM bot_trades WHERE bot_id IN (${placeholders}) AND status = 'closed'`,
            activeIds
        );
        totalProfit = profitRow.length > 0 ? profitRow[0].total : 0;

        // Active allocation: sum of investment for non-binance bots + sum of open position value for binance bots
        activeAllocation = activeBots.reduce((sum, bot) => sum + (bot.investment || 0), 0);
        const openPositions = dbAll(
            `SELECT COALESCE(SUM(quantity * price), 0) as total FROM bot_trades WHERE bot_id IN (${placeholders}) AND status = 'open'`,
            activeIds
        );
        if (openPositions.length > 0) activeAllocation += openPositions[0].total;
    }

    res.json({ totalProfit, activeAllocation, activeBots: activeBots.length, totalBots: allBots.length });
});

router.post('/api/bots/binance', requireAuth, requireRole('admin', 'moderator'), async (req, res) => {
    try {
        const { name, apiKey, apiSecret, mode, accountType, displaySettings } = req.body;
        if (!name || !apiKey || !apiSecret) return res.status(400).json({ error: 'Name, API Key and API Secret are required' });

        const testResult = await testBinanceCredentials(apiKey, apiSecret, accountType);
        if (!testResult.success) return res.status(400).json({ error: 'Invalid API credentials: ' + testResult.error });

        const result = dbRun(
            'INSERT INTO bots (user_id, name, type, pair, binance_api_key, binance_api_secret, mode, account_type, display_settings, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)',
            [req.session.userId, name, 'binance', 'FUTURES', apiKey, apiSecret, mode || 'test', accountType || 'futures', JSON.stringify(displaySettings || {})]
        );

        res.json({ success: true, botId: result.lastInsertRowid });
    } catch (error) {
        console.error('Create Binance bot error:', error);
        res.status(500).json({ error: 'Failed to create bot' });
    }
});

// ── Emergency stop all bots (admin only) ──

router.post('/api/bots/emergency-stop', requireAuth, requireRole('admin'), (req, res) => {
    try {
        // 1. Deactivate all bots
        dbRun('UPDATE bots SET is_active = 0');

        // 2. Remove all active subscriptions
        const subs = dbAll("SELECT id, bot_id, user_id FROM bot_subscribers WHERE status = 'active'");
        dbRun("UPDATE bot_subscribers SET status = 'stopped'");

        // 3. Log the action
        dbRun(
            'INSERT INTO admin_audit_log (admin_id, action, details, created_at) VALUES (?, ?, ?, datetime(\'now\'))',
            [req.session.userId, 'emergency_stop', JSON.stringify({ botsDeactivated: true, subscriptionsStopped: subs.length })]
        );

        console.warn(`[EMERGENCY STOP] Admin ${req.session.userId} stopped all bots. ${subs.length} subscriptions deactivated.`);

        res.json({ ok: true, subscriptionsStopped: subs.length });
    } catch (error) {
        console.error('Emergency stop error:', error);
        res.status(500).json({ error: 'Failed to execute emergency stop' });
    }
});

// ── Symbol visibility (admin only, must be before :id routes) ──

router.patch('/api/bots/symbol-visibility', requireAuth, requireRole('admin', 'moderator'), (req, res) => {
    try {
        const { botId, symbol, visible } = req.body;
        if (!botId || !symbol) return res.status(400).json({ error: 'botId and symbol required' });
        const isVisible = visible ? 1 : 0;
        const existing = dbGet('SELECT id FROM bot_symbol_settings WHERE bot_id = ? AND symbol = ?', [botId, symbol]);
        if (existing) {
            dbRun('UPDATE bot_symbol_settings SET is_visible = ? WHERE bot_id = ? AND symbol = ?', [isVisible, botId, symbol]);
        } else {
            dbRun('INSERT INTO bot_symbol_settings (bot_id, symbol, is_visible) VALUES (?, ?, ?)', [botId, symbol, isVisible]);
        }
        res.json({ ok: true, visible: !!isVisible });
    } catch (error) {
        console.error('Symbol visibility error:', error);
        res.status(500).json({ error: 'Failed to update symbol visibility' });
    }
});

// ── Bot Analytics (must be before :id routes) ──

router.post('/api/bots/analytics', requireAuth, (req, res) => {
    try {
        const { event, bot_id, symbol, meta } = req.body;
        if (!event) return res.status(400).json({ error: 'event is required' });
        dbRun(
            'INSERT INTO bot_analytics (user_id, event, bot_id, symbol, meta) VALUES (?, ?, ?, ?, ?)',
            [req.session.userId, event, bot_id || null, symbol || null, meta ? JSON.stringify(meta) : null]
        );
        res.json({ ok: true });
    } catch (error) {
        console.error('Analytics track error:', error);
        res.status(500).json({ error: 'Failed to track event' });
    }
});

router.get('/api/bots/analytics/stats', requireAuth, requireRole('admin', 'moderator'), (req, res) => {
    try {
        const days = parseInt(req.query.days) || 7;
        const since = new Date(Date.now() - days * 86400000).toISOString();

        const pageViews = dbGet(
            `SELECT COUNT(*) as total, COUNT(DISTINCT user_id) as unique_users
             FROM bot_analytics WHERE event = 'page_view' AND created_at >= ?`, [since]
        );

        const topBots = dbAll(
            `SELECT ba.bot_id, b.name as bot_name, COUNT(*) as views, COUNT(DISTINCT ba.user_id) as unique_users
             FROM bot_analytics ba LEFT JOIN bots b ON b.id = ba.bot_id
             WHERE ba.event = 'bot_select' AND ba.created_at >= ? AND ba.bot_id IS NOT NULL
             GROUP BY ba.bot_id ORDER BY views DESC LIMIT 20`, [since]
        );

        const topCoins = dbAll(
            `SELECT ba.symbol, ba.bot_id, b.name as bot_name, COUNT(*) as views, COUNT(DISTINCT ba.user_id) as unique_users
             FROM bot_analytics ba LEFT JOIN bots b ON b.id = ba.bot_id
             WHERE ba.event = 'coin_click' AND ba.created_at >= ? AND ba.symbol IS NOT NULL
             GROUP BY ba.bot_id, ba.symbol ORDER BY views DESC LIMIT 30`, [since]
        );

        const activeUsers = dbAll(
            `SELECT ba.user_id, u.full_name, u.email, COUNT(*) as actions,
                    COUNT(DISTINCT ba.bot_id) as bots_viewed,
                    MAX(ba.created_at) as last_active
             FROM bot_analytics ba LEFT JOIN users u ON u.id = ba.user_id
             WHERE ba.created_at >= ?
             GROUP BY ba.user_id ORDER BY actions DESC LIMIT 30`, [since]
        );

        const events = dbAll(
            `SELECT event, COUNT(*) as count FROM bot_analytics
             WHERE created_at >= ? GROUP BY event ORDER BY count DESC`, [since]
        );

        const daily = dbAll(
            `SELECT DATE(created_at) as day, COUNT(*) as events, COUNT(DISTINCT user_id) as users
             FROM bot_analytics WHERE created_at >= ?
             GROUP BY DATE(created_at) ORDER BY day DESC`, [since]
        );

        res.json({ pageViews, topBots, topCoins, activeUsers, events, daily, days });
    } catch (error) {
        console.error('Analytics stats error:', error);
        res.status(500).json({ error: 'Failed to fetch analytics' });
    }
});

// ── Bot Strategies CRUD ──────────────────────────────────────────────────────

// List all strategies for a bot
router.get('/api/bots/:id/strategies', requireAuth, (req, res) => {
    try {
        const strategies = dbAll(
            `SELECT s.*, bs.total_trades, bs.winning_trades, bs.losing_trades, bs.total_pnl, bs.best_trade, bs.worst_trade
             FROM bot_strategies s
             LEFT JOIN bot_stats bs ON bs.strategy_id = s.id AND bs.bot_id = s.bot_id
             WHERE s.bot_id = ? ORDER BY s.created_at ASC`,
            [req.params.id]
        );

        // Count open trades per strategy
        const openCounts = {};
        const openRows = dbAll(
            "SELECT strategy_id, COUNT(*) as c FROM bot_trades WHERE bot_id = ? AND status = 'open' AND strategy_id IS NOT NULL GROUP BY strategy_id",
            [req.params.id]
        );
        openRows.forEach(r => { openCounts[r.strategy_id] = r.c; });

        res.json({
            strategies: strategies.map(s => ({
                id: s.id,
                botId: s.bot_id,
                strategy: s.strategy,
                symbol: s.symbol,
                isActive: !!s.is_active,
                settings: JSON.parse(s.settings || '{}'),
                createdAt: s.created_at,
                stats: {
                    totalTrades: s.total_trades || 0,
                    winningTrades: s.winning_trades || 0,
                    losingTrades: s.losing_trades || 0,
                    totalPnl: s.total_pnl || 0,
                    bestTrade: s.best_trade || 0,
                    worstTrade: s.worst_trade || 0,
                    winRate: s.total_trades > 0 ? Math.round((s.winning_trades / s.total_trades) * 100) : 0
                },
                openTrades: openCounts[s.id] || 0
            }))
        });
    } catch (error) {
        console.error('Get strategies error:', error);
        res.status(500).json({ error: 'Failed to fetch strategies' });
    }
});

// Create a new strategy
router.post('/api/bots/:id/strategies', requireAuth, requireRole('admin', 'moderator'), (req, res) => {
    try {
        const { strategy, symbol, settings } = req.body;
        if (!symbol) return res.status(400).json({ error: 'symbol is required' });

        const bot = dbGet('SELECT id FROM bots WHERE id = ?', [req.params.id]);
        if (!bot) return res.status(404).json({ error: 'Bot not found' });

        const name = strategy || 'default';
        const existing = dbGet(
            'SELECT id FROM bot_strategies WHERE bot_id = ? AND strategy = ? AND symbol = ?',
            [req.params.id, name, symbol]
        );
        if (existing) return res.status(409).json({ error: 'Strategy with this name+symbol already exists', existingId: existing.id });

        const result = dbRun(
            'INSERT INTO bot_strategies (bot_id, strategy, symbol, settings) VALUES (?, ?, ?, ?)',
            [req.params.id, name, symbol, JSON.stringify(settings || {})]
        );

        res.json({ success: true, strategyId: result.lastInsertRowid });
    } catch (error) {
        console.error('Create strategy error:', error);
        res.status(500).json({ error: 'Failed to create strategy' });
    }
});

// Update a strategy (rename, change settings, toggle active)
router.patch('/api/bots/:id/strategies/:strategyId', requireAuth, requireRole('admin', 'moderator'), (req, res) => {
    try {
        const s = dbGet('SELECT * FROM bot_strategies WHERE id = ? AND bot_id = ?', [req.params.strategyId, req.params.id]);
        if (!s) return res.status(404).json({ error: 'Strategy not found' });

        const { strategy, is_active, settings } = req.body;
        const updates = [], params = [];
        if (strategy !== undefined)  { updates.push('strategy = ?');  params.push(strategy); }
        if (is_active !== undefined) { updates.push('is_active = ?'); params.push(is_active ? 1 : 0); }
        if (settings !== undefined)  { updates.push('settings = ?');  params.push(JSON.stringify(settings)); }

        if (updates.length > 0) {
            params.push(req.params.strategyId);
            dbRun(`UPDATE bot_strategies SET ${updates.join(', ')} WHERE id = ?`, params);
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Update strategy error:', error);
        res.status(500).json({ error: 'Failed to update strategy' });
    }
});

// Delete a strategy (and optionally its trades)
router.delete('/api/bots/:id/strategies/:strategyId', requireAuth, requireRole('admin', 'moderator'), (req, res) => {
    try {
        const s = dbGet('SELECT * FROM bot_strategies WHERE id = ? AND bot_id = ?', [req.params.strategyId, req.params.id]);
        if (!s) return res.status(404).json({ error: 'Strategy not found' });

        const deleteTrades = req.query.deleteTrades === '1';
        if (deleteTrades) {
            dbRun('DELETE FROM bot_trades WHERE strategy_id = ?', [req.params.strategyId]);
            dbRun('DELETE FROM bot_position_blocks WHERE strategy_id = ?', [req.params.strategyId]);
        } else {
            // Unlink trades — set strategy_id to NULL
            dbRun('UPDATE bot_trades SET strategy_id = NULL WHERE strategy_id = ?', [req.params.strategyId]);
            dbRun('UPDATE bot_position_blocks SET strategy_id = NULL WHERE strategy_id = ?', [req.params.strategyId]);
        }

        dbRun('DELETE FROM bot_stats WHERE strategy_id = ?', [req.params.strategyId]);
        dbRun('DELETE FROM bot_strategies WHERE id = ?', [req.params.strategyId]);

        // Recalculate bot-level stats
        updateBotStats(parseInt(req.params.id));

        res.json({ success: true });
    } catch (error) {
        console.error('Delete strategy error:', error);
        res.status(500).json({ error: 'Failed to delete strategy' });
    }
});

// Get trades for a specific strategy
router.get('/api/bots/:id/strategies/:strategyId/trades', requireAuth, (req, res) => {
    try {
        const { limit = 50, offset = 0, status } = req.query;
        let query = 'SELECT * FROM bot_trades WHERE bot_id = ? AND strategy_id = ?';
        const params = [req.params.id, req.params.strategyId];

        if (status) { query += ' AND status = ?'; params.push(status); }
        query += ' ORDER BY opened_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));

        const trades = dbAll(query, params);
        const total = dbGet('SELECT COUNT(*) as c FROM bot_trades WHERE bot_id = ? AND strategy_id = ?', [req.params.id, req.params.strategyId]);

        res.json({
            trades: trades.map(t => ({
                id: t.id, symbol: t.symbol, side: t.side, type: t.type,
                quantity: t.quantity, price: t.price, pnl: t.pnl, pnlPercent: t.pnl_percent,
                status: t.status, openedAt: t.opened_at, closedAt: t.closed_at,
                positionSide: t.position_side || null
            })),
            total: total?.c || 0
        });
    } catch (error) {
        console.error('Strategy trades error:', error);
        res.status(500).json({ error: 'Failed to fetch strategy trades' });
    }
});

// Get stats for a specific strategy with timeframe support
router.get('/api/bots/:id/strategies/:strategyId/stats', requireAuth, (req, res) => {
    try {
        const tf = req.query.timeframe || 'all';
        const tfMs = { '30m': 30*60*1000, '1h': 60*60*1000, '2h': 2*60*60*1000, '4h': 4*60*60*1000, '1d': 86400000, '7d': 7*86400000 }[tf] || 0;

        let trades;
        if (tfMs > 0) {
            const since = new Date(Date.now() - tfMs).toISOString();
            trades = dbAll('SELECT pnl, side FROM bot_trades WHERE bot_id = ? AND strategy_id = ? AND status = ? AND closed_at >= ?',
                [req.params.id, req.params.strategyId, 'closed', since]);
        } else {
            trades = dbAll('SELECT pnl, side FROM bot_trades WHERE bot_id = ? AND strategy_id = ? AND status = ?',
                [req.params.id, req.params.strategyId, 'closed']);
        }

        const wins = trades.filter(t => parseFloat(t.pnl) > 0);
        const losses = trades.filter(t => parseFloat(t.pnl) <= 0);
        const totalPnl = trades.reduce((s, t) => s + parseFloat(t.pnl || 0), 0);
        const winRate = trades.length > 0 ? (wins.length / trades.length * 100) : 0;
        const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + parseFloat(t.pnl), 0) / wins.length : 0;
        const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + parseFloat(t.pnl), 0) / losses.length) : 0;
        const profitFactor = avgLoss * losses.length > 0 ? (avgWin * wins.length) / (avgLoss * losses.length) : 0;

        res.json({ totalPnl, winRate, avgWin, avgLoss, profitFactor, totalTrades: trades.length, wins: wins.length, losses: losses.length });
    } catch (error) {
        console.error('Strategy stats error:', error);
        res.status(500).json({ error: 'Failed to fetch strategy stats' });
    }
});

// Simple bot info (no Binance call)
router.get('/api/bots/:id/info', requireAuth, requireRole('admin', 'moderator'), (req, res) => {
    try {
        const bot = dbGet('SELECT * FROM bots WHERE id = ?', [req.params.id]);
        if (!bot) return res.status(404).json({ error: 'Bot not found' });
        res.json(bot);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch bot' });
    }
});

router.get('/api/bots/:id/data', requireAuth, async (req, res) => {
    try {
        if (_binanceBanUntil > Date.now()) {
            return res.status(503).json({ error: 'Binance temporarily unavailable', retryAfter: Math.ceil((_binanceBanUntil - Date.now()) / 1000) });
        }

        const bot = dbGet('SELECT * FROM bots WHERE id = ?', [req.params.id]);
        if (!bot) return res.status(404).json({ error: 'Bot not found' });

        // Ownership check: admin/moderator or bot owner
        const user = dbGet('SELECT role FROM users WHERE id = ?', [req.session.userId]);
        const isPrivileged = user && (user.role === 'admin' || user.role === 'moderator');
        if (!isPrivileged && bot.user_id !== req.session.userId) {
            // Allow subscribers to view
            const sub = dbGet('SELECT id FROM bot_subscribers WHERE bot_id = ? AND user_id = ?', [bot.id, req.session.userId]);
            if (!sub) return res.status(403).json({ error: 'Access denied' });
        }

        // Multi-account mode: fetch from all credentials in parallel
        const multiCreds = getMultiCredentials(bot);
        let binanceData;
        if (multiCreds) {
            binanceData = await fetchMultiAccountFuturesData(multiCreds);
        } else {
            if (!bot.binance_api_key || !bot.binance_api_secret) return res.status(400).json({ error: 'Bot is not configured with Binance API' });
            binanceData = await fetchBinanceFuturesData(bot.binance_api_key, bot.binance_api_secret);
        }

        res.json({
            bot: {
                id: bot.id, name: bot.name, mode: bot.mode, accountType: bot.account_type,
                displaySettings: JSON.parse(bot.display_settings || '{}'),
                isActive: !!bot.is_active, createdAt: bot.created_at
            },
            ...binanceData
        });
    } catch (error) {
        logBinanceError('Get bot data error:', error);
        res.status(500).json({ error: 'Failed to fetch bot data' });
    }
});

router.patch('/api/bots/:id/settings', requireAuth, requireRole('admin', 'moderator'), (req, res) => {
    try {
        const { name, mode, displaySettings, community_visible, category_id, pair, type, account_type, selected_symbol, investment } = req.body;
        const bot = dbGet('SELECT * FROM bots WHERE id = ?', [req.params.id]);
        if (!bot) return res.status(404).json({ error: 'Bot not found' });

        const updates = [], params = [];
        if (name !== undefined)               { updates.push('name = ?');               params.push(name); }
        if (mode !== undefined)               { updates.push('mode = ?');               params.push(mode); }
        if (displaySettings !== undefined)    { updates.push('display_settings = ?');   params.push(JSON.stringify(displaySettings)); }
        if (community_visible !== undefined)  { updates.push('community_visible = ?');  params.push(community_visible ? 1 : 0); }
        if (category_id !== undefined)        { updates.push('category_id = ?');        params.push(category_id); }
        if (pair !== undefined)               { updates.push('pair = ?');               params.push(pair); }
        if (type !== undefined)               { updates.push('type = ?');               params.push(type); }
        if (account_type !== undefined)       { updates.push('account_type = ?');       params.push(account_type); }
        if (selected_symbol !== undefined)    { updates.push('selected_symbol = ?');    params.push(selected_symbol); }
        if (investment !== undefined)         { updates.push('investment = ?');         params.push(parseFloat(investment) || 0); }

        if (updates.length > 0) { params.push(req.params.id); dbRun(`UPDATE bots SET ${updates.join(', ')} WHERE id = ?`, params); }

        res.json({ success: true });
    } catch (error) {
        console.error('Update bot settings error:', error);
        res.status(500).json({ error: 'Failed to update settings' });
    }
});

router.patch('/api/bots/:id/api-keys', requireAuth, requireRole('admin', 'moderator'), async (req, res) => {
    try {
        const { apiKey, apiSecret } = req.body;
        if (!apiKey || !apiSecret) return res.status(400).json({ error: 'apiKey and apiSecret are required' });

        const bot = dbGet('SELECT * FROM bots WHERE id = ?', [req.params.id]);
        if (!bot) return res.status(404).json({ error: 'Bot not found' });

        const testResult = await testBinanceCredentials(apiKey, apiSecret, 'futures');
        if (!testResult.success) return res.status(400).json({ error: testResult.error || 'Invalid API credentials' });

        dbRun('UPDATE bots SET binance_api_key = ?, binance_api_secret = ? WHERE id = ?', [apiKey, apiSecret, req.params.id]);

        const balance = parseFloat(testResult.data?.totalWalletBalance || 0).toFixed(2);
        res.json({ success: true, balance });
    } catch (err) {
        console.error('Save API keys error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ── Multi-account credentials ──
router.patch('/api/bots/:id/multi-credentials', requireAuth, requireRole('admin'), async (req, res) => {
    try {
        const { credentials, skipValidation } = req.body;
        if (!Array.isArray(credentials) || credentials.length === 0) return res.status(400).json({ error: 'credentials must be a non-empty array of {tk, tk_secret}' });

        const bot = dbGet('SELECT * FROM bots WHERE id = ?', [req.params.id]);
        if (!bot) return res.status(404).json({ error: 'Bot not found' });

        // Filter out entries without both fields
        const cleaned = credentials.filter(c => c.tk && c.tk_secret);
        if (cleaned.length === 0) return res.status(400).json({ error: 'No valid credentials provided' });

        let toSave = cleaned, failed = [];
        if (!skipValidation) {
            const tests = await Promise.allSettled(
                cleaned.map(c => testBinanceCredentials(c.tk, c.tk_secret, 'futures'))
            );
            toSave = []; failed = [];
            tests.forEach((t, i) => {
                if (t.status === 'fulfilled' && t.value.success) {
                    toSave.push({ tk: cleaned[i].tk, tk_secret: cleaned[i].tk_secret });
                } else {
                    failed.push(i);
                }
            });
            if (toSave.length === 0) return res.status(400).json({ error: 'Жоден акаунт не пройшов перевірку. Використайте "Зберегти без перевірки" щоб зберегти примусово.' });
        }

        let settings = {};
        try { settings = JSON.parse(bot.trading_settings || '{}'); } catch (e) {}
        settings.multi_credentials = toSave.map(c => ({ tk: c.tk, tk_secret: c.tk_secret }));
        dbRun('UPDATE bots SET trading_settings = ? WHERE id = ?', [JSON.stringify(settings), req.params.id]);

        res.json({ success: true, total: credentials.length, valid: toSave.length, failed, skippedValidation: !!skipValidation });
    } catch (err) {
        console.error('Save multi-credentials error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ── Verify all multi-account credentials ──
router.get('/api/bots/:id/multi-credentials/verify', requireAuth, requireRole('admin'), async (req, res) => {
    try {
        const bot = dbGet('SELECT * FROM bots WHERE id = ?', [req.params.id]);
        if (!bot) return res.status(404).json({ error: 'Bot not found' });

        const multiCreds = getMultiCredentials(bot);
        if (!multiCreds || multiCreds.length === 0) return res.json({ accounts: [], total: 0 });

        const results = await Promise.allSettled(
            multiCreds.map(c => testBinanceCredentials(c.tk, c.tk_secret, 'futures'))
        );

        const accounts = results.map((r, i) => {
            const keyPreview = multiCreds[i].tk.slice(0, 8) + '...' + multiCreds[i].tk.slice(-6);
            if (r.status === 'fulfilled' && r.value.success) {
                const d = r.value.data;
                return {
                    index: i,
                    key: keyPreview,
                    status: 'ok',
                    balance: parseFloat(d.totalWalletBalance || 0),
                    unrealizedPnl: parseFloat(d.totalUnrealizedProfit || 0),
                    availableBalance: parseFloat(d.availableBalance || 0),
                    positions: (d.positions || []).filter(p => parseFloat(p.positionAmt) !== 0).length
                };
            } else {
                const errMsg = r.status === 'fulfilled' ? r.value.error : (r.reason?.message || 'Unknown error');
                return { index: i, key: keyPreview, status: 'error', error: errMsg };
            }
        });

        const okCount  = accounts.filter(a => a.status === 'ok').length;
        const totalBal = accounts.filter(a => a.status === 'ok').reduce((s, a) => s + a.balance, 0);
        const totalPnl = accounts.filter(a => a.status === 'ok').reduce((s, a) => s + a.unrealizedPnl, 0);

        res.json({ accounts, total: multiCreds.length, ok: okCount, totalBalance: totalBal, totalUnrealizedPnl: totalPnl });
    } catch (err) {
        console.error('Verify multi-credentials error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ── Reset bot statistics ──
router.post('/api/bots/:id/reset-stats', requireAuth, requireRole('admin'), (req, res) => {
    try {
        const bot = dbGet('SELECT * FROM bots WHERE id = ?', [req.params.id]);
        if (!bot) return res.status(404).json({ error: 'Bot not found' });

        const { resetTrades, resetProfit, adjustPnl } = req.body;

        if (resetTrades) {
            dbRun('DELETE FROM bot_trades WHERE bot_id = ?', [req.params.id]);
        }

        if (resetProfit) {
            dbRun('UPDATE bots SET profit = 0, investment = 0 WHERE id = ?', [req.params.id]);
        }

        if (adjustPnl !== undefined && adjustPnl !== null) {
            const adj = parseFloat(adjustPnl) || 0;
            dbRun('UPDATE bots SET profit = profit + ? WHERE id = ?', [adj, req.params.id]);
        }

        // Rebuild stats (both global and per-strategy)
        dbRun('DELETE FROM bot_stats WHERE bot_id = ?', [req.params.id]);
        updateBotStats(parseInt(req.params.id));

        res.json({ success: true });
    } catch (error) {
        console.error('Reset stats error:', error);
        res.status(500).json({ error: 'Failed to reset stats' });
    }
});

router.get('/api/bots/:id/trading-settings', requireAuth, (req, res) => {
    try {
        const bot = dbGet('SELECT trading_settings FROM bots WHERE id = ?', [req.params.id]);
        if (!bot) return res.status(404).json({ error: 'Bot not found' });

        let settings = {};
        try { settings = JSON.parse(bot.trading_settings || '{}'); } catch (e) {}

        // Hide secrets from non-admins
        const user    = dbGet('SELECT role FROM users WHERE id = ?', [req.session.userId]);
        const isAdmin = user && (user.role === 'admin' || user.role === 'moderator');
        if (!isAdmin && settings.multi_credentials) {
            settings.multi_credentials = settings.multi_credentials.map(c => ({
                tk: c.tk.slice(0, 8) + '...',
                tk_secret: '***'
            }));
        }

        res.json({ settings });
    } catch (error) {
        console.error('Get trading settings error:', error);
        res.status(500).json({ error: 'Failed to get trading settings' });
    }
});

router.put('/api/bots/:id/trading-settings', requireAuth, (req, res) => {
    try {
        const { settings } = req.body;
        const user    = dbGet('SELECT role FROM users WHERE id = ?', [req.session.userId]);
        const isAdmin = user && (user.role === 'admin' || user.role === 'moderator');
        const bot     = dbGet('SELECT * FROM bots WHERE id = ?', [req.params.id]);

        if (!bot) return res.status(404).json({ error: 'Bot not found' });
        if (bot.user_id !== req.session.userId && !isAdmin) return res.status(403).json({ error: 'Access denied' });

        // Preserve multi_credentials — they are managed by a separate endpoint
        let existing = {};
        try { existing = JSON.parse(bot.trading_settings || '{}'); } catch (e) {}
        if (existing.multi_credentials) {
            settings.multi_credentials = existing.multi_credentials;
        }

        dbRun('UPDATE bots SET trading_settings = ? WHERE id = ?', [JSON.stringify(settings), req.params.id]);
        res.json({ success: true, settings });
    } catch (error) {
        console.error('Update trading settings error:', error);
        res.status(500).json({ error: 'Failed to update trading settings' });
    }
});

router.delete('/api/bots/:id', requireAuth, requireRole('admin', 'moderator'), (req, res) => {
    try {
        const botId = req.params.id;
        const bot = dbGet('SELECT * FROM bots WHERE id = ?', [botId]);
        if (!bot) return res.status(404).json({ error: 'Bot not found' });

        // Clean up all related records before deleting the bot
        const relatedTables = [
            'bot_trades', 'bot_stats', 'bot_subscribers', 'bot_symbol_settings',
            'bot_analytics', 'bot_notification_settings', 'bot_position_blocks', 'bot_order_history',
            'bot_strategies'
        ];
        for (const table of relatedTables) {
            try { dbRun(`DELETE FROM "${table}" WHERE bot_id = ?`, [botId]); } catch(e) {}
        }
        dbRun('DELETE FROM bots WHERE id = ?', [botId]);
        res.json({ success: true });
    } catch (error) {
        console.error('Delete bot error:', error);
        res.status(500).json({ error: 'Failed to delete bot' });
    }
});

router.get('/api/bots/:id/klines', requireAuth, async (req, res) => {
    try {
        const bot = dbGet('SELECT * FROM bots WHERE id = ?', [req.params.id]);
        if (!bot) return res.status(404).json({ error: 'Bot not found' });

        const symbol   = req.query.symbol || bot.selected_symbol || 'BTCUSDT';
        const interval = req.query.interval || '15m';
        const limit    = parseInt(req.query.limit) || 500;
        const endTime  = req.query.endTime   ? parseInt(req.query.endTime)   : undefined;
        const startTime = req.query.startTime ? parseInt(req.query.startTime) : undefined;

        const SUB_MINUTE = ['1s', '2s', '5s', '10s', '15s', '30s'];
        if (SUB_MINUTE.includes(interval)) {
            return res.status(400).json({ error: `Interval '${interval}' is not supported by klines endpoint.` });
        }

        // Check Binance IP ban
        if (_binanceBanUntil > Date.now()) {
            return res.status(503).json({ error: 'Binance temporarily unavailable', retryAfter: Math.ceil((_binanceBanUntil - Date.now()) / 1000) });
        }

        const params = { symbol, interval, limit };
        if (endTime)   params.endTime   = endTime;
        if (startTime) params.startTime = startTime;

        const response = await axios.get('https://fapi.binance.com/fapi/v1/klines', { params, timeout: 10000 });
        const klines = response.data.map(k => ({
            time: Math.floor(k[0] / 1000), open: parseFloat(k[1]),
            high: parseFloat(k[2]), low: parseFloat(k[3]),
            close: parseFloat(k[4]), volume: parseFloat(k[5])
        }));

        res.json({ klines, symbol, interval, hasMore: klines.length >= limit });
    } catch (error) {
        const status = error.response?.status;
        if (status === 418 || status === 429) {
            const banMsg = error.response?.data?.msg || '';
            const banMatch = banMsg.match(/until\s+(\d+)/);
            _binanceBanUntil = banMatch ? parseInt(banMatch[1]) : Date.now() + 120_000;
        }
        console.error('Klines error:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to fetch klines' });
    }
});

router.get('/api/bots/:id/chart-data', requireAuth, async (req, res) => {
    try {
        if (_binanceBanUntil > Date.now()) {
            return res.status(503).json({ error: 'Binance temporarily unavailable', retryAfter: Math.ceil((_binanceBanUntil - Date.now()) / 1000) });
        }

        const bot = dbGet('SELECT * FROM bots WHERE id = ?', [req.params.id]);
        if (!bot) return res.status(404).json({ error: 'Bot not found' });

        // Ownership check: admin/moderator or bot owner
        const user = dbGet('SELECT role FROM users WHERE id = ?', [req.session.userId]);
        const isPrivileged = user && (user.role === 'admin' || user.role === 'moderator');
        if (!isPrivileged && bot.user_id !== req.session.userId) {
            const sub = dbGet('SELECT id FROM bot_subscribers WHERE bot_id = ? AND user_id = ?', [bot.id, req.session.userId]);
            if (!sub) return res.status(403).json({ error: 'Access denied' });
        }

        const symbol     = req.query.symbol || bot.selected_symbol || 'BTCUSDT';
        const credPairs  = getBotCredentialPairs(bot);
        if (credPairs.length === 0) return res.status(400).json({ error: 'Bot is not configured with Binance API' });

        // Fetch from all accounts using centralized cache (no duplicate API calls)
        const results = await Promise.allSettled(
            credPairs.map(async (cred) => {
                const raw = await fetchRawBinanceData(cred.apiKey, cred.apiSecret);
                let allOrders = [];
                try { allOrders = await fetchCachedAllOrders(cred.apiKey, cred.apiSecret, symbol); } catch (e) {}
                return { account: raw.account, openOrders: raw.openOrders, allOrders };
            })
        );

        const merged = { positions: [], totalWalletBalance: 0, totalUnrealizedProfit: 0, availableBalance: 0 };
        const mergedOpen = [], mergedAll = [];
        let successCount = 0;
        for (const r of results) {
            if (r.status !== 'fulfilled') continue;
            successCount++;
            const d = r.value;
            merged.totalWalletBalance    += parseFloat(d.account.totalWalletBalance) || 0;
            merged.totalUnrealizedProfit += parseFloat(d.account.totalUnrealizedProfit) || 0;
            merged.availableBalance      += parseFloat(d.account.availableBalance) || 0;
            merged.positions.push(...(d.account.positions || []));
            mergedOpen.push(...(d.openOrders || []));
            mergedAll.push(...(d.allOrders || []));
        }
        if (successCount === 0) return res.status(500).json({ error: 'All Binance accounts failed' });

        const account    = { totalWalletBalance: merged.totalWalletBalance, totalUnrealizedProfit: merged.totalUnrealizedProfit, availableBalance: merged.availableBalance, positions: merged.positions };
        const openOrders = mergedOpen.filter(o => o.symbol === symbol);
        const allOrders  = mergedAll;

        const activePositions    = (account.positions || []).filter(p => p.symbol === symbol && parseFloat(p.positionAmt) !== 0);
        const position          = activePositions[0] || null;
        const stopOrders        = openOrders.filter(o => o.type === 'STOP' || o.type === 'STOP_MARKET' || o.type === 'TRAILING_STOP_MARKET');
        const takeProfitOrders  = openOrders.filter(o => o.type === 'TAKE_PROFIT' || o.type === 'TAKE_PROFIT_MARKET');
        const stopSet           = new Set(stopOrders.map(o => o.orderId));
        const tpSet             = new Set(takeProfitOrders.map(o => o.orderId));
        const limitOrders       = openOrders.filter(o => !stopSet.has(o.orderId) && !tpSet.has(o.orderId));
        const canceledOrders    = allOrders.filter(o => o.status === 'CANCELED');

        let orderHistory = [];
        try {
            canceledOrders.forEach(o => {
                try {
                    const exists = dbGet('SELECT id FROM bot_order_history WHERE bot_id = ? AND order_id = ?', [bot.id, o.orderId]);
                    if (!exists) {
                        const sId = o.symbol ? findStrategyBySymbol(bot.id, o.symbol) : null;
                        dbRun(
                            'INSERT INTO bot_order_history (bot_id, strategy_id, order_id, symbol, side, type, price, stop_price, quantity, status, canceled_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                            [bot.id, sId, o.orderId, o.symbol, o.side, o.type, o.price, o.stopPrice, o.origQty, o.status, new Date(o.updateTime).toISOString()]
                        );
                    }
                } catch (dbErr) { console.error('Error saving order history:', dbErr.message); }
            });
            orderHistory = dbAll('SELECT * FROM bot_order_history WHERE bot_id = ? AND symbol = ? ORDER BY canceled_at DESC LIMIT 50', [bot.id, symbol]);
        } catch (historyError) { console.error('Order history error:', historyError.message); }

        res.json({
            symbol,
            isActive: !!bot.is_active,
            account: {
                totalWalletBalance:    parseFloat(account.totalWalletBalance) || 0,
                totalUnrealizedProfit: parseFloat(account.totalUnrealizedProfit) || 0,
                availableBalance:      parseFloat(account.availableBalance) || 0
            },
            position: position ? {
                symbol:           position.symbol,
                side:             parseFloat(position.positionAmt) > 0 ? 'LONG' : 'SHORT',
                positionAmt:      Math.abs(parseFloat(position.positionAmt)),
                entryPrice:       parseFloat(position.entryPrice),
                markPrice:        parseFloat(position.markPrice),
                unrealizedProfit: parseFloat(position.unrealizedProfit),
                leverage:         position.leverage,
                updateTime:       position.updateTime || null
            } : null,
            positions: activePositions.map(p => ({
                symbol:           p.symbol,
                side:             parseFloat(p.positionAmt) > 0 ? 'LONG' : 'SHORT',
                positionAmt:      Math.abs(parseFloat(p.positionAmt)),
                entryPrice:       parseFloat(p.entryPrice),
                markPrice:        parseFloat(p.markPrice),
                unrealizedProfit: parseFloat(p.unrealizedProfit),
                leverage:         p.leverage,
                updateTime:       p.updateTime || null
            })),
            limitOrders:      limitOrders.map(o => ({ orderId: o.orderId, side: o.side, price: parseFloat(o.price), quantity: parseFloat(o.origQty), time: o.time })),
            stopOrders:       stopOrders.map(o => ({ orderId: o.orderId, side: o.side, stopPrice: parseFloat(o.stopPrice), price: parseFloat(o.price), quantity: parseFloat(o.origQty), type: o.type, time: o.time })),
            takeProfitOrders: takeProfitOrders.map(o => ({ orderId: o.orderId, side: o.side, stopPrice: parseFloat(o.stopPrice), price: parseFloat(o.price), quantity: parseFloat(o.origQty), type: o.type, time: o.time })),
            canceledOrders: orderHistory.map(o => ({ orderId: o.order_id, side: o.side, price: parseFloat(o.price), stopPrice: o.stop_price ? parseFloat(o.stop_price) : null, quantity: parseFloat(o.quantity), type: o.type, canceledAt: o.canceled_at })),
            displaySettings: JSON.parse(bot.display_settings || '{}'),
            tradesCount: (dbGet('SELECT COUNT(*) as c FROM bot_trades WHERE bot_id = ?', [bot.id]) || {}).c || 0
        });

        // Background trade sync (fire-and-forget)
        syncBinanceTrades(bot.id).catch(e => console.log('Background sync:', e.message));
    } catch (error) {
        console.error('Chart data error:', error.response?.data || error.message);
        res.status(500).json({ error: error.response?.data?.msg || 'Failed to fetch chart data' });
    }
});

router.patch('/api/bots/:id/symbol', requireAuth, requireRole('admin', 'moderator'), (req, res) => {
    try {
        const { symbol } = req.body;
        const bot = dbGet('SELECT * FROM bots WHERE id = ?', [req.params.id]);
        if (!bot) return res.status(404).json({ error: 'Bot not found' });
        dbRun('UPDATE bots SET selected_symbol = ? WHERE id = ?', [symbol, req.params.id]);
        res.json({ success: true, symbol });
    } catch (error) {
        console.error('Update symbol error:', error);
        res.status(500).json({ error: 'Failed to update symbol' });
    }
});

router.get('/api/bots/:id/symbols', requireAuth, async (req, res) => {
    try {
        if (_binanceBanUntil > Date.now()) {
            return res.status(503).json({ error: 'Binance temporarily unavailable', retryAfter: Math.ceil((_binanceBanUntil - Date.now()) / 1000) });
        }

        const bot = dbGet('SELECT * FROM bots WHERE id = ?', [req.params.id]);
        if (!bot) return res.status(404).json({ error: 'Bot not found' });

        const response = await axios.get('https://fapi.binance.com/fapi/v1/exchangeInfo');
        const symbols  = response.data.symbols
            .filter(s => s.status === 'TRADING' && s.contractType === 'PERPETUAL')
            .map(s => ({ symbol: s.symbol, baseAsset: s.baseAsset, quoteAsset: s.quoteAsset }))
            .sort((a, b) => a.symbol.localeCompare(b.symbol));

        // Auto-detect active symbol from positions
        let selected = bot.selected_symbol || 'BTCUSDT';
        try {
            const multiCreds = getMultiCredentials(bot);
            let binData;
            if (multiCreds) {
                binData = await fetchMultiAccountFuturesData(multiCreds);
            } else if (bot.binance_api_key && bot.binance_api_secret) {
                binData = await fetchBinanceFuturesData(bot.binance_api_key, bot.binance_api_secret);
            }
            if (binData) {
                const activePos = (binData.positions || []).find(p => parseFloat(p.positionAmt) !== 0);
                if (activePos) {
                    selected = activePos.symbol;
                    if (selected !== (bot.selected_symbol || 'BTCUSDT')) {
                        dbRun('UPDATE bots SET selected_symbol = ? WHERE id = ?', [selected, req.params.id]);
                    }
                }
            }
        } catch (e) { /* keep DB value */ }
        res.json({ symbols, selected });
    } catch (error) {
        console.error('Symbols error:', error);
        res.status(500).json({ error: 'Failed to fetch symbols' });
    }
});

router.get('/api/bots/:id/details', requireAuth, async (req, res) => {
    try {
        const bot = dbGet('SELECT * FROM bots WHERE id = ?', [req.params.id]);
        if (!bot) return res.status(404).json({ error: 'Bot not found' });

        const creator       = dbGet('SELECT id, full_name, avatar FROM users WHERE id = ?', [bot.user_id]);
        let stats           = dbGet('SELECT * FROM bot_stats WHERE bot_id = ? AND strategy_id IS NULL', [req.params.id]);
        if (!stats) stats   = { total_trades: 0, winning_trades: 0, losing_trades: 0, total_pnl: 0, max_drawdown: 0, best_trade: 0, worst_trade: 0, avg_trade_duration: 0 };

        const subscriberCount = dbGet('SELECT COUNT(*) as count FROM bot_subscribers WHERE bot_id = ? AND status = ?', [req.params.id, 'active']);
        const subscription    = dbGet('SELECT * FROM bot_subscribers WHERE bot_id = ? AND user_id = ?', [req.params.id, req.session.userId]);
        const recentTrades    = dbAll('SELECT * FROM bot_trades WHERE bot_id = ? ORDER BY opened_at DESC LIMIT 20', [req.params.id]);
        const instruments     = dbAll('SELECT DISTINCT symbol FROM bot_trades WHERE bot_id = ?', [req.params.id]);

        // Auto-detect active symbol from positions or latest trade
        let activeSymbol = bot.selected_symbol || 'BTCUSDT';
        try {
            const multiCreds = getMultiCredentials(bot);
            let binData;
            if (multiCreds) {
                binData = await fetchMultiAccountFuturesData(multiCreds);
            } else if (bot.binance_api_key && bot.binance_api_secret) {
                binData = await fetchBinanceFuturesData(bot.binance_api_key, bot.binance_api_secret);
            }
            if (binData) {
                const activePos = (binData.positions || []).find(p => parseFloat(p.positionAmt) !== 0);
                if (activePos) {
                    activeSymbol = activePos.symbol;
                } else if (binData.recentTrades?.length > 0) {
                    activeSymbol = binData.recentTrades[0].symbol;
                }
                // Update DB if symbol changed
                if (activeSymbol !== (bot.selected_symbol || 'BTCUSDT')) {
                    dbRun('UPDATE bots SET selected_symbol = ? WHERE id = ?', [activeSymbol, req.params.id]);
                }
            }
        } catch (e) { /* keep existing selected_symbol */ }
        const winRate         = stats.total_trades > 0 ? ((stats.winning_trades / stats.total_trades) * 100).toFixed(1) : 0;
        const days            = Math.floor((new Date() - new Date(bot.created_at)) / (1000 * 60 * 60 * 24));

        res.json({
            bot: {
                id: bot.id, name: bot.name, type: bot.type, pair: bot.pair,
                mode: bot.mode || 'test', accountType: bot.account_type || 'futures',
                investment: bot.investment || 0, profit: bot.profit || 0,
                isActive: !!bot.is_active, createdAt: bot.created_at, runningDays: days,
                selectedSymbol: activeSymbol,
                displaySettings: JSON.parse(bot.display_settings || '{}')
            },
            creator: creator ? { id: creator.id, name: creator.full_name, avatar: creator.avatar } : null,
            stats: {
                totalTrades: stats.total_trades, winningTrades: stats.winning_trades,
                losingTrades: stats.losing_trades, winRate: parseFloat(winRate),
                totalPnl: stats.total_pnl, maxDrawdown: stats.max_drawdown,
                bestTrade: stats.best_trade, worstTrade: stats.worst_trade,
                avgTradeDuration: stats.avg_trade_duration
            },
            subscribers: subscriberCount?.count || 0,
            isSubscribed: !!subscription,
            subscription: subscription ? {
                copyTrades: !!subscription.copy_trades,
                copyPercentage: subscription.copy_percentage,
                maxPositionSize: subscription.max_position_size,
                status: subscription.status
            } : null,
            recentTrades: recentTrades.map(t => ({
                id: t.id, symbol: t.symbol, side: t.side, type: t.type,
                quantity: t.quantity, price: t.price, pnl: t.pnl, pnlPercent: t.pnl_percent,
                status: t.status, openedAt: t.opened_at, closedAt: t.closed_at,
                strategyId: t.strategy_id || null
            })),
            instruments: instruments.map(i => i.symbol),
            strategies: dbAll(
                `SELECT s.*, bs.total_trades, bs.winning_trades, bs.losing_trades, bs.total_pnl
                 FROM bot_strategies s
                 LEFT JOIN bot_stats bs ON bs.strategy_id = s.id AND bs.bot_id = s.bot_id
                 WHERE s.bot_id = ? ORDER BY s.created_at ASC`,
                [req.params.id]
            ).map(s => ({
                id: s.id, strategy: s.strategy, symbol: s.symbol, isActive: !!s.is_active,
                stats: {
                    totalTrades: s.total_trades || 0, winningTrades: s.winning_trades || 0,
                    losingTrades: s.losing_trades || 0, totalPnl: s.total_pnl || 0,
                    winRate: s.total_trades > 0 ? Math.round(((s.winning_trades || 0) / s.total_trades) * 100) : 0
                }
            }))
        });
    } catch (error) {
        console.error('Bot details error:', error);
        res.status(500).json({ error: 'Failed to fetch bot details' });
    }
});

router.post('/api/bots/:id/subscribe', requireAuth, (req, res) => {
    try {
        const bot = dbGet('SELECT * FROM bots WHERE id = ?', [req.params.id]);
        if (!bot) return res.status(404).json({ error: 'Bot not found' });

        const existing = dbGet('SELECT * FROM bot_subscribers WHERE bot_id = ? AND user_id = ?', [req.params.id, req.session.userId]);
        if (existing) return res.status(400).json({ error: 'Already subscribed to this bot' });

        dbRun('INSERT INTO bot_subscribers (bot_id, user_id, copy_trades, copy_percentage, status) VALUES (?, ?, 0, 100, ?)',
            [req.params.id, req.session.userId, 'active']);

        sendUserNotification(req.session.userId, {
            type: 'bot', title: 'Subscribed to Bot',
            message: `You are now following ${bot.name}`, icon: '🤖'
        });

        res.json({ success: true, message: 'Successfully subscribed to bot' });
    } catch (error) {
        console.error('Subscribe error:', error);
        res.status(500).json({ error: 'Failed to subscribe' });
    }
});

router.delete('/api/bots/:id/subscribe', requireAuth, (req, res) => {
    try {
        const subscription = dbGet('SELECT * FROM bot_subscribers WHERE bot_id = ? AND user_id = ?', [req.params.id, req.session.userId]);
        if (!subscription) return res.status(404).json({ error: 'Not subscribed to this bot' });
        dbRun('DELETE FROM bot_subscribers WHERE bot_id = ? AND user_id = ?', [req.params.id, req.session.userId]);
        res.json({ success: true, message: 'Successfully unsubscribed' });
    } catch (error) {
        console.error('Unsubscribe error:', error);
        res.status(500).json({ error: 'Failed to unsubscribe' });
    }
});

router.patch('/api/bots/:id/copy-trading', requireAuth, async (req, res) => {
    try {
        const { enabled, copyPercentage, maxPositionSize, userApiKey, userApiSecret } = req.body;
        const subscription = dbGet('SELECT * FROM bot_subscribers WHERE bot_id = ? AND user_id = ?', [req.params.id, req.session.userId]);
        if (!subscription) return res.status(404).json({ error: 'Not subscribed to this bot' });

        if (userApiKey && userApiSecret) {
            const testResult = await testBinanceCredentials(userApiKey, userApiSecret, 'futures');
            if (!testResult.success) return res.status(400).json({ error: 'Invalid Binance API keys: ' + testResult.error });
            dbRun(
                'UPDATE bot_subscribers SET copy_trades = ?, copy_percentage = ?, max_position_size = ?, user_binance_api_key = ?, user_binance_api_secret = ? WHERE bot_id = ? AND user_id = ?',
                [enabled ? 1 : 0, copyPercentage || 100, maxPositionSize || 0, userApiKey, userApiSecret, req.params.id, req.session.userId]
            );
            const balance = parseFloat(testResult.data?.totalWalletBalance || 0).toFixed(2);
            return res.json({ success: true, copyTrades: enabled, balance });
        }

        dbRun(
            'UPDATE bot_subscribers SET copy_trades = ?, copy_percentage = ?, max_position_size = ? WHERE bot_id = ? AND user_id = ?',
            [enabled ? 1 : 0, copyPercentage || 100, maxPositionSize || 0, req.params.id, req.session.userId]
        );
        res.json({ success: true, copyTrades: enabled });
    } catch (error) {
        console.error('Copy trading error:', error);
        res.status(500).json({ error: 'Failed to update copy trading settings' });
    }
});

router.get('/api/bots/:id/position-blocks', requireAuth, (req, res) => {
    try {
        const { limit = 100, offset = 0, open, strategy_id } = req.query;
        let query = 'SELECT * FROM bot_position_blocks WHERE bot_id = ?';
        const params = [req.params.id];

        if (open === '1') { query += ' AND is_open = 1'; }
        if (strategy_id) { query += ' AND strategy_id = ?'; params.push(parseInt(strategy_id)); }

        let countQuery = 'SELECT COUNT(*) as c FROM bot_position_blocks WHERE bot_id = ?';
        const countParams = [req.params.id];
        if (open === '1') { countQuery += ' AND is_open = 1'; }
        if (strategy_id) { countQuery += ' AND strategy_id = ?'; countParams.push(parseInt(strategy_id)); }
        const total = dbGet(countQuery, countParams);

        query += ' ORDER BY started_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));

        const blocks = dbAll(query, params);

        res.json({
            blocks: blocks.map(b => ({
                id: b.id, symbol: b.symbol, side: b.side,
                tradeCount: b.trade_count, totalQty: b.total_qty,
                avgEntry: b.avg_entry, avgExit: b.avg_exit,
                totalPnl: b.total_pnl, isOpen: !!b.is_open,
                startedAt: b.started_at, endedAt: b.ended_at,
                tradeIds: b.trade_ids,
                strategyId: b.strategy_id || null
            })),
            total: total?.c || 0
        });
    } catch (error) {
        console.error('Position blocks error:', error);
        res.status(500).json({ error: 'Failed to fetch position blocks' });
    }
});

// Trigger rebuild of position blocks (manual)
router.post('/api/bots/:id/rebuild-blocks', requireAuth, requireRole('admin', 'moderator'), (req, res) => {
    try {
        const count = rebuildPositionBlocks(parseInt(req.params.id));
        res.json({ success: true, blocks: count });
    } catch (error) {
        console.error('Rebuild blocks error:', error);
        res.status(500).json({ error: 'Failed to rebuild blocks' });
    }
});

router.post('/api/bots/:id/copy-now', requireAuth, async (req, res) => {
    try {
        const bot = dbGet('SELECT * FROM bots WHERE id = ?', [req.params.id]);
        if (!bot) return res.status(404).json({ error: 'Bot not found' });

        const subscription = dbGet('SELECT * FROM bot_subscribers WHERE bot_id = ? AND user_id = ?', [req.params.id, req.session.userId]);
        if (!subscription) return res.status(403).json({ error: 'Not subscribed to this bot' });

        const { user_binance_api_key: userApiKey, user_binance_api_secret: userApiSecret } = subscription;
        if (!userApiKey || !userApiSecret) return res.status(400).json({ error: 'No Binance API keys saved. Please add your keys in Copy Trading settings.' });
        if (!botHasCredentials(bot)) return res.status(400).json({ error: 'Bot has no Binance API keys configured.' });

        const symbol  = req.body.symbol || bot.selected_symbol || 'BTCUSDT';
        const copyPct = (subscription.copy_percentage || 100) / 100;
        const maxSize = subscription.max_position_size || 0;
        const baseUrl = 'https://fapi.binance.com';

        const userTs   = await getBinanceServerTime('futures');
        const userSign = (qs) => crypto.createHmac('sha256', userApiSecret).update(qs).digest('hex');
        const userPost = async (endpoint, params = {}) => {
            const qs = new URLSearchParams({ ...params, timestamp: userTs }).toString();
            const r  = await axios.post(`${baseUrl}${endpoint}?${qs}&signature=${userSign(qs)}`, null, { headers: { 'X-MBX-APIKEY': userApiKey }, timeout: 10000 });
            return r.data;
        };

        // Fetch open orders from ALL bot accounts (uses centralized cache)
        const allBotOrders = [];
        const credPairs = getBotCredentialPairs(bot);
        await Promise.allSettled(credPairs.map(async (cred) => {
            try {
                const raw = await fetchRawBinanceData(cred.apiKey, cred.apiSecret);
                allBotOrders.push(...(raw.openOrders || []).filter(o => o.symbol === symbol));
            } catch (e) {}
        }));
        const openOrders = allBotOrders;
        if (openOrders.length === 0) return res.json({ success: true, placed: 0, message: 'Bot has no open orders to copy' });

        const placed = [], failed = [];
        for (const o of openOrders) {
            try {
                let qty = parseFloat(o.origQty) * copyPct;
                if (maxSize > 0) {
                    const price  = parseFloat(o.price) || parseFloat(o.stopPrice) || 1;
                    qty = Math.min(qty, maxSize / price);
                }
                qty = Math.floor(qty * 1000) / 1000;
                if (qty <= 0) { failed.push({ orderId: o.orderId, reason: 'Quantity too small' }); continue; }

                const orderParams = { symbol: o.symbol, side: o.side, type: o.type, quantity: qty, timeInForce: o.timeInForce !== 'GTE_GTC' ? (o.timeInForce || 'GTC') : 'GTC' };
                if (o.price && parseFloat(o.price) > 0) orderParams.price = o.price;
                if (o.stopPrice && parseFloat(o.stopPrice) > 0) orderParams.stopPrice = o.stopPrice;
                if (o.activatePrice) orderParams.activatePrice = o.activatePrice;
                if (o.priceRate) orderParams.callbackRate = o.priceRate;
                if (['STOP_MARKET', 'TAKE_PROFIT_MARKET', 'TRAILING_STOP_MARKET'].includes(o.type)) delete orderParams.timeInForce;

                const result = await userPost('/fapi/v1/order', orderParams);
                placed.push({ orderId: result.orderId, type: o.type, side: o.side, qty });
            } catch (err) {
                failed.push({ orderId: o.orderId, reason: err.response?.data?.msg || err.message });
            }
        }

        res.json({ success: true, placed: placed.length, failed: failed.length, details: { placed, failed } });
    } catch (error) {
        console.error('Copy-now error:', error.response?.data || error.message);
        res.status(500).json({ error: error.response?.data?.msg || 'Failed to copy orders' });
    }
});

router.get('/api/bots/:id/trades', requireAuth, (req, res) => {
    try {
        const { limit = 50, offset = 0, status, strategy_id } = req.query;
        let query  = 'SELECT * FROM bot_trades WHERE bot_id = ?';
        const params = [req.params.id];

        if (status) { query += ' AND status = ?'; params.push(status); }
        if (strategy_id) { query += ' AND strategy_id = ?'; params.push(parseInt(strategy_id)); }
        query += ' ORDER BY opened_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));

        const trades = dbAll(query, params);

        let countQuery = 'SELECT COUNT(*) as count FROM bot_trades WHERE bot_id = ?';
        const countParams = [req.params.id];
        if (status) { countQuery += ' AND status = ?'; countParams.push(status); }
        if (strategy_id) { countQuery += ' AND strategy_id = ?'; countParams.push(parseInt(strategy_id)); }
        const total = dbGet(countQuery, countParams);

        res.json({
            trades: trades.map(t => ({
                id: t.id, symbol: t.symbol, side: t.side, type: t.type,
                quantity: t.quantity, price: t.price, pnl: t.pnl, pnlPercent: t.pnl_percent,
                status: t.status, openedAt: t.opened_at, closedAt: t.closed_at,
                positionSide: t.position_side || null,
                binanceTradeId: t.binance_trade_id || null,
                binanceCloseTradeId: t.binance_close_trade_id || null,
                strategyId: t.strategy_id || null
            })),
            total: total?.count || 0
        });

        // Background: check if any open trades are actually closed on Binance
        const bot = dbGet('SELECT binance_api_key FROM bots WHERE id = ?', [req.params.id]);
        if (bot?.binance_api_key) {
            reconcileOpenTrades(req.params.id).catch(e => console.log('Background reconcile:', e.message));
        }
    } catch (error) {
        console.error('Bot trades error:', error);
        res.status(500).json({ error: 'Failed to fetch trades' });
    }
});

router.get('/api/bots/:id/order-history', requireAuth, async (req, res) => {
    try {
        const bot = dbGet('SELECT * FROM bots WHERE id = ?', [req.params.id]);
        if (!bot) return res.status(404).json({ error: 'Bot not found' });

        const credPairs = getBotCredentialPairs(bot);
        if (credPairs.length === 0) {
            // Return DB-only order history
            const dbOrders = dbAll('SELECT * FROM bot_order_history WHERE bot_id = ? ORDER BY canceled_at DESC LIMIT 200', [bot.id]);
            return res.json({
                orders: dbOrders.map(o => ({
                    orderId: o.order_id, symbol: o.symbol, side: o.side, type: o.type,
                    price: parseFloat(o.price) || 0, stopPrice: o.stop_price ? parseFloat(o.stop_price) : null,
                    quantity: parseFloat(o.quantity) || 0, status: o.status,
                    time: o.canceled_at || o.created_at
                }))
            });
        }

        const symbol = req.query.symbol || bot.selected_symbol || 'BTCUSDT';

        // Fetch from all accounts and merge
        const allOrders = [];
        await Promise.allSettled(credPairs.map(async (cred) => {
            try {
                const data = await makeBinanceSignedReq(cred.apiKey, cred.apiSecret, '/fapi/v1/allOrders', { symbol, limit: 500 });
                allOrders.push(...(data || []));
            } catch (e) {}
        }));

        // Save canceled orders to DB for history
        const canceled = allOrders.filter(o => o.status === 'CANCELED');
        for (const o of canceled) {
            try {
                const exists = dbGet('SELECT id FROM bot_order_history WHERE bot_id = ? AND order_id = ?', [bot.id, o.orderId]);
                if (!exists) {
                    const sId = o.symbol ? findStrategyBySymbol(bot.id, o.symbol) : null;
                    dbRun('INSERT INTO bot_order_history (bot_id, strategy_id, order_id, symbol, side, type, price, stop_price, quantity, status, canceled_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                        [bot.id, sId, o.orderId, o.symbol, o.side, o.type, o.price, o.stopPrice, o.origQty, o.status, new Date(o.updateTime).toISOString()]);
                }
            } catch (e) { /* duplicate */ }
        }

        const orders = allOrders.map(o => ({
            orderId: o.orderId,
            symbol: o.symbol,
            side: o.side,
            type: o.type,
            price: parseFloat(o.price) || 0,
            stopPrice: parseFloat(o.stopPrice) || 0,
            avgPrice: parseFloat(o.avgPrice) || 0,
            quantity: parseFloat(o.origQty) || 0,
            executedQty: parseFloat(o.executedQty) || 0,
            status: o.status,
            time: o.time,
            updateTime: o.updateTime
        })).sort((a, b) => b.time - a.time);

        res.json({ orders });
    } catch (error) {
        console.error('Order history error:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to fetch order history' });
    }
});

router.get('/api/bots/:id/orders', requireAuth, async (req, res) => {
    try {
        if (_binanceBanUntil > Date.now()) {
            return res.status(503).json({ error: 'Binance temporarily unavailable', retryAfter: Math.ceil((_binanceBanUntil - Date.now()) / 1000) });
        }

        const bot = dbGet('SELECT * FROM bots WHERE id = ?', [req.params.id]);
        const credPairs = bot ? getBotCredentialPairs(bot) : [];
        if (!bot || credPairs.length === 0) {
            return res.json({ limitOrders: [], stopOrders: [], takeProfitOrders: [] });
        }

        const symbol = req.query.symbol || bot.selected_symbol || 'BTCUSDT';

        // Use centralized cache — no duplicate API calls
        const allOpenOrders = [], allPositions = [];
        await Promise.allSettled(credPairs.map(async (cred) => {
            try {
                const raw = await fetchRawBinanceData(cred.apiKey, cred.apiSecret);
                // Filter openOrders by symbol (raw cache stores ALL open orders)
                allOpenOrders.push(...(raw.openOrders || []).filter(o => o.symbol === symbol));
                // Get positions from account data (equivalent to positionRisk)
                const positions = (raw.account.positions || []).filter(p => p.symbol === symbol && parseFloat(p.positionAmt) !== 0);
                allPositions.push(...positions);
            } catch (e) {}
        }));

        const openOrders       = allOpenOrders;
        const activePositions  = allPositions;  // already filtered by symbol + non-zero in cache consumer
        const posRisk          = activePositions[0] || null;
        const stopOrders       = openOrders.filter(o => o.type === 'STOP' || o.type === 'STOP_MARKET' || o.type === 'TRAILING_STOP_MARKET');
        const takeProfitOrders = openOrders.filter(o => o.type === 'TAKE_PROFIT' || o.type === 'TAKE_PROFIT_MARKET');
        const stopSet          = new Set(stopOrders.map(o => o.orderId));
        const tpSet            = new Set(takeProfitOrders.map(o => o.orderId));
        const limitOrders      = openOrders.filter(o => !stopSet.has(o.orderId) && !tpSet.has(o.orderId));

        const formatPos = (p) => ({
            symbol: p.symbol, side: parseFloat(p.positionAmt) > 0 ? 'LONG' : 'SHORT',
            positionAmt: Math.abs(parseFloat(p.positionAmt)), entryPrice: parseFloat(p.entryPrice),
            markPrice: parseFloat(p.markPrice), unrealizedProfit: parseFloat(p.unRealizedProfit || p.unrealizedProfit),
            leverage: p.leverage, updateTime: p.updateTime || null
        });

        res.json({
            isActive: !!bot.is_active,
            limitOrders:      limitOrders.map(o => ({ orderId: o.orderId, side: o.side, price: parseFloat(o.price), quantity: parseFloat(o.origQty), time: o.time })),
            stopOrders:       stopOrders.map(o => ({ orderId: o.orderId, side: o.side, stopPrice: parseFloat(o.stopPrice), price: parseFloat(o.price), quantity: parseFloat(o.origQty), type: o.type, time: o.time })),
            takeProfitOrders: takeProfitOrders.map(o => ({ orderId: o.orderId, side: o.side, stopPrice: parseFloat(o.stopPrice), price: parseFloat(o.price), quantity: parseFloat(o.origQty), type: o.type, time: o.time })),
            position: posRisk ? formatPos(posRisk) : null,
            positions: activePositions.map(formatPos)
        });
    } catch (error) {
        logBinanceError('Orders poll error:', error);
        res.status(500).json({ error: 'Failed to fetch orders' });
    }
});

router.post('/api/bots/:id/trades', requireAuth, requireRole('admin', 'moderator'), (req, res) => {
    try {
        const { symbol, side, type, quantity, price, pnl, pnlPercent, status, strategy_id } = req.body;
        // Auto-resolve strategy if not provided
        const sId = strategy_id || (symbol ? resolveStrategyId(parseInt(req.params.id), symbol) : null);
        const result = dbRun(
            'INSERT INTO bot_trades (bot_id, strategy_id, symbol, side, type, quantity, price, pnl, pnl_percent, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [req.params.id, sId, symbol, side, type, quantity, price, pnl || 0, pnlPercent || 0, status || 'open']
        );
        updateBotStats(parseInt(req.params.id));
        res.json({ success: true, tradeId: result.lastInsertRowid });
    } catch (error) {
        console.error('Record trade error:', error);
        res.status(500).json({ error: 'Failed to record trade' });
    }
});

router.post('/api/bots/:id/resync-trades', requireAuth, async (req, res) => {
    try {
        const bot = dbGet('SELECT * FROM bots WHERE id = ?', [req.params.id]);
        if (!bot) return res.status(404).json({ error: 'Bot not found' });
        if (!botHasCredentials(bot)) return res.status(400).json({ error: 'Binance API not configured for this bot' });

        const before = dbGet('SELECT COUNT(*) as count FROM bot_trades WHERE bot_id = ?', [req.params.id]);
        dbRun('DELETE FROM bot_trades WHERE bot_id = ?', [req.params.id]);
        dbRun('DELETE FROM bot_position_blocks WHERE bot_id = ?', [req.params.id]);
        dbRun('DELETE FROM bot_stats WHERE bot_id = ?', [req.params.id]);
        saveDatabase();

        const result  = await syncBinanceTrades(req.params.id);
        const total   = dbGet('SELECT COUNT(*) as count FROM bot_trades WHERE bot_id = ?', [req.params.id]);
        const symbols = dbAll('SELECT DISTINCT symbol FROM bot_trades WHERE bot_id = ?', [req.params.id]).map(r => r.symbol);

        try { getIo()?.emit('bot:orders-changed', { botId: req.params.id }); } catch(e) {}

        res.json({ success: true, cleared: before?.count || 0, newSaved: result.saved, total: total?.count || 0, symbols });
    } catch (err) {
        console.error('Resync trades error:', err);
        res.status(500).json({ error: 'Resync failed: ' + err.message });
    }
});

router.post('/api/bots/:id/sync-trades', requireAuth, async (req, res) => {
    try {
        const bot = dbGet('SELECT * FROM bots WHERE id = ?', [req.params.id]);
        if (!bot) return res.status(404).json({ error: 'Bot not found' });
        if (!botHasCredentials(bot)) return res.status(400).json({ error: 'Binance API not configured for this bot' });

        const result  = await syncBinanceTrades(req.params.id);
        const total   = dbGet('SELECT COUNT(*) as count FROM bot_trades WHERE bot_id = ?', [req.params.id]);
        const symbols = dbAll('SELECT DISTINCT symbol FROM bot_trades WHERE bot_id = ?', [req.params.id]).map(r => r.symbol);

        // Emit real-time event so bot-detail pages refresh instantly
        try { getIo()?.emit('bot:orders-changed', { botId: req.params.id }); } catch(e) {}

        res.json({ success: true, newSaved: result.saved, total: total?.count || 0, symbols, scannedSymbols: result.symbols });
    } catch (err) {
        console.error('Sync trades endpoint error:', err);
        res.status(500).json({ error: 'Sync failed: ' + err.message });
    }
});

router.get('/api/bots/:id/trade-markers', requireAuth, async (req, res) => {
    try {
        const bot = dbGet('SELECT * FROM bots WHERE id = ?', [req.params.id]);
        if (!bot) return res.status(404).json({ error: 'Bot not found' });

        const parseSqlDate = (s) => s ? new Date(s.replace(' ', 'T') + (s.endsWith('Z') ? '' : 'Z')) : null;

        const credPairs = getBotCredentialPairs(bot);
        if (credPairs.length === 0) {
            const trades  = dbAll('SELECT * FROM bot_trades WHERE bot_id = ? ORDER BY opened_at DESC LIMIT 500', [bot.id]).reverse();
            const markers = [];
            for (const t of trades) {
                const entryTime = Math.floor((parseSqlDate(t.opened_at)?.getTime() || 0) / 1000);
                const exitTime  = t.closed_at ? Math.floor((parseSqlDate(t.closed_at)?.getTime() || 0) / 1000) : 0;
                if (entryTime > 0) markers.push({ time: entryTime, side: t.side, price: t.price, pnl: 0, isEntry: true, status: t.status, symbol: t.symbol, qty: t.quantity });
                if (exitTime > 0 && t.status === 'closed') markers.push({ time: exitTime, side: t.side, price: t.price, pnl: t.pnl, isEntry: false, status: t.status, symbol: t.symbol, qty: t.quantity });
            }
            markers.sort((a, b) => a.time - b.time);
            return res.json({ markers });
        }

        const symbol = req.query.symbol || bot.selected_symbol || 'BTCUSDT';

        // Fetch from all accounts and merge
        const fills = [];
        await Promise.allSettled(credPairs.map(async (cred) => {
            try {
                const data = await makeBinanceSignedReq(cred.apiKey, cred.apiSecret, '/fapi/v1/userTrades', { symbol, limit: 1000 });
                fills.push(...(data || []));
            } catch (e) {}
        }));

        if (fills.length === 0) {
            const trades  = dbAll('SELECT * FROM bot_trades WHERE bot_id = ? ORDER BY opened_at DESC LIMIT 500', [bot.id]).reverse();
            const markers = [];
            for (const t of trades) {
                const entryTime = Math.floor((parseSqlDate(t.opened_at)?.getTime() || 0) / 1000);
                const exitTime  = t.closed_at ? Math.floor((parseSqlDate(t.closed_at)?.getTime() || 0) / 1000) : 0;
                if (entryTime > 0) markers.push({ time: entryTime, side: t.side, price: t.price, pnl: 0, isEntry: true, status: t.status, symbol: t.symbol, qty: t.quantity });
                if (exitTime > 0 && t.status === 'closed') markers.push({ time: exitTime, side: t.side, price: t.price, pnl: t.pnl, isEntry: false, status: t.status, symbol: t.symbol, qty: t.quantity });
            }
            markers.sort((a, b) => a.time - b.time);
            return res.json({ markers });
        }

        const orderMap = {};
        fills.forEach(f => {
            const oid = f.orderId;
            if (!orderMap[oid]) orderMap[oid] = { orderId: oid, symbol: f.symbol, side: f.side, positionSide: f.positionSide, price: 0, qty: 0, realizedPnl: 0, time: f.time, fills: [] };
            const wt = orderMap[oid];
            wt.qty       += parseFloat(f.qty);
            wt.realizedPnl += parseFloat(f.realizedPnl || 0);
            wt.price = wt.price === 0 ? parseFloat(f.price) : (wt.price * (wt.qty - parseFloat(f.qty)) + parseFloat(f.price) * parseFloat(f.qty)) / wt.qty;
            if (f.time > wt.time) wt.time = f.time;
            wt.fills.push({ price: parseFloat(f.price), qty: parseFloat(f.qty), pnl: parseFloat(f.realizedPnl || 0), time: f.time });
        });

        const orders  = Object.values(orderMap).sort((a, b) => a.time - b.time);
        const markers = orders.map(o => {
            const isBuy = o.side === 'BUY';
            // Determine entry/exit using positionSide (hedge mode is unambiguous)
            let isEntry;
            if (o.positionSide === 'LONG')       isEntry = isBuy;   // LONG+BUY=open, LONG+SELL=close
            else if (o.positionSide === 'SHORT')  isEntry = !isBuy;  // SHORT+SELL=open, SHORT+BUY=close
            else isEntry = Math.abs(o.realizedPnl) < 0.0001;         // BOTH (one-way): use pnl
            const isLong  = o.positionSide === 'LONG' || (o.positionSide === 'BOTH' && isBuy);
            return {
                time: Math.floor(o.time / 1000), closeTime: null,
                side: isLong ? 'LONG' : 'SHORT',
                price: parseFloat(o.price.toFixed(8)),
                pnl: parseFloat(o.realizedPnl.toFixed(4)),
                isEntry, qty: parseFloat(o.qty.toFixed(6)),
                orderId: o.orderId, symbol: o.symbol, status: isEntry ? 'open' : 'closed'
            };
        });

        // Supplement with DB historical trades that predate the Binance fills window
        // (DB is kept current by syncBinanceTrades which now paginates all history)
        const oldestFillMs = fills.length > 0 ? Math.min(...fills.map(f => f.time)) : Date.now();
        const historicalCutoff = new Date(oldestFillMs).toISOString();
        const dbTrades = dbAll(
            'SELECT * FROM bot_trades WHERE bot_id = ? AND symbol = ? AND opened_at < ? ORDER BY opened_at ASC',
            [bot.id, symbol, historicalCutoff]
        );
        for (const t of dbTrades) {
            const entryTime = Math.floor((parseSqlDate(t.opened_at)?.getTime() || 0) / 1000);
            const exitTime  = t.closed_at ? Math.floor((parseSqlDate(t.closed_at)?.getTime() || 0) / 1000) : 0;
            if (entryTime > 0) markers.push({ time: entryTime, side: t.side, price: t.price, pnl: 0, isEntry: true, status: t.status, symbol: t.symbol, qty: t.quantity });
            if (exitTime > 0 && t.status === 'closed') markers.push({ time: exitTime, side: t.side, price: t.price, pnl: t.pnl, isEntry: false, status: t.status, symbol: t.symbol, qty: t.quantity });
        }

        // Filter out zero/invalid markers
        const validMarkers = markers.filter(m => m.time > 0 && m.price && parseFloat(m.price) > 0 && m.qty && parseFloat(m.qty) > 0);
        validMarkers.sort((a, b) => a.time - b.time);
        res.json({ markers: validMarkers });
    } catch (err) {
        console.error('Trade markers error:', err.response?.data || err.message);
        res.json({ markers: [] });
    }
});

// Bot notification settings
router.get('/api/bots/:id/notifications', requireAuth, (req, res) => {
    try {
        const user = dbGet('SELECT telegram_id, telegram_verified FROM users WHERE id = ?', [req.session.userId]);
        let settings = dbGet('SELECT * FROM bot_notification_settings WHERE bot_id = ? AND user_id = ?', [req.params.id, req.session.userId]);

        if (!settings) {
            settings = { notify_new_trade: 1, notify_close_trade: 1, notify_stop_loss: 1, notify_take_profit: 1, notify_position_change: 0, notify_daily_summary: 1, notify_pnl_threshold: 0, notify_method: 'both' };
        }

        res.json({
            settings: {
                newTrade: !!settings.notify_new_trade, closeTrade: !!settings.notify_close_trade,
                stopLoss: !!settings.notify_stop_loss, takeProfit: !!settings.notify_take_profit,
                positionChange: !!settings.notify_position_change, dailySummary: !!settings.notify_daily_summary,
                pnlThreshold: settings.notify_pnl_threshold || 0, method: settings.notify_method || 'both'
            },
            telegram: {
                connected: !!(user?.telegram_id && user?.telegram_verified),
                username: user?.telegram_username || null
            }
        });
    } catch (error) {
        console.error('Get notification settings error:', error);
        res.status(500).json({ error: 'Failed to get notification settings' });
    }
});

router.put('/api/bots/:id/notifications', requireAuth, (req, res) => {
    try {
        const { newTrade, closeTrade, stopLoss, takeProfit, positionChange, dailySummary, pnlThreshold, method } = req.body;
        const existing = dbGet('SELECT * FROM bot_notification_settings WHERE bot_id = ? AND user_id = ?', [req.params.id, req.session.userId]);

        if (existing) {
            dbRun(
                'UPDATE bot_notification_settings SET notify_new_trade = ?, notify_close_trade = ?, notify_stop_loss = ?, notify_take_profit = ?, notify_position_change = ?, notify_daily_summary = ?, notify_pnl_threshold = ?, notify_method = ? WHERE bot_id = ? AND user_id = ?',
                [newTrade ? 1 : 0, closeTrade ? 1 : 0, stopLoss ? 1 : 0, takeProfit ? 1 : 0, positionChange ? 1 : 0, dailySummary ? 1 : 0, pnlThreshold || 0, method || 'both', req.params.id, req.session.userId]
            );
        } else {
            dbRun(
                'INSERT INTO bot_notification_settings (user_id, bot_id, notify_new_trade, notify_close_trade, notify_stop_loss, notify_take_profit, notify_position_change, notify_daily_summary, notify_pnl_threshold, notify_method) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [req.session.userId, req.params.id, newTrade ? 1 : 0, closeTrade ? 1 : 0, stopLoss ? 1 : 0, takeProfit ? 1 : 0, positionChange ? 1 : 0, dailySummary ? 1 : 0, pnlThreshold || 0, method || 'both']
            );
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Update notification settings error:', error);
        res.status(500).json({ error: 'Failed to update notification settings' });
    }
});

// ── Bot stats endpoint (Phase 7) ─────────────────────────────────────────────
router.get('/api/bots/:id/stats', requireAuth, async (req, res) => {
    try {
        const bot = dbGet('SELECT id FROM bots WHERE id = ?', [req.params.id]);
        if (!bot) return res.status(404).json({ error: 'Bot not found' });

        const tf = req.query.timeframe || 'all';
        const strategyId = req.query.strategy_id ? parseInt(req.query.strategy_id) : null;
        const tfMs = { '30m': 30*60*1000, '1h': 60*60*1000, '2h': 2*60*60*1000, '4h': 4*60*60*1000, '1d': 86400000, '7d': 7*86400000 }[tf] || 0;

        let trades;
        let baseQuery = 'SELECT pnl, side FROM bot_trades WHERE bot_id = ? AND status = ?';
        const baseParams = [req.params.id, 'closed'];
        if (strategyId) { baseQuery += ' AND strategy_id = ?'; baseParams.push(strategyId); }

        if (tfMs > 0) {
            const since = new Date(Date.now() - tfMs).toISOString();
            trades = dbAll(baseQuery + ' AND closed_at >= ?', [...baseParams, since]);
        } else {
            trades = dbAll(baseQuery, baseParams);
        }

        const wins = trades.filter(t => parseFloat(t.pnl) > 0);
        const losses = trades.filter(t => parseFloat(t.pnl) <= 0);
        const totalPnl = trades.reduce((s, t) => s + parseFloat(t.pnl || 0), 0);
        const winRate = trades.length > 0 ? (wins.length / trades.length * 100) : 0;
        const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + parseFloat(t.pnl), 0) / wins.length : 0;
        const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + parseFloat(t.pnl), 0) / losses.length) : 0;
        const profitFactor = avgLoss * losses.length > 0 ? (avgWin * wins.length) / (avgLoss * losses.length) : 0;

        res.json({ totalPnl, winRate, avgWin, avgLoss, profitFactor, totalTrades: trades.length, wins: wins.length, losses: losses.length });
    } catch (error) {
        console.error('Stats endpoint error:', error);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

// ── Periodic reconciliation for active bots with open trades ──────────────────
// Runs every 2 minutes: checks all active bots that have open trades and reconciles them
let _reconcileRunning = false;
async function periodicReconcile() {
    if (_reconcileRunning) return;
    _reconcileRunning = true;
    try {
        const botsWithOpen = dbAll(`
            SELECT DISTINCT b.id FROM bots b
            INNER JOIN bot_trades bt ON bt.bot_id = b.id AND bt.status = 'open'
            WHERE (b.binance_api_key IS NOT NULL AND b.binance_api_key != '')
               OR (b.trading_settings LIKE '%multi_credentials%')
        `);
        for (const bot of botsWithOpen) {
            try {
                await reconcileOpenTrades(bot.id);
            } catch (e) {
                console.log(`[periodicReconcile] bot ${bot.id} error:`, e.message);
            }
            // Small delay between bots to avoid rate limits
            await new Promise(r => setTimeout(r, 500));
        }
    } catch (e) {
        console.error('[periodicReconcile] error:', e.message);
    } finally {
        _reconcileRunning = false;
    }
}
setInterval(periodicReconcile, 2 * 60 * 1000); // every 2 minutes
// Run once on startup after a short delay
setTimeout(periodicReconcile, 10000);

// Explicit reconcile endpoint — triggered from frontend when viewing positions
router.post('/api/bots/:id/reconcile', requireAuth, async (req, res) => {
    try {
        const fixed = await reconcileOpenTrades(req.params.id);
        res.json({ success: true, fixed });
    } catch (error) {
        console.error('Reconcile error:', error);
        res.status(500).json({ error: 'Reconcile failed' });
    }
});

module.exports = router;
