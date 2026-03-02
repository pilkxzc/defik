# Yamato Trading Platform

> Сучасна криптовалютна торгова платформа з реальними даними Binance, системою торгових ботів, copy trading та передовими методами автентифікації.

**Stack:** Node.js + Express | SQLite (sql.js) | Vanilla JS + React (Vite) | Socket.IO | PM2

---

## Статус проекту

```
  Версія:     Beta
  Стадія:     Active Development
  Деплой:     VPS (PM2, fork mode)
  Дата:       Березень 2026
```

### Загальний прогрес

| Модуль | Статус | Прогрес |
|--------|--------|---------|
| Автентифікація та безпека | Готово | ██████████ 100% |
| Торговий дашборд | Готово | ██████████ 100% |
| Портфоліо | Готово | ██████████ 100% |
| Торгові боти | Готово | ██████████ 100% |
| Copy Trading | Готово | ██████████ 100% |
| Адмін-панель | Готово | ██████████ 100% |
| Новини | Готово | ██████████ 100% |
| Підписки та тарифи | Частково | ██████░░░░ 60% |
| Реальний акаунт | В розробці | ███░░░░░░░ 30% |
| Платіжна система | Заплановано | ░░░░░░░░░░ 0% |
| Мобільний додаток | Заплановано | ░░░░░░░░░░ 0% |

---

## Що зроблено

### Автентифікація та безпека

- [x] Email + пароль (реєстрація, логін, валідація)
- [x] Passkeys / WebAuthn (відбиток пальця, Face ID, апаратні ключі)
- [x] 2FA через TOTP (Google Authenticator, Authy) + 5 backup-кодів
- [x] Telegram Login Widget (авторизація через Telegram)
- [x] Telegram login-коди (6-значний код в бот)
- [x] Прив'язка Telegram-акаунту до профілю
- [x] Відновлення пароля (email-токен, захист від email enumeration)
- [x] Верифікація email (token-based)
- [x] Brute-force захист (прогресивні затримки, блокування)
- [x] Rate limiting (5 req/min auth, 100 req/min API)
- [x] HTTPS з SSL-сертифікатами
- [x] Helmet.js + CSP + CORS
- [x] HttpOnly secure cookies (7 днів)
- [x] Система ролей: admin / moderator / user
- [x] Гранулярні дозволи (permissions per user)
- [x] Бан/розбан з причиною
- [x] Activity log (всі дії + IP)
- [x] Admin audit log

### Торговий дашборд

- [x] Реальні ціни від Binance API (REST + WebSocket)
- [x] Графіки (React + Vite, Lightweight Charts)
- [x] 1-секундні свічки через WebSocket з агрегацією (5s, 15s, 1m...)
- [x] Ордербук (глибина bid/ask в реальному часі)
- [x] Ticker tape (біжучий рядок з цінами)
- [x] Market + Limit ордери
- [x] Підтримка 6 пар: BTC, ETH, SOL, ADA, DOGE, DOT (USDT)
- [x] Збереження історії свічок (candles.sqlite)
- [x] Backfill з Binance REST API
- [x] Dashboard customizer (drag & resize віджетів)

### Портфоліо

- [x] Demo-акаунт ($10,000 стартових)
- [x] Відображення холдингів з поточною вартістю
- [x] Середня ціна покупки + P&L (реалізований / нереалізований)
- [x] Місячні снепшоти портфоліо
- [x] Розподіл активів (allocation breakdown)
- [x] Зовнішні гаманці (watch-only, оновлення балансу з блокчейну)
- [x] Історія транзакцій з фільтрацією
- [x] Faucet — щоденне нарахування тестових коштів (до $100/день)

### Торгові боти

- [x] Створення ботів (Grid, DCA, Arbitrage)
- [x] Підключення реальних Binance API ключів (шифрування)
- [x] Тест API-ключів перед збереженням
- [x] Futures + Spot торгівля
- [x] Категорії ботів (AI BOT, Grid Bot, Neutral Bot)
- [x] Налаштування торгових параметрів
- [x] Кліне/свічкові дані для кожного бота
- [x] Вибір торгової пари
- [x] Трекінг виконаних угод (Binance trade ID)
- [x] Розрахунок PnL + PnL %
- [x] Синхронізація угод з Binance
- [x] Trade markers на графіках
- [x] Історія ордерів (limit, stop, take-profit)
- [x] Статистика: win rate, max drawdown, best/worst trade
- [x] Per-bot повідомлення (new trade, close, stop loss, take profit)
- [x] Бот-термінал з live-оновленнями (admin, desktop only)

