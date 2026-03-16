# Yamato Trading Platform -- Security Audit Report

**Date**: 2026-03-16
**Auditor**: Claude Security Auditor (Automated)
**Scope**: Full backend codebase, middleware, routing, session management, API security
**Platform**: Node.js + Express + SQLite (sql.js) + Socket.IO

---

## Executive Summary

The Yamato Trading Platform has **several critical vulnerabilities** that require immediate attention, particularly around **plaintext storage of Binance API keys** (which control real money), **weak session security**, **absence of CSRF protection**, and **hardcoded secrets in source code**. The platform handles financial operations and third-party exchange credentials, making these findings especially severe.

### Vulnerability Count

| Severity | Count |
|----------|-------|
| CRITICAL | 7 |
| HIGH     | 9 |
| MEDIUM   | 8 |
| LOW      | 4 |
| **Total** | **28** |

---

## CRITICAL Findings

### C1. Binance API Keys Stored in Plaintext (No Encryption at Rest)

**Severity**: CRITICAL
**Files**: `server/routes/bots.js:1291`, `server/routes/bots.js:1706`, `server/routes/bots.js:2404`, `server/db/index.js:75-83`
**OWASP**: A02:2021 -- Cryptographic Failures

Binance API keys and secrets are stored **directly in the SQLite database without any encryption**. These keys grant direct access to users' exchange accounts and real money.

```
// server/routes/bots.js:1291 -- stored as plaintext
'INSERT INTO bots (..., binance_api_key, binance_api_secret, ...) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)',
[req.session.userId, name, 'binance', 'FUTURES', apiKey, apiSecret, ...]

// server/routes/bots.js:1706 -- updated as plaintext
dbRun('UPDATE bots SET binance_api_key = ?, binance_api_secret = ? WHERE id = ?', [apiKey, apiSecret, req.params.id]);

// server/routes/bots.js:2404 -- user subscriber keys also plaintext
'UPDATE bot_subscribers SET ... user_binance_api_key = ?, user_binance_api_secret = ? ...'
```

There is **zero encryption** anywhere in the codebase -- no `crypto.createCipheriv`, no AES, no envelope encryption. A database file leak, backup compromise, or admin DB access feature abuse exposes all API keys.

**Impact**: Complete compromise of all users' Binance exchange accounts. Attackers could drain funds, place malicious trades, or steal assets.

**Remediation**:
1. Implement AES-256-GCM encryption for all API keys at rest using a key derived from an environment variable (never stored in DB)
2. Decrypt only in memory when making Binance API calls
3. Rotate the encryption key periodically
4. Consider using a secrets manager (AWS Secrets Manager, HashiCorp Vault)

---

### C2. Hardcoded Secrets in Source Code

**Severity**: CRITICAL
**Files**: `server/config/index.js:14-15`, `server/middleware/beta.js:3`
**OWASP**: A02:2021 -- Cryptographic Failures

Multiple secrets are hardcoded directly in the source code with weak fallback values:

```javascript
// server/config/index.js:14
const SESSION_SECRET = process.env.SESSION_SECRET || 'yamato-dev-secret-change-me';

// server/config/index.js:15
const EMERGENCY_KEY = process.env.EMERGENCY_KEY || 'yamato-emergency-2026';

// server/config/index.js:13
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'gerbera.uh@gmail.com';

// server/middleware/beta.js:3
const BETA_CODE = '401483';
```

If the `.env` file is missing or incomplete (common in deployments), the application runs with these predictable defaults. The beta code is **always** hardcoded and committed to the repository.

**Impact**: Session forgery if default secret is used; unauthorized emergency restore access; beta gate bypass.

**Remediation**:
1. Remove all fallback secret values -- fail loudly on startup if env vars are missing
2. Move `BETA_CODE` to environment variable
3. Add startup validation that refuses to run without required secrets
4. Ensure `.env` is never committed (verify `.gitignore`)

---

### C3. No CSRF Protection

**Severity**: CRITICAL
**Files**: `server/server.js` (entire application)
**OWASP**: A01:2021 -- Broken Access Control

