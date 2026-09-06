import {
  AutoModerationActionType,
  AutoModerationRuleEventType,
  AutoModerationRuleTriggerType,
  ChannelType,
  PermissionFlagsBits
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
  applicationPanel,
  applicationReviewPanel,
  applicationStatusPanel,
  carryPanel,
  securityPanel,
  supportPanel,
  ticketOverviewPanel
} from '../ui/embeds.js';

const SECURITY_ACCESS_KEYS = ['crown', 'regent', 'council', 'gatekeeper', 'royalGuard', 'castleGuard'];
const ALL_ROLE_KEYS = ROLE_BLUEPRINT.map((role) => role.key);

const UPGRADE_CHANNELS = [
  { key: 'applicationStatus', category: 'applications', name: '📌・application-status', publicReadOnly: true },
  { key: 'ticketOverview', category: 'staff', name: '🎫・ticket-overview', staffOnly: true },
  { key: 'ticketTranscripts', category: 'staff', name: '🧾・ticket-transcripts', staffOnly: true },
  { key: 'securityCenter', category: 'security', name: '🛡️・security-center', securityOnly: true },
  { key: 'webhookLog', category: 'security', name: '🪝・webhook-log', securityOnly: true }
];

function roleObjects(guild, state) {
  return Object.fromEntries(
    Object.entries(state.setup?.roles ?? {})
      .map(([key, id]) => [key, guild.roles.cache.get(id)])
      .filter(([, role]) => role)
  );
}

function allowForRole(role, { send = true } = {}) {
  return {
    id: role.id,
    allow: [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.Connect,
      PermissionFlagsBits.Speak,
      ...(send ? [PermissionFlagsBits.SendMessages] : [])
    ]
  };
}

function denyForRole(role) {
  return {
    id: role.id,
    allow: [PermissionFlagsBits.ReadMessageHistory],
    deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect]
  };
}

function privateOverwrites(guild, roles, allowedKeys, { allowedCanSend = true } = {}) {
  const allowed = new Set([...STAFF_KEYS, ...allowedKeys]);
  const overwrites = [{
    id: guild.roles.everyone.id,
    allow: [PermissionFlagsBits.ReadMessageHistory],
    deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect]
  }];

  for (const key of ALL_ROLE_KEYS) {
    const role = roles[key];
    if (!role) continue;
    if (allowed.has(key)) {
      const staff = STAFF_KEYS.includes(key);
      overwrites.push(allowForRole(role, { send: staff || allowedCanSend }));
    } else {
      overwrites.push(denyForRole(role));
    }
  }
  return overwrites;
}

function staffOverwrites(guild, roles, allowedKeys = STAFF_KEYS) {
  const allowed = new Set(allowedKeys);
  const overwrites = [{
    id: guild.roles.everyone.id,
    allow: [PermissionFlagsBits.ReadMessageHistory],
    deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect]
  }];
  for (const key of ALL_ROLE_KEYS) {
    const role = roles[key];
    if (!role) continue;
    overwrites.push(allowed.has(key) ? allowForRole(role) : denyForRole(role));
  }
  return overwrites;
}

function publicReadOnlyOverwrites(guild, roles) {
  const overwrites = [{
    id: guild.roles.everyone.id,
    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
    deny: [PermissionFlagsBits.SendMessages]
  }];
  for (const key of STAFF_KEYS) {
    const role = roles[key];
    if (role) overwrites.push(allowForRole(role));
  }
  return overwrites;
}

async function repairRoleHierarchy(guild, state) {
  await guild.roles.fetch();
  const me = guild.members.me;
  const top = me?.roles.highest?.position ?? 0;
  if (top <= 1) return 0;

  const ordered = ROLE_BLUEPRINT
    .map((definition) => guild.roles.cache.get(state.setup?.roles?.[definition.key]))
    .filter((role) => role && !role.managed && role.editable);

  if (!ordered.length) return 0;
  const highestTarget = Math.max(1, top - 1);
  const positions = ordered.map((role, index) => ({
    role: role.id,
    position: Math.max(1, highestTarget - index)
  }));

  await guild.roles.setPositions(positions).catch(() => null);
  return positions.length;
}

