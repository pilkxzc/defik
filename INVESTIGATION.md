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

**Investigation completed (Backend):** 2026-03-02
**Analyst:** Auto-Claude Agent
**Subtask ID:** subtask-1-1

---

# Frontend Architecture Analysis - Subtask 1-2 Investigation Results

## Overview

The Yamato Trading Platform has a **vanilla HTML/CSS/JavaScript frontend** (in `/page`, `/css`, `/js`) combined with a **React/Vite charting widget** (in `/_src/` building to `/js/chart/chart.js`). The frontend consists of ~20 HTML pages across desktop and mobile, with a sophisticated real-time trading interface powered by Socket.IO and Binance market data.

---

## 1. HTML Pages Inventory (`page/` directory)

### Total: 22 HTML files, ~32,000 lines

#### Landing & Authentication Pages

| File | Purpose | Size | Key Features |
|------|---------|------|--------------|
| **index.html** | Landing page / home | 973 lines | Marketing content, CTA buttons, animated 3D cube background, navigation to login/register, project overview |
| **reglogin.html** | Login & Register | 1252 lines | Dual-tab form (login/signup), email/password fields, client-side validation, OAuth hints, forgot password link, responsive auth modal |
| **reset-password.html** | Password reset flow | 173 lines | Token-based password reset form, new password input confirmation |
| **verify-email.html** | Email verification | 175 lines | Email verification prompt, resend verification link button |

#### Main Trading/Dashboard Pages

| File | Purpose | Size | Key Features |
|------|---------|------|--------------|
| **datedos.html** | Primary Trading Terminal | 1947 lines | **Main dashboard** — real-time chart (KlineCharts), market list sidebar (price tickers), trading panel (buy/sell forms), holdings display, order history, Socket.IO price streaming, responsive grid layout with collapsible sidebars |
| **dashboards-bot.html** | Bot Dashboard | 1496 lines | Bot trading terminal with bot-specific positions, trades, statistics, charting for bot performance |

#### Bot Management

| File | Purpose | Size | Key Features |
|------|---------|------|--------------|
| **bots.html** | Bot List & Management | 1407 lines | List of user's trading bots, create bot modal, edit bot forms, bot status indicators (active/inactive), Binance API key configuration, bot mode selection (demo/real), delete functionality, modal-heavy |
| **bot-detail.html** | Bot Detail View (Admin/Desktop) | 10,698 lines | **Largest page in codebase** — comprehensive bot detail: settings, terminal/console output, live trade execution log, bot statistics, performance graphs, Telegram config, strategy settings, complex UI with tabs/expandable sections |
| **bot-stats.html** | Bot Statistics & Performance | 527 lines | Bot performance charts, trade statistics, PnL metrics, win rate, visual performance indicators |

#### User Account Pages

| File | Purpose | Size | Key Features |
|------|---------|------|--------------|
| **profile.html** | User Profile & Settings | 2430 lines | **Large page** — account settings tabs: personal info, security (2FA/TOTP), email settings, wallet management, API key management, password change, theme preferences, account deletion, Telegram integration, subscription info |
| **portfolio.html** | Portfolio Overview | 880 lines | Holdings summary, asset allocation, balance display, transaction history, quick stats (total value, 24h change), market overview |

#### Admin Panel

| File | Purpose | Size | Key Features |
|------|---------|------|--------------|
| **admin.html** | Admin Control Panel | 1796 lines | Admin-only interface: user management, transaction monitoring, audit logs, news management, subscription tier management, analytics dashboard, pagination, export functionality |

#### Informational Pages

| File | Purpose | Size | Key Features |
|------|---------|------|--------------|
| **news.html** | Crypto News Feed | 510 lines | News article list, filtering/search, article details, real-time news streaming |
| **community.html** | Community & Social Links | 437 lines | Links to Telegram, Instagram, YouTube, TikTok; community engagement CTA |
| **subscriptions.html** | Subscription Plans | 1309 lines | Pricing tiers, feature comparison table, plan selection, upgrade/downgrade functionality |

#### Loading & Error Pages

| File | Purpose | Size | Key Features |
|------|---------|------|--------------|
| **loading.html** | Loading Overlay | 316 lines | Generic loading screen (splash/transition state) |
| **loading grafik.html** | Chart Loading | 364 lines | Chart-specific loading overlay |
| **loadingdachbot.html** | Bot Dashboard Loading | 653 lines | Bot terminal loading screen with spinner |
| **403.html** | Access Denied | 305 lines | 403 Forbidden error page (no auth/permission) |
| **404erors.html** | Not Found | 306 lines | 404 Page Not Found error page |
| **500.html** | Server Error | 305 lines | 500 Internal Server Error page |
| **502.html** | Service Unavailable | 291 lines | 502 Bad Gateway / maintenance page ("Yamato — Оновлення") |

