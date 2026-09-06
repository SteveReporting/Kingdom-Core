import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';
import { BRAND, CARRIER_KEYS, ROLE_BLUEPRINT, STAFF_KEYS } from '../config/blueprint.js';
import { mutateGuildState, readGuildState, writeGuildState } from '../storage/store.js';
import { sendBrandedWebhook } from './webhooks.js';

const DUNGEONS = [
  'Desert Temple', 'Winter Outpost', 'Pirate Island', "King's Castle", 'The Underworld',
  'Samurai Palace', 'The Canals', 'Ghastly Harbor', 'Steampunk Sewers', 'Boss Raids',
  'Orbital Outpost', 'Volcanic Chambers', 'Aquatic Temple', 'Enchanted Forest', 'Northern Lands',
  'Gilded Skies', 'Yokai Peak', 'Abyssal Void'
];
const DIFFICULTIES = ['Easy', 'Medium', 'Hard', 'Insane', 'Nightmare'];
const ACTIVE = new Set(['open', 'claimed', 'ready', 'running']);
const JOINABLE = new Set(['open', 'claimed', 'ready']);
const eph = (content) => ({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });

function branded(title, color = BRAND.color) {
  return new EmbedBuilder().setColor(color).setTitle(title).setFooter({ text: BRAND.footer }).setTimestamp();
}

function normalize(ticket) {
  ticket.members ??= [ticket.userId].filter(Boolean);
  if (ticket.userId && !ticket.members.includes(ticket.userId)) ticket.members.unshift(ticket.userId);
  ticket.leaderId ??= ticket.userId ?? ticket.members[0] ?? null;
  ticket.ready ??= {};
  return ticket;
}

function membersOf(ticket) {
  return [...new Set(normalize(ticket).members.filter(Boolean))];
}

function hasAnyRole(member, ids) {
  return ids.some((id) => id && member?.roles?.cache?.has(id));
}

function carrierOrStaff(member, state) {
  if (member?.permissions?.has?.(PermissionFlagsBits.Administrator)) return true;
  const roles = state.setup?.roles ?? {};
  return hasAnyRole(member, [...CARRIER_KEYS, ...STAFF_KEYS].map((key) => roles[key]).filter(Boolean));
}

function staffOnly(member, state) {
  if (member?.permissions?.has?.(PermissionFlagsBits.Administrator)) return true;
  const roles = state.setup?.roles ?? {};
  return hasAnyRole(member, STAFF_KEYS.map((key) => roles[key]).filter(Boolean));
}

function assignedCarrierOrStaff(member, state, ticket, userId) {
  return staffOnly(member, state) || ticket.carrierId === userId;
}

function statusText(ticket) {
  return {
    open: '🟡 OPEN',
    claimed: '🛡️ CLAIMED',
    ready: '✅ READY CHECK',
    running: '⚔️ RUNNING',
    completed: '🏆 COMPLETE',
    cancelled: '❌ CLOSED',
    merged: '🔗 MERGED'
  }[ticket.status] ?? String(ticket.status).toUpperCase();
}

function compatible(a, b) {
  return a.dungeon === b.dungeon && a.difficulty === b.difficulty && a.mode === b.mode;
}

function activeParties(state) {
  return Object.values(state.carryTickets ?? {})
    .map(normalize)
    .filter((ticket) => ACTIVE.has(ticket.status))
    .sort((a, b) => new Date(a.createdAt ?? 0) - new Date(b.createdAt ?? 0));
}

function userActiveParty(state, userId) {
  return activeParties(state).find((ticket) => membersOf(ticket).includes(userId)) ?? null;
}

function readyCount(ticket) {
  const members = membersOf(ticket);
  return members.filter((id) => Boolean(ticket.ready?.[id])).length;
}

function allReady(ticket) {
  const members = membersOf(ticket);
  return members.length > 0 && members.every((id) => Boolean(ticket.ready?.[id]));
}

