'use strict';

const request = require('supertest');
const express = require('express');
const session = require('express-session');
const axios = require('axios');
const { setupTestDatabase, getTestDb, closeTestDatabase } = require('./setup');
const { TEST_PASSWORD, TEST_PASSWORD_HASH, createTestUser } = require('./helpers');

let app;
let db;

// Mock db module
jest.mock('../db', () => {
    const setup = require('./setup');
    return {
        dbGet(sql, params = []) {
            const d = setup.getTestDb();
            try {
                const stmt = d.prepare(sql);
                stmt.bind(params);
                if (stmt.step()) {
                    const row = stmt.getAsObject();
                    stmt.free();
                    return row;
                }
                stmt.free();
                return null;
            } catch (e) {
                return null;
            }
        },
        dbAll(sql, params = []) {
            const d = setup.getTestDb();
            try {
                const stmt = d.prepare(sql);
                stmt.bind(params);
                const results = [];
                while (stmt.step()) results.push(stmt.getAsObject());
                stmt.free();
                return results;
            } catch (e) {
                return [];
            }
        },
        dbRun(sql, params = []) {
            const d = setup.getTestDb();
            try {
                d.run(sql, params);
                const last = d.exec('SELECT last_insert_rowid()');
                return { lastInsertRowid: last[0]?.values[0]?.[0] };
            } catch (e) {
                return { lastInsertRowid: null };
            }
        },
        saveDatabase: jest.fn()
    };
});

jest.mock('axios');

jest.mock('../middleware/auth', () => ({
    requireAuth(req, res, next) {
        if (!req.session.userId) return res.status(401).json({ error: 'Unauthorized' });
        next();
    }
}));

jest.mock('../utils/ip', () => ({
    getClientIP: () => '127.0.0.1'
}));

jest.mock('../utils/time', () => ({
    getLocalTime: () => new Date().toISOString()
}));

jest.mock('../services/market', () => ({
    getMarketPrices: jest.fn().mockResolvedValue({
        BTC: { price: 50000 },
        ETH: { price: 3000 }
    })
}));

jest.mock('../socket', () => ({
    getIo: () => null
}));

function createApp() {
    const a = express();
    a.use(express.json());
    a.use(session({
        secret: 'test-secret',
        resave: false,
        saveUninitialized: true,
        cookie: { secure: false }
    }));
    // Middleware to set session userId for authenticated routes
    a.use((req, res, next) => {
        if (req.headers['x-test-user-id']) {
            req.session.userId = parseInt(req.headers['x-test-user-id']);
        }
        next();
    });
    const ordersRouter = require('../routes/orders');
    a.use(ordersRouter);
    return a;
}

function createExtraTables() {
    db.run(`CREATE TABLE IF NOT EXISTS activity_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        action TEXT NOT NULL,
        details TEXT,
        ip_address TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
}

function insertUser(overrides = {}) {
    const data = {
        email: `user${Date.now()}${Math.random()}@test.com`,
        password: TEST_PASSWORD_HASH,
        full_name: 'Test User',
        role: 'user',
        demo_balance: 10000,
        real_balance: 0,
        active_account: 'demo',
        is_verified: 1,
        is_banned: 0,
        totp_enabled: 0,
        subscription_plan: 'free',
        ...overrides
    };
    db.run(
        `INSERT INTO users (email, password, full_name, role, demo_balance, real_balance, active_account, is_verified, is_banned, totp_enabled, subscription_plan)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [data.email, data.password, data.full_name, data.role, data.demo_balance, data.real_balance, data.active_account, data.is_verified, data.is_banned, data.totp_enabled, data.subscription_plan]
    );
    const row = db.exec('SELECT * FROM users WHERE email = ?', [data.email]);
    const columns = row[0].columns;
    const values = row[0].values[0];
    const user = {};
    columns.forEach((col, i) => { user[col] = values[i]; });
    return user;
}

beforeAll(async () => {
    db = await setupTestDatabase();
    createExtraTables();
    app = createApp();
});

afterAll(() => {
    closeTestDatabase();
});

afterEach(() => {
    jest.clearAllMocks();
});

