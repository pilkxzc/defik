#!/usr/bin/env node
'use strict';

/**
 * End-to-End Rate Limiting Verification Script
 * Tests all requirements from subtask-4-2
 */

const http = require('http');

const BASE_URL = 'http://localhost:3000';
const COLORS = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[36m',
    bold: '\x1b[1m'
};

let testsPassed = 0;
let testsFailed = 0;

function log(message, color = 'reset') {
    console.log(`${COLORS[color]}${message}${COLORS.reset}`);
}

function logPass(message) {
    testsPassed++;
    log(`✓ ${message}`, 'green');
}

function logFail(message) {
    testsFailed++;
    log(`✗ ${message}`, 'red');
}

function logInfo(message) {
    log(`ℹ ${message}`, 'blue');
}

function logSection(message) {
    log(`\n${'='.repeat(60)}`, 'bold');
    log(message, 'bold');
    log('='.repeat(60), 'bold');
}

async function makeRequest(method, path, body = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, BASE_URL);
        const options = {
            method,
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'rate-limit-test/1.0'
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const jsonData = data ? JSON.parse(data) : null;
                    resolve({
                        status: res.statusCode,
                        headers: res.headers,
                        body: jsonData,
                        rawBody: data
                    });
                } catch (e) {
                    resolve({
                        status: res.statusCode,
                        headers: res.headers,
                        body: null,
                        rawBody: data
                    });
                }
            });
        });

        req.on('error', reject);

        if (body) {
            req.write(JSON.stringify(body));
        }

        req.end();
    });
}

async function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function testAuthRateLimiting() {
    logSection('TEST 1: Auth Endpoint Rate Limiting (5 req/min per IP)');

    const loginBody = {
        email: 'test@example.com',
        password: 'wrongpassword123'
    };

    let rateLimitHeaders = null;
    let ukrainianErrorMessage = null;

    for (let i = 1; i <= 6; i++) {
        try {
            const response = await makeRequest('POST', '/api/auth/login', loginBody);

            logInfo(`Request ${i}: Status ${response.status}`);

            if (i <= 5) {
                // First 5 requests should succeed (or return 401 for wrong password, but not 429)
                if (response.status === 429) {
                    logFail(`Request ${i} returned 429 (should accept up to 5 requests)`);
                } else {
                    logPass(`Request ${i} was not rate limited (status: ${response.status})`);
                }
            } else {
                // 6th request should return 429
                if (response.status === 429) {
                    logPass('Request 6 returned 429 (rate limit exceeded)');

                    // Check Ukrainian error message
                    if (response.body && response.body.error) {
                        ukrainianErrorMessage = response.body.error;
                        if (ukrainianErrorMessage.includes('Занадто багато запитів') ||
                            ukrainianErrorMessage.includes('Будь ласка, спробуйте пізніше')) {
                            logPass(`Ukrainian error message present: "${ukrainianErrorMessage}"`);
                        } else {
                            logFail(`Error message not in Ukrainian: "${ukrainianErrorMessage}"`);
                        }
                    } else {
                        logFail('429 response missing error message');
                    }
                } else {
                    logFail(`Request 6 returned ${response.status} (expected 429)`);
                }

                rateLimitHeaders = response.headers;
            }

            // Check headers on all responses
            if (response.headers['x-ratelimit-limit']) {
                if (i === 1) {
                    logPass(`X-RateLimit-Limit header present: ${response.headers['x-ratelimit-limit']}`);
                }
            } else {
                if (i === 1) {
                    logFail('X-RateLimit-Limit header missing');
                }
            }

            if (response.headers['x-ratelimit-remaining'] !== undefined) {
                if (i === 1) {
                    logPass(`X-RateLimit-Remaining header present: ${response.headers['x-ratelimit-remaining']}`);
                }
            } else {
                if (i === 1) {
                    logFail('X-RateLimit-Remaining header missing');
                }
            }

            if (response.headers['x-ratelimit-reset']) {
                if (i === 1) {
                    logPass(`X-RateLimit-Reset header present: ${response.headers['x-ratelimit-reset']}`);
                }
            } else {
                if (i === 1) {
                    logFail('X-RateLimit-Reset header missing');
                }
            }

            // Small delay between requests
            if (i < 6) {
                await wait(100);
            }
        } catch (error) {
            logFail(`Request ${i} failed with error: ${error.message}`);
        }
    }

    // Display final headers
    if (rateLimitHeaders) {
        logInfo('\nRate Limit Headers on 429 Response:');
        logInfo(`  X-RateLimit-Limit: ${rateLimitHeaders['x-ratelimit-limit']}`);
        logInfo(`  X-RateLimit-Remaining: ${rateLimitHeaders['x-ratelimit-remaining']}`);
        logInfo(`  X-RateLimit-Reset: ${rateLimitHeaders['x-ratelimit-reset']}`);
    }
}

