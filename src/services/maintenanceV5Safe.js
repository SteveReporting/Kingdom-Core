import { LEVEL_TIERS } from './levelRoles.js';
import { mutateGuildState } from '../storage/store.js';
import { refreshPremiumV4 } from './platformV4Complete.js';

const DONE_TICKET = new Set(['closed', 'resolved']);
const YIELD_EVERY = 250;

function immediate() {
  return new Promise((resolve) => setImmediate(resolve));
}

function carrierCoverage(state) {
  const profiles = Object.values(state.carrierOps?.profiles ?? {});
  const available = profiles.filter((x) => x.status === 'available');
  const busy = profiles.filter((x) => x.status === 'busy' || x.shiftStartedAt);
  const waiting = Object.values(state.carryTickets ?? {})
    .filter((x) => x.status === 'open')
    .reduce((n, x) => n + Math.max(1, x.members?.length ?? 1), 0);
  const required = waiting ? Math.max(1, Math.ceil(waiting / 6)) : 0;
  return {
    available: available.length,
    busy: busy.length,
    required,
    deficit: Math.max(0, required - available.length),
    status: available.length >= required ? 'COVERED' : 'UNDERSTAFFED'
  };
}

function timestamp(value) {
  const time = Date.parse(value ?? '');
  return Number.isFinite(time) ? time : null;
}

export async function runHeartbeatSafePlatformMaintenance(guild) {
  const started = Date.now();

  await mutateGuildState(guild.id, async (fresh) => {
    if (!fresh.platform?.release && !fresh.platform?.schemaVersion) return;

    fresh.verificationV4 ??= {};
    fresh.analyticsV4 ??= {};
    fresh.analyticsV4.events ??= [];
    fresh.referralsV4 ??= { referrals: {}, qualified: {} };
    fresh.referralsV4.referrals ??= {};
    fresh.referralsV4.qualified ??= {};
    fresh.marketV4 ??= { listings: {}, watchlists: {}, priceIndex: {} };
    fresh.marketV4.listings ??= {};
    fresh.ticketMetricsV4 ??= { claimed: {}, firstResponse: {}, escalations: {}, summaries: {} };
    fresh.ticketMetricsV4.firstResponse ??= {};

    // Verification intelligence. Yield periodically so Discord heartbeats are never starved.
    let seen = 0;
    for (const member of guild.members.cache.values()) {
      if (member.user.bot) continue;
      const traveller = fresh.setup?.roles?.traveller;
      const tier = LEVEL_TIERS.find((x) => fresh.setup?.levelRoles?.[x.key] && member.roles.cache.has(fresh.setup.levelRoles[x.key]));
      fresh.verificationV4[member.id] = {
        verified: Boolean(traveller && member.roles.cache.has(traveller)),
        levelBand: tier?.key ?? null,
        dungeon: tier?.dungeon ?? null,
        displayName: member.displayName,
        updatedAt: new Date().toISOString()
      };
      seen++;
      if (seen % YIELD_EVERY === 0) await immediate();
    }

    // O(n) retention analytics. The previous implementation repeatedly scanned the full event history per join.
    const events = fresh.analyticsV4.events;
    const joins = [];
    const latestEventByUser = new Map();
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      if (!event?.userId) continue;
      const at = timestamp(event.at);
      if (at == null) continue;
      if (event.type === 'member.joined') joins.push({ userId: event.userId, at });
      const previous = latestEventByUser.get(event.userId) ?? 0;
      if (at > previous) latestEventByUser.set(event.userId, at);
      if (i > 0 && i % 2000 === 0) await immediate();
    }

    let eligible1 = 0, kept1 = 0, eligible7 = 0, kept7 = 0, eligible30 = 0, kept30 = 0;
    const now = Date.now();
    for (let i = 0; i < joins.length; i++) {
      const join = joins[i];
      const latest = latestEventByUser.get(join.userId) ?? join.at;
      if (now >= join.at + 86400000) { eligible1++; if (latest >= join.at + 86400000) kept1++; }
      if (now >= join.at + 7 * 86400000) { eligible7++; if (latest >= join.at + 7 * 86400000) kept7++; }
      if (now >= join.at + 30 * 86400000) { eligible30++; if (latest >= join.at + 30 * 86400000) kept30++; }
      if (i > 0 && i % 1000 === 0) await immediate();
    }

    fresh.analyticsV4.retention = {
      cohort: joins.length,
      d1: eligible1 ? Math.round((kept1 / eligible1) * 100) : 0,
      d7: eligible7 ? Math.round((kept7 / eligible7) * 100) : 0,
      d30: eligible30 ? Math.round((kept30 / eligible30) * 100) : 0
    };
    fresh.analyticsV4.coverage = carrierCoverage(fresh);

    // Quality referrals.
    for (const ref of Object.values(fresh.referralsV4.referrals)) {
      if (ref.status !== 'pending') continue;
      const member = guild.members.cache.get(ref.targetId);
      if (!member || member.user.bot || member.id === ref.referrerId) continue;
      const ageDays = (now - (member.joinedTimestamp ?? now)) / 86400000;
      const profile = fresh.identities?.[member.id];
      const meaningful = (profile?.kingdomXp ?? 0) >= 50 || (profile?.stats?.carriesReceived ?? 0) >= 1;
      const verified = fresh.verificationV4?.[member.id]?.verified;
      if (ageDays < 7 || !meaningful || !verified) continue;
      ref.status = 'qualified';
      ref.qualifiedAt = new Date().toISOString();
      fresh.referralsV4.qualified[ref.id] = ref;
      fresh.identities ??= {};
      fresh.identities[ref.referrerId] ??= { userId: ref.referrerId, kingdomXp: 0, stats: {}, achievements: [], titles: [] };
      fresh.identities[ref.referrerId].kingdomXp = (fresh.identities[ref.referrerId].kingdomXp ?? 0) + 100;
    }

    // Market index.
    const index = {};
    for (const listing of Object.values(fresh.marketV4.listings).filter((x) => x.status === 'active')) {
      const key = String(listing.item ?? '').trim().toLowerCase();
      if (!key) continue;
      index[key] ??= { count: 0, examples: [] };
      index[key].count++;
      if (index[key].examples.length < 5) index[key].examples.push(listing.id);
    }
    fresh.marketV4.priceIndex = index;

    // Ticket SLA snapshot.
    const open = Object.values(fresh.tickets ?? {}).filter((ticket) => !DONE_TICKET.has(ticket.status));
    fresh.ticketMetricsV4.sla ??= {};
    fresh.ticketMetricsV4.sla.open = open.length;
    fresh.ticketMetricsV4.sla.breached30m = open.filter((ticket) => {
      const created = timestamp(ticket.createdAt) ?? now;
      const key = ticket.id ?? ticket.channelId;
      return now - created > 1800000 && !fresh.ticketMetricsV4.firstResponse[key];
    }).length;
    fresh.ticketMetricsV4.sla.updatedAt = new Date().toISOString();

    fresh.systemV5 ??= {};
    fresh.systemV5.lastSafeMaintenanceAt = new Date().toISOString();
    fresh.systemV5.lastSafeMaintenanceMs = Date.now() - started;

    // Refresh the premium surfaces after calculations, with all CPU-heavy loops already yielded.
    await refreshPremiumV4(guild, fresh);
  });

  return { durationMs: Date.now() - started };
}
