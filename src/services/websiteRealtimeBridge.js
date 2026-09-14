import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits
} from 'discord.js';
import { BRAND, STAFF_KEYS } from '../config/blueprint.js';
import { mutateGuildState, readGuildState } from '../storage/store.js';
import { LEVEL_TIERS } from './levelRoles.js';
import { refreshPartyPanels } from './carryPartiesV3.js';
import { refreshTicketControl } from './ticketControlV2.js';

const SUPPORT_TYPES = {
  support: { label: 'Support', emoji: '🛟', color: 0x5865f2 },
  report: { label: 'Member Report', emoji: '🚨', color: 0xed4245 },
  partnership: { label: 'Partnership', emoji: '🤝', color: 0x57f287 },
  appeal: { label: 'Appeal', emoji: '⚖️', color: 0xfee75c }
};

const ACTIVE_CARRY = new Set(['open', 'claimed', 'ready', 'running', 'between', 'closing']);
const JOINABLE_CARRY = new Set(['open', 'claimed', 'ready', 'between']);
const RELAY_WEBHOOKS = new Map();
const RELAY_COOLDOWNS = new Map();

const DUNGEON_MIN_LEVEL = new Map([
  ['Desert Temple', 0],
  ['Winter Outpost', 30],
  ['Pirate Island', 60],
  ["King's Castle", 70],
  ['The Underworld', 80],
  ['Samurai Palace', 90],
  ['The Canals', 100],
  ['Ghastly Harbor', 110],
  ['Steampunk Sewers', 120],
  ['Boss Raids', 0],
  ['Orbital Outpost', 140],
  ['Volcanic Chambers', 150],
  ['Aquatic Temple', 160],
  ['Enchanted Forest', 170],
  ['Northern Lands', 180],
  ['Gilded Skies', 190],
  ['Yokai Peak', 200],
  ['Abyssal Void', 200]
]);

function bridgeError(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

export function normaliseRealtimeBridgeError(error) {
  return {
    status: Number(error?.status) || 500,
    body: {
      error: String(error?.code || 'internal_error'),
      message: String(error?.message || 'Kingdom Core could not complete that request.').slice(0, 500)
    }
  };
}

function branded(title, color = BRAND.color) {
  return new EmbedBuilder().setColor(color).setTitle(title).setFooter({ text: BRAND.footer }).setTimestamp();
}

function clean(value, max = 1800) {
  return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);
}

function safeChannelPart(value, fallback) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 28) || fallback;
}

async function requireMember(guild, userId) {
  if (!userId) throw bridgeError('missing_user', 'Sign in with Discord first.', 401);
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) throw bridgeError('not_in_guild', 'Join the Kingdom Carries Discord server before using this feature.', 403);
  return member;
}

function tierBounds(key) {
  if (key === '200+') return { min: 200, max: Number.POSITIVE_INFINITY };
  const match = String(key).match(/^(\d+)-(\d+)$/);
  return match ? { min: Number(match[1]), max: Number(match[2]) } : { min: 0, max: 0 };
}

export function getMemberLevelRole(member, state) {
  for (const tier of LEVEL_TIERS) {
    const configuredId = state.setup?.levelRoles?.[tier.key];
    const role = configuredId
      ? member.roles.cache.get(configuredId)
      : member.roles.cache.find((item) => item.name === tier.role);
    if (!role) continue;
    const bounds = tierBounds(tier.key);
    return {
      key: tier.key,
      roleId: role.id,
      roleName: role.name,
      label: `Lvl ${tier.key}`,
      min: bounds.min,
      max: Number.isFinite(bounds.max) ? bounds.max : null
    };
  }
  return null;
}

function parsedRequirementLevel(ticket) {
  const match = String(ticket?.requirement ?? '').match(/(?:lvl|level)\s*(\d+)\s*\+/i);
  return match ? Math.max(0, Number(match[1]) || 0) : 0;
}

export function requiredLevelForCarry(ticket) {
  return Math.max(
    Number(ticket?.minimumLevel) || 0,
    parsedRequirementLevel(ticket),
    DUNGEON_MIN_LEVEL.get(String(ticket?.dungeon ?? '')) ?? 0
  );
}

