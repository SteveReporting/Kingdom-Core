import {
  ActionRowBuilder,
  ButtonStyle,
  ChannelType,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';
import { BRAND, CARRIER_KEYS, ROLE_BLUEPRINT, STAFF_KEYS } from '../config/blueprint.js';
import { LEVEL_TIERS } from './levelRoles.js';
import { mutateGuildState, readGuildState, writeGuildState } from '../storage/store.js';
import { refreshPartyPanels } from './carryPartiesV3.js';
import { auditDigitalTwin, captureDigitalTwin, repairDigitalTwin } from './securityV4.js';
import {
  KC4_COLORS,
  bar,
  button,
  compactNumber,
  duration,
  empty,
  metric,
  panel,
  rankMedal,
  row,
  select,
  stateBadge,
  statusDot,
  timestamp
} from '../ui/kingdomV4Ui.js';

const ALL_ROLE_KEYS = ROLE_BLUEPRINT.map((x) => x.key);
const ACTIVE_CARRY = new Set(['open', 'claimed', 'ready', 'running']);
const DONE_TICKET = new Set(['closed', 'resolved']);
const eph = (content) => ({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });

function isStaff(member, state) {
  if (member?.permissions?.has?.(PermissionFlagsBits.Administrator)) return true;
  return STAFF_KEYS.some((key) => state.setup?.roles?.[key] && member.roles.cache.has(state.setup.roles[key]));
}

function isCarrier(member, state) {
  if (isStaff(member, state)) return true;
  return CARRIER_KEYS.some((key) => state.setup?.roles?.[key] && member.roles.cache.has(state.setup.roles[key]));
}

function roleOverwrites(guild, state, access) {
  const rows = [];
  const everyone = guild.roles.everyone.id;
  if (access === 'public') {
    rows.push({ id: everyone, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.SendMessages] });
  } else {
    rows.push({ id: everyone, allow: [PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
  }
  const allowedKeys = access === 'staff' ? new Set(STAFF_KEYS) : access === 'carrier' ? new Set([...STAFF_KEYS, ...CARRIER_KEYS]) : null;
  for (const key of ALL_ROLE_KEYS) {
    const id = state.setup?.roles?.[key];
    if (!id) continue;
    if (access === 'public') {
      rows.push({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.SendMessages] });
    } else if (allowedKeys.has(key)) {
      rows.push({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages] });
    } else {
      rows.push({ id, allow: [PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
    }
  }
  return rows;
}

async function ensureChannel(guild, state, key, name, parentId, access) {
  state.setup ??= {};
  state.setup.channels ??= {};
  let channel = guild.channels.cache.get(state.setup.channels[key]);
  if (!channel || channel.type !== ChannelType.GuildText) channel = guild.channels.cache.find((c) => c.type === ChannelType.GuildText && c.name === name);
  let created = false;
  if (!channel) {
    channel = await guild.channels.create({
      name,
      type: ChannelType.GuildText,
      parent: parentId,
      permissionOverwrites: roleOverwrites(guild, state, access),
      reason: 'Kingdom Core v4 complete platform surface'
    });
    created = true;
  } else {
    if (parentId && channel.parentId !== parentId) await channel.setParent(parentId, { lockPermissions: false }).catch(() => null);
    await channel.permissionOverwrites.set(roleOverwrites(guild, state, access), 'Kingdom Core v4 premium permissions').catch(() => null);
  }
  state.setup.channels[key] = channel.id;
  return { channel, created };
}

async function upsertPinned(channel, state, key, payload) {
  state.setup ??= {};
  state.setup.panels ??= {};
  let message = state.setup.panels[key] ? await channel.messages.fetch(state.setup.panels[key]).catch(() => null) : null;
  if (message) await message.edit(payload).catch(() => null);
  else {
    message = await channel.send(payload);
    state.setup.panels[key] = message.id;
  }
  if (!message.pinned) await message.pin('Kingdom Core v4 premium control surface').catch(() => null);
  return message;
}

function ensureState(state) {
  state.platform ??= {};
  state.platform.schemaVersion = Math.max(4, state.platform.schemaVersion ?? 0);
  state.platform.release = '4.2-complete';
  state.platform.migrations ??= [];
  if (!state.platform.migrations.includes('v4-approved-systems-complete')) state.platform.migrations.push('v4-approved-systems-complete');
  state.platform.auditLedger ??= [];
  state.platform.integrationTests ??= [];
  state.platform.permissionTests ??= [];
  state.platform.workflows ??= [
    { id: 'wf-carry-complete', event: 'carry.completed', actions: ['member-xp', 'carrier-service', 'kingdom-xp', 'analytics'], enabled: true },
    { id: 'wf-referral-quality', event: 'maintenance', actions: ['qualify-referrals'], enabled: true },
    { id: 'wf-market-watch', event: 'market.listed', actions: ['watchlist-notify'], enabled: true },
    { id: 'wf-security-drift', event: 'maintenance', actions: ['audit-digital-twin'], enabled: true },
    { id: 'wf-quest-progress', event: 'carry.completed', actions: ['quest-progress'], enabled: true }
  ];

  state.carrierOps ??= {};
  state.carrierOps.profiles ??= {};
  state.carrierOps.skillMatrix ??= {};
  state.carrierOps.academy ??= {};
  state.carrierOps.certifications ??= {};
  state.carrierOps.recovery ??= [];

  state.applicationMetricsV4 ??= {};
  state.applicationMetricsV4.scores ??= [];
  state.applicationMetricsV4.workflow ??= {};

  state.ticketMetricsV4 ??= {};
  state.ticketMetricsV4.claimed ??= {};
  state.ticketMetricsV4.firstResponse ??= {};
  state.ticketMetricsV4.escalations ??= {};
  state.ticketMetricsV4.summaries ??= {};

  state.treasuryV4 ??= {};
  state.treasuryV4.items ??= {};
  state.treasuryV4.loans ??= {};
  state.treasuryV4.requests ??= {};
  state.treasuryV4.history ??= [];

  state.marketV4 ??= {};
  state.marketV4.listings ??= {};
  state.marketV4.history ??= [];
  state.marketV4.watchlists ??= {};
  state.marketV4.notified ??= {};
  state.marketV4.priceIndex ??= {};

  state.referralsV4 ??= {};
  state.referralsV4.referrals ??= {};
  state.referralsV4.qualified ??= {};

  state.analyticsV4 ??= {};
  state.analyticsV4.events ??= [];
  state.analyticsV4.retention ??= {};
  state.analyticsV4.coverage ??= {};
  state.analyticsV4.public ??= {};

  state.verificationV4 ??= {};
  state.stagingV4 ??= { configured: Boolean(process.env.STAGING_GUILD_ID), guildId: process.env.STAGING_GUILD_ID ?? null };
}

function ledger(state, action, actorId = null, targetId = null, details = {}) {
  state.platform.auditLedger ??= [];
  state.platform.auditLedger.push({ id: `AUD-${Date.now().toString(36).toUpperCase()}`, at: new Date().toISOString(), action, actorId, targetId, details });
  if (state.platform.auditLedger.length > 3000) state.platform.auditLedger = state.platform.auditLedger.slice(-3000);
}

function activeCarries(state) {
  return Object.values(state.carryTickets ?? {}).filter((t) => ACTIVE_CARRY.has(t.status));
}

function membersOf(ticket) {
  return [...new Set((ticket.members ?? [ticket.userId]).filter(Boolean))];
}

function carrySummary(state) {
  const active = activeCarries(state);
  const waiting = active.filter((t) => t.status === 'open');
  const running = active.filter((t) => t.status === 'running');
  const forming = active.filter((t) => ['claimed', 'ready'].includes(t.status));
  const peopleWaiting = waiting.reduce((sum, t) => sum + membersOf(t).length, 0);
  const allForecast = Object.values(state.analyticsV4?.forecasts ?? {});
  const eta = allForecast.length ? Math.max(1, Math.round(allForecast.reduce((s, x) => s + (x.estimatedWaitMinutes ?? 0), 0) / allForecast.length)) : 1;
  return { active, waiting, running, forming, peopleWaiting, eta };
}

function carrierCoverage(state) {
  const profiles = Object.values(state.carrierOps?.profiles ?? {});
  const available = profiles.filter((p) => p.status === 'available');
  const busy = profiles.filter((p) => p.status === 'busy');
  const c = carrySummary(state);
  const required = Math.max(1, Math.ceil(c.peopleWaiting / 6));
  const deficit = Math.max(0, required - available.length);
  const status = deficit >= 5 ? 'CRITICAL' : deficit >= 2 ? 'THIN' : deficit === 1 ? 'WATCH' : 'COVERED';
  return { available, busy, required, deficit, status };
}

function topDemand(state, limit = 5) {
  return Object.entries(state.analyticsV4?.forecasts ?? {})
    .sort((a, b) => (b[1].waiting ?? b[1].requests ?? 0) - (a[1].waiting ?? a[1].requests ?? 0))
    .slice(0, limit);
}

function houseTable(state) {
  return Object.values(state.kingdom?.houses ?? {}).sort((a, b) => (b.xp ?? 0) - (a.xp ?? 0));
}

function publicOperationsPayload(guild, state) {
  const c = carrySummary(state);
  const coverage = carrierCoverage(state);
  const demand = topDemand(state, 4);
  const houses = houseTable(state);
  const kingdomXp = state.kingdom?.xp ?? 0;
  const stageTargets = { Settlement: 1000, Village: 5000, Fort: 15000, Keep: 40000, Castle: 100000, Kingdom: 250000, 'Great Kingdom': 600000, Empire: 600000 };
  const target = stageTargets[state.kingdom?.stage ?? 'Settlement'] ?? 1000;
  const demandText = demand.length ? demand.map(([name, d], i) => `${rankMedal(i)} **${name}** • ${d.waiting ?? 0} waiting • ~${d.estimatedWaitMinutes ?? 1}m`).join('\n') : empty('No active carry demand.');
  return {
    embeds: [panel('🌐 KINGDOM LIVE • Public Operations', 'A live view of the Realm: carries, Kingdom progression, House competition and service coverage.', KC4_COLORS.royal)
      .addFields(
        metric('⚔️ Waiting', compactNumber(c.peopleWaiting), `${c.waiting.length} forming requests`),
        metric('▶️ Running', compactNumber(c.running.length), `${c.forming.length} preparing`),
        metric('⏱️ Queue ETA', `~${c.eta}m`, 'live estimate'),
        metric('🏰 Kingdom', state.kingdom?.stage ?? 'Settlement', `Level ${state.kingdom?.level ?? 1}`),
        metric('🛡️ Knights Ready', coverage.available.length, coverage.deficit ? `${coverage.deficit} coverage deficit` : 'coverage healthy'),
        metric('👥 Members', compactNumber(guild.memberCount), 'live Discord count'),
        { name: '📊 LIVE DEMAND', value: demandText },
        { name: '🏰 REALM PROGRESS', value: `${bar(kingdomXp, target, 14)}  **${compactNumber(kingdomXp)} XP**\n${houses[0] ? `Leading House: **${houses[0].name}** • ${compactNumber(houses[0].xp)} XP` : 'House season has not started.'}` }
      )],
    components: [row(
      button('kc4x:public:refresh', 'Refresh Live', '🔄', ButtonStyle.Primary),
      button('kc4x:member:dashboard', 'My Dashboard', '🪪', ButtonStyle.Secondary),
      button('kc4x:public:demand', 'Demand Map', '📊', ButtonStyle.Secondary)
    )],
    allowedMentions: { parse: [] }
  };
}

function memberHubPayload(state) {
  return {
    embeds: [panel('🪪 MEMBER COMMAND • Your Kingdom', 'Your personal launchpad for progression, carries, quests, referrals, mentors and notifications.', KC4_COLORS.royal)
      .addFields(
        metric('🏰 Realm', state.kingdom?.stage ?? 'Settlement', `Kingdom Lv ${state.kingdom?.level ?? 1}`),
        metric('📜 Quests', (state.questsV4?.daily?.length ?? 0) + (state.questsV4?.weekly?.length ?? 0), 'live objectives'),
        metric('🧭 Mentors', Object.keys(state.mentorsV4?.mentors ?? {}).length, 'registered'),
        { name: 'HOW TO USE THIS', value: 'Open your profile, check quests, register a quality referral or jump into the Mentor/Notification systems. Kingdom Core keeps these tied to one identity.' }
      )],
    components: [
      row(
        button('kc4:profile:self', 'My Identity', '🪪', ButtonStyle.Primary),
        button('kc4:quests:mine', 'My Quests', '📜', ButtonStyle.Secondary),
        button('kc4x:referral:new', 'Register Referral', '🤝', ButtonStyle.Secondary),
        button('kc4c:mentor:request', 'Find Mentor', '🧭', ButtonStyle.Secondary)
      ),
      row(
        button('kc4x:member:reliability', 'Reliability', '🧱', ButtonStyle.Secondary),
        button('kc4x:member:verification', 'Verification Intel', '✅', ButtonStyle.Secondary),
        button('kc4c:archives:build', 'Build Advisor', '🛠️', ButtonStyle.Success)
      )
    ],
    allowedMentions: { parse: [] }
  };
}

function carrierCommandPayload(state) {
  const coverage = carrierCoverage(state);
  const c = carrySummary(state);
  const demand = topDemand(state, 3);
  const online = Object.values(state.carrierOps?.profiles ?? {}).filter((p) => ['available', 'busy'].includes(p.status));
  return {
    embeds: [panel('🛡️ KNIGHT COMMAND • Service Operations', 'Mission coverage, verified service, recovery, reliability and carrier performance from one control surface.', KC4_COLORS.carrier)
      .addFields(
        metric('🟢 Available', coverage.available.length, `${online.length} on duty`),
        metric('⚔️ Active Parties', c.active.length, `${c.peopleWaiting} players waiting`),
        metric('📡 Coverage', coverage.status, coverage.deficit ? `Need ~${coverage.deficit} more Knights` : 'Demand covered'),
        { name: '🔥 PRIORITY DISPATCH', value: demand.length ? demand.map(([d, x], i) => `${rankMedal(i)} **${d}** • ${x.waiting ?? 0} waiting • ~${x.estimatedWaitMinutes ?? 1}m`).join('\n') : empty('No priority dungeon right now.') },
        { name: 'SERVICE RULE', value: 'Use **Start/Stop Service** only while actively available to carry. Recovery returns abandoned missions to the pool without destroying the party.' }
      )],
    components: [
      row(
        button('kc4x:carrier:recommended', 'Recommended Mission', '🎯', ButtonStyle.Primary),
        button('kc4:carrier:shift', 'Start / Stop Service', '⏱️', ButtonStyle.Success),
        button('kc4:carrier:profile', 'My Service Profile', '🪪', ButtonStyle.Secondary),
        button('kc4:carrier:academy', 'Academy', '🎓', ButtonStyle.Secondary)
      ),
      row(
        button('kc4x:carrier:coverage', 'Coverage Plan', '📡', ButtonStyle.Secondary),
        button('kc4x:carrier:recovery', 'Recover Mission', '♻️', ButtonStyle.Secondary),
        button('kc4x:carrier:noshow', 'Record No-Show', '🚫', ButtonStyle.Danger),
        button('kc4x:carrier:matrix', 'Skill Matrix', '📜', ButtonStyle.Secondary)
      )
    ],
    allowedMentions: { parse: [] }
  };
}

function staffControlPayload(state) {
  const c = carrySummary(state);
  const openTickets = Object.values(state.tickets ?? {}).filter((t) => !DONE_TICKET.has(t.status)).length;
  const reviews = state.externalApplicationReviews ?? [];
  const pendingTreasury = Object.values(state.treasuryV4?.requests ?? {}).filter((r) => r.status === 'pending').length;
  const risk = state.securityV4?.riskScore ?? 0;
  const coverage = carrierCoverage(state);
  return {
    embeds: [panel('👑 ROYAL CONTROL PLANE • Executive Operations', 'The staff cockpit for carries, applications, tickets, security, economy, analytics and platform configuration.', KC4_COLORS.command)
      .addFields(
        metric('⚔️ Carry Pressure', c.peopleWaiting, `${c.running.length} running • ~${c.eta}m ETA`),
        metric('📨 Applications', reviews.length, `${state.applicationMetricsV4?.scores?.length ?? 0} scored`),
        metric('🕯️ Open Tickets', openTickets, `${Object.keys(state.ticketMetricsV4?.claimed ?? {}).length} claimed`),
        metric('🛡️ Security', stateBadge(state.securityV4?.state), `Risk ${risk}/100`),
        metric('🏦 Treasury', pendingTreasury, 'pending approvals'),
        metric('📡 Coverage', coverage.status, `${coverage.available.length}/${coverage.required} ready`),
        { name: 'SYSTEM STATE', value: `Schema **v${state.platform?.schemaVersion ?? 4}** • Release **${state.platform?.release ?? '4.x'}** • Drift **${state.securityV4?.drift?.length ?? 0}** • Audit entries **${state.platform?.auditLedger?.length ?? 0}**` }
      )],
    components: [
      row(
        button('kc4x:staff:applications', 'Application Console', '📨', ButtonStyle.Primary),
        button('kc4x:staff:tickets', 'Ticket Console', '🕯️', ButtonStyle.Primary),
        button('kc4x:staff:economy', 'Economy Console', '🏦', ButtonStyle.Secondary),
        button('kc4x:staff:analytics', 'Analytics', '📊', ButtonStyle.Secondary)
      ),
      row(
        button('kc4x:staff:security', 'Security Command', '🛡️', ButtonStyle.Danger),
        button('kc4x:staff:config', 'Configuration', '⚙️', ButtonStyle.Secondary),
        button('kc4x:staff:workflows', 'Workflow Engine', '🧬', ButtonStyle.Secondary),
        button('kc4x:staff:audit', 'Audit Ledger', '📚', ButtonStyle.Secondary)
      )
    ],
    allowedMentions: { parse: [] }
  };
}

function testingPayload(state) {
  const latestInt = state.platform?.integrationTests?.at(-1);
  const latestPerm = state.platform?.permissionTests?.at(-1);
  return {
    embeds: [panel('🧪 PLATFORM ASSURANCE • Tests + Staging', 'Runtime verification for the production server plus staging/deployment readiness.', KC4_COLORS.success)
      .addFields(
        metric('Integration', latestInt?.passed === false ? 'FAILED' : latestInt ? 'PASSED' : 'NOT RUN', latestInt ? timestamp(latestInt.at) : 'run a suite'),
        metric('Permissions', latestPerm?.passed === false ? 'FAILED' : latestPerm ? 'PASSED' : 'NOT RUN', latestPerm ? `${latestPerm.failures ?? 0} findings` : 'run matrix'),
        metric('Staging', state.stagingV4?.configured ? 'CONFIGURED' : 'NOT SET', state.stagingV4?.guildId ? `Guild ${state.stagingV4.guildId}` : 'set STAGING_GUILD_ID'),
        { name: 'ASSURANCE POLICY', value: 'Run both suites after structural changes. The integration suite validates platform state and references; the permission matrix verifies real Discord channel visibility against expected staff/carrier/public boundaries.' }
      )],
    components: [row(
      button('kc4x:test:integration', 'Run Integration Suite', '🧪', ButtonStyle.Primary),
      button('kc4x:test:permissions', 'Run Permission Matrix', '🔐', ButtonStyle.Primary),
      button('kc4x:test:twin', 'Audit Digital Twin', '🪞', ButtonStyle.Secondary),
      button('kc4x:test:repair', 'Repair Drift', '🛠️', ButtonStyle.Success)
    )],
    allowedMentions: { parse: [] }
  };
}

function economyPayload(state) {
  const items = Object.values(state.treasuryV4?.items ?? {});
  const loans = Object.values(state.treasuryV4?.loans ?? {}).filter((l) => l.status === 'loaned');
  const requests = Object.values(state.treasuryV4?.requests ?? {}).filter((r) => r.status === 'pending');
  const listings = Object.values(state.marketV4?.listings ?? {}).filter((l) => l.status === 'active');
  return {
    embeds: [panel('🏦 ROYAL ECONOMY • Treasury + Marketplace', 'Tracked inventory, approvals, loans, listings, searches and watchlists — no more unlogged gear DMs.', KC4_COLORS.economy)
      .addFields(
        metric('Treasury Items', items.length, `${items.reduce((s, x) => s + (Number(x.quantity) || 1), 0)} total units`),
        metric('Active Loans', loans.length, `${requests.length} requests pending`),
        metric('Market Listings', listings.length, `${Object.keys(state.marketV4?.watchlists ?? {}).length} watchlists`),
        { name: 'LEDGER', value: `Treasury history **${state.treasuryV4?.history?.length ?? 0}** • Market events **${state.marketV4?.history?.length ?? 0}**` }
      )],
    components: [
      row(
        button('kc4x:economy:inventory', 'Treasury Inventory', '📦', ButtonStyle.Secondary),
        button('kc4x:economy:additem', 'Add Treasury Item', '➕', ButtonStyle.Success),
        button('kc4x:economy:loan', 'Create Loan', '🤝', ButtonStyle.Primary),
        button('kc4x:economy:loans', 'Active Loans', '📋', ButtonStyle.Secondary)
      ),
      row(
        button('kc4x:market:search', 'Search Market', '🔎', ButtonStyle.Primary),
        button('kc4x:market:watch', 'Create Watchlist', '🔔', ButtonStyle.Secondary),
        button('kc4:market:intel', 'Market Intelligence', '📈', ButtonStyle.Secondary)
      )
    ],
    allowedMentions: { parse: [] }
  };
}

function applicationConsolePayload(state) {
  const reviews = state.externalApplicationReviews ?? [];
  const scores = state.applicationMetricsV4?.scores ?? [];
  const counts = {};
  for (const r of reviews) counts[String(r.decision ?? 'Pending').toLowerCase()] = (counts[String(r.decision ?? 'Pending').toLowerCase()] ?? 0) + 1;
  return {
    embeds: [panel('📨 APPLICATION COMMAND • Review Intelligence', 'Google Forms remains the raw-answer source; Kingdom Core owns scoring, workflow state, review metrics and decision auditing.', KC4_COLORS.command)
      .addFields(
        metric('Logged Reviews', reviews.length, `${scores.length} structured scorecards`),
        metric('Accepted', counts.accepted ?? 0, `${counts.interview ?? 0} interview`),
        metric('Denied', counts.denied ?? 0, `${counts.pending ?? 0} pending`),
        { name: 'SCORING MODEL', value: '**Communication • Experience • Availability • Judgement**\nEach scored 1–10; Kingdom Core calculates the average and grade. Human staff still make every decision.' }
      )],
    components: [row(
      button('kc4x:apps:score', 'Score Application', '📊', ButtonStyle.Primary),
      button('kc2:apps:review', 'Log Review / Decision', '📝', ButtonStyle.Success),
      button('kc2:apps:recent', 'Recent Reviews', '📚', ButtonStyle.Secondary),
      button('kc4x:apps:brief', 'Generate Staff Brief', '🧠', ButtonStyle.Secondary)
    )],
    allowedMentions: { parse: [] }
  };
}

function ticketConsolePayload(state) {
  const tickets = Object.values(state.tickets ?? {});
  const open = tickets.filter((t) => !DONE_TICKET.has(t.status));
  const now = Date.now();
  const breached = open.filter((t) => now - new Date(t.createdAt ?? now).getTime() > 30 * 60_000 && !state.ticketMetricsV4?.firstResponse?.[t.id ?? t.channelId]).length;
  return {
    embeds: [panel('🕯️ PETITION COMMAND • Unified Ticket Console', 'Claim ownership, watch response SLA, escalate authority and archive structured resolution summaries.', KC4_COLORS.command)
      .addFields(
        metric('Open Cases', open.length, `${tickets.length - open.length} closed`),
        metric('SLA Watch', breached, '30m without recorded first response'),
        metric('Owned', Object.keys(state.ticketMetricsV4?.claimed ?? {}).length, `${Object.keys(state.ticketMetricsV4?.escalations ?? {}).length} escalated`),
        { name: 'CASE ROUTING', value: 'Support → Watchman/Castle Guard → Royal Guard → Council. Claim first, escalate only when required, then close with a structured summary.' }
      )],
    components: [row(
      button('kc4x:tickets:browse', 'Browse Open Cases', '🗂️', ButtonStyle.Primary),
      button('kc4x:tickets:sla', 'SLA Report', '⏱️', ButtonStyle.Secondary),
      button('kc4x:tickets:brief', 'Backlog Brief', '🧠', ButtonStyle.Secondary)
    )],
    allowedMentions: { parse: [] }
  };
}

function securityPremiumPayload(state) {
  const sec = state.securityV4 ?? {};
  const incidents = (sec.incidents ?? []).slice(-4).reverse();
  return {
    embeds: [panel('🛡️ KINGDOM SECURITY • Active Defense', 'Risk scoring, bot/webhook governance, permission drift and emergency controls tied to an auditable server model.', sec.state === 'LOCKDOWN' ? KC4_COLORS.danger : KC4_COLORS.security)
      .addFields(
        metric('Security State', stateBadge(sec.state), `Risk ${sec.riskScore ?? 0}/100`),
        metric('Digital Twin', `${sec.drift?.length ?? 0} drift`, `${sec.snapshots?.length ?? 0} snapshots`),
        metric('Registries', `${sec.approvedBots?.length ?? 0} bots`, `${Object.keys(sec.webhookRegistry ?? {}).length} webhooks`),
        { name: 'RECENT SIGNALS', value: incidents.length ? incidents.map((x) => `${x.riskAdded >= 45 ? '🔴' : '🟡'} action **${x.action}** • +${x.riskAdded} risk • ${timestamp(x.at)}`).join('\n') : empty('No recent high-impact audit signals.') }
      )],
    components: [
      row(
        button('kc4:security:audit', 'Audit Drift', '🪞', ButtonStyle.Primary),
        button('kc4:security:snapshot', 'Capture Snapshot', '📸', ButtonStyle.Secondary),
        button('kc4:security:registry', 'Bot + Webhook Registry', '📚', ButtonStyle.Secondary),
        button('kc4:security:repair', 'Repair Drift', '🛠️', ButtonStyle.Success)
      ),
      row(
        button('kc4:security:lockdown', 'Emergency Lockdown', '🚨', ButtonStyle.Danger, Boolean(sec.lockdown?.active)),
        button('kc4:security:unlock', 'End Lockdown', '🔓', ButtonStyle.Secondary, !sec.lockdown?.active),
        button('kc4x:security:explain', 'Explain Risk', '🧠', ButtonStyle.Secondary)
      )
    ],
    allowedMentions: { parse: [] }
  };
}

function analyticsPayload(state) {
  const funnels = state.analyticsV4?.funnels ?? {};
  const retention = state.analyticsV4?.retention ?? {};
  const coverage = carrierCoverage(state);
  const events = state.analyticsV4?.events ?? [];
  return {
    embeds: [panel('📊 KINGDOM ANALYTICS • Decision Intelligence', 'Operational analytics built from the same event ledger that powers carries, progression and the control plane.', KC4_COLORS.command)
      .addFields(
        metric('Data Events', compactNumber(events.length), 'event warehouse'),
        metric('Profiles', funnels.identities ?? 0, `${funnels.activeContributor ?? 0} active contributors`),
        metric('Carry Conversion', funnels.identities ? `${Math.round(((funnels.receivedCarry ?? 0) / funnels.identities) * 100)}%` : '0%', `${funnels.receivedCarry ?? 0} received a carry`),
        metric('D1 Retention', `${retention.d1 ?? 0}%`, `${retention.cohort ?? 0} tracked joins`),
        metric('D7 Retention', `${retention.d7 ?? 0}%`, 'activity-based'),
        metric('Coverage', coverage.status, `${coverage.deficit} Knight deficit`),
        { name: 'FORECAST ENGINE', value: topDemand(state, 5).map(([d, x], i) => `${rankMedal(i)} **${d}** • ${x.waiting ?? 0} waiting • avg ${x.avgRunMinutes ?? 8}m • ETA ${x.estimatedWaitMinutes ?? 1}m`).join('\n') || empty('Forecasts will appear as carry history accumulates.') }
      )],
    allowedMentions: { parse: [] }
  };
}

function workflowPayload(state) {
  const rules = state.platform?.workflows ?? [];
  return {
    embeds: [panel('🧬 WORKFLOW ENGINE • Event Automation', 'Versioned rules connect platform events to progression, analytics, referrals, watchlists, quests and repair checks.', KC4_COLORS.royal)
      .setDescription(rules.map((w) => `${w.enabled ? '🟢' : '⚫'} **${w.id}**\n└ \`${w.event}\` → ${w.actions.join(' → ')}`).join('\n\n') || empty('No workflows configured.'))],
    components: [row(
      button('kc4x:workflow:run', 'Run Maintenance Workflows', '▶️', ButtonStyle.Primary),
      button('kc4x:workflow:events', 'Recent Events', '📚', ButtonStyle.Secondary)
    )],
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] }
  };
}

function configPayload(state) {
  const flags = Object.entries(state.platform?.featureFlags ?? {});
  return {
    embeds: [panel('⚙️ PLATFORM CONFIGURATION • Feature Flags', 'Change platform modules without editing source code. Structural/security-critical changes should still be tested after toggling.', KC4_COLORS.royal)
      .setDescription(flags.slice(0, 35).map(([k, v]) => `${v ? '🟢' : '⚫'} **${k}**`).join('\n'))],
    components: flags.length ? [new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId('kc4x:config:toggle').setPlaceholder('Toggle a feature flag').addOptions(flags.slice(0, 25).map(([k, v]) => ({ label: k.slice(0, 100), value: k, description: v ? 'Currently ENABLED' : 'Currently DISABLED', emoji: v ? '🟢' : '⚫' })))
    )] : [],
    flags: MessageFlags.Ephemeral
  };
}

function auditPayload(state) {
  const rows = (state.platform?.auditLedger ?? []).slice(-20).reverse();
  return {
    embeds: [panel('📚 IMMUTABLE-STYLE AUDIT LEDGER • Recent Actions', 'High-value Kingdom Core actions recorded with actor, target, timestamp and structured details.', KC4_COLORS.command)
      .setDescription(rows.length ? rows.map((a) => `**${a.action}** • ${timestamp(a.at)}\n└ actor ${a.actorId ? `<@${a.actorId}>` : 'system'}${a.targetId ? ` • target \`${a.targetId}\`` : ''}`).join('\n\n') : empty('No v4.2 audit records yet.'))],
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] }
  };
}

function referralModal() {
  const target = new TextInputBuilder().setCustomId('kc4x:referral:user').setPlaceholder('Discord user ID of the person you invited').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(30);
  return new ModalBuilder().setCustomId('kc4x:referral:submit').setTitle('🤝 Register Quality Referral').addLabelComponents(
    new LabelBuilder().setLabel('Referred Member ID').setDescription('Rewards only qualify after genuine activity.').setTextInputComponent(target)
  );
}

function appScoreModal() {
  const applicant = new TextInputBuilder().setCustomId('kc4x:apps:applicant').setPlaceholder('Discord / Roblox name or application reference').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100);
  const communication = new TextInputBuilder().setCustomId('kc4x:apps:communication').setPlaceholder('1-10').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(2);
  const experience = new TextInputBuilder().setCustomId('kc4x:apps:experience').setPlaceholder('1-10').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(2);
  const availability = new TextInputBuilder().setCustomId('kc4x:apps:availability').setPlaceholder('1-10').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(2);
  const judgement = new TextInputBuilder().setCustomId('kc4x:apps:judgement').setPlaceholder('1-10').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(2);
  return new ModalBuilder().setCustomId('kc4x:apps:score-submit').setTitle('📊 Application Scorecard').addLabelComponents(
    new LabelBuilder().setLabel('Applicant').setTextInputComponent(applicant),
    new LabelBuilder().setLabel('Communication').setTextInputComponent(communication),
    new LabelBuilder().setLabel('Experience').setTextInputComponent(experience),
    new LabelBuilder().setLabel('Availability').setTextInputComponent(availability),
    new LabelBuilder().setLabel('Judgement').setTextInputComponent(judgement)
  );
}

function treasuryItemModal() {
  const name = new TextInputBuilder().setCustomId('kc4x:treasury:name').setPlaceholder('T3 Purple Mage Weapon').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(120);
  const qty = new TextInputBuilder().setCustomId('kc4x:treasury:qty').setPlaceholder('1').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(6);
  const notes = new TextInputBuilder().setCustomId('kc4x:treasury:notes').setPlaceholder('Tier, stats, source, restrictions').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500);
  return new ModalBuilder().setCustomId('kc4x:treasury:additem-submit').setTitle('📦 Add Treasury Item').addLabelComponents(
    new LabelBuilder().setLabel('Item').setTextInputComponent(name),
    new LabelBuilder().setLabel('Quantity').setTextInputComponent(qty),
    new LabelBuilder().setLabel('Notes').setTextInputComponent(notes)
  );
}

function loanModal() {
  const itemId = new TextInputBuilder().setCustomId('kc4x:loan:item').setPlaceholder('Treasury item ID, e.g. IT-ABC123').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(40);
  const borrower = new TextInputBuilder().setCustomId('kc4x:loan:user').setPlaceholder('Discord user ID').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(30);
  const due = new TextInputBuilder().setCustomId('kc4x:loan:due').setPlaceholder('2026-09-15').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(20);
  return new ModalBuilder().setCustomId('kc4x:loan:submit').setTitle('🤝 Create Treasury Loan').addLabelComponents(
    new LabelBuilder().setLabel('Treasury Item ID').setTextInputComponent(itemId),
    new LabelBuilder().setLabel('Borrower ID').setTextInputComponent(borrower),
    new LabelBuilder().setLabel('Return Due').setTextInputComponent(due)
  );
}

function marketSearchModal() {
  const query = new TextInputBuilder().setCustomId('kc4x:market:query').setPlaceholder('Volcanic legendary, mage, purple...').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100);
  return new ModalBuilder().setCustomId('kc4x:market:search-submit').setTitle('🔎 Search Kingdom Marketplace').addLabelComponents(new LabelBuilder().setLabel('Search').setTextInputComponent(query));
}

function marketWatchModal() {
  const query = new TextInputBuilder().setCustomId('kc4x:watch:query').setPlaceholder('Volcanic Mage Legendary').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100);
  return new ModalBuilder().setCustomId('kc4x:watch:submit').setTitle('🔔 Create Market Watch').addLabelComponents(new LabelBuilder().setLabel('Item Keywords').setTextInputComponent(query));
}

function noShowBrowser(state) {
  const options = [];
  for (const ticket of activeCarries(state)) {
    if (!['claimed', 'ready'].includes(ticket.status)) continue;
    for (const userId of membersOf(ticket)) {
      options.push({ label: `${ticket.id} • member …${userId.slice(-6)}`.slice(0, 100), description: `${ticket.dungeon} • ${ticket.status}`.slice(0, 100), value: `${ticket.id}|${userId}`, emoji: '🚫' });
      if (options.length >= 25) break;
    }
    if (options.length >= 25) break;
  }
  return {
    embeds: [panel('🚫 Record Carry No-Show', 'Select only a member who failed the active ready/assembly process. No-show data affects reliability; use it carefully.', KC4_COLORS.danger)],
    components: options.length ? [row(select('kc4x:carrier:noshow-pick', 'Select party member', options))] : [],
    flags: MessageFlags.Ephemeral
  };
}

function recoveryBrowser(state) {
  const options = activeCarries(state).filter((t) => ['claimed', 'ready', 'running'].includes(t.status)).slice(0, 25).map((t) => ({
    label: `${t.id} • ${t.dungeon}`.slice(0, 100),
    description: `${t.status} • Knight ${t.carrierId ? `…${t.carrierId.slice(-6)}` : 'none'} • ${membersOf(t).length} members`.slice(0, 100),
    value: t.id,
    emoji: '♻️'
  }));
  return {
    embeds: [panel('♻️ Mission Recovery', 'Return an interrupted carry to the open pool while preserving its party and ticket.', KC4_COLORS.warning)],
    components: options.length ? [row(select('kc4x:carrier:recovery-pick', 'Select interrupted mission', options))] : [],
    flags: MessageFlags.Ephemeral
  };
}

function ticketBrowser(state) {
  const open = Object.values(state.tickets ?? {}).filter((t) => !DONE_TICKET.has(t.status)).slice(0, 25);
  const options = open.map((t, i) => ({
    label: `${t.id ?? `CASE-${i + 1}`} • ${t.type ?? 'support'}`.slice(0, 100),
    description: `${t.status ?? 'open'} • ${t.userId ? `member …${t.userId.slice(-6)}` : 'unknown member'}`.slice(0, 100),
    value: String(t.id ?? t.channelId ?? i),
    emoji: '🕯️'
  }));
  return {
    embeds: [panel('🗂️ Open Petition Browser', open.length ? 'Select a live case to claim, escalate or summarize.' : 'No open petition/support cases.', KC4_COLORS.command)],
    components: options.length ? [row(select('kc4x:tickets:pick', 'Select an open case', options))] : [],
    flags: MessageFlags.Ephemeral
  };
}

function ticketControls(ticket, key, state) {
  const owner = state.ticketMetricsV4?.claimed?.[key];
  const escalation = state.ticketMetricsV4?.escalations?.[key] ?? 0;
  return {
    embeds: [panel(`🕯️ Case • ${ticket.id ?? key}`, `Type **${ticket.type ?? 'support'}** • Status **${ticket.status ?? 'open'}**`, KC4_COLORS.command)
      .addFields(
        metric('Owner', owner ? `<@${owner}>` : 'UNCLAIMED', 'claim before responding'),
        metric('Escalation', `Level ${escalation}`, escalation ? 'higher authority requested' : 'normal routing'),
        metric('Created', timestamp(ticket.createdAt), ticket.channelId ? `<#${ticket.channelId}>` : 'channel unknown')
      )],
    components: [row(
      button(`kc4x:ticket:claim:${key}`, 'Claim', '✋', ButtonStyle.Primary),
      button(`kc4x:ticket:escalate:${key}`, 'Escalate', '⬆️', ButtonStyle.Secondary),
      button(`kc4x:ticket:summary:${key}`, 'Create Summary', '🧠', ButtonStyle.Secondary)
    )],
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] }
  };
}

