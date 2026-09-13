import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PermissionFlagsBits } from 'discord.js';
import { CARRIER_KEYS, STAFF_KEYS } from '../config/blueprint.js';
import { mutateGuildState, readGuildState } from '../storage/store.js';

const MAX_LEDGER = 5000;
const MAX_RELAY = 1500;
const MAX_NOTIFICATIONS = 150;
const MAX_DECISIONS = 250;
const MAX_LAB_RUNS = 100;
const MAX_SNAPSHOTS = 24;
const ACTIVE_CARRY = new Set(['open', 'claimed', 'ready', 'running']);
const MARKET_TERMINAL = new Set(['sold', 'closed', 'cancelled']);

const DEFAULT_EXTENSIONS = Object.freeze({
  'carry-operations': { id: 'carry-operations', name: 'Carry Operations', version: '1.0.0', trusted: true },
  'kingdom-id': { id: 'kingdom-id', name: 'Kingdom ID', version: '1.0.0', trusted: true },
  'kingdom-ledger': { id: 'kingdom-ledger', name: 'Kingdom Ledger', version: '1.0.0', trusted: true },
  'kingdom-relay': { id: 'kingdom-relay', name: 'Kingdom Relay', version: '1.0.0', trusted: true },
  'kingdom-key': { id: 'kingdom-key', name: 'Kingdom Key', version: '1.0.0', trusted: true },
  'kingdom-forge': { id: 'kingdom-forge', name: 'Kingdom Forge', version: '1.0.0', trusted: true },
  'kingdom-contracts': { id: 'kingdom-contracts', name: 'Kingdom Contracts', version: '1.0.0', trusted: true },
  'kingdom-gateway': { id: 'kingdom-gateway', name: 'Kingdom Gateway', version: '1.0.0', trusted: true },
  'decision-engine': { id: 'decision-engine', name: 'Kingdom Decision Engine', version: '1.0.0', trusted: true }
});

const CAPABILITY_GROUPS = Object.freeze({
  member: [
    'identity.read.self', 'notifications.read.self', 'notifications.update.self',
    'carry.read.self', 'market.create', 'market.close.self', 'referral.read.self',
    'referral.create', 'contract.read.self', 'contract.sign.self', 'gateway.resolve',
    'search.public'
  ],
  carrier: [
    'carry.read.assigned', 'carry.control.assigned', 'carrier.read.self', 'search.carrier'
  ],
  staff: [
    'identity.read.staff', 'notifications.send', 'carry.read.all', 'carry.control.all',
    'market.moderate', 'treasury.read', 'treasury.manage', 'contract.manage',
    'gateway.manage', 'ledger.read', 'relay.read', 'forge.manage', 'studio.manage',
    'factory.manage', 'extensions.manage', 'labs.run', 'timemachine.capture',
    'decision.read', 'search.staff', 'trust.read.staff'
  ],
  owner: ['*']
});

function clean(value, max = 240) {
  return typeof value === 'string' ? value.trim().slice(0, max) : String(value ?? '').trim().slice(0, max);
}