---

## 2. CSS Architecture (`css/` directory)

### Total: 8 files, ~2,800 lines

#### Design System (`variables.css`, 46 lines)
- Single source of truth for design tokens loaded FIRST
- Color palette: Dark theme (#080808 bg, #10B981 green accent)
- Text colors, radii, shadows, spacing gaps
- Never hardcoded colors; always uses `var(--css-token)`

**Key Tokens:**
```
--bg-app: #080808              (main background)
--surface: #141414             (card background)
--accent-primary: #10B981      (green — main brand color)
--color-up: #10B981            (price increase)
--color-down: #EF4444          (price decrease)
--text-primary: #FFFFFF
--text-secondary: #A1A1A1
--radius-xl: 32px              (max roundness)
--shadow-soft: 0 12px 32px rgba(0,0,0,0.4)
```

#### Shared Layout (`shared-layout.css`, 408 lines)
- Consistent layout across all dashboard pages
- 70px left sidebar with icon-only nav items
- 60px top header (brand pill + user menu + balance)
- Grid-based app container: `grid-template-columns: auto 1fr; grid-template-rows: 60px 1fr`
- `.card` component for consistent panel styling
- `.scroll-y` for scrollable areas with custom scrollbars

#### Mobile Responsive (`mobile.css`, 628 lines)
- Breakpoint: ≤768px
- Key changes:
  - Hide sidebar: `.nav-sidebar { display: none !important; }`
  - Single column: `grid-template-columns: 1fr`
  - Bottom navigation bar (replaces sidebar)
  - Sticky header at top with safe-area padding
  - Full-height scrollable content: `overflow: auto !important;`
  - Responsive font sizes, padding adjustments

#### Responsive Utilities (`responsive.css`, 264 lines)
- Desktop overflow lock: `html, body { overflow: hidden; }` (prevents bounce scroll)
- Mobile scrolling enabled via media query
- Scrollbar styling: Thin 4px scrollbar with custom colors
- Container rules and viewport constraints

#### Custom Scrollbar (`scrollbar.css`, 84 lines)
- Candlestick-themed scrollbar design
- **Vertical thumb:** Green (#26a69a) with thin wick + thick body (mimics candlestick)
- **Hover state:** Becomes red (#EF5350)
- **Active state:** Bright orange-red (#FF8A80)
- Firefox (`scrollbar-width: thin`) + WebKit support (Chrome/Safari/Edge)

#### Bot Terminal Styles (`bot-terminal.css`, 670 lines)
- Terminal display with monospace font
- Color-coded severity levels (error, warning, info, success)
- Log entry styling with timestamps
- Trade log visualization
- Tabs system for different views (chart, logs, settings, stats)
- Resizable panels, controls bar (symbol/timeframe selection)

#### Bot Terminal Mobile (`bot-terminal-mobile.css`, 347 lines)
- Mobile adaptations: shrink panels, stack vertically
- Hide non-essential panels on small screens
- Reduce font sizes, collapse accordions
- Optimized touch interactions

#### Navigation Fixes (`nav-fix.css`, 19 lines)
- Minor tweaks for navigation items
- Z-index adjustments, hover state refinements

---

## 3. JavaScript Architecture (`js/` directory)

### Total: 8 files, ~6,900 lines

#### Global App Initialization (`app.js`, 2594 lines)

**Purpose:** Global initialization, authentication, utilities

**Key Functions:**
1. **Authentication (`checkAuth()`):**
   - Verifies user login status on page load
   - Redirects to `/login` if not authenticated
   - Loads current user data from `/api/auth/me`

2. **Toast Notification System:**
   - `showToast(type, title, message)` — Creates styled notifications
   - Types: success, error, warning, info, login, security, transaction
   - Auto-dismiss after 4s, manual close button, 380px max width
   - Positioned top-right, z-index 99999, backdrop-blurred

3. **API Utilities:**
   - Fetch wrapper with error handling
   - Auto-redirect on 401 Unauthorized
   - JSON parsing, error message extraction
   - API_BASE = '/api'

4. **Format Utilities:**
   - `formatCurrency(value)` — USD with 2 decimals ($X,XXX.XX)
   - `formatNumber(value)` — Thousand separators
   - `formatPriceDash(price)` — Dashboard price formatting
   - `formatPercent(value)` — Percentage with ± prefix

5. **Socket.IO Initialization:**
   - `initSocket()` — Connects to real-time event stream
   - Handles reconnection with exponential backoff
   - Configures transports: WebSocket + polling fallback

6. **Navigation & UI:**
   - Highlight active nav item
   - Setup click handlers for nav items
   - Mobile detection and responsive behavior

7. **Global Variables:**
   - `currentUser` — Logged-in user object
   - `dashboardSocket` — Socket.IO connection
   - `sessionId` — Session identifier

#### Dashboard Real-Time (`dashboard.js`, 385 lines)

**Purpose:** Dashboard page logic — real-time updates, holdings, trades

**Key Functions:**
1. **Socket.IO Event Listeners:**
   - `priceUpdate` — Updates market ticker prices in real-time
   - `orderFilled` — Notifies when order executes
   - `holdingsUpdate` — Updates asset holdings display
   - `balanceUpdate` — Updates wallet balance display

2. **Holdings Management:**
   - `loadHoldings()` — Fetch and render user holdings
   - `updateHoldingsPrices(prices)` — Update prices without refetching
   - `renderHoldingsFromRaw(data)` — Render from API data

3. **Recent Trades:**
   - `loadRecentTrades()` — Fetch last N trades

4. **Order Management:**
   - Market vs. Limit order selection
   - Quick amount buttons (10%, 25%, 50%, 100%)
   - Order total calculation

5. **Chart Integration:**
   - Loads React KlineCharts from `/js/chart/chart.js`
   - Symbol & timeframe selection (1m, 5m, 1h, 1d)
   - Real-time candle updates

#### Admin Panel Controller (`admin.js`, 2846 lines)

**Purpose:** Admin-only functionality

**Key Sections:**
1. **Authentication:** Check admin/moderator role, display "Access Denied" if insufficient
2. **User Management:** List users, search, ban/unban, edit details
3. **Transaction Monitoring:** Display deposits/withdrawals, filter, approve/reject
4. **News Management:** Create, edit, delete crypto news articles
5. **Audit Logs:** Track admin actions, user login history, account changes
6. **Analytics Dashboard:** User growth, trading volume, revenue metrics, CSV export
7. **Subscription Management:** View/edit/delete tiers, manage feature availability
8. **Moderation Tools:** Report management, user warnings, suspensions

#### Dashboard Customization (`dashboard-customizer.js`, 679 lines)

**Purpose:** Dashboard panel customization (resize, drag, show/hide, persistence)

**Features:**
1. **Edit Mode:**
   - Toggle "Edit Layout" button in header
   - Visual outline of panels (dashed border)
   - Indicates customizable panels

2. **Column Resizing:**
   - Draggable gutter between market panel and chart
   - Draggable gutter between chart and trade panel
   - Snap to min (180px) and max (450px) widths

3. **Panel Visibility:**
   - Eye toggle button per trade card
   - Hide/show market panel, trade panel
   - Persists in localStorage

4. **Card Reordering:**
   - Drag handle (⋮) on trade cards
   - Drag-to-reorder functionality
   - Visual feedback on drag-over

5. **State Persistence:**
   - localStorage key: `yamato_dashboard_layout`
   - Saves panel widths, visibility states
   - Loads on page reload

#### Bot Terminal Modules (4 parts)

The `bot-detail.html` (10,698 lines) imports from `js/terminal/`:

**`terminal/init.js` (Initialization & Bootstrap):**
- `init()` — Main bootstrap: syncs trades, fetches data, initializes chart, binds listeners
- `fadeIn()` — Smooth loading screen fade (3s minimum)
- `getSymbol()` — Detect trading symbol from positions
- Event listeners for: symbol selection, timeframe, export CSV, tab switches

**`terminal/data.js` (Data Fetching & Management):**
- `fetchBotDetails()` — Load bot configuration
- `fetchTrades()` — Load trade history with pagination
- `fetchCurrentUser()` — Load user info
- `fetchLiveData()` — Real-time bot position updates
- `fetchKlines(symbol, timeframe)` — Load candlestick data from Binance
- `fetchBotStats(period)` — Aggregated bot statistics
- `fetchTradeMarkers()` — Entry/exit markers for chart
- `fetchTelegramStatus()`, `fetchNotificationSettings()`
- `syncTrades()` — Sync trade log with server

**`terminal/controls.js` (UI Controls & Interactions):**
- `toggleSymbolDropdown()` — Show/hide symbol selector
- `selectSymbol(symbol)` — Change trading symbol
- `setPeriod(days)` — Switch chart timeframe (1/7/30/365 days)
- `applyPeriod()` — Apply period and reload chart
- `exportCSV()` — Export trade history as CSV
- Event bindings for period pills, symbol buttons, modals

**`terminal/renderers.js` (Rendering & Display):**
- `renderTrades()` — Render trade history table
- `renderStats()` — Display bot statistics
- `renderChart()` — Initialize KlineCharts
- `renderLiveData()` — Update live position display
- `updateTradeMarkers()` — Add entry/exit markers to chart
- Color coding: green for profit, red for loss

---

## 4. CSS Loading Order (Critical for Precedence)

Every app page loads CSS in this order:

1. **`css/variables.css`** — Design tokens, `:root` variables, `* { box-sizing... }`
2. **`css/shared-layout.css`** — Sidebar, header, grid layout
3. **`css/scrollbar.css`** — Custom scrollbar styles
4. **`css/mobile.css`** (media="(max-width: 768px)") — Mobile breakpoint
5. **`css/responsive.css`** — Overflow/scroll logic
6. **`css/bot-terminal.css`** (if bot-detail page) — Bot terminal styles
7. **Page-specific `<style>` block** — Inline in HTML

---

## 5. Key UI Components & Patterns

### Navigation Pattern
- **Desktop:** 70px sidebar with icon-only nav items (70px wide, 40x40px buttons)
- **Mobile:** Bottom nav bar with 5 main items, sticky header
- **Active state:** Green (#10B981) background + white text
- **Hover state:** Surface-secondary background

### Card Component
- Class: `.card`
- Background: `var(--surface)`
- Border-radius: `var(--radius-lg)` (24px)
- Padding: 16px
- Shadow: `var(--shadow-card)`
- Border: 1px solid rgba(255,255,255,0.05)

### Grid Layout (Dashboard)
- Dynamic columns: sidebar | market panel | chart | trade panel
- Gap: 12px
- Header: 60px fixed height
- Responsive: Grid columns collapse at smaller breakpoints

### Form Pattern
- Text inputs: border 1px solid rgba(255,255,255,0.1), border-radius 8px
- Buttons: green background (#10B981) for primary, outlined for secondary
- Error states: red border, error message below field
- Validation: client-side via JS, server-side via API

### Modal Pattern
- Overlay with semi-transparent backdrop
- Centered card with max-width (e.g., 600px)
- Close button (×) in top-right
- Dismiss on backdrop click or Escape key
- Animated in/out: opacity 0→1, scale 0.9→1

---

## 6. Responsive Breakpoints

| Device | Breakpoint | Layout | Navigation |
|--------|-----------|--------|------------|
| Desktop | ≥769px | Sidebar visible, multi-column grid | Left sidebar (70px) |
| Tablet/Mobile | ≤768px | Single column, full-width content | Bottom nav bar (60px) |

**Key Mobile Changes:**
- Sidebar hidden entirely
- Grid switches to single-column
- Bottom nav replaces left sidebar
- Header becomes sticky (top: 0)
- Content scrollable: `overflow: auto !important;`
- Safe-area padding for notches/home indicators

---

## 7. Real-Time Communication

### Socket.IO Events (from `app.js`)
- **`priceUpdate`** — Market price updates (every 1-2s)
- **`orderFilled`** — Order execution notification
- **`holdingsUpdate`** — Asset holdings update
- **`balanceUpdate`** — Wallet balance update
- **`botStatusUpdate`** — Bot state change (started/stopped)
- **`tradeUpdate`** — New trade executed by bot

### Direct Binance WebSocket (from chart widget)
- Real-time candlestick data (1m, 5m, 1h, 1d)
- Order book updates (for advanced charts)
- Direct connection from browser (not proxied)
- Intentional: Performance over centralized control

---

## 8. Interactive Features

### Dashboard Customization (`dashboard-customizer.js`)
- **Edit mode toggle:** Button in header
- **Column resizing:** Drag gutter between panels
- **Panel visibility:** Eye toggle on cards
- **Card reordering:** Drag handle to reorder
- **State persistence:** localStorage saves layout

### Bot Terminal (bot-detail.html + terminal/*.js)
- **Symbol selection:** Dropdown to select trading pair
- **Timeframe selection:** Pills for 1m, 5m, 1h, 1d
- **Trade log:** Real-time trade execution display
- **Chart interaction:** Zoom, pan, crosshair
- **Export CSV:** Download trade history

### Admin Panel (admin.js)
- **Pagination:** Navigate large result sets
- **Search/filter:** Find users, transactions, news
- **Bulk actions:** Select multiple, apply action
- **Data export:** Download analytics to CSV

---

## 9. Performance Optimizations

### CSS
- **Variables.css first:** Single source of truth (fast lookups)
- **Shared-layout.css:** Reused across pages (DRY)
- **Media query in link:** Mobile CSS only loaded on small screens
- **No critical rendering blocker:** CSS in `<head>` but non-blocking

### JavaScript
- **Vanilla JS (no heavy framework):** Fast parsing
- **Module imports:** Code split across files
- **Event delegation:** Reduces listener count
- **localStorage:** Instant layout restore without API call

### HTML
- **Large files split into sections:** Easy to parse
- **Inline styles for dynamic content:** Reduced CSS overhead
- **Lazy-loaded images:** Deferred loading in some pages

---

## 10. Accessibility & Internationalization

### Language
- All pages: `lang="uk"` (Ukrainian)
- All content: Fully in Ukrainian
- RTL support: Not implemented (future consideration)

### Accessibility
- ARIA labels: Limited (could be enhanced)
- Semantic HTML: Some use of `<button>`, `<nav>`, `<header>`
- Keyboard navigation: Partial support
- Color contrast: Good (light text on dark backgrounds)

---

## 11. Mobile Optimizations

### Touch Interactions
- Button tap targets: ≥40x40px
- Modal scaling: Fits screen width
- Chart responsiveness: Adjusts to viewport
- Bottom nav safe area: Padding for notches/home indicators

### Responsive Design
- Fluid typography: em/rem-based sizing
- Flexible layouts: Flexbox + CSS Grid
- Viewport meta tag: `width=device-width, initial-scale=1.0`
- Touch-friendly: Larger buttons, spacing

---

## 12. Key Observations & Notes

1. **bot-detail.html Size:** 10,698 lines makes it one of the largest files in the codebase. Could benefit from further componentization.

2. **Mobile Bot Terminal:** Currently desktop-only. Mobile users cannot access full bot management (bot-detail.html is not mobile-optimized).

3. **Monolithic vs. Component:** Vanilla HTML/CSS/JS approach is lightweight but less scalable than a component framework. Each feature adds lines to existing files.

4. **Accessibility:** While visually polished, some a11y features (ARIA labels, semantic HTML) could be enhanced for screen readers.

5. **Code Duplication:** Some UI patterns (modals, tables, filters) repeated across pages rather than as reusable components.

6. **Direct Binance WebSocket:** Browser connects directly to Binance (not proxied). Intentional for performance; API key security is frontend-managed.

7. **CSS-in-JS:** `dashboard-customizer.js` injects styles dynamically for edit-mode UI. Works but could use a CSS-in-JS library for cleaner code.

---

## 13. Integration Points

### With Backend (server/)
- All API calls to `/api/*` endpoints
- Authentication via `connect.sid` cookie
- Socket.IO namespace for real-time events
- File uploads for avatars/documents

### With External Services
- **Binance:** Direct WebSocket for market data
- **Google Fonts:** Plus Jakarta Sans, Material Symbols fonts
- **Socket.IO:** Real-time bidirectional communication

### With React Charting Widget (_src/)
- Compiled output: `/js/chart/chart.js`
- Loaded via `<script src="/js/chart/chart.js"></script>`
- KlineCharts library + custom Binance datafeed
- Communication via `window.chartInstance` or custom events

---

## File Reference Summary

| Category | File | Lines | Purpose |
|----------|------|-------|---------|
| **Design System** | `css/variables.css` | 46 | CSS design tokens |
| **Layout** | `css/shared-layout.css` | 408 | Sidebar + grid layout |
| **Responsive** | `css/mobile.css` | 628 | Mobile breakpoint styles |
| **Auth/Global** | `js/app.js` | 2,594 | Global init, toast, auth |
| **Admin** | `js/admin.js` | 2,846 | Admin panel controller |
| **Trading** | `js/dashboard.js` | 385 | Real-time dashboard |
| **Customization** | `js/dashboard-customizer.js` | 679 | Layout customization |
| **Main Terminal** | `page/bot-detail.html` | 10,698 | Bot trading terminal (LARGEST!) |
| **Profile** | `page/profile.html` | 2,430 | User settings (2nd largest) |
| **Login** | `page/reglogin.html` | 1,252 | Auth forms |

---

**Investigation completed (Frontend):** 2026-03-02
**Analyst:** Auto-Claude Agent
**Subtask ID:** subtask-1-2
