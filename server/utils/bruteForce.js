'use strict';

const { dbGet, dbAll, dbRun } = require('../db');

const LOCKOUT_THRESHOLD = 10;
const LOCKOUT_WINDOW_MINUTES = 15;

/**
 * Record a login attempt in the database
 * @param {string} ip - IP address of the requester
 * @param {string} email - Email address attempted
 * @param {boolean} success - Whether the login was successful
 * @returns {Promise<void>}
 */
async function recordLoginAttempt(ip, email, success) {
    try {
        const attemptTime = new Date().toISOString();
        await dbRun(
            'INSERT INTO login_attempts (ip_address, user_email, success, attempt_time) VALUES (?, ?, ?, ?)',
            [ip, email || '', success ? 1 : 0, attemptTime]
        );
    } catch (error) {
        console.error('Error recording login attempt:', error);
    }
}

/**
 * Get the number of failed login attempts within a time window
 * @param {string} email - Email address to check
 * @param {number} timeWindowMinutes - Time window in minutes (default: 15)
 * @returns {Promise<number>}
 */
async function getFailedAttempts(email, timeWindowMinutes = LOCKOUT_WINDOW_MINUTES) {
    try {
        const windowStart = new Date(Date.now() - timeWindowMinutes * 60 * 1000).toISOString();

        const result = await dbGet(
            'SELECT COUNT(*) as count FROM login_attempts WHERE user_email = ? AND success = 0 AND attempt_time > ?',
            [email, windowStart]
        );

        return result ? result.count : 0;
    } catch (error) {
        console.error('Error getting failed attempts:', error);
        return 0;
    }
}

/**
 * Check if an account is temporarily locked due to failed login attempts
 * @param {string} email - Email address to check
 * @returns {Promise<boolean>}
 */
async function isAccountLocked(email) {
    const failedCount = await getFailedAttempts(email);
    return failedCount >= LOCKOUT_THRESHOLD;
}

/**
 * Calculate progressive delay based on number of failed attempts
 * Returns a promise that resolves after the delay
 * @param {number} attemptCount - Number of failed attempts
 * @returns {Promise<number>} - Delay in milliseconds
 */
function getProgressiveDelay(attemptCount) {
    if (attemptCount <= 0) {
        return Promise.resolve(0);
    }

    // Progressive delays: 1s, 2s, 4s, 8s, 16s, 32s...
    // Delay = 2^(attemptCount-1) seconds, capped at 32 seconds
    const delaySeconds = Math.min(Math.pow(2, attemptCount - 1), 32);
    const delayMs = delaySeconds * 1000;

    return new Promise(resolve => {
        setTimeout(() => resolve(delayMs), delayMs);
    });
}

module.exports = {
    recordLoginAttempt,
    getFailedAttempts,
    isAccountLocked,
    getProgressiveDelay
};
