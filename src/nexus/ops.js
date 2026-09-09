import fs from 'node:fs/promises';
import path from 'node:path';
import { PermissionFlagsBits } from 'discord.js';
import { readGuildState } from '../storage/store.js';
import { mutateNexusState } from './state.js';

const VAULT_ROOT = path.resolve('data', 'vault');

function count(value) {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return Object.keys(value).length;
  return 0;
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
    completedCarries: completed
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

export async function createVaultBackup(guildId) {
  const state = await readGuildState(guildId);
  const folder = path.join(VAULT_ROOT, guildId);
  await fs.mkdir(folder, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(folder, `${stamp}.json`);
  await fs.writeFile(file, JSON.stringify(state, null, 2), 'utf8');

  const entries = (await fs.readdir(folder)).filter((name) => name.endsWith('.json')).sort();
  const excess = Math.max(0, entries.length - 20);
  for (const old of entries.slice(0, excess)) await fs.unlink(path.join(folder, old)).catch(() => null);

  const relativePath = path.relative(process.cwd(), file);
  const record = { at: new Date().toISOString(), file: relativePath };
  await mutateNexusState(guildId, (nexus) => {
    nexus.vault.backups.push(record);
    if (nexus.vault.backups.length > 20) nexus.vault.backups.splice(0, nexus.vault.backups.length - 20);
  });
  return record;
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
          { role: 'system', content: 'You are Kingdom AI. Answer only from the supplied Kingdom context when context is relevant.' },
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
