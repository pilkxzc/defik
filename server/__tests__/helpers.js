'use strict';

const bcrypt = require('bcryptjs');
const { getTestDb } = require('./setup');

const TEST_PASSWORD = 'TestPass123!';
const TEST_PASSWORD_HASH = bcrypt.hashSync(TEST_PASSWORD, 10);

let userCounter = 0;

/**
 * Create a test user in the database.
 * @param {Object} [overrides] - Field overrides for the user row.
 * @returns {Object} The created user row.
 */
function createTestUser(overrides = {}) {
    const db = getTestDb();
    userCounter++;
    const defaults = {
        email: `testuser${userCounter}_${Date.now()}@example.com`,
        password: TEST_PASSWORD_HASH,
        full_name: `Test User ${userCounter}`,
        role: 'user',
        demo_balance: 10000,
        real_balance: 0,
        active_account: 'demo',
        is_verified: 1,
        is_banned: 0,
        totp_enabled: 0,
        subscription_plan: 'free'
    };
    const data = { ...defaults, ...overrides };

    db.run(
        `INSERT INTO users (email, password, full_name, role, demo_balance, real_balance, active_account, is_verified, is_banned, totp_enabled, subscription_plan)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [data.email, data.password, data.full_name, data.role, data.demo_balance, data.real_balance, data.active_account, data.is_verified, data.is_banned, data.totp_enabled, data.subscription_plan]
    );

    const row = db.exec('SELECT * FROM users WHERE email = ?', [data.email]);
    if (row.length && row[0].values.length) {
        const columns = row[0].columns;
        const values = row[0].values[0];
        const user = {};
        columns.forEach((col, i) => { user[col] = values[i]; });
        return user;
    }
    return null;
}

/**
 * Create a test admin user.
 * @param {Object} [overrides] - Field overrides.
 * @returns {Object} The created admin user row.
 */
function createTestAdmin(overrides = {}) {
    return createTestUser({ role: 'admin', ...overrides });
}

/**
 * Create a test order in the database.
 * @param {number} userId
 * @param {Object} [overrides]
 * @returns {Object} The created order row.
 */
function createTestOrder(userId, overrides = {}) {
    const db = getTestDb();
    const defaults = {
        symbol: 'BTCUSDT',
        side: 'buy',
        type: 'market',
        price: 50000,
        amount: 0.1,
        status: 'open',
        account_type: 'demo'
    };
    const data = { ...defaults, ...overrides };

    db.run(
        `INSERT INTO orders (user_id, symbol, side, type, price, amount, status, account_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, data.symbol, data.side, data.type, data.price, data.amount, data.status, data.account_type]
    );

    const row = db.exec('SELECT last_insert_rowid() as id');
    const id = row[0].values[0][0];
    return { id, user_id: userId, ...data };
}

/**
 * Create a test bot in the database.
 * @param {number} userId
 * @param {Object} [overrides]
 * @returns {Object} The created bot row.
 */
function createTestBot(userId, overrides = {}) {
    const db = getTestDb();
    const defaults = {
        name: 'Test Bot',
        type: 'grid',
        pair: 'BTCUSDT',
        investment: 1000,
        is_active: 0,
        mode: 'test'
    };
    const data = { ...defaults, ...overrides };

    db.run(
        `INSERT INTO bots (user_id, name, type, pair, investment, is_active, mode)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [userId, data.name, data.type, data.pair, data.investment, data.is_active, data.mode]
    );

    const row = db.exec('SELECT last_insert_rowid() as id');
    const id = row[0].values[0][0];
    return { id, user_id: userId, ...data };
}

/**
 * Helper to build a mock session object for testing middleware.
 * @param {Object} [sessionData]
 * @returns {Object}
 */
function mockSession(sessionData = {}) {
    return {
        userId: null,
        betaAccess: true,
        ...sessionData
    };
}

/**
 * Helper to build a mock request object.
 * @param {Object} [overrides]
 * @returns {Object}
 */
function mockRequest(overrides = {}) {
    return {
        session: mockSession(overrides.session),
        body: {},
        params: {},
        query: {},
        headers: {},
        ...overrides
    };
}

/**
 * Helper to build a mock response object.
 * @returns {Object}
 */
function mockResponse() {
    const res = {
        statusCode: 200,
        _json: null,
        _sent: null
    };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (data) => { res._json = data; return res; };
    res.send = (data) => { res._sent = data; return res; };
    res.redirect = (url) => { res._redirect = url; return res; };
    return res;
}

module.exports = {
    TEST_PASSWORD,
    TEST_PASSWORD_HASH,
    createTestUser,
    createTestAdmin,
    createTestOrder,
    createTestBot,
    mockSession,
    mockRequest,
    mockResponse
};
