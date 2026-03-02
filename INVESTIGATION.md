# Backend Services Analysis - Subtask 1-1 Investigation Results

## Overview

This document provides a comprehensive analysis of the Yamato Trading Platform backend services, including all API routes, database schema, middleware architecture, and key services. Analysis was performed on the current codebase as of 2026-03-02.

---

## 1. All API Routes by Feature

### 1.1 Authentication Routes (`server/routes/auth.js`)

| Method | Endpoint | Purpose | Auth Required | Key Parameters |
|--------|----------|---------|---------------|-----------------|
| POST | `/api/auth/register` | User registration with email/password | No | `email`, `password`, `fullName`, `phone` |
| POST | `/api/auth/login` | User login with credentials | No | `email`, `password`, `totpToken` (optional) |
| GET | `/api/auth/me` | Get current authenticated user info | Yes | None |
| POST | `/api/auth/logout` | Clear session and logout | Yes | None |
| POST | `/api/auth/forgot-password` | Request password reset | No | `email` |
| POST | `/api/auth/reset-password` | Reset password with token | No | `token`, `newPassword` |
| POST | `/api/auth/verify-email` | Verify email with token | No | `token` |
| POST | `/api/auth/enable-2fa` | Enable 2FA (TOTP) | Yes | None |
| POST | `/api/auth/disable-2fa` | Disable 2FA | Yes | `password` |
| POST | `/api/auth/telegram-login-request` | Request Telegram login code | No | `email` |
| POST | `/api/auth/telegram-login-verify` | Verify Telegram login code | No | `email`, `code` |
| GET | `/api/auth/backup-codes` | Get 2FA backup codes | Yes | None |

**Authentication Pattern:**
- Uses bcryptjs for password hashing (10 rounds)
- Custom session middleware with FileSessionStore (`server/middleware/session.js`)
- TOTP (Time-based One-Time Password) via speakeasy library for 2FA
- Brute-force protection via `utils/bruteForce.js` with progressive delays
- Rate limiting: 5 req/min per IP (auth endpoints)
- Session cookie: `connect.sid`, httpOnly, sameSite=lax, 7-day maxAge

### 1.2 Market Data Routes (`server/routes/market.js`)

| Method | Endpoint | Purpose | Auth Required | Key Parameters |
|--------|----------|---------|---------------|-----------------|
| GET | `/api/market/prices` | Get current prices for major crypto | No | None |
| GET | `/api/market/price/:symbol` | Get single symbol price from Binance | No | `symbol` |
| GET | `/api/market/orderbook/:symbol` | Get order book (bids/asks) | No | `symbol`, `limit` (default 10) |
| GET | `/api/market/ticker` | Get ticker data for all symbols | No | None |

**Data Sources:**
- Binance API v3 spot market data
- Supported symbols: BTC, ETH, SOL, DOGE, ADA, XRP, DOT, MATIC, AVAX, LINK, UNI, ATOM, LTC, BCH, NEAR, APT, ARB, OP, FIL, ICP, SHIB, TRX, ETC, XLM, HBAR, BNB, PEPE, WIF

### 1.3 Portfolio Routes (`server/routes/portfolio.js`)

| Method | Endpoint | Purpose | Auth Required | Key Parameters |
|--------|----------|---------|---------------|-----------------|
| GET | `/api/portfolio` | Get user portfolio summary | Yes | None |
| GET | `/api/portfolio/performance` | Get portfolio performance metrics | Yes | None |
| GET | `/api/portfolio/holdings/:currency` | Get specific holding details | Yes | `currency` |
| POST | `/api/portfolio/wallet/add` | Add external wallet tracking | Yes | `name`, `address`, `currency` |
| DELETE | `/api/portfolio/wallet/:id` | Remove tracked wallet | Yes | `id` |
| PUT | `/api/portfolio/wallet/refresh` | Manually refresh wallet balances | Yes | None |

**Portfolio Features:**
- Tracks both demo and real account balances
- Computes holdings from trading orders + external wallets
- Calculates P&L, average buy price, current price per holding
- Portfolio snapshots for historical performance tracking
- Account type switching: demo (10000 initial) vs. real (real money)

### 1.4 Trading Orders Routes (`server/routes/orders.js`)

