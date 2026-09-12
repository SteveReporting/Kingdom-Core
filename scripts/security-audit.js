import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const failures = [];
const warnings = [];
const passes = [];

function pass(message) { passes.push(message); }
function warn(message) { warnings.push(message); }
function fail(message) { failures.push(message); }

function isLoopback(value) {
  const host = String(value ?? '').trim().toLowerCase();
  return host === '127.0.0.1' || host === '::1' || host === 'localhost';
}

function modeString(stat) {
  return (stat.mode & 0o777).toString(8).padStart(3, '0');
}

async function checkPrivatePath(relative, expectedKind = null) {
  const full = path.resolve(root, relative);
  try {
    const stat = await fs.stat(full);
    if (expectedKind === 'file' && !stat.isFile()) return fail(`${relative} is not a regular file.`);
    if (expectedKind === 'dir' && !stat.isDirectory()) return fail(`${relative} is not a directory.`);
    const mode = stat.mode & 0o777;
    if ((mode & 0o077) !== 0) fail(`${relative} permissions are ${modeString(stat)}; group/other access must be removed.`);
    else pass(`${relative} permissions are private (${modeString(stat)}).`);
  } catch (error) {
    if (error?.code === 'ENOENT') warn(`${relative} does not exist.`);
    else fail(`${relative} could not be inspected.`);
  }
}

async function scanDataPermissions() {
  const dataRoot = path.resolve(root, 'data');
  let seen = 0;
  async function walk(dir) {
    if (seen > 5000) return;
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); }
    catch (error) {
      if (error?.code !== 'ENOENT') fail(`Could not inspect ${path.relative(root, dir)}.`);
      return;
    }
    for (const entry of entries) {
      if (++seen > 5000) break;
      const full = path.join(dir, entry.name);
      const stat = await fs.lstat(full).catch(() => null);
      if (!stat) continue;
      if (stat.isSymbolicLink()) {
        fail(`Symlink found inside data/: ${path.relative(root, full)}.`);
        continue;
      }
      const mode = stat.mode & 0o777;
      if ((mode & 0o077) !== 0) fail(`${path.relative(root, full)} permissions are ${modeString(stat)}.`);
      if (entry.isDirectory()) await walk(full);
    }
  }
  await walk(dataRoot);
  if (seen <= 5000) pass(`Inspected ${seen} data entries for unsafe permissions/symlinks.`);
  else warn('Data permission scan stopped after 5000 entries.');
}

function checkSecret(name, minLength = 32, required = false) {
  const value = String(process.env[name] ?? '').trim();
  if (!value) {
    if (required) fail(`${name} is missing.`);
    else warn(`${name} is not configured.`);
    return;
  }
  if (value.length < minLength) fail(`${name} is shorter than ${minLength} characters.`);
  else pass(`${name} is present with acceptable length.`);
}

function checkTrackedSensitiveFiles() {
  try {
    const files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
      .split(/\r?\n/)
      .filter(Boolean);
    const unsafe = files.filter((file) =>
      file === '.env' ||
      file.startsWith('.env.') && file !== '.env.example' ||
      /^data\/.*\.(json|bak|tmp)$/i.test(file) ||
      /^secrets\//i.test(file) && !/^secrets\/README\.md$/i.test(file)
    );
    if (unsafe.length) fail(`Sensitive runtime files are tracked by git: ${unsafe.join(', ')}`);
    else pass('No .env, runtime data, backup or secret files are tracked by git.');
  } catch {
    warn('Git tracked-file audit could not be completed.');
  }
}

if (String(process.env.ENABLE_PLATFORM_API).toLowerCase() === 'true') {
  if (isLoopback(process.env.API_HOST || '127.0.0.1')) pass('Platform API is configured for loopback only.');
  else fail('API_HOST is not loopback while the platform API is enabled.');
}

if (String(process.env.KINGDOM_NEXUS_ENABLED).toLowerCase() !== 'false') {
  if (isLoopback(process.env.KINGDOM_NEXUS_HOST || '127.0.0.1')) pass('Kingdom Nexus is configured for loopback only.');
  else fail('KINGDOM_NEXUS_HOST is not loopback.');
}

const publicUrl = String(process.env.KINGDOM_NEXUS_PUBLIC_URL ?? '').trim();
if (publicUrl && !publicUrl.startsWith('https://')) fail('KINGDOM_NEXUS_PUBLIC_URL must use HTTPS.');
else if (publicUrl) pass('Kingdom Nexus public URL uses HTTPS.');

checkSecret('TOKEN', 50, true);
checkSecret('API_ADMIN_TOKEN', 32, String(process.env.ENABLE_PLATFORM_API).toLowerCase() === 'true');
checkSecret('KINGDOM_NEXUS_ADMIN_TOKEN', 32, false);
checkSecret('DISCORD_OAUTH_CLIENT_SECRET', 24, false);

await checkPrivatePath('.env', 'file');
await checkPrivatePath('data', 'dir');
await scanDataPermissions();
checkTrackedSensitiveFiles();

console.log('\nKingdom Core host security audit');
for (const message of passes) console.log(`PASS  ${message}`);
for (const message of warnings) console.log(`WARN  ${message}`);
for (const message of failures) console.log(`FAIL  ${message}`);
console.log(`\n${passes.length} pass(es), ${warnings.length} warning(s), ${failures.length} failure(s).`);

if (failures.length) process.exitCode = 1;
