/**
 * Yamato Chart — KLineChart Pro entry point.
 *
 * Replaces the previous React + lightweight-charts implementation.
 * Builds to IIFE (js/chart/chart.js) and is loaded by page/datedos.html.
 *
 * Exposes window.yamatoChart API:
 *   setSymbol(s)              – switch trading pair, e.g. "BTCUSDT" or "BINANCE:BTCUSDT"
 *   setTimeframe(tf)          – switch period, e.g. "15m", "1h", "4h"
 *   addTradeMarker(side, price, label?)  – add buy/sell triangle overlay
 *   clearTradeMarkers()       – remove all trade marker overlays
 *   setPriceDecimals(n)       – no-op (KLineChart Pro handles precision)
 */

import { KLineChartPro } from '@klinecharts/pro';
import '@klinecharts/pro/dist/klinecharts-pro.css';
import * as klinecharts from 'klinecharts';

import { createBinanceDatafeed } from './klpro-datafeed';
import { registerTradeMarkerOverlay } from './overlays';
import type { SymbolInfo, Period } from './klpro-datafeed';

// Register custom trade marker overlay globally (affects inner chart)
registerTradeMarkerOverlay(klinecharts);

// ─── Global API declaration ───────────────────────────────────────────────────

declare global {
  interface Window {
    yamatoChart: {
      setSymbol:         (symbol: string)                                       => void;
      setTimeframe:      (tf:     string)                                       => void;
      addTradeMarker:    (side: 'buy' | 'sell', price: number, label?: string) => void;
      clearTradeMarkers: ()                                                     => void;
      setPriceDecimals:  (n: number)                                           => void;
    };
    _yamatoInitSymbol?: string;
    chartLoadingShow?:  (show: boolean) => void;
  }
}

// ─── Period definitions ───────────────────────────────────────────────────────

const PERIODS: Period[] = [
  { multiplier: 1,  timespan: 'second', text: '1s'  },
  { multiplier: 1,  timespan: 'minute', text: '1m'  },
  { multiplier: 3,  timespan: 'minute', text: '3m'  },
  { multiplier: 5,  timespan: 'minute', text: '5m'  },
  { multiplier: 15, timespan: 'minute', text: '15m' },
  { multiplier: 30, timespan: 'minute', text: '30m' },
  { multiplier: 1,  timespan: 'hour',   text: '1H'  },
  { multiplier: 2,  timespan: 'hour',   text: '2H'  },
  { multiplier: 4,  timespan: 'hour',   text: '4H'  },
  { multiplier: 6,  timespan: 'hour',   text: '6H'  },
  { multiplier: 12, timespan: 'hour',   text: '12H' },
  { multiplier: 1,  timespan: 'day',    text: '1D'  },
  { multiplier: 3,  timespan: 'day',    text: '3D'  },
  { multiplier: 1,  timespan: 'week',   text: '1W'  },
  { multiplier: 1,  timespan: 'month',  text: '1M'  },
];

const TF_MAP: Record<string, Period> = {
  '1s':  PERIODS[0],
  '1m':  PERIODS[1],  '3m':  PERIODS[2],  '5m':  PERIODS[3],
  '15m': PERIODS[4],  '30m': PERIODS[5],
  '1h':  PERIODS[6],  '2h':  PERIODS[7],  '4h':  PERIODS[8],
  '6h':  PERIODS[9],  '12h': PERIODS[10],
  '1d':  PERIODS[11], '3d':  PERIODS[12],
  '1w':  PERIODS[13], '1M':  PERIODS[14],
};

// ─── Live price display ───────────────────────────────────────────────────────

const WS_LABELS: Record<string, string> = {
  disconnected: 'Disconnected',
  connecting:   'Connecting...',
  connected:    'Live',
  error:        'Error',
};

let lastPriceRaw  = '';
let flashTimer: ReturnType<typeof setTimeout> | undefined;

