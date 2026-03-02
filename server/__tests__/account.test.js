'use strict';

const request = require('supertest');
const express = require('express');
const session = require('express-session');
const { setupTestDatabase, getTestDb, closeTestDatabase } = require('./setup');
const { TEST_PASSWORD, TEST_PASSWORD_HASH, createTestUser } = require('./helpers');

let app;
let db;

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
        }
    };
});

jest.mock('../services/notifications', () => ({
    createNotification: jest.fn()
}));

jest.mock('../services/email', () => ({
    sendVerificationEmail: jest.fn(),
    sendPasswordResetEmail: jest.fn()
}));

jest.mock('../config', () => ({
    ADMIN_EMAIL: 'admin@test.com',
    siteSettings: { telegramBotToken: '', telegramBotUsername: '' }
}));

jest.mock('../utils/ip', () => ({
    getClientIP: () => '127.0.0.1'
}));

jest.mock('../utils/time', () => ({
    getLocalTime: () => new Date().toISOString()
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
    const authRouter = require('../routes/auth');
    a.use(authRouter);
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
    db.run(`CREATE TABLE IF NOT EXISTS passkeys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        credential_id TEXT UNIQUE NOT NULL,
        public_key TEXT NOT NULL,
        counter INTEGER DEFAULT 0,
        device_type TEXT,
        last_used_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    try { db.run('ALTER TABLE password_reset_tokens ADD COLUMN used INTEGER DEFAULT 0'); } catch(e) {}
    try { db.run('ALTER TABLE email_verification_tokens ADD COLUMN used INTEGER DEFAULT 0'); } catch(e) {}
    try { db.run('ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0'); } catch(e) {}
    try { db.run('ALTER TABLE users ADD COLUMN last_ip TEXT'); } catch(e) {}
}

beforeAll(async () => {
    db = await setupTestDatabase();
    createExtraTables();
    app = createApp();
});

afterAll(() => {
    closeTestDatabase();
});

// ==================== ACCOUNT SWITCH ====================

describe('POST /api/account/switch', () => {
    test('returns 401 without session', async () => {
        const res = await request(app)
            .post('/api/account/switch')
            .send({ accountType: 'demo' });

        expect(res.status).toBe(401);
    });

    test('switches to demo account successfully', async () => {
        const agent = request.agent(app);
        const email = `acctdemo${Date.now()}@test.com`;

        await agent.post('/api/auth/register')
            .send({ email, password: 'Pass123!', fullName: 'Demo Switch User' });

        const res = await agent.post('/api/account/switch')
            .send({ accountType: 'demo' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.activeAccount).toBe('demo');
        expect(res.body.balance).toBe(10000);
    });

    test('returns 400 for invalid account type', async () => {
        const agent = request.agent(app);
        const email = `acctinv${Date.now()}@test.com`;

        await agent.post('/api/auth/register')
            .send({ email, password: 'Pass123!', fullName: 'Invalid Switch User' });

        const res = await agent.post('/api/account/switch')
            .send({ accountType: 'invalid' });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/invalid account type/i);
    });

    test('returns 400 when accountType is missing', async () => {
        const agent = request.agent(app);
        const email = `acctmiss${Date.now()}@test.com`;

        await agent.post('/api/auth/register')
            .send({ email, password: 'Pass123!', fullName: 'Missing Type User' });

        const res = await agent.post('/api/account/switch')
            .send({});

        expect(res.status).toBe(400);
    });

    test('returns 403 for real account (not available)', async () => {
        const agent = request.agent(app);
        const email = `acctreal${Date.now()}@test.com`;

        await agent.post('/api/auth/register')
            .send({ email, password: 'Pass123!', fullName: 'Real Switch User' });

        const res = await agent.post('/api/account/switch')
            .send({ accountType: 'real' });

        expect(res.status).toBe(403);
        expect(res.body.disabled).toBe(true);
    });
});

// ==================== INDEPENDENT BALANCES ====================

describe('Independent demo/real balances', () => {
    test('new user starts with 10000 demo and 0 real balance', async () => {
        const agent = request.agent(app);
        const email = `balances${Date.now()}@test.com`;

        await agent.post('/api/auth/register')
            .send({ email, password: 'Pass123!', fullName: 'Balance User' });

        const res = await agent.get('/api/auth/me');

        expect(res.status).toBe(200);
        expect(res.body.demoBalance).toBe(10000);
        expect(res.body.realBalance).toBe(0);
        expect(res.body.activeAccount).toBe('demo');
    });

    test('active balance reflects current account type', async () => {
        const agent = request.agent(app);
        const email = `activebal${Date.now()}@test.com`;

        await agent.post('/api/auth/register')
            .send({ email, password: 'Pass123!', fullName: 'Active Balance User' });

        const meRes = await agent.get('/api/auth/me');

        // On demo account, balance should equal demoBalance
        expect(meRes.body.balance).toBe(meRes.body.demoBalance);
        expect(meRes.body.activeAccount).toBe('demo');
    });

    test('demo and real balances are independent in database', async () => {
        const user = createTestUser({
            email: `indepbal${Date.now()}@test.com`,
            demo_balance: 5000,
            real_balance: 250
        });

        // Verify balances stored independently
        const row = db.exec('SELECT demo_balance, real_balance FROM users WHERE id = ?', [user.id]);
        expect(row[0].values[0][0]).toBe(5000);
        expect(row[0].values[0][1]).toBe(250);
    });

    test('switching account does not alter balances', async () => {
        const agent = request.agent(app);
        const email = `noalter${Date.now()}@test.com`;

        await agent.post('/api/auth/register')
            .send({ email, password: 'Pass123!', fullName: 'No Alter User' });

        // Switch to demo (already demo, but confirms no mutation)
        await agent.post('/api/account/switch')
            .send({ accountType: 'demo' });

        const meRes = await agent.get('/api/auth/me');
        expect(meRes.body.demoBalance).toBe(10000);
        expect(meRes.body.realBalance).toBe(0);
    });
});

// ==================== ACCOUNT INFO ====================

describe('GET /api/account/info', () => {
    test('returns 401 without session', async () => {
        const res = await request(app).get('/api/account/info');
        expect(res.status).toBe(401);
    });

    test('returns account info with valid session', async () => {
        const agent = request.agent(app);
        const email = `acctinfo${Date.now()}@test.com`;

        await agent.post('/api/auth/register')
            .send({ email, password: 'Pass123!', fullName: 'Info User' });

        const res = await agent.get('/api/account/info');

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('activeAccount');
        expect(res.body).toHaveProperty('demoBalance');
        expect(res.body).toHaveProperty('realBalance');
        expect(res.body.activeAccount).toBe('demo');
    });
});