function nowIso() {
  return new Date().toISOString();
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function hash(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

function shortToken(bytes = 6) {
  return randomBytes(bytes).toString('base64url').replace(/[-_]/g, '').toUpperCase().slice(0, 10);
}

function roleIds(state, keys) {
  return keys.map((key) => state.setup?.roles?.[key]).filter(Boolean);
}

function memberHasAnyRole(member, ids) {
  return ids.some((id) => member?.roles?.cache?.has?.(id));
}

export function isEcosystemStaff(member, state) {
  if (member?.permissions?.has?.(PermissionFlagsBits.Administrator)) return true;
  return memberHasAnyRole(member, roleIds(state, STAFF_KEYS));
}

export function isEcosystemCarrier(member, state) {
  return isEcosystemStaff(member, state) || memberHasAnyRole(member, roleIds(state, CARRIER_KEYS));
}

export function ensureEcosystemState(state) {
  state.ecosystemV1 ??= {};
  const eco = state.ecosystemV1;
  eco.version = 1;
  eco.updatedAt ??= nowIso();
  eco.relay ??= { sequence: 0, events: [] };
  eco.relay.events ??= [];
  eco.ledger ??= { sequence: 0, anchorHash: 'GENESIS', entries: [] };
  eco.ledger.entries ??= [];
  eco.notifications ??= {};
  eco.referrals ??= { codes: {}, codeByUser: {}, claims: {} };
  eco.referrals.codes ??= {};
  eco.referrals.codeByUser ??= {};
  eco.referrals.claims ??= {};
  eco.contracts ??= {};
  eco.gateway ??= { links: {} };
  eco.gateway.links ??= {};
  eco.forge ??= {
    workflows: {
      'treasury-overdue': {
        id: 'treasury-overdue',
        name: 'Treasury overdue recovery',
        trigger: 'treasury.loan.overdue',
        enabled: true,
        steps: ['notify-borrower', 'alert-custodian', 'open-case-after-48h']
      }
    },
    history: []
  };
  eco.forge.workflows ??= {};
  eco.forge.history ??= [];
  eco.timeMachine ??= { snapshots: {} };
  eco.timeMachine.snapshots ??= {};
  eco.labs ??= { runs: [] };
  eco.labs.runs ??= [];
  eco.studio ??= { surfaces: {} };
  eco.studio.surfaces ??= {};
  eco.factory ??= { products: {} };
  eco.factory.products ??= {};
  eco.extensions ??= { registry: {}, installed: {} };
  eco.extensions.registry ??= {};
  eco.extensions.installed ??= {};
  for (const manifest of Object.values(DEFAULT_EXTENSIONS)) {
    eco.extensions.registry[manifest.id] ??= manifest;
    eco.extensions.installed[manifest.id] ??= { enabled: true, installedAt: nowIso(), source: 'core' };
  }
  eco.network ??= { peers: {}, tenant: { mode: 'single-guild', cloudEnabled: false } };
  eco.network.peers ??= {};
  eco.network.tenant ??= { mode: 'single-guild', cloudEnabled: false };
  eco.exchange ??= { offers: {}, matches: [] };
  eco.exchange.offers ??= {};
  eco.exchange.matches ??= [];
  eco.decisions ??= { recommendations: [] };
  eco.decisions.recommendations ??= [];
  eco.intelligence ??= { enabled: true, mode: 'context-and-guarded-actions', conversations: {} };
  eco.intelligence.conversations ??= {};
  state.identities ??= {};
  state.marketV4 ??= { listings: {}, history: [] };
  state.marketV4.listings ??= {};
  state.marketV4.history ??= [];
  state.referralsV4 ??= { referrals: {}, qualified: {} };
  state.referralsV4.referrals ??= {};
  state.referralsV4.qualified ??= {};
  state.treasuryV4 ??= { items: {}, loans: {}, requests: {}, history: [] };
  state.treasuryV4.items ??= {};
  state.treasuryV4.loans ??= {};
  state.treasuryV4.requests ??= {};
  state.treasuryV4.history ??= [];
  state.carryTickets ??= {};
  state.tickets ??= {};
  return eco;
}

function appendBounded(list, value, max) {
  list.push(value);
  if (list.length > max) list.splice(0, list.length - max);
  return value;
}

export function appendKingdomLedger(state, type, actorId = null, subjectId = null, payload = {}) {
  const eco = ensureEcosystemState(state);
  const ledger = eco.ledger;
  const previous = ledger.entries.at(-1)?.hash ?? ledger.anchorHash ?? 'GENESIS';
  const sequence = (ledger.sequence ?? 0) + 1;
  const at = nowIso();
  const body = {
    sequence,
    at,
    type: clean(type, 120),
    actorId: actorId ? clean(actorId, 40) : null,
    subjectId: subjectId ? clean(subjectId, 100) : null,
    payload
  };
  const entry = { ...body, previousHash: previous, hash: hash({ previous, ...body }) };
  ledger.sequence = sequence;
  ledger.entries.push(entry);
  if (ledger.entries.length > MAX_LEDGER) {
    const removed = ledger.entries.splice(0, ledger.entries.length - MAX_LEDGER);
    ledger.anchorHash = removed.at(-1)?.hash ?? ledger.anchorHash;
  }
  eco.updatedAt = at;
  return entry;
}

export function emitKingdomRelay(state, type, actorId = null, payload = {}) {
  const eco = ensureEcosystemState(state);
  const sequence = (eco.relay.sequence ?? 0) + 1;
  const event = {
    id: `EV-${sequence}-${shortToken(4)}`,
    sequence,
    type: clean(type, 120),
    actorId: actorId ? clean(actorId, 40) : null,
    at: nowIso(),
    payload
  };
  eco.relay.sequence = sequence;
  appendBounded(eco.relay.events, event, MAX_RELAY);
  appendKingdomLedger(state, `relay.${event.type}`, actorId, event.id, payload);
  return event;
}

export function ensureKingdomId(state, userId, seed = {}) {
  const id = clean(userId, 40);
  if (!id) throw new Error('Kingdom ID requires a Discord user id.');
  ensureEcosystemState(state);
  state.identities[id] ??= { userId: id, kingdomXp: 0, stats: {}, achievements: [], titles: [] };
  const profile = state.identities[id];
  profile.kingdomId ??= `KID-${randomUUID().replaceAll('-', '').slice(0, 16).toUpperCase()}`;
  profile.identityVersion ??= 1;
  profile.createdAt ??= nowIso();
  profile.updatedAt = nowIso();
  profile.providers ??= {};
  profile.providers.discord = {
    id,
    username: clean(seed.discordUsername ?? profile.discordName ?? '', 100) || null,
    linked: true
  };
  const roblox = profile.website?.roblox;
  if (roblox?.userId) {
    profile.providers.roblox = {
      id: clean(roblox.userId, 40),
      username: clean(roblox.username, 100),
      displayName: clean(roblox.displayName, 100) || null,
      verifiedAt: roblox.verifiedAt ?? null,
      linked: true
    };
  }
  return profile.kingdomId;
}

export function getKingdomIdCard(state, userId) {
  const kingdomId = ensureKingdomId(state, userId);
  const profile = state.identities[userId] ?? {};
  return {
    kingdomId,
    userId,
    displayName: profile.website?.displayName || profile.displayName || profile.discordName || null,
    providers: profile.providers ?? {},
    createdAt: profile.createdAt ?? null,
    progression: {
      kingdomXp: Number(profile.kingdomXp ?? 0),
      prestige: Number(profile.prestige ?? 0)
    }
  };
}

export function capabilitiesForMember(member, state) {
  const caps = new Set(CAPABILITY_GROUPS.member);
  if (isEcosystemCarrier(member, state)) for (const cap of CAPABILITY_GROUPS.carrier) caps.add(cap);
  if (isEcosystemStaff(member, state)) for (const cap of CAPABILITY_GROUPS.staff) caps.add(cap);
  if (member?.permissions?.has?.(PermissionFlagsBits.Administrator)) return ['*'];
  return [...caps].sort();
}

export function memberCan(member, state, capability) {
  const caps = capabilitiesForMember(member, state);
  return caps.includes('*') || caps.includes(capability);
}

export function notifyKingdomUser(state, userId, input = {}) {
  const eco = ensureEcosystemState(state);
  const id = clean(userId, 40);
  if (!id) return null;
  eco.notifications[id] ??= [];
  const notification = {
    id: `NT-${Date.now().toString(36).toUpperCase()}-${shortToken(3)}`,
    type: clean(input.type || 'system', 80),
    title: clean(input.title || 'Kingdom update', 160),
    body: clean(input.body || '', 1000),
    data: input.data && typeof input.data === 'object' ? input.data : {},
    createdAt: nowIso(),
    readAt: null
  };
  appendBounded(eco.notifications[id], notification, MAX_NOTIFICATIONS);
  return notification;
}

export function getKingdomNotifications(state, userId, options = {}) {
  const eco = ensureEcosystemState(state);
  const limit = Math.max(1, Math.min(100, Number(options.limit ?? 50)));
  const unreadOnly = options.unreadOnly === true;
  return (eco.notifications[clean(userId, 40)] ?? [])
    .filter((x) => !unreadOnly || !x.readAt)
    .slice(-limit)
    .reverse();
}

export function markKingdomNotificationRead(state, userId, notificationId = null) {
  const eco = ensureEcosystemState(state);
  const rows = eco.notifications[clean(userId, 40)] ?? [];
  let changed = 0;
  for (const row of rows) {
    if (row.readAt) continue;
    if (notificationId && row.id !== notificationId) continue;
    row.readAt = nowIso();
    changed++;
  }
  return changed;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[index];
}

function completedDurations(state, ticket) {
  const all = Object.values(state.carryTickets ?? {})
    .filter((x) => x.status === 'completed' && x.startedAt && x.completedAt)
    .map((x) => ({
      ticket: x,
      minutes: Math.max(1, (new Date(x.completedAt).getTime() - new Date(x.startedAt).getTime()) / 60000)
    }))
    .filter((x) => Number.isFinite(x.minutes) && x.minutes < 180)
    .slice(-500);
  const exact = all.filter((x) => x.ticket.dungeon === ticket.dungeon && x.ticket.difficulty === ticket.difficulty && x.ticket.mode === ticket.mode);
  if (exact.length >= 5) return { samples: exact, tier: 'exact' };
  const dungeon = all.filter((x) => x.ticket.dungeon === ticket.dungeon);
  if (dungeon.length >= 3) return { samples: dungeon, tier: 'dungeon' };
  return { samples: all, tier: 'global' };
}

export function smartCarryEta(state, ticketOrId) {
  ensureEcosystemState(state);
  const ticket = typeof ticketOrId === 'string' ? state.carryTickets?.[ticketOrId] : ticketOrId;
  if (!ticket) return null;
  const active = Object.values(state.carryTickets ?? {}).filter((x) => ACTIVE_CARRY.has(x.status));
  const peers = active
    .filter((x) => x.dungeon === ticket.dungeon && x.difficulty === ticket.difficulty && x.mode === ticket.mode)
    .sort((a, b) => new Date(a.createdAt ?? 0) - new Date(b.createdAt ?? 0));
  const queueIndex = Math.max(0, peers.findIndex((x) => x.id === ticket.id));
  const profiles = Object.values(state.carrierOps?.profiles ?? {});
  const available = profiles.filter((x) => x.status === 'available' || x.shiftStartedAt).length;
  const busy = profiles.filter((x) => x.status === 'busy').length;
  const sampleSet = completedDurations(state, ticket);
  const durations = sampleSet.samples.map((x) => x.minutes);
  const runMedian = median(durations) ?? 8;
  const runP25 = percentile(durations, 0.25) ?? Math.max(3, runMedian * 0.7);
  const runP75 = percentile(durations, 0.75) ?? runMedian * 1.35;
  const effectiveCapacity = Math.max(1, available + Math.floor(busy * 0.35));
  const jobsAhead = ticket.status === 'open' ? queueIndex : 0;
  const activePenalty = active.filter((x) => x.status === 'running' && x.dungeon === ticket.dungeon).length * runMedian * 0.35;
  const estimate = ticket.status === 'running'
    ? Math.max(1, Math.round(runMedian * 0.45))
    : ticket.status === 'claimed' || ticket.status === 'ready'
      ? Math.max(1, Math.round(runMedian * 0.25))
      : Math.max(1, Math.round(((jobsAhead + 1) / effectiveCapacity) * runMedian + activePenalty));
  const sampleConfidence = Math.min(1, durations.length / 20);
  const capacityConfidence = profiles.length ? Math.min(1, (available + busy) / Math.max(2, profiles.length * 0.4)) : 0.2;
  const confidence = Math.round(100 * (0.25 + sampleConfidence * 0.5 + capacityConfidence * 0.25));
  const spread = Math.max(2, Math.round((runP75 - runP25) + estimate * (1 - confidence / 100) * 0.5));
  return {
    carryId: ticket.id,
    status: ticket.status,
    estimateMinutes: estimate,
    lowMinutes: Math.max(1, estimate - Math.ceil(spread / 2)),
    highMinutes: estimate + spread,
    confidence: Math.min(95, Math.max(20, confidence)),
    samples: durations.length,
    sampleTier: sampleSet.tier,
    medianRunMinutes: Math.round(runMedian),
    carriersAvailable: available,
    carriersBusy: busy,
    queueAhead: jobsAhead,
    calculatedAt: nowIso()
  };
}

export function allSmartCarryEtas(state) {
  return Object.values(state.carryTickets ?? {})
    .filter((x) => ACTIVE_CARRY.has(x.status))
    .map((ticket) => smartCarryEta(state, ticket))
    .filter(Boolean);
}

export function ensureCarryTimeline(ticket) {
  ticket.timeline ??= [];
  const known = new Set(ticket.timeline.map((x) => `${x.type}:${x.at}`));
  const add = (type, at, actorId = null, meta = {}) => {
    if (!at || known.has(`${type}:${at}`)) return;
    ticket.timeline.push({ id: `TL-${hash(`${ticket.id}:${type}:${at}`).slice(0, 12).toUpperCase()}`, type, at, actorId, meta });
    known.add(`${type}:${at}`);
  };
  add('requested', ticket.createdAt, ticket.userId, { source: ticket.source ?? 'discord' });
  add('claimed', ticket.claimedAt, ticket.carrierId);
  add('started', ticket.startedAt, ticket.carrierId);
  add('returned', ticket.returnedAt, null);
  add('completed', ticket.completedAt, ticket.completedBy ?? ticket.carrierId);
  add('closed', ticket.closedAt, ticket.closedBy ?? null);
  ticket.timeline.sort((a, b) => new Date(a.at ?? 0) - new Date(b.at ?? 0));
  return ticket.timeline;
}

export function recordCarryProofStep(state, ticket, type, actorId = null, meta = {}) {
  ensureEcosystemState(state);
  ensureCarryTimeline(ticket);
  const step = {
    id: `TL-${Date.now().toString(36).toUpperCase()}-${shortToken(3)}`,
    type: clean(type, 80),
    at: nowIso(),
    actorId: actorId ? clean(actorId, 40) : null,
    meta
  };
  ticket.timeline.push(step);
  appendKingdomLedger(state, `carry.${step.type}`, actorId, ticket.id, { ...meta, proofStepId: step.id });
  return step;
}

export function referralCodeFor(state, userId) {
  const eco = ensureEcosystemState(state);
  const uid = clean(userId, 40);
  if (!uid) throw new Error('Referral code requires a user id.');
  const existing = eco.referrals.codeByUser[uid];
  if (existing) return { code: existing, url: `https://kingdomcarries.com/r/${existing}` };
  let code;
  do code = `K${shortToken(5)}`; while (eco.referrals.codes[code]);
  eco.referrals.codes[code] = { code, ownerId: uid, createdAt: nowIso(), active: true, uses: 0 };
  eco.referrals.codeByUser[uid] = code;
  appendKingdomLedger(state, 'referral.code_created', uid, code, {});
  return { code, url: `https://kingdomcarries.com/r/${code}` };
}

export async function claimReferralCode(guild, claimantId, rawCode) {
  const code = clean(rawCode, 32).toUpperCase();
  if (!code) throw new Error('Referral code is required.');
  return mutateGuildState(guild.id, async (state) => {
    const eco = ensureEcosystemState(state);
    const record = eco.referrals.codes[code];
    if (!record?.active) throw Object.assign(new Error('Referral code was not found.'), { status: 404, code: 'referral_code_not_found' });
    if (record.ownerId === claimantId) throw Object.assign(new Error('You cannot use your own referral code.'), { status: 409, code: 'self_referral' });
    const member = await guild.members.fetch(claimantId).catch(() => null);
    if (!member || member.user.bot) throw Object.assign(new Error('Referral claimant must be a current human member.'), { status: 403, code: 'invalid_referral_member' });
    const existing = Object.values(state.referralsV4.referrals).find((x) => x.targetId === claimantId);
    if (existing) return { existing: true, referral: existing, code };
    const id = `REF-${Date.now().toString(36).toUpperCase()}`;
    const referral = { id, referrerId: record.ownerId, targetId: claimantId, code, status: 'pending', registeredAt: nowIso(), source: 'referral-link' };
    state.referralsV4.referrals[id] = referral;
    eco.referrals.claims[claimantId] = { code, referralId: id, claimedAt: referral.registeredAt };
    record.uses = Number(record.uses ?? 0) + 1;
    emitKingdomRelay(state, 'referral.claimed', claimantId, { referralId: id, referrerId: record.ownerId, code });
    notifyKingdomUser(state, record.ownerId, { type: 'referral', title: 'Referral registered', body: 'A member joined through your referral link. Rewards only qualify after the normal verification and activity rules.', data: { referralId: id } });
    return { existing: false, referral, code };
  });
}

export async function closeMarketplaceListing(guild, actorId, listingId, requestedStatus = 'closed') {
  const status = clean(requestedStatus, 20).toLowerCase();
  if (!MARKET_TERMINAL.has(status)) throw Object.assign(new Error('Listing can only be marked sold, closed or cancelled.'), { status: 400, code: 'invalid_listing_status' });
  return mutateGuildState(guild.id, async (state) => {
    ensureEcosystemState(state);
    const listing = state.marketV4.listings[listingId];
    if (!listing) throw Object.assign(new Error('Marketplace listing not found.'), { status: 404, code: 'listing_not_found' });
    const member = await guild.members.fetch(actorId).catch(() => null);
    const staff = member ? isEcosystemStaff(member, state) : false;
    if (listing.sellerId !== actorId && !staff) throw Object.assign(new Error('Only the seller or staff can close this listing.'), { status: 403, code: 'forbidden' });
    if (listing.status !== 'active') return listing;
    listing.status = status;
    listing.closedAt = nowIso();
    listing.closedBy = actorId;
    state.marketV4.history.push({ id: listing.id, item: listing.item, price: listing.price, sellerId: listing.sellerId, at: listing.closedAt, event: status });
    emitKingdomRelay(state, `market.${status}`, actorId, { listingId, item: listing.item, sellerId: listing.sellerId });
    notifyKingdomUser(state, listing.sellerId, { type: 'market', title: `Listing ${status}`, body: `${listing.item} was marked ${status}.`, data: { listingId } });
    return listing;
  });
}

function publicSearchRecord(type, id, title, subtitle, href, meta = {}) {
  return { type, id, title, subtitle, href, meta };
}

export function searchKingdom(state, query, options = {}) {
  ensureEcosystemState(state);
  const q = clean(query, 120).toLowerCase();
  if (q.length < 2) return [];
  const limit = Math.max(1, Math.min(50, Number(options.limit ?? 20)));
  const rows = [];
  const matches = (...values) => values.filter(Boolean).some((x) => String(x).toLowerCase().includes(q));

  for (const ticket of Object.values(state.carryTickets ?? {})) {
    if (!matches(ticket.id, ticket.dungeon, ticket.difficulty, ticket.mode, ticket.status)) continue;
    rows.push(publicSearchRecord('carry', ticket.id, `${ticket.dungeon} • ${ticket.difficulty}`, `${ticket.mode} • ${ticket.status}`, `/carries/history`, { status: ticket.status }));
  }
  for (const listing of Object.values(state.marketV4?.listings ?? {})) {
    if (!matches(listing.id, listing.item, listing.price, listing.notes)) continue;
    rows.push(publicSearchRecord('market', listing.id, listing.item, listing.price, '/marketplace', { status: listing.status }));
  }
  for (const item of Object.values(state.treasuryV4?.items ?? {})) {
    if (!matches(item.id, item.name, item.notes)) continue;
    rows.push(publicSearchRecord('treasury', item.id, item.name, `${item.available ?? item.quantity ?? 0} available`, '/treasury', {}));
  }
  for (const event of Object.values(state.eventsV4?.events ?? {})) {
    if (!matches(event.id, event.title, event.description)) continue;
    rows.push(publicSearchRecord('event', event.id, event.title || 'Kingdom Event', event.status || 'scheduled', `/events/${encodeURIComponent(event.id)}`, {}));
  }
  for (const [userId, profile] of Object.entries(state.identities ?? {})) {
    if (!matches(profile.kingdomId, profile.discordName, profile.displayName, profile.website?.displayName, profile.website?.roblox?.username)) continue;
    rows.push(publicSearchRecord('identity', profile.kingdomId || userId, profile.website?.displayName || profile.displayName || profile.discordName || `Member ${String(userId).slice(-4)}`, 'Kingdom identity', '/dashboard', { kingdomId: profile.kingdomId ?? null }));
  }
  return rows.slice(0, limit);
}

function trustDimension(label, positive, negative, sample) {
  const score = sample <= 0 ? null : Math.max(0, Math.min(100, Math.round(100 * positive / Math.max(1, positive + negative))));
  return { label, score, sample };
}

export function kingdomTrust(state, userId) {
  ensureEcosystemState(state);
  const profile = state.identities?.[userId] ?? {};
  const carries = Object.values(state.carryTickets ?? {}).filter((x) => (x.members ?? [x.userId]).includes(userId) || x.carrierId === userId);
  const completed = carries.filter((x) => x.status === 'completed').length;
  const noShows = Number(profile.stats?.noShows ?? 0);
  const listings = Object.values(state.marketV4?.listings ?? {}).filter((x) => x.sellerId === userId);
  const sold = listings.filter((x) => x.status === 'sold').length;
  const cancelled = listings.filter((x) => x.status === 'cancelled').length;
  const loans = Object.values(state.treasuryV4?.loans ?? {}).filter((x) => x.borrowerId === userId);
  const overdue = loans.filter((x) => x.overdueAt && x.status === 'loaned').length;
  const returned = loans.filter((x) => ['returned', 'closed'].includes(x.status)).length;
  const dimensions = {
    carryReliability: trustDimension('Carry reliability', completed, noShows, completed + noShows),
    tradeReliability: trustDimension('Trade reliability', sold, cancelled, sold + cancelled),
    assetReliability: trustDimension('Asset reliability', returned, overdue, returned + overdue)
  };
  const scored = Object.values(dimensions).filter((x) => x.score != null);
  const aggregate = scored.length ? Math.round(scored.reduce((sum, x) => sum + x.score, 0) / scored.length) : null;
  return {
    userId,
    kingdomId: profile.kingdomId ?? null,
    aggregate,
    dimensions,
    note: 'Kingdom Trust is limited to recorded service, trade and asset reliability. It is not a general social score.',
    calculatedAt: nowIso()
  };
}

export function createKingdomContract(state, actorId, input = {}) {
  const eco = ensureEcosystemState(state);
  const parties = [...new Set((Array.isArray(input.parties) ? input.parties : []).map((x) => clean(x, 40)).filter(Boolean))];
  if (!parties.length) throw new Error('Contract requires at least one party.');
  const id = `CTR-${Date.now().toString(36).toUpperCase()}-${shortToken(3)}`;
  const contract = {
    id,
    type: clean(input.type || 'internal-accountability', 80),
    title: clean(input.title || 'Kingdom agreement', 160),
    terms: clean(input.terms || '', 3000),
    parties,
    signatures: {},
    status: 'pending',
    createdBy: actorId,
    createdAt: nowIso(),
    expiresAt: input.expiresAt ? clean(input.expiresAt, 64) : null,
    resource: input.resource && typeof input.resource === 'object' ? input.resource : null
  };
  eco.contracts[id] = contract;
  appendKingdomLedger(state, 'contract.created', actorId, id, { type: contract.type, parties });
  for (const party of parties) notifyKingdomUser(state, party, { type: 'contract', title: 'Agreement awaiting acknowledgement', body: contract.title, data: { contractId: id } });
  return contract;
}

export function signKingdomContract(state, userId, contractId) {
  const eco = ensureEcosystemState(state);
  const contract = eco.contracts[contractId];
  if (!contract) throw new Error('Contract not found.');
  if (!contract.parties.includes(userId)) throw new Error('You are not a party to this agreement.');
  if (!['pending', 'active'].includes(contract.status)) throw new Error(`Contract is ${contract.status}.`);
  contract.signatures[userId] = { at: nowIso() };
  if (contract.parties.every((id) => contract.signatures[id])) contract.status = 'active';
  appendKingdomLedger(state, 'contract.acknowledged', userId, contractId, { active: contract.status === 'active' });
  return contract;
}

export function closeKingdomContract(state, actorId, contractId, status = 'completed') {
  const eco = ensureEcosystemState(state);
  const contract = eco.contracts[contractId];
  if (!contract) throw new Error('Contract not found.');
  if (!['completed', 'cancelled', 'expired'].includes(status)) throw new Error('Invalid contract close status.');
  contract.status = status;
  contract.closedAt = nowIso();
  contract.closedBy = actorId;
  appendKingdomLedger(state, `contract.${status}`, actorId, contractId, {});
  return contract;
}

function safeGatewayTarget(target) {
  const text = clean(target, 1000);
  if (text.startsWith('/') && !text.startsWith('//')) return text;
  try {
    const url = new URL(text);
    const allowedHosts = new Set(['kingdomcarries.com', 'www.kingdomcarries.com', 'nexus.kingdomcarries.com', 'core.kingdomcarries.com', 'discord.gg', 'www.roblox.com', 'roblox.com']);
    return url.protocol === 'https:' && allowedHosts.has(url.hostname) ? url.toString() : null;
  } catch {
    return null;
  }
}

export function createGatewayLink(state, actorId, input = {}) {
  const eco = ensureEcosystemState(state);
  const target = safeGatewayTarget(input.target);
  if (!target) throw new Error('Gateway target must be an approved HTTPS Kingdom/Discord/Roblox URL or an internal path.');
  let slug = clean(input.slug, 40).toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (!slug) slug = shortToken(5).toLowerCase();
  if (eco.gateway.links[slug]) throw new Error('Gateway slug is already in use.');
  const record = { slug, target, label: clean(input.label || slug, 120), createdBy: actorId, createdAt: nowIso(), active: true, visits: 0, campaign: clean(input.campaign || '', 100) || null };
  eco.gateway.links[slug] = record;
  appendKingdomLedger(state, 'gateway.link_created', actorId, slug, { target, campaign: record.campaign });
  return { ...record, url: `https://kingdomcarries.com/go/${slug}` };
}

export function resolveGatewayLink(state, slug) {
  const eco = ensureEcosystemState(state);
  const record = eco.gateway.links[clean(slug, 40).toLowerCase()];
  if (!record?.active) return null;
  record.visits = Number(record.visits ?? 0) + 1;
  record.lastVisitedAt = nowIso();
  return { ...record };
}

function realmSnapshotData(state) {
  return {
    setup: state.setup ?? {},
    platform: state.platform ?? {},
    kingdom: state.kingdom ?? {},
    carrierOps: state.carrierOps ?? {},
    treasuryV4: state.treasuryV4 ?? {},
    marketV4: state.marketV4 ?? {},
    referralsV4: state.referralsV4 ?? {},
    eventsV4: state.eventsV4 ?? {},
    securityV4: state.securityV4 ?? {},
    ecosystemV1: {
      network: state.ecosystemV1?.network ?? {},
      extensions: state.ecosystemV1?.extensions ?? {},
      studio: state.ecosystemV1?.studio ?? {},
      factory: state.ecosystemV1?.factory ?? {}
    }
  };
}

export function captureKingdomTimeMachine(state, actorId, label = '') {
  const eco = ensureEcosystemState(state);
  const data = realmSnapshotData(state);
  const id = `TM-${Date.now().toString(36).toUpperCase()}`;
  const snapshot = { id, label: clean(label || 'Realm snapshot', 120), createdAt: nowIso(), createdBy: actorId, digest: hash(data), data };
  eco.timeMachine.snapshots[id] = snapshot;
  const ids = Object.values(eco.timeMachine.snapshots).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)).map((x) => x.id);
  while (ids.length > MAX_SNAPSHOTS) delete eco.timeMachine.snapshots[ids.shift()];
  appendKingdomLedger(state, 'timemachine.snapshot', actorId, id, { digest: snapshot.digest, label: snapshot.label });
  return { id, label: snapshot.label, createdAt: snapshot.createdAt, createdBy: actorId, digest: snapshot.digest };
}

