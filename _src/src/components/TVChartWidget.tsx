/**
 * TVChartWidget — TradingView Advanced Charts integration.
 *
 * Replaces ChartWidget (lightweight-charts) with TradingView's library.
 * The library must be loaded as a global script BEFORE chart.js:
 *   <script src="/charting_library/charting_library.js"></script>
 *   <script src="/js/chart/chart.js"></script>
 */

import {
  forwardRef,
  memo,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';

import type { IChartingLibraryWidget } from '../types/tradingview.d';
import { createDatafeed }               from '../datafeed';
import type { Timeframe, WsConnectionStatus } from '../types/binance';
import { TF_TO_TV_RESOLUTION }          from '../types/binance';

// ─── Public handle (same interface as the old ChartWidgetHandle) ──────────────

export interface ChartWidgetHandle {
  setSymbol:    (s:  string)    => void;
  setTimeframe: (tf: Timeframe) => void;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  initialSymbol?:    string;
  initialTimeframe?: Timeframe;
  onPriceUpdate?:   (raw: string)               => void;
  onStatusUpdate?:  (status: WsConnectionStatus) => void;
  onLoadingChange?: (loading: boolean)           => void;
}

// ─── Default initial timeframe → TV resolution ───────────────────────────────

const DEFAULT_SYMBOL:     string    = 'BTCUSDT';
const DEFAULT_TIMEFRAME:  Timeframe = '15m';

// ─── Component ────────────────────────────────────────────────────────────────

const TVChartWidgetInner = forwardRef<ChartWidgetHandle, Props>(
  (
    {
      initialSymbol    = DEFAULT_SYMBOL,
      initialTimeframe = DEFAULT_TIMEFRAME,
      onPriceUpdate,
      onStatusUpdate,
      onLoadingChange,
    },
    ref,
  ) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const widgetRef    = useRef<IChartingLibraryWidget | null>(null);

    // Stable ref so the datafeed callback always has the latest function
    const onPriceUpdateRef   = useRef(onPriceUpdate);
    const onStatusUpdateRef  = useRef(onStatusUpdate);
    const onLoadingChangeRef = useRef(onLoadingChange);
    onPriceUpdateRef.current   = onPriceUpdate;
    onStatusUpdateRef.current  = onStatusUpdate;
    onLoadingChangeRef.current = onLoadingChange;

    // ── Imperative API (same shape as old ChartWidgetHandle) ─────────────────
    useImperativeHandle(ref, () => ({
      setSymbol: (s: string) => {
        widgetRef.current?.onChartReady(() => {
          widgetRef.current?.chart().setSymbol(s.toUpperCase());
        });
      },
      setTimeframe: (tf: Timeframe) => {
        const res = TF_TO_TV_RESOLUTION[tf] ?? '15';
        widgetRef.current?.onChartReady(() => {
          widgetRef.current?.chart().setResolution(res);
        });
      },
    }), []);

    // ── Mount TradingView widget ──────────────────────────────────────────────
    useEffect(() => {
      const el = containerRef.current;
      if (!el) return;

      // Guard: ensure charting_library.js was loaded
      if (!window.TradingView?.widget) {
        console.error(
          '[TVChartWidget] window.TradingView.widget not found.\n' +
          'Add <script src="/charting_library/charting_library.js"> before chart.js.',
        );
        return;
      }

      onLoadingChangeRef.current?.(true);
      onStatusUpdateRef.current?.('connecting');

      const datafeed = createDatafeed({
        onPriceUpdate: (price) => {
          onPriceUpdateRef.current?.(String(price));
          onStatusUpdateRef.current?.('connected');
        },
      });

      const initialResolution = TF_TO_TV_RESOLUTION[initialTimeframe] ?? '15';

      const widget = new window.TradingView.widget({
        container:    el,
        datafeed,
        locale:       'en',
        library_path: '/charting_library/',
        symbol:       initialSymbol,
        interval:     initialResolution,
        fullscreen:   false,
        autosize:     true,
        theme:        'Dark',
        toolbar_bg:   '#141414',
        timezone:     'exchange',
        disabled_features: [
          'header_symbol_search',
          'header_compare',
          'header_undo_redo',
          'header_saveload',
          'use_localstorage_for_settings',
        ],
        enabled_features: [
          'hide_left_toolbar_by_default',
        ],
        overrides: {
          'mainSeriesProperties.candleStyle.upColor':          '#10B981',
          'mainSeriesProperties.candleStyle.downColor':        '#EF4444',
          'mainSeriesProperties.candleStyle.borderUpColor':    '#10B981',
          'mainSeriesProperties.candleStyle.borderDownColor':  '#EF4444',
          'mainSeriesProperties.candleStyle.wickUpColor':      '#10B981',
          'mainSeriesProperties.candleStyle.wickDownColor':    '#EF4444',
          'paneProperties.background':                         '#141414',
          'paneProperties.backgroundGradientStartColor':       '#141414',
          'paneProperties.backgroundGradientEndColor':         '#141414',
          'paneProperties.vertGridProperties.color':           'rgba(255,255,255,0.04)',
          'paneProperties.horzGridProperties.color':           'rgba(255,255,255,0.04)',
          'scalesProperties.textColor':                        '#A1A1A1',
        },
        loading_screen: {
          backgroundColor: '#141414',
          foregroundColor: '#10B981',
        },
      });

      widget.onChartReady(() => {
        onLoadingChangeRef.current?.(false);
        onStatusUpdateRef.current?.('connected');
      });

      widgetRef.current = widget;

      return () => {
        try { widget.remove(); } catch { /* ok */ }
        widgetRef.current = null;
        onStatusUpdateRef.current?.('disconnected');
      };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // Mount once — symbol/timeframe changes go through the imperative API

    return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
  },
);

TVChartWidgetInner.displayName = 'TVChartWidget';
export const ChartWidget = memo(TVChartWidgetInner);
