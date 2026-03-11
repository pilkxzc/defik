'use strict';

const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');
const { createRedisClient, getRedisStatus } = require('../utils/redis');

// Initialize Redis client for rate limiting
const redisClient = createRedisClient();

// Custom handler for rate limit exceeded
const rateLimitHandler = (req, res) => {
    return res.status(429).json({
        error: 'Занадто багато запитів. Будь ласка, спробуйте пізніше.'
    });
};

// Create rate limiter with dynamic Redis/memory store selection
function createLimiter(config) {
    let _limiter = null;
    let _usingRedis = null;

    return (req, res, next) => {
        const redisAvailable = getRedisStatus().available;
        if (!_limiter || redisAvailable !== _usingRedis) {
            _usingRedis = redisAvailable;
            const storeOpt = redisAvailable
                ? { store: new RedisStore({
                    sendCommand: (...args) => redisClient.call(...args),
                    prefix: config._prefix
                  }) }
                : {};
            _limiter = rateLimit({ ...config, ...storeOpt });
            if (redisAvailable && _usingRedis !== null) {
                console.log(`[RateLimit] ${config._prefix} switched to Redis store`);
            }
        }
        return _limiter(req, res, next);
    };
}

// Auth endpoints rate limiter - 5 requests per minute per IP
const authRateLimiter = createLimiter({
    _prefix: 'rl:auth:',
    windowMs: 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: true,
    handler: rateLimitHandler,
    skip: () => false
});

// General API rate limiter - 100 requests per minute per user/IP
const apiRateLimiter = createLimiter({
    _prefix: 'rl:api:',
    windowMs: 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: true,
    handler: rateLimitHandler,
    skip: (req) => {
        const authPaths = ['/api/auth/login', '/api/auth/register', '/api/auth/forgot-password', '/api/auth/reset-password'];
        return authPaths.some(path => req.path === path);
    },
    keyGenerator: (req, res) => {
        if (req.session && req.session.userId) {
            return `user:${req.session.userId}`;
        }
        return res.locals.keyGenerator?.(req, res);
    }
});

module.exports = {
    authRateLimiter,
    apiRateLimiter
};
