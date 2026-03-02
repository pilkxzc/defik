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