// ==================== CREATE ORDER ====================

describe('POST /api/orders', () => {
    test('returns 401 without authentication', async () => {
        const res = await request(app)
            .post('/api/orders')
            .send({ symbol: 'BTC', side: 'buy', type: 'market', amount: 0.1 });

        expect(res.status).toBe(401);
    });

    test('returns 400 for missing required fields', async () => {
        const user = insertUser();
        const res = await request(app)
            .post('/api/orders')
            .set('x-test-user-id', String(user.id))
            .send({ symbol: 'BTC' });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/missing required/i);
    });

    test('returns 400 for invalid order side', async () => {
        const user = insertUser();
        const res = await request(app)
            .post('/api/orders')
            .set('x-test-user-id', String(user.id))
            .send({ symbol: 'BTC', side: 'hold', type: 'market', amount: 0.1 });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/invalid order side/i);
    });

    test('returns 400 for invalid order type', async () => {
        const user = insertUser();
        const res = await request(app)
            .post('/api/orders')
            .set('x-test-user-id', String(user.id))
            .send({ symbol: 'BTC', side: 'buy', type: 'stop', amount: 0.1 });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/invalid order type/i);
    });

    test('returns 400 for insufficient balance on market buy', async () => {
        const user = insertUser({ demo_balance: 100 });
        axios.get.mockResolvedValueOnce({ data: { price: '50000' } });

        const res = await request(app)
            .post('/api/orders')
            .set('x-test-user-id', String(user.id))
            .send({ symbol: 'BTC', side: 'buy', type: 'market', amount: 1 });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/insufficient balance/i);
    });

    test('creates a market buy order successfully', async () => {
        const user = insertUser({ demo_balance: 100000 });
        axios.get.mockResolvedValueOnce({ data: { price: '50000' } });

        const res = await request(app)
            .post('/api/orders')
            .set('x-test-user-id', String(user.id))
            .send({ symbol: 'BTC', side: 'buy', type: 'market', amount: 0.1 });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.order.symbol).toBe('BTC');
        expect(res.body.order.side).toBe('buy');
        expect(res.body.order.status).toBe('filled');
        expect(res.body.order.price).toBe(50000);
        expect(res.body.order.amount).toBe(0.1);
        expect(res.body.order.total).toBe(5000);
        expect(res.body.newBalance).toBe(95000);
    });

    test('creates a market sell order successfully', async () => {
        const user = insertUser({ demo_balance: 100000 });
        // Insert a holding for the user
        db.run(
            `INSERT INTO holdings (user_id, currency, amount, avg_buy_price, account_type)
             VALUES (?, ?, ?, ?, ?)`,
            [user.id, 'BTC', 1.0, 45000, 'demo']
        );
        axios.get.mockResolvedValueOnce({ data: { price: '50000' } });

        const res = await request(app)
            .post('/api/orders')
            .set('x-test-user-id', String(user.id))
            .send({ symbol: 'BTC', side: 'sell', type: 'market', amount: 0.5 });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.order.side).toBe('sell');
        expect(res.body.order.status).toBe('filled');
        expect(res.body.order.total).toBe(25000);
    });

    test('returns 400 for insufficient holdings on sell', async () => {
        const user = insertUser({ demo_balance: 100000 });
        axios.get.mockResolvedValueOnce({ data: { price: '50000' } });

        const res = await request(app)
            .post('/api/orders')
            .set('x-test-user-id', String(user.id))
            .send({ symbol: 'ETH', side: 'sell', type: 'market', amount: 10 });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/insufficient holdings/i);
    });

    test('returns 400 when market price fetch fails', async () => {
        const user = insertUser({ demo_balance: 100000 });
        axios.get.mockRejectedValueOnce(new Error('Network error'));

        const res = await request(app)
            .post('/api/orders')
            .set('x-test-user-id', String(user.id))
            .send({ symbol: 'BTC', side: 'buy', type: 'market', amount: 0.1 });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/could not fetch market price/i);
    });

    test('creates a limit buy order successfully', async () => {
        const user = insertUser({ demo_balance: 100000 });

        const res = await request(app)
            .post('/api/orders')
            .set('x-test-user-id', String(user.id))
            .send({ symbol: 'BTC', side: 'buy', type: 'limit', price: 45000, amount: 0.1 });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.order.type).toBe('limit');
        expect(res.body.order.status).toBe('open');
        expect(res.body.order.filled).toBe(0);
        expect(res.body.order.price).toBe(45000);
    });

    test('creates a limit sell order successfully', async () => {
        const user = insertUser({ demo_balance: 100000 });
        db.run(
            `INSERT INTO holdings (user_id, currency, amount, avg_buy_price, account_type)
             VALUES (?, ?, ?, ?, ?)`,
            [user.id, 'ETH', 5.0, 3000, 'demo']
        );

        const res = await request(app)
            .post('/api/orders')
            .set('x-test-user-id', String(user.id))
            .send({ symbol: 'ETH', side: 'sell', type: 'limit', price: 3500, amount: 2 });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.order.status).toBe('open');
    });

    test('returns 404 for non-existent user', async () => {
        const res = await request(app)
            .post('/api/orders')
            .set('x-test-user-id', '99999')
            .send({ symbol: 'BTC', side: 'buy', type: 'market', amount: 0.1 });

        expect(res.status).toBe(404);
        expect(res.body.error).toMatch(/user not found/i);
    });
});

