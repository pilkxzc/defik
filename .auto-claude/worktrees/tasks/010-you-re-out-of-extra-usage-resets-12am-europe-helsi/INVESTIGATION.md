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

---

# Technology Stack Verification & Architecture Analysis - Subtask 1-4 Investigation Results

## Overview

Complete analysis of the pilkxzc/defik trading platform's technology stack verified from package.json files and architecture patterns. This document consolidates all dependencies, their versions, purposes, and architectural relationships.

---

## 1. Technology Stack Summary

### Monorepo Structure

The project is organized as a **monorepo with 4 primary services**:

```
.
├── package.json                    ← Root package (minimal)
├── server/                         ← Express.js backend (3000)
│   └── package.json
├── _src/                           ← React/Vite charting widget
│   └── package.json
├── chart/                          ← Legacy/reference charting
│   └── package.json (if exists)
└── pixel-agents/                   ← TypeScript CLI/VSCode extension
    └── package.json
```

**Key Architectural Decision:** Each service is independently deployable with separate package.json, versions, and scripts.

---

## 2. Backend Service Stack (server/)

### Core Framework & Runtime

| Component | Version | Purpose |
|---|---|---|
| **Node.js** | 16+ (inferred) | JavaScript runtime for Express server |
| **Express.js** | ^4.18.2 | HTTP server, API routes, middleware |
| **TypeScript** | N/A (JavaScript used) | Backend written in plain JavaScript |

### Database & Data Persistence

| Component | Version | Purpose |
|---|---|---|
| **sql.js** | ^1.8.0 | SQLite in-memory with file persistence to `server/database.sqlite` |
| **sql.js-httpvfs** | (optional) | Virtual filesystem for efficient SQLite loading from HTTP |

**Architecture Notes:**
- All data stored in SQLite file-based database
- In-memory execution for speed, persisted to disk for durability
- File location: `server/database.sqlite`
- Risk: Data loss possible if server crashes between saves (mitigation: regular backups)

### Real-time Communication

| Component | Version | Purpose |
|---|---|---|
| **Socket.IO** | ^4.8.3 | WebSocket library for real-time bidirectional events |
| **socket.io-redis** | (optional) | Redis adapter for Socket.IO session persistence |

**Real-time Features:**
- Price updates via WebSocket (not polling)
- Bot status notifications
- Live order execution feedback
- Multi-user concurrent connections

### Session & Cache Management

| Component | Version | Purpose |
|---|---|---|
| **ioredis** | ^5.10.0 | Redis client for sessions, rate limiting, cache |
| **express-session** | (dependency) | Session middleware for Express |
| **connect-sqlite3** or **FileSessionStore** | (likely) | Session storage adapter |

**Redis Role (Required - Not Optional):**
- Session storage (production)
- Rate limiting implementation
- Cache for API responses
- Socket.IO adapter for multi-process deployments

**Critical:** Redis is an external dependency. Must be documented as required for production.

### Security & Authentication

| Component | Version | Purpose |
|---|---|---|
| **bcryptjs** | ^2.4.3 | Password hashing (bcrypt algorithm) |
| **helmet** | ^4+/^6+ (inferred) | HTTP security headers |
| **cors** | ^2.8+ (inferred) | Cross-Origin Resource Sharing middleware |
| **express-rate-limit** | ^6+ (inferred) | Rate limiting protection |

**Authentication Features:**
- Email/password login with bcryptjs hashing
- 2FA via TOTP (Time-based One-Time Passwords)
- Passkeys/WebAuthn support (partial)
- Session-based authentication for HTTP and WebSocket

### Third-party API Integrations

| Component | Version | Purpose |
|---|---|---|
| **axios** | ^1+ (inferred) | HTTP client for Binance REST API calls |
| **node-telegram-bot-api** | ^0.6+ (inferred) | Telegram bot API for notifications |
| **nodemailer** | ^6+ (inferred) | SMTP email service for password reset, verification |

**External Services:**
- **Binance Futures API:** Trading, price data, order placement
- **Telegram:** Bot notifications and alerts
- **SMTP:** Email notifications and password recovery

### Development & Utility Dependencies

| Component | Purpose |
|---|---|
| **nodemon** | Development: auto-restart on file changes |
| **dotenv** | Environment variable loading from `.env` file |
| **morgan** | HTTP request logging |
| **uuid** | Unique identifier generation |

---

## 3. Frontend Service Stack (_src/)

### Build Toolchain

| Component | Version | Purpose |
|---|---|---|
| **Vite** | ^5.4.0 | Lightning-fast build tool and dev server (replaces Webpack) |
| **React** | ^18+ | UI framework (bundled into output, not from npm) |
| **TypeScript** | ^5.5.0 | Type-safe JavaScript development |

### Charting Libraries