function partyEmbed(ticket) {
  const members = membersOf(ticket);
  const ready = readyCount(ticket);
  const color = ticket.status === 'completed' ? 0x57f287
    : ticket.status === 'running' ? 0xfee75c
      : ticket.status === 'ready' ? 0x57f287
        : ticket.status === 'claimed' ? 0x5865f2
          : BRAND.color;
  const roster = members.slice(0, 20).map((id, index) => {
    const icon = ticket.status === 'ready' ? (ticket.ready?.[id] ? '✅' : '⬜') : '•';
    return `${icon} **${index + 1}.** <@${id}>`;
  }).join('\n');

  return branded(`⚔️ Carry Party • ${ticket.id}`, color)
    .setDescription([
      `**${ticket.dungeon}** • **${ticket.difficulty}** • **${ticket.mode}**`,
      `Status: **${statusText(ticket)}**`,
      '',
      ticket.notes ? `> ${ticket.notes}` : '> No extra party notes.'
    ].join('\n'))
    .addFields(
      { name: `Party • ${members.length} member${members.length === 1 ? '' : 's'}`, value: roster || '_No members._' },
      { name: 'Knight', value: ticket.carrierId ? `<@${ticket.carrierId}>` : 'Unassigned', inline: true },
      { name: 'Ready', value: ticket.status === 'ready' ? `**${ready}/${members.length}**` : 'Not started', inline: true },
      { name: 'Created', value: ticket.createdAt ? `<t:${Math.floor(new Date(ticket.createdAt).getTime() / 1000)}:R>` : 'Unknown', inline: true }
    );
}

function partyControls(ticket) {
  if (!ACTIVE.has(ticket.status)) return [];
  const rows = [];
  const memberRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`kc3:party:join:${ticket.id}`).setLabel('Join Party').setEmoji('➕').setStyle(ButtonStyle.Success).setDisabled(!JOINABLE.has(ticket.status)),
    new ButtonBuilder().setCustomId(`kc3:party:leave:${ticket.id}`).setLabel('Leave Party').setEmoji('🚪').setStyle(ButtonStyle.Secondary).setDisabled(ticket.status === 'running'),
    new ButtonBuilder().setCustomId(`kc3:party:ready:${ticket.id}`).setLabel("I'm Ready").setEmoji('✅').setStyle(ButtonStyle.Primary).setDisabled(ticket.status !== 'ready')
  );
  rows.push(memberRow);

  const carrier = new ActionRowBuilder();
  if (ticket.status === 'open') {
    carrier.addComponents(new ButtonBuilder().setCustomId(`kc3:party:claim:${ticket.id}`).setLabel('Claim').setEmoji('🛡️').setStyle(ButtonStyle.Primary));
  } else if (ticket.status === 'claimed') {
    carrier.addComponents(new ButtonBuilder().setCustomId(`kc3:party:readycheck:${ticket.id}`).setLabel('Start Ready Check').setEmoji('✅').setStyle(ButtonStyle.Success));
  } else if (ticket.status === 'ready') {
    carrier.addComponents(
      new ButtonBuilder().setCustomId(`kc3:party:start:${ticket.id}`).setLabel('Start Carry').setEmoji('▶️').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`kc3:party:readycheck:${ticket.id}`).setLabel('Reset Ready Check').setEmoji('🔄').setStyle(ButtonStyle.Secondary)
    );
  } else if (ticket.status === 'running') {
    carrier.addComponents(new ButtonBuilder().setCustomId(`kc3:party:complete:${ticket.id}`).setLabel('Complete Carry').setEmoji('🏆').setStyle(ButtonStyle.Success));
  }
  carrier.addComponents(
    new ButtonBuilder().setCustomId(`kc3:party:manage:${ticket.id}`).setLabel('Manage Members').setEmoji('👥').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`kc3:party:return:${ticket.id}`).setLabel('Return').setEmoji('↩️').setStyle(ButtonStyle.Secondary).setDisabled(ticket.status === 'open'),
    new ButtonBuilder().setCustomId(`kc3:party:close:${ticket.id}`).setLabel('Close').setEmoji('✖️').setStyle(ButtonStyle.Danger)
  );
  rows.push(carrier);
  return rows;
}

