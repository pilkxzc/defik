/**
 * Binance datafeed for KLineChart Pro.
 * Implements KLineChart Pro's Datafeed interface via Binance REST + WebSocket.
 */

const BINANCE_FAPI = 'https://fapi.binance.com/fapi/v1';
const BINANCE_SPOT = 'https://api.binance.com/api/v3';

export interface KLineData {
  timestamp: number; // ms
  open:      number;
  high:      number;
  low:       number;
  close:     number;
  volume?:   number;
}

export interface SymbolInfo {
  ticker:         string;
  shortName?:     string;
  pricePrecision?: number;
}

export interface Period {
  multiplier: number;
  timespan:   'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year';
  text:       string;
}

type DatafeedSubscribeCallback = (data: KLineData) => void;

/** Map a KLineChart Pro Period → Binance REST interval string. */
function periodToInterval(period: Period): string | null {
  const { multiplier, timespan } = period;
  switch (timespan) {
    case 'second': return multiplier === 1 ? '1s' : null;
    case 'minute': return `${multiplier}m`;
    case 'hour':   return `${multiplier}h`;
    case 'day':    return `${multiplier}d`;
    case 'week':   return '1w';
    case 'month':  return '1M';
    default:       return null;
  }
}

function parseBinanceKlines(
  raw: [number, string, string, string, string, string, ...unknown[]][],
): KLineData[] {
  return raw.map(([t, o, h, l, c, v]) => ({
    timestamp: t,
    open: +o, high: +h, low: +l, close: +c, volume: +v,
  }));
}

export interface DatafeedCallbacks {
  onPriceUpdate?:  (price: string) => void;
  onStatusUpdate?: (status: string) => void;
}

export interface BinanceDatafeed {
  getHistoryKLineData(symbol: SymbolInfo, period: Period, from: number, to: number): Promise<KLineData[]>;
  subscribe(symbol: SymbolInfo, period: Period, callback: DatafeedSubscribeCallback): void;
  unsubscribe(symbol: SymbolInfo, period: Period): void;
  searchSymbols(search?: string): Promise<SymbolInfo[]>;
  /** Close all open WebSocket connections (call before rebuilding chart). */
  disconnectAll(): void;
}

export function createBinanceDatafeed(callbacks: DatafeedCallbacks = {}): BinanceDatafeed {
  const { onPriceUpdate, onStatusUpdate } = callbacks;
  const wsMap = new Map<string, WebSocket>();

  function wsKey(symbol: SymbolInfo, period: Period): string {
    return `${symbol.ticker.toLowerCase()}|${period.timespan}|${period.multiplier}`;
  }

  function openWS(
    url: string,
    key: string,
    callback: DatafeedSubscribeCallback,
  ): WebSocket {
    const ws = new WebSocket(url);

    ws.onopen  = () => onStatusUpdate?.('connected');
    ws.onerror = () => onStatusUpdate?.('error');

    ws.onclose = () => {
      onStatusUpdate?.('disconnected');
      // Auto-reconnect if still registered
      if (wsMap.has(key)) {
        setTimeout(() => {
          if (!wsMap.has(key)) return;
          onStatusUpdate?.('connecting');
          const newWs = openWS(url, key, callback);
          wsMap.set(key, newWs);
        }, 3000);
      }
    };

    ws.onmessage = (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data as string) as Record<string, unknown>;
        if (msg['e'] === 'kline') {
          const k = msg['k'] as Record<string, unknown>;
          callback({
            timestamp: k['t'] as number,
            open:  +(k['o'] as string),
            high:  +(k['h'] as string),
            low:   +(k['l'] as string),
            close: +(k['c'] as string),
            volume: +(k['v'] as string),
          });
          onPriceUpdate?.(k['c'] as string);
        } else if (msg['e'] === 'aggTrade') {
          // 1s chart: aggregate ticks into 1s candles
          const ts = Math.floor((msg['T'] as number) / 1000) * 1000;
          const price = msg['p'] as string;
          callback({
            timestamp: ts,
            open: +price, high: +price, low: +price, close: +price,
            volume: +(msg['q'] as string),
          });
          onPriceUpdate?.(price);
        }
      } catch { /* ok */ }
    };

    return ws;
  }

  return {
    async getHistoryKLineData(
      symbol: SymbolInfo,
      period: Period,
      from:   number,
      to:     number,
    ): Promise<KLineData[]> {
      const ticker   = symbol.ticker;
      const interval = periodToInterval(period);
      if (!interval) return [];

      // 1s candles → Binance Spot; everything else → Binance Futures
      const base = period.timespan === 'second' ? BINANCE_SPOT : BINANCE_FAPI;
      const url  = `${base}/klines?symbol=${ticker}&interval=${interval}&startTime=${from}&endTime=${to}&limit=500`;

      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const raw = await res.json() as [number, string, string, string, string, string, ...unknown[]][];
        return parseBinanceKlines(raw);
      } catch (err) {
        console.error('[BinanceDatafeed] getHistoryKLineData:', err);
        return [];
      }
    },

    subscribe(
      symbol:   SymbolInfo,
      period:   Period,
      callback: DatafeedSubscribeCallback,
    ): void {
      const key = wsKey(symbol, period);

      // Close any existing connection for this key
      const existing = wsMap.get(key);
      if (existing) { existing.onclose = null; existing.close(); wsMap.delete(key); }

      const ticker   = symbol.ticker.toLowerCase();
      const interval = periodToInterval(period);
      if (!interval) return;

      // Stream selection:
      //   1s  → aggTrade on Spot WebSocket
      //   1m+ → kline stream on Futures WebSocket
      let streamUrl: string;
      if (period.timespan === 'second' && period.multiplier === 1) {
        streamUrl = `wss://stream.binance.com:9443/ws/${ticker}@aggTrade`;
      } else {
        streamUrl = `wss://fstream.binance.com/ws/${ticker}@kline_${interval}`;
      }

      onStatusUpdate?.('connecting');
      const ws = openWS(streamUrl, key, callback);
      wsMap.set(key, ws);
    },

    unsubscribe(symbol: SymbolInfo, period: Period): void {
      const key = wsKey(symbol, period);
      const ws  = wsMap.get(key);
      if (ws) {
        ws.onclose = null; // prevent auto-reconnect
        ws.close();
        wsMap.delete(key);
      }
      onStatusUpdate?.('disconnected');
    },

    // Required by KLineChart Pro Datafeed interface.
    // Returns empty list — symbol search is handled by the market panel in datedos.html.
    async searchSymbols(_search?: string): Promise<SymbolInfo[]> {
      return [];
    },

    disconnectAll(): void {
      wsMap.forEach((ws) => {
        try { ws.onclose = null; ws.close(); } catch { /* ok */ }
      });
      wsMap.clear();
      onStatusUpdate?.('disconnected');
    },
  };
}