export function carryEligibilityForMember(member, state, ticket) {
  const levelRole = getMemberLevelRole(member, state);
  const requiredLevel = requiredLevelForCarry(ticket);
  if (!levelRole) {
    return {
      eligible: false,
      code: 'missing_level_role',
      reason: 'Choose your current Dungeon Quest level role in Discord before joining a live carry.',
      requiredLevel,
      levelRole: null
    };
  }

  const proven = levelRole.key === '200+' || levelRole.min >= requiredLevel;
  if (!proven) {
    return {
      eligible: false,
      code: 'level_too_low',
      reason: `This session requires Level ${requiredLevel}+; your verified Discord role is ${levelRole.label}.`,
      requiredLevel,
      levelRole
    };
  }

  return {
    eligible: true,
    code: 'eligible',
    reason: requiredLevel > 0 ? `${levelRole.label} satisfies the Level ${requiredLevel}+ requirement.` : `${levelRole.label} is verified.`,
    requiredLevel,
    levelRole
  };
}

function carryMembers(ticket) {
  return [...new Set((Array.isArray(ticket?.members) ? ticket.members : [ticket?.userId]).filter(Boolean))];
}

function activePartyForUser(state, userId) {
  return Object.values(state.carryTickets ?? {}).find((ticket) =>
    Array.isArray(ticket.members) && ACTIVE_CARRY.has(ticket.status) && carryMembers(ticket).includes(userId)
  ) ?? null;
}

function publicCarrySession(ticket, member, state, currentSessionId = null) {
  const members = carryMembers(ticket);
  const eligibility = carryEligibilityForMember(member, state, ticket);
  const joined = members.includes(member.id);
  const full = members.length >= Math.max(members.length, Number(ticket.maxMembers) || 8);
  const blockedByOther = Boolean(currentSessionId && currentSessionId !== ticket.id);
  const accepting = JOINABLE_CARRY.has(ticket.status) && !full;
  return {
    id: ticket.id,
    dungeon: ticket.dungeon,
    difficulty: ticket.difficulty,
    mode: ticket.mode ?? 'Normal',
    status: ticket.status,
    members: members.length,
    maxMembers: Math.max(members.length, Number(ticket.maxMembers) || 8),
    runsCompleted: Number(ticket.runsCompleted) || 0,
    runTarget: ticket.runTarget === null ? null : Math.max(1, Number(ticket.runTarget) || 1),
    requirement: clean(ticket.requirement, 200),
    requiredLevel: eligibility.requiredLevel,
    levelRole: eligibility.levelRole,
    joined,
    canJoin: joined || (accepting && eligibility.eligible && !blockedByOther),
    eligibility: joined
      ? { ...eligibility, eligible: true, code: 'already_joined', reason: 'You are already in this carry session.' }
      : blockedByOther
        ? { ...eligibility, eligible: false, code: 'already_in_session', reason: 'Leave your current carry session before joining another one.' }
        : !accepting
          ? { ...eligibility, eligible: false, code: full ? 'session_full' : 'not_joinable', reason: full ? 'This carry session is full.' : 'This carry session is not accepting members right now.' }
          : eligibility,
    carrierId: ticket.carrierId ?? null,
    createdAt: ticket.createdAt ?? null
  };
}

function supportDefinition(type) {
  return SUPPORT_TYPES[type] ?? null;
}

function supportButtons(id) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`kc:ticket:claim:${id}`).setLabel('Claim').setEmoji('🛡️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`kc:ticket:priority:${id}`).setLabel('Escalate').setEmoji('🚨').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`kc:ticket:close2:${id}`).setLabel('Close').setEmoji('🔒').setStyle(ButtonStyle.Secondary)
  );
}