| Method | Endpoint | Purpose | Auth Required | Key Parameters |
|--------|----------|---------|---------------|-----------------|
| POST | `/api/orders` | Create new buy/sell order | Yes | `symbol`, `side` (buy/sell), `type` (market/limit), `price`, `amount` |
| GET | `/api/orders` | Get all user orders | Yes | None |
| GET | `/api/orders/:id` | Get specific order details | Yes | `id` |
| PUT | `/api/orders/:id/cancel` | Cancel open order | Yes | `id` |
| GET | `/api/orders/history` | Get historical orders | Yes | `limit`, `offset` |
| POST | `/api/orders/binance/validate` | Validate Binance credentials | Yes | `apiKey`, `apiSecret`, `accountType` |
| POST | `/api/orders/binance/futures-data` | Get futures account data from Binance | Yes | `apiKey`, `apiSecret` |
| POST | `/api/orders/binance/place-order` | Place order on Binance futures | Yes | `apiKey`, `apiSecret`, various order params |

**Order Features:**
- Market and limit orders for spot trading
- Binance API integration for real trading (with credential validation)
- Order status tracking: open, filled, cancelled, partially_filled
- Caching: Server time cache (30s), Binance data cache (8s)
- Rate limiting: 100 req/min per user/IP

### 1.5 Bot Trading Routes (`server/routes/bots.js`)

| Method | Endpoint | Purpose | Auth Required | Key Parameters |
|--------|----------|---------|---------------|-----------------|
| POST | `/api/bots` | Create new trading bot | Yes | `name`, `type`, `pair`, `investment` |
| GET | `/api/bots` | List all user bots | Yes | None |
| GET | `/api/bots/:id` | Get bot details | Yes | `id` |
| PUT | `/api/bots/:id` | Update bot settings | Yes | `id`, settings object |
| DELETE | `/api/bots/:id` | Delete bot | Yes | `id` |
| POST | `/api/bots/:id/start` | Activate bot trading | Yes | `id` |
| POST | `/api/bots/:id/stop` | Deactivate bot | Yes | `id` |
| GET | `/api/bots/:id/trades` | Get bot trade history | Yes | `id` |
| GET | `/api/bots/:id/stats` | Get bot statistics (P&L, win rate, etc.) | Yes | `id` |
| POST | `/api/bots/:id/subscribe` | Subscribe to bot trades | Yes | `id`, `copy_percentage`, `max_position_size` |
| GET | `/api/bots/:id/subscribers` | Get list of bot subscribers | Yes | `id` |
| POST | `/api/bots/:id/settings` | Update bot trading settings | Yes | `id`, settings object |

**Bot Features:**
- Three bot types: AI BOT, Grid Bot, Neutral Bot
- Copy-trading: Subscribe to other users' bots with custom percentage/position sizing
- Binance integration: Connect real API keys for live trading
- Bot statistics: Total trades, win rate, P&L, max drawdown, best/worst trade
- Account types: Futures (default) or spot
- Mode: Test (simulated) or Live (real Binance)

### 1.6 User Profile Routes (`server/routes/profile.js`)

| Method | Endpoint | Purpose | Auth Required | Key Parameters |
|--------|----------|---------|---------------|-----------------|
| GET | `/api/profile` | Get user profile data | Yes | None |
| PATCH | `/api/profile` | Update profile info | Yes | `fullName`, `phone` |
| POST | `/api/profile/avatar` | Upload avatar image | Yes | file multipart |
| POST | `/api/profile/change-password` | Change password | Yes | `oldPassword`, `newPassword` |
| GET | `/api/profile/activity-log` | Get user activity log | Yes | `limit` (default 10) |
| POST | `/api/profile/telegram/link-request` | Request Telegram link code | Yes | None |
| POST | `/api/profile/telegram/link-verify` | Verify Telegram link | Yes | `code` |
| POST | `/api/profile/telegram/unlink` | Unlink Telegram | Yes | None |

### 1.7 Notifications Routes (`server/routes/notifications.js`)

