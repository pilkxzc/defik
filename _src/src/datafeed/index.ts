/**
 * Binance Futures datafeed for TradingView Advanced Charts Library.
 * Implements IDatafeedChartApi.
 */

import type { IDatafeedChartApi, OnReadyCallback, LibrarySymbolInfo, ResolutionString, PeriodParams, HistoryCallback, SubscribeBarsCallback, ErrorCallback } from '../types/tradingview.d';
import { getBars }                            from './history';
import { subscribeBars, unsubscribeBars }     from './realtime';
import { resolveSymbol, searchSymbols, SUPPORTED_RESOLUTIONS } from './symbology';

export interface DatafeedOptions {
  /** Called with the latest close price whenever a realtime bar arrives. */
  onPriceUpdate?: (price: number) => void;
}

export function createDatafeed(options: DatafeedOptions = {}): IDatafeedChartApi {
  return {
    onReady(callback: OnReadyCallback): void {
      // TV requires onReady to call back asynchronously
      setTimeout(() => callback({
        supported_resolutions:    SUPPORTED_RESOLUTIONS,
        supports_marks:           false,
        supports_timescale_marks: false,
        supports_time:            true,
      }), 0);
    },

    searchSymbols(userInput, exchange, symbolType, onResult) {
      searchSymbols(userInput, exchange, symbolType, onResult);
    },

    resolveSymbol(symbolName, onResolve, onError) {
      resolveSymbol(symbolName, onResolve, onError);
    },

    getBars(
      symbolInfo:   LibrarySymbolInfo,
      resolution:   ResolutionString,
      periodParams: PeriodParams,
      onResult:     HistoryCallback,
      onError:      ErrorCallback,
    ) {
      void getBars(symbolInfo, resolution, periodParams, onResult, onError);
    },

    subscribeBars(
      symbolInfo:    LibrarySymbolInfo,
      resolution:    ResolutionString,
      onBar:         SubscribeBarsCallback,
      subscriberUID: string,
      onResetCache:  () => void,
    ) {
      subscribeBars(symbolInfo, resolution, onBar, subscriberUID, onResetCache, options.onPriceUpdate);
    },

    unsubscribeBars(subscriberUID: string) {
      unsubscribeBars(subscriberUID);
    },
  };
}