function liveQueuePayload(state) {
  const parties = activeParties(state);
  const lines = parties.slice(0, 15).map((ticket, index) => {
    const ready = ticket.status === 'ready' ? ` • Ready ${readyCount(ticket)}/${membersOf(ticket).length}` : '';
    return `**${index + 1}. ${ticket.dungeon}** • ${ticket.difficulty} ${ticket.mode}\n└ ${statusText(ticket)} • **${membersOf(ticket).length} member${membersOf(ticket).length === 1 ? '' : 's'}**${ready}`;
  });
  return {
    embeds: [branded('⚔️ Live Carry Queue • Join a Party')
      .setDescription([
        '**Request a new carry or join a compatible party that is already forming.**',
        'Exact matching requests are automatically grouped so carriers do not run duplicate parties.',
        '',
        ...lines,
        ...(lines.length ? [] : ['_No active carry parties right now._'])
      ].join('\n'))
      .addFields(
        { name: 'Open Parties', value: `🟡 **${parties.filter((x) => x.status === 'open').length}**`, inline: true },
        { name: 'Ready / Claimed', value: `✅ **${parties.filter((x) => ['claimed', 'ready'].includes(x.status)).length}**`, inline: true },
        { name: 'Running', value: `⚔️ **${parties.filter((x) => x.status === 'running').length}**`, inline: true }
      )],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('kc3:party:request').setLabel('Request Carry').setEmoji('⚔️').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('kc3:party:join-active').setLabel('Join Active Carry').setEmoji('➕').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('kc3:party:mine').setLabel('My Party').setEmoji('🎫').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('kc3:party:refresh').setLabel('Refresh').setEmoji('🔄').setStyle(ButtonStyle.Secondary)
    )],
    allowedMentions: { parse: [] }
  };
}

function carrierBoardPayload(state) {
  const parties = activeParties(state);
  return {
    embeds: [branded('🛡️ Carrier Control • Grouped Carry Operations', 0x5865f2)
      .setDescription([
        '**Claim, ready-check, manage and complete grouped carry parties from one desk.**',
        '',
        `🟡 Waiting: **${parties.filter((x) => x.status === 'open').length}**`,
        `🛡️ Claimed: **${parties.filter((x) => x.status === 'claimed').length}**`,
        `✅ Ready checks: **${parties.filter((x) => x.status === 'ready').length}**`,
        `⚔️ Running: **${parties.filter((x) => x.status === 'running').length}**`,
        '',
        '> Use Browse Parties for direct controls. Merge Compatible cleans up duplicate open requests.'
      ].join('\n'))],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('kc3:party:browse').setLabel('Browse Parties').setEmoji('🗂️').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('kc3:party:merge-all').setLabel('Merge Compatible').setEmoji('🔗').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('kc3:party:refresh-control').setLabel('Refresh').setEmoji('🔄').setStyle(ButtonStyle.Secondary)
    )],
    allowedMentions: { parse: [] }
  };
}

function requestModal() {
  const dungeon = new StringSelectMenuBuilder().setCustomId('kc3:party:dungeon').setPlaceholder('Choose dungeon').setRequired(true)
    .addOptions(DUNGEONS.map((name) => ({ label: name, value: name, emoji: '⚔️' })));
  const difficulty = new StringSelectMenuBuilder().setCustomId('kc3:party:difficulty').setPlaceholder('Choose difficulty').setRequired(true)
    .addOptions(DIFFICULTIES.map((name) => ({ label: name, value: name, emoji: '🏰' })));
  const mode = new StringSelectMenuBuilder().setCustomId('kc3:party:mode').setPlaceholder('Normal or Hardcore').setRequired(true)
    .addOptions(
      { label: 'Normal', value: 'Normal', emoji: '🟢' },
      { label: 'Hardcore', value: 'Hardcore', emoji: '🔥' }
    );
  const notes = new TextInputBuilder().setCustomId('kc3:party:notes').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(180)
    .setPlaceholder('Optional notes for the carrier');
  return new ModalBuilder().setCustomId('kc3:party:submit').setTitle('⚔️ Request a Grouped Carry')
    .addLabelComponents(
      new LabelBuilder().setLabel('Dungeon').setStringSelectMenuComponent(dungeon),
      new LabelBuilder().setLabel('Difficulty').setStringSelectMenuComponent(difficulty),
      new LabelBuilder().setLabel('Mode').setStringSelectMenuComponent(mode),
      new LabelBuilder().setLabel('Notes').setTextInputComponent(notes)
    );
}

