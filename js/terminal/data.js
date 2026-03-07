// ═══════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════
const botId = window.location.pathname.split('/').pop();
let allTrades = [];
let filteredTrades = [];
let currentPeriod = 90;
let calDate = new Date();
let botDetails = null;
let botStats = null;
let liveData = null;
let klineData = [];
let currentTF = '1h';
let isSubscribed = false;
let currentUser = null;
let tradeMarkers = [];
let currentSymbol = new URLSearchParams(window.location.search).get('symbol') || null; // URL param or auto-detect

// ═══════════════════════════════════════════
//  FETCH REAL DATA
// ═══════════════════════════════════════════
async function fetchBotDetails() {
    try {
        const res = await fetch(`/api/bots/${botId}/details`, { credentials: 'include' });
        if (res.ok) {
            botDetails = await res.json();
            isSubscribed = botDetails.isSubscribed || false;
        }
    } catch (e) { console.error('fetchBotDetails:', e); }
}

async function fetchBotStats(timeframe) {
    try {
        const tf = timeframe || 'all';
        const res = await fetch(`/api/bots/${botId}/stats?timeframe=${tf}`, { credentials: 'include' });
        if (res.ok) {
            botStats = await res.json();
        }
    } catch (e) { console.error('fetchBotStats:', e); }
}

async function fetchTrades() {
    try {
        const res = await fetch(`/api/bots/${botId}/trades?limit=10000&offset=0`, { credentials: 'include' });
        if (res.ok) {
            const data = await res.json();
            allTrades = data.trades || [];
        }
    } catch (e) { console.error('fetchTrades:', e); }
}

async function fetchLiveData() {
    try {
        const res = await fetch(`/api/bots/${botId}/data`, { credentials: 'include' });
        if (res.ok) {
            liveData = await res.json();
        }
    } catch (e) { console.error('fetchLiveData:', e); }
}