| Method | Endpoint | Purpose | Auth Required | Key Parameters |
|--------|----------|---------|---------------|-----------------|
| GET | `/api/notifications` | Get user notifications | Yes | None |
| PUT | `/api/notifications/:id/read` | Mark single notification as read | Yes | `id` |
| PUT | `/api/notifications/read-all` | Mark all notifications as read | Yes | None |
| DELETE | `/api/notifications/:id` | Delete notification | Yes | `id` |
| DELETE | `/api/notifications` | Clear all notifications | Yes | None |

**Notification Features:**
- Types: system, trade, alert, warning, info
- Unread count tracking
- Socket.IO real-time delivery
- Telegram integration for notifications
- In-app notification center with 50 max display

### 1.8 Subscription Routes (`server/routes/subscription.js`)

| Method | Endpoint | Purpose | Auth Required | Key Parameters |
|--------|----------|---------|---------------|-----------------|
| GET | `/api/subscription` | Get current subscription status | Yes | None |
| POST | `/api/subscription/checkout` | Activate subscription | Yes | `plan` (pro/enterprise), `period` (monthly/yearly) |
| POST | `/api/subscription/cancel` | Cancel subscription | Yes | None |

**Subscription Plans:**
- free: Limited bots (1), no copy-trading
- pro: 5 bots, copy-trading enabled, monthly
- enterprise: Unlimited bots, priority support, yearly

### 1.9 Faucet Routes (`server/routes/faucet.js`)

| Method | Endpoint | Purpose | Auth Required | Key Parameters |
|--------|----------|---------|---------------|-----------------|
| GET | `/api/faucet/status` | Get faucet claim status | Yes | None |
| POST | `/api/faucet/claim` | Claim test funds | Yes | `amount` (1-100), `currency` (default USDT) |

**Faucet Features:**
- Demo account funding: $100 per 24-hour period max
- Used for testing trading strategies without real money
- Recorded in transactions table with type='faucet'

### 1.10 History/Candle Data Routes (`server/routes/history.js`)

| Method | Endpoint | Purpose | Auth Required | Key Parameters |
|--------|----------|---------|---------------|-----------------|
| GET | `/api/market/history/:symbol` | Get candle history | No | `symbol`, `from`, `to`, `timeframe`, `limit` |
| GET | `/api/market/history/:symbol/info` | Get candle data metadata | No | `symbol` |

**Timeframes Supported:** 1s, 5s, 15s, 30s, 1m, 5m, 15m, 30m, 1h, 4h, 1d

### 1.11 Admin Routes (`server/routes/admin.js`)

| Method | Endpoint | Purpose | Auth Required | Role Required | Key Parameters |
|--------|----------|---------|---------------|----------------|-----------------|
| GET | `/api/admin/stats` | Get platform statistics | Yes | admin/moderator | None |
| GET | `/api/admin/analytics/users` | Get user analytics (DAU/WAU/MAU) | Yes | admin/moderator | `days` (default 30) |
| GET | `/api/admin/users` | List all users | Yes | admin | `search`, `role`, `limit` |
| GET | `/api/admin/users/:id` | Get user details | Yes | admin | `id` |
| PUT | `/api/admin/users/:id` | Update user info | Yes | admin | `id`, update fields |
| POST | `/api/admin/users/:id/ban` | Ban user account | Yes | admin | `id`, `reason` |
| POST | `/api/admin/users/:id/unban` | Unban user | Yes | admin | `id` |
| GET | `/api/admin/transactions` | List all transactions | Yes | admin | `limit`, `offset` |
| GET | `/api/admin/bots` | List all bots | Yes | admin | None |
| GET | `/api/admin/news` | Get news articles | Yes | admin | None |
| POST | `/api/admin/news` | Create news article | Yes | admin | `title`, `content`, `category` |
| PUT | `/api/admin/news/:id` | Update news article | Yes | admin | `id`, fields |
| DELETE | `/api/admin/news/:id` | Delete news article | Yes | admin | `id` |

---

## 2. Database Schema

### Core Tables

