/**
 * Minimal type declarations for TradingView Advanced Charts Library.
 * Full API docs: https://www.tradingview.com/charting-library-docs/latest/api/
 *
 * Place the actual library files in /charting_library/:
 *   charting_library.js, charting_library.css
 */

export type ResolutionString = string;

// ─── Data types ──────────────────────────────────────────────────────────────

export interface Bar {
  /** UTC Unix timestamp in milliseconds */
  time:    number;
  open:    number;
  high:    number;
  low:     number;
  close:   number;
  volume?: number;
}

// ─── Datafeed configuration ───────────────────────────────────────────────────

export interface DatafeedConfiguration {
  supported_resolutions:    ResolutionString[];
  exchanges?:               Array<{ value: string; name: string; desc: string }>;
  symbols_types?:           Array<{ name: string; value: string }>;
  supports_marks?:          boolean;
  supports_timescale_marks?: boolean;
  supports_time?:           boolean;
}

// ─── Symbol info ──────────────────────────────────────────────────────────────

export interface LibrarySymbolInfo {
  name:                    string;
  full_name:               string;
  description:             string;
  type:                    string;
  session:                 string;
  timezone:                string;
  exchange:                string;
  listed_exchange:         string;
  format:                  'price' | 'volume';
  pricescale:              number;
  minmov:                  number;
  has_intraday:            boolean;
  intraday_multipliers?:   string[];
  has_seconds?:            boolean;
  seconds_multipliers?:    string[];
  has_daily:               boolean;
  has_weekly_and_monthly?: boolean;
  supported_resolutions:   ResolutionString[];
  volume_precision?:       number;
  data_status?:            string;
  ticker?:                 string;
}

// ─── Datafeed callbacks ───────────────────────────────────────────────────────

export type OnReadyCallback        = (config: DatafeedConfiguration) => void;
export type SearchSymbolsCallback  = (items: SearchSymbolResultItem[]) => void;
export type ResolveSymbolCallback  = (symbolInfo: LibrarySymbolInfo) => void;
export type HistoryCallback        = (bars: Bar[], meta: { noData?: boolean; nextTime?: number }) => void;
export type SubscribeBarsCallback  = (bar: Bar) => void;
export type ErrorCallback          = (reason: string) => void;

export interface PeriodParams {
  /** Start time — UTC Unix seconds */
  from:             number;
  /** End time — UTC Unix seconds */
  to:               number;
  /** Number of bars the chart needs (used for initial load) */
  countBack:        number;
  firstDataRequest: boolean;
}

export interface SearchSymbolResultItem {
  symbol:      string;
  full_name:   string;
  description: string;
  exchange:    string;
  type:        string;
}

// ─── Datafeed interface ───────────────────────────────────────────────────────

export interface IDatafeedChartApi {
  onReady(callback: OnReadyCallback): void;
  searchSymbols(
    userInput:   string,
    exchange:    string,
    symbolType:  string,
    onResult:    SearchSymbolsCallback,
  ): void;
  resolveSymbol(
    symbolName: string,
    onResolve:  ResolveSymbolCallback,
    onError:    ErrorCallback,
  ): void;
  getBars(
    symbolInfo:   LibrarySymbolInfo,
    resolution:   ResolutionString,
    periodParams: PeriodParams,
    onResult:     HistoryCallback,
    onError:      ErrorCallback,
  ): void;
  subscribeBars(
    symbolInfo:                 LibrarySymbolInfo,
    resolution:                 ResolutionString,
    onRealtimeCallback:         SubscribeBarsCallback,
    subscriberUID:              string,
    onResetCacheNeededCallback: () => void,
  ): void;
  unsubscribeBars(subscriberUID: string): void;
}

// ─── Widget options & API ─────────────────────────────────────────────────────

export interface ChartingLibraryWidgetOptions {
  container:           string | HTMLElement;
  datafeed:            IDatafeedChartApi;
  locale:              string;
  library_path:        string;
  symbol?:             string;
  interval?:           ResolutionString;
  fullscreen?:         boolean;
  autosize?:           boolean;
  theme?:              'Light' | 'Dark';
  disabled_features?:  string[];
  enabled_features?:   string[];
  toolbar_bg?:         string;
  timezone?:           string;
  overrides?:          Record<string, unknown>;
  studies_overrides?:  Record<string, unknown>;
  loading_screen?:     { backgroundColor?: string; foregroundColor?: string };
  time_frames?:        Array<{ text: string; resolution: ResolutionString; description?: string }>;
  debug?:              boolean;
}

export interface IChartingLibraryWidget {
  onChartReady(callback: () => void): void;
  chart(): IChartApi;
  remove(): void;
}

export interface IChartApi {
  setSymbol(symbol: string, callback?: () => void): void;
  setResolution(resolution: ResolutionString, callback?: () => void): void;
  symbol():     string;
  resolution(): ResolutionString;
}

// ─── Global declaration ───────────────────────────────────────────────────────

declare global {
  interface Window {
    TradingView: {
      widget: new (options: ChartingLibraryWidgetOptions) => IChartingLibraryWidget;
    };
  }
}
