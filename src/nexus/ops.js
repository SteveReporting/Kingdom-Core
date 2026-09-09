import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { PermissionFlagsBits } from 'discord.js';
import { readGuildState } from '../storage/store.js';
import { mutateNexusState } from './state.js';

const VAULT_ROOT = path.resolve('data', 'vault');
const lastMaintenance = new Map();
const lastAutoBackup = new Map();
const MAINTENANCE_INTERVAL_MS = Math.max(15 * 60_000, Number(process.env.KINGDOM_NEXUS_MAINTENANCE_MS ?? 15 * 60_000));
const AUTO_BACKUP_INTERVAL_MS = Math.max(6 * 60 * 60_000, Number(process.env.KINGDOM_NEXUS_BACKUP_MS ?? 6 * 60 * 60_000));

function count(value) {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return Object.keys(value).length;
  return 0;
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function runtime(status, detail, enabled = true) {
  return { enabled, status, detail, checkedAt: new Date().toISOString() };
}

export async function refreshSystemReadiness(guild) {
  const publicUrl = String(process.env.KINGDOM_NEXUS_PUBLIC_URL ?? '').trim();
  const oauthReady = Boolean(
    String(process.env.CLIENT_ID ?? '').trim() &&
    String(process.env.DISCORD_OAUTH_CLIENT_SECRET ?? '').trim() &&
    publicUrl.startsWith('https://')
  );
  const aiReady = Boolean(String(process.env.KINGDOM_AI_LOCAL_URL ?? '').trim());

  let vaultReady = true;
  try {
    await fs.mkdir(path.join(VAULT_ROOT, guild.id), { recursive: true });
    await fs.access(path.join(VAULT_ROOT, guild.id));
  } catch {
    vaultReady = false;
  }

  let sdkReady = true;
  try {
    await fs.access(path.resolve('src', 'nexus', 'sdk-browser.js'));
  } catch {
    sdkReady = false;
  }

  const publicSurfaceReady = publicUrl.startsWith('https://');
  const states = {
    core: runtime('operational', `Discord gateway connected to ${guild.name}.`),
    platform: runtime('operational', 'Shared Kingdom services and Nexus backend are running.'),
    mobile: runtime(publicSurfaceReady ? 'operational' : 'configuration-required', publicSurfaceReady ? 'Installable mobile web client has a secure public origin.' : 'A secure Nexus public origin is required.', publicSurfaceReady),
    desktop: runtime(publicSurfaceReady ? 'operational' : 'configuration-required', publicSurfaceReady ? 'Installable desktop web client has a secure public origin.' : 'A secure Nexus public origin is required.', publicSurfaceReady),
    network: runtime('operational', 'Primary guild and tenant registry are available.'),
    cloud: runtime(publicSurfaceReady ? 'operational' : 'degraded', publicSurfaceReady ? 'Private backend is paired with the secure Nexus public origin.' : 'Private backend is running without a configured public origin.'),
    identity: runtime(oauthReady ? 'operational' : 'configuration-required', oauthReady ? 'Discord OAuth and Kingdom membership sessions are configured.' : 'Discord OAuth configuration is incomplete.', oauthReady),
    launcher: runtime('operational', 'Launcher API and install surface are available.'),
    companion: runtime('operational', 'Build, guide and readiness stores are available.'),
    live: runtime('operational', 'Live queue snapshot and event stream are available.'),
    tv: runtime(publicSurfaceReady ? 'operational' : 'configuration-required', publicSurfaceReady ? 'Broadcast route is available on the secure Nexus origin.' : 'A secure Nexus public origin is required.', publicSurfaceReady),
    creators: runtime('operational', 'Creator campaign registry is available.'),
    api: runtime('operational', 'Authenticated Kingdom HTTP API is available.'),
    sdk: runtime(sdkReady ? 'operational' : 'degraded', sdkReady ? 'Browser SDK asset is present.' : 'SDK asset is missing.', sdkReady),
    studio: runtime('operational', 'Studio layouts and publishing state are available.'),
    sentinel: runtime('operational', 'Discord permission posture scanning is available.'),
    vault: runtime(vaultReady ? 'operational' : 'degraded', vaultReady ? 'Vault storage is writable.' : 'Vault storage is unavailable.', vaultReady),
    intelligence: runtime('operational', 'Operational snapshots and trend history are available.'),
    ai: runtime(aiReady ? 'operational' : 'configuration-required', aiReady ? 'Kingdom AI endpoint is configured.' : 'Set KINGDOM_AI_LOCAL_URL to activate the optional private AI provider.', aiReady),
    nexus: runtime('operational', 'Unified Kingdom control plane is running.')
  };

  await mutateNexusState(guild.id, (nexus) => {
    for (const [slug, state] of Object.entries(states)) nexus.products[slug] = state;
    nexus.ai.enabled = aiReady;
    nexus.ai.provider = aiReady ? 'local' : 'unconfigured';
  });
  return states;
}

export async function buildIntelligenceSnapshot(guild) {
  const state = await readGuildState(guild.id);
  const queue = Array.isArray(state.queue) ? state.queue : [];
  const tickets = state.tickets ?? {};
  const apps = state.applications ?? {};
  const parties = state.carryParties ?? state.parties ?? {};
  const completed = Number(state.stats?.completedCarries ?? state.platform?.analytics?.completedCarries ?? 0);
  const snapshot = {
    at: new Date().toISOString(),
    guildId: guild.id,
    guildName: guild.name,
    membersCached: guild.memberCount ?? null,
    queueDepth: queue.length,
    openTickets: Object.values(tickets).filter((ticket) => !['closed', 'resolved', 'done'].includes(String(ticket?.status ?? '').toLowerCase())).length,
    applications: count(apps),
    activeCarryParties: Object.values(parties).filter((party) => !['ended', 'closed', 'completed'].includes(String(party?.status ?? '').toLowerCase())).length,
    completedCarries: completed,
    memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    uptimeSeconds: Math.floor(process.uptime())
  };
  await mutateNexusState(guild.id, (nexus) => {
    nexus.intelligence.lastSnapshot = snapshot;
    nexus.intelligence.snapshots.push(snapshot);
    if (nexus.intelligence.snapshots.length > 96) nexus.intelligence.snapshots.splice(0, nexus.intelligence.snapshots.length - 96);
  });
  return snapshot;
}

export async function buildSentinelSnapshot(guild) {
  await guild.roles.fetch().catch(() => null);
  const roles = [...guild.roles.cache.values()];
  const adminRoles = roles.filter((role) => role.permissions.has(PermissionFlagsBits.Administrator) && role.id !== guild.id);
  const manageGuildRoles = roles.filter((role) => role.permissions.has(PermissionFlagsBits.ManageGuild) && role.id !== guild.id);
  const dangerousRoleCount = new Set([...adminRoles, ...manageGuildRoles].map((role) => role.id)).size;
  let botAdmins = 0;
  for (const member of guild.members.cache.values()) {
    if (member.user?.bot && member.permissions.has(PermissionFlagsBits.Administrator)) botAdmins++;
  }
  const risk = dangerousRoleCount >= 8 || botAdmins >= 5 ? 'high' : dangerousRoleCount >= 4 || botAdmins >= 3 ? 'elevated' : 'normal';
  const snapshot = {
    at: new Date().toISOString(),
    risk,
    administratorRoles: adminRoles.length,
    manageGuildRoles: manageGuildRoles.length,
    privilegedBotsCached: botAdmins,
    roleCount: roles.length,
    channelCount: guild.channels.cache.size
  };
  await mutateNexusState(guild.id, (nexus) => { nexus.sentinel.lastSnapshot = snapshot; });
  return snapshot;
}

export async function createVaultBackup(guildId, { automatic = false } = {}) {
  const state = await readGuildState(guildId);
  const folder = path.join(VAULT_ROOT, guildId);
  await fs.mkdir(folder, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(folder, `${stamp}.json`);
  const bytes = Buffer.from(JSON.stringify(state, null, 2), 'utf8');
  await fs.writeFile(file, bytes);

  const entries = (await fs.readdir(folder)).filter((name) => name.endsWith('.json')).sort();
  const excess = Math.max(0, entries.length - 20);
  for (const old of entries.slice(0, excess)) await fs.unlink(path.join(folder, old)).catch(() => null);

  const relativePath = path.relative(process.cwd(), file);
  const record = {
    at: new Date().toISOString(),
    file: relativePath,
    bytes: bytes.length,
    sha256: sha256(bytes),
    automatic: Boolean(automatic)
  };
  await mutateNexusState(guildId, (nexus) => {
    nexus.vault.backups.push(record);
    if (nexus.vault.backups.length > 20) nexus.vault.backups.splice(0, nexus.vault.backups.length - 20);
  });
  return record;
}

export async function verifyVaultBackups(guildId) {
  const state = await readGuildState(guildId);
  const records = state.nexus?.vault?.backups ?? [];
  const results = [];
  for (const record of records.slice(-20)) {
    const full = path.resolve(record.file ?? '');
    if (!full.startsWith(path.resolve(VAULT_ROOT))) {
      results.push({ ...record, exists: false, verified: false, reason: 'path-outside-vault' });
      continue;
    }
    try {
      const bytes = await fs.readFile(full);
      const digest = sha256(bytes);
      results.push({ ...record, exists: true, verified: record.sha256 ? digest === record.sha256 : true, actualSha256: digest, bytes: bytes.length });
    } catch (error) {
      results.push({ ...record, exists: false, verified: false, reason: error.code ?? 'read-failed' });
    }
  }
  return results;
}

export async function callLocalKingdomAi(prompt, context = {}) {
  const baseUrl = String(process.env.KINGDOM_AI_LOCAL_URL ?? '').trim().replace(/\/$/, '');
  if (!baseUrl) throw new Error('Kingdom AI is disabled: KINGDOM_AI_LOCAL_URL is not configured.');
  const model = String(process.env.KINGDOM_AI_LOCAL_MODEL ?? 'sentient-local');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          { role: 'system', content: 'You are Kingdom AI. Answer only from the supplied Kingdom context when context is relevant. Never claim to have performed actions you did not perform.' },
          { role: 'user', content: `${String(prompt).slice(0, 6000)}\n\nContext:\n${JSON.stringify(context).slice(0, 12000)}` }
        ]
      }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Local AI returned HTTP ${response.status}`);
    const data = await response.json();
    return String(data?.message?.content ?? data?.response ?? '').trim();
  } finally {
    clearTimeout(timer);
  }
}

export async function runNexusMaintenance(guild) {
  const current = Date.now();
  const previous = lastMaintenance.get(guild.id) ?? 0;
  if (current - previous < MAINTENANCE_INTERVAL_MS) return { skipped: true, reason: 'throttled' };
  lastMaintenance.set(guild.id, current);

  const intelligence = await buildIntelligenceSnapshot(guild);
  await new Promise((resolve) => setImmediate(resolve));
  const sentinel = await buildSentinelSnapshot(guild);
  const systems = await refreshSystemReadiness(guild);

  let backup = null;
  const previousBackup = lastAutoBackup.get(guild.id) ?? 0;
  if (current - previousBackup >= AUTO_BACKUP_INTERVAL_MS) {
    backup = await createVaultBackup(guild.id, { automatic: true });
    lastAutoBackup.set(guild.id, current);
  }

  return { skipped: false, intelligence, sentinel, systems, backup };
}
