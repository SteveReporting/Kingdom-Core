import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits
} from 'discord.js';
import { BRAND, CARRIER_KEYS, STAFF_KEYS } from '../config/blueprint.js';
import { V10_DOMAINS, V10_FEATURE_COUNT } from '../config/approvedSystemsV10.js';
import { mutateGuildState, readGuildState } from '../storage/store.js';

const ACTIVE_CARRY = new Set(['open', 'claimed', 'ready', 'running']);
const REFERRAL_REWARD_XP = 100;

function clean(value, max = 180) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function iso(value) {
  const date = new Date(value ?? 0);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function memberHasAnyRole(member, state, keys) {
  const roles = state.setup?.roles ?? {};
  return keys.some((key) => roles[key] && member.roles.cache.has(roles[key]));
}

function isStaff(member, state) {
  return Boolean(member?.permissions?.has?.(PermissionFlagsBits.Administrator)) || memberHasAnyRole(member, state, STAFF_KEYS);
}

function isCarrier(member, state) {
  return isStaff(member, state) || memberHasAnyRole(member, state, CARRIER_KEYS);
}

function carrierRank(member, state) {
  const roles = state.setup?.roles ?? {};
  const ranks = [
    ['royalChampion', 'Royal Champion'],
    ['knightCaptain', 'Knight Captain'],
    ['royalKnight', 'Royal Knight'],
    ['knight', 'Knight'],
    ['squireCarrier', 'Squire • Carrier Trial']
  ];
  return ranks.find(([key]) => roles[key] && member.roles.cache.has(roles[key]))?.[1] ?? 'Carrier';
}

function houseName(member, state) {
  const roles = state.setup?.roles ?? {};
  const houses = [
    ['houseDrakon', 'House Drakon'],
    ['houseLeonis', 'House Leonis'],
    ['houseAether', 'House Aether'],
    ['houseFenrir', 'House Fenrir']
  ];
  return houses.find(([key]) => roles[key] && member.roles.cache.has(roles[key]))?.[1] ?? null;
}

function activeCarries(state) {
  return Object.values(state.carryTickets ?? {}).filter((ticket) => ACTIVE_CARRY.has(ticket.status));
}

function publicEvent(event) {
  return {
    id: clean(event.id, 80),
    title: clean(event.title, 120) || 'Kingdom Event',
    description: clean(event.description, 1000),
    startsAt: iso(event.startsAt),
    status: clean(event.status, 40) || 'scheduled',
    rsvp: {
      going: Array.isArray(event.rsvp?.going) ? event.rsvp.going.length : 0,
      maybe: Array.isArray(event.rsvp?.maybe) ? event.rsvp.maybe.length : 0,
      no: Array.isArray(event.rsvp?.no) ? event.rsvp.no.length : 0
    },
    teams: Array.isArray(event.teams) ? event.teams.length : 0,
    createdAt: iso(event.createdAt)
  };
}

export function getPublicEvents(state) {
  return Object.values(state.eventsV4?.events ?? {})
    .filter((event) => event.status !== 'cancelled')
    .sort((a, b) => new Date(a.startsAt ?? 0) - new Date(b.startsAt ?? 0))
    .slice(0, 100)
    .map(publicEvent);
}

export function getPublicEvent(state, eventId) {
  const event = state.eventsV4?.events?.[eventId];
  return event && event.status !== 'cancelled' ? publicEvent(event) : null;
}

export function getPublicQuestBoard(state) {
  const mapQuest = (quest, scope) => ({
    id: clean(quest.id, 120),
    name: clean(quest.name, 120),
    description: clean(quest.description, 500),
    target: Math.max(0, number(quest.target)),
    rewardXp: Math.max(0, number(quest.rewardXp)),
    scope,
    progress: scope === 'community' ? Math.max(0, number(quest.progress)) : null,
    completedAt: scope === 'community' ? iso(quest.completedAt) : null
  });
  return {
    generatedAt: clean(state.questsV4?.generatedAt, 40) || null,
    daily: (state.questsV4?.daily ?? []).map((quest) => mapQuest(quest, 'daily')),
    weekly: (state.questsV4?.weekly ?? []).map((quest) => mapQuest(quest, 'weekly')),
    community: (state.questsV4?.community ?? []).map((quest) => mapQuest(quest, 'community'))
  };
}

function questProgressFor(state, userId, quest) {
  const value = state.questsV4?.progress?.[userId]?.[quest.id];
  return Math.max(0, number(value));
}

export function getMemberQuestBoard(state, userId) {
  const board = getPublicQuestBoard(state);
  const completed = state.questsV4?.completed?.[userId] ?? {};
  const decorate = (quest) => ({
    ...quest,
    progress: quest.scope === 'community' ? quest.progress : questProgressFor(state, userId, quest),
    completed: quest.scope === 'community' ? Boolean(quest.completedAt) : Boolean(completed?.[quest.id]),
    completedAt: quest.scope === 'community' ? quest.completedAt : iso(completed?.[quest.id]?.completedAt ?? completed?.[quest.id])
  });
  return {
    ...board,
    daily: board.daily.map(decorate),
    weekly: board.weekly.map(decorate),
    community: board.community.map(decorate)
  };
}

export function getMemberAchievements(state, userId) {
  const identity = state.identities?.[userId] ?? {};
  return {
    achievements: [...new Set((identity.achievements ?? []).map((value) => clean(value, 120)).filter(Boolean))].slice(-100),
    titles: [...new Set((identity.titles ?? []).map((value) => clean(value, 120)).filter(Boolean))].slice(-50),
    kingdomXp: Math.max(0, number(identity.kingdomXp)),
    prestige: Math.max(0, number(identity.prestige)),
    stats: {
      carriesReceived: Math.max(0, number(identity.stats?.carriesReceived)),
      carriesCompleted: Math.max(0, number(identity.stats?.carriesCompleted)),
      noShows: Math.max(0, number(identity.stats?.noShows)),
      events: Math.max(0, number(identity.stats?.events)),
      quests: Math.max(0, number(identity.stats?.quests)),
      trades: Math.max(0, number(identity.stats?.trades))
    }
  };
}

export async function getPublicCarriers(guild, state) {
  const rows = Object.values(state.carrierOps?.profiles ?? {}).slice(0, 250);
  const resolved = await Promise.all(rows.map(async (profile) => {
    const member = await guild.members.fetch(profile.userId).catch(() => null);
    if (!member || member.user.bot || !isCarrier(member, state)) return null;
    const commendations = Object.values(profile.commendations ?? {}).reduce((sum, value) => sum + number(value), 0);
    const certifications = state.carrierOps?.certifications?.[profile.userId] ?? [];
    return {
      username: member.user.username,
      displayName: member.displayName,
      avatarUrl: member.displayAvatarURL({ extension: 'png', size: 128 }),
      rank: carrierRank(member, state),
      status: clean(profile.status, 40) || 'off',
      completedRuns: Math.max(0, number(profile.completedRuns)),
      playersHelped: Math.max(0, number(profile.playersHelped)),
      serviceMinutes: Math.max(0, number(profile.serviceMinutes)),
      reputation: Math.max(0, Math.min(100, number(profile.reputation?.score, 100))),
      commendations,
      certifications: Array.isArray(certifications) ? certifications.map((value) => clean(value, 100)).filter(Boolean).slice(0, 20) : [],
      house: houseName(member, state)
    };
  }));
  return resolved.filter(Boolean).sort((a, b) => {
    const dutyA = ['available', 'busy'].includes(a.status) ? 1 : 0;
    const dutyB = ['available', 'busy'].includes(b.status) ? 1 : 0;
    return dutyB - dutyA || b.playersHelped - a.playersHelped || a.displayName.localeCompare(b.displayName);
  });
}

export function getPublicApplications(state) {
  const forms = [
    ['staff', 'Royal Staff', process.env.STAFF_APPLICATION_URL],
    ['carrier', 'Knight / Carrier', process.env.CARRIER_APPLICATION_URL],
    ['creator', 'Creator', process.env.CREATOR_APPLICATION_URL]
  ].map(([type, label, url]) => ({
    type,
    label,
    open: /^https:\/\//i.test(String(url ?? '')),
    url: /^https:\/\//i.test(String(url ?? '')) ? String(url) : null
  }));
  const applications = Object.values(state.applications ?? {});
  const counts = { pending: 0, interview: 0, accepted: 0, denied: 0 };
  for (const application of applications) {
    const key = String(application.status ?? 'pending').toLowerCase();
    if (key in counts) counts[key]++;
  }
  return {
    forms,
    counts,
    total: applications.length,
    workflow: 'Kingdom Core Application OS'
  };
}

export function getPublicTreasury(state) {
  const items = Object.values(state.treasuryV4?.items ?? {}).slice(0, 200).map((item) => ({
    id: clean(item.id, 80),
    name: clean(item.name, 160) || 'Treasury Asset',
    quantity: Math.max(0, number(item.quantity, 1)),
    available: Math.max(0, number(item.available, item.quantity ?? 1)),
    notes: clean(item.notes, 240)
  }));
  const activeLoans = Object.values(state.treasuryV4?.loans ?? {}).filter((loan) => loan.status === 'loaned').length;
  const pendingRequests = Object.values(state.treasuryV4?.requests ?? {}).filter((request) => request.status === 'pending').length;
  return {
    items,
    totals: {
      itemTypes: items.length,
      units: items.reduce((sum, item) => sum + item.quantity, 0),
      availableUnits: items.reduce((sum, item) => sum + item.available, 0),
      activeLoans,
      pendingRequests,
      ledgerEvents: (state.treasuryV4?.history ?? []).length
    }
  };
}

export function getPublicSystems(state) {
  const domains = V10_DOMAINS.map((domain) => ({
    key: domain.key,
    label: domain.label,
    engine: domain.engine,
    start: domain.start,
    end: domain.end,
    approvedSystems: domain.end - domain.start + 1 - (domain.start <= 385 && domain.end >= 385 ? 1 : 0),
    enabled: state.platform?.v10?.domains?.[domain.key]?.enabled ?? domain.key !== 'ai',
    capabilities: [...domain.capabilities]
  }));
  const featureFlags = Object.entries(state.platform?.featureFlags ?? {});
  return {
    schemaVersion: state.platform?.schemaVersion ?? null,
    release: clean(state.platform?.release, 80) || null,
    approvedSystems: V10_FEATURE_COUNT,
    enabledDomains: domains.filter((domain) => domain.enabled).length,
    disabledDomains: domains.filter((domain) => !domain.enabled).map((domain) => domain.key),
    featureFlags: {
      total: featureFlags.length,
      enabled: featureFlags.filter(([, enabled]) => Boolean(enabled)).length
    },
    domains
  };
}

export async function getMemberPortal(guild, state, userId) {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) {
    const error = new Error('This Discord account is not in the Kingdom Carries server.');
    error.code = 'not_guild_member';
    error.status = 403;
    throw error;
  }
  const carrier = state.carrierOps?.profiles?.[userId] ?? null;
  const assigned = Object.values(state.carryTickets ?? {})
    .filter((ticket) => ticket.carrierId === userId && ACTIVE_CARRY.has(ticket.status))
    .map((ticket) => ({
      id: clean(ticket.id, 80),
      dungeon: clean(ticket.dungeon, 80),
      difficulty: clean(ticket.difficulty, 40),
      mode: clean(ticket.mode, 40),
      status: clean(ticket.status, 40),
      partySize: [...new Set((ticket.members ?? [ticket.userId]).filter(Boolean))].length,
      createdAt: iso(ticket.createdAt)
    }));
  const referrals = Object.values(state.referralsV4?.referrals ?? {}).filter((ref) => ref.referrerId === userId);
  const treasury = Object.values(state.treasuryV4?.requests ?? {}).filter((request) => request.userId === userId);
  return {
    access: {
      owner: guild.ownerId === userId,
      staff: isStaff(member, state),
      carrier: isCarrier(member, state),
      rank: isCarrier(member, state) ? carrierRank(member, state) : null,
      house: houseName(member, state)
    },
    quests: getMemberQuestBoard(state, userId),
    achievements: getMemberAchievements(state, userId),
    referrals: {
      total: referrals.length,
      qualified: referrals.filter((ref) => ref.status === 'qualified').length,
      pending: referrals.filter((ref) => ref.status === 'pending').length,
      rewardXpPerQualified: REFERRAL_REWARD_XP,
      rows: referrals.slice(-100).reverse().map((ref) => ({
        id: clean(ref.id, 80),
        target: `Member ••••${clean(ref.targetId, 32).slice(-4)}`,
        status: clean(ref.status, 40) || 'pending',
        createdAt: iso(ref.createdAt),
        qualifiedAt: iso(ref.qualifiedAt)
      }))
    },
    treasury: {
      requests: treasury.slice(-100).reverse().map((request) => ({
        id: clean(request.id, 80),
        item: clean(request.item, 160),
        reason: clean(request.reason, 500),
        status: clean(request.status, 40) || 'pending',
        createdAt: iso(request.createdAt),
        reviewedAt: iso(request.reviewedAt)
      }))
    },
    carrier: carrier && isCarrier(member, state) ? {
      status: clean(carrier.status, 40) || 'off',
      completedRuns: Math.max(0, number(carrier.completedRuns)),
      playersHelped: Math.max(0, number(carrier.playersHelped)),
      serviceMinutes: Math.max(0, number(carrier.serviceMinutes)),
      reputation: Math.max(0, Math.min(100, number(carrier.reputation?.score, 100))),
      workload: Math.max(0, Math.min(100, number(carrier.workload))),
      assigned
    } : null
  };
}

