# Yamato Trading Platform

Сучасна криптовалютна торгова платформа з реальними даними від Binance API, системою демо/реальних акаунтів та передовими методами автентифікації.

## Огляд проекту

Yamato Trading Platform — це повнофункціональна веб-платформа для торгівлі криптовалютами. Платформа надає користувачам можливість:

- Торгувати криптовалютами з реальними ринковими даними
- Тестувати стратегії на демо-акаунті без ризику
- Використовувати торгових ботів для автоматизації
- Захищати акаунт за допомогою 2FA та Passkeys

## Основний функціонал

### Система авторизації

| Функція | Опис |
|---------|------|
| **Реєстрація/Логін** | Email + пароль з валідацією |
| **Passkeys (WebAuthn)** | Вхід за допомогою відбитка пальця, Face ID або апаратного ключа |
| **2FA (TOTP)** | Двофакторна автентифікація через Google Authenticator |
| **OAuth** | Підготовлено для Google, Apple, Discord (UI ready) |
| **Сесії** | Secure cookies з автоматичним продовженням |

### Демо та Реальний акаунти

Платформа підтримує два типи акаунтів:

- **Demo Account** — $10,000 віртуальних коштів для тестування стратегій
- **Real Account** — реальний баланс для справжньої торгівлі

Переключення між акаунтами доступне в хедері на будь-якій сторінці.

### Торговий дашборд

- **Графіки** — TradingView-подібні графіки з різними таймфреймами
- **Ордербук** — реальні дані bid/ask з Binance
- **Торгова панель** — Market та Limit ордери
- **Валютні пари** — BTC, ETH, BNB, SOL, XRP та інші

### Портфоліо

- **Баланс** — відображення поточного балансу (demo/real)
- **Гаманці** — підключення криптовалютних гаманців
- **Історія транзакцій** — всі операції з фільтрацією

### Торгові боти

- **Grid Bot** — сітковий бот для бокового ринку
- **DCA Bot** — усереднення позиції
- **Arbitrage Bot** — арбітражні операції
- **Управління** — запуск/зупинка, налаштування параметрів

### Профіль користувача

Сторінка профілю містить 4 розділи з навігацією:

1. **Personal Details** — особиста інформація, аватар, верифікація
2. **Security Settings** — пароль, 2FA, Passkeys
3. **Payment Methods** — банківські картки, криптогаманці
4. **Activity Log** — журнал всіх дій в акаунті

## Безпека

### Passkeys (WebAuthn/FIDO2)

Passkeys — це сучасний метод автентифікації без паролів:

```
Підтримувані методи:
├── Біометрія (відбиток пальця, Face ID)
├── Windows Hello
├── Апаратні ключі (YubiKey, Google Titan)
└── Синхронізовані паролі (iCloud Keychain, Google Password Manager)
```

**Як додати Passkey:**
1. Перейдіть в Profile → Security Settings
2. Натисніть "Add New Passkey"
3. Введіть назву ключа
4. Підтвердіть за допомогою біометрії або PIN

**Як увійти з Passkey:**
1. На сторінці логіну натисніть "Sign in with Passkey"
2. Виберіть збережений ключ
3. Підтвердіть біометрією

### Двофакторна автентифікація (2FA)

TOTP-based автентифікація через:
- Google Authenticator
- Authy
- Microsoft Authenticator
- Інші TOTP-сумісні додатки

## Встановлення

### Вимоги

- Node.js 18+
- npm або yarn
- Сучасний браузер з підтримкою WebAuthn

### Кроки встановлення

```bash
# 1. Клонуйте репозиторій
git clone <repository-url>
cd defisit

# 2. Перейдіть до папки server
cd server

# 3. Встановіть залежності
npm install

# 4. Запустіть сервер
npm start

# Для розробки з auto-reload:
npm run dev
```

### Доступ

Відкрийте в браузері: **http://localhost:3000**

## Структура проекту

```
defisit/
├── server/
│   ├── server.js          # Express сервер, API endpoints
│   ├── database.sqlite    # SQLite база даних
│   └── node_modules/      # Залежності
├── page/
│   ├── index.html         # Landing page
│   ├── reglogin.html      # Реєстрація/Логін
│   ├── datedos.html       # Торговий дашборд
│   ├── portfolio.html     # Портфоліо
│   ├── bots.html          # Торгові боти
│   └── porfile.html       # Профіль користувача
├── js/
│   └── app.js             # Клієнтська логіка
├── css/
│   └── nav-fix.css        # Стилі навігації
├── logo.svg               # Логотип (favicon)
└── README.md
```

## API Reference

### Авторизація

| Метод | Endpoint | Опис |
|-------|----------|------|
| POST | `/api/auth/register` | Реєстрація нового користувача |
| POST | `/api/auth/login` | Вхід в систему |
| POST | `/api/auth/logout` | Вихід з системи |
| GET | `/api/auth/me` | Поточний користувач |

### Passkeys

| Метод | Endpoint | Опис |
|-------|----------|------|
| GET | `/api/passkeys` | Список всіх passkeys користувача |
| POST | `/api/passkeys/register/options` | Опції для реєстрації passkey |
| POST | `/api/passkeys/register/verify` | Верифікація та збереження passkey |
| POST | `/api/passkeys/authenticate/options` | Опції для автентифікації |
| POST | `/api/passkeys/authenticate/verify` | Верифікація та вхід |
| DELETE | `/api/passkeys/:id` | Видалення passkey |

