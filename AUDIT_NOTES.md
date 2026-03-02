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
