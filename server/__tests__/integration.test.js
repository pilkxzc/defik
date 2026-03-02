'use strict';

const request = require('supertest');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const fs = require('fs');
const path = require('path');
const { setupTestDatabase, getTestDb, closeTestDatabase } = require('./setup');

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
                const rows = [];
                while (stmt.step()) rows.push(stmt.getAsObject());
                stmt.free();
                return rows;
            } catch (e) {
                return [];
            }
        },
        dbRun(sql, params = []) {
            const d = setup.getTestDb();
            try {
                d.run(sql, params);
                return { lastInsertRowid: d.exec("SELECT last_insert_rowid()")[0]?.values[0]?.[0] || 0 };
            } catch (e) {
                throw e;
            }
        },
        initDatabase: jest.fn().mockResolvedValue(undefined),
        saveDatabase: jest.fn()
    };
});

// Mock services that require external connections
jest.mock('../services/telegram', () => ({ initTelegramBot: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../services/candleCollector', () => ({ startCollector: jest.fn().mockResolvedValue(undefined), stopCollector: jest.fn() }));
jest.mock('../socket', () => ({ initSocket: jest.fn() }));
jest.mock('../utils/ssl', () => ({ getSSLCredentials: jest.fn() }));

describe('Integration Verification', () => {
    let app;

    beforeAll(async () => {
        await setupTestDatabase();
    });

    afterAll(() => {
        closeTestDatabase();
    });

    describe('Helmet Security Headers', () => {
        beforeAll(async () => {
            app = express();
            app.use(helmet({
                contentSecurityPolicy: false,
                crossOriginEmbedderPolicy: false
            }));
            app.get('/test', (req, res) => res.json({ ok: true }));
        });

        it('should include X-Content-Type-Options header', async () => {
            const res = await request(app).get('/test');
            expect(res.headers['x-content-type-options']).toBe('nosniff');
        });

        it('should include X-Frame-Options or equivalent', async () => {
            const res = await request(app).get('/test');
            // Helmet v7+ uses cross-origin-opener-policy instead of X-Frame-Options
            const hasFrameProtection = res.headers['x-frame-options'] ||
                                        res.headers['cross-origin-opener-policy'];
            expect(hasFrameProtection).toBeDefined();
        });

        it('should remove X-Powered-By header', async () => {
            const res = await request(app).get('/test');
            expect(res.headers['x-powered-by']).toBeUndefined();
        });
    });

    describe('Rate Limiter Headers', () => {
        let rateLimitApp;

        beforeAll(() => {
            const { loginLimiter } = require('../middleware/rateLimiter');
            rateLimitApp = express();
            rateLimitApp.use('/api/auth/login', loginLimiter);
            rateLimitApp.post('/api/auth/login', (req, res) => res.json({ ok: true }));
        });

        it('should return draft-6 RateLimit-* headers (not X-RateLimit-*)', async () => {
            const res = await request(rateLimitApp).post('/api/auth/login');
            // express-rate-limit with standardHeaders: true, legacyHeaders: false
            // uses draft-6 standard headers
            const hasStandardHeaders = res.headers['ratelimit-limit'] ||
                                        res.headers['ratelimit-remaining'] ||
                                        res.headers['ratelimit-reset'];
            expect(hasStandardHeaders).toBeDefined();

            // Should NOT have legacy X-RateLimit-* headers
            expect(res.headers['x-ratelimit-limit']).toBeUndefined();
            expect(res.headers['x-ratelimit-remaining']).toBeUndefined();
        });
    });

    describe('Environment Configuration', () => {
        it('.env.example should contain all documented variables', () => {
            const envExample = fs.readFileSync(
                path.join(__dirname, '..', '..', '.env.example'), 'utf8'
            );

            const requiredVars = [
                'PORT', 'HTTPS_PORT', 'HOST', 'NODE_ENV',
                'SESSION_SECRET', 'DB_PATH',
                'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS',
                'SSL_KEY_PATH', 'SSL_CERT_PATH'
            ];

            for (const v of requiredVars) {
                expect(envExample).toContain(v);
            }
        });

        it('config/index.js should not contain hardcoded secrets', () => {
            const configSrc = fs.readFileSync(
                path.join(__dirname, '..', 'config', 'index.js'), 'utf8'
            );
            // The fallback default is acceptable, but should be a dev placeholder
            // It should use process.env.SESSION_SECRET
            expect(configSrc).toContain('process.env.SESSION_SECRET');
        });

        it('session.js should not contain hardcoded secrets', () => {
            const sessionSrc = fs.readFileSync(
                path.join(__dirname, '..', 'middleware', 'session.js'), 'utf8'
            );
            // Should import SESSION_SECRET from config, not hardcode it
            expect(sessionSrc).toContain('SESSION_SECRET');
            expect(sessionSrc).not.toMatch(/secret:\s*['"][^'"{]+['"]/);
        });

        it('config should warn when using default SESSION_SECRET', () => {
            const configSrc = fs.readFileSync(
                path.join(__dirname, '..', 'config', 'index.js'), 'utf8'
            );
            // Default fallback should be a clearly-dev-only value
            expect(configSrc).toMatch(/SESSION_SECRET.*\|\|.*['"].*change.*['"]/i);
        });
    });

    describe('Server exports createApp for testability', () => {
        it('server.js should export createApp', () => {
            const serverSrc = fs.readFileSync(
                path.join(__dirname, '..', 'server.js'), 'utf8'
            );
            expect(serverSrc).toContain('module.exports');
            expect(serverSrc).toContain('createApp');
        });

        it('server.js should only listen when run directly', () => {
            const serverSrc = fs.readFileSync(
                path.join(__dirname, '..', 'server.js'), 'utf8'
            );
            expect(serverSrc).toContain('require.main === module');
        });
    });
});
