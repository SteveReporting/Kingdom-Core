import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits
} from 'discord.js';
import { APPROVED_V4_NUMBERS, APPROVED_V4_SYSTEMS } from '../config/approvedSystemsV4.js';
import { BRAND, STAFF_KEYS } from '../config/blueprint.js';
import { readGuildState, writeGuildState } from '../storage/store.js';
import { auditDigitalTwin, captureDigitalTwin } from './securityV4.js';

export const PLATFORM_V5_SCHEMA = 5;
export const PLATFORM_V5_RELEASE = '5.0-approved-roadmap';

const REQUIRED_FEATURES = {
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
  carrierCoverage: true,
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
  controlPlane: true,
  staging: true
};

const V5_WORKFLOWS = [
  { id: 'v5-carry-request', event: 'carry.requested', actions: ['group-compatible', 'demand-index', 'queue-eta', 'notifications'], enabled: true },
  { id: 'v5-carry-complete', event: 'carry.completed', actions: ['member-xp', 'carrier-service', 'reputation', 'house-xp', 'kingdom-xp', 'quests', 'analytics'], enabled: true },
  { id: 'v5-carry-recovery', event: 'carry.interrupted', actions: ['preserve-party', 'return-to-pool', 'dispatch-replacement'], enabled: true },
  { id: 'v5-referral-quality', event: 'maintenance', actions: ['verify-age', 'verify-member', 'verify-activity', 'award-qualified-referral'], enabled: true },
  { id: 'v5-market-watch', event: 'market.listed', actions: ['match-watchlists', 'notify-subscribers', 'market-index'], enabled: true },
  { id: 'v5-ticket-ops', event: 'ticket.updated', actions: ['ownership', 'sla', 'escalation', 'summary', 'analytics'], enabled: true },
  { id: 'v5-security-drift', event: 'maintenance', actions: ['audit-digital-twin', 'risk-score', 'repair-critical-drift'], enabled: true },
  { id: 'v5-analytics', event: 'maintenance', actions: ['retention', 'funnels', 'forecast-demand', 'carrier-coverage'], enabled: true }
];

function staffOverwrites(guild, state) {
  const rows = [{
    id: guild.roles.everyone.id,
    allow: [PermissionFlagsBits.ReadMessageHistory],
    deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
  }];
  for (const key of STAFF_KEYS) {
    const id = state.setup?.roles?.[key];
    if (!id) continue;
    rows.push({
      id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
      deny: [PermissionFlagsBits.SendMessages]
    });
  }
  return rows;
}

function ensureV5State(state) {
  state.platform ??= {};
  state.platform.schemaVersion = PLATFORM_V5_SCHEMA;
  state.platform.release = PLATFORM_V5_RELEASE;
  state.platform.updatedAt = new Date().toISOString();
  state.platform.migrations ??= [];
  if (!state.platform.migrations.includes('v5-approved-roadmap')) state.platform.migrations.push('v5-approved-roadmap');
  state.platform.featureFlags = { ...(state.platform.featureFlags ?? {}), ...REQUIRED_FEATURES };
  state.platform.workflows ??= [];
  const byId = new Map(state.platform.workflows.map((w) => [w.id, w]));
  for (const workflow of V5_WORKFLOWS) byId.set(workflow.id, { ...byId.get(workflow.id), ...workflow });
  state.platform.workflows = [...byId.values()];

  state.platform.v5 ??= {};
  state.platform.v5.installedAt ??= new Date().toISOString();
  state.platform.v5.updatedAt = new Date().toISOString();
  state.platform.v5.approvedNumbers = [...APPROVED_V4_NUMBERS];
  state.platform.v5.approvedCount = APPROVED_V4_NUMBERS.length;
  state.platform.v5.systems = Object.fromEntries(
    APPROVED_V4_NUMBERS.map((number) => [number, {
      number,
      name: APPROVED_V4_SYSTEMS[number][0],
      implementation: APPROVED_V4_SYSTEMS[number][1],
      enabled: true
    }])
  );

  state.identities ??= {};
  state.carrierOps ??= {};
  state.carrierOps.profiles ??= {};
  state.carrierOps.shifts ??= {};
  state.carrierOps.commendations ??= [];
  state.carrierOps.certifications ??= {};
  state.carrierOps.academy ??= {};
  state.kingdom ??= { level: 1, xp: 0, stage: 'Settlement' };
  state.questsV4 ??= { daily: [], weekly: [], community: [], completed: {} };
  state.treasuryV4 ??= { items: {}, loans: {}, requests: {}, history: [] };
  state.marketV4 ??= { listings: {}, history: [], watchlists: {}, priceIndex: {} };
  state.applicationMetricsV4 ??= { scores: [], reviewTimesMs: [] };
  state.ticketMetricsV4 ??= { claimed: {}, firstResponse: {}, escalations: {}, summaries: {}, closed: 0 };
  state.analyticsV4 ??= { events: [], daily: {}, funnels: {}, retention: {}, demand: {}, forecasts: {} };
  state.securityV4 ??= { riskScore: 0, state: 'NORMAL', approvedBots: [], webhookRegistry: {}, incidents: [], snapshots: [], drift: [], lockdown: { active: false, previous: {} } };
  state.notificationsV4 ??= { subscriptions: {}, digest: {} };
  state.eventsV4 ??= { events: {}, attendance: {}, scheduled: {} };
  state.mentorsV4 ??= { mentors: {}, matches: {} };
  state.referralsV4 ??= { referrals: {}, qualified: {} };
  state.systemV4 ??= { health: {}, errors: [] };
}

