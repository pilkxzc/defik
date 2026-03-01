import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import {
  createChart,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type CandlestickSeriesOptions,
  type SeriesMarker,
} from 'lightweight-charts';

import type {
  BinanceAggTradeMsg,
  BinanceKlineMsg,
  CandleData,
  Timeframe,
  WsConnectionStatus,
} from '../types/binance';
import { AGG_TRADE_TFS, SUB_MINUTE_TFS, TF_SECONDS, TF_TO_BINANCE } from '../types/binance';

import { useBinanceWs }   from '../hooks/useBinanceWs';
import { useKlineBuffer } from '../hooks/useKlineBuffer';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Binance Futures REST — used for 1m+ timeframes */
const BINANCE_REST      = 'https://fapi.binance.com/fapi/v1';
/** Binance Spot REST — used for sub-minute history (supports native 1s klines) */
const BINANCE_SPOT_REST = 'https://api.binance.com/api/v3';

const HIST_LIMIT  = 500;  // initial kline load (standard TFs)
const MORE_LIMIT  = 500;  // each loadMore page

/**
 * Trigger loadMore only when the user scrolls this many bars PAST the first
 * data point. Negative = the user has genuinely scrolled beyond the left edge.
 */
const LOAD_MORE_THRESHOLD = -30;

/**
 * How many 1-second Spot klines to fetch for sub-minute TF history.
 * 1000 × 1s = ~16 min of 1s data → 200 candles at 5s, 66 at 15s, 33 at 30s.
 */
const SUB_MINUTE_1S_LIMIT = 1000;

/**
 * Futures aggTrades fallback: max pages and target time window.
 * 50 pages × 1000 trades ÷ 50 trades/s avg = ~1000 seconds = plenty of history.
 * The loop exits early once AGG_TARGET_MS of history is collected.
 */
const AGG_MAX_PAGES  = 50;
const AGG_TARGET_MS  = 5 * 60 * 1000; // 5 minutes

// ─── Chart options ────────────────────────────────────────────────────────────

const CHART_OPTS = {
  layout: {
    background: { color: '#141414' },
    textColor:  '#A1A1A1',
    fontSize:   11,
  },
  grid: {
    vertLines: { color: 'rgba(255,255,255,0.04)', style: LineStyle.Solid },
    horzLines: { color: 'rgba(255,255,255,0.04)', style: LineStyle.Solid },
  },
  crosshair: { mode: CrosshairMode.Normal },
  rightPriceScale: { borderColor: 'rgba(255,255,255,0.08)' },
  timeScale: {
    borderColor:    'rgba(255,255,255,0.08)',
    timeVisible:    true,
    secondsVisible: false,
    rightOffset:    12,
  },
  handleScroll: { vertTouchDrag: false },
} as const;

const SERIES_OPTS: Partial<CandlestickSeriesOptions> = {
  upColor:         '#10B981',
  downColor:       '#EF4444',
  borderUpColor:   '#10B981',
  borderDownColor: '#EF4444',
  wickUpColor:     '#10B981',
  wickDownColor:   '#EF4444',
};

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function asTime(unixSec: number): Time { return unixSec as Time; }

function parseRestCandles(
  raw: [number, string, string, string, string, string, ...unknown[]][],
): CandleData[] {
  return raw
    .map(([t, o, h, l, c, v]) => ({
      time: Math.floor(t / 1000), open: +o, high: +h, low: +l, close: +c, volume: +v,
    }))
    .sort((a, b) => a.time - b.time);
}

function aggregateTrades(
  trades: { T: number; p: string; q: string }[],
  tfSec: number,
): CandleData[] {
  const map = new Map<number, CandleData>();
  for (const { T, p, q } of trades) {
    const bucket = Math.floor(Math.floor(T / 1000) / tfSec) * tfSec;
    const price = +p, qty = +q;
    const c = map.get(bucket);
    if (!c) {
      map.set(bucket, { time: bucket, open: price, high: price, low: price, close: price, volume: qty });
    } else {
      if (price > c.high) c.high = price;
      if (price < c.low)  c.low  = price;
      c.close   = price;
      c.volume += qty;
    }
  }
  return [...map.values()].sort((a, b) => a.time - b.time);
}