async function ensureCategory(guild, state, roles, key, name, mode) {
  let category = guild.channels.cache.get(state.setup?.categories?.[key]);
  if (!category || category.type !== ChannelType.GuildCategory) {
    category = guild.channels.cache.find((channel) => channel.type === ChannelType.GuildCategory && channel.name === name);
  }
  const overwrites = mode === 'staff'
    ? staffOverwrites(guild, roles)
    : mode === 'security'
      ? staffOverwrites(guild, roles, SECURITY_ACCESS_KEYS)
      : undefined;

  if (!category) {
    category = await guild.channels.create({
      name,
      type: ChannelType.GuildCategory,
      permissionOverwrites: overwrites,
      reason: 'Kingdom Core /setup2'
    });
    state.setup.categories ??= {};
    state.setup.categories[key] = category.id;
    return { category, created: true };
  }

  if (overwrites) await category.permissionOverwrites.set(overwrites, 'Kingdom Core /setup2 explicit X permissions').catch(() => null);
  state.setup.categories ??= {};
  state.setup.categories[key] = category.id;
  return { category, created: false };
}

async function ensureUpgradeChannel(guild, state, roles, definition) {
  let channel = guild.channels.cache.get(state.setup?.channels?.[definition.key]);
  if (!channel || channel.type !== ChannelType.GuildText) {
    channel = guild.channels.cache.find((item) => item.type === ChannelType.GuildText && item.name === definition.name);
  }
  const parent = guild.channels.cache.get(state.setup?.categories?.[definition.category]);
  const overwrites = definition.staffOnly
    ? staffOverwrites(guild, roles)
    : definition.securityOnly
      ? staffOverwrites(guild, roles, SECURITY_ACCESS_KEYS)
      : definition.publicReadOnly
        ? publicReadOnlyOverwrites(guild, roles)
        : undefined;

  let created = false;
  if (!channel) {
    channel = await guild.channels.create({
      name: definition.name,
      type: ChannelType.GuildText,
      parent: parent?.id,
      permissionOverwrites: overwrites,
      reason: 'Kingdom Core /setup2 workflow upgrade'
    });
    created = true;
  } else {
    if (parent && channel.parentId !== parent.id) await channel.setParent(parent.id, { lockPermissions: false }).catch(() => null);
    if (overwrites) await channel.permissionOverwrites.set(overwrites, 'Kingdom Core /setup2 workflow permissions').catch(() => null);
  }

  state.setup.channels ??= {};
  state.setup.channels[definition.key] = channel.id;
  return { channel, created };
}

async function repairManagedPermissions(guild, state, roles) {
  let count = 0;
  const categoryModes = {
    carrier: { allowed: CARRIER_KEYS, mode: 'private' },
    staff: { allowed: STAFF_KEYS, mode: 'staff' },
    security: { allowed: SECURITY_ACCESS_KEYS, mode: 'security' }
  };

  for (const [key, config] of Object.entries(categoryModes)) {
    const category = guild.channels.cache.get(state.setup?.categories?.[key]);
    if (!category) continue;
    const overwrites = config.mode === 'private'
      ? privateOverwrites(guild, roles, config.allowed)
      : staffOverwrites(guild, roles, config.allowed);
    await category.permissionOverwrites.set(overwrites, 'Kingdom Core /setup2 explicit access matrix').catch(() => null);
    count++;
  }

  for (const definition of CHANNEL_BLUEPRINT) {
    const channel = guild.channels.cache.get(state.setup?.channels?.[definition.key]);
    if (!channel || channel.type === ChannelType.GuildCategory) continue;

    await channel.permissionOverwrites.edit(guild.roles.everyone, { ReadMessageHistory: true }, { reason: 'Kingdom Core /setup2 history baseline' }).catch(() => null);

    if (definition.accessFor?.length) {
      const overwrites = privateOverwrites(guild, roles, definition.accessFor, { allowedCanSend: !definition.readOnly });
      await channel.permissionOverwrites.set(overwrites, 'Kingdom Core /setup2 House/private X permissions').catch(() => null);
      count++;
      continue;
    }

    const categoryDefinition = CATEGORY_BLUEPRINT.find((category) => category.key === definition.category);
    if (!categoryDefinition?.privateFor && definition.readOnly && channel.type !== ChannelType.GuildVoice) {
      await channel.permissionOverwrites.set(publicReadOnlyOverwrites(guild, roles), 'Kingdom Core /setup2 read-only permissions').catch(() => null);
      count++;
      continue;
    }

    if (categoryDefinition?.privateFor && definition.readOnly && channel.type !== ChannelType.GuildVoice) {
      const allowedKeys = definition.category === 'carrier' ? CARRIER_KEYS : STAFF_KEYS;
      const overwrites = definition.category === 'carrier'
        ? privateOverwrites(guild, roles, allowedKeys, { allowedCanSend: false })
        : staffOverwrites(guild, roles, STAFF_KEYS);
      await channel.permissionOverwrites.set(overwrites, 'Kingdom Core /setup2 private read-only permissions').catch(() => null);
      count++;
    }
  }

  return count;
}

