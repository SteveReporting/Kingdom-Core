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
import { mutateGuildState, readGuildState } from '../storage/store.js';
import { sendBrandedWebhook } from './webhooks.js';

const DUNGEONS = [
  'Desert Temple', 'Winter Outpost', 'Pirate Island', "King\'s Castle", 'The Underworld',
  'Samurai Palace', 'The Canals', 'Ghastly Harbor', 'Steampunk Sewers', 'Boss Raids',
  'Orbital Outpost', 'Volcanic Chambers', 'Aquatic Temple', 'Enchanted Forest', 'Northern Lands',
  'Gilded Skies', 'Yokai Peak', 'Abyssal Void'
];
const DIFFICULTIES = ['Easy', 'Medium', 'Hard', 'Insane', 'Nightmare'];
const MODES = ['Normal', 'Hardcore'];
const ACTIVE = new Set(['open', 'claimed', 'running']);

const eph = (content) => ({ content, flags: MessageFlags.Ephemeral });

function branded(title, color = BRAND.color) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setFooter({ text: BRAND.footer })
    .setTimestamp();
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

function carryModal() {
  const dungeon = new StringSelectMenuBuilder()
    .setCustomId('kc2:carry:dungeon')
    .setPlaceholder('Choose the dungeon')
    .setRequired(true)
    .addOptions(DUNGEONS.map((name) => ({ label: name, value: name, emoji: '⚔️' })));

  const difficulty = new StringSelectMenuBuilder()
    .setCustomId('kc2:carry:difficulty')
    .setPlaceholder('Choose difficulty')
    .setRequired(true)
    .addOptions(DIFFICULTIES.map((name) => ({ label: name, value: name, emoji: '🏰' })));

  const mode = new StringSelectMenuBuilder()
    .setCustomId('kc2:carry:mode')
    .setPlaceholder('Choose Normal or Hardcore')
    .setRequired(true)
    .addOptions(
      { label: 'Normal', value: 'Normal', description: 'Standard dungeon run', emoji: '🟢' },
      { label: 'Hardcore', value: 'Hardcore', description: 'Hardcore mode enabled', emoji: '🔥' }
    );

  const notes = new TextInputBuilder()
    .setCustomId('kc2:carry:notes')
    .setPlaceholder('Optional: party size, gear context, anything the carrier should know')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(180);

  return new ModalBuilder()
    .setCustomId('kc2:carry:submit')
    .setTitle('⚔️ Request a Kingdom Carry')
    .addLabelComponents(
      new LabelBuilder().setLabel('Dungeon').setDescription('Select exactly where you need help.').setStringSelectMenuComponent(dungeon),
      new LabelBuilder().setLabel('Difficulty').setDescription('Select the dungeon difficulty.').setStringSelectMenuComponent(difficulty),
      new LabelBuilder().setLabel('Mode').setDescription('Normal or Hardcore.').setStringSelectMenuComponent(mode),
      new LabelBuilder().setLabel('Carrier Notes').setDescription('Optional details for the Knight who claims the mission.').setTextInputComponent(notes)
    );
}

function ticketColor(ticket) {
  if (ticket.status === 'completed') return 0x57f287;
  if (ticket.status === 'cancelled') return 0xed4245;
  if (ticket.status === 'running') return 0xfee75c;
  if (ticket.status === 'claimed') return 0x5865f2;
  return BRAND.color;
}

function statusLabel(ticket) {
  return {
    open: '🟡 Waiting for Knight',
    claimed: '🛡️ Claimed',
    running: '⚔️ Carry in Progress',
    completed: '✅ Completed',
    cancelled: '❌ Closed'
  }[ticket.status] ?? ticket.status;
}

function ticketEmbed(ticket) {
  return branded(`⚔️ Carry Mission • ${ticket.id}`, ticketColor(ticket))
    .setDescription([
      `**${ticket.dungeon}** • **${ticket.difficulty}** • **${ticket.mode}**`,
      '',
      `Status: **${statusLabel(ticket)}**`,
      ticket.notes ? `> ${ticket.notes}` : '> No extra carrier notes.'
    ].join('\n'))
    .addFields(
      { name: 'Member', value: `<@${ticket.userId}>`, inline: true },
      { name: 'Knight', value: ticket.carrierId ? `<@${ticket.carrierId}>` : 'Unassigned', inline: true },
      { name: 'Created', value: `<t:${Math.floor(new Date(ticket.createdAt).getTime() / 1000)}:R>`, inline: true }
    );
}

