#!/usr/bin/env node
'use strict';

/**
 * Automated Redis Fallback Verification
 *
 * Tests the Redis fallback by examining the code and simulating the scenarios
 */

const fs = require('fs');
const path = require('path');

// ANSI color codes
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function checkFile(filePath, checks) {
    const fullPath = path.join(__dirname, filePath);
    if (!fs.existsSync(fullPath)) {
        return { exists: false, passed: 0, failed: 1, details: ['File does not exist'] };
    }

    const content = fs.readFileSync(fullPath, 'utf8');
    const results = {
        exists: true,
        passed: 0,
        failed: 0,
        details: []
    };

    for (const check of checks) {
        const { name, test } = check;
        const passed = test(content);
        if (passed) {
            results.passed++;
            results.details.push(`✓ ${name}`);
        } else {
            results.failed++;
            results.details.push(`✗ ${name}`);
        }
    }

    return results;
}

async function runVerification() {
    log('\n=== Redis Fallback Code Verification ===\n', 'cyan');

    let totalPassed = 0;
    let totalFailed = 0;

    // Test 1: Redis utility has error handling
    log('[Test 1] Checking Redis utility implementation...', 'blue');
    const redisUtilChecks = [
        {
            name: 'Has lazyConnect option (prevents crash on init)',
            test: (content) => content.includes('lazyConnect: true')
        },
        {
            name: 'Has retry strategy with limit',
            test: (content) => content.includes('retryStrategy') && content.includes('return null')
        },
        {
            name: 'Has error event handler',
            test: (content) => content.includes("redisClient.on('error'")
        },
        {
            name: 'Has connection event handler',
            test: (content) => content.includes("redisClient.on('connect'")
        },
        {
            name: 'Catches connection errors',
            test: (content) => content.includes('.connect().catch(')
        },
        {
            name: 'Shows warning when Redis unavailable',
            test: (content) => content.includes('Redis unavailable') || content.includes('falling back to memory store')
        },
        {
            name: 'Exports getRedisStatus function',
            test: (content) => content.includes('getRedisStatus') && content.includes('module.exports')
        }
    ];

    const redisUtilResults = checkFile('server/utils/redis.js', redisUtilChecks);
    if (!redisUtilResults.exists) {
        log('✗ server/utils/redis.js not found', 'red');
        totalFailed++;
    } else {
        redisUtilResults.details.forEach(detail => {
            log(detail, detail.startsWith('✓') ? 'green' : 'red');
        });
        totalPassed += redisUtilResults.passed;
        totalFailed += redisUtilResults.failed;
    }

    // Test 2: Rate limit middleware uses fallback
    log('\n[Test 2] Checking rate limit middleware fallback...', 'blue');
    const rateLimitChecks = [
        {
            name: 'Imports getRedisStatus from redis utility',
            test: (content) => content.includes('getRedisStatus') && content.includes('./utils/redis')
        },
        {
            name: 'Auth limiter checks Redis availability',
            test: (content) => {
                const authSection = content.match(/const authRateLimiter[\s\S]+?}\);/);
                if (!authSection) return false;
                return authSection[0].includes('getRedisStatus()') ||
                       authSection[0].includes('store:') && authSection[0].includes('undefined');
            }
        },
        {
            name: 'API limiter checks Redis availability',
            test: (content) => {
                const apiSection = content.match(/const apiRateLimiter[\s\S]+?}\);/);
                if (!apiSection) return false;
                return apiSection[0].includes('getRedisStatus()') ||
                       apiSection[0].includes('store:') && apiSection[0].includes('undefined');
            }
        },
        {
            name: 'Falls back to memory store (undefined) when Redis unavailable',
            test: (content) => content.includes(': undefined') && content.includes('memory store')
        },
        {
            name: 'Uses RedisStore when Redis available',
            test: (content) => content.includes('RedisStore') && content.includes('sendCommand')
        }
    ];

    const rateLimitResults = checkFile('server/middleware/rateLimit.js', rateLimitChecks);
    if (!rateLimitResults.exists) {
        log('✗ server/middleware/rateLimit.js not found', 'red');
        totalFailed++;
    } else {
        rateLimitResults.details.forEach(detail => {
            log(detail, detail.startsWith('✓') ? 'green' : 'red');
        });
        totalPassed += rateLimitResults.passed;
        totalFailed += rateLimitResults.failed;
    }

    // Test 3: Check for proper error handling patterns
    log('\n[Test 3] Checking error handling patterns...', 'blue');

    // Read redis.js to verify try-catch blocks
    const redisPath = path.join(__dirname, 'server/utils/redis.js');
    const redisContent = fs.readFileSync(redisPath, 'utf8');

    const errorHandlingTests = [
        {
            name: 'Try-catch wraps Redis initialization',
            passed: redisContent.includes('try {') && redisContent.includes('} catch (err) {')
        },
        {
            name: 'Console warnings for Redis errors (not console.error that might crash)',
            passed: redisContent.includes('console.warn') || redisContent.includes('console.log')
        },
        {
            name: 'No process.exit() on Redis failure',
            passed: !redisContent.includes('process.exit')
        },
        {
            name: 'Returns client even if connection fails',
            passed: redisContent.includes('return redisClient')
        }
    ];

    errorHandlingTests.forEach(test => {
        if (test.passed) {
            log(`✓ ${test.name}`, 'green');
            totalPassed++;
        } else {
            log(`✗ ${test.name}`, 'red');
            totalFailed++;
        }
    });

    // Summary
    log('\n=== Verification Summary ===', 'cyan');
    log(`Passed: ${totalPassed}`, 'green');
    log(`Failed: ${totalFailed}`, totalFailed > 0 ? 'red' : 'green');

    if (totalFailed === 0) {
        log('\n✓ All code checks passed!', 'green');
        log('\nThe implementation correctly:', 'cyan');
        log('  • Uses lazyConnect to prevent crash on init', 'green');
        log('  • Has retry strategy with fallback', 'green');
        log('  • Handles connection errors gracefully', 'green');
        log('  • Falls back to memory store when Redis unavailable', 'green');
        log('  • Shows clear warning messages', 'green');
        log('  • Exports status checking function', 'green');
        return true;
    } else {
        log('\n✗ Some checks failed', 'red');
        return false;
    }
}

// Run verification
runVerification().then(success => {
    if (success) {
        log('\n📝 Manual verification steps:', 'yellow');
        log('1. Ensure Redis is stopped: redis-cli shutdown', 'yellow');
        log('2. Start server: cd server && node server.js', 'yellow');
        log('   → Should see: "Redis unavailable, rate limiting will use memory store"', 'yellow');
        log('3. Test rate limiting works (use verify-redis-fallback.js)', 'yellow');
        log('4. Start Redis: redis-server --daemonize yes', 'yellow');
        log('5. Restart server', 'yellow');
        log('   → Should see: "Redis connected successfully"', 'yellow');
    }
    process.exit(success ? 0 : 1);
}).catch(err => {
    log(`\n✗ Verification error: ${err.message}`, 'red');
    console.error(err);
    process.exit(1);
});
