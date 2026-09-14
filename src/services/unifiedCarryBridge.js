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
import { LEVEL_TIERS } from './levelRoles.js';
import { refreshPartyPanels } from './carryPartiesV3.js';

const ACTIVE = new Set(['open', 'claimed', 'ready', 'running', 'between', 'closing']);
const JOINABLE = new Set(['open', 'claimed', 'ready', 'between']);
const DUNGEONS = new Set([
  'Desert Temple', 'Winter Outpost', 'Pirate Island', "King's Castle", 'The Underworld',
  'Samurai Palace', 'The Canals', 'Ghastly Harbor', 'Steampunk Sewers', 'Boss Raids',
  'Orbital Outpost', 'Volcanic Chambers', 'Aquatic Temple', 'Enchanted Forest', 'Northern Lands',
  'Gilded Skies', 'Yokai Peak', 'Abyssal Void'
]);
const DIFFICULTIES = new Set(['Easy', 'Medium', 'Hard', 'Insane', 'Nightmare']);
const MODES = new Set(['Normal', 'Hardcore']);
const DUNGEON_MIN_LEVEL = new Map([
  ['Desert Temple', 0], ['Winter Outpost', 30], ['Pirate Island', 60], ["King's Castle", 70],
  ['The Underworld', 80], ['Samurai Palace', 90], ['The Canals', 100], ['Ghastly Harbor', 110],
  ['Steampunk Sewers', 120], ['Boss Raids', 0], ['Orbital Outpost', 140], ['Volcanic Chambers', 150],
  ['Aquatic Temple', 160], ['Enchanted Forest', 170], ['Northern Lands', 180], ['Gilded Skies', 190],
  ['Yokai Peak', 200], ['Abyssal Void', 200]
]);

function fail(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  throw error;
}

export function normaliseUnifiedCarryError(error) {
  return {
    status: Number(error?.status) || 500,
    body: {
      error: String(error?.code || 'internal_error'),
      message: Number(error?.status)
        ? String(error?.message || 'Kingdom Core could not complete that carry action.').slice(0, 500)
        : 'Kingdom Core could not complete that carry action.'
    }
  };
}

