import os from 'node:os';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits
} from 'discord.js';
import {
  APPROVED_V10_NUMBERS,
  APPROVED_V10_SYSTEMS,
  V10_DOMAINS,
  V10_ENGINE_KEYS,
  V10_FEATURE_COUNT
} from '../config/approvedSystemsV10.js';
import { BRAND, STAFF_KEYS } from '../config/blueprint.js';
import { readGuildState, writeGuildState } from '../storage/store.js';

export const PLATFORM_V10_SCHEMA = 10;
export const PLATFORM_V10_RELEASE = '10.0-realm-os';

const PUBLIC_DOMAIN_KEYS = new Set([
  'carryOperations',
  'memberIdentity',
  'houses',
  'questsRealm',
  'economyMarket',
  'eventsUx',
  'knowledge',
  'webGrowth'
]);

const HUB_CANDIDATES = {
  carryOperations: ['carryBoard', 'liveOperationsPremiumV4', 'carryQueue'],
  knightOperations: ['carrierCommandPremiumV4', 'carrierAnnouncements', 'carrierAssignments'],
  memberIdentity: ['memberDashboardPremiumV4', 'kingdomProgress', 'general'],
  houses: ['houseHall', 'kingdomProgress', 'general'],
  questsRealm: ['quests', 'kingdomProgress', 'memberDashboardPremiumV4'],
  economyMarket: ['economyPremiumV4', 'marketplace', 'treasury'],
  eventsUx: ['events', 'liveOperationsPremiumV4', 'announcements'],
  applicationsRecruitment: ['applicationPremiumV4', 'staffApplications', 'staffControlPremiumV4'],
  ticketsStaff: ['ticketPremiumV4', 'supportPanel', 'staffControlPremiumV4'],
  securityReliability: ['securityPremiumV4', 'securityLog', 'staffControlPremiumV4'],
  analyticsGovernance: ['analyticsPremiumV4', 'leaderboards', 'staffControlPremiumV4'],
  knowledge: ['faq', 'guides', 'help'],
  ai: ['staffControlPremiumV4', 'platformV5Control', 'council'],
  webGrowth: ['staffControlPremiumV4', 'announcements', 'general'],
  legacyPlatform: ['platformV5Control', 'staffControlPremiumV4', 'council']
};

function bytesToMb(value) {
  return Math.round((value / 1024 / 1024) * 10) / 10;
}

export function getV10ResourceSnapshot() {
  const total = os.totalmem();
  const free = os.freemem();
  const rss = process.memoryUsage().rss;
  const load1 = os.loadavg()[0] ?? 0;
  const freeRatio = total ? free / total : 1;

  let pressure = 'normal';
  if (freeRatio < 0.08 || load1 >= 1.8) pressure = 'critical';
  else if (freeRatio < 0.16 || load1 >= 1.1) pressure = 'high';
  else if (freeRatio < 0.28 || load1 >= 0.75) pressure = 'guarded';

  return {
    pressure,
    totalMemoryMb: bytesToMb(total),
    freeMemoryMb: bytesToMb(free),
    processRssMb: bytesToMb(rss),
    load1: Math.round(load1 * 100) / 100,
    lowMemoryVm: total <= 1.5 * 1024 * 1024 * 1024,
    capturedAt: new Date().toISOString()
  };
}

function textChannel(channel) {
  return channel?.isTextBased?.() && !channel.isThread?.();
}

function stateChannel(guild, state, key) {
  const id = state.setup?.channels?.[key];
  const channel = id ? guild.channels.cache.get(id) : null;
  return textChannel(channel) ? channel : null;
}

function findHub(guild, state, candidates = []) {
  for (const key of candidates) {
    const channel = stateChannel(guild, state, key);
    if (channel) return channel;
  }
  return null;
}

