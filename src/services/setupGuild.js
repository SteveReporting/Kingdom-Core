import {
  AutoModerationActionType,
  AutoModerationRuleEventType,
  AutoModerationRuleTriggerType,
  ChannelType,
  GuildExplicitContentFilter,
  GuildVerificationLevel,
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
  Administrator: PermissionFlagsBits.Administrator,
  ManageGuild: PermissionFlagsBits.ManageGuild,
  ManageRoles: PermissionFlagsBits.ManageRoles,
  ManageChannels: PermissionFlagsBits.ManageChannels,
  ManageWebhooks: PermissionFlagsBits.ManageWebhooks,
  ManageMessages: PermissionFlagsBits.ManageMessages,
  ManageEvents: PermissionFlagsBits.ManageEvents,
  ModerateMembers: PermissionFlagsBits.ModerateMembers,
  KickMembers: PermissionFlagsBits.KickMembers,
  BanMembers: PermissionFlagsBits.BanMembers,
  ViewAuditLog: PermissionFlagsBits.ViewAuditLog
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

function existingManagedChannel(guild, id, type) {
  if (!id) return null;
  const channel = guild.channels.cache.get(id);
  if (!channel) return null;
  return type === undefined || channel.type === type ? channel : null;
}

function roleAccessOverwrites(guild, roles, keys, { readOnly = false } = {}) {
  const overwrites = [{ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }];
  for (const key of [...new Set([...STAFF_KEYS, ...keys])]) {
    const role = roles[key];
    if (!role) continue;
    overwrites.push({
      id: role.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ReadMessageHistory,
        ...(readOnly ? [] : [PermissionFlagsBits.SendMessages])
      ]
    });
  }
  return overwrites;
}

function privateCategoryOverwrites(guild, roles, mode) {
  const allows = mode === 'staff' ? STAFF_KEYS : [...STAFF_KEYS, ...CARRIER_KEYS];
  return roleAccessOverwrites(guild, roles, allows);
}

function publicChannelOverwrites(guild, roles, readOnly) {
  if (!readOnly) return undefined;
  const overwrites = [{
    id: guild.roles.everyone.id,
    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
    deny: [PermissionFlagsBits.SendMessages]
  }];
  for (const key of STAFF_KEYS) {
    const role = roles[key];
    if (!role) continue;
    overwrites.push({
      id: role.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages]
    });
  }
  return overwrites;
}

function channelOverwrites(guild, roles, definition) {
  if (definition.accessFor?.length) {
    return roleAccessOverwrites(guild, roles, definition.accessFor, { readOnly: Boolean(definition.readOnly) });
  }
  return publicChannelOverwrites(guild, roles, definition.readOnly);
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

async function ensureAutoMod(guild, channels, roles) {
  const me = guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageGuild)) return 0;
  const existing = await guild.autoModerationRules.fetch().catch(() => null);
  if (!existing) return 0;
  let created = 0;
  const exemptRoles = STAFF_KEYS.map((key) => roles[key]?.id).filter(Boolean).slice(0, 20);
  const alertChannel = channels.securityLog;

  const definitions = [
    {
      name: 'Kingdom Core • Mention Spam',
      eventType: AutoModerationRuleEventType.MessageSend,
      triggerType: AutoModerationRuleTriggerType.MentionSpam,
      triggerMetadata: { mentionTotalLimit: 5, mentionRaidProtectionEnabled: true },
      actions: [
        { type: AutoModerationActionType.BlockMessage, metadata: { customMessage: 'Too many mentions. Slow down.' } },
        ...(alertChannel ? [{ type: AutoModerationActionType.SendAlertMessage, metadata: { channel: alertChannel.id } }] : [])
      ],
      enabled: true,
      exemptRoles
    }
  ];

  for (const definition of definitions) {
    if (existing.find((rule) => rule.name === definition.name)) continue;
    await guild.autoModerationRules.create({ ...definition, reason: 'Kingdom Core /setup security baseline' }).catch(() => null);
    created++;
  }
  return created;
}

async function hardenGuild(guild) {
  const changes = [];
  if (guild.verificationLevel < GuildVerificationLevel.Medium) {
    await guild.setVerificationLevel(GuildVerificationLevel.Medium, 'Kingdom Core /setup security baseline').catch(() => null);
    changes.push('verification');
  }
  if (guild.explicitContentFilter !== GuildExplicitContentFilter.AllMembers) {
    await guild.setExplicitContentFilter(GuildExplicitContentFilter.AllMembers, 'Kingdom Core /setup security baseline').catch(() => null);
    changes.push('content-filter');
  }
  return changes;
}