function clean(value, max = 180) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function normalName(value = '') {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function membersOf(ticket) {
  return [...new Set((Array.isArray(ticket?.members) ? ticket.members : [ticket?.userId]).filter(Boolean))];
}

function normaliseTicket(ticket) {
  if (!ticket) return ticket;
  ticket.members = membersOf(ticket);
  if (ticket.userId && !ticket.members.includes(ticket.userId)) ticket.members.unshift(ticket.userId);
  ticket.leaderId ??= ticket.userId ?? ticket.members[0] ?? null;
  ticket.ready ??= {};
  ticket.runsCompleted ??= ticket.status === 'completed' ? 1 : 0;
  if (ticket.runTarget === undefined) ticket.runTarget = 1;
  ticket.maxMembers = Math.max(ticket.members.length, Number(ticket.maxMembers) || 8);
  ticket.requirement ??= clean(ticket.partyRequirements, 180);
  ticket.minimumLevel ??= DUNGEON_MIN_LEVEL.get(String(ticket.dungeon ?? '')) ?? 0;
  ticket.leftEarly ??= [];
  ticket.participantHistory ??= [...ticket.members];
  for (const id of ticket.members) {
    if (!ticket.participantHistory.includes(id)) ticket.participantHistory.push(id);
    if (ticket.ready[id] === undefined) ticket.ready[id] = false;
  }
  return ticket;
}

function tierBounds(key) {
  if (key === '200+') return { min: 200, max: Number.POSITIVE_INFINITY };
  const match = String(key).match(/^(\d+)-(\d+)$/);
  return match ? { min: Number(match[1]), max: Number(match[2]) } : { min: 0, max: 0 };
}

function memberLevelRole(member, state) {
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

function eligibility(member, state, ticket) {
  const levelRole = memberLevelRole(member, state);
  const requiredLevel = Math.max(
    Number(ticket.minimumLevel) || 0,
    DUNGEON_MIN_LEVEL.get(String(ticket.dungeon ?? '')) ?? 0
  );
  if (!levelRole) {
    return {
      eligible: false,
      code: 'missing_level_role',
      reason: 'Choose your Dungeon Quest level role in Discord before joining a live carry.',
      requiredLevel,
      levelRole: null
    };
  }
  const proven = levelRole.key === '200+' || levelRole.min >= requiredLevel;
  if (!proven) {
    return {
      eligible: false,
      code: 'level_too_low',
      reason: `This carry requires Level ${requiredLevel}+; your Discord role is ${levelRole.label}.`,
      requiredLevel,
      levelRole
    };
  }
  return {
    eligible: true,
    code: 'eligible',
    reason: requiredLevel ? `${levelRole.label} satisfies Level ${requiredLevel}+. ` : `${levelRole.label} is verified.`,
    requiredLevel,
    levelRole
  };
}

function liveRoleId(guild, state, key) {
  const configured = state.setup?.roles?.[key];
  if (configured && guild.roles.cache.has(configured)) return configured;
  const definition = ROLE_BLUEPRINT.find((item) => item.key === key);
  if (!definition) return null;
  const exact = guild.roles.cache.find((role) => role.name === definition.name);
  if (exact) return exact.id;
  const wanted = normalName(definition.name);
  return guild.roles.cache.find((role) => normalName(role.name) === wanted)?.id ?? null;
}

async function syncLivePointers(guild, state) {
  await guild.channels.fetch().catch(() => null);
  await guild.roles.fetch().catch(() => null);
  state.setup ??= {};
  state.setup.channels ??= {};
  state.setup.categories ??= {};
  state.setup.roles ??= {};
  state.setup.panels ??= {};

  for (const key of [...STAFF_KEYS, ...CARRIER_KEYS]) {
    const id = liveRoleId(guild, state, key);
    if (id) state.setup.roles[key] = id;
  }

  const categories = [...guild.channels.cache.values()].filter((channel) => channel.type === ChannelType.GuildCategory);
  const carriesCategory = guild.channels.cache.get(state.setup.categories.carries)
    ?? categories.find((channel) => /\bcarr(?:y|ies)\b/i.test(channel.name));
  const supportCategory = guild.channels.cache.get(state.setup.categories.support)
    ?? categories.find((channel) => /support|ticket|petition/i.test(channel.name));
  if (carriesCategory?.type === ChannelType.GuildCategory) state.setup.categories.carries = carriesCategory.id;
  if (supportCategory?.type === ChannelType.GuildCategory) state.setup.categories.support = supportCategory.id;

  const texts = [...guild.channels.cache.values()].filter((channel) => channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement);
  const resolve = (key, matcher) => {
    const current = guild.channels.cache.get(state.setup.channels[key]);
    if (current?.isTextBased()) return current;
    const found = texts.find((channel) => matcher(normalName(channel.name), channel));
    if (found) state.setup.channels[key] = found.id;
    return found ?? null;
  };
  resolve('carryQueue', (name) => name.includes('live queue'));
  resolve('carryBoard', (name) => name.includes('carry board'));
  resolve('carryResults', (name) => name.includes('completed carries'));
  resolve('carrierAssignments', (name) => name.includes('carry assignments'));

  const queue = guild.channels.cache.get(state.setup.channels.carryQueue);
  if (queue?.isTextBased() && !state.setup.panels.liveQueueV3) {
    const candidates = [state.setup.panels.liveQueue, state.setup.panels.liveQueueV2].filter(Boolean);
    for (const messageId of candidates) {
      const message = await queue.messages.fetch(messageId).catch(() => null);
      if (message?.author?.id === guild.client.user?.id) {
        state.setup.panels.liveQueueV3 = message.id;
        break;
      }
    }
    if (!state.setup.panels.liveQueueV3) {
      const pins = await queue.messages.fetchPins().catch(() => null);
      const pinned = pins?.items?.find?.((message) =>
        message.author?.id === guild.client.user?.id &&
        message.embeds?.some?.((embed) => /live carry|join a party|carry session/i.test(embed.title ?? ''))
      );
      if (pinned) state.setup.panels.liveQueueV3 = pinned.id;
    }
  }
}

function carryParent(guild, state) {
  const ids = [state.setup?.categories?.carryTickets, state.setup?.categories?.carries, state.setup?.categories?.support].filter(Boolean);
  for (const id of ids) {
    const channel = guild.channels.cache.get(id);
    if (channel?.type === ChannelType.GuildCategory) return channel;
  }
  return [...guild.channels.cache.values()].find((channel) =>
    channel.type === ChannelType.GuildCategory && /\bcarr(?:y|ies)\b/i.test(channel.name)
  ) ?? null;
}

function privateOverwrites(guild, state, userId) {
  const rows = [{
    id: guild.roles.everyone.id,
    deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
    allow: [PermissionFlagsBits.ReadMessageHistory]
  }];
  const allowed = new Set([...STAFF_KEYS, ...CARRIER_KEYS].map((key) => liveRoleId(guild, state, key)).filter(Boolean));
  for (const id of allowed) {
    rows.push({
      id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks
      ]
    });
  }
  if (guild.members.me?.id) {
    rows.push({
      id: guild.members.me.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.ManageWebhooks,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks
      ]
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

function statusText(ticket) {
  return {
    open: '🟡 Forming party',
    claimed: '🛡️ Knight assigned',
    ready: '✅ Party ready',
    running: '⚔️ Run in progress',
    between: '🟣 Between runs',
    closing: '⏳ Closing',
    completed: '✅ Completed',
    cancelled: '❌ Closed'
  }[ticket.status] ?? String(ticket.status ?? 'open');
}

function sessionEmbed(ticket) {
  normaliseTicket(ticket);
  const members = membersOf(ticket);
  return new EmbedBuilder()
    .setColor(BRAND.color)
    .setTitle(`⚔️ Live Carry Session • ${ticket.id}`)
    .setDescription([
      `**${ticket.dungeon}** • **${ticket.difficulty}** • **${ticket.mode ?? 'Normal'}**`,
      '',
      `Status: **${statusText(ticket)}**`,
      ticket.notes ? `> ${ticket.notes}` : '> No extra notes.'
    ].join('\n'))
    .addFields(
      { name: 'Requester', value: ticket.userId ? `<@${ticket.userId}>` : 'Unknown', inline: true },
      { name: 'Roblox', value: ticket.robloxUsername ? `\`${ticket.robloxUsername}\`` : 'Not linked', inline: true },
      { name: 'Knight', value: ticket.carrierId ? `<@${ticket.carrierId}>` : 'Unassigned', inline: true },
      { name: `👥 Party • ${members.length}/${ticket.maxMembers}`, value: members.map((id) => `<@${id}>`).join('  ') || '_No members_', inline: false },
      { name: 'Level Requirement', value: `Lvl ${ticket.minimumLevel ?? 0}+`, inline: true },
      { name: 'Runs', value: `${ticket.runsCompleted ?? 0}/${ticket.runTarget ?? 1}`, inline: true }
    )
    .setFooter({ text: BRAND.footer })
    .setTimestamp();
}

function sessionControls(ticket) {
  if (!ACTIVE.has(ticket.status)) return [];
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`kc3:party:claim:${ticket.id}`).setLabel(ticket.carrierId ? 'Carrier Controls' : 'Claim & Configure').setEmoji('🛡️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`kc3:party:ready:${ticket.id}`).setLabel('Toggle Ready').setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`kc3:party:leave:${ticket.id}`).setLabel('Leave Party').setEmoji('🚪').setStyle(ButtonStyle.Secondary)
  )];
}

async function syncTicketMessage(guild, ticket) {
  normaliseTicket(ticket);
  const channel = guild.channels.cache.get(ticket.channelId) ?? await guild.channels.fetch(ticket.channelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  let header = ticket.headerMessageId ? await channel.messages.fetch(ticket.headerMessageId).catch(() => null) : null;
  const payload = { embeds: [sessionEmbed(ticket)], components: sessionControls(ticket), allowedMentions: { parse: [] } };
  if (header) await header.edit(payload).catch(() => null);
  else {
    header = await channel.send({ content: ticket.userId ? `<@${ticket.userId}>` : undefined, ...payload, allowedMentions: { users: ticket.userId ? [ticket.userId] : [], roles: [] } });
    ticket.headerMessageId = header.id;
  }
  if (!header.pinned) await header.pin('Kingdom Core live carry session').catch(() => null);

  if (ticket.controlMessageId) {
    for (const candidate of guild.channels.cache.values()) {
      if (!candidate?.isTextBased?.()) continue;
      const message = await candidate.messages.fetch(ticket.controlMessageId).catch(() => null);
      if (!message) continue;
      await message.edit(payload).catch(() => null);
      break;
    }
  }
}

async function refreshUnifiedUi(guild, state) {
  await syncLivePointers(guild, state);
  await refreshPartyPanels(guild, state);

  const deskId = state.setup?.panels?.carryUltimate;
  const board = guild.channels.cache.get(state.setup?.channels?.carryBoard);
  if (deskId && board?.isTextBased() && deskId !== state.setup?.panels?.liveQueueV3) {
    const old = await board.messages.fetch(deskId).catch(() => null);
    if (old?.author?.id === guild.client.user?.id) {
      await old.edit({
        embeds: [new EmbedBuilder()
          .setColor(BRAND.color)
          .setTitle('⚔️ Kingdom Carries • Carry Hub')
          .setDescription('**One live carry system.** Request a carry here or open the live queue to join a compatible party. Website and Discord now use the same session record.')
          .setFooter({ text: BRAND.footer })
          .setTimestamp()],
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('kc3:party:request').setLabel('Request Carry').setEmoji('⚔️').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('kc3:party:join-active').setLabel('Join Active Carry').setEmoji('➕').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('kc3:party:mine').setLabel('My Party').setEmoji('🎟️').setStyle(ButtonStyle.Secondary)
        )],
        allowedMentions: { parse: [] }
      }).catch(() => null);
    }
  }
}

export async function reconcileUnifiedCarries(guild) {
  let snapshot = null;
  await mutateGuildState(guild.id, async (state) => {
    state.carryTickets ??= {};
    for (const ticket of Object.values(state.carryTickets)) normaliseTicket(ticket);
    await refreshUnifiedUi(guild, state);
    snapshot = state;
  });
  return snapshot ?? readGuildState(guild.id);
}

function publicSession(ticket, member, state, currentId = null) {
  normaliseTicket(ticket);
  const members = membersOf(ticket);
  const check = eligibility(member, state, ticket);
  const joined = members.includes(member.id);
  const full = members.length >= ticket.maxMembers;
  const blocked = Boolean(currentId && currentId !== ticket.id);
  const accepting = JOINABLE.has(ticket.status) && !full;
  return {
    id: ticket.id,
    dungeon: ticket.dungeon,
    difficulty: ticket.difficulty,
    mode: ticket.mode ?? 'Normal',
    status: ticket.status,
    robloxUsername: ticket.robloxUsername ?? null,
    requesterDisplayName: ticket.displayName ?? ticket.username ?? null,
    members: members.length,
    maxMembers: ticket.maxMembers,
    runsCompleted: Number(ticket.runsCompleted) || 0,
    runTarget: ticket.runTarget === null ? null : Math.max(1, Number(ticket.runTarget) || 1),
    requirement: clean(ticket.requirement, 200),
    requiredLevel: check.requiredLevel,
    levelRole: check.levelRole,
    joined,
    canJoin: joined || (accepting && check.eligible && !blocked),
    eligibility: joined
      ? { ...check, eligible: true, code: 'already_joined', reason: 'You are already in this carry party.' }
      : blocked
        ? { ...check, eligible: false, code: 'already_in_session', reason: 'Leave your current carry before joining another.' }
        : !accepting
          ? { ...check, eligible: false, code: full ? 'session_full' : 'not_joinable', reason: full ? 'This party is full.' : 'This party is not accepting members right now.' }
          : check,
    carrierId: ticket.carrierId ?? null,
    createdAt: ticket.createdAt ?? null
  };
}

function activeForUser(state, userId) {
  return Object.values(state.carryTickets ?? {}).map(normaliseTicket).find((ticket) =>
    ACTIVE.has(ticket.status) && membersOf(ticket).includes(userId)
  ) ?? null;
}

export async function createUnifiedWebsiteCarry(guild, userId, input = {}) {
  if (!userId) fail('missing_user', 'Sign in with Discord first.', 401);
  const dungeon = clean(input.dungeon, 64);
  const difficulty = clean(input.difficulty, 32);
  const mode = clean(input.mode, 32) || 'Normal';
  const notes = clean(input.notes, 180);
  const region = clean(input.region, 64);
  const partyRequirements = clean(input.partyRequirements, 180);
  if (!DUNGEONS.has(dungeon)) fail('invalid_dungeon', 'Choose a supported dungeon.');
  if (!DIFFICULTIES.has(difficulty)) fail('invalid_difficulty', 'Choose a supported difficulty.');
  if (!MODES.has(mode)) fail('invalid_mode', 'Choose Normal or Hardcore mode.');

  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) fail('not_guild_member', 'Join the Kingdom Carries Discord before requesting a carry.', 403);

  const initial = await readGuildState(guild.id);
  await syncLivePointers(guild, initial);
  const roblox = initial.identities?.[userId]?.website?.roblox;
  if (!roblox?.userId || !roblox?.username) fail('roblox_not_connected', 'Connect and verify your Roblox account before requesting a carry.', 409);
  const existing = Object.values(initial.carryTickets ?? {}).map(normaliseTicket).find((ticket) => ACTIVE.has(ticket.status) && membersOf(ticket).includes(userId));
  if (existing) fail('active_ticket_exists', `You already have an active carry session (${existing.id}).`, 409);

  const parent = carryParent(guild, initial);
  if (!parent) fail('carry_category_unavailable', 'Kingdom Core could not find your existing CARRIES category. Run /setup1 once, then retry.', 503);

  const numericLevel = Number(input.level);
  const level = Number.isFinite(numericLevel) && numericLevel > 0 && numericLevel < 10000 ? Math.floor(numericLevel) : null;
  const short = Date.now().toString(36).slice(-5).toUpperCase();
  const id = `KC-${short}`;
  const safe = member.user.username.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 22) || userId.slice(-8);
  const channel = await guild.channels.create({
    name: `carry-${safe}-${short.toLowerCase()}`.slice(0, 100),
    type: ChannelType.GuildText,
    parent: parent.id,
    topic: `Kingdom Core live carry ${id} • ${userId} • ${dungeon} • ${difficulty} • ${mode}`,
    permissionOverwrites: privateOverwrites(guild, initial, userId),
    reason: `Kingdom Carries unified website carry ${id}`
  });

  const now = new Date().toISOString();
  const ticket = normaliseTicket({
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
    robloxUsername: clean(roblox.username, 64),
    robloxUserId: clean(roblox.userId, 32),
    region: region || null,
    partyRequirements: partyRequirements || null,
    requirement: partyRequirements,
    source: 'website',
    status: 'open',
    carrierId: null,
    members: [userId],
    leaderId: userId,
    ready: { [userId]: false },
    maxMembers: 8,
    runsCompleted: 0,
    runTarget: 1,
    minimumLevel: DUNGEON_MIN_LEVEL.get(dungeon) ?? 0,
    participantHistory: [userId],
    createdAt: now
  });

  const header = await channel.send({
    content: `<@${userId}>`,
    embeds: [sessionEmbed(ticket)],
    components: sessionControls(ticket),
    allowedMentions: { users: [userId], roles: [] }
  });
  ticket.headerMessageId = header.id;
  await header.pin('Kingdom Core live carry session').catch(() => null);

  await mutateGuildState(guild.id, async (state) => {
    state.carryTickets ??= {};
    state.carryTickets[id] = ticket;
    state.identities ??= {};
    state.identities[userId] ??= { userId };
    state.identities[userId].website ??= {};
    if (region) state.identities[userId].website.region = region;
    state.identities[userId].website.lastSeenAt = now;
    await refreshUnifiedUi(guild, state);
  });

  return ticket;
}

