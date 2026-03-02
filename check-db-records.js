#!/usr/bin/env node
'use strict';

const { initDatabase, dbAll } = require('./server/db');

async function main() {
  await initDatabase();

  console.log('=== Login Attempts for Brute-Force Test Users ===\n');

  const attempts = await dbAll(
    "SELECT user_email, COUNT(*) as count, MAX(attempt_time) as last_attempt FROM login_attempts WHERE user_email LIKE '%bruteforce%' GROUP BY user_email"
  );

  console.log('Summary by user:');
  attempts.forEach(a => {
    console.log(`  ${a.user_email}: ${a.count} attempts (last: ${a.last_attempt})`);
  });

  console.log('\n=== Detailed Records for bruteforce-test-v2@yamato.test ===\n');

  const detailed = await dbAll(
    "SELECT * FROM login_attempts WHERE user_email = 'bruteforce-test-v2@yamato.test' ORDER BY attempt_time ASC"
  );

  if (detailed.length === 0) {
    console.log('No records found (cleaned up by test)');
  } else {
    detailed.forEach((a, i) => {
      const age = Date.now() - new Date(a.attempt_time).getTime();
      const minutes = Math.floor(age / 60000);
      console.log(`  ${i+1}. ${a.success ? 'SUCCESS' : 'FAILED'} - ${a.attempt_time} (${minutes}m ago) - IP: ${a.ip_address}`);
    });
  }

  console.log('\n=== All Recent Login Attempts (last 20) ===\n');

  const recent = await dbAll(
    "SELECT * FROM login_attempts ORDER BY attempt_time DESC LIMIT 20"
  );

  recent.forEach((a, i) => {
    console.log(`  ${i+1}. ${a.user_email.substring(0, 30)} - ${a.success ? 'SUCCESS' : 'FAILED'} - ${a.attempt_time}`);
  });

  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
