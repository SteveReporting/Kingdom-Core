import { ChannelType } from 'discord.js';
import { readGuildState, writeGuildState } from '../storage/store.js';

const GROUPS = [
  {
    key: 'start',
    name: '━━ 👑 START HERE ━━',
    preferredKey: 'arrival',
    keys: ['arrival', 'verification', 'serverStats'],
    legacyNames: ['━━ 👑 ARRIVAL ━━', '✅・VERIFICATION', '📊 SERVER STATS 📊']
  },
  {
    key: 'community',
    name: '━━ 🏰 COMMUNITY ━━',
    preferredKey: 'kingdom',
    keys: ['kingdom', 'community', 'progression', 'houses', 'kingdomProgressV4'],
    legacyNames: [
      '━━ 🏰 THE KINGDOM ━━',
      '━━ 🎪 COMMUNITY ━━',
      '━━ 📜 PROGRESSION ━━',
      '━━ 🏰 HOUSES ━━',
      '━━ 🏰 KINGDOM PROGRESSION ━━'
    ]
  },
  {
    key: 'carries',
    name: '━━ ⚔️ CARRIES ━━',
    preferredKey: 'carries',
    keys: ['carries', 'carryTickets'],
    legacyNames: ['━━ ⚔️ CARRIES ━━', '━━ ⚔️ LIVE CARRY TICKETS ━━']
  },
  {
    key: 'economy',
    name: '━━ 💰 MARKET & TREASURY ━━',
    preferredKey: 'market',
    keys: ['market', 'royalEconomyV4'],
    legacyNames: ['━━ 💰 MARKET DISTRICT ━━', '━━ 🏦 ROYAL ECONOMY ━━']
  },
  {
    key: 'support',
    name: '━━ 🕯️ SUPPORT & APPLICATIONS ━━',
    preferredKey: 'support',
    keys: ['support', 'applications', 'tickets'],
    legacyNames: ['━━ 🕯️ SUPPORT ━━', '━━ 📝 APPLICATIONS ━━', '━━ 🎫 OPEN TICKETS ━━']
  },
  {
    key: 'carrier',
    name: '━━ 🛡️ KNIGHTS ━━',
    preferredKey: 'carrier',
    keys: ['carrier', 'knightAcademyV4'],
    legacyNames: ["━━ 🛡️ KNIGHTS' QUARTERS ━━", '━━ ⚔️ KNIGHT ACADEMY ━━']
  },
  {
    key: 'staff',
    name: '━━ 👑 STAFF HQ ━━',
    preferredKey: 'staff',
    keys: ['staff', 'security', 'kingdomCommandV4', 'platformSystemV4'],
    legacyNames: [
      '━━ 👑 ROYAL COUNCIL ━━',
      '━━ 🔐 KINGDOM SECURITY ━━',
      '━━ 👑 KINGDOM COMMAND ━━',
      '━━ ⚙️ KINGDOM CORE SYSTEM ━━'
    ]
  }
];

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function managedChannelIds(state) {
  return new Set([
    ...Object.values(state.setup?.channels ?? {}),
    ...Object.values(state.setup?.statsChannels ?? {})
  ].filter(Boolean));
}

async function ensureCompactCategory(guild, state, group) {
  state.setup ??= {};
  state.setup.categories ??= {};

  const preferred = guild.channels.cache.get(state.setup.categories[group.preferredKey]);
  const byName = guild.channels.cache.find(
    (channel) => channel.type === ChannelType.GuildCategory && channel.name === group.name
  );

  const knownIds = unique(group.keys.map((key) => state.setup.categories[key]));
  const matchingNames = guild.channels.cache
    .filter((channel) =>
      channel.type === ChannelType.GuildCategory &&
      (channel.name === group.name || group.legacyNames.includes(channel.name))
    )
    .map((channel) => channel.id);

  const candidates = unique([...knownIds, ...matchingNames])
    .map((id) => guild.channels.cache.get(id))
    .filter((channel) => channel?.type === ChannelType.GuildCategory);

  // On later /setup runs, preserve the already-consolidated category instead of
  // replacing its ID with a temporary legacy category recreated during repair.
  let target = byName ?? (preferred?.type === ChannelType.GuildCategory ? preferred : candidates[0] ?? null);
  let created = false;

  if (!target) {
    target = await guild.channels.create({
      name: group.name,
      type: ChannelType.GuildCategory,
      reason: 'Kingdom Core /setup compact server structure'
    });
    created = true;
  } else if (target.name !== group.name) {
    await target.setName(group.name, 'Kingdom Core /setup category consolidation').catch(() => null);
  }

  const sourceIds = new Set(unique([...candidates.map((category) => category.id), target.id]));
  let moved = 0;
  for (const channel of guild.channels.cache.values()) {
    if (channel.type === ChannelType.GuildCategory || !sourceIds.has(channel.parentId) || channel.parentId === target.id) continue;
    const result = await channel.setParent(target.id, { lockPermissions: false }).catch(() => null);
    if (result) moved++;
  }

  for (const key of group.keys) state.setup.categories[key] = target.id;

  let removed = 0;
  for (const category of candidates) {
    if (category.id === target.id) continue;
    const children = guild.channels.cache.filter((channel) => channel.parentId === category.id);
    if (children.size) continue;
    const deleted = await category.delete('Kingdom Core /setup removed obsolete duplicate category').catch(() => null);
    if (deleted) removed++;
  }

  return { target, created, moved, removed };
}