function ticketButtons(ticket) {
  if (!ACTIVE.has(ticket.status)) return [];
  const row = new ActionRowBuilder();
  if (ticket.status === 'open') {
    row.addComponents(
      new ButtonBuilder().setCustomId(`kc2:carry:claim:${ticket.id}`).setLabel('Claim Mission').setEmoji('🛡️').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`kc2:carry:close:${ticket.id}`).setLabel('Remove / Close').setEmoji('✖️').setStyle(ButtonStyle.Danger)
    );
  } else if (ticket.status === 'claimed') {
    row.addComponents(
      new ButtonBuilder().setCustomId(`kc2:carry:start:${ticket.id}`).setLabel('Start Carry').setEmoji('▶️').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`kc2:carry:return:${ticket.id}`).setLabel('Return to Pool').setEmoji('↩️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`kc2:carry:complete:${ticket.id}`).setLabel('Complete').setEmoji('✅').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`kc2:carry:close:${ticket.id}`).setLabel('Close').setEmoji('✖️').setStyle(ButtonStyle.Danger)
    );
  } else {
    row.addComponents(
      new ButtonBuilder().setCustomId(`kc2:carry:complete:${ticket.id}`).setLabel('Complete Carry').setEmoji('✅').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`kc2:carry:return:${ticket.id}`).setLabel('Return to Pool').setEmoji('↩️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`kc2:carry:close:${ticket.id}`).setLabel('Close').setEmoji('✖️').setStyle(ButtonStyle.Danger)
    );
  }
  return [row];
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

function activeTickets(state) {
  return Object.values(state.carryTickets ?? {})
    .filter((ticket) => ACTIVE.has(ticket.status))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

export function carryPublicPanelPayload(state = {}) {
  const active = activeTickets(state);
  const embed = branded('⚔️ Kingdom Carries • Mission Desk')
    .setDescription([
      '**Free Dungeon Quest carries, handled as private missions.**',
      '',
      'Press **Request Carry** and choose your dungeon, difficulty and mode in one popup.',
      'Kingdom Core creates a **private carry ticket** visible only to you, Knights and staff.',
      'A Knight can claim it, start the run, return it to the pool, or complete it from inside the ticket.',
      '',
      '> No public request spam. No typing dungeon names. No hunting through channels.'
    ].join('\n'))
    .addFields(
      { name: 'Open Missions', value: `**${active.filter((x) => x.status === 'open').length}**`, inline: true },
      { name: 'Claimed / Running', value: `**${active.filter((x) => x.status !== 'open').length}**`, inline: true },
      { name: 'Completed', value: `**${state.stats?.completedCarries ?? 0}**`, inline: true }
    );

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('kc2:carry:open').setLabel('Request Carry').setEmoji('⚔️').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('kc2:carry:mine').setLabel('My Carry Ticket').setEmoji('🎫').setStyle(ButtonStyle.Secondary)
    )],
    allowedMentions: { parse: [] }
  };
}

export function carryControlPanelPayload(state = {}) {
  const tickets = activeTickets(state);
  const waiting = tickets.filter((ticket) => ticket.status === 'open');
  const active = tickets.filter((ticket) => ['claimed', 'running'].includes(ticket.status));
  const preview = tickets.slice(0, 10).map((ticket, index) =>
    `**${index + 1}.** <@${ticket.userId}> • **${ticket.dungeon}** • ${ticket.difficulty} ${ticket.mode}\n└ ${statusLabel(ticket)}${ticket.carrierId ? ` • <@${ticket.carrierId}>` : ''}`
  ).join('\n');

  const embed = branded('🛡️ Knight Operations • Carry Control', 0x5865f2)
    .setDescription([
      '**Live private carry-ticket command center.**',
      'Use **Browse Missions** to select any current request and control it without searching channels.',
      '',
      preview || '_No active carry missions._'
    ].join('\n'))
    .addFields(
      { name: 'Waiting', value: `🟡 **${waiting.length}**`, inline: true },
      { name: 'Claimed / Running', value: `⚔️ **${active.length}**`, inline: true },
      { name: 'Total Active', value: `🎫 **${tickets.length}**`, inline: true }
    );

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('kc2:carry:browse').setLabel('Browse Missions').setEmoji('🗂️').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('kc2:carry:refresh').setLabel('Refresh Board').setEmoji('🔄').setStyle(ButtonStyle.Secondary)
    )],
    allowedMentions: { parse: [] }
  };
}

