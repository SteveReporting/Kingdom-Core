import { ChannelType } from 'discord.js';
import { readGuildState, writeGuildState } from '../storage/store.js';

export const ORGANIZER_GROUPS = Object.freeze([
  {
    key: 'start',
    name: '━━ 👑 START HERE ━━',
    categoryHints: ['start', 'arrival', 'welcome', 'info', 'verification'],
    keywords: ['welcome','rules','rule','verify','verification','roles','role-menu','server-info','information','start-here','getting-started','faq','server-stats','member-count','status']
  },
  {
    key: 'community',
    name: '━━ 🏰 COMMUNITY ━━',
    categoryHints: ['community', 'kingdom', 'social', 'progression', 'houses', 'events'],
    keywords: ['general','chat','community','media','memes','clips','screenshots','suggestion','feedback','giveaway','event','events','house','houses','quest','quests','progress','progression','leaderboard','bot-commands','commands','off-topic','voice','vc','lounge','games','gaming']
  },
  {
    key: 'carries',
    name: '━━ ⚔️ CARRIES ━━',
    categoryHints: ['carry', 'carries', 'dungeon', 'queue', 'mission'],
    keywords: ['carry','carries','queue','dungeon','party','mission','ready-check','request-carry','carry-request','live-operations','operations','run','runs','service','claim','waiting-room','boss','raid']
  },
  {
    key: 'economy',
    name: '━━ 💰 MARKET & TREASURY ━━',
    categoryHints: ['market', 'treasury', 'economy', 'trade', 'shop'],
    keywords: ['market','marketplace','trade','trading','treasury','economy','loan','lend','lending','borrow','item','items','shop','auction','price','prices','watchlist','asset','assets','donation','donations','gold']
  },
  {
    key: 'support',
    name: '━━ 🕯️ SUPPORT & APPLICATIONS ━━',
    categoryHints: ['support', 'application', 'ticket', 'help', 'petition'],
    keywords: ['support','ticket','tickets','help','application','applications','apply','appeal','report','reports','dispute','petition','contact-staff','open-ticket','case','cases','interview']
  },
  {
    key: 'knights',
    name: '━━ 🛡️ KNIGHTS ━━',
    categoryHints: ['knight', 'carrier', 'squire', 'academy'],
    keywords: ['knight','knights','carrier','carriers','squire','academy','mentor','training','assignment','assignments','shift','shifts','coverage','commendation','service-hours','carrier-chat','carrier-announcements']
  },
  {
    key: 'staff',
    name: '━━ 👑 STAFF HQ ━━',
    categoryHints: ['staff', 'council', 'security', 'admin', 'moderation', 'command', 'system'],
    keywords: ['staff','mod','moderator','admin','council','crown','security','audit','logs','log','webhook','incident','control','command-center','command','analytics','internal','review','reviewer','management','royal-council','bot-control','platform','system','diagnostic','diagnostics']
  }
]);

const MAX_TARGET_CATEGORIES = ORGANIZER_GROUPS.length;
const CATEGORY_CAPACITY = 50;

