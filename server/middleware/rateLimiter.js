'use strict';
const rateLimit = require('express-rate-limit');

const loginLimiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_LOGIN_WINDOW, 10) || 15 * 60 * 1000,
    limit: parseInt(process.env.RATE_LIMIT_LOGIN_MAX, 10) || 5,
    message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false
});

const registerLimiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_REGISTER_WINDOW, 10) || 60 * 60 * 1000,
    limit: parseInt(process.env.RATE_LIMIT_REGISTER_MAX, 10) || 3,
    message: { error: 'Too many registration attempts. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false
});

const ordersLimiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_ORDERS_WINDOW, 10) || 60 * 1000,
    limit: parseInt(process.env.RATE_LIMIT_ORDERS_MAX, 10) || 30,
    message: { error: 'Too many order requests. Please slow down.' },
    standardHeaders: true,
    legacyHeaders: false
});

const telegramCodeLimiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_TELEGRAM_CODE_WINDOW, 10) || 60 * 60 * 1000,
    limit: parseInt(process.env.RATE_LIMIT_TELEGRAM_CODE_MAX, 10) || 5,
    message: { error: 'Too many code requests. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false
});

module.exports = { loginLimiter, registerLimiter, ordersLimiter, telegramCodeLimiter };
