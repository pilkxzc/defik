'use strict';
const express = require('express');
const router  = express.Router();

const { getCandleHistory, aggregateCandles, getCandleInfo } = require('../services/candleCollector');

// Timeframe string → seconds
const TF_MAP = {
    '1s': 1, '5s': 5, '15s': 15, '30s': 30,
    '1m': 60, '5m': 300, '15m': 900, '30m': 1800,
    '1h': 3600, '4h': 14400, '1d': 86400,
};

/**
 * GET /api/market/history/:symbol
 * Query params:
 *   from      - Unix seconds (optional)
 *   to        - Unix seconds (optional)
 *   timeframe - e.g. '1s', '5s', '1m', '15m' (default '1s')
 *   limit     - max candles (default 500)
 */
router.get('/api/market/history/:symbol', (req, res) => {
    try {
        const symbol    = req.params.symbol.toUpperCase();
        const from      = req.query.from  ? parseInt(req.query.from)  : undefined;
        const to        = req.query.to    ? parseInt(req.query.to)    : undefined;
        const limit     = req.query.limit ? parseInt(req.query.limit) : 500;
        const timeframe = req.query.timeframe || '1s';
        const tfSec     = TF_MAP[timeframe] || 1;

        // Fetch raw 1s candles
        const raw = getCandleHistory(symbol, from, to, tfSec <= 1 ? limit : limit * tfSec);

        if (!raw.length) {
            return res.json({ symbol, timeframe, candles: [] });
        }

        // Aggregate if needed
        const candles = tfSec > 1 ? aggregateCandles(raw, tfSec).slice(-limit) : raw.slice(-limit);

        res.json({
            symbol,
            timeframe,
            count: candles.length,
            candles: candles.map(c => ({
                time:   c.timestamp,
                open:   c.open,
                high:   c.high,
                low:    c.low,
                close:  c.close,
                volume: c.volume,
            })),
        });
    } catch (err) {
        console.error('[History API] Error:', err);
        res.status(500).json({ error: 'Failed to fetch candle history' });
    }
});

/**
 * GET /api/market/history/:symbol/info
 * Returns metadata about stored candles for a symbol.
 */
router.get('/api/market/history/:symbol/info', (req, res) => {
    try {
        const symbol = req.params.symbol.toUpperCase();
        const info   = getCandleInfo(symbol);

        if (!info || !info.count) {
            return res.json({ symbol, earliest: null, latest: null, count: 0 });
        }

        res.json({
            symbol,
            earliest: info.earliest,
            latest:   info.latest,
            count:    info.count,
        });
    } catch (err) {
        console.error('[History API] Info error:', err);
        res.status(500).json({ error: 'Failed to fetch candle info' });
    }
});

module.exports = router;