async function testApiRateLimiting() {
    logSection('TEST 2: General API Rate Limiting (100 req/min)');

    logInfo('Sending 101 requests to /api/auth/me...');
    logInfo('(This will take ~10 seconds with small delays)');

    let successCount = 0;
    let rateLimitedCount = 0;

    for (let i = 1; i <= 101; i++) {
        try {
            const response = await makeRequest('GET', '/api/auth/me');

            if (response.status === 429) {
                rateLimitedCount++;
                if (i === 101) {
                    logPass(`Request ${i} returned 429 (rate limit exceeded at 100)`);

                    // Verify headers on 101st request
                    if (response.headers['x-ratelimit-limit'] &&
                        response.headers['x-ratelimit-remaining'] !== undefined &&
                        response.headers['x-ratelimit-reset']) {
                        logPass('All rate limit headers present on 429 response');
                    } else {
                        logFail('Some rate limit headers missing on 429 response');
                    }
                } else {
                    // Rate limited before 101st request
                    logInfo(`Request ${i} was rate limited (premature)`);
                }
            } else {
                successCount++;
            }

            // Progress indicator every 25 requests
            if (i % 25 === 0) {
                logInfo(`  Progress: ${i}/101 requests sent`);
            }

            // Small delay to avoid overwhelming the server
            await wait(100);
        } catch (error) {
            logFail(`Request ${i} failed: ${error.message}`);
        }
    }

    logInfo(`\nResults: ${successCount} successful, ${rateLimitedCount} rate limited`);

    // Note: successCount may be less than 100 if previous tests consumed some quota
    // This is expected behavior - rate limit is shared across all requests from same IP
    if (successCount >= 90 && successCount <= 101 && rateLimitedCount > 0) {
        logPass('API rate limiting working correctly (~100 req/min limit)');
        if (successCount < 99) {
            logInfo(`Note: ${100 - successCount} requests were consumed by previous tests (expected)`);
        }
    } else if (successCount < 90) {
        logFail(`Too few successful requests (${successCount}, expected ~90-100)`);
    } else if (rateLimitedCount === 0) {
        logFail('No rate limiting occurred (expected 429 on request 101 or earlier)');
    }
}

async function testRateLimitReset() {
    logSection('TEST 3: Rate Limit Reset After Window');

    logInfo('Testing rate limit reset requires waiting 60 seconds...');
    logInfo('Sending request to trigger rate limit...');

    // First, exhaust the limit
    for (let i = 1; i <= 6; i++) {
        try {
            const response = await makeRequest('POST', '/api/auth/login', {
                email: 'reset-test@example.com',
                password: 'test123'
            });

            if (i === 6 && response.status === 429) {
                logPass('Rate limit triggered successfully');

                const resetTime = response.headers['x-ratelimit-reset'];
                if (resetTime) {
                    const resetDate = new Date(parseInt(resetTime) * 1000);
                    logInfo(`Rate limit will reset at: ${resetDate.toLocaleTimeString()}`);
                    logInfo('Waiting 61 seconds for rate limit window to reset...');

                    // Wait 61 seconds (60s window + 1s buffer)
                    await wait(61000);

                    // Try another request
                    const afterReset = await makeRequest('POST', '/api/auth/login', {
                        email: 'reset-test@example.com',
                        password: 'test123'
                    });

                    if (afterReset.status !== 429) {
                        logPass('Rate limit reset successfully after 60 seconds');
                        logInfo(`New request status: ${afterReset.status}`);
                    } else {
                        logFail('Rate limit did not reset after 60 seconds');
                    }
                } else {
                    logFail('X-RateLimit-Reset header missing');
                }
            }

            if (i < 6) {
                await wait(100);
            }
        } catch (error) {
            logFail(`Error during reset test: ${error.message}`);
        }
    }
}

async function checkServerStatus() {
    logSection('Pre-flight: Server Status Check');

    try {
        // Test /api/auth/me endpoint (should return 401 if not authenticated, but server is running)
        const response = await makeRequest('GET', '/api/auth/me');

        if (response.status === 401 || response.status === 200 || response.status === 429) {
            logPass('Server is running and API endpoints are responding');
            logInfo(`Test endpoint returned status: ${response.status}`);
            return true;
        } else if (response.status === 403) {
            // Beta gate might be active, but server is running
            logPass('Server is running (beta gate detected)');
            logInfo('Testing auth endpoints which should bypass beta gate...');

            // Try login endpoint
            const loginTest = await makeRequest('POST', '/api/auth/login', {
                email: 'test@test.com',
                password: 'test'
            });

            if (loginTest.status === 401 || loginTest.status === 404 || loginTest.status === 429) {
                logPass('Auth endpoints are accessible');
                return true;
            } else {
                logFail(`Auth endpoint returned unexpected status: ${loginTest.status}`);
                return false;
            }
        } else {
            logFail(`Server returned unexpected status: ${response.status}`);
            return false;
        }
    } catch (error) {
        logFail(`Cannot connect to server: ${error.message}`);
        logInfo('Please start the server with: cd server && node server.js');
        return false;
    }
}

async function runAllTests() {
    log('\n╔════════════════════════════════════════════════════════════╗', 'bold');
    log('║     Rate Limiting End-to-End Verification Suite          ║', 'bold');
    log('╚════════════════════════════════════════════════════════════╝\n', 'bold');

    const serverRunning = await checkServerStatus();

    if (!serverRunning) {
        process.exit(1);
    }

    await testAuthRateLimiting();
    await testApiRateLimiting();

    // Note: Rate limit reset test is commented out by default because it takes 61 seconds
    // Uncomment the line below to include it in the test suite
    // await testRateLimitReset();

    logSection('Test Summary');
    log(`Total Passed: ${testsPassed}`, 'green');
    log(`Total Failed: ${testsFailed}`, testsFailed > 0 ? 'red' : 'green');

    if (testsFailed === 0) {
        log('\n🎉 All tests passed!', 'green');
        process.exit(0);
    } else {
        log('\n❌ Some tests failed', 'red');
        process.exit(1);
    }
}

// Run the tests
runAllTests().catch(error => {
    logFail(`Fatal error: ${error.message}`);
    console.error(error);
    process.exit(1);
});
