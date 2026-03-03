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
    try { db.run('ALTER TABLE bots ADD COLUMN category_id INTEGER DEFAULT NULL'); } catch(e) {}
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
    try { db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_bot_trades_binance_id ON bot_trades(bot_id, binance_trade_id) WHERE binance_trade_id IS NOT NULL'); } catch(e) {}
    try { db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_bot_trades_close_id ON bot_trades(bot_id, binance_close_trade_id) WHERE binance_close_trade_id IS NOT NULL'); } catch(e) {}

    db.run(`
        CREATE TABLE IF NOT EXISTS bot_stats (
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
    `);

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
            user_id INTEGER NOT NULL,
            action TEXT NOT NULL,
            details TEXT,
            ip_address TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS login_attempts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ip_address TEXT NOT NULL,
            user_email TEXT,
            success INTEGER DEFAULT 0,
            attempt_time TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

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

    saveDatabase();
    console.log('Database initialized');
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
        fs.writeFileSync(DB_PATH, buffer);
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
        return null;
    } catch (error) {
        console.error('dbGet error:', error.message, 'SQL:', sql);
        return null;
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
        return { lastInsertRowid: null };
    }
}

module.exports = { initDatabase, saveDatabase, dbGet, dbAll, dbRun, getDb: () => db };
