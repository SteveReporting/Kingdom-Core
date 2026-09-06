import { ChannelType, PermissionFlagsBits } from 'discord.js';
import {
  CATEGORY_BLUEPRINT,
  CHANNEL_BLUEPRINT,
  CARRIER_KEYS,
  ROLE_BLUEPRINT,
  STAFF_KEYS
} from '../config/blueprint.js';
import { readGuildState } from '../storage/store.js';

const SECURITY_ACCESS_KEYS = ['crown', 'regent', 'council', 'gatekeeper', 'royalGuard', 'castleGuard'];
const ALL_ROLE_KEYS = ROLE_BLUEPRINT.map((role) => role.key);

function roleMap(guild, state) {
  return Object.fromEntries(
    Object.entries(state.setup?.roles ?? {})
      .map(([key, id]) => [key, guild.roles.cache.get(id)])
      .filter(([, role]) => role)
  );
}

function denyHidden(role) {
  return {
    id: role.id,
    allow: [PermissionFlagsBits.ReadMessageHistory],
    deny: [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.Connect,
      PermissionFlagsBits.Speak
    ]
  };
}

function allowVisible(role, { send = true, voice = false } = {}) {
  const allow = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory];
  const deny = [];

  if (send) allow.push(PermissionFlagsBits.SendMessages);
  else deny.push(PermissionFlagsBits.SendMessages);

  if (voice) {
    allow.push(PermissionFlagsBits.Connect, PermissionFlagsBits.Speak);
  }

  return { id: role.id, allow, deny };
}

function privateMatrix(guild, roles, allowedKeys, { send = true, voice = false } = {}) {
  const allowed = new Set(allowedKeys);
  const rows = [{
    id: guild.roles.everyone.id,
    allow: [PermissionFlagsBits.ReadMessageHistory],
    deny: [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.Connect,
      PermissionFlagsBits.Speak
    ]
  }];

  for (const key of ALL_ROLE_KEYS) {
    const role = roles[key];
    if (!role) continue;
    rows.push(allowed.has(key) ? allowVisible(role, { send, voice }) : denyHidden(role));
  }
  return rows;
}

function publicReadOnlyMatrix(guild, roles) {
  const rows = [{
    id: guild.roles.everyone.id,
    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
    deny: [PermissionFlagsBits.SendMessages]
  }];

  const staff = new Set(STAFF_KEYS);
  for (const key of ALL_ROLE_KEYS) {
    const role = roles[key];
    if (!role) continue;
    rows.push(staff.has(key)
      ? allowVisible(role, { send: true })
      : {
        id: role.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
        deny: [PermissionFlagsBits.SendMessages]
      });
  }
  return rows;
}

function categoryAllowedKeys(categoryKey) {
  if (categoryKey === 'carrier') return [...STAFF_KEYS, ...CARRIER_KEYS];
  if (categoryKey === 'staff') return STAFF_KEYS;
  if (categoryKey === 'security') return SECURITY_ACCESS_KEYS;
  return null;
}

export async function finishPermissionMatrix(guild) {
  await guild.roles.fetch();
  await guild.channels.fetch();
  const state = await readGuildState(guild.id);
  const roles = roleMap(guild, state);
  let repaired = 0;

  for (const categoryKey of ['carrier', 'staff', 'security']) {
    const category = guild.channels.cache.get(state.setup?.categories?.[categoryKey]);
    if (!category || category.type !== ChannelType.GuildCategory) continue;
    const allowed = categoryAllowedKeys(categoryKey);
    await category.permissionOverwrites.set(
      privateMatrix(guild, roles, allowed, { send: true, voice: false }),
      'Kingdom Core /setup2 final explicit X/✓ category matrix'
    ).catch(() => null);
    repaired++;
  }

  for (const definition of CHANNEL_BLUEPRINT) {
    const channel = guild.channels.cache.get(state.setup?.channels?.[definition.key]);
    if (!channel) continue;

    await channel.permissionOverwrites.edit(
      guild.roles.everyone,
      { ReadMessageHistory: true },
      { reason: 'Kingdom Core /setup2 preserve message history everywhere' }
    ).catch(() => null);

    const isVoice = channel.type === ChannelType.GuildVoice;
    const categoryDefinition = CATEGORY_BLUEPRINT.find((category) => category.key === definition.category);

    if (definition.accessFor?.length) {
      const allowed = [...STAFF_KEYS, ...definition.accessFor];
      await channel.permissionOverwrites.set(
        privateMatrix(guild, roles, allowed, { send: !definition.readOnly, voice: isVoice }),
        'Kingdom Core /setup2 explicit House/private X permissions'
      ).catch(() => null);
      repaired++;
      continue;
    }

    const privateAllowed = categoryAllowedKeys(definition.category);
    if (privateAllowed) {
      await channel.permissionOverwrites.set(
        privateMatrix(guild, roles, privateAllowed, { send: !definition.readOnly, voice: isVoice }),
        'Kingdom Core /setup2 explicit private channel X permissions'
      ).catch(() => null);
      repaired++;
      continue;
    }

    if (definition.readOnly && !isVoice) {
      await channel.permissionOverwrites.set(
        publicReadOnlyMatrix(guild, roles),
        'Kingdom Core /setup2 explicit read-only X permissions'
      ).catch(() => null);
      repaired++;
      continue;
    }

    if (categoryDefinition?.privateFor) repaired++;
  }

  for (const extraKey of ['applicationStatus']) {
    const channel = guild.channels.cache.get(state.setup?.channels?.[extraKey]);
    if (!channel?.isTextBased()) continue;
    await channel.permissionOverwrites.set(
      publicReadOnlyMatrix(guild, roles),
      'Kingdom Core /setup2 explicit application status permissions'
    ).catch(() => null);
    repaired++;
  }

  for (const extraKey of ['ticketOverview', 'ticketTranscripts']) {
    const channel = guild.channels.cache.get(state.setup?.channels?.[extraKey]);
    if (!channel) continue;
    await channel.permissionOverwrites.set(
      privateMatrix(guild, roles, STAFF_KEYS, { send: false }),
      'Kingdom Core /setup2 explicit staff-log permissions'
    ).catch(() => null);
    repaired++;
  }

  for (const extraKey of ['securityCenter', 'webhookLog']) {
    const channel = guild.channels.cache.get(state.setup?.channels?.[extraKey]);
    if (!channel) continue;
    await channel.permissionOverwrites.set(
      privateMatrix(guild, roles, SECURITY_ACCESS_KEYS, { send: false }),
      'Kingdom Core /setup2 explicit security permissions'
    ).catch(() => null);
    repaired++;
  }

  return repaired;
}
