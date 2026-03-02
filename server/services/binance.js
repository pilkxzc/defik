'use strict';
const axios  = require('axios');
const crypto = require('crypto');

// Retry config
const RETRY_MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY   = 1000; // ms
const RETRYABLE_CODES    = new Set([408, 429, 500, 502, 503, 504]);

/**
 * Retry wrapper with exponential backoff + jitter.
 * Only retries on network errors and retryable HTTP status codes.
 * Auth errors (4xx except 408/429) are never retried.
 */
async function withRetry(fn, { maxAttempts = RETRY_MAX_ATTEMPTS, baseDelay = RETRY_BASE_DELAY } = {}) {
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            const status = error.response?.status;

            // Don't retry client errors (except timeout/rate-limit/server errors)
            if (status && !RETRYABLE_CODES.has(status)) {
                throw error;
            }

            if (attempt === maxAttempts) break;

            const delay = baseDelay * Math.pow(2, attempt - 1) + Math.random() * 500;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    throw lastError;
}

async function getBinanceServerTime(accountType = 'futures') {
    try {
        const baseUrl  = accountType === 'futures' ? 'https://fapi.binance.com' : 'https://api.binance.com';
        const endpoint = accountType === 'futures' ? '/fapi/v1/time' : '/api/v3/time';
        const response = await withRetry(() => axios.get(`${baseUrl}${endpoint}`, { timeout: 5000 }));
        return response.data.serverTime;
    } catch (error) {
        console.error('Failed to get Binance server time, using local time:', error.message);
        return Date.now();
    }
}

async function testBinanceCredentials(apiKey, apiSecret, accountType = 'futures') {
    try {
        const baseUrl   = accountType === 'futures' ? 'https://fapi.binance.com' : 'https://api.binance.com';
        const timestamp = await getBinanceServerTime(accountType);
        const queryString = `timestamp=${timestamp}`;
        const signature   = crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');
        const endpoint    = accountType === 'futures' ? '/fapi/v2/account' : '/api/v3/account';

        const response = await withRetry(() => axios.get(`${baseUrl}${endpoint}?${queryString}&signature=${signature}`, {
            headers: { 'X-MBX-APIKEY': apiKey }
        }));

        return { success: true, data: response.data };
    } catch (error) {
        console.error('Binance test error:', error.response?.data || error.message);
        return { success: false, error: error.response?.data?.msg || error.message };
    }
}

async function fetchBinanceFuturesData(apiKey, apiSecret) {
    try {
        const baseUrl  = 'https://fapi.binance.com';
        const timestamp = await getBinanceServerTime('futures');

        const createSignature = (queryString) =>
            crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');

        const makeRequest = async (endpoint, params = {}) => {
            const queryString = new URLSearchParams({ ...params, timestamp }).toString();
            const signature   = createSignature(queryString);
            const response    = await withRetry(() => axios.get(`${baseUrl}${endpoint}?${queryString}&signature=${signature}`, {
                headers: { 'X-MBX-APIKEY': apiKey },
                timeout: 10000
            }));
            return response.data;
        };

        const account = await makeRequest('/fapi/v2/account');
        const positions  = account.positions?.filter(p => parseFloat(p.positionAmt) !== 0) || [];
        const openOrders = await makeRequest('/fapi/v1/openOrders');

        let recentTrades = [];
        try { recentTrades = await makeRequest('/fapi/v1/userTrades', { limit: 50 }); } catch(e) {}

        let incomeHistory = [];
        try { incomeHistory = await makeRequest('/fapi/v1/income', { limit: 100 }); } catch(e) {}

        const limitOrders      = openOrders.filter(o => o.type === 'LIMIT');
        const stopOrders       = openOrders.filter(o => o.type.includes('STOP'));
        const takeProfitOrders = openOrders.filter(o => o.type.includes('TAKE_PROFIT'));

        return {
            account: {
                totalWalletBalance:    parseFloat(account.totalWalletBalance) || 0,
                totalUnrealizedProfit: parseFloat(account.totalUnrealizedProfit) || 0,
                totalMarginBalance:    parseFloat(account.totalMarginBalance) || 0,
                availableBalance:      parseFloat(account.availableBalance) || 0
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
            openOrders: openOrders.map(o => ({
                symbol:   o.symbol,
                side:     o.side,
                type:     o.type,
                price:    parseFloat(o.price),
                quantity: parseFloat(o.origQty),
                status:   o.status,
                time:     o.time
            })),
            limitOrders: limitOrders.map(o => ({
                symbol:   o.symbol,
                side:     o.side,
                price:    parseFloat(o.price),
                quantity: parseFloat(o.origQty),
                status:   o.status,
                time:     o.time
            })),
            stopOrders: stopOrders.map(o => ({
                symbol:    o.symbol,
                side:      o.side,
                stopPrice: parseFloat(o.stopPrice),
                quantity:  parseFloat(o.origQty),
                type:      o.type,
                status:    o.status,
                time:      o.time
            })),
            takeProfitOrders: takeProfitOrders.map(o => ({
                symbol:    o.symbol,
                side:      o.side,
                stopPrice: parseFloat(o.stopPrice),
                quantity:  parseFloat(o.origQty),
                type:      o.type,
                status:    o.status,
                time:      o.time
            })),
            recentTrades: recentTrades.slice(0, 20).map(t => ({
                symbol:      t.symbol,
                side:        t.side,
                price:       parseFloat(t.price),
                quantity:    parseFloat(t.qty),
                realizedPnl: parseFloat(t.realizedPnl),
                time:        t.time
            })),
            incomeHistory: incomeHistory.slice(0, 50).map(i => ({
                symbol:     i.symbol,
                incomeType: i.incomeType,
                income:     parseFloat(i.income),
                time:       i.time,
                info:       i.info
            }))
        };
    } catch (error) {
        console.error('Binance data fetch error:', error.response?.data || error.message);
        throw new Error(error.response?.data?.msg || 'Failed to fetch Binance data');
    }
}

module.exports = { getBinanceServerTime, testBinanceCredentials, fetchBinanceFuturesData };