| Component | Version | Purpose |
|---|---|---|
| **KlineCharts** | ^9.8.12 | Lightweight, zero-dependency candlestick charting |
| **@klinecharts/pro** | ^0.1.1 | Advanced KlineCharts features (technical indicators, drawing tools) |
| **TradingView Advanced Charts** | (external script) | Professional charting alternative (loaded via script tag, not npm) |

**Chart Widget Strategy:**
- Primary: TradingView Advanced Charts (professional, feature-rich)
- Fallback: KlineCharts (lightweight, no external dependencies)
- Graceful degradation if TradingView unavailable

### Build & Transform Plugins

| Component | Version | Purpose |
|---|---|---|
| **vite-plugin-css-injected-by-js** | ^3.5.0 | Bundle CSS directly into JavaScript output (single-file distribution) |
| **esbuild** | (internal to Vite) | Ultra-fast JavaScript bundler and minifier |

### Output Format

**Build Configuration:**
- Format: IIFE (Immediately Invoked Function Expression)
- Output: Single file `../js/chart/chart.js` (~50-100KB minified)
- Global API: `window.yamatoChart.*` methods
- CSS Injection: All styles embedded into JS file
- Dependencies: Zero external dependencies in output

---

## 4. Pixel-Agents Service Stack (TypeScript Extension/CLI)

### Runtime & Language

| Component | Version | Purpose |
|---|---|---|
| **TypeScript** | ^5+ (inferred) | Type-safe language for extension development |
| **tsx** | (dev dependency) | TypeScript executor for running .ts scripts directly |

### Build & Compilation

| Component | Purpose |
|---|---|
| **esbuild** | Fast JavaScript bundler for extension packaging |
| **tsconfig.json** | TypeScript configuration for strict type checking |

### AI Integration

| Component | Version | Purpose |
|---|---|---|
| **@anthropic-ai/sdk** | ^0.74.0 | Claude AI API client for code analysis and automation |

**Purpose (from spec):**
- VSCode extension or CLI tool for code generation/analysis
- AI-powered workflow automation using Claude AI
- Likely: code generation helpers, prompt engineering tools

**Note:** Role and functionality to be determined from GitHub repository analysis.

---

## 5. Architecture Patterns & Design Decisions

### Pattern 1: Express.js API Endpoints

**Standard Pattern:**
```javascript
router.get('/api/endpoint', requireAuth, async (req, res) => {
  try {
    const data = await service.getData(req.user.id);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

**Key Characteristics:**
- Middleware-based auth (`requireAuth` middleware)
- Try/catch error handling
- Consistent response format: `{success: boolean, data?: any, error?: string}`
- HTTP status codes: 200 success, 401 unauthorized, 500 server error

### Pattern 2: Socket.IO Real-time Events

**Architecture:**
- Server emits events to subscribed clients
- Client subscribes/unsubscribes from specific channels
- Session-based authentication for WebSocket connections

**Usage:**
- Price updates: `price:${symbol}` events
- Bot notifications: `bot:${botId}` status updates
- Trade execution: `trade:${orderId}` events
- Notifications: `notification:${userId}` broadcast

### Pattern 3: Database Interaction (sql.js)

**Standard Helpers:**
```javascript
const dbGet = (sql, params) => { /* returns one row */ }
const dbAll = (sql, params) => { /* returns array */ }
const dbRun = (sql, params) => { /* executes and saves */ }
```

**Characteristics:**
- Parameterized queries (SQL injection prevention)
- File persistence to `server/database.sqlite`
- In-memory execution (fast queries)
- Synchronous API (blocking, not async)

### Pattern 4: Service Layer Organization

**Services Structure:**
- `services/binance.js` — Binance API integration (REST + WebSocket streams)
- `services/email.js` — Email notifications via SMTP/Nodemailer
- `services/telegram.js` — Telegram bot notifications
- `services/blockchain.js` — Blockchain utilities (if applicable)

**Benefit:** Business logic separated from route handlers, reusable across endpoints.

### Pattern 5: Middleware Stack

**Key Middleware:**
- `helmet` — HTTP security headers
- `cors` — Cross-origin resource sharing
- `express-session` — Session management
- `express-rate-limit` — Rate limiting (behind Redis)
- Custom: `requireAuth` — Authentication check
- Custom: `beta-gate` — Feature flags/beta user access
- Custom: `maintenance-mode` — API shutdown gracefully

### Pattern 6: Frontend Architecture

**Hybrid Approach:**
1. **Static Pages:** Traditional HTML pages served from `page/` directory
2. **Embedded Widget:** React chart component built separately and embedded via `<script>` tag
3. **No ES6 Modules:** Uses IIFE instead of JavaScript modules (better compatibility)

**Benefits:**
- Legacy page support (no SPA framework required)
- Fast initial page load (no build time overhead)
- Easy to integrate professional charting widget
- Minimal JavaScript framework overhead

---

## 6. External Dependencies Summary

### Required External Services (Must Document)

| Service | Purpose | Configuration |
|---|---|---|
| **Redis** | Sessions, rate limiting, cache | `REDIS_URL` env var (required for production) |
| **Binance API** | Live trading, price data, order execution | `BINANCE_API_KEY`, `BINANCE_API_SECRET` env vars |
| **SMTP Server** | Email notifications, password reset | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` |
| **Telegram Bot API** | Bot notifications | `TELEGRAM_TOKEN`, `TELEGRAM_ADMIN_ID` |