### Copy Trading

- [x] Підписка на бота іншого користувача
- [x] Налаштування copy % (0–100%)
- [x] Ліміт максимальної позиції
- [x] Миттєве копіювання угоди (Copy Now)
- [x] Ручне додавання угод

### Адмін-панель

- [x] Дашборд зі статистикою (юзери, боти, транзакції, revenue)
- [x] Управління користувачами (CRUD, бан, ролі, дозволи)
- [x] Управління ботами (редагування, видалення, категорії)
- [x] Редактор новин (створення, редагування, публікація)
- [x] Аналітика: реєстрації, воронка ботів, воронка підписок
- [x] Аналітика: обсяги торгів, retention когорти, system health
- [x] CSV-експорт аналітики
- [x] Перегляд транзакцій та підписок
- [x] Maintenance mode (вкл/викл сайту)
- [x] Налаштування Telegram-бота
- [x] Пряме редагування БД (table viewer/editor)
- [x] Audit log (всі дії адмінів)

### Telegram-бот

- [x] Команди: `/start`, `/status`, `/unlink`, `/help`, `/verify`
- [x] Прив'язка/відв'язка акаунту
- [x] Надсилання сповіщень
- [x] Login-коди для входу
- [x] Відображення балансу та підписки

### Сповіщення

- [x] In-app сповіщення (bell icon)
- [x] Прочитати / прочитати все
- [x] Видалення / очистити все
- [x] Telegram-сповіщення (якщо прив'язано)

### Інші сторінки

- [x] Landing page (3D-куб анімація, hero section, CTA)
- [x] Новини (стрічка опублікованих статей)
- [x] Підписки (Free / Pro / Enterprise — UI)
- [x] Спільнота (Telegram, Instagram, YouTube, TikTok)
- [x] Сторінки помилок (403, 404, 500, 502)
- [x] Loading screens (анімовані переходи)

---

## В процесі розробки

### Підписки та тарифи

- [x] UI сторінки тарифів (Free / Pro / Enterprise)
- [x] Mock checkout (активація плану)
- [x] Скасування підписки
- [x] Відстеження терміну дії
- [x] Відображення в адмінці
- [ ] Обмеження фічей по тарифу (ліміти ботів, API calls)
- [ ] Автоматичне закінчення підписки
- [ ] Нагадування про закінчення

### Реальний акаунт

- [x] Інфраструктура: dual balance (demo/real), account_type в ордерах/холдингах
- [x] Перемикач у хедері (UI)
- [ ] Активація реального акаунту (зараз "Coming soon")
- [ ] KYC верифікація
- [ ] Депозит / вивід реальних коштів

---

## Заплановано

### Платіжна система

- [ ] Інтеграція Stripe або LiqPay
- [ ] Оплата підписок реальними грошима
- [ ] Рекурентні платежі (автопродовження)
- [ ] Валідація платіжних методів
- [ ] Історія оплат

### Автоматичне виконання ордерів

- [ ] Limit order execution engine (автоматичне виконання при досягненні ціни)
- [ ] Stop-loss / Take-profit ордери
- [ ] Trailing stop

### Розширення ботів

- [ ] Автоматичне виконання торгових стратегій (без ручного втручання)
- [ ] Backtesting стратегій на історичних даних
- [ ] Більше типів ботів (Signal, Momentum, Mean Reversion)
- [ ] Маркетплейс стратегій

### Соціальні функції

- [ ] Рейтинг трейдерів (leaderboard)
- [ ] Публічні профілі
- [ ] Коментарі та відгуки на ботів
- [ ] Система репутації

### Mobile

- [ ] PWA або нативний мобільний додаток
- [ ] Push-сповіщення
- [ ] Мобільна торгівля

### OAuth провайдери

- [ ] Google OAuth
- [ ] Apple Sign In
- [ ] Discord OAuth
- [ ] (UI підготовлено, бекенд не реалізовано)

---

## Архітектура

```
                      ┌──────────────┐
                      │   Binance    │
                      │  REST + WS   │
                      └──────┬───────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
        ┌─────▼─────┐ ┌─────▼─────┐ ┌─────▼─────┐
        │  Market    │ │  Candle   │ │  Bot      │
        │  Service   │ │ Collector │ │  Trading  │
        └─────┬─────┘ └─────┬─────┘ └─────┬─────┘
              │              │              │
        ┌─────▼──────────────▼──────────────▼─────┐
        │            Express Server               │
        │         (server/server.js)               │
        │                                          │
        │  Routes:  auth | market | portfolio      │
        │           bots | orders | profile        │
        │           admin | notifications          │
        │           faucet | subscription           │
        │           history                        │
        │                                          │
        │  Middleware: session | auth | beta        │
        │              maintenance | rate-limit     │
        ├──────────────────────────────────────────┤
        │          SQLite (sql.js)                 │
        │    database.sqlite + candles.sqlite      │
        └─────────────────┬────────────────────────┘
                          │
              ┌───────────┼───────────┐
              │           │           │
        ┌─────▼───┐ ┌────▼────┐ ┌────▼────┐
        │  HTML   │ │  React  │ │ Socket  │
        │  Pages  │ │  Chart  │ │   .IO   │
        │ (page/) │ │ (_src/) │ │ (live)  │
        └─────────┘ └─────────┘ └─────────┘
```

### Структура файлів

```
defisit/
├── server/                     # Backend
│   ├── server.js               # Entry point, маршрутизація, HTTP/HTTPS
│   ├── config/index.js         # Конфігурація (порти, шляхи, env)
│   ├── db/index.js             # SQLite init, хелпери (dbGet/dbAll/dbRun)
│   ├── middleware/
│   │   ├── session.js          # FileSessionStore, cookies
│   │   ├── auth.js             # requireAuth
│   │   ├── beta.js             # Beta gate
│   │   └── maintenance.js      # Maintenance mode
│   ├── routes/
│   │   ├── auth.js             # /api/auth/* (login, register, 2FA, passkeys, telegram)
│   │   ├── market.js           # /api/market/* (prices, orderbook, ticker)
│   │   ├── portfolio.js        # /api/portfolio/*, /api/wallets, /api/transactions
│   │   ├── orders.js           # /api/orders/*, /api/holdings
│   │   ├── bots.js             # /api/bots/* (CRUD, trading, copy, stats)
│   │   ├── profile.js          # /api/profile/*, /api/telegram/*
│   │   ├── admin.js            # /api/admin/* (users, bots, news, analytics, DB)
│   │   ├── notifications.js    # /api/notifications/*
│   │   ├── subscription.js     # /api/subscription/*
│   │   ├── faucet.js           # /api/faucet/*
│   │   └── history.js          # /api/market/history/*
│   ├── services/
│   │   ├── binance.js          # Binance API (REST, підпис, retry)
│   │   ├── candleCollector.js  # WS → 1s свічки → БД
│   │   ├── market.js           # Кеш цін
│   │   ├── telegram.js         # Telegram-бот
│   │   ├── notifications.js    # In-app сповіщення
│   │   ├── email.js            # Nodemailer (verification, reset)
│   │   └── blockchain.js       # Баланси гаманців
│   ├── socket/index.js         # Socket.IO
│   └── sessions.json           # Активні сесії
│
├── page/                       # HTML сторінки
│   ├── index.html              # Landing (/)
│   ├── reglogin.html           # Login + Register
│   ├── datedos.html            # Dashboard
│   ├── portfolio.html          # Portfolio
│   ├── bots.html               # Bots list
│   ├── bot-detail.html         # Bot terminal (admin)
│   ├── bot-stats.html          # Bot statistics
│   ├── profile.html            # Profile + settings
│   ├── admin.html              # Admin panel
│   ├── news.html               # News
│   ├── subscriptions.html      # Pricing plans
│   ├── community.html          # Social links
│   └── ...                     # Error pages, loading screens
│
├── css/                        # Стилі
│   ├── variables.css           # Design tokens (:root)
│   ├── shared-layout.css       # Навігація, sidebar
│   ├── mobile.css              # Mobile nav
│   ├── responsive.css          # Breakpoints
│   └── ...
│
├── js/                         # Client-side JS
│   ├── app.js                  # Shared init (auth, notifications)
│   ├── dashboard.js            # Dashboard logic
│   ├── dashboard-customizer.js # Widget drag/resize
│   ├── chart/chart.js          # React chart build (DO NOT EDIT)
│   └── terminal/               # Bot terminal modules
│
├── _src/                       # React chart source (Vite)
│   └── src/
│       ├── components/         # ChartWidget, TVChartWidget
│       └── datafeed/           # TradingView datafeed
│
└── logo.svg
```

---

## База даних

### Основні таблиці

| Таблиця | Призначення | Записів* |
|---------|------------|---------|
| `users` | Акаунти користувачів | — |
| `bots` | Торгові боти | — |
| `bot_trades` | Виконані угоди ботів | — |
| `bot_stats` | Агрегована статистика | — |
| `bot_subscribers` | Copy trading підписки | — |
| `bot_categories` | Категорії ботів | — |
| `bot_order_history` | Історія ордерів бота | — |
| `bot_notification_settings` | Налаштування алертів | — |
| `holdings` | Холдинги користувачів | — |
| `orders` | Ордери (market/limit) | — |
| `transactions` | Транзакції (deposit/withdraw) | — |
| `wallets` | Зовнішні гаманці | — |
| `portfolio_snapshots` | Місячні снепшоти | — |
| `passkeys` | WebAuthn ключі | — |
| `password_reset_tokens` | Токени скидання паролю | — |
| `email_verification_tokens` | Токени верифікації | — |
| `login_codes` | Telegram login-коди | — |
| `login_attempts` | Спроби входу (brute-force) | — |
| `notifications` | In-app сповіщення | — |
| `news` | Статті новин | — |
| `payment_methods` | Збережені платіжні методи | — |
| `activity_log` | Журнал дій користувачів | — |
| `admin_audit_log` | Журнал дій адмінів | — |
| `permissions` | Визначення дозволів | — |
| `user_permissions` | Надані дозволи | — |

---

## API Endpoints

### Auth & Security

| Метод | Endpoint | Опис |
|-------|----------|------|
| POST | `/api/auth/register` | Реєстрація |
| POST | `/api/auth/login` | Вхід |
| POST | `/api/auth/logout` | Вихід |
| GET | `/api/auth/me` | Поточний користувач |
| GET | `/api/auth/session` | Інфо про сесію |
| POST | `/api/auth/forgot-password` | Запит скидання пароля |
| POST | `/api/auth/reset-password` | Скидання пароля |
| GET | `/api/auth/verify-email` | Верифікація email |
| POST | `/api/auth/resend-verification` | Повторна верифікація |
| POST | `/api/account/switch` | Перемикання demo/real |

### Passkeys

| Метод | Endpoint | Опис |
|-------|----------|------|
| GET | `/api/passkeys` | Список passkeys |
| POST | `/api/passkeys/register-options` | Опції реєстрації |
| POST | `/api/passkeys/register-verify` | Верифікація реєстрації |
| POST | `/api/passkeys/auth-options` | Опції автентифікації |
| POST | `/api/passkeys/auth-verify` | Верифікація входу |
| POST | `/api/passkeys/check` | Чи є passkeys у юзера |
| DELETE | `/api/passkeys/:id` | Видалити passkey |

### 2FA

| Метод | Endpoint | Опис |
|-------|----------|------|
| GET | `/api/2fa/status` | Статус 2FA |
| POST | `/api/2fa/setup` | QR-код + секрет |
| POST | `/api/2fa/verify` | Активація 2FA |
| POST | `/api/2fa/disable` | Вимкнення 2FA |

### Telegram Auth

| Метод | Endpoint | Опис |
|-------|----------|------|
| POST | `/api/auth/telegram` | Telegram Widget вхід |
| POST | `/api/auth/telegram-register` | Реєстрація через Telegram |
| GET | `/api/auth/telegram-bot-username` | Username бота |
| POST | `/api/auth/telegram-login-request` | Запит login-коду |
| POST | `/api/auth/telegram-login-verify` | Верифікація коду |

### Market

| Метод | Endpoint | Опис |
|-------|----------|------|
| GET | `/api/market/prices` | Всі ціни |
| GET | `/api/market/price/:symbol` | Ціна пари |
| GET | `/api/market/orderbook/:symbol` | Ордербук |
| GET | `/api/market/ticker` | 24h тікер |
| GET | `/api/market/history/:symbol` | Історія цін |

### Portfolio & Trading

| Метод | Endpoint | Опис |
|-------|----------|------|
| GET | `/api/portfolio` | Портфоліо |
| GET | `/api/portfolio/performance` | Перформанс |
| GET | `/api/portfolio/allocation` | Алокація |
| GET | `/api/wallets` | Гаманці |
| POST | `/api/wallets` | Додати гаманець |
| DELETE | `/api/wallets/:id` | Видалити гаманець |
| POST | `/api/wallets/:id/refresh` | Оновити баланс |
| GET | `/api/transactions` | Транзакції |
| POST | `/api/orders` | Створити ордер |
| GET | `/api/orders` | Ордери |
| GET | `/api/orders/history` | Історія ордерів |
| DELETE | `/api/orders/:id` | Скасувати ордер |
| GET | `/api/holdings` | Холдинги |
| GET | `/api/faucet/status` | Статус faucet |
| POST | `/api/faucet/claim` | Отримати тестові кошти |

### Bots

| Метод | Endpoint | Опис |
|-------|----------|------|
| GET | `/api/bots` | Список ботів |
| POST | `/api/bots` | Створити бота |
| DELETE | `/api/bots/:id` | Видалити |
| PATCH | `/api/bots/:id/toggle` | Увімк/вимк |
| GET | `/api/bots/:id/data` | Дані бота |
| GET | `/api/bots/:id/details` | Деталі |
| GET | `/api/bots/:id/stats` | Статистика |
| GET | `/api/bots/:id/trades` | Угоди |
| GET | `/api/bots/:id/orders` | Ордери бота |
| POST | `/api/bots/:id/trades` | Додати угоду |
| POST | `/api/bots/:id/resync-trades` | Ресинк з Binance |
| GET | `/api/bots/:id/klines` | Свічки |
| GET | `/api/bots/:id/chart-data` | Дані для графіку |
| GET | `/api/bots/:id/trade-markers` | Маркери на графіку |
| PATCH | `/api/bots/:id/settings` | Display settings |
| PATCH | `/api/bots/:id/api-keys` | API ключі |
| PATCH | `/api/bots/:id/symbol` | Вибір пари |
| GET/PUT | `/api/bots/:id/trading-settings` | Trading settings |
| GET/PUT | `/api/bots/:id/notifications` | Notification settings |
| POST | `/api/bots/:id/subscribe` | Підписка (copy) |
| DELETE | `/api/bots/:id/subscribe` | Відписка |
| POST | `/api/bots/:id/copy-now` | Копіювати зараз |
| POST | `/api/bots/binance` | Тест API ключів |

### Profile

| Метод | Endpoint | Опис |
|-------|----------|------|
| GET | `/api/profile` | Профіль |
| PATCH | `/api/profile` | Оновити |
| GET/POST/DELETE | `/api/profile/payment-methods` | Платіжні методи |
| POST/GET/DELETE | `/api/profile/avatar` | Аватар |
| GET | `/api/telegram/status` | Telegram статус |
| POST | `/api/telegram/link` | Прив'язати |
| POST | `/api/telegram/unlink` | Відв'язати |
| POST | `/api/telegram/test` | Тестове повідомлення |
| GET | `/api/activity` | Лог активності |

### Admin

| Метод | Endpoint | Опис |
|-------|----------|------|
| GET | `/api/admin/stats` | Загальна статистика |
| GET | `/api/admin/users` | Список юзерів |
| GET/PATCH | `/api/admin/users/:id` | Деталі/редагування |
| PATCH | `/api/admin/users/:id/password` | Зміна пароля |
| PATCH | `/api/admin/users/:id/role` | Зміна ролі |
| POST | `/api/admin/users/:id/ban` | Бан |
| POST | `/api/admin/users/:id/unban` | Розбан |
| GET/POST/DELETE | `/api/admin/users/:id/permissions` | Дозволи |
| POST/DELETE | `/api/admin/users/:id/subscription` | Підписка юзера |
| GET | `/api/admin/bots` | Всі боти |
| PATCH/DELETE | `/api/admin/bots/:id` | Управління ботом |
| CRUD | `/api/admin/bot-categories` | Категорії ботів |
| GET/POST/PATCH/DELETE | `/api/admin/news` | Управління новинами |
| GET/POST | `/api/admin/maintenance` | Maintenance mode |
| GET/POST | `/api/admin/telegram-settings` | Telegram config |
| GET | `/api/admin/telegram-users` | Linked accounts |
| GET | `/api/admin/transactions` | Транзакції |
| GET | `/api/admin/subscriptions` | Підписки |
| GET | `/api/admin/audit-logs` | Аудит |
| GET | `/api/admin/analytics/*` | Аналітика (users, bots, trading, retention, health) |
| GET | `/api/admin/analytics/export` | CSV експорт |
| CRUD | `/api/admin/tables/:name` | Прямий доступ до БД |

### Notifications & Subscriptions

| Метод | Endpoint | Опис |
|-------|----------|------|
| GET | `/api/notifications` | Сповіщення |
| PUT | `/api/notifications/:id/read` | Прочитати |
| PUT | `/api/notifications/read-all` | Прочитати все |
| DELETE | `/api/notifications/:id` | Видалити |
| DELETE | `/api/notifications` | Очистити все |
| GET | `/api/subscription` | Поточний план |
| POST | `/api/subscription/checkout` | Активувати план |
| POST | `/api/subscription/cancel` | Скасувати |

---

## Технології

| Категорія | Технологія |
|-----------|-----------|
| **Runtime** | Node.js 18+ |
| **Framework** | Express.js |
| **Database** | SQLite (sql.js, in-memory + file) |
| **Realtime** | Socket.IO |
| **Auth** | bcryptjs, express-session, WebAuthn (@simplewebauthn) |
| **2FA** | speakeasy (TOTP), qrcode |
| **Market Data** | Binance REST API + WebSocket |
| **Telegram** | node-telegram-bot-api |
| **Email** | Nodemailer |
| **Security** | Helmet, CORS, rate-limiter-flexible |
| **Frontend** | Vanilla JS, HTML5, CSS3 |
| **Charts** | React 18 + Vite (Lightweight Charts) |
| **Deploy** | PM2 (fork mode) |
| **SSL** | Custom certificates |

---

## Встановлення

```bash
# Клонувати
git clone <repository-url>
cd defisit

# Встановити залежності сервера
cd server && npm install

# Запуск
npm start          # Production
npm run dev        # Development (nodemon)

# Збірка chart widget (опціонально)
cd ../_src && npm install && npm run build
```

Відкрити: **http://localhost:3000**

---

## Сторінки

| URL | Файл | Опис |
|-----|------|------|
| `/` | `page/index.html` | Landing page |
| `/login` | `page/reglogin.html` | Вхід |
| `/register` | `page/reglogin.html` | Реєстрація |
| `/dashboard` | `page/datedos.html` | Торговий дашборд |
| `/portfolio` | `page/portfolio.html` | Портфоліо |
| `/bots` | `page/bots.html` | Торгові боти |
| `/bot/:id` | `page/bot-detail.html` | Бот-термінал (admin) |
| `/bot-stats/:id` | `page/bot-stats.html` | Статистика бота |
| `/profile` | `page/profile.html` | Профіль |
| `/admin` | `page/admin.html` | Адмін-панель |
| `/news` | `page/news.html` | Новини |
| `/subscriptions` | `page/subscriptions.html` | Тарифи |
| `/community` | `page/community.html` | Спільнота |
| `/reset-password` | `page/reset-password.html` | Скидання пароля |
| `/verify-email` | `page/verify-email.html` | Верифікація email |

---

## UI/UX

- Темна тема (dark mode)
- Зелений акцент `#10B981`
- Адаптивний дизайн (mobile + desktop)
- CSS design tokens (`:root` змінні)
- Кастомний scrollbar
- Плавні анімації та переходи
- 3D-куб на landing page

---

## Соціальні мережі

- [Telegram](https://t.me/+Bf85Gs-LpSUyNmFi)
- [Instagram](https://www.instagram.com/yamato.legends_/)
- [YouTube](https://www.youtube.com/@YamatoLegends1)
- [TikTok](https://www.tiktok.com/@yamatolegends)

---

## Ліцензія

MIT License

**Yamato Trading Platform Team** | 2024–2026
