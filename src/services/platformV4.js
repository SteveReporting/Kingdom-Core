import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder
} from 'discord.js';
import { BRAND, CARRIER_KEYS, ROLE_BLUEPRINT, STAFF_KEYS } from '../config/blueprint.js';
import { readGuildState, writeGuildState } from '../storage/store.js';
import { captureDigitalTwin, scanWebhookRegistry } from './securityV4.js';

export const PLATFORM_SCHEMA = 4;

const ALL_ROLE_KEYS = ROLE_BLUEPRINT.map((x) => x.key);
const STAFF_AND_CARRIERS = [...new Set([...STAFF_KEYS, ...CARRIER_KEYS])];

const FEATURES = {
  groupedCarries: true,
  joinableCarries: true,
  demandHeatmap: true,
  queueEstimates: true,
  carrierServiceTime: true,
  carrierReputation: true,
  carrierCommendations: true,
  missionStateMachine: true,
  missionRecovery: true,
  reliabilityTracking: true,
  kingdomProgression: true,
  houseCompetition: true,
  questEngine: true,
  prestige: true,
  treasuryLedger: true,
  treasuryApprovals: true,
  itemLoans: true,
  marketplace: true,
  marketplaceSearch: true,
  watchlists: true,
  applicationWorkflow: true,
  applicationScoring: true,
  applicationAnalytics: true,
  staffCommandCenter: true,
  unifiedTickets: true,
  ticketOwnership: true,
  ticketSla: true,
  ticketEscalation: true,
  ticketSummaries: true,
  auditLedger: true,
  permissionDrift: true,
  botRegistry: true,
  webhookRegistry: true,
  securityRisk: true,
  autoLockdown: true,
  memberIdentity: true,
  liveStatistics: true,
  operationsDashboard: true,
  publicApi: true,
  realtimeApi: true,
  notificationRouter: true,
  scheduledEvents: true,
  referrals: true,
  mentorNetwork: true,
  royalArchives: true,
  knowledgeSearch: true,
  analytics: true,
  retentionAnalytics: true,
  funnelAnalytics: true,
  demandForecasting: true,
  featureFlags: true,
  configuration: true,
  workflowEngine: true,
  eventBus: true,
  internalApi: true,
  observability: true,
  selfDiagnostics: true,
  automaticRepair: true,
  configVersioning: true,
  integrationTests: true,
  permissionTests: true,
  digitalTwin: true,
  controlPlane: true
};

const CATEGORY_DEFS = [
  { key: 'kingdomCommandV4', name: '━━ 👑 KINGDOM COMMAND ━━', access: 'staff' },
  { key: 'knightAcademyV4', name: '━━ ⚔️ KNIGHT ACADEMY ━━', access: 'carrier' },
  { key: 'kingdomProgressV4', name: '━━ 🏰 KINGDOM PROGRESSION ━━', access: 'public' },
  { key: 'royalEconomyV4', name: '━━ 🏦 ROYAL ECONOMY ━━', access: 'public' },
  { key: 'platformSystemV4', name: '━━ ⚙️ KINGDOM CORE SYSTEM ━━', access: 'staff' }
];

const CHANNEL_DEFS = [
  ['commandCenterV4', '👑・kingdom-command', 'kingdomCommandV4', 'staff'],
  ['applicationAnalyticsV4', '📨・application-analytics', 'kingdomCommandV4', 'staff'],
  ['ticketOperationsV4', '🕯️・ticket-operations', 'kingdomCommandV4', 'staff'],
  ['securityOperationsV4', '🛡️・security-command', 'kingdomCommandV4', 'staff'],
  ['analyticsV4', '📊・kingdom-analytics', 'kingdomCommandV4', 'staff'],

  ['academyV4', '🎓・knight-academy', 'knightAcademyV4', 'carrier'],
  ['serviceV4', '⏱️・verified-service', 'knightAcademyV4', 'carrier'],
  ['reputationV4', '🏅・knight-reputation', 'knightAcademyV4', 'carrier'],
  ['certificationsV4', '📜・certifications', 'knightAcademyV4', 'carrier'],

  ['identityV4', '🪪・kingdom-profile', 'kingdomProgressV4', 'public'],
  ['kingdomProgressV4Channel', '🏰・kingdom-progress', 'kingdomProgressV4', 'public'],
  ['houseWarV4', '⚔️・house-war', 'kingdomProgressV4', 'public'],
  ['questEngineV4', '📜・quest-engine', 'kingdomProgressV4', 'public'],
  ['prestigeV4', '✨・prestige', 'kingdomProgressV4', 'public'],

  ['treasuryV4', '🏦・royal-treasury', 'royalEconomyV4', 'public'],
  ['treasuryRequestsV4', '📥・treasury-requests', 'royalEconomyV4', 'staff'],
  ['marketplaceV4', '🏪・marketplace-live', 'royalEconomyV4', 'public'],
  ['marketIntelV4', '📈・market-intelligence', 'royalEconomyV4', 'public'],

  ['systemHealthV4', '💓・system-health', 'platformSystemV4', 'staff'],
  ['digitalTwinV4', '🪞・digital-twin', 'platformSystemV4', 'staff'],
  ['auditLedgerV4', '📚・audit-ledger', 'platformSystemV4', 'staff'],
  ['featureFlagsV4', '🚩・feature-flags', 'platformSystemV4', 'staff']
];

