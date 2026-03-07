<div align="center">

# YAMATO TRADING PLATFORM

### *Smart Crypto Trading. Automated. Secured. Beautiful.*

[![Status](https://img.shields.io/badge/Status-Beta-10B981?style=for-the-badge&labelColor=141414)](https://github.com)
[![Stack](https://img.shields.io/badge/Stack-Node.js_+_Express-333?style=for-the-badge&logo=node.js&logoColor=10B981&labelColor=141414)](https://github.com)
[![DB](https://img.shields.io/badge/Database-SQLite-333?style=for-the-badge&logo=sqlite&logoColor=8CA8FF&labelColor=141414)](https://github.com)
[![Frontend](https://img.shields.io/badge/Frontend-Vanilla_JS_+_React-333?style=for-the-badge&logo=react&logoColor=61DAFB&labelColor=141414)](https://github.com)
[![Deploy](https://img.shields.io/badge/Deploy-PM2_on_VPS-333?style=for-the-badge&logo=pm2&logoColor=10B981&labelColor=141414)](https://github.com)

---

**Crypto trading platform with real-time Binance data,**
**automated trading bots, copy trading, TradingView charts**
**and 6+ authentication methods.**

[Features](#features) | [Architecture](#architecture) | [Setup](#setup) | [API](#api-endpoints) | [Deployment](#deployment)

</div>

---

## Features

### Trading & Market Data
- Real-time cryptocurrency prices via Binance WebSocket
- TradingView-powered interactive charts (React + Vite widget)
- Limit and market orders
- Portfolio tracking with monthly snapshots
- Demo and real account modes

### Trading Bots
- Automated trading bot creation and management
- Bot types: AI BOT, Grid Bot, Neutral Bot
- Per-bot statistics, analytics, and order history
- Copy trading — subscribe to other users' bots
- Bot terminal with live controls (start/stop/configure)
- Per-bot notification and symbol settings

### Authentication (6 methods)
- Email + password (bcrypt)
- WebAuthn / Passkeys
- TOTP 2FA (Google Authenticator)
- Telegram Widget login
- Telegram login code
- Beta access gate

### Security
- Brute force protection (10 attempts / 15 min lockout)
- Rate limiting — Redis-backed with memory fallback (5 req/min auth, 100 req/min API)
- Activity logging (IP, user-agent, country, path, method, status, duration)
- Admin audit log
- Custom error handler with `AppError` class
- HTTPS support with self-signed certificate generation

### Admin Panel
- User management (ban, roles, permissions)
- Bot oversight and statistics
- Activity and audit logs
- Bug report viewer
- News management

### Community & Content
- Telegram channel post integration (auto-fetched and cached)
- News collector (automated exchange news gathering)
- In-app notification system
- Documentation page

### Infrastructure
- Database backups to Google Drive (scheduled, OAuth2)
- Redis caching with automatic in-memory fallback
- Socket.IO for real-time updates
- PM2 process management
- Emergency stop system

---

## Architecture

```
Client (Browser)
  |
  |-- Static HTML/CSS/JS (page/, css/, js/)
  |-- React Chart Widget (js/chart/chart.js, built from _src/)
  |-- Direct Binance WebSocket (chart real-time data)
  |
  v
Express Server (server/server.js)
  |
  |-- Middleware: session, beta gate, auth, rate limiter, activity tracker, error handler
  |-- Routes: auth, market, portfolio, bots, profile, orders, admin, notifications,
  |           subscription, faucet, history, community
  |-- Services: binance, candleCollector, market, email, telegram, notifications,
  |             newsCollector, backup, blockchain
  |
  |-- SQLite (sql.js) -- 32 tables
  |-- Redis (ioredis) -- rate limiting cache (optional, memory fallback)
  |-- Socket.IO -- real-time updates
  |-- File sessions -- server/sessions.json
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js + Express |
| Database | SQLite via sql.js (in-memory, persisted to file) |
| Cache | Redis (ioredis) with memory fallback |
| Sessions | Custom FileSessionStore (file-based) |
| Frontend | Vanilla JS + HTML/CSS |
| Charts | React + TradingView (Vite build) |
| Real-time | Socket.IO + Binance WebSocket |
| Email | Nodemailer |
| Telegram | node-telegram-bot-api |
| Auth | bcryptjs, speakeasy (TOTP), WebAuthn |
| Backups | Google Drive API (googleapis) |
| Process | PM2 (fork mode) |

---

## Setup

### Prerequisites

- Node.js 18+
- Redis (optional, falls back to in-memory)

### Installation

```bash
# Clone the repo
git clone <repo-url>
cd defisit

# Install server dependencies
cd server
npm install
cd ..

# Copy environment config
cp .env.example .env
# Edit .env with your values
```

### Environment Variables

```env
PORT=3000
HTTPS_PORT=3443
HOST=0.0.0.0
NODE_ENV=development
SESSION_SECRET=your-secret-here
DB_PATH=./server/database.sqlite

# Email (SMTP)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=user@example.com
SMTP_PASS=password

# Telegram
TELEGRAM_BOT_TOKEN=your-bot-token
TELEGRAM_ENABLED=true

# SSL (optional)
SSL_KEY_PATH=./certs/key.pem
SSL_CERT_PATH=./certs/cert.pem
```

### Running

```bash
# Development (with nodemon)
npm run dev

# Production
npm start

# Build React chart widget
npm run build
```

---

## Project Structure

```
/
+-- server/                     Backend
|   +-- server.js               Entry point
|   +-- config/index.js         Configuration
|   +-- db/index.js             SQLite init + helpers (32 tables)
|   +-- middleware/              session, auth, beta, maintenance,
|   |                            rateLimiter, rateLimit, activityTracker, errorHandler
|   +-- routes/                  12 route modules
|   +-- services/                9 service modules
|   +-- utils/                   ip, ssl, time, bruteForce, redis
|   +-- socket/index.js         Socket.IO
|   +-- sessions.json           Active sessions
|
+-- page/                       26 HTML pages
+-- css/                        8 CSS files (design tokens, layout, mobile)
+-- js/                         12 JS files (app, dashboard, admin, terminal, tracker, etc.)
+-- _src/                       React chart source (TypeScript, Vite)
+-- chart/                      Old chart source (reference only)
+-- ecosystem.config.js         PM2 config
+-- .env.example                Environment template
+-- deploy.sh                   Deployment script
```

---

## Pages

| URL | File | Description |
|-----|------|-------------|
| `/` | `page/index.html` | Landing page |
| `/login`, `/register` | `page/reglogin.html` | Authentication |
| `/dashboard` | `page/datedos.html` | Main trading dashboard |
| `/portfolio` | `page/portfolio.html` | Portfolio overview |
| `/bots` | `page/bots.html` | Bot list and management |
| `/bot/:id` | `page/bot-detail.html` | Bot terminal (admin, desktop) |
| `/bot-stats/:id` | `page/bot-stats.html` | Bot statistics |
| `/bot-orders/:id` | `page/bot-orders.html` | Bot order history |
| `/bot-dashboard/:id` | `page/dashboards-bot.html` | Individual bot dashboard |
| `/bot-community-stats` | `page/bot-community-stats.html` | Community bot stats |
| `/profile` | `page/profile.html` | User profile & settings |
| `/admin` | `page/admin.html` | Admin panel |
| `/news` | `page/news.html` | News feed |
| `/community` | `page/community.html` | Community & social links |
| `/subscriptions` | `page/subscriptions.html` | Subscription plans |
| `/docs` | `page/docs.html` | Documentation |
| `/emergency` | `page/emergency.html` | Emergency stop |

---

## API Endpoints

### Authentication
```
POST /api/auth/login            Login with email/password
POST /api/auth/register         Register new account
POST /api/auth/logout           Logout
GET  /api/auth/me               Get current user
```

### Market Data
```
GET  /api/market/prices         Get current crypto prices
```

### Bots
```
GET  /api/bots                  List user's bots
GET  /api/bots/:id              Get bot details
POST /api/bots                  Create new bot
```

### Portfolio & Orders
```
GET  /api/portfolio             Get portfolio holdings
GET  /api/orders/*              Order management
```

### Profile
```
GET  /api/profile               Get user profile
POST /api/profile/update        Update profile
```

### Admin
```
GET  /api/admin/users           List all users
GET  /api/admin/*               Admin management endpoints
```

### Community
```
GET  /api/community/tg-posts           Get Telegram channel posts
GET  /api/community/tg-photo/:fileId   Proxy Telegram photos
```

### Other
```
GET  /api/notifications         User notifications
GET  /api/history/*             Historical data
GET  /api/faucet/*              Faucet (demo funds)
GET  /api/subscription/*        Subscription info
```

---

## Database

32 tables organized in groups:

- **User & Auth** (7): users, passkeys, login_attempts, login_codes, password_reset_tokens, email_verification_tokens, permissions/user_permissions
- **Bot Management** (10): bots, bot_trades, bot_stats, bot_subscribers, bot_position_blocks, bot_notification_settings, bot_symbol_settings, bot_categories, bot_analytics, bot_order_history
- **Portfolio & Trading** (5): holdings, orders, transactions, portfolio_snapshots, wallets, payment_methods
- **Content** (3): news, notifications, tg_posts
- **Admin & Logging** (4): activity_log, admin_audit_log, bug_reports, backup_history

---

## Deployment

```bash
# Deploy to VPS
./deploy.sh

# PM2 management
pm2 start ecosystem.config.js
pm2 restart yamato
pm2 logs yamato
```

The app runs in PM2 fork mode, served from `/var/www/defisit` on the VPS.

---

## Design System

- Brand accent: `#10B981` (green)
- Secondary accent: `#8CA8FF` (blue)
- Up/profit: `#10B981` (green)
- Down/loss: `#EF4444` (red)
- Dark theme with CSS custom properties in `css/variables.css`
- Border radii: 32px (xl), 24px (lg), 16px (md)

---

## Community

- [Telegram](https://t.me/+Bf85Gs-LpSUyNmFi)
- [Instagram](https://www.instagram.com/yamato.legends_/)
- [YouTube](https://www.youtube.com/@YamatoLegends1)
- [TikTok](https://www.tiktok.com/@yamatolegends)