### 2FA

| Метод | Endpoint | Опис |
|-------|----------|------|
| POST | `/api/2fa/setup` | Генерація QR-коду для 2FA |
| POST | `/api/2fa/verify` | Верифікація та активація 2FA |
| POST | `/api/2fa/disable` | Вимкнення 2FA |

### Ринкові дані (Binance API)

| Метод | Endpoint | Опис |
|-------|----------|------|
| GET | `/api/market/prices` | Ціни всіх криптовалют |
| GET | `/api/market/price/:symbol` | Ціна конкретної пари |
| GET | `/api/market/orderbook/:symbol` | Ордербук |
| GET | `/api/market/ticker` | Дані для ticker tape |

### Портфоліо

| Метод | Endpoint | Опис |
|-------|----------|------|
| GET | `/api/portfolio` | Портфоліо користувача |
| GET | `/api/wallets` | Список гаманців |
| POST | `/api/wallets` | Додати гаманець |
| GET | `/api/transactions` | Історія транзакцій |

### Торгові боти

| Метод | Endpoint | Опис |
|-------|----------|------|
| GET | `/api/bots` | Список ботів |
| POST | `/api/bots` | Створити бота |
| PATCH | `/api/bots/:id/toggle` | Увімк/вимк бота |
| DELETE | `/api/bots/:id` | Видалити бота |
| GET | `/api/bots/stats` | Статистика ботів |

### Профіль

| Метод | Endpoint | Опис |
|-------|----------|------|
| GET | `/api/profile` | Дані профілю |
| PATCH | `/api/profile` | Оновити профіль |
| POST | `/api/profile/payment-methods` | Додати платіжний метод |
| DELETE | `/api/profile/payment-methods/:id` | Видалити платіжний метод |
| GET | `/api/activity-log` | Журнал активності |

### Акаунт

| Метод | Endpoint | Опис |
|-------|----------|------|
| POST | `/api/account/switch` | Переключити demo/real |

## База даних

SQLite база даних з наступними таблицями:

### users
```sql
- id (PRIMARY KEY)
- email (UNIQUE)
- password (bcrypt hash)
- full_name
- phone
- demo_balance (default: 10000)
- real_balance (default: 0)
- active_account ('demo' | 'real')
- two_factor_secret
- two_factor_enabled
- email_verified
- created_at
```

### passkeys
```sql
- id (PRIMARY KEY)
- user_id (FOREIGN KEY)
- name
- credential_id (UNIQUE)
- public_key
- counter
- device_type
- last_used_at
- created_at
```

### wallets
```sql
- id (PRIMARY KEY)
- user_id (FOREIGN KEY)
- currency
- address
- balance
- created_at
```

### transactions
```sql
- id (PRIMARY KEY)
- user_id (FOREIGN KEY)
- type ('buy' | 'sell' | 'deposit' | 'withdraw')
- currency
- amount
- price
- status
- created_at
```

### bots
```sql
- id (PRIMARY KEY)
- user_id (FOREIGN KEY)
- name
- type ('grid' | 'dca' | 'arbitrage')
- pair
- status ('active' | 'paused' | 'stopped')
- config (JSON)
- profit
- trades
- created_at
```

### payment_methods
```sql
- id (PRIMARY KEY)
- user_id (FOREIGN KEY)
- type ('card' | 'crypto')
- name
- details (JSON)
- is_default
- created_at
```

### activity_log
```sql
- id (PRIMARY KEY)
- user_id (FOREIGN KEY)
- action
- details
- ip_address
- user_agent
- created_at
```

## Технології

| Категорія | Технологія |
|-----------|-----------|
| **Backend** | Node.js, Express.js |
| **Database** | SQLite (sql.js) |
| **Authentication** | bcryptjs, express-session, WebAuthn |
| **2FA** | TOTP (speakeasy, qrcode) |
| **Market Data** | Binance REST API |
| **Frontend** | Vanilla JavaScript, CSS3 |
| **Icons** | Inline SVG |

## Сторінки

| URL | Файл | Опис |
|-----|------|------|
| `/` | index.html | Landing page |
| `/page/reglogin.html` | reglogin.html | Логін/Реєстрація |
| `/page/datedos.html` | datedos.html | Торговий дашборд |
| `/page/portfolio.html` | portfolio.html | Портфоліо |
| `/page/bots.html` | bots.html | Торгові боти |
| `/page/porfile.html` | porfile.html | Профіль |

## Особливості UI

- **Темна тема** — сучасний dark mode дизайн
- **Адаптивність** — підтримка мобільних пристроїв
- **Анімації** — плавні переходи та hover-ефекти
- **Градієнти** — фіолетово-синя кольорова схема
- **Ticker tape** — біжучий рядок з цінами криптовалют

## Розробка

### Запуск в режимі розробки

```bash
cd server
npm run dev
```

Сервер автоматично перезапускається при зміні файлів (nodemon).

### Тестовий акаунт

При першому запуску можна зареєструвати новий акаунт або використати:
- Демо-баланс: $10,000 (автоматично)

## Ліцензія

MIT License

## Автор

Yamato Trading Platform Team
