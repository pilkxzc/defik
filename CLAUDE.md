# Yamato Trading Platform — Project Map

## Stack
- **Backend**: Node.js + Express, `server/server.js` is the entry point
- **Database**: SQLite via `sql.js` (in-memory, saved to file) — `server/database.sqlite`
- **Sessions**: Custom `FileSessionStore` → `server/sessions.json`
- **Cache**: Redis (ioredis) with automatic in-memory fallback
- **Frontend**: Vanilla JS + HTML/CSS, one React chart widget built with Vite
- **Deployment**: PM2 (fork mode), served from `/var/www/defisit` on VPS

## File Structure

```
/
├── server/                    ← All backend code
│   ├── server.js              ← Entry point, routes, HTTP/HTTPS
│   ├── config/index.js        ← PORT, HTTPS_PORT, HOST, paths, env vars
│   ├── db/index.js            ← SQLite init, dbGet/dbAll/dbRun helpers (32 tables)
│   ├── middleware/
│   │   ├── session.js         ← FileSessionStore (custom), cookie config
│   │   ├── beta.js            ← Beta gate — checks req.session.betaAccess
│   │   ├── auth.js            ← requireAuth middleware
│   │   ├── maintenance.js     ← Maintenance mode toggle
│   │   ├── errorHandler.js    ← AppError class + global error handler
│   │   ├── rateLimiter.js     ← express-rate-limit based limiters
│   │   ├── rateLimit.js       ← Redis-backed rate limiting + memory fallback
│   │   └── activityTracker.js ← Logs every request to activity_log table
│   ├── routes/
│   │   ├── auth.js            ← /api/auth/* (login, register, logout, me)
│   │   ├── market.js          ← /api/market/*
│   │   ├── portfolio.js       ← /api/portfolio/*
│   │   ├── bots.js            ← /api/bots/*
│   │   ├── profile.js         ← /api/profile/*
│   │   ├── faucet.js          ← /api/faucet/*
│   │   ├── notifications.js   ← /api/notifications/*
│   │   ├── subscription.js    ← /api/subscription/*
│   │   ├── orders.js          ← /api/orders/*
│   │   ├── admin.js           ← /api/admin/*
│   │   ├── history.js         ← /api/history/*
│   │   └── community.js       ← /api/community/* (Telegram posts proxy)
│   ├── services/
│   │   ├── binance.js         ← Binance API client (DO NOT CHANGE fetch logic)
│   │   ├── candleCollector.js ← Fills candles.sqlite from Binance WS
│   │   ├── market.js          ← Market data helpers
│   │   ├── email.js           ← Email sending (nodemailer)
│   │   ├── telegram.js        ← Telegram bot
│   │   ├── notifications.js   ← In-app notifications
│   │   ├── blockchain.js      ← Blockchain utils
│   │   ├── newsCollector.js   ← Auto-collects exchange news on schedule
│   │   └── backup.js          ← Database backups to Google Drive (OAuth2)
│   ├── socket/index.js        ← Socket.IO init
│   ├── utils/
│   │   ├── ip.js              ← IP address utilities
│   │   ├── ssl.js             ← SSL certificate management
│   │   ├── time.js            ← Time/timezone utilities
│   │   ├── bruteForce.js      ← Login attempt tracking + lockout (10 attempts / 15 min)
│   │   └── redis.js           ← Redis client init + memory fallback
│   └── sessions.json          ← Active sessions (managed by FileSessionStore)
│
├── page/                      ← HTML pages (served as static files)
│   ├── index.html             ← Landing page (/)
│   ├── reglogin.html          ← /login and /register
│   ├── datedos.html           ← /dashboard
│   ├── portfolio.html         ← /portfolio
│   ├── bots.html              ← /bots  (large file ~2000+ lines)
│   ├── bot-detail.html        ← /bot/:id (admin only, desktop only)
│   ├── bot-stats.html         ← /bot-stats/:id  (large)
│   ├── bot-orders.html        ← /bot-orders/:id — bot order history
│   ├── bot-community-stats.html ← /bot-community-stats
│   ├── dashboards-bot.html    ← /bot-dashboard/:id — individual bot dashboard
│   ├── profile.html           ← /profile  (large)
│   ├── admin.html             ← /admin
│   ├── news.html              ← /news
│   ├── subscriptions.html     ← /subscriptions
│   ├── community.html         ← /community
│   ├── docs.html              ← /docs — documentation page
│   ├── reset-password.html    ← /reset-password
│   ├── verify-email.html      ← /verify-email
│   ├── emergency.html         ← /emergency — emergency stop
│   ├── 403.html, 404erors.html, 500.html, 502.html
│   ├── loading.html           ← /loadingcube
│   └── loadingdachbot.html    ← /loadingdachbot
│
├── css/
│   ├── variables.css          ← Shared design tokens (:root vars + * reset)
│   ├── shared-layout.css      ← Shared nav/layout (sidebar, mobile nav, etc.)
│   ├── mobile.css             ← Mobile-specific styles
│   ├── responsive.css         ← Breakpoints
│   ├── scrollbar.css          ← Custom scrollbar
│   ├── nav-fix.css            ← Nav fixes
│   ├── bot-terminal.css       ← Bot terminal UI
│   └── bot-terminal-mobile.css
│
├── js/
│   ├── app.js                 ← Shared app init (auth check, notifications)
│   ├── dashboard.js           ← Dashboard page logic
│   ├── dashboard-customizer.js← Dashboard widget drag/resize
│   ├── admin.js               ← Admin panel logic
│   ├── tracker.js             ← Activity/usage tracking
│   ├── bug-reporter.js        ← Client-side bug reporting
│   ├── emergency-stop.js      ← Emergency stop controls
│   ├── chart/chart.js         ← Built React chart widget (Vite output, DO NOT EDIT)
│   └── terminal/              ← Bot terminal split into modules
│       ├── init.js
│       ├── controls.js
│       ├── data.js
│       └── renderers.js
│
├── _src/                      ← React chart source (Vite, builds to js/chart/chart.js)
│   └── src/
│       ├── main.tsx, main.ts  ← Entry points
│       ├── overlays.ts        ← Chart overlays
│       ├── klpro-datafeed.ts  ← KL Pro datafeed
│       ├── components/        ← ChartWidget, TVChartWidget, TimeframeSelector, WsStatusIndicator
│       ├── datafeed/          ← TradingView datafeed (history, realtime, symbology)
│       ├── hooks/             ← useBinanceWs, useKlineBuffer
│       └── types/             ← binance.ts, tradingview.d.ts
│
├── chart/                     ← Old React chart source (kept for reference)
├── ecosystem.config.js        ← PM2 configuration
├── .env.example               ← Environment variable template
├── deploy.sh                  ← Deployment script
└── logo.svg
```