function supportOverwrites(guild, state, userId) {
  const rows = [{
    id: guild.roles.everyone.id,
    deny: [PermissionFlagsBits.ViewChannel],
    allow: [PermissionFlagsBits.ReadMessageHistory]
  }];

  if (guild.members.me?.id) {
    rows.push({
      id: guild.members.me.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.ManageWebhooks,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AttachFiles
      ]
    });
  }

  rows.push({
    id: userId,
    allow: [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.EmbedLinks,
      PermissionFlagsBits.AttachFiles
    ]
  });

  for (const key of STAFF_KEYS) {
    const roleId = state.setup?.roles?.[key];
    if (!roleId) continue;
    rows.push({
      id: roleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AttachFiles
      ]
    });
  }
  return rows;
}

function publicSupportTicket(ticket) {
  const def = supportDefinition(ticket.type) ?? SUPPORT_TYPES.support;
  return {
    id: ticket.id,
    type: ticket.type ?? 'support',
    label: def.label,
    summary: ticket.summary ?? '',
    details: ticket.details ?? '',
    status: ticket.status ?? 'open',
    priority: ticket.priority ?? 'normal',
    claimedBy: ticket.claimedBy ?? null,
    createdAt: ticket.createdAt ?? null,
    updatedAt: ticket.updatedAt ?? ticket.createdAt ?? null,
    closedAt: ticket.closedAt ?? null,
    source: ticket.source ?? 'discord'
  };
}

async function supportParent(guild, state) {
  await guild.channels.fetch().catch(() => null);
  const configured = guild.channels.cache.get(state.setup?.categories?.tickets)
    ?? guild.channels.cache.get(state.setup?.categories?.support);
  if (configured?.type === ChannelType.GuildCategory) return configured;
  return guild.channels.cache.find((channel) =>
    channel.type === ChannelType.GuildCategory && /support|ticket|petition/i.test(channel.name)
  ) ?? null;
}

export async function createWebsiteSupportTicket(guild, userId, input = {}) {
  const member = await requireMember(guild, userId);
  const type = clean(input.type || 'support', 30).toLowerCase();
  const def = supportDefinition(type);
  if (!def) throw bridgeError('invalid_ticket_type', 'Choose support, report, partnership or appeal.', 400);
  const summary = clean(input.summary, 100);
  const details = clean(input.details, 1500);
  if (summary.length < 3) throw bridgeError('summary_required', 'Add a short summary for the ticket.', 400);
  if (details.length < 5) throw bridgeError('details_required', 'Add enough detail for staff to understand the ticket.', 400);

  const initial = await readGuildState(guild.id);
  const existing = Object.values(initial.tickets ?? {}).find((ticket) => ticket.userId === userId && ticket.status !== 'closed');
  if (existing) throw bridgeError('ticket_already_open', `You already have an open ticket (${existing.id}).`, 409);
  const parent = await supportParent(guild, initial);
  if (!parent) throw bridgeError('ticket_category_unavailable', 'The Discord support category is unavailable. Ask staff to repair the ticket setup.', 503);

  const short = Date.now().toString(36).slice(-6).toUpperCase();
  const id = `KT-${short}-${userId.slice(-4)}`;
  const safeName = safeChannelPart(member.user.username, userId.slice(-8));
  const channel = await guild.channels.create({
    name: `${type}-${safeName}-${short.toLowerCase()}`.slice(0, 100),
    type: ChannelType.GuildText,
    parent: parent.id,
    topic: `Kingdom Core ticket ${id} • ${type} • owner ${userId} • created from Kingdom HQ`,
    permissionOverwrites: supportOverwrites(guild, initial, userId),
    reason: `Kingdom HQ ${def.label} ticket ${id}`
  });

  const now = new Date().toISOString();
  const ticket = {
    id,
    type,
    userId,
    username: member.user.username,
    displayName: member.displayName,
    channelId: channel.id,
    summary,
    details,
    status: 'open',
    priority: 'normal',
    claimedBy: null,
    source: 'website',
    createdAt: now,
    updatedAt: now
  };

  const header = await channel.send({
    content: `<@${userId}>`,
    embeds: [branded(`${def.emoji} ${def.label} • ${id}`, def.color)
      .setDescription(`**${summary}**\n\n${details}`)
      .addFields(
        { name: 'Petitioner', value: `<@${userId}>`, inline: true },
        { name: 'Created From', value: '🌐 Kingdom HQ', inline: true },
        { name: 'Status', value: 'OPEN', inline: true }
      )],
    components: [supportButtons(id)],
    allowedMentions: { users: [userId], roles: [] }
  });
  ticket.headerMessageId = header.id;
  await header.pin('Kingdom Core ticket controls').catch(() => null);

  await mutateGuildState(guild.id, async (state) => {
    state.tickets ??= {};
    state.tickets[id] = ticket;
    await refreshTicketControl(guild, state);
  });

  return publicSupportTicket(ticket);
}