async function fetchKlines(symbol, interval) {
    try {
        const sym = symbol || getSymbol();
        const intv = interval || currentTF;

        // Sub-minute intervals: fetch 1s klines from Binance directly and aggregate
        const subMinMap = { '1s': 1, '3s': 3, '5s': 5, '15s': 15, '30s': 30 };
        if (subMinMap[intv]) {
            const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=1s&limit=1000`;
            const resp = await fetch(url);
            if (resp.ok) {
                const raw = await resp.json();
                const oneSecCandles = raw.map(k => ({
                    time: Math.floor(k[0] / 1000), open: parseFloat(k[1]),
                    high: parseFloat(k[2]), low: parseFloat(k[3]),
                    close: parseFloat(k[4]), volume: parseFloat(k[5])
                }));
                const bucketSec = subMinMap[intv];
                if (bucketSec === 1) {
                    klineData = oneSecCandles;
                } else {
                    // Aggregate 1s candles into larger buckets
                    const buckets = {};
                    for (const c of oneSecCandles) {
                        const key = Math.floor(c.time / bucketSec) * bucketSec;
                        if (!buckets[key]) {
                            buckets[key] = { time: key, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume };
                        } else {
                            const b = buckets[key];
                            b.high = Math.max(b.high, c.high);
                            b.low = Math.min(b.low, c.low);
                            b.close = c.close;
                            b.volume += c.volume;
                        }
                    }
                    klineData = Object.values(buckets).sort((a, b) => a.time - b.time);
                }
                return;
            }
        }

        const res = await fetch(`/api/bots/${botId}/klines?symbol=${sym}&interval=${intv}&limit=500`, { credentials: 'include' });
        if (res.ok) {
            const data = await res.json();
            klineData = data.klines || data || [];
        }
    } catch (e) { console.error('fetchKlines:', e); }
}

async function fetchCurrentUser() {
    try {
        const res = await fetch('/api/auth/me', { credentials: 'include' });
        if (res.ok) {
            currentUser = await res.json();
        }
    } catch (e) { console.error('fetchCurrentUser:', e); }
}

async function fetchTradeMarkers() {
    try {
        const sym = getSymbol();
        const res = await fetch(`/api/bots/${botId}/trade-markers?symbol=${sym}`, { credentials: 'include' });
        if (res.ok) {
            const data = await res.json();
            tradeMarkers = data.markers || [];
        }
    } catch (e) { console.error('fetchTradeMarkers:', e); }
}

async function syncTrades() {
    try {
        await fetch(`/api/bots/${botId}/sync-trades`, { method: 'POST', credentials: 'include' });
    } catch (e) { /* silent */ }
}

// ═══════════════════════════════════════════
//  SUBSCRIBE / COPY TRADING
// ═══════════════════════════════════════════
async function subscribeToBotAPI() {
    try {
        const res = await fetch(`/api/bots/${botId}/subscribe`, {
            method: 'POST', credentials: 'include',
        });
        return res.ok;
    } catch { return false; }
}

async function unsubscribeFromBotAPI() {
    try {
        const res = await fetch(`/api/bots/${botId}/subscribe`, {
            method: 'DELETE', credentials: 'include',
        });
        return res.ok;
    } catch { return false; }
}

async function enableCopyTrading(apiKey, apiSecret, percentage, maxPosition) {
    try {
        const res = await fetch(`/api/bots/${botId}/copy-trading`, {
            method: 'PATCH', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                enabled: true,
                userApiKey: apiKey,
                userApiSecret: apiSecret,
                copyPercentage: percentage,
                maxPositionSize: maxPosition,
            }),
        });
        if (res.ok) return await res.json();
        const err = await res.json();
        throw new Error(err.error || 'Failed');
    } catch (e) { throw e; }
}

// ═══════════════════════════════════════════
//  TELEGRAM & NOTIFICATIONS
// ═══════════════════════════════════════════
let telegramStatus = null;
let notificationSettings = null;

async function fetchTelegramStatus() {
    try {
        const res = await fetch('/api/telegram/status', { credentials: 'include' });
        if (res.ok) telegramStatus = await res.json();
    } catch (e) { console.error('fetchTelegramStatus:', e); }
}

async function linkTelegram() {
    try {
        const res = await fetch('/api/telegram/link', { method: 'POST', credentials: 'include' });
        if (res.ok) return await res.json();
    } catch (e) { console.error('linkTelegram:', e); }
    return null;
}

async function unlinkTelegram() {
    try {
        const res = await fetch('/api/telegram/unlink', { method: 'POST', credentials: 'include' });
        return res.ok;
    } catch (e) { console.error('unlinkTelegram:', e); return false; }
}

async function testTelegramNotification() {
    try {
        const res = await fetch('/api/telegram/test', { method: 'POST', credentials: 'include' });
        return res.ok;
    } catch (e) { console.error('testTelegram:', e); return false; }
}

async function fetchNotificationSettings() {
    try {
        const res = await fetch(`/api/bots/${botId}/notifications`, { credentials: 'include' });
        if (res.ok) notificationSettings = await res.json();
    } catch (e) { console.error('fetchNotificationSettings:', e); }
}

async function saveNotificationSettings(settings) {
    try {
        const res = await fetch(`/api/bots/${botId}/notifications`, {
            method: 'PUT', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings),
        });
        if (res.ok) { notificationSettings = await res.json(); return true; }
    } catch (e) { console.error('saveNotificationSettings:', e); }
    return false;
}

// ═══════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════
function getSymbol() {
    // User explicitly selected a symbol
    if (currentSymbol) return currentSymbol;

    // Auto-detect: position > trade > instruments > DB
    const positions = liveData?.positions?.filter(p => parseFloat(p.positionAmt || 0) !== 0) || [];
    if (positions.length > 0) return positions[0].symbol;

    if (allTrades.length > 0) {
        const last = allTrades[0];
        if (last.symbol && last.symbol !== 'FUTURES') return last.symbol;
    }

    if (botDetails?.instruments?.length > 0) return botDetails.instruments[0];

    if (botDetails?.bot?.selectedSymbol && botDetails.bot.selectedSymbol !== 'FUTURES') return botDetails.bot.selectedSymbol;
    if (botDetails?.bot?.selected_symbol && botDetails.bot.selected_symbol !== 'FUTURES') return botDetails.bot.selected_symbol;
    if (botDetails?.bot?.pair && botDetails.bot.pair !== 'FUTURES' && botDetails.bot.pair.length > 3) return botDetails.bot.pair;

    return 'BTCUSDT';
}

// All symbols the bot trades (for multi-symbol bots)
function getAllSymbols() {
    const syms = new Set();
    // From positions
    (liveData?.positions || []).forEach(p => {
        if (parseFloat(p.positionAmt || 0) !== 0) syms.add(p.symbol);
    });
    // From trades
    allTrades.forEach(t => { if (t.symbol && t.symbol !== 'FUTURES') syms.add(t.symbol); });
    // From instruments
    (botDetails?.instruments || []).forEach(s => syms.add(s));
    // Fallback
    if (syms.size === 0) {
        const sel = botDetails?.bot?.selectedSymbol || botDetails?.bot?.selected_symbol;
        if (sel && sel !== 'FUTURES') syms.add(sel);
    }
    return [...syms];
}

function getBotName() {
    return botDetails?.bot?.name || 'Bot';
}

function isTestMode() {
    return botDetails?.bot?.isTestMode || botDetails?.bot?.mode === 'test';
}

function getCreator() {
    return botDetails?.creator || null;
}

function getSubscribersCount() {
    return botDetails?.subscribers || botDetails?.subscribersCount || 0;
}

// ── Trade helpers ──
const pnlOf = t => parseFloat(t.pnl || 0);
const isLong = t => t.side === 'BUY' || t.side === 'LONG';
const fmt = v => (v >= 0 ? '+' : '') + '$' + Math.abs(v).toFixed(2);

function applyPeriod() {
    const sym = getSymbol();
    let trades = allTrades.slice();

    // Filter by selected symbol (if bot trades multiple)
    const symbols = getAllSymbols();
    if (symbols.length > 1 && sym) {
        trades = trades.filter(t => t.symbol === sym);
    }

    // Filter by period
    if (currentPeriod !== 0) {
        const cutoff = Date.now() - currentPeriod * 86400000;
        trades = trades.filter(t => new Date(t.closedAt || t.openedAt).getTime() >= cutoff);
    }

    filteredTrades = trades;
    renderAll();
}

function setPeriod(days) {
    currentPeriod = days;
    document.querySelectorAll('.period-pill').forEach(p =>
        p.classList.toggle('active', parseInt(p.dataset.days) === days)
    );
    applyPeriod();
}
