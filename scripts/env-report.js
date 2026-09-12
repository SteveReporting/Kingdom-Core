import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const envPath = path.join(root, '.env');
const examplePath = path.join(root, '.env.example');

function parseEnvText(text) {
  const keys = [];
  const values = new Map();
  const duplicates = new Set();
  const counts = new Map();

  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    const count = (counts.get(key) || 0) + 1;
    counts.set(key, count);
    if (count > 1) duplicates.add(key);
    if (!values.has(key)) keys.push(key);
    values.set(key, rawValue);
  }

  return { keys, values, duplicates };
}

async function walk(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full));
    else if (/\.(?:js|mjs|cjs)$/i.test(entry.name)) out.push(full);
  }
  return out;
}

async function codeReferencedKeys() {
  const files = [
    ...await walk(path.join(root, 'src')),
    ...await walk(path.join(root, 'scripts'))
  ];
  const keys = new Set();
  const direct = /process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g;
  const bracket = /process\.env\[['"]([A-Za-z_][A-Za-z0-9_]*)['"]\]/g;

  for (const file of files) {
    const text = await fs.readFile(file, 'utf8');
    for (const regex of [direct, bracket]) {
      regex.lastIndex = 0;
      let match;
      while ((match = regex.exec(text))) keys.add(match[1]);
    }
  }
  return [...keys].sort();
}

function section(title, rows) {
  console.log(`\n=== ${title} ===`);
  if (!rows.length) {
    console.log('(none)');
    return;
  }
  for (const row of rows) console.log(row);
}

let envText;
try {
  envText = await fs.readFile(envPath, 'utf8');
} catch (error) {
  console.error('Could not read .env from the current Kingdom-Core directory.');
  console.error('Run this from ~/Kingdom-Core after git pull.');
  process.exit(error?.code === 'ENOENT' ? 2 : 1);
}

const exampleText = await fs.readFile(examplePath, 'utf8');
const current = parseEnvText(envText);
const example = parseEnvText(exampleText);
const codeKeys = await codeReferencedKeys();

const currentSet = new Set(current.keys);
const exampleSet = new Set(example.keys);
const codeSet = new Set(codeKeys);

const blank = current.keys.filter((key) => String(current.values.get(key) ?? '').trim() === '');
const onlyCurrent = current.keys.filter((key) => !exampleSet.has(key)).sort();
const missingDocumented = example.keys.filter((key) => !currentSet.has(key)).sort();
const missingCode = codeKeys.filter((key) => !currentSet.has(key));
const codeNotDocumented = codeKeys.filter((key) => !exampleSet.has(key));
const documentedNotStaticallyDetected = example.keys.filter((key) => !codeSet.has(key)).sort();

console.log('Kingdom Core environment inventory');
console.log('No environment values are printed by this report.');
console.log(`Current .env keys: ${current.keys.length}`);
console.log(`Documented .env.example keys: ${example.keys.length}`);
console.log(`Statically detected process.env references in code: ${codeKeys.length}`);

section('CURRENT KEY NAMES (safe to paste)', current.keys);
section('EXISTING KEYS NOT IN .env.example (preserve these until reviewed)', onlyCurrent);
section('DOCUMENTED KEYS MISSING FROM CURRENT .env', missingDocumented);
section('STATICALLY CODE-REFERENCED KEYS MISSING FROM CURRENT .env', missingCode);
section('STATICALLY CODE-REFERENCED KEYS NOT DOCUMENTED IN .env.example', codeNotDocumented);
section('CURRENT KEYS WITH BLANK VALUES', blank);
section('DUPLICATE KEYS IN CURRENT .env', [...current.duplicates].sort());
section('DOCUMENTED KEYS NOT STATICALLY DETECTED (may be read dynamically; do NOT treat as unused)', documentedNotStaticallyDetected);

if (current.duplicates.size) {
  console.log('\nWARNING: duplicate keys can make configuration ambiguous. Do not delete either copy until the intended value is confirmed.');
}

console.log('\nPaste this report into ChatGPT. It contains key names only, not your secrets.');