function flatObject(value, prefix = '', out = {}) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    out[prefix || '$'] = JSON.stringify(value);
    return out;
  }
  for (const [key, child] of Object.entries(value)) flatObject(child, prefix ? `${prefix}.${key}` : key, out);
  return out;
}

export function compareKingdomTimeMachine(state, aId, bId) {
  const eco = ensureEcosystemState(state);
  const a = eco.timeMachine.snapshots[aId];
  const b = eco.timeMachine.snapshots[bId];
  if (!a || !b) throw new Error('Both Time Machine snapshots are required.');
  const left = flatObject(a.data);
  const right = flatObject(b.data);
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  const changes = [];
  for (const key of keys) {
    if (left[key] === right[key]) continue;
    changes.push({ path: key, before: left[key] ?? null, after: right[key] ?? null });
    if (changes.length >= 250) break;
  }
  return { from: aId, to: bId, changed: changes.length, changes, truncated: changes.length >= 250 };
}

export function runKingdomLab(state, actorId, scenario = {}) {
  const eco = ensureEcosystemState(state);
  const type = clean(scenario.type || 'carry-surge', 80);
  const active = Object.values(state.carryTickets ?? {}).filter((x) => ACTIVE_CARRY.has(x.status));
  const available = Object.values(state.carrierOps?.profiles ?? {}).filter((x) => x.status === 'available' || x.shiftStartedAt).length;
  let result;
  if (type === 'carry-surge') {
    const addedPlayers = Math.max(0, Math.min(10000, Number(scenario.addedPlayers ?? 100)));
    const currentWaiting = active.filter((x) => x.status === 'open').reduce((sum, x) => sum + Math.max(1, (x.members ?? [x.userId]).filter(Boolean).length), 0);
    const medianRun = median(Object.values(state.carryTickets ?? {}).filter((x) => x.status === 'completed' && x.startedAt && x.completedAt).slice(-250).map((x) => Math.max(1, (new Date(x.completedAt) - new Date(x.startedAt)) / 60000))) ?? 8;
    const carriers = Math.max(1, available);
    result = { type, addedPlayers, projectedWaiting: currentWaiting + addedPlayers, projectedClearMinutes: Math.ceil(((currentWaiting + addedPlayers) / carriers) * medianRun), carriers };
  } else if (type === 'knight-outage') {
    const unavailablePercent = Math.max(0, Math.min(100, Number(scenario.unavailablePercent ?? 50)));
    const remaining = Math.max(0, Math.floor(available * (1 - unavailablePercent / 100)));
    result = { type, unavailablePercent, beforeAvailable: available, afterAvailable: remaining, coverageRisk: remaining === 0 && active.length ? 'critical' : remaining < Math.ceil(active.length / 3) ? 'high' : 'guarded' };
  } else if (type === 'treasury-demand') {
    const requested = Math.max(1, Math.min(10000, Number(scenario.requestedUnits ?? 10)));
    const availableUnits = Object.values(state.treasuryV4?.items ?? {}).reduce((sum, x) => sum + Number(x.available ?? 0), 0);
    result = { type, requestedUnits: requested, availableUnits, shortfall: Math.max(0, requested - availableUnits) };
  } else {
    throw new Error('Unsupported Labs scenario. Use carry-surge, knight-outage or treasury-demand.');
  }
  const run = { id: `LAB-${Date.now().toString(36).toUpperCase()}`, actorId, createdAt: nowIso(), scenario, result };
  appendBounded(eco.labs.runs, run, MAX_LAB_RUNS);
  appendKingdomLedger(state, 'labs.simulation', actorId, run.id, { type });
  return run;
}

