<div align="center">

# ⛩️ YAMATO TRADING PLATFORM

### *Smart Crypto Trading. Automated. Secured. Beautiful.*

[![Status](https://img.shields.io/badge/Status-Beta-10B981?style=for-the-badge&labelColor=141414)](https://github.com)
[![Stack](https://img.shields.io/badge/Stack-Node.js_+_Express-333?style=for-the-badge&logo=node.js&logoColor=10B981&labelColor=141414)](https://github.com)
[![DB](https://img.shields.io/badge/Database-SQLite-333?style=for-the-badge&logo=sqlite&logoColor=8CA8FF&labelColor=141414)](https://github.com)
[![Frontend](https://img.shields.io/badge/Frontend-Vanilla_JS_+_React-333?style=for-the-badge&logo=react&logoColor=61DAFB&labelColor=141414)](https://github.com)
[![Deploy](https://img.shields.io/badge/Deploy-PM2_on_VPS-333?style=for-the-badge&logo=pm2&logoColor=10B981&labelColor=141414)](https://github.com)

---

**Повнофункціональна криптовалютна торгова платформа з реальними даними Binance,**
**системою торгових ботів, copy trading, KLineChart Pro терміналом**
**та 6+ методами автентифікації.**

[Функціонал](#-що-реалізовано) · [Графіки](#-торговий-термінал--графіки) · [Боти](#-торгові-боти) · [Безпека](#-безпека--автентифікація) · [Баг-фікси](#-виправлені-баги) · [Roadmap](#-roadmap)

</div>

---

## 📊 Прогрес розробки

```
╔══════════════════════════════════════════════════════════════╗
║  YAMATO TRADING PLATFORM — Development Status               ║
║  Version: Beta · Stage: Active Development · March 2026      ║
╚══════════════════════════════════════════════════════════════╝
```

| Модуль | Статус | Прогрес | Деталі |
|:-------|:------:|:-------:|:-------|
| Автентифікація (6 методів) | ✅ Done | `██████████` 100% | Email, Passkeys, 2FA, Telegram Widget, Telegram Code, Beta Gate |
| Торговий дашборд | ✅ Done | `██████████` 100% | Графіки, ордербук, ордери, холдинги, кастомізація |
| Торговий термінал (KLineChart) | ✅ Done | `██████████` 100% | Свічки, індикатори, ruler, range stats, маркери |
| Портфоліо | ✅ Done | `██████████` 100% | Баланс, холдинги, алокація, гаманці, перформанс |
| Торгові боти | ✅ Done | `██████████` 100% | Grid, DCA, Arbitrage, Binance API, статистика |
| Copy Trading | ✅ Done | `██████████` 100% | Підписка, copy %, ліміт позиції, Copy Now |
| Адмін-панель | ✅ Done | `██████████` 100% | Юзери, боти, новини, аналітика, DB viewer |
| Telegram-бот | ✅ Done | `██████████` 100% | 5 команд, лінк, нотифікації, login-коди |
| Сповіщення | ✅ Done | `██████████` 100% | In-app + Telegram push |
| Кастомізація дашборду | ✅ Done | `██████████` 100% | Drag, resize, hide/show, layout save |
| Підписки (Free/Pro/Enterprise) | ⚡ 60% | `██████░░░░` 60% | UI + mock checkout, без реальних платежів |
| Реальний акаунт | ⚡ 30% | `███░░░░░░░` 30% | Інфраструктура є, активація "Coming soon" |
| Платіжна система | 🔜 Planned | `░░░░░░░░░░` 0% | Stripe / LiqPay інтеграція |
| OAuth (Google, Apple, Discord) | 🔜 Planned | `░░░░░░░░░░` 0% | UI підготовлено |
| Мобільний додаток | 🔜 Planned | `░░░░░░░░░░` 0% | PWA або native |

---

## ✅ Що реалізовано

### 🔐 Безпека та автентифікація

<details>
<summary><b>6 методів входу + повний захист</b> — натисни щоб розгорнути</summary>

#### Методи автентифікації

| # | Метод | Опис | Статус |
|:-:|:------|:-----|:------:|
| 1 | **Email + Пароль** | Класична реєстрація/логін з валідацією | ✅ |
| 2 | **Passkeys (WebAuthn/FIDO2)** | Відбиток пальця, Face ID, YubiKey, Windows Hello | ✅ |
| 3 | **2FA (TOTP)** | Google Authenticator, Authy + 5 backup-кодів | ✅ |
| 4 | **Telegram Widget** | Вхід через кнопку Telegram Login Widget | ✅ |
| 5 | **Telegram Code** | 6-значний код від бота (дійсний 10 хвилин) | ✅ |
| 6 | **Beta Gate** | Код доступу для закритого бета-тесту | ✅ |

#### Brute-Force захист

```
Максимум спроб:     10 невдалих за 15 хвилин
Блокування:         15 хвилин автоматичне
Прогресивна затримка між спробами:

  Спроба 1 → 1 сек
  Спроба 2 → 2 сек
  Спроба 3 → 4 сек
  Спроба 4 → 8 сек
  Спроба 5 → 16 сек
  Спроба 6+ → 32 сек (cap)

Формула: 2^(attempt-1) секунд, максимум 32
```

#### Сесії та cookies

```
Cookie:            connect.sid
HttpOnly:          ✓ (JavaScript не має доступу)
SameSite:          Lax (CSRF protection)
Max-Age:           7 днів (604,800,000 ms)
Storage:           Custom FileSessionStore → sessions.json
```

#### 2FA деталі

```
Алгоритм:          TOTP (Time-based One-Time Password)
Бібліотека:        speakeasy
Вікно:             ±2 часових вікна (30-секундний drift)
Backup-коди:       5 штук (4 байти hex, uppercase)
Одноразове:        Використаний backup-код видаляється
QR-код:            Генерується з email + issuer "Yamato Trading"
```

#### Додатковий захист

- [x] Rate limiting: **5 req/min** на auth endpoints, **100 req/min** на API
- [x] HTTPS з SSL-сертифікатами
- [x] Helmet.js + Content Security Policy + CORS
- [x] Відновлення паролю (токен на 1 годину, захист від email enumeration)
- [x] Верифікація email (токен на 24 години)
- [x] Система ролей: `admin` / `moderator` / `user`
- [x] Гранулярні дозволи (permissions per user)
- [x] Бан/розбан з причиною
- [x] Activity log (всі дії + IP + User-Agent)
- [x] Admin audit log (окремий журнал дій адмінів)
- [x] Timing-safe HMAC comparison (Telegram auth)
- [x] Bcrypt password hashing (cost factor 10)
- [x] Parameterized SQL queries (injection prevention)

</details>

---

### 📈 Торговий термінал / Графіки

<details>
<summary><b>KLineChart Pro + Lightweight Charts + TradingView</b> — натисни щоб розгорнути</summary>

#### Три графічні движки

| Движок | Де використовується | Опис |
|:-------|:--------------------|:-----|
| **KLineChart Pro** | Bot Terminal (`/bot/:id`) | Повний торговий термінал з індикаторами, drawing tools, ruler |
| **Lightweight Charts** | Dashboard (`/dashboard`) | Швидкий widget для дашборду, React + Vite |
| **TradingView Advanced** | Dashboard (альтернатива) | Swappable з Lightweight Charts через компоненти |

#### Таймфрейми (19 штук)

```
Sub-minute (фіолетовий маркер):
  1s  │  2s  │  5s  │  15s  │  30s

Standard:
  1m  │  3m  │  5m  │  15m  │  30m
  1h  │  2h  │  4h  │  6h   │  12h
  1d  │  3d  │  1w  │  1M
```

#### Sub-minute data flow

```
Як працюють sub-second/sub-minute свічки:

  ┌──────────────┐     WebSocket      ┌──────────────┐
  │   Binance    │ ──── aggTrade ───→ │   Browser    │
  │   Futures    │     (кожен тік)    │  (React)     │
  └──────────────┘                    └──────┬───────┘
                                             │
                                    useKlineBuffer hook
                                             │
                                     Bucket aggregation:
                                     floor(timestamp / tfSec) * tfSec
                                             │
                                    ┌────────▼────────┐
                                    │  OHLCV candle   │
                                    │  (open, high,   │
                                    │   low, close,   │
                                    │   volume)       │
                                    └─────────────────┘

  Для 1s: нативний Binance Futures @kline_1s
  Для 2s-30s: aggTrade → клієнтська агрегація в реальному часі
  Для 1m+: нативний Binance @kline_{interval}
```

#### Автоматична точність ціни

```javascript
price >= 10000  → 2 знаки   (BTC: $67,432.15)
price >= 1000   → 2 знаки   (ETH: $3,421.89)
price >= 100    → 3 знаки   (SOL: $142.531)
price >= 10     → 4 знаки
price >= 1      → 5 знаків
price >= 0.1    → 6 знаків
price >= 0.001  → 7 знаків  (DOGE: $0.1234567)
price < 0.001   → 8 знаків
```

#### Індикатори (Bot Terminal)

| Індикатор | Тип | Опис |
|:----------|:----|:-----|
| **BOLL** (Bollinger Bands) | Overlay | Верхня/нижня стрічки + середня лінія |
| **VOL** (Volume) | Sub-pane | Об'єм торгів |
| **RSI** (Relative Strength Index) | Sub-pane | Індекс відносної сили |
| **MACD** | Sub-pane | Moving Average Convergence Divergence |

#### Ruler Tool (Вимірювач)

```
Функціонал ruler:
  • Прив'язка до координат графіка (chart-snapped)
  • Band tint (тоноване виділення зони)
  • Guide lines (напрямні лінії)
  • No-pan on click (графік не рухається при кліку)
  • Ціна з NaN guard (fallback до kLineData.close)
  • Центрування label через CSS transform
  • Прилипання до crosshair
```

#### Range Stats Tool (Статистика діапазону)

```
Виділяєш діапазон на графіку → отримуєш:
  • Ціновий діапазон (min/max/delta/%)
  • Кількість свічок у виділенні
  • Об'єм торгів за період
  • Кількість угод
  • Draggable popup з результатами
  • Вертикальні маркери періоду на графіку
```

#### Trade Markers (Маркери угод)

```
  BUY markers:
    ▲ Зелений трикутник (#10B981) під свічкою
    Entry: hollow triangle

  SELL markers:
    ▼ Червоний трикутник (#EF4444) над свічкою
    Exit: hollow circle

  Функції:
    • Групування маркерів
    • Click-to-popup (деталі угоди)
    • Count badges (кількість угод у точці)
    • Колір за стороною позиції (long=green, short=red)
    • Автоочищення при зміні символу/таймфрейму
```

#### Кольори графіків

```css
/* Dashboard (Lightweight Charts) */
--candle-up:     #10B981    /* Green */
--candle-down:   #EF4444    /* Red */
--chart-bg:      #141414
--grid-lines:    rgba(255, 255, 255, 0.04)

/* Bot Terminal (KLineChart) */
--candle-up-body:    #2BD9C0
--candle-down-body:  #FF4D4F
--candle-up-border:  #1FA88F
--candle-down-border:#CC3D3F

/* Order Types */
--color-long:     #10B981    /* Long positions */
--color-short:    #EF4444    /* Short positions */
--color-limit:    #8B5CF6    /* Limit orders (purple) */
--color-stop:     #F59E0B    /* Stop orders (amber) */
--color-tp:       #06B6D4    /* Take-profit (cyan) */
--color-canceled:  #6B7280   /* Canceled */
```

#### WebSocket reconnect

```
Auto-reconnect з exponential backoff:
  Max delay: 30 секунд
  Статуси: disconnected → connecting → connected → error
  Reconnect тільки при зміні symbol/timeframe
  WS status dot на графіку (зелений/жовтий/червоний)
```

#### Fullscreen mode

```
Chart → Fullscreen:
  position: fixed, covers viewport
  z-index: 1000
  Toggle: кнопка або ESC
```

#### Watermark

```
"YAMATO" — Orbitron font
font-size: clamp(52px, 7vw, 100px)
opacity: 0.045
letter-spacing: 0.22em
pointer-events: none
```

</details>

---

### 🖥️ Кастомізація дашборду

<details>
<summary><b>Drag & drop, resize, hide/show панелей</b> — натисни щоб розгорнути</summary>

#### Layout система

```
┌──────────────────────────────────────────────────────────┐
│  Header (60px)                                            │
├─────────┬──────────────┬──────────────────┬──────────────┤
│         │              │                  │              │
│  Side-  │   Market     │     Chart        │    Trade     │
│  bar    │   Panel      │     Panel        │    Panel     │
│  (nav)  │  (180-450px) │    (flex: 1fr)   │ (180-450px) │
│         │   resize ↔   │                  │  ↔ resize   │
│         │              │                  │              │
└─────────┴──────────────┴──────────────────┴──────────────┘

Зберігається в localStorage: yamato_dashboard_layout
```

#### Edit Mode функції

| Функція | Опис |
|:--------|:-----|
| **Column Resize** | Перетягування gutters для зміни ширини Market/Trade панелей (180–450px) |
| **Card Drag & Drop** | Перетягування карток в Trade панелі для зміни порядку |
| **Card Height Resize** | Вертикальний resize кожної картки (min 60px) |
| **Card Visibility** | Eye button — показати/сховати кожну картку |
| **Panel Toggle** | Сховати/показати Market або Trade панель повністю |
| **Reset Layout** | Скинути до дефолтного розташування |
| **ESC** | Вихід з edit mode |

#### Trade Panel картки

```
Карти що кастомізуються (data-panel-id):

  ┌─────────────────────────┐
  │ 💰 wallet               │  Баланс акаунту
  ├─────────────────────────┤
  │ 📝 orderForm            │  Buy/Sell форма
  ├─────────────────────────┤
  │ 📊 orderBook            │  Книга ордерів
  ├─────────────────────────┤
  │ 📋 infoPanel            │  Холдинги / Ордери / Історія
  └─────────────────────────┘

  Порядок, висота, видимість — все зберігається
```

#### Анімації

```
Grid transition:     0.25s ease
Gutter highlight:    4px green bar на hover
Drag visual:         opacity 0.4, dashed outline
Drop zone:           solid green outline
Hidden cards:        48px ghost в edit mode
```

</details>

---

### 💹 Торговий дашборд

<details>
<summary><b>Ринки, ордери, холдинги, real-time</b> — натисни щоб розгорнути</summary>

#### Market Panel (ліва панель)

```
Фільтри:
  • Всі       — всі пари, сортовані по 24h change
  • Зростаючі — change >= 0%, сортовані desc
  • Падаючі   — change < 0%, сортовані asc

Пошук (розумний синтаксис):
  "BTC"      → точний символ
  "SOL/BTC"  → SOL з BTC quote
  "/ETH"     → будь-яка пара з ETH quote
  "bitcoin"  → fuzzy пошук по назві монети

Price flash:
  Ціна зеленіє (↑) або червоніє (↓) при оновленні
```

#### Order Form (форма ордерів)

```
Типи ордерів:
  • Market (ринковий) — виконується миттєво по поточній ціні
  • Limit (лімітний)  — виконується при досягненні вказаної ціни

Сторони:
  • Buy (Купити)  — зелена кнопка
  • Sell (Продати) — червона кнопка

Quick Amount кнопки:
  [25%] [50%] [75%] [100%]

  Buy:  (balance × pct) / price
  Sell: (holding.amount × pct)

Доступно:
  Buy mode:  "Доступно: $X.XX"
  Sell mode: "Доступно: X.XXXX SYMBOL"
```

#### Order Book (книга ордерів)

```
┌────────────────────────┐
│  Sell orders (red)     │  3 рядки asks
│  ──────────────────    │
│  ───── spread ─────    │
│  ──────────────────    │
│  Buy orders (green)    │  3 рядки bids
└────────────────────────┘

Реальні дані bid/ask з Binance
```

#### Info Panel (3 таби)

```
[Активи] [Ордери] [Історія]

Активи:    Монета, кількість, USD вартість, PnL ($), PnL (%)
Ордери:    Buy/Sell, символ, ціна × кількість, дата, [×] cancel
Історія:   Індикатор, символ, дата, total, amount @ price

Оновлення:  кожні 15 секунд + Socket.IO events
```

#### Real-time Socket.IO

```
Events:
  priceUpdate    → оновлення цін (кожні 3 сек)
  orderFilled    → ордер виконано
  holdingsUpdate → холдинги змінились
  balanceUpdate  → баланс оновлено
```

#### Account Switcher

```
[Демо ✓] [Реальний 🔒]

Demo:  $10,000 стартовий баланс
Real:  Coming soon (інфраструктура готова)
```

</details>

---

### 🤖 Торгові боти

<details>
<summary><b>Grid, DCA, Arbitrage + Binance Futures + Copy Trading</b> — натисни щоб розгорнути</summary>

#### Типи ботів

| Тип | Стратегія | Опис |
|:----|:----------|:-----|
| **Grid Bot** | Сіткова торгівля | Розставляє ордери сіткою для бокового ринку |
| **DCA Bot** | Dollar Cost Averaging | Усереднює позицію при падінні ціни |
| **Arbitrage Bot** | Арбітраж | Різниця цін між біржами/парами |

#### Binance інтеграція

```
Підключення:
  • Binance API Key + Secret (зашифровані в БД)
  • Тест ключів перед збереженням
  • Futures + Spot підтримка
  • Retry з exponential backoff + jitter

Дані з Binance:
  • Account balance
  • Open positions (symbol, side, entryPrice, markPrice, unrealizedPnL, leverage)
  • Open orders (limit, stop, take-profit)
  • Trade history
  • Income history
  • Klines/candlestick data
```

#### TP / SL / Limit ордери бота

```
Типи ордерів що відслідковуються:

  LIMIT orders:
    symbol, side, price, quantity, status, time
    Колір: #8B5CF6 (purple)

  STOP orders (Stop-Loss):
    symbol, side, stopPrice, quantity, type, status
    Колір: #F59E0B (amber)

  TAKE_PROFIT orders:
    symbol, side, stopPrice, quantity, type, status
    Колір: #06B6D4 (cyan)

Відображення в терміналі:
  • Кольорові toggle кнопки для positions/limits/stops/TP
  • Collapsible groups з count badges
  • Color-coded рядки по типу ордера
```

#### Статистика бота

```
Метрики:
  • Total trades (загальна кількість угод)
  • Winning trades (прибуткові)
  • Losing trades (збиткові)
  • Win Rate % (відсоток виграшних)
  • Total PnL ($) (загальний P&L)
  • Max Drawdown (максимальна просадка)
  • Best trade (найкраща угода)
  • Worst trade (найгірша угода)
  • Average trade duration

Графіки (bot-stats page):
  • Equity curve (крива капіталу)
  • PnL distribution
  • Monthly performance
  • Win rate chart
  • Drawdown analysis
```

#### Copy Trading

```
Функціонал:
  1. Підписка на бота іншого користувача
  2. Налаштування copy percentage (0–100%)
  3. Ліміт максимальної позиції (max_position_size)
  4. "Copy Now" — миттєве копіювання поточної угоди
  5. Ручне додавання угод
  6. Автоматична синхронізація з Binance
```

#### Bot Terminal (admin, desktop only)

```
Компоненти:
  • KLineChart Pro з свічками
  • Панель позицій (PnL bar)
  • Панель ордерів (stats bar з chips)
  • Trade history
  • Panel width resizer
  • Live updates через Socket.IO

Notification settings per bot:
  • New trade alerts
  • Close trade alerts
  • Stop loss triggered
  • Take profit triggered
```

#### Категорії ботів

```
Вбудовані категорії:
  • AI BOT
  • Grid Bot
  • Neutral Bot

Кастомні категорії через адмінку:
  • name, color, icon, sort_order
```

</details>

---

### 💼 Портфоліо

<details>
<summary><b>Баланс, холдинги, гаманці, перформанс</b> — натисни щоб розгорнути</summary>

```
┌─────────────────────────────┬──────────────────────┐
│                             │                      │
│   💰 Wallet Card            │   🔗 Saved Wallets   │
│   Balance: $10,000.00       │   + Add Wallet       │
│   30d Performance: +2.5%    │   BTC: 0x...abc      │
│   [Deposit] [Withdraw]      │   ETH: 0x...def      │
│                             │   SOL: 7K9...xyz      │
├─────────────────────────────┼──────────────────────┤
│                             │                      │
│   📋 Transaction History    │   🍩 Asset Allocation │
│   Filter: All Assets        │   (Donut Chart)      │
│                             │   BTC: 45%           │
│   ↓ Faucet USDT   +$100    │   ETH: 30%           │
│   ↑ Buy BTC       -$500    │   SOL: 15%           │
│   ↓ Sell ETH      +$200    │   Other: 10%         │
│                             │                      │
│                             │   📊 Monthly Perf    │
│                             │   ▅▇▃▆▅█ (6 bars)   │
│                             │                      │
└─────────────────────────────┴──────────────────────┘
```

#### Зовнішні гаманці (Watch-Only)

```
Підтримувані блокчейни:

  Bitcoin (BTC):
    API: blockchain.info
    Формати: 1... (P2PKH), 3... (P2SH), bc1... (SegWit)
    Конвертація: satoshis / 1e8

  Ethereum (ETH):
    RPC: Cloudflare-eth (cloudflare-eth.com)
    Формат: 0x + 40 hex chars
    Конвертація: wei / 1e18

  Solana (SOL):
    RPC: mainnet-beta.solana.com
    Формат: Base58, 32-44 chars
    Конвертація: lamports / 1e9

  Кеш: 5 хвилин TTL
  Fallback: кешоване значення при помилці API
```

#### Faucet (тестові кошти)

```
Ліміт:     $100 USDT на день
Мінімум:   $1 за транзакцію
Валюта:    USDT (demo account only)
Скидання:  кожні 24 години
```

#### Розрахунок P&L

```
currentPrice = real-time від Binance
usdValue     = amount × currentPrice
costBasis    = amount × avgBuyPrice
pnl          = usdValue - costBasis
pnlPercent   = (pnl / costBasis) × 100%

Avg buy price on upsert:
  newAvg = (oldAvg × oldAmount + newPrice × newAmount) / (oldAmount + newAmount)

Dust threshold: DELETE holding when amount <= 0.00000001
```

</details>

---

### 🛡️ Адмін-панель

<details>
<summary><b>Юзери, боти, аналітика, БД, новини</b> — натисни щоб розгорнути</summary>

#### Дашборд статистики

```
Метрики:
  • Total Users / Active (7d) / Banned
  • Total Bots / Active Bots
  • Total Transactions / Volume ($)
  • Recent Registrations (30d)
```

#### Управління користувачами

- Пагінований список (20/сторінка) з пошуком
- Профіль: email, name, phone, balances, role, status
- Операції: Edit, Change Password, Change Role, Ban/Unban, Permissions
- Підписки: Override plan, cancel, manage expiry
- Activity log + Transactions + Bots per user

#### Аналітика

| Модуль | Що показує |
|:-------|:-----------|
| **User Analytics** | Тренди реєстрацій, DAU/WAU/MAU |
| **Bot Funnel** | Воронка: створення → налаштування → активація |
| **Subscription Funnel** | Воронка: Free → Pro → Enterprise конверсія |
| **Trading Volume** | Обсяги торгів по днях/тижнях |
| **Retention** | Когортний аналіз (повернення юзерів) |
| **System Health** | CPU, Memory, Uptime, Response time |
| **CSV Export** | users, bots, transactions, trades (за N днів) |

#### Database Viewer

```
Прямий доступ до БД:
  GET  /api/admin/tables           → список таблиць
  GET  /api/admin/tables/:name/schema → схема
  GET  /api/admin/tables/:name     → дані (paginated)
  POST /api/admin/tables/:name     → створити запис
  PUT  /api/admin/tables/:name/:id → оновити запис
  DELETE /api/admin/tables/:name/:id → видалити запис
```

#### Maintenance Mode

```
POST /api/admin/maintenance
  → enabled: true/false
  → message: "Планове оновлення..."
  → enabledBy: admin email
  → enabledAt: timestamp
```

#### Ролі та доступ

```
admin:      Повний доступ до всього
moderator:  Stats, users list, exports, maintenance
user:       Тільки свої дані
```

</details>

---

### 📱 Telegram-бот

<details>
<summary><b>5 команд, linking, нотифікації, login-коди</b> — натисни щоб розгорнути</summary>

#### Команди

| Команда | Що робить |
|:--------|:----------|
| `/start [code]` | З кодом — прив'язує акаунт. Без коду — інструкція |
| `/status` | Баланс, email, підписка, ім'я |
| `/unlink` | Відв'язати Telegram від акаунту |
| `/help` | Список всіх команд |
| `/verify` | Верифікація телефону (share contact) |

#### Прив'язка акаунту

```
1. User натискає "Link Telegram" в Profile
2. Генерується унікальний код
3. User відкриває бота і пише /start <code>
4. Бот перевіряє код в БД
5. Прив'язує telegram_id + telegram_username
6. Емітить socket event: telegram_linked
7. Створює notification: "Telegram Linked"
```

#### Login-коди

```
1. User обирає "Вхід з кодом" на login page
2. Вводить email
3. POST /api/auth/telegram-login-request
4. Бот надсилає: "🔐 Your login code is: XXXXXX\nValid for 10 minutes."
5. User вводить код
6. POST /api/auth/telegram-login-verify → сесія створена
```

#### Нотифікації

```
sendTelegramNotification(userId, title, message, icon):
  → Перевіряє telegram_verified
  → Формат: "icon **title**\n\nmessage"
  → Markdown parse mode
```

</details>

---

### 💳 Підписки

<details>
<summary><b>Free / Pro ($29) / Enterprise ($99)</b> — натисни щоб розгорнути</summary>

| | Free | Pro | Enterprise |
|:--|:----:|:---:|:----------:|
| **Ціна** | $0 | $29/міс | $99/міс |
| **Річна** | — | $232/рік (-20%) | $792/рік (-20%) |
| **Боти** | 1 | 10 | Безліміт |
| **Пари** | 5 | 50 | Всі |
| **Grid Trading** | ✅ | ✅ | ✅ |
| **DCA** | ❌ | ✅ | ✅ |
| **Martingale** | ❌ | ✅ | ✅ |
| **RSI** | ✅ | ✅ | ✅ |
| **MACD / Bollinger** | ❌ | ✅ | ✅ |
| **Volume Profile** | ❌ | ✅ | ✅ |
| **Custom Indicators** | ❌ | ❌ | ✅ |
| **Telegram Alerts** | ❌ | ✅ | ✅ |
| **Discord Alerts** | ❌ | ❌ | ✅ |
| **AI Optimization** | ❌ | ❌ | ✅ |
| **Priority Support** | ❌ | ❌ | ✅ |

> **Статус:** UI повністю готовий, checkout mock (без реальних платежів)

</details>

---

### 🎨 UI / UX / Design System

<details>
<summary><b>Design tokens, анімації, responsive</b> — натисни щоб розгорнути</summary>

#### Design Tokens

```css
/* Кольори */
--bg-app:             #080808     /* Основний фон */
--surface:            #141414     /* Картки/компоненти */
--surface-secondary:  #1C1C1C     /* Darker surface */

--accent-primary:     #10B981     /* Зелений — бренд */
--accent-blue:        #8CA8FF     /* Синій акцент */

--color-up:           #10B981     /* Bullish (зелений) */
--color-down:         #EF4444     /* Bearish (червоний) */

--text-primary:       #FFFFFF
--text-secondary:     #A1A1A1
--text-tertiary:      #636363

/* Радіуси */
--radius-xl:          32px
--radius-lg:          24px
--radius-md:          16px
--radius-full:        9999px      /* Pills */

/* Тіні */
--shadow-soft:        0 12px 32px rgba(0,0,0,0.4)
--shadow-card:        0 4px 12px rgba(0,0,0,0.2)
```

#### Типографіка

```
Шрифт:            Plus Jakarta Sans (400, 500, 600, 700)
Headings:          700 weight, -1px letter-spacing
Body:              14-15px, 400 weight
Small:             11-12px
Chart watermark:   Orbitron (display font)
```

#### Landing Page — 3D Cube

```
Куб 400×400px:
  • Perspective: 1200px
  • Opacity: 0.15 (subtle background)
  • 6 граней × 16×16 grid = 256 cells per face
  • Символи: X, Y, Z, 0, 1, /, \, #, %, B, T, C
  • 15% highlighted (green #10B981)
  • 40% dim (opacity 0.3)
  • Анімація: 20-секундна ротація по Y-осі
  • Random glitch: 5 клітин змінюються кожні 100ms

Floating elements:
  BTC, ETH, SOL, DOGE — 32px, opacity 0.1
  Float animation: 8s ease-in-out, ±30px vertical
```

#### Loading Screens (3 варіанти)

| Screen | Стиль | Опис |
|:-------|:------|:-----|
| `loading.html` | Pixel 3D Cube | Voxel-куб з random символами, progress bar, density % |
| `loading grafik.html` | Chart Skeleton | Fake chart shell, skeleton candles, shimmer sweep (2.2s), progress 0→82% |
| `loadingdachbot.html` | Generative Canvas | ASCII-генеративна анімація, OHLC візуалізація, glitch на hover, MA overlay |

#### Responsive Breakpoints

```
1400px+:   Desktop (повний layout)
1200px:    Зменшені колонки (240px/260px)
1024px:    Tablet
800px:     Зменшений gap (8px)
768px:     Mobile (single column, customizer hidden)
480px:     Small mobile (account switcher hidden)
```

</details>

---

## 🐛 Виправлені баги

### Графіки та термінал (~30 фіксів)

| Баг | Проблема | Рішення |
|:----|:---------|:--------|
| **Chart не оновлювався** | При зміні символу/інтервалу графік залишався старий | Повна перебудова KLineCharts інстансу при зміні |
| **Старі дані лишались** | При завантаженні нових klines старі дані мигтіли | Очищення графіка перед `applyNewData`, навіть якщо data пустий |
| **Race condition в klines** | `_fetchKlines` мав race condition; timezone був неправильний | Фікс race condition, `scrollToTimestamp` для навігації, timezone → Kyiv |
| **Неправильний символ** | При старті показувався не той символ; не було 1s historical candles | Фікс початкового вибору + 1s candles через Binance Spot REST |
| **CDN URL klinecharts** | `umd.min.js` замість `min.js` | Виправлений URL |
| **Script loading order** | KLineCharts CDN завантажувався занадто пізно | Переміщення `<script>` в `<head>` |
| **Stray brace** | Зайва `}` в WS manager bot-detail.html | Видалена |
| **Double-chart flicker** | На 1m інтервалі мигтіння від подвійного `setData` | Один `setData` після завершення всіх fetch батчів |
| **Stale trade markers** | Race condition при зміні інтервалів | Generation counter для abort stale `loadTradeMarkers` |
| **selectSymbol blocked** | `await` блокував `selectSymbol` | Видалено `await` |
| **changeSymbol lock** | Lock не пропускав зміну символу | Bypass lock в `changeSymbol` |
| **Exit marker direction** | Маркери виходу показували неправильний напрямок | Виправлена `.then` generation check + direction |
| **loadMore broken** | Підвантаження старих даних при скролі не працювало | Фікс пагінації |

### Ruler та Drawing Tools (~7 фіксів)

| Баг | Проблема | Рішення |
|:----|:---------|:--------|
| **Ruler canvas offset** | Ruler не збігався з позицією графіка | `position:relative` на `#chart` container |
| **Ruler dot position** | Точка не на курсорі | `convertToPixel` для точного позиціонування |
| **Ruler label centering** | Використовувався `offsetHeight` (unreliable) | CSS `transform` для центрування |
| **Ruler label above crosshair** | Label з'являвся над crosshair замість по центру | Центрування на crosshair |
| **Ruler price NaN** | NaN коли `kLineData` відсутній | Fallback до `kLineData.close` з NaN guard |
| **Ruler double-event** | Подвійне спрацювання | Фікс event handling |
| **Drawing tool double-click** | Потрібен подвійний клік замість одного | Single-click toggle |

### Markers (~6 фіксів)

| Баг | Проблема | Рішення |
|:----|:---------|:--------|
| **Polygon/circle colors** | Використовувались неправильні color properties | `borderColor` + `borderSize` |
| **Entry = Exit markers** | Виглядали однаково | Entry = hollow triangle, Exit = hollow circle |
| **Circle fill** | Entry мав бути filled, exit — hollow | Виправлено fill + legend |
| **Color by direction** | Колір слідував за order direction замість position side | Колір за position side (long=green, short=red) |
| **No grouping** | Маркери не групувались | Grouping + click-to-popup + count badges |
| **Debug logs** | Console.log в production | Видалені |

### Panel / UI Layout (~5 фіксів)

| Баг | Проблема | Рішення |
|:----|:---------|:--------|
| **Resize handle hidden** | Перекривався контентом | `position:sticky` + `z-index:100` |
| **Position panel resize** | Неправильний `startHeight`, без max-height | Фікс `flex-shrink:0`, correct `startHeight` + max-height |
| **Panel collapse flex** | Flex override ламав collapse | Фікс flex + handle visibility |
| **Resize handle invisible** | Не видно handle | Flex layout на `panel-card`, збільшений grab zone |
| **Trend shadow direction** | Тінь рендерилась вгору | Forced downward з 40px fade strips |

### Автентифікація (~8 фіксів)

| Баг | Проблема | Рішення |
|:----|:---------|:--------|
| **Stale sessions → 500** | `account/info` повертав null для stale сесій | `requireAuth` тепер знищує stale сесії + null-check |
| **Email case sensitivity** | `User@Email.com` ≠ `user@email.com` | Email normalization (toLowerCase) на login + register |
| **Telegram auth hash** | Порожні/null/undefined поля ламали hash | Фільтрація порожніх полів + `timingSafeEqual` |
| **Telegram widget version** | Застарілий script `?22` | Оновлено до `?23` |
| **Telegram ban check** | Login endpoint не перевіряв `is_banned` | Додано `is_banned`, `ban_reason` в SELECT |
| **CSP headers** | Неправильна конфігурація Content Security Policy | Виправлено в одному commit з rate limiter + error handler |
| **Binance 429** | Сервер потрапляв під rate limit Binance | Кешування: serverTime 30s, futures data 8s |
| **Bot-stats redirect** | Кнопка "Back" відправляла non-admins на неправильну сторінку | Redirect → `/bots` для не-адмінів |

### Equity Chart (~2 фікси)

| Баг | Проблема | Рішення |
|:----|:---------|:--------|
| **Shadow fill** | Тінь заповнювала від кривої до низу графіка | Shadow від zero baseline до кривої |
| **VOL indicator** | VOL sub-pane захаращував bot-stats chart | Видалено VOL indicator |

### Range Stats (~1 фікс)

| Баг | Проблема | Рішення |
|:----|:---------|:--------|
| **Multiple issues** | Неправильний candle filter, trade buffer, popup not draggable | Time-based filter, `ivSec` buffer, draggable popup |

---

## 🚀 Що було додано (хронологія)

### Major Features

| Фіча | Опис |
|:------|:-----|
| **KLineChart Pro** | Заміна lightweight-charts → повний торговий термінал з індикаторами та drawing tools |
| **Range Stats Tool** | Виділення діапазону → статистика по ціні, свічках, об'єму, угодах |
| **Ruler Rewrite** | Chart-snapped координати, band tint, guide lines, no-pan on click |
| **Quote Currency Tabs** | BTC/ETH/BNB/SOL пари з Binance в market panel |
| **Smart Search** | BASE/QUOTE синтаксис (SOL/BTC, /ETH) |
| **YAMATO Watermark** | Orbitron font watermark на графіку |
| **Indicator Toolbar** | BOLL, VOL, RSI, MACD + ruler в toolbar |
| **Colored Order Toggles** | Кольорові toggle для positions/limits/stops/TP |
| **Stats Period Markers** | Вертикальні лінії на графіку для виділеного періоду |
| **Custom 502 Page** | Анімована сторінка рестарту |
| **Deploy System** | push.js deploy script з SSH + database backup |

### Security & Infrastructure

| Фіча | Опис |
|:------|:-----|
| **Rate Limiting** | Middleware з Redis + memory fallback, headers |
| **Brute-Force Protection** | Progressive delays, account lockout |
| **Telegram Login Codes** | login_codes table, request/verify endpoints, bot sendLoginCode |
| **Admin Analytics** | DAU/WAU/MAU, registration trends, funnels, retention, health, CSV export |
| **Bots Accordion** | Редизайн з accordion panels, chip cards, ticker pills |

### Testing

| Suite | Файл |
|:------|:-----|
| Auth tests | `server/__tests__/auth.test.js` |
| Order tests | `server/__tests__/orders.test.js` |
| Account switch tests | `server/__tests__/account.test.js` |
| Binance error tests | `server/__tests__/binance.test.js` |
| Integration tests | `server/__tests__/integration.test.js` |

---

## 🗺️ Roadmap

### Q2 2026 — Payment & Real Trading

- [ ] Інтеграція Stripe або LiqPay для оплати підписок
- [ ] Рекурентні платежі (автопродовження)
- [ ] Активація реального акаунту
- [ ] KYC верифікація
- [ ] Депозит / вивід реальних коштів
- [ ] Обмеження фічей по тарифу (ліміти ботів, API calls)

### Q3 2026 — Advanced Trading

- [ ] Limit order execution engine (авто-виконання при досягненні ціни)
- [ ] Stop-Loss / Take-Profit ордери для demo
- [ ] Trailing stop
- [ ] Backtesting стратегій на історичних даних
- [ ] Більше типів ботів (Signal, Momentum, Mean Reversion)
- [ ] Маркетплейс стратегій

### Q4 2026 — Social & Mobile

- [ ] Рейтинг трейдерів (leaderboard)
- [ ] Публічні профілі
- [ ] Коментарі та відгуки на ботів
- [ ] PWA або native мобільний додаток
- [ ] Push-сповіщення
- [ ] OAuth: Google, Apple, Discord

---

## 🏗️ Архітектура

```
                         ┌─────────────────┐
                         │    BINANCE       │
                         │  REST + WebSocket│
                         └────────┬────────┘
                                  │
                ┌─────────────────┼─────────────────┐
                │                 │                  │
          ┌─────▼──────┐  ┌──────▼───────┐  ┌──────▼──────┐
          │  Market     │  │   Candle     │  │   Bot       │
          │  Service    │  │  Collector   │  │  Trading    │
          │  (cache)    │  │  (WS→SQLite) │  │  (futures)  │
          └─────┬──────┘  └──────┬───────┘  └──────┬──────┘
                │                │                  │
   ┌────────────┴────────────────┴──────────────────┴────────────┐
   │                     EXPRESS SERVER                           │
   │                   (server/server.js)                         │
   │                                                              │
   │  ┌─── Routes ──────────────────────────────────────────┐    │
   │  │ auth · market · portfolio · orders · bots · profile  │    │
   │  │ admin · notifications · subscription · faucet        │    │
   │  │ history                                              │    │
   │  └─────────────────────────────────────────────────────┘    │
   │                                                              │
   │  ┌─── Middleware ──────────────────────────────────────┐    │
   │  │ session · auth · beta · maintenance · rate-limit     │    │
   │  │ helmet · cors · error-handler                        │    │
   │  └─────────────────────────────────────────────────────┘    │
   │                                                              │
   │  ┌─── Services ────────────────────────────────────────┐    │
   │  │ binance · candleCollector · market · telegram        │    │
   │  │ notifications · email · blockchain                   │    │
   │  └─────────────────────────────────────────────────────┘    │
   │                                                              │
   ├──────────────────────────────────────────────────────────────┤
   │              SQLite (sql.js) — in-memory + file              │
   │           database.sqlite     candles.sqlite                 │
   └───────────────┬────────────────────┬─────────────────────────┘
                   │                    │
        ┌──────────┼──────────┐         │
        │          │          │         │
   ┌────▼────┐ ┌──▼───┐ ┌───▼────┐ ┌──▼──────┐
   │  HTML   │ │ React│ │ Socket │ │Telegram │
   │  Pages  │ │ Chart│ │  .IO   │ │   Bot   │
   │ (page/) │ │(_src)│ │ (live) │ │ (polling)│
   └─────────┘ └──────┘ └────────┘ └─────────┘
```

---

## 📂 Структура проекту

<details>
<summary><b>Повне дерево файлів</b></summary>

```
defisit/
│
├── server/                          # ═══ BACKEND ═══
│   ├── server.js                    # Entry point, routes, HTTP/HTTPS
│   ├── config/
│   │   └── index.js                 # PORT, HTTPS_PORT, HOST, paths, env
│   ├── db/
│   │   └── index.js                 # SQLite init, dbGet/dbAll/dbRun helpers
│   ├── middleware/
│   │   ├── session.js               # Custom FileSessionStore → sessions.json
│   │   ├── auth.js                  # requireAuth middleware
│   │   ├── beta.js                  # Beta gate (code: 401483)
│   │   ├── maintenance.js           # Maintenance mode toggle
│   │   └── errorHandler.js          # Centralized error handling
│   ├── routes/
│   │   ├── auth.js                  # /api/auth/* (1087 lines)
│   │   ├── market.js                # /api/market/* (97 lines)
│   │   ├── portfolio.js             # /api/portfolio/* (359 lines)
│   │   ├── orders.js                # /api/orders/* (339 lines)
│   │   ├── bots.js                  # /api/bots/* (1357 lines)
│   │   ├── profile.js               # /api/profile/* (262 lines)
│   │   ├── admin.js                 # /api/admin/* (1569 lines)
│   │   ├── notifications.js         # /api/notifications/* (77 lines)
│   │   ├── subscription.js          # /api/subscription/* (85 lines)
│   │   ├── faucet.js                # /api/faucet/* (78 lines)
│   │   └── history.js               # /api/history/* (85 lines)
│   ├── services/
│   │   ├── binance.js               # Binance API (REST, signing, retry)
│   │   ├── candleCollector.js        # WS → 1s candles → SQLite
│   │   ├── market.js                # Price cache
│   │   ├── telegram.js              # Telegram bot (5 commands)
│   │   ├── notifications.js         # In-app notifications
│   │   ├── email.js                 # Nodemailer (verification, reset)
│   │   └── blockchain.js            # ETH/BTC/SOL wallet balances
│   ├── socket/
│   │   └── index.js                 # Socket.IO (priceUpdate every 3s)
│   ├── utils/
│   │   ├── ip.js                    # IP extraction
│   │   ├── ssl.js                   # SSL certificate loading
│   │   └── time.js                  # Time helpers
│   ├── __tests__/                   # Jest test suites
│   │   ├── auth.test.js
│   │   ├── orders.test.js
│   │   ├── account.test.js
│   │   ├── binance.test.js
│   │   └── integration.test.js
│   ├── database.sqlite              # Main database
│   ├── candles.sqlite               # Candle history (6 symbols)
│   └── sessions.json                # Active sessions
│
├── page/                            # ═══ HTML PAGES ═══
│   ├── index.html                   # Landing (3D cube, hero, features)
│   ├── reglogin.html                # Login + Register + Code Login
│   ├── datedos.html                 # Trading dashboard
│   ├── portfolio.html               # Portfolio overview
│   ├── bots.html                    # Bots list (accordion)
│   ├── bot-detail.html              # Bot terminal (KLineChart Pro)
│   ├── bot-stats.html               # Bot statistics & charts
│   ├── profile.html                 # Profile + settings (6 tabs)
│   ├── admin.html                   # Admin panel
│   ├── news.html                    # News feed
│   ├── subscriptions.html           # Pricing (Free/Pro/Enterprise)
│   ├── community.html               # Social links
│   ├── reset-password.html          # Password reset
│   ├── verify-email.html            # Email verification
│   ├── loading.html                 # Loading: Pixel 3D cube
│   ├── loading grafik.html          # Loading: Chart skeleton
│   ├── loadingdachbot.html          # Loading: Generative canvas
│   ├── 403.html                     # Forbidden
│   ├── 404erors.html                # Not found
│   ├── 500.html                     # Server error
│   └── 502.html                     # Bad gateway (animated restart)
│
├── css/                             # ═══ STYLES ═══
│   ├── variables.css                # Design tokens (:root vars)
│   ├── shared-layout.css            # Nav, sidebar, layout
│   ├── mobile.css                   # Mobile navigation
│   ├── responsive.css               # Breakpoints
│   ├── scrollbar.css                # Custom scrollbar
│   ├── nav-fix.css                  # Nav fixes
│   ├── bot-terminal.css             # Bot terminal UI
│   └── bot-terminal-mobile.css      # Terminal mobile
│
├── js/                              # ═══ CLIENT JS ═══
│   ├── app.js                       # Shared init (auth, notifications)
│   ├── dashboard.js                 # Dashboard logic + Socket.IO
│   ├── dashboard-customizer.js      # Drag/resize/hide layout editor
│   ├── admin.js                     # Admin panel logic
│   ├── chart/
│   │   └── chart.js                 # React chart build (DO NOT EDIT)
│   └── terminal/                    # Bot terminal modules
│       ├── init.js
│       ├── controls.js
│       ├── data.js
│       └── renderers.js
│
├── _src/                            # ═══ REACT CHART SOURCE ═══
│   └── src/
│       ├── components/
│       │   ├── ChartWidget.tsx       # Lightweight Charts widget
│       │   ├── TVChartWidget.tsx     # TradingView widget (alternative)
│       │   └── TimeframeSelector.tsx # 19 timeframes, color-coded
│       ├── hooks/
│       │   ├── useBinanceWs.ts       # WebSocket connection manager
│       │   └── useKlineBuffer.ts     # aggTrade → OHLCV aggregation
│       ├── overlays.ts              # Custom trade marker overlay
│       ├── types/
│       │   └── binance.ts            # CandleData, BinanceKlineMsg types
│       └── main.tsx                  # Mount point, global API
│
├── chart/                           # Old chart source (reference)
├── logo.svg                         # Brand logo
├── .env.example                     # Environment variables template
└── README.md                        # ← ви тут
```

</details>

---

## 🗄️ База даних (26 таблиць)

<details>
<summary><b>Повна схема</b></summary>

#### Core

| Таблиця | Ключові поля | Призначення |
|:--------|:-------------|:------------|
| `users` | id, email, password, fullName, demo_balance, real_balance, role, is_banned, totp_secret, telegram_id, avatar | Акаунти |
| `bots` | id, user_id, name, type, pair, investment, profit, is_active, binance_api_key(encrypted), trading_settings(JSON) | Боти |
| `bot_trades` | id, bot_id, symbol, side, type, quantity, price, pnl, pnl_percent, binance_trade_id | Угоди ботів |
| `bot_stats` | id, bot_id, total_trades, winning_trades, losing_trades, total_pnl, max_drawdown | Статистика |
| `bot_subscribers` | id, bot_id, user_id, copy_trades, copy_percentage, max_position_size | Copy trading |
| `bot_categories` | id, name, color, icon, sort_order | Категорії |
| `bot_order_history` | id, bot_id, order_id, symbol, side, type, price, quantity, status | Ордери бота |
| `bot_notification_settings` | user_id, bot_id, notify_new_trade, notify_close_trade, notify_stop_loss | Алерти |

#### Portfolio & Trading

| Таблиця | Ключові поля | Призначення |
|:--------|:-------------|:------------|
| `holdings` | id, user_id, currency, amount, avg_buy_price, account_type | Холдинги |
| `orders` | id, user_id, symbol, side, type, price, amount, filled, status, account_type | Ордери |
| `transactions` | id, user_id, type, currency, amount, usd_value, status, account_type | Транзакції |
| `wallets` | id, user_id, name, address, currency, balance, usd_value | Зовнішні гаманці |
| `portfolio_snapshots` | id, user_id, month, total_value, profit_loss | Місячний перформанс |

#### Auth & Security

| Таблиця | Ключові поля | Призначення |
|:--------|:-------------|:------------|
| `passkeys` | id, user_id, name, credential_id, public_key, device_type, last_used_at | WebAuthn ключі |
| `password_reset_tokens` | id, user_id, token, expires_at, used | Скидання паролю |
| `email_verification_tokens` | id, user_id, token, expires_at, used | Верифікація email |
| `login_codes` | id, user_id, code, expires_at, used_at | Telegram login коди |
| `login_attempts` | id, ip_address, user_email, success, attempt_time | Brute-force tracking |

#### Admin & System

| Таблиця | Ключові поля | Призначення |
|:--------|:-------------|:------------|
| `activity_log` | id, user_id, action, details, ip_address, created_at | Дії користувачів |
| `admin_audit_log` | id, admin_id, action, target_type, target_id, details, ip_address | Дії адмінів |
| `notifications` | id, user_id, type, title, message, icon, is_read | In-app сповіщення |
| `news` | id, title, excerpt, content, category, image_url, is_published, created_by | Новини |
| `payment_methods` | id, user_id, type, card_last_four, expiry_date | Платіжні методи |
| `permissions` | id, name, description | Визначення дозволів |
| `user_permissions` | id, user_id, permission_id, granted_by, granted_at | Надані дозволи |

#### Candle Storage (окрема БД)

| Таблиця | Ключові поля | Призначення |
|:--------|:-------------|:------------|
| `candle_history` | symbol, timestamp, open, high, low, close, volume | 1s свічки (6 символів) |

</details>

---

## 🔌 API Reference (100+ endpoints)

<details>
<summary><b>Повний список API</b></summary>

#### Auth & Security (20 endpoints)

```
POST   /api/auth/register              Реєстрація
POST   /api/auth/login                 Вхід (email + password + optional 2FA)
POST   /api/auth/logout                Вихід
GET    /api/auth/me                    Поточний користувач
GET    /api/auth/ip                    IP клієнта
GET    /api/auth/session               Інфо про сесію
POST   /api/auth/forgot-password       Запит скидання пароля
POST   /api/auth/reset-password        Скидання пароля
GET    /api/auth/verify-email          Верифікація email
POST   /api/auth/resend-verification   Повторна верифікація
POST   /api/account/switch             Переключити demo/real
GET    /api/account/info               Інфо акаунту

POST   /api/auth/telegram              Telegram Widget вхід
POST   /api/auth/telegram-register     Реєстрація через Telegram
GET    /api/auth/telegram-bot-username  Username бота
POST   /api/auth/telegram-login-request  Запит 6-значного коду
POST   /api/auth/telegram-login-verify   Верифікація коду

GET    /api/2fa/status                 Статус 2FA
POST   /api/2fa/setup                  QR-код + secret
POST   /api/2fa/verify                 Активувати 2FA
POST   /api/2fa/disable                Вимкнути 2FA
```

#### Passkeys (7 endpoints)

```
GET    /api/passkeys                   Список passkeys
POST   /api/passkeys/register-options  Challenge для реєстрації
POST   /api/passkeys/register-verify   Зберегти passkey
POST   /api/passkeys/auth-options      Challenge для входу
POST   /api/passkeys/auth-verify       Верифікація + вхід
POST   /api/passkeys/check             Чи є passkeys у юзера
DELETE /api/passkeys/:id               Видалити
```

#### Market (5 endpoints)

```
GET    /api/market/prices              Всі ціни
GET    /api/market/price/:symbol       Ціна пари
GET    /api/market/orderbook/:symbol   Ордербук
GET    /api/market/ticker              24h тікер
GET    /api/market/history/:symbol     Історія свічок
```

#### Portfolio & Trading (13 endpoints)

```
GET    /api/portfolio                  Портфоліо
GET    /api/portfolio/performance      Перформанс
GET    /api/portfolio/allocation       Алокація
GET    /api/wallets                    Гаманці
POST   /api/wallets                    Додати гаманець
DELETE /api/wallets/:id                Видалити
POST   /api/wallets/:id/refresh        Оновити баланс з блокчейну
GET    /api/transactions               Транзакції
POST   /api/orders                     Створити ордер
GET    /api/orders                     Ордери
GET    /api/orders/history             Історія
DELETE /api/orders/:id                 Скасувати
GET    /api/holdings                   Холдинги
```

#### Bots (25+ endpoints)

```
GET    /api/bots                       Список ботів
POST   /api/bots                       Створити
DELETE /api/bots/:id                   Видалити
PATCH  /api/bots/:id/toggle            Увімк/вимк
GET    /api/bots/:id/data              Дані бота
GET    /api/bots/:id/details           Деталі
GET    /api/bots/:id/stats             Статистика
GET    /api/bots/:id/trades            Угоди
GET    /api/bots/:id/orders            Ордери
POST   /api/bots/:id/trades            Додати угоду
POST   /api/bots/:id/resync-trades     Ресинк з Binance
POST   /api/bots/:id/sync-trades       Оновити статуси
GET    /api/bots/:id/klines            Свічки
GET    /api/bots/:id/chart-data        OHLCV дані
GET    /api/bots/:id/trade-markers     Маркери на графіку
GET    /api/bots/:id/symbols           Доступні пари
PATCH  /api/bots/:id/settings          Display settings
PATCH  /api/bots/:id/api-keys          API ключі (encrypted)
PATCH  /api/bots/:id/symbol            Вибір пари
GET    /api/bots/:id/trading-settings  Trading settings
PUT    /api/bots/:id/trading-settings  Оновити settings
GET    /api/bots/:id/notifications     Notification settings
PUT    /api/bots/:id/notifications     Оновити notifications
POST   /api/bots/:id/subscribe         Підписка (copy trading)
DELETE /api/bots/:id/subscribe         Відписка
PATCH  /api/bots/:id/copy-trading      Copy налаштування
POST   /api/bots/:id/copy-now          Копіювати зараз
POST   /api/bots/binance               Тест API ключів
GET    /api/bots/tree                  Tree view
GET    /api/bots/stats                 Загальна статистика
```

#### Profile (10 endpoints)

```
GET    /api/profile                    Профіль
PATCH  /api/profile                    Оновити
GET    /api/profile/payment-methods    Платіжні методи
POST   /api/profile/payment-methods    Додати
DELETE /api/profile/payment-methods/:id Видалити
POST   /api/profile/avatar             Завантажити аватар
GET    /api/profile/avatar             Отримати
DELETE /api/profile/avatar             Видалити
GET    /api/activity                   Activity log
POST   /api/telegram/link              Прив'язати Telegram
POST   /api/telegram/unlink            Відв'язати
GET    /api/telegram/status            Статус
POST   /api/telegram/test              Тестове повідомлення
```

#### Admin (30+ endpoints)

```
GET    /api/admin/stats                Дашборд
GET    /api/admin/users                Список юзерів
GET    /api/admin/users/:id            Деталі
PATCH  /api/admin/users/:id            Редагувати
PATCH  /api/admin/users/:id/password   Зміна пароля
PATCH  /api/admin/users/:id/role       Зміна ролі
POST   /api/admin/users/:id/ban        Бан
POST   /api/admin/users/:id/unban      Розбан
GET    /api/admin/users/:id/permissions Дозволи
POST   /api/admin/users/:id/permissions Додати дозвіл
DELETE /api/admin/users/:id/permissions Видалити дозвіл
POST   /api/admin/users/:id/subscription Override підписки
DELETE /api/admin/users/:id/subscription Скасувати підписку
GET    /api/admin/bots                 Всі боти
PATCH  /api/admin/bots/:id             Редагувати бота
DELETE /api/admin/bots/:id             Видалити бота
CRUD   /api/admin/bot-categories       Категорії ботів
PATCH  /api/admin/bots/:id/category    Assign категорію
GET    /api/admin/news                 Всі новини
POST   /api/admin/news                 Створити
PATCH  /api/admin/news/:id             Редагувати
DELETE /api/admin/news/:id             Видалити
GET    /api/admin/maintenance          Статус maintenance
POST   /api/admin/maintenance          Toggle
GET    /api/admin/telegram-settings    Telegram config
POST   /api/admin/telegram-settings    Оновити config
GET    /api/admin/telegram-users       Linked accounts
GET    /api/admin/transactions         Транзакції
GET    /api/admin/subscriptions        Підписки
GET    /api/admin/audit-logs           Audit log
GET    /api/admin/analytics/users      User analytics
GET    /api/admin/analytics/bots/funnel Bot funnel
GET    /api/admin/analytics/subscriptions/funnel Subscription funnel
GET    /api/admin/analytics/trading/volume Trading volume
GET    /api/admin/analytics/retention  Retention cohorts
GET    /api/admin/analytics/system/health System health
GET    /api/admin/analytics/export     CSV export
CRUD   /api/admin/tables/:name         Direct DB access
```

#### Other

```
GET    /api/notifications              Сповіщення
PUT    /api/notifications/:id/read     Прочитати
PUT    /api/notifications/read-all     Прочитати все
DELETE /api/notifications/:id          Видалити
DELETE /api/notifications              Очистити все
GET    /api/subscription               Поточний план
POST   /api/subscription/checkout      Активувати
POST   /api/subscription/cancel        Скасувати
GET    /api/faucet/status              Faucet статус
POST   /api/faucet/claim              Claim тестових коштів
GET    /api/news                       Публічні новини
GET    /api/news/:id                   Деталі новини
```

</details>

---

## ⚙️ Технології

| Категорія | Stack |
|:----------|:------|
| **Runtime** | Node.js 18+ |
| **Framework** | Express.js |
| **Database** | SQLite via sql.js (in-memory + file persistence) |
| **Realtime** | Socket.IO |
| **Auth** | bcryptjs · express-session · @simplewebauthn |
| **2FA** | speakeasy (TOTP) · qrcode |
| **Market Data** | Binance REST API + WebSocket (Futures + Spot) |
| **Telegram** | node-telegram-bot-api |
| **Email** | Nodemailer |
| **Security** | Helmet · CORS · rate-limiter-flexible · Redis (optional) |
| **Charts** | KLineChart Pro · Lightweight Charts · TradingView (swappable) |
| **Frontend** | Vanilla JS · HTML5 · CSS3 · React 18 + Vite (chart only) |
| **Typography** | Plus Jakarta Sans · Orbitron |
| **Testing** | Jest |
| **Deploy** | PM2 (fork mode) · Custom push.js deploy script |
| **SSL** | Custom certificates |

---

## 🚀 Встановлення

```bash
# Clone
git clone <repository-url>
cd defisit

# Backend dependencies
cd server && npm install

# Start
npm start           # Production
npm run dev         # Development (nodemon auto-reload)

# Build chart widget (optional)
cd ../_src && npm install && npm run build
```

**Open:** `http://localhost:3000`

**Environment:** Copy `.env.example` → `.env` and configure:
```
SESSION_SECRET=your-secret
ADMIN_EMAIL=admin@example.com
TELEGRAM_BOT_TOKEN=your-bot-token
```

---

## 📱 Сторінки

| URL | Файл | Опис |
|:----|:-----|:-----|
| `/` | `page/index.html` | Landing (3D cube, hero, features, ticker) |
| `/login` | `page/reglogin.html` | Вхід (email, passkey, telegram, code) |
| `/register` | `page/reglogin.html` | Реєстрація |
| `/dashboard` | `page/datedos.html` | Торговий дашборд (customizable) |
| `/portfolio` | `page/portfolio.html` | Портфоліо (balance, wallets, allocation) |
| `/bots` | `page/bots.html` | Торгові боти (accordion layout) |
| `/bot/:id` | `page/bot-detail.html` | Бот-термінал (KLineChart, admin only) |
| `/bot-stats/:id` | `page/bot-stats.html` | Статистика бота |
| `/profile` | `page/profile.html` | Профіль (6 tabs) |
| `/admin` | `page/admin.html` | Адмін-панель |
| `/news` | `page/news.html` | Новини |
| `/subscriptions` | `page/subscriptions.html` | Тарифи (Free/Pro/Enterprise) |
| `/community` | `page/community.html` | Соцмережі |
| `/reset-password` | `page/reset-password.html` | Скидання пароля |
| `/verify-email` | `page/verify-email.html` | Верифікація email |

---

## 📊 Статистика проекту

```
Commits:          ~155
Bug fixes:        ~47
Features added:   ~15
Test suites:      5
Codebase audits:  6
API endpoints:    100+
DB tables:        26
Auth methods:     6
Chart timeframes: 19
Chart engines:    3 (KLineChart, Lightweight, TradingView)
Symbols tracked:  6 (BTC, ETH, SOL, ADA, DOGE, DOT)
Pages:            15+
Loading screens:  3
```

---

<div align="center">

### Соціальні мережі

[![Telegram](https://img.shields.io/badge/Telegram-Channel-2CA5E0?style=for-the-badge&logo=telegram&logoColor=white)](https://t.me/+Bf85Gs-LpSUyNmFi)
[![Instagram](https://img.shields.io/badge/Instagram-Follow-E4405F?style=for-the-badge&logo=instagram&logoColor=white)](https://www.instagram.com/yamato.legends_/)
[![YouTube](https://img.shields.io/badge/YouTube-Subscribe-FF0000?style=for-the-badge&logo=youtube&logoColor=white)](https://www.youtube.com/@YamatoLegends1)
[![TikTok](https://img.shields.io/badge/TikTok-Follow-000000?style=for-the-badge&logo=tiktok&logoColor=white)](https://www.tiktok.com/@yamatolegends)

---

**MIT License** · **Yamato Trading Platform Team** · **2024–2026**

*Built with passion for crypto traders*

</div>
