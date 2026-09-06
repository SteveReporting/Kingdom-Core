import { ChannelType, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { CARRIER_KEYS, ROLE_BLUEPRINT, STAFF_KEYS } from '../config/blueprint.js';
import { applicationHubPayload, applicationReviewDeskPayload } from './applicationLinks.js';
import { carryControlPanelPayload, carryPublicPanelPayload } from './carryTickets.js';
import { readGuildState, writeGuildState } from '../storage/store.js';
import { ticketControlPayload } from './ticketControlV2.js';
import {
  housePremium,
  notificationsPremium,
  questPremium,
  rulesPremium,
  securityPremium,
  supportPremium,
  welcomePremium
} from '../ui/premiumUi2.js';

const ALL_KEYS = ROLE_BLUEPRINT.map((role) => role.key);

function roleMatrix(guild, state, allowedKeys, { staffSend = false, allowedSend = false } = {}) {
  const roleIds = state.setup?.roles ?? {};
  const allowed = new Set(allowedKeys);
  const staff = new Set(STAFF_KEYS);
  const rows = [{
    id: guild.roles.everyone.id,
    allow: [PermissionFlagsBits.ReadMessageHistory],
    deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
  }];

  for (const key of ALL_KEYS) {
    const id = roleIds[key];
    if (!id) continue;
    if (allowed.has(key)) {
      rows.push({
        id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.ReadMessageHistory,
          ...(allowedSend || (staffSend && staff.has(key)) ? [PermissionFlagsBits.SendMessages] : [])
        ],
        deny: allowedSend || (staffSend && staff.has(key)) ? [] : [PermissionFlagsBits.SendMessages]
      });
    } else {
      rows.push({
        id,
        allow: [PermissionFlagsBits.ReadMessageHistory],
        deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
      });
    }
  }
  return rows;
}

function publicReadOnly(guild, state) {
  const roleIds = state.setup?.roles ?? {};
  const rows = [{
    id: guild.roles.everyone.id,
    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
    deny: [PermissionFlagsBits.SendMessages]
  }];
  for (const key of ALL_KEYS) {
    const id = roleIds[key];
    if (!id) continue;
    rows.push({
      id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
      deny: [PermissionFlagsBits.SendMessages]
    });
  }
  for (const key of STAFF_KEYS) {
    const id = roleIds[key];
    if (!id) continue;
    const found = rows.find((row) => row.id === id);
    if (found) {
      found.allow = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages];
      found.deny = [];
    }
  }
  return rows;
}

async function ensureCategory(guild, state, key, name, overwrites) {
  let category = guild.channels.cache.get(state.setup?.categories?.[key]);
  if (!category || category.type !== ChannelType.GuildCategory) {
    category = guild.channels.cache.find((channel) => channel.type === ChannelType.GuildCategory && channel.name === name);
  }
  let created = false;
  if (!category) {
    category = await guild.channels.create({
      name,
      type: ChannelType.GuildCategory,
      permissionOverwrites: overwrites,
      reason: 'Kingdom Core /setup2 consolidated infrastructure'
    });
    created = true;
  } else if (overwrites) {
    await category.permissionOverwrites.set(overwrites, 'Kingdom Core /setup2 consolidated permissions').catch(() => null);
  }
  state.setup.categories ??= {};
  state.setup.categories[key] = category.id;
  return { category, created };
}

async function ensureTextChannel(guild, state, key, name, parentId, overwrites) {
  let channel = guild.channels.cache.get(state.setup?.channels?.[key]);
  if (!channel || channel.type !== ChannelType.GuildText) {
    channel = guild.channels.cache.find((item) => item.type === ChannelType.GuildText && item.name === name);
  }
  let created = false;
  if (!channel) {
    channel = await guild.channels.create({
      name,
      type: ChannelType.GuildText,
      parent: parentId,
      permissionOverwrites: overwrites,
      reason: 'Kingdom Core /setup2 consolidated control channel'
    });
    created = true;
  } else {
    if (parentId && channel.parentId !== parentId) await channel.setParent(parentId, { lockPermissions: false }).catch(() => null);
    if (overwrites) await channel.permissionOverwrites.set(overwrites, 'Kingdom Core /setup2 consolidated control permissions').catch(() => null);
  }
  state.setup.channels ??= {};
  state.setup.channels[key] = channel.id;
  return { channel, created };
}

async function upsertPinned(channel, state, marker, payload) {
  if (!channel?.isTextBased()) return { updated: false, pinned: false, message: null };
  state.setup.panels ??= {};
  let message = state.setup.panels[marker]
    ? await channel.messages.fetch(state.setup.panels[marker]).catch(() => null)
    : null;
  if (message) await message.edit({ ...payload, allowedMentions: payload.allowedMentions ?? { parse: [] } }).catch(() => null);
  else {
    message = await channel.send({ ...payload, allowedMentions: payload.allowedMentions ?? { parse: [] } });
    state.setup.panels[marker] = message.id;
  }
  let pinned = Boolean(message.pinned);
  if (!pinned) {
    await message.pin('Kingdom Core /setup2 primary control panel').catch(() => null);
    pinned = true;
  }
  return { updated: true, pinned, message };
}

