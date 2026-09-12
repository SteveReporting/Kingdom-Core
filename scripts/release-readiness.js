import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';

const blockers = [];
const warnings = [];
const passed = [];

function value(name) {
  return String(process.env[name] ?? '').trim();
}

function enabled(name, fallback = false) {
  const raw = value(name);
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

function requireValue(name, message = `${name} is not configured.`) {
  if (!value(name)) blockers.push(message);
  else passed.push(name);
}

function validDiscordId(input) {
  return /^\d{17,20}$/.test(String(input || ''));
}

function isLoopback(host) {
  const normalized = String(host || '').trim().toLowerCase();
  return ['127.0.0.1', 'localhost', '::1'].includes(normalized);
}

function parseUrl(name, required = false) {
  const raw = value(name);
  if (!raw) {
    if (required) blockers.push(`${name} is not configured.`);
    return null;
  }
  try {
    return new URL(raw);
  } catch {
    blockers.push(`${name} is not a valid URL.`);
    return null;
  }
}

requireValue('TOKEN', 'TOKEN is missing. Kingdom Core cannot connect to Discord.');
requireValue('CLIENT_ID', 'CLIENT_ID is missing.');
requireValue('GUILD_ID', 'GUILD_ID is missing. Production commands cannot be safely guild-deployed.');

if (value('CLIENT_ID') && !validDiscordId(value('CLIENT_ID'))) blockers.push('CLIENT_ID does not look like a Discord application ID.');
if (value('GUILD_ID') && !validDiscordId(value('GUILD_ID'))) blockers.push('GUILD_ID does not look like a Discord guild ID.');

const nexusEnabled = enabled('KINGDOM_NEXUS_ENABLED', true);
if (nexusEnabled) {
  requireValue('DISCORD_OAUTH_CLIENT_SECRET', 'DISCORD_OAUTH_CLIENT_SECRET is missing while Nexus is enabled.');
  const nexusPublic = parseUrl('KINGDOM_NEXUS_PUBLIC_URL', true);
  if (nexusPublic && nexusPublic.protocol !== 'https:') blockers.push('KINGDOM_NEXUS_PUBLIC_URL must use HTTPS in production.');

  const nexusHost = value('KINGDOM_NEXUS_HOST') || '127.0.0.1';
  if (!isLoopback(nexusHost)) blockers.push('KINGDOM_NEXUS_HOST must remain loopback-only; expose Nexus through the configured secure edge/tunnel.');
  else passed.push('Nexus loopback binding');
}

const platformEnabled = enabled('ENABLE_PLATFORM_API', false);
const apiHost = value('API_HOST') || '127.0.0.1';
const apiPort = Number(value('API_PORT') || 8787);
if (platformEnabled) {
  requireValue('API_ADMIN_TOKEN', 'ENABLE_PLATFORM_API=true but API_ADMIN_TOKEN is missing.');
  if (value('API_ADMIN_TOKEN') && value('API_ADMIN_TOKEN').length < 32) blockers.push('API_ADMIN_TOKEN should be at least 32 characters.');
  if (!isLoopback(apiHost)) blockers.push('API_HOST must remain loopback-only when the HQ bridge is enabled.');
  if (!Number.isInteger(apiPort) || apiPort < 1 || apiPort > 65535) blockers.push('API_PORT is invalid.');
  else passed.push('HQ/Core private API configuration');
} else {
  warnings.push('ENABLE_PLATFORM_API is false. The Kingdom Carries HQ live queue/carry/profile bridge will not work until it is enabled.');
}

const kmiUrl = parseUrl('KMI_API_URL');
if (!kmiUrl) {
  warnings.push('KMI_API_URL is not configured; /value and KMI-backed Asset Bank deposits will not be usable.');
} else {
  if (!['http:', 'https:'].includes(kmiUrl.protocol)) blockers.push('KMI_API_URL must use HTTP or HTTPS.');
  const kmiPort = Number(kmiUrl.port || (kmiUrl.protocol === 'https:' ? 443 : 80));
  const kmiHost = kmiUrl.hostname.toLowerCase();
  const apiHostNormalized = apiHost.toLowerCase();
  const sameHost = kmiHost === apiHostNormalized || (isLoopback(kmiHost) && isLoopback(apiHostNormalized));
  if (platformEnabled && sameHost && kmiPort === apiPort) {
    blockers.push(`KMI_API_URL and Kingdom Core platform API both resolve to ${kmiHost}:${kmiPort}. They must run on different ports/services.`);
  } else {
    passed.push('KMI endpoint does not collide with HQ/Core API');
  }
  if (isLoopback(kmiHost)) passed.push('KMI loopback binding');
  else warnings.push('KMI_API_URL is not loopback. Make sure the KMI service is authenticated and transported securely.');
}

const creditRate = Number(value('DQ_BANK_CREDIT_RATE') || 0.9);
const reserveRatio = Number(value('DQ_BANK_RESERVE_RATIO') || 0.15);
if (!Number.isFinite(creditRate) || creditRate < 0.1 || creditRate > 1) blockers.push('DQ_BANK_CREDIT_RATE must be between 0.10 and 1.00.');
else passed.push('DQ Asset Bank credit rate');
if (!Number.isFinite(reserveRatio) || reserveRatio < 0 || reserveRatio > 0.95) blockers.push('DQ_BANK_RESERVE_RATIO must be between 0 and 0.95.');
else passed.push('DQ Asset Bank reserve ratio');

const dataDir = path.resolve(value('DQ_DATA_DIR') || 'data/dq');
try {
  await fs.mkdir(dataDir, { recursive: true });
  const probe = path.join(dataDir, `.release-probe-${process.pid}`);
  await fs.writeFile(probe, 'ok', 'utf8');
  await fs.unlink(probe);
  passed.push(`DQ data directory writable (${dataDir})`);
} catch (error) {
  blockers.push(`DQ data directory is not writable: ${dataDir} (${error.message})`);
}

for (const name of ['STAFF_ACCEPT_ROLE_IDS', 'CARRIER_ACCEPT_ROLE_IDS', 'CREATOR_ACCEPT_ROLE_IDS']) {
  if (!value(name)) warnings.push(`${name} is blank. Confirm the intended fallback/no-role behaviour before opening that application type.`);
}

if (!value('KINGDOM_DISCORD_URL')) warnings.push('KINGDOM_DISCORD_URL is blank; Nexus Launcher will not have an explicit Discord destination.');
if (!value('KINGDOM_GAME_URL')) warnings.push('KINGDOM_GAME_URL is blank; Nexus Launcher will not have an explicit game destination.');
if (!value('KINGDOM_WEBSITE_URL')) warnings.push('KINGDOM_WEBSITE_URL is blank; Nexus Launcher will not have an explicit website destination.');

console.log('\n=== Kingdom Carries production preflight ===');
for (const item of passed) console.log(`PASS  ${item}`);
for (const item of warnings) console.log(`WARN  ${item}`);
for (const item of blockers) console.log(`FAIL  ${item}`);
console.log(`\nResult: ${blockers.length} blocker(s), ${warnings.length} warning(s), ${passed.length} pass(es).`);

if (blockers.length) process.exit(1);
console.log('Production configuration preflight passed.');