function branded(title, color = BRAND.color) {
  return new EmbedBuilder().setColor(color).setTitle(title).setFooter({ text: BRAND.footer }).setTimestamp();
}

function roleOverwrites(guild, state, mode) {
  const ids = state.setup?.roles ?? {};
  const staff = new Set(STAFF_KEYS);
  const carriers = new Set(CARRIER_KEYS);
  const allowed = mode === 'staff' ? staff : mode === 'carrier' ? new Set([...staff, ...carriers]) : null;
  const rows = [{
    id: guild.roles.everyone.id,
    allow: mode === 'public'
      ? [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory]
      : [PermissionFlagsBits.ReadMessageHistory],
    deny: mode === 'public' ? [] : [PermissionFlagsBits.ViewChannel]
  }];

  for (const key of ALL_ROLE_KEYS) {
    const id = ids[key];
    if (!id) continue;
    if (mode === 'public') {
      rows.push({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] });
    } else if (allowed.has(key)) {
      rows.push({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages] });
    } else {
      rows.push({ id, allow: [PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.ViewChannel] });
    }
  }
  return rows;
}

async function ensureCategory(guild, state, def) {
  state.setup.categories ??= {};
  let category = guild.channels.cache.get(state.setup.categories[def.key]);
  if (!category || category.type !== ChannelType.GuildCategory) {
    category = guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name === def.name);
  }
  let created = false;
  if (!category) {
    category = await guild.channels.create({
      name: def.name,
      type: ChannelType.GuildCategory,
      permissionOverwrites: roleOverwrites(guild, state, def.access),
      reason: 'Kingdom Core /setup4 platform category'
    });
    created = true;
  } else {
    await category.permissionOverwrites.set(roleOverwrites(guild, state, def.access), 'Kingdom Core /setup4 permissions').catch(() => null);
  }
  state.setup.categories[def.key] = category.id;
  return { category, created };
}

async function ensureChannel(guild, state, [key, name, categoryKey, access]) {
  state.setup.channels ??= {};
  let channel = guild.channels.cache.get(state.setup.channels[key]);
  if (!channel || channel.type !== ChannelType.GuildText) {
    channel = guild.channels.cache.find((c) => c.type === ChannelType.GuildText && c.name === name);
  }
  let created = false;
  if (!channel) {
    channel = await guild.channels.create({
      name,
      type: ChannelType.GuildText,
      parent: state.setup.categories[categoryKey],
      permissionOverwrites: roleOverwrites(guild, state, access),
      reason: 'Kingdom Core /setup4 platform channel'
    });
    created = true;
  } else {
    if (channel.parentId !== state.setup.categories[categoryKey]) {
      await channel.setParent(state.setup.categories[categoryKey], { lockPermissions: false }).catch(() => null);
    }
    await channel.permissionOverwrites.set(roleOverwrites(guild, state, access), 'Kingdom Core /setup4 permissions').catch(() => null);
  }
  state.setup.channels[key] = channel.id;
  return { channel, created };
}

