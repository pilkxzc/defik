const fs = require('fs');

const planPath = './.auto-claude/specs/004-api-rate-limiting-brute-force-protection/implementation_plan.json';
const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));

const phase4 = plan.phases.find(p => p.id === 'phase-4-integration');
const subtask = phase4.subtasks.find(s => s.id === 'subtask-4-3');

subtask.status = 'completed';
subtask.updated_at = new Date().toISOString();
subtask.notes = '✅ Comprehensive verification completed. All critical features verified:\n' +
  '- Progressive delays (1s, 2s, 4s) working correctly\n' +
  '- Account lockout after 10 failed attempts confirmed\n' +
  '- Locked accounts reject even correct passwords\n' +
  '- Database recording all attempts with IP, email, timestamps\n' +
  '- Auto-unlock logic verified by code inspection and time window calculation\n\n' +
  'Created verification tools: verify-brute-force-v2.js, manual-verification.js, check-server-db.js\n' +
  'Full report: brute-force-verification-report.md';

plan.updated_at = new Date().toISOString();

fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));
console.log('✅ Plan updated - subtask-4-3 marked as completed');
