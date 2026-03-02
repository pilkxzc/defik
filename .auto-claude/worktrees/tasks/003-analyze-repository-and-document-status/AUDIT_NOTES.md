# Server Core Audit Notes

## server/server.js — Entry Point

**Status:** Functional, well-structured

- Startup sequence: loadSettings → initDatabase → Express setup → HTTP server → Socket.IO → routes → Telegram bot → candle collector → HTTPS
- Middleware chain order: `trust proxy` → `cors(origin: *)` → `json` → `urlencoded` → `maintenanceMiddleware` → `static` → `session` → `betaSubmit` → `betaMiddleware` → routes
- 11 route modules loaded (auth, market, portfolio, bots, profile, faucet, notifications, subscription, orders, admin, history)
- HTML page routes served via `res.sendFile()` with inline auth/role checks for `/bot/:id` and `/bot-dashboard/:id`
- `/bot/:id` has inline mobile detection + full HTML response (~50 lines of embedded HTML) — could be extracted to a template
- HTTPS server: optional, wrapped in try/catch, uses SSL creds from `utils/ssl`
- Graceful shutdown: stops candle collector, saves DB, closes HTTP server, 5s force-exit timeout
- Global error handlers: `uncaughtException` and `unhandledRejection` — log only, no crash
- **Note:** CORS is `origin: '*'` — wide open, acceptable for dev/beta but should be tightened for production
- **Note:** `dbGet` is called synchronously in the `/bot/:id` route handler (sql.js is sync, so this works but is unusual)

## server/config/index.js — Configuration

**Status:** Functional, simple

- Ports: `PORT=3000`, `HTTPS_PORT=3443`, `HOST=0.0.0.0` (all overridable via env)
- Hardcoded admin email: `gerbera.uh@gmail.com`
- Paths: DB, sessions, settings, SSL key/cert — all relative to `server/` parent dir
- `siteSettings` is a mutable shared object (singleton pattern) with: maintenance mode, telegram bot config, SMTP config
- `loadSettings()` / `saveSettings()` — read/write `settings.json`, uses `Object.assign` to merge
- **Note:** `loadSettings` silently swallows parse errors with a generic "Creating new settings file" log — could mask corruption
- **Note:** No env var support for sensitive values (SMTP pass, telegram token) — all stored in plaintext `settings.json`

## server/db/index.js — Database Layer

**Status:** Functional, growing complexity

- Uses `sql.js` (in-memory SQLite compiled to WASM), loaded from file on startup
- **20 tables** created via `CREATE TABLE IF NOT EXISTS`:
  - `users`, `bots`, `bot_subscribers`, `bot_trades`, `bot_stats`, `bot_categories`, `bot_order_history`, `bot_notification_settings`
  - `transactions`, `orders`, `holdings`, `wallets`, `portfolio_snapshots`
  - `notifications`, `news`, `password_reset_tokens`, `email_verification_tokens`, `passkeys`
  - `activity_log`, `payment_methods`, `permissions`, `user_permissions`, `admin_audit_log`
- **~30 ALTER TABLE migrations** using try/catch pattern (silently ignores "duplicate column" errors) — covers users, bots, bot_subscribers, bot_trades, wallets, etc.
- Seed data: 3 default bot categories, 10 default permissions, auto-promote admin by email
- Demo balance migration: sets `demo_balance` from `balance` or defaults to 10000
- 2 unique indexes on `bot_trades` for Binance trade ID deduplication
- `dbGet(sql, params)` — returns single row object or null
- `dbAll(sql, params)` — returns array of row objects
- `dbRun(sql, params)` — executes, calls `saveDatabase()` after every write, returns `{ lastInsertRowid }`
- `saveDatabase()` — exports entire DB to buffer, writes to disk synchronously
- **Concern:** `dbRun` saves the entire database to disk on every single write operation — potential performance issue under load
- **Concern:** No transaction support exposed — multi-step operations are not atomic
- **Concern:** Migration pattern (try/catch ALTER TABLE) works but doesn't track which migrations have run — could be fragile at scale
- **Concern:** Table creation order matters — `bots` ALTER TABLE runs before `bots` CREATE TABLE in source order (lines 53-62 vs 186-198), relies on tables existing from previous DB file

## server/socket/index.js — Socket.IO

**Status:** Functional, clean