There is **zero CSRF protection** anywhere in the application. No CSRF tokens, no `csurf` middleware, no double-submit cookies. The session cookie uses `sameSite: 'lax'` which only protects against cross-site POST from top-level navigations, **not** from:
- Requests initiated by `<form>` with `method="POST"` on cross-origin pages (top-level navigation)
- Specially crafted scenarios using `fetch` in combination with other techniques

State-changing operations vulnerable to CSRF include:
- `/api/auth/logout` (session destruction)
- `/api/bots/emergency-stop` (stops all trading bots)
- `/api/account/switch` (account switching)
- `/api/bots/:id/api-keys` (API key updates)
- `/api/admin/tables/:name/:id` (database record manipulation)
- All trade, order, and financial operations

**Impact**: An attacker could craft a malicious page that forces a logged-in admin to stop all bots, modify database records, or change API keys.

**Remediation**:
1. Implement CSRF tokens using the `csurf` or `csrf-csrf` package
2. Add CSRF token to all state-changing requests
3. Consider setting `sameSite: 'strict'` for the session cookie (with UX tradeoff evaluation)

---

### C4. Session Fixation -- No Session Regeneration on Login

**Severity**: CRITICAL
**Files**: `server/routes/auth.js:74`, `server/routes/auth.js:194`, `server/routes/auth.js:914`
**OWASP**: A07:2021 -- Identification and Authentication Failures

After successful authentication (login, register, Telegram auth, Google auth), the session ID is **never regenerated**. The existing session is simply populated with `userId`:

```javascript
// server/routes/auth.js:194 (login)
req.session.userId = user.id;
req.session.betaAccess = true;
// ... no req.session.regenerate()

// server/routes/auth.js:74 (register)
req.session.userId = userId;
req.session.betaAccess = true;
// ... no req.session.regenerate()
```

Search for `regenerate` across the entire server codebase returned only one unrelated admin comment.

**Impact**: An attacker who knows or can set a user's session ID before login can hijack the session after the user authenticates (session fixation attack).

**Remediation**:
```javascript
req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Session error' });
    req.session.userId = user.id;
    req.session.betaAccess = true;
    req.session.save((err) => { ... });
});
```

---

### C5. FileSessionStore -- Sessions Stored in Plaintext JSON on Disk

**Severity**: CRITICAL
**Files**: `server/middleware/session.js:1-159`, `server/sessions.json`
**OWASP**: A02:2021 -- Cryptographic Failures

The custom `FileSessionStore` writes all session data to a JSON file on disk in plaintext. This file contains:
- User IDs for all active sessions
- Session metadata (IP, user agent, login method)
- Beta access status
- Passkey challenges
- Pending Telegram auth data

```javascript
// server/middleware/session.js:29
fs.writeFileSync(tmpPath, JSON.stringify(this.sessions, null, 2));
```

The file is saved **synchronously on every session write** (line 83), which creates:
1. **Security risk**: Any file read vulnerability exposes all active sessions
2. **Performance risk**: Synchronous I/O blocks the event loop on every request
3. **Race condition risk**: Concurrent writes could corrupt the file
4. **Backup exposure**: `sessions.json` is included in database backups (see admin.js restore logic), meaning API keys + sessions travel together

**Impact**: Session hijacking for all users if file is exposed; denial of service under load.

**Remediation**:
1. Replace `FileSessionStore` with Redis-backed store (`connect-redis`) -- Redis is already configured
2. If file-based sessions are required, encrypt session data before writing
3. At minimum, use async file I/O and add file locking

---

### C6. Password Policy -- Minimum 6 Characters, No Complexity Requirements

**Severity**: CRITICAL
**Files**: `server/routes/auth.js:437`, `server/routes/auth.js:968`
**OWASP**: A07:2021 -- Identification and Authentication Failures

The only password validation is a minimum length of 6 characters for password reset; **registration has zero password validation**:

```javascript
// server/routes/auth.js:437 (reset-password only)
if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

// server/routes/auth.js:22-37 (register) -- NO password validation at all
if (!email || !password || !fullName) { return res.status(400).json({...}); }
// A 1-character password "a" would be accepted
const hashedPassword = await bcrypt.hash(password, 10);
```

