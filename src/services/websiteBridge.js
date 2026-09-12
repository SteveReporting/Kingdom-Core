import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits
} from 'discord.js';
import { BRAND, CARRIER_KEYS, ROLE_BLUEPRINT, STAFF_KEYS } from '../config/blueprint.js';
import { mutateGuildState, readGuildState } from '../storage/store.js';
import { refreshCarryPanels } from './carryTickets.js';
import { sendBrandedWebhook } from './webhooks.js';

const DUNGEONS = new Set([
  'Desert Temple', 'Winter Outpost', 'Pirate Island', "King's Castle", 'The Underworld',
  'Samurai Palace', 'The Canals', 'Ghastly Harbor', 'Steampunk Sewers', 'Boss Raids',
  'Orbital Outpost', 'Volcanic Chambers', 'Aquatic Temple', 'Enchanted Forest', 'Northern Lands',
  'Gilded Skies', 'Yokai Peak', 'Abyssal Void'
]);
const DIFFICULTIES = new Set(['Easy', 'Medium', 'Hard', 'Insane', 'Nightmare']);
const MODES = new Set(['Normal', 'Hardcore']);
const ACTIVE = new Set(['open', 'claimed', 'ready', 'running']);
const NOTIFICATION_KEYS = [
  'carryStatus', 'eventReminders', 'marketplaceActivity', 'announcements', 'applicationUpdates'
];

function apiError(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function cleanString(value, max = 180) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function carryTicketOverwrites(guild, state, userId) {
  const roleIds = state.setup?.roles ?? {};
  const allowed = new Set([...STAFF_KEYS, ...CARRIER_KEYS].map((key) => roleIds[key]).filter(Boolean));
  const rows = [{
    id: guild.roles.everyone.id,
    allow: [PermissionFlagsBits.ReadMessageHistory],
    deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
  }];

  for (const definition of ROLE_BLUEPRINT) {
    const id = roleIds[definition.key];
    if (!id) continue;
    rows.push(allowed.has(id)
      ? {
        id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
      }
      : {
        id,
        allow: [PermissionFlagsBits.ReadMessageHistory],
        deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
      });
  }

  rows.push({
    id: userId,
    allow: [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.AttachFiles,
      PermissionFlagsBits.EmbedLinks
    ]
  });
  return rows;
}

function ticketButtons(ticket) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`kc2:carry:claim:${ticket.id}`).setLabel('Claim Mission').setEmoji('🛡️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`kc2:carry:close:${ticket.id}`).setLabel('Remove / Close').setEmoji('✖️').setStyle(ButtonStyle.Danger)
  )];
}

function ticketEmbed(ticket) {
  const fields = [
    { name: 'Member', value: `<@${ticket.userId}>`, inline: true },
    { name: 'Knight', value: 'Unassigned', inline: true },
    { name: 'Source', value: 'Website', inline: true }
  ];
  if (ticket.robloxUsername) fields.push({ name: 'Roblox', value: `\`${ticket.robloxUsername}\``, inline: true });
  if (ticket.level) fields.push({ name: 'Level', value: String(ticket.level), inline: true });
  if (ticket.region) fields.push({ name: 'Region', value: ticket.region, inline: true });
  if (ticket.partyRequirements) fields.push({ name: 'Party', value: ticket.partyRequirements, inline: false });

  return new EmbedBuilder()
    .setColor(BRAND.color)
    .setTitle(`⚔️ Carry Mission • ${ticket.id}`)
    .setDescription([
      `**${ticket.dungeon}** • **${ticket.difficulty}** • **${ticket.mode}**`,
      '',
      'Status: **🟡 Waiting for Knight**',
      ticket.notes ? `> ${ticket.notes}` : '> No extra carrier notes.'
    ].join('\n'))
    .addFields(fields)
    .setFooter({ text: BRAND.footer })
    .setTimestamp();
}

