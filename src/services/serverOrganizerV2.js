import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { readGuildState, writeGuildState } from '../storage/store.js';

export const ORGANIZER_GROUPS = Object.freeze([
  {
    key: 'start',
    name: '━━ 👑 START HERE ━━',
    priority: 30,
    categoryHints: ['start', 'arrival', 'welcome', 'info', 'verification'],
    keywords: ['welcome','rules','rule','verify','verification','roles','role-menu','server-info','information','start-here','getting-started','faq','member-count','server-stats']
  },
  {
    key: 'news',
    name: '━━ 📢 NEWS & UPDATES ━━',
    priority: 26,
    categoryHints: ['news', 'updates', 'announcements', 'notices'],
    keywords: ['announcement','announcements','news','update','updates','notice','notices','patch-notes','release-notes','changelog','milestone']
  },
  {
    key: 'community',
    name: '━━ 🏰 COMMUNITY ━━',
    priority: 8,
    categoryHints: ['community', 'kingdom', 'general', 'social'],
    keywords: ['general','chat','community','suggestion','suggestions','feedback','poll','polls','bot-commands','commands','off-topic','lounge-chat','questions','qotd']
  },
  {
    key: 'media',
    name: '━━ 🎨 MEDIA & CREATIONS ━━',
    priority: 18,
    categoryHints: ['media', 'creative', 'creations', 'gallery'],
    keywords: ['media','memes','meme','clips','clip','screenshots','screenshot','art','artwork','creations','gallery','videos','video','photos','photo','showcase']
  },
  {
    key: 'voice',
    name: '━━ 🔊 VOICE & SOCIAL ━━',
    priority: 16,
    categoryHints: ['voice', 'vc', 'lounge', 'social'],
    keywords: ['voice','vc','lounge','music','afk','hangout','gaming-vc','party-vc']
  },
  {
    key: 'events',
    name: '━━ 🏆 EVENTS & PROGRESSION ━━',
    priority: 20,
    categoryHints: ['events', 'progression', 'quests', 'season', 'tournament'],
    keywords: ['event','events','giveaway','giveaways','quest','quests','progress','progression','leaderboard','leaderboards','achievement','achievements','season','seasonal','tournament','tournaments','competition','competitions','rsvp']
  },
  {
    key: 'houses',
    name: '━━ 🏰 HOUSES ━━',
    priority: 24,
    categoryHints: ['house', 'houses', 'drakon', 'leonis', 'aether', 'fenrir'],
    keywords: ['house','houses','drakon','leonis','aether','fenrir','house-chat','house-leaderboard','house-events','house-quests']
  },
  {
    key: 'carries',
    name: '━━ ⚔️ CARRIES ━━',
    priority: 25,
    categoryHints: ['carry', 'carries', 'dungeon', 'queue', 'mission'],
    keywords: ['carry','carries','queue','dungeon','party','mission','ready-check','request-carry','carry-request','live-operations','run','runs','service','claim','waiting-room','boss','raid','carry-board','carry-log']
  },
  {
    key: 'economy',
    name: '━━ 💰 MARKET & TREASURY ━━',
    priority: 23,
    categoryHints: ['market', 'treasury', 'economy', 'trade', 'shop'],
    keywords: ['market','marketplace','trade','trading','treasury','economy','loan','lend','lending','borrow','item','items','shop','auction','price','prices','watchlist','asset','assets','donation','donations','gold']
  },
  {
    key: 'support',
    name: '━━ 🕯️ SUPPORT ━━',
    priority: 22,
    categoryHints: ['support', 'ticket', 'help', 'petition', 'appeal'],
    keywords: ['support','ticket','tickets','help','appeal','appeals','report','reports','dispute','petition','contact-staff','open-ticket','case','cases','complaint','complaints']
  },
  {
    key: 'applications',
    name: '━━ 📝 APPLICATIONS ━━',
    priority: 29,
    categoryHints: ['application', 'applications', 'recruitment', 'interview'],
    keywords: ['application','applications','apply','interview','interviews','recruitment','candidate','candidates','app-review','application-review','trial-application','staff-application','carrier-application']
  },
  {
    key: 'knights',
    name: '━━ 🛡️ KNIGHTS ━━',
    priority: 24,
    categoryHints: ['knight', 'carrier', 'squire', 'academy'],
    keywords: ['knight','knights','carrier','carriers','squire','academy','mentor','training','assignment','assignments','shift','shifts','coverage','commendation','service-hours','carrier-chat','carrier-announcements','knight-command']
  },
  {
    key: 'staff',
    name: '━━ 👑 STAFF HQ ━━',
    priority: 14,
    categoryHints: ['staff', 'council', 'admin', 'moderation', 'management'],
    keywords: ['staff','staff-chat','mod-chat','moderator','moderators','admin','admins','council','crown','management','staff-roster','staff-review','reviewer','leadership','royal-council','staff-announcements']
  },
  {
    key: 'security',
    name: '━━ 🔐 SECURITY & LOGS ━━',
    priority: 32,
    categoryHints: ['security', 'audit', 'logs', 'incident', 'moderation-log'],
    keywords: ['security','security-log','audit','audit-log','mod-log','moderation-log','automod','incident','incidents','raid-alert','raid-log','webhook-log','webhooks','punishment-log','evidence','anti-raid','anti-spam','risk','lockdown']
  },
  {
    key: 'systems',
    name: '━━ ⚙️ CORE SYSTEMS ━━',
    priority: 28,
    categoryHints: ['system', 'platform', 'bot', 'analytics', 'control-plane', 'diagnostics'],
    keywords: ['bot-control','platform','system','systems','control-plane','analytics','diagnostic','diagnostics','health','metrics','database','redis','postgres','api','websocket','worker','observability','configuration','config','automation','workflow','internal-api']
  },
  {
    key: 'archives',
    name: '━━ 📚 ARCHIVES & RECORDS ━━',
    priority: 21,
    categoryHints: ['archive', 'archives', 'records', 'history'],
    keywords: ['archive','archives','record','records','history','transcript','transcripts','closed-cases','closed-tickets','decision-log','decisions','meeting-notes','minutes','legacy','old','historical']
  }
]);