#### `users` Table
```sql
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL (bcrypt hash),
    full_name TEXT NOT NULL,
    phone TEXT,
    balance REAL DEFAULT 0 (legacy, use demo_balance/real_balance),
    demo_balance REAL DEFAULT 10000,
    real_balance REAL DEFAULT 0,
    active_account TEXT DEFAULT 'demo' (demo|real),
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    last_login TEXT,
    is_verified INTEGER DEFAULT 0,
    verification_level INTEGER DEFAULT 0,
    role TEXT DEFAULT 'user' (user|admin|moderator),
    is_banned INTEGER DEFAULT 0,
    ban_reason TEXT,
    totp_secret TEXT (TOTP 2FA secret),
    totp_enabled INTEGER DEFAULT 0,
    backup_codes TEXT (JSON array of 2FA backup codes),
    avatar TEXT (image URL),
    subscription_plan TEXT DEFAULT 'free' (free|pro|enterprise),
    subscription_expires_at TEXT,
    last_ip TEXT,
    telegram_id TEXT,
    telegram_code TEXT (verification code),
    telegram_verified INTEGER DEFAULT 0,
    telegram_username TEXT,
    email_verified INTEGER DEFAULT 0
)
```

#### `transactions` Table
```sql
CREATE TABLE transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL (deposit|withdrawal|faucet|trade),
    currency TEXT NOT NULL (USDT, BTC, ETH, etc.),
    amount REAL NOT NULL,
    usd_value REAL,
    status TEXT DEFAULT 'completed' (pending|completed|failed),
    account_type TEXT DEFAULT 'demo' (demo|real),
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
)
```

#### `orders` Table
```sql
CREATE TABLE orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    symbol TEXT NOT NULL (BTCUSDT, ETHUSDT, etc.),
    side TEXT NOT NULL (buy|sell),
    type TEXT NOT NULL (market|limit),
    price REAL,
    amount REAL NOT NULL,
    filled REAL DEFAULT 0,
    status TEXT DEFAULT 'open' (open|filled|cancelled|partially_filled),
    account_type TEXT DEFAULT 'demo' (demo|real),
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    filled_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
)
```

#### `holdings` Table
```sql
CREATE TABLE holdings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    currency TEXT NOT NULL,
    amount REAL DEFAULT 0,
    avg_buy_price REAL DEFAULT 0,
    account_type TEXT DEFAULT 'demo',
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(user_id, currency, account_type)
)
```

#### `bots` Table
```sql
CREATE TABLE bots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL (ai_bot|grid_bot|neutral_bot),
    pair TEXT NOT NULL (BTCUSDT, ETHUSDT, etc.),
    investment REAL DEFAULT 0,
    profit REAL DEFAULT 0,
    is_active INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    binance_api_key TEXT,
    binance_api_secret TEXT,
    mode TEXT DEFAULT 'test' (test|live),
    display_settings TEXT DEFAULT '{}' (JSON),
    account_type TEXT DEFAULT 'futures' (futures|spot),
    selected_symbol TEXT DEFAULT 'BTCUSDT',
    trading_settings TEXT DEFAULT '{}' (JSON with strategy params),
    category_id INTEGER DEFAULT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (category_id) REFERENCES bot_categories(id)
)
```

#### `bot_trades` Table
```sql
CREATE TABLE bot_trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id INTEGER NOT NULL,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL (buy|sell),
    type TEXT NOT NULL (market|limit),
    quantity REAL NOT NULL,
    price REAL NOT NULL,
    pnl REAL DEFAULT 0,
    pnl_percent REAL DEFAULT 0,
    status TEXT DEFAULT 'open' (open|closed),
    opened_at TEXT DEFAULT CURRENT_TIMESTAMP,
    closed_at TEXT,
    binance_trade_id TEXT,
    binance_close_trade_id TEXT,
    FOREIGN KEY (bot_id) REFERENCES bots(id),
    INDEX: idx_bot_trades_binance_id, idx_bot_trades_close_id
)
```

#### `bot_subscribers` Table
```sql
CREATE TABLE bot_subscribers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    copy_trades INTEGER DEFAULT 0,
    copy_percentage REAL DEFAULT 100,
    max_position_size REAL DEFAULT 0,
    status TEXT DEFAULT 'active' (active|paused|cancelled),
    subscribed_at TEXT DEFAULT CURRENT_TIMESTAMP,
    user_binance_api_key TEXT,
    user_binance_api_secret TEXT,
    FOREIGN KEY (bot_id) REFERENCES bots(id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(bot_id, user_id)
)
```