No requirements for: uppercase, lowercase, numbers, special characters, or dictionary word checking.

**Impact**: Users can set trivially guessable passwords (e.g., "123456", "a"), making brute force attacks viable even with rate limiting.

**Remediation**:
1. Enforce minimum 8 characters with complexity requirements
2. Check against common password lists (e.g., Have I Been Pwned API)
3. Apply the same validation to registration, password reset, and password change

---

### C7. Bcrypt Rounds Hardcoded to 10 (Config Value 12 Ignored)

**Severity**: CRITICAL
**Files**: `server/routes/auth.js:37`, `server/routes/auth.js:472`, `server/routes/auth.js:982`, `server/config/index.js:16`
**OWASP**: A02:2021 -- Cryptographic Failures

The config defines `BCRYPT_ROUNDS = 12`, but it is **never imported or used** in the auth routes. All password hashing uses hardcoded `10`:

```javascript
// server/config/index.js:16
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS, 10) || 12;

// server/routes/auth.js:37 -- ignores BCRYPT_ROUNDS, uses 10
const hashedPassword = await bcrypt.hash(password, 10);

// server/routes/auth.js:472 -- same
const hashedPassword = await bcrypt.hash(newPassword, 10);

// server/routes/auth.js:982 -- same
const hashedPassword = await bcrypt.hash(password, 10);
```

While 10 rounds is not catastrophically weak, it is below modern recommendations (12+), and the discrepancy between config and actual usage indicates a configuration management failure.

**Impact**: Passwords are slightly weaker to brute-force than intended.

**Remediation**: Import `BCRYPT_ROUNDS` from config and use it consistently across all `bcrypt.hash()` calls.

---

## HIGH Findings

### H1. Socket.IO CORS Set to Wildcard Origin

**Severity**: HIGH
**File**: `server/socket/index.js:11-15`
**OWASP**: A05:2021 -- Security Misconfiguration

```javascript
io = new Server(httpServer, {
    cors: {
        origin: "*",          // <-- allows ANY origin
        methods: ["GET", "POST"],
        credentials: true     // <-- sends cookies cross-origin
    }
});
```

`origin: "*"` combined with `credentials: true` means any website can establish a WebSocket connection using the user's session cookie. This bypasses the main CORS policy configured on Express.

**Impact**: Cross-site WebSocket hijacking. Any malicious website can connect to the Socket.IO server with the victim's session, receive real-time price data, notifications, and potentially emit events.

**Remediation**: Set `origin` to the same value as the Express CORS config: `process.env.CORS_ORIGIN || 'https://tradingarena.space'`.

---

### H2. Open Redirect in Beta Submit

**Severity**: HIGH
**File**: `server/middleware/beta.js:245`
**OWASP**: A01:2021 -- Broken Access Control

```javascript
function betaSubmit(req, res) {
    const code = (req.body?.code || '').trim();
    if (code === BETA_CODE) {
        req.session.betaAccess = true;
        const redirectTo = req.body?.next || '/';
        return res.redirect(redirectTo);   // <-- user-controlled redirect
    }
    res.redirect('/beta?error=1');
}
```

The `next` parameter from the request body is used directly in `res.redirect()` without validation. An attacker could craft a form that submits the beta code with `next=https://evil.com/phishing`.

**Impact**: Phishing attacks leveraging trust in the platform's domain.

**Remediation**: Validate that `redirectTo` is a relative path (starts with `/` and does not contain `//`).

---

### H3. Admin DB Access Exposes All Tables Including Passwords and API Keys

**Severity**: HIGH
**Files**: `server/routes/admin.js:1441-1491`, `server/routes/admin.js:1402-1407`
**OWASP**: A01:2021 -- Broken Access Control

The admin table browser uses `SELECT *` on the `users` table, which returns bcrypt password hashes, TOTP secrets, and backup codes. The `bots` table is not in `ADMIN_TABLES` but is accessible through other admin endpoints.

```javascript
const ADMIN_TABLES = [
    'users', 'orders', 'transactions', 'bots', 'wallets', ...
];

// server/routes/admin.js:1455
let query = `SELECT * FROM "${tableName}"`;
```