export async function refreshCarryPanels(guild, state) {
  state.setup ??= {};
  state.setup.panels ??= {};
  const publicChannel = guild.channels.cache.get(state.setup?.channels?.carryBoard);
  if (publicChannel?.isTextBased()) {
    let msg = state.setup.panels.carryUltimate
      ? await publicChannel.messages.fetch(state.setup.panels.carryUltimate).catch(() => null) : null;
    if (msg) await msg.edit(carryPublicPanelPayload(state)).catch(() => null);
    else {
      msg = await publicChannel.send(carryPublicPanelPayload(state));
      state.setup.panels.carryUltimate = msg.id;
    }
    if (!msg.pinned) await msg.pin('Kingdom Core /setup2 carry mission desk').catch(() => null);
  }

  const control = guild.channels.cache.get(state.setup?.channels?.carryControl);
  if (control?.isTextBased()) {
    let msg = state.setup.panels.carryControl
      ? await control.messages.fetch(state.setup.panels.carryControl).catch(() => null) : null;
    if (msg) await msg.edit(carryControlPanelPayload(state)).catch(() => null);
    else {
      msg = await control.send(carryControlPanelPayload(state));
      state.setup.panels.carryControl = msg.id;
    }
    if (!msg.pinned) await msg.pin('Kingdom Core /setup2 Knight operations board').catch(() => null);
  }
}

async function syncTicketMessages(guild, state, ticket) {
  const payload = { embeds: [ticketEmbed(ticket)], components: ticketButtons(ticket), allowedMentions: { parse: [] } };
  const channel = guild.channels.cache.get(ticket.channelId);
  if (channel?.isTextBased() && ticket.headerMessageId) {
    const msg = await channel.messages.fetch(ticket.headerMessageId).catch(() => null);
    if (msg) await msg.edit(payload).catch(() => null);
  }
  const control = guild.channels.cache.get(state.setup?.channels?.carryControl);
  if (control?.isTextBased() && ticket.controlMessageId) {
    const msg = await control.messages.fetch(ticket.controlMessageId).catch(() => null);
    if (msg) await msg.edit(payload).catch(() => null);
  }
  await refreshCarryPanels(guild, state);
}

export async function openCarryTicketModal(interaction) {
  const state = await readGuildState(interaction.guildId);
  const existing = Object.values(state.carryTickets ?? {}).find((ticket) => ticket.userId === interaction.user.id && ACTIVE.has(ticket.status));
  if (existing) return interaction.reply(eph(`You already have an active carry ticket: <#${existing.channelId}>`));
  return interaction.showModal(carryModal());
}

async function createCarryTicket(interaction) {
  const dungeon = interaction.fields.getStringSelectValues('kc2:carry:dungeon')[0];
  const difficulty = interaction.fields.getStringSelectValues('kc2:carry:difficulty')[0];
  const mode = interaction.fields.getStringSelectValues('kc2:carry:mode')[0];
  const notes = interaction.fields.getTextInputValue('kc2:carry:notes').trim();
  const state = await readGuildState(interaction.guildId);

  const existing = Object.values(state.carryTickets ?? {}).find((ticket) => ticket.userId === interaction.user.id && ACTIVE.has(ticket.status));
  if (existing) return interaction.reply(eph(`You already have an active carry ticket: <#${existing.channelId}>`));

  const parent = interaction.guild.channels.cache.get(state.setup?.categories?.carryTickets);
  if (!parent || parent.type !== ChannelType.GuildCategory) {
    return interaction.reply(eph('The carry-ticket category is unavailable. Ask an administrator to run `/setup2`.'));
  }

  const short = Date.now().toString(36).slice(-5);
  const safe = interaction.user.username.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24) || interaction.user.id.slice(-8);
  const id = `KC-${short.toUpperCase()}`;
  const channel = await interaction.guild.channels.create({
    name: `carry-${safe}-${short}`.slice(0, 100),
    type: ChannelType.GuildText,
    parent: parent.id,
    topic: `Kingdom Core carry ticket ${id} • ${interaction.user.id} • ${dungeon} • ${difficulty} • ${mode}`,
    permissionOverwrites: carryTicketOverwrites(interaction.guild, state, interaction.user.id),
    reason: `Kingdom Core carry ticket ${id}`
  });

  const ticket = {
    id,
    userId: interaction.user.id,
    username: interaction.user.username,
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
    embeds: [ticketEmbed(ticket)],
    components: ticketButtons(ticket),
    allowedMentions: { users: [interaction.user.id], roles: [] }
  });
  ticket.headerMessageId = header.id;
  if (!header.pinned) await header.pin('Kingdom Core carry mission controls').catch(() => null);

  const control = interaction.guild.channels.cache.get(state.setup?.channels?.carryControl);
  if (control?.isTextBased()) {
    const controlMsg = await control.send({
      embeds: [ticketEmbed(ticket)],
      components: ticketButtons(ticket),
      allowedMentions: { parse: [] }
    });
    ticket.controlMessageId = controlMsg.id;
  }

  await mutateGuildState(interaction.guildId, async (fresh) => {
    fresh.carryTickets ??= {};
    fresh.carryTickets[id] = ticket;
    await refreshCarryPanels(interaction.guild, fresh);
  });

  const fresh = await readGuildState(interaction.guildId);
  await sendBrandedWebhook(interaction.guild, fresh, 'carry', {
    embeds: [branded('⚔️ New Carry Mission').setDescription(`**${dungeon}** • ${difficulty} • ${mode}`).addFields(
      { name: 'Member', value: `<@${interaction.user.id}>`, inline: true },
      { name: 'Ticket', value: `<#${channel.id}>`, inline: true },
      { name: 'Mission ID', value: `\`${id}\``, inline: true }
    )]
  }).catch(() => null);

  return interaction.reply({
    content: `✅ Your private carry mission is ready: <#${channel.id}>`,
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] }
  });
}

