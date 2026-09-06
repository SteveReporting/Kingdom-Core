import {
  AuditLogEvent,
  ChannelType,
  PermissionFlagsBits
} from 'discord.js';
import { mutateGuildState, readGuildState, writeGuildState } from '../storage/store.js';

const DANGEROUS_ACTIONS = new Map([
  [AuditLogEvent.BotAdd, 90],
  [AuditLogEvent.WebhookCreate, 45],
  [AuditLogEvent.WebhookDelete, 20],
  [AuditLogEvent.ChannelDelete, 55],
  [AuditLogEvent.RoleDelete, 60],
  [AuditLogEvent.RoleUpdate, 25],
  [AuditLogEvent.ChannelUpdate, 20],
  [AuditLogEvent.MemberBanAdd, 8],
  [AuditLogEvent.MemberKick, 5]
]);

function securityState(score, locked = false) {
  if (locked) return 'LOCKDOWN';
  if (score >= 80) return 'HIGH';
  if (score >= 50) return 'ELEVATED';
  if (score >= 20) return 'WATCH';
  return 'NORMAL';
}

function serializeOverwrites(channel) {
  return [...channel.permissionOverwrites.cache.values()].map((ow) => ({
    id: ow.id,
    type: ow.type,
    allow: ow.allow.bitfield.toString(),
    deny: ow.deny.bitfield.toString()
  }));
}

export async function captureDigitalTwin(guild, state = null) {
  await guild.roles.fetch();
  await guild.channels.fetch();
  const roles = [...guild.roles.cache.values()]
    .filter((r) => r.id !== guild.id)
    .map((r) => ({
      id: r.id,
      name: r.name,
      position: r.position,
      permissions: r.permissions.bitfield.toString(),
      color: r.color,
      hoist: r.hoist,
      mentionable: r.mentionable,
      managed: r.managed
    }))
    .sort((a, b) => b.position - a.position);
  const channels = [...guild.channels.cache.values()].map((c) => ({
    id: c.id,
    name: c.name,
    type: c.type,
    parentId: c.parentId ?? null,
    position: c.rawPosition ?? c.position ?? 0,
    overwrites: serializeOverwrites(c)
  }));
  return {
    id: `SNAP-${Date.now().toString(36).toUpperCase()}`,
    createdAt: new Date().toISOString(),
    guildId: guild.id,
    schemaVersion: state?.platform?.schemaVersion ?? 4,
    roles,
    channels
  };
}

export async function scanWebhookRegistry(guild) {
  const registry = {};
  for (const channel of guild.channels.cache.values()) {
    if (!channel?.isTextBased?.() || typeof channel.fetchWebhooks !== 'function') continue;
    const hooks = await channel.fetchWebhooks().catch(() => null);
    if (!hooks) continue;
    for (const hook of hooks.values()) {
      registry[hook.id] = {
        id: hook.id,
        name: hook.name,
        channelId: channel.id,
        ownerId: hook.owner?.id ?? null,
        applicationId: hook.applicationId ?? null,
        registeredAt: new Date().toISOString()
      };
    }
  }
  return registry;
}

function latestSnapshot(state) {
  return state.securityV4?.snapshots?.at(-1) ?? null;
}

