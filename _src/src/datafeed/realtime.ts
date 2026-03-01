/**
 * subscribeBars / unsubscribeBars — real-time price feed for TradingView datafeed.
 * Binance Futures WebSocket streams:
 *   Sub-second: wss://fstream.binance.com/ws/{sym}@aggTrade
 *   Standard:   wss://fstream.binance.com/ws/{sym}@kline_{interval}
 */

import type { Bar, SubscribeBarsCallback, LibrarySymbolInfo, ResolutionString } from '../types/tradingview.d';
import {
  TV_AGG_TRADE_RESOLUTIONS,
  TV_RESOLUTION_TO_BINANCE_INTERVAL,
  TV_RESOLUTION_SECONDS,
} from '../types/binance';

const FSTREAM_WS = 'wss://fstream.binance.com/ws';

// ─── Subscription registry ───────────────────────────────────────────────────

interface Subscription {
  ws:              WebSocket;
  onBar:           SubscribeBarsCallback;
  onResetCache:    () => void;
  /** Current forming bar (for aggTrade sub-second aggregation) */
  currentBar:      Bar | null;
  /** Resolution string for this subscription */
  resolution:      ResolutionString;
  /** Price update listener (optional, for external UI) */
  onPriceUpdate?:  (price: number) => void;
}

const subscriptions = new Map<string, Subscription>();

// ─── Helper: emit a price update if listener is set ──────────────────────────

function emitPrice(sub: Subscription, price: number): void {
  sub.onPriceUpdate?.(price);
}

// ─── aggTrade handler ─────────────────────────────────────────────────────────

interface BinanceAggTradeMsg {
  e: 'aggTrade';
  T: number;   // trade time ms
  p: string;   // price
  q: string;   // quantity
}

function handleAggTrade(sub: Subscription, msg: BinanceAggTradeMsg): void {
  const tfSec  = TV_RESOLUTION_SECONDS[sub.resolution] ?? 1;
  const price  = Number(msg.p);
  const qty    = Number(msg.q);
  const bucket = Math.floor(Math.floor(msg.T / 1000) / tfSec) * tfSec;
  const timeMs = bucket * 1000;

  if (!sub.currentBar || sub.currentBar.time !== timeMs) {
    // New candle bucket — emit the completed previous bar first
    if (sub.currentBar) sub.onBar({ ...sub.currentBar });
    sub.currentBar = { time: timeMs, open: price, high: price, low: price, close: price, volume: qty };
  } else {
    // Update forming bar
    const b = sub.currentBar;
    if (price > b.high) b.high = price;
    if (price < b.low)  b.low  = price;
    b.close    = price;
    b.volume!  += qty;
  }
  sub.onBar({ ...sub.currentBar! });
  emitPrice(sub, price);
}

// ─── kline handler ────────────────────────────────────────────────────────────

interface BinanceKlinePayload {
  t: number; T: number;
  o: string; h: string; l: string; c: string; v: string;
  x: boolean;
}
interface BinanceKlineMsg { e: 'kline'; k: BinanceKlinePayload }

function handleKline(sub: Subscription, msg: BinanceKlineMsg): void {
  const k = msg.k;
  const bar: Bar = {
    time:   k.t,           // open time ms
    open:   Number(k.o),
    high:   Number(k.h),
    low:    Number(k.l),
    close:  Number(k.c),
    volume: Number(k.v),
  };
  sub.onBar(bar);
  emitPrice(sub, Number(k.c));
}

// ─── WebSocket factory ────────────────────────────────────────────────────────

function openWs(streamPath: string, sub: Subscription): WebSocket {
  const ws = new WebSocket(`${FSTREAM_WS}/${streamPath}`);

  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data as string) as BinanceAggTradeMsg | BinanceKlineMsg;
      if (msg.e === 'aggTrade') handleAggTrade(sub, msg as BinanceAggTradeMsg);
      else if (msg.e === 'kline') handleKline(sub, msg as BinanceKlineMsg);
    } catch { /* skip malformed */ }
  };

  ws.onerror = () => console.error('[realtime] WS error on', streamPath);

  ws.onclose = (ev) => {
    if (ev.code !== 1000) {
      // Unexpected close — trigger cache reset so TV will re-request history
      sub.onResetCache();
    }
  };

  return ws;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function subscribeBars(
  symbolInfo:   LibrarySymbolInfo,
  resolution:   ResolutionString,
  onBar:        SubscribeBarsCallback,
  subscriberUID: string,
  onResetCache: () => void,
  onPriceUpdate?: (price: number) => void,
): void {
  // Close any existing subscription with the same UID
  unsubscribeBars(subscriberUID);

  const sym    = (symbolInfo.ticker ?? symbolInfo.name).toUpperCase();
  const isAgg  = TV_AGG_TRADE_RESOLUTIONS.has(resolution);
  const stream = isAgg
    ? `${sym.toLowerCase()}@aggTrade`
    : `${sym.toLowerCase()}@kline_${TV_RESOLUTION_TO_BINANCE_INTERVAL[resolution] ?? '1m'}`;

  const sub: Subscription = {
    onBar,
    onResetCache,
    currentBar:    null,
    resolution,
    onPriceUpdate,
    ws: null as unknown as WebSocket,
  };

  sub.ws = openWs(stream, sub);
  subscriptions.set(subscriberUID, sub);
}

export function unsubscribeBars(subscriberUID: string): void {
  const sub = subscriptions.get(subscriberUID);
  if (!sub) return;
  try { sub.ws.close(1000); } catch { /* ok */ }
  subscriptions.delete(subscriberUID);
}