export async function listWebsiteSupportTickets(guild, userId) {
  await requireMember(guild, userId);
  const state = await readGuildState(guild.id);
  return Object.values(state.tickets ?? {})
    .filter((ticket) => ticket.userId === userId)
    .sort((a, b) => new Date(b.createdAt ?? 0) - new Date(a.createdAt ?? 0))
    .map(publicSupportTicket);
}

export async function getWebsiteSupportTicket(guild, userId, ticketId) {
  await requireMember(guild, userId);
  const state = await readGuildState(guild.id);
  const ticket = state.tickets?.[ticketId];
  if (!ticket || ticket.userId !== userId) throw bridgeError('ticket_not_found', 'That ticket could not be found.', 404);
  return publicSupportTicket(ticket);
}

export async function closeWebsiteSupportTicket(guild, userId, ticketId) {
  await requireMember(guild, userId);
  let closed = null;
  await mutateGuildState(guild.id, async (state) => {
    const ticket = state.tickets?.[ticketId];
    if (!ticket || ticket.userId !== userId) return;
    if (ticket.status === 'closed') {
      closed = ticket;
      return;
    }
    ticket.status = 'closed';
    ticket.closedBy = userId;
    ticket.closedAt = new Date().toISOString();
    ticket.updatedAt = ticket.closedAt;
    closed = ticket;
    await refreshTicketControl(guild, state);
  });
  if (!closed) throw bridgeError('ticket_not_found', 'That ticket could not be found.', 404);

  const channel = guild.channels.cache.get(closed.channelId);
  if (channel?.isTextBased()) {
    await channel.send({ content: '🔒 This ticket was closed from **Kingdom HQ**. The conversation is now read-only.', allowedMentions: { parse: [] } }).catch(() => null);
    await channel.permissionOverwrites.edit(userId, { SendMessages: false, ReadMessageHistory: true }).catch(() => null);
    if (channel.name && !channel.name.startsWith('closed-')) await channel.setName(`closed-${channel.name}`.slice(0, 100)).catch(() => null);
  }
  return publicSupportTicket(closed);
}

export async function listWebsiteJoinableCarries(guild, userId) {
  const member = await requireMember(guild, userId);
  const state = await readGuildState(guild.id);
  const current = activePartyForUser(state, userId);
  const sessions = Object.values(state.carryTickets ?? {})
    .filter((ticket) => Array.isArray(ticket.members) && ACTIVE_CARRY.has(ticket.status))
    .sort((a, b) => new Date(a.createdAt ?? 0) - new Date(b.createdAt ?? 0))
    .map((ticket) => publicCarrySession(ticket, member, state, current?.id ?? null));
  return {
    member: {
      id: member.id,
      displayName: member.displayName,
      avatarUrl: member.displayAvatarURL({ extension: 'png', size: 128 }),
      levelRole: getMemberLevelRole(member, state)
    },
    currentSessionId: current?.id ?? null,
    sessions
  };
}