/**
 * Aggregate 1-second candles up to a coarser timeframe (e.g. 1s → 5s).
 * Groups candles into buckets of `tfSec` seconds aligned to Unix epoch.
 */
function aggregateCandlesByTf(candles: CandleData[], tfSec: number): CandleData[] {
  if (tfSec <= 1) return candles;
  const map = new Map<number, CandleData>();
  for (const c of candles) {
    const bucket = Math.floor(c.time / tfSec) * tfSec;
    const ex = map.get(bucket);
    if (!ex) {
      map.set(bucket, { time: bucket, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume });
    } else {
      if (c.high > ex.high) ex.high = c.high;
      if (c.low  < ex.low)  ex.low  = c.low;
      ex.close   = c.close;
      ex.volume += c.volume;
    }
  }
  return [...map.values()].sort((a, b) => a.time - b.time);
}

/**
 * Fetch sub-minute TF history.
 *
 * Strategy (two-layer):
 *  1. Try Binance Spot 1s klines — one REST call, up to 1000 × 1-second bars,
 *     then aggregate to the target TF.  Works in most regions.
 *  2. Fallback: paginate Binance Futures aggTrades (up to AGG_MAX_PAGES pages,
 *     stopping early once AGG_TARGET_MS of history is collected).  Works even
 *     when the Spot API is geo-blocked because it uses the same fapi domain as
 *     the rest of the app.
 */
async function fetchSubMinuteHistory(
  sym: string,
  tfSec: number,
  signal: AbortSignal,
): Promise<CandleData[]> {
  // ── Attempt 0: Local candle history API ──────────────────────────────────
  try {
    const tfMap: Record<number, string> = { 1: '1s', 5: '5s', 15: '15s', 30: '30s', 60: '1m' };
    const tfStr = tfMap[tfSec] || '1s';
    const res = await fetch(
      `/api/market/history/${sym}?timeframe=${tfStr}&limit=${SUB_MINUTE_1S_LIMIT}`,
      { signal },
    );
    if (res.ok) {
      const data = await res.json() as { candles: { time: number; open: number; high: number; low: number; close: number; volume: number }[] };
      if (data.candles && data.candles.length > 0) {
        return data.candles.map(c => ({
          time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume,
        }));
      }
    }
  } catch {
    if ((signal as AbortSignal & { aborted?: boolean }).aborted) throw new DOMException('Aborted', 'AbortError');
    // Fall through to Binance
  }

  // ── Attempt 1: Spot 1s klines ────────────────────────────────────────────
  try {
    const res = await fetch(
      `${BINANCE_SPOT_REST}/klines?symbol=${sym}&interval=1s&limit=${SUB_MINUTE_1S_LIMIT}`,
      { signal },
    );
    if (res.ok) {
      const raw = await res.json() as [number, string, string, string, string, string, ...unknown[]][];
      const oneSecCandles = parseRestCandles(raw);
      if (oneSecCandles.length > 0) {
        return tfSec === 1 ? oneSecCandles : aggregateCandlesByTf(oneSecCandles, tfSec);
      }
    }
  } catch {
    if ((signal as AbortSignal & { aborted?: boolean }).aborted) throw new DOMException('Aborted', 'AbortError');
    // Fall through to aggTrades
  }

  // ── Attempt 2: Futures aggTrades pagination ───────────────────────────────
  let endTime    = Date.now();
  const wantFrom = endTime - AGG_TARGET_MS;
  const allTrades: { T: number; p: string; q: string }[] = [];

  for (let page = 0; page < AGG_MAX_PAGES; page++) {
    const res = await fetch(
      `${BINANCE_REST}/aggTrades?symbol=${sym}&endTime=${endTime}&limit=1000`,
      { signal },
    );
    if (!res.ok) throw new Error(`aggTrades HTTP ${res.status}`);
    const batch = await res.json() as { T: number; p: string; q: string; a: number }[];
    if (!batch.length) break;

    allTrades.unshift(...batch);

    const oldest = batch[0].T;
    if (oldest <= wantFrom) break;   // collected enough history
    endTime = oldest - 1;
  }

  return aggregateTrades(allTrades, tfSec);
}