function findTicket(state, key) {
  const entries = Object.entries(state.tickets ?? {});
  return entries.find(([k, t]) => k === key || String(t.id) === key || String(t.channelId) === key) ?? null;
}

function scoreToGrade(avg) {
  if (avg >= 9) return 'S';
  if (avg >= 8) return 'A';
  if (avg >= 7) return 'B';
  if (avg >= 6) return 'C';
  if (avg >= 5) return 'D';
  return 'F';
}

function parseScore(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 && n <= 10 ? n : null;
}

function reliabilityPayload(state, userId) {
  const p = state.identities?.[userId] ?? {};
  const good = p.stats?.carriesReceived ?? 0;
  const noShows = p.stats?.noShows ?? 0;
  const total = good + noShows;
  const reliability = total ? Math.round((good / total) * 100) : 100;
  return {
    embeds: [panel('🧱 Carry Reliability', 'A lightweight service reliability signal based only on actual carry attendance — not a general social score.', KC4_COLORS.success)
      .addFields(
        metric('Reliability', `${reliability}%`, `${bar(reliability, 100, 12)}`),
        metric('Successful Carries', good, 'completed as participant'),
        metric('No-Shows', noShows, 'recorded during assembly')
      )],
    flags: MessageFlags.Ephemeral
  };
}

