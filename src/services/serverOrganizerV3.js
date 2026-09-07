import { ChannelType } from 'discord.js';
import { readGuildState, writeGuildState } from '../storage/store.js';

export const SETUP3_GROUPS = Object.freeze([
  {
    key: 'start',
    name: '━━ 👑 START HERE ━━',
    aliases: ['start here', 'arrival', 'server stats', 'member stats']
  },
  {
    key: 'verification',
    name: '━━ ✅ VERIFICATION ━━',
    aliases: ['verification', 'verify', 'onboarding']
  },
  {
    key: 'important',
    name: '━━ 📌 IMPORTANT ━━',
    aliases: ['important', 'information', 'server information']
  },
  {
    key: 'community',
    name: '━━ 🏰 COMMUNITY ━━',
    aliases: ['community', 'the kingdom', 'kingdom community']
  },
  {
    key: 'applications',
    name: '━━ 📝 APPLICATIONS ━━',
    aliases: ['applications', 'recruitment']
  },
  {
    key: 'staff',
    name: '━━ 👑 STAFF HQ ━━',
    aliases: ['staff hq', 'royal council', 'staff', 'council']
  },
  {
    key: 'security',
    name: '━━ 🛡️ KINGDOM SECURITY ━━',
    aliases: ['kingdom security', 'security and logs', 'security logs', 'security']
  },
  {
    key: 'support',
    name: '━━ 🕯️ SUPPORT ━━',
    aliases: ['support', 'help centre', 'help center', 'petitions']
  },
  {
    key: 'houses',
    name: '━━ 🏰 HOUSES ━━',
    aliases: ['houses', 'house district']
  },
  {
    key: 'events',
    name: '━━ 🏆 EVENTS & PROGRESSION ━━',
    aliases: ['events and progression', 'events', 'progression', 'quests']
  },
  {
    key: 'social',
    name: '━━ 🔊 VOICE & SOCIAL ━━',
    aliases: ['voice and social', 'voice', 'social voice']
  },
  {
    key: 'systems',
    name: '━━ ⚙️ CORE SYSTEMS ━━',
    aliases: ['core systems', 'kingdom core system', 'platform system', 'systems']
  },
  {
    key: 'archives',
    name: '━━ 📚 ARCHIVES & RECORDS ━━',
    aliases: ['archives and records', 'archives', 'records', 'history']
  }
]);

export const SETUP3_PROTECTED_ZONES = Object.freeze([
  {
    key: 'carries',
    label: 'Carries',
    hints: ['carries', 'carry', 'live carry tickets', 'carry operations']
  },
  {
    key: 'economy',
    label: 'Market & Treasury',
    hints: ['market and treasury', 'market treasury', 'market district', 'royal economy', 'market', 'treasury']
  },
  {
    key: 'knights',
    label: 'Knights',
    hints: ['knights', 'knight academy', 'knights quarters', 'carrier', 'carriers']
  }
]);

const CATEGORY_CAPACITY = 50;

const EXACT_CHANNEL_MAP = new Map(Object.entries({
  // Verification — exactly as requested.
  welcome: 'verification',
  guide: 'verification',
  'bloxlink-verification': 'verification',
  bloxlink: 'verification',
  verification: 'verification',
  verify: 'verification',

  // Important server information.
  rules: 'important',
  rulebook: 'important',
  announcement: 'important',
  announcements: 'important',
  'choose-house': 'important',
  'choose-your-house': 'important',
  'notification-roles': 'important',
  'notification-role': 'important',
  'notifiable-roles': 'important',
  'server-guide': 'important',
  'level-roles': 'important',
  'level-role': 'important',

  // Community — intentionally kept small.
  'kingdom-chat': 'community',
  'dungeon-quest': 'community',
  'loot-showcase': 'community',
  media: 'community',

  // Applications.
  'application-hub': 'applications',
  applications: 'applications',
  'application-status': 'applications',
  'staff-apps': 'applications',
  'staff-applications': 'applications',
  'carrier-apps': 'applications',
  'carrier-applications': 'applications',
  'creator-apps': 'applications',
  'creator-applications': 'applications',

  // Common support surfaces.
  support: 'support',
  'support-hub': 'support',
  'support-panel': 'support',
  'open-ticket': 'support',
  'open-tickets': 'support',
  appeals: 'support',
  reports: 'support',
  disputes: 'support',
  petitions: 'support'
}));

