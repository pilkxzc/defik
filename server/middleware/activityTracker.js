'use strict';
const { dbRun } = require('../db');
const { getClientIP } = require('../utils/ip');

// Paths to skip tracking (static assets, health checks)
const SKIP_PREFIXES = [
    '/css/', '/js/', '/fonts/', '/logo', '/favicon',
    '/socket.io/', '/api/market/prices', '/api/admin/db-access/heartbeat'
];

const SKIP_EXTENSIONS = ['.css', '.js', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.map'];

// Categorize actions
function categorizeRequest(method, path) {
    if (path.startsWith('/api/auth/')) return 'auth';
    if (path.startsWith('/api/admin/')) return 'admin';
    if (path.startsWith('/api/bots')) return 'bots';
    if (path.startsWith('/api/portfolio')) return 'portfolio';
    if (path.startsWith('/api/orders')) return 'orders';
    if (path.startsWith('/api/profile')) return 'profile';
    if (path.startsWith('/api/notifications')) return 'notifications';
    if (path.startsWith('/api/faucet')) return 'faucet';
    if (path.startsWith('/api/market')) return 'market';
    if (path.startsWith('/api/subscription')) return 'subscription';
    if (path.startsWith('/api/history')) return 'history';
    if (path.startsWith('/api/activity')) return 'client';
    if (path.startsWith('/api/')) return 'api';
    return 'navigation';
}

function getActionName(method, path) {
    // Auth
    if (path === '/api/auth/login' && method === 'POST') return 'login';
    if (path === '/api/auth/register' && method === 'POST') return 'register';
    if (path === '/api/auth/logout' && method === 'POST') return 'logout';
    if (path === '/api/auth/me' && method === 'GET') return 'session_check';

    // Navigation (page views)
    if (method === 'GET' && !path.startsWith('/api/')) return 'page_view';

    // API calls
    return `${method.toLowerCase()}_${path.replace(/^\/api\//, '').replace(/\//g, '_').replace(/[^a-zA-Z0-9_]/g, '')}`;
}

function activityTracker(req, res, next) {
    const startTime = Date.now();
    const originalPath = req.originalUrl || req.url;
    const cleanPath = originalPath.split('?')[0];

    // Skip static assets
    if (SKIP_PREFIXES.some(p => cleanPath.startsWith(p))) return next();
    if (SKIP_EXTENSIONS.some(ext => cleanPath.endsWith(ext))) return next();

    // Hook into response finish
    res.on('finish', () => {
        try {
            const duration = Date.now() - startTime;
            const userId = req.session?.userId || null;
            const method = req.method;
            const statusCode = res.statusCode;
            const ip = getClientIP(req);
            const ua = req.headers['user-agent'] || '';
            const sessionId = req.sessionID || null;
            const category = categorizeRequest(method, cleanPath);
            const action = getActionName(method, cleanPath);

            // Skip session checks for non-logged users (too noisy)
            if (action === 'session_check' && !userId) return;

            // Build details
            let details = null;
            if (action === 'login' && statusCode === 200) {
                details = JSON.stringify({ email: req.body?.email });
            } else if (action === 'register' && statusCode === 201) {
                details = JSON.stringify({ email: req.body?.email });
            } else if (action === 'page_view') {
                details = JSON.stringify({ page: cleanPath });
            }

            dbRun(
                `INSERT INTO activity_log (user_id, action, category, details, ip_address, user_agent, path, method, status_code, duration_ms, session_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [userId, action, category, details, ip, ua.substring(0, 500), cleanPath, method, statusCode, duration, sessionId]
            );
        } catch (e) {
            // Silent fail — tracking should never break the app
        }
    });

    next();
}

// Log client-side events (called from frontend tracker)
function logClientEvent(userId, action, details, ip, ua, sessionId) {
    try {
        dbRun(
            `INSERT INTO activity_log (user_id, action, category, details, ip_address, user_agent, session_id)
             VALUES (?, ?, 'client', ?, ?, ?, ?)`,
            [userId, action, details ? JSON.stringify(details) : null, ip, ua?.substring(0, 500), sessionId]
        );
    } catch (e) { /* silent */ }
}

module.exports = { activityTracker, logClientEvent };