export async function listUnifiedJoinableCarries(guild, userId) {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) fail('not_in_guild', 'Join the Kingdom Carries Discord server before using this feature.', 403);
  const state = await reconcileUnifiedCarries(guild);
  const current = activeForUser(state, userId);
  const sessions = Object.values(state.carryTickets ?? {})
    .map(normaliseTicket)
    .filter((ticket) => ACTIVE.has(ticket.status))
    .sort((a, b) => new Date(a.createdAt ?? 0) - new Date(b.createdAt ?? 0))
    .map((ticket) => publicSession(ticket, member, state, current?.id ?? null));
  return {
    member: {
      id: member.id,
      displayName: member.displayName,
      avatarUrl: member.displayAvatarURL({ extension: 'png', size: 128 }),
      levelRole: memberLevelRole(member, state)
    },
    currentSessionId: current?.id ?? null,
    sessions
  };
}

export async function joinUnifiedCarry(guild, userId, ticketId) {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) fail('not_in_guild', 'Join the Kingdom Carries Discord server before using this feature.', 403);
  let joined = null;
  let stateAfter = null;
  await mutateGuildState(guild.id, async (state) => {
    state.carryTickets ??= {};
    for (const item of Object.values(state.carryTickets)) normaliseTicket(item);
    const current = activeForUser(state, userId);
    if (current && current.id !== ticketId) fail('already_in_session', `You are already in carry session ${current.id}.`, 409);
    const ticket = normaliseTicket(state.carryTickets[ticketId]);
    if (!ticket || !ACTIVE.has(ticket.status)) fail('carry_not_found', 'That live carry no longer exists.', 404);
    if (ticket.members.includes(userId)) {
      joined = ticket;
      stateAfter = state;
      return;
    }
    if (!JOINABLE.has(ticket.status)) fail('carry_not_joinable', 'That carry is not accepting members right now.', 409);
    if (ticket.members.length >= ticket.maxMembers) fail('carry_full', 'That carry party is full.', 409);
    const check = eligibility(member, state, ticket);
    if (!check.eligible) fail(check.code, check.reason, 403);
    ticket.members.push(userId);
    if (!ticket.participantHistory.includes(userId)) ticket.participantHistory.push(userId);
    ticket.ready[userId] = false;
    const channel = guild.channels.cache.get(ticket.channelId) ?? await guild.channels.fetch(ticket.channelId).catch(() => null);
    if (channel?.isTextBased()) {
      await channel.permissionOverwrites.edit(userId, {
        ViewChannel: true,
        ReadMessageHistory: true,
        SendMessages: true,
        AttachFiles: true,
        EmbedLinks: true
      }, { reason: 'Joined unified carry from Kingdom HQ' }).catch(() => null);
    }
    joined = ticket;
    await syncTicketMessage(guild, ticket);
    await refreshUnifiedUi(guild, state);
    stateAfter = state;
  });
  if (!joined) fail('carry_changed', 'That carry changed before you could join it. Refresh and try again.', 409);
  const channel = guild.channels.cache.get(joined.channelId);
  await channel?.send({ content: `🌐 **${member.displayName}** joined the carry party from Kingdom HQ.`, allowedMentions: { parse: [] } }).catch(() => null);
  return publicSession(joined, member, stateAfter, joined.id);
}

