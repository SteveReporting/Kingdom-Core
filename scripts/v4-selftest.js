import fs from 'node:fs/promises';
import path from 'node:path';
import { APPROVED_V4_SYSTEMS } from '../src/config/approvedSystemsV4.js';

const root = process.cwd();
const missing = [];
const checked = [];

for (const [number, [name, file]] of Object.entries(APPROVED_V4_SYSTEMS)) {
  const candidates = [
    path.join(root, 'src', file),
    path.join(root, 'src', 'services', file),
    path.join(root, 'src', 'commands', file),
    path.join(root, 'src', 'config', file),
    path.join(root, 'src', 'ui', file),
    path.join(root, file),
    path.join(root, 'scripts', file)
  ];
  let found = false;
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      found = true;
      break;
    } catch {}
  }
  checked.push({ number, name, file, found });
  if (!found) missing.push(`#${number} ${name} -> ${file}`);
}

const requiredImports = [
  '../src/commands/setup4.js',
  '../src/services/platformV4Complete.js',
  '../src/services/communityV4.js',
  '../src/services/securityV4.js',
  '../src/services/externalInfraV4.js',
  '../src/services/platformApiV4.js',
  '../src/ui/kingdomV4Ui.js'
];
for (const specifier of requiredImports) await import(specifier);

if (missing.length) {
  console.error('Approved-system manifest failures:');
  for (const row of missing) console.error(` - ${row}`);
  process.exit(1);
}

console.log(`Kingdom Core v4 self-test passed: ${checked.length} approved roadmap systems mapped to implementation files.`);
