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

import type { IChartingLibraryWidget, EntityId } from '../types/tradingview.d';
import { createDatafeed }               from '../datafeed';
import type { Timeframe, WsConnectionStatus } from '../types/binance';
import { TF_TO_TV_RESOLUTION }          from '../types/binance';

// ─── Public handle (same interface as the old ChartWidgetHandle) ──────────────

export interface ChartWidgetHandle {
  setSymbol:         (s:  string)                                     => void;
  setTimeframe:      (tf: Timeframe)                                  => void;
  addTradeMarker:    (side: 'buy' | 'sell', price: number, label?: string) => void;
  clearTradeMarkers: ()                                               => void;
  /** Set price decimal precision. 0 = auto-detect. Currently a no-op (TV auto-detects). */
  setPriceDecimals:  (n: number)                                      => void;
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
    const containerRef  = useRef<HTMLDivElement>(null);
    const widgetRef     = useRef<IChartingLibraryWidget | null>(null);
    const shapeIdsRef   = useRef<EntityId[]>([]);

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
      addTradeMarker: (side: 'buy' | 'sell', price: number, label?: string) => {
        widgetRef.current?.onChartReady(() => {
          const chart = widgetRef.current?.chart();
          if (!chart) return;
          const id = chart.createShape(
            { time: Math.floor(Date.now() / 1000), price },
            {
              shape:            side === 'buy' ? 'arrow_up' : 'arrow_down',
              text:             label ?? '',
              color:            side === 'buy' ? '#10B981' : '#EF4444',
              lock:             true,
              disableSelection: true,
              zOrder:           'top',
            },
          );
          if (id) shapeIdsRef.current.push(id);
        });
      },
      clearTradeMarkers: () => {
        widgetRef.current?.onChartReady(() => {
          const chart = widgetRef.current?.chart();
          if (!chart) return;
          shapeIdsRef.current.forEach(id => {
            try { chart.removeEntity(id); } catch { /* already gone */ }
          });
          shapeIdsRef.current = [];
        });
      },
      setPriceDecimals: (_n: number) => {
        // TV auto-detects precision from the price scale; no-op for now.
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
          'volume_force_overlay',
        ],
        enabled_features: [
          'hide_left_toolbar_by_default',
          'seconds_resolution',
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