function browserPayload(state) {
  const tickets = activeTickets(state).slice(0, 25);
  const embed = branded('🗂️ Active Carry Missions', 0x5865f2)
    .setDescription(tickets.length
      ? 'Select a mission below to open carrier/staff controls.'
      : '_There are no active carry missions._');
  const components = [];
  if (tickets.length) {
    components.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('kc2:carry:pick')
        .setPlaceholder('Select an active carry mission')
        .addOptions(tickets.map((ticket) => ({
          label: `${ticket.id} • ${ticket.dungeon}`.slice(0, 100),
          description: `${ticket.difficulty} ${ticket.mode} • ${ticket.status} • ${ticket.username}`.slice(0, 100),
          value: ticket.id,
          emoji: ticket.status === 'open' ? '🟡' : ticket.status === 'running' ? '⚔️' : '🛡️'
        })))
    ));
  }
  return { embeds: [embed], components, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } };
}

async function updateTicket(interaction, id, action) {
  const initial = await readGuildState(interaction.guildId);
  const ticket = initial.carryTickets?.[id];
  if (!ticket) return interaction.reply(eph('That carry mission no longer exists.'));

  const carrier = carrierOrStaff(interaction.member, initial);
  const staff = staffOnly(interaction.member, initial);
  const requester = ticket.userId === interaction.user.id;
  const assigned = ticket.carrierId === interaction.user.id;

  if (action === 'claim' && !carrier) return interaction.reply(eph('Only Kingdom Knights or staff can claim carry missions.'));
  if (['start', 'complete', 'return'].includes(action) && !(assigned || staff)) {
    return interaction.reply(eph('Only the assigned Knight or staff can control that active carry mission.'));
  }
  if (action === 'close' && !(requester || assigned || staff)) {
    return interaction.reply(eph('Only the requester, assigned Knight or staff can close this carry mission.'));
  }

  let updated = null;
  await mutateGuildState(interaction.guildId, async (state) => {
    const current = state.carryTickets?.[id];
    if (!current) return;

    if (action === 'claim') {
      if (current.status !== 'open') return;
      current.status = 'claimed';
      current.carrierId = interaction.user.id;
      current.claimedAt = new Date().toISOString();
    } else if (action === 'start') {
      if (!['claimed', 'running'].includes(current.status)) return;
      current.status = 'running';
      current.startedAt ??= new Date().toISOString();
    } else if (action === 'return') {
      if (!['claimed', 'running'].includes(current.status)) return;
      current.status = 'open';
      current.carrierId = null;
      current.claimedAt = null;
      current.returnedAt = new Date().toISOString();
    } else if (action === 'complete') {
      if (!['claimed', 'running'].includes(current.status)) return;
      current.status = 'completed';
      current.completedAt = new Date().toISOString();
      current.completedBy = interaction.user.id;
      state.stats ??= {};
      state.stats.completedCarries = (state.stats.completedCarries ?? 0) + 1;
    } else if (action === 'close') {
      if (!ACTIVE.has(current.status)) return;
      current.status = 'cancelled';
      current.closedAt = new Date().toISOString();
      current.closedBy = interaction.user.id;
    }
    updated = current;
    await syncTicketMessages(interaction.guild, state, current);
  });

  if (!updated) return interaction.reply(eph('That mission changed before the action could be applied. Refresh and try again.'));

  const fresh = await readGuildState(interaction.guildId);
  const channel = interaction.guild.channels.cache.get(updated.channelId);
  if (['completed', 'cancelled'].includes(updated.status) && channel?.isTextBased()) {
    await channel.permissionOverwrites.edit(updated.userId, {
      ViewChannel: true,
      SendMessages: false,
      ReadMessageHistory: true
    }).catch(() => null);
    if (!channel.name.startsWith(updated.status === 'completed' ? 'done-' : 'closed-')) {
      await channel.setName(`${updated.status === 'completed' ? 'done' : 'closed'}-${channel.name}`.slice(0, 100)).catch(() => null);
    }
  }

  if (updated.status === 'completed') {
    const results = interaction.guild.channels.cache.get(fresh.setup?.channels?.carryResults);
    const embed = branded('🏆 Carry Mission Complete', 0x57f287)
      .setDescription(`**${updated.dungeon}** • ${updated.difficulty} • ${updated.mode}`)
      .addFields(
        { name: 'Member', value: `<@${updated.userId}>`, inline: true },
        { name: 'Knight', value: updated.carrierId ? `<@${updated.carrierId}>` : `<@${interaction.user.id}>`, inline: true },
        { name: 'Mission', value: `\`${updated.id}\``, inline: true }
      );
    if (results?.isTextBased()) await results.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => null);
    await sendBrandedWebhook(interaction.guild, fresh, 'dispatch', { embeds: [embed] }).catch(() => null);
  }

  return interaction.reply(eph(`✅ **${updated.id}** is now **${statusLabel(updated)}**.`));
}