function ensureState(state) {
  state.platform ??= {};
  state.platform.schemaVersion = PLATFORM_SCHEMA;
  state.platform.migrations ??= [];
  if (!state.platform.migrations.includes('v4-platform')) state.platform.migrations.push('v4-platform');
  state.platform.featureFlags = { ...FEATURES, ...(state.platform.featureFlags ?? {}) };
  state.platform.installedAt ??= new Date().toISOString();
  state.platform.updatedAt = new Date().toISOString();

  state.identities ??= {};
  state.carrierOps ??= { profiles: {}, shifts: {}, commendations: [], certifications: {}, academy: {} };
  state.carrierOps.profiles ??= {};
  state.carrierOps.shifts ??= {};
  state.carrierOps.commendations ??= [];
  state.carrierOps.certifications ??= {};
  state.carrierOps.academy ??= {};

  state.kingdom ??= {};
  state.kingdom.level ??= 1;
  state.kingdom.xp ??= 0;
  state.kingdom.stage ??= 'Settlement';
  state.kingdom.houses ??= {
    drakon: { name: 'House Drakon', xp: 0, wins: 0 },
    leonis: { name: 'House Leonis', xp: 0, wins: 0 },
    aether: { name: 'House Aether', xp: 0, wins: 0 },
    fenrir: { name: 'House Fenrir', xp: 0, wins: 0 }
  };

  state.questsV4 ??= { daily: [], weekly: [], community: [], completed: {}, generatedAt: null };
  state.treasuryV4 ??= { items: {}, loans: {}, requests: {}, history: [] };
  state.marketV4 ??= { listings: {}, history: [], watchlists: {}, priceIndex: {} };
  state.applicationMetricsV4 ??= { reviews: 0, accepted: 0, denied: 0, interview: 0, pending: 0, reviewTimesMs: [] };
  state.ticketMetricsV4 ??= { claimed: {}, firstResponse: {}, escalations: {}, summaries: {}, closed: 0 };
  state.analyticsV4 ??= { events: [], daily: {}, funnels: {}, retention: {}, demand: {}, forecasts: {} };
  state.securityV4 ??= {
    riskScore: 0,
    state: 'NORMAL',
    approvedBots: [],
    webhookRegistry: {},
    incidents: [],
    snapshots: [],
    drift: [],
    lockdown: { active: false, previous: {} },
    autoLockdownThreshold: 90
  };
  state.workflowsV4 ??= [];
  state.notificationsV4 ??= { subscriptions: {}, digest: {} };
  state.mentorsV4 ??= { mentors: {}, matches: {} };
  state.eventsV4 ??= { events: {}, attendance: {}, scheduled: {} };
  state.referralsV4 ??= { referrals: {}, qualified: {} };
  state.systemV4 ??= { health: {}, errors: [], lastMaintenanceAt: null };
}

function activeCarryStats(state) {
  const tickets = Object.values(state.carryTickets ?? {});
  const active = tickets.filter((x) => ['open', 'claimed', 'ready', 'running'].includes(x.status));
  const waiting = active.filter((x) => x.status === 'open');
  const running = active.filter((x) => x.status === 'running');
  const peopleWaiting = waiting.reduce((n, x) => n + (x.members?.length ?? 1), 0);
  const demand = {};
  for (const t of active) demand[t.dungeon] = (demand[t.dungeon] ?? 0) + (t.members?.length ?? 1);
  const hottest = Object.entries(demand).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const completed = tickets.filter((x) => x.status === 'completed' && x.startedAt && x.completedAt);
  const avg = completed.length
    ? completed.reduce((sum, x) => sum + Math.max(0, new Date(x.completedAt) - new Date(x.startedAt)), 0) / completed.length
    : 0;
  const estimatedWaitMinutes = Math.max(1, Math.round((peopleWaiting * Math.max(avg, 8 * 60_000)) / Math.max(1, running.length + 1) / 60_000));
  return { active, waiting, running, peopleWaiting, hottest, avgMs: avg, estimatedWaitMinutes };
}