export async function leaveUnifiedCarry(guild, userId, ticketId) {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) fail('not_in_guild', 'Join the Kingdom Carries Discord server before using this feature.', 403);
  let result = null;
  await mutateGuildState(guild.id, async (state) => {
    const ticket = normaliseTicket(state.carryTickets?.[ticketId]);
    if (!ticket || !ACTIVE.has(ticket.status) || !ticket.members.includes(userId)) fail('carry_not_found', 'You are not in that active carry.', 404);
    ticket.members = ticket.members.filter((id) => id !== userId);
    delete ticket.ready[userId];
    if (ticket.leaderId === userId) ticket.leaderId = ticket.members[0] ?? null;
    if (!ticket.members.length) {
      ticket.status = 'cancelled';
      ticket.closedAt = new Date().toISOString();
    }
    const channel = guild.channels.cache.get(ticket.channelId);
    if (channel?.isTextBased()) await channel.permissionOverwrites.delete(userId, 'Left unified carry from Kingdom HQ').catch(() => null);
    result = ticket;
    await syncTicketMessage(guild, ticket);
    await refreshUnifiedUi(guild, state);
  });
  const channel = guild.channels.cache.get(result?.channelId);
  await channel?.send({ content: `🌐 **${member.displayName}** left the carry party from Kingdom HQ.`, allowedMentions: { parse: [] } }).catch(() => null);
  return { ok: true, id: ticketId, status: result.status };
}

export async function getUnifiedCarry(guild, userId, ticketId) {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) fail('not_in_guild', 'Join the Kingdom Carries Discord server before using this feature.', 403);
  const state = await reconcileUnifiedCarries(guild);
  const ticket = normaliseTicket(state.carryTickets?.[ticketId]);
  if (!ticket) fail('carry_not_found', 'That carry could not be found.', 404);
  const involved = ticket.members.includes(userId)
    || ticket.participantHistory.includes(userId)
    || ticket.carrierId === userId
    || ticket.userId === userId;
  if (!involved) fail('forbidden', 'You do not have access to that carry.', 403);
  return publicSession(ticket, member, state, activeForUser(state, userId)?.id ?? null);
}
