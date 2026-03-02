#!/usr/bin/env node
'use strict';

/**
 * Brute-Force Protection Verification Script
 * Tests progressive delays, account lockout, and auto-unlock functionality
 */

const http = require('http');
const { dbGet, dbAll, dbRun, initDatabase } = require('./server/db');

const BASE_URL = 'http://localhost:3000';
const TEST_EMAIL = 'bruteforce-test@yamato.test';
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

  // Register test user
  const response = await makeRequest('/api/auth/register', 'POST', {
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
    fullName: 'Brute Force Test User',
    phone: '+380000000000'
  });

  if (response.status === 200 && response.body.success) {
    log('✅ Test user created successfully', 'green');
    return true;
  } else {
    log(`❌ Failed to create test user: ${JSON.stringify(response.body)}`, 'red');
    return false;
  }
}

async function testProgressiveDelays() {
  log('\n🔍 Test 1: Progressive Delays (1s, 2s, 4s)', 'blue');

  const delays = [];
  const expectedDelays = [1000, 2000, 4000]; // 1s, 2s, 4s
  const tolerance = 500; // 500ms tolerance

  for (let i = 1; i <= 3; i++) {
    const startTime = Date.now();

    const response = await makeRequest('/api/auth/login', 'POST', {
      email: TEST_EMAIL,
      password: WRONG_PASSWORD
    });

    const elapsed = Date.now() - startTime;
    delays.push(elapsed);

    log(`  Attempt ${i}: ${response.status} - Delay: ${elapsed}ms (expected: ~${expectedDelays[i-1]}ms)`, 'gray');

    if (response.status !== 401) {
      log(`❌ Expected 401 Unauthorized, got ${response.status}`, 'red');
      return false;
    }
  }

  // Verify delays are progressive and within tolerance
  for (let i = 0; i < expectedDelays.length; i++) {
    const actual = delays[i];
    const expected = expectedDelays[i];
    const diff = Math.abs(actual - expected);

    if (diff > tolerance && actual < expected) {
      log(`❌ Delay ${i+1} too short: ${actual}ms (expected: ~${expected}ms)`, 'red');
      return false;
    }
  }

  log('✅ Progressive delays working correctly', 'green');
  return true;
}

async function testAccountLockout() {
  log('\n🔍 Test 2: Account Lockout After 10 Failed Attempts', 'blue');

  // We already have 3 failed attempts from previous test
  // Make 7 more to reach 10 total
  for (let i = 4; i <= 10; i++) {
    const response = await makeRequest('/api/auth/login', 'POST', {
      email: TEST_EMAIL,
      password: WRONG_PASSWORD
    });

    log(`  Attempt ${i}: ${response.status}`, 'gray');

    if (i < 10 && response.status === 403 && response.body.locked) {
      log(`❌ Account locked too early at attempt ${i}`, 'red');
      return false;
    }
  }

  // Check if account is now locked
  const response = await makeRequest('/api/auth/login', 'POST', {
    email: TEST_EMAIL,
    password: WRONG_PASSWORD
  });

  if (response.status === 403 && response.body.locked) {
    log(`✅ Account locked after 10 failed attempts`, 'green');
    log(`  Message: "${response.body.error}"`, 'gray');
    return true;
  } else {
    log(`❌ Account not locked. Status: ${response.status}`, 'red');
    return false;
  }
}

async function testCorrectPasswordWhileLocked() {
  log('\n🔍 Test 3: Correct Password Returns 403 When Locked', 'blue');

  const response = await makeRequest('/api/auth/login', 'POST', {
    email: TEST_EMAIL,
    password: TEST_PASSWORD // Correct password
  });

  if (response.status === 403 && response.body.locked) {
    log('✅ Correct password rejected while account locked', 'green');
    return true;
  } else {
    log(`❌ Expected 403 with locked=true, got ${response.status}`, 'red');
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

  if (attempts.length < 11) { // 1 successful (registration auto-login) + 10 failed
    log(`❌ Expected at least 11 attempts, found ${attempts.length}`, 'red');
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
  if (withIP.length < attempts.length) {
    log(`⚠️  Some attempts missing IP address (${withIP.length}/${attempts.length})`, 'yellow');
  }

  log('✅ Database records correct', 'green');
  return true;
}

async function testAutoUnlock() {
  log('\n🔍 Test 5: Auto-Unlock After 15 Minutes', 'blue');
  log('  Note: Testing with manipulated timestamps (15 min wait not practical)', 'yellow');

  // Manipulate database to simulate 15 minutes passing
  const fifteenMinutesAgo = new Date(Date.now() - 16 * 60 * 1000).toISOString();

  await dbRun(
    'UPDATE login_attempts SET attempt_time = ? WHERE user_email = ?',
    [fifteenMinutesAgo, TEST_EMAIL]
  );

  log('  Backdated all attempts to 16 minutes ago', 'gray');

  // Try to login with correct password
  const response = await makeRequest('/api/auth/login', 'POST', {
    email: TEST_EMAIL,
    password: TEST_PASSWORD
  });

  if (response.status === 200 && response.body.success) {
    log('✅ Account auto-unlocked after 15 minutes', 'green');
    return true;
  } else {
    log(`❌ Login failed after time window. Status: ${response.status}`, 'red');
    log(`  Response: ${JSON.stringify(response.body)}`, 'gray');
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
  log('  Brute-Force Protection Verification', 'blue');
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

    // Wait a bit to avoid rate limiting
    await sleep(2000);

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