async function ensureWebhook(channel, state, key, name, guild) {
  if (!channel?.isTextBased() || typeof channel.createWebhook !== 'function') return false;
  state.setup.webhooks ??= {};
  const saved = state.setup.webhooks[key];
  if (saved?.id && saved?.token) {
    const fetched = await guild.client.fetchWebhook(saved.id, saved.token).catch(() => null);
    if (fetched) {
      state.setup.webhooks[key] = { ...saved, channelId: channel.id, name };
      return false;
    }
  }

  const existing = await channel.fetchWebhooks().catch(() => null);
  const hook = existing?.find((item) => item.name === name && item.token) ?? await channel.createWebhook({
    name,
    avatar: guild.client.user.displayAvatarURL(),
    reason: 'Kingdom Core /setup2 premium webhook stream'
  }).catch(() => null);
  if (!hook?.token) return false;
  state.setup.webhooks[key] = { id: hook.id, token: hook.token, channelId: channel.id, name };

  await hook.send({
    username: name,
    avatarURL: guild.client.user.displayAvatarURL(),
    embeds: [new EmbedBuilder()
      .setColor(0xd4af37)
      .setTitle(`${name} • ONLINE`)
      .setDescription('This dedicated Kingdom Core stream is active and ready for structured system events.')
      .setFooter({ text: 'Kingdom Carries • Kingdom Core' })
      .setTimestamp()],
    allowedMentions: { parse: [] }
  }).catch(() => null);
  return true;
}

export async function installUltimateSetup2(guild, onProgress = async () => {}) {
  await guild.roles.fetch();
  await guild.channels.fetch();
  const state = await readGuildState(guild.id);
  state.setup ??= {};
  if (!state.setup.completedAt) throw new Error('Run /setup once before the consolidated /setup2.');

  const summary = {
    categoriesCreated: 0,
    channelsCreated: 0,
    panelsUpdated: 0,
    panelsPinned: 0,
    webhooksPrepared: 0
  };

  await onProgress('Building the private carry-ticket layer…');
  const carryCategory = await ensureCategory(
    guild,
    state,
    'carryTickets',
    '━━ ⚔️ LIVE CARRY TICKETS ━━',
    roleMatrix(guild, state, [...CARRIER_KEYS, ...STAFF_KEYS], { allowedSend: true })
  );
  summary.categoriesCreated += Number(carryCategory.created);

  const carrierParent = state.setup?.categories?.carrier;
  const carryControl = await ensureTextChannel(
    guild,
    state,
    'carryControl',
    '🛡️・carry-control',
    carrierParent,
    roleMatrix(guild, state, [...CARRIER_KEYS, ...STAFF_KEYS], { staffSend: true, allowedSend: false })
  );
  summary.channelsCreated += Number(carryControl.created);

  await onProgress('Creating the public applications hub…');
  const applicationHub = await ensureTextChannel(
    guild,
    state,
    'applicationHub',
    '📨・applications',
    state.setup?.categories?.applications,
    publicReadOnly(guild, state)
  );
  summary.channelsCreated += Number(applicationHub.created);

  const channel = (key) => guild.channels.cache.get(state.setup?.channels?.[key]);
  const pin = async (target, marker, payload) => {
    const result = await upsertPinned(target, state, marker, payload);
    summary.panelsUpdated += Number(result.updated);
    summary.panelsPinned += Number(result.pinned);
    return result;
  };

  await onProgress('Replacing the core server UI with the premium control surfaces…');
  await pin(channel('welcome'), 'welcome', welcomePremium(guild, state));
  await pin(channel('rules'), 'rules', rulesPremium());
  await pin(channel('chooseHouse'), 'houses', housePremium());
  await pin(channel('roles'), 'notifications', notificationsPremium());
  await pin(channel('supportPanel'), 'support', supportPremium());
  await pin(channel('quests'), 'quests', questPremium());
  await pin(channel('securityCenter'), 'securityCenter', securityPremium(state.security ?? {}));

  const carry = await pin(channel('carryBoard'), 'carry', carryPublicPanelPayload(state));
  if (carry.message) state.setup.panels.carryUltimate = carry.message.id;
  const legacyQueue = await pin(channel('carryQueue'), 'liveQueue', carryPublicPanelPayload(state));
  if (legacyQueue.message) state.setup.panels.liveQueue = legacyQueue.message.id;
  const carryOps = await pin(channel('carryControl'), 'carryControl', carryControlPanelPayload(state));
  if (carryOps.message) state.setup.panels.carryControl = carryOps.message.id;

  await onProgress('Replacing popup applications with Google Forms links…');
  await pin(channel('applicationHub'), 'applicationHub', applicationHubPayload());
  await pin(channel('staffApplications'), 'appStaff', applicationHubPayload());
  await pin(channel('carrierApplications'), 'appCarrier', applicationHubPayload());
  await pin(channel('creatorApplications'), 'appCreator', applicationHubPayload());
  await pin(channel('applicationsReview'), 'appReviewGuide', applicationReviewDeskPayload());
  const tickets = await pin(channel('ticketOverview'), 'ticketOverview', ticketControlPayload(state));
  if (tickets.message) state.setup.panels.ticketControlV2 = tickets.message.id;

  await onProgress('Rebuilding dedicated branded webhook streams…');
  summary.webhooksPrepared += Number(await ensureWebhook(channel('securityLog'), state, 'security', '🛡️ Kingdom Security', guild));
  summary.webhooksPrepared += Number(await ensureWebhook(channel('staffLogs'), state, 'registry', '👑 Royal Registry', guild));
  summary.webhooksPrepared += Number(await ensureWebhook(channel('carrierLogs'), state, 'dispatch', '⚔️ Knight Dispatch', guild));
  summary.webhooksPrepared += Number(await ensureWebhook(channel('carryControl'), state, 'carry', '🎫 Carry Operations', guild));
  summary.webhooksPrepared += Number(await ensureWebhook(channel('ticketOverview'), state, 'tickets', '🕯️ Petition Desk', guild));

  state.setup.version = 4;
  state.setup.consolidatedSetup2At = new Date().toISOString();
  await writeGuildState(guild.id, state);
  return { summary, state };
}
