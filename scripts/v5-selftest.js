import fs from 'node:fs/promises';
import path from 'node:path';
import { APPROVED_V4_NUMBERS, APPROVED_V4_SYSTEMS } from '../src/config/approvedSystemsV4.js';

const explicitlyApproved = [
  4, 5, 6, 7, 8, 14, 15, 16, 18, 19, 20, 21, 24, 28, 31,
  33, 34, 35, 36, 37, 38, 41, 42, 45, 46, 47, 48, 49, 50, 51,
  52, 53, 54, 55, 56, 57, 61, 63,
  ...Array.from({ length: 46 }, (_, i) => i + 64)
];

const expected = [...new Set(explicitlyApproved)].sort((a, b) => a - b);
const actual = [...APPROVED_V4_NUMBERS].sort((a, b) => a - b);
const missingNumbers = expected.filter((n) => !actual.includes(n));
const extraRequired = actual.filter((n) => !APPROVED_V4_SYSTEMS[n]);
if (missingNumbers.length || extraRequired.length) {
  console.error('Kingdom Core v5 approved-number manifest mismatch.');
  if (missingNumbers.length) console.error('Missing approved numbers:', missingNumbers.join(', '));
  if (extraRequired.length) console.error('Manifest entries missing:', extraRequired.join(', '));
  process.exit(1);
}

const root = process.cwd();
const missingFiles = [];
for (const number of expected) {
  const [name, file] = APPROVED_V4_SYSTEMS[number];
  const candidates = [
    path.join(root, 'src', 'services', file),
    path.join(root, 'src', 'commands', file),
    path.join(root, 'src', 'config', file),
    path.join(root, 'src', file),
    path.join(root, 'scripts', file),
    path.join(root, file)
  ];
  let found = false;
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      found = true;
      break;
    } catch {}
  }
  if (!found) missingFiles.push(`#${number} ${name} -> ${file}`);
}
if (missingFiles.length) {
  console.error('Approved system implementation files missing:');
  missingFiles.forEach((x) => console.error(` - ${x}`));
  process.exit(1);
}

await Promise.all([
  import('../src/services/platformV5.js'),
  import('../src/services/platformV4Complete.js'),
  import('../src/services/platformV4Automation.js'),
  import('../src/services/communityV4.js'),
  import('../src/services/securityV4.js')
]);

console.log(`Kingdom Core v5 self-test passed: ${expected.length} approved roadmap systems remain mapped; the retired /setup5 command is no longer required.`);
