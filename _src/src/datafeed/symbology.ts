/**
 * Symbol resolution and search for TradingView datafeed.
 * Uses Binance Futures perpetual swap symbols.
 */

import type {
  LibrarySymbolInfo,
  ResolveSymbolCallback,
  ErrorCallback,
  SearchSymbolsCallback,
  ResolutionString,
} from '../types/tradingview.d';

const FAPI = 'https://fapi.binance.com/fapi/v1';

/** All supported TradingView resolutions (seconds, minutes, hours, days, weeks, months). */
export const SUPPORTED_RESOLUTIONS: ResolutionString[] = [
  '1S', '2S', '5S', '15S', '30S',
  '1', '3', '5', '15', '30',
  '60', '120', '240', '360', '720',
  '1D', '3D', '1W', '1M',
];

// ─── Binance exchange info cache ──────────────────────────────────────────────

interface ExchangeSymbol { symbol: string; pricePrecision: number; quantityPrecision: number; status: string }

let symbolInfoCache: ExchangeSymbol[] | null = null;

async function getBinanceSymbols(): Promise<ExchangeSymbol[]> {
  if (symbolInfoCache) return symbolInfoCache;
  try {
    const res  = await fetch(`${FAPI}/exchangeInfo`);
    const data = await res.json() as { symbols: ExchangeSymbol[] };
    symbolInfoCache = data.symbols.filter(s => s.status === 'TRADING' && s.symbol.endsWith('USDT'));
    return symbolInfoCache;
  } catch {
    return [];
  }
}

// ─── resolveSymbol ────────────────────────────────────────────────────────────

/** Build a LibrarySymbolInfo for a Binance Futures symbol (e.g. "BTCUSDT"). */
async function buildSymbolInfo(symbol: string): Promise<LibrarySymbolInfo | null> {
  const syms = await getBinanceSymbols();
  const info = syms.find(s => s.symbol === symbol.toUpperCase());

  const pricescale = info ? Math.pow(10, info.pricePrecision) : 100;
  const ticker     = symbol.toUpperCase();

  return {
    name:                    ticker,
    full_name:               `BINANCE:${ticker}`,
    description:             ticker,
    type:                    'crypto',
    session:                 '24x7',
    timezone:                'Etc/UTC',
    exchange:                'BINANCE',
    listed_exchange:         'BINANCE',
    format:                  'price',
    pricescale,
    minmov:                  1,
    has_intraday:            true,
    intraday_multipliers:    ['1', '3', '5', '15', '30', '60', '120', '240', '360', '720'],
    has_seconds:             true,
    seconds_multipliers:     ['1', '2', '5', '15', '30'],
    has_daily:               true,
    has_weekly_and_monthly:  true,
    supported_resolutions:   SUPPORTED_RESOLUTIONS,
    volume_precision:        2,
    data_status:             'streaming',
    ticker,
  };
}

export function resolveSymbol(
  symbolName: string,
  onResolve:  ResolveSymbolCallback,
  onError:    ErrorCallback,
): void {
  // Strip exchange prefix if present (e.g. "BINANCE:BTCUSDT" → "BTCUSDT")
  const ticker = symbolName.includes(':') ? symbolName.split(':')[1] : symbolName;

  // Resolve asynchronously but TV expects it to be called "soon"
  buildSymbolInfo(ticker).then(info => {
    if (!info) { onError(`Symbol not found: ${ticker}`); return; }
    onResolve(info);
  }).catch(err => onError(String(err)));
}

// ─── searchSymbols ────────────────────────────────────────────────────────────

export function searchSymbols(
  userInput:  string,
  _exchange:  string,
  _type:      string,
  onResult:   SearchSymbolsCallback,
): void {
  const query = userInput.toUpperCase();

  getBinanceSymbols().then(syms => {
    const results = syms
      .filter(s => s.symbol.includes(query))
      .slice(0, 50)
      .map(s => ({
        symbol:      s.symbol,
        full_name:   `BINANCE:${s.symbol}`,
        description: s.symbol,
        exchange:    'BINANCE',
        type:        'crypto',
      }));
    onResult(results);
  }).catch(() => onResult([]));
}
