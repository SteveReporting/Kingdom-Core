import { LEVEL_TIERS } from './levelRoles.js';
import { auditDigitalTwin } from './securityV4.js';
import { mutateGuildState, readGuildState } from '../storage/store.js';

const HOUSE_ROLE_MAP = {
  houseDrakon: 'drakon',
  houseLeonis: 'leonis',
  houseAether: 'aether',
  houseFenrir: 'fenrir'
};

function pushLedger(state, action, actorId, targetId, details = {}, at = null) {
  state.platform ??= {};
  state.platform.auditLedger ??= [];
  state.platform.auditLedger.push({
    id: `AUD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 5)}`,
    at: at ?? new Date().toISOString(),
    action,
    actorId: actorId ?? null,
    targetId: targetId ?? null,
    details
  });
  if (state.platform.auditLedger.length > 3000) state.platform.auditLedger = state.platform.auditLedger.slice(-3000);
}

function pushEvent(state, type, data = {}, at = null) {
  state.analyticsV4 ??= {};
  state.analyticsV4.events ??= [];
  state.analyticsV4.events.push({ type, at: at ?? new Date().toISOString(), ...data });
  if (state.analyticsV4.events.length > 5000) state.analyticsV4.events = state.analyticsV4.events.slice(-5000);
}

function ensureIdentity(state, userId) {
  state.identities ??= {};
  state.identities[userId] ??= { userId, kingdomXp: 0, prestige: 0, stats: {}, achievements: [], titles: [] };
  state.identities[userId].stats ??= {};
  state.identities[userId].achievements ??= [];
  state.identities[userId].titles ??= [];
  return state.identities[userId];
}

function membersOf(ticket) {
  return [...new Set((ticket.members ?? [ticket.userId]).filter(Boolean))];
}

function syncMemberIdentity(member, state) {
  if (!member || member.user?.bot) return;
  const profile = ensureIdentity(state, member.id);
  let house = null;
  for (const [roleKey, houseKey] of Object.entries(HOUSE_ROLE_MAP)) {
    const roleId = state.setup?.roles?.[roleKey];
    if (roleId && member.roles.cache.has(roleId)) {
      house = houseKey;
      break;
    }
  }
  const tier = LEVEL_TIERS.find((x) => state.setup?.levelRoles?.[x.key] && member.roles.cache.has(state.setup.levelRoles[x.key]));
  profile.house = house;
  profile.levelBand = tier?.key ?? profile.levelBand ?? null;
  profile.currentDungeon = tier?.dungeon ?? profile.currentDungeon ?? null;
  profile.displayName = member.displayName;
  profile.lastSyncedAt = new Date().toISOString();
}

function syncCarryStateEvents(state) {
  state.platform ??= {};
  state.platform.carryStateCache ??= {};
  for (const ticket of Object.values(state.carryTickets ?? {})) {
    if (!ticket?.id) continue;
    const previous = state.platform.carryStateCache[ticket.id];
    if (previous !== ticket.status) {
      pushEvent(state, `carry.${ticket.status}`, {
        carryId: ticket.id,
        previousStatus: previous ?? null,
        carrierId: ticket.carrierId ?? null,
        dungeon: ticket.dungeon ?? null,
        difficulty: ticket.difficulty ?? null,
        mode: ticket.mode ?? null,
        partySize: membersOf(ticket).length
      });
      state.platform.carryStateCache[ticket.id] = ticket.status;
    }

    if (ticket.status === 'completed' && !ticket.v4ActivityEventsAt) {
      const eventAt = ticket.completedAt ?? new Date().toISOString();
      for (const userId of membersOf(ticket)) {
        pushEvent(state, 'member.carry_completed', { userId, carryId: ticket.id, dungeon: ticket.dungeon ?? null }, eventAt);
      }
      if (ticket.carrierId) {
        pushEvent(state, 'carrier.carry_completed', { userId: ticket.carrierId, carryId: ticket.id, playersHelped: membersOf(ticket).length }, eventAt);
      }
      ticket.v4ActivityEventsAt = new Date().toISOString();
    }
  }
}