function participantOverwrites(guild, state, memberIds) {
  const roleIds = state.setup?.roles ?? {};
  const privileged = new Set([...STAFF_KEYS, ...CARRIER_KEYS].map((key) => roleIds[key]).filter(Boolean));
  const rows = [{
    id: guild.roles.everyone.id,
    allow: [PermissionFlagsBits.ReadMessageHistory],
    deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
  }];
  for (const definition of ROLE_BLUEPRINT) {
    const id = roleIds[definition.key];
    if (!id) continue;
    rows.push(privileged.has(id)
      ? { id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages] }
      : { id, allow: [PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
  }
  for (const id of [...new Set(memberIds)]) {
    rows.push({
      id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks
      ]
    });
  }
  return rows;
}

async function syncParty(guild, state, ticket) {
  normalize(ticket);
  const channel = guild.channels.cache.get(ticket.channelId);
  if (channel?.isTextBased()) {
    if (ticket.headerMessageId) {
      const msg = await channel.messages.fetch(ticket.headerMessageId).catch(() => null);
      if (msg) await msg.edit({ embeds: [partyEmbed(ticket)], components: partyControls(ticket), allowedMentions: { parse: [] } }).catch(() => null);
    }
    for (const memberId of membersOf(ticket)) {
      await channel.permissionOverwrites.edit(memberId, {
        ViewChannel: true,
        ReadMessageHistory: true,
        SendMessages: ticket.status !== 'completed' && ticket.status !== 'cancelled'
      }, { reason: 'Kingdom Core grouped carry member' }).catch(() => null);
    }
  }
  await refreshPartyPanels(guild, state);
}

export async function refreshPartyPanels(guild, state) {
  state.setup ??= {};
  state.setup.panels ??= {};
  const queue = guild.channels.cache.get(state.setup?.channels?.carryQueue);
  if (queue?.isTextBased()) {
    let message = state.setup.panels.liveQueueV3 ? await queue.messages.fetch(state.setup.panels.liveQueueV3).catch(() => null) : null;
    if (message) await message.edit(liveQueuePayload(state)).catch(() => null);
    else {
      message = await queue.send(liveQueuePayload(state));
      state.setup.panels.liveQueueV3 = message.id;
    }
    if (!message.pinned) await message.pin('Kingdom Core /setup3 live carry queue').catch(() => null);
  }
  const control = guild.channels.cache.get(state.setup?.channels?.carryControl);
  if (control?.isTextBased()) {
    let message = state.setup.panels.carryControl ? await control.messages.fetch(state.setup.panels.carryControl).catch(() => null) : null;
    if (message) await message.edit(carrierBoardPayload(state)).catch(() => null);
    else {
      message = await control.send(carrierBoardPayload(state));
      state.setup.panels.carryControl = message.id;
    }
    if (!message.pinned) await message.pin('Kingdom Core /setup3 carrier control').catch(() => null);
  }
}

async function addMemberToParty(guild, state, ticket, userId) {
  normalize(ticket);
  if (!JOINABLE.has(ticket.status)) return false;
  if (!ticket.members.includes(userId)) ticket.members.push(userId);
  ticket.ready[userId] = false;
  const channel = guild.channels.cache.get(ticket.channelId);
  if (channel?.isTextBased()) {
    await channel.permissionOverwrites.edit(userId, {
      ViewChannel: true,
      ReadMessageHistory: true,
      SendMessages: true,
      AttachFiles: true,
      EmbedLinks: true
    }, { reason: 'Joined grouped carry party' }).catch(() => null);
  }
  return true;
}

async function removeMemberFromParty(guild, ticket, userId) {
  normalize(ticket);
  ticket.members = ticket.members.filter((id) => id !== userId);
  delete ticket.ready[userId];
  if (ticket.leaderId === userId) ticket.leaderId = ticket.members[0] ?? null;
  const channel = guild.channels.cache.get(ticket.channelId);
  if (channel?.isTextBased()) await channel.permissionOverwrites.delete(userId, 'Left grouped carry party').catch(() => null);
  if (!ticket.members.length) {
    ticket.status = 'cancelled';
    ticket.closedAt = new Date().toISOString();
  }
}

async function mergeOpenDuplicates(guild, state) {
  const parties = activeParties(state).filter((ticket) => ticket.status === 'open');
  let merged = 0;
  const handled = new Set();
  for (const target of parties) {
    if (handled.has(target.id)) continue;
    const matches = parties.filter((other) => other.id !== target.id && !handled.has(other.id) && compatible(target, other));
    for (const source of matches) {
      for (const memberId of membersOf(source)) await addMemberToParty(guild, state, target, memberId);
      source.status = 'merged';
      source.mergedInto = target.id;
      source.mergedAt = new Date().toISOString();
      const sourceChannel = guild.channels.cache.get(source.channelId);
      if (sourceChannel?.isTextBased()) {
        await sourceChannel.send({ content: `🔗 This request was merged into <#${target.channelId}>.`, allowedMentions: { parse: [] } }).catch(() => null);
        await sourceChannel.setName(`merged-${sourceChannel.name}`.slice(0, 100)).catch(() => null);
      }
      handled.add(source.id);
      merged++;
    }
    await syncParty(guild, state, target);
  }
  return merged;
}

async function createOrMerge(interaction) {
  const dungeon = interaction.fields.getStringSelectValues('kc3:party:dungeon')[0];
  const difficulty = interaction.fields.getStringSelectValues('kc3:party:difficulty')[0];
  const mode = interaction.fields.getStringSelectValues('kc3:party:mode')[0];
  const notes = interaction.fields.getTextInputValue('kc3:party:notes').trim();
  const initial = await readGuildState(interaction.guildId);
  const existingUser = userActiveParty(initial, interaction.user.id);
  if (existingUser) return interaction.reply(eph(`You are already in <#${existingUser.channelId}>.`));

  const target = activeParties(initial).find((ticket) => JOINABLE.has(ticket.status) && compatible(ticket, { dungeon, difficulty, mode }));
  if (target) {
    await mutateGuildState(interaction.guildId, async (state) => {
      const current = state.carryTickets?.[target.id];
      if (!current) return;
      await addMemberToParty(interaction.guild, state, current, interaction.user.id);
      await syncParty(interaction.guild, state, current);
    });
    return interaction.reply(eph(`🔗 Your matching request was merged into the active party: <#${target.channelId}>.`));
  }

  const parent = interaction.guild.channels.cache.get(initial.setup?.categories?.carryTickets);
  if (!parent || parent.type !== ChannelType.GuildCategory) return interaction.reply(eph('Carry ticket infrastructure is missing. Run `/setup2` first, then `/setup3`.'));

  const short = Date.now().toString(36).slice(-5).toUpperCase();
  const id = `KP-${short}`;
  const safe = interaction.user.username.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 18) || interaction.user.id.slice(-8);
  const channel = await interaction.guild.channels.create({
    name: `carry-${safe}-${short.toLowerCase()}`,
    type: ChannelType.GuildText,
    parent: parent.id,
    permissionOverwrites: participantOverwrites(interaction.guild, initial, [interaction.user.id]),
    topic: `${id} • ${dungeon} • ${difficulty} • ${mode} • grouped Kingdom carry`,
    reason: `Kingdom Core grouped carry ${id}`
  });
  const ticket = {
    id,
    userId: interaction.user.id,
    leaderId: interaction.user.id,
    members: [interaction.user.id],
    ready: {},
    channelId: channel.id,
    dungeon,
    difficulty,
    mode,
    notes,
    status: 'open',
    carrierId: null,
    createdAt: new Date().toISOString()
  };
  const header = await channel.send({
    content: `<@${interaction.user.id}>`,
    embeds: [partyEmbed(ticket)],
    components: partyControls(ticket),
    allowedMentions: { users: [interaction.user.id], roles: [] }
  });
  ticket.headerMessageId = header.id;
  await header.pin('Kingdom Core grouped carry controls').catch(() => null);

  await mutateGuildState(interaction.guildId, async (state) => {
    state.carryTickets ??= {};
    state.carryTickets[id] = ticket;
    await refreshPartyPanels(interaction.guild, state);
  });
  const fresh = await readGuildState(interaction.guildId);
  await sendBrandedWebhook(interaction.guild, fresh, 'carry', {
    embeds: [branded('⚔️ New Grouped Carry Party').setDescription(`**${dungeon}** • ${difficulty} • ${mode}`).addFields(
      { name: 'Leader', value: `<@${interaction.user.id}>`, inline: true },
      { name: 'Party', value: `<#${channel.id}>`, inline: true },
      { name: 'ID', value: `\`${id}\``, inline: true }
    )]
  }).catch(() => null);
  return interaction.reply(eph(`✅ Carry party created: <#${channel.id}>`));
}

