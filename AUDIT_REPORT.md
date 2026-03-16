# YAMATO TRADING PLATFORM -- FULL AUDIT REPORT
> 10 agents, 300+ issues analyzed, consolidated into actionable plan
> Date: 2026-03-16

---

## EXECUTIVE SUMMARY

| Metric | Value |
|--------|-------|
| Agents deployed | 10 |
| Total issues found | ~300 (deduplicated to ~120 unique) |
| CRITICAL | 18 |
| HIGH | 32 |
| MEDIUM | 41 |
| LOW | 29 |
| Estimated total fix time | 200-280 hours |
| Overall platform score | **4.5/10** |

The platform is functional but has **serious security vulnerabilities** that could lead to real financial loss (plaintext Binance API keys, session fixation, broken WebAuthn). Performance will degrade under moderate load (sync file I/O on every request, no compression, no caching). Frontend has massive tech debt (1771 inline styles, 207 !important, zero accessibility).

---

## PHASE 1: CRITICAL SECURITY FIXES (Priority: IMMEDIATE)
> Estimated: 20-30 hours | These can cause real financial damage if exploited

### S1. Binance API Keys Stored in Plaintext
- **Files**: `server/db/index.js:75-76`, `server/routes/bots.js:1291,1706,2404`
- **Risk**: Database leak = all users' exchange accounts compromised
- **Fix**: AES-256-GCM encryption with key from env var. Encrypt on write, decrypt on read.

### S2. Session Fixation -- No `req.session.regenerate()` After Login
- **Files**: `server/routes/auth.js:194` (login), `:74` (register), `:806` (passkey), `:914` (telegram), `:1322` (google)
- **Risk**: Attacker plants session cookie, victim logs in, attacker hijacks session
- **Fix**: Call `req.session.regenerate()` before setting userId on ALL 5 login paths

### S3. WebAuthn/Passkey Has ZERO Cryptographic Verification
- **File**: `server/routes/auth.js:690-730` (register), `:787-827` (auth)
- **Risk**: Anyone knowing a credential_id can authenticate as that user
- **Fix**: Use `@simplewebauthn/server` for proper attestation/assertion verification

### S4. Hardcoded Secrets in Source Code
- `server/config/index.js:14` -- Session secret: `'yamato-dev-secret-change-me'`
- `server/config/index.js:15` -- Emergency key: `'yamato-emergency-2026'`
- `server/middleware/beta.js:3` -- Beta code: `'401483'`
- **Fix**: Move all to env vars, fail hard on startup if defaults in production

### S5. TOTP Secrets & Backup Codes Stored in Plaintext
- **File**: `server/routes/auth.js:573`
- **Fix**: Encrypt totp_secret with AES-256-GCM, hash backup codes with bcrypt

### S6. Static File Root Exposes Entire Project
- **File**: `server/server.js:61` -- `express.static(path.join(__dirname, '..'))`
- **Risk**: `.env`, `database.sqlite`, `sessions.json`, `ecosystem.config.js` accessible via HTTP
- **Fix**: Serve only specific directories (`/css`, `/js`, `/fonts`, `/page`, `/logo.svg`)

### S7. Race Condition in Order Execution -- Double-Spend
- **File**: `server/routes/orders.js:80-131`
- **Risk**: Two concurrent orders can both pass balance check, spending more than available
- **Fix**: Wrap in `dbTransaction()` (the helper already exists, used in faucet.js)

### S8. Subscription Cancel Does Not Actually Cancel
- **File**: `server/routes/subscription.js:68-83`
- Returns `{ success: true }` but never updates DB. User keeps paying, subscription stays active.
- **Fix**: Actually set `subscription_plan = 'free'` or implement cancel_at_period_end

### S9. Emergency Restore Has No Rate Limiting
- **File**: `server/routes/admin.js:2476`
- Only protected by a hardcoded key, no rate limit, no IP lockout
- **Fix**: Add strict rate limiting (3 attempts/hour), require admin auth + 2FA