#### `bot_stats` Table
```sql
CREATE TABLE bot_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id INTEGER NOT NULL UNIQUE,
    total_trades INTEGER DEFAULT 0,
    winning_trades INTEGER DEFAULT 0,
    losing_trades INTEGER DEFAULT 0,
    total_pnl REAL DEFAULT 0,
    max_drawdown REAL DEFAULT 0,
    best_trade REAL DEFAULT 0,
    worst_trade REAL DEFAULT 0,
    avg_trade_duration INTEGER DEFAULT 0,
    last_updated TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (bot_id) REFERENCES bots(id)
)
```

### Supporting Tables

#### `notifications` Table
```sql
CREATE TABLE notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL (system|trade|alert|warning|info),
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    icon TEXT,
    is_read INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
)
```

#### `wallets` Table
```sql
CREATE TABLE wallets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    currency TEXT NOT NULL,
    balance REAL DEFAULT 0,
    usd_value REAL DEFAULT 0,
    last_updated TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id)
)
```

#### `bot_categories` Table
```sql
CREATE TABLE bot_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL (AI BOT|Grid Bot|Neutral Bot),
    color TEXT DEFAULT '#10B981' (hex color code),
    icon TEXT DEFAULT 'bot',
    sort_order INTEGER DEFAULT 0,
    is_visible INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
)
```

#### `activity_log` Table
```sql
CREATE TABLE activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    action TEXT NOT NULL (Login|Logout|Profile Updated|Bot Created|etc),
    details TEXT,
    ip_address TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
)
```

#### `login_attempts` Table
```sql
CREATE TABLE login_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip_address TEXT NOT NULL,
    user_email TEXT NOT NULL,
    success INTEGER DEFAULT 0 (0=failed, 1=success),
    attempt_time TEXT DEFAULT CURRENT_TIMESTAMP,
    INDEX: idx_login_attempts_ip_time, idx_login_attempts_email_time
)
```

#### `password_reset_tokens` Table
```sql
CREATE TABLE password_reset_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token TEXT UNIQUE NOT NULL,
    expires_at TEXT NOT NULL,
    used INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
)
```

#### `email_verification_tokens` Table
```sql
CREATE TABLE email_verification_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token TEXT UNIQUE NOT NULL,
    expires_at TEXT NOT NULL,
    used INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
)
```

#### `passkeys` Table (WebAuthn)
```sql
CREATE TABLE passkeys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    credential_id TEXT UNIQUE NOT NULL,
    public_key TEXT NOT NULL,
    counter INTEGER DEFAULT 0,
    device_type TEXT,
    last_used_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
)
```

#### `permissions` & `user_permissions` Tables
```sql
CREATE TABLE permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    description TEXT
)

CREATE TABLE user_permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    permission_id INTEGER NOT NULL,
    granted_by INTEGER,
    granted_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (permission_id) REFERENCES permissions(id),
    FOREIGN KEY (granted_by) REFERENCES users(id)
)

DEFAULT PERMISSIONS:
- users.view, users.edit, users.ban, users.roles
- transactions.view
- bots.manage
- news.manage
- settings.manage, settings.view
```

#### `admin_audit_log` Table
```sql
CREATE TABLE admin_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id INTEGER,
    details TEXT,
    ip_address TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (admin_id) REFERENCES users(id)
)
```

#### `news` Table
```sql
CREATE TABLE news (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    excerpt TEXT,
    content TEXT,
    category TEXT NOT NULL DEFAULT 'update' (update|announcement|tutorial),
    image_url TEXT,
    is_published INTEGER DEFAULT 1,
    created_by INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id)
)
```

#### `portfolio_snapshots` Table
```sql
CREATE TABLE portfolio_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    month TEXT NOT NULL (YYYY-MM),
    total_value REAL DEFAULT 0,
    profit_loss REAL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
)
```

#### `bot_order_history` Table
```sql
CREATE TABLE bot_order_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id INTEGER NOT NULL,
    order_id TEXT,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL (buy|sell),
    type TEXT NOT NULL (market|limit),
    price REAL,
    stop_price REAL,
    quantity REAL,
    status TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    canceled_at TEXT,
    FOREIGN KEY (bot_id) REFERENCES bots(id)
)
```