function staffOverwrites(guild, state) {
  const rows = [{
    id: guild.roles.everyone.id,
    deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
    allow: [PermissionFlagsBits.ReadMessageHistory]
  }];
  for (const key of STAFF_KEYS) {
    const id = state.setup?.roles?.[key];
    if (!id) continue;
    rows.push({
      id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages]
    });
  }
  return rows;
}

async function ensureStaffHub(guild, state) {
  const existing = findHub(guild, state, ['staffControlPremiumV4', 'platformV5Control', 'council', 'staffChat']);
  if (existing) return { channel: existing, created: false };

  const parentId = state.setup?.categories?.staff ?? state.setup?.categories?.security ?? null;
  const byName = guild.channels.cache.find((channel) => textChannel(channel) && channel.name === '👑・kingdom-os');
  if (byName) return { channel: byName, created: false };

  const channel = await guild.channels.create({
    name: '👑・kingdom-os',
    type: ChannelType.GuildText,
    parent: parentId,
    permissionOverwrites: staffOverwrites(guild, state),
    reason: 'Kingdom Core /setup10 fallback control plane'
  });
  state.setup.channels.kingdomOsV10 = channel.id;
  return { channel, created: true };
}

function ensurePublicHub(guild, state) {
  return findHub(guild, state, ['memberDashboardPremiumV4', 'kingdomProgress', 'liveOperationsPremiumV4', 'carryBoard', 'general']);
}

function channelInventory(guild, state) {
  const managedIds = new Set([
    ...Object.values(state.setup?.channels ?? {}),
    ...Object.values(state.setup?.statsChannels ?? {})
  ].filter(Boolean));
  const duplicateGroups = new Map();
  let categories = 0;
  let text = 0;
  let voice = 0;
  let announcements = 0;

  for (const channel of guild.channels.cache.values()) {
    if (channel.type === ChannelType.GuildCategory) {
      categories++;
      continue;
    }
    if (channel.type === ChannelType.GuildVoice) voice++;
    else if (channel.type === ChannelType.GuildAnnouncement) announcements++;
    else if (channel.type === ChannelType.GuildText) text++;
    if (channel.isThread?.()) continue;
    const key = `${channel.type}:${channel.name}`;
    const group = duplicateGroups.get(key) ?? [];
    group.push(channel);
    duplicateGroups.set(key, group);
  }

  let exactDuplicateGroups = 0;
  let safeEmptyDuplicateCandidates = 0;
  let populatedDuplicates = 0;
  for (const channels of duplicateGroups.values()) {
    if (channels.length < 2) continue;
    exactDuplicateGroups++;
    const hasManaged = channels.some((channel) => managedIds.has(channel.id));
    for (const channel of channels.slice(1)) {
      const populated = ('lastMessageId' in channel && Boolean(channel.lastMessageId)) || ('members' in channel && Boolean(channel.members?.size));
      if (populated) populatedDuplicates++;
      else if (hasManaged) safeEmptyDuplicateCandidates++;
    }
  }

  return {
    total: guild.channels.cache.size,
    categories,
    text,
    voice,
    announcements,
    exactDuplicateGroups,
    safeEmptyDuplicateCandidates,
    populatedDuplicates,
    capturedAt: new Date().toISOString()
  };
}