function joinBrowser(state) {
  const parties = activeParties(state).filter((ticket) => JOINABLE.has(ticket.status)).slice(0, 25);
  const components = [];
  if (parties.length) {
    components.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId('kc3:party:joinpick').setPlaceholder('Choose an active carry party').addOptions(
        parties.map((ticket) => ({
          label: `${ticket.dungeon} • ${ticket.difficulty}`.slice(0, 100),
          description: `${ticket.mode} • ${membersOf(ticket).length} member(s) • ${statusText(ticket)}`.slice(0, 100),
          value: ticket.id,
          emoji: ticket.status === 'ready' ? '✅' : ticket.status === 'claimed' ? '🛡️' : '🟡'
        }))
      )
    ));
  }
  return {
    embeds: [branded('➕ Join an Active Carry').setDescription(parties.length ? 'Select the party you want to join. You can only be in one active carry at a time.' : '_No joinable parties right now._')],
    components,
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] }
  };
}

function manageBrowser(state) {
  const parties = activeParties(state).slice(0, 25);
  const components = [];
  if (parties.length) {
    components.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId('kc3:party:managepick').setPlaceholder('Select a party to manage').addOptions(
        parties.map((ticket) => ({
          label: `${ticket.id} • ${ticket.dungeon}`.slice(0, 100),
          description: `${ticket.difficulty} ${ticket.mode} • ${membersOf(ticket).length} members • ${ticket.status}`.slice(0, 100),
          value: ticket.id,
          emoji: ticket.status === 'running' ? '⚔️' : ticket.status === 'ready' ? '✅' : '🛡️'
        }))
      )
    ));
  }
  return { embeds: [branded('🗂️ Carrier Party Browser', 0x5865f2)], components, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } };
}