## URL → File Map

| URL | HTML File | Notes |
|-----|-----------|-------|
| `/` | `page/index.html` | Landing page |
| `/login`, `/register` | `page/reglogin.html` | Same file, JS handles tab |
| `/dashboard` | `page/datedos.html` | Main trading dashboard |
| `/portfolio` | `page/portfolio.html` | Portfolio overview |
| `/bots` | `page/bots.html` | Bots list |
| `/bot/:id` | `page/bot-detail.html` | Admin only + desktop only |
| `/bot-stats/:id` | `page/bot-stats.html` | Bot statistics |
| `/bot-orders/:id` | `page/bot-orders.html` | Bot order history |
| `/bot-community-stats` | `page/bot-community-stats.html` | Community bot stats |
| `/bot-dashboard/:id` | `page/dashboards-bot.html` | Individual bot dashboard |
| `/profile` | `page/profile.html` | User profile |
| `/admin` | `page/admin.html` | Admin panel |
| `/news` | `page/news.html` | News |
| `/subscriptions` | `page/subscriptions.html` | Plans/pricing |
| `/community` | `page/community.html` | Community/socials |
| `/docs` | `page/docs.html` | Documentation |
| `/emergency` | `page/emergency.html` | Emergency stop |
| `/reset-password` | `page/reset-password.html` | |
| `/verify-email` | `page/verify-email.html` | |

## API Endpoints

```
# Auth
POST /api/auth/login           → routes/auth.js
POST /api/auth/register        → routes/auth.js
POST /api/auth/logout          → routes/auth.js
GET  /api/auth/me              → routes/auth.js

# Market
GET  /api/market/prices        → routes/market.js

# Bots
GET  /api/bots                 → routes/bots.js
GET  /api/bots/:id             → routes/bots.js
POST /api/bots                 → routes/bots.js

# Portfolio & Orders
GET  /api/portfolio            → routes/portfolio.js
GET  /api/orders/*             → routes/orders.js

# Profile
GET  /api/profile              → routes/profile.js
POST /api/profile/update       → routes/profile.js

# Other
GET  /api/notifications        → routes/notifications.js
GET  /api/admin/*              → routes/admin.js
GET  /api/history/*            → routes/history.js
GET  /api/faucet/*             → routes/faucet.js
GET  /api/subscription/*       → routes/subscription.js

# Community (Telegram integration)
GET  /api/community/tg-posts       → routes/community.js
GET  /api/community/tg-photo/:fileId → routes/community.js
```

## Auth & Session Architecture

- Sessions stored in `server/sessions.json` via custom `FileSessionStore`
- Cookie: `connect.sid`, httpOnly, sameSite=lax, 7-day maxAge
- `req.session.userId` — set on login
- `req.session.betaAccess` — set on login/register; required by betaMiddleware
- **Beta gate** (`middleware/beta.js`) skips these prefixes:
  ```
  /beta, /logo.svg, /css/, /fonts/,
  /login, /register, /verify-email, /reset-password,
  /api/auth/login, /api/auth/register, /api/auth/logout, /api/auth/me
  ```
- `requireAuth` middleware (`middleware/auth.js`) — use on protected API routes
- **Brute force protection**: 10 failed attempts → 15 min lockout (per IP + email)
- **Rate limiting**: 5 req/min on auth endpoints, 100 req/min general API