export async function getStaffPortal(guild, state, userId) {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member || !isStaff(member, state)) {
    const error = new Error('Kingdom staff access is required.');
    error.code = 'staff_required';
    error.status = 403;
    throw error;
  }
  const carries = activeCarries(state);
  const tickets = Object.values(state.tickets ?? {});
  const apps = Object.values(state.applications ?? {});
  return {
    access: { owner: guild.ownerId === userId, staff: true },
    carries: {
      waiting: carries.filter((ticket) => ticket.status === 'open').length,
      forming: carries.filter((ticket) => ['claimed', 'ready'].includes(ticket.status)).length,
      running: carries.filter((ticket) => ticket.status === 'running').length
    },
    tickets: {
      open: tickets.filter((ticket) => !['closed', 'resolved'].includes(ticket.status)).length,
      total: tickets.length,
      escalated: Object.keys(state.ticketMetricsV4?.escalations ?? {}).length
    },
    applications: {
      pending: apps.filter((app) => String(app.status ?? '').toLowerCase() === 'pending').length,
      interview: apps.filter((app) => String(app.status ?? '').toLowerCase() === 'interview').length,
      total: apps.length
    },
    treasury: {
      pending: Object.values(state.treasuryV4?.requests ?? {}).filter((request) => request.status === 'pending').length,
      activeLoans: Object.values(state.treasuryV4?.loans ?? {}).filter((loan) => loan.status === 'loaned').length
    },
    security: {
      state: clean(state.securityV4?.state, 40) || 'NORMAL',
      riskScore: Math.max(0, Math.min(100, number(state.securityV4?.riskScore))),
      driftFindings: (state.securityV4?.drift ?? []).length
    },
    system: {
      release: clean(state.platform?.release, 80),
      schemaVersion: state.platform?.schemaVersion ?? null,
      lastMaintenanceAt: iso(state.systemV4?.lastMaintenanceAt)
    }
  };
}