function manageMembersPayload(ticket) {
  const members = membersOf(ticket);
  const components = [];
  if (members.length) {
    components.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId(`kc3:party:kickpick:${ticket.id}`).setPlaceholder('Remove a member from this party').addOptions(
        members.map((id, index) => ({ label: `Party Member ${index + 1}`, description: id, value: id, emoji: '🚪' }))
      )
    ));
  }
  return { embeds: [partyEmbed(ticket)], components, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } };
}

async function controlAction(interaction, ticketId, action) {
  const initial = await readGuildState(interaction.guildId);
  const ticket = initial.carryTickets?.[ticketId];
  if (!ticket || !ACTIVE.has(ticket.status)) return interaction.reply(eph('That party is no longer active.'));
  normalize(ticket);
  const participant = ticket.members.includes(interaction.user.id);
  const carrier = carrierOrStaff(interaction.member, initial);
  const assigned = assignedCarrierOrStaff(interaction.member, initial, ticket, interaction.user.id);

  if (action === 'join') {
    if (userActiveParty(initial, interaction.user.id)) return interaction.reply(eph('You are already in an active carry party.'));
    if (!JOINABLE.has(ticket.status)) return interaction.reply(eph('That carry has already started.'));
    await mutateGuildState(interaction.guildId, async (state) => {
      const current = state.carryTickets?.[ticketId];
      await addMemberToParty(interaction.guild, state, current, interaction.user.id);
      await syncParty(interaction.guild, state, current);
    });
    return interaction.reply(eph(`✅ Joined <#${ticket.channelId}>.`));
  }
  if (action === 'leave') {
    if (!participant) return interaction.reply(eph('You are not in that party.'));
    if (ticket.status === 'running') return interaction.reply(eph('You cannot leave after the carry has started. Ask the Knight or staff.'));
    await mutateGuildState(interaction.guildId, async (state) => {
      const current = state.carryTickets?.[ticketId];
      await removeMemberFromParty(interaction.guild, current, interaction.user.id);
      await syncParty(interaction.guild, state, current);
    });
    return interaction.reply(eph('🚪 You left the carry party.'));
  }
  if (action === 'ready') {
    if (!participant || ticket.status !== 'ready') return interaction.reply(eph('There is no active ready check for you in that party.'));
    let nowReady = false;
    let everyone = false;
    await mutateGuildState(interaction.guildId, async (state) => {
      const current = normalize(state.carryTickets?.[ticketId]);
      current.ready[interaction.user.id] = !current.ready[interaction.user.id];
      nowReady = current.ready[interaction.user.id];
      everyone = allReady(current);
      await syncParty(interaction.guild, state, current);
    });
    if (everyone) {
      const channel = interaction.guild.channels.cache.get(ticket.channelId);
      await channel?.send({ content: '✅ **Everyone is ready.** The assigned Knight can now start the carry.', allowedMentions: { parse: [] } }).catch(() => null);
    }
    return interaction.reply(eph(nowReady ? '✅ You are marked **READY**.' : '⬜ You are marked **NOT READY**.'));
  }

  if (!carrier) return interaction.reply(eph('Only Knights or staff can use carrier controls.'));
  if (['readycheck', 'start', 'complete', 'return', 'manage'].includes(action) && !assigned && action !== 'manage') {
    return interaction.reply(eph('Only the assigned Knight or staff can control this party.'));
  }

  if (action === 'manage') {
    if (!assigned) return interaction.reply(eph('Only the assigned Knight or staff can manage members.'));
    return interaction.reply(manageMembersPayload(ticket));
  }

  let result = null;
  await mutateGuildState(interaction.guildId, async (state) => {
    const current = normalize(state.carryTickets?.[ticketId]);
    if (!current) return;
    if (action === 'claim') {
      if (current.status !== 'open') return;
      current.status = 'claimed';
      current.carrierId = interaction.user.id;
      current.claimedAt = new Date().toISOString();
    } else if (action === 'readycheck') {
      if (!['claimed', 'ready'].includes(current.status)) return;
      current.status = 'ready';
      current.ready = Object.fromEntries(membersOf(current).map((id) => [id, false]));
      current.readyCheckAt = new Date().toISOString();
    } else if (action === 'start') {
      if (current.status !== 'ready' || !allReady(current)) return;
      current.status = 'running';
      current.startedAt = new Date().toISOString();
    } else if (action === 'return') {
      if (!['claimed', 'ready', 'running'].includes(current.status)) return;
      current.status = 'open';
      current.carrierId = null;
      current.ready = {};
      current.returnedAt = new Date().toISOString();
    } else if (action === 'complete') {
      if (current.status !== 'running') return;
      current.status = 'completed';
      current.completedAt = new Date().toISOString();
      current.completedBy = interaction.user.id;
      state.stats ??= {};
      state.stats.completedRuns = (state.stats.completedRuns ?? 0) + 1;
      state.stats.completedCarries = (state.stats.completedCarries ?? 0) + membersOf(current).length;
    } else if (action === 'close') {
      current.status = 'cancelled';
      current.closedAt = new Date().toISOString();
      current.closedBy = interaction.user.id;
    }
    result = current;
    await syncParty(interaction.guild, state, current);
  });

  if (!result) {
    if (action === 'start') return interaction.reply(eph('The carry can only start after **every party member is ready**.'));
    return interaction.reply(eph('That action was not valid for the current party state.'));
  }

  const channel = interaction.guild.channels.cache.get(result.channelId);
  if (action === 'readycheck' && channel?.isTextBased()) {
    await channel.send({
      content: membersOf(result).map((id) => `<@${id}>`).join(' '),
      embeds: [branded('✅ READY CHECK').setDescription('Everyone press **I\'m Ready** on the pinned carry panel. The carry cannot start until the full party is ready.')],
      allowedMentions: { users: membersOf(result), roles: [] }
    }).catch(() => null);
  }
  if (['completed', 'cancelled'].includes(result.status) && channel?.isTextBased()) {
    for (const id of membersOf(result)) {
      await channel.permissionOverwrites.edit(id, { ViewChannel: true, ReadMessageHistory: true, SendMessages: false }).catch(() => null);
    }
    await channel.setName(`${result.status === 'completed' ? 'done' : 'closed'}-${channel.name}`.slice(0, 100)).catch(() => null);
  }
  if (result.status === 'completed') {
    const fresh = await readGuildState(interaction.guildId);
    const results = interaction.guild.channels.cache.get(fresh.setup?.channels?.carryResults);
    const embed = branded('🏆 Group Carry Complete', 0x57f287)
      .setDescription(`**${result.dungeon}** • ${result.difficulty} • ${result.mode}`)
      .addFields(
        { name: 'Members Carried', value: `**${membersOf(result).length}**`, inline: true },
        { name: 'Knight', value: result.carrierId ? `<@${result.carrierId}>` : `<@${interaction.user.id}>`, inline: true },
        { name: 'Party ID', value: `\`${result.id}\``, inline: true }
      );
    if (results?.isTextBased()) await results.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => null);
    await sendBrandedWebhook(interaction.guild, fresh, 'dispatch', { embeds: [embed] }).catch(() => null);
  }
  return interaction.reply(eph(`✅ **${result.id}** → **${statusText(result)}**.`));
}