// ==================== GET ORDERS ====================

describe('GET /api/orders', () => {
    test('returns 401 without authentication', async () => {
        const res = await request(app).get('/api/orders');
        expect(res.status).toBe(401);
    });

    test('returns user orders', async () => {
        const user = insertUser();
        db.run(
            `INSERT INTO orders (user_id, symbol, side, type, price, amount, status, account_type)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [user.id, 'BTC', 'buy', 'limit', 50000, 0.1, 'open', 'demo']
        );

        const res = await request(app)
            .get('/api/orders')
            .set('x-test-user-id', String(user.id));

        expect(res.status).toBe(200);
        expect(res.body.orders).toBeInstanceOf(Array);
        expect(res.body.orders.length).toBeGreaterThanOrEqual(1);
    });

    test('filters orders by status', async () => {
        const user = insertUser();
        db.run(
            `INSERT INTO orders (user_id, symbol, side, type, price, amount, status, account_type)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [user.id, 'BTC', 'buy', 'limit', 50000, 0.1, 'open', 'demo']
        );
        db.run(
            `INSERT INTO orders (user_id, symbol, side, type, price, amount, status, account_type)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [user.id, 'ETH', 'sell', 'market', 3000, 1, 'filled', 'demo']
        );

        const res = await request(app)
            .get('/api/orders?status=open')
            .set('x-test-user-id', String(user.id));

        expect(res.status).toBe(200);
        res.body.orders.forEach(order => {
            expect(order.status).toBe('open');
        });
    });
});

// ==================== GET ORDER HISTORY ====================

describe('GET /api/orders/history', () => {
    test('returns 401 without authentication', async () => {
        const res = await request(app).get('/api/orders/history');
        expect(res.status).toBe(401);
    });

    test('returns order history with pagination', async () => {
        const user = insertUser();
        for (let i = 0; i < 3; i++) {
            db.run(
                `INSERT INTO orders (user_id, symbol, side, type, price, amount, status, account_type)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [user.id, 'BTC', 'buy', 'market', 50000, 0.1, 'filled', 'demo']
            );
        }

        const res = await request(app)
            .get('/api/orders/history?page=1&limit=2')
            .set('x-test-user-id', String(user.id));

        expect(res.status).toBe(200);
        expect(res.body.orders).toBeInstanceOf(Array);
        expect(res.body.orders.length).toBeLessThanOrEqual(2);
        expect(res.body).toHaveProperty('total');
        expect(res.body).toHaveProperty('page', 1);
        expect(res.body).toHaveProperty('totalPages');
    });
});

// ==================== CANCEL ORDER ====================