async function upsertPanel(channel, marker, payload, state) {
  if (!channel?.isTextBased()) return false;
  state.setup.panels ??= {};
  const id = state.setup.panels[marker];
  if (id) {
    const existing = await channel.messages.fetch(id).catch(() => null);
    if (existing) {
      await existing.edit(payload).catch(() => null);
      return true;
    }
  }
  const message = await channel.send({ ...payload, allowedMentions: { parse: [] } });
  state.setup.panels[marker] = message.id;
  return true;
}

async function prepareWebhook(channel, state, key, name, guild) {
  if (!channel?.isTextBased() || typeof channel.createWebhook !== 'function') return false;
  state.setup.webhooks ??= {};

  const saved = state.setup.webhooks[key];
  if (saved?.id && saved?.token) {
    const fetched = await guild.client.fetchWebhook(saved.id, saved.token).catch(() => null);
    if (fetched) return false;
  }

  const hooks = await channel.fetchWebhooks().catch(() => null);
  const existing = hooks?.find((hook) => hook.name === name && hook.owner?.id === guild.client.user.id);
  if (existing?.token) {
    state.setup.webhooks[key] = { id: existing.id, token: existing.token, channelId: channel.id, name };
    return false;
  }

  const hook = await channel.createWebhook({
    name,
    avatar: guild.client.user.displayAvatarURL(),
    reason: 'Kingdom Core /setup2 branded system webhook'
  }).catch(() => null);
  if (!hook?.token) return false;

  state.setup.webhooks[key] = { id: hook.id, token: hook.token, channelId: channel.id, name };
  await hook.send({
    username: name,
    avatarURL: guild.client.user.displayAvatarURL(),
    content: `✅ **${name}** webhook stream is online.`,
    allowedMentions: { parse: [] }
  }).catch(() => null);
  return true;
}

async function ensureAutoModUpgrade(guild, state, roles) {
  const existing = await guild.autoModerationRules.fetch().catch(() => null);
  if (!existing) return 0;
  const alertChannelId = state.setup?.channels?.securityLog;
  const exemptRoles = STAFF_KEYS.map((key) => roles[key]?.id).filter(Boolean).slice(0, 20);
  let changed = 0;

  const definitions = [
    {
      name: 'Kingdom Core • Mention Spam',
      eventType: AutoModerationRuleEventType.MessageSend,
      triggerType: AutoModerationRuleTriggerType.MentionSpam,
      triggerMetadata: { mentionTotalLimit: 4, mentionRaidProtectionEnabled: true },
      actions: [
        { type: AutoModerationActionType.BlockMessage, metadata: { customMessage: 'Too many mentions. Slow down.' } },
        ...(alertChannelId ? [{ type: AutoModerationActionType.SendAlertMessage, metadata: { channel: alertChannelId } }] : [])
      ],
      enabled: true,
      exemptRoles
    },
    {
      name: 'Kingdom Core • Generic Spam',
      eventType: AutoModerationRuleEventType.MessageSend,
      triggerType: AutoModerationRuleTriggerType.Spam,
      actions: [
        { type: AutoModerationActionType.BlockMessage, metadata: { customMessage: 'Discord detected this as spam.' } },
        ...(alertChannelId ? [{ type: AutoModerationActionType.SendAlertMessage, metadata: { channel: alertChannelId } }] : [])
      ],
      enabled: true,
      exemptRoles
    }
  ];

  for (const definition of definitions) {
    const rule = existing.find((item) => item.name === definition.name);
    if (rule) {
      await rule.edit({ ...definition, reason: 'Kingdom Core /setup2 security upgrade' }).catch(() => null);
      changed++;
    } else {
      await guild.autoModerationRules.create({ ...definition, reason: 'Kingdom Core /setup2 security upgrade' }).catch(() => null);
      changed++;
    }
  }
  return changed;
}