export function commandCenterPayload(state) {
  const c = activeCarryStats(state);
  const apps = state.externalApplicationReviews ?? [];
  const openTickets = Object.values(state.tickets ?? {}).filter((x) => !['closed', 'resolved'].includes(x.status)).length;
  const risk = state.securityV4?.riskScore ?? 0;
  return {
    embeds: [branded('👑 KINGDOM COMMAND • Operations Control', 0x5865f2)
      .setDescription('**One operational surface for Kingdom Carries.**\nCarries, Knights, applications, tickets, security, progression and system health are connected to the same platform state.')
      .addFields(
        { name: '⚔️ Carry Operations', value: `**${c.peopleWaiting}** waiting • **${c.running.length}** running\nETA ~ **${c.estimatedWaitMinutes}m**`, inline: true },
        { name: '📨 Applications', value: `**${apps.length}** reviews logged`, inline: true },
        { name: '🕯️ Support', value: `**${openTickets}** open tickets`, inline: true },
        { name: '🏰 Kingdom', value: `**${state.kingdom?.stage ?? 'Settlement'}** • Lvl **${state.kingdom?.level ?? 1}**\n${state.kingdom?.xp ?? 0} XP`, inline: true },
        { name: '🛡️ Security', value: `**${state.securityV4?.state ?? 'NORMAL'}** • Risk **${risk}/100**`, inline: true },
        { name: '⚙️ Schema', value: `Platform **v${state.platform?.schemaVersion ?? 4}**`, inline: true }
      )],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('kc4:ops:refresh').setLabel('Refresh Command').setEmoji('🔄').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('kc4:ops:demand').setLabel('Demand Intelligence').setEmoji('📊').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('kc4:ops:applications').setLabel('Application Metrics').setEmoji('📨').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('kc4:ops:tickets').setLabel('Ticket Metrics').setEmoji('🕯️').setStyle(ButtonStyle.Secondary)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('kc4:system:health').setLabel('System Health').setEmoji('💓').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('kc4:security:audit').setLabel('Audit Drift').setEmoji('🪞').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('kc4:security:snapshot').setLabel('Create Snapshot').setEmoji('📸').setStyle(ButtonStyle.Secondary)
      )
    ],
    allowedMentions: { parse: [] }
  };
}

function academyPayload(state) {
  const profiles = Object.values(state.carrierOps?.profiles ?? {});
  const onDuty = profiles.filter((x) => x.status === 'available' || x.shiftStartedAt).length;
  const helped = profiles.reduce((n, x) => n + (x.playersHelped ?? 0), 0);
  return {
    embeds: [branded('🎓 KNIGHT ACADEMY • Carrier Development')
      .setDescription([
        '**Carrier progression is now tracked as an operating system, not a role list.**',
        '',
        'Academy → supervised service → certification → Knight progression → service/reputation history.',
        'Verified service time measures actual wall-clock carrying time; grouped parties count time once, not once per player.'
      ].join('\n'))
      .addFields(
        { name: 'Registered Knights', value: `**${profiles.length}**`, inline: true },
        { name: 'On Duty', value: `**${onDuty}**`, inline: true },
        { name: 'Players Helped', value: `**${helped}**`, inline: true }
      )],
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId('kc4:carrier:status').setPlaceholder('Set carrier duty status').addOptions(
          { label: 'Available', value: 'available', emoji: '🟢', description: 'Ready for missions' },
          { label: 'Finishing Run', value: 'busy', emoji: '🟡', description: 'Do not dispatch another mission yet' },
          { label: 'Off Duty', value: 'off', emoji: '🔴', description: 'Unavailable for carries' }
        )
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('kc4:carrier:shift').setLabel('Start / Stop Service').setEmoji('⏱️').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('kc4:carrier:profile').setLabel('My Knight Profile').setEmoji('🛡️').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('kc4:carrier:academy').setLabel('Academy Progress').setEmoji('🎓').setStyle(ButtonStyle.Secondary)
      )
    ],
    allowedMentions: { parse: [] }
  };
}

function kingdomPayload(state) {
  const houses = state.kingdom?.houses ?? {};
  const houseText = Object.values(houses).sort((a, b) => (b.xp ?? 0) - (a.xp ?? 0)).map((h, i) => `**${i + 1}. ${h.name}** — ${h.xp ?? 0} XP`).join('\n');
  return {
    embeds: [branded('🏰 KINGDOM PROGRESSION • The Realm Evolves')
      .setDescription(`**${state.kingdom?.stage ?? 'Settlement'} • Kingdom Level ${state.kingdom?.level ?? 1}**\n\nGuild activity now feeds one shared progression system: carries, quests, events, mentorship, House contribution and service.`)
      .addFields(
        { name: 'Kingdom XP', value: `**${state.kingdom?.xp ?? 0}**`, inline: true },
        { name: 'Prestige', value: `Seasonal + personal prestige enabled`, inline: true },
        { name: 'House Standings', value: houseText || '_No House activity yet._' }
      )],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('kc4:profile:self').setLabel('My Kingdom Profile').setEmoji('🪪').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('kc4:quests:mine').setLabel('My Quests').setEmoji('📜').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('kc4:houses:standings').setLabel('House Standings').setEmoji('⚔️').setStyle(ButtonStyle.Secondary)
    )],
    allowedMentions: { parse: [] }
  };
}

