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

// Minimal RSS parser — no deps needed
function parseRSS(xml) {
    const items = [];
    const re = /<item>([\s\S]*?)<\/item>/g;
    let m;
    while ((m = re.exec(xml)) !== null) {
        const b = m[1];
        const val = tag => {
            const r = b.match(new RegExp(
                `<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i'
            ));
            return r ? r[1].trim() : '';
        };
        const title = val('title');
        const guid  = val('guid') || val('link') || title;
        if (title) items.push({
            title, guid,
            description: val('description'),
            pubDate: val('pubDate') || val('dc:date'),
        });
    }
    return items;
}

async function safeFetch(url, opts = {}, timeoutMs = 8000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        return await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json, text/xml, */*',
            },
            ...opts,
            signal: ctrl.signal,
        });
    } finally {
        clearTimeout(t);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Binance  — internal CMS JSON API (more reliable than RSS)
// catalogId 48 = New Listings, 157 = Launchpool, 49 = New Futures
// ─────────────────────────────────────────────────────────────────────────────

async function fetchBinanceCatalog(catalogId) {
    const url = `https://www.binance.com/bapi/composite/v1/public/cms/article/catalog/list/query` +
        `?catalogId=${catalogId}&pageNo=1&pageSize=20&type=1`;
    const res = await safeFetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.code !== '000000') throw new Error(`API code ${json.code}`);
    return (json.data?.articles ?? []).map(a => ({
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
    }));
}

async function fetchBinance() {
    try {
        // Fetch multiple catalogs in parallel, merge and deduplicate
        const [listings, launchpool] = await Promise.allSettled([
            fetchBinanceCatalog(48),   // New Cryptocurrency Listing
            fetchBinanceCatalog(157),  // Launchpool
        ]);
        const items = [
            ...(listings.status   === 'fulfilled' ? listings.value   : []),
            ...(launchpool.status === 'fulfilled' ? launchpool.value : []),
        ];
        const seen = new Set();
        return items.filter(i => seen.has(i.externalId) ? false : seen.add(i.externalId));
    } catch (e) {
        console.error('[NewsCollector] Binance error:', e.message);
        return [];
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Bybit  — public announcements API
// ─────────────────────────────────────────────────────────────────────────────

async function fetchBybit() {
    try {
        const url = 'https://announcements.bybit.com/en-US/api/v2/articles?page=1&limit=30';
        const res = await safeFetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();

        // Try multiple response shapes
        const articles =
            json?.result?.items ??
            json?.result?.list  ??
            json?.data?.list    ??
            json?.data          ??
            json?.items         ??
            [];

        if (!Array.isArray(articles) || articles.length === 0) {
            console.warn('[NewsCollector] Bybit: empty response, keys:', Object.keys(json));
            return [];
        }

        return articles.map(a => ({
            source:     'bybit',
            externalId: `bybit-${a.id ?? a.articleId ?? a.title}`,
            title:      a.title ?? a.articleTitle ?? '',
            excerpt:    stripHtml(a.description ?? a.summary ?? '').slice(0, 400),
            content:    stripHtml(a.content ?? a.description ?? ''),
            category:   guessCategory(a.title ?? ''),
            imageUrl:   a.coverImgUrl ?? a.imgUrl ?? null,
            publishedAt: a.publishTime
                ? new Date(Number(a.publishTime)).toISOString()
                : a.dateTimeISO
                ? new Date(a.dateTimeISO).toISOString()
                : new Date().toISOString(),
        }));
    } catch (e) {
        console.error('[NewsCollector] Bybit error:', e.message);
        return [];
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// OKX  — RSS feed (more reliable than their JSON API)
// ─────────────────────────────────────────────────────────────────────────────

async function fetchOKX() {
    try {
        const res = await safeFetch('https://www.okx.com/help/rss/en-us.xml');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const xml = await res.text();
        return parseRSS(xml).slice(0, 20).map(item => ({
            source:     'okx',
            externalId: `okx-${item.guid}`,
            title:      item.title,
            excerpt:    stripHtml(item.description).slice(0, 400),
            content:    stripHtml(item.description),
            category:   guessCategory(item.title),
            imageUrl:   null,
            publishedAt: item.pubDate
                ? new Date(item.pubDate).toISOString()
                : new Date().toISOString(),
        }));
    } catch (e) {
        console.error('[NewsCollector] OKX error:', e.message);
        return [];
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Persist
// ─────────────────────────────────────────────────────────────────────────────

async function saveItems(items) {
    let saved = 0;
    for (const item of items) {
        if (!item.title || !item.externalId) continue;
        try {
            const exists = dbGet(
                'SELECT id FROM news WHERE external_id = ?',
                [item.externalId]
            );
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
    const all = [
        ...(binance.status === 'fulfilled' ? binance.value : []),
        ...(bybit.status   === 'fulfilled' ? bybit.value   : []),
        ...(okx.status     === 'fulfilled' ? okx.value     : []),
    ];
    console.log(`[NewsCollector] Fetched: Binance=${binance.status==='fulfilled'?binance.value.length:'ERR'} Bybit=${bybit.status==='fulfilled'?bybit.value.length:'ERR'} OKX=${okx.status==='fulfilled'?okx.value.length:'ERR'} (${Date.now()-t}ms)`);
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
