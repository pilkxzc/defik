'use strict';

const { dbGet, dbRun, saveDatabase } = require('../db');

// ── Source definitions ──────────────────────────────────────────────────────

const SOURCES = {
    binance: { name: 'Binance', color: '#F0B90B' },
    bybit:   { name: 'Bybit',   color: '#F7A600' },
    okx:     { name: 'OKX',     color: '#FFFFFF' },
};

// Guess news category from announcement title
function guessCategory(title, source) {
    const t = title.toLowerCase();
    if (t.includes('delist') || t.includes('suspend') || t.includes('restrict') ||
        t.includes('warning') || t.includes('caution')) return 'alert';
    if (t.includes('launchpool') || t.includes('launchpad') || t.includes('airdrop') ||
        t.includes('listing') || t.includes('will list') || t.includes('will add') ||
        t.includes('new token') || t.includes('token launch') || t.includes('jumpstart')) return 'market';
    if (t.includes('maintenance') || t.includes('update') || t.includes('upgrade') ||
        t.includes('system') || t.includes('migration')) return 'update';
    return 'update';
}

// Strip HTML tags and decode common entities
function stripHtml(html = '') {
    return html
        .replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
        .replace(/\s+/g, ' ').trim();
}

// Minimal RSS/Atom XML parser — no external deps
function parseRSS(xml) {
    const items = [];
    const re = /<item>([\s\S]*?)<\/item>/g;
    let m;
    while ((m = re.exec(xml)) !== null) {
        const block = m[1];
        const val = (tag) => {
            const r = block.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i'));
            return r ? r[1].trim() : '';
        };
        const title = val('title');
        const link  = val('link') || val('guid');
        const desc  = val('description');
        const date  = val('pubDate') || val('dc:date');
        const guid  = val('guid') || link || title;
        if (title) items.push({ title, link, description: desc, pubDate: date, guid });
    }
    return items;
}

// ── Fetch helpers ───────────────────────────────────────────────────────────

async function fetchWithTimeout(url, opts = {}, timeoutMs = 15000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...opts, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

const COMMON_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (compatible; YamatoNewsBot/1.0)',
    'Accept': 'application/json, application/xml, text/xml, */*',
};

// ── Binance ─────────────────────────────────────────────────────────────────
// Public RSS feed: https://www.binance.com/en/support/announcement/rss

async function fetchBinance() {
    try {
        const res = await fetchWithTimeout(
            'https://www.binance.com/en/support/announcement/rss',
            { headers: COMMON_HEADERS }
        );
        if (!res.ok) return [];
        const xml = await res.text();
        return parseRSS(xml).slice(0, 30).map(item => ({
            source:     'binance',
            externalId: item.guid,
            title:      item.title,
            excerpt:    stripHtml(item.description).slice(0, 400),
            content:    stripHtml(item.description),
            category:   guessCategory(item.title, 'binance'),
            imageUrl:   null,
            publishedAt: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
        }));
    } catch (e) {
        console.error('[NewsCollector] Binance error:', e.message);
        return [];
    }
}

// ── Bybit ───────────────────────────────────────────────────────────────────
// Public announcements API

async function fetchBybit() {
    try {
        const url = 'https://announcements.bybit.com/en-US/api/v2/articles?page=1&limit=30';
        const res = await fetchWithTimeout(url, { headers: COMMON_HEADERS });
        if (!res.ok) return [];
        const data = await res.json();
        // Different response shapes from different API versions
        const articles = data?.result?.items ?? data?.items ?? data?.data ?? [];
        return articles.slice(0, 30).map(item => ({
            source:     'bybit',
            externalId: String(item.id ?? item.articleId ?? item.title),
            title:      item.title ?? item.articleTitle ?? '',
            excerpt:    stripHtml(item.description ?? item.summary ?? '').slice(0, 400),
            content:    stripHtml(item.content ?? item.description ?? ''),
            category:   guessCategory(item.title ?? '', 'bybit'),
            imageUrl:   item.coverImgUrl ?? item.imgUrl ?? null,
            publishedAt: item.publishTime
                ? new Date(Number(item.publishTime)).toISOString()
                : item.dateTimestamp
                ? new Date(Number(item.dateTimestamp) * 1000).toISOString()
                : new Date().toISOString(),
        }));
    } catch (e) {
        console.error('[NewsCollector] Bybit error:', e.message);
        return [];
    }
}

// ── OKX ─────────────────────────────────────────────────────────────────────
// Public announcements RSS / JSON feed

async function fetchOKX() {
    try {
        // OKX public blog API (known working endpoint)
        const url = 'https://www.okx.com/api/v5/support/announcements?page=1&limit=30';
        const res = await fetchWithTimeout(url, { headers: COMMON_HEADERS });
        if (!res.ok) return [];
        const data = await res.json();
        const articles = data?.data ?? data?.items ?? [];
        if (!Array.isArray(articles) || articles.length === 0) return [];
        return articles.slice(0, 30).map(item => ({
            source:     'okx',
            externalId: String(item.id ?? item.articleId ?? item.title ?? Math.random()),
            title:      item.title ?? item.name ?? '',
            excerpt:    stripHtml(item.summary ?? item.description ?? '').slice(0, 400),
            content:    stripHtml(item.content ?? item.summary ?? ''),
            category:   guessCategory(item.title ?? '', 'okx'),
            imageUrl:   item.coverImgUrl ?? item.imgUrl ?? null,
            publishedAt: item.publishTime
                ? new Date(Number(item.publishTime)).toISOString()
                : new Date().toISOString(),
        }));
    } catch (e) {
        // OKX endpoint may not always be reachable — not a hard error
        return [];
    }
}

// ── Persist to DB ───────────────────────────────────────────────────────────

async function saveItems(items) {
    let saved = 0;
    for (const item of items) {
        if (!item.title || !item.externalId) continue;
        try {
            const exists = dbGet(
                'SELECT id FROM news WHERE external_id = ? AND source = ?',
                [item.externalId, item.source]
            );
            if (exists) continue;

            dbRun(
                `INSERT INTO news (title, excerpt, content, category, image_url, is_published, source, external_id, created_at)
                 VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
                [
                    item.title, item.excerpt, item.content,
                    item.category, item.imageUrl,
                    item.source, item.externalId, item.publishedAt,
                ]
            );
            saved++;
        } catch (e) {
            // Skip duplicate or constraint errors silently
        }
    }
    if (saved > 0) {
        saveDatabase();
        console.log(`[NewsCollector] Saved ${saved} new items`);
    }
    return saved;
}

// ── Scheduler ───────────────────────────────────────────────────────────────

let _interval = null;

async function collect() {
    const results = await Promise.allSettled([
        fetchBinance(),
        fetchBybit(),
        fetchOKX(),
    ]);
    const all = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
    await saveItems(all);
}

function startNewsCollector() {
    console.log('[NewsCollector] Starting — interval 30 min');
    // Run immediately on start, then every 30 min
    collect().catch(err => console.error('[NewsCollector] Initial collect error:', err));
    _interval = setInterval(
        () => collect().catch(err => console.error('[NewsCollector] Collect error:', err)),
        30 * 60 * 1000
    );
}

function stopNewsCollector() {
    if (_interval) { clearInterval(_interval); _interval = null; }
}

// Manual trigger (for admin panel)
async function collectNow() {
    return collect();
}

module.exports = { startNewsCollector, stopNewsCollector, collectNow, SOURCES };
