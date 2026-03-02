'use strict';

const request = require('supertest');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const speakeasy = require('speakeasy');
const { setupTestDatabase, getTestDb, closeTestDatabase } = require('./setup');
const { TEST_PASSWORD, TEST_PASSWORD_HASH } = require('./helpers');

let app;
let db;

// Mock db module to use test database
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

// Mock services
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

// Helper: create tables missing from setup.js that auth routes need
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
    // Add missing columns to existing tables
    try { db.run('ALTER TABLE password_reset_tokens ADD COLUMN used INTEGER DEFAULT 0'); } catch(e) {}
    try { db.run('ALTER TABLE email_verification_tokens ADD COLUMN used INTEGER DEFAULT 0'); } catch(e) {}
    try { db.run('ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0'); } catch(e) {}
    try { db.run('ALTER TABLE users ADD COLUMN last_ip TEXT'); } catch(e) {}
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

// ==================== REGISTER ====================

describe('POST /api/auth/register', () => {
    test('registers a new user successfully', async () => {
        const res = await request(app)
            .post('/api/auth/register')
            .send({ email: 'newuser@test.com', password: 'Pass123!', fullName: 'New User' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.user.email).toBe('newuser@test.com');
        expect(res.body.user.demoBalance).toBe(10000);
    });

    test('returns 400 for missing fields', async () => {
        const res = await request(app)
            .post('/api/auth/register')
            .send({ email: 'x@test.com' });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/required/i);
    });

    test('returns 400 for duplicate email', async () => {
        const email = 'dup@test.com';
        await request(app)
            .post('/api/auth/register')
            .send({ email, password: 'Pass123!', fullName: 'Dup User' });

        const res = await request(app)
            .post('/api/auth/register')
            .send({ email, password: 'Pass123!', fullName: 'Dup User 2' });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/already registered/i);
    });

    test('sets admin role for admin email', async () => {
        const res = await request(app)
            .post('/api/auth/register')
            .send({ email: 'admin@test.com', password: 'Admin123!', fullName: 'Admin' });

        expect(res.status).toBe(200);
        // Verify in DB
        const row = db.exec('SELECT role FROM users WHERE email = ?', ['admin@test.com']);
        expect(row[0].values[0][0]).toBe('admin');
    });
});

// ==================== LOGIN ====================

describe('POST /api/auth/login', () => {
    const loginEmail = 'loginuser@test.com';

    beforeAll(() => {
        insertUser({ email: loginEmail });
    });

    test('logs in with valid credentials', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({ email: loginEmail, password: TEST_PASSWORD });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.user.email).toBe(loginEmail);
    });

    test('returns 400 for missing fields', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({ email: loginEmail });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/required/i);
    });

    test('returns 401 for wrong password', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({ email: loginEmail, password: 'WrongPass!' });

        expect(res.status).toBe(401);
        expect(res.body.error).toMatch(/invalid credentials/i);
    });

    test('returns 401 for non-existent user', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({ email: 'nobody@test.com', password: 'Pass123!' });

        expect(res.status).toBe(401);
    });

    test('returns 403 for banned user', async () => {
        const banned = insertUser({ email: `banned${Date.now()}@test.com`, is_banned: 1 });
        const res = await request(app)
            .post('/api/auth/login')
            .send({ email: banned.email, password: TEST_PASSWORD });

        expect(res.status).toBe(403);
        expect(res.body.banned).toBe(true);
    });
});

// ==================== 2FA ====================

describe('2FA login flow', () => {
    let totpEmail;
    let totpSecret;

    beforeAll(() => {
        totpSecret = speakeasy.generateSecret();
        totpEmail = `totp${Date.now()}@test.com`;
        insertUser({
            email: totpEmail,
            totp_enabled: 1
        });
        // Set totp_secret directly
        db.run('UPDATE users SET totp_secret = ?, backup_codes = ? WHERE email = ?',
            [totpSecret.base32, JSON.stringify(['BACKUP01']), totpEmail]);
    });

    test('returns requires2FA when no totp token provided', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({ email: totpEmail, password: TEST_PASSWORD });

        expect(res.status).toBe(200);
        expect(res.body.requires2FA).toBe(true);
    });

    test('logs in with valid TOTP token', async () => {
        const token = speakeasy.totp({ secret: totpSecret.base32, encoding: 'base32' });
        const res = await request(app)
            .post('/api/auth/login')
            .send({ email: totpEmail, password: TEST_PASSWORD, totpToken: token });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    test('rejects invalid TOTP token', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({ email: totpEmail, password: TEST_PASSWORD, totpToken: '000000' });

        expect(res.status).toBe(401);
        expect(res.body.error).toMatch(/invalid 2fa/i);
    });

    test('allows login with backup code', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({ email: totpEmail, password: TEST_PASSWORD, totpToken: 'BACKUP01' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);

        // Backup code should be consumed
        const row = db.exec('SELECT backup_codes FROM users WHERE email = ?', [totpEmail]);
        const codes = JSON.parse(row[0].values[0][0]);
        expect(codes).not.toContain('BACKUP01');
    });
});

// ==================== LOGOUT ====================

describe('POST /api/auth/logout', () => {
    test('logs out successfully', async () => {
        const res = await request(app)
            .post('/api/auth/logout');

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });
});

// ==================== GET /api/auth/me ====================