function verificationPayload(member, state) {
  const traveller = state.setup?.roles?.traveller;
  const verified = Boolean(traveller && member.roles.cache.has(traveller));
  const tier = LEVEL_TIERS.find((x) => state.setup?.levelRoles?.[x.key] && member.roles.cache.has(state.setup.levelRoles[x.key]));
  return {
    embeds: [panel('✅ Verification Intelligence', 'Kingdom Core derives progression context from your verified Discord/level state without inventing Roblox data it cannot reliably read.', verified ? KC4_COLORS.success : KC4_COLORS.warning)
      .addFields(
        metric('Guild Verification', verified ? 'VERIFIED' : 'NOT VERIFIED', traveller ? 'Traveller role check' : 'verification role not mapped'),
        metric('Level Band', tier ? `Lvl ${tier.key}` : 'Not Set', tier?.role ?? 'select a level role'),
        metric('Current Progression', tier?.dungeon ?? 'Unknown', 'derived from level role')
      )],
    flags: MessageFlags.Ephemeral
  };
}

function applicationsBrief(state) {
  const reviews = (state.externalApplicationReviews ?? []).slice(-50);
  const scores = (state.applicationMetricsV4?.scores ?? []).slice(-50);
  const accepted = reviews.filter((r) => r.decision === 'Accepted').length;
  const denied = reviews.filter((r) => r.decision === 'Denied').length;
  const interview = reviews.filter((r) => r.decision === 'Interview').length;
  const avg = scores.length ? scores.reduce((s, x) => s + x.average, 0) / scores.length : 0;
  return panel('🧠 Application Staff Brief', 'A deterministic summary of the recent application pipeline. Staff remain the decision-makers.', KC4_COLORS.command)
    .addFields(
      metric('Recent Reviews', reviews.length, `${accepted} accepted • ${interview} interview • ${denied} denied`),
      metric('Scorecards', scores.length, avg ? `average ${avg.toFixed(1)}/10` : 'no structured scores'),
      { name: 'REVIEW FOCUS', value: 'Look for mismatches between strong numeric scores and weak written notes, long-pending candidates, and interview candidates without a final decision.' }
    );
}

