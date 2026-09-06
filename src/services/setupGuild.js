import {
  ChannelType,
  PermissionFlagsBits,
  PermissionsBitField
} from 'discord.js';
import {
  CATEGORY_BLUEPRINT,
  CHANNEL_BLUEPRINT,
  CARRIER_KEYS,
  ROLE_BLUEPRINT,
  STAFF_KEYS
} from '../config/blueprint.js';
import { readGuildState, writeGuildState } from '../storage/store.js';
import {
  carryPanel,
  housePanel,
  notificationPanel,
  questPanel,
  rulesPanel,
  supportPanel,
  welcomePanel
} from '../ui/embeds.js';

const permissionMap = {
  ManageGuild: PermissionFlagsBits.ManageGuild,
  ManageRoles: PermissionFlagsBits.ManageRoles,
  ManageChannels: PermissionFlagsBits.ManageChannels,
  ManageMessages: PermissionFlagsBits.ManageMessages,
  ModerateMembers: PermissionFlagsBits.ModerateMembers,
  KickMembers: PermissionFlagsBits.KickMembers,
  BanMembers: PermissionFlagsBits.BanMembers
};

const channelTypeMap = {
  text: ChannelType.GuildText,
  announcement: ChannelType.GuildAnnouncement,
  voice: ChannelType.GuildVoice
};

function rolePermissions(names = []) {
  return new PermissionsBitField(names.map((name) => permissionMap[name]).filter(Boolean));
}

function firstRoleByName(guild, name) {
  return guild.roles.cache.find((role) => role.name === name && !role.managed);
}

function firstChannelByName(guild, name, type) {
  return guild.channels.cache.find((channel) => channel.name === name && (!type || channel.type === type));
}

function privateCategoryOverwrites(guild, roles, mode) {
  const allows = mode === 'staff' ? STAFF_KEYS : [...STAFF_KEYS, ...CARRIER_KEYS];
  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }
  ];

  for (const key of allows) {
    const role = roles[key];
    if (role) {
      overwrites.push({
        id: role.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
      });
    }
  }
  return overwrites;
}

function channelOverwrites(guild, readOnly) {
  if (!readOnly) return undefined;
  return [
    {
      id: guild.roles.everyone.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
      deny: [PermissionFlagsBits.SendMessages]
    }
  ];
}

async function ensurePanel(channel, marker, payload, state) {
  if (!channel?.isTextBased()) return false;
  if (state.setup.panels?.[marker]) {
    try {
      await channel.messages.fetch(state.setup.panels[marker]);
      return false;
    } catch {
      // Message was removed; recreate it below.
    }
  }
  const message = await channel.send(payload);
  state.setup.panels ??= {};
  state.setup.panels[marker] = message.id;
  return true;
}

export async function setupGuild(guild, onProgress = async () => {}) {
  await guild.roles.fetch();
  await guild.channels.fetch();
  const state = await readGuildState(guild.id);
  state.setup ??= {};

  const summary = { rolesCreated: 0, categoriesCreated: 0, channelsCreated: 0, panelsCreated: 0 };
  const roles = {};

  await onProgress('Creating Kingdom roles…');
  // Create lowest-priority roles first so leadership tends to remain visually higher on fresh servers.
  for (const definition of [...ROLE_BLUEPRINT].reverse()) {
    let role = firstRoleByName(guild, definition.name);
    if (!role) {
      role = await guild.roles.create({
        name: definition.name,
        color: definition.color,
        hoist: definition.hoist,
        permissions: rolePermissions(definition.permissions),
        reason: 'Kingdom Core /setup'
      });
      summary.rolesCreated++;
    }
    roles[definition.key] = role;
  }

  const categories = {};
  await onProgress('Raising the Kingdom categories…');
  for (const definition of CATEGORY_BLUEPRINT) {
    let category = firstChannelByName(guild, definition.name, ChannelType.GuildCategory);
    if (!category) {
      category = await guild.channels.create({
        name: definition.name,
        type: ChannelType.GuildCategory,
        permissionOverwrites: definition.privateFor
          ? privateCategoryOverwrites(guild, roles, definition.privateFor)
          : undefined,
        reason: 'Kingdom Core /setup'
      });
      summary.categoriesCreated++;
    }
    categories[definition.key] = category;
  }

  const channels = {};
  await onProgress('Building channels and permissions…');
  for (const definition of CHANNEL_BLUEPRINT) {
    const targetType = channelTypeMap[definition.type];
    const resolvedType = definition.type === 'announcement' && !guild.features.includes('COMMUNITY')
      ? ChannelType.GuildText
      : targetType;
    let channel = firstChannelByName(guild, definition.name, resolvedType);

    if (!channel) {
      channel = await guild.channels.create({
        name: definition.name,
        type: resolvedType,
        parent: categories[definition.category]?.id,
        permissionOverwrites: CATEGORY_BLUEPRINT.find((c) => c.key === definition.category)?.privateFor
          ? undefined
          : channelOverwrites(guild, definition.readOnly),
        reason: 'Kingdom Core /setup'
      });
      summary.channelsCreated++;
    } else if (!channel.parentId && categories[definition.category]) {
      await channel.setParent(categories[definition.category].id, { lockPermissions: false }).catch(() => null);
    }
    channels[definition.key] = channel;
  }

  state.setup.roles = Object.fromEntries(Object.entries(roles).map(([key, role]) => [key, role.id]));
  state.setup.categories = Object.fromEntries(Object.entries(categories).map(([key, channel]) => [key, channel.id]));
  state.setup.channels = Object.fromEntries(Object.entries(channels).map(([key, channel]) => [key, channel.id]));

  await onProgress('Posting the core Kingdom panels…');
  const mentions = Object.fromEntries(Object.entries(channels).map(([key, channel]) => [key, `<#${channel.id}>`]));
  summary.panelsCreated += Number(await ensurePanel(channels.welcome, 'welcome', welcomePanel(mentions), state));
  summary.panelsCreated += Number(await ensurePanel(channels.rules, 'rules', rulesPanel(), state));
  summary.panelsCreated += Number(await ensurePanel(channels.chooseHouse, 'houses', housePanel(), state));
  summary.panelsCreated += Number(await ensurePanel(channels.roles, 'notifications', notificationPanel(), state));
  summary.panelsCreated += Number(await ensurePanel(channels.carryBoard, 'carry', carryPanel(), state));
  summary.panelsCreated += Number(await ensurePanel(channels.supportPanel, 'support', supportPanel(), state));
  summary.panelsCreated += Number(await ensurePanel(channels.quests, 'quests', questPanel(), state));

  state.setup.completedAt = new Date().toISOString();
  await writeGuildState(guild.id, state);
  return { summary, roles, categories, channels, state };
}
