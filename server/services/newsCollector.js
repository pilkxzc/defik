'use strict';

const { dbGet, dbRun, saveDatabase } = require('../db');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function guessCategory(title = '') {
    const t = title.toLowerCase();
    if (t.includes('delist') || t.includes('suspend') || t.includes('restrict') ||
        t.includes('warning') || t.includes('terminat')) return 'alert';
    if (t.includes('launchpool') || t.includes('launchpad') || t.includes('airdrop') ||
        t.includes('listing') || t.includes('will list') || t.includes('will add') ||
        t.includes('new token') || t.includes('jumpstart') || t.includes('megadrop')) return 'market';
    if (t.includes('maintenance') || t.includes('upgrade') || t.includes('migration')) return 'update';
    return 'update';
}

function stripHtml(html = '') {
    return html
        .replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
        .replace(/\s+/g, ' ').trim();
}


async function safeFetch(url, opts = {}, timeoutMs = 10000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        return await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0',
                'Accept': 'application/json, text/xml, application/xml, */*',
                'Accept-Language': 'en-US,en;q=0.9',
            },
            ...opts,
            signal: ctrl.signal,
        });
    } finally {
        clearTimeout(t);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Binance — internal CMS API (all catalog types: listings, delisting,
//           airdrops, activities, maintenance, news, etc.)
// https://www.binance.com/bapi/composite/v1/public/cms/article/list/query
// ─────────────────────────────────────────────────────────────────────────────

async function fetchBinance() {
    try {
        const url = 'https://www.binance.com/bapi/composite/v1/public/cms/article/list/query?type=1&pageNo=1&pageSize=10';
        const res = await safeFetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();

        if (!json.success) throw new Error(`success=false: ${json.message}`);

        const catalogs = json?.data?.catalogs ?? [];
        if (catalogs.length === 0) {
            console.warn('[NewsCollector] Binance: no catalogs in response');
            return [];
        }

        const seen = new Set();
        const result = [];
        for (const catalog of catalogs) {
            for (const a of (catalog.articles ?? [])) {
                if (!a.id || seen.has(a.id)) continue;
                seen.add(a.id);
                result.push({
                    source:     'binance',
                    externalId: `binance-${a.id}`,
                    title:      a.title ?? '',
                    excerpt:    '',
                    content:    '',
                    category:   guessCategory(a.title ?? ''),
                    imageUrl:   null,
                    publishedAt: a.releaseDate
                        ? new Date(Number(a.releaseDate)).toISOString()
                        : new Date().toISOString(),
                });
            }
        }
        return result;
    } catch (e) {
        console.error('[NewsCollector] Binance error:', e.message);
        return [];
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Bybit — official public REST API v5
// https://api.bybit.com/v5/announcements/index
// ─────────────────────────────────────────────────────────────────────────────

async function fetchBybit() {
    try {
        const url = 'https://api.bybit.com/v5/announcements/index?locale=en-US&page=1&limit=30';
        const res = await safeFetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();

        if (json.retCode !== 0) throw new Error(`retCode ${json.retCode}: ${json.retMsg}`);

        const list = json?.result?.list ?? [];
        if (!Array.isArray(list) || list.length === 0) {
            console.warn('[NewsCollector] Bybit: empty list, result keys:', Object.keys(json.result ?? {}));
            return [];
        }

        return list.map(a => ({
            source:     'bybit',
            externalId: `bybit-${a.id ?? a.dateTimestamp ?? a.title}`,
            title:      a.title ?? '',
            excerpt:    stripHtml(a.description ?? '').slice(0, 400),
            content:    stripHtml(a.description ?? ''),
            category:   guessCategory(a.title ?? ''),
            imageUrl:   null,
            publishedAt: a.dateTimestamp
                ? new Date(Number(a.dateTimestamp)).toISOString()
                : new Date().toISOString(),
        }));
    } catch (e) {
        console.error('[NewsCollector] Bybit error:', e.message);
        return [];
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// OKX — official v5 support announcements API
// https://www.okx.com/api/v5/support/announcements
// ─────────────────────────────────────────────────────────────────────────────

async function fetchOKX() {
    try {
        const url = 'https://www.okx.com/api/v5/support/announcements?lang=en-US&limit=30';
        const res = await safeFetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();

        if (json.code !== '0') throw new Error(`code ${json.code}: ${json.msg}`);

        // data[0].details[] contains the actual announcements
        const list = json?.data?.[0]?.details ?? [];
        if (!Array.isArray(list) || list.length === 0) {
            console.warn('[NewsCollector] OKX: empty list');
            return [];
        }

        return list.map(a => ({
            source:     'okx',
            externalId: `okx-${a.url ?? a.title}`,
            title:      a.title ?? '',
            excerpt:    '',
            content:    '',
            category:   guessCategory(a.title ?? ''),
            imageUrl:   null,
            publishedAt: a.pTime
                ? new Date(Number(a.pTime)).toISOString()
                : new Date().toISOString(),
        }));
    } catch (e) {
        console.error('[NewsCollector] OKX error:', e.message);
        return [];
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Persist — skip duplicates by external_id
// ─────────────────────────────────────────────────────────────────────────────

async function saveItems(items) {
    let saved = 0;
    for (const item of items) {
        if (!item.title || !item.externalId) continue;
        try {
            const exists = dbGet('SELECT id FROM news WHERE external_id = ?', [item.externalId]);
            if (exists) continue;
            dbRun(
                `INSERT INTO news
                    (title, excerpt, content, category, image_url, is_published, source, external_id, created_at)
                 VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
                [item.title, item.excerpt, item.content, item.category,
                 item.imageUrl, item.source, item.externalId, item.publishedAt]
            );
            saved++;
        } catch (_) {}
    }
    if (saved > 0) {
        saveDatabase();
        console.log(`[NewsCollector] Saved ${saved} new items`);
    }
    return saved;
}

// ─────────────────────────────────────────────────────────────────────────────
// Scheduler
// ─────────────────────────────────────────────────────────────────────────────

let _interval = null;

async function collect() {
    console.log('[NewsCollector] Collecting...');
    const t = Date.now();

    const [binance, bybit, okx] = await Promise.allSettled([
        fetchBinance(),
        fetchBybit(),
        fetchOKX(),
    ]);

    const counts = {
        Binance: binance.status === 'fulfilled' ? binance.value.length : `ERR(${binance.reason?.message})`,
        Bybit:   bybit.status   === 'fulfilled' ? bybit.value.length   : `ERR(${bybit.reason?.message})`,
        OKX:     okx.status     === 'fulfilled' ? okx.value.length     : `ERR(${okx.reason?.message})`,
    };
    console.log(`[NewsCollector] Fetched: Binance=${counts.Binance} Bybit=${counts.Bybit} OKX=${counts.OKX} (${Date.now()-t}ms)`);

    const all = [
        ...(binance.status === 'fulfilled' ? binance.value : []),
        ...(bybit.status   === 'fulfilled' ? bybit.value   : []),
        ...(okx.status     === 'fulfilled' ? okx.value     : []),
    ];
    await saveItems(all);
}

function startNewsCollector() {
    console.log('[NewsCollector] Starting — interval 30 min');
    collect().catch(err => console.error('[NewsCollector] Initial collect error:', err));
    _interval = setInterval(
        () => collect().catch(err => console.error('[NewsCollector] Collect error:', err)),
        30 * 60 * 1000
    );
}

function stopNewsCollector() {
    if (_interval) { clearInterval(_interval); _interval = null; }
}

async function collectNow() {
    return collect();
}

module.exports = { startNewsCollector, stopNewsCollector, collectNow };