export async function auditDigitalTwin(guild, state = null) {
  const currentState = state ?? await readGuildState(guild.id);
  const snapshot = latestSnapshot(currentState);
  if (!snapshot) return [{ type: 'snapshot', severity: 'medium', message: 'No digital-twin snapshot exists yet.' }];
  await guild.roles.fetch();
  await guild.channels.fetch();
  const findings = [];

  for (const expected of snapshot.roles) {
    if (expected.managed) continue;
    const role = guild.roles.cache.get(expected.id);
    if (!role) {
      findings.push({ type: 'role_missing', severity: 'high', id: expected.id, name: expected.name, message: `Role missing: ${expected.name}` });
      continue;
    }
    if (role.permissions.bitfield.toString() !== expected.permissions) {
      findings.push({ type: 'role_permissions', severity: 'high', id: role.id, name: role.name, message: `Permissions changed: ${role.name}` });
    }
    if (Math.abs(role.position - expected.position) > 0) {
      findings.push({ type: 'role_position', severity: 'medium', id: role.id, name: role.name, expectedPosition: expected.position, message: `Position changed: ${role.name}` });
    }
  }

  for (const expected of snapshot.channels) {
    const channel = guild.channels.cache.get(expected.id);
    if (!channel) {
      findings.push({ type: 'channel_missing', severity: 'high', id: expected.id, name: expected.name, message: `Channel missing: ${expected.name}` });
      continue;
    }
    if (channel.name !== expected.name || channel.parentId !== expected.parentId) {
      findings.push({ type: 'channel_structure', severity: 'medium', id: channel.id, name: channel.name, message: `Channel structure changed: ${expected.name}` });
    }
    const current = JSON.stringify(serializeOverwrites(channel).sort((a, b) => a.id.localeCompare(b.id)));
    const wanted = JSON.stringify([...expected.overwrites].sort((a, b) => a.id.localeCompare(b.id)));
    if (current !== wanted) {
      findings.push({ type: 'channel_permissions', severity: 'high', id: channel.id, name: channel.name, message: `Permission drift: ${expected.name}` });
    }
  }
  return findings;
}

export async function repairDigitalTwin(guild) {
  const state = await readGuildState(guild.id);
  const snapshot = latestSnapshot(state);
  if (!snapshot) return { repaired: 0, skipped: 0, findings: ['No snapshot available.'] };
  await guild.roles.fetch();
  await guild.channels.fetch();
  const me = await guild.members.fetchMe();
  let repaired = 0;
  let skipped = 0;

  for (const expected of snapshot.roles) {
    if (expected.managed) continue;
    const role = guild.roles.cache.get(expected.id);
    if (!role || !role.editable || role.position >= me.roles.highest.position) {
      if (!role) skipped++;
      continue;
    }
    if (role.permissions.bitfield.toString() !== expected.permissions) {
      await role.setPermissions(BigInt(expected.permissions), 'Kingdom Core v4 digital-twin repair').then(() => repaired++).catch(() => skipped++);
    }
  }

  for (const expected of snapshot.channels) {
    const channel = guild.channels.cache.get(expected.id);
    if (!channel) { skipped++; continue; }
    const overwrites = expected.overwrites.map((ow) => ({
      id: ow.id,
      type: ow.type,
      allow: BigInt(ow.allow),
      deny: BigInt(ow.deny)
    }));
    await channel.permissionOverwrites.set(overwrites, 'Kingdom Core v4 digital-twin repair').then(() => repaired++).catch(() => skipped++);
    if (channel.name !== expected.name) await channel.setName(expected.name, 'Kingdom Core v4 digital-twin repair').then(() => repaired++).catch(() => skipped++);
    if (expected.parentId && channel.parentId !== expected.parentId && guild.channels.cache.has(expected.parentId)) {
      await channel.setParent(expected.parentId, { lockPermissions: false }).then(() => repaired++).catch(() => skipped++);
    }
  }
  return { repaired, skipped };
}

export async function applyEmergencyLockdown(guild, reason = 'Kingdom Core v4 emergency lockdown') {
  const state = await readGuildState(guild.id);
  if (!state.securityV4 || state.securityV4.lockdown?.active) return { changed: 0, already: true };
  state.securityV4.lockdown ??= { active: false, previous: {} };
  state.securityV4.lockdown.previous = {};
  let changed = 0;

  for (const channel of guild.channels.cache.values()) {
    if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement && channel.type !== ChannelType.GuildForum) continue;
    const ow = channel.permissionOverwrites.cache.get(guild.roles.everyone.id);
    const before = ow?.allow?.has(PermissionFlagsBits.SendMessages) ? 'allow'
      : ow?.deny?.has(PermissionFlagsBits.SendMessages) ? 'deny' : 'inherit';
    state.securityV4.lockdown.previous[channel.id] = before;
    await channel.permissionOverwrites.edit(guild.roles.everyone.id, { SendMessages: false }, { reason }).then(() => changed++).catch(() => null);
  }
  state.securityV4.lockdown.active = true;
  state.securityV4.lockdown.startedAt = new Date().toISOString();
  state.securityV4.lockdown.reason = reason;
  state.securityV4.state = 'LOCKDOWN';
  await writeGuildState(guild.id, state);
  return { changed, already: false };
}