### S10. Zero CSRF Protection
- No CSRF tokens anywhere in the codebase
- `sameSite: 'lax'` is partial protection only
- **Fix**: Add `csurf` middleware or double-submit cookie pattern

### S11. Socket.IO CORS Wildcard with Credentials
- **File**: `server/socket/index.js` -- `origin: "*"`
- **Fix**: Set specific allowed origins

### S12. `dbRun` Silently Swallows All Errors
- **File**: `server/db/index.js:710-720`
- Returns `{ lastInsertRowid: null }` on failure -- callers treat as success
- **Fix**: Throw on error, let callers handle with try/catch

---

## PHASE 2: CRITICAL PERFORMANCE FIXES (Priority: THIS WEEK)
> Estimated: 8-12 hours | Quick wins with massive impact

### P1. Add HTTP Compression (5 min)
```js
// server/server.js
const compression = require('compression');
app.use(compression()); // before express.static
```
**Impact**: 3-5x bandwidth reduction. `bot-detail.html` goes from 532KB to ~100KB.

### P2. Add Missing Database Indexes (15 min)
```sql
CREATE INDEX idx_users_telegram_id ON users(telegram_id);
CREATE INDEX idx_users_google_id ON users(google_id);
CREATE INDEX idx_bot_trades_bot_status ON bot_trades(bot_id, status);
CREATE INDEX idx_bot_trades_bot_symbol_status ON bot_trades(bot_id, symbol, status);
CREATE INDEX idx_bot_subscribers_user_status ON bot_subscribers(user_id, status);
CREATE INDEX idx_orders_user_status ON orders(user_id, status);
CREATE INDEX idx_news_external_id ON news(external_id);
CREATE INDEX idx_notifications_user_read ON notifications(user_id, is_read);
CREATE INDEX idx_transactions_user_id ON transactions(user_id);
```
**Impact**: Eliminates full table scans on login, bot queries, trade sync.

### P3. Debounce FileSessionStore Writes (30 min)
- **File**: `server/middleware/session.js`
- Currently: `writeFileSync` on EVERY request
- **Fix**: Debounce saves (2s delay), or migrate to Redis sessions (`connect-redis`)

### P4. Add Static Asset Cache Headers (10 min)
```js
app.use(express.static(dir, {
    maxAge: '1d',
    setHeaders: (res, path) => {
        if (path.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
        else if (path.match(/\.(woff2?|ttf)$/)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
}));
```

### P5. Add In-Flight Guard to Socket.IO Price Interval (15 min)
- **File**: `server/socket/index.js:57-66`
- `getMarketPrices()` has no timeout, fires every 3s -- requests stack if Binance is slow
- **Fix**: Add `isFetching` flag + 10s timeout on `getMarketPrices`

### P6. Fix `uncaughtException` Handler (15 min)
- **File**: `server/server.js:261-267`
- Currently just logs and continues in corrupted state
- **Fix**: Save database, then exit (PM2 will restart)

### P7. Make `_saveDatabaseNow()` Async (30 min)
- **File**: `server/db/index.js:663-675`
- `db.export()` + `writeFileSync` blocks event loop for 50-100ms on large DB
- **Fix**: Use `fs.promises.writeFile`

### P8. Reduce Body Size Limit (5 min)
- **File**: `server/server.js:58` -- `express.json({ limit: '20mb' })`
- **Fix**: Default to `1mb`, increase only on specific routes

---

## PHASE 3: AUTH & SESSION HARDENING (Priority: NEXT WEEK)
> Estimated: 15-20 hours

### A1. Add Password Validation
- Min 8 chars, uppercase, lowercase, digit
- Apply on ALL paths: register, reset, telegram-register

### A2. Enforce Email Verification Before Login
- Check `user.email_verified` in login handler
- Or limit functionality until verified

### A3. Fix Bcrypt Rounds Mismatch
- Config says 12, code uses hardcoded 10 everywhere
- Import and use `BCRYPT_ROUNDS` from config