Even though this is admin-only, it means:
- Password hashes are visible in the admin UI
- TOTP secrets are visible (allows admin to generate 2FA codes for any user)
- Combined with C1, Binance API keys in the `bots` table are fully readable

**Impact**: Privilege escalation from admin to complete account takeover of any user; exposure of all Binance API keys.

**Remediation**:
1. Exclude sensitive columns (`password`, `totp_secret`, `backup_codes`, `binance_api_key`, `binance_api_secret`) from admin table views
2. Implement column-level access control
3. Mask sensitive values (show only last 4 characters)

---

### H4. SQL Injection via Dynamic Table Names in Admin Routes

**Severity**: HIGH
**Files**: `server/routes/admin.js:1412`, `server/routes/admin.js:1455`, `server/routes/admin.js:1514`
**OWASP**: A03:2021 -- Injection

While table names are validated against `ADMIN_TABLES` whitelist (good), the `sortBy` parameter is validated against actual column names from `PRAGMA table_info`, but the `search` parameter is properly parameterized. However, there is a subtle issue:

```javascript
// server/routes/admin.js:1470
query += ` ORDER BY "${validSortBy}" ${validSortOrder} LIMIT ? OFFSET ?`;
```

The `validSortBy` is sourced from `columnNames.includes(sortBy)` which should be safe. However, the pattern of interpolating identifiers with double quotes could be exploited if table/column names contain special characters (unlikely but worth noting).

More concerning is the `DELETE FROM` at line 1566 which uses table name interpolation:
```javascript
dbRun(`DELETE FROM "${tableName}" WHERE id = ?`, [recordId]);
```

The whitelist check mitigates this, but the pattern is fragile.

**Impact**: Currently mitigated by whitelist, but any expansion of `ADMIN_TABLES` without careful review could introduce SQL injection.

**Remediation**: Use a strict identifier validation regex in addition to the whitelist. Consider using an ORM or query builder.

---

### H5. Emergency Restore Endpoint Has No Authentication

**Severity**: HIGH
**File**: `server/routes/admin.js:2476-2481`
**OWASP**: A01:2021 -- Broken Access Control

```javascript
router.post('/api/emergency/restore', async (req, res) => {
    const { EMERGENCY_KEY } = require('../config');
    const { key } = req.body;   // <-- just needs the key
    if (!key || key !== EMERGENCY_KEY) { ... }
```

This endpoint is protected **only** by the `EMERGENCY_KEY` -- no session, no `requireAuth`, no `requireRole`. Combined with C2 (hardcoded default key `yamato-emergency-2026`), anyone who knows the key can replace the entire database.

The beta middleware skip list includes `/api/emergency/` (beta.js:218), so even the beta gate is bypassed.

**Impact**: Complete database replacement, leading to total platform compromise.

**Remediation**:
1. Add `requireAuth` and `requireRole('admin')` middleware
2. Require 2FA verification in addition to the emergency key
3. Rate limit this endpoint aggressively
4. Remove from beta middleware skip list

---

### H6. Static File Serving Exposes Entire Project Directory

**Severity**: HIGH
**File**: `server/server.js:61`
**OWASP**: A01:2021 -- Broken Access Control

```javascript
app.use(express.static(path.join(__dirname, '..'), { ... }));
```

The static file middleware serves the **entire project root directory** (`..` from `server/`), not just the `page/`, `css/`, `js/` directories. This means any file in the project root is potentially accessible, including:
- `server/settings.json` (contains SMTP credentials, Telegram bot token, Google OAuth secrets)
- `server/sessions.json` (all active sessions)
- `.env` (environment variables with secrets)
- `ecosystem.config.js` (PM2 config)
- `deploy.sh` (deployment script)
- `server/database.sqlite` (entire database)

Express.static will not serve `.js` files from `server/` because the route handler for `server.js` would conflict, but **JSON files, SQLite files, and other non-JS files may be accessible**.

**Impact**: Direct access to database, sessions, secrets, and configuration files.

**Remediation**:
1. Serve only specific public directories: `page/`, `css/`, `js/`, `fonts/`, `uploads/`
2. Never serve the project root
3. Add explicit deny rules for sensitive file extensions (`.json`, `.sqlite`, `.env`, `.sh`)