function eventEmbed(event) {
  return new EmbedBuilder()
    .setColor(BRAND.color)
    .setTitle(`🎪 ${clean(event.title, 120) || 'Kingdom Event'}`)
    .setDescription(clean(event.description, 1000) || 'Kingdom event')
    .addFields(
      { name: 'Starts', value: event.startsAt ? `<t:${Math.floor(new Date(event.startsAt).getTime() / 1000)}:F>` : 'TBA', inline: true },
      { name: 'Going', value: `✅ **${event.rsvp?.going?.length ?? 0}**`, inline: true },
      { name: 'Maybe', value: `❔ **${event.rsvp?.maybe?.length ?? 0}**`, inline: true }
    )
    .setFooter({ text: BRAND.footer })
    .setTimestamp();
}

function eventButtons(event) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`kc4c:event:rsvp:${event.id}:going`).setLabel('Attending').setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`kc4c:event:rsvp:${event.id}:maybe`).setLabel('Maybe').setEmoji('❔').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`kc4c:event:rsvp:${event.id}:no`).setLabel("Can't Attend").setEmoji('❌').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`kc4c:event:teams:${event.id}`).setLabel('Build Teams').setEmoji('👥').setStyle(ButtonStyle.Primary)
  )];
}

async function syncEvent(guild, event) {
  const channel = guild.channels.cache.get(event.channelId);
  if (!channel?.isTextBased() || !event.messageId) return;
  const message = await channel.messages.fetch(event.messageId).catch(() => null);
  if (message) await message.edit({ embeds: [eventEmbed(event)], components: eventButtons(event), allowedMentions: { parse: [] } }).catch(() => null);
}