---

## 3. Key Services

### 3.1 Binance Service (`server/services/binance.js`)

**Purpose:** Handles all Binance exchange API interactions for real trading

**Key Functions:**
- `testBinanceCredentials(apiKey, apiSecret, accountType)` - Validates Binance API credentials
- `fetchBinanceFuturesData(apiKey, apiSecret)` - Retrieves account positions, open orders, balance
- `placeBinanceOrder(apiKey, apiSecret, orderParams)` - Places limit/market orders on Binance Futures
- `closeBinancePosition(apiKey, apiSecret, symbol)` - Closes open position
- `getBinanceServerTime(accountType)` - Gets server time for request signatures

**Features:**
- Supports both Spot API and Futures API
- Automatic request signing using HMAC-SHA256
- Retry mechanism with exponential backoff (3 attempts max)
- Retryable errors: 408, 429, 500, 502, 503, 504
- Non-retryable: Client auth errors (4xx except timeout/rate-limit)
- Base delay: 1000ms between retries with jitter

**Integration Points:**
- Used by bot trading logic for live trading
- Used by orders routes for validating/executing trades
- Requires valid Binance API keys (secret stored encrypted in DB)

### 3.2 Telegram Service (`server/services/telegram.js`)

**Purpose:** Telegram bot integration for user notifications and account linking

**Key Functions:**
- `initTelegramBot()` - Initialize Telegram bot with polling
- `sendTelegramNotification(telegramId, message)` - Send message to user's Telegram chat
- Handles `/start` command for account linking with verification codes
- Handles `/status` command for user balance/subscription info

**Features:**
- Account linking via unique verification codes
- Real-time notifications for trade events, alerts, messages
- Notifications for new trades, position closures, stop losses, take profits
- Status tracking: telegram_verified, telegram_id, telegram_username in users table
- Telegram bot token stored in site settings (environment variable)

**Integration Points:**
- Linked in profile via `/api/profile/telegram/link-request`
- Used to send notifications when trading events occur
- Socket.IO event `telegram_linked` emitted on successful link

### 3.3 Email Service (`server/services/email.js`)

**Purpose:** Handles email sending for authentication and notifications

**Key Functions:**
- `sendVerificationEmail(email, verificationUrl)` - Verification email on registration
- `sendPasswordResetEmail(email, resetUrl)` - Password reset link
- Generic email sending function

**Features:**
- Uses nodemailer for SMTP
- Email credentials from environment variables
- HTML email templates
- Used for account recovery flows
- Verification emails with expiring tokens (24-hour expiration)

**Integration Points:**
- Registration flow creates email_verification_tokens
- Password reset flow creates password_reset_tokens
- Emails sent asynchronously (non-blocking)

### 3.4 Notifications Service (`server/services/notifications.js`)

**Purpose:** In-app notification system management

**Key Functions:**
- `createNotification(userId, type, title, message, icon)` - Creates notification record
- `logAdminAction(adminId, action, targetType, targetId, details)` - Logs admin activities
- Types: system, trade, alert, warning, info

**Features:**
- Notifications stored in database with read/unread status
- Real-time delivery via Socket.IO
- Notification types: system (welcome, settings), trade (fills, executions), alert (price levels), warning (errors), info (general)
- Admin action logging for audit trail

**Integration Points:**
- Emitted on user events: registration, password changes, 2FA enablement
- Emitted on bot events: bot created, trades opened, positions closed
- Socket.IO room: `user_{userId}` for real-time delivery

### 3.5 Market Service (`server/services/market.js`)

**Purpose:** Market data aggregation from Binance

**Key Functions:**
- `getMarketPrices()` - Fetches current prices for major symbols from Binance API
- `getOrderBook(symbol, limit)` - Retrieves order book depth
- Exports `BINANCE_API` constant: `https://api.binance.com/api/v3`

**Features:**
- Caches market data to reduce API calls
- Returns price, 24h change %, high, low, volume
- Used for market view displays
- Used for market price validation in order execution

### 3.6 Candle Collector Service (`server/services/candleCollector.js`)

**Purpose:** Collects and stores OHLCV candle data from Binance WebSocket