function coverage(state, guild) {
  const exists = (key) => Boolean(state.setup?.channels?.[key] && guild.channels.cache.has(state.setup.channels[key]));
  const groups = {
    carries: Boolean(state.setup?.channels?.carryQueue && state.setup?.categories?.carryTickets),
    knights: exists('carrierCommandPremiumV4') || exists('academyV4'),
    kingdom: exists('memberDashboardPremiumV4') || exists('kingdomProgressV4Channel'),
    economy: exists('economyPremiumV4') || (exists('treasuryV4') && exists('marketplaceV4')),
    staff: exists('staffControlPremiumV4') || exists('commandCenterV4'),
    applicationsTickets: (exists('applicationPremiumV4') || exists('applicationAnalyticsV4')) && (exists('ticketPremiumV4') || exists('ticketOperationsV4')),
    security: exists('securityPremiumV4') || exists('securityOperationsV4'),
    analytics: exists('analyticsPremiumV4') || exists('analyticsV4')
  };
  const passed = Object.values(groups).filter(Boolean).length;
  return { groups, passed, total: Object.keys(groups).length };
}

function dashboardPayload(state, guild) {
  const c = coverage(state, guild);
  const drift = state.securityV4?.drift?.length ?? 0;
  const activeFlags = Object.values(state.platform?.featureFlags ?? {}).filter(Boolean).length;
  const rows = Object.entries(c.groups).map(([name, ok]) => `${ok ? '✅' : '❌'} **${name.replace(/([A-Z])/g, ' $1')}**`).join('\n');
  const embed = new EmbedBuilder()
    .setColor(c.passed === c.total && drift === 0 ? 0x57f287 : BRAND.color)
    .setTitle('👑 KINGDOM CORE v5 • Platform Assurance')
    .setDescription([
      '**The approved Kingdom Carries roadmap is installed as one connected operating platform.**',
      'This panel verifies the major live surfaces and gives staff direct access to assurance/repair controls.',
      '',
      rows
    ].join('\n'))
    .addFields(
      { name: 'Approved Systems', value: `**${state.platform?.v5?.approvedCount ?? APPROVED_V4_NUMBERS.length}** roadmap systems`, inline: true },
      { name: 'Platform Coverage', value: `**${c.passed}/${c.total}** major domains`, inline: true },
      { name: 'Feature Flags', value: `**${activeFlags}** enabled`, inline: true },
      { name: 'Digital Twin', value: `**${drift}** drift finding${drift === 1 ? '' : 's'}`, inline: true },
      { name: 'Schema', value: `**v${state.platform?.schemaVersion ?? PLATFORM_V5_SCHEMA}**`, inline: true },
      { name: 'Release', value: `\`${state.platform?.release ?? PLATFORM_V5_RELEASE}\``, inline: true }
    )
    .setFooter({ text: 'Kingdom Core v5 • Carries, Knights, Kingdom, staff and security share one source of truth.' })
    .setTimestamp();

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('kc4x:test:integration').setLabel('Integration Test').setEmoji('🧪').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('kc4x:test:permissions').setLabel('Permission Test').setEmoji('🔐').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('kc4:security:audit').setLabel('Audit Drift').setEmoji('🪞').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('kc4:system:health').setLabel('Diagnostics').setEmoji('💓').setStyle(ButtonStyle.Success)
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('kc4x:workflow:run').setLabel('Run Workflows').setEmoji('▶️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('kc4:security:snapshot').setLabel('Snapshot').setEmoji('📸').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('kc4:security:repair').setLabel('Repair Drift').setEmoji('🛠️').setStyle(ButtonStyle.Success)
  );
  return { embeds: [embed], components: [row1, row2], allowedMentions: { parse: [] } };
}