function onPriceUpdate(raw: string): void {
  const el = document.getElementById('livePrice');
  if (!el) return;

  if (lastPriceRaw) {
    const up = parseFloat(raw) >= parseFloat(lastPriceRaw);
    el.classList.remove('flash-up', 'flash-down');
    void el.offsetWidth; // force reflow so animation restarts
    el.classList.add(up ? 'flash-up' : 'flash-down');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => el.classList.remove('flash-up', 'flash-down'), 300);
  }
  lastPriceRaw = raw;

  const n = parseFloat(raw);
  if (isNaN(n)) { el.textContent = '—'; return; }

  let fmt: string;
  if      (n >= 1000)  fmt = n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  else if (n >= 1)     fmt = n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  else if (n >= 0.01)  fmt = n.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 6 });
  else                 fmt = n.toLocaleString('en-US', { minimumFractionDigits: 6, maximumFractionDigits: 8 });

  el.textContent = '$' + fmt;
}

function onStatusUpdate(status: string): void {
  const dot  = document.getElementById('wsStatusDot');
  const text = document.getElementById('wsStatusText');
  const cls  =
    status === 'connected'  ? 'connected'  :
    status === 'connecting' ? 'connecting' :
    status === 'error'      ? 'error'      : '';

  if (dot)  dot.className    = `ws-status-dot ${cls}`.trim();
  if (text) text.textContent = WS_LABELS[status] ?? status;
}

// ─── Mount ────────────────────────────────────────────────────────────────────

const rootEl = document.getElementById('chart-root');

if (!rootEl) {
  console.warn('[YamatoChart] #chart-root not found — chart not started.');
} else {
  // Hide the skeleton loading overlay — KLineChart Pro shows its own loader
  window.chartLoadingShow?.(false);

  // Determine initial symbol (strip "BINANCE:" prefix if present)
  const initRaw    = window._yamatoInitSymbol ?? 'BTCUSDT';
  const initTicker = initRaw.replace(/^[^:]+:/, '').toUpperCase();

  const symbol: SymbolInfo = {
    shortName:      initTicker.replace(/USDT$/, '/USDT'),
    ticker:         initTicker,
    pricePrecision: 2,
  };

  const datafeed = createBinanceDatafeed({ onPriceUpdate, onStatusUpdate });

  const proChart = new KLineChartPro({
    container:         rootEl,
    watermark:         'Yamato',
    symbol,
    period:            { multiplier: 15, timespan: 'minute', text: '15m' } as Period,
    periods:           PERIODS,
    theme:             'dark',
    locale:            'en-US',
    drawingBarVisible: true,
    subIndicators:     ['VOL'],
    mainIndicators:    [],
    datafeed,
  });

  // ─── window.yamatoChart API ─────────────────────────────────────────────────
  let markerGroup = 'trm-0';
  let markerIdx   = 0;

  window.yamatoChart = {
    setSymbol: (s: string) => {
      lastPriceRaw = '';
      const ticker = s.replace(/^[^:]+:/, '').toUpperCase();
      proChart.setSymbol({
        shortName:      ticker.replace(/USDT$/, '/USDT'),
        ticker,
        pricePrecision: 2,
      } as SymbolInfo);
    },

    setTimeframe: (tf: string) => {
      if (!tf) return;
      const period = TF_MAP[tf.toLowerCase()] ?? TF_MAP['15m'];
      proChart.setPeriod(period);
    },

    addTradeMarker: (side: 'buy' | 'sell', price: number, _label?: string) => {
      try {
        // _chartApi is the inner klinecharts Chart instance (private field)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const inner = (proChart as any)['_chartApi'];
        if (!inner) return;
        inner.createOverlay({
          name:       'tradeMarker',
          groupId:    markerGroup,
          lock:       true,
          points:     [{ timestamp: Date.now(), value: price }],
          extendData: { isBuy: side === 'buy' },
        });
      } catch { /* ok */ }
    },

    clearTradeMarkers: () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const inner = (proChart as any)['_chartApi'];
        if (!inner) return;
        inner.removeOverlay({ groupId: markerGroup });
        markerGroup = `trm-${++markerIdx}`;
      } catch { /* ok */ }
    },

    setPriceDecimals: (_n: number) => {
      // KLineChart Pro manages precision automatically
    },
  };

  window._yamatoInitSymbol = undefined;
}
