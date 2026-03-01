'use strict';
const { dbGet } = require('../db');
const { siteSettings } = require('../config');

const maintenanceMiddleware = (req, res, next) => {
    if (req.path === '/api/auth/me' ||
        req.path === '/api/admin/maintenance' ||
        req.path.startsWith('/api/admin/')) {
        return next();
    }

    if (req.path.match(/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf)$/)) {
        return next();
    }

    if (siteSettings.maintenanceMode) {
        if (req.session?.userId) {
            const user = dbGet('SELECT role FROM users WHERE id = ?', [req.session.userId]);
            if (user && (user.role === 'admin' || user.role === 'moderator')) {
                return next();
            }
        }

        if (req.path.startsWith('/api/')) {
            return res.status(503).json({
                error: 'maintenance',
                message: siteSettings.maintenanceMessage
            });
        }

        return res.status(503).send(`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Yamato - Maintenance</title>
                <style>
                    * { box-sizing: border-box; margin: 0; padding: 0; }
                    body {
                        font-family: 'Plus Jakarta Sans', -apple-system, sans-serif;
                        background: #080808;
                        color: #fff;
                        min-height: 100vh;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        text-align: center;
                        padding: 20px;
                    }
                    .container { max-width: 500px; }
                    .icon {
                        width: 80px;
                        height: 80px;
                        background: rgba(255, 59, 48, 0.1);
                        border-radius: 50%;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        margin: 0 auto 24px;
                    }
                    .icon svg { width: 40px; height: 40px; stroke: #10B981; }
                    h1 { font-size: 28px; margin-bottom: 16px; }
                    p { color: #A1A1A1; font-size: 16px; line-height: 1.6; }
                    .refresh {
                        margin-top: 32px;
                        padding: 12px 32px;
                        background: #10B981;
                        color: white;
                        border: none;
                        border-radius: 50px;
                        font-size: 14px;
                        font-weight: 600;
                        cursor: pointer;
                        text-decoration: none;
                        display: inline-block;
                    }
                    .refresh:hover { opacity: 0.9; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
                        </svg>
                    </div>
                    <h1>Maintenance</h1>
                    <p>${siteSettings.maintenanceMessage}</p>
                    <a href="/" class="refresh" onclick="location.reload(); return false;">Refresh Page</a>
                </div>
            </body>
            </html>
        `);
    }

    next();
};

module.exports = { maintenanceMiddleware };