export async function createWebsiteCarryTicket(guild, input = {}) {
  const userId = cleanString(input.userId, 32);
  const dungeon = cleanString(input.dungeon, 64);
  const difficulty = cleanString(input.difficulty, 32);
  const mode = cleanString(input.mode, 32) || 'Normal';
  const notes = cleanString(input.notes, 180);
  const region = cleanString(input.region, 64);
  const partyRequirements = cleanString(input.partyRequirements, 120);
  const robloxUsername = cleanString(input.robloxUsername, 20);
  const numericLevel = Number(input.level);
  const level = Number.isFinite(numericLevel) && numericLevel > 0 && numericLevel < 10000
    ? Math.floor(numericLevel)
    : null;

  if (!userId) throw apiError('missing_user', 'Discord user is required.', 401);
  if (!DUNGEONS.has(dungeon)) throw apiError('invalid_dungeon', 'Choose a supported dungeon.');
  if (!DIFFICULTIES.has(difficulty)) throw apiError('invalid_difficulty', 'Choose a supported difficulty.');
  if (!MODES.has(mode)) throw apiError('invalid_mode', 'Choose Normal or Hardcore mode.');
  if (robloxUsername && !/^[A-Za-z0-9_]{3,20}$/.test(robloxUsername)) {
    throw apiError('invalid_roblox_username', 'Roblox username must be 3-20 letters, numbers or underscores.');
  }

  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) throw apiError('not_guild_member', 'Join the Kingdom Carries Discord before requesting a carry.', 403);

  const state = await readGuildState(guild.id);
  const existing = Object.values(state.carryTickets ?? {}).find(
    (ticket) => ticket.userId === userId && ACTIVE.has(ticket.status)
  );
  if (existing) {
    throw apiError('active_ticket_exists', `You already have an active carry mission (${existing.id}).`, 409);
  }

  const parent = guild.channels.cache.get(state.setup?.categories?.carryTickets);
  if (!parent || parent.type !== ChannelType.GuildCategory) {
    throw apiError('carry_system_not_configured', 'The Discord carry-ticket category is unavailable. Run /setup2 first.', 503);
  }

  const short = Date.now().toString(36).slice(-5);
  const safe = member.user.username.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24) || userId.slice(-8);
  const id = `KC-${short.toUpperCase()}`;
  const channel = await guild.channels.create({
    name: `carry-${safe}-${short}`.slice(0, 100),
    type: ChannelType.GuildText,
    parent: parent.id,
    topic: `Kingdom Core website carry ${id} • ${userId} • ${dungeon} • ${difficulty} • ${mode}`,
    permissionOverwrites: carryTicketOverwrites(guild, state, userId),
    reason: `Kingdom Carries website request ${id}`
  });

  const ticket = {
    id,
    userId,
    username: member.user.username,
    displayName: member.displayName,
    channelId: channel.id,
    dungeon,
    difficulty,
    mode,
    notes,
    level,
    robloxUsername: robloxUsername || null,
    region: region || null,
    partyRequirements: partyRequirements || null,
    source: 'website',
    status: 'open',
    carrierId: null,
    createdAt: new Date().toISOString()
  };

  const header = await channel.send({
    content: `<@${userId}>`,
    embeds: [ticketEmbed(ticket)],
    components: ticketButtons(ticket),
    allowedMentions: { users: [userId], roles: [] }
  });
  ticket.headerMessageId = header.id;
  if (!header.pinned) await header.pin('Kingdom Core website carry mission controls').catch(() => null);

  const control = guild.channels.cache.get(state.setup?.channels?.carryControl);
  if (control?.isTextBased()) {
    const controlMsg = await control.send({
      embeds: [ticketEmbed(ticket)],
      components: ticketButtons(ticket),
      allowedMentions: { parse: [] }
    });
    ticket.controlMessageId = controlMsg.id;
  }

  await mutateGuildState(guild.id, async (fresh) => {
    fresh.carryTickets ??= {};
    fresh.carryTickets[id] = ticket;
    fresh.identities ??= {};
    const identity = fresh.identities[userId] ?? { userId };
    identity.userId = userId;
    identity.website ??= {};
    if (robloxUsername) identity.website.robloxUsername = robloxUsername;
    if (region) identity.website.region = region;
    identity.website.lastSeenAt = new Date().toISOString();
    fresh.identities[userId] = identity;
    await refreshCarryPanels(guild, fresh);
  });

  const fresh = await readGuildState(guild.id);
  await sendBrandedWebhook(guild, fresh, 'carry', {
    embeds: [new EmbedBuilder()
      .setColor(BRAND.color)
      .setTitle('🌐 New Website Carry Mission')
      .setDescription(`**${dungeon}** • ${difficulty} • ${mode}`)
      .addFields(
        { name: 'Member', value: `<@${userId}>`, inline: true },
        { name: 'Ticket', value: `<#${channel.id}>`, inline: true },
        { name: 'Mission ID', value: `\`${id}\``, inline: true }
      )
      .setFooter({ text: BRAND.footer })
      .setTimestamp()]
  }).catch(() => null);

  return { guildId: guild.id, ticket };
}

