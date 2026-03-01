/**
 * getBars — historical kline fetcher for TradingView datafeed.
 * Binance Futures REST endpoints:
 *   Standard:   GET /fapi/v1/klines
 *   Sub-second: GET /fapi/v1/aggTrades  (aggregated into candles)
 */

import type { Bar, HistoryCallback, ErrorCallback, LibrarySymbolInfo, PeriodParams, ResolutionString } from '../types/tradingview.d';
import {
  TV_AGG_TRADE_RESOLUTIONS,
  TV_RESOLUTION_TO_BINANCE_INTERVAL,
  TV_RESOLUTION_SECONDS,
} from '../types/binance';

const FAPI = 'https://fapi.binance.com/fapi/v1';
const MAX_KLINES = 1500;  // Binance Futures max per request

// ─── aggTrade aggregation ─────────────────────────────────────────────────────

interface RawAggTrade { T: number; p: string; q: string }

function aggregateToCandles(trades: RawAggTrade[], tfSec: number): Bar[] {
  const map = new Map<number, Bar>();
  for (const { T, p, q } of trades) {
    const bucket = Math.floor(Math.floor(T / 1000) / tfSec) * tfSec;
    const price  = Number(p);
    const qty    = Number(q);
    const bar    = map.get(bucket);
    if (!bar) {
      map.set(bucket, { time: bucket * 1000, open: price, high: price, low: price, close: price, volume: qty });
    } else {
      if (price > bar.high) bar.high = price;
      if (price < bar.low)  bar.low  = price;
      bar.close   = price;
      bar.volume! += qty;
    }
  }
  return [...map.values()].sort((a, b) => a.time - b.time);
}

async function fetchAggTradeHistory(symbol: string, tfSec: number, from: number, to: number): Promise<Bar[]> {
  const allTrades: RawAggTrade[] = [];
  let endTime = to * 1000;
  const startMs = from * 1000;

  for (let page = 0; page < 20; page++) {
    const url = `${FAPI}/aggTrades?symbol=${symbol}&endTime=${endTime}&limit=1000`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`aggTrades HTTP ${res.status}`);
    const batch = await res.json() as (RawAggTrade & { a: number })[];
    if (!batch.length) break;

    allTrades.unshift(...batch);
    const oldest = batch[0].T;
    if (oldest <= startMs) break;
    endTime = oldest - 1;
  }

  return aggregateToCandles(allTrades.filter(t => t.T >= startMs && t.T <= to * 1000), tfSec);
}

// ─── Standard kline history ───────────────────────────────────────────────────

function parseKlines(raw: [number, string, string, string, string, string, ...unknown[]][]): Bar[] {
  return raw.map(([t, o, h, l, c, v]) => ({
    time:   t,           // ms — TradingView expects ms for bars
    open:   Number(o),
    high:   Number(h),
    low:    Number(l),
    close:  Number(c),
    volume: Number(v),
  }));
}

async function fetchKlineHistory(symbol: string, interval: string, from: number, to: number, countBack: number): Promise<Bar[]> {
  const allBars: Bar[] = [];
  let endTime = to * 1000;
  const startMs = from * 1000;
  const remaining = { count: countBack };

  for (let page = 0; page < 20; page++) {
    const limit = Math.min(remaining.count + 10, MAX_KLINES);
    const url   = `${FAPI}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}&endTime=${endTime}`;
    const res   = await fetch(url);
    if (!res.ok) throw new Error(`klines HTTP ${res.status}`);
    const raw   = await res.json() as [number, string, string, string, string, string, ...unknown[]][];
    if (!raw.length) break;

    const bars = parseKlines(raw);
    // Prepend since we're going backward
    allBars.unshift(...bars);
    endTime = raw[0][0] - 1;  // oldest bar time minus 1ms

    remaining.count -= bars.length;
    if (remaining.count <= 0 || raw[0][0] <= startMs) break;
  }

  return allBars.filter(b => b.time >= startMs && b.time <= to * 1000);
}

// ─── Local history API ───────────────────────────────────────────────────────

async function fetchLocalHistory(symbol: string, tfSec: number, from: number, to: number): Promise<Bar[] | null> {
  try {
    const tfMap: Record<number, string> = {
      1: '1s', 5: '5s', 15: '15s', 30: '30s', 60: '1m', 300: '5m',
      900: '15m', 1800: '30m', 3600: '1h', 14400: '4h', 86400: '1d',
    };
    const tfStr = tfMap[tfSec];
    if (!tfStr) return null;

    const url = `/api/market/history/${symbol}?timeframe=${tfStr}&from=${from}&to=${to}&limit=1500`;
    const res = await fetch(url);
    if (!res.ok) return null;

    const data = await res.json() as { candles: { time: number; open: number; high: number; low: number; close: number; volume: number }[] };
    if (!data.candles || data.candles.length === 0) return null;

    return data.candles.map(c => ({
      time: c.time * 1000,  // TradingView expects ms
      open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume,
    }));
  } catch {
    return null;
  }
}

// ─── Public getBars ───────────────────────────────────────────────────────────

export async function getBars(
  symbolInfo:   LibrarySymbolInfo,
  resolution:   ResolutionString,
  periodParams: PeriodParams,
  onResult:     HistoryCallback,
  onError:      ErrorCallback,
): Promise<void> {
  const { from, to, countBack } = periodParams;
  const symbol = symbolInfo.ticker ?? symbolInfo.name;

  try {
    let bars: Bar[];

    // Try local history API first
    const tfSec = TV_RESOLUTION_SECONDS[resolution] ?? 60;
    const localBars = await fetchLocalHistory(symbol, tfSec, from, to);
    if (localBars && localBars.length > 0) {
      bars = localBars;
    } else if (TV_AGG_TRADE_RESOLUTIONS.has(resolution)) {
      bars = await fetchAggTradeHistory(symbol, tfSec, from, to);
    } else {
      const interval = TV_RESOLUTION_TO_BINANCE_INTERVAL[resolution];
      if (!interval) { onError(`Unsupported resolution: ${resolution}`); return; }
      bars = await fetchKlineHistory(symbol, interval, from, to, countBack);
    }

    if (!bars.length) {
      onResult([], { noData: true });
      return;
    }
    onResult(bars, { noData: false });
  } catch (err) {
    onError(err instanceof Error ? err.message : String(err));
  }
}