const MAX_TARGET_CATEGORIES = ORGANIZER_GROUPS.length;
const CATEGORY_CAPACITY = 50;
export const SOFT_CATEGORY_TARGET = 18;

function normalize(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/[━┃│┆┇•・|]/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function hasToken(haystack, needle) {
  const token = normalize(needle);
  if (!token || !haystack) return false;
  return haystack === token || haystack.startsWith(`${token}-`) || haystack.endsWith(`-${token}`) || haystack.includes(`-${token}-`);
}

function isMovable(channel) {
  return channel.type !== ChannelType.GuildCategory && !channel.isThread?.() && typeof channel.setParent === 'function';
}

function everyoneHidden(channel, guild) {
  const overwrite = channel.permissionOverwrites?.cache?.get(guild.roles.everyone.id);
  return Boolean(overwrite?.deny?.has?.(PermissionFlagsBits.ViewChannel));
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

function scoreGroup(group, channel, state) {
  const parentName = normalize(channel.parent?.name ?? '');
  const channelSignal = normalize([
    channel.name,
    channel.topic ?? '',
    knownKeyForChannel(state, channel.id)
  ].join(' '));

  let score = 0;
  for (const keyword of group.keywords) {
    const token = normalize(keyword);
    if (!token || !hasToken(channelSignal, token)) continue;
    score += channelSignal === token ? 12 : (token.length >= 6 ? 8 : 6);
  }

  // Current category is only a weak hint. The old organiser gave it too much
  // weight, which caused giant COMMUNITY and STAFF buckets to self-perpetuate.
  for (const hint of group.categoryHints) {
    if (hasToken(parentName, hint)) score += 2;
  }

  if (group.key === 'voice' && [ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(channel.type)) score += 9;
  if (group.key === 'news' && channel.type === ChannelType.GuildAnnouncement) score += 7;

  return score;
}

function classifyChannel(channel, guild, state) {
  const scored = ORGANIZER_GROUPS.map((group, index) => ({
    group,
    index,
    score: scoreGroup(group, channel, state)
  })).sort((a, b) => b.score - a.score || b.group.priority - a.group.priority || a.index - b.index);

  if (scored[0].score >= 5) return scored[0].group;

  const parentName = normalize(channel.parent?.name ?? '');
  const parentMatches = ORGANIZER_GROUPS
    .map((group) => ({
      group,
      score: group.categoryHints.reduce((sum, hint) => sum + Number(hasToken(parentName, hint)), 0)
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.group.priority - a.group.priority);
  if (parentMatches[0]) return parentMatches[0].group;

  if ([ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(channel.type)) {
    return ORGANIZER_GROUPS.find((group) => group.key === 'voice');
  }

  // Unknown private channels default to Staff HQ rather than risking exposure;
  // unknown public channels default to Community.
  return everyoneHidden(channel, guild)
    ? ORGANIZER_GROUPS.find((group) => group.key === 'staff')
    : ORGANIZER_GROUPS.find((group) => group.key === 'community');
}

function categoryMatches(group, category) {
  const name = normalize(category.name);
  if (name === normalize(group.name)) return true;
  return group.categoryHints.some((hint) => hasToken(name, hint));
}

function categoryChildren(guild, categoryId) {
  return guild.channels.cache.filter((channel) => channel.parentId === categoryId && channel.type !== ChannelType.GuildCategory);
}

function chooseTargets(guild) {
  const categories = [...guild.channels.cache.values()]
    .filter((channel) => channel.type === ChannelType.GuildCategory)
    .sort((a, b) => a.rawPosition - b.rawPosition);
  const claimed = new Set();
  const targets = new Map();

  // Reuse only a category whose name clearly matches the intended section.
  // We no longer hijack unrelated categories merely because many channels happen
  // to be there already.
  for (const group of ORGANIZER_GROUPS) {
    const exact = categories.find((category) => !claimed.has(category.id) && normalize(category.name) === normalize(group.name));
    const hinted = exact ?? categories.find((category) => !claimed.has(category.id) && categoryMatches(group, category));
    if (!hinted) continue;
    claimed.add(hinted.id);
    targets.set(group.key, hinted);
  }

  return targets;
}

async function ensureTargets(guild, assignments, preview) {
  const targets = chooseTargets(guild);
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
        reason: 'Kingdom Core /setup2 balanced server organisation'
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

async function removeCategoriesEmptiedByThisRun(guild, sourceIds, targetIds, preview, assignments, targets) {
  const protectedIds = new Set([...targetIds].filter((id) => !String(id).startsWith('preview:')));
  const candidateIds = [...sourceIds].filter((id) => id && !protectedIds.has(id));
  let removed = 0;

  for (const categoryId of candidateIds) {
    const category = guild.channels.cache.get(categoryId);
    if (!category || category.type !== ChannelType.GuildCategory) continue;

    if (preview) {
      const children = categoryChildren(guild, categoryId);
      const wouldRemain = children.some((child) => {
        const assignment = assignments.find((entry) => entry.channel.id === child.id);
        if (!assignment) return true;
        return targets.get(assignment.group.key)?.id === categoryId;
      });
      if (!wouldRemain) removed++;
      continue;
    }

    const children = categoryChildren(guild, categoryId);
    if (children.size) continue;
    const deleted = await category.delete('Kingdom Core /setup2 removed category emptied by this organisation run').catch(() => null);
    if (deleted) removed++;
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

  await onProgress(`Analysed ${channels.length} live channels and rebuilt the category plan from channel purpose, not just current placement.`);
  const { targets, created, renamed } = await ensureTargets(guild, assignments, preview);

  if (targets.size > MAX_TARGET_CATEGORIES) throw new Error(`setup2 target category cap exceeded (${targets.size}/${MAX_TARGET_CATEGORIES}).`);

  let moved = 0;
  let alreadyCorrect = 0;
  let skippedCapacity = 0;
  let failed = 0;
  const movedFromCategoryIds = new Set();

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
      if (channel.parentId) movedFromCategoryIds.add(channel.parentId);
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
  const removedEmptyCategories = await removeCategoriesEmptiedByThisRun(
    guild,
    movedFromCategoryIds,
    [...targets.values()].map((target) => target.id),
    preview,
    assignments,
    targets
  );

  const usedCounts = Object.entries(counts).filter(([, count]) => count > 0);
  const largest = usedCounts.sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
  const overloaded = usedCounts.filter(([, count]) => count > SOFT_CATEGORY_TARGET);

  state.setup ??= {};
  state.setup.organizerV2 = {
    version: 3,
    lastRunAt: new Date().toISOString(),
    preview,
    analysedChannels: channels.length,
    counts,
    categoryIds: Object.fromEntries([...targets.entries()].map(([key, target]) => [key, target.id])),
    summary: {
      created,
      renamed,
      moved,
      alreadyCorrect,
      skippedCapacity,
      failed,
      removedEmptyCategories,
      largestCategoryKey: largest[0],
      largestCategorySize: largest[1],
      overloadedCategoryKeys: overloaded.map(([key]) => key)
    }
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
    largestCategoryKey: largest[0],
    largestCategorySize: largest[1],
    overloadedCategoryKeys: overloaded.map(([key]) => key),
    categoryNames: Object.fromEntries([...targets.entries()].map(([key, target]) => [key, target.name]))
  };
}