export function createStudioSurface(state, actorId, input = {}) {
  const eco = ensureEcosystemState(state);
  const id = clean(input.id, 80) || `SURF-${Date.now().toString(36).toUpperCase()}`;
  const allowedAudience = new Set(['public', 'member', 'carrier', 'staff', 'owner']);
  const surface = {
    id,
    name: clean(input.name || 'Kingdom Surface', 140),
    audience: allowedAudience.has(input.audience) ? input.audience : 'member',
    description: clean(input.description || '', 500),
    widgets: Array.isArray(input.widgets) ? input.widgets.slice(0, 40).map((x) => ({ type: clean(x?.type, 60), source: clean(x?.source, 160), title: clean(x?.title, 120) })) : [],
    createdBy: actorId,
    createdAt: eco.studio.surfaces[id]?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
    status: 'draft'
  };
  eco.studio.surfaces[id] = surface;
  appendKingdomLedger(state, 'studio.surface_saved', actorId, id, { audience: surface.audience, widgetCount: surface.widgets.length });
  return surface;
}

const FACTORY_TEMPLATES = Object.freeze({
  'creator-programme': {
    departments: ['creator'],
    surfaces: [{ name: 'Creator Portal', audience: 'member', widgets: [{ type: 'application', source: 'applications.creator', title: 'Creator Application' }, { type: 'events', source: 'events.creator', title: 'Creator Events' }] }],
    workflows: ['application-review', 'creator-onboarding']
  },
  'service-programme': {
    departments: ['service'],
    surfaces: [{ name: 'Service Portal', audience: 'member', widgets: [{ type: 'queue', source: 'carries.active', title: 'Live Queue' }, { type: 'status', source: 'carriers.coverage', title: 'Coverage' }] }],
    workflows: ['request-triage', 'completion-record']
  },
  'asset-programme': {
    departments: ['treasury'],
    surfaces: [{ name: 'Asset Portal', audience: 'member', widgets: [{ type: 'inventory', source: 'treasury.items', title: 'Available Assets' }, { type: 'requests', source: 'treasury.requests', title: 'My Requests' }] }],
    workflows: ['asset-request', 'treasury-overdue']
  }
});