**Key Functions:**
- `startCollector()` - Start WebSocket stream for candle data
- `getCandleHistory(symbol, from, to, limit)` - Retrieve candle history
- `aggregateCandles(raw, timeframe)` - Aggregate 1s candles to higher timeframes
- `getCandleInfo(symbol)` - Get metadata about stored candles

**Features:**
- Real-time candle collection from Binance WebSocket
- Aggregates 1-second candles into higher timeframes (5s, 1m, 5m, 15m, 1h, 4h, 1d)
- Persists to separate candles.sqlite database
- Used by charting component for TradingView-like UI
- In-memory caching to reduce DB queries

### 3.7 Blockchain Service (`server/services/blockchain.js`)

**Purpose:** Blockchain/wallet tracking utilities

**Key Functions:**
- `validateWalletAddress(address, currency)` - Validate blockchain address format
- `getBlockchainBalance(address, currency)` - Fetch wallet balance from blockchain explorer
- Supports: Bitcoin, Ethereum, Solana, and other major chains

**Features:**
- External wallet balance tracking
- Used for portfolio overview (combining trading + external holdings)
- Wallet validation before adding to portfolio
- Cache with TTL (default 1 hour) to reduce API calls

---

## 4. Middleware Architecture

### 4.1 Authentication Middleware (`server/middleware/auth.js`)

**Exports:**
- `requireAuth` - Ensures user is logged in; returns 401 if not authenticated
- `requireRole(...roles)` - Checks if user has required role(s); returns 403 if not
- `requirePermission(permissionName)` - Checks granular permissions; returns 403 if missing

**Behavior:**
- Checks `req.session.userId` existence
- Verifies user is not banned (checks `is_banned` and `ban_reason` columns)
- Role-based access: admin, moderator, user
- Permission-based access for fine-grained control
- Destroys session if user not found or is banned

### 4.2 Session Middleware (`server/middleware/session.js`)

**Features:**
- Custom `FileSessionStore` implementation
- Stores sessions in `server/sessions.json`
- Cookie: `connect.sid`, httpOnly, sameSite=lax, 7-day maxAge
- Session fields: `userId`, `betaAccess`
- Session middleware initialized before routes in server.js

### 4.3 Beta Gate Middleware (`server/middleware/beta.js`)

**Features:**
- Checks `req.session.betaAccess` flag
- Whitelist of excluded paths (no auth required):
  - `/beta`, `/logo.svg`
  - `/css/`, `/fonts/`
  - `/login`, `/register`, `/verify-email`, `/reset-password`
  - `/api/auth/*`
- POST `/beta` endpoint for requesting beta access
- Redirects to `/beta` form if access denied

### 4.4 Error Handler Middleware (`server/middleware/errorHandler.js`)

**Features:**
- Global error handling for uncaught exceptions
- Returns JSON error responses
- Status codes: 500 for server errors, 400 for validation errors
- Logs errors to console

### 4.5 Rate Limiting Middleware (`server/middleware/rateLimit.js`)

**Configuration:**
- **Auth endpoints:** 5 req/min per IP (login, register, forgot-password, reset-password)
- **Telegram auth:** 5 req/min per IP
- **Orders:** 100 req/min per user/IP
- **General API:** 100 req/min per user/IP

**Features:**
- Redis-backed with in-memory fallback
- Window-based rate limiting
- IP-based for unauthenticated endpoints
- User ID-based for authenticated endpoints
- Graceful degradation if Redis unavailable

### 4.6 Maintenance Middleware (`server/middleware/maintenance.js`)

**Features:**
- Toggle maintenance mode via site settings
- Returns maintenance page if `maintenanceMode` is enabled
- Allows admin access during maintenance
- Used for deployments and updates

---

## 5. Socket.IO Real-Time Events

**Location:** `server/socket/index.js`

**Key Events (Server → Client):**
- `price_update` - Market price changes
- `trade_executed` - Order filled
- `position_opened` - New position
- `position_closed` - Position closed
- `notification` - In-app notification
- `bot_trade` - Bot executed a trade
- `telegram_linked` - Telegram account linked

**Key Events (Client → Server):**
- `subscribe_prices` - Subscribe to price updates
- `unsubscribe_prices` - Unsubscribe
- `subscribe_notifications` - Subscribe to notifications
- Rooms: `user_{userId}` for user-specific events

