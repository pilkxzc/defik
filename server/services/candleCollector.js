'use strict';
const path    = require('path');
const fs      = require('fs');
const initSqlJs = require('sql.js');

const CANDLE_DB_PATH = path.join(__dirname, '..', 'candles.sqlite');

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'ADAUSDT', 'DOGEUSDT', 'DOTUSDT'];
const BINANCE_WS_URL = 'wss://stream.binance.com:9443/stream';
const BINANCE_REST   = 'https://api.binance.com/api/v3';
const BACKFILL_LIMIT = 1000;
const SAVE_INTERVAL  = 30000; // 30 seconds

let db      = null;
let ws      = null;
let saveTimer = null;
let dirty   = false;

// ─── Database ─────────────────────────────────────────────────────────────────

async function initCandleDb() {
    const SQL = await initSqlJs();

    if (fs.existsSync(CANDLE_DB_PATH)) {
        const buf = fs.readFileSync(CANDLE_DB_PATH);
        db = new SQL.Database(buf);
    } else {
        db = new SQL.Database();
    }

    db.run(`
        CREATE TABLE IF NOT EXISTS candle_history (
            symbol    TEXT    NOT NULL,
            timestamp INTEGER NOT NULL,
            open      REAL    NOT NULL,
            high      REAL    NOT NULL,
            low       REAL    NOT NULL,
            close     REAL    NOT NULL,
            volume    REAL    NOT NULL,
            PRIMARY KEY (symbol, timestamp)
        )
    `);

    saveCandleDb();
    console.log('[CandleCollector] Database initialized');
}

function saveCandleDb() {
    if (!db) return;
    try {
        const data = db.export();
        const buffer = Buffer.from(data);
        fs.writeFileSync(CANDLE_DB_PATH, buffer);
    } catch (err) {
        console.error('[CandleCollector] DB save error:', err.message);
    }
}

function periodicSave() {
    if (dirty) {
        saveCandleDb();
        dirty = false;
    }
}

// ─── Insert candle ────────────────────────────────────────────────────────────

