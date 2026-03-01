// ─── Timeframe types ──────────────────────────────────────────────────────────

export type Timeframe =
  | '1s' | '2s' | '5s' | '15s' | '30s'   // sub-minute
  | '1m' | '3m' | '5m' | '15m' | '30m'   // minutes
  | '1h' | '2h' | '4h' | '6h' | '12h'   // hours
  | '1d' | '3d' | '1w' | '1M';           // day+

// ─── Chart data ───────────────────────────────────────────────────────────────

export interface CandleData {
  time:   number;  // Unix seconds
  open:   number;
  high:   number;
  low:    number;
  close:  number;
  volume: number;
}

// ─── Binance WebSocket message shapes ─────────────────────────────────────────

export interface BinanceKlineMsg {
  e: 'kline';
  E: number;    // event time ms
  s: string;    // symbol
  k: {
    t: number;  // kline open time ms
    T: number;  // kline close time ms
    s: string;  // symbol
    i: string;  // interval
    o: string;  // open price
    c: string;  // close price
    h: string;  // high price
    l: string;  // low price
    v: string;  // base asset volume
    n: number;  // number of trades
    x: boolean; // is this kline closed?
    q: string;  // quote asset volume
  };
}

export interface BinanceAggTradeMsg {
  e: 'aggTrade';
  E: number;    // event time ms
  s: string;    // symbol
  a: number;    // aggregate trade id
  p: string;    // price
  q: string;    // quantity
  T: number;    // trade time ms
  m: boolean;   // buyer is market maker
}

export type WsConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

// ─── Constants & mappings ─────────────────────────────────────────────────────

/** All timeframes shown in the selector, ordered. */
export const ALL_TIMEFRAMES: readonly Timeframe[] = [
  '1s', '2s', '5s', '15s', '30s',
  '1m', '3m', '5m', '15m', '30m',
  '1h', '2h', '4h', '6h', '12h',
  '1d', '3d', '1w', '1M',
];

/** All sub-minute timeframes. */
export const SUB_MINUTE_TFS = new Set<Timeframe>(['1s', '2s', '5s', '15s', '30s']);

/**
 * Sub-minute TFs that use aggTrade aggregation instead of kline streams.
 *
 * Binance SPOT has a native kline_1s stream, but Binance FUTURES (fapi) does
 * NOT support interval=1s on the REST /klines endpoint or kline_1s WS stream.
 * So ALL sub-minute TFs go through aggTrade on the Futures endpoint.
 */
export const AGG_TRADE_TFS = new Set<Timeframe>(['1s', '2s', '5s', '15s', '30s']);

/** Map our TF to Binance's interval string (only for natively supported TFs). */
export const TF_TO_BINANCE: Readonly<Partial<Record<Timeframe, string>>> = {
  // '1s' intentionally omitted — Futures API does not support 1s klines
  '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m',
  '1h': '1h', '2h': '2h', '4h': '4h', '6h': '6h', '12h': '12h',
  '1d': '1d', '3d': '3d', '1w': '1w', '1M': '1M',
} as const;

/** Duration in seconds for each sub-minute TF (used for candle aggregation). */
export const TF_SECONDS: Readonly<Partial<Record<Timeframe, number>>> = {
  '1s': 1, '2s': 2, '5s': 5, '15s': 15, '30s': 30,
} as const;