/** Write candle array to series (strips volume — CandlestickSeries has no volume). */
function setSeriesData(series: ISeriesApi<'Candlestick'> | null, candles: CandleData[]): void {
  if (!series || !candles.length) return;
  try {
    series.setData(
      candles.map(({ time, open, high, low, close }) => ({ time: asTime(time), open, high, low, close })),
    );
  } catch (e) {
    console.error('[YamatoChart] setData error:', e);
  }
}

// ─── Price precision helpers ───────────────────────────────────────────────────

/**
 * Compute the ideal number of decimal places for a given price.
 * Returns a precision that makes sense for the magnitude of the asset.
 */
function calcPrecision(price: number): number {
  if (price >= 10_000) return 2;
  if (price >= 1_000)  return 2;
  if (price >= 100)    return 3;
  if (price >= 10)     return 4;
  if (price >= 1)      return 5;
  if (price >= 0.1)    return 6;
  if (price >= 0.001)  return 7;
  return 8;
}

function applyPriceFormat(
  series: ISeriesApi<'Candlestick'> | null,
  precision: number,
): void {
  if (!series) return;
  const minMove = parseFloat((10 ** -precision).toFixed(precision));
  try {
    series.applyOptions({ priceFormat: { type: 'price', precision, minMove } });
  } catch { /* ok */ }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface ChartWidgetHandle {
  setSymbol:         (s:  string)                                    => void;
  setTimeframe:      (tf: Timeframe)                                 => void;
  addTradeMarker:    (side: 'buy' | 'sell', price: number, label?: string) => void;
  clearTradeMarkers: ()                                              => void;
  /** Set price decimal precision. Pass 0 for auto-detect from current price. */
  setPriceDecimals:  (n: number)                                     => void;
}

interface Props {
  initialSymbol?:    string;
  initialTimeframe?: Timeframe;
  /** Called whenever the live price changes (raw string from Binance). */
  onPriceUpdate?:   (raw: string)               => void;
  /** Called whenever the WebSocket connection status changes. */
  onStatusUpdate?:  (status: WsConnectionStatus) => void;
  /** Called with `true` when history fetch starts, `false` when done. */
  onLoadingChange?: (loading: boolean)           => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

const ChartWidgetInner = forwardRef<ChartWidgetHandle, Props>(
  (
    {
      initialSymbol    = 'BTCUSDT',
      initialTimeframe = '15m',
      onPriceUpdate,
      onStatusUpdate,
      onLoadingChange,
    },
    ref,
  ) => {
    // ── Minimal React state ───────────────────────────────────────────────────
    const [symbol,    setSymbol]    = useState<string>(initialSymbol);
    const [timeframe, setTimeframe] = useState<Timeframe>(initialTimeframe);

    // ── Chart lives in refs — never in state (zero re-renders in hot path) ───
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef     = useRef<IChartApi | null>(null);
    const seriesRef    = useRef<ISeriesApi<'Candlestick'> | null>(null);
    const lastPriceRef = useRef<string>('');

    // ── Trade markers ─────────────────────────────────────────────────────────
    const markersRef = useRef<SeriesMarker<Time>[]>([]);

    // ── Price precision (0 = auto-detect from price, >0 = manual) ────────────
    const manualDecimalsRef = useRef<number>(0);
    const lastSetPrecision  = useRef<number>(-1);

    // ── Pagination ────────────────────────────────────────────────────────────
    const allCandlesRef    = useRef<CandleData[]>([]);
    const oldestTimeMsRef  = useRef<number>(0);
    const isLoadingMoreRef = useRef<boolean>(false);
    const hasMoreRef       = useRef<boolean>(true);
    const sessionRef       = useRef<number>(0);
    const abortCtrlRef     = useRef<AbortController | null>(null);

    // ── Stable refs for callbacks inside async/subscribed contexts ────────────
    const symbolRef    = useRef(symbol);
    const timeframeRef = useRef(timeframe);
    symbolRef.current    = symbol;
    timeframeRef.current = timeframe;

    // Store callbacks in refs so they never cause re-renders when the parent
    // re-renders with new function instances.
    const onPriceUpdateRef   = useRef(onPriceUpdate);
    const onStatusUpdateRef  = useRef(onStatusUpdate);
    const onLoadingChangeRef = useRef(onLoadingChange);
    onPriceUpdateRef.current   = onPriceUpdate;
    onStatusUpdateRef.current  = onStatusUpdate;
    onLoadingChangeRef.current = onLoadingChange;

    // ── Sub-minute aggregator ─────────────────────────────────────────────────
    const { processAggTrade, reset: resetBuffer } = useKlineBuffer(timeframe);
    const isAggTrade = AGG_TRADE_TFS.has(timeframe);

    // ── Imperative API exposed to vanilla JS ──────────────────────────────────
    useImperativeHandle(ref, () => ({
      setSymbol:    (s)  => setSymbol(s.toUpperCase()),
      setTimeframe: (tf) => setTimeframe(tf),

      addTradeMarker: (side, price, label) => {
        const time = Math.floor(Date.now() / 1000) as Time;
        const marker: SeriesMarker<Time> = {
          time,
          position: side === 'buy' ? 'belowBar' : 'aboveBar',
          shape:    side === 'buy' ? 'arrowUp'  : 'arrowDown',
          color:    side === 'buy' ? '#10B981'  : '#EF4444',
          text:     label ?? `${side === 'buy' ? 'Buy' : 'Sell'} $${price.toFixed(2)}`,
          size: 1,
        };
        const updated = [...markersRef.current, marker]
          .sort((a, b) => (a.time as number) - (b.time as number));
        markersRef.current = updated;
        try { seriesRef.current?.setMarkers(updated); } catch { /* ok */ }
      },

      clearTradeMarkers: () => {
        markersRef.current = [];
        try { seriesRef.current?.setMarkers([]); } catch { /* ok */ }
      },

      setPriceDecimals: (n: number) => {
        manualDecimalsRef.current = n; // 0 = auto
        const precision = n > 0 ? n : calcPrecision(parseFloat(lastPriceRef.current) || 1);
        lastSetPrecision.current = precision;
        applyPriceFormat(seriesRef.current, precision);
      },
    }), []);

    // ── Show/hide the HTML loading-more indicator (DOM direct, no setState) ───
    const showLoadingMore = useCallback((show: boolean): void => {
      const el = document.getElementById('loadingMoreIndicator');
      if (el) el.style.display = show ? 'flex' : 'none';
    }, []);

    // ── Sync chart canvas to container size ───────────────────────────────────
    const syncSize = useCallback((): void => {
      const el = containerRef.current;
      const ch = chartRef.current;
      if (!el || !ch) return;
      const w = el.clientWidth  || el.offsetWidth;
      const h = el.clientHeight || el.offsetHeight;
      if (w > 0 && h > 0) try { ch.applyOptions({ width: w, height: h }); } catch { /* ok */ }
    }, []);

    // ── fitContent — deferred so ResizeObserver applies real size first ───────
    const fitContent = useCallback((): void => {
      requestAnimationFrame(() => {
        try { chartRef.current?.timeScale().fitContent(); } catch { /* ok */ }
      });
    }, []);

    // ── Lazy-load historical candles when user scrolls past left edge ─────────
    const loadMore = useCallback(async (): Promise<void> => {
      if (
        isLoadingMoreRef.current       ||
        !hasMoreRef.current            ||
        oldestTimeMsRef.current === 0     // still doing initial load
      ) return;

      const tf = timeframeRef.current;
      if (AGG_TRADE_TFS.has(tf)) return; // no REST klines for custom TFs

      isLoadingMoreRef.current = true;
      showLoadingMore(true);

      try {
        const sym      = symbolRef.current;
        const endTime  = oldestTimeMsRef.current - 1;
        const interval = TF_TO_BINANCE[tf] ?? '1m';

        const res = await fetch(
          `${BINANCE_REST}/klines?symbol=${sym}&interval=${interval}&limit=${MORE_LIMIT}&endTime=${endTime}`,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const raw = await res.json() as [number, string, string, string, string, string, ...unknown[]][];

        if (!raw.length) { hasMoreRef.current = false; return; }
        if (raw.length < MORE_LIMIT) hasMoreRef.current = false;

        const newCandles  = parseRestCandles(raw);
        const existingSet = new Set(allCandlesRef.current.map(c => c.time));
        const unique      = newCandles.filter(c => !existingSet.has(c.time));
        if (!unique.length) { hasMoreRef.current = false; return; }

        const merged = [...unique, ...allCandlesRef.current].sort((a, b) => a.time - b.time);
        allCandlesRef.current   = merged;
        oldestTimeMsRef.current = merged[0].time * 1000;

        const chart  = chartRef.current;
        const series = seriesRef.current;
        if (!chart || !series) return;

        // Save scroll position — setData resets it — then restore shifted by #new
        let savedRange: { from: number; to: number } | null = null;
        try { savedRange = chart.timeScale().getVisibleLogicalRange(); } catch { /* ok */ }

        setSeriesData(series, merged);

        if (savedRange) {
          try {
            chart.timeScale().setVisibleLogicalRange({
              from: savedRange.from + unique.length,
              to:   savedRange.to   + unique.length,
            });
          } catch { /* ok */ }
        }
      } catch (err) {
        console.error('[YamatoChart] loadMore failed:', err);
      } finally {
        isLoadingMoreRef.current = false;
        showLoadingMore(false);
      }
    }, [showLoadingMore]);

    // ── Init LightweightCharts instance (once on mount) ───────────────────────
    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;

      const w = el.clientWidth  || el.offsetWidth  || 800;
      const h = el.clientHeight || el.offsetHeight || 500;
      const chart  = createChart(el, { ...CHART_OPTS, width: w, height: h });
      const series = chart.addCandlestickSeries(SERIES_OPTS);
      chartRef.current  = chart;
      seriesRef.current = series;

      // Auto-resize when container changes dimensions
      const ro = new ResizeObserver(([entry]) => {
        if (!entry || !chartRef.current) return;
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          try { chartRef.current.applyOptions({ width, height }); } catch { /* ok */ }
        }
      });
      ro.observe(el);

      // Trigger history pagination when user scrolls past the leftmost candle
      chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (range && range.from < LOAD_MORE_THRESHOLD) void loadMore();
      });

      return () => {
        ro.disconnect();
        chartRef.current  = null;
        seriesRef.current = null;
        try { chart.remove(); } catch { /* ok */ }
      };
    }, [loadMore]);

    // ── Update secondsVisible when timeframe changes ──────────────────────────
    useEffect(() => {
      try {
        chartRef.current?.applyOptions({
          timeScale: { secondsVisible: SUB_MINUTE_TFS.has(timeframe) },
        });
      } catch { /* ok */ }
    }, [timeframe]);

    // ── Price update — hot path, no React setState ────────────────────────────
    const updatePrice = useCallback((raw: string): void => {
      if (raw === lastPriceRef.current) return;
      lastPriceRef.current = raw;
      onPriceUpdateRef.current?.(raw);

      // Auto-apply precision once per symbol load (only when not manually set)
      if (manualDecimalsRef.current === 0) {
        const price     = parseFloat(raw);
        const precision = calcPrecision(price);
        if (precision !== lastSetPrecision.current) {
          lastSetPrecision.current = precision;
          applyPriceFormat(seriesRef.current, precision);
        }
      }
    }, []);

    // ── Load initial history ──────────────────────────────────────────────────
    const loadHistory = useCallback(async (sym: string, tf: Timeframe): Promise<void> => {
      abortCtrlRef.current?.abort();
      const ctrl = new AbortController();
      abortCtrlRef.current = ctrl;

      const session = ++sessionRef.current;

      onLoadingChangeRef.current?.(true);
      allCandlesRef.current   = [];
      oldestTimeMsRef.current = 0;
      hasMoreRef.current      = !AGG_TRADE_TFS.has(tf);

      // Reset auto-precision so it re-detects from the new symbol's price
      if (manualDecimalsRef.current === 0) lastSetPrecision.current = -1;

      // Clear trade markers when switching symbol or timeframe
      markersRef.current = [];
      try { seriesRef.current?.setMarkers([]); } catch { /* ok */ }

      try {
        let candles: CandleData[];

        if (AGG_TRADE_TFS.has(tf)) {
          // Sub-minute TF: fetch Spot 1s klines and aggregate to target TF.
          // This gives up to 1000 candles in a single REST call, regardless
          // of how many trades per second the symbol trades.
          const tfSec = TF_SECONDS[tf] ?? 5;
          candles = await fetchSubMinuteHistory(sym, tfSec, ctrl.signal);
        } else {
          // Standard TF: use Binance Futures klines endpoint
          const interval = TF_TO_BINANCE[tf] ?? '1m';
          const res = await fetch(
            `${BINANCE_REST}/klines?symbol=${sym}&interval=${interval}&limit=${HIST_LIMIT}`,
            { signal: ctrl.signal },
          );
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const raw = await res.json() as [number, string, string, string, string, string, ...unknown[]][];
          candles = parseRestCandles(raw);
        }

        // Discard if a newer loadHistory started while we were fetching
        if (sessionRef.current !== session) return;

        allCandlesRef.current   = candles;
        oldestTimeMsRef.current = candles.length ? candles[0].time * 1000 : 0;

        syncSize();
        setSeriesData(seriesRef.current, candles);
        fitContent();

      } catch (err: unknown) {
        if ((err as { name?: string }).name === 'AbortError') return;
        if (sessionRef.current === session) console.error('[YamatoChart] loadHistory failed:', err);
      } finally {
        if (sessionRef.current === session) onLoadingChangeRef.current?.(false);
      }
    }, [syncSize, fitContent]);

    // Re-run whenever symbol or timeframe changes
    useEffect(() => {
      resetBuffer();
      lastPriceRef.current = '';
      void loadHistory(symbol, timeframe);
    }, [symbol, timeframe, loadHistory, resetBuffer]);

    // Cleanup abort on unmount
    useEffect(() => () => { abortCtrlRef.current?.abort(); }, []);

    // ── WebSocket message handlers — zero React overhead ──────────────────────

    const handleKline = useCallback((msg: BinanceKlineMsg): void => {
      const { k } = msg;
      try {
        seriesRef.current?.update({
          time: asTime(Math.floor(k.t / 1000)),
          open: +k.o, high: +k.h, low: +k.l, close: +k.c,
        });
      } catch { /* ok */ }
      updatePrice(k.c);
    }, [updatePrice]);

    const handleAggTrade = useCallback((msg: BinanceAggTradeMsg): void => {
      const { time, open, high, low, close } = processAggTrade(+msg.p, +msg.q, msg.T);
      try {
        seriesRef.current?.update({ time: asTime(time), open, high, low, close });
      } catch { /* ok */ }
      updatePrice(msg.p);
    }, [processAggTrade, updatePrice]);

    const handleStatus = useCallback(
      (s: WsConnectionStatus): void => { onStatusUpdateRef.current?.(s); },
      [],
    );

    useBinanceWs({
      symbol, timeframe,
      onKline: handleKline, onAggTrade: handleAggTrade, onStatus: handleStatus,
    });

    // ── Render — chart canvas ONLY (toolbar lives in the HTML header) ─────────
    return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
  },
);

ChartWidgetInner.displayName = 'ChartWidget';
export const ChartWidget = memo(ChartWidgetInner);