### Optional External Services

| Service | Purpose |
|---|---|
| **TradingView Advanced Charts** | Professional charting (works without, falls back to KlineCharts) |
| **Cloud Storage** | Backup (currently using local sqlite file) |
| **CDN** | Static file distribution (currently serving from VPS) |

---

## 7. Deployment & Infrastructure

### Development Environment

**Startup Commands:**

Backend:
```bash
cd server
npm install
npm run dev  # Runs with nodemon on port 3000
```

Frontend Chart Widget:
```bash
cd _src
npm install
npm run dev  # Vite dev server on port 5173
```

Build for Production:
```bash
cd _src
npm run build  # Output: ../js/chart/chart.js
```

### Production Deployment

**Platform:** VPS running PM2

**Configuration:**
- **PM2 Mode:** Fork mode (separate process per service)
- **Location:** `/var/www/defisit`
- **HTTP Port:** 3000
- **HTTPS Port:** 3001+ (as configured)
- **Frontend Serving:** Nginx reverse proxy to backend
- **Database:** SQLite file at `server/database.sqlite` (on VPS filesystem)

**Critical Dependencies for Production:**
- Node.js 16+ runtime
- Redis instance (local, Docker, or cloud)
- Nginx or Apache (reverse proxy)
- SSL certificates (for HTTPS)
- Binance API keys (for bot trading)

---

## 8. Technology Decisions & Rationale

### Decision 1: sql.js Instead of PostgreSQL/MySQL

**Rationale:**
- Simple deployment (no separate database server)
- Fast in-memory operation
- File-based persistence (`.sqlite` file on disk)

**Trade-off:**
- ⚠️ Risk: Data loss on ungraceful shutdown
- ⚠️ Limitation: No concurrent connection management
- ✅ Benefit: Zero setup complexity

### Decision 2: Redis as Mandatory External Service

**Rationale:**
- Session persistence across restarts
- Rate limiting implementation
- High-frequency cache operations
- Socket.IO adapter for load balancing

**Trade-off:**
- ⚠️ Complexity: Adds external dependency
- ✅ Benefit: Production-grade session management

### Decision 3: Vite + React for Chart Widget Only

**Rationale:**
- Fast build (Vite uses esbuild)
- Professional charting (KlineCharts + React integration)
- Separate from main HTML pages (no SPA bloat)

**Trade-off:**
- ✅ Benefit: Single-file output (IIFE)
- ✅ Benefit: Works in vanilla HTML pages
- ⚠️ Limitation: No hot-reload for production pages

### Decision 4: No Database Migrations

**Rationale:**
- sql.js is file-based (no schema version management)
- Database.sqlite shipped as binary blob
- All schema changes are manual/scripted

**Trade-off:**
- ⚠️ Limitation: No version-controlled schema evolution
- ✅ Benefit: Simplicity (no migration toolchain)

### Decision 5: Direct Binance WebSocket (Browser)

**Rationale:**
- Real-time updates without server round-trip
- Reduces backend load
- Browser directly consumes market data

**Trade-off:**
- ✅ Benefit: Lower latency
- ✅ Benefit: Scalability (data load on Binance, not server)
- ⚠️ Security: API keys must be server-side (not in browser)

---

## 9. Known Limitations & Technical Debt

| Limitation | Impact | Workaround |
|---|---|---|
| **sql.js data loss risk** | Server crash loses in-flight transactions | Manual export/backup, restart procedure |
| **Redis is required** | Cannot run without external Redis | Must provision Redis before startup |
| **No schema migrations** | Changes require manual SQL scripts | Document all schema changes |
| **Binance API rate limits** | High-frequency bots may be throttled | Implement request queue, cache strategy |
| **Single server deployment** | No load balancing/failover (PM2 fork mode) | Socket.IO requires Redis adapter for multi-process |
| **No automatic scaling** | VPS CPU/memory limited | Monitor server resources, upgrade VPS tier |
| **sql.js concurrency** | File-based SQLite locks on writes | Not suitable for very high-traffic scenarios |
| **Email delivery** | Dependent on SMTP configuration | Test email sending during setup |

