# Backend Services Analysis - Subtask 1-1 Investigation Results

## Overview

This document provides a comprehensive analysis of the Yamato Trading Platform backend services, including all API routes, database schema, middleware architecture, and key services. Analysis was performed on the current codebase as of 2026-03-02.

---

## Placeholder from Previous Sessions

(Previous sessions' analysis would be documented here - Backend section 1-11 and Frontend section 1-13)

---

# React/Vite Frontend Analysis - Subtask 1-3 Investigation Results

## Overview

The `_src/` directory is a specialized **Vite + React + TypeScript** project that builds a professional **KlineCharts integration widget** for advanced candlestick charting. This widget is compiled into a standalone JavaScript file (`js/chart/chart.js`) and loaded into the main trading platform's HTML pages (e.g., `bot-detail.html`).

**Purpose:** Replace or enhance vanilla JavaScript charting with a professional trading-grade charting library.
**Build Output:** `../js/chart/chart.js` (IIFE format, self-contained, ~50-100KB minified)
**Key Libraries:** KlineCharts (main), TradingView Advanced Charts (alternative)

---

## 1. Project Structure & Files

```
_src/
├── package.json                 ← Project metadata, scripts, dependencies
├── vite.config.ts              ← Vite build configuration
├── tsconfig.json               ← TypeScript compiler options
├── src/
│   ├── main.tsx                ← Entry point (React + global API)
│   ├── components/
│   │   ├── TVChartWidget.tsx   ← TradingView Advanced Charts component
│   │   ├── ChartWidget.tsx     ← KlineCharts lightweight component (fallback)
│   │   ├── TimeframeSelector.tsx ← UI selector for 1s-1M timeframes
│   │   └── WsStatusIndicator.tsx ← WebSocket connection status display
│   ├── hooks/
│   │   ├── useBinanceWs.ts     ← Custom hook for Binance WebSocket streams
│   │   └── useKlineBuffer.ts   ← Custom hook for candle aggregation
│   ├── datafeed/
│   │   ├── index.ts            ← Creates TradingView datafeed interface
│   │   ├── history.ts          ← Historical bar data from Binance REST API
│   │   ├── realtime.ts         ← Real-time kline/aggTrade subscriptions
│   │   └── symbology.ts        ← Symbol metadata, search, resolution mappings
│   ├── types/
│   │   ├── binance.ts          ← Binance message types & timeframe mappings
│   │   └── tradingview.d.ts    ← TradingView library type definitions
│   ├── klpro-datafeed.ts       ← (Deprecated) KlineCharts Pro datafeed
│   └── overlays.ts             ← Trade marker overlays (buy/sell indicators)
└── dist/                       ← Build output (generated after `npm run build`)
```

**File Count:** ~15 source files (TS/TSX)
**Total Lines:** ~3,000 lines of TypeScript

---

## 2. Dependencies & Tech Stack

### Production Dependencies
```json
{
  "@klinecharts/pro": "^0.1.1",  // KlineCharts Professional library
  "klinecharts": "^9.8.12"       // KlineCharts base library (lightweight)
}
```

**Note:** Intentionally minimal dependencies. TradingView library is loaded externally as a global script, not via npm.

### Development Dependencies
```json
{
  "typescript": "^5.5.0",  // TypeScript compiler
  "vite": "^5.4.0",        // Fast bundler & dev server
  "vite-plugin-css-injected-by-js": "^3.5.0" // Bundle CSS into JS output
}
```

### External Libraries (loaded via `<script>` tags, not npm)
- **TradingView Advanced Charts** (`charting_library.js`) — Professional charting if Binance data available
- **React 18** (via CDN or bundled)
- **React-DOM 18** (bundled into chart.js)

---

## 3. Vite Configuration (`vite.config.ts`)

The Vite configuration is designed to produce a self-contained, IIFE-wrapped chart widget that can be loaded as a standalone script without requiring module bundlers on the host page.

```typescript
export default defineConfig({
  plugins: [cssInjectedByJs()],

  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'process.env': '{}',
    'global': 'globalThis',
  },

  build: {
    outDir: '../js/chart',      // ← Build into main project's js/ folder
    emptyOutDir: true,           // Clear folder before building
    lib: {
      entry: resolve(__dirname, 'src/main.ts'),
      name: 'YamatoChart',        // Global variable name
      formats: ['iife'],          // Self-executing function (standalone)
      fileName: () => 'chart.js',
    },
    rollupOptions: {
      external: [],
      output: {
        inlineDynamicImports: true, // Inline all imports (no code splitting)
      },
    },
    minify: 'esbuild',
  },
});
```

**Key Details:**
- **IIFE Format:** Generates `window.YamatoChart` global object
- **CSS Injection:** CSS bundled directly into `chart.js` (via `vite-plugin-css-injected-by-js`)
- **No External Dependencies:** All imports inlined; standalone file
- **Output:** `/js/chart/chart.js` (~50-100KB minified)

---

## 4. Entry Point & Global API (`src/main.tsx`)

### Global API: `window.yamatoChart`

The entry point exposes a stable, well-documented API for controlling the chart from vanilla JavaScript.

```typescript
declare global {
  interface Window {
    yamatoChart: {
      setSymbol(symbol: string): void;
      setTimeframe(tf: string): void;
      addTradeMarker(side: 'buy' | 'sell', price: number, label?: string): void;
      clearTradeMarkers(): void;
      setPriceDecimals(n: number): void;
    };
    _yamatoInitSymbol?: string;  // Pending symbol before chart loads
  }
}
```

### Usage in HTML (e.g., `bot-detail.html`)

```html
<script src="/js/chart/chart.js"></script>
<script>
  // Set symbol BEFORE or AFTER chart loads
  window.yamatoChart.setSymbol('ETHUSDT');
  window.yamatoChart.setTimeframe('5m');
  window.yamatoChart.addTradeMarker('buy', 1850.50, 'Entry');
</script>
```

### DOM Integration

- **Mount Point:** `<div id="chart-root"></div>` (must exist in HTML)
- **Price Display:** Updates `#livePrice` element with formatted price + flash effect (up/down colors)
- **Status Indicator:** Updates `#wsStatusDot` and `#wsStatusText` for WebSocket connection status
- **Loading Overlay:** Shows `#chartLoading` spinner during initial data fetch

---

## 5. Chart Components

### 5.1 TradingView Advanced Charts (`src/components/TVChartWidget.tsx`)

**Primary Component** (when TradingView charting_library.js is available)

**Features:**
- Professional trading interface with TradingView's Advanced Charts library
- Support for 19 timeframes: 1s–1M (sub-second through monthly)
- Real-time candlestick updates via Binance Futures WebSocket
- Customizable datafeed (OHLCV history + real-time bars)
- Trade marker overlays (buy/sell entry points with labels)
- Advanced drawing tools (lines, channels, annotations, etc.)
- Symbol search across 100+ crypto pairs
- Full-featured technician indicators (moving averages, RSI, MACD, Bollinger Bands, etc.)

**Props:**
```typescript
interface Props {
  initialSymbol?: string;        // Default: 'BTCUSDT'
  initialTimeframe?: Timeframe;  // Default: '15m'
  onPriceUpdate?: (raw: string) => void;
  onStatusUpdate?: (status: WsConnectionStatus) => void;
  onLoadingChange?: (loading: boolean) => void;
}
```

**Handle Methods:**
```typescript
export interface ChartWidgetHandle {
  setSymbol(s: string): void;
  setTimeframe(tf: Timeframe): void;
  addTradeMarker(side: 'buy' | 'sell', price: number, label?: string): void;
  clearTradeMarkers(): void;
  setPriceDecimals(n: number): void;
}
```

### 5.2 KlineCharts Component (`src/components/ChartWidget.tsx`)

**Fallback Component** (lightweight alternative if TradingView unavailable)

**Features:**
- Lightweight candlestick charting using KlineCharts library (open source)
- Same API as TVChartWidget for drop-in replacement
- Supports all 19 timeframes
- Manual candle aggregation for sub-minute timeframes (1s-30s)
- Low bandwidth footprint
- Cross-compatible with bot-detail.html

**File Size:** Much smaller than TradingView (KlineCharts is ~20KB vs TradingView's 300KB+), suitable for low-bandwidth environments

### 5.3 TimeframeSelector (`src/components/TimeframeSelector.tsx`)

**Purpose:** Interactive UI component for timeframe selection

**Supported Timeframes:**
- Sub-minute: 1s, 2s, 5s, 15s, 30s
- Minute-hour: 1m, 3m, 5m, 15m, 30m
- Hour-day: 1h, 2h, 4h, 6h, 12h
- Day+: 1d, 3d, 1w, 1M

**Interaction:** Clicking a timeframe button calls `window.yamatoChart.setTimeframe()` and triggers chart reload

### 5.4 WsStatusIndicator (`src/components/WsStatusIndicator.tsx`)

**Purpose:** Visual indicator for Binance WebSocket connection health

**Connection States:**
- `disconnected`: Gray dot, "Disconnected" label
- `connecting`: Yellow animated dot, "Connecting..." label
- `connected`: Green dot, "Live" label
- `error`: Red dot, "Error" label

---

## 6. Binance WebSocket Integration

### 6.1 Custom Hook: `useBinanceWs` (`src/hooks/useBinanceWs.ts`)

**Purpose:** Manages Binance Futures WebSocket connection with automatic reconnection and stream selection

**Key Features:**
- **Smart Stream Selection:**
  - 1s timeframe → `{sym}@kline_1s` (native 1-second stream)
  - 2s–30s → `{sym}@aggTrade` (aggregate trades manually into candles)
  - 1m+ → `{sym}@kline_{interval}` (native Binance kline streams)
- **Auto-Reconnect with Exponential Backoff:** 1s → 30s max retry delay
- **Connection Status Callbacks:** Emits `connecting`, `connected`, `error`, `disconnected` states
- **Performance Optimization:** Callback refs prevent unnecessary reconnections when callbacks update

**Binance Endpoint:** `wss://fstream.binance.com/ws` (Binance Futures WebSocket, not Spot)

### 6.2 Message Types (`src/types/binance.ts`)

#### Kline (Candlestick) Message Format
```typescript
interface BinanceKlineMsg {
  e: 'kline';
  E: number;        // event time (milliseconds)
  s: string;        // symbol (BTCUSDT, ETHUSDT, etc)
  k: {
    t: number;      // kline open time (ms)
    T: number;      // kline close time (ms)
    s: string;      // symbol
    i: string;      // interval (1s, 5m, 1h, etc)
    o: string;      // open price (string to preserve precision)
    c: string;      // close price
    h: string;      // high price
    l: string;      // low price
    v: string;      // base asset volume
    n: number;      // number of trades in this kline
    x: boolean;     // is this kline closed/final?
    q: string;      // quote asset volume
  };
}
```

#### Aggregate Trade Message Format
```typescript
interface BinanceAggTradeMsg {
  e: 'aggTrade';
  E: number;        // event time (ms)
  s: string;        // symbol
  a: number;        // aggregate trade id
  p: string;        // price
  q: string;        // quantity
  T: number;        // trade time (ms)
  m: boolean;       // buyer is maker? (true = buy, false = sell)
}
```

### 6.3 Candle Aggregation (`src/hooks/useKlineBuffer.ts`)

**Purpose:** Manually aggregate aggTrade messages into candlesticks for sub-minute timeframes (1s-30s)

**Aggregation Logic:**
1. Collect all aggTrade messages within a time window (e.g., 5 seconds for 5s timeframe)
2. Calculate OHLCV from collected trades:
   - Open: first trade price
   - High: maximum trade price
   - Low: minimum trade price
   - Close: last trade price
   - Volume: sum of all quantities
3. Emit completed candle to chart
4. Reset buffer and start next window

**Timeframes Using Aggregation:** 1s, 2s, 5s, 15s, 30s

---

## 7. TradingView Datafeed Implementation (`src/datafeed/`)

**Purpose:** Implements TradingView's `IDatafeedChartApi` interface for compatibility with TradingView Advanced Charts

### 7.1 Datafeed Factory (`src/datafeed/index.ts`)

```typescript
export function createDatafeed(options: DatafeedOptions = {}): IDatafeedChartApi
```

**Implements the following methods:**
- `onReady(callback)` — Returns supported resolutions and chart capabilities
- `resolveSymbol(symbolName, onResolve, onError)` — Symbol metadata lookup
- `searchSymbols(input, exchange, type, onResult)` — Search symbols by name/ticker
- `getBars(symbolInfo, resolution, params, onResult, onError)` — Fetch historical OHLCV bars
- `subscribeBars(symbolInfo, resolution, onBar, uid, onResetCache)` — Subscribe to real-time bar updates
- `unsubscribeBars(uid)` — Unsubscribe from real-time updates

### 7.2 Historical Data (`src/datafeed/history.ts`)

**Data Source:** Binance REST API `/fapi/v1/klines` endpoint

**Request Format:**
```
GET https://fapi.binance.com/fapi/v1/klines
  ?symbol=BTCUSDT
  &interval=1h
  &limit=1000
  &startTime=<from_timestamp>
  &endTime=<to_timestamp>
```

**Response Format:** Array of `[openTime, open, high, low, close, volume, ...]`

**Caching:** 8-second cache to reduce redundant Binance API calls

### 7.3 Real-time Data (`src/datafeed/realtime.ts`)

**Data Source:** Binance WebSocket (via `useBinanceWs` hook)

**Update Flow:**
1. User subscribes to chart updates for a specific timeframe
2. Hook establishes WebSocket connection to appropriate stream (kline or aggTrade)
3. Market data messages arrive from Binance in real-time
4. Chart receives updates and renders candlesticks instantly
5. Latest close price emitted via callback for display in header

### 7.4 Symbol Metadata (`src/datafeed/symbology.ts`)

**Supported Symbols:** 100+ crypto pairs including:
- Major: BTC, ETH, SOL, DOGE, ADA, XRP, DOT, MATIC, AVAX, LINK
- Secondary: UNI, ATOM, LTC, BCH, NEAR, APT, ARB, OP, FIL, ICP
- Emerging: SHIB, TRX, ETC, XLM, HBAR, BNB, PEPE, WIF

**Symbol Metadata Format:**
```typescript
{
  name: 'BTCUSDT',
  ticker: 'BTCUSDT',
  type: 'crypto',
  session: '24x7',  // 24-hour market
  currency_code: 'USDT',
  minmov: 1,
  pricescale: 100,  // Decimal places for price formatting
  has_intraday: true,
  has_daily: true,
  has_weekly_and_monthly: true,
}
```

**Resolution Mapping Across Three Systems:**

| App Timeframe | TradingView Resolution | Binance Interval |
|---|---|---|
| 1s | 1S | 1s |
| 2s | 2S | (via aggTrade) |
| 5s | 5S | (via aggTrade) |
| 1m | 1 | 1m |
| 5m | 5 | 5m |
| 1h | 60 | 1h |
| 1d | 1D | 1d |
| 1w | 1W | 1w |

---

## 8. Build & Deployment

### Build Process

**Build Command:**
```bash
cd _src
npm install
npm run build
```

**Outputs:**
- **Location:** `./js/chart/chart.js` (relative to project root)
- **Format:** IIFE (Immediately Invoked Function Expression)
- **Size:** ~50-100KB minified (varies based on optimization level)
- **Dependencies:** None (all inlined into single file)

### Development Server

```bash
cd _src
npm install
npm run dev
# Vite dev server on http://localhost:5173
```

Allows hot-module reloading (HMR) for rapid development iteration.

### Production HTML Integration

In HTML pages (e.g., `page/bot-detail.html`):

```html
<!-- Optional: Load TradingView library if available -->
<script src="/charting_library/charting_library.js"></script>

<!-- Load the YamatoChart widget -->
<script src="/js/chart/chart.js"></script>

<!-- HTML container for chart -->
<div id="chart-root"></div>

<!-- Use the API -->
<script>
  if (window.yamatoChart) {
    window.yamatoChart.setSymbol('ETHUSDT');
    window.yamatoChart.setTimeframe('5m');
  }
</script>
```

---

## 9. Architecture & Data Flow

### Request Flow: Page Load → Chart Display

```
1. HTML page loads → <script src="/js/chart/chart.js"></script>
   ↓ chart.js executes (IIFE), creates window.yamatoChart global
   ↓
2. Vanilla JavaScript calls window.yamatoChart.setSymbol('BTCUSDT')
   ↓ Signal reaches React component (TVChartWidget or ChartWidget)
   ↓
3. Component initializes useBinanceWs hook
   ↓ Connects to Binance WebSocket: wss://fstream.binance.com/ws
   ↓
4. datafeed/history.ts fetches historical bars from Binance REST API
   ↓ (HTTP GET /fapi/v1/klines?symbol=BTCUSDT&interval=...)
   ↓
5. Chart renders candlestick bars in SVG/Canvas
   ↓
6. Real-time kline/aggTrade messages stream from WebSocket
   ↓ Updates candle state in React
   ↓
7. Price changes → window.onPriceUpdate() callback
   ↓ Updates #livePrice DOM element with formatted price
```

### Data Sources

| Data Type | Source | Transport | Frequency | Usage |
|---|---|---|---|---|
| OHLCV History | Binance REST API | HTTPS GET | On-demand (page load) | Chart initialization |
| Real-time Bars | Binance WebSocket Futures | WebSocket | Every 1s (kline), every trade (aggTrade) | Live chart updates |
| Symbol List | Hardcoded in `symbology.ts` | In-memory | Static | Symbol search, metadata |
| Trade Markers | `window.yamatoChart.addTradeMarker()` | JavaScript callback | Manual API calls | Bot entry/exit visualization |

---

## 10. Key Design Decisions

### 1. **Direct Binance WebSocket (No Proxy)**
- Browser connects directly to `wss://fstream.binance.com`
- **Rationale:** Reduces server load, improves latency, enables real-time updates
- **Security:** API keys never sent to charting library (stored server-side)
- **Intentional architectural choice** — not a oversight

### 2. **IIFE + Global API (No ES6 Modules)**
- Single `chart.js` file with no module system
- Can be loaded via simple `<script>` tag in vanilla HTML
- **Rationale:** Maximizes compatibility with legacy pages, reduces bundle overhead
- No build tools or bundlers required on host page

### 3. **Dual Component Approach (TV + KlineCharts)**
- **TVChartWidget:** Professional TradingView (if library available)
- **ChartWidget:** Lightweight fallback (open-source KlineCharts)
- **Rationale:** Graceful degradation; site works even if TradingView unavailable

### 4. **Sub-Minute Timeframe Strategy (aggTrade)**
- 1s–30s timeframes use `@aggTrade` stream with manual aggregation
- Reason: Binance Futures API doesn't natively support sub-second klines
- **Result:** More bandwidth-efficient than polling REST API repeatedly

### 5. **Minimal npm Dependencies**
- Only KlineCharts in package.json (TradingView loaded externally)
- React bundled into single file (not external CDN)
- **Rationale:** Faster builds, smaller install size, fewer supply-chain risks

---

## 11. Integration with Main Project

### Where _src/ Output is Used

1. **bot-detail.html** (`page/bot-detail.html`) — PRIMARY
   - Displays live trading chart for bot monitoring
   - Calls `window.yamatoChart.setSymbol(pair)` based on active bot settings
   - Shows trade entry/exit markers via `addTradeMarker()` API

2. **Future Dashboard Updates** (page/datedos.html) — POTENTIAL
   - Could integrate chart widget for portfolio overview
   - Currently uses embedded TradingView Lightweight Charts

### Compilation Output Location

**After `npm run build` in `_src/`:**
- Output File: `./js/chart/chart.js` (relative to project root)
- Size: ~50-100KB minified
- Format: Self-contained IIFE
- No external dependencies required

### Integration Points

- **HTML pages:** `<script src="/js/chart/chart.js"></script>`
- **JavaScript API:** `window.yamatoChart.*` methods
- **No npm/module system required** on host page

---

## 12. Performance Characteristics

### Strengths
- **Single-file deployment** — Fast initial load, no HTTP parallelization overhead
- **Lazy WebSocket** — Connects only when chart is visible/mounted
- **8-second cache** — Reduces redundant Binance API calls
- **Efficient aggregation** — Uses React refs to avoid unnecessary re-renders
- **Direct WebSocket** — Real-time data without server round-trip latency

### Potential Improvements
- Service Worker caching for historical data across sessions
- WebSocket reconnect queue to prevent message loss during network hiccups
- Memory cleanup on chart unmount (prevent memory leaks in long-running SPAs)
- WASM for ultra-high-frequency candle aggregation
- Compression for large historical datasets

---

## 13. Known Limitations & Workarounds

| Limitation | Impact | Workaround |
|---|---|---|
| TradingView library required for full features | Some indicators unavailable if library missing | Falls back to KlineCharts; include TradingView script |
| Binance Futures API only (not Spot) | Spot trading pairs not available | Future: add Spot API option |
| No chart history replay | Cannot "replay" historical data with current time | Design limitation of Binance data model |
| Manual symbol list | Hardcoded symbols, not dynamic | Future: fetch from Binance exchange info endpoint |
| No offline mode | Requires live Binance connection | By design; real-time trading depends on live data |
| TypeScript strict mode off | Less type safety | Tradeoff for flexibility; enable if type safety critical |
| Single browser WebSocket (not pooled) | Limited to one concurrent stream | Acceptable for single chart; could multiplex if needed |

---

## 14. File Reference Summary (_src/)

| File | Lines | Purpose |
|------|-------|---------|
| `src/main.tsx` | 149 | Entry point, React mount, global API |
| `src/components/TVChartWidget.tsx` | 200+ | TradingView charting component |
| `src/components/ChartWidget.tsx` | 150+ | KlineCharts fallback component |
| `src/components/TimeframeSelector.tsx` | 80+ | Timeframe picker UI |
| `src/components/WsStatusIndicator.tsx` | 60+ | Connection status display |
| `src/hooks/useBinanceWs.ts` | 120+ | WebSocket management + auto-reconnect |
| `src/hooks/useKlineBuffer.ts` | 80+ | Candle aggregation for sub-minute TFs |
| `src/datafeed/index.ts` | 60 | TradingView datafeed factory |
| `src/datafeed/history.ts` | 80+ | Historical bar fetching from REST API |
| `src/datafeed/realtime.ts` | 100+ | Real-time bar subscription handler |
| `src/datafeed/symbology.ts` | 120+ | Symbol metadata & search |
| `src/types/binance.ts` | 122 | Binance message types & mappings |
| `src/types/tradingview.d.ts` | 100+ | TradingView library types (stubs) |
| `src/klpro-datafeed.ts` | 80+ | KlineCharts Pro datafeed (deprecated) |
| `src/overlays.ts` | 40+ | Trade marker overlay utilities |
| `vite.config.ts` | 32 | Build configuration |
| `tsconfig.json` | 16 | TypeScript compiler options |
| `package.json` | 19 | Dependencies & build scripts |

**Total:** ~1,400+ lines of TypeScript

---

**Investigation completed (React/Vite Frontend):** 2026-03-02
**Analyst:** Auto-Claude Agent
**Subtask ID:** subtask-1-3
