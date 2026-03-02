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

// Auth endpoints rate limiter - 5 requests per minute per IP
// Applied to login, register, password reset endpoints
const authRateLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 5, // 5 requests per window per IP
    standardHeaders: true, // Return rate limit info in RateLimit-* headers (RFC draft)
    legacyHeaders: true, // Also send X-RateLimit-* headers for backwards compatibility
    handler: rateLimitHandler,
    skip: (req) => {
        // Skip rate limiting for health checks or specific routes if needed
        return false;
    },
    // Use Redis if available, otherwise fall back to memory store
    store: getRedisStatus().available
        ? new RedisStore({
            // @ts-expect-error - Known issue: the `call` function is not present in @types/ioredis
            sendCommand: (...args) => redisClient.call(...args),
            prefix: 'rl:auth:'
        })
        : undefined // undefined = use default memory store
    // Use default keyGenerator (req.ip) - handles IPv6 correctly
});

// General API rate limiter - 100 requests per minute per user/IP
// Applied to all API endpoints except auth endpoints (which have stricter limits)
const apiRateLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 100, // 100 requests per window
    standardHeaders: true, // Return rate limit info in RateLimit-* headers (RFC draft)
    legacyHeaders: true, // Also send X-RateLimit-* headers for backwards compatibility
    handler: rateLimitHandler,
    skip: (req) => {
        // Skip rate limiting for health checks or specific routes if needed
        return false;
    },
    // Use Redis if available, otherwise fall back to memory store
    store: getRedisStatus().available
        ? new RedisStore({
            // @ts-expect-error - Known issue: the `call` function is not present in @types/ioredis
            sendCommand: (...args) => redisClient.call(...args),
            prefix: 'rl:api:'
        })
        : undefined, // undefined = use default memory store
    keyGenerator: (req, res) => {
        // Rate limit by user ID if authenticated
        // For unauthenticated requests, use default IP handling (res.locals.keyGenerator)
        if (req.session && req.session.userId) {
            return `user:${req.session.userId}`;
        }
        // Fallback to default IP key generator (handles IPv6 correctly)
        return res.locals.keyGenerator?.(req, res);
    }
});

module.exports = {
    authRateLimiter,
    apiRateLimiter
};