async function upsertDashboard(guild, state) {
  state.setup ??= {};
  state.setup.channels ??= {};
  state.setup.panels ??= {};
  const parentId = state.setup?.categories?.platformSystemV4
    ?? state.setup?.categories?.security
    ?? state.setup?.categories?.staff
    ?? null;

  let channel = guild.channels.cache.get(state.setup.channels.platformV5Control);
  if (!channel || channel.type !== ChannelType.GuildText) {
    channel = guild.channels.cache.find((c) => c.type === ChannelType.GuildText && c.name === '👑・v5-control-plane');
  }
  if (!channel) {
    channel = await guild.channels.create({
      name: '👑・v5-control-plane',
      type: ChannelType.GuildText,
      parent: parentId,
      permissionOverwrites: staffOverwrites(guild, state),
      reason: 'Kingdom Core /setup5 platform assurance channel'
    });
  } else {
    if (parentId && channel.parentId !== parentId) await channel.setParent(parentId, { lockPermissions: false }).catch(() => null);
    await channel.permissionOverwrites.set(staffOverwrites(guild, state), 'Kingdom Core v5 staff control permissions').catch(() => null);
  }
  state.setup.channels.platformV5Control = channel.id;

  let message = state.setup.panels.platformV5Control
    ? await channel.messages.fetch(state.setup.panels.platformV5Control).catch(() => null)
    : null;
  const payload = dashboardPayload(state, guild);
  if (message) await message.edit(payload).catch(() => null);
  else {
    message = await channel.send(payload);
    state.setup.panels.platformV5Control = message.id;
  }
  if (!message.pinned) await message.pin('Kingdom Core v5 platform assurance').catch(() => null);
  return channel;
}

export async function installPlatformV5(guild) {
  await guild.channels.fetch();
  await guild.roles.fetch();
  const state = await readGuildState(guild.id);
  ensureV5State(state);
  await upsertDashboard(guild, state);
  await writeGuildState(guild.id, state);
  return {
    schemaVersion: PLATFORM_V5_SCHEMA,
    approved: APPROVED_V4_NUMBERS.length,
    coverage: coverage(state, guild)
  };
}

export async function finalizePlatformV5(guild) {
  await guild.channels.fetch();
  await guild.roles.fetch();
  const state = await readGuildState(guild.id);
  ensureV5State(state);
  state.securityV4 ??= {};
  state.securityV4.snapshots ??= [];
  const snapshot = await captureDigitalTwin(guild, state);
  state.securityV4.snapshots.push(snapshot);
  if (state.securityV4.snapshots.length > 12) state.securityV4.snapshots = state.securityV4.snapshots.slice(-12);
  const findings = await auditDigitalTwin(guild, state).catch(() => []);
  state.securityV4.drift = findings;
  state.platform.v5.lastVerifiedAt = new Date().toISOString();
  state.platform.v5.lastCoverage = coverage(state, guild);
  state.platform.v5.lastSnapshotId = snapshot.id;
  await upsertDashboard(guild, state);
  await writeGuildState(guild.id, state);
  return {
    snapshotId: snapshot.id,
    drift: findings.length,
    coverage: state.platform.v5.lastCoverage,
    approved: APPROVED_V4_NUMBERS.length
  };
}