---

## 6. Database Helpers (`server/db/index.js`)

**Exported Functions:**
- `dbGet(sql, params)` - Returns single row or null
- `dbAll(sql, params)` - Returns array of rows
- `dbRun(sql, params)` - Executes INSERT/UPDATE/DELETE, saves to file
- `saveDatabase()` - Persists in-memory DB to `server/database.sqlite` file
- `initDatabase()` - Initialize DB and create/migrate tables

**Database Engine:**
- sql.js (SQLite compiled to WebAssembly)
- In-memory with file persistence
- All queries use parameterized statements (no SQL injection)
- File location: `server/database.sqlite`

---

## 7. Security Features

### Authentication & Authorization
- Bcrypt password hashing (10 rounds)
- TOTP 2FA with backup codes
- Session-based authentication with secure cookies
- Brute-force protection with progressive delays
- IP address logging on all activities
- Passkey support (WebAuthn)

### Rate Limiting
- Per-IP rate limiting on auth endpoints
- Per-user rate limiting on API endpoints
- Redis fallback to in-memory store
- Custom limiter for orders, telegram auth

### Account Protection
- Ban/unban functionality with reasons
- Activity logging on all user actions
- Telegram account linking verification
- Email verification tokens with expiration

### Data Protection
- Parameterized SQL queries prevent injection
- Environment variable management for secrets
- Secure password reset tokens (32-byte crypto.randomBytes)
- Email verification tokens (24-hour expiration)

---

## 8. Configuration (`server/config/index.js`)

**Key Settings:**
- `PORT` - HTTP server port (default 3000)
- `HTTPS_PORT` - HTTPS server port
- `HOST` - Server host (default localhost)
- `DB_PATH` - Database file location
- `ADMIN_EMAIL` - Email that gets admin role on registration
- `REDIS_URL` - Redis connection string
- `TELEGRAM_BOT_TOKEN` - Telegram bot token
- `SMTP_*` - Email service configuration

---

## 9. Summary Statistics

| Category | Count |
|----------|-------|
| API Routes | 50+ |
| Database Tables | 25+ |
| Services | 7 |
| Middleware Modules | 7 |
| Socket.IO Events | 10+ |
| Database Helpers | 3 |
| User Roles | 3 (user, admin, moderator) |
| Subscription Plans | 3 (free, pro, enterprise) |
| Bot Types | 3 (AI BOT, Grid Bot, Neutral Bot) |

---

## 10. Key Observations & Notes

1. **Database Design:**
   - Demo/real account separation allows safe testing
   - Proper foreign key relationships with cascade deletes
   - Historical data preserved (activity logs, transaction history)
   - Indexes on frequently queried fields (login_attempts, bot_trades)

2. **Security:**
   - Rate limiting is multi-layered (IP + user)
   - Brute-force protection on login
   - Session-based auth is more stateful than JWT but allows immediate logout
   - 2FA is optional but available

3. **Scalability Concerns:**
   - sql.js is in-memory; large datasets could be problematic
   - Redis fallback for rate limiting is good; prevents single point of failure
   - Binance API caching (30s server time, 8s data) reduces external API calls

4. **Trading Integration:**
   - Binance API credentials stored encrypted in bots table
   - Supports both futures and spot trading
   - Copy-trading allows subscribers to replicate bot trades with custom sizing
   - Test mode allows simulated trading before going live

5. **Missing/Partial Features:**
   - WebAuthn (passkeys) schema exists but not fully integrated in routes
   - Payment methods table exists but checkout is mocked (no real payment processing)
   - Subscription cancellation is mocked (not actually stopping service)

---

## 11. File References

- Entry Point: `server/server.js`
- Routes: `server/routes/*.js` (11 files)
- Services: `server/services/*.js` (7 files)
- Middleware: `server/middleware/*.js` (7 files)
- Database: `server/db/index.js`
- Configuration: `server/config/index.js`
- Socket.IO: `server/socket/index.js`
- Utilities: `server/utils/` (ip.js, ssl.js, time.js, redis.js, bruteForce.js)

---

**Investigation completed:** 2026-03-02
**Analyst:** Auto-Claude Agent
**Subtask ID:** subtask-1-1
