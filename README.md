<div align="center">

# YAMATO TRADING PLATFORM

### *Smart Crypto Trading. Automated. Secured. Beautiful.*

[![Status](https://img.shields.io/badge/Status-Beta-10B981?style=for-the-badge&labelColor=141414)](https://github.com)
[![Node.js](https://img.shields.io/badge/Node.js-18+-333?style=for-the-badge&logo=node.js&logoColor=10B981&labelColor=141414)](https://nodejs.org)
[![SQLite](https://img.shields.io/badge/SQLite-sql.js-333?style=for-the-badge&logo=sqlite&logoColor=8CA8FF&labelColor=141414)](https://github.com)
[![Express](https://img.shields.io/badge/Express-4.x-333?style=for-the-badge&logo=express&logoColor=white&labelColor=141414)](https://expressjs.com)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-4.x-333?style=for-the-badge&logo=socket.io&logoColor=white&labelColor=141414)](https://socket.io)
[![PM2](https://img.shields.io/badge/PM2-Production-333?style=for-the-badge&logo=pm2&logoColor=10B981&labelColor=141414)](https://pm2.keymetrics.io)

---

**Full-featured cryptocurrency trading platform with real-time Binance data, automated trading bots, copy trading, TradingView-powered charts, and 6+ authentication methods.**

[Features](#-features) | [Screenshots](#-architecture) | [Quick Start](#-quick-start) | [Project Structure](#-project-structure) | [API Reference](#-api-reference) | [Database](#-database-schema) | [Deployment](#-deployment) | [Community](#-community)

</div>

---

## Overview

Yamato is a self-hosted crypto trading platform that connects to Binance for real-time market data and automated trading. It provides a complete trading experience with portfolio management, customizable bots, advanced charting, and a comprehensive admin panel.

**Key highlights:**
- Real-time data from Binance via WebSocket (spot + futures)
- 3 types of automated trading bots with copy trading
- TradingView-quality interactive charts (React + KLineChart Pro)
- 6 authentication methods including WebAuthn passkeys and Telegram
- Redis-backed rate limiting with brute force protection
- Automated database backups to Google Drive
- Full admin panel with activity logs, audit trail, and permissions system

---

## Features

### Trading & Market Data
- Live cryptocurrency prices via Binance WebSocket streams
- TradingView-powered interactive charts with multiple timeframes
- Limit and market order execution
- Portfolio tracking with monthly snapshots and P&L history
- Demo account (10,000 USDT) and real account modes
- Holdings management with average buy price tracking
- Faucet system for demo funds

### Trading Bots
| Feature | Description |
|---------|-------------|
| **3 Bot Types** | AI BOT, Grid Bot, Neutral Bot |
| **Bot Dashboard** | Individual dashboards per bot with live stats |
| **Copy Trading** | Subscribe to other users' bots with configurable % |
| **Order History** | Complete order log per bot |
| **Position Blocks** | Grouped trade positions with P&L |
| **Analytics** | Event tracking and performance metrics |
| **Notifications** | Configurable alerts per bot (trade, stop-loss, take-profit, daily summary) |
| **Community Stats** | Public bot performance leaderboard |
| **Bot Terminal** | Admin-only desktop terminal with live controls |

### Authentication (6 Methods)
| Method | Technology |
|--------|-----------|
| Email + Password | bcryptjs hashing |
| WebAuthn Passkeys | Biometric / hardware key login |
| TOTP 2FA | Google Authenticator via speakeasy |
| Telegram Widget | OAuth through Telegram |
| Telegram Code | Bot-generated login codes |
| Beta Access Gate | Session-based beta access control |

### Security & Protection
- **Brute force protection** — 10 failed attempts = 15 minute lockout (per IP + email)
- **Rate limiting** — Redis-backed with in-memory fallback
  - Auth endpoints: 5 req/min per IP
  - General API: 100 req/min per user
  - Custom limits for orders and Telegram codes
- **Activity logging** — Every request logged with IP, user-agent, country, path, method, status code, duration
- **Admin audit log** — All admin actions tracked
- **Helmet.js** — Security headers with strict CSP
- **HTTPS** — SSL with self-signed certificate auto-generation
- **Error handling** — Custom `AppError` class with centralized error handler

### Admin Panel
- User management (view, edit, ban/unban, role assignment)
- Granular permissions system (10 default permissions)
- Bot oversight and management
- Activity and audit log viewer
- Bug report management
- News and announcements editor
- System settings

### Content & Community
- Telegram channel integration — auto-fetches and caches channel posts with photos
- News collector — automated exchange news gathering on schedule
- In-app notification system
- Documentation page
- Community page with social links

### Infrastructure
- Automated database backups to Google Drive (OAuth2, scheduled via cron)
- Redis caching with automatic in-memory fallback when unavailable
- Socket.IO for real-time push updates
- Candle data collector from Binance WebSocket
- PM2 process management with graceful shutdown
- Emergency stop system
- Client-side bug reporter with screenshots

---

## Architecture

```
                        +-------------------+
                        |     Browser       |
                        |                   |
                        |  HTML/CSS/JS      |
                        |  React Chart      |---------> Binance WebSocket
                        |  Socket.IO Client |           (direct connection)
                        +--------+----------+
                                 |
                        HTTP / HTTPS / WS
                                 |
                        +--------v----------+
                        |   Express Server  |
                        |   server.js       |
                        +-------------------+
                        |                   |
           +------------+   Middleware      +------------+
           |            |   Pipeline        |            |
           |            +-------------------+            |
           |                                             |
    +------v------+    +----------------+    +-----------v---------+
    |  12 Route   |    |  9 Services    |    |  5 Utilities        |
    |  Modules    |    |                |    |                     |
    |             |    |  binance       |    |  bruteForce         |
    |  auth       |    |  candleCollect |    |  redis              |
    |  market     |    |  market        |    |  ip / ssl / time    |
    |  portfolio  |    |  email         |    +---------------------+
    |  bots       |    |  telegram      |
    |  profile    |    |  notifications |    +---------------------+
    |  orders     |    |  newsCollector |    |  Storage            |
    |  admin      |    |  backup        |    |                     |
    |  faucet     |    |  blockchain    |    |  SQLite (sql.js)    |
    |  history    |    +----------------+    |  Redis (ioredis)    |
    |  notificat. |                          |  File sessions      |
    |  subscript. |    +----------------+    +---------------------+
    |  community  |    |  Socket.IO     |
    +---------+---+    |  Real-time     |
              |        +----------------+
              |
    +---------v---------------------------+
    |  Middleware Pipeline (in order)      |
    |                                     |
    |  1. helmet (security headers)       |
    |  2. cors                            |
    |  3. body parser (20mb limit)        |
    |  4. maintenance mode check          |
    |  5. static file serving             |
    |  6. session (FileSessionStore)      |
    |  7. activity tracker                |
    |  8. beta gate                       |
    |  9. rate limiters                   |
    | 10. route handlers                  |
    | 11. 404 handler                     |
    | 12. error handler                   |
    +-----------------------------------------+
```

### Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Runtime** | Node.js 18+ | Server runtime |
| **Framework** | Express 4.x | HTTP server and routing |
| **Database** | SQLite via sql.js | In-memory DB, persisted to file |
| **Cache** | Redis (ioredis) | Rate limiting, with memory fallback |
| **Sessions** | Custom FileSessionStore | File-based session persistence |
| **Real-time** | Socket.IO 4.x | WebSocket push updates |
| **Charts** | React + TradingView + KLineChart Pro | Interactive trading charts |
| **Market Data** | Binance WebSocket + REST API | Real-time crypto prices |
| **Auth** | bcryptjs / speakeasy / WebAuthn | Multi-method authentication |
| **Email** | Nodemailer | Transactional emails |
| **Telegram** | node-telegram-bot-api | Bot integration & login |
| **Backups** | Google Drive API (googleapis) | Automated DB backups |
| **Scheduling** | node-cron | Scheduled tasks |
| **Security** | Helmet / express-rate-limit / rate-limit-redis | Headers, rate limiting |
| **Process** | PM2 (fork mode) | Production process management |
| **Build** | Vite | React chart widget bundler |
| **Testing** | Jest + Supertest | Unit and integration tests |

---

## Quick Start

### Prerequisites

- **Node.js** 18+
- **Redis** (optional — falls back to in-memory automatically)

### Installation

```bash
# 1. Clone the repository
git clone <repo-url>
cd defisit

# 2. Install server dependencies
cd server && npm install && cd ..

# 3. Install chart widget dependencies (for building)
cd _src && npm install && cd ..

# 4. Configure environment
cp .env.example .env
# Edit .env with your values (see below)

# 5. Build the React chart widget
npm run build

# 6. Start the server
npm start
```

### Environment Variables (.env)

```env
# Server
PORT=3000                              # HTTP port
HTTPS_PORT=3443                        # HTTPS port
HOST=0.0.0.0                           # Bind address
NODE_ENV=development                   # development | production

# Session
SESSION_SECRET=your-session-secret     # Random string for cookie signing

# Database
DB_PATH=./server/database.sqlite       # SQLite file path

# Email (SMTP)
SMTP_HOST=smtp.example.com             # Mail server host
SMTP_PORT=587                          # Mail server port
SMTP_USER=user@example.com             # SMTP username
SMTP_PASS=password                     # SMTP password
SMTP_FROM=noreply@yamato.com           # Sender address

# Telegram Bot
TELEGRAM_BOT_TOKEN=                    # @BotFather token
TELEGRAM_BOT_ENABLED=false             # Enable Telegram integration

# SSL (optional, auto-generates self-signed if missing)
SSL_KEY_PATH=./server/ssl/key.pem      # Private key path
SSL_CERT_PATH=./server/ssl/cert.pem    # Certificate path
```

### NPM Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Build chart widget + start server |
| `npm run dev` | Start with hot-reload (nodemon + vite watch) |
| `npm run build` | Build React chart widget only |
| `npm run local` | Run local utilities |
| `npm run push` | Custom push script |
| `cd server && npm test` | Run Jest tests |

---

## Project Structure

```
/
+-- server/                          All backend code
|   +-- server.js                    Entry point (createApp + startServer)
|   +-- config/index.js              PORT, HTTPS_PORT, HOST, DB_PATH, env vars
|   +-- db/index.js                  SQLite init, 32 tables, dbGet/dbAll/dbRun/dbInsertNoSave
|   |
|   +-- middleware/
|   |   +-- session.js               FileSessionStore + cookie config
|   |   +-- auth.js                  requireAuth middleware
|   |   +-- beta.js                  Beta access gate
|   |   +-- maintenance.js           Maintenance mode toggle
|   |   +-- errorHandler.js          AppError class + centralized error handler
|   |   +-- rateLimiter.js           express-rate-limit (orders, telegram code)
|   |   +-- rateLimit.js             Redis-backed rate limiter + memory fallback
|   |   +-- activityTracker.js       Request logging to activity_log table
|   |
|   +-- routes/                      12 route modules
|   |   +-- auth.js                  /api/auth/* (login, register, logout, me, passkeys, 2FA)
|   |   +-- market.js                /api/market/* (prices, symbols)
|   |   +-- portfolio.js             /api/portfolio/* (holdings, snapshots)
|   |   +-- bots.js                  /api/bots/* (CRUD, subscribers, stats)
|   |   +-- profile.js               /api/profile/* (view, update, avatar)
|   |   +-- orders.js                /api/orders/* (create, cancel, history)
|   |   +-- admin.js                 /api/admin/* (users, bots, logs, settings)
|   |   +-- notifications.js         /api/notifications/* (list, mark read)
|   |   +-- subscription.js          /api/subscription/* (plans, upgrade)
|   |   +-- faucet.js                /api/faucet/* (demo funds)
|   |   +-- history.js               /api/history/* (trade history)
|   |   +-- community.js             /api/community/* (Telegram posts proxy)
|   |
|   +-- services/                    9 service modules
|   |   +-- binance.js               Binance REST + WebSocket client
|   |   +-- candleCollector.js       Candle data collector (Binance WS -> candles.sqlite)
|   |   +-- market.js                Market data helpers + price cache
|   |   +-- email.js                 Email sending via Nodemailer
|   |   +-- telegram.js              Telegram bot (login codes, notifications)
|   |   +-- notifications.js         In-app notification creation
|   |   +-- newsCollector.js         Auto-collects exchange news on schedule
|   |   +-- backup.js                Google Drive backup (OAuth2, cron-scheduled)
|   |   +-- blockchain.js            Blockchain utilities
|   |
|   +-- socket/index.js              Socket.IO initialization + events
|   |
|   +-- utils/
|   |   +-- ip.js                    IP address resolution
|   |   +-- ssl.js                   SSL certificate loading / auto-generation
|   |   +-- time.js                  Timezone / date utilities
|   |   +-- bruteForce.js            Login attempt tracking (10 attempts / 15 min lockout)
|   |   +-- redis.js                 Redis client with auto memory fallback
|   |
|   +-- sessions.json                Active sessions file
|   +-- database.sqlite              SQLite database file
|   +-- package.json                 Server dependencies
|
+-- page/                            26 HTML pages
|   +-- index.html                   Landing page (/) with 3D cube animation
|   +-- reglogin.html                Login / Register (/login, /register)
|   +-- datedos.html                 Trading dashboard (/dashboard)
|   +-- portfolio.html               Portfolio overview (/portfolio)
|   +-- bots.html                    Bot list (/bots) ~2000+ lines
|   +-- bot-detail.html              Bot terminal (/bot/:id) admin + desktop only
|   +-- bot-stats.html               Bot statistics (/bot-stats/:id)
|   +-- bot-orders.html              Bot order history (/bot-orders/:id)
|   +-- dashboards-bot.html          Bot dashboard (/bot-dashboard/:id)
|   +-- bot-community-stats.html     Community stats (/bot-community-stats)
|   +-- profile.html                 User profile (/profile)
|   +-- admin.html                   Admin panel (/admin, /admin/:tab)
|   +-- news.html                    News feed (/news)
|   +-- community.html               Community page (/community)
|   +-- subscriptions.html           Subscription plans (/subscriptions)
|   +-- docs.html                    Documentation (/docs)
|   +-- emergency.html               Emergency stop (/emergency)
|   +-- reset-password.html          Password reset (/reset-password)
|   +-- verify-email.html            Email verification (/verify-email)
|   +-- loading.html                 Loading screen (/loadingcube)
|   +-- loadingdachbot.html          Bot loading screen (/loadingdachbot)
|   +-- 403.html                     Forbidden
|   +-- 404erors.html                Not found
|   +-- 500.html                     Server error
|   +-- 502.html                     Bad gateway
|
+-- css/                             8 stylesheets
|   +-- variables.css                Design tokens (:root CSS custom properties)
|   +-- shared-layout.css            Navigation, sidebar, shared layout
|   +-- mobile.css                   Mobile-specific styles
|   +-- responsive.css               Breakpoint queries
|   +-- scrollbar.css                Custom scrollbar
|   +-- nav-fix.css                  Navigation fixes
|   +-- bot-terminal.css             Bot terminal styles
|   +-- bot-terminal-mobile.css      Bot terminal mobile styles
|
+-- js/                              Frontend JavaScript
|   +-- app.js                       Shared init (auth check, notifications, nav)
|   +-- dashboard.js                 Dashboard page logic
|   +-- dashboard-customizer.js      Widget drag and resize
|   +-- admin.js                     Admin panel logic
|   +-- tracker.js                   Activity / usage tracking
|   +-- bug-reporter.js              Client-side bug reporting with screenshots
|   +-- emergency-stop.js            Emergency stop controls
|   +-- chart/chart.js               React chart widget (Vite build output, DO NOT EDIT)
|   +-- terminal/                    Bot terminal (4 modules)
|       +-- init.js                  Terminal initialization
|       +-- controls.js              Start/stop/configure controls
|       +-- data.js                  Data fetching and processing
|       +-- renderers.js             UI rendering
|
+-- _src/                            React chart source (TypeScript + Vite)
|   +-- src/
|       +-- main.tsx                 React entry point
|       +-- overlays.ts              Chart overlays
|       +-- klpro-datafeed.ts        KLineChart Pro datafeed
|       +-- components/              ChartWidget, TVChartWidget, TimeframeSelector, WsStatusIndicator
|       +-- datafeed/                TradingView datafeed (history, realtime, symbology)
|       +-- hooks/                   useBinanceWs, useKlineBuffer
|       +-- types/                   TypeScript type definitions
|
+-- chart/                           Old chart source (kept for reference)
+-- ecosystem.config.js              PM2 configuration
+-- .env.example                     Environment variable template
+-- deploy.sh                        VPS deployment script
+-- logo.svg                         Brand logo
```

---

## Pages & Routes

| URL | File | Auth | Description |
|-----|------|:----:|-------------|
| `/` | `index.html` | - | Landing page with 3D cube animation |
| `/login` | `reglogin.html` | - | Login form (email, passkey, Telegram) |
| `/register` | `reglogin.html` | - | Registration form |
| `/dashboard` | `datedos.html` | Beta | Main trading dashboard with live charts |
| `/portfolio` | `portfolio.html` | Beta | Portfolio overview, holdings, P&L |
| `/bots` | `bots.html` | Beta | Bot list, create/edit modals |
| `/bot/:id` | `bot-detail.html` | Admin | Bot terminal (desktop only) |
| `/bot-dashboard/:id` | `dashboards-bot.html` | Auth | Individual bot dashboard |
| `/bot-stats/:id` | `bot-stats.html` | Beta | Bot performance statistics |
| `/bot-orders/:id` | `bot-orders.html` | Beta | Bot order history |
| `/bot-community-stats` | `bot-community-stats.html` | Beta | Community bot leaderboard |
| `/profile` | `profile.html` | Beta | User profile and settings |
| `/admin` | `admin.html` | Beta | Admin panel |
| `/admin/:tab` | `admin.html` | Beta | Admin panel with specific tab |
| `/news` | `news.html` | Beta | News feed |
| `/community` | `community.html` | Beta | Community and social links |
| `/subscriptions` | `subscriptions.html` | Beta | Subscription plans |
| `/docs` | `docs.html` | Beta | Platform documentation |
| `/emergency` | `emergency.html` | Beta | Emergency stop system |
| `/reset-password` | `reset-password.html` | - | Password reset flow |
| `/verify-email` | `verify-email.html` | - | Email verification |

> **Auth Legend:** `-` = public, `Beta` = requires beta access, `Auth` = requires login, `Admin` = requires admin role + desktop

---

## API Reference

### Authentication `/api/auth/*`

```http
POST /api/auth/register              # Register with email + password
POST /api/auth/login                  # Login (email/password)
POST /api/auth/logout                 # Logout (clears session)
GET  /api/auth/me                     # Get current authenticated user

# Two-Factor Authentication
POST /api/auth/totp/setup             # Generate TOTP secret + QR code
POST /api/auth/totp/verify            # Verify TOTP code
POST /api/auth/totp/disable           # Disable 2FA

# Passkeys (WebAuthn)
POST /api/auth/passkey/register       # Begin passkey registration
POST /api/auth/passkey/register/verify  # Complete passkey registration
POST /api/auth/passkey/login          # Begin passkey authentication
POST /api/auth/passkey/login/verify   # Complete passkey authentication

# Telegram
POST /api/auth/telegram-login         # Login via Telegram widget
POST /api/auth/telegram-login-request # Request login code via Telegram bot
POST /api/auth/telegram-login-code    # Login with Telegram code

# Password Reset
POST /api/auth/forgot-password        # Request password reset email
POST /api/auth/reset-password         # Reset password with token

# Email Verification
POST /api/auth/verify-email           # Verify email with token
```

### Market Data `/api/market/*`

```http
GET  /api/market/prices               # Current crypto prices (cached)
```

### Trading Bots `/api/bots/*`

```http
GET  /api/bots                        # List user's bots
GET  /api/bots/:id                    # Get bot details
POST /api/bots                        # Create new bot
PUT  /api/bots/:id                    # Update bot settings
DELETE /api/bots/:id                  # Delete bot

# Bot Control
POST /api/bots/:id/start              # Start bot
POST /api/bots/:id/stop               # Stop bot

# Subscribers (Copy Trading)
POST /api/bots/:id/subscribe          # Subscribe to bot
DELETE /api/bots/:id/unsubscribe      # Unsubscribe from bot
```

### Portfolio `/api/portfolio/*`

```http
GET  /api/portfolio                   # Get portfolio holdings and value
```

### Orders `/api/orders/*`

```http
GET  /api/orders                      # List user's orders
POST /api/orders                      # Place new order (market/limit)
DELETE /api/orders/:id                # Cancel order
```

### Profile `/api/profile/*`

```http
GET  /api/profile                     # Get user profile
POST /api/profile/update              # Update profile info
```

### Notifications `/api/notifications/*`

```http
GET  /api/notifications               # Get user notifications
POST /api/notifications/:id/read      # Mark notification as read
```

### Admin `/api/admin/*`

```http
GET  /api/admin/users                 # List all users
PUT  /api/admin/users/:id             # Update user (role, ban, etc.)
GET  /api/admin/activity              # Get activity logs
GET  /api/admin/audit                 # Get admin audit log
GET  /api/admin/bug-reports           # Get bug reports
```

### Community `/api/community/*`

```http
GET  /api/community/tg-posts          # Get cached Telegram channel posts
GET  /api/community/tg-photo/:fileId  # Proxy Telegram photo by file ID
```

### Other Endpoints

```http
GET  /api/subscription/*              # Subscription plans and status
GET  /api/faucet/*                    # Demo faucet (get demo funds)
GET  /api/history/*                   # Trade history data
```

### Rate Limits

| Endpoint | Limit | Scope |
|----------|-------|-------|
| `/api/auth/login` | 5 req/min | Per IP |
| `/api/auth/register` | 5 req/min | Per IP |
| `/api/auth/forgot-password` | 5 req/min | Per IP |
| `/api/auth/reset-password` | 5 req/min | Per IP |
| `/api/auth/telegram-login-request` | 5 req/min | Per IP |
| `/api/orders` | Custom | Per user |
| `/api/*` (all other) | 100 req/min | Per user/IP |

---

## Database Schema

**32 tables** in SQLite, organized by domain:

### User & Authentication (8 tables)

| Table | Key Fields | Purpose |
|-------|-----------|---------|
| `users` | id, email, password, full_name, balance, demo_balance, real_balance, active_account, role, is_banned, totp_secret, totp_enabled, subscription_plan, telegram_id, google_id, avatar, permissions | User accounts |
| `passkeys` | user_id, credential_id, public_key, counter, device_type | WebAuthn credentials |
| `login_attempts` | ip_address, user_email, success, attempt_time | Brute force tracking |
| `login_codes` | user_id, code, expires_at | Telegram login codes |
| `password_reset_tokens` | user_id, token, expires_at, used | Password reset flow |
| `email_verification_tokens` | user_id, token, expires_at, used | Email verification flow |
| `permissions` | name, description | Permission definitions (10 defaults) |
| `user_permissions` | user_id, permission_id, granted_by | Permission assignments |

### Bot Management (10 tables)

| Table | Key Fields | Purpose |
|-------|-----------|---------|
| `bots` | user_id, name, type, pair, investment, profit, is_active, binance_api_key, mode, account_type, selected_symbol, trading_settings, category_id | Bot configurations |
| `bot_trades` | bot_id, symbol, side, type, quantity, price, pnl, pnl_percent, status, binance_trade_id, position_side | Individual trades |
| `bot_stats` | bot_id (unique), total_trades, winning_trades, losing_trades, total_pnl, max_drawdown, best_trade, worst_trade | Aggregated statistics |
| `bot_subscribers` | bot_id, user_id, copy_trades, copy_percentage, max_position_size, user_binance_api_key | Copy trading subscriptions |
| `bot_position_blocks` | bot_id, symbol, side, trade_count, total_qty, avg_entry, avg_exit, total_pnl, is_open | Grouped positions |
| `bot_notification_settings` | user_id, bot_id, notify_new_trade, notify_close_trade, notify_stop_loss, notify_take_profit, notify_daily_summary, notify_method | Per-bot notification config |
| `bot_symbol_settings` | bot_id, symbol, is_visible | Symbol visibility per bot |
| `bot_categories` | name, color, icon, sort_order | Bot categorization |
| `bot_analytics` | user_id, event, bot_id, symbol, meta | Event tracking |
| `bot_order_history` | bot_id, order_id, symbol, side, type, price, stop_price, quantity, status | Order log |

### Portfolio & Trading (6 tables)

| Table | Key Fields | Purpose |
|-------|-----------|---------|
| `holdings` | user_id, currency, amount, avg_buy_price, account_type | Current token holdings |
| `orders` | user_id, symbol, side, type, price, amount, filled, status, account_type | Active and filled orders |
| `transactions` | user_id, type, currency, amount, usd_value, status, account_type | Deposit/withdrawal records |
| `portfolio_snapshots` | user_id, month, total_value, profit_loss | Monthly portfolio snapshots |
| `wallets` | user_id, name, address, currency, balance, usd_value | Tracked crypto wallets |
| `payment_methods` | user_id, type, card_last_four, expiry_date | Saved payment methods |

### Content (3 tables)

| Table | Key Fields | Purpose |
|-------|-----------|---------|
| `news` | title, excerpt, content, category, image_url, is_published, source, external_id | News articles |
| `notifications` | user_id, type, title, message, icon, is_read | In-app notifications |
| `tg_posts` | message_id, channel_id, channel_title, text, photo_file_id | Cached Telegram posts |

### Admin & System (5 tables)

| Table | Key Fields | Purpose |
|-------|-----------|---------|
| `activity_log` | user_id, action, category, ip_address, user_agent, country, path, method, status_code, duration_ms, session_id | Request logging |
| `admin_audit_log` | admin_id, action, target_type, target_id, details, ip_address | Admin action audit |
| `bug_reports` | user_id, description, logs, screenshot_path, video_path, page_url, status | Bug reports |
| `backup_history` | filename, size_bytes, drive_file_id, status, triggered_by | DB backup records |

### DB Helpers (`server/db/index.js`)

```javascript
dbGet(sql, params)           // Returns one row or null
dbAll(sql, params)           // Returns array of rows
dbRun(sql, params)           // Execute + auto-save, returns { lastInsertRowid }
dbInsertNoSave(sql, params)  // Insert without immediate save (batched every 5s)
saveDatabase()               // Debounced save (2s delay, force every 10s)
```

---

## Design System

### Colors

| Token | Value | Usage |
|-------|-------|-------|
| `--accent-primary` | `#10B981` | Brand green, primary accent |
| `--accent-blue` | `#8CA8FF` | Secondary accent |
| `--color-up` | `#10B981` | Profit, positive values |
| `--color-down` | `#EF4444` | Loss, negative values |
| `--bg-app` | Dark | App background |
| `--surface` | Dark | Card/panel backgrounds |
| `--surface-secondary` | Dark | Nested surfaces |
| `--text-primary` | White | Primary text |
| `--text-secondary` | `#A1A1A1` | Secondary text |
| `--text-tertiary` | `#636363` | Muted text |

### Border Radii

| Token | Value |
|-------|-------|
| `--radius-xl` | 32px |
| `--radius-lg` | 24px |
| `--radius-md` | 16px |
| `--radius-full` | 9999px |

### CSS Load Order (every page)

1. `css/variables.css` — Design tokens + global reset
2. `css/shared-layout.css` — Nav, sidebar, layout
3. `css/scrollbar.css` — Custom scrollbar
4. `css/mobile.css` — Mobile navigation
5. Page-specific `<style>` block

### Font

**Plus Jakarta Sans** (400, 600, 700, 800) via Google Fonts

---

## Background Services

The server starts these services automatically on boot:

| Service | Module | Schedule | Description |
|---------|--------|----------|-------------|
| Candle Collector | `services/candleCollector.js` | Continuous | Collects kline data from Binance WebSocket |
| News Collector | `services/newsCollector.js` | Cron-based | Fetches exchange news automatically |
| Backup Schedule | `services/backup.js` | Cron-based | Backs up database to Google Drive |
| Telegram Bot | `services/telegram.js` | On-start | Handles Telegram login codes and notifications |
| Socket.IO | `socket/index.js` | On-start | WebSocket server for real-time updates |

All services gracefully shut down on SIGTERM/SIGINT.

---

## Deployment

### VPS Production Setup

```bash
# 1. Deploy to server
./deploy.sh

# 2. Start with PM2
pm2 start ecosystem.config.js

# 3. Save PM2 process list and enable auto-start
pm2 save && pm2 startup
```

### PM2 Configuration

```javascript
// ecosystem.config.js
{
  name: 'defisit',
  script: 'server/server.js',
  cwd: '/var/www/defisit',
  instances: 1,
  exec_mode: 'fork',
  autorestart: true,
  max_restarts: 10,
  restart_delay: 2000,
  min_uptime: '10s',
  env: {
    NODE_ENV: 'production',
    PORT: 3000,
    HTTPS_PORT: 3443,
    HOST: '0.0.0.0'
  }
}
```

### PM2 Commands

```bash
pm2 start ecosystem.config.js        # Start
pm2 restart defisit                   # Restart
pm2 reload ecosystem.config.js        # Zero-downtime restart
pm2 stop defisit                      # Stop
pm2 logs defisit                      # View logs
pm2 monit                             # Monitor dashboard
```

### Log Files

```
/var/log/defisit/out.log              # stdout
/var/log/defisit/error.log            # stderr
```

### Servers

| Protocol | Port | Notes |
|----------|------|-------|
| HTTP | 3000 | Main server |
| HTTPS | 3443 | SSL (auto-generates self-signed cert if none provided) |

---

## Testing

```bash
cd server
npm test                               # Run all Jest tests
npx jest --verbose                     # Verbose output
npx jest --coverage                    # With coverage report
```

---

## Security Notes

- Passwords hashed with **bcryptjs** (salt rounds = 10)
- Sessions stored in files, not in database — prevents session fixation via DB access
- TOTP secrets stored encrypted in database
- Binance API keys stored per-bot (user responsibility)
- Redis connection is optional — all security features work with memory fallback
- CSP headers restrict script sources, connect sources, and frame sources
- Static HTML files served with `no-cache` headers to prevent stale content
- The `trust proxy` setting is enabled for proper IP resolution behind reverse proxy

---

## Community

<div align="center">

[![Telegram](https://img.shields.io/badge/Telegram-Join-26A5E4?style=for-the-badge&logo=telegram&logoColor=white&labelColor=141414)](https://t.me/+Bf85Gs-LpSUyNmFi)
[![Instagram](https://img.shields.io/badge/Instagram-Follow-E4405F?style=for-the-badge&logo=instagram&logoColor=white&labelColor=141414)](https://www.instagram.com/yamato.legends_/)
[![YouTube](https://img.shields.io/badge/YouTube-Subscribe-FF0000?style=for-the-badge&logo=youtube&logoColor=white&labelColor=141414)](https://www.youtube.com/@YamatoLegends1)
[![TikTok](https://img.shields.io/badge/TikTok-Follow-000000?style=for-the-badge&logo=tiktok&logoColor=white&labelColor=141414)](https://www.tiktok.com/@yamatolegends)

</div>

---

<div align="center">

**Built with discipline. Traded with confidence.**

*Yamato Trading Platform &copy; 2025-2026*

</div>