async function updateCarryHeader(guild, ticket) {
  const channel = guild.channels.cache.get(ticket.channelId);
  if (!channel?.isTextBased() || !ticket.headerMessageId) return;
  const message = await channel.messages.fetch(ticket.headerMessageId).catch(() => null);
  if (!message?.embeds?.[0]) return;
  const members = carryMembers(ticket);
  const embed = EmbedBuilder.from(message.embeds[0]);
  const fields = message.embeds[0].fields.map((field) => {
    if (!String(field.name).startsWith('👥 Party')) return { name: field.name, value: field.value, inline: field.inline };
    return {
      name: `👥 Party • ${members.length}/${Math.max(members.length, Number(ticket.maxMembers) || 8)}`,
      value: members.length ? members.slice(0, 20).map((id) => `<@${id}>`).join('  ') : '_No active members._',
      inline: field.inline
    };
  });
  embed.setFields(fields);
  await message.edit({ embeds: [embed] }).catch(() => null);
}

export async function joinWebsiteCarrySession(guild, userId, ticketId) {
  const member = await requireMember(guild, userId);
  const initial = await readGuildState(guild.id);
  const currentParty = activePartyForUser(initial, userId);
  if (currentParty && currentParty.id !== ticketId) throw bridgeError('already_in_session', `You are already in carry session ${currentParty.id}.`, 409);
  const initialTicket = initial.carryTickets?.[ticketId];
  if (!initialTicket || !Array.isArray(initialTicket.members) || !ACTIVE_CARRY.has(initialTicket.status)) throw bridgeError('carry_not_found', 'That live carry session no longer exists.', 404);
  if (carryMembers(initialTicket).includes(userId)) return publicCarrySession(initialTicket, member, initial, initialTicket.id);
  if (!JOINABLE_CARRY.has(initialTicket.status)) throw bridgeError('carry_not_joinable', 'That carry session is not accepting members right now.', 409);
  if (carryMembers(initialTicket).length >= Math.max(carryMembers(initialTicket).length, Number(initialTicket.maxMembers) || 8)) throw bridgeError('carry_full', 'That carry session is full.', 409);
  const eligibility = carryEligibilityForMember(member, initial, initialTicket);
  if (!eligibility.eligible) throw bridgeError(eligibility.code, eligibility.reason, 403);

  let joined = null;
  await mutateGuildState(guild.id, async (state) => {
    const activeElsewhere = activePartyForUser(state, userId);
    if (activeElsewhere && activeElsewhere.id !== ticketId) return;
    const ticket = state.carryTickets?.[ticketId];
    if (!ticket || !Array.isArray(ticket.members) || !JOINABLE_CARRY.has(ticket.status)) return;
    const members = carryMembers(ticket);
    const cap = Math.max(members.length, Number(ticket.maxMembers) || 8);
    if (members.length >= cap) return;
    ticket.members = members;
    if (!ticket.members.includes(userId)) ticket.members.push(userId);
    ticket.participantHistory ??= [...ticket.members];
    if (!ticket.participantHistory.includes(userId)) ticket.participantHistory.push(userId);
    ticket.ready ??= {};
    ticket.ready[userId] = false;
    joined = ticket;
    const channel = guild.channels.cache.get(ticket.channelId);
    if (channel?.isTextBased()) {
      await channel.permissionOverwrites.edit(userId, {
        ViewChannel: true,
        ReadMessageHistory: true,
        SendMessages: true,
        AttachFiles: true,
        EmbedLinks: true
      }, { reason: 'Joined carry session from Kingdom HQ' }).catch(() => null);
    }
    await refreshPartyPanels(guild, state);
  });
  if (!joined) throw bridgeError('carry_changed', 'That carry session changed before you could join it. Refresh and try again.', 409);
  await updateCarryHeader(guild, joined);
  const channel = guild.channels.cache.get(joined.channelId);
  await channel?.send({ content: `🌐 **${member.displayName}** joined this carry session from Kingdom HQ.`, allowedMentions: { parse: [] } }).catch(() => null);
  const fresh = await readGuildState(guild.id);
  return publicCarrySession(joined, member, fresh, joined.id);
}

