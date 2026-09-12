import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const envPath = path.join(root, '.env');
const examplePath = path.join(root, '.env.example');

function parseKeys(text) {
  const keys = new Set();
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (match) keys.add(match[1]);
  }
  return keys;
}

function parseExampleEntries(text) {
  const entries = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = raw.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (match) entries.push({ key: match[1], value: match[2] });
  }
  return entries;
}

let current;
try {
  current = await fs.readFile(envPath, 'utf8');
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
  console.error('No .env found. Create it first from .env.example or restore the existing production file.');
  process.exit(2);
}

const example = await fs.readFile(examplePath, 'utf8');
const existing = parseKeys(current);
const missing = parseExampleEntries(example).filter(({ key }) => !existing.has(key));

if (!missing.length) {
  console.log('Environment already contains every key documented in .env.example. Nothing changed.');
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = `${envPath}.backup-${stamp}`;
await fs.copyFile(envPath, backup);

const block = [
  '',
  '# -----------------------------------------------------------------------------',
  '# Added automatically by npm run env:sync',
  '# Existing keys and values above were NOT modified.',
  '# Review blank values before production release.',
  '# -----------------------------------------------------------------------------',
  ...missing.map(({ key, value }) => `${key}=${value}`),
  ''
].join('\n');

await fs.appendFile(envPath, block, 'utf8');

console.log(`Backed up existing .env to: ${path.basename(backup)}`);
console.log(`Appended ${missing.length} missing key(s) without changing any existing value:`);
for (const { key } of missing) console.log(`+ ${key}`);
console.log('\nRun: node scripts/env-report.js');
console.log('Then run: npm run preflight:prod');
