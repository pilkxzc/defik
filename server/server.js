'use strict';
const http  = require('http');
const https = require('https');
const path  = require('path');
const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');

const { PORT, HTTPS_PORT, HOST, loadSettings } = require('./config');
const { initDatabase, saveDatabase, dbGet }    = require('./db');
const { createSessionMiddleware }              = require('./middleware/session');
const { maintenanceMiddleware }                = require('./middleware/maintenance');
const { betaMiddleware, betaSubmit }           = require('./middleware/beta');
const { errorHandler }                         = require('./middleware/errorHandler');
const { ordersLimiter, telegramCodeLimiter }   = require('./middleware/rateLimiter');
const { authRateLimiter, apiRateLimiter }      = require('./middleware/rateLimit');
const { initSocket }                           = require('./socket');
const { initTelegramBot }                      = require('./services/telegram');
const { getSSLCredentials }                    = require('./utils/ssl');
const { startCollector, stopCollector }        = require('./services/candleCollector');
const { startBackupSchedule, stopBackupSchedule } = require('./services/backup');
const { startNewsCollector, stopNewsCollector }   = require('./services/newsCollector');
const { activityTracker }                         = require('./middleware/activityTracker');

async function createApp() {
    // 1. Load persisted settings
    loadSettings();

    // 2. Initialize database
    await initDatabase();

    // 3. Express app
    const app = express();

    app.set('trust proxy', 1);

    // Security headers
    app.use(helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.socket.io", "https://cdn.jsdelivr.net", "https://telegram.org"],
                scriptSrcAttr: ["'unsafe-inline'"],
                styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
                fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
                connectSrc: ["'self'", "wss://stream.binance.com:*", "wss://fstream.binance.com", "https://api.binance.com", "https://fapi.binance.com", "https://telegram.org", "https://oauth.telegram.org", "https://cdn.jsdelivr.net", "https://cdn.socket.io", "https://accounts.google.com", "https://oauth2.googleapis.com"],
                imgSrc: ["'self'", "data:", "https://cdn.jsdelivr.net", "https://t.me", "https://*.telegram.org", "https://api.telegram.org", "https://lh3.googleusercontent.com"],
                frameSrc: ["'self'", "https://oauth.telegram.org", "https://accounts.google.com"]
            }
        },
        crossOriginEmbedderPolicy: false
    }));

    app.use(cors({ origin: '*' }));
    app.use(express.json({ limit: '20mb' }));
    app.use(express.urlencoded({ extended: true, limit: '20mb' }));
    app.use(maintenanceMiddleware);
    app.use(express.static(path.join(__dirname, '..'), {
        setHeaders: (res, filePath) => {
            if (filePath.endsWith('.html')) {
                res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            }
        }
    }));

    const sessionMiddleware = createSessionMiddleware();
    app.use(sessionMiddleware);

    // Activity tracking — runs after session so req.session.userId is available
    app.use(activityTracker);

    // Beta gate — runs after session so req.session is available
    app.post('/beta', betaSubmit);
    app.use(betaMiddleware);

    // Rate limiting — applied after session and beta, before routes
    // Auth endpoints (strict): 5 req/min per IP, Redis-backed with memory fallback
    app.use('/api/auth/login', authRateLimiter);
    app.use('/api/auth/register', authRateLimiter);
    app.use('/api/auth/forgot-password', authRateLimiter);
    app.use('/api/auth/reset-password', authRateLimiter);
    // Specific endpoint limiters
    app.use('/api/auth/telegram-login-request', telegramCodeLimiter);
    app.use('/api/orders', ordersLimiter);
    // General API endpoints: 100 req/min per user/IP, Redis-backed with memory fallback
    app.use('/api', apiRateLimiter);

    // 4. API routers
    const authRouter = require('./routes/auth');
    app.use(authRouter);
    app.use(require('./routes/market'));
    app.use(require('./routes/portfolio'));
    app.use(require('./routes/bots'));
    app.use(require('./routes/profile'));
    app.use(require('./routes/faucet'));
    app.use(require('./routes/notifications'));
    app.use(require('./routes/subscription'));
    app.use(require('./routes/orders'));
    app.use(require('./routes/admin'));
    app.use(require('./routes/history'));
    app.use(require('./routes/community'));

    // 5. HTML page routes
    const pages = path.join(__dirname, '..', 'page');

    app.get('/',             (req, res) => res.sendFile(path.join(pages, 'index.html')));
    app.get('/login',        (req, res) => res.sendFile(path.join(pages, 'reglogin.html')));
    app.get('/register',     (req, res) => res.sendFile(path.join(pages, 'reglogin.html')));
    app.get('/dashboard',    (req, res) => res.sendFile(path.join(pages, 'datedos.html')));
    app.get('/portfolio',    (req, res) => res.sendFile(path.join(pages, 'portfolio.html')));
    app.get('/bots',           (req, res) => res.sendFile(path.join(pages, 'bots.html')));
    app.get('/bot-dashboard/:id', (req, res) => {
        if (!req.session || !req.session.userId) return res.redirect('/login');
        res.sendFile(path.join(pages, 'dashboards-bot.html'));
    });
    app.get('/profile',      (req, res) => res.sendFile(path.join(pages, 'profile.html')));
    app.get('/admin',        (req, res) => res.sendFile(path.join(pages, 'admin.html')));
    app.get('/admin/:tab',   (req, res) => res.sendFile(path.join(pages, 'admin.html')));
    app.get('/bot/:id', (req, res) => {
        // 1. Не залогінений → на логін
        if (!req.session || !req.session.userId) {
            return res.redirect('/login');
        }

        // 2. Перевірка ролі — тільки admin
        const user = dbGet('SELECT role FROM users WHERE id = ?', [req.session.userId]);
        if (!user || user.role !== 'admin') {
            return res.redirect('/dashboard');
        }

        // 3. Перевірка чи мобільний
        const ua = req.headers['user-agent'] || '';
        const isMobile = /Mobile|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
        if (isMobile) {
            return res.status(200).send(`<!DOCTYPE html>
<html lang="uk">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Yamato — Тільки для ПК</title>
<link rel="icon" type="image/svg+xml" href="/logo.svg">
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  :root{--bg:#080808;--surface:#141414;--border:rgba(255,255,255,0.07);--green:#10B981;--text:#fff;--muted:#A1A1A1}
  body{background:var(--bg);color:var(--text);font-family:'Plus Jakarta Sans',sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center}
  .card{background:var(--surface);border:1px solid var(--border);border-radius:24px;padding:40px 32px;max-width:360px;width:100%}
  .icon-wrap{width:72px;height:72px;background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.25);border-radius:20px;display:flex;align-items:center;justify-content:center;margin:0 auto 24px}
  .icon-wrap svg{color:var(--green)}
  h1{font-size:22px;font-weight:800;margin-bottom:12px;line-height:1.3}
  p{color:var(--muted);font-size:14px;line-height:1.6;margin-bottom:28px}
  .hint{background:rgba(16,185,129,0.06);border:1px solid rgba(16,185,129,0.15);border-radius:12px;padding:14px 16px;font-size:13px;color:var(--green);font-weight:600;margin-bottom:28px}
  .btn{display:block;width:100%;padding:14px;background:rgba(255,255,255,0.05);border:1px solid var(--border);border-radius:12px;color:var(--muted);font-size:14px;font-weight:600;text-decoration:none;transition:0.2s}
  .btn:hover{background:rgba(255,255,255,0.08);color:var(--text)}
  .brand{display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:28px;font-size:15px;font-weight:800;letter-spacing:0.5px}
  .brand img{width:28px;height:28px;border-radius:50%}
</style>
</head>
<body>
<div class="card">
  <div class="brand">
    <img src="/logo.svg" alt="Yamato">YAMATO
  </div>
  <div class="icon-wrap">
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
    </svg>
  </div>
  <h1>Ця сторінка доступна тільки з комп'ютера</h1>
  <p>Панель керування ботом — це складний інтерфейс, який не підтримується на мобільних пристроях.</p>
  <div class="hint">Відкрийте сайт на ПК або ноутбуці</div>
  <a href="/bots" class="btn">← Повернутись до ботів</a>
</div>
</body>
</html>`);
        }

        // 4. Адмін з десктопу — відкриваємо сторінку
        res.sendFile(path.join(pages, 'bot-detail.html'));
    });
    app.get('/news',         (req, res) => res.sendFile(path.join(pages, 'news.html')));
    app.get('/subscriptions',(req, res) => res.sendFile(path.join(pages, 'subscriptions.html')));
    app.get('/community',    (req, res) => res.sendFile(path.join(pages, 'community.html')));
    app.get('/docs',         (req, res) => res.sendFile(path.join(pages, 'docs.html')));
    app.get('/reset-password', (req, res) => res.sendFile(path.join(pages, 'reset-password.html')));
    app.get('/verify-email',   (req, res) => res.sendFile(path.join(pages, 'verify-email.html')));
    app.get('/bot-stats/:id', (req, res) => res.sendFile(path.join(pages, 'bot-stats.html')));
    app.get('/bot-community-stats', (req, res) => res.sendFile(path.join(pages, 'bot-community-stats.html')));
    app.get('/loadingdachbot', (req, res) => res.sendFile(path.join(pages, 'loadingdachbot.html')));

    app.get('/emergency',    (req, res) => res.sendFile(path.join(pages, 'emergency.html')));

    // 404 — must be last
    app.use((req, res) => res.status(404).sendFile(path.join(pages, '404erors.html')));

    // Error handler
    app.use(errorHandler);

    return { app, sessionMiddleware };
}