export async function upgradeGuild(guild, onProgress = async () => {}) {
  await guild.roles.fetch();
  await guild.channels.fetch();
  const state = await readGuildState(guild.id);
  state.setup ??= {};
  if (!state.setup.completedAt) throw new Error('Run /setup once before /setup2.');
  state.security = {
    blockUnauthorizedBots: true,
    messageSpamProtection: true,
    spamLimit: 9,
    spamWindowMs: 7000,
    spamTimeoutMs: 300000,
    ...(state.security ?? {})
  };

  const summary = {
    rolesReordered: 0,
    permissionsRepaired: 0,
    channelsCreated: 0,
    panelsUpgraded: 0,
    webhooksPrepared: 0,
    automodChanged: 0
  };
  const roles = roleObjects(guild, state);

  await onProgress('Correcting the role hierarchy…');
  summary.rolesReordered = await repairRoleHierarchy(guild, state);

  await onProgress('Applying explicit X/✓ permission matrices and history access…');
  summary.permissionsRepaired = await repairManagedPermissions(guild, state, roles);

  await onProgress('Adding application, ticket and security upgrade channels…');
  const tickets = await ensureCategory(guild, state, roles, 'tickets', '━━ 🎫 OPEN TICKETS ━━', 'staff');
  if (tickets.created) summary.channelsCreated++;

  for (const definition of UPGRADE_CHANNELS) {
    const result = await ensureUpgradeChannel(guild, state, roles, definition);
    if (result.created) summary.channelsCreated++;
  }

  await onProgress('Upgrading carry, application, ticket and security UI…');
  const channel = (key) => guild.channels.cache.get(state.setup?.channels?.[key]);
  summary.panelsUpgraded += Number(await upsertPanel(channel('carryBoard'), 'carry', carryPanel(), state));
  summary.panelsUpgraded += Number(await upsertPanel(channel('supportPanel'), 'support', supportPanel(), state));
  summary.panelsUpgraded += Number(await upsertPanel(channel('staffApplications'), 'appStaff', applicationPanel('staff'), state));
  summary.panelsUpgraded += Number(await upsertPanel(channel('carrierApplications'), 'appCarrier', applicationPanel('carrier'), state));
  summary.panelsUpgraded += Number(await upsertPanel(channel('creatorApplications'), 'appCreator', applicationPanel('creator'), state));
  summary.panelsUpgraded += Number(await upsertPanel(channel('applicationsReview'), 'appReviewGuide', applicationReviewPanel(), state));
  summary.panelsUpgraded += Number(await upsertPanel(channel('applicationStatus'), 'appStatus', applicationStatusPanel(), state));
  summary.panelsUpgraded += Number(await upsertPanel(channel('ticketOverview'), 'ticketOverview', ticketOverviewPanel(), state));
  summary.panelsUpgraded += Number(await upsertPanel(channel('securityCenter'), 'securityCenter', securityPanel(state.security), state));

  await onProgress('Preparing branded webhook streams…');
  summary.webhooksPrepared += Number(await prepareWebhook(channel('securityLog'), state, 'security', 'Kingdom Security', guild));
  summary.webhooksPrepared += Number(await prepareWebhook(channel('staffLogs'), state, 'registry', 'Royal Registry', guild));
  summary.webhooksPrepared += Number(await prepareWebhook(channel('carrierLogs'), state, 'dispatch', 'Knight Dispatch', guild));

  await onProgress('Deepening AutoMod and anti-spam protection…');
  summary.automodChanged = await ensureAutoModUpgrade(guild, state, roles);

  state.setup.upgrade2At = new Date().toISOString();
  state.setup.version = 3;
  await writeGuildState(guild.id, state);
  return { summary, state };
}