describe('GET /api/auth/me', () => {
    test('returns 401 without session', async () => {
        const res = await request(app)
            .get('/api/auth/me');

        expect(res.status).toBe(401);
    });

    test('returns user data with valid session', async () => {
        const agent = request.agent(app);
        const email = `me${Date.now()}@test.com`;

        // Register to get a session
        await agent
            .post('/api/auth/register')
            .send({ email, password: 'Pass123!', fullName: 'Me User' });

        const res = await agent.get('/api/auth/me');

        expect(res.status).toBe(200);
        expect(res.body.email).toBe(email);
        expect(res.body.fullName).toBe('Me User');
        expect(res.body).toHaveProperty('demoBalance');
        expect(res.body).toHaveProperty('activeAccount');
    });
});

// ==================== SESSION ENDPOINT ====================

describe('GET /api/auth/session', () => {
    test('returns 401 without session', async () => {
        const res = await request(app).get('/api/auth/session');
        expect(res.status).toBe(401);
    });

    test('returns session info with valid session', async () => {
        const agent = request.agent(app);
        const email = `sess${Date.now()}@test.com`;

        await agent
            .post('/api/auth/register')
            .send({ email, password: 'Pass123!', fullName: 'Session User' });

        const res = await agent.get('/api/auth/session');

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('currentIP');
        expect(res.body).toHaveProperty('recentActivity');
    });
});

// ==================== PASSWORD RESET ====================

describe('Password reset flow', () => {
    test('POST /api/auth/forgot-password returns success even for non-existent email', async () => {
        const res = await request(app)
            .post('/api/auth/forgot-password')
            .send({ email: 'nonexistent@test.com' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    test('POST /api/auth/forgot-password returns 400 without email', async () => {
        const res = await request(app)
            .post('/api/auth/forgot-password')
            .send({});

        expect(res.status).toBe(400);
    });

    test('POST /api/auth/reset-password returns 400 for invalid token', async () => {
        const res = await request(app)
            .post('/api/auth/reset-password')
            .send({ token: 'invalidtoken', newPassword: 'NewPass123!' });

        expect(res.status).toBe(400);
    });

    test('POST /api/auth/reset-password returns 400 for short password', async () => {
        const res = await request(app)
            .post('/api/auth/reset-password')
            .send({ token: 'sometoken', newPassword: '12345' });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/at least 6/i);
    });
});

// ==================== ACCOUNT SWITCH ====================

describe('POST /api/account/switch', () => {
    test('returns 401 without session', async () => {
        const res = await request(app)
            .post('/api/account/switch')
            .send({ accountType: 'demo' });

        expect(res.status).toBe(401);
    });

    test('returns 400 for invalid account type', async () => {
        const agent = request.agent(app);
        const email = `switch${Date.now()}@test.com`;

        await agent.post('/api/auth/register')
            .send({ email, password: 'Pass123!', fullName: 'Switch User' });

        const res = await agent.post('/api/account/switch')
            .send({ accountType: 'invalid' });

        expect(res.status).toBe(400);
    });

    test('returns 403 for real account (not available)', async () => {
        const agent = request.agent(app);
        const email = `switchreal${Date.now()}@test.com`;

        await agent.post('/api/auth/register')
            .send({ email, password: 'Pass123!', fullName: 'Switch Real User' });

        const res = await agent.post('/api/account/switch')
            .send({ accountType: 'real' });

        expect(res.status).toBe(403);
    });
});

// ==================== 2FA SETUP ENDPOINTS ====================

describe('2FA setup endpoints', () => {
    test('GET /api/2fa/status returns 401 without session', async () => {
        const res = await request(app).get('/api/2fa/status');
        expect(res.status).toBe(401);
    });

    test('GET /api/2fa/status returns enabled status', async () => {
        const agent = request.agent(app);
        const email = `tfa${Date.now()}@test.com`;

        await agent.post('/api/auth/register')
            .send({ email, password: 'Pass123!', fullName: '2FA User' });

        const res = await agent.get('/api/2fa/status');
        expect(res.status).toBe(200);
        expect(res.body.enabled).toBe(false);
    });

    test('POST /api/2fa/setup generates secret and QR', async () => {
        const agent = request.agent(app);
        const email = `tfasetup${Date.now()}@test.com`;

        await agent.post('/api/auth/register')
            .send({ email, password: 'Pass123!', fullName: '2FA Setup' });

        const res = await agent.post('/api/2fa/setup');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body).toHaveProperty('secret');
        expect(res.body).toHaveProperty('qrCode');
        expect(res.body).toHaveProperty('backupCodes');
        expect(res.body.backupCodes).toHaveLength(5);
    });

    test('POST /api/2fa/verify enables 2FA with valid token', async () => {
        const agent = request.agent(app);
        const email = `tfaver${Date.now()}@test.com`;

        await agent.post('/api/auth/register')
            .send({ email, password: 'Pass123!', fullName: '2FA Verify' });

        const setupRes = await agent.post('/api/2fa/setup');
        const secret = setupRes.body.secret;

        const token = speakeasy.totp({ secret, encoding: 'base32' });
        const res = await agent.post('/api/2fa/verify').send({ token });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    test('POST /api/2fa/verify rejects invalid token', async () => {
        const agent = request.agent(app);
        const email = `tfabad${Date.now()}@test.com`;

        await agent.post('/api/auth/register')
            .send({ email, password: 'Pass123!', fullName: '2FA Bad' });

        await agent.post('/api/2fa/setup');

        const res = await agent.post('/api/2fa/verify').send({ token: '000000' });
        expect(res.status).toBe(400);
    });
});

// ==================== IP ENDPOINT ====================

describe('GET /api/auth/ip', () => {
    test('returns IP and timestamp', async () => {
        const res = await request(app).get('/api/auth/ip');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('ip');
        expect(res.body).toHaveProperty('timestamp');
    });
});
