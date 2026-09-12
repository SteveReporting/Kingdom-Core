import { mutateGuildState, readGuildState } from '../storage/store.js';
import { refreshV4Panels } from './platformV4.js';
import { auditDigitalTwin, decaySecurityRisk } from './securityV4.js';

const STAGES = [
  [0, 'Settlement'],
  [1000, 'Village'],
  [5000, 'Fort'],
  [15000, 'Keep'],
  [40000, 'Castle'],
  [100000, 'Kingdom'],
  [250000, 'Great Kingdom'],
  [600000, 'Empire']
];

function membersOf(ticket) {
  return [...new Set((ticket.members ?? [ticket.userId]).filter(Boolean))];
}

function ensureProfile(state, userId) {
  state.identities ??= {};
  state.identities[userId] ??= {
    userId,
    kingdomXp: 0,
    prestige: 0,
    stats: { carriesReceived: 0, carriesCompleted: 0, noShows: 0, events: 0, quests: 0, trades: 0 },
    achievements: [],
    titles: []
  };
  state.identities[userId].stats ??= {};
  state.identities[userId].achievements ??= [];
  state.identities[userId].titles ??= [];
  return state.identities[userId];
}

function ensureCarrier(state, userId) {
  state.carrierOps ??= { profiles: {} };
  state.carrierOps.profiles ??= {};
  state.carrierOps.profiles[userId] ??= {
    userId,
    status: 'off',
    completedRuns: 0,
    playersHelped: 0,
    serviceMinutes: 0,
    commendations: {},
    reputation: { positive: 0, neutral: 0, concerns: 0, score: 100 },
    workload: 0
  };
  return state.carrierOps.profiles[userId];
}

function uniquePush(list, value, max = 100) {
  if (!value || list.includes(value)) return false;
  list.push(value);
  if (list.length > max) list.splice(0, list.length - max);
  return true;
}

function awardProgressAchievements(profile) {
  const received = profile.stats?.carriesReceived ?? 0;
  const completed = profile.stats?.carriesCompleted ?? 0;
  const quests = profile.stats?.quests ?? 0;

  if (received >= 1) uniquePush(profile.achievements, 'First Carry');
  if (received >= 10) uniquePush(profile.achievements, 'Realm Regular');
  if (received >= 50) uniquePush(profile.achievements, 'Veteran Adventurer');
  if (completed >= 1) uniquePush(profile.achievements, 'First Service');
  if (completed >= 50) uniquePush(profile.achievements, 'Kingdom Helper');
  if (completed >= 250) uniquePush(profile.achievements, 'Royal Service');
  if (quests >= 1) uniquePush(profile.achievements, 'Quest Initiate');
  if (quests >= 25) uniquePush(profile.achievements, 'Quest Veteran');

  if (received >= 50) uniquePush(profile.titles, 'Veteran of the Realm', 50);
  if (completed >= 250) uniquePush(profile.titles, 'Servant of the Realm', 50);
  if (quests >= 25) uniquePush(profile.titles, 'Royal Questmaster', 50);
}

function awardCarrierAchievements(profile, carrier) {
  if (!carrier) return;
  if ((carrier.completedRuns ?? 0) >= 1) uniquePush(profile.achievements, 'Knight First Mission');
  if ((carrier.playersHelped ?? 0) >= 50) uniquePush(profile.achievements, '50 Players Helped');
  if ((carrier.playersHelped ?? 0) >= 100) uniquePush(profile.achievements, '100 Players Helped');
  if ((carrier.serviceMinutes ?? 0) >= 600) uniquePush(profile.achievements, '10 Hours of Verified Service');
  if ((carrier.playersHelped ?? 0) >= 100) uniquePush(profile.titles, 'Guardian of the Realm', 50);
}

function pushEvent(state, type, data = {}) {
  state.analyticsV4 ??= { events: [] };
  state.analyticsV4.events ??= [];
  state.analyticsV4.events.push({ type, at: new Date().toISOString(), ...data });
  if (state.analyticsV4.events.length > 5000) state.analyticsV4.events = state.analyticsV4.events.slice(-5000);
}