function computeQuestProgress(state) {
  state.questsV4 ??= { daily: [], weekly: [], community: [], completed: {} };
  state.questsV4.progress ??= {};
  state.questsV4.completed ??= {};
  const tickets = Object.values(state.carryTickets ?? {}).filter((x) => x.status === 'completed' && x.completedAt);
  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = now - 7 * 86400000;

  const dailyByUser = {};
  const weeklyCarrier = {};
  let communityPlayers = 0;
  for (const ticket of tickets) {
    const completedAt = new Date(ticket.completedAt).getTime();
    const members = membersOf(ticket);
    if (ticket.completedAt.slice(0, 10) === today) {
      communityPlayers += members.length;
      for (const userId of members) dailyByUser[userId] = (dailyByUser[userId] ?? 0) + 1;
      if (ticket.carrierId) dailyByUser[ticket.carrierId] = (dailyByUser[ticket.carrierId] ?? 0) + 1;
    }
    if (completedAt >= weekAgo && ticket.carrierId) weeklyCarrier[ticket.carrierId] = (weeklyCarrier[ticket.carrierId] ?? 0) + members.length;
  }

  const userIds = new Set([...Object.keys(state.identities ?? {}), ...Object.keys(dailyByUser), ...Object.keys(weeklyCarrier)]);
  for (const userId of userIds) {
    state.questsV4.progress[userId] ??= {};
    for (const quest of state.questsV4.daily ?? []) {
      const value = quest.name === 'Answer the Call' ? (dailyByUser[userId] ?? 0) : Math.min(quest.target ?? 1, (dailyByUser[userId] ?? 0) > 0 ? 1 : 0);
      state.questsV4.progress[userId][quest.id] = { value, target: quest.target, updatedAt: new Date().toISOString() };
      const completionKey = `${userId}:${quest.id}`;
      if (value >= (quest.target ?? 1) && !state.questsV4.completed[completionKey]) {
        const profile = ensureIdentity(state, userId);
        profile.kingdomXp = (profile.kingdomXp ?? 0) + (quest.rewardXp ?? 0);
        profile.stats.quests = (profile.stats.quests ?? 0) + 1;
        state.questsV4.completed[completionKey] = { userId, questId: quest.id, at: new Date().toISOString(), rewardXp: quest.rewardXp ?? 0 };
        pushLedger(state, 'quest.completed', userId, quest.id, { rewardXp: quest.rewardXp ?? 0 });
      }
    }
    for (const quest of state.questsV4.weekly ?? []) {
      const value = weeklyCarrier[userId] ?? 0;
      state.questsV4.progress[userId][quest.id] = { value, target: quest.target, updatedAt: new Date().toISOString() };
      const completionKey = `${userId}:${quest.id}`;
      if (value >= (quest.target ?? 1) && !state.questsV4.completed[completionKey]) {
        const profile = ensureIdentity(state, userId);
        profile.kingdomXp = (profile.kingdomXp ?? 0) + (quest.rewardXp ?? 0);
        profile.stats.quests = (profile.stats.quests ?? 0) + 1;
        state.questsV4.completed[completionKey] = { userId, questId: quest.id, at: new Date().toISOString(), rewardXp: quest.rewardXp ?? 0 };
        pushLedger(state, 'quest.completed', userId, quest.id, { rewardXp: quest.rewardXp ?? 0 });
      }
    }
  }

  for (const quest of state.questsV4.community ?? []) {
    state.questsV4.communityProgress ??= {};
    state.questsV4.communityProgress[quest.id] = { value: communityPlayers, target: quest.target, updatedAt: new Date().toISOString() };
    const completionKey = `community:${quest.id}`;
    if (communityPlayers >= (quest.target ?? 1) && !state.questsV4.completed[completionKey]) {
      state.kingdom ??= { xp: 0 };
      state.kingdom.xp = (state.kingdom.xp ?? 0) + (quest.rewardXp ?? 0);
      state.questsV4.completed[completionKey] = { questId: quest.id, at: new Date().toISOString(), rewardXp: quest.rewardXp ?? 0 };
      pushLedger(state, 'quest.community_completed', null, quest.id, { rewardXp: quest.rewardXp ?? 0 });
    }
  }
}

function rebuildHouseStandings(state) {
  state.kingdom ??= {};
  state.kingdom.houses ??= {
    drakon: { name: 'House Drakon', xp: 0, wins: 0 },
    leonis: { name: 'House Leonis', xp: 0, wins: 0 },
    aether: { name: 'House Aether', xp: 0, wins: 0 },
    fenrir: { name: 'House Fenrir', xp: 0, wins: 0 }
  };
  const totals = { drakon: 0, leonis: 0, aether: 0, fenrir: 0 };
  const counts = { drakon: 0, leonis: 0, aether: 0, fenrir: 0 };
  for (const profile of Object.values(state.identities ?? {})) {
    if (!profile.house || !(profile.house in totals)) continue;
    totals[profile.house] += Math.max(0, Number(profile.kingdomXp) || 0);
    counts[profile.house]++;
  }
  for (const [key, total] of Object.entries(totals)) {
    state.kingdom.houses[key] ??= { name: `House ${key}`, wins: 0 };
    state.kingdom.houses[key].xp = total;
    state.kingdom.houses[key].members = counts[key];
    const thresholds = [0, 1000, 5000, 15000, 50000, 150000];
    state.kingdom.houses[key].level = thresholds.filter((x) => total >= x).length;
  }
}