export async function setupGuild(guild, onProgress = async () => {}, options = {}) {
  const preserveExistingChannelParents = Boolean(options.preserveExistingChannelParents);

  await guild.roles.fetch();
  await guild.channels.fetch();
  const state = await readGuildState(guild.id);
  state.setup ??= {};
  state.setup.roles ??= {};
  state.setup.categories ??= {};
  state.setup.channels ??= {};
  state.security ??= { blockUnauthorizedBots: true };

  const summary = {
    rolesCreated: 0,
    rolesUpdated: 0,
    categoriesCreated: 0,
    channelsCreated: 0,
    panelsCreated: 0,
    automodCreated: 0,
    securityChanges: 0
  };
  const roles = {};

  await onProgress('Creating and repairing Kingdom roles…');
  for (const definition of [...ROLE_BLUEPRINT].reverse()) {
    let role = guild.roles.cache.get(state.setup.roles[definition.key]) ?? firstRoleByName(guild, definition.name);
    const desiredPermissions = rolePermissions(definition.permissions);
    if (!role) {
      role = await guild.roles.create({
        name: definition.name,
        color: definition.color,
        hoist: definition.hoist,
        permissions: desiredPermissions,
        reason: 'Kingdom Core /setup'
      });
      summary.rolesCreated++;
    } else {
      const needsUpdate = role.color !== definition.color || role.hoist !== definition.hoist || !role.permissions.equals(desiredPermissions);
      if (needsUpdate && role.editable) {
        await role.edit({
          color: definition.color,
          hoist: definition.hoist,
          permissions: desiredPermissions,
          reason: 'Kingdom Core /setup repair'
        }).catch(() => null);
        summary.rolesUpdated++;
      }
    }
    roles[definition.key] = role;
  }

  const owner = await guild.fetchOwner().catch(() => null);
  if (owner && roles.crown && !owner.roles.cache.has(roles.crown.id)) {
    await owner.roles.add(roles.crown, 'Kingdom Core /setup assigns The Crown to server owner').catch(() => null);
  }

  const categories = {};
  await onProgress('Reusing and repairing Kingdom categories…');
  for (const definition of CATEGORY_BLUEPRINT) {
    let category = existingManagedChannel(guild, state.setup.categories[definition.key], ChannelType.GuildCategory)
      ?? firstChannelByName(guild, definition.name, ChannelType.GuildCategory);
    const overwrites = definition.privateFor ? privateCategoryOverwrites(guild, roles, definition.privateFor) : undefined;
    if (!category) {
      category = await guild.channels.create({
        name: definition.name,
        type: ChannelType.GuildCategory,
        permissionOverwrites: overwrites,
        reason: 'Kingdom Core /setup'
      });
      summary.categoriesCreated++;
    } else if (overwrites) {
      await category.permissionOverwrites.set(overwrites, 'Kingdom Core /setup repair').catch(() => null);
    }
    categories[definition.key] = category;
  }

  const channels = {};
  await onProgress('Reusing channels and repairing permissions…');
  for (const definition of CHANNEL_BLUEPRINT) {
    const targetType = channelTypeMap[definition.type];
    const resolvedType = definition.type === 'announcement' && !guild.features.includes('COMMUNITY')
      ? ChannelType.GuildText
      : targetType;
    let channel = existingManagedChannel(guild, state.setup.channels[definition.key], resolvedType)
      ?? firstChannelByName(guild, definition.name, resolvedType);
    const category = categories[definition.category];
    const categoryPrivate = CATEGORY_BLUEPRINT.find((c) => c.key === definition.category)?.privateFor;
    const overwrites = definition.accessFor?.length
      ? channelOverwrites(guild, roles, definition)
      : (categoryPrivate ? undefined : channelOverwrites(guild, roles, definition));

    if (!channel) {
      channel = await guild.channels.create({
        name: definition.name,
        type: resolvedType,
        parent: category?.id,
        permissionOverwrites: overwrites,
        reason: 'Kingdom Core /setup'
      });
      summary.channelsCreated++;
    } else {
      if (!preserveExistingChannelParents && category && channel.parentId !== category.id) {
        await channel.setParent(category.id, { lockPermissions: false }).catch(() => null);
      }
      if (overwrites) {
        await channel.permissionOverwrites.set(overwrites, 'Kingdom Core /setup repair').catch(() => null);
      }
    }
    channels[definition.key] = channel;
  }

  state.setup.roles = Object.fromEntries(Object.entries(roles).map(([key, role]) => [key, role.id]));
  state.setup.categories = Object.fromEntries(Object.entries(categories).map(([key, channel]) => [key, channel.id]));
  state.setup.channels = Object.fromEntries(Object.entries(channels).map(([key, channel]) => [key, channel.id]));

  await onProgress('Applying server security and AutoMod…');
  summary.securityChanges = (await hardenGuild(guild)).length;
  summary.automodCreated = await ensureAutoMod(guild, channels, roles);

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
  state.setup.version = Math.max(Number(state.setup.version ?? 0), 2);
  await writeGuildState(guild.id, state);
  return { summary, roles, categories, channels, state };
}