export function createFactoryProduct(state, actorId, input = {}) {
  const eco = ensureEcosystemState(state);
  const templateId = clean(input.template, 80);
  const template = FACTORY_TEMPLATES[templateId];
  if (!template) throw new Error(`Unknown Factory template. Available: ${Object.keys(FACTORY_TEMPLATES).join(', ')}`);
  const id = `PROD-${Date.now().toString(36).toUpperCase()}`;
  const product = { id, name: clean(input.name || templateId, 140), template: templateId, spec: deepClone(template), createdBy: actorId, createdAt: nowIso(), status: 'draft' };
  eco.factory.products[id] = product;
  for (const [index, surface] of template.surfaces.entries()) createStudioSurface(state, actorId, { id: `${id}-surface-${index + 1}`, ...surface });
  appendKingdomLedger(state, 'factory.product_created', actorId, id, { template: templateId });
  return product;
}

export function setExtensionEnabled(state, actorId, extensionId, enabled) {
  const eco = ensureEcosystemState(state);
  const manifest = eco.extensions.registry[extensionId];
  if (!manifest?.trusted) throw new Error('Only trusted, locally registered extensions can be enabled. Arbitrary remote code is not supported.');
  eco.extensions.installed[extensionId] ??= { installedAt: nowIso(), source: 'core' };
  eco.extensions.installed[extensionId].enabled = Boolean(enabled);
  eco.extensions.installed[extensionId].updatedAt = nowIso();
  appendKingdomLedger(state, 'extension.toggled', actorId, extensionId, { enabled: Boolean(enabled) });
  return { manifest, installation: eco.extensions.installed[extensionId] };
}

