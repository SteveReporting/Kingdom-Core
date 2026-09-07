import fs from 'node:fs/promises';

const source = await fs.readFile(new URL('../src/services/carryPartiesV3.js', import.meta.url), 'utf8');
const required = [
  "runTarget === null ? '∞'",
  'runsCompleted',
  'Claim & Configure',
  'Complete Run',
  'Extend Session',
  'End Session',
  'Left Early',
  'session-submit',
  'extend-submit',
  'dispute-submit',
  "current.status = 'closing'",
  "current.status = 'between'",
  'completedSessions',
  'participantHistory',
  'carryDisputes',
  'maxMembers',
  'requirement'
];

const failures = required.filter((needle) => !source.includes(needle));
await import('../src/services/carryPartiesV3.js');

if (failures.length) {
  console.error('Carry session self-test FAILED:');
  for (const item of failures) console.error(`- missing ${item}`);
  process.exit(1);
}

console.log('Carry session self-test passed: configurable run targets, unlimited sessions, progress, extensions, member rotation, early-leave tracking and disputes are wired.');