export async function setWebsiteEventRsvp(guild, userId, eventId, response) {
  if (!['going', 'maybe', 'no'].includes(response)) {
    const error = new Error('Choose going, maybe or no.');
    error.code = 'invalid_rsvp';
    error.status = 400;
    throw error;
  }
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member || member.user.bot) {
    const error = new Error('Join Kingdom Carries before responding to events.');
    error.code = 'not_guild_member';
    error.status = 403;
    throw error;
  }
  let updated = null;
  await mutateGuildState(guild.id, async (state) => {
    const event = state.eventsV4?.events?.[eventId];
    if (!event || event.status === 'cancelled') return;
    event.rsvp ??= { going: [], maybe: [], no: [] };
    for (const key of ['going', 'maybe', 'no']) {
      event.rsvp[key] = (event.rsvp[key] ?? []).filter((id) => id !== userId);
    }
    event.rsvp[response].push(userId);
    event.updatedAt = new Date().toISOString();
    state.eventsV4.attendance ??= {};
    state.eventsV4.attendance[eventId] ??= {};
    state.eventsV4.attendance[eventId][userId] = { response, at: event.updatedAt, source: 'website' };
    updated = { ...event, rsvp: { ...event.rsvp } };
  });
  if (!updated) {
    const error = new Error('That event does not exist.');
    error.code = 'event_not_found';
    error.status = 404;
    throw error;
  }
  await syncEvent(guild, updated);
  return publicEvent(updated);
}