function updateKingdomStage(state) {
  state.kingdom ??= { xp: 0 };
  const xp = state.kingdom?.xp ?? 0;
  let stage = STAGES[0][1];
  let level = 1;
  for (let i = 0; i < STAGES.length; i++) {
    if (xp >= STAGES[i][0]) {
      stage = STAGES[i][1];
      level = i + 1;
    }
  }
  state.kingdom.stage = stage;
  state.kingdom.level = level;
}

function ensureQuestState(state) {
  state.questsV4 ??= { daily: [], weekly: [], community: [], completed: {} };
  state.questsV4.daily ??= [];
  state.questsV4.weekly ??= [];
  state.questsV4.community ??= [];
  state.questsV4.completed ??= {};
  state.questsV4.progress ??= {};
  return state.questsV4;
}

function questCompleteRecord(state, userId, quest) {
  const quests = ensureQuestState(state);
  quests.completed[userId] ??= {};
  return quests.completed[userId][quest.id] ?? null;
}

function incrementQuest(state, userId, quest, amount = 1) {
  if (!quest?.id || !userId || amount <= 0) return false;
  const quests = ensureQuestState(state);
  quests.progress[userId] ??= {};
  if (questCompleteRecord(state, userId, quest)) return false;

  const next = Math.min(Math.max(0, Number(quest.target) || 0), (Number(quests.progress[userId][quest.id]) || 0) + amount);
  quests.progress[userId][quest.id] = next;
  if (!quest.target || next < quest.target) return false;

  const completedAt = new Date().toISOString();
  quests.completed[userId][quest.id] = { completedAt, rewardXp: quest.rewardXp ?? 0, name: quest.name };
  const completedEntries = Object.entries(quests.completed[userId]);
  if (completedEntries.length > 100) {
    completedEntries
      .sort((a, b) => new Date(a[1]?.completedAt ?? 0) - new Date(b[1]?.completedAt ?? 0))
      .slice(0, completedEntries.length - 100)
      .forEach(([id]) => delete quests.completed[userId][id]);
  }

  const profile = ensureProfile(state, userId);
  profile.kingdomXp = (profile.kingdomXp ?? 0) + (Number(quest.rewardXp) || 0);
  profile.stats.quests = (profile.stats.quests ?? 0) + 1;
  awardProgressAchievements(profile);
  pushEvent(state, 'quest.completed', { userId, questId: quest.id, rewardXp: quest.rewardXp ?? 0 });
  return true;
}

function progressCarryQuests(state, ticket, members) {
  const quests = ensureQuestState(state);
  const dailyCarry = quests.daily.find((quest) => quest.kind === 'carry-participation' || /Answer the Call/i.test(quest.name ?? ''));
  const dailyAid = quests.daily.find((quest) => quest.kind === 'realm-aid' || /Aid the Realm/i.test(quest.name ?? ''));
  const weeklyKnight = quests.weekly.find((quest) => quest.kind === 'carrier-service' || /Knight of the Week/i.test(quest.name ?? ''));

  for (const userId of members) {
    if (dailyCarry) incrementQuest(state, userId, dailyCarry, 1);
    if (dailyAid) incrementQuest(state, userId, dailyAid, 1);
  }
  if (ticket.carrierId) {
    if (dailyCarry) incrementQuest(state, ticket.carrierId, dailyCarry, 1);
    if (dailyAid) incrementQuest(state, ticket.carrierId, dailyAid, 1);
    if (weeklyKnight) incrementQuest(state, ticket.carrierId, weeklyKnight, members.length);
  }

  for (const quest of quests.community) {
    if (quest.completedAt) continue;
    if (quest.dungeon && quest.dungeon !== ticket.dungeon) continue;
    quest.progress = Math.min(Number(quest.target) || 0, (Number(quest.progress) || 0) + members.length);
    if (quest.target && quest.progress >= quest.target) {
      quest.completedAt = new Date().toISOString();
      state.kingdom.xp = (state.kingdom.xp ?? 0) + (Number(quest.rewardXp) || 0);
      pushEvent(state, 'quest.community.completed', { questId: quest.id, rewardXp: quest.rewardXp ?? 0 });
      updateKingdomStage(state);
    }
  }
}