function ensureV10State(state) {
  state.platform ??= {};
  state.platform.schemaVersion = PLATFORM_V10_SCHEMA;
  state.platform.release = PLATFORM_V10_RELEASE;
  state.platform.updatedAt = new Date().toISOString();
  state.platform.migrations ??= [];
  if (!state.platform.migrations.includes('v10-realm-os')) state.platform.migrations.push('v10-realm-os');

  state.platform.v10 ??= {};
  const v10 = state.platform.v10;
  v10.installedAt ??= new Date().toISOString();
  v10.updatedAt = new Date().toISOString();
  v10.approvedCount = V10_FEATURE_COUNT;
  v10.approvedNumbers = [...APPROVED_V10_NUMBERS];
  v10.domains = Object.fromEntries(V10_DOMAINS.map((domain) => [domain.key, {
    label: domain.label,
    start: domain.start,
    end: domain.end,
    engine: domain.engine,
    enabled: domain.key !== 'ai',
    capabilities: [...domain.capabilities]
  }]));
  v10.engines = Object.fromEntries(V10_ENGINE_KEYS.map((key) => [key, {
    enabled: key !== 'ai-adapter',
    shared: true,
    mode: key === 'ai-adapter' ? 'disabled' : 'active'
  }]));
  v10.ai = {
    ...(v10.ai ?? {}),
    enabled: false,
    provider: null,
    mode: 'disabled-for-vps-stability',
    resourceGovernor: true
  };
  v10.resourcePolicy = {
    backgroundConcurrency: 1,
    heavyAnalyticsMinIntervalMs: 900_000,
    panelRefreshMinIntervalMs: 600_000,
    AIAllowed: false,
    pauseNonEssentialOnHighPressure: true,
    maxActiveDashboardRefreshes: 1
  };
  v10.emergencySwitches ??= {
    carries: false,
    economy: false,
    marketplace: false,
    events: false,
    integrations: false,
    ai: true
  };
  v10.safeModes ??= {
    maintenance: false,
    readOnly: false,
    startupSafeMode: false,
    lowMemory: false
  };

  state.platform.featureFlags ??= {};
  for (const domain of V10_DOMAINS) state.platform.featureFlags[`v10:${domain.key}`] = domain.key !== 'ai';
}

function buildHubMap(guild, state, staffHub, publicHub) {
  const result = {};
  for (const domain of V10_DOMAINS) {
    const direct = findHub(guild, state, HUB_CANDIDATES[domain.key] ?? []);
    result[domain.key] = (direct ?? (PUBLIC_DOMAIN_KEYS.has(domain.key) ? publicHub : staffHub))?.id ?? null;
  }
  return result;
}

function pressureEmoji(pressure) {
  if (pressure === 'critical') return '🔴';
  if (pressure === 'high') return '🟠';
  if (pressure === 'guarded') return '🟡';
  return '🟢';
}

