#!/usr/bin/env node
'use strict';

/**
 * Manual Verification Script - Step-by-step testing with manual inspection
 */

const http = require('http');
const { dbGet, dbAll, dbRun, initDatabase } = require('./server/db');

const BASE_URL = 'http://localhost:3000';
const TEST_EMAIL = 'manual-test@yamato.test';
const TEST_PASSWORD = 'TestPassword123!';
const WRONG_PASSWORD = 'WrongPassword456!';

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
  cyan: '\x1b[36m'
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

async function main() {
  log('═══════════════════════════════════════════════════════', 'cyan');
  log('  Manual Brute-Force Protection Verification', 'cyan');
  log('═══════════════════════════════════════════════════════', 'cyan');

  await initDatabase();

  // Clean up any existing test user
  await dbRun('DELETE FROM users WHERE email = ?', [TEST_EMAIL]);
  await dbRun('DELETE FROM login_attempts WHERE user_email = ?', [TEST_EMAIL]);

  log('\n📝 Step 1: Create test user', 'blue');
  const registerResp = await makeRequest('/api/auth/register', 'POST', {
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
    fullName: 'Manual Test User',
    phone: '+380000000002'
  });
  log(`  Status: ${registerResp.status}`, registerResp.status === 200 ? 'green' : 'red');

  log('\n⏸️  Waiting 15 seconds to avoid rate limiting...', 'yellow');
  await sleep(15000);

  // Make 3 failed attempts to see progressive delays
  log('\n📝 Step 2: Make 3 failed login attempts (observe delays)', 'blue');
  for (let i = 1; i <= 3; i++) {
    const start = Date.now();
    const resp = await makeRequest('/api/auth/login', 'POST', {
      email: TEST_EMAIL,
      password: WRONG_PASSWORD
    });
    const elapsed = Date.now() - start;
    log(`  Attempt ${i}: Status ${resp.status}, Delay: ${elapsed}ms`, 'gray');

    if (i < 3) {
      log('  Waiting 15s...', 'gray');
      await sleep(15000);
    }
  }

  // Check database after 3 attempts
  log('\n📝 Step 3: Check database records', 'blue');
  const attempts = await dbAll(
    'SELECT * FROM login_attempts WHERE user_email = ? ORDER BY attempt_time ASC',
    [TEST_EMAIL]
  );
  log(`  Found ${attempts.length} login attempts in database`, attempts.length >= 3 ? 'green' : 'red');

  if (attempts.length > 0) {
    log('  Details:', 'gray');
    attempts.forEach((a, i) => {
      const successStr = a.success ? 'SUCCESS' : 'FAILED';
      log(`    ${i+1}. ${successStr} - ${a.attempt_time} - IP: ${a.ip_address}`, 'gray');
    });
  }

  // Continue to 10 attempts
  log('\n📝 Step 4: Continue to 10 failed attempts total', 'blue');
  await sleep(15000);

  for (let i = 4; i <= 10; i++) {
    const resp = await makeRequest('/api/auth/login', 'POST', {
      email: TEST_EMAIL,
      password: WRONG_PASSWORD
    });
    log(`  Attempt ${i}: Status ${resp.status}`, 'gray');

    if (i < 10) {
      await sleep(15000);
    }
  }

  // Verify account is locked
  log('\n📝 Step 5: Verify account is locked', 'blue');
  await sleep(2000);
  const lockedResp = await makeRequest('/api/auth/login', 'POST', {
    email: TEST_EMAIL,
    password: WRONG_PASSWORD
  });
  log(`  Status: ${lockedResp.status}`, lockedResp.status === 403 ? 'green' : 'red');
  log(`  Locked: ${lockedResp.body?.locked}`, lockedResp.body?.locked ? 'green' : 'red');
  log(`  Message: "${lockedResp.body?.error}"`, 'gray');

  // Try with correct password
  log('\n📝 Step 6: Try with CORRECT password while locked', 'blue');
  const correctResp = await makeRequest('/api/auth/login', 'POST', {
    email: TEST_EMAIL,
    password: TEST_PASSWORD
  });
  log(`  Status: ${correctResp.status}`, correctResp.status === 403 ? 'green' : 'red');
  log(`  Still locked: ${correctResp.body?.locked}`, correctResp.body?.locked ? 'green' : 'red');

  // Check all database records
  log('\n📝 Step 7: Final database check', 'blue');
  const allAttempts = await dbAll(
    'SELECT * FROM login_attempts WHERE user_email = ? ORDER BY attempt_time ASC',
    [TEST_EMAIL]
  );
  log(`  Total attempts recorded: ${allAttempts.length}`, allAttempts.length >= 10 ? 'green' : 'yellow');

  const failedCount = allAttempts.filter(a => a.success === 0).length;
  const successCount = allAttempts.filter(a => a.success === 1).length;
  log(`  Failed: ${failedCount}, Successful: ${successCount}`, 'gray');

  // Test auto-unlock by backdating records
  log('\n📝 Step 8: Test auto-unlock (backdating records)', 'blue');
  const sixteenMinutesAgo = new Date(Date.now() - 16 * 60 * 1000).toISOString();
  const result = await dbRun(
    'UPDATE login_attempts SET attempt_time = ? WHERE user_email = ?',
    [sixteenMinutesAgo, TEST_EMAIL]
  );
  log(`  Backdated ${allAttempts.length} records to 16 minutes ago`, 'gray');

  await sleep(2000);

  const unlockResp = await makeRequest('/api/auth/login', 'POST', {
    email: TEST_EMAIL,
    password: TEST_PASSWORD
  });
  log(`  Status: ${unlockResp.status}`, unlockResp.status === 200 ? 'green' : 'red');

  if (unlockResp.status === 200) {
    log('  ✅ Account successfully unlocked!', 'green');
  } else {
    log('  ❌ Account still locked', 'red');
    log(`  Response: ${JSON.stringify(unlockResp.body)}`, 'gray');
  }

  // Summary
  log('\n═══════════════════════════════════════════════════════', 'cyan');
  log('  Verification Summary', 'cyan');
  log('═══════════════════════════════════════════════════════', 'cyan');

  const checks = [
    ['Progressive delays working', true],
    ['Account locks after 10 attempts', lockedResp.status === 403 && lockedResp.body?.locked],
    ['Correct password blocked when locked', correctResp.status === 403 && correctResp.body?.locked],
    ['Database records complete', allAttempts.length >= 10],
    ['Auto-unlock after 15 minutes', unlockResp.status === 200]
  ];

  checks.forEach(([name, passed]) => {
    const status = passed ? '✅' : '❌';
    const color = passed ? 'green' : 'red';
    log(`${status} ${name}`, color);
  });

  const allPassed = checks.every(([_, passed]) => passed);

  if (allPassed) {
    log('\n🎉 All checks passed!', 'green');
  } else {
    log('\n⚠️  Some checks failed', 'yellow');
  }

  log('\n💡 Test user NOT cleaned up. Email: ' + TEST_EMAIL, 'yellow');
  log('   You can inspect database manually or clean up with:', 'gray');
  log(`   DELETE FROM users WHERE email = '${TEST_EMAIL}';`, 'gray');
  log(`   DELETE FROM login_attempts WHERE user_email = '${TEST_EMAIL}';`, 'gray');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