function treasuryPayload(state) {
  const openLoans = Object.values(state.treasuryV4?.loans ?? {}).filter((x) => x.status === 'loaned').length;
  const listings = Object.values(state.marketV4?.listings ?? {}).filter((x) => x.status === 'active').length;
  return {
    embeds: [branded('🏦 ROYAL ECONOMY • Treasury + Marketplace')
      .setDescription('Treasury items, lending, approvals and marketplace listings are now recorded as auditable objects instead of loose Discord messages.')
      .addFields(
        { name: 'Treasury Items', value: `**${Object.keys(state.treasuryV4?.items ?? {}).length}**`, inline: true },
        { name: 'Active Loans', value: `**${openLoans}**`, inline: true },
        { name: 'Market Listings', value: `**${listings}**`, inline: true }
      )],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('kc4:treasury:request').setLabel('Request Treasury Item').setEmoji('🏦').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('kc4:market:create').setLabel('Create Listing').setEmoji('🏪').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('kc4:market:browse').setLabel('Browse Market').setEmoji('🔎').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('kc4:market:intel').setLabel('Price Intelligence').setEmoji('📈').setStyle(ButtonStyle.Secondary)
    )],
    allowedMentions: { parse: [] }
  };
}

function securityPayload(state) {
  const sec = state.securityV4 ?? {};
  return {
    embeds: [branded('🛡️ KINGDOM SECURITY • Control Plane', sec.state === 'LOCKDOWN' ? 0xed4245 : 0x5865f2)
      .setDescription('Risk scoring, permission drift, bot/webhook registry, snapshots and incident state are unified here.')
      .addFields(
        { name: 'Security State', value: `**${sec.state ?? 'NORMAL'}**`, inline: true },
        { name: 'Risk', value: `**${sec.riskScore ?? 0}/100**`, inline: true },
        { name: 'Approved Bots', value: `**${sec.approvedBots?.length ?? 0}**`, inline: true },
        { name: 'Snapshots', value: `**${sec.snapshots?.length ?? 0}**`, inline: true },
        { name: 'Drift Findings', value: `**${sec.drift?.length ?? 0}**`, inline: true },
        { name: 'Lockdown', value: sec.lockdown?.active ? '**ACTIVE**' : 'Inactive', inline: true }
      )],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('kc4:security:audit').setLabel('Audit Drift').setEmoji('🪞').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('kc4:security:repair').setLabel('Repair Drift').setEmoji('🛠️').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('kc4:security:snapshot').setLabel('Snapshot').setEmoji('📸').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('kc4:security:registry').setLabel('Registries').setEmoji('📚').setStyle(ButtonStyle.Secondary)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(sec.lockdown?.active ? 'kc4:security:unlock' : 'kc4:security:lockdown')
          .setLabel(sec.lockdown?.active ? 'End Lockdown' : 'Emergency Lockdown')
          .setEmoji(sec.lockdown?.active ? '🔓' : '🚨')
          .setStyle(sec.lockdown?.active ? ButtonStyle.Success : ButtonStyle.Danger)
      )
    ],
    allowedMentions: { parse: [] }
  };
}