export async function handleCarryTicketButton(interaction) {
  const id = interaction.customId;
  if (id === 'kc2:carry:open' || id === 'kc:carry:join') return openCarryTicketModal(interaction);

  const state = await readGuildState(interaction.guildId);
  if (id === 'kc2:carry:mine') {
    const ticket = Object.values(state.carryTickets ?? {}).find((item) => item.userId === interaction.user.id && ACTIVE.has(item.status));
    return interaction.reply(eph(ticket ? `Your active carry mission: <#${ticket.channelId}>` : 'You do not have an active carry mission.'));
  }
  if (id === 'kc2:carry:browse') {
    if (!carrierOrStaff(interaction.member, state)) return interaction.reply(eph('Only Knights or staff can browse carry missions.'));
    return interaction.reply(browserPayload(state));
  }
  if (id === 'kc2:carry:refresh') {
    if (!carrierOrStaff(interaction.member, state)) return interaction.reply(eph('Only Knights or staff can refresh the operations board.'));
    await mutateGuildState(interaction.guildId, async (fresh) => refreshCarryPanels(interaction.guild, fresh));
    return interaction.reply(eph('🔄 Carry control board refreshed.'));
  }

  const parts = id.split(':');
  if (parts[0] === 'kc2' && parts[1] === 'carry' && ['claim', 'start', 'complete', 'return', 'close'].includes(parts[2])) {
    return updateTicket(interaction, parts.slice(3).join(':'), parts[2]);
  }
  return false;
}

export async function handleCarryTicketSelect(interaction) {
  if (interaction.customId !== 'kc2:carry:pick') return false;
  const state = await readGuildState(interaction.guildId);
  if (!carrierOrStaff(interaction.member, state)) {
    await interaction.reply(eph('Only Knights or staff can use the carry mission browser.'));
    return true;
  }
  const ticket = state.carryTickets?.[interaction.values[0]];
  if (!ticket || !ACTIVE.has(ticket.status)) {
    await interaction.reply(eph('That mission is no longer active.'));
    return true;
  }
  await interaction.update({
    embeds: [ticketEmbed(ticket)],
    components: ticketButtons(ticket),
    allowedMentions: { parse: [] }
  });
  return true;
}

export async function handleCarryTicketModal(interaction) {
  if (interaction.customId !== 'kc2:carry:submit') return false;
  await createCarryTicket(interaction);
  return true;
}
