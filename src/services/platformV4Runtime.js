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
    }
    state.kingdom.xp = (state.kingdom.xp ?? 0) + 25 + members.length * 10;
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

function generateQuests(state) {
  state.questsV4 ??= { daily: [], weekly: [], community: [], completed: {} };
  const today = new Date().toISOString().slice(0, 10);
  if (state.questsV4.generatedAt === today) return;
  const hottest = Object.entries(state.analyticsV4?.demand ?? {}).sort((a, b) => (b[1].requests ?? 0) - (a[1].requests ?? 0))[0]?.[0] ?? 'any dungeon';
  state.questsV4.daily = [
    { id: `daily-carry-${today}`, name: 'Answer the Call', description: 'Complete or receive 3 successful carries.', target: 3, rewardXp: 75 },
    { id: `daily-help-${today}`, name: 'Aid the Realm', description: 'Help another member or participate in a Kingdom activity.', target: 1, rewardXp: 40 }
  ];
  state.questsV4.weekly = [
    { id: `weekly-${today}`, name: 'Knight of the Week', description: 'Contribute to 25 successful player carries.', target: 25, rewardXp: 500 }
  ];
  state.questsV4.community = [
    { id: `bounty-${today}`, name: "King's Bounty", description: `Prioritise **${hottest}** while demand is elevated.`, target: 100, rewardXp: 1500 }
  ];
  state.questsV4.generatedAt = today;
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
    backfillCarryLifecycle(fresh);
    rebuildDemand(fresh);
    updateFunnels(fresh);
    generateQuests(fresh);
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