export async function registerWebsiteReferral(guild, userId, targetIdInput) {
  const targetId = String(targetIdInput ?? '').replace(/\D/g, '').slice(0, 32);
  if (!targetId || targetId === userId) {
    const error = new Error('Enter a valid different Discord member ID.');
    error.code = 'invalid_referral';
    error.status = 400;
    throw error;
  }
  const [referrer, target] = await Promise.all([
    guild.members.fetch(userId).catch(() => null),
    guild.members.fetch(targetId).catch(() => null)
  ]);
  if (!referrer || !target || target.user.bot) {
    const error = new Error('Both accounts must be human members of Kingdom Carries.');
    error.code = 'invalid_referral';
    error.status = 400;
    throw error;
  }
  const id = `REF-${Date.now().toString(36).toUpperCase()}`;
  let duplicate = false;
  await mutateGuildState(guild.id, async (state) => {
    state.referralsV4 ??= { referrals: {}, qualified: {} };
    state.referralsV4.referrals ??= {};
    state.referralsV4.qualified ??= {};
    duplicate = Object.values(state.referralsV4.referrals).some((ref) => ref.targetId === targetId);
    if (duplicate) return;
    state.referralsV4.referrals[id] = {
      id,
      referrerId: userId,
      targetId,
      status: 'pending',
      source: 'website',
      createdAt: new Date().toISOString()
    };
  });
  if (duplicate) {
    const error = new Error('That member is already registered as a referral.');
    error.code = 'referral_exists';
    error.status = 409;
    throw error;
  }
  return { id, status: 'pending', target: `Member ••••${targetId.slice(-4)}` };
}