export async function handlePartyButton(interaction) {
  const id = interaction.customId;
  if (id === 'kc3:party:request' || id === 'kc2:carry:open' || id === 'kc:carry:join') return interaction.showModal(requestModal());
  const state = await readGuildState(interaction.guildId);
  if (id === 'kc3:party:join-active') {
    if (userActiveParty(state, interaction.user.id)) return interaction.reply(eph('You are already in an active carry party.'));
    return interaction.reply(joinBrowser(state));
  }
  if (id === 'kc3:party:mine') {
    const ticket = userActiveParty(state, interaction.user.id);
    return interaction.reply(eph(ticket ? `Your active carry party: <#${ticket.channelId}>` : 'You are not in an active carry party.'));
  }
  if (id === 'kc3:party:refresh') {
    await mutateGuildState(interaction.guildId, async (fresh) => refreshPartyPanels(interaction.guild, fresh));
    return interaction.reply(eph('🔄 Live queue refreshed.'));
  }
  if (id === 'kc3:party:browse') {
    if (!carrierOrStaff(interaction.member, state)) return interaction.reply(eph('Only Knights or staff can browse carrier controls.'));
    return interaction.reply(manageBrowser(state));
  }
  if (id === 'kc3:party:refresh-control') {
    if (!carrierOrStaff(interaction.member, state)) return interaction.reply(eph('Only Knights or staff can refresh the carrier board.'));
    await mutateGuildState(interaction.guildId, async (fresh) => refreshPartyPanels(interaction.guild, fresh));
    return interaction.reply(eph('🔄 Carrier board refreshed.'));
  }
  if (id === 'kc3:party:merge-all') {
    if (!carrierOrStaff(interaction.member, state)) return interaction.reply(eph('Only Knights or staff can merge carry requests.'));
    let count = 0;
    await mutateGuildState(interaction.guildId, async (fresh) => {
      count = await mergeOpenDuplicates(interaction.guild, fresh);
      await refreshPartyPanels(interaction.guild, fresh);
    });
    return interaction.reply(eph(`🔗 Merged **${count}** duplicate compatible request${count === 1 ? '' : 's'}.`));
  }
  const parts = id.split(':');
  if (parts[0] === 'kc3' && parts[1] === 'party' && ['join', 'leave', 'ready', 'claim', 'readycheck', 'start', 'complete', 'return', 'close', 'manage'].includes(parts[2])) {
    return controlAction(interaction, parts.slice(3).join(':'), parts[2]);
  }
  return false;
}