export function recordCarryTransition(state, ticket, action, actorId) {
  if (!state.platform?.featureFlags?.analytics) return;
  const members = membersOf(ticket);
  pushEvent(state, `carry.${action}`, {
    carryId: ticket.id,
    actorId,
    carrierId: ticket.carrierId ?? null,
    dungeon: ticket.dungeon,
    difficulty: ticket.difficulty,
    mode: ticket.mode,
    partySize: members.length
  });

  if (action === 'requested' || action === 'joined') {
    for (const userId of members) ensureProfile(state, userId);
  }
  if (action === 'claimed' && ticket.carrierId) {
    const carrier = ensureCarrier(state, ticket.carrierId);
    carrier.workload = Math.min(100, (carrier.workload ?? 0) + 10);
  }
  if (action === 'returned' && ticket.carrierId) {
    const carrier = ensureCarrier(state, ticket.carrierId);
    carrier.interruptedRuns = (carrier.interruptedRuns ?? 0) + 1;
  }
  if (action === 'completed') {
    const minutes = ticket.startedAt && ticket.completedAt
      ? Math.max(0, Math.round((new Date(ticket.completedAt) - new Date(ticket.startedAt)) / 60000))
      : 0;
    for (const userId of members) {
      const profile = ensureProfile(state, userId);
      profile.stats.carriesReceived = (profile.stats.carriesReceived ?? 0) + 1;
      profile.kingdomXp = (profile.kingdomXp ?? 0) + 10;
      awardProgressAchievements(profile);
    }
    if (ticket.carrierId) {
      const carrier = ensureCarrier(state, ticket.carrierId);
      carrier.completedRuns = (carrier.completedRuns ?? 0) + 1;
      carrier.playersHelped = (carrier.playersHelped ?? 0) + members.length;
      carrier.serviceMinutes = (carrier.serviceMinutes ?? 0) + minutes;
      carrier.workload = Math.max(0, Math.min(100, (carrier.workload ?? 0) + 5));
      const carrierIdentity = ensureProfile(state, ticket.carrierId);
      carrierIdentity.stats.carriesCompleted = (carrierIdentity.stats.carriesCompleted ?? 0) + members.length;
      carrierIdentity.kingdomXp = (carrierIdentity.kingdomXp ?? 0) + 20 + members.length * 2;
      awardProgressAchievements(carrierIdentity);
      awardCarrierAchievements(carrierIdentity, carrier);
    }
    state.kingdom.xp = (state.kingdom.xp ?? 0) + 25 + members.length * 10;
    progressCarryQuests(state, ticket, members);
    updateKingdomStage(state);
  }
}

function backfillCarryLifecycle(state) {
  for (const ticket of Object.values(state.carryTickets ?? {})) {
    if (ticket.status !== 'completed' || ticket.v4ProcessedAt) continue;
    recordCarryTransition(state, ticket, 'completed', ticket.completedBy ?? ticket.carrierId ?? null);
    ticket.v4ProcessedAt = new Date().toISOString();
  }
}

function rebuildDemand(state) {
  const demand = {};
  const tickets = Object.values(state.carryTickets ?? {}).filter((x) => ['open', 'claimed', 'ready', 'running'].includes(x.status));
  for (const ticket of tickets) {
    const count = membersOf(ticket).length;
    const key = ticket.dungeon ?? 'Unknown';
    demand[key] ??= { waiting: 0, active: 0, requests: 0 };
    demand[key].requests += count;
    if (ticket.status === 'open') demand[key].waiting += count;
    else demand[key].active += count;
  }
  state.analyticsV4.demand = demand;
  const completed = Object.values(state.carryTickets ?? {}).filter((x) => x.status === 'completed' && x.startedAt && x.completedAt);
  const avgByDungeon = {};
  for (const t of completed.slice(-500)) {
    const ms = Math.max(0, new Date(t.completedAt) - new Date(t.startedAt));
    avgByDungeon[t.dungeon] ??= [];
    avgByDungeon[t.dungeon].push(ms);
  }
  const forecasts = {};
  for (const [dungeon, row] of Object.entries(demand)) {
    const durations = avgByDungeon[dungeon] ?? [];
    const avgMs = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 8 * 60_000;
    const estimatedMinutes = Math.max(1, Math.round((row.waiting * avgMs) / Math.max(1, row.active + 1) / 60000));
    forecasts[dungeon] = { ...row, avgRunMinutes: Math.max(1, Math.round(avgMs / 60000)), estimatedWaitMinutes: estimatedMinutes };
  }
  state.analyticsV4.forecasts = forecasts;
}