async function removeSafeDuplicateChannels(guild, state) {
  const managed = managedChannelIds(state);
  const groups = new Map();

  for (const channel of guild.channels.cache.values()) {
    if (channel.type === ChannelType.GuildCategory || channel.isThread?.()) continue;
    const key = `${channel.type}:${channel.name}`;
    const list = groups.get(key) ?? [];
    list.push(channel);
    groups.set(key, list);
  }

  let removed = 0;
  let skipped = 0;

  for (const channels of groups.values()) {
    if (channels.length < 2 || !channels.some((channel) => managed.has(channel.id))) continue;

    const keep = channels.find((channel) => managed.has(channel.id)) ?? channels[0];
    for (const channel of channels) {
      if (channel.id === keep.id || managed.has(channel.id)) continue;

      const hasMessages = 'lastMessageId' in channel && Boolean(channel.lastMessageId);
      const hasVoiceUsers = 'members' in channel && Boolean(channel.members?.size);
      if (hasMessages || hasVoiceUsers) {
        skipped++;
        continue;
      }

      const deleted = await channel.delete('Kingdom Core /setup safe duplicate channel cleanup').catch(() => null);
      if (deleted) removed++;
      else skipped++;
    }
  }

  return { removed, skipped };
}

export async function seedCompactCategoryAliases(guild) {
  await guild.channels.fetch();
  const state = await readGuildState(guild.id);
  state.setup ??= {};
  state.setup.categories ??= {};

  const aliasTargets = {
    tickets: 'support',
    carryTickets: 'carries',
    serverStats: 'arrival',
    verification: 'arrival',
    kingdomCommandV4: 'staff',
    knightAcademyV4: 'carrier',
    kingdomProgressV4: 'community',
    royalEconomyV4: 'market',
    platformSystemV4: 'staff'
  };

  for (const [alias, source] of Object.entries(aliasTargets)) {
    const sourceId = state.setup.categories[source];
    if (sourceId && guild.channels.cache.get(sourceId)?.type === ChannelType.GuildCategory) {
      state.setup.categories[alias] = sourceId;
    }
  }

  await writeGuildState(guild.id, state);
  return state;
}

export async function compactGuildStructure(guild, onProgress = async () => {}) {
  await guild.channels.fetch();
  const state = await readGuildState(guild.id);
  state.setup ??= {};
  state.setup.categories ??= {};

  const summary = {
    categoriesCreated: 0,
    categoriesRemoved: 0,
    channelsMoved: 0,
    duplicateChannelsRemoved: 0,
    populatedDuplicatesSkipped: 0
  };

  for (const group of GROUPS) {
    await onProgress(`Consolidating ${group.name.replace(/━/g, '').trim()}…`);
    const result = await ensureCompactCategory(guild, state, group);
    summary.categoriesCreated += Number(result.created);
    summary.categoriesRemoved += result.removed;
    summary.channelsMoved += result.moved;
  }

  const duplicateResult = await removeSafeDuplicateChannels(guild, state);
  summary.duplicateChannelsRemoved = duplicateResult.removed;
  summary.populatedDuplicatesSkipped = duplicateResult.skipped;

  state.setup.compactStructureVersion = 1;
  state.setup.compactedAt = new Date().toISOString();
  await writeGuildState(guild.id, state);

  return { summary, state };
}