describe('DELETE /api/orders/:id', () => {
    test('returns 401 without authentication', async () => {
        const res = await request(app).delete('/api/orders/1');
        expect(res.status).toBe(401);
    });

    test('cancels an open order', async () => {
        const user = insertUser();
        db.run(
            `INSERT INTO orders (user_id, symbol, side, type, price, amount, status, account_type)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [user.id, 'BTC', 'buy', 'limit', 45000, 0.1, 'open', 'demo']
        );
        const row = db.exec('SELECT last_insert_rowid() as id');
        const orderId = row[0].values[0][0];

        const res = await request(app)
            .delete(`/api/orders/${orderId}`)
            .set('x-test-user-id', String(user.id));

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    test('returns 404 for non-existent order', async () => {
        const user = insertUser();
        const res = await request(app)
            .delete('/api/orders/99999')
            .set('x-test-user-id', String(user.id));

        expect(res.status).toBe(404);
        expect(res.body.error).toMatch(/order not found/i);
    });

    test('returns 400 when cancelling non-open order', async () => {
        const user = insertUser();
        db.run(
            `INSERT INTO orders (user_id, symbol, side, type, price, amount, status, account_type)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [user.id, 'BTC', 'buy', 'market', 50000, 0.1, 'filled', 'demo']
        );
        const row = db.exec('SELECT last_insert_rowid() as id');
        const orderId = row[0].values[0][0];

        const res = await request(app)
            .delete(`/api/orders/${orderId}`)
            .set('x-test-user-id', String(user.id));

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/only cancel open/i);
    });

    test('cannot cancel another user\'s order', async () => {
        const user1 = insertUser();
        const user2 = insertUser();
        db.run(
            `INSERT INTO orders (user_id, symbol, side, type, price, amount, status, account_type)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [user1.id, 'BTC', 'buy', 'limit', 45000, 0.1, 'open', 'demo']
        );
        const row = db.exec('SELECT last_insert_rowid() as id');
        const orderId = row[0].values[0][0];

        const res = await request(app)
            .delete(`/api/orders/${orderId}`)
            .set('x-test-user-id', String(user2.id));

        expect(res.status).toBe(404);
    });
});

// ==================== GET HOLDINGS ====================

describe('GET /api/holdings', () => {
    test('returns 401 without authentication', async () => {
        const res = await request(app).get('/api/holdings');
        expect(res.status).toBe(401);
    });

    test('returns enriched holdings with market data', async () => {
        const user = insertUser();
        db.run(
            `INSERT INTO holdings (user_id, currency, amount, avg_buy_price, account_type)
             VALUES (?, ?, ?, ?, ?)`,
            [user.id, 'BTC', 0.5, 45000, 'demo']
        );

        const res = await request(app)
            .get('/api/holdings')
            .set('x-test-user-id', String(user.id));

        expect(res.status).toBe(200);
        expect(res.body.holdings).toBeInstanceOf(Array);
        expect(res.body).toHaveProperty('totalValue');
    });
});

// ==================== GET SINGLE HOLDING ====================

describe('GET /api/holdings/:currency', () => {
    test('returns 401 without authentication', async () => {
        const res = await request(app).get('/api/holdings/BTC');
        expect(res.status).toBe(401);
    });

    test('returns holding for existing currency', async () => {
        const user = insertUser();
        db.run(
            `INSERT INTO holdings (user_id, currency, amount, avg_buy_price, account_type)
             VALUES (?, ?, ?, ?, ?)`,
            [user.id, 'ETH', 2.0, 3000, 'demo']
        );

        const res = await request(app)
            .get('/api/holdings/ETH')
            .set('x-test-user-id', String(user.id));

        expect(res.status).toBe(200);
        expect(res.body.currency).toBe('ETH');
        expect(res.body.amount).toBe(2.0);
        expect(res.body.avgBuyPrice).toBe(3000);
    });

    test('returns zero amount for non-existent holding', async () => {
        const user = insertUser();

        const res = await request(app)
            .get('/api/holdings/DOGE')
            .set('x-test-user-id', String(user.id));

        expect(res.status).toBe(200);
        expect(res.body.currency).toBe('DOGE');
        expect(res.body.amount).toBe(0);
    });
});