export async function handlePartySelect(interaction) {
  const state = await readGuildState(interaction.guildId);
  if (interaction.customId === 'kc3:party:joinpick') {
    if (userActiveParty(state, interaction.user.id)) return interaction.reply(eph('You are already in an active carry party.'));
    return controlAction(interaction, interaction.values[0], 'join');
  }
  if (interaction.customId === 'kc3:party:managepick') {
    if (!carrierOrStaff(interaction.member, state)) return interaction.reply(eph('Only Knights or staff can manage parties.'));
    const ticket = state.carryTickets?.[interaction.values[0]];
    if (!ticket) return interaction.reply(eph('That party no longer exists.'));
    return interaction.update({ embeds: [partyEmbed(ticket)], components: partyControls(ticket), allowedMentions: { parse: [] } });
  }
  if (interaction.customId.startsWith('kc3:party:kickpick:')) {
    const ticketId = interaction.customId.split(':').slice(3).join(':');
    const ticket = state.carryTickets?.[ticketId];
    if (!ticket || !assignedCarrierOrStaff(interaction.member, state, ticket, interaction.user.id)) return interaction.reply(eph('Only the assigned Knight or staff can remove party members.'));
    const userId = interaction.values[0];
    await mutateGuildState(interaction.guildId, async (fresh) => {
      const current = fresh.carryTickets?.[ticketId];
      await removeMemberFromParty(interaction.guild, current, userId);
      await syncParty(interaction.guild, fresh, current);
    });
    return interaction.update({ content: `🚪 Removed <@${userId}> from the party.`, embeds: [], components: [], allowedMentions: { parse: [] } });
  }
  return false;
}

export async function handlePartyModal(interaction) {
  if (interaction.customId !== 'kc3:party:submit') return false;
  await createOrMerge(interaction);
  return true;
}

export async function installCarryPartiesV3(guild) {
  await guild.channels.fetch();
  const state = await readGuildState(guild.id);
  state.carryTickets ??= {};
  for (const ticket of Object.values(state.carryTickets)) normalize(ticket);
  const merged = await mergeOpenDuplicates(guild, state);
  await refreshPartyPanels(guild, state);
  state.setup ??= {};
  state.setup.carryPartyVersion = 3;
  await writeGuildState(guild.id, state);
  return { active: activeParties(state).length, merged };
}
