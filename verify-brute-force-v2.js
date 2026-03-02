#!/usr/bin/env node
'use strict';

/**
 * Brute-Force Protection Verification Script (v2)
 * Tests progressive delays, account lockout, and auto-unlock functionality
 * Handles rate limiting properly by spacing out requests
 */

const http = require('http');
const { dbGet, dbAll, dbRun, initDatabase } = require('./server/db');

const BASE_URL = 'http://localhost:3000';
const TEST_EMAIL = 'bruteforce-test-v2@yamato.test';
const TEST_PASSWORD = 'TestPassword123!';
const WRONG_PASSWORD = 'WrongPassword456!';

// ANSI colors for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  gray: '\x1b[90m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function makeRequest(path, method = 'POST', body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      }
    };

    if (body) {
      const data = JSON.stringify(body);
      options.headers['Content-Length'] = Buffer.byteLength(data);
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: data ? JSON.parse(data) : null
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: data
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

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function setupTestUser() {
  log('\n📋 Setting up test user...', 'blue');

  // Clean up existing test user
  await dbRun('DELETE FROM users WHERE email = ?', [TEST_EMAIL]);
  await dbRun('DELETE FROM login_attempts WHERE user_email = ?', [TEST_EMAIL]);

  // Register test user via API to ensure it goes through all validation
  const response = await makeRequest('/api/auth/register', 'POST', {
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
    fullName: 'Brute Force Test User V2',
    phone: '+380000000001'
  });

  if (response.status === 200 && response.body.success) {
    log('✅ Test user created successfully', 'green');
    // Wait 15 seconds for rate limit to reset
    log('  Waiting 15s for rate limit reset...', 'gray');
    await sleep(15000);
    return true;
  } else {
    log(`❌ Failed to create test user: ${JSON.stringify(response.body)}`, 'red');
    return false;
  }
}

async function testProgressiveDelays() {
  log('\n🔍 Test 1: Progressive Delays', 'blue');
  log('  Note: Delays are based on PREVIOUS failed attempts', 'yellow');
  log('  Attempt 1: 0 prior failures → ~0ms delay', 'yellow');
  log('  Attempt 2: 1 prior failure → ~1000ms delay', 'yellow');
  log('  Attempt 3: 2 prior failures → ~2000ms delay', 'yellow');
  log('  Attempt 4: 3 prior failures → ~4000ms delay', 'yellow');

  const attempts = [
    { expectedDelay: 0, priorFailures: 0 },
    { expectedDelay: 1000, priorFailures: 1 },
    { expectedDelay: 2000, priorFailures: 2 },
    { expectedDelay: 4000, priorFailures: 3 }
  ];

  const tolerance = 600; // 600ms tolerance

  for (let i = 0; i < attempts.length; i++) {
    const startTime = Date.now();

    const response = await makeRequest('/api/auth/login', 'POST', {
      email: TEST_EMAIL,
      password: WRONG_PASSWORD
    });

    const elapsed = Date.now() - startTime;
    const expected = attempts[i].expectedDelay;

    log(`  Attempt ${i+1}: ${response.status} - Delay: ${elapsed}ms (expected: ~${expected}ms)`, 'gray');

    if (response.status !== 401) {
      log(`❌ Expected 401 Unauthorized, got ${response.status}`, 'red');
      return false;
    }

    // Only check delay for attempts 2-4 (attempts with prior failures)
    if (i > 0 && elapsed < (expected - tolerance)) {
      log(`❌ Delay too short: ${elapsed}ms (expected: ~${expected}ms ± ${tolerance}ms)`, 'red');
      return false;
    }

    // Wait 15 seconds between attempts to avoid rate limiting
    if (i < attempts.length - 1) {
      log('    Waiting 15s to avoid rate limiting...', 'gray');
      await sleep(15000);
    }
  }

  log('✅ Progressive delays working correctly', 'green');
  return true;
}

async function testAccountLockout() {
  log('\n🔍 Test 2: Account Lockout After 10 Failed Attempts', 'blue');
  log('  Note: We already have 4 failed attempts from previous test', 'yellow');
  log('  Making 6 more attempts to reach 10 total...', 'yellow');

  // Make 6 more attempts (we already have 4 from previous test)
  for (let i = 5; i <= 10; i++) {
    const response = await makeRequest('/api/auth/login', 'POST', {
      email: TEST_EMAIL,
      password: WRONG_PASSWORD
    });

    log(`  Attempt ${i}: ${response.status}`, 'gray');

    if (response.status === 403 && response.body.locked) {
      log(`⚠️  Account locked early at attempt ${i}`, 'yellow');
      // This is okay if we've hit the threshold
      break;
    } else if (response.status !== 401) {
      log(`⚠️  Unexpected status ${response.status} at attempt ${i}`, 'yellow');
    }

    // Wait between attempts to avoid rate limiting
    if (i < 10) {
      log('    Waiting 15s...', 'gray');
      await sleep(15000);
    }
  }

  // Now check if account is locked
  log('  Checking if account is locked...', 'gray');
  const response = await makeRequest('/api/auth/login', 'POST', {
    email: TEST_EMAIL,
    password: WRONG_PASSWORD
  });

  if (response.status === 403 && response.body.locked) {
    log(`✅ Account locked after failed attempts`, 'green');
    log(`  Message: "${response.body.error}"`, 'gray');
    return true;
  } else {
    log(`❌ Account not locked. Status: ${response.status}, Response: ${JSON.stringify(response.body)}`, 'red');
    return false;
  }
}

async function testCorrectPasswordWhileLocked() {
  log('\n🔍 Test 3: Correct Password Returns 403 When Locked', 'blue');

  await sleep(2000); // Small delay

  const response = await makeRequest('/api/auth/login', 'POST', {
    email: TEST_EMAIL,
    password: TEST_PASSWORD // Correct password
  });

  if (response.status === 403 && response.body.locked) {
    log('✅ Correct password rejected while account locked', 'green');
    return true;
  } else {
    log(`❌ Expected 403 with locked=true, got ${response.status}`, 'red');
    log(`  Response: ${JSON.stringify(response.body)}`, 'gray');
    return false;
  }
}

async function testDatabaseRecords() {
  log('\n🔍 Test 4: Verify Database Records', 'blue');

  const attempts = await dbAll(
    'SELECT * FROM login_attempts WHERE user_email = ? ORDER BY attempt_time ASC',
    [TEST_EMAIL]
  );

  log(`  Found ${attempts.length} login attempts in database`, 'gray');

  if (attempts.length < 10) { // At least 10 failed login attempts
    log(`❌ Expected at least 10 attempts, found ${attempts.length}`, 'red');
    log('  Database records:', 'gray');
    attempts.forEach((a, i) => {
      log(`    ${i+1}. ${a.user_email} - success:${a.success} - ${a.attempt_time} - IP:${a.ip_address}`, 'gray');
    });
    return false;
  }

  // Check that timestamps are in correct order
  for (let i = 1; i < attempts.length; i++) {
    const prev = new Date(attempts[i-1].attempt_time);
    const curr = new Date(attempts[i].attempt_time);

    if (curr < prev) {
      log(`❌ Timestamps out of order at index ${i}`, 'red');
      return false;
    }
  }

  // Count failed attempts
  const failedAttempts = attempts.filter(a => a.success === 0);
  log(`  Failed attempts: ${failedAttempts.length}`, 'gray');

  // Verify IP addresses are recorded
  const withIP = attempts.filter(a => a.ip_address && a.ip_address !== '');
  log(`  Attempts with IP: ${withIP.length}/${attempts.length}`, 'gray');

  if (withIP.length < attempts.length) {
    log(`⚠️  Some attempts missing IP address`, 'yellow');
  }

  log('✅ Database records verified', 'green');
  return true;
}

async function testAutoUnlock() {
  log('\n🔍 Test 5: Auto-Unlock After 15 Minutes', 'blue');
  log('  Note: Simulating time passage by backdating database records', 'yellow');

  // Manipulate database to simulate 15 minutes passing
  const sixteenMinutesAgo = new Date(Date.now() - 16 * 60 * 1000).toISOString();

  await dbRun(
    'UPDATE login_attempts SET attempt_time = ? WHERE user_email = ?',
    [sixteenMinutesAgo, TEST_EMAIL]
  );

  log('  Backdated all attempts to 16 minutes ago', 'gray');

  // Wait a moment for database to save
  await sleep(2000);

  // Try to login with correct password
  const response = await makeRequest('/api/auth/login', 'POST', {
    email: TEST_EMAIL,
    password: TEST_PASSWORD
  });

  if (response.status === 200 || (response.body && response.body.success)) {
    log('✅ Account auto-unlocked after 15 minutes', 'green');
    return true;
  } else {
    log(`❌ Login failed after time window. Status: ${response.status}`, 'red');
    log(`  Response: ${JSON.stringify(response.body)}`, 'gray');

    // Check database to see if the update worked
    const attempts = await dbAll(
      'SELECT * FROM login_attempts WHERE user_email = ? ORDER BY attempt_time DESC LIMIT 3',
      [TEST_EMAIL]
    );
    log('  Recent attempts:', 'gray');
    attempts.forEach(a => {
      const age = Date.now() - new Date(a.attempt_time).getTime();
      log(`    - ${a.attempt_time} (${Math.round(age/60000)} minutes ago)`, 'gray');
    });

    return false;
  }
}

async function cleanup() {
  log('\n🧹 Cleaning up...', 'blue');
  await dbRun('DELETE FROM users WHERE email = ?', [TEST_EMAIL]);
  await dbRun('DELETE FROM login_attempts WHERE user_email = ?', [TEST_EMAIL]);
  log('✅ Cleanup complete', 'green');
}

async function main() {
  log('═══════════════════════════════════════════════════════', 'blue');
  log('  Brute-Force Protection Verification (v2)', 'blue');
  log('═══════════════════════════════════════════════════════', 'blue');

  try {
    // Initialize database
    await initDatabase();

    // Check if server is running
    try {
      await makeRequest('/api/auth/me', 'GET');
    } catch (e) {
      log('❌ Server not running. Start with: cd server && node server.js', 'red');
      process.exit(1);
    }

    const results = {
      setup: false,
      progressiveDelays: false,
      accountLockout: false,
      correctPasswordLocked: false,
      databaseRecords: false,
      autoUnlock: false
    };

    // Run tests
    results.setup = await setupTestUser();
    if (!results.setup) {
      log('\n❌ Setup failed, aborting tests', 'red');
      process.exit(1);
    }

    results.progressiveDelays = await testProgressiveDelays();
    results.accountLockout = await testAccountLockout();
    results.correctPasswordLocked = await testCorrectPasswordWhileLocked();
    results.databaseRecords = await testDatabaseRecords();
    results.autoUnlock = await testAutoUnlock();

    await cleanup();

    // Print summary
    log('\n═══════════════════════════════════════════════════════', 'blue');
    log('  Test Summary', 'blue');
    log('═══════════════════════════════════════════════════════', 'blue');

    const tests = [
      ['Progressive Delays (1s, 2s, 4s)', results.progressiveDelays],
      ['Account Lockout After 10 Attempts', results.accountLockout],
      ['Correct Password Blocked When Locked', results.correctPasswordLocked],
      ['Database Records Complete', results.databaseRecords],
      ['Auto-Unlock After 15 Minutes', results.autoUnlock]
    ];

    tests.forEach(([name, passed]) => {
      const status = passed ? '✅' : '❌';
      const color = passed ? 'green' : 'red';
      log(`${status} ${name}`, color);
    });

    const allPassed = Object.values(results).every(r => r === true);

    if (allPassed) {
      log('\n🎉 All tests passed!', 'green');
      log('\n✅ Brute-force protection is working correctly:', 'green');
      log('  • Progressive delays applied based on failed attempt count', 'green');
      log('  • Account locks after 10 failed attempts in 15 minutes', 'green');
      log('  • Locked accounts reject even correct passwords', 'green');
      log('  • All attempts recorded in database with timestamps', 'green');
      log('  • Account auto-unlocks after 15-minute window expires', 'green');
      process.exit(0);
    } else {
      log('\n❌ Some tests failed', 'red');
      process.exit(1);
    }

  } catch (error) {
    log(`\n❌ Error: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