---

### H7. Information Disclosure in Error Responses

**Severity**: HIGH
**File**: `server/middleware/errorHandler.js:28-29`
**OWASP**: A09:2021 -- Security Logging and Monitoring Failures

```javascript
if (process.env.NODE_ENV !== 'production' && !isOperational) {
    response.stack = err.stack;
}
```

Stack traces are exposed when `NODE_ENV` is not explicitly set to `production`. Given that the default in `config/index.js:11` is `development`, any deployment that forgets to set `NODE_ENV=production` will leak full stack traces to clients, revealing internal file paths, module names, and potential attack vectors.

Additionally, specific error messages leak information:
- `server/middleware/auth.js:51`: `'Access denied. Missing permission: ' + permissionName` -- reveals internal permission names
- `server/routes/bots.js:1288`: `'Invalid API credentials: ' + testResult.error` -- forwards Binance error details

**Impact**: Internal path disclosure, framework version inference, and targeted attack guidance.

**Remediation**:
1. Default to production behavior (no stack traces) unless explicitly in development
2. Sanitize error messages sent to clients
3. Never forward third-party error details to users

---

### H8. Body Size Limit Too Large (20MB)

**Severity**: HIGH
**File**: `server/server.js:58-59`
**OWASP**: A05:2021 -- Security Misconfiguration

```javascript
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
```

A 20MB JSON body limit is excessive for a trading platform API. This can be abused for:
- Memory exhaustion attacks (parse large JSON payloads)
- Slow-loris style attacks
- Abuse of the activity tracker (logs every request)

**Impact**: Denial of service through memory exhaustion.

**Remediation**: Reduce to 1MB for general API, use route-specific limits for file uploads.

---

### H9. TOTP Secret Stored in Plaintext

**Severity**: HIGH
**Files**: `server/routes/auth.js:573`, `server/db/index.js:46`
**OWASP**: A02:2021 -- Cryptographic Failures

TOTP secrets and backup codes are stored unencrypted in the database:

```javascript
// server/routes/auth.js:573
dbRun('UPDATE users SET totp_secret = ?, backup_codes = ? WHERE id = ?',
    [secret.base32, JSON.stringify(backupCodes), req.session.userId]);
```

If the database is compromised, an attacker can generate valid 2FA codes for any user, completely bypassing 2FA protection.

**Impact**: 2FA bypass for all users if database is exposed.

**Remediation**: Encrypt TOTP secrets with application-level encryption before storage.

---

## MEDIUM Findings

### M1. No HSTS Header Enforcement

**Severity**: MEDIUM
**File**: `server/server.js:38`
**OWASP**: A05:2021 -- Security Misconfiguration

While Helmet is configured, the default HSTS configuration does not enforce `includeSubDomains` or `preload`. Additionally, since the app listens on both HTTP (port 3000) and HTTPS (port 3443) simultaneously without an HTTP-to-HTTPS redirect, users could connect over unencrypted HTTP.

**Impact**: Man-in-the-middle attacks on HTTP connections.

**Remediation**:
1. Add HTTP to HTTPS redirect
2. Configure Helmet HSTS with `maxAge: 31536000`, `includeSubDomains: true`, `preload: true`

---

### M2. CSP Allows unsafe-inline and unsafe-eval

**Severity**: MEDIUM
**File**: `server/server.js:42`
**OWASP**: A05:2021 -- Security Misconfiguration

```javascript
scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", ...],
scriptSrcAttr: ["'unsafe-inline'"],
styleSrc: ["'self'", "'unsafe-inline'", ...],
```

`unsafe-inline` and `unsafe-eval` in the CSP significantly weaken XSS protection. These are often required for legacy code but should be replaced with nonce-based CSP.

**Impact**: Reduced protection against XSS attacks.

**Remediation**: Migrate inline scripts to external files with nonce-based CSP. Remove `unsafe-eval` if not strictly required.

---

### M3. Rate Limiting Uses IP Only -- No User-Level Rate Limiting on Auth