export async function leaveWebsiteCarrySession(guild, userId, ticketId) {
  const member = await requireMember(guild, userId);
  let result = null;
  let early = false;
  await mutateGuildState(guild.id, async (state) => {
    const ticket = state.carryTickets?.[ticketId];
    if (!ticket || !Array.isArray(ticket.members) || !ACTIVE_CARRY.has(ticket.status)) return;
    if (!carryMembers(ticket).includes(userId)) return;
    early = ['running', 'between'].includes(ticket.status) && ((Number(ticket.runsCompleted) || 0) > 0 || ticket.status === 'running');
    ticket.members = carryMembers(ticket).filter((id) => id !== userId);
    ticket.ready ??= {};
    delete ticket.ready[userId];
    ticket.leftEarly ??= [];
    if (early && !ticket.leftEarly.includes(userId)) ticket.leftEarly.push(userId);
    if (ticket.leaderId === userId) ticket.leaderId = ticket.members[0] ?? null;
    if (!ticket.members.length) {
      ticket.status = 'cancelled';
      ticket.closedAt = new Date().toISOString();
    }
    result = ticket;
    const channel = guild.channels.cache.get(ticket.channelId);
    if (channel?.isTextBased()) await channel.permissionOverwrites.delete(userId, 'Left carry session from Kingdom HQ').catch(() => null);
    await refreshPartyPanels(guild, state);
  });
  if (!result) throw bridgeError('carry_not_found', 'You are not in that active carry session.', 404);
  await updateCarryHeader(guild, result);
  const channel = guild.channels.cache.get(result.channelId);
  await channel?.send({ content: `🌐 **${member.displayName}** left this carry session from Kingdom HQ${early ? ' (early departure recorded)' : ''}.`, allowedMentions: { parse: [] } }).catch(() => null);
  return { ok: true, early, id: ticketId, status: result.status };
}

export async function getWebsiteCarrySession(guild, userId, ticketId) {
  const member = await requireMember(guild, userId);
  const state = await readGuildState(guild.id);
  const ticket = state.carryTickets?.[ticketId];
  if (!ticket) throw bridgeError('carry_not_found', 'That carry session could not be found.', 404);
  const involved = carryMembers(ticket).includes(userId)
    || (ticket.participantHistory ?? []).includes(userId)
    || ticket.carrierId === userId
    || ticket.userId === userId;
  if (!involved) throw bridgeError('forbidden', 'You do not have access to that carry session.', 403);
  return publicCarrySession(ticket, member, state, activePartyForUser(state, userId)?.id ?? null);
}

function conversationRecord(state, kind, id, userId, forSend = false) {
  if (kind === 'ticket') {
    const ticket = state.tickets?.[id];
    if (!ticket || ticket.userId !== userId) return null;
    if (forSend && ticket.status === 'closed') return null;
    return { record: ticket, channelId: ticket.channelId, headerMessageId: ticket.headerMessageId };
  }
  if (kind === 'carry') {
    const ticket = state.carryTickets?.[id];
    if (!ticket) return null;
    const members = carryMembers(ticket);
    const canRead = members.includes(userId) || (ticket.participantHistory ?? []).includes(userId) || ticket.carrierId === userId || ticket.userId === userId;
    const canSend = members.includes(userId) || ticket.carrierId === userId;
    if (!canRead || (forSend && (!canSend || !ACTIVE_CARRY.has(ticket.status)))) return null;
    return { record: ticket, channelId: ticket.channelId, headerMessageId: ticket.headerMessageId };
  }
  return null;
}

async function serializeDiscordMessage(message, guild) {
  let displayName = message.author?.globalName || message.author?.username || 'Unknown';
  if (!message.webhookId && message.author?.id) {
    const member = message.member ?? guild.members.cache.get(message.author.id) ?? await guild.members.fetch(message.author.id).catch(() => null);
    if (member?.displayName) displayName = member.displayName;
  }
  return {
    id: message.id,
    content: message.content ?? '',
    createdAt: message.createdAt?.toISOString?.() ?? new Date(message.createdTimestamp ?? Date.now()).toISOString(),
    editedAt: message.editedAt?.toISOString?.() ?? null,
    author: {
      id: message.webhookId ? null : message.author?.id ?? null,
      displayName,
      avatarUrl: message.author?.displayAvatarURL?.({ extension: 'png', size: 128 }) ?? null,
      bot: Boolean(message.author?.bot),
      viaWebsite: Boolean(message.webhookId)
    },
    attachments: [...message.attachments.values()].map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      url: attachment.url,
      contentType: attachment.contentType ?? null,
      size: attachment.size
    }))
  };
}