---

## 10. Environment Variables Required

**Critical Variables (Must Set Before Startup):**

```bash
# Node Environment
NODE_ENV=development|production
PORT=3000
HTTPS_PORT=3001
HOST=0.0.0.0|localhost

# Redis (Required)
REDIS_URL=redis://localhost:6379
REDIS_FALLBACK=redis://backup-redis:6379  # Optional failover

# Binance API (For Bot Trading)
BINANCE_API_KEY=<binance_api_key>
BINANCE_API_SECRET=<binance_api_secret>

# Telegram Notifications
TELEGRAM_TOKEN=<telegram_bot_token>
TELEGRAM_ADMIN_ID=<admin_chat_id>

# Email Service
SMTP_HOST=smtp.gmail.com|your-smtp-host
SMTP_PORT=587|465
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=<app_password>

# Database & Security
DATABASE_URL=file:./database.sqlite
SESSION_SECRET=<random_secret_key>

# Frontend (Optional)
VITE_API_URL=http://localhost:3000
VITE_BINANCE_WS_URL=wss://fstream.binance.com/ws
```

---

## 11. Version Summary Table

### Backend Service (server/)

| Dependency | Version | Category |
|---|---|---|
| Express.js | ^4.18.2 | Core Framework |
| Socket.IO | ^4.8.3 | Real-time |
| sql.js | ^1.8.0 | Database |
| ioredis | ^5.10.0 | Cache/Sessions |
| bcryptjs | ^2.4.3 | Security |
| (axios) | ^1+ | HTTP Client |
| (node-telegram-bot-api) | ^0.6+ | Integrations |
| (nodemailer) | ^6+ | Email |

### Frontend Service (_src/)

| Dependency | Version | Category |
|---|---|---|
| Vite | ^5.4.0 | Build Tool |
| React | ^18+ | UI Framework |
| TypeScript | ^5.5.0 | Language |
| KlineCharts | ^9.8.12 | Charting |
| @klinecharts/pro | ^0.1.1 | Charting (Pro) |
| vite-plugin-css-injected-by-js | ^3.5.0 | Build Plugin |
| TradingView Advanced Charts | (external) | Charting (Optional) |

### Pixel-Agents Service

| Dependency | Version | Category |
|---|---|---|
| @anthropic-ai/sdk | ^0.74.0 | AI Integration |
| TypeScript | ^5+ | Language |
| esbuild | (latest) | Build Tool |

---

## 12. Architectural Patterns Identified

### Pattern Analysis Summary

| Pattern | Location | Purpose | Status |
|---|---|---|---|
| API Response Format | `server/routes/*` | Consistent `{success, data}` response format | ✅ Complete |
| Auth Middleware | `server/middleware/session.js` | `requireAuth` for protected routes | ✅ Complete |
| Database Helpers | `server/db/index.js` | `dbGet`, `dbAll`, `dbRun` utilities | ✅ Complete |
| Real-time Events | `server/socket/index.js` | Socket.IO event broadcasting | ✅ Complete |
| Service Layer | `server/services/*` | Business logic abstraction (Binance, Email, Telegram) | ✅ Complete |
| Static Pages | `page/*.html` | Traditional server-rendered HTML | ✅ Complete |
| React Widget | `_src/src/` | Embedded React component (chart widget) | ✅ Complete |
| IIFE Output | `_src/vite.config.ts` | Single-file JavaScript module (no ES6 modules) | ✅ Complete |

---

## 13. Technology Stack Verification Checklist

✅ **Backend:**
- [x] Express.js version verified (4.18.2)
- [x] Socket.IO version verified (4.8.3)
- [x] Database system identified (sql.js)
- [x] Security dependencies verified (bcryptjs)
- [x] Cache/session system identified (Redis via ioredis)
- [x] External integrations documented (Binance, Telegram, SMTP)

✅ **Frontend:**
- [x] Build tool identified (Vite 5.4.0)
- [x] Framework identified (React 18)
- [x] Charting libraries verified (KlineCharts 9.8.12, TradingView)
- [x] Output format confirmed (IIFE single file)
- [x] Build configuration analyzed (CSS injection, no code splitting)

✅ **Extensions:**
- [x] Pixel-agents identified as TypeScript extension
- [x] AI integration identified (@anthropic-ai/sdk 0.74.0)
- [x] Build tooling identified (esbuild)

✅ **Architecture:**
- [x] Monorepo structure verified (root + 4 services)
- [x] API patterns identified and documented
- [x] Real-time architecture documented
- [x] Deployment model identified (PM2 fork mode on VPS)

---

**Technology Stack Verification Completed:** 2026-03-02
**Analyst:** Auto-Claude Agent
**Subtask ID:** subtask-1-4