function securityExplain(state) {
  const sec = state.securityV4 ?? {};
  const recent = (sec.incidents ?? []).slice(-8).reverse();
  return panel('🧠 Security Explanation', 'Why Kingdom Security is currently in this state.', sec.riskScore >= 80 ? KC4_COLORS.danger : KC4_COLORS.warning)
    .addFields(
      metric('State', stateBadge(sec.state), `Risk ${sec.riskScore ?? 0}/100`),
      metric('Lockdown', sec.lockdown?.active ? 'ACTIVE' : 'Inactive', `${sec.drift?.length ?? 0} drift findings`),
      { name: 'RECENT CONTRIBUTORS', value: recent.length ? recent.map((x) => `• audit action **${x.action}** added **${x.riskAdded}** risk ${timestamp(x.at)}`).join('\n') : empty('No recent security contributors.') }
    );
}

function marketSearch(state, query) {
  const q = query.toLowerCase();
  return Object.values(state.marketV4?.listings ?? {}).filter((x) => x.status === 'active' && `${x.item} ${x.price} ${x.notes ?? ''}`.toLowerCase().includes(q)).slice(-20).reverse();
}

function integrationSuite(guild, state) {
  const tests = [];
  const test = (name, pass, detail = '') => tests.push({ name, pass: Boolean(pass), detail });
  test('Platform schema', (state.platform?.schemaVersion ?? 0) >= 4, `v${state.platform?.schemaVersion ?? 0}`);
  test('Carry ticket category', Boolean(state.setup?.categories?.carryTickets && guild.channels.cache.has(state.setup.categories.carryTickets)));
  test('Live carry queue', Boolean(state.setup?.channels?.carryQueue && guild.channels.cache.has(state.setup.channels.carryQueue)));
  test('Kingdom Command', Boolean(state.setup?.channels?.staffControlPremiumV4 && guild.channels.cache.has(state.setup.channels.staffControlPremiumV4)));
  test('Knight Command', Boolean(state.setup?.channels?.carrierCommandPremiumV4 && guild.channels.cache.has(state.setup.channels.carrierCommandPremiumV4)));
  test('Public operations', Boolean(state.setup?.channels?.liveOperationsPremiumV4 && guild.channels.cache.has(state.setup.channels.liveOperationsPremiumV4)));
  test('Digital twin snapshot', Boolean(state.securityV4?.snapshots?.length));
  test('Workflow engine', Boolean(state.platform?.workflows?.length));
  test('Economy ledgers', Boolean(state.treasuryV4 && state.marketV4));
  test('Analytics event store', Array.isArray(state.analyticsV4?.events));
  const failures = tests.filter((x) => !x.pass);
  return { passed: failures.length === 0, failures: failures.length, tests };
}