async function startServer() {
    const { app, sessionMiddleware } = await createApp();

    // HTTP server
    const server = http.createServer(app);

    // Socket.IO (HTTP only)
    initSocket(server, sessionMiddleware);

    // Telegram bot
    await initTelegramBot();

    // Start candle collector
    startCollector().catch(err => console.error('[Server] Candle collector failed:', err));

    // Start backup schedule
    startBackupSchedule();

    // Start exchange news collector
    startNewsCollector();

    // Start HTTP server
    server.listen(PORT, HOST, () => {
        console.log(`HTTP  server listening on http://${HOST}:${PORT}`);
    });

    // Start HTTPS server
    try {
        const credentials = getSSLCredentials();
        const httpsServer = https.createServer(credentials, app);
        httpsServer.listen(HTTPS_PORT, HOST, () => {
            console.log(`HTTPS server listening on https://${HOST}:${HTTPS_PORT}`);
        });
    } catch (err) {
        console.error('HTTPS server could not start:', err.message);
    }

    // Graceful shutdown
    function shutdown(signal) {
        console.log(`\n${signal} received — shutting down gracefully`);
        stopCollector();
        stopBackupSchedule();
        stopNewsCollector();
        saveDatabase();
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(1), 5000);
    }

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT',  () => shutdown('SIGINT'));
}

// Global error handlers
process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
});

process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection:', reason);
});

// Only start server if run directly (not required for testing)
if (require.main === module) {
    startServer().catch((err) => {
        console.error('Failed to start server:', err);
        process.exit(1);
    });
}

module.exports = { createApp };