const OLD_ORGANIZER_NAMES = new Set([
  'start here',
  'news and updates',
  'community',
  'media and creations',
  'voice and social',
  'events and progression',
  'houses',
  'support',
  'applications',
  'staff hq',
  'security and logs',
  'core systems',
  'archives and records'
]);

function normalize(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/[━┃│┆┇•・|]/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function words(value = '') {
  return normalize(value).split('-').filter(Boolean);
}

function containsPhrase(value, phrase) {
  const haystack = `-${normalize(value)}-`;
  const needle = `-${normalize(phrase)}-`;
  return haystack.includes(needle);
}

function channelIdentity(state, channel) {
  const keys = [];
  for (const [key, id] of Object.entries(state.setup?.channels ?? {})) if (id === channel.id) keys.push(key);
  for (const [key, id] of Object.entries(state.setup?.statsChannels ?? {})) if (id === channel.id) keys.push(key);
  return normalize(keys.join(' '));
}

function protectedZoneForCategory(category) {
  if (!category || category.type !== ChannelType.GuildCategory) return null;
  const name = normalize(category.name);
  return SETUP3_PROTECTED_ZONES.find((zone) => zone.hints.some((hint) => containsPhrase(name, hint))) ?? null;
}

function isProtectedChannel(channel) {
  return Boolean(protectedZoneForCategory(channel.parent));
}

function isMemberCountChannel(channel, state) {
  const name = normalize(channel.name);
  const identity = channelIdentity(state, channel);
  if (/(^|-)(member|members|member-count|member-counter|humans|human-count|online|online-members|bots|bot-count|citizens|travellers)(-|$)/.test(name)) return true;
  return /(member|online|human|bot).*(count|stats)|server-stats|member-stats/.test(identity);
}

function clearSecurityMatch(channel) {
  const signal = normalize(`${channel.name} ${channel.topic ?? ''}`);
  const tokens = new Set(words(signal));
  const direct = [
    'security','audit','automod','incident','lockdown','risk','evidence','punishment',
    'anti-raid','anti-spam','webhook-log','mod-log','moderation-log','audit-log',
    'security-control','permission-drift','bot-firewall','bot-auth','raid-alert','raid-log'
  ];
  if (direct.some((value) => containsPhrase(signal, value))) return true;
  if (tokens.has('logs') || tokens.has('log')) {
    // Carry/economy/knight logs are already protected by their categories. For all
    // other operational log channels, Kingdom Security is the cleanest home.
    return true;
  }
  return false;
}

function classifyChannel(channel, state) {
  if (isProtectedChannel(channel)) return { protected: protectedZoneForCategory(channel.parent), group: null, reason: 'protected-zone' };

  const name = normalize(channel.name);
  const identity = channelIdentity(state, channel);
  const combined = normalize(`${channel.name} ${channel.topic ?? ''} ${identity}`);

  if (isMemberCountChannel(channel, state)) return { group: 'start', reason: 'member-count' };
  if (EXACT_CHANNEL_MAP.has(name)) return { group: EXACT_CHANNEL_MAP.get(name), reason: 'exact-name' };

  // Explicit exceptions beat broad keyword families.
  if (containsPhrase(name, 'server-guide')) return { group: 'important', reason: 'server-guide' };
  if (containsPhrase(name, 'choose-house') || containsPhrase(name, 'choose-your-house')) return { group: 'important', reason: 'choose-house' };

  if (clearSecurityMatch(channel)) return { group: 'security', reason: 'security-log-control' };

  if (/\b(drakon|leonis|aether|fenrir)\b/.test(combined.replace(/-/g, ' ')) || containsPhrase(combined, 'house-chat') || containsPhrase(combined, 'house-events') || containsPhrase(combined, 'house-quests') || containsPhrase(combined, 'house-leaderboard')) {
    return { group: 'houses', reason: 'house-channel' };
  }

  if (/(application|applications|app-status|app-review|recruitment|interview|candidate)/.test(combined)) return { group: 'applications', reason: 'application-family' };
  if (/(support|ticket|appeal|report|dispute|petition|help-desk|complaint)/.test(combined)) return { group: 'support', reason: 'support-family' };

  if (/(staff-chat|staff-announcement|staff-roster|staff-review|royal-council|council-chat|management|leadership|reviewer-chat|moderator-chat|mod-chat)/.test(combined)) {
    return { group: 'staff', reason: 'staff-family' };
  }

  if (/(event|giveaway|quest|progression|leaderboard|achievement|tournament|season|competition|rsvp)/.test(combined)) return { group: 'events', reason: 'events-progression' };
  if (/(bot-control|platform|control-plane|analytics|diagnostic|health|metrics|database|redis|postgres|websocket|internal-api|workflow|automation|system-status|config-control)/.test(combined)) return { group: 'systems', reason: 'core-system' };
  if (/(archive|archives|records|history|historical|transcript|decision-log|meeting-notes|minutes|legacy)/.test(combined)) return { group: 'archives', reason: 'archive' };

  if ([ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(channel.type)) return { group: 'social', reason: 'voice' };

  // Do not repeat setup2's mistake of throwing every unknown channel into Community
  // or Staff HQ. Unclear channels are intentionally left exactly where they are.
  return { group: null, reason: 'leave-in-place' };
}

function groupByKey(key) {
  return SETUP3_GROUPS.find((group) => group.key === key) ?? null;
}

function categoryMatches(group, category) {
  const categoryName = normalize(category.name);
  if (categoryName === normalize(group.name)) return true;
  return group.aliases.some((alias) => categoryName === normalize(alias));
}

function existingTargetCategories(guild) {
  const categories = [...guild.channels.cache.values()]
    .filter((channel) => channel.type === ChannelType.GuildCategory)
    .sort((a, b) => a.rawPosition - b.rawPosition);
  const targets = new Map();
  const claimed = new Set();

  for (const group of SETUP3_GROUPS) {
    const target = categories.find((category) => !claimed.has(category.id) && !protectedZoneForCategory(category) && categoryMatches(group, category));
    if (!target) continue;
    targets.set(group.key, target);
    claimed.add(target.id);
  }
  return targets;
}

async function ensureTargets(guild, usedKeys, preview) {
  const targets = existingTargetCategories(guild);
  let created = 0;
  let renamed = 0;

  for (const key of usedKeys) {
    const group = groupByKey(key);
    if (!group) continue;
    let target = targets.get(key);
    if (!target) {
      created++;
      target = preview
        ? { id: `preview:${key}`, name: group.name, preview: true }
        : await guild.channels.create({ name: group.name, type: ChannelType.GuildCategory, reason: 'Kingdom Core /setup3 curated server structure' });
      targets.set(key, target);
      continue;
    }

    if (target.name !== group.name) {
      renamed++;
      if (!preview) await target.setName(group.name, 'Kingdom Core /setup3 canonical category name').catch(() => null);
    }
  }

  return { targets, created, renamed };
}

function childCount(guild, parentId) {
  return guild.channels.cache.filter((channel) => channel.parentId === parentId && channel.type !== ChannelType.GuildCategory).size;
}

async function removeSafeEmptyLegacyCategories(guild, targets, preview) {
  const targetIds = new Set([...targets.values()].filter((target) => !target.preview).map((target) => target.id));
  let removed = 0;

  for (const category of guild.channels.cache.values()) {
    if (category.type !== ChannelType.GuildCategory || targetIds.has(category.id) || protectedZoneForCategory(category)) continue;
    const simpleName = normalize(category.name).replace(/-/g, ' ');
    if (!OLD_ORGANIZER_NAMES.has(simpleName)) continue;
    if (childCount(guild, category.id) !== 0) continue;
    if (!preview) {
      const deleted = await category.delete('Kingdom Core /setup3 removed empty category created by an earlier organiser').catch(() => null);
      if (!deleted) continue;
    }
    removed++;
  }
  return removed;
}

export async function analyseServerForSetup3(guild) {
  await guild.channels.fetch();
  const state = await readGuildState(guild.id);
  const channels = [...guild.channels.cache.values()]
    .filter((channel) => channel.type !== ChannelType.GuildCategory && !channel.isThread?.() && typeof channel.setParent === 'function')
    .sort((a, b) => a.rawPosition - b.rawPosition);

  const assignments = channels.map((channel) => ({ channel, ...classifyChannel(channel, state) }));
  const counts = Object.fromEntries(SETUP3_GROUPS.map((group) => [group.key, 0]));
  const protectedCounts = Object.fromEntries(SETUP3_PROTECTED_ZONES.map((zone) => [zone.key, 0]));
  let unclassified = 0;

  for (const assignment of assignments) {
    if (assignment.protected) protectedCounts[assignment.protected.key]++;
    else if (assignment.group) counts[assignment.group]++;
    else unclassified++;
  }

  return { state, channels, assignments, counts, protectedCounts, unclassified };
}

export async function organiseServerV3(guild, { preview = false, onProgress = async () => {} } = {}) {
  const analysis = await analyseServerForSetup3(guild);
  const { state, channels, assignments, counts, protectedCounts, unclassified } = analysis;
  const usedKeys = SETUP3_GROUPS.map((group) => group.key).filter((key) => counts[key] > 0);

  await onProgress(`Analysed ${channels.length} live channels. Carries, Market & Treasury and Knights are locked as protected zones.`);
  const { targets, created, renamed } = await ensureTargets(guild, usedKeys, preview);

  let moved = 0;
  let alreadyCorrect = 0;
  let failed = 0;
  let capacitySkipped = 0;

  for (const group of SETUP3_GROUPS) {
    const target = targets.get(group.key);
    if (!target) continue;
    const entries = assignments.filter((entry) => entry.group === group.key && !entry.protected);
    if (!entries.length) continue;
    await onProgress(`${preview ? 'Planning' : 'Organising'} ${group.name.replace(/━/g, '').trim()} • ${entries.length} channel(s)…`);

    let count = target.preview ? 0 : childCount(guild, target.id);
    for (const { channel } of entries) {
      if (!target.preview && channel.parentId === target.id) {
        alreadyCorrect++;
        continue;
      }
      if (count >= CATEGORY_CAPACITY) {
        capacitySkipped++;
        continue;
      }
      if (!preview) {
        const result = await channel.setParent(target.id, { lockPermissions: false }).catch(() => null);
        if (!result) {
          failed++;
          continue;
        }
      }
      moved++;
      count++;
    }
  }

  if (!preview) await guild.channels.fetch();
  const emptyLegacyRemoved = await removeSafeEmptyLegacyCategories(guild, targets, preview);

  const unclassifiedNames = assignments
    .filter((entry) => !entry.group && !entry.protected)
    .map((entry) => entry.channel.name)
    .slice(0, 15);

  state.setup ??= {};
  state.setup.organizerV3 = {
    version: 3,
    lastRunAt: new Date().toISOString(),
    preview,
    analysedChannels: channels.length,
    counts,
    protectedCounts,
    unclassified,
    categoryIds: Object.fromEntries([...targets.entries()].map(([key, target]) => [key, target.id])),
    summary: { created, renamed, moved, alreadyCorrect, failed, capacitySkipped, emptyLegacyRemoved }
  };
  if (!preview) await writeGuildState(guild.id, state);

  return {
    preview,
    analysedChannels: channels.length,
    counts,
    protectedCounts,
    protectedTotal: Object.values(protectedCounts).reduce((sum, value) => sum + value, 0),
    unclassified,
    unclassifiedNames,
    categoriesUsed: targets.size,
    categoriesCreated: created,
    categoriesRenamed: renamed,
    channelsMoved: moved,
    channelsAlreadyCorrect: alreadyCorrect,
    channelsFailed: failed,
    channelsSkippedCapacity: capacitySkipped,
    emptyLegacyCategoriesRemoved: emptyLegacyRemoved
  };
}