function permissionSuite(guild, state) {
  const checks = [];
  const add = (name, actual, expected) => checks.push({ name, pass: actual === expected, actual, expected });
  const everyone = guild.roles.everyone;
  const staffRoleId = STAFF_KEYS.map((k) => state.setup?.roles?.[k]).find(Boolean);
  const carrierRoleId = CARRIER_KEYS.map((k) => state.setup?.roles?.[k]).find(Boolean);
  const staffRole = staffRoleId ? guild.roles.cache.get(staffRoleId) : null;
  const carrierRole = carrierRoleId ? guild.roles.cache.get(carrierRoleId) : null;
  const publicCh = guild.channels.cache.get(state.setup?.channels?.liveOperationsPremiumV4);
  const staffCh = guild.channels.cache.get(state.setup?.channels?.staffControlPremiumV4);
  const carrierCh = guild.channels.cache.get(state.setup?.channels?.carrierCommandPremiumV4);
  if (publicCh) add('Everyone views public operations', publicCh.permissionsFor(everyone)?.has(PermissionFlagsBits.ViewChannel), true);
  if (staffCh) add('Everyone blocked from staff control', staffCh.permissionsFor(everyone)?.has(PermissionFlagsBits.ViewChannel), false);
  if (staffCh && staffRole) add('Staff views staff control', staffCh.permissionsFor(staffRole)?.has(PermissionFlagsBits.ViewChannel), true);
  if (carrierCh) add('Everyone blocked from Knight Command', carrierCh.permissionsFor(everyone)?.has(PermissionFlagsBits.ViewChannel), false);
  if (carrierCh && carrierRole) add('Carrier views Knight Command', carrierCh.permissionsFor(carrierRole)?.has(PermissionFlagsBits.ViewChannel), true);
  const failures = checks.filter((x) => !x.pass);
  return { passed: failures.length === 0, failures: failures.length, checks };
}

export async function refreshPremiumV4(guild, state) {
  const c = (key) => guild.channels.cache.get(state.setup?.channels?.[key]);
  const surfaces = [
    ['liveOperationsPremiumV4', 'liveOperationsPremiumV4Panel', publicOperationsPayload(guild, state)],
    ['memberDashboardPremiumV4', 'memberDashboardPremiumV4Panel', memberHubPayload(state)],
    ['carrierCommandPremiumV4', 'carrierCommandPremiumV4Panel', carrierCommandPayload(state)],
    ['staffControlPremiumV4', 'staffControlPremiumV4Panel', staffControlPayload(state)],
    ['platformTestingPremiumV4', 'platformTestingPremiumV4Panel', testingPayload(state)],
    ['economyPremiumV4', 'economyPremiumV4Panel', economyPayload(state)],
    ['applicationPremiumV4', 'applicationPremiumV4Panel', applicationConsolePayload(state)],
    ['ticketPremiumV4', 'ticketPremiumV4Panel', ticketConsolePayload(state)],
    ['securityPremiumV4', 'securityPremiumV4Panel', securityPremiumPayload(state)],
    ['analyticsPremiumV4', 'analyticsPremiumV4Panel', analyticsPayload(state)]
  ];
  let count = 0;
  for (const [channelKey, panelKey, payload] of surfaces) {
    const channel = c(channelKey);
    if (!channel?.isTextBased()) continue;
    await upsertPinned(channel, state, panelKey, payload);
    count++;
  }
  return count;
}

export async function installPlatformV4Complete(guild) {
  await guild.channels.fetch();
  const state = await readGuildState(guild.id);
  ensureState(state);
  const publicParent = state.setup?.categories?.kingdomProgressV4 ?? state.setup?.categories?.progression ?? null;
  const carrierParent = state.setup?.categories?.knightAcademyV4 ?? state.setup?.categories?.carriers ?? null;
  const staffParent = state.setup?.categories?.kingdomCommandV4 ?? state.setup?.categories?.staff ?? null;
  const systemParent = state.setup?.categories?.platformSystemV4 ?? staffParent;
  const economyParent = state.setup?.categories?.royalEconomyV4 ?? publicParent;
  if (!publicParent || !carrierParent || !staffParent || !systemParent || !economyParent) throw new Error('Required Kingdom Core categories are missing. Run /setup4 again after the earlier setup migrations are present.');

  const defs = [
    ['liveOperationsPremiumV4', '🌐・live-operations', publicParent, 'public'],
    ['memberDashboardPremiumV4', '🪪・member-command', publicParent, 'public'],
    ['carrierCommandPremiumV4', '🛡️・knight-command-center', carrierParent, 'carrier'],
    ['staffControlPremiumV4', '👑・royal-control-plane', staffParent, 'staff'],
    ['platformTestingPremiumV4', '🧪・platform-assurance', systemParent, 'staff'],
    ['economyPremiumV4', '🏦・economy-command', economyParent, 'public'],
    ['applicationPremiumV4', '📨・application-command', staffParent, 'staff'],
    ['ticketPremiumV4', '🕯️・petition-command', staffParent, 'staff'],
    ['securityPremiumV4', '🛡️・security-control', systemParent, 'staff'],
    ['analyticsPremiumV4', '📊・analytics-command', staffParent, 'staff']
  ];
  let created = 0;
  for (const def of defs) {
    const out = await ensureChannel(guild, state, ...def);
    created += Number(out.created);
  }

  if (!state.securityV4?.snapshots?.length) {
    state.securityV4 ??= {};
    state.securityV4.snapshots ??= [];
    state.securityV4.snapshots.push(await captureDigitalTwin(guild, state));
  }
  ledger(state, 'platform.v4.2.install', guild.client.user.id, guild.id, { created });
  const panels = await refreshPremiumV4(guild, state);
  await writeGuildState(guild.id, state);
  return { created, panels };
}