async function safeCriticalAutoRepair(guild, state) {
  if (!state.platform?.featureFlags?.automaticRepair || state.securityV4?.lockdown?.active) return { repaired: 0 };
  const snapshot = state.securityV4?.snapshots?.at(-1);
  if (!snapshot) return { repaired: 0 };
  const findings = await auditDigitalTwin(guild, state).catch(() => []);
  const critical = findings.filter((x) => ['role_permissions', 'channel_permissions'].includes(x.type) && x.severity === 'high');
  if (!critical.length) return { repaired: 0 };
  let repaired = 0;
  const me = await guild.members.fetchMe().catch(() => null);
  for (const finding of critical.slice(0, 25)) {
    if (finding.type === 'role_permissions') {
      const expected = snapshot.roles?.find((x) => x.id === finding.id);
      const role = guild.roles.cache.get(finding.id);
      if (!expected || !role?.editable || !me || role.position >= me.roles.highest.position) continue;
      await role.setPermissions(BigInt(expected.permissions), 'Kingdom Core automatic critical permission repair').then(() => repaired++).catch(() => null);
    } else if (finding.type === 'channel_permissions') {
      const expected = snapshot.channels?.find((x) => x.id === finding.id);
      const channel = guild.channels.cache.get(finding.id);
      if (!expected || !channel) continue;
      const overwrites = expected.overwrites.map((ow) => ({ id: ow.id, type: ow.type, allow: BigInt(ow.allow), deny: BigInt(ow.deny) }));
      await channel.permissionOverwrites.set(overwrites, 'Kingdom Core automatic critical permission repair').then(() => repaired++).catch(() => null);
    }
  }
  return { repaired, findings: critical.length };
}

export async function recordAuditLedgerEventV4(entry, guild, botUserId) {
  if (!entry || entry.executorId === botUserId) return false;
  await mutateGuildState(guild.id, async (state) => {
    if (!state.platform?.schemaVersion) return;
    pushLedger(state, 'discord.audit', entry.executorId ?? entry.executor?.id ?? null, entry.targetId ?? entry.target?.id ?? null, {
      action: entry.action,
      reason: entry.reason ?? null,
      changes: Array.isArray(entry.changes) ? entry.changes.slice(0, 12).map((x) => x.key) : []
    });
  });
  return true;
}

export async function runPlatformAutomationV4(guild) {
  const initial = await readGuildState(guild.id);
  if (!initial.platform?.schemaVersion) return false;

  await mutateGuildState(guild.id, async (state) => {
    for (const member of guild.members.cache.values()) syncMemberIdentity(member, state);
    syncCarryStateEvents(state);
    computeQuestProgress(state);
    rebuildHouseStandings(state);
  });

  const state = await readGuildState(guild.id);
  const listings = Object.values(state.marketV4?.listings ?? {}).filter((x) => x.status === 'active');
  const watchlists = state.marketV4?.watchlists ?? {};
  const notified = state.marketV4?.notified ?? {};
  const deliveries = [];

  for (const [userId, queries] of Object.entries(watchlists)) {
    for (const listing of listings) {
      if (listing.sellerId === userId) continue;
      if (notified[userId]?.[listing.id]) continue;
      const haystack = `${listing.item ?? ''} ${listing.price ?? ''} ${listing.notes ?? ''}`.toLowerCase();
      const matched = (queries ?? []).find((q) => haystack.includes(String(q).toLowerCase()));
      if (!matched) continue;
      deliveries.push({ userId, listing, matched });
      if (deliveries.length >= 100) break;
    }
    if (deliveries.length >= 100) break;
  }

  const delivered = [];
  for (const item of deliveries) {
    const member = await guild.members.fetch(item.userId).catch(() => null);
    if (!member) continue;
    const sent = await member.send({
      content: [
        '🔔 **Kingdom Marketplace Watch**',
        `A listing matched **${item.matched}**.`,
        '',
        `**${item.listing.item}** — ${item.listing.price}`,
        item.listing.notes ? `> ${item.listing.notes}` : '',
        `Seller: <@${item.listing.sellerId}>`
      ].filter(Boolean).join('\n'),
      allowedMentions: { parse: [] }
    }).then(() => true).catch(() => false);
    if (sent) delivered.push(item);
  }

  if (delivered.length) {
    await mutateGuildState(guild.id, async (fresh) => {
      fresh.marketV4 ??= {};
      fresh.marketV4.notified ??= {};
      for (const item of delivered) {
        fresh.marketV4.notified[item.userId] ??= {};
        fresh.marketV4.notified[item.userId][item.listing.id] = new Date().toISOString();
        pushLedger(fresh, 'market.watch_notified', null, item.userId, { listingId: item.listing.id, matched: item.matched });
      }
    });
  }

  const repairState = await readGuildState(guild.id);
  const repair = await safeCriticalAutoRepair(guild, repairState).catch(() => ({ repaired: 0 }));
  if (repair.repaired) {
    await mutateGuildState(guild.id, async (fresh) => {
      pushLedger(fresh, 'security.auto_repair', null, guild.id, repair);
      fresh.securityV4.lastAutoRepairAt = new Date().toISOString();
    });
  }
  return { delivered: delivered.length, autoRepaired: repair.repaired ?? 0 };
}
