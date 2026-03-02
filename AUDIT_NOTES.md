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