## Database Schema (32 tables)

**User & Auth:**
- `users` — id, email, password (bcrypt), full_name, balance, demo_balance, real_balance, active_account, role, is_banned, totp_secret, totp_enabled, subscription_plan, telegram_id
- `passkeys` — WebAuthn passkey storage
- `login_attempts` — failed login tracking (brute force protection)
- `login_codes` — login verification codes
- `password_reset_tokens`, `email_verification_tokens`
- `permissions`, `user_permissions` — role-based permissions

**Bot Management:**
- `bots` — id, user_id, name, type, pair, investment, profit, is_active, binance_api_key, binance_api_secret, mode, display_settings, account_type, selected_symbol, trading_settings
- `bot_trades` — trades executed by bots
- `bot_stats` — aggregated per-bot stats
- `bot_subscribers` — users subscribed to a bot
- `bot_position_blocks` — grouped trade positions
- `bot_notification_settings` — notification preferences per bot
- `bot_symbol_settings` — visible symbols per bot
- `bot_categories` — bot categorization (AI BOT, Grid Bot, Neutral Bot)
- `bot_analytics` — bot event tracking
- `bot_order_history` — historical orders per bot

**Portfolio & Trading:**
- `holdings` — current token holdings per user
- `orders` — limit/market orders
- `transactions` — deposit/withdrawal records
- `portfolio_snapshots` — monthly portfolio snapshots
- `wallets` — tracked crypto wallets
- `payment_methods` — payment method storage

**Content:**
- `news` — news articles with categories
- `notifications` — in-app notifications
- `tg_posts` — cached Telegram channel posts

**Admin & Logging:**
- `activity_log` — comprehensive user activity logging (IP, user-agent, country, path, method, status, duration)
- `admin_audit_log` — admin action auditing
- `bug_reports` — user bug reports
- `backup_history` — database backup records

DB helpers in `server/db/index.js`:
- `dbGet(sql, params)` — returns one row or null
- `dbAll(sql, params)` — returns array
- `dbRun(sql, params)` — executes + saves, returns `{ lastInsertRowid }`

## CSS Architecture

Every app page loads (in order):
1. `/css/variables.css` — `:root` design tokens + `* { box-sizing... }`
2. `/css/shared-layout.css` — nav, sidebar, layout
3. `/css/scrollbar.css` — custom scrollbar
4. `/css/mobile.css` — mobile nav
5. Page-specific `<style>` block inline

**Design tokens** (from `variables.css`):
- Colors: `--bg-app`, `--surface`, `--surface-secondary`
- Accent: `--accent-primary` (#10B981 green), `--accent-blue` (#8CA8FF)
- Up/down: `--color-up` (#10B981), `--color-down` (#EF4444)
- Text: `--text-primary`, `--text-secondary` (#A1A1A1), `--text-tertiary` (#636363)
- Radii: `--radius-xl` (32px), `--radius-lg` (24px), `--radius-md` (16px), `--radius-full`
- Shadows: `--shadow-soft`, `--shadow-card`

## Large Files — Read with offset/limit

These files are 1000+ lines, use `offset` + `limit` when reading:
- `page/bots.html` (~2000+ lines) — bot list, create/edit modals, inline JS
- `page/bot-detail.html` — bot detail/terminal
- `page/bot-stats.html` — bot statistics charts
- `page/profile.html` — user profile + settings tabs
- `page/reglogin.html` — login/register forms
- `page/admin.html` — admin panel
- `js/terminal/` — split across 4 files

## React Chart Widget

- **Source**: `_src/` (newer, has TradingView datafeed support)
- **Built output**: `js/chart/chart.js` — DO NOT manually edit
- **Old source**: `chart/` — kept for reference
- **Usage**: Loaded in `page/datedos.html` via `<script src="/js/chart/chart.js">`
- Connects to Binance WebSocket directly from the browser (intentional, do not proxy)

## Background Services

Started in `startServer()` within `server.js`:
- `startCollector()` — candle data collection from Binance WS
- `startBackupSchedule()` — database backups to Google Drive
- `startNewsCollector()` — exchange news auto-collection
- `initTelegramBot()` — Telegram bot initialization
- `initSocket()` — Socket.IO WebSocket server

## Social Links (real, from community.html)
- Telegram: `https://t.me/+Bf85Gs-LpSUyNmFi`
- Instagram: `https://www.instagram.com/yamato.legends_/`
- YouTube: `https://www.youtube.com/@YamatoLegends1`
- TikTok: `https://www.tiktok.com/@yamatolegends`

## Important Rules
- **DO NOT** change Binance WebSocket fetch in `_src/` or `chart/` — it's a deliberate direct connection
- **DO NOT** manually edit `js/chart/chart.js` — it's a Vite build artifact
- **DO NOT** touch the 3D cube animation in `page/index.html` (but you can fix interval/timing bugs)
- Brand accent color is **green #10B981** — never use red `rgba(255, 59, 48, x)` for accent