export async function getWebsiteMemberProfile(guild, userId) {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) throw apiError('not_guild_member', 'This Discord account is not in the Kingdom Carries server.', 403);
  const state = await readGuildState(guild.id);
  const identity = state.identities?.[userId] ?? {};
  const website = identity.website ?? {};

  return {
    discord: {
      id: userId,
      username: member.user.username,
      displayName: member.displayName,
      nickname: member.nickname ?? '',
      avatarUrl: member.displayAvatarURL({ extension: 'png', size: 128 })
    },
    profile: {
      displayName: cleanString(website.displayName, 32) || member.displayName,
      robloxUsername: cleanString(website.robloxUsername, 20),
      region: cleanString(website.region, 64)
    },
    notifications: {
      carryStatus: website.notifications?.carryStatus ?? true,
      eventReminders: website.notifications?.eventReminders ?? true,
      marketplaceActivity: website.notifications?.marketplaceActivity ?? false,
      announcements: website.notifications?.announcements ?? true,
      applicationUpdates: website.notifications?.applicationUpdates ?? true
    },
    display: {
      compactMode: website.display?.compactMode ?? false,
      reducedMotion: website.display?.reducedMotion ?? false
    },
    stats: {
      kingdomXp: identity.kingdomXp ?? 0,
      prestige: identity.prestige ?? 0,
      carriesReceived: Object.values(state.carryTickets ?? {}).filter(
        (ticket) => ticket.userId === userId && ticket.status === 'completed'
      ).length
    }
  };
}

export async function updateWebsiteMemberProfile(guild, userId, patch = {}) {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) throw apiError('not_guild_member', 'This Discord account is not in the Kingdom Carries server.', 403);

  const displayName = cleanString(patch.displayName, 32);
  const robloxUsername = cleanString(patch.robloxUsername, 20);
  const region = cleanString(patch.region, 64);

  if (robloxUsername && !/^[A-Za-z0-9_]{3,20}$/.test(robloxUsername)) {
    throw apiError('invalid_roblox_username', 'Roblox username must be 3-20 letters, numbers or underscores.');
  }

  await mutateGuildState(guild.id, async (state) => {
    state.identities ??= {};
    const identity = state.identities[userId] ?? { userId };
    identity.userId = userId;
    identity.website ??= {};
    identity.website.displayName = displayName;
    identity.website.robloxUsername = robloxUsername;
    identity.website.region = region;
    identity.website.notifications ??= {};
    for (const key of NOTIFICATION_KEYS) {
      if (typeof patch.notifications?.[key] === 'boolean') {
        identity.website.notifications[key] = patch.notifications[key];
      }
    }
    identity.website.display ??= {};
    if (typeof patch.display?.compactMode === 'boolean') identity.website.display.compactMode = patch.display.compactMode;
    if (typeof patch.display?.reducedMotion === 'boolean') identity.website.display.reducedMotion = patch.display.reducedMotion;
    identity.website.updatedAt = new Date().toISOString();
    state.identities[userId] = identity;
  });

  return getWebsiteMemberProfile(guild, userId);
}

export function normaliseWebsiteBridgeError(error) {
  return {
    status: Number(error?.status) || 500,
    body: {
      error: error?.code || 'internal_error',
      message: Number(error?.status) ? error.message : 'Kingdom Core could not complete that request.'
    }
  };
}
