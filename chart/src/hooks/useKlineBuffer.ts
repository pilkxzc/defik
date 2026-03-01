import { useRef, useCallback } from 'react';
import type { CandleData, Timeframe } from '../types/binance';
import { TF_SECONDS } from '../types/binance';

interface KlineBufferResult {
  /**
   * Feed a single aggTrade tick into the buffer.
   * Returns a snapshot of the current forming candle (always non-null).
   * The snapshot is a new object on every call so the chart can detect changes.
   */
  processAggTrade: (price: number, qty: number, tradeTimeMs: number) => CandleData;
  /** Clear the buffer (call when switching symbol or timeframe). */
  reset: () => void;
}

/**
 * Accumulates aggTrade ticks into OHLCV candles for sub-minute timeframes.
 *
 * All state is in a ref — zero React re-renders in the hot path.
 * Only the returned `CandleData` snapshot changes on every tick.
 */
export function useKlineBuffer(timeframe: Timeframe): KlineBufferResult {
  const candleRef = useRef<CandleData | null>(null);
  const tfSec = TF_SECONDS[timeframe] ?? 1;

  const reset = useCallback((): void => {
    candleRef.current = null;
  }, []);

  const processAggTrade = useCallback(
    (price: number, qty: number, tradeTimeMs: number): CandleData => {
      // Bucket start in seconds (floor to nearest tfSec boundary)
      const bucket = Math.floor(Math.floor(tradeTimeMs / 1000) / tfSec) * tfSec;
      const prev   = candleRef.current;

      if (!prev || prev.time !== bucket) {
        // New candle bucket — start fresh
        candleRef.current = {
          time:   bucket,
          open:   price,
          high:   price,
          low:    price,
          close:  price,
          volume: qty,
        };
      } else {
        // Update the forming candle in-place (no allocation)
        if (price > prev.high) prev.high = price;
        if (price < prev.low)  prev.low  = price;
        prev.close   = price;
        prev.volume += qty;
      }

      // Return a snapshot so the chart gets a fresh object reference
      return { ...candleRef.current! };
    },
    [tfSec],
  );

  return { processAggTrade, reset };
}
