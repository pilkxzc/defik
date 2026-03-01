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

/** Binance Futures REST base URL */
const BINANCE_REST = 'https://fapi.binance.com/fapi/v1';
const HIST_LIMIT   = 500;  // initial kline load
const MORE_LIMIT   = 500;  // each loadMore page

/**
 * Trigger loadMore only when the user scrolls this many bars PAST the first
 * data point. Negative = the user has genuinely scrolled beyond the left edge.
 */
const LOAD_MORE_THRESHOLD = -30;

/** How many candles of history to request for sub-minute TFs via aggTrades. */
const AGG_TARGET_CANDLES = 300;

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
 * Fetch aggTrade history for sub-minute TFs by paginating backwards in time.
 * Uses Binance Futures endpoint (fapi.binance.com).
 */
async function fetchAggTradeHistory(
  sym: string,
  tfSec: number,
  signal: AbortSignal,
): Promise<CandleData[]> {
  const targetMs = AGG_TARGET_CANDLES * tfSec * 1000;
  let endTime    = Date.now();
  const wantFrom = endTime - targetMs;
  const allTrades: { T: number; p: string; q: string }[] = [];

  for (let page = 0; page < 10; page++) {
    const res = await fetch(
      `${BINANCE_REST}/aggTrades?symbol=${sym}&endTime=${endTime}&limit=1000`,
      { signal },
    );
    if (!res.ok) throw new Error(`aggTrades HTTP ${res.status}`);
    const batch = await res.json() as { T: number; p: string; q: string; a: number }[];
    if (!batch.length) break;

    allTrades.unshift(...batch);

    const oldestInBatch = batch[0].T;
    if (oldestInBatch <= wantFrom) break;
    endTime = oldestInBatch - 1;
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

// ─── Public API ───────────────────────────────────────────────────────────────

export interface ChartWidgetHandle {
  setSymbol:    (s:  string)    => void;
  setTimeframe: (tf: Timeframe) => void;
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

      try {
        let candles: CandleData[];

        if (AGG_TRADE_TFS.has(tf)) {
          // Sub-minute custom TF: aggregate raw trades into candles
          const tfSec = TF_SECONDS[tf] ?? 5;
          candles = await fetchAggTradeHistory(sym, tfSec, ctrl.signal);
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
