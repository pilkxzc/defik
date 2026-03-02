'use strict';

const initSqlJs = require('sql.js');

let db;

/**
 * Initialize an in-memory SQLite database for testing.
 * Mirrors the schema from server/db/index.js but never touches disk.
 */
async function setupTestDatabase() {
    const SQL = await initSqlJs();
    db = new SQL.Database();

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
            verification_level INTEGER DEFAULT 0,
            role TEXT DEFAULT 'user',
            is_banned INTEGER DEFAULT 0,
            ban_reason TEXT,
            totp_secret TEXT,
            totp_enabled INTEGER DEFAULT 0,
            backup_codes TEXT,
            avatar TEXT,
            subscription_plan TEXT DEFAULT 'free',
            subscription_expires_at TEXT,
            telegram_id TEXT,
            telegram_code TEXT,
            telegram_verified INTEGER DEFAULT 0,
            telegram_username TEXT
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
            binance_api_key TEXT,
            binance_api_secret TEXT,
            mode TEXT DEFAULT 'test',
            display_settings TEXT DEFAULT '{}',
            account_type TEXT DEFAULT 'futures',
            selected_symbol TEXT DEFAULT 'BTCUSDT',
            trading_settings TEXT DEFAULT '{}',
            category_id INTEGER DEFAULT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            type TEXT NOT NULL,
            title TEXT NOT NULL,
            message TEXT,
            is_read INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

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

    db.run(`
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS email_verification_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token TEXT NOT NULL,
            expires_at TEXT NOT NULL,
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

    return db;
}

function getTestDb() {
    return db;
}

function closeTestDatabase() {
    if (db) {
        db.close();
        db = null;
    }
}

module.exports = {
    setupTestDatabase,
    getTestDb,
    closeTestDatabase
};