**Severity**: MEDIUM
**Files**: `server/middleware/rateLimit.js:42-50`
**OWASP**: A04:2021 -- Insecure Design

The auth rate limiter keys on IP only. An attacker using distributed IPs (botnet) can bypass the rate limit. The brute force protection in `bruteForce.js` uses email, but the rate limiter middleware and brute force protection are separate systems that could have gaps.

Additionally, the `loginLimiter` in `rateLimiter.js` (5 req/15min) is defined but **never imported in server.js** -- only `authRateLimiter` from `rateLimit.js` (5 req/min) is used.

**Impact**: Distributed brute force attacks against user accounts.

**Remediation**:
1. Combine IP + email for rate limiting
2. Implement CAPTCHA after 3 failed attempts
3. Remove unused `loginLimiter` to avoid confusion

---

### M4. Session Cookie Not Secure in Development

**Severity**: MEDIUM
**File**: `server/middleware/session.js:151`

```javascript
cookie: {
    secure: process.env.NODE_ENV === 'production',
    // ...
}
```

Since `NODE_ENV` defaults to `development`, the session cookie's `secure` flag is `false` by default. This means the cookie will be sent over unencrypted HTTP connections.

**Impact**: Session hijacking via network sniffing on non-HTTPS connections.

**Remediation**: Ensure production deployment always sets `NODE_ENV=production`. Add startup warning if HTTPS is not available with secure cookies.

---

### M5. Maintenance Mode Message Vulnerable to Stored XSS

**Severity**: MEDIUM
**File**: `server/middleware/maintenance.js:89`

```javascript
<p>${siteSettings.maintenanceMessage}</p>
```

The maintenance message is stored in `siteSettings` (editable by admin) and rendered directly into HTML without escaping. If an admin (or someone who compromises admin access) sets a maintenance message containing JavaScript, it will execute for all users.

**Impact**: Stored XSS affecting all users when maintenance mode is active.

**Remediation**: HTML-encode the maintenance message before rendering: `siteSettings.maintenanceMessage.replace(/</g, '&lt;').replace(/>/g, '&gt;')`.

---

### M6. Progressive Delay Creates Server-Side DoS Vector

**Severity**: MEDIUM
**File**: `server/utils/bruteForce.js:72-77`

```javascript
function getProgressiveDelay(attemptCount) {
    const delaySeconds = Math.min(Math.pow(2, attemptCount - 1), 32);
    const delayMs = delaySeconds * 1000;
    return new Promise(resolve => {
        setTimeout(() => resolve(delayMs), delayMs);
    });
}
```

This delays the server response using `setTimeout`, holding the connection open for up to 32 seconds. An attacker can trigger many login attempts (even with wrong emails) to hold many connections open simultaneously, exhausting server resources.

**Impact**: Application-layer denial of service by exhausting connection pool.

**Remediation**: Return a 429 status immediately instead of holding connections open. Use client-side retry logic.

---

### M7. `SELECT *` Queries Expose Sensitive Fields in API Responses

**Severity**: MEDIUM
**Files**: `server/routes/auth.js:120`, `server/routes/admin.js:474`

Multiple routes use `SELECT * FROM users` which fetches all columns including `password`, `totp_secret`, `backup_codes`, and `binance_api_key` into memory. While most routes only return a subset of fields to the client, the data is still loaded into the Node.js process memory.

```javascript
// server/routes/auth.js:120 (login)
const user = dbGet('SELECT * FROM users WHERE LOWER(email) = LOWER(?)', [normalizedEmail]);
// user.password, user.totp_secret, user.backup_codes all in memory
```

**Impact**: Increased risk of accidental data exposure through logging, error messages, or memory dumps.

**Remediation**: Use explicit column lists in all queries: `SELECT id, email, full_name, ... FROM users`.

---

### M8. Telegram Bot Token in settings.json (Plaintext on Disk)

**Severity**: MEDIUM
**Files**: `server/config/index.js:29`, `server/services/telegram.js:16`

The Telegram bot token, SMTP credentials, and Google OAuth secrets are stored in `settings.json` on disk in plaintext. This file is also included in database backups sent to Google Drive.

**Impact**: Credential exposure through file access or backup compromise.