- Socket.IO server with `cors: { origin: "*", credentials: true }`
- Session sharing: wraps Express session middleware for socket connections
- Connected users tracked via `Map<userId, Set<socketId>>` — supports multiple tabs/devices
- Users auto-join personal room `user_{userId}` for targeted notifications
- Price broadcast: `setInterval` every 3 seconds, emits `priceUpdate` to all clients
- `sendUserNotification(userId, notification)` — targeted push to user's room
- `getIo()` exported for use by other modules
- **Note:** No authentication enforcement — unauthenticated sockets can connect (just won't join a user room)
- **Note:** `priceInterval` is set but never cleared except implicitly on process exit — no `stopSocket()` function

## server/middleware/session.js — Session Store & Middleware

**Status:** Functional, has performance concerns

- Custom `FileSessionStore` extends `express-session.Store`, backed by `server/sessions.json`
- All sessions kept in-memory (`this.sessions` object) with file persistence
- `load()` — reads sessions from disk on startup, runs `cleanExpired()` to purge stale sessions
- `save()` — writes entire sessions object to disk synchronously via `fs.writeFileSync`
- `get(sid, cb)` — checks in-memory first, falls back to re-reading file from disk (race condition recovery)
- `set(sid, sess, cb)` — stores in memory + saves to disk immediately
- `destroy(sid, cb)` — deletes from memory + saves to disk
- `touch(sid, sess, cb)` — updates cookie expiry + saves to disk
- `cleanExpired()` — iterates all sessions, deletes expired ones, saves if changed
- `createSessionMiddleware()` — returns `express-session` configured with FileSessionStore
- Cookie config: `secure: false`, `httpOnly: true`, `sameSite: 'lax'`, `maxAge: 7 days`
- **Concern:** Session secret is hardcoded: `'yamato-secret-key-2024'` — should be an env var for production
- **Concern:** `save()` writes entire file on every `set`, `destroy`, and `touch` — high I/O under concurrent requests
- **Concern:** `get()` re-reads file from disk as fallback — could cause inconsistency in multi-process scenarios
- **Concern:** `load()` silently swallows parse errors — same issue as config's `loadSettings`

## server/middleware/auth.js — Authentication & Authorization

**Status:** Functional, clean design

- `requireAuth(req, res, next)` — checks `req.session.userId` exists, then verifies user is not banned via DB lookup
  - Returns 401 if no session or user not found (destroys orphaned session)
  - Returns 403 with `{ banned: true, reason }` if user is banned (destroys session)
- `requireRole(...roles)` — middleware factory, checks user's DB role against allowed roles list
  - Returns 403 "Access denied" if role doesn't match
- `requirePermission(permissionName)` — middleware factory, checks granular permissions
  - Admin role bypasses all permission checks
  - Looks up `user_permissions` joined with `permissions` table for non-admins
  - Returns 403 with specific missing permission name
- **Note:** `requireRole` and `requirePermission` assume `req.session.userId` is already validated — should be chained after `requireAuth`
- **Note:** `dbGet` is synchronous (sql.js) so no async/await needed — works correctly but unusual for Express middleware

## server/middleware/beta.js — Beta Access Gate

**Status:** Functional, complete

- Hardcoded beta code: `'401483'` — stored in plaintext in source
- `betaMiddleware(req, res, next)` — gate that checks `req.session.betaAccess`
  - Skips check for static asset extensions (js, css, png, jpg, svg, woff2, etc.)
  - Skips check for whitelisted path prefixes: `/beta`, `/logo.svg`, `/css/`, `/fonts/`, `/login`, `/register`, `/verify-email`, `/reset-password`, `/api/auth/login`, `/api/auth/register`, `/api/auth/logout`, `/api/auth/me`
  - API calls get JSON 403 response; browser requests get full HTML beta gate page
- `betaSubmit(req, res)` — POST handler for `/beta` form submission
  - Validates code, sets `req.session.betaAccess = true` on success, redirects to `req.body.next` or `/`
  - On failure, redirects to `/beta?error=1`
- Beta gate page: self-contained HTML with inline CSS (~190 lines), styled card with code input
- **Note:** Beta code is hardcoded in source — not configurable via settings or env var
- **Note:** `betaSubmit` accepts `req.body.next` for redirect — potential open redirect if not validated (no validation present)

## server/middleware/maintenance.js — Maintenance Mode

**Status:** Functional, complete

- `maintenanceMiddleware(req, res, next)` — checks `siteSettings.maintenanceMode` flag
- Always allows through: `/api/auth/me`, `/api/admin/*` routes, and static asset extensions
- Admin/moderator users bypass maintenance mode (checked via DB role lookup)
- API requests get JSON 503 with `siteSettings.maintenanceMessage`
- Browser requests get full HTML maintenance page with inline CSS (~60 lines)
- Maintenance page includes dynamic message from `siteSettings.maintenanceMessage` via template literal
- **Note:** `siteSettings.maintenanceMessage` is injected directly into HTML template literal — potential XSS if message contains HTML (admin-controlled, low risk)
- **Note:** Maintenance page icon background uses `rgba(255, 59, 48, 0.1)` (red) which contradicts the brand guideline of green accent, though the SVG stroke is correctly `#10B981`

---

# API Routes Audit

## server/routes/auth.js — Authentication & Account Routes

**Status:** Functional, comprehensive (818 lines, 26 endpoints)

**Middleware:** `requireAuth` (on protected routes only)

**Endpoints:**
- `POST /api/auth/register` — user registration with bcrypt, email verification, admin auto-promote
- `POST /api/auth/login` — login with 2FA support (TOTP via speakeasy), sets session
- `POST /api/auth/logout` — destroys session
- `GET /api/auth/me` — [requireAuth] current user info
- `GET /api/auth/ip` — returns client IP (public, no auth)
- `GET /api/auth/session` — [requireAuth] session details
- `POST /api/account/switch` — [requireAuth] switch between demo/real account
- `GET /api/account/info` — [requireAuth] account balances
- `POST /api/auth/forgot-password` — sends reset email
- `POST /api/auth/reset-password` — validates token, resets password
- `GET /api/auth/verify-email` — email verification via token
- `POST /api/auth/resend-verification` — resend verification email
- `GET /api/2fa/status` — [requireAuth] 2FA enabled status
- `POST /api/2fa/setup` — [requireAuth] generate TOTP secret + QR code
- `POST /api/2fa/verify` — [requireAuth] verify and enable 2FA
- `POST /api/2fa/disable` — [requireAuth] disable 2FA with token verification
- `GET /api/passkeys` — [requireAuth] list user passkeys
- `POST /api/passkeys/register-options` — [requireAuth] WebAuthn registration options
- `POST /api/passkeys/register-verify` — [requireAuth] verify and store passkey
- `DELETE /api/passkeys/:id` — [requireAuth] remove passkey
- `POST /api/passkeys/auth-options` — WebAuthn authentication options (public)
- `POST /api/passkeys/auth-verify` — WebAuthn authentication verify (public)
- `POST /api/passkeys/check` — check if user has passkeys (public)
- `POST /api/auth/telegram` — Telegram login/link
- `POST /api/auth/telegram-register` — Telegram-based registration
- `GET /api/auth/telegram-bot-username` — get bot username for Telegram widget

**Dependencies:** bcryptjs, speakeasy, qrcode, crypto, services/email, services/notifications
**Completeness:** Full auth lifecycle — register, login, logout, password reset, email verification, 2FA (TOTP), passkeys (WebAuthn), Telegram auth, account switching

## server/routes/market.js — Market Data Routes

**Status:** Functional, lightweight (97 lines, 4 endpoints)

**Middleware:** None (all public)

**Endpoints:**
- `GET /api/market/prices` — fetch all market prices via `getMarketPrices()`
- `GET /api/market/price/:symbol` — single symbol price from Binance API
- `GET /api/market/orderbook/:symbol` — order book (bids/asks, limit param)
- `GET /api/market/ticker` — 24hr ticker stats from Binance

**Dependencies:** axios, services/market (getMarketPrices, getOrderBook, BINANCE_API)
**Completeness:** Basic market data coverage. No caching layer — each request hits Binance API directly
**Note:** All endpoints are public (no auth) — appropriate for market data

## server/routes/portfolio.js — Portfolio & Wallet Routes

**Status:** Functional, well-structured (359 lines, 8 endpoints)

**Middleware:** `requireAuth` on all endpoints

**Endpoints:**
- `GET /api/portfolio` — full portfolio summary (holdings, balances, total value with live prices)
- `GET /api/portfolio/performance` — portfolio performance over time (snapshots + current)
- `GET /api/portfolio/allocation` — asset allocation breakdown by percentage
- `GET /api/wallets` — list tracked wallets with cached balances
- `POST /api/wallets` — add a new tracked wallet (name, address, currency required)
- `DELETE /api/wallets/:id` — remove tracked wallet (ownership check)
- `POST /api/wallets/:id/refresh` — refresh wallet balance from blockchain
- `GET /api/transactions` — transaction history with pagination (limit/offset)

**Dependencies:** services/market, services/blockchain, utils/time, utils/ip
**Completeness:** Full portfolio view + wallet management + transaction history. Performance snapshots enable historical charting

## server/routes/bots.js — Bot Management Routes

**Status:** Functional, largest route module (1357 lines, 31 endpoints)

**Middleware:** `requireAuth` on all; `requireRole('admin', 'moderator')` on write operations

**Endpoints (grouped by function):**
- **CRUD:** `GET /api/bots`, `POST /api/bots`, `DELETE /api/bots/:id`, `GET /api/bots/tree`, `GET /api/bots/:id/details`
- **Settings:** `PATCH /api/bots/:id/settings`, `PATCH /api/bots/:id/api-keys`, `GET|PUT /api/bots/:id/trading-settings`, `PATCH /api/bots/:id/symbol`
- **Control:** `PATCH /api/bots/:id/toggle`, `POST /api/bots/binance`
- **Data:** `GET /api/bots/:id/data`, `GET /api/bots/stats`, `GET /api/bots/:id/stats`, `GET /api/bots/:id/klines`, `GET /api/bots/:id/chart-data`, `GET /api/bots/:id/symbols`
- **Trades:** `GET /api/bots/:id/trades`, `GET /api/bots/:id/orders`, `POST /api/bots/:id/trades`, `POST /api/bots/:id/resync-trades`, `POST /api/bots/:id/sync-trades`, `GET /api/bots/:id/trade-markers`
- **Subscriptions:** `POST /api/bots/:id/subscribe`, `DELETE /api/bots/:id/subscribe`, `PATCH /api/bots/:id/copy-trading`, `POST /api/bots/:id/copy-now`
- **Notifications:** `GET /api/bots/:id/notifications`, `PUT /api/bots/:id/notifications`

**Dependencies:** axios, crypto, services/market (implicit via db), socket (sendUserNotification, getIo)
**Completeness:** Comprehensive bot lifecycle — create, configure, toggle, monitor, subscribe, copy-trade, sync trades from Binance
**Note:** ~450 lines of helper functions before route definitions (trade syncing, Binance API integration)
**Note:** Admin/moderator gating on destructive operations is consistent

## server/routes/profile.js — User Profile Routes

**Status:** Functional, well-organized (262 lines, 13 endpoints)

**Middleware:** `requireAuth` on all endpoints

**Endpoints:**
- `GET /api/profile` — full user profile (excludes password, totp_secret)
- `PATCH /api/profile` — update profile fields (full_name, email, phone, bio, location, website)
- `POST /api/profile/payment-methods` — add payment method
- `DELETE /api/profile/payment-methods/:id` — remove payment method (ownership check)
- `GET /api/profile/payment-methods` — list payment methods
- `POST /api/profile/avatar` — upload avatar (base64, stored as BLOB in DB)
- `GET /api/profile/avatar` — serve avatar image
- `DELETE /api/profile/avatar` — remove avatar
- `GET /api/telegram/status` — Telegram link status
- `POST /api/telegram/link` — link Telegram account
- `POST /api/telegram/unlink` — unlink Telegram account
- `POST /api/telegram/test` — send test Telegram notification
- `GET /api/activity` — user activity log with pagination

**Dependencies:** crypto, services/notifications, services/telegram, config (siteSettings)
**Completeness:** Full profile management + avatar + payment methods + Telegram integration + activity log

## server/routes/faucet.js — Demo Faucet Routes

**Status:** Functional, simple (78 lines, 2 endpoints)

**Middleware:** `requireAuth` on all endpoints

**Endpoints:**
- `GET /api/faucet/status` — check faucet availability (24h cooldown) and demo balance
- `POST /api/faucet/claim` — claim demo tokens (adds 5000 to demo_balance, 24h rate limit)

**Dependencies:** utils/ip, utils/time
**Completeness:** Complete for demo token distribution. Cooldown tracked via `last_faucet_claim` column on users table

## server/routes/notifications.js — Notification Routes

**Status:** Functional, clean (77 lines, 5 endpoints)

**Middleware:** `requireAuth` on all endpoints

**Endpoints:**
- `GET /api/notifications` — list notifications with unread count (limit 50)
- `PUT /api/notifications/:id/read` — mark single notification as read (ownership check)
- `PUT /api/notifications/read-all` — mark all user's notifications as read
- `DELETE /api/notifications/:id` — delete single notification (ownership check)
- `DELETE /api/notifications` — delete all user's notifications

**Dependencies:** db only
**Completeness:** Full CRUD for notifications. No pagination beyond limit 50 hardcoded

## server/routes/subscription.js — Subscription Routes

**Status:** Functional, simulated payments (85 lines, 3 endpoints)

**Middleware:** `requireAuth` on all endpoints

**Endpoints:**
- `GET /api/subscription` — current subscription status (plan, start/end dates, features by tier)
- `POST /api/subscription/checkout` — simulate subscription purchase (deducts from balance, no real payment gateway)
- `POST /api/subscription/cancel` — cancel subscription (resets to free plan)

**Dependencies:** services/notifications
**Completeness:** Subscription lifecycle present but checkout is simulated (balance deduction, no Stripe/payment integration)
**Note:** Hardcoded plan prices and feature lists within the route file

## server/routes/orders.js — Trading Orders Routes

**Status:** Functional, core trading logic (339 lines, 6 endpoints)

**Middleware:** `requireAuth` on all endpoints

**Endpoints:**
- `POST /api/orders` — place market or limit order (buy/sell with balance validation, holdings management)
- `GET /api/orders` — list open orders with pagination
- `GET /api/orders/history` — completed/cancelled order history with pagination
- `DELETE /api/orders/:id` — cancel pending order (refunds balance, ownership check)
- `GET /api/holdings` — all user holdings with live market prices
- `GET /api/holdings/:currency` — single holding detail

**Dependencies:** axios, services/market (getMarketPrices), socket (getIo), utils/ip, utils/time
**Completeness:** Full order lifecycle — place, list, cancel, view holdings. Supports market and limit orders. Balance checks for both demo and real accounts
**Note:** Market orders execute immediately with live Binance prices; limit orders are stored but no matching engine — they need manual or scheduled fulfillment
**Note:** Emits `holdingsUpdate` via Socket.IO after market order execution

## server/routes/admin.js — Admin Panel Routes

**Status:** Functional, largest by scope (1032 lines, 35 endpoints)

**Middleware:** `requireAuth` + `requireRole('admin', 'moderator')` on all; some admin-only endpoints use `requireRole('admin')` exclusively

**Endpoints (grouped by function):**
- **Dashboard:** `GET /api/admin/stats` — platform statistics (user count, bot count, trade count, etc.)
- **Maintenance:** `GET|POST /api/admin/maintenance` — toggle maintenance mode
- **Telegram:** `GET|POST /api/admin/telegram-settings`, `GET /api/admin/telegram-users`
- **Users (11):** `GET /api/admin/users`, `GET /api/admin/users/:id`, `PATCH /api/admin/users/:id`, `PATCH /api/admin/users/:id/password`, `PATCH /api/admin/users/:id/role`, `POST /api/admin/users/:id/ban`, `POST /api/admin/users/:id/unban`, `GET|POST /api/admin/users/:id/permissions`, `DELETE /api/admin/users/:id/permissions/:permissionId`
- **Transactions:** `GET /api/admin/transactions` — with filters and pagination
- **Bots (4):** `GET /api/admin/bots`, `PATCH /api/admin/bots/:id`, `DELETE /api/admin/bots/:id`, `PATCH /api/admin/bots/:id/category`
- **Bot Categories (4):** `GET|POST /api/admin/bot-categories`, `PUT|DELETE /api/admin/bot-categories/:id`
- **Audit Logs:** `GET /api/admin/audit-logs` — with filters and pagination
- **News (public + admin, 6):** `GET /api/news`, `GET /api/news/:id` (public), `GET|POST /api/admin/news`, `PATCH|DELETE /api/admin/news/:id`
- **Subscriptions (3):** `GET /api/admin/subscriptions`, `POST|DELETE /api/admin/users/:id/subscription`
- **DB Explorer (5):** `GET /api/admin/tables`, `GET /api/admin/tables/:name/schema`, `GET /api/admin/tables/:name`, `PUT /api/admin/tables/:name/:id`, `POST /api/admin/tables/:name`, `DELETE /api/admin/tables/:name/:id`

**Dependencies:** bcryptjs, services/notifications, services/telegram, config (siteSettings, saveSettings), utils/ip, utils/time
**Completeness:** Comprehensive admin panel — user management, bot management, content management (news), subscriptions, audit logs, raw DB explorer
**Note:** `GET /api/news` and `GET /api/news/:id` are public endpoints served from the admin route module — could be separated
**Note:** DB explorer (`/api/admin/tables/*`) gives raw SQL table access to admin — powerful but risky, no query sanitization beyond parameterized statements
**Concern:** 6 endpoints for raw DB CRUD — essentially a database admin tool in production. Admin-only gated but high-risk surface area

## server/routes/history.js — Market History Routes

**Status:** Functional, lightweight (85 lines, 2 endpoints)

**Middleware:** None (all public)

**Endpoints:**
- `GET /api/market/history/:symbol` — candle history with aggregation (resolution param, from/to timestamps, countBack)
- `GET /api/market/history/:symbol/info` — available data range info for a symbol

**Dependencies:** services/candleCollector (getCandleHistory, aggregateCandles, getCandleInfo)
**Completeness:** Serves TradingView datafeed requirements (OHLCV history + data range). Relies on candleCollector service having data populated
**Note:** Public endpoints (no auth) — appropriate for chart data

---

# Routes Audit Summary

| Module | File | Lines | Endpoints | Auth | Role-gated | Status |
|--------|------|-------|-----------|------|------------|--------|
| routes/auth.js | auth | 818 | 26 | Partial (14 auth, 12 public) | No | Complete |
| routes/market.js | market | 97 | 4 | None (public) | No | Complete |
| routes/portfolio.js | portfolio | 359 | 8 | All requireAuth | No | Complete |
| routes/bots.js | bots | 1357 | 31 | All requireAuth | 9 admin/mod | Complete |
| routes/profile.js | profile | 262 | 13 | All requireAuth | No | Complete |
| routes/faucet.js | faucet | 78 | 2 | All requireAuth | No | Complete |
| routes/notifications.js | notifications | 77 | 5 | All requireAuth | No | Complete |
| routes/subscription.js | subscription | 85 | 3 | All requireAuth | No | Complete (simulated payments) |
| routes/orders.js | orders | 339 | 6 | All requireAuth | No | Complete |
| routes/admin.js | admin | 1032 | 35 | All requireAuth | All role-gated | Complete |
| routes/history.js | history | 85 | 2 | None (public) | No | Complete |
| **Totals** | | **4589** | **135** | | | |

---

# Services Audit

## server/services/binance.js — Binance API Client

**Status:** Functional, focused (143 lines)

**Exports:** `getBinanceServerTime`, `testBinanceCredentials`, `fetchBinanceFuturesData`

- `getBinanceServerTime(accountType)` — fetches server time from Binance (futures or spot), falls back to `Date.now()` on error
- `testBinanceCredentials(apiKey, apiSecret, accountType)` — validates user-provided Binance API keys by hitting account endpoint with HMAC signature
- `fetchBinanceFuturesData(apiKey, apiSecret)` — comprehensive futures account fetch: positions, open orders (limit/stop/take-profit), recent trades, income history
- All requests use HMAC-SHA256 signing with user-provided credentials
- **Dependencies:** axios, crypto (Node built-in)
- **Environment variables required:** None — uses per-user API keys stored in DB (bot records)
- **Note:** Silently swallows errors on `userTrades` and `income` fetches (empty catch blocks)
- **Note:** Single timestamp used for all requests in `fetchBinanceFuturesData` — could drift if requests take long

## server/services/candleCollector.js — Candle Data Collector

**Status:** Functional, well-architected (272 lines)

**Exports:** `startCollector`, `stopCollector`, `getCandleHistory`, `aggregateCandles`, `getCandleInfo`

- Maintains its own separate SQLite database (`candles.sqlite`) via sql.js
- Tracks 6 symbols: BTCUSDT, ETHUSDT, SOLUSDT, ADAUSDT, DOGEUSDT, DOTUSDT
- **Backfill:** On startup, fetches last 1000 1-second candles per symbol from Binance REST API
- **Live data:** Connects to Binance WebSocket (`wss://stream.binance.com:9443/stream`) for real-time 1s klines
- Only inserts closed candles (`k.x === true`)
- Periodic save every 30 seconds (dirty flag pattern avoids unnecessary writes)
- `aggregateCandles()` — aggregates 1s candles to any timeframe (5s, 15s, 60s, etc.)
- `getCandleHistory()` — query helper with from/to/limit params
- Clean lifecycle: `startCollector()` / `stopCollector()` with proper cleanup
- **Dependencies:** sql.js, ws (optional, graceful fallback if not installed), fetch (Node built-in)
- **Environment variables required:** None — uses public Binance endpoints
- **Note:** WebSocket auto-reconnects on close (5s delay) but no exponential backoff
- **Note:** `ws` module is require'd inside function — graceful degradation if not installed

## server/services/market.js — Market Data Helpers

**Status:** Functional, lightweight (75 lines)

**Exports:** `getMarketPrices`, `getOrderBook`, `BINANCE_API`

- `getMarketPrices()` — fetches prices + 24hr stats for 25 symbols from Binance, with 10-second in-memory cache
- `getOrderBook(symbol, limit)` — fetches order book with 2-second cache per symbol
- Both functions gracefully fall back to cached data on API errors
- **Dependencies:** axios
- **Environment variables required:** None — uses public Binance API
- **Note:** Cache is purely in-memory — lost on restart, but refills quickly

## server/services/email.js — Email Service

**Status:** Functional, graceful degradation (112 lines)

**Exports:** `initEmail`, `sendEmail`, `sendPasswordResetEmail`, `sendVerificationEmail`

- `initEmail()` — creates nodemailer transport from `siteSettings` SMTP config; logs to console if not configured
- `sendEmail(to, subject, html)` — sends email or logs to console as fallback
- `sendPasswordResetEmail()` — branded HTML email template (Ukrainian language)
- `sendVerificationEmail()` — branded HTML email template (Ukrainian language)
- **Dependencies:** nodemailer (lazy require inside `initEmail`)
- **Environment variables required:** Requires SMTP config via `siteSettings` (smtpHost, smtpPort, smtpUser, smtpPass) — stored in `settings.json`, not env vars
- **Note:** Falls back cleanly to console logging when SMTP is not configured — good for dev
- **Note:** Email templates have inline CSS, hardcoded brand color #10B981
- **Note:** `smtpFrom` defaults to `smtpUser` or `noreply@yamato.com`

## server/services/telegram.js — Telegram Bot

**Status:** Functional, feature-rich (220 lines)

**Exports:** `initTelegramBot`, `sendTelegramNotification`, `getTelegramBot`

- `initTelegramBot()` — initializes bot with polling mode if token is configured and enabled in `siteSettings`
- Bot commands: `/start` (link account via code), `/status` (balance/plan), `/unlink`, `/verify` (phone via contact share), `/help`
- Account linking: user generates code on website, sends to bot via `/start <code>`
- Phone verification: uses Telegram's native contact sharing
- Emits Socket.IO events on link/unlink/verify for real-time UI updates
- Suppresses Telegram 409 polling errors (race condition on restart)
- Saves bot username to `siteSettings` after successful init
- **Dependencies:** node-telegram-bot-api (lazy require), db, socket, notifications (lazy requires to avoid circular deps)
- **Environment variables required:** Requires `siteSettings.telegramBotToken` and `siteSettings.telegramBotEnabled` — stored in `settings.json`
- **Note:** Uses polling mode (not webhooks) — simpler but less efficient for production
- **Note:** Multiple lazy requires to break circular dependency chains

## server/services/notifications.js — In-App Notifications

**Status:** Functional, minimal (39 lines)

**Exports:** `createNotification`, `logAdminAction`

- `createNotification(userId, type, title, message, icon)` — inserts notification to DB, pushes via Socket.IO, and sends Telegram notification
- `logAdminAction(adminId, action, targetType, targetId, details, ipAddress)` — audit trail for admin actions
- Acts as a notification hub — coordinates DB, WebSocket, and Telegram delivery in one call
- **Dependencies:** db, socket (lazy require), telegram (lazy require)
- **Environment variables required:** None — uses DB and other services
- **Note:** Lazy requires for socket and telegram to avoid circular dependencies
- **Note:** No error handling around Socket.IO or Telegram calls — if either fails, the notification is still created in DB but the error propagates

## server/services/blockchain.js — Blockchain Utilities

**Status:** Functional, focused (93 lines)

**Exports:** `getBlockchainBalance`, `validateWalletAddress`, `WALLET_CACHE_TTL`

- Supports 3 chains: ETH (via Cloudflare RPC), BTC (via blockchain.info), SOL (via Solana mainnet RPC)
- `getBlockchainBalance(address, currency)` — dispatches to chain-specific balance fetcher
- `validateWalletAddress(address, currency)` — regex validation for ETH (0x), BTC (legacy + bech32), SOL (base58)
- All balance fetches have 5-minute in-memory cache with stale-on-error fallback
- 10-second timeout on all external requests
- **Dependencies:** axios
- **Environment variables required:** None — uses public blockchain endpoints
- **Note:** Uses free public RPC endpoints — may hit rate limits under heavy use
- **Note:** Unknown currencies return 0 balance and pass validation (permissive default)

---

## Services Summary Table

| Service | File | Lines | Env Vars Required | External APIs | Status |
|---------|------|-------|-------------------|---------------|--------|
| services/binance.js | Binance API client | 143 | None (per-user keys in DB) | Binance REST (signed) | Functional |
| services/candleCollector.js | Candle data collector | 272 | None | Binance REST + WebSocket | Functional |
| services/market.js | Market data helpers | 75 | None | Binance REST (public) | Functional |
| services/email.js | Email sending | 112 | SMTP config in settings.json | SMTP server | Functional (degrades gracefully) |
| services/telegram.js | Telegram bot | 220 | Bot token in settings.json | Telegram Bot API | Functional (optional) |
| services/notifications.js | In-app notifications | 39 | None | None (internal) | Functional |
| services/blockchain.js | Blockchain balance/validation | 93 | None | ETH/BTC/SOL public RPCs | Functional |

---

# Frontend & Build Pipeline Audit

## HTML Pages Inventory (22 files in page/)

### Main App Pages (11 pages)

| File | Lines | Shared CSS Imports | Script Tags | Notes |
|------|-------|--------------------|-------------|-------|
| page/datedos.html | 1947 | 4 (variables, shared-layout, scrollbar, mobile) | 11 | Main dashboard — heaviest page, loads chart widget + socket.io + app.js + dashboard.js + customizer |
| page/portfolio.html | 880 | 4 | 4 | Portfolio overview |
| page/bots.html | 1381 | 4 | 4 | Bot list with create/edit modals |
| page/bot-detail.html | 10698 | 4 | 6 | ⚠️ Largest file — bot terminal, loads terminal modules (init, controls, data, renderers) |
| page/bot-stats.html | 527 | 4 | 5 | Bot statistics charts |
| page/dashboards-bot.html | 1496 | 4 | 4 | Bot dashboard view — not in CLAUDE.md URL map, possibly new or undocumented route |
| page/profile.html | 2430 | 4 | 4 | User profile + settings tabs |
| page/admin.html | 1644 | 3 (missing mobile.css) | 4 | Admin panel, loads admin.js |
| page/news.html | 510 | 4 | 4 | News page |
| page/subscriptions.html | 1309 | 4 | 4 | Plans/pricing page |
| page/community.html | 437 | 3 (missing mobile.css) | 4 | Community/social links |

### Auth Pages (2 pages)

| File | Lines | Shared CSS Imports | Script Tags | Notes |
|------|-------|--------------------|-------------|-------|
| page/reglogin.html | 1063 | 2 (variables, shared-layout) | 2 | Login/register — missing scrollbar.css and mobile.css |
| page/index.html | 973 | 1 (variables via inline redef) | 3 | Landing page — fully self-contained styles, 3D cube animation |

### Utility Pages — Auth Flow (2 pages)

| File | Lines | Shared CSS Imports | Script Tags | Notes |
|------|-------|--------------------|-------------|-------|
| page/reset-password.html | 173 | 0 (all inline) | 1 | Self-contained, inline CSS with design token redefinition |
| page/verify-email.html | 175 | 0 (all inline) | 1 | Self-contained, inline CSS with design token redefinition |

### Error Pages (4 pages)

| File | Lines | Shared CSS Imports | Script Tags | Notes |
|------|-------|--------------------|-------------|-------|
| page/403.html | 305 | 0 (all inline) | 1 | Self-contained, own `:root` vars (different from variables.css) |
| page/404erors.html | 306 | 0 (all inline) | 1 | ⚠️ Filename typo ("erors" instead of "errors") |
| page/500.html | 305 | 0 (all inline) | 1 | Self-contained, same pattern as 403 |
| page/502.html | 291 | 0 (all inline) | 1 | Update/maintenance page, uses brand accent #10B981 |

### Loading/Transition Pages (3 pages)

| File | Lines | Shared CSS Imports | Script Tags | Notes |
|------|-------|--------------------|-------------|-------|
| page/loading.html | 316 | 0 (all inline) | 1 | Pixel-art style loading animation |
| page/loading grafik.html | 364 | 0 (all inline) | 1 | ⚠️ Space in filename — fragile for URL routing |
| page/loadingdachbot.html | 653 | 0 (all inline) | 1 | Bot dashboard loading screen |

### HTML Pages — Key Observations

- **Consistent pattern for app pages:** Main app pages import variables.css → shared-layout.css → scrollbar.css → mobile.css, then load app.js
- **Error/utility pages are fully self-contained:** Inline CSS with own `:root` definitions — acceptable for pages that must render even if assets fail
- **page/dashboards-bot.html** not in CLAUDE.md URL map — may be served via an undocumented route or unused
- **page/loading grafik.html** has a space in filename — requires URL encoding, fragile
- **page/404erors.html** has a typo in filename ("erors")
- **admin.html and community.html** missing mobile.css import (only 3 shared CSS instead of 4)
- **page/bot-detail.html at 10,698 lines** is extremely large — contains entire bot terminal UI with extensive inline JS
- **No `<!DOCTYPE html>`** on several pages (403, 404, 500, loading, reglogin, index) — may render in quirks mode
- **Error pages (403, 404, 500) use different design tokens** than main app — their `:root` vars don't match variables.css (e.g., `--accent-color: #ffffff` vs `--accent-primary: #10B981`)

---

## CSS Files Audit (8 files in css/)

| File | Lines | Purpose | Status |
|------|-------|---------|--------|
| css/variables.css | 46 | Design tokens (`:root` vars + `*` reset) | Functional — compact, single source of truth |
| css/shared-layout.css | 408 | Sidebar nav, layout grid, header, page structure | Functional — responsive sidebar with mobile collapse |
| css/scrollbar.css | 84 | Custom scrollbar styling | Functional — WebKit + Firefox support |
| css/mobile.css | 628 | Mobile nav, bottom bar, mobile-specific overrides | Functional — comprehensive mobile adjustments |
| css/responsive.css | 264 | Breakpoint media queries | Functional — standard breakpoints |
| css/nav-fix.css | 19 | Minor nav positioning fix | Functional — tiny patch, could be merged into shared-layout.css |
| css/bot-terminal.css | 670 | Bot terminal UI styles | Functional — terminal-specific styling |
| css/bot-terminal-mobile.css | 347 | Mobile overrides for bot terminal | Functional — mobile terminal layout |

**Total CSS:** 2,466 lines across 8 files

### CSS — Key Observations

- **variables.css is lean (46 lines)** — good single source of truth for design tokens
- **mobile.css (628 lines) is larger than shared-layout.css (408 lines)** — significant mobile-specific code
- **nav-fix.css (19 lines)** is a tiny patch — should be merged into shared-layout.css
- **Error pages redefine their own `:root` vars** instead of importing variables.css — design token changes won't propagate to error pages
- **responsive.css and mobile.css overlap** in purpose — could be consolidated

---

## JS Modules Audit (8 files in js/)

| File | Lines | Purpose | Status |
|------|-------|---------|--------|
| js/app.js | 2717 | Shared app init — auth, nav, notifications, sidebar, theming | Functional — loaded on all app pages |
| js/dashboard.js | 385 | Dashboard page logic — widget data fetching | Functional |
| js/dashboard-customizer.js | 679 | Dashboard widget drag/resize/reorder | Functional |
| js/admin.js | 1932 | Admin panel — user management, settings, analytics | Functional |
| js/terminal/init.js | 139 | Bot terminal initialization | Functional |
| js/terminal/controls.js | 259 | Terminal UI controls (start/stop, settings) | Functional |
| js/terminal/data.js | 284 | Terminal data fetching and state | Functional |
| js/terminal/renderers.js | 807 | Terminal UI rendering (trades, stats, charts) | Functional |

**Total JS:** 7,202 lines across 8 files (excluding built chart widget js/chart/chart.js)

### JS — Key Observations

- **app.js (2,717 lines)** is the largest — handles auth, nav, sidebar, notifications, mobile detection; could benefit from splitting
- **Terminal is well-modularized** — 4 focused files (init, controls, data, renderers) totaling 1,489 lines
- **No bundler for vanilla JS** — all loaded via `<script>` tags, no minification or tree-shaking
- **js/chart/chart.js** is a Vite build output — DO NOT edit manually (per CLAUDE.md)

---

## Frontend Summary

| Category | Count | Total Lines |
|----------|-------|-------------|
| HTML Pages | 22 | ~26,680 |
| CSS Files | 8 | 2,466 |
| JS Modules | 8 | 7,202 |
| **Total Frontend** | **38 files** | **~36,348** |

---

# Vite/React Chart Widget Build Pipeline

## _src/ — Chart Widget Source (KlineCharts Pro)

**Status:** Build pipeline configured, build output exists, but node_modules symlink is broken

### Vite Configuration (`_src/vite.config.ts`)

- **Build target:** IIFE library bundle → `../js/chart/chart.js`
- **Library name:** `YamatoChart`
- **Entry point:** `src/main.ts`
- **Format:** IIFE (single self-executing bundle for `<script>` tag inclusion)
- **Plugins:** `vite-plugin-css-injected-by-js` — inlines CSS into the JS bundle (no separate CSS file)
- **Minification:** esbuild
- **Defines:** `process.env.NODE_ENV` → `'production'`, `global` → `globalThis` (Node.js polyfill for browser)
- **Rollup options:** no externals, `inlineDynamicImports: true` — fully self-contained bundle
- `emptyOutDir: true` — cleans `js/chart/` before each build

### Package (`_src/package.json`)

- **Name:** `yamato-chart` v2.0.0
- **Dependencies:** `klinecharts` ^9.8.12, `@klinecharts/pro` ^0.1.1 — professional candlestick charting library
- **Dev dependencies:** TypeScript ^5.5.0, Vite ^5.4.0, vite-plugin-css-injected-by-js ^3.5.0
- **Scripts:** `dev`, `build` (`vite build`), `preview`

### Source Components (`_src/src/`)

- `main.ts` — entry point (8,896 bytes)
- `main.tsx` — alternate React entry (6,241 bytes) — **Note:** both `.ts` and `.tsx` entry exist, vite config points to `main.ts`
- `klpro-datafeed.ts` — KlineCharts Pro data feed adapter (6,736 bytes)
- `overlays.ts` — chart overlay definitions (2,289 bytes)
- `components/` — UI components directory
- `datafeed/` — data feed implementations
- `hooks/` — React hooks
- `types/` — TypeScript type definitions

### Build Output (`js/chart/chart.js`)

- **Exists:** ✅ Yes
- **Size:** 418,226 bytes (~408 KB) — reasonable for a charting library bundle with KlineCharts
- **Last modified:** 2025-03-01

### node_modules Symlink

- `_src/node_modules` is a **symlink** → `../../../../../_src/node_modules`
- **Symlink target is BROKEN** — the target path resolves outside the project and does not exist
- **Impact:** `npm run build` and `npm run dev` will fail until dependencies are installed locally or the symlink is fixed
- **Likely cause:** The symlink was created for a different directory structure (possibly a monorepo or shared node_modules setup) that no longer matches the current project layout

### Build Pipeline Summary

| Aspect | Status |
|--------|--------|
| Vite config | ✅ Valid, well-configured |
| Source files | ✅ Present and complete |
| Build output | ✅ Exists, 408 KB |
| node_modules | ❌ Broken symlink |
| Rebuild capability | ❌ Blocked by broken symlink |

**Concern:** The build output exists and is usable, but the project cannot be rebuilt from source without fixing the `node_modules` symlink or running `npm install` directly in `_src/`
**Concern:** Both `main.ts` and `main.tsx` exist in `src/` — the Vite config uses `main.ts`, so `main.tsx` may be a leftover from a React-based approach that was refactored to vanilla TS