function normalize(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/[━┃│┆┇•・|]/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function isMovable(channel) {
  return channel.type !== ChannelType.GuildCategory && !channel.isThread?.() && typeof channel.setParent === 'function';
}

function everyoneHidden(channel, guild) {
  const overwrite = channel.permissionOverwrites?.cache?.get(guild.roles.everyone.id);
  return Boolean(overwrite?.deny?.has?.('ViewChannel'));
}

function knownKeyForChannel(state, channelId) {
  for (const [key, id] of Object.entries(state.setup?.channels ?? {})) {
    if (id === channelId) return key;
  }
  for (const [key, id] of Object.entries(state.setup?.statsChannels ?? {})) {
    if (id === channelId) return key;
  }
  return '';
}

function scoreGroup(group, channel, guild, state) {
  const parent = channel.parent;
  const knownKey = knownKeyForChannel(state, channel.id);
  const haystack = normalize([
    channel.name,
    channel.topic ?? '',
    parent?.name ?? '',
    knownKey
  ].join(' '));

  let score = 0;
  for (const keyword of group.keywords) {
    const token = normalize(keyword);
    if (!token) continue;
    if (haystack === token) score += 8;
    else if (haystack.includes(token)) score += token.length >= 6 ? 5 : 3;
  }
  for (const hint of group.categoryHints) {
    if (normalize(parent?.name ?? '').includes(normalize(hint))) score += 4;
  }

  // Extra precision for sensitive/private channels. Ticket/carry/knight names still
  // win first; otherwise a hidden operational channel belongs in Staff HQ rather
  // than being accidentally exposed through a public-looking group.
  if (group.key === 'staff' && everyoneHidden(channel, guild)) score += 2;

  return score;
}

function classifyChannel(channel, guild, state) {
  const scored = ORGANIZER_GROUPS.map((group, index) => ({
    group,
    index,
    score: scoreGroup(group, channel, guild, state)
  })).sort((a, b) => b.score - a.score || a.index - b.index);

  if (scored[0].score > 0) return scored[0].group;

  // Unknown private channels stay on the safe side. Unknown public channels are
  // community by default so orphaned channels do not create extra categories.
  return everyoneHidden(channel, guild)
    ? ORGANIZER_GROUPS.find((group) => group.key === 'staff')
    : ORGANIZER_GROUPS.find((group) => group.key === 'community');
}

function categoryMatches(group, category) {
  const name = normalize(category.name);
  if (name === normalize(group.name)) return true;
  return group.categoryHints.some((hint) => name.includes(normalize(hint)));
}

function categoryChildren(guild, categoryId) {
  return guild.channels.cache.filter((channel) => channel.parentId === categoryId && channel.type !== ChannelType.GuildCategory);
}

function currentCategoryCounts(assignments) {
  const counts = new Map();
  for (const { channel, group } of assignments) {
    if (!channel.parentId) continue;
    const key = `${group.key}:${channel.parentId}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function chooseTargets(guild, assignments) {
  const categories = [...guild.channels.cache.values()]
    .filter((channel) => channel.type === ChannelType.GuildCategory)
    .sort((a, b) => a.rawPosition - b.rawPosition);
  const counts = currentCategoryCounts(assignments);
  const claimed = new Set();
  const targets = new Map();

  for (const group of ORGANIZER_GROUPS) {
    const canonical = categories.find((category) => !claimed.has(category.id) && normalize(category.name) === normalize(group.name));
    if (canonical) {
      claimed.add(canonical.id);
      targets.set(group.key, canonical);
      continue;
    }

    const hinted = categories
      .filter((category) => !claimed.has(category.id) && categoryMatches(group, category))
      .sort((a, b) => (counts.get(`${group.key}:${b.id}`) ?? 0) - (counts.get(`${group.key}:${a.id}`) ?? 0))[0];
    if (hinted) {
      claimed.add(hinted.id);
      targets.set(group.key, hinted);
      continue;
    }

    // Reuse a category only when at least two channels already belong there.
    // This avoids hijacking a one-off custom category purely to save one create.
    const majority = categories
      .filter((category) => !claimed.has(category.id))
      .map((category) => ({ category, count: counts.get(`${group.key}:${category.id}`) ?? 0 }))
      .filter((entry) => entry.count >= 2)
      .sort((a, b) => b.count - a.count)[0];
    if (majority) {
      claimed.add(majority.category.id);
      targets.set(group.key, majority.category);
    }
  }

  return targets;
}

async function ensureTargets(guild, assignments, preview) {
  const targets = chooseTargets(guild, assignments);
  const usedGroups = new Set(assignments.map((entry) => entry.group.key));
  let created = 0;
  let renamed = 0;

  for (const group of ORGANIZER_GROUPS) {
    if (!usedGroups.has(group.key)) continue;
    let target = targets.get(group.key);
    if (!target) {
      if (preview) {
        targets.set(group.key, { id: `preview:${group.key}`, name: group.name, preview: true });
        created++;
        continue;
      }
      target = await guild.channels.create({
        name: group.name,
        type: ChannelType.GuildCategory,
        reason: 'Kingdom Core /setup2 server organisation'
      });
      targets.set(group.key, target);
      created++;
    } else if (target.name !== group.name) {
      if (!preview) await target.setName(group.name, 'Kingdom Core /setup2 category organisation').catch(() => null);
      renamed++;
    }
  }

  return { targets, created, renamed };
}

async function removeEmptyOldCategories(guild, targetIds, preview) {
  const protectedIds = new Set([...targetIds].filter((id) => !String(id).startsWith('preview:')));
  const categories = [...guild.channels.cache.values()]
    .filter((channel) => channel.type === ChannelType.GuildCategory && !protectedIds.has(channel.id));

  let removed = 0;
  for (const category of categories) {
    const children = categoryChildren(guild, category.id);
    if (children.size) continue;
    if (!preview) {
      const deleted = await category.delete('Kingdom Core /setup2 removed empty category after organisation').catch(() => null);
      if (!deleted) continue;
    }
    removed++;
  }
  return removed;
}

export async function analyseServerOrganisation(guild) {
  await guild.channels.fetch();
  const state = await readGuildState(guild.id);
  const channels = [...guild.channels.cache.values()]
    .filter(isMovable)
    .sort((a, b) => a.rawPosition - b.rawPosition);

  const assignments = channels.map((channel) => ({
    channel,
    group: classifyChannel(channel, guild, state)
  }));

  const counts = Object.fromEntries(ORGANIZER_GROUPS.map((group) => [group.key, 0]));
  for (const entry of assignments) counts[entry.group.key]++;

  return { state, channels, assignments, counts };
}

export async function organiseServerV2(guild, { preview = false, onProgress = async () => {} } = {}) {
  const analysis = await analyseServerOrganisation(guild);
  const { state, channels, assignments, counts } = analysis;

  await onProgress(`Analysed ${channels.length} live channels across the entire server.`);
  const { targets, created, renamed } = await ensureTargets(guild, assignments, preview);

  if (targets.size > MAX_TARGET_CATEGORIES) throw new Error(`setup2 target category cap exceeded (${targets.size}/${MAX_TARGET_CATEGORIES}).`);

  let moved = 0;
  let alreadyCorrect = 0;
  let skippedCapacity = 0;
  let failed = 0;

  for (const group of ORGANIZER_GROUPS) {
    const target = targets.get(group.key);
    if (!target) continue;
    const entries = assignments.filter((entry) => entry.group.key === group.key);
    await onProgress(`${preview ? 'Planning' : 'Organising'} ${group.name.replace(/━/g, '').trim()} • ${entries.length} channel(s)…`);

    let targetCount = target.preview ? 0 : categoryChildren(guild, target.id).size;
    for (const { channel } of entries) {
      if (!target.preview && channel.parentId === target.id) {
        alreadyCorrect++;
        continue;
      }
      if (targetCount >= CATEGORY_CAPACITY) {
        skippedCapacity++;
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
      targetCount++;
    }
  }

  if (!preview) await guild.channels.fetch();
  const removedEmptyCategories = await removeEmptyOldCategories(guild, [...targets.values()].map((target) => target.id), preview);

  state.setup ??= {};
  state.setup.organizerV2 = {
    version: 2,
    lastRunAt: new Date().toISOString(),
    preview,
    analysedChannels: channels.length,
    counts,
    categoryIds: Object.fromEntries([...targets.entries()].map(([key, target]) => [key, target.id])),
    summary: { created, renamed, moved, alreadyCorrect, skippedCapacity, failed, removedEmptyCategories }
  };
  if (!preview) await writeGuildState(guild.id, state);

  return {
    preview,
    analysedChannels: channels.length,
    counts,
    categoriesUsed: targets.size,
    categoriesCreated: created,
    categoriesRenamed: renamed,
    channelsMoved: moved,
    channelsAlreadyCorrect: alreadyCorrect,
    channelsSkippedCapacity: skippedCapacity,
    channelsFailed: failed,
    emptyCategoriesRemoved: removedEmptyCategories,
    categoryNames: Object.fromEntries([...targets.entries()].map(([key, target]) => [key, target.name]))
  };
}