export function createExchangeOffer(state, actorId, input = {}) {
  const eco = ensureEcosystemState(state);
  const offer = clean(input.offer, 240);
  const want = clean(input.want, 240);
  if (!offer || !want) throw new Error('Exchange offer requires both HAVE and WANT values.');
  const id = `EX-${Date.now().toString(36).toUpperCase()}-${shortToken(3)}`;
  const record = { id, ownerId: actorId, offer, want, notes: clean(input.notes || '', 500), status: 'active', createdAt: nowIso(), matchedWith: [] };
  eco.exchange.offers[id] = record;
  for (const other of Object.values(eco.exchange.offers)) {
    if (other.id === id || other.status !== 'active' || other.ownerId === actorId) continue;
    const reciprocal = other.offer.toLowerCase().includes(want.toLowerCase()) && record.offer.toLowerCase().includes(other.want.toLowerCase());
    if (!reciprocal) continue;
    record.matchedWith.push(other.id);
    other.matchedWith ??= [];
    if (!other.matchedWith.includes(record.id)) other.matchedWith.push(record.id);
    const match = { id: `XM-${Date.now().toString(36).toUpperCase()}-${shortToken(2)}`, offerA: record.id, offerB: other.id, users: [actorId, other.ownerId], createdAt: nowIso(), status: 'suggested' };
    appendBounded(eco.exchange.matches, match, 1000);
    notifyKingdomUser(state, actorId, { type: 'exchange', title: 'Potential trade match', body: `A reciprocal offer may match ${record.offer} ↔ ${record.want}.`, data: { matchId: match.id, otherOfferId: other.id } });
    notifyKingdomUser(state, other.ownerId, { type: 'exchange', title: 'Potential trade match', body: `A reciprocal offer may match ${other.offer} ↔ ${other.want}.`, data: { matchId: match.id, otherOfferId: record.id } });
  }
  emitKingdomRelay(state, 'exchange.offer_created', actorId, { offerId: id });
  return record;
}

