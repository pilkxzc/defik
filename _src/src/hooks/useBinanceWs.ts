import { useEffect, useRef } from 'react';
import type {
  BinanceKlineMsg,
  BinanceAggTradeMsg,
  WsConnectionStatus,
  Timeframe,
} from '../types/binance';
import { AGG_TRADE_TFS, TF_TO_BINANCE } from '../types/binance';

const FUTURES_WS_BASE = 'wss://fstream.binance.com/ws';
const MAX_DELAY_MS    = 30_000;

interface Options {
  symbol:     string;
  timeframe:  Timeframe;
  onKline:    (msg: BinanceKlineMsg)    => void;
  onAggTrade: (msg: BinanceAggTradeMsg) => void;
  onStatus:   (s:   WsConnectionStatus) => void;
}

/**
 * Manages a Binance WebSocket stream with automatic reconnect.
 *
 * Stream selection:
 *   1s        → {sym}@kline_1s      (native 1-second kline stream)
 *   2s/5s/…   → {sym}@aggTrade      (aggregate ticks manually)
 *   1m, 5m, … → {sym}@kline_{tf}
 *
 * Callbacks are stored in a ref, so changing them never triggers a reconnect.
 * Reconnects happen only when `symbol` or `timeframe` changes.
 */
export function useBinanceWs({
  symbol,
  timeframe,
  onKline,
  onAggTrade,
  onStatus,
}: Options): void {
  const cbRef = useRef({ onKline, onAggTrade, onStatus });
  cbRef.current = { onKline, onAggTrade, onStatus };

  useEffect(() => {
    let ws:         WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryDelay  = 1_000;
    let alive       = true;

    function buildStream(): string {
      const sym = symbol.toLowerCase();
      if (AGG_TRADE_TFS.has(timeframe)) return `${sym}@aggTrade`;
      const bTf = TF_TO_BINANCE[timeframe] ?? '1m';
      return `${sym}@kline_${bTf}`;
    }

    const WS_BASE = FUTURES_WS_BASE;

    function connect(): void {
      if (!alive) return;

      cbRef.current.onStatus('connecting');

      const socket = new WebSocket(`${WS_BASE}/${buildStream()}`);
      ws = socket;

      socket.onopen = () => {
        if (!alive) { socket.close(); return; }
        retryDelay = 1_000;
        cbRef.current.onStatus('connected');
      };

      socket.onmessage = ({ data }: MessageEvent<string>) => {
        if (!alive) return;
        try {
          const msg = JSON.parse(data) as BinanceKlineMsg | BinanceAggTradeMsg;
          if (msg.e === 'kline')    cbRef.current.onKline(msg as BinanceKlineMsg);
          if (msg.e === 'aggTrade') cbRef.current.onAggTrade(msg as BinanceAggTradeMsg);
        } catch {
          // ignore malformed frames
        }
      };

      // Suppress browser's "Ping received after close" and similar close-phase errors
      socket.onerror = () => { /* suppress — close handler will reconnect */ };

      socket.onclose = ({ code }: CloseEvent) => {
        if (!alive) return;
        ws = null;
        // code 1000 = normal close (we called close() intentionally), no reconnect
        if (code === 1000) return;
        cbRef.current.onStatus('disconnected');
        retryTimer = setTimeout(() => {
          retryDelay = Math.min(retryDelay * 2, MAX_DELAY_MS);
          connect();
        }, retryDelay);
      };
    }

    connect();

    return () => {
      alive = false;
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      if (ws) {
        const _ws = ws;
        ws = null;
        // Null all handlers BEFORE close so nothing fires during teardown
        _ws.onopen    = null;
        _ws.onclose   = null;
        _ws.onerror   = null;
        _ws.onmessage = null;
        // Normal close (code 1000) — avoids reconnect in onclose
        if (_ws.readyState < WebSocket.CLOSING) _ws.close(1000);
      }
    };
  // Reconnect only when these change
  }, [symbol, timeframe]); // eslint-disable-line react-hooks/exhaustive-deps
}
