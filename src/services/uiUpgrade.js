import { ChannelType } from 'discord.js';
import { readGuildState, writeGuildState } from '../storage/store.js';
import {
  applicationHubVNext,
  applicationReviewVNext,
  applicationStatusVNext,
  carryBoardVNext,
  eventVNext,
  genericInfoVNext,
  giveawayVNext,
  guideVNext,
  houseVNext,
  levelRolesVNext,
  notificationsVNext,
  questVNext,
  rulesVNext,
  securityVNext,
  staffCommandVNext,
  supportVNext,
  treasuryVNext,
  verificationVNext,
  welcomeVNext
} from '../ui/realmUiVNext.js';

const DAY = 86_400_000;
const BULK_DELETE_LIMIT_MS = 13.8 * DAY;

function norm(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function isTextSurface(channel) {
  return channel?.isTextBased?.() && !channel.isThread?.() && channel.type !== ChannelType.GuildForum;
}

function findByAliases(guild, aliases = []) {
  const wanted = aliases.map(norm).filter(Boolean);
  const channels = [...guild.channels.cache.values()].filter(isTextSurface);
  for (const alias of wanted) {
    const exact = channels.find((channel) => norm(channel.name) === alias);
    if (exact) return exact;
  }
  for (const alias of wanted) {
    const partial = channels.find((channel) => norm(channel.name).includes(alias));
    if (partial) return partial;
  }
  return null;
}

function resolveChannel(guild, state, keys = [], aliases = []) {
  for (const key of keys) {
    const id = state.setup?.channels?.[key] ?? state.setup?.statsChannels?.[key];
    const channel = id ? guild.channels.cache.get(id) : null;
    if (isTextSurface(channel)) return channel;
  }
  return findByAliases(guild, aliases);
}

async function purgeChannel(channel, onProgress) {
  if (!isTextSurface(channel)) return { deleted: 0, batches: 0 };
  let before = null;
  let deleted = 0;
  let batches = 0;
  let safety = 0;

  while (safety++ < 100) {
    const fetched = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) }).catch(() => null);
    if (!fetched?.size) break;
    batches++;
    const messages = [...fetched.values()];
    before = messages[messages.length - 1]?.id ?? null;
    const recent = messages.filter((message) => Date.now() - message.createdTimestamp < BULK_DELETE_LIMIT_MS);
    const old = messages.filter((message) => Date.now() - message.createdTimestamp >= BULK_DELETE_LIMIT_MS);

    if (recent.length) {
      const result = await channel.bulkDelete(recent, true).catch(() => null);
      deleted += result?.size ?? 0;
    }
    for (const message of old) {
      const ok = await message.delete().then(() => true).catch(() => false);
      if (ok) deleted++;
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    if (messages.length < 100) break;
    if (batches % 5 === 0) await onProgress(`Clearing old presentation messages from #${channel.name}… ${deleted} removed so far.`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return { deleted, batches };
}

async function sendPinned(channel, payload, marker, state) {
  if (!isTextSurface(channel)) return null;
  const message = await channel.send({ ...payload, allowedMentions: payload.allowedMentions ?? { parse: [] } });
  await message.pin('Kingdom Core UIpgrade • primary interface').catch(() => null);
  state.setup ??= {};
  state.setup.panels ??= {};
  state.setup.panels[marker] = message.id;
  return message;
}

function panelSpecs(guild, state) {
  return [
    { marker: 'ui-welcome', keys: ['welcome'], aliases: ['welcome'], payload: () => welcomeVNext(guild, state) },
    { marker: 'ui-verification', keys: ['verificationPanel', 'verification'], aliases: ['bloxlink-verification', 'verification', 'verify'], payload: () => verificationVNext(guild) },
    { marker: 'ui-guide', keys: ['guide'], aliases: ['guide'], payload: () => guideVNext(guild, state) },
    { marker: 'ui-rules', keys: ['rules'], aliases: ['rules'], payload: () => rulesVNext(guild) },
    { marker: 'ui-houses', keys: ['chooseHouse'], aliases: ['choose-house', 'choose-your-house'], payload: () => houseVNext(guild) },
    { marker: 'ui-notifications', keys: ['roles'], aliases: ['notification-roles', 'notifiable-roles', 'roles'], payload: () => notificationsVNext(guild) },
    { marker: 'ui-server-guide', keys: ['serverGuide'], aliases: ['server-guide'], payload: () => guideVNext(guild, state) },
    { marker: 'ui-level-roles', keys: ['levelRoles'], aliases: ['level-roles'], payload: () => levelRolesVNext(guild) },

    { marker: 'ui-carry-board', keys: ['carryBoard'], aliases: ['carry-board'], payload: () => carryBoardVNext(guild) },
    { marker: 'ui-carry-schedule', keys: ['carrySchedule'], aliases: ['carry-schedule'], payload: () => genericInfoVNext(guild, '📅 Carry Schedule', 'Scheduled carry sessions and major service windows appear here.', 0x3498db, [
      { name: 'Live service', value: 'For immediate carries, use the Royal Carry Board rather than waiting for a scheduled event.' },
      { name: 'Timezones', value: 'Scheduled times should use Discord timestamps so they automatically display in your local timezone.' }
    ]) },

    { marker: 'ui-quests', keys: ['quests'], aliases: ['quest-board'], payload: () => questVNext(guild) },
    { marker: 'ui-leaderboards', keys: ['leaderboards'], aliases: ['leaderboards'], payload: () => genericInfoVNext(guild, '🏆 Realm Leaderboards', 'Meaningful service and progression records — not message-spam rankings.', 0xf1c40f, [
      { name: 'Tracked', value: 'Carries • House progression • events • service • achievements' },
      { name: 'Fairness', value: 'Operational contribution matters more than raw chat volume.' }
    ]) },
    { marker: 'ui-achievements', keys: ['achievements'], aliases: ['achievements'], payload: () => genericInfoVNext(guild, '🎖️ Achievement Cabinet', 'Major milestones and rare accomplishments earned across the Kingdom.', 0xd4af37, [
      { name: 'Permanent', value: 'Achievements are historical recognition and are not wiped just because a season changes.' }
    ]) },
    { marker: 'ui-campaigns', keys: ['campaigns'], aliases: ['campaigns'], payload: () => genericInfoVNext(guild, '🗺️ Kingdom Campaigns', 'Multi-stage community objectives, seasonal arcs and large Realm challenges.', 0x7c3aed, [
      { name: 'Campaign flow', value: 'Objective → progress → milestone → reward → archived result.' }
    ]) },
    { marker: 'ui-kingdom-progress', keys: ['kingdomProgress'], aliases: ['kingdom-progress'], payload: () => genericInfoVNext(guild, '👑 Kingdom Progress', 'A high-level view of the Realm’s collective progression.', 0xd4af37, [
      { name: 'Contributors', value: 'Carries, Houses, events, mentoring and useful community participation feed Realm progress.' }
    ]) },
    { marker: 'ui-world-boss', keys: ['worldBoss'], aliases: ['world-boss'], payload: () => genericInfoVNext(guild, '☠️ World Boss', 'Large collaborative objectives and limited-time Realm challenges.', 0xed4245, [
      { name: 'When active', value: 'Objectives, contribution rules and progress will be posted here.' }
    ]) },
    { marker: 'ui-hall-of-fame', keys: ['hallOfFame'], aliases: ['hall-of-fame'], payload: () => genericInfoVNext(guild, '🏛️ Hall of Fame', 'Permanent recognition for exceptional service, records and historic Kingdom contributions.', 0xf1c40f, [
      { name: 'Legacy', value: 'Major achievements remain visible even after roles, seasons or systems change.' }
    ]) },
    { marker: 'ui-house-hall', keys: ['houseHall'], aliases: ['house-hall'], payload: () => genericInfoVNext(guild, '🏰 House Hall', 'The shared command board for Drakon, Leonis, Aether and Fenrir.', 0x7c3aed, [
      { name: 'House competition', value: 'Season objectives, standings and cross-House events belong here.' },
      { name: 'Private halls', value: 'Each House keeps its own member channel for internal coordination.' }
    ]) },

    { marker: 'ui-treasury', keys: ['treasury'], aliases: ['royal-treasury', 'treasury'], payload: () => treasuryVNext(guild) },
    { marker: 'ui-events', keys: ['events'], aliases: ['events'], payload: () => eventVNext(guild) },
    { marker: 'ui-giveaways', keys: ['giveaways'], aliases: ['giveaways'], payload: () => giveawayVNext(guild) },

    { marker: 'ui-support', keys: ['supportPanel'], aliases: ['petition-the-crown', 'support'], payload: () => supportVNext(guild) },
    { marker: 'ui-faq', keys: ['faq'], aliases: ['royal-archives', 'faq'], payload: () => genericInfoVNext(guild, '📚 Royal Archives • Help Index', 'Quick answers and reference information for common Kingdom systems.', 0x5865f2, [
      { name: 'Carries', value: 'Use the carry board and keep one active request at a time.' },
      { name: 'Applications', value: 'Apply through Discord; staff review every written answer privately.' },
      { name: 'Support', value: 'If your issue is personal, moderation-related or account-specific, open a private ticket.' }
    ]) },
    { marker: 'ui-appeals', keys: ['appeals'], aliases: ['appeals-info'], payload: () => genericInfoVNext(guild, '⚖️ Appeals', 'Appeals are reviewed privately and should focus on facts, context and relevant evidence.', 0xf1c40f, [
      { name: 'Use support', value: 'Open an **Appeal** through the support panel. Do not argue moderation cases in public chat.' }
    ]) },
    { marker: 'ui-reports', keys: ['reportInfo'], aliases: ['report-a-member'], payload: () => genericInfoVNext(guild, '🚨 Report a Member', 'Reports are private. Give staff enough evidence to understand what happened.', 0xed4245, [
      { name: 'Include', value: 'User • what happened • when/where • screenshots/message links if relevant.' },
      { name: 'Do not', value: 'Do not organize public call-outs or harassment around a report.' }
    ]) },

    { marker: 'ui-app-hub', keys: ['applicationHub'], aliases: ['applications'], payload: () => applicationHubVNext() },
    { marker: 'ui-app-staff', keys: ['staffApplications'], aliases: ['staff-applications', 'staff-apps'], payload: () => applicationHubVNext() },
    { marker: 'ui-app-carrier', keys: ['carrierApplications'], aliases: ['carrier-applications', 'carrier-apps'], payload: () => applicationHubVNext() },
    { marker: 'ui-app-creator', keys: ['creatorApplications'], aliases: ['creator-applications', 'creator-apps'], payload: () => applicationHubVNext() },
    { marker: 'ui-app-status', keys: ['applicationStatus'], aliases: ['application-status'], payload: () => applicationStatusVNext(guild) },
    { marker: 'ui-app-review', keys: ['applicationsReview'], aliases: ['application-review', 'grading-applications', 'application-grading'], payload: () => applicationReviewVNext(state) },

    { marker: 'ui-knight-announcements', keys: ['carrierAnnouncements'], aliases: ['knight-announcements'], payload: () => genericInfoVNext(guild, '📯 Knight Dispatch', 'Official Knight notices, standards and service updates.', 0x3498db, [
      { name: 'Carrier standard', value: 'Carries remain free. Keep parties moving, communicate clearly and use handoff/recovery when needed.' }
    ]) },
    { marker: 'ui-knight-assignments', keys: ['carrierAssignments'], aliases: ['carry-assignments'], payload: () => genericInfoVNext(guild, '📋 Knight Assignments', 'Current service priorities, assignments and coverage needs.', 0x3498db, [
      { name: 'Use this channel', value: 'For organized service work — not general Knight chat.' }
    ]) },
    { marker: 'ui-knight-guides', keys: ['carrierGuides'], aliases: ['carrier-guides'], payload: () => genericInfoVNext(guild, '📚 Knight Field Manual', 'Carrier procedures, quality standards and reference material.', 0x3498db, [
      { name: 'Before carrying', value: 'Know the current service rules, recovery procedure and escalation path.' }
    ]) },

    { marker: 'ui-staff-command', keys: ['staffCommands'], aliases: ['staff-commands', 'royal-control-plane'], payload: () => staffCommandVNext(guild, state) },
    { marker: 'ui-security-command', keys: ['securityCenter', 'securityPremiumV4'], aliases: ['security-control', 'security-center', 'bot-security'], payload: () => securityVNext(guild, state) }
  ];
}

export async function runUiUpgrade(guild, onProgress = async () => {}) {
  await guild.channels.fetch();
  const state = await readGuildState(guild.id);
  state.setup ??= {};
  state.setup.panels ??= {};

  const specs = panelSpecs(guild, state);
  const resolved = [];
  const seen = new Set();
  for (const spec of specs) {
    const channel = resolveChannel(guild, state, spec.keys, spec.aliases);
    if (!channel || seen.has(`${spec.marker}:${channel.id}`)) continue;
    seen.add(`${spec.marker}:${channel.id}`);
    resolved.push({ ...spec, channel });
  }

  let messagesDeleted = 0;
  let channelsCleared = 0;
  let panelsSent = 0;
  let panelsPinned = 0;
  const failures = [];

  await onProgress(`UIpgrade found ${resolved.length} presentation surfaces. Human chat, announcements and log channels are protected.`);

  const uniqueChannels = [...new Map(resolved.map((entry) => [entry.channel.id, entry.channel])).values()];
  for (let index = 0; index < uniqueChannels.length; index++) {
    const channel = uniqueChannels[index];
    await onProgress(`01/03 • Clearing presentation surface ${index + 1}/${uniqueChannels.length}: #${channel.name}`);
    const result = await purgeChannel(channel, onProgress).catch((error) => {
      failures.push(`#${channel.name}: purge failed (${String(error?.message ?? error).slice(0, 140)})`);
      return { deleted: 0 };
    });
    messagesDeleted += result.deleted;
    channelsCleared++;
  }

  // Every saved panel message may have been deleted. Rebuild the registry from the
  // new vNext messages rather than keeping stale IDs around.
  state.setup.panels = {};

  for (let index = 0; index < resolved.length; index++) {
    const { channel, marker, payload } = resolved[index];
    await onProgress(`02/03 • Publishing UI vNext ${index + 1}/${resolved.length}: #${channel.name}`);
    try {
      const message = await sendPinned(channel, payload(), marker, state);
      if (message) {
        panelsSent++;
        panelsPinned += Number(message.pinned);
      }
    } catch (error) {
      failures.push(`#${channel.name}: publish failed (${String(error?.message ?? error).slice(0, 140)})`);
    }
  }

  state.uiVNext = {
    version: 1,
    upgradedAt: new Date().toISOString(),
    presentationChannels: uniqueChannels.map((channel) => channel.id),
    panels: Object.fromEntries(resolved.map((entry) => [entry.marker, entry.channel.id])),
    protectedByDesign: [
      'announcements/news', 'general/community chat', 'Dungeon Quest chat', 'media/showcase',
      'market conversations', 'active tickets/carry tickets', 'staff discussion', 'security/audit/mod logs'
    ],
    summary: { messagesDeleted, channelsCleared, panelsSent, panelsPinned, failures: failures.length }
  };

  await writeGuildState(guild.id, state);
  await onProgress('03/03 • UI registry rebuilt and application grading console activated.');

  return {
    messagesDeleted,
    channelsCleared,
    panelsSent,
    panelsPinned,
    failures,
    surfaces: resolved.map(({ marker, channel }) => ({ marker, channelId: channel.id, name: channel.name }))
  };
}