export async function readWebsiteConversation(guild, userId, kind, id, options = {}) {
  await requireMember(guild, userId);
  const state = await readGuildState(guild.id);
  const access = conversationRecord(state, kind, id, userId, false);
  if (!access) throw bridgeError('conversation_not_found', 'That conversation could not be found or you do not have access.', 404);
  const channel = guild.channels.cache.get(access.channelId) ?? await guild.channels.fetch(access.channelId).catch(() => null);
  if (!channel?.isTextBased()) throw bridgeError('channel_unavailable', 'The Discord channel for this conversation is unavailable.', 404);

  const after = /^\d{15,22}$/.test(String(options.after ?? '')) ? String(options.after) : null;
  const limit = Math.max(1, Math.min(75, Number(options.limit) || 50));
  const fetched = await channel.messages.fetch(after ? { limit, after } : { limit }).catch(() => null);
  if (!fetched) throw bridgeError('message_fetch_failed', 'Discord messages could not be loaded right now.', 502);
  const rows = [...fetched.values()]
    .filter((message) => message.id !== access.headerMessageId)
    .filter((message) => Boolean(message.content?.trim()) || message.attachments.size > 0)
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  return {
    id,
    kind,
    status: access.record.status ?? 'open',
    messages: await Promise.all(rows.map((message) => serializeDiscordMessage(message, guild)))
  };
}

async function websiteRelayWebhook(channel) {
  const cached = RELAY_WEBHOOKS.get(channel.id);
  if (cached) return cached;
  const hooks = await channel.fetchWebhooks().catch(() => null);
  let hook = hooks?.find((item) => item.name === 'Kingdom Website Relay' && item.owner?.id === channel.client.user?.id && item.token) ?? null;
  if (!hook) {
    hook = await channel.createWebhook({
      name: 'Kingdom Website Relay',
      reason: 'Relay authenticated Kingdom HQ member messages into private Discord conversations'
    }).catch(() => null);
  }
  if (!hook) throw bridgeError('webhook_unavailable', 'Kingdom Core cannot create the Discord relay webhook in this channel.', 503);
  RELAY_WEBHOOKS.set(channel.id, hook);
  return hook;
}

export async function sendWebsiteConversationMessage(guild, userId, kind, id, input = {}) {
  const member = await requireMember(guild, userId);
  const content = clean(input.content, 1800);
  if (!content) throw bridgeError('message_required', 'Type a message before sending it.', 400);
  const key = `${guild.id}:${userId}`;
  const now = Date.now();
  if (now - (RELAY_COOLDOWNS.get(key) ?? 0) < 650) throw bridgeError('slow_down', 'Wait a moment before sending another message.', 429);
  RELAY_COOLDOWNS.set(key, now);

  const state = await readGuildState(guild.id);
  const access = conversationRecord(state, kind, id, userId, true);
  if (!access) throw bridgeError('conversation_not_writable', 'That conversation is closed or you no longer have permission to send messages.', 403);
  const channel = guild.channels.cache.get(access.channelId) ?? await guild.channels.fetch(access.channelId).catch(() => null);
  if (!channel?.isTextBased()) throw bridgeError('channel_unavailable', 'The Discord channel for this conversation is unavailable.', 404);
  const webhook = await websiteRelayWebhook(channel);
  const message = await webhook.send({
    content,
    username: member.displayName.slice(0, 80),
    avatarURL: member.displayAvatarURL({ extension: 'png', size: 128 }),
    allowedMentions: { parse: [] }
  }).catch((error) => {
    throw bridgeError('discord_send_failed', `Discord rejected the website message: ${String(error?.message ?? 'send failed').slice(0, 160)}`, 502);
  });
  return serializeDiscordMessage(message, guild);
}