export function closeExchangeOffer(state, actorId, offerId, status = 'closed') {
  const eco = ensureEcosystemState(state);
  const offer = eco.exchange.offers[offerId];
  if (!offer) throw new Error('Exchange offer not found.');
  if (offer.ownerId !== actorId) throw new Error('Only the offer owner can close this exchange offer.');
  if (!['closed', 'completed', 'cancelled'].includes(status)) throw new Error('Invalid exchange status.');
  offer.status = status;
  offer.closedAt = nowIso();
  emitKingdomRelay(state, `exchange.${status}`, actorId, { offerId });
  return offer;
}

export function getKingdomVault(state) {
  ensureEcosystemState(state);
  const items = Object.values(state.treasuryV4?.items ?? {});
  const loans = Object.values(state.treasuryV4?.loans ?? {});
  const activeLoans = loans.filter((x) => x.status === 'loaned');
  return {
    items: items.map((x) => ({ id: x.id, name: x.name, quantity: Number(x.quantity ?? 0), available: Number(x.available ?? 0), custodianId: x.custodianId ?? x.addedBy ?? null, notes: x.notes ?? '' })),
    totals: {
      records: items.length,
      units: items.reduce((sum, x) => sum + Number(x.quantity ?? 0), 0),
      availableUnits: items.reduce((sum, x) => sum + Number(x.available ?? 0), 0),
      activeLoans: activeLoans.length,
      overdueLoans: activeLoans.filter((x) => x.overdueAt).length
    },
    activeLoans
  };
}

function staleMinutes(value, now = Date.now()) {
  const timestamp = new Date(value ?? 0).getTime();
  return Number.isFinite(timestamp) ? Math.max(0, Math.round((now - timestamp) / 60000)) : 0;
}

export function computeKingdomDecisions(state) {
  const eco = ensureEcosystemState(state);
  const recommendations = [];
  const active = Object.values(state.carryTickets ?? {}).filter((x) => ACTIVE_CARRY.has(x.status));
  const waiting = active.filter((x) => x.status === 'open');
  const available = Object.values(state.carrierOps?.profiles ?? {}).filter((x) => x.status === 'available' || x.shiftStartedAt).length;
  if (waiting.length && available === 0) recommendations.push({ key: 'carry-zero-coverage', severity: 'critical', title: 'No Knights available', reason: `${waiting.length} carry request(s) are waiting with zero recorded available Knights.`, action: 'Ask available carriers to go on duty or pause new queue promotion.' });
  else if (waiting.length > available * 4) recommendations.push({ key: 'carry-thin-coverage', severity: 'high', title: 'Carry coverage is thin', reason: `${waiting.length} waiting requests for ${Math.max(1, available)} available Knight(s).`, action: 'Increase carrier coverage before promoting more carries.' });

  const overdue = Object.values(state.treasuryV4?.loans ?? {}).filter((x) => x.status === 'loaned' && x.overdueAt);
  if (overdue.length) recommendations.push({ key: 'treasury-overdue', severity: overdue.some((x) => staleMinutes(x.overdueAt) >= 2880) ? 'high' : 'medium', title: 'Treasury loans need recovery', reason: `${overdue.length} loan(s) are overdue.`, action: 'Use the Forge recovery workflow and review open overdue cases.' });

  const oldTickets = Object.values(state.tickets ?? {}).filter((x) => !['closed', 'resolved'].includes(x.status) && staleMinutes(x.createdAt) >= 60);
  if (oldTickets.length) recommendations.push({ key: 'support-backlog', severity: 'medium', title: 'Support backlog aging', reason: `${oldTickets.length} open case(s) are over one hour old.`, action: 'Rebalance staff ownership and escalate blockers.' });

  const activeListings = Object.values(state.marketV4?.listings ?? {}).filter((x) => x.status === 'active');
  const staleListings = activeListings.filter((x) => staleMinutes(x.createdAt) >= 7 * 1440);
  if (staleListings.length) recommendations.push({ key: 'stale-market', severity: 'low', title: 'Marketplace listings are stale', reason: `${staleListings.length} active listing(s) are older than seven days.`, action: 'Ask sellers to confirm, close or relist stale entries.' });

  const stamped = recommendations.map((x) => ({ ...x, generatedAt: nowIso() }));
  eco.decisions.recommendations = stamped.slice(0, 50);
  return stamped;
}

function openForgeCase(state, loan, custodianId) {
  const existing = Object.values(state.tickets ?? {}).find((x) => x.source === 'kingdom-forge' && x.loanId === loan.id && !['closed', 'resolved'].includes(x.status));
  if (existing) return existing;
  const id = `CASE-${Date.now().toString(36).toUpperCase()}-${shortToken(2)}`;
  const record = {
    id,
    type: 'treasury-overdue',
    status: 'open',
    userId: loan.borrowerId,
    loanId: loan.id,
    ownerId: custodianId ?? null,
    priority: 'high',
    source: 'kingdom-forge',
    summary: `Treasury loan ${loan.id} remains overdue more than 48 hours.`,
    createdAt: nowIso()
  };
  state.tickets[id] = record;
  return record;
}

