import { createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { ChartWidget, type ChartWidgetHandle } from './components/ChartWidget';
import type { Timeframe, WsConnectionStatus } from './types/binance';

// ─── Global API type declaration ─────────────────────────────────────────────

declare global {
  interface Window {
    /**
     * Public API exposed so the surrounding vanilla JS in bot-detail.html can
     * control the chart without touching React internals.
     *
     * Usage:
     *   window.yamatoChart.setSymbol('ETHUSDT');
     *   window.yamatoChart.setTimeframe('5m');
     *
     * Set before chart mounts so loadSymbols() can call setSymbol early.
     * If chart isn't ready yet, store the symbol in _yamatoInitSymbol instead.
     */
    yamatoChart: {
      setSymbol:         (symbol: string)                                    => void;
      setTimeframe:      (tf:     string)                                    => void;
      addTradeMarker:    (side: 'buy' | 'sell', price: number, label?: string) => void;
      clearTradeMarkers: ()                                                  => void;
      /** Set price decimal precision. 0 = auto-detect from price. */
      setPriceDecimals:  (n: number)                                        => void;
    };
    /** Pending symbol set by init() before chart.js finished loading. */
    _yamatoInitSymbol?: string;
  }
}

// ─── DOM helpers — update the HTML header elements without React state ────────

const WS_LABELS: Record<WsConnectionStatus, string> = {
  disconnected: 'Disconnected',
  connecting:   'Connecting...',
  connected:    'Live',
  error:        'Error',
};

let lastPriceRaw = '';
let flashTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Update the #livePrice element in the HTML header.
 * Applies a brief flash-up / flash-down CSS class for visual feedback.
 * Formats the price with appropriate decimal precision.
 */
function onPriceUpdate(raw: string): void {
  const el = document.getElementById('livePrice') as HTMLElement | null;
  if (!el) return;

  // Flash effect (reuse classes already defined in bot-detail.html)
  if (lastPriceRaw) {
    const up = parseFloat(raw) >= parseFloat(lastPriceRaw);
    el.classList.remove('flash-up', 'flash-down');
    void el.offsetWidth; // force reflow so animation restarts
    el.classList.add(up ? 'flash-up' : 'flash-down');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => el.classList.remove('flash-up', 'flash-down'), 300);
  }
  lastPriceRaw = raw;

  // Adaptive decimal formatting (matches the vanilla updateLivePrice logic)
  const n = parseFloat(raw);
  if (isNaN(n)) { el.textContent = '—'; return; }

  let fmt: string;
  if      (n >= 1000)  fmt = n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  else if (n >= 1)     fmt = n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  else if (n >= 0.01)  fmt = n.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 6 });
  else                 fmt = n.toLocaleString('en-US', { minimumFractionDigits: 6, maximumFractionDigits: 8 });

  el.textContent = '$' + fmt;
}

/**
 * Update the #wsStatusDot and #wsStatusText elements in the HTML header.
 */
function onStatusUpdate(status: WsConnectionStatus): void {
  const dot  = document.getElementById('wsStatusDot')  as HTMLElement | null;
  const text = document.getElementById('wsStatusText') as HTMLElement | null;

  const dotClass =
    status === 'connected'  ? 'connected'  :
    status === 'connecting' ? 'connecting' :
    status === 'error'      ? 'error'      : '';

  if (dot)  dot.className    = `ws-status-dot ${dotClass}`.trim();
  if (text) text.textContent = WS_LABELS[status];
}

/**
 * Show/hide the #chartLoading overlay that sits above the chart-root div.
 * Uses window.chartLoadingShow (smooth fade) when available, otherwise falls
 * back to a direct display toggle (bot-detail.html manages its own overlay).
 */
function onLoadingChange(loading: boolean): void {
  if (typeof (window as unknown as { chartLoadingShow?: (b: boolean) => void }).chartLoadingShow === 'function') {
    (window as unknown as { chartLoadingShow: (b: boolean) => void }).chartLoadingShow(loading);
    return;
  }
  const el = document.getElementById('chartLoading') as HTMLElement | null;
  if (el) el.style.display = loading ? 'flex' : 'none';
}

// ─── Mount ────────────────────────────────────────────────────────────────────

const rootEl = document.getElementById('chart-root');

if (!rootEl) {
  console.warn('[YamatoChart] Mount target #chart-root not found — chart not started.');
} else {
  const widgetRef = createRef<ChartWidgetHandle>();

  // Expose global API before rendering so that any synchronous calls from
  // init() that arrive before React finishes mounting are queued via the ref.
  window.yamatoChart = {
    setSymbol:         (s)            => widgetRef.current?.setSymbol(s),
    setTimeframe:      (tf)           => widgetRef.current?.setTimeframe(tf as Timeframe),
    addTradeMarker:    (side, price, label) => widgetRef.current?.addTradeMarker(side, price, label),
    clearTradeMarkers: ()             => widgetRef.current?.clearTradeMarkers(),
    setPriceDecimals:  (n)            => widgetRef.current?.setPriceDecimals(n),
  };

  createRoot(rootEl).render(
    <ChartWidget
      ref={widgetRef}
      onPriceUpdate={onPriceUpdate}
      onStatusUpdate={onStatusUpdate}
      onLoadingChange={onLoadingChange}
    />,
  );

  // If init() already ran and stored a pending symbol (before chart.js loaded),
  // apply it now.  Using requestAnimationFrame to give React a tick to commit.
  if (window._yamatoInitSymbol) {
    requestAnimationFrame(() => {
      const pending = window._yamatoInitSymbol;
      if (pending) {
        window._yamatoInitSymbol = undefined;
        widgetRef.current?.setSymbol(pending);
      }
    });
  }
}