export async function runPlatformV4CompleteMaintenance(guild) {
  const state = await readGuildState(guild.id);
  if (!state.platform?.release) return false;
  await mutateGuildState(guild.id, async (fresh) => {
    ensureState(fresh);

    // Verification intelligence from live roles.
    const members = guild.members.cache;
    for (const member of members.values()) {
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
    }

    // Retention from joins + later activity events.
    const events = fresh.analyticsV4.events ?? [];
    const joins = events.filter((e) => e.type === 'member.joined' && e.userId);
    let eligible1 = 0, kept1 = 0, eligible7 = 0, kept7 = 0, eligible30 = 0, kept30 = 0;
    const now = Date.now();
    for (const j of joins) {
      const jt = new Date(j.at).getTime();
      const later = events.filter((e) => e.userId === j.userId && new Date(e.at).getTime() > jt);
      const activeAfter = (days) => later.some((e) => new Date(e.at).getTime() >= jt + days * 86400000);
      if (now >= jt + 86400000) { eligible1++; if (activeAfter(1)) kept1++; }
      if (now >= jt + 7 * 86400000) { eligible7++; if (activeAfter(7)) kept7++; }
      if (now >= jt + 30 * 86400000) { eligible30++; if (activeAfter(30)) kept30++; }
    }
    fresh.analyticsV4.retention = {
      cohort: joins.length,
      d1: eligible1 ? Math.round((kept1 / eligible1) * 100) : 0,
      d7: eligible7 ? Math.round((kept7 / eligible7) * 100) : 0,
      d30: eligible30 ? Math.round((kept30 / eligible30) * 100) : 0
    };
    fresh.analyticsV4.coverage = carrierCoverage(fresh);

    // Qualify referrals only after time + real activity.
    for (const ref of Object.values(fresh.referralsV4.referrals ?? {})) {
      if (ref.status !== 'pending') continue;
      const member = guild.members.cache.get(ref.targetId);
      if (!member || member.user.bot || member.id === ref.referrerId) continue;
      const ageDays = (now - (member.joinedTimestamp ?? now)) / 86400000;
      const profile = fresh.identities?.[member.id];
      const meaningful = (profile?.kingdomXp ?? 0) >= 50 || (profile?.stats?.carriesReceived ?? 0) >= 1;
      const verified = fresh.verificationV4?.[member.id]?.verified;
      if (ageDays >= 7 && meaningful && verified) {
        ref.status = 'qualified';
        ref.qualifiedAt = new Date().toISOString();
        fresh.referralsV4.qualified[ref.id] = ref;
        fresh.identities ??= {};
        fresh.identities[ref.referrerId] ??= { userId: ref.referrerId, kingdomXp: 0, stats: {}, achievements: [], titles: [] };
        fresh.identities[ref.referrerId].kingdomXp = (fresh.identities[ref.referrerId].kingdomXp ?? 0) + 100;
        ledger(fresh, 'referral.qualified', null, ref.targetId, { referrerId: ref.referrerId, referralId: ref.id });
      }
    }

    // Market price index + watch matches.
    const activeListings = Object.values(fresh.marketV4.listings ?? {}).filter((x) => x.status === 'active');
    const index = {};
    for (const listing of activeListings) {
      const key = String(listing.item ?? '').trim().toLowerCase();
      if (!key) continue;
      index[key] ??= { count: 0, examples: [] };
      index[key].count++;
      if (index[key].examples.length < 5) index[key].examples.push(listing.id);
    }
    fresh.marketV4.priceIndex = index;

    // Ticket SLA snapshots.
    const open = Object.values(fresh.tickets ?? {}).filter((t) => !DONE_TICKET.has(t.status));
    fresh.ticketMetricsV4.sla ??= {};
    fresh.ticketMetricsV4.sla.open = open.length;
    fresh.ticketMetricsV4.sla.breached30m = open.filter((t) => now - new Date(t.createdAt ?? now).getTime() > 1800000 && !fresh.ticketMetricsV4.firstResponse?.[t.id ?? t.channelId]).length;
    fresh.ticketMetricsV4.sla.updatedAt = new Date().toISOString();

    await refreshPremiumV4(guild, fresh);
  });
  return true;
}

