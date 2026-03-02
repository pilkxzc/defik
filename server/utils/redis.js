'use strict';

const Redis = require('ioredis');

let redisClient = null;
let redisAvailable = false;

function createRedisClient() {
    if (redisClient) {
        return redisClient;
    }

    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

    try {
        redisClient = new Redis(redisUrl, {
            maxRetriesPerRequest: 3,
            enableReadyCheck: true,
            lazyConnect: true,
            retryStrategy(times) {
                if (times > 3) {
                    console.log('Redis connection failed after 3 retries, falling back to memory store');
                    return null;
                }
                return Math.min(times * 100, 3000);
            }
        });

        redisClient.on('connect', () => {
            console.log('Redis connected successfully');
            redisAvailable = true;
        });

        redisClient.on('error', (err) => {
            console.warn('Redis connection error:', err.message);
            redisAvailable = false;
        });

        redisClient.on('close', () => {
            console.log('Redis connection closed');
            redisAvailable = false;
        });

        redisClient.connect().catch((err) => {
            console.warn('Redis unavailable, rate limiting will use memory store:', err.message);
            redisAvailable = false;
        });

    } catch (err) {
        console.warn('Failed to initialize Redis client, falling back to memory store:', err.message);
        redisAvailable = false;
    }

    return redisClient;
}

function getRedisStatus() {
    return {
        available: redisAvailable,
        client: redisClient
    };
}

module.exports = {
    createRedisClient,
    getRedisStatus
};