function staffPayload(state) {
  const v10 = state.platform?.v10 ?? {};
  const structure = v10.structure ?? {};
  const resources = v10.resources ?? getV10ResourceSnapshot();
  const mapped = Object.values(v10.hubs ?? {}).filter(Boolean).length;
  const domainLines = V10_DOMAINS.map((domain) => {
    const enabled = domain.key === 'ai' ? false : true;
    return `${enabled ? '✅' : '⏸️'} **${domain.label}** · #${domain.start}–${domain.end}`;
  });

  const embed = new EmbedBuilder()
    .setColor(resources.pressure === 'critical' ? 0xed4245 : BRAND.color)
    .setTitle('👑 KINGDOM CORE v10 • Realm Operating System')
    .setDescription([
      '**370 approved systems, converged into shared engines and the channels the Kingdom already uses.**',
      'v10 does not create a channel per feature. The control plane routes features into existing carry, Knight, House, economy, event, support, staff, security and analytics surfaces.',
      '',
      ...domainLines
    ].join('\n'))
    .addFields(
      { name: 'Roadmap', value: `**${v10.approvedCount ?? 370}/370** approved`, inline: true },
      { name: 'Shared Engines', value: `**${Object.keys(v10.engines ?? {}).length}**`, inline: true },
      { name: 'Mapped Hubs', value: `**${mapped}/${V10_DOMAINS.length}**`, inline: true },
      { name: 'Server Structure', value: `**${structure.categories ?? 0}** categories · **${(structure.text ?? 0) + (structure.announcements ?? 0)}** text surfaces · **${structure.voice ?? 0}** voice`, inline: false },
      { name: 'Duplicate Safety', value: `**${structure.exactDuplicateGroups ?? 0}** exact-name groups · **${structure.safeEmptyDuplicateCandidates ?? 0}** safe empty candidates · **${structure.populatedDuplicates ?? 0}** populated duplicates preserved`, inline: false },
      { name: 'Resource Guard', value: `${pressureEmoji(resources.pressure)} **${resources.pressure?.toUpperCase() ?? 'NORMAL'}** · ${resources.processRssMb ?? '?'} MB bot RSS · ${resources.freeMemoryMb ?? '?'} MB host free · load ${resources.load1 ?? '?'}`, inline: false },
      { name: 'AI', value: '⏸️ Installed as an optional adapter but **disabled** while the small VPS is being stabilised.', inline: false }
    )
    .setFooter({ text: 'Kingdom Core v10 • One control plane, shared engines, minimal channel sprawl.' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('kc10:status').setLabel('Realm Status').setEmoji('👑').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('kc10:structure').setLabel('Structure').setEmoji('🏰').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('kc10:resources').setLabel('Resources').setEmoji('💓').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('kc10:domains').setLabel('370 Systems').setEmoji('🧭').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('kc10:refresh').setLabel('Refresh').setEmoji('🔄').setStyle(ButtonStyle.Secondary)
  );
  return { embeds: [embed], components: [row], allowedMentions: { parse: [] } };
}

function publicPayload(state) {
  const v10 = state.platform?.v10 ?? {};
  const resources = v10.resources ?? getV10ResourceSnapshot();
  const embed = new EmbedBuilder()
    .setColor(BRAND.color)
    .setTitle('🏰 KINGDOM CARRIES • Realm Status')
    .setDescription([
      '**Kingdom Core v10 connects carries, Houses, quests, events, progression, marketplace and member tools into one system.**',
      '',
      'Use the controls below instead of hunting through dozens of commands. The system automatically routes you to the correct Kingdom surface.'
    ].join('\n'))
    .addFields(
      { name: 'Platform', value: `**${v10.approvedCount ?? 370}** approved systems`, inline: true },
      { name: 'Operating Mode', value: resources.pressure === 'normal' ? '🟢 Normal' : `${pressureEmoji(resources.pressure)} Resource Guard`, inline: true },
      { name: 'AI', value: '⏸️ Temporarily disabled', inline: true }
    )
    .setFooter({ text: 'Kingdom Carries • Powered by Kingdom Core v10' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('kc10:member').setLabel('My Kingdom').setEmoji('🪪').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('kc10:carries').setLabel('Carry Status').setEmoji('⚔️').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('kc10:events').setLabel('Events').setEmoji('🎪').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('kc10:help').setLabel('Help').setEmoji('📚').setStyle(ButtonStyle.Secondary)
  );
  return { embeds: [embed], components: [row], allowedMentions: { parse: [] } };
}

async function upsertPanel(channel, state, key, payload) {
  if (!textChannel(channel)) return null;
  state.setup ??= {};
  state.setup.panels ??= {};
  let message = state.setup.panels[key]
    ? await channel.messages.fetch(state.setup.panels[key]).catch(() => null)
    : null;
  if (message) await message.edit(payload).catch(() => null);
  else {
    message = await channel.send(payload);
    state.setup.panels[key] = message.id;
  }
  if (message && !message.pinned) await message.pin('Kingdom Core v10 control surface').catch(() => null);
  return message;
}

async function refreshV10Panels(guild, state) {
  const staffHub = guild.channels.cache.get(state.platform?.v10?.staffHubId);
  const publicHub = guild.channels.cache.get(state.platform?.v10?.publicHubId);
  if (staffHub) await upsertPanel(staffHub, state, 'platformV10Staff', staffPayload(state));
  if (publicHub && publicHub.id !== staffHub?.id) await upsertPanel(publicHub, state, 'platformV10Public', publicPayload(state));
  state.platform.v10.lastPanelRefreshAt = new Date().toISOString();
}

export async function installPlatformV10(guild) {
  await guild.channels.fetch();
  await guild.roles.fetch();
  const state = await readGuildState(guild.id);
  ensureV10State(state);

  const staffResult = await ensureStaffHub(guild, state);
  const publicHub = ensurePublicHub(guild, state) ?? staffResult.channel;
  state.platform.v10.staffHubId = staffResult.channel.id;
  state.platform.v10.publicHubId = publicHub.id;
  state.platform.v10.hubs = buildHubMap(guild, state, staffResult.channel, publicHub);
  state.platform.v10.structure = channelInventory(guild, state);
  state.platform.v10.resources = getV10ResourceSnapshot();
  state.platform.v10.safeModes.lowMemory = state.platform.v10.resources.lowMemoryVm;
  await refreshV10Panels(guild, state);
  await writeGuildState(guild.id, state);

  return {
    approved: V10_FEATURE_COUNT,
    domains: V10_DOMAINS.length,
    engines: V10_ENGINE_KEYS.length,
    fallbackChannelsCreated: Number(staffResult.created),
    mappedHubs: Object.values(state.platform.v10.hubs).filter(Boolean).length,
    structure: state.platform.v10.structure,
    resources: state.platform.v10.resources
  };
}

export async function finalizePlatformV10(guild) {
  await guild.channels.fetch();
  const state = await readGuildState(guild.id);
  ensureV10State(state);
  state.platform.v10.structure = channelInventory(guild, state);
  state.platform.v10.resources = getV10ResourceSnapshot();
  state.platform.v10.safeModes.lowMemory = state.platform.v10.resources.lowMemoryVm || ['high', 'critical'].includes(state.platform.v10.resources.pressure);
  state.platform.v10.lastVerifiedAt = new Date().toISOString();
  await refreshV10Panels(guild, state);
  await writeGuildState(guild.id, state);
  return {
    approved: state.platform.v10.approvedCount,
    structure: state.platform.v10.structure,
    resources: state.platform.v10.resources,
    mappedHubs: Object.values(state.platform.v10.hubs ?? {}).filter(Boolean).length
  };
}

export async function runV10Maintenance(guild) {
  const state = await readGuildState(guild.id);
  if ((state.platform?.schemaVersion ?? 0) < PLATFORM_V10_SCHEMA) return false;
  ensureV10State(state);

  const resources = getV10ResourceSnapshot();
  state.platform.v10.resources = resources;
  state.platform.v10.safeModes.lowMemory = resources.lowMemoryVm || ['high', 'critical'].includes(resources.pressure);
  state.platform.v10.runtimeMode = resources.pressure === 'critical'
    ? 'critical-graceful-degradation'
    : resources.pressure === 'high'
      ? 'low-memory'
      : resources.pressure === 'guarded'
        ? 'guarded'
        : 'normal';

  const last = new Date(state.platform.v10.lastPanelRefreshAt ?? 0).getTime();
  const minimum = resources.pressure === 'normal' ? 600_000 : 900_000;
  if (resources.pressure !== 'critical' && Date.now() - last >= minimum) {
    await refreshV10Panels(guild, state);
  }
  await writeGuildState(guild.id, state);
  return true;
}

function ephemeral(content) {
  return { content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } };
}

function domainSummary() {
  return V10_DOMAINS.map((domain) => `• **#${domain.start}–${domain.end}** ${domain.label} · \`${domain.engine}\``).join('\n');
}

export async function handleV10Button(interaction) {
  if (!interaction.customId.startsWith('kc10:')) return false;
  const state = await readGuildState(interaction.guildId);
  const v10 = state.platform?.v10;
  if (!v10) return interaction.reply(ephemeral('Kingdom Core v10 has not been installed in this server yet.'));

  if (interaction.customId === 'kc10:status') {
    const r = v10.resources ?? getV10ResourceSnapshot();
    return interaction.reply(ephemeral(`👑 **Kingdom Core v10**\n370/370 systems registered across ${Object.keys(v10.domains ?? {}).length} domains.\nMode: **${v10.runtimeMode ?? 'normal'}**\nResource pressure: **${r.pressure}**\nAI: **disabled**`));
  }
  if (interaction.customId === 'kc10:structure') {
    const s = v10.structure ?? {};
    return interaction.reply(ephemeral(`🏰 **Current Kingdom structure**\nCategories: **${s.categories ?? 0}**\nText/announcement surfaces: **${(s.text ?? 0) + (s.announcements ?? 0)}**\nVoice: **${s.voice ?? 0}**\nExact duplicate groups: **${s.exactDuplicateGroups ?? 0}**\nSafe empty duplicate candidates: **${s.safeEmptyDuplicateCandidates ?? 0}**\nPopulated duplicates preserved: **${s.populatedDuplicates ?? 0}**`));
  }
  if (interaction.customId === 'kc10:resources') {
    const r = getV10ResourceSnapshot();
    return interaction.reply(ephemeral(`💓 **Resource Guard**\nPressure: **${r.pressure}**\nHost memory: **${r.freeMemoryMb} MB free / ${r.totalMemoryMb} MB total**\nKingdom Core RSS: **${r.processRssMb} MB**\n1m load: **${r.load1}**\nLow-memory VM policy: **${r.lowMemoryVm ? 'ON' : 'OFF'}**\nAI remains disabled.`));
  }
  if (interaction.customId === 'kc10:domains') {
    return interaction.reply(ephemeral(`🧭 **370-system v10 roadmap**\n${domainSummary()}`));
  }
  if (interaction.customId === 'kc10:refresh') {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return interaction.reply(ephemeral('Administrator permission is required to refresh the v10 control plane.'));
    await guildRefresh(interaction.guild, state);
    return interaction.reply(ephemeral('🔄 Kingdom Core v10 control surfaces refreshed.'));
  }
  if (interaction.customId === 'kc10:member') {
    return interaction.reply(ephemeral('🪪 **My Kingdom** is routed through the existing member dashboard/passport system. Your progression, House, quests, achievements and contribution state stay in one profile instead of separate channels.'));
  }
  if (interaction.customId === 'kc10:carries') {
    const waiting = Object.values(state.carryPartiesV3?.parties ?? {}).filter((party) => !['completed', 'cancelled', 'closed'].includes(party.status)).length;
    return interaction.reply(ephemeral(`⚔️ **Carry Operations**\nActive tracked parties: **${waiting}**\nSmart matching, ETA, recovery, no-show and coverage features share the existing carry board/live queue surfaces.`));
  }
  if (interaction.customId === 'kc10:events') {
    const events = Object.values(state.eventsV4?.events ?? {}).filter((event) => !['completed', 'cancelled'].includes(event.status)).length;
    return interaction.reply(ephemeral(`🎪 **Kingdom Events**\nActive/upcoming tracked events: **${events}**\nRSVP, teams, tournaments, calendars, reminders and recaps share the existing Events hub.`));
  }
  if (interaction.customId === 'kc10:help') {
    return interaction.reply(ephemeral('📚 **Kingdom Help**\nUse the existing Royal Archives / guides / game-help surfaces. v10 routes knowledge, build advice, progression help and FAQs there instead of spawning new help channels. AI assistance remains disabled for now.'));
  }

  return interaction.reply(ephemeral('That Kingdom Core v10 action is not available yet.'));
}

async function guildRefresh(guild, state) {
  ensureV10State(state);
  state.platform.v10.structure = channelInventory(guild, state);
  state.platform.v10.resources = getV10ResourceSnapshot();
  await refreshV10Panels(guild, state);
  await writeGuildState(guild.id, state);
}

export { APPROVED_V10_SYSTEMS };
