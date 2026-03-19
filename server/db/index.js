'use strict';
const initSqlJs = require('sql.js');
const fs        = require('fs');
const { DB_PATH, ADMIN_EMAIL } = require('../config');

let db;

async function initDatabase() {
    const SQL = await initSqlJs();

    if (fs.existsSync(DB_PATH)) {
        const fileBuffer = fs.readFileSync(DB_PATH);
        db = new SQL.Database(fileBuffer);
    } else {
        db = new SQL.Database();
    }

    // Enable foreign key constraint enforcement
    db.run('PRAGMA foreign_keys = ON');

    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            full_name TEXT NOT NULL,
            phone TEXT,
            balance REAL DEFAULT 0,
            demo_balance REAL DEFAULT 10000,
            real_balance REAL DEFAULT 0,
            active_account TEXT DEFAULT 'demo',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            last_login TEXT,
            is_verified INTEGER DEFAULT 0,
            verification_level INTEGER DEFAULT 0
        )
    `);

    try { db.run('ALTER TABLE users ADD COLUMN demo_balance REAL DEFAULT 10000'); } catch(e) {}
    try { db.run('ALTER TABLE users ADD COLUMN real_balance REAL DEFAULT 0'); } catch(e) {}
    try { db.run('ALTER TABLE users ADD COLUMN active_account TEXT DEFAULT "demo"'); } catch(e) {}
    try { db.run('ALTER TABLE transactions ADD COLUMN account_type TEXT DEFAULT "demo"'); } catch(e) {}
    try { db.run('ALTER TABLE users ADD COLUMN role TEXT DEFAULT "user"'); } catch(e) {}
    try { db.run('ALTER TABLE users ADD COLUMN is_banned INTEGER DEFAULT 0'); } catch(e) {}
    try { db.run('ALTER TABLE users ADD COLUMN ban_reason TEXT'); } catch(e) {}
    try { db.run('ALTER TABLE users ADD COLUMN totp_secret TEXT'); } catch(e) {}
    try { db.run('ALTER TABLE users ADD COLUMN totp_enabled INTEGER DEFAULT 0'); } catch(e) {}
    try { db.run('ALTER TABLE users ADD COLUMN backup_codes TEXT'); } catch(e) {}
    try { db.run('ALTER TABLE users ADD COLUMN avatar TEXT'); } catch(e) {}
    try { db.run('ALTER TABLE users ADD COLUMN subscription_plan TEXT DEFAULT "free"'); } catch(e) {}
    try { db.run('ALTER TABLE users ADD COLUMN subscription_expires_at TEXT'); } catch(e) {}
    try { db.run('ALTER TABLE users ADD COLUMN last_ip TEXT'); } catch(e) {}
    try { db.run('ALTER TABLE users ADD COLUMN telegram_id TEXT'); } catch(e) {}
    try { db.run('ALTER TABLE users ADD COLUMN telegram_code TEXT'); } catch(e) {}
    try { db.run('ALTER TABLE users ADD COLUMN telegram_verified INTEGER DEFAULT 0'); } catch(e) {}
    try { db.run('ALTER TABLE users ADD COLUMN telegram_username TEXT'); } catch(e) {}
    try { db.run('ALTER TABLE users ADD COLUMN google_id TEXT'); } catch(e) {}
    try { db.run('ALTER TABLE users ADD COLUMN google_avatar TEXT'); } catch(e) {}
    try { db.run('ALTER TABLE users ADD COLUMN db_access INTEGER DEFAULT 0'); } catch(e) {}
    try { db.run('ALTER TABLE users ADD COLUMN permissions TEXT DEFAULT "{}"'); } catch(e) {}

    db.run(`
        CREATE TABLE IF NOT EXISTS backup_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT NOT NULL,
            size_bytes INTEGER DEFAULT 0,
            drive_file_id TEXT,
            status TEXT DEFAULT 'pending',
            error_message TEXT,
            triggered_by TEXT DEFAULT 'manual',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            completed_at TEXT
        )
    `);
    try { db.run('ALTER TABLE bots ADD COLUMN binance_api_key TEXT'); } catch(e) {}
    try { db.run('ALTER TABLE bots ADD COLUMN binance_api_secret TEXT'); } catch(e) {}
    try { db.run('ALTER TABLE bots ADD COLUMN mode TEXT DEFAULT "test"'); } catch(e) {}
    try { db.run('ALTER TABLE bots ADD COLUMN display_settings TEXT DEFAULT "{}"'); } catch(e) {}
    try { db.run('ALTER TABLE bots ADD COLUMN account_type TEXT DEFAULT "futures"'); } catch(e) {}
    try { db.run('ALTER TABLE bots ADD COLUMN selected_symbol TEXT DEFAULT "BTCUSDT"'); } catch(e) {}
    try { db.run('ALTER TABLE bots ADD COLUMN trading_settings TEXT DEFAULT "{}"'); } catch(e) {}
    try { db.run('ALTER TABLE bot_subscribers ADD COLUMN user_binance_api_key TEXT'); } catch(e) {}
    try { db.run('ALTER TABLE bot_subscribers ADD COLUMN user_binance_api_secret TEXT'); } catch(e) {}
    try { db.run('ALTER TABLE bots ADD COLUMN proxy TEXT'); } catch(e) {}
    try { db.run('ALTER TABLE bots ADD COLUMN category_id INTEGER DEFAULT NULL'); } catch(e) {}
    try { db.run('ALTER TABLE bots ADD COLUMN community_visible INTEGER DEFAULT 1'); } catch(e) {}

    // ── Bot strategies: unique strategy+symbol per bot ──
    db.run(`
        CREATE TABLE IF NOT EXISTS bot_strategies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            bot_id INTEGER NOT NULL,
            strategy TEXT NOT NULL DEFAULT 'default',
            symbol TEXT NOT NULL,
            is_active INTEGER DEFAULT 1,
            settings TEXT DEFAULT '{}',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (bot_id) REFERENCES bots(id),
            UNIQUE(bot_id, strategy, symbol)
        )
    `);
    try { db.run('CREATE INDEX IF NOT EXISTS idx_bot_strategies_bot_id ON bot_strategies(bot_id)'); } catch(e) {}

    // Add strategy_id to tables that already exist at this point
    try { db.run('ALTER TABLE bot_trades ADD COLUMN strategy_id INTEGER REFERENCES bot_strategies(id)'); } catch(e) {}
    try { db.run('ALTER TABLE bot_order_history ADD COLUMN strategy_id INTEGER REFERENCES bot_strategies(id)'); } catch(e) {}
    try { db.run('CREATE INDEX IF NOT EXISTS idx_bot_trades_strategy_id ON bot_trades(strategy_id)'); } catch(e) {}

    db.run(`
        CREATE TABLE IF NOT EXISTS bot_symbol_settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            bot_id INTEGER NOT NULL,
            symbol TEXT NOT NULL,
            is_visible INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(bot_id, symbol),
            FOREIGN KEY (bot_id) REFERENCES bots(id)
        )
    `);
    db.run(`
        CREATE TABLE IF NOT EXISTS bot_analytics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            event TEXT NOT NULL,
            bot_id INTEGER,
            symbol TEXT,
            meta TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (bot_id) REFERENCES bots(id)
        )
    `);

    try { db.run('ALTER TABLE news ADD COLUMN source TEXT DEFAULT NULL'); } catch(e) {}
    try { db.run('ALTER TABLE news ADD COLUMN external_id TEXT DEFAULT NULL'); } catch(e) {}

    db.run(`
        CREATE TABLE IF NOT EXISTS tg_posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            message_id INTEGER NOT NULL,
            channel_id TEXT NOT NULL,
            channel_title TEXT DEFAULT '',
            text TEXT DEFAULT '',
            photo_file_id TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(channel_id, message_id)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS bot_categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            color TEXT DEFAULT '#10B981',
            icon TEXT DEFAULT 'bot',
            sort_order INTEGER DEFAULT 0,
            is_visible INTEGER DEFAULT 1,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    try {
        const cnt = dbGet('SELECT COUNT(*) as c FROM bot_categories');
        if (!cnt || cnt.c === 0) {
            [['AI BOT','#8B5CF6','cpu',1],['Grid Bot','#10B981','grid',2],['Neutral Bot','#F59E0B','scale',3]]
                .forEach(([name,color,icon,sort]) =>
                    db.run('INSERT INTO bot_categories (name,color,icon,sort_order) VALUES (?,?,?,?)',[name,color,icon,sort]));
        }
    } catch(e) {}

    db.run(`
        CREATE TABLE IF NOT EXISTS bot_order_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            bot_id INTEGER NOT NULL,
            order_id TEXT,
            symbol TEXT NOT NULL,
            side TEXT NOT NULL,
            type TEXT NOT NULL,
            price REAL,
            stop_price REAL,
            quantity REAL,
            status TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            canceled_at TEXT,
            FOREIGN KEY (bot_id) REFERENCES bots(id)
        )
    `);

    try {
        db.run('UPDATE users SET demo_balance = balance WHERE demo_balance = 0 AND balance > 0');
        db.run('UPDATE users SET demo_balance = 10000 WHERE demo_balance = 0');
        saveDatabase();
    } catch(e) {}

    db.run(`
        CREATE TABLE IF NOT EXISTS wallets (
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
    `);

    try { db.run('ALTER TABLE wallets ADD COLUMN usd_value REAL DEFAULT 0'); } catch(e) {}
    try { db.run('ALTER TABLE wallets ADD COLUMN last_updated TEXT'); } catch(e) {}

    db.run(`
        CREATE TABLE IF NOT EXISTS portfolio_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            month TEXT NOT NULL,
            total_value REAL DEFAULT 0,
            profit_loss REAL DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            type TEXT NOT NULL,
            currency TEXT NOT NULL,
            amount REAL NOT NULL,
            usd_value REAL,
            status TEXT DEFAULT 'completed',
            account_type TEXT DEFAULT 'demo',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            symbol TEXT NOT NULL,
            side TEXT NOT NULL,
            type TEXT NOT NULL,
            price REAL,
            amount REAL NOT NULL,
            filled REAL DEFAULT 0,
            status TEXT DEFAULT 'open',
            account_type TEXT DEFAULT 'demo',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            filled_at TEXT,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS holdings (
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
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS bots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            type TEXT NOT NULL,
            pair TEXT NOT NULL,
            investment REAL DEFAULT 0,
            profit REAL DEFAULT 0,
            is_active INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS bot_subscribers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            bot_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            copy_trades INTEGER DEFAULT 0,
            copy_percentage REAL DEFAULT 100,
            max_position_size REAL DEFAULT 0,
            status TEXT DEFAULT 'active',
            subscribed_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (bot_id) REFERENCES bots(id),
            FOREIGN KEY (user_id) REFERENCES users(id),
            UNIQUE(bot_id, user_id)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS bot_trades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            bot_id INTEGER NOT NULL,
            symbol TEXT NOT NULL,
            side TEXT NOT NULL,
            type TEXT NOT NULL,
            quantity REAL NOT NULL,
            price REAL NOT NULL,
            pnl REAL DEFAULT 0,
            pnl_percent REAL DEFAULT 0,
            status TEXT DEFAULT 'open',
            opened_at TEXT DEFAULT CURRENT_TIMESTAMP,
            closed_at TEXT,
            FOREIGN KEY (bot_id) REFERENCES bots(id)
        )
    `);

    try { db.run('ALTER TABLE bot_trades ADD COLUMN binance_trade_id TEXT'); } catch(e) {}
    try { db.run('ALTER TABLE bot_trades ADD COLUMN binance_close_trade_id TEXT'); } catch(e) {}
    try { db.run('ALTER TABLE bot_trades ADD COLUMN position_side TEXT'); } catch(e) {}
    try { db.run('ALTER TABLE bot_trades ADD COLUMN commission REAL DEFAULT 0'); } catch(e) {}
    try { db.run('ALTER TABLE bot_trades ADD COLUMN commission_asset TEXT'); } catch(e) {}
    try { db.run('ALTER TABLE bot_trades ADD COLUMN account_idx INTEGER'); } catch(e) {}

    db.run(`
        CREATE TABLE IF NOT EXISTS bot_position_blocks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            bot_id INTEGER NOT NULL,
            symbol TEXT NOT NULL,
            side TEXT NOT NULL,
            trade_count INTEGER DEFAULT 0,
            total_qty REAL DEFAULT 0,
            avg_entry REAL DEFAULT 0,
            avg_exit REAL DEFAULT 0,
            total_pnl REAL DEFAULT 0,
            is_open INTEGER DEFAULT 0,
            started_at TEXT,
            ended_at TEXT,
            trade_ids TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (bot_id) REFERENCES bots(id)
        )
    `);
    try { db.run('ALTER TABLE bot_position_blocks ADD COLUMN strategy_id INTEGER REFERENCES bot_strategies(id)'); } catch(e) {}
    try { db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_bot_trades_binance_id ON bot_trades(bot_id, binance_trade_id) WHERE binance_trade_id IS NOT NULL'); } catch(e) {}
    try { db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_bot_trades_close_id ON bot_trades(bot_id, binance_close_trade_id) WHERE binance_close_trade_id IS NOT NULL'); } catch(e) {}

    // Migrate bot_stats: remove UNIQUE constraint on bot_id (now multiple rows per bot: global + per-strategy)
    try {
        const tableInfo = db.exec("SELECT sql FROM sqlite_master WHERE type='table' AND name='bot_stats'");
        const createSql = tableInfo[0]?.values[0]?.[0] || '';
        if (createSql.includes('bot_id INTEGER NOT NULL UNIQUE')) {
            console.log('Migrating bot_stats: removing UNIQUE constraint on bot_id...');
            db.run(`CREATE TABLE bot_stats_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                bot_id INTEGER NOT NULL,
                strategy_id INTEGER REFERENCES bot_strategies(id),
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
            )`);
            db.run(`INSERT INTO bot_stats_new (id, bot_id, total_trades, winning_trades, losing_trades, total_pnl, max_drawdown, best_trade, worst_trade, avg_trade_duration, last_updated)
                    SELECT id, bot_id, total_trades, winning_trades, losing_trades, total_pnl, max_drawdown, best_trade, worst_trade, avg_trade_duration, last_updated FROM bot_stats`);
            db.run('DROP TABLE bot_stats');
            db.run('ALTER TABLE bot_stats_new RENAME TO bot_stats');
            console.log('bot_stats migration complete.');
        }
    } catch(e) {
        // Table doesn't exist yet — will be created below
    }

    db.run(`
        CREATE TABLE IF NOT EXISTS bot_stats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            bot_id INTEGER NOT NULL,
            strategy_id INTEGER REFERENCES bot_strategies(id),
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
    `);
    try { db.run('ALTER TABLE bot_stats ADD COLUMN strategy_id INTEGER REFERENCES bot_strategies(id)'); } catch(e) {}
    try { db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_bot_stats_bot_strategy ON bot_stats(bot_id, COALESCE(strategy_id, 0))'); } catch(e) {}
    try { db.run('CREATE INDEX IF NOT EXISTS idx_bot_stats_strategy_id ON bot_stats(strategy_id)'); } catch(e) {}

    db.run(`
        CREATE TABLE IF NOT EXISTS bot_notification_settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            bot_id INTEGER NOT NULL,
            notify_new_trade INTEGER DEFAULT 1,
            notify_close_trade INTEGER DEFAULT 1,
            notify_stop_loss INTEGER DEFAULT 1,
            notify_take_profit INTEGER DEFAULT 1,
            notify_position_change INTEGER DEFAULT 0,
            notify_daily_summary INTEGER DEFAULT 1,
            notify_pnl_threshold REAL DEFAULT 0,
            notify_method TEXT DEFAULT 'both',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (bot_id) REFERENCES bots(id),
            UNIQUE(user_id, bot_id)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS activity_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            action TEXT NOT NULL,
            category TEXT DEFAULT 'general',
            details TEXT,
            ip_address TEXT,
            user_agent TEXT,
            country TEXT,
            path TEXT,
            method TEXT,
            status_code INTEGER,
            duration_ms INTEGER,
            session_id TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);
    // Migrate old activity_log columns
    try { db.run('ALTER TABLE activity_log ADD COLUMN category TEXT DEFAULT "general"'); } catch(e) {}
    try { db.run('ALTER TABLE activity_log ADD COLUMN user_agent TEXT'); } catch(e) {}
    try { db.run('ALTER TABLE activity_log ADD COLUMN country TEXT'); } catch(e) {}
    try { db.run('ALTER TABLE activity_log ADD COLUMN path TEXT'); } catch(e) {}
    try { db.run('ALTER TABLE activity_log ADD COLUMN method TEXT'); } catch(e) {}
    try { db.run('ALTER TABLE activity_log ADD COLUMN status_code INTEGER'); } catch(e) {}
    try { db.run('ALTER TABLE activity_log ADD COLUMN duration_ms INTEGER'); } catch(e) {}
    try { db.run('ALTER TABLE activity_log ADD COLUMN session_id TEXT'); } catch(e) {}

    db.run(`
        CREATE TABLE IF NOT EXISTS payment_methods (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            type TEXT NOT NULL,
            card_last_four TEXT,
            expiry_date TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS permissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            description TEXT
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS user_permissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            permission_id INTEGER NOT NULL,
            granted_by INTEGER,
            granted_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (permission_id) REFERENCES permissions(id),
            FOREIGN KEY (granted_by) REFERENCES users(id)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS admin_audit_log (
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
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS news (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            excerpt TEXT,
            content TEXT,
            category TEXT NOT NULL DEFAULT 'update',
            image_url TEXT,
            is_published INTEGER DEFAULT 1,
            created_by INTEGER,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (created_by) REFERENCES users(id)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            type TEXT NOT NULL,
            title TEXT NOT NULL,
            message TEXT NOT NULL,
            icon TEXT,
            is_read INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token TEXT UNIQUE NOT NULL,
            expires_at TEXT NOT NULL,
            used INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS email_verification_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token TEXT UNIQUE NOT NULL,
            expires_at TEXT NOT NULL,
            used INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS login_attempts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ip_address TEXT NOT NULL,
            user_email TEXT NOT NULL,
            success INTEGER DEFAULT 0,
            attempt_time TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    try { db.run('CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_time ON login_attempts(ip_address, attempt_time)'); } catch(e) {}
    try { db.run('CREATE INDEX IF NOT EXISTS idx_login_attempts_email_time ON login_attempts(user_email, attempt_time)'); } catch(e) {}

    try { db.run('ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0'); } catch(e) {}

    db.run(`
        CREATE TABLE IF NOT EXISTS passkeys (
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
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS login_codes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL UNIQUE,
            code TEXT NOT NULL UNIQUE,
            expires_at INTEGER NOT NULL,
            used_at INTEGER,
            created_at INTEGER DEFAULT (strftime('%s', 'now')),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS bug_reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            user_email TEXT,
            user_name TEXT,
            description TEXT,
            logs TEXT,
            screenshot_path TEXT,
            video_path TEXT,
            page_url TEXT,
            user_agent TEXT,
            status TEXT DEFAULT 'new',
            created_at TEXT DEFAULT (datetime('now','localtime'))
        )
    `);

    const defaultPermissions = [
        ['users.view', 'View users list'],
        ['users.edit', 'Edit user details'],
        ['users.ban', 'Ban/unban users'],
        ['users.roles', 'Change user roles'],
        ['transactions.view', 'View all transactions'],
        ['bots.manage', 'Manage trading bots'],
        ['news.manage', 'Manage news and announcements'],
        ['activity.view', 'View activity logs'],
        ['settings.manage', 'Manage system settings'],
        ['admin.access', 'Access admin panel']
    ];

    defaultPermissions.forEach(([name, description]) => {
        try {
            db.run('INSERT OR IGNORE INTO permissions (name, description) VALUES (?, ?)', [name, description]);
        } catch(e) {}
    });

    try {
        db.run("UPDATE users SET role = 'admin' WHERE email = ?", [ADMIN_EMAIL]);
    } catch(e) {}

    // Indexes for frequently queried tables
    try { db.run('CREATE INDEX IF NOT EXISTS idx_activity_log_user_id ON activity_log(user_id)'); } catch(e) {}
    try { db.run('CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log(created_at DESC)'); } catch(e) {}
    try { db.run('CREATE INDEX IF NOT EXISTS idx_activity_log_user_created ON activity_log(user_id, created_at DESC)'); } catch(e) {}
    try { db.run('CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id)'); } catch(e) {}
    try { db.run('CREATE INDEX IF NOT EXISTS idx_bot_analytics_bot_id ON bot_analytics(bot_id)'); } catch(e) {}
    try { db.run('CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_user_id ON portfolio_snapshots(user_id)'); } catch(e) {}
    try { db.run('CREATE INDEX IF NOT EXISTS idx_bot_trades_bot_id ON bot_trades(bot_id)'); } catch(e) {}
    try { db.run('CREATE INDEX IF NOT EXISTS idx_bot_order_history_bot_id ON bot_order_history(bot_id)'); } catch(e) {}

    // Additional indexes for common query patterns
    try { db.run('CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id)'); } catch(e) {}
    try { db.run('CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id)'); } catch(e) {}
    try { db.run('CREATE INDEX IF NOT EXISTS idx_bot_trades_bot_status ON bot_trades(bot_id, status)'); } catch(e) {}
    try { db.run('CREATE INDEX IF NOT EXISTS idx_bot_trades_bot_symbol_status ON bot_trades(bot_id, symbol, status)'); } catch(e) {}
    try { db.run('CREATE INDEX IF NOT EXISTS idx_bot_subscribers_user_status ON bot_subscribers(user_id, status)'); } catch(e) {}
    try { db.run('CREATE INDEX IF NOT EXISTS idx_bot_subscribers_bot_status ON bot_subscribers(bot_id, status)'); } catch(e) {}
    try { db.run('CREATE INDEX IF NOT EXISTS idx_orders_user_status ON orders(user_id, status)'); } catch(e) {}
    try { db.run('CREATE INDEX IF NOT EXISTS idx_holdings_user_account ON holdings(user_id, account_type)'); } catch(e) {}
    try { db.run('CREATE INDEX IF NOT EXISTS idx_news_external_id ON news(external_id)'); } catch(e) {}
    try { db.run('CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, is_read)'); } catch(e) {}
    try { db.run('CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id)'); } catch(e) {}
    try { db.run('CREATE INDEX IF NOT EXISTS idx_bots_user_id ON bots(user_id)'); } catch(e) {}
    try { db.run('CREATE INDEX IF NOT EXISTS idx_bots_is_active ON bots(is_active)'); } catch(e) {}
    try { db.run('CREATE INDEX IF NOT EXISTS idx_passkeys_user_id ON passkeys(user_id)'); } catch(e) {}
    try { db.run('CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON wallets(user_id)'); } catch(e) {}

    // Clean up expired tokens on startup
    try { db.run("DELETE FROM password_reset_tokens WHERE used = 1 OR created_at < datetime('now', '-24 hours')"); } catch(e) {}
    try { db.run("DELETE FROM email_verification_tokens WHERE used = 1 OR created_at < datetime('now', '-7 days')"); } catch(e) {}
    try { db.run("DELETE FROM login_codes WHERE created_at < (strftime('%s', 'now') - 3600)"); } catch(e) {}
    try { db.run("DELETE FROM login_attempts WHERE attempt_time < datetime('now', '-24 hours')"); } catch(e) {}

    saveDatabase();
    console.log('Database initialized');

    // Migrate plaintext API keys to encrypted (if crypto module available)
    try {
        const { migrateEncryptKeys } = require('../utils/crypto');
        migrateEncryptKeys();
    } catch(e) {
        // crypto module not yet created or ENCRYPTION_KEY not set
        console.warn('[DB] API key encryption migration skipped:', e.message);
    }
}

let _saveTimer = null;
let _lastSaveTime = 0;

function saveDatabase() {
    // Debounce: wait 2s after last write, but force save every 10s
    const now = Date.now();
    if (_saveTimer) clearTimeout(_saveTimer);

    const timeSinceLastSave = now - _lastSaveTime;
    if (timeSinceLastSave >= 10000) {
        // Force immediate save if it's been 10s+
        _saveDatabaseNow();
    } else {
        // Debounce — save 2s after last call
        _saveTimer = setTimeout(_saveDatabaseNow, 2000);
    }
}

function _saveDatabaseNow() {
    if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
    try {
        const data   = db.export();
        const buffer = Buffer.from(data);
        const tmpPath = DB_PATH + '.tmp';
        fs.writeFileSync(tmpPath, buffer);
        fs.renameSync(tmpPath, DB_PATH);
        _lastSaveTime = Date.now();
    } catch (error) {
        console.error('Error saving database:', error);
    }
}

function dbGet(sql, params = []) {
    try {
        const stmt = db.prepare(sql);
        stmt.bind(params);
        if (stmt.step()) {
            const row = stmt.getAsObject();
            stmt.free();
            return row;
        }
        stmt.free();
        return null; // no row found — not an error
    } catch (error) {
        console.error('dbGet error:', error.message, 'SQL:', sql);
        return { error: true, message: error.message };
    }
}

function dbAll(sql, params = []) {
    try {
        const stmt    = db.prepare(sql);
        stmt.bind(params);
        const results = [];
        while (stmt.step()) {
            results.push(stmt.getAsObject());
        }
        stmt.free();
        return results;
    } catch (error) {
        console.error('dbAll error:', error.message, 'SQL:', sql);
        return [];
    }
}

function dbRun(sql, params = []) {
    try {
        db.run(sql, params);
        const lastInsertRowid = db.exec("SELECT last_insert_rowid()")[0]?.values[0]?.[0];
        saveDatabase();
        return { lastInsertRowid };
    } catch (error) {
        console.error('dbRun error:', error.message, 'SQL:', sql);
        return { lastInsertRowid: null, error: true, message: error.message };
    }
}

// Same as dbRun but silently swallows errors (for migrations, optional writes)
function dbRunSafe(sql, params = []) {
    try {
        db.run(sql, params);
        const lastInsertRowid = db.exec("SELECT last_insert_rowid()")[0]?.values[0]?.[0];
        saveDatabase();
        return { lastInsertRowid };
    } catch (error) {
        return { lastInsertRowid: null };
    }
}

// Insert without immediate save — for high-frequency logging
let _batchTimer = null;
function dbInsertNoSave(sql, params = []) {
    try {
        db.run(sql, params);
        if (!_batchTimer) {
            _batchTimer = setTimeout(() => { _batchTimer = null; saveDatabase(); }, 5000);
        }
    } catch (error) {
        console.error('dbInsertNoSave error:', error.message);
    }
}

// Run multiple operations atomically in a transaction
function dbTransaction(operations) {
    try {
        db.run('BEGIN TRANSACTION');
        const results = [];
        for (const { sql, params } of operations) {
            db.run(sql, params || []);
            const lastInsertRowid = db.exec("SELECT last_insert_rowid()")[0]?.values[0]?.[0];
            results.push({ lastInsertRowid });
        }
        db.run('COMMIT');
        saveDatabase();
        return results;
    } catch (error) {
        try { db.run('ROLLBACK'); } catch(e) {}
        console.error('dbTransaction error:', error.message);
        throw error;
    }
}

// Flush pending writes on process exit
function flushPendingWrites() {
    if (_batchTimer) { clearTimeout(_batchTimer); _batchTimer = null; }
    if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
    _saveDatabaseNow();
}
process.on('SIGTERM', flushPendingWrites);
process.on('SIGINT', flushPendingWrites);

module.exports = { initDatabase, saveDatabase, dbGet, dbAll, dbRun, dbRunSafe, dbInsertNoSave, dbTransaction, getDb: () => db };