### A4. Fix User Enumeration
- Registration: return generic message
- Telegram login: return generic message
- Passkey check: require authentication

### A5. Add Session Cleanup Interval
- `cleanExpired()` runs only once at startup
- Add `setInterval(cleanExpired, 15 * 60 * 1000)`

### A6. Password Reset Must Invalidate Other Tokens + Destroy Sessions
- `UPDATE password_reset_tokens SET used = 1 WHERE user_id = ?`
- Destroy all sessions for the user

### A7. Fix Google OAuth Auto-Link (Account Takeover Risk)
- Require user confirmation before linking Google account to existing user

### A8. Add `asyncHandler` Wrapper for Express Routes
- Prevents hanging connections from unhandled async rejections

---

## PHASE 4: FRONTEND QUALITY (Priority: 2-3 WEEKS)
> Estimated: 60-80 hours

### F1. Fix XSS Vulnerabilities (URGENT)
- 12+ locations using `innerHTML` with unsanitized data
- `js/app.js:158` (showToast), `:1935` (activity log), `:1886` (transactions)
- `js/admin.js:306,518,880`
- `page/bots.html` (bot names via innerHTML)
- **Fix**: Replace `innerHTML` with `textContent` or add universal `escapeHtml()`

### F2. Fix CSS Architecture
- Add `<!DOCTYPE html>` to 11 files missing it
- Fix CSS load order (shared CSS BEFORE inline styles)
- Remove `:root` redefinitions in `bot-terminal.css` and `dashboards-bot.html`
- Eliminate 207 `!important` declarations in `mobile.css`

### F3. Fix Brand Consistency
- Error pages (403, 404, 500) branded as "QUANTUM" not "Yamato"
- `dashboards-bot.html` has ivory theme instead of green
- Fix `404erors.html` filename typo

### F4. Fix Memory Leaks
- 61 `setInterval` calls vs 22 `clearInterval`
- 239 `addEventListener` vs 19 `removeEventListener`
- MutationObserver on entire `document.body` never disconnected
- **Fix**: Add cleanup registry, clear on `beforeunload`

### F5. Fix Global Variable Pollution
- `currentUser` declared in 3 different files
- `switchTab`, `toggleBot` defined in multiple files
- 10+ variables dumped on `window` from `datedos.html`

### F6. Delete Dead Code
- `page/porfile.html` (111KB orphan duplicate)
- `.mobile-bottom-nav` CSS (72 lines, never used)
- `loginLimiter`/`registerLimiter` (defined, never imported)
- `chart/` directory (old React source, superseded by `_src/`)

### F7. Extract Shared Utilities
- `formatPrice()` implemented 4 different ways in 4 files
- `escapeHtml()` exists in some files but not all
- Create `js/utils.js` with shared formatters

---

## PHASE 5: ARCHITECTURE REFACTORING (Priority: 1-2 MONTHS)
> Estimated: 80-120 hours

### R1. Split God Files
- `server/routes/bots.js` (3014 lines) -> `bots-crud.js`, `bots-binance.js`, `bots-sync.js`, `bots-subscribers.js`
- `server/routes/admin.js` (2948 lines) -> `admin/users.js`, `admin/settings.js`, `admin/analytics.js`, `admin/backups.js`
- `server/db/index.js` (764 lines) -> `schema.js`, `migrations.js`, `helpers.js`
- `js/app.js` (3418 lines) -> `toast.js`, `socket.js`, `notifications.js`, `nav.js`, `utils.js`

### R2. Create Service Layer
- `server/services/auth.js` -- registration, login, 2FA logic
- `server/services/botManager.js` -- bot CRUD, credential management
- `server/services/trading.js` -- order execution, balance management
- Routes become thin controllers

### R3. Add Structured Logging
- Replace 298 `console.log/error` with `pino` or `winston`
- Add request-id correlation
- Add PM2 log rotation