export async function runKingdomForgeMaintenance(guild) {
  const dmQueue = [];
  let outcome = { overdueDetected: 0, borrowerNotices: 0, custodianAlerts: 0, casesOpened: 0 };
  await mutateGuildState(guild.id, async (state) => {
    const eco = ensureEcosystemState(state);
    const workflow = eco.forge.workflows['treasury-overdue'];
    if (!workflow?.enabled) return;
    const now = Date.now();
    for (const loan of Object.values(state.treasuryV4?.loans ?? {})) {
      if (loan.status !== 'loaned' || !loan.due) continue;
      const due = new Date(loan.due).getTime();
      if (!Number.isFinite(due) || now <= due) continue;
      outcome.overdueDetected++;
      const item = state.treasuryV4.items?.[loan.itemId] ?? {};
      const custodianId = item.custodianId ?? loan.createdBy ?? item.addedBy ?? null;
      if (!loan.overdueAt) {
        loan.overdueAt = nowIso();
        const borrowerNotice = notifyKingdomUser(state, loan.borrowerId, { type: 'treasury', title: 'Treasury loan overdue', body: `${item.name || loan.itemId} was due ${loan.due}. Please arrange its return with Kingdom staff.`, data: { loanId: loan.id } });
        outcome.borrowerNotices++;
        if (borrowerNotice) dmQueue.push({ userId: loan.borrowerId, text: `🏦 **Kingdom Treasury:** ${item.name || loan.itemId} is overdue (loan ${loan.id}). Please arrange its return with Kingdom staff.` });
        if (custodianId && custodianId !== loan.borrowerId) {
          notifyKingdomUser(state, custodianId, { type: 'treasury', title: 'Borrowed asset overdue', body: `${item.name || loan.itemId} loan ${loan.id} is overdue.`, data: { loanId: loan.id, borrowerId: loan.borrowerId } });
          dmQueue.push({ userId: custodianId, text: `🏦 **Treasury alert:** loan ${loan.id} for ${item.name || loan.itemId} is overdue.` });
          outcome.custodianAlerts++;
        }
        emitKingdomRelay(state, 'treasury.loan.overdue', null, { loanId: loan.id, borrowerId: loan.borrowerId, custodianId, due: loan.due });
      }
      const overdueAge = now - new Date(loan.overdueAt).getTime();
      if (overdueAge >= 48 * 60 * 60 * 1000 && !loan.forgeCaseOpenedAt) {
        const caseRecord = openForgeCase(state, loan, custodianId);
        loan.forgeCaseOpenedAt = nowIso();
        loan.forgeCaseId = caseRecord.id;
        outcome.casesOpened++;
        notifyKingdomUser(state, loan.borrowerId, { type: 'treasury', title: 'Treasury recovery case opened', body: `Loan ${loan.id} remains overdue and a staff recovery case has been opened.`, data: { loanId: loan.id, caseId: caseRecord.id } });
        if (custodianId) notifyKingdomUser(state, custodianId, { type: 'treasury', title: 'Treasury recovery case opened', body: `${caseRecord.id} was opened for overdue loan ${loan.id}.`, data: { loanId: loan.id, caseId: caseRecord.id } });
        emitKingdomRelay(state, 'treasury.loan.recovery_case_opened', null, { loanId: loan.id, caseId: caseRecord.id, borrowerId: loan.borrowerId, custodianId });
      }
    }
    eco.forge.history.push({ id: `WF-${Date.now().toString(36).toUpperCase()}`, workflowId: 'treasury-overdue', at: nowIso(), outcome });
    if (eco.forge.history.length > 500) eco.forge.history = eco.forge.history.slice(-500);
    computeKingdomDecisions(state);
  });

  for (const notice of dmQueue) {
    const member = await guild.members.fetch(notice.userId).catch(() => null);
    if (member && !member.user.bot) await member.send({ content: notice.text, allowedMentions: { parse: [] } }).catch(() => null);
  }
  return outcome;
}

export function getIntelligenceContext(guild, state, userId = null) {
  const eco = ensureEcosystemState(state);
  const active = Object.values(state.carryTickets ?? {}).filter((x) => ACTIVE_CARRY.has(x.status));
  const decisions = computeKingdomDecisions(state);
  return {
    generatedAt: nowIso(),
    guild: { id: guild.id, name: guild.name, members: guild.memberCount },
    realm: { stage: state.kingdom?.stage ?? 'Settlement', level: state.kingdom?.level ?? 1, xp: state.kingdom?.xp ?? 0 },
    carries: { active: active.length, waiting: active.filter((x) => x.status === 'open').length, etas: allSmartCarryEtas(state).slice(0, 50) },
    treasury: getKingdomVault(state).totals,
    marketplace: { active: Object.values(state.marketV4?.listings ?? {}).filter((x) => x.status === 'active').length },
    support: { open: Object.values(state.tickets ?? {}).filter((x) => !['closed', 'resolved'].includes(x.status)).length },
    decisions,
    user: userId ? { identity: getKingdomIdCard(state, userId), notificationsUnread: getKingdomNotifications(state, userId, { unreadOnly: true, limit: 100 }).length } : null,
    guardrails: {
      gameplayAutomation: false,
      destructiveActionsRequireHumanApproval: true,
      arbitraryRemoteExtensions: false
    },
    relaySequence: eco.relay.sequence,
    ledgerSequence: eco.ledger.sequence
  };
}

export function getKingdomOs(state) {
  const eco = ensureEcosystemState(state);
  return {
    version: eco.version,
    modules: {
      id: true,
      relay: true,
      ledger: true,
      key: true,
      notifications: true,
      forge: true,
      contracts: true,
      gateway: true,
      timeMachine: true,
      labs: true,
      studio: true,
      factory: true,
      exchange: true,
      vault: true,
      trust: true,
      intelligenceContext: true,
      network: Object.keys(eco.network.peers).length > 0,
      cloud: Boolean(eco.network.tenant.cloudEnabled)
    },
    extensions: Object.entries(eco.extensions.registry).map(([id, manifest]) => ({ ...manifest, enabled: eco.extensions.installed[id]?.enabled !== false })),
    network: { peerCount: Object.keys(eco.network.peers).length, tenant: eco.network.tenant },
    updatedAt: eco.updatedAt
  };
}

export async function getEcosystemMemberPortal(guild, userId) {
  return mutateGuildState(guild.id, async (state) => {
    ensureEcosystemState(state);
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) throw Object.assign(new Error('Member not found in this guild.'), { status: 403, code: 'not_guild_member' });
    const identity = getKingdomIdCard(state, userId);
    const referral = referralCodeFor(state, userId);
    const notifications = getKingdomNotifications(state, userId, { limit: 30 });
    const trust = kingdomTrust(state, userId);
    const contracts = Object.values(state.ecosystemV1.contracts).filter((x) => x.parties.includes(userId));
    return { identity, referral, notifications, trust, contracts, capabilities: capabilitiesForMember(member, state) };
  });
}

export async function initializeEcosystemGuild(guild) {
  return mutateGuildState(guild.id, async (state) => {
    ensureEcosystemState(state);
    for (const member of guild.members.cache.values()) {
      if (member.user.bot) continue;
      ensureKingdomId(state, member.id, { discordUsername: member.user.username });
    }
    const decisions = computeKingdomDecisions(state);
    appendKingdomLedger(state, 'ecosystem.initialized', guild.client.user?.id ?? null, guild.id, { members: guild.memberCount });
    return { version: state.ecosystemV1.version, identities: Object.keys(state.identities ?? {}).length, decisions: decisions.length };
  });
}

export async function readEcosystemState(guildId) {
  const state = await readGuildState(guildId);
  ensureEcosystemState(state);
  return state.ecosystemV1;
}