function insertCandle(symbol, timestamp, open, high, low, close, volume) {
    if (!db) return;
    try {
        db.run(
            `INSERT OR REPLACE INTO candle_history (symbol, timestamp, open, high, low, close, volume)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [symbol, timestamp, open, high, low, close, volume]
        );
        dirty = true;
    } catch (err) {
        // Silently ignore duplicate key errors
    }
}

// ─── Backfill from REST ───────────────────────────────────────────────────────

async function backfillSymbol(symbol) {
    try {
        const url = `${BINANCE_REST}/klines?symbol=${symbol}&interval=1s&limit=${BACKFILL_LIMIT}`;
        const res = await fetch(url);
        if (!res.ok) {
            console.warn(`[CandleCollector] Backfill failed for ${symbol}: HTTP ${res.status}`);
            return 0;
        }
        const klines = await res.json();
        let count = 0;
        for (const k of klines) {
            const ts = Math.floor(k[0] / 1000);
            insertCandle(symbol, ts, +k[1], +k[2], +k[3], +k[4], +k[5]);
            count++;
        }
        return count;
    } catch (err) {
        console.warn(`[CandleCollector] Backfill error for ${symbol}:`, err.message);
        return 0;
    }
}

async function backfillAll() {
    console.log('[CandleCollector] Starting backfill...');
    for (const sym of SYMBOLS) {
        const count = await backfillSymbol(sym);
        console.log(`[CandleCollector] Backfilled ${count} candles for ${sym}`);
    }
    saveCandleDb();
    dirty = false;
}

// ─── WebSocket ────────────────────────────────────────────────────────────────

function connectWebSocket() {
    let WebSocket;
    try {
        WebSocket = require('ws');
    } catch {
        console.warn('[CandleCollector] ws module not installed — skipping WebSocket connection');
        return;
    }

    const streams = SYMBOLS.map(s => `${s.toLowerCase()}@kline_1s`).join('/');
    const url = `${BINANCE_WS_URL}?streams=${streams}`;

    ws = new WebSocket(url);

    ws.on('open', () => {
        console.log('[CandleCollector] WebSocket connected to Binance');
    });

    ws.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw.toString());
            if (!msg.data || !msg.data.k) return;

            const k = msg.data.k;
            // Only insert closed candles
            if (k.x === true) {
                const ts = Math.floor(k.t / 1000);
                insertCandle(k.s, ts, +k.o, +k.h, +k.l, +k.c, +k.v);
            }
        } catch (err) {
            // Ignore parse errors
        }
    });

    ws.on('close', () => {
        console.log('[CandleCollector] WebSocket closed, reconnecting in 5s...');
        setTimeout(connectWebSocket, 5000);
    });

    ws.on('error', (err) => {
        console.error('[CandleCollector] WebSocket error:', err.message);
    });
}

// ─── Query helpers ────────────────────────────────────────────────────────────

/**
 * Get candle history for a symbol.
 * @param {string} symbol - e.g. 'BTCUSDT'
 * @param {number} [from] - Unix seconds start
 * @param {number} [to] - Unix seconds end
 * @param {number} [limit=500] - Max candles to return
 * @returns {Array<{timestamp, open, high, low, close, volume}>}
 */
function getCandleHistory(symbol, from, to, limit = 500) {
    if (!db) return [];
    try {
        let sql = 'SELECT timestamp, open, high, low, close, volume FROM candle_history WHERE symbol = ?';
        const params = [symbol];

        if (from) { sql += ' AND timestamp >= ?'; params.push(from); }
        if (to)   { sql += ' AND timestamp <= ?'; params.push(to); }

        sql += ' ORDER BY timestamp ASC';
        if (limit) { sql += ' LIMIT ?'; params.push(limit); }

        const stmt = db.prepare(sql);
        stmt.bind(params);
        const results = [];
        while (stmt.step()) {
            results.push(stmt.getAsObject());
        }
        stmt.free();
        return results;
    } catch (err) {
        console.error('[CandleCollector] Query error:', err.message);
        return [];
    }
}

/**
 * Aggregate 1s candles to a coarser timeframe.
 * @param {Array} candles - Array of 1s candle objects
 * @param {number} tfSec - Target timeframe in seconds (e.g. 5, 15, 60)
 * @returns {Array}
 */
function aggregateCandles(candles, tfSec) {
    if (tfSec <= 1) return candles;

    const map = new Map();
    for (const c of candles) {
        const bucket = Math.floor(c.timestamp / tfSec) * tfSec;
        const ex = map.get(bucket);
        if (!ex) {
            map.set(bucket, {
                timestamp: bucket,
                open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume,
            });
        } else {
            if (c.high > ex.high) ex.high = c.high;
            if (c.low  < ex.low)  ex.low  = c.low;
            ex.close   = c.close;
            ex.volume += c.volume;
        }
    }
    return [...map.values()].sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Get metadata about stored candles for a symbol.
 */
function getCandleInfo(symbol) {
    if (!db) return null;
    try {
        const stmt = db.prepare(
            'SELECT MIN(timestamp) as earliest, MAX(timestamp) as latest, COUNT(*) as count FROM candle_history WHERE symbol = ?'
        );
        stmt.bind([symbol]);
        if (stmt.step()) {
            const row = stmt.getAsObject();
            stmt.free();
            return row;
        }
        stmt.free();
        return null;
    } catch (err) {
        return null;
    }
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

async function startCollector() {
    await initCandleDb();
    await backfillAll();
    connectWebSocket();
    saveTimer = setInterval(periodicSave, SAVE_INTERVAL);
    console.log('[CandleCollector] Started');
}

function stopCollector() {
    if (saveTimer) { clearInterval(saveTimer); saveTimer = null; }
    if (ws) { ws.close(); ws = null; }
    if (dirty) saveCandleDb();
    console.log('[CandleCollector] Stopped');
}

module.exports = {
    startCollector,
    stopCollector,
    getCandleHistory,
    aggregateCandles,
    getCandleInfo,
};