export async function handlePlatformV4CompleteButton(interaction) {
  const id = interaction.customId;
  if (!id.startsWith('kc4x:')) return false;
  const state = await readGuildState(interaction.guildId);

  if (id === 'kc4x:public:refresh') {
    await mutateGuildState(interaction.guildId, async (fresh) => refreshPremiumV4(interaction.guild, fresh));
    return interaction.reply(eph('🔄 Live Kingdom operations refreshed.'));
  }
  if (id === 'kc4x:member:dashboard') return interaction.reply({ embeds: memberHubPayload(state).embeds, components: memberHubPayload(state).components, flags: MessageFlags.Ephemeral });
  if (id === 'kc4x:public:demand') {
    const demand = topDemand(state, 15);
    return interaction.reply({ embeds: [panel('📊 LIVE CARRY DEMAND MAP', demand.length ? demand.map(([d, x], i) => `${rankMedal(i)} **${d}**\n└ ${x.waiting ?? 0} waiting • ${x.active ?? 0} active • avg ${x.avgRunMinutes ?? 8}m • ETA **${x.estimatedWaitMinutes ?? 1}m**`).join('\n\n') : empty('No demand right now.'), KC4_COLORS.command)], flags: MessageFlags.Ephemeral });
  }
  if (id === 'kc4x:member:reliability') return interaction.reply(reliabilityPayload(state, interaction.user.id));
  if (id === 'kc4x:member:verification') return interaction.reply(verificationPayload(interaction.member, state));
  if (id === 'kc4x:referral:new') return interaction.showModal(referralModal());

  if (id === 'kc4x:carrier:coverage') {
    if (!isCarrier(interaction.member, state)) return interaction.reply(eph('Knight Command is carrier/staff only.'));
    const c = carrierCoverage(state);
    return interaction.reply({ embeds: [panel('📡 Carrier Coverage Plan', 'How many active Knights the current waiting load reasonably needs.', c.deficit ? KC4_COLORS.warning : KC4_COLORS.success).addFields(
      metric('Available', c.available.length, `${c.busy.length} busy`), metric('Required', c.required, `${carrySummary(state).peopleWaiting} players waiting`), metric('Deficit', c.deficit, c.status),
      { name: 'PRIORITY', value: topDemand(state, 5).map(([d, x], i) => `${rankMedal(i)} **${d}** • ${x.waiting ?? 0} waiting`).join('\n') || empty() }
    )], flags: MessageFlags.Ephemeral });
  }
  if (id === 'kc4x:carrier:recommended') {
    if (!isCarrier(interaction.member, state)) return interaction.reply(eph('Knight Command is carrier/staff only.'));
    const open = activeCarries(state).filter((t) => t.status === 'open').sort((a, b) => new Date(a.createdAt ?? 0) - new Date(b.createdAt ?? 0));
    const hottest = topDemand(state, 1)[0]?.[0];
    const mission = open.find((t) => t.dungeon === hottest) ?? open[0];
    return interaction.reply({ embeds: [panel('🎯 Recommended Mission', mission ? `**${mission.dungeon}** • ${mission.difficulty} • ${mission.mode}\nParty: **${membersOf(mission).length}** • ${timestamp(mission.createdAt)}\n${mission.channelId ? `<#${mission.channelId}>` : ''}` : empty('No open carry party needs a Knight.'), mission ? KC4_COLORS.carrier : KC4_COLORS.success)], flags: MessageFlags.Ephemeral });
  }
  if (id === 'kc4x:carrier:recovery') {
    if (!isCarrier(interaction.member, state)) return interaction.reply(eph('Knight Command is carrier/staff only.'));
    return interaction.reply(recoveryBrowser(state));
  }
  if (id === 'kc4x:carrier:noshow') {
    if (!isCarrier(interaction.member, state)) return interaction.reply(eph('Knight Command is carrier/staff only.'));
    return interaction.reply(noShowBrowser(state));
  }
  if (id === 'kc4x:carrier:matrix') {
    if (!isCarrier(interaction.member, state)) return interaction.reply(eph('Knight Command is carrier/staff only.'));
    const completed = Object.values(state.carryTickets ?? {}).filter((t) => t.status === 'completed' && t.carrierId === interaction.user.id);
    const matrix = {};
    for (const t of completed) matrix[t.dungeon] = (matrix[t.dungeon] ?? 0) + 1;
    const rows = Object.entries(matrix).sort((a, b) => b[1] - a[1]).slice(0, 15);
    return interaction.reply({ embeds: [panel('📜 My Carrier Skill Matrix', rows.length ? rows.map(([d, n]) => `${n >= 50 ? '🏆 MASTERED' : n >= 20 ? '💎 ELITE' : n >= 5 ? '✅ VERIFIED' : '🎓 TRAINING'} • **${d}** — ${n} completed run${n === 1 ? '' : 's'}`).join('\n') : empty('Complete carrier missions to build dungeon proficiency.'), KC4_COLORS.carrier)], flags: MessageFlags.Ephemeral });
  }

  if (id === 'kc4x:staff:applications') {
    if (!isStaff(interaction.member, state)) return interaction.reply(eph('Staff only.'));
    return interaction.reply({ ...applicationConsolePayload(state), flags: MessageFlags.Ephemeral });
  }
  if (id === 'kc4x:staff:tickets') {
    if (!isStaff(interaction.member, state)) return interaction.reply(eph('Staff only.'));
    return interaction.reply({ ...ticketConsolePayload(state), flags: MessageFlags.Ephemeral });
  }
  if (id === 'kc4x:staff:economy') {
    if (!isStaff(interaction.member, state)) return interaction.reply(eph('Staff only.'));
    return interaction.reply({ ...economyPayload(state), flags: MessageFlags.Ephemeral });
  }
  if (id === 'kc4x:staff:analytics') {
    if (!isStaff(interaction.member, state)) return interaction.reply(eph('Staff only.'));
    return interaction.reply({ ...analyticsPayload(state), flags: MessageFlags.Ephemeral });
  }
  if (id === 'kc4x:staff:security') {
    if (!isStaff(interaction.member, state)) return interaction.reply(eph('Staff only.'));
    return interaction.reply({ ...securityPremiumPayload(state), flags: MessageFlags.Ephemeral });
  }
  if (id === 'kc4x:staff:config') {
    if (!isStaff(interaction.member, state)) return interaction.reply(eph('Staff only.'));
    return interaction.reply(configPayload(state));
  }
  if (id === 'kc4x:staff:workflows') {
    if (!isStaff(interaction.member, state)) return interaction.reply(eph('Staff only.'));
    return interaction.reply(workflowPayload(state));
  }
  if (id === 'kc4x:staff:audit') {
    if (!isStaff(interaction.member, state)) return interaction.reply(eph('Staff only.'));
    return interaction.reply(auditPayload(state));
  }
  if (id === 'kc4x:apps:score') {
    if (!isStaff(interaction.member, state)) return interaction.reply(eph('Staff only.'));
    return interaction.showModal(appScoreModal());
  }
  if (id === 'kc4x:apps:brief') {
    if (!isStaff(interaction.member, state)) return interaction.reply(eph('Staff only.'));
    return interaction.reply({ embeds: [applicationsBrief(state)], flags: MessageFlags.Ephemeral });
  }
  if (id === 'kc4x:tickets:browse') {
    if (!isStaff(interaction.member, state)) return interaction.reply(eph('Staff only.'));
    return interaction.reply(ticketBrowser(state));
  }
  if (id === 'kc4x:tickets:sla') {
    if (!isStaff(interaction.member, state)) return interaction.reply(eph('Staff only.'));
    const sla = state.ticketMetricsV4?.sla ?? {};
    return interaction.reply({ embeds: [panel('⏱️ Ticket SLA Report', `Open **${sla.open ?? 0}** • 30m breaches **${sla.breached30m ?? 0}**\nLast calculated ${sla.updatedAt ? timestamp(sla.updatedAt) : 'not yet'}`, sla.breached30m ? KC4_COLORS.warning : KC4_COLORS.success)], flags: MessageFlags.Ephemeral });
  }
  if (id === 'kc4x:tickets:brief') {
    if (!isStaff(interaction.member, state)) return interaction.reply(eph('Staff only.'));
    const open = Object.values(state.tickets ?? {}).filter((t) => !DONE_TICKET.has(t.status));
    const types = {};
    for (const t of open) types[t.type ?? 'support'] = (types[t.type ?? 'support'] ?? 0) + 1;
    return interaction.reply({ embeds: [panel('🧠 Ticket Backlog Brief', `**${open.length} open cases**\n\n${Object.entries(types).map(([k, n]) => `• **${k}** — ${n}`).join('\n') || empty()}\n\nPrioritise unclaimed SLA breaches first.`, KC4_COLORS.command)], flags: MessageFlags.Ephemeral });
  }

  if (id === 'kc4x:economy:inventory') {
    const items = Object.values(state.treasuryV4?.items ?? {});
    return interaction.reply({ embeds: [panel('📦 Royal Treasury Inventory', items.length ? items.slice(0, 25).map((x) => `**${x.id}** • ${x.name} • qty **${x.quantity ?? 1}**\n└ ${x.available ?? x.quantity ?? 1} available${x.notes ? ` • ${x.notes}` : ''}`).join('\n\n') : empty('Treasury inventory is empty.'), KC4_COLORS.economy)], flags: MessageFlags.Ephemeral });
  }
  if (id === 'kc4x:economy:additem') {
    if (!isStaff(interaction.member, state)) return interaction.reply(eph('Only staff can add Treasury inventory.'));
    return interaction.showModal(treasuryItemModal());
  }
  if (id === 'kc4x:economy:loan') {
    if (!isStaff(interaction.member, state)) return interaction.reply(eph('Only staff can create Treasury loans.'));
    return interaction.showModal(loanModal());
  }
  if (id === 'kc4x:economy:loans') {
    const loans = Object.values(state.treasuryV4?.loans ?? {}).filter((l) => l.status === 'loaned');
    return interaction.reply({ embeds: [panel('🤝 Active Treasury Loans', loans.length ? loans.map((l) => `**${l.id}** • item \`${l.itemId}\` → <@${l.borrowerId}>\n└ due **${l.due}** • ${timestamp(l.createdAt)}`).join('\n\n') : empty('No active loans.'), KC4_COLORS.economy)], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  }
  if (id === 'kc4x:market:search') return interaction.showModal(marketSearchModal());
  if (id === 'kc4x:market:watch') return interaction.showModal(marketWatchModal());

  if (id === 'kc4x:security:explain') {
    if (!isStaff(interaction.member, state)) return interaction.reply(eph('Staff only.'));
    return interaction.reply({ embeds: [securityExplain(state)], flags: MessageFlags.Ephemeral });
  }
  if (id === 'kc4x:workflow:run') {
    if (!isStaff(interaction.member, state)) return interaction.reply(eph('Staff only.'));
    await runPlatformV4CompleteMaintenance(interaction.guild);
    return interaction.reply(eph('▶️ Workflow maintenance pass completed.'));
  }
  if (id === 'kc4x:workflow:events') {
    if (!isStaff(interaction.member, state)) return interaction.reply(eph('Staff only.'));
    const events = (state.analyticsV4?.events ?? []).slice(-20).reverse();
    return interaction.reply({ embeds: [panel('📚 Recent Event Bus Activity', events.length ? events.map((e) => `• **${e.type}** ${timestamp(e.at)}${e.userId ? ` • <@${e.userId}>` : ''}`).join('\n') : empty(), KC4_COLORS.command)], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  }

  if (id === 'kc4x:test:integration') {
    if (!isStaff(interaction.member, state)) return interaction.reply(eph('Staff only.'));
    const result = integrationSuite(interaction.guild, state);
    await mutateGuildState(interaction.guildId, async (fresh) => { fresh.platform.integrationTests ??= []; fresh.platform.integrationTests.push({ ...result, at: new Date().toISOString(), actorId: interaction.user.id }); });
    return interaction.reply({ embeds: [panel(`🧪 Integration Suite • ${result.passed ? 'PASS' : 'FAIL'}`, result.tests.map((t) => `${t.pass ? '✅' : '❌'} **${t.name}**${t.detail ? ` — ${t.detail}` : ''}`).join('\n'), result.passed ? KC4_COLORS.success : KC4_COLORS.danger)], flags: MessageFlags.Ephemeral });
  }
  if (id === 'kc4x:test:permissions') {
    if (!isStaff(interaction.member, state)) return interaction.reply(eph('Staff only.'));
    const result = permissionSuite(interaction.guild, state);
    await mutateGuildState(interaction.guildId, async (fresh) => { fresh.platform.permissionTests ??= []; fresh.platform.permissionTests.push({ ...result, at: new Date().toISOString(), actorId: interaction.user.id }); });
    return interaction.reply({ embeds: [panel(`🔐 Permission Matrix • ${result.passed ? 'PASS' : 'FAIL'}`, result.checks.map((t) => `${t.pass ? '✅' : '❌'} **${t.name}**`).join('\n') || empty('No mapped roles/channels to test.'), result.passed ? KC4_COLORS.success : KC4_COLORS.danger)], flags: MessageFlags.Ephemeral });
  }
  if (id === 'kc4x:test:twin') {
    if (!isStaff(interaction.member, state)) return interaction.reply(eph('Staff only.'));
    const findings = await auditDigitalTwin(interaction.guild, state);
    return interaction.reply({ embeds: [panel('🪞 Digital Twin Audit', findings.length ? findings.slice(0, 25).map((x) => `• **${x.severity}** — ${x.message}`).join('\n') : '✅ No drift detected.', findings.length ? KC4_COLORS.warning : KC4_COLORS.success)], flags: MessageFlags.Ephemeral });
  }
  if (id === 'kc4x:test:repair') {
    if (!isStaff(interaction.member, state)) return interaction.reply(eph('Staff only.'));
    const result = await repairDigitalTwin(interaction.guild);
    return interaction.reply(eph(`🛠️ Digital twin repair: **${result.repaired} repaired**, **${result.skipped} skipped**.`));
  }

  const ticketAction = id.match(/^kc4x:ticket:(claim|escalate|summary):(.+)$/);
  if (ticketAction) {
    if (!isStaff(interaction.member, state)) return interaction.reply(eph('Staff only.'));
    const [, action, key] = ticketAction;
    const found = findTicket(state, key);
    if (!found) return interaction.reply(eph('That case no longer exists.'));
    const [storageKey, ticket] = found;
    if (action === 'claim') {
      await mutateGuildState(interaction.guildId, async (fresh) => {
        ensureState(fresh);
        fresh.ticketMetricsV4.claimed[storageKey] = interaction.user.id;
        fresh.ticketMetricsV4.firstResponse[storageKey] ??= new Date().toISOString();
        if (fresh.tickets?.[storageKey]) fresh.tickets[storageKey].assignedTo = interaction.user.id;
        ledger(fresh, 'ticket.claim', interaction.user.id, storageKey);
      });
      return interaction.reply(eph(`✋ Case **${ticket.id ?? storageKey}** claimed.`));
    }
    if (action === 'escalate') {
      let level = 0;
      await mutateGuildState(interaction.guildId, async (fresh) => {
        ensureState(fresh);
        level = Math.min(3, (fresh.ticketMetricsV4.escalations[storageKey] ?? 0) + 1);
        fresh.ticketMetricsV4.escalations[storageKey] = level;
        ledger(fresh, 'ticket.escalate', interaction.user.id, storageKey, { level });
      });
      return interaction.reply(eph(`⬆️ Case escalated to **Level ${level}**.`));
    }
    if (action === 'summary') {
      const channel = interaction.guild.channels.cache.get(ticket.channelId);
      let messages = [];
      if (channel?.isTextBased()) messages = [...(await channel.messages.fetch({ limit: 50 }).catch(() => new Map())).values()];
      const participants = new Set(messages.map((m) => m.author?.id).filter(Boolean));
      const attachments = messages.reduce((s, m) => s + (m.attachments?.size ?? 0), 0);
      const summary = { messageCount: messages.length, participants: participants.size, attachments, lastActivity: messages[0]?.createdAt?.toISOString?.() ?? null, generatedAt: new Date().toISOString(), generatedBy: interaction.user.id };
      await mutateGuildState(interaction.guildId, async (fresh) => { fresh.ticketMetricsV4.summaries[storageKey] = summary; ledger(fresh, 'ticket.summary', interaction.user.id, storageKey, summary); });
      return interaction.reply({ embeds: [panel(`🧠 Case Summary • ${ticket.id ?? storageKey}`, `**Messages:** ${messages.length}\n**Participants:** ${participants.size}\n**Attachments:** ${attachments}\n**Last Activity:** ${summary.lastActivity ? timestamp(summary.lastActivity) : 'Unknown'}\n\nThis is a structured operational summary; staff should add the final outcome before closing.`, KC4_COLORS.command)], flags: MessageFlags.Ephemeral });
    }
  }
  return false;
}

export async function handlePlatformV4CompleteSelect(interaction) {
  const id = interaction.customId;
  if (!id.startsWith('kc4x:')) return false;
  const state = await readGuildState(interaction.guildId);
  if (id === 'kc4x:carrier:recovery-pick') {
    if (!isCarrier(interaction.member, state)) return interaction.reply(eph('Carrier/staff only.'));
    const ticketId = interaction.values[0];
    let channelId = null;
    await mutateGuildState(interaction.guildId, async (fresh) => {
      const t = fresh.carryTickets?.[ticketId];
      if (!t || !['claimed', 'ready', 'running'].includes(t.status)) return;
      t.recoveryHistory ??= [];
      t.recoveryHistory.push({ fromStatus: t.status, carrierId: t.carrierId, at: new Date().toISOString(), actorId: interaction.user.id });
      t.status = 'open';
      t.carrierId = null;
      t.ready = {};
      t.returnedAt = new Date().toISOString();
      channelId = t.channelId;
      ledger(fresh, 'carry.recovered', interaction.user.id, ticketId);
      await refreshPartyPanels(interaction.guild, fresh);
    });
    const channel = interaction.guild.channels.cache.get(channelId);
    if (channel?.isTextBased()) await channel.send({ content: '♻️ **Mission recovered.** The party was preserved and returned to the Knight pool for reassignment.', allowedMentions: { parse: [] } }).catch(() => null);
    return interaction.update({ content: `♻️ Mission **${ticketId}** returned to the open pool.`, embeds: [], components: [] });
  }
  if (id === 'kc4x:carrier:noshow-pick') {
    if (!isCarrier(interaction.member, state)) return interaction.reply(eph('Carrier/staff only.'));
    const [ticketId, userId] = interaction.values[0].split('|');
    let ok = false;
    await mutateGuildState(interaction.guildId, async (fresh) => {
      const t = fresh.carryTickets?.[ticketId];
      if (!t || !['claimed', 'ready'].includes(t.status) || !membersOf(t).includes(userId)) return;
      t.members = membersOf(t).filter((x) => x !== userId);
      if (t.ready) delete t.ready[userId];
      fresh.identities ??= {};
      fresh.identities[userId] ??= { userId, kingdomXp: 0, stats: {}, achievements: [], titles: [] };
      fresh.identities[userId].stats ??= {};
      fresh.identities[userId].stats.noShows = (fresh.identities[userId].stats.noShows ?? 0) + 1;
      t.noShows ??= [];
      t.noShows.push({ userId, at: new Date().toISOString(), recordedBy: interaction.user.id });
      ledger(fresh, 'carry.no_show', interaction.user.id, userId, { ticketId });
      ok = true;
      await refreshPartyPanels(interaction.guild, fresh);
    });
    return interaction.update({ content: ok ? `🚫 No-show recorded for <@${userId}> on **${ticketId}**.` : 'That participant is no longer eligible for a no-show record.', embeds: [], components: [], allowedMentions: { parse: [] } });
  }
  if (id === 'kc4x:tickets:pick') {
    if (!isStaff(interaction.member, state)) return interaction.reply(eph('Staff only.'));
    const found = findTicket(state, interaction.values[0]);
    if (!found) return interaction.reply(eph('That case no longer exists.'));
    const [key, ticket] = found;
    return interaction.update(ticketControls(ticket, key, state));
  }
  if (id === 'kc4x:config:toggle') {
    if (!isStaff(interaction.member, state)) return interaction.reply(eph('Staff only.'));
    const flag = interaction.values[0];
    let value = false;
    await mutateGuildState(interaction.guildId, async (fresh) => {
      if (!(flag in (fresh.platform?.featureFlags ?? {}))) return;
      value = !fresh.platform.featureFlags[flag];
      fresh.platform.featureFlags[flag] = value;
      ledger(fresh, 'config.feature_toggle', interaction.user.id, flag, { value });
    });
    return interaction.reply(eph(`${value ? '🟢' : '⚫'} **${flag}** is now **${value ? 'ENABLED' : 'DISABLED'}**.`));
  }
  return false;
}

export async function handlePlatformV4CompleteModal(interaction) {
  const id = interaction.customId;
  if (!id.startsWith('kc4x:')) return false;
  const initial = await readGuildState(interaction.guildId);

  if (id === 'kc4x:referral:submit') {
    const targetId = interaction.fields.getTextInputValue('kc4x:referral:user').replace(/\D/g, '');
    if (!targetId || targetId === interaction.user.id) return interaction.reply(eph('Enter a valid different Discord user ID.'));
    const member = await interaction.guild.members.fetch(targetId).catch(() => null);
    if (!member || member.user.bot) return interaction.reply(eph('That user is not a valid human member of this server.'));
    const refId = `REF-${Date.now().toString(36).toUpperCase()}`;
    let existing = false;
    await mutateGuildState(interaction.guildId, async (state) => {
      ensureState(state);
      existing = Object.values(state.referralsV4.referrals).some((r) => r.targetId === targetId);
      if (existing) return;
      state.referralsV4.referrals[refId] = { id: refId, referrerId: interaction.user.id, targetId, status: 'pending', registeredAt: new Date().toISOString() };
      ledger(state, 'referral.registered', interaction.user.id, targetId, { refId });
    });
    return interaction.reply(eph(existing ? 'That member already has a registered referrer.' : `🤝 Referral **${refId}** registered. It qualifies only after **7 days + verification + meaningful activity**.`));
  }

  if (id === 'kc4x:apps:score-submit') {
    if (!isStaff(interaction.member, initial)) return interaction.reply(eph('Staff only.'));
    const applicant = interaction.fields.getTextInputValue('kc4x:apps:applicant').trim();
    const communication = parseScore(interaction.fields.getTextInputValue('kc4x:apps:communication'));
    const experience = parseScore(interaction.fields.getTextInputValue('kc4x:apps:experience'));
    const availability = parseScore(interaction.fields.getTextInputValue('kc4x:apps:availability'));
    const judgement = parseScore(interaction.fields.getTextInputValue('kc4x:apps:judgement'));
    if ([communication, experience, availability, judgement].some((x) => x == null)) return interaction.reply(eph('Every score must be a number from **1 to 10**.'));
    const average = (communication + experience + availability + judgement) / 4;
    const grade = scoreToGrade(average);
    const record = { id: `SC-${Date.now().toString(36).toUpperCase()}`, applicant, communication, experience, availability, judgement, average, grade, reviewerId: interaction.user.id, at: new Date().toISOString() };
    await mutateGuildState(interaction.guildId, async (state) => { ensureState(state); state.applicationMetricsV4.scores.push(record); ledger(state, 'application.scored', interaction.user.id, record.id, { applicant, average, grade }); });
    return interaction.reply({ embeds: [panel(`📊 Application Scorecard • Grade ${grade}`, `**${applicant}** scored **${average.toFixed(1)}/10**`, grade === 'F' || grade === 'D' ? KC4_COLORS.warning : KC4_COLORS.success).addFields(
      metric('Communication', `${communication}/10`), metric('Experience', `${experience}/10`), metric('Availability', `${availability}/10`), metric('Judgement', `${judgement}/10`),
      { name: 'HUMAN DECISION REQUIRED', value: 'This scorecard does **not** accept or reject the applicant. Use the review/decision control after reading the full Google Forms response.' }
    )], flags: MessageFlags.Ephemeral });
  }

  if (id === 'kc4x:treasury:additem-submit') {
    if (!isStaff(interaction.member, initial)) return interaction.reply(eph('Staff only.'));
    const name = interaction.fields.getTextInputValue('kc4x:treasury:name').trim();
    const quantity = Math.max(1, Math.min(9999, Number(interaction.fields.getTextInputValue('kc4x:treasury:qty')) || 1));
    const notes = interaction.fields.getTextInputValue('kc4x:treasury:notes').trim();
    const itemId = `IT-${Date.now().toString(36).toUpperCase()}`;
    await mutateGuildState(interaction.guildId, async (state) => { ensureState(state); state.treasuryV4.items[itemId] = { id: itemId, name, quantity, available: quantity, notes, addedBy: interaction.user.id, createdAt: new Date().toISOString() }; state.treasuryV4.history.push({ type: 'item-added', itemId, at: new Date().toISOString(), actorId: interaction.user.id }); ledger(state, 'treasury.item_added', interaction.user.id, itemId, { name, quantity }); });
    return interaction.reply(eph(`📦 Added **${name}** ×${quantity} as \`${itemId}\`.`));
  }

  if (id === 'kc4x:loan:submit') {
    if (!isStaff(interaction.member, initial)) return interaction.reply(eph('Staff only.'));
    const itemId = interaction.fields.getTextInputValue('kc4x:loan:item').trim();
    const borrowerId = interaction.fields.getTextInputValue('kc4x:loan:user').replace(/\D/g, '');
    const due = interaction.fields.getTextInputValue('kc4x:loan:due').trim();
    let result = null;
    await mutateGuildState(interaction.guildId, async (state) => {
      ensureState(state);
      const item = state.treasuryV4.items[itemId];
      if (!item || (item.available ?? 0) < 1 || !borrowerId) return;
      const loanId = `LN-${Date.now().toString(36).toUpperCase()}`;
      item.available = Math.max(0, (item.available ?? item.quantity ?? 1) - 1);
      state.treasuryV4.loans[loanId] = { id: loanId, itemId, borrowerId, due, status: 'loaned', createdAt: new Date().toISOString(), createdBy: interaction.user.id };
      state.treasuryV4.history.push({ type: 'loan-created', loanId, itemId, borrowerId, at: new Date().toISOString(), actorId: interaction.user.id });
      ledger(state, 'treasury.loan_created', interaction.user.id, loanId, { itemId, borrowerId, due });
      result = loanId;
    });
    return interaction.reply(eph(result ? `🤝 Loan **${result}** created for <@${borrowerId}>.` : 'Could not create the loan. Check the item ID, availability and borrower ID.'));
  }

  if (id === 'kc4x:market:search-submit') {
    const query = interaction.fields.getTextInputValue('kc4x:market:query').trim();
    const results = marketSearch(initial, query);
    return interaction.reply({ embeds: [panel(`🔎 Market Search • ${query}`, results.length ? results.map((x) => `**${x.item}** • ${x.price}\n└ <@${x.sellerId}>${x.notes ? ` • ${x.notes}` : ''}`).join('\n\n') : empty('No active listing matched those keywords.'), KC4_COLORS.economy)], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  }

  if (id === 'kc4x:watch:submit') {
    const query = interaction.fields.getTextInputValue('kc4x:watch:query').trim();
    await mutateGuildState(interaction.guildId, async (state) => { ensureState(state); state.marketV4.watchlists[interaction.user.id] ??= []; if (!state.marketV4.watchlists[interaction.user.id].some((x) => x.toLowerCase() === query.toLowerCase())) state.marketV4.watchlists[interaction.user.id].push(query); ledger(state, 'market.watch_created', interaction.user.id, null, { query }); });
    return interaction.reply(eph(`🔔 Watching the marketplace for **${query}**.`));
  }
  return false;
}