**Remediation**: Move sensitive service credentials to environment variables. Do not include `settings.json` in backups or encrypt it before backup.

---

## LOW Findings

### L1. Beta Code is Weak and Hardcoded

**Severity**: LOW
**File**: `server/middleware/beta.js:3`

```javascript
const BETA_CODE = '401483';
```

The 6-digit numeric beta code is trivially brute-forceable (1,000,000 combinations) and hardcoded in source code visible to anyone with repository access.

**Impact**: Beta gate bypass.

**Remediation**: Move to environment variable; use a stronger alphanumeric code; add rate limiting on `/beta` POST.

---

### L2. Session ID Prefix Exposed in API

**Severity**: LOW
**File**: `server/routes/auth.js:287`

```javascript
id: s.sid.substring(0, 8),
```

The first 8 characters of session IDs are exposed in the sessions list API. While not directly exploitable (full session ID needed), this reduces the entropy for session guessing.

**Impact**: Marginal reduction in session ID entropy.

**Remediation**: Use a separate opaque identifier for session management UI.

---

### L3. No Account Lockout Notification

**Severity**: LOW
**File**: `server/utils/bruteForce.js`

When an account is locked due to failed login attempts, there is no notification sent to the account owner via email or Telegram.

**Impact**: Users are unaware their account is under brute force attack.

**Remediation**: Send a notification to the user when their account is locked.

---

### L4. IP Extraction Trusts Multiple Headers

**Severity**: LOW
**File**: `server/utils/ip.js:4-12`

```javascript
const headers = [
    'x-forwarded-for', 'x-real-ip', 'cf-connecting-ip',
    'x-client-ip', 'x-cluster-client-ip', 'forwarded-for', 'forwarded'
];
```

The IP extraction function checks many headers that can be spoofed by clients if there is no trusted reverse proxy stripping them. While `trust proxy` is set to `1`, the custom `getClientIP` function bypasses Express's built-in `req.ip` handling by checking raw headers first.

**Impact**: IP-based rate limiting and brute force protection can be bypassed by spoofing headers.

**Remediation**: Use only `req.ip` (which respects `trust proxy` setting) or validate headers against a known proxy chain.

---

## Remediation Priority

### Immediate (This Week)

1. **C1**: Encrypt Binance API keys at rest
2. **C2**: Remove hardcoded secrets, add startup validation
3. **H5**: Add authentication to emergency restore endpoint
4. **H6**: Restrict static file serving to public directories only
5. **C6**: Implement proper password validation on registration

### Short Term (Next 2 Weeks)

6. **C3**: Implement CSRF protection
7. **C4**: Add session regeneration on login
8. **C5**: Replace FileSessionStore with Redis
9. **H1**: Fix Socket.IO CORS configuration
10. **H2**: Validate redirect URLs
11. **C7**: Use `BCRYPT_ROUNDS` from config consistently

### Medium Term (Next Month)

12. **H3**: Mask sensitive columns in admin views
13. **H7**: Sanitize all error responses
14. **H8**: Reduce body size limits
15. **H9**: Encrypt TOTP secrets at rest
16. **M1-M8**: Address all medium findings

---

## Summary of Compliance Gaps

### PCI DSS (relevant for financial platform)
- **Fail**: Cardholder-equivalent data (API keys) stored unencrypted (Req 3.4)
- **Fail**: No key management procedures (Req 3.5-3.6)
- **Fail**: Weak password policy (Req 8.2.3)

### OWASP Top 10 Coverage
- **A01 Broken Access Control**: CRITICAL (CSRF, open redirect, static serving)
- **A02 Cryptographic Failures**: CRITICAL (plaintext API keys, plaintext sessions, hardcoded secrets)
- **A03 Injection**: LOW (parameterized queries used, minor interpolation concerns)
- **A04 Insecure Design**: MEDIUM (rate limiting gaps)
- **A05 Security Misconfiguration**: MEDIUM (CSP, HSTS, body limits)
- **A07 Auth Failures**: CRITICAL (no session regeneration, weak passwords)
- **A09 Logging Failures**: MEDIUM (sensitive data potentially in logs)

---

*End of Security Audit Report*