export async function endEmergencyLockdown(guild) {
  const state = await readGuildState(guild.id);
  if (!state.securityV4?.lockdown?.active) return { changed: 0, already: true };
  let changed = 0;
  for (const [channelId, before] of Object.entries(state.securityV4.lockdown.previous ?? {})) {
    const channel = guild.channels.cache.get(channelId);
    if (!channel) continue;
    const value = before === 'allow' ? true : before === 'deny' ? false : null;
    await channel.permissionOverwrites.edit(guild.roles.everyone.id, { SendMessages: value }, { reason: 'Kingdom Core v4 lockdown ended' }).then(() => changed++).catch(() => null);
  }
  state.securityV4.lockdown.active = false;
  state.securityV4.lockdown.endedAt = new Date().toISOString();
  state.securityV4.state = securityState(state.securityV4.riskScore ?? 0, false);
  await writeGuildState(guild.id, state);
  return { changed, already: false };
}

export async function handleV4AuditEvent(entry, guild, botUserId) {
  const initial = await readGuildState(guild.id);
  if (!initial.platform?.featureFlags?.securityRisk) return;
  const base = DANGEROUS_ACTIONS.get(entry.action) ?? 0;
  if (!base) return;
  const executorId = entry.executorId ?? entry.executor?.id ?? null;
  if (executorId === botUserId) return;

  let shouldLock = false;
  await mutateGuildState(guild.id, async (state) => {
    state.securityV4 ??= { riskScore: 0, incidents: [], lockdown: { active: false, previous: {} }, autoLockdownThreshold: 90 };
    let weight = base;
    if (entry.action === AuditLogEvent.BotAdd) {
      const targetId = entry.targetId ?? entry.target?.id;
      if (targetId && state.securityV4.approvedBots?.includes(targetId)) weight = 0;
    }
    state.securityV4.riskScore = Math.min(100, Math.max(0, (state.securityV4.riskScore ?? 0) + weight));
    state.securityV4.state = securityState(state.securityV4.riskScore, state.securityV4.lockdown?.active);
    state.securityV4.incidents ??= [];
    state.securityV4.incidents.push({
      id: `INC-${Date.now().toString(36).toUpperCase()}`,
      at: new Date().toISOString(),
      action: entry.action,
      executorId,
      targetId: entry.targetId ?? entry.target?.id ?? null,
      riskAdded: weight,
      riskAfter: state.securityV4.riskScore
    });
    if (state.securityV4.incidents.length > 250) state.securityV4.incidents = state.securityV4.incidents.slice(-250);
    state.analyticsV4 ??= { events: [] };
    state.analyticsV4.events ??= [];
    state.analyticsV4.events.push({ type: 'security.audit', at: new Date().toISOString(), action: entry.action, executorId, riskAdded: weight });
    if (state.analyticsV4.events.length > 5000) state.analyticsV4.events = state.analyticsV4.events.slice(-5000);
    shouldLock = Boolean(state.platform?.featureFlags?.autoLockdown)
      && !state.securityV4.lockdown?.active
      && state.securityV4.riskScore >= (state.securityV4.autoLockdownThreshold ?? 90);
  });

  if (shouldLock) await applyEmergencyLockdown(guild, 'Kingdom Core v4 automatic risk threshold').catch(() => null);
}

export async function decaySecurityRisk(guild) {
  await mutateGuildState(guild.id, async (state) => {
    if (!state.securityV4) return;
    if (!state.securityV4.lockdown?.active) {
      state.securityV4.riskScore = Math.max(0, (state.securityV4.riskScore ?? 0) - 5);
      state.securityV4.state = securityState(state.securityV4.riskScore, false);
    }
  });
}