export async function submitWebsiteTreasuryRequest(guild, userId, input = {}) {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) {
    const error = new Error('Join Kingdom Carries before requesting Treasury gear.');
    error.code = 'not_guild_member';
    error.status = 403;
    throw error;
  }
  const item = clean(input.item, 120);
  const reason = clean(input.reason, 600);
  if (!item || !reason) {
    const error = new Error('Item and reason are required.');
    error.code = 'invalid_treasury_request';
    error.status = 400;
    throw error;
  }
  const id = `TR-${Date.now().toString(36).toUpperCase()}`;
  let reviewChannelId = null;
  await mutateGuildState(guild.id, async (state) => {
    state.treasuryV4 ??= { requests: {}, history: [] };
    state.treasuryV4.requests ??= {};
    state.treasuryV4.history ??= [];
    state.treasuryV4.requests[id] = { id, userId, item, reason, status: 'pending', source: 'website', createdAt: new Date().toISOString() };
    state.treasuryV4.history.push({ type: 'request-created', requestId: id, userId, source: 'website', at: new Date().toISOString() });
    reviewChannelId = state.setup?.channels?.treasuryRequestsV4;
  });
  const channel = guild.channels.cache.get(reviewChannelId);
  if (channel?.isTextBased()) {
    await channel.send({
      embeds: [new EmbedBuilder()
        .setColor(BRAND.color)
        .setTitle(`🏦 Treasury Request • ${id}`)
        .setDescription(`**${item}**\n> ${reason}`)
        .addFields({ name: 'Requester', value: `<@${userId}>` }, { name: 'Source', value: 'Website', inline: true })
        .setFooter({ text: BRAND.footer })
        .setTimestamp()],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`kc4:treasury:decision:${id}:approved`).setLabel('Approve').setEmoji('✅').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`kc4:treasury:decision:${id}:denied`).setLabel('Deny').setEmoji('❌').setStyle(ButtonStyle.Danger)
      )],
      allowedMentions: { parse: [] }
    }).catch(() => null);
  }
  return { id, item, reason, status: 'pending', createdAt: new Date().toISOString() };
}

export async function createWebsiteMarketListing(guild, userId, input = {}) {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) {
    const error = new Error('Join Kingdom Carries before publishing a listing.');
    error.code = 'not_guild_member';
    error.status = 403;
    throw error;
  }
  const item = clean(input.item, 120);
  const price = clean(input.price, 80);
  const notes = clean(input.notes, 180);
  if (!item || !price) {
    const error = new Error('Item and price/trade are required.');
    error.code = 'invalid_listing';
    error.status = 400;
    throw error;
  }
  const id = `MK-${Date.now().toString(36).toUpperCase()}`;
  let channelId = null;
  const createdAt = new Date().toISOString();
  await mutateGuildState(guild.id, async (state) => {
    state.marketV4 ??= { listings: {}, history: [] };
    state.marketV4.listings ??= {};
    state.marketV4.history ??= [];
    state.marketV4.listings[id] = { id, sellerId: userId, item, price, notes, status: 'active', source: 'website', createdAt };
    state.marketV4.history.push({ id, item, price, sellerId: userId, source: 'website', at: createdAt, event: 'listed' });
    state.identities ??= {};
    state.identities[userId] ??= { userId, kingdomXp: 0, stats: {}, achievements: [], titles: [] };
    state.identities[userId].stats ??= {};
    state.identities[userId].stats.trades = (state.identities[userId].stats.trades ?? 0) + 1;
    channelId = state.setup?.channels?.marketplaceV4 ?? state.setup?.channels?.marketplace;
  });
  const channel = guild.channels.cache.get(channelId);
  if (channel?.isTextBased()) {
    await channel.send({
      embeds: [new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle(`🏪 Marketplace Listing • ${id}`)
        .setDescription(`**${item}**\nPrice / Trade: **${price}**${notes ? `\n> ${notes}` : ''}`)
        .addFields({ name: 'Seller', value: `<@${userId}>` }, { name: 'Source', value: 'Website', inline: true })
        .setFooter({ text: BRAND.footer })
        .setTimestamp()],
      allowedMentions: { parse: [] }
    }).catch(() => null);
  }
  return { id, item, price, notes, status: 'active', createdAt };
}

export async function readPortalState(guild) {
  return readGuildState(guild.id);
}