function systemPayload(state) {
  const flags = Object.entries(state.platform?.featureFlags ?? {}).filter(([, on]) => on).length;
  return {
    embeds: [branded('💓 KINGDOM CORE • Platform Health', 0x57f287)
      .setDescription('The bot is now treated as a versioned control plane. `/setup4` is a migration, not a destructive rebuild.')
      .addFields(
        { name: 'Schema', value: `**v${state.platform?.schemaVersion ?? PLATFORM_SCHEMA}**`, inline: true },
        { name: 'Feature Flags', value: `**${flags} enabled**`, inline: true },
        { name: 'Storage', value: '**JSON fallback active**\nExternal DB adapters can be enabled separately.', inline: true },
        { name: 'API', value: process.env.ENABLE_PLATFORM_API === 'true' ? '**Enabled**' : 'Disabled', inline: true },
        { name: 'Real-time', value: process.env.ENABLE_PLATFORM_API === 'true' ? '**WebSocket enabled**' : 'Disabled', inline: true },
        { name: 'Last Maintenance', value: state.systemV4?.lastMaintenanceAt ? `<t:${Math.floor(new Date(state.systemV4.lastMaintenanceAt).getTime() / 1000)}:R>` : 'Not yet', inline: true }
      )],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('kc4:system:health').setLabel('Run Diagnostics').setEmoji('🩺').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('kc4:system:flags').setLabel('Feature Flags').setEmoji('🚩').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('kc4:system:repair').setLabel('Self Repair').setEmoji('🛠️').setStyle(ButtonStyle.Success)
    )],
    allowedMentions: { parse: [] }
  };
}

async function upsertPinned(channel, state, key, payload) {
  if (!channel?.isTextBased()) return null;
  state.setup.panels ??= {};
  let msg = state.setup.panels[key] ? await channel.messages.fetch(state.setup.panels[key]).catch(() => null) : null;
  if (msg) await msg.edit(payload).catch(() => null);
  else {
    msg = await channel.send(payload);
    state.setup.panels[key] = msg.id;
  }
  if (!msg.pinned) await msg.pin('Kingdom Core /setup4 control panel').catch(() => null);
  return msg;
}

export async function refreshV4Panels(guild, state) {
  const c = (key) => guild.channels.cache.get(state.setup?.channels?.[key]);
  await upsertPinned(c('commandCenterV4'), state, 'commandCenterV4', commandCenterPayload(state));
  await upsertPinned(c('academyV4'), state, 'academyV4', academyPayload(state));
  await upsertPinned(c('kingdomProgressV4Channel'), state, 'kingdomProgressV4', kingdomPayload(state));
  await upsertPinned(c('treasuryV4'), state, 'treasuryV4', treasuryPayload(state));
  await upsertPinned(c('securityOperationsV4'), state, 'securityV4', securityPayload(state));
  await upsertPinned(c('systemHealthV4'), state, 'systemV4', systemPayload(state));
}

export async function installPlatformV4(guild, onProgress = async () => {}) {
  await guild.roles.fetch();
  await guild.channels.fetch();
  const state = await readGuildState(guild.id);
  state.setup ??= {};
  if (!state.setup.completedAt) throw new Error('Run /setup before /setup4.');
  ensureState(state);

  const summary = { categoriesCreated: 0, channelsCreated: 0, panels: 0, approvedBots: 0, webhooks: 0 };
  await onProgress('Creating the Kingdom Core v4 control-plane categories…');
  for (const def of CATEGORY_DEFS) {
    const result = await ensureCategory(guild, state, def);
    summary.categoriesCreated += Number(result.created);
  }

  await onProgress('Creating command, academy, progression, economy and system channels…');
  for (const def of CHANNEL_DEFS) {
    const result = await ensureChannel(guild, state, def);
    summary.channelsCreated += Number(result.created);
  }

  await onProgress('Registering trusted bots, webhooks and the initial digital twin…');
  if (String(process.env.ENABLE_MEMBER_STATS_INTENT).toLowerCase() === 'true') await guild.members.fetch().catch(() => null);
  state.securityV4.approvedBots = [...guild.members.cache.values()].filter((m) => m.user.bot).map((m) => m.id);
  summary.approvedBots = state.securityV4.approvedBots.length;
  state.securityV4.webhookRegistry = await scanWebhookRegistry(guild);
  summary.webhooks = Object.keys(state.securityV4.webhookRegistry).length;
  state.securityV4.snapshots.push(await captureDigitalTwin(guild, state));
  if (state.securityV4.snapshots.length > 10) state.securityV4.snapshots = state.securityV4.snapshots.slice(-10);

  await onProgress('Publishing premium operating dashboards…');
  await refreshV4Panels(guild, state);
  summary.panels = 6;

  state.setup.version = Math.max(Number(state.setup.version ?? 0), 5);
  state.setup.setup4At = new Date().toISOString();
  state.systemV4.lastMaintenanceAt = new Date().toISOString();
  await writeGuildState(guild.id, state);
  return { summary, state };
}