function updateFunnels(state) {
  const profiles = Object.values(state.identities ?? {});
  state.analyticsV4.funnels = {
    identities: profiles.length,
    receivedCarry: profiles.filter((p) => (p.stats?.carriesReceived ?? 0) > 0).length,
    completedCarry: profiles.filter((p) => (p.stats?.carriesCompleted ?? 0) > 0).length,
    activeContributor: profiles.filter((p) => (p.kingdomXp ?? 0) >= 100).length
  };
}

function weekKey(date = new Date()) {
  const current = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = current.getUTCDay() || 7;
  current.setUTCDate(current.getUTCDate() - day + 1);
  return current.toISOString().slice(0, 10);
}

function generateQuests(state) {
  const quests = ensureQuestState(state);
  const today = new Date().toISOString().slice(0, 10);
  const week = weekKey();
  const hottest = Object.entries(state.analyticsV4?.demand ?? {}).sort((a, b) => (b[1].requests ?? 0) - (a[1].requests ?? 0))[0]?.[0] ?? null;

  if (quests.dailyGeneratedAt !== today) {
    quests.daily = [
      { id: `daily-carry-${today}`, kind: 'carry-participation', name: 'Answer the Call', description: 'Complete or receive 3 successful carries.', target: 3, rewardXp: 75 },
      { id: `daily-help-${today}`, kind: 'realm-aid', name: 'Aid the Realm', description: 'Help another member or participate in a Kingdom activity.', target: 1, rewardXp: 40 }
    ];
    quests.dailyGeneratedAt = today;
  }

  if (quests.weeklyGeneratedAt !== week) {
    quests.weekly = [
      { id: `weekly-knight-${week}`, kind: 'carrier-service', name: 'Knight of the Week', description: 'Contribute to 25 successful player carries.', target: 25, rewardXp: 500 }
    ];
    quests.weeklyGeneratedAt = week;
  }

  if (quests.communityGeneratedAt !== today) {
    quests.community = [
      {
        id: `bounty-${today}`,
        kind: 'community-bounty',
        name: "King's Bounty",
        description: hottest ? `Prioritise **${hottest}** while demand is elevated.` : 'Complete carries together to answer the Realm\'s demand.',
        dungeon: hottest,
        target: 100,
        rewardXp: 1500,
        progress: 0,
        completedAt: null
      }
    ];
    quests.communityGeneratedAt = today;
  }
  quests.generatedAt = today;
}

export async function trackPlatformEvent(guildId, type, data = {}) {
  await mutateGuildState(guildId, async (state) => {
    if (!state.platform?.featureFlags?.eventBus) return;
    pushEvent(state, type, data);
  });
}

export async function runV4Maintenance(guild) {
  const state = await readGuildState(guild.id);
  if (!state.platform?.schemaVersion) return false;
  await mutateGuildState(guild.id, async (fresh) => {
    fresh.analyticsV4 ??= { events: [], demand: {}, forecasts: {}, funnels: {} };
    generateQuests(fresh);
    backfillCarryLifecycle(fresh);
    rebuildDemand(fresh);
    updateFunnels(fresh);
    fresh.systemV4 ??= {};
    fresh.systemV4.lastMaintenanceAt = new Date().toISOString();
    fresh.systemV4.health = {
      bot: 'healthy',
      discordPing: guild.client.ws.ping,
      memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      uptimeSeconds: Math.round(process.uptime()),
      storage: 'json-fallback',
      api: String(process.env.ENABLE_PLATFORM_API).toLowerCase() === 'true' ? 'enabled' : 'disabled'
    };
    if (fresh.securityV4?.snapshots?.length) fresh.securityV4.drift = await auditDigitalTwin(guild, fresh).catch(() => fresh.securityV4.drift ?? []);
    await refreshV4Panels(guild, fresh);
  });
  await decaySecurityRisk(guild).catch(() => null);
  return true;
}