### R4. Add Input Validation Library
- `zod` or `joi` for all API endpoints
- Centralized validation middleware

### R5. Consolidate Binance Client
- `server/services/binance.js` (old) vs `server/routes/bots.js` (new with proxy/cache)
- Merge into single `services/binanceFutures.js`

### R6. Fix Graceful Shutdown
- Close HTTPS server, Socket.IO, Telegram bot, Redis
- Clear all intervals (`priceInterval`, activity cleanup, etc.)

### R7. Add Circuit Breakers for External Services
- Binance API, blockchain APIs, email, Google Drive
- Track failure rates, "open" circuit after N failures

### R8. Add Health Check Endpoint
- `/health` -- DB status, Redis status, memory usage, uptime

### R9. Migrate to `better-sqlite3` (Long-term)
- Eliminates `db.export()` bottleneck
- Native file-based storage, WAL mode
- 5-10x faster queries
- Enables PM2 cluster mode

### R10. Add Candle Database Cleanup
- 518,400 rows/day, no retention policy
- Add 7-14 day cleanup job

---

## QUICK REFERENCE: TOP 20 FILES TO FIX

| # | File | Issues | Priority |
|---|------|--------|----------|
| 1 | `server/routes/bots.js` | God file, plaintext API keys, XSS, race conditions | P0 |
| 2 | `server/routes/auth.js` | Session fixation, no password validation, user enumeration | P0 |
| 3 | `server/db/index.js` | dbRun swallows errors, missing indexes, no migrations | P0 |
| 4 | `server/middleware/session.js` | Sync file I/O every request, no cleanup | P0 |
| 5 | `server/server.js` | Static root exposure, no compression, bad error handlers | P1 |
| 6 | `server/routes/admin.js` | God file, emergency restore, plaintext data in SELECT * | P1 |
| 7 | `server/routes/orders.js` | Race condition double-spend, no transactions | P0 |
| 8 | `server/socket/index.js` | CORS wildcard, no timeout, memory exhaustion | P1 |
| 9 | `server/config/index.js` | Hardcoded secrets, no production validation | P0 |
| 10 | `server/middleware/beta.js` | Hardcoded beta code, open redirect | P1 |
| 11 | `js/app.js` | XSS, memory leaks, 3418-line monolith | P2 |
| 12 | `server/routes/subscription.js` | Cancel does nothing | P0 |
| 13 | `server/services/candleCollector.js` | No reconnection limit, no cleanup | P2 |
| 14 | `server/utils/bruteForce.js` | Email-only lockout (DoS vector) | P2 |
| 15 | `css/mobile.css` | 207 !important declarations | P3 |
| 16 | `css/bot-terminal.css` | Redefines all :root variables | P3 |
| 17 | `page/bots.html` | XSS via innerHTML, 2000+ lines | P2 |
| 18 | `server/services/notifications.js` | Swallows errors, unhandled promises | P2 |
| 19 | `server/middleware/activityTracker.js` | Logs every request, no cleanup batching | P3 |
| 20 | `js/admin.js` | 4800+ lines, inconsistent escaping | P3 |

---

## AGENTS THAT CONTRIBUTED

| Agent | Focus | Issues Found | Duration |
|-------|-------|-------------|----------|
| Backend API Routes | Route validation, auth, SQL | 47 | 3 min |
| Database Schema | Schema, queries, integrity | 47 | 3 min |
| Security Audit | Full security review | 16 critical/high | 4 min |
| Frontend HTML/CSS | Markup, styles, accessibility | 47 | 3.5 min |
| Error Handling | Resilience, crash recovery | 38 | 2.5 min |
| Auth & Sessions | Auth flows, session security | 24 | 3.5 min |
| Bot Management | Trading, Binance integration | 29 | 2.5 min |
| Performance | Bottlenecks, caching, I/O | 16 | 3 min |
| Architecture | Patterns, structure, debt | 13 categories | 3.5 min |
| Frontend JS | JS quality, XSS, leaks | 47 | 3 min |
