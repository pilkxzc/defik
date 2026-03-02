#!/usr/bin/env node
'use strict';

/**
 * Check the server's actual database file
 */

const fs = require('fs');
const initSqlJs = require('./server/node_modules/sql.js');

async function main() {
  console.log('Reading server database file...\n');

  const dbPath = './server/database.sqlite';
  const SQL = await initSqlJs();
  const fileBuffer = fs.readFileSync(dbPath);
  const db = new SQL.Database(fileBuffer);

  // Check for manual-test user
  const manualTestAttempts = db.exec(
    "SELECT * FROM login_attempts WHERE user_email = 'manual-test@yamato.test' ORDER BY attempt_time ASC"
  );

  console.log('=== manual-test@yamato.test Login Attempts ===');
  if (manualTestAttempts.length > 0 && manualTestAttempts[0].values.length > 0) {
    const cols = manualTestAttempts[0].columns;
    const rows = manualTestAttempts[0].values;
    console.log(`Found ${rows.length} attempts:\n`);
    rows.forEach((row, i) => {
      const record = {};
      cols.forEach((col, j) => {
        record[col] = row[j];
      });
      const status = record.success ? 'SUCCESS' : 'FAILED';
      console.log(`  ${i+1}. ${status} - ${record.attempt_time} - IP: ${record.ip_address}`);
    });
  } else {
    console.log('No attempts found');
  }

  // Check all recent attempts
  console.log('\n=== All Recent Login Attempts (last 20) ===');
  const recentAttempts = db.exec(
    "SELECT * FROM login_attempts ORDER BY attempt_time DESC LIMIT 20"
  );

  if (recentAttempts.length > 0 && recentAttempts[0].values.length > 0) {
    const cols = recentAttempts[0].columns;
    const rows = recentAttempts[0].values;
    console.log(`Found ${rows.length} recent attempts:\n`);
    rows.forEach((row, i) => {
      const record = {};
      cols.forEach((col, j) => {
        record[col] = row[j];
      });
      const status = record.success ? 'SUCCESS' : 'FAILED';
      const email = record.user_email.substring(0, 35);
      console.log(`  ${i+1}. ${email.padEnd(35)} - ${status} - ${record.attempt_time}`);
    });
  } else {
    console.log('No attempts found');
  }

  db.close();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
