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
  'Desert Temple', 'Winter Outpost', 'Pirate Island', "King\'s Castle", 'The Underworld',
  'Samurai Palace', 'The Canals', 'Ghastly Harbor', 'Steampunk Sewers', 'Boss Raids',
  'Orbital Outpost', 'Volcanic Chambers', 'Aquatic Temple', 'Enchanted Forest', 'Northern Lands',
  'Gilded Skies', 'Yokai Peak', 'Abyssal Void'
];
const DIFFICULTIES = ['Easy', 'Medium', 'Hard', 'Insane', 'Nightmare'];
const ACTIVE = new Set(['open', 'claimed', 'ready', 'running', 'between', 'closing']);
const JOINABLE = new Set(['open', 'claimed', 'ready', 'between']);
const eph = (content) => ({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });

function branded(title, color = BRAND.color) {
  return new EmbedBuilder().setColor(color).setTitle(title).setFooter({ text: BRAND.footer }).setTimestamp();
}

function normalize(ticket) {
  if (!ticket) return ticket;
  ticket.members ??= [ticket.userId].filter(Boolean);
  if (ticket.userId && !ticket.members.includes(ticket.userId)) ticket.members.unshift(ticket.userId);
  ticket.leaderId ??= ticket.userId ?? ticket.members[0] ?? null;
  ticket.ready ??= {};
  ticket.runsCompleted ??= ticket.status === 'completed' ? 1 : 0;
  if (ticket.runTarget === undefined) ticket.runTarget = 1;
  if (ticket.runTarget === 'infinite' || ticket.runTarget === 'unlimited') ticket.runTarget = null;
  ticket.maxMembers ??= Math.max(8, ticket.members.length);
  ticket.requirement ??= '';
  ticket.leftEarly ??= [];
  ticket.participantHistory ??= [...ticket.members];
  ticket.extensions ??= 0;
  ticket.sessionConfigured ??= Boolean(ticket.carrierId && ticket.runTarget !== undefined);
  return ticket;
}

function membersOf(ticket) {
  return [...new Set((normalize(ticket)?.members ?? []).filter(Boolean))];
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
    between: '🟣 BETWEEN RUNS',
    closing: '🟠 TARGET REACHED',
    completed: '🏆 SESSION ENDED',
    cancelled: '❌ CLOSED',
    merged: '🔗 MERGED'
  }[ticket.status] ?? String(ticket.status ?? 'unknown').toUpperCase();
}

function runTargetText(ticket) {
  return ticket.runTarget === null ? '∞' : String(Math.max(1, Number(ticket.runTarget) || 1));
}

function progressText(ticket) {
  return `**${ticket.runsCompleted ?? 0} / ${runTargetText(ticket)}** run${ticket.runTarget === 1 ? '' : 's'}`;
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

function sessionColor(ticket) {
  if (ticket.status === 'completed') return 0x57f287;
  if (ticket.status === 'closing') return 0xf1c40f;
  if (ticket.status === 'running') return 0x57f287;
  if (ticket.status === 'between') return 0x7c3aed;
  if (ticket.status === 'ready') return 0x3498db;
  if (ticket.status === 'claimed') return 0x5865f2;
  return BRAND.color;
}

function partyEmbed(ticket) {
  normalize(ticket);
  const members = membersOf(ticket);
  const ready = readyCount(ticket);
  const roster = members.length
    ? members.slice(0, 20).map((id) => `<@${id}>`).join('  ')
    : '_No active members._';
  const early = (ticket.leftEarly ?? []).length
    ? [...new Set(ticket.leftEarly)].slice(0, 20).map((id) => `<@${id}>`).join(', ')
    : null;
  const statusDetail = ticket.status === 'closing' && ticket.targetReachedAt
    ? `Target reached <t:${Math.floor(new Date(ticket.targetReachedAt).getTime() / 1000)}:R> — extend or end the session.`
    : ticket.status === 'between'
      ? 'A run finished. Members may rotate before the next ready check.'
      : ticket.status === 'running' && ticket.runStartedAt
        ? `Current run started <t:${Math.floor(new Date(ticket.runStartedAt).getTime() / 1000)}:R>.`
        : null;

  const embed = branded(`⚔️ ${ticket.dungeon} (${ticket.difficulty})`, sessionColor(ticket))
    .setDescription([
      `**${ticket.mode}** • Party \`${ticket.id}\``,
      statusDetail ? `> ${statusDetail}` : null
    ].filter(Boolean).join('\n'))
    .addFields(
      { name: '🛡️ Carrier', value: ticket.carrierId ? `<@${ticket.carrierId}>` : '**Waiting for a Knight**', inline: true },
      { name: '🏁 Progress', value: progressText(ticket), inline: true },
      { name: '📡 Status', value: `**${statusText(ticket)}**`, inline: true },
      { name: `👥 Party • ${members.length}/${ticket.maxMembers}`, value: roster },
      { name: '📋 Requirements', value: ticket.requirement?.trim() || '_No carrier requirement set._', inline: true },
      { name: '✅ Ready', value: ticket.status === 'ready' ? `**${ready}/${members.length}**` : '—', inline: true }
    );

  if (ticket.notes) embed.addFields({ name: '🗒️ Request Note', value: String(ticket.notes).slice(0, 1024) });
  if (early) embed.addFields({ name: '🚪 Left Early', value: early });
  if (ticket.extensions) embed.addFields({ name: '➕ Extensions', value: `**${ticket.extensions}**`, inline: true });
  return embed;
}

function partyControls(ticket) {
  normalize(ticket);
  if (ticket.status === 'completed') {
    return [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`kc3:party:dispute:${ticket.id}`).setLabel('Dispute Result').setEmoji('⚖️').setStyle(ButtonStyle.Danger)
    )];
  }
  if (!ACTIVE.has(ticket.status)) return [];

  const full = membersOf(ticket).length >= ticket.maxMembers;
  const rows = [];
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`kc3:party:join:${ticket.id}`).setLabel(full ? 'Party Full' : 'Join Party').setEmoji('➕').setStyle(ButtonStyle.Success).setDisabled(!JOINABLE.has(ticket.status) || full),
    new ButtonBuilder().setCustomId(`kc3:party:leave:${ticket.id}`).setLabel(ticket.status === 'running' ? 'Leave Early' : 'Leave Party').setEmoji('🚪').setStyle(ButtonStyle.Secondary).setDisabled(ticket.status === 'closing'),
    new ButtonBuilder().setCustomId(`kc3:party:ready:${ticket.id}`).setLabel("I'm Ready").setEmoji('✅').setStyle(ButtonStyle.Primary).setDisabled(ticket.status !== 'ready')
  ));

  const carrier = new ActionRowBuilder();
  if (ticket.status === 'open') {
    carrier.addComponents(new ButtonBuilder().setCustomId(`kc3:party:claim:${ticket.id}`).setLabel('Claim & Configure').setEmoji('🛡️').setStyle(ButtonStyle.Primary));
  } else if (ticket.status === 'claimed') {
    carrier.addComponents(
      new ButtonBuilder().setCustomId(`kc3:party:readycheck:${ticket.id}`).setLabel('Start Ready Check').setEmoji('✅').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`kc3:party:configure:${ticket.id}`).setLabel('Edit Run Plan').setEmoji('⚙️').setStyle(ButtonStyle.Secondary)
    );
  } else if (ticket.status === 'ready') {
    carrier.addComponents(
      new ButtonBuilder().setCustomId(`kc3:party:start:${ticket.id}`).setLabel('Start Run').setEmoji('▶️').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`kc3:party:readycheck:${ticket.id}`).setLabel('Reset Ready').setEmoji('🔄').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`kc3:party:configure:${ticket.id}`).setLabel('Edit Plan').setEmoji('⚙️').setStyle(ButtonStyle.Secondary)
    );
  } else if (ticket.status === 'running') {
    carrier.addComponents(
      new ButtonBuilder().setCustomId(`kc3:party:complete:${ticket.id}`).setLabel('Complete Run').setEmoji('🏆').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`kc3:party:extend:${ticket.id}`).setLabel('Extend').setEmoji('➕').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`kc3:party:finish:${ticket.id}`).setLabel('End Session').setEmoji('⏹️').setStyle(ButtonStyle.Danger)
    );
  } else if (ticket.status === 'between') {
    carrier.addComponents(
      new ButtonBuilder().setCustomId(`kc3:party:readycheck:${ticket.id}`).setLabel('Ready Next Run').setEmoji('✅').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`kc3:party:extend:${ticket.id}`).setLabel('Extend').setEmoji('➕').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`kc3:party:finish:${ticket.id}`).setLabel('End Session').setEmoji('⏹️').setStyle(ButtonStyle.Danger)
    );
  } else if (ticket.status === 'closing') {
    carrier.addComponents(
      new ButtonBuilder().setCustomId(`kc3:party:extend:${ticket.id}`).setLabel('Extend Session').setEmoji('➕').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`kc3:party:finish:${ticket.id}`).setLabel('End Session').setEmoji('🏁').setStyle(ButtonStyle.Success)
    );
  }

  if (ticket.status !== 'closing') {
    carrier.addComponents(new ButtonBuilder().setCustomId(`kc3:party:manage:${ticket.id}`).setLabel('Members').setEmoji('👥').setStyle(ButtonStyle.Secondary));
  }
  rows.push(carrier);

  if (['claimed', 'ready'].includes(ticket.status)) {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`kc3:party:return:${ticket.id}`).setLabel('Return to Queue').setEmoji('↩️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`kc3:party:close:${ticket.id}`).setLabel('Cancel Session').setEmoji('✖️').setStyle(ButtonStyle.Danger)
    ));
  }
  return rows;
}

function liveQueuePayload(state) {
  const parties = activeParties(state);
  const lines = parties.slice(0, 15).map((ticket, index) => {
    const ready = ticket.status === 'ready' ? ` • Ready ${readyCount(ticket)}/${membersOf(ticket).length}` : '';
    const plan = ticket.carrierId ? ` • ${ticket.runsCompleted}/${runTargetText(ticket)} runs` : '';
    return `**${index + 1}. ${ticket.dungeon}** • ${ticket.difficulty} ${ticket.mode}\n└ ${statusText(ticket)} • **${membersOf(ticket).length}/${ticket.maxMembers} members**${plan}${ready}`;
  });
  return {
    embeds: [branded('⚔️ Live Carry Sessions • Join the Realm')
      .setDescription([
        '**Requests are grouped into live multi-run sessions.**',
        'Knights choose how many runs they are offering, party capacity and any requirement before the first ready check.',
        '',
        ...lines,
        ...(lines.length ? [] : ['_No active carry sessions right now._'])
      ].join('\n'))
      .addFields(
        { name: 'Waiting', value: `🟡 **${parties.filter((x) => x.status === 'open').length}**`, inline: true },
        { name: 'Preparing', value: `✅ **${parties.filter((x) => ['claimed', 'ready', 'between'].includes(x.status)).length}**`, inline: true },
        { name: 'Running', value: `⚔️ **${parties.filter((x) => x.status === 'running').length}**`, inline: true },
        { name: 'Target Reached', value: `🟠 **${parties.filter((x) => x.status === 'closing').length}**`, inline: true }
      )],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('kc3:party:request').setLabel('Request Carry').setEmoji('⚔️').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('kc3:party:join-active').setLabel('Join Active Session').setEmoji('➕').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('kc3:party:mine').setLabel('My Session').setEmoji('🎫').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('kc3:party:refresh').setLabel('Refresh').setEmoji('🔄').setStyle(ButtonStyle.Secondary)
    )],
    allowedMentions: { parse: [] }
  };
}

function carrierBoardPayload(state) {
  const parties = activeParties(state);
  const activeRuns = parties.filter((x) => x.status === 'running');
  return {
    embeds: [branded('🛡️ Knight Carry Command • Session Operations', 0x5865f2)
      .setDescription([
        '**Claim a request, define the session, then run as many rounds as you committed to.**',
        '',
        `🟡 Waiting: **${parties.filter((x) => x.status === 'open').length}**`,
        `🛡️ Preparing: **${parties.filter((x) => ['claimed', 'ready', 'between'].includes(x.status)).length}**`,
        `⚔️ In a run: **${activeRuns.length}**`,
        `🟠 Target reached: **${parties.filter((x) => x.status === 'closing').length}**`,
        '',
        '> **Claim & Configure** lets the Knight choose run count, party cap and requirements. Use **Complete Run** after each dungeon; the session stays alive until the plan is finished or the Knight ends it.'
      ].join('\n'))],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('kc3:party:browse').setLabel('Browse Sessions').setEmoji('🗂️').setStyle(ButtonStyle.Primary),
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
    .setPlaceholder('Optional note for the Knight');
  return new ModalBuilder().setCustomId('kc3:party:submit').setTitle('⚔️ Request a Carry')
    .addLabelComponents(
      new LabelBuilder().setLabel('Dungeon').setStringSelectMenuComponent(dungeon),
      new LabelBuilder().setLabel('Difficulty').setStringSelectMenuComponent(difficulty),
      new LabelBuilder().setLabel('Mode').setStringSelectMenuComponent(mode),
      new LabelBuilder().setLabel('Request note').setTextInputComponent(notes)
    );
}

function sessionPlanModal(ticket, mode = 'claim') {
  const runs = new StringSelectMenuBuilder().setCustomId('kc3:party:session-runs').setPlaceholder('How many runs are you offering?').setRequired(true)
    .addOptions(
      { label: '1 run', value: '1', emoji: '1️⃣' },
      { label: '2 runs', value: '2', emoji: '2️⃣' },
      { label: '3 runs', value: '3', emoji: '3️⃣' },
      { label: '5 runs', value: '5', emoji: '5️⃣' },
      { label: '10 runs', value: '10', emoji: '🔟' },
      { label: '15 runs', value: '15', emoji: '⚔️' },
      { label: '25 runs', value: '25', emoji: '🏆' },
      { label: 'Until I end the session', description: 'Unlimited / ∞ runs', value: 'infinite', emoji: '♾️' }
    );
  const capacity = new StringSelectMenuBuilder().setCustomId('kc3:party:session-cap').setPlaceholder('Maximum party size').setRequired(true)
    .addOptions([2, 4, 6, 8, 10, 12, 15, 20].map((value) => ({ label: `${value} members`, value: String(value), emoji: '👥' })));
  const requirement = new TextInputBuilder().setCustomId('kc3:party:session-req').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(160)
    .setPlaceholder('e.g. Level 70+, must be ready in 5 min, or leave blank');
  if (ticket.requirement) requirement.setValue(String(ticket.requirement).slice(0, 160));
  return new ModalBuilder().setCustomId(`kc3:party:session-submit:${ticket.id}`).setTitle(mode === 'claim' ? '🛡️ Claim & Configure Session' : '⚙️ Edit Carry Session')
    .addLabelComponents(
      new LabelBuilder().setLabel('Run commitment').setStringSelectMenuComponent(runs),
      new LabelBuilder().setLabel('Party capacity').setStringSelectMenuComponent(capacity),
      new LabelBuilder().setLabel('Requirement / note').setTextInputComponent(requirement)
    );
}

function extendModal(ticket) {
  const runs = new StringSelectMenuBuilder().setCustomId('kc3:party:extend-runs').setPlaceholder('Extend this session by…').setRequired(true)
    .addOptions(
      { label: '+1 run', value: '1', emoji: '➕' },
      { label: '+2 runs', value: '2', emoji: '➕' },
      { label: '+3 runs', value: '3', emoji: '➕' },
      { label: '+5 runs', value: '5', emoji: '⚔️' },
      { label: '+10 runs', value: '10', emoji: '🏆' },
      { label: '+25 runs', value: '25', emoji: '🏰' },
      { label: 'Make unlimited', description: 'Switch target to ∞', value: 'infinite', emoji: '♾️' }
    );
  const note = new TextInputBuilder().setCustomId('kc3:party:extend-note').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(120)
    .setPlaceholder('Optional extension note');
  return new ModalBuilder().setCustomId(`kc3:party:extend-submit:${ticket.id}`).setTitle('➕ Extend Carry Session')
    .addLabelComponents(
      new LabelBuilder().setLabel('Extension').setStringSelectMenuComponent(runs),
      new LabelBuilder().setLabel('Note').setTextInputComponent(note)
    );
}

function disputeModal(ticket) {
  const reason = new StringSelectMenuBuilder().setCustomId('kc3:party:dispute-reason').setPlaceholder('Why are you disputing this session?').setRequired(true)
    .addOptions(
      { label: 'Run count is wrong', value: 'run-count', emoji: '🏁' },
      { label: 'I was marked as leaving early incorrectly', value: 'left-early', emoji: '🚪' },
      { label: 'Carry quality / completion issue', value: 'quality', emoji: '⚔️' },
      { label: 'Carrier / member conduct', value: 'conduct', emoji: '🚨' },
      { label: 'Other', value: 'other', emoji: '📝' }
    );
  const details = new TextInputBuilder().setCustomId('kc3:party:dispute-details').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1200)
    .setPlaceholder('Explain what should be reviewed. Include useful context, not passwords or private account data.');
  return new ModalBuilder().setCustomId(`kc3:party:dispute-submit:${ticket.id}`).setTitle('⚖️ Dispute Carry Result')
    .addLabelComponents(
      new LabelBuilder().setLabel('Reason').setStringSelectMenuComponent(reason),
      new LabelBuilder().setLabel('Details').setTextInputComponent(details)
    );
}

function participantOverwrites(guild, state, memberIds) {
  const roleIds = state.setup?.roles ?? {};
  const privileged = new Set([...STAFF_KEYS, ...CARRIER_KEYS].map((key) => roleIds[key]).filter(Boolean));
  const rows = [{ id: guild.roles.everyone.id, allow: [PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }];
  for (const definition of ROLE_BLUEPRINT) {
    const id = roleIds[definition.key];
    if (!id) continue;
    rows.push(privileged.has(id)
      ? { id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages] }
      : { id, allow: [PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
  }
  for (const id of [...new Set(memberIds)]) rows.push({
    id,
    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks]
  });
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
        SendMessages: !['completed', 'cancelled'].includes(ticket.status)
      }, { reason: 'Kingdom Core carry session member' }).catch(() => null);
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
    if (!message.pinned) await message.pin('Kingdom Core live carry sessions').catch(() => null);
  }
  const control = guild.channels.cache.get(state.setup?.channels?.carryControl);
  if (control?.isTextBased()) {
    let message = state.setup.panels.carryControl ? await control.messages.fetch(state.setup.panels.carryControl).catch(() => null) : null;
    if (message) await message.edit(carrierBoardPayload(state)).catch(() => null);
    else {
      message = await control.send(carrierBoardPayload(state));
      state.setup.panels.carryControl = message.id;
    }
    if (!message.pinned) await message.pin('Kingdom Core Knight carry command').catch(() => null);
  }
}

async function addMemberToParty(guild, state, ticket, userId) {
  normalize(ticket);
  if (!JOINABLE.has(ticket.status)) return false;
  if (membersOf(ticket).length >= ticket.maxMembers) return false;
  if (!ticket.members.includes(userId)) ticket.members.push(userId);
  if (!ticket.participantHistory.includes(userId)) ticket.participantHistory.push(userId);
  ticket.ready[userId] = false;
  const channel = guild.channels.cache.get(ticket.channelId);
  if (channel?.isTextBased()) await channel.permissionOverwrites.edit(userId, {
    ViewChannel: true,
    ReadMessageHistory: true,
    SendMessages: true,
    AttachFiles: true,
    EmbedLinks: true
  }, { reason: 'Joined Kingdom carry session' }).catch(() => null);
  return true;
}

async function removeMemberFromParty(guild, ticket, userId, { early = false } = {}) {
  normalize(ticket);
  ticket.members = ticket.members.filter((id) => id !== userId);
  delete ticket.ready[userId];
  if (early && !ticket.leftEarly.includes(userId)) ticket.leftEarly.push(userId);
  if (ticket.leaderId === userId) ticket.leaderId = ticket.members[0] ?? null;
  const channel = guild.channels.cache.get(ticket.channelId);
  if (channel?.isTextBased()) await channel.permissionOverwrites.delete(userId, 'Left Kingdom carry session').catch(() => null);
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
      for (const memberId of membersOf(source)) {
        if (membersOf(target).length >= target.maxMembers) break;
        await addMemberToParty(guild, state, target, memberId);
      }
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

  const target = activeParties(initial).find((ticket) => JOINABLE.has(ticket.status) && membersOf(ticket).length < ticket.maxMembers && compatible(ticket, { dungeon, difficulty, mode }));
  if (target) {
    let joined = false;
    await mutateGuildState(interaction.guildId, async (state) => {
      const current = state.carryTickets?.[target.id];
      if (!current) return;
      joined = await addMemberToParty(interaction.guild, state, current, interaction.user.id);
      await syncParty(interaction.guild, state, current);
    });
    return interaction.reply(eph(joined ? `🔗 Your request joined the active session: <#${target.channelId}>.` : 'That matching session filled before you could join it.'));
  }

  const parent = interaction.guild.channels.cache.get(initial.setup?.categories?.carryTickets);
  if (!parent || parent.type !== ChannelType.GuildCategory) return interaction.reply(eph('The private carry-session category is unavailable. Ask staff to repair the Kingdom Core carry infrastructure.'));

  const short = Date.now().toString(36).slice(-5).toUpperCase();
  const id = `KP-${short}`;
  const safe = interaction.user.username.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 18) || interaction.user.id.slice(-8);
  const channel = await interaction.guild.channels.create({
    name: `carry-${safe}-${short.toLowerCase()}`,
    type: ChannelType.GuildText,
    parent: parent.id,
    permissionOverwrites: participantOverwrites(interaction.guild, initial, [interaction.user.id]),
    topic: `${id} • ${dungeon} • ${difficulty} • ${mode} • Kingdom carry session`,
    reason: `Kingdom Core carry session ${id}`
  });
  const ticket = normalize({
    id,
    userId: interaction.user.id,
    leaderId: interaction.user.id,
    members: [interaction.user.id],
    participantHistory: [interaction.user.id],
    ready: {},
    channelId: channel.id,
    dungeon,
    difficulty,
    mode,
    notes,
    status: 'open',
    carrierId: null,
    runTarget: 1,
    runsCompleted: 0,
    maxMembers: 8,
    requirement: '',
    sessionConfigured: false,
    createdAt: new Date().toISOString()
  });
  const header = await channel.send({
    content: `<@${interaction.user.id}>`,
    embeds: [partyEmbed(ticket)],
    components: partyControls(ticket),
    allowedMentions: { users: [interaction.user.id], roles: [] }
  });
  ticket.headerMessageId = header.id;
  await header.pin('Kingdom Core carry-session controls').catch(() => null);

  await mutateGuildState(interaction.guildId, async (state) => {
    state.carryTickets ??= {};
    state.carryTickets[id] = ticket;
    await refreshPartyPanels(interaction.guild, state);
  });
  const fresh = await readGuildState(interaction.guildId);
  await sendBrandedWebhook(interaction.guild, fresh, 'carry', {
    embeds: [branded('⚔️ New Carry Request').setDescription(`**${dungeon}** • ${difficulty} • ${mode}`).addFields(
      { name: 'Requester', value: `<@${interaction.user.id}>`, inline: true },
      { name: 'Session', value: `<#${channel.id}>`, inline: true },
      { name: 'ID', value: `\`${id}\``, inline: true }
    )]
  }).catch(() => null);
  return interaction.reply(eph(`✅ Carry request created: <#${channel.id}>`));
}

function joinBrowser(state) {
  const parties = activeParties(state).filter((ticket) => JOINABLE.has(ticket.status) && membersOf(ticket).length < ticket.maxMembers).slice(0, 25);
  const components = [];
  if (parties.length) components.push(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId('kc3:party:joinpick').setPlaceholder('Choose a live carry session').addOptions(
      parties.map((ticket) => ({
        label: `${ticket.dungeon} • ${ticket.difficulty}`.slice(0, 100),
        description: `${ticket.mode} • ${membersOf(ticket).length}/${ticket.maxMembers} • ${ticket.runsCompleted}/${runTargetText(ticket)} runs`.slice(0, 100),
        value: ticket.id,
        emoji: ticket.status === 'ready' ? '✅' : ticket.status === 'between' ? '🟣' : ticket.status === 'claimed' ? '🛡️' : '🟡'
      }))
    )
  ));
  return {
    embeds: [branded('➕ Join a Live Carry Session').setDescription(parties.length ? 'Choose a compatible session with an open slot.' : '_No joinable sessions have open slots right now._')],
    components,
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] }
  };
}

function manageBrowser(state) {
  const parties = activeParties(state).slice(0, 25);
  const components = [];
  if (parties.length) components.push(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId('kc3:party:managepick').setPlaceholder('Select a carry session').addOptions(
      parties.map((ticket) => ({
        label: `${ticket.id} • ${ticket.dungeon}`.slice(0, 100),
        description: `${ticket.difficulty} ${ticket.mode} • ${ticket.runsCompleted}/${runTargetText(ticket)} runs • ${ticket.status}`.slice(0, 100),
        value: ticket.id,
        emoji: ticket.status === 'running' ? '⚔️' : ticket.status === 'closing' ? '🟠' : ticket.status === 'between' ? '🟣' : '🛡️'
      }))
    )
  ));
  return { embeds: [branded('🗂️ Knight Session Browser', 0x5865f2)], components, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } };
}

function manageMembersPayload(ticket) {
  const members = membersOf(ticket);
  const components = [];
  if (members.length) components.push(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId(`kc3:party:kickpick:${ticket.id}`).setPlaceholder('Remove a member from this session').addOptions(
      members.map((id, index) => ({ label: `Party Member ${index + 1}`, description: id, value: id, emoji: '🚪' }))
    )
  ));
  return { embeds: [partyEmbed(ticket)], components, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } };
}

async function postSessionResult(guild, state, ticket) {
  const results = guild.channels.cache.get(state.setup?.channels?.carryResults);
  const early = (ticket.leftEarly ?? []).length ? [...new Set(ticket.leftEarly)].map((id) => `<@${id}>`).join(', ') : '_None_';
  const embed = branded('🏆 Carry Session Complete', 0x57f287)
    .setDescription(`**${ticket.dungeon}** • ${ticket.difficulty} • ${ticket.mode}`)
    .addFields(
      { name: 'Runs Completed', value: `**${ticket.runsCompleted} / ${runTargetText(ticket)}**`, inline: true },
      { name: 'Knight', value: ticket.carrierId ? `<@${ticket.carrierId}>` : 'Unknown', inline: true },
      { name: 'Session ID', value: `\`${ticket.id}\``, inline: true },
      { name: 'Participants', value: `**${new Set(ticket.participantHistory ?? membersOf(ticket)).size}** unique member(s)`, inline: true },
      { name: 'Left Early', value: early }
    );
  const payload = {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`kc3:party:dispute:${ticket.id}`).setLabel('Dispute Result').setEmoji('⚖️').setStyle(ButtonStyle.Danger)
    )],
    allowedMentions: { parse: [] }
  };
  if (results?.isTextBased()) await results.send(payload).catch(() => null);
  await sendBrandedWebhook(guild, state, 'dispatch', { embeds: [embed] }).catch(() => null);
}

async function controlAction(interaction, ticketId, action) {
  const initial = await readGuildState(interaction.guildId);
  const ticket = normalize(initial.carryTickets?.[ticketId]);
  if (!ticket || !ACTIVE.has(ticket.status)) return interaction.reply(eph('That carry session is no longer active.'));
  const participant = ticket.members.includes(interaction.user.id);
  const carrier = carrierOrStaff(interaction.member, initial);
  const assigned = assignedCarrierOrStaff(interaction.member, initial, ticket, interaction.user.id);

  if (action === 'join') {
    if (userActiveParty(initial, interaction.user.id)) return interaction.reply(eph('You are already in an active carry session.'));
    if (!JOINABLE.has(ticket.status)) return interaction.reply(eph('That session is not currently accepting members.'));
    if (membersOf(ticket).length >= ticket.maxMembers) return interaction.reply(eph('That carry session is full.'));
    let joined = false;
    await mutateGuildState(interaction.guildId, async (state) => {
      const current = state.carryTickets?.[ticketId];
      joined = await addMemberToParty(interaction.guild, state, current, interaction.user.id);
      await syncParty(interaction.guild, state, current);
    });
    return interaction.reply(eph(joined ? `✅ Joined <#${ticket.channelId}>.` : 'That session is no longer joinable.'));
  }

  if (action === 'leave') {
    if (!participant) return interaction.reply(eph('You are not in that session.'));
    const early = ['running', 'between'].includes(ticket.status) && (ticket.runsCompleted > 0 || ticket.status === 'running');
    await mutateGuildState(interaction.guildId, async (state) => {
      const current = state.carryTickets?.[ticketId];
      await removeMemberFromParty(interaction.guild, current, interaction.user.id, { early });
      await syncParty(interaction.guild, state, current);
    });
    return interaction.reply(eph(early ? '🚪 You left the session early. The session record has been updated.' : '🚪 You left the carry session.'));
  }

  if (action === 'ready') {
    if (!participant || ticket.status !== 'ready') return interaction.reply(eph('There is no active ready check for you in that session.'));
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
      await channel?.send({ content: '✅ **Everyone is ready.** The assigned Knight can start the run.', allowedMentions: { parse: [] } }).catch(() => null);
    }
    return interaction.reply(eph(nowReady ? '✅ You are marked **READY**.' : '⬜ You are marked **NOT READY**.'));
  }

  if (!carrier) return interaction.reply(eph('Only Knights or staff can use session controls.'));
  if (['readycheck', 'start', 'complete', 'return', 'manage', 'finish'].includes(action) && !assigned && action !== 'manage') {
    return interaction.reply(eph('Only the assigned Knight or staff can control this session.'));
  }
  if (action === 'manage') {
    if (!assigned) return interaction.reply(eph('Only the assigned Knight or staff can manage members.'));
    return interaction.reply(manageMembersPayload(ticket));
  }

  let result = null;
  let runJustCompleted = false;
  let finalised = false;
  await mutateGuildState(interaction.guildId, async (state) => {
    const current = normalize(state.carryTickets?.[ticketId]);
    if (!current) return;
    if (action === 'readycheck') {
      if (!['claimed', 'ready', 'between'].includes(current.status)) return;
      current.status = 'ready';
      current.ready = Object.fromEntries(membersOf(current).map((id) => [id, false]));
      current.readyCheckAt = new Date().toISOString();
    } else if (action === 'start') {
      if (current.status !== 'ready' || !allReady(current)) return;
      current.status = 'running';
      current.startedAt ??= new Date().toISOString();
      current.sessionStartedAt ??= new Date().toISOString();
      current.runStartedAt = new Date().toISOString();
    } else if (action === 'return') {
      if (!['claimed', 'ready'].includes(current.status) || current.runsCompleted > 0) return;
      current.status = 'open';
      current.carrierId = null;
      current.ready = {};
      current.sessionConfigured = false;
      current.returnedAt = new Date().toISOString();
    } else if (action === 'complete') {
      if (current.status !== 'running') return;
      current.runsCompleted += 1;
      current.lastRunCompletedAt = new Date().toISOString();
      current.runStartedAt = null;
      state.stats ??= {};
      state.stats.completedRuns = (state.stats.completedRuns ?? 0) + 1;
      state.stats.completedCarries = (state.stats.completedCarries ?? 0) + membersOf(current).length;
      if (current.runTarget !== null && current.runsCompleted >= current.runTarget) {
        current.status = 'closing';
        current.targetReachedAt = new Date().toISOString();
      } else {
        current.status = 'between';
      }
      runJustCompleted = true;
    } else if (action === 'finish') {
      if (!['claimed', 'ready', 'running', 'between', 'closing'].includes(current.status)) return;
      current.status = 'completed';
      current.completedAt = new Date().toISOString();
      current.completedBy = interaction.user.id;
      current.runStartedAt = null;
      finalised = true;
      state.stats ??= {};
      state.stats.completedSessions = (state.stats.completedSessions ?? 0) + 1;
    } else if (action === 'close') {
      if (current.runsCompleted > 0) return;
      current.status = 'cancelled';
      current.closedAt = new Date().toISOString();
      current.closedBy = interaction.user.id;
    }
    result = current;
    await syncParty(interaction.guild, state, current);
  });

  if (!result) {
    if (action === 'start') return interaction.reply(eph('The run can only start after **every current party member is ready**.'));
    return interaction.reply(eph('That action is not valid for the current session state.'));
  }

  const channel = interaction.guild.channels.cache.get(result.channelId);
  if (action === 'readycheck' && channel?.isTextBased()) {
    await channel.send({
      content: membersOf(result).map((id) => `<@${id}>`).join(' '),
      embeds: [branded('✅ READY CHECK').setDescription(`Run **${result.runsCompleted + 1}** is preparing. Everyone press **I\'m Ready** on the pinned session panel.`)],
      allowedMentions: { users: membersOf(result), roles: [] }
    }).catch(() => null);
  }
  if (runJustCompleted && channel?.isTextBased()) {
    const target = runTargetText(result);
    await channel.send({
      embeds: [branded(result.status === 'closing' ? '🏁 Session Target Reached' : '🏆 Run Complete', result.status === 'closing' ? 0xf1c40f : 0x57f287)
        .setDescription(`Progress is now **${result.runsCompleted}/${target}**. ${result.status === 'closing' ? 'The Knight can **Extend Session** or **End Session**.' : 'Members may rotate before the next ready check.'}`)],
      allowedMentions: { parse: [] }
    }).catch(() => null);
  }
  if (['completed', 'cancelled'].includes(result.status) && channel?.isTextBased()) {
    for (const id of membersOf(result)) await channel.permissionOverwrites.edit(id, { ViewChannel: true, ReadMessageHistory: true, SendMessages: false }).catch(() => null);
    await channel.setName(`${result.status === 'completed' ? 'done' : 'closed'}-${channel.name}`.slice(0, 100)).catch(() => null);
  }
  if (finalised) {
    const fresh = await readGuildState(interaction.guildId);
    await postSessionResult(interaction.guild, fresh, result);
  }
  return interaction.reply(eph(runJustCompleted
    ? `🏆 Run **${result.runsCompleted}** completed — ${result.status === 'closing' ? '**target reached**.' : '**session remains open**.'}`
    : `✅ **${result.id}** → **${statusText(result)}**.`));
}

async function openSessionPlan(interaction, ticketId, mode = 'claim') {
  const state = await readGuildState(interaction.guildId);
  const ticket = normalize(state.carryTickets?.[ticketId]);
  if (!ticket || !ACTIVE.has(ticket.status)) return interaction.reply(eph('That carry session is no longer active.'));
  if (!carrierOrStaff(interaction.member, state)) return interaction.reply(eph('Only Knights or staff can configure a carry session.'));
  if (mode === 'claim' && ticket.status !== 'open') return interaction.reply(eph('That request has already been claimed.'));
  if (mode !== 'claim' && !assignedCarrierOrStaff(interaction.member, state, ticket, interaction.user.id)) return interaction.reply(eph('Only the assigned Knight or staff can edit this run plan.'));
  return interaction.showModal(sessionPlanModal(ticket, mode));
}

async function openExtension(interaction, ticketId) {
  const state = await readGuildState(interaction.guildId);
  const ticket = normalize(state.carryTickets?.[ticketId]);
  if (!ticket || !ACTIVE.has(ticket.status)) return interaction.reply(eph('That carry session is no longer active.'));
  if (!assignedCarrierOrStaff(interaction.member, state, ticket, interaction.user.id)) return interaction.reply(eph('Only the assigned Knight or staff can extend this session.'));
  return interaction.showModal(extendModal(ticket));
}

async function openDispute(interaction, ticketId) {
  const state = await readGuildState(interaction.guildId);
  const ticket = normalize(state.carryTickets?.[ticketId]);
  if (!ticket || ticket.status !== 'completed') return interaction.reply(eph('Only completed carry sessions can be disputed.'));
  const involved = (ticket.participantHistory ?? []).includes(interaction.user.id) || ticket.carrierId === interaction.user.id || staffOnly(interaction.member, state);
  if (!involved) return interaction.reply(eph('Only people involved in that carry session or staff can dispute it.'));
  return interaction.showModal(disputeModal(ticket));
}

export async function handlePartyButton(interaction) {
  const id = interaction.customId;
  if (id === 'kc3:party:request' || id === 'kc2:carry:open' || id === 'kc:carry:join') return interaction.showModal(requestModal());
  const state = await readGuildState(interaction.guildId);
  if (id === 'kc3:party:join-active') {
    if (userActiveParty(state, interaction.user.id)) return interaction.reply(eph('You are already in an active carry session.'));
    return interaction.reply(joinBrowser(state));
  }
  if (id === 'kc3:party:mine') {
    const ticket = userActiveParty(state, interaction.user.id);
    return interaction.reply(eph(ticket ? `Your active carry session: <#${ticket.channelId}> • ${ticket.runsCompleted}/${runTargetText(ticket)} runs` : 'You are not in an active carry session.'));
  }
  if (id === 'kc3:party:refresh') {
    await mutateGuildState(interaction.guildId, async (fresh) => refreshPartyPanels(interaction.guild, fresh));
    return interaction.reply(eph('🔄 Live carry sessions refreshed.'));
  }
  if (id === 'kc3:party:browse') {
    if (!carrierOrStaff(interaction.member, state)) return interaction.reply(eph('Only Knights or staff can browse carry-session controls.'));
    return interaction.reply(manageBrowser(state));
  }
  if (id === 'kc3:party:refresh-control') {
    if (!carrierOrStaff(interaction.member, state)) return interaction.reply(eph('Only Knights or staff can refresh the Knight board.'));
    await mutateGuildState(interaction.guildId, async (fresh) => refreshPartyPanels(interaction.guild, fresh));
    return interaction.reply(eph('🔄 Knight carry board refreshed.'));
  }
  if (id === 'kc3:party:merge-all') {
    if (!carrierOrStaff(interaction.member, state)) return interaction.reply(eph('Only Knights or staff can merge carry requests.'));
    let count = 0;
    await mutateGuildState(interaction.guildId, async (fresh) => {
      count = await mergeOpenDuplicates(interaction.guild, fresh);
      await refreshPartyPanels(interaction.guild, fresh);
    });
    return interaction.reply(eph(`🔗 Merged **${count}** compatible duplicate request${count === 1 ? '' : 's'}.`));
  }

  const parts = id.split(':');
  if (parts[0] !== 'kc3' || parts[1] !== 'party') return false;
  const action = parts[2];
  const ticketId = parts.slice(3).join(':');
  if (action === 'claim') return openSessionPlan(interaction, ticketId, 'claim');
  if (action === 'configure') return openSessionPlan(interaction, ticketId, 'edit');
  if (action === 'extend') return openExtension(interaction, ticketId);
  if (action === 'dispute') return openDispute(interaction, ticketId);
  if (['join', 'leave', 'ready', 'readycheck', 'start', 'complete', 'return', 'close', 'manage', 'finish'].includes(action)) {
    return controlAction(interaction, ticketId, action);
  }
  return false;
}

export async function handlePartySelect(interaction) {
  const state = await readGuildState(interaction.guildId);
  if (interaction.customId === 'kc3:party:joinpick') {
    if (userActiveParty(state, interaction.user.id)) return interaction.reply(eph('You are already in an active carry session.'));
    return controlAction(interaction, interaction.values[0], 'join');
  }
  if (interaction.customId === 'kc3:party:managepick') {
    if (!carrierOrStaff(interaction.member, state)) return interaction.reply(eph('Only Knights or staff can manage sessions.'));
    const ticket = state.carryTickets?.[interaction.values[0]];
    if (!ticket) return interaction.reply(eph('That session no longer exists.'));
    return interaction.update({ embeds: [partyEmbed(ticket)], components: partyControls(ticket), allowedMentions: { parse: [] } });
  }
  if (interaction.customId.startsWith('kc3:party:kickpick:')) {
    const ticketId = interaction.customId.split(':').slice(3).join(':');
    const ticket = normalize(state.carryTickets?.[ticketId]);
    if (!ticket || !assignedCarrierOrStaff(interaction.member, state, ticket, interaction.user.id)) return interaction.reply(eph('Only the assigned Knight or staff can remove session members.'));
    const userId = interaction.values[0];
    const early = ['running', 'between'].includes(ticket.status) && (ticket.runsCompleted > 0 || ticket.status === 'running');
    await mutateGuildState(interaction.guildId, async (fresh) => {
      const current = fresh.carryTickets?.[ticketId];
      await removeMemberFromParty(interaction.guild, current, userId, { early });
      await syncParty(interaction.guild, fresh, current);
    });
    return interaction.update({ content: `🚪 Removed <@${userId}> from the session${early ? ' and recorded an early departure' : ''}.`, embeds: [], components: [], allowedMentions: { parse: [] } });
  }
  return false;
}

async function submitSessionPlan(interaction, ticketId) {
  const initial = await readGuildState(interaction.guildId);
  const ticket = normalize(initial.carryTickets?.[ticketId]);
  if (!ticket || !ACTIVE.has(ticket.status)) return interaction.reply(eph('That carry session is no longer active.'));
  if (!carrierOrStaff(interaction.member, initial)) return interaction.reply(eph('Only Knights or staff can configure sessions.'));
  if (ticket.status !== 'open' && !assignedCarrierOrStaff(interaction.member, initial, ticket, interaction.user.id)) return interaction.reply(eph('That session is assigned to another Knight.'));

  const runValue = interaction.fields.getStringSelectValues('kc3:party:session-runs')[0];
  const capValue = Number(interaction.fields.getStringSelectValues('kc3:party:session-cap')[0]);
  const requirement = interaction.fields.getTextInputValue('kc3:party:session-req').trim();
  let result = null;
  await mutateGuildState(interaction.guildId, async (state) => {
    const current = normalize(state.carryTickets?.[ticketId]);
    if (!current) return;
    if (current.status === 'open') {
      current.status = 'claimed';
      current.carrierId = interaction.user.id;
      current.claimedAt = new Date().toISOString();
    } else if (!staffOnly(interaction.member, state) && current.carrierId !== interaction.user.id) return;
    current.runTarget = runValue === 'infinite' ? null : Math.max(current.runsCompleted + 1, Number(runValue) || 1);
    current.maxMembers = Math.max(membersOf(current).length, Math.min(20, Math.max(2, capValue || 8)));
    current.requirement = requirement;
    current.sessionConfigured = true;
    current.configuredAt = new Date().toISOString();
    result = current;
    await syncParty(interaction.guild, state, current);
  });
  if (!result) return interaction.reply(eph('The session changed before the plan could be saved.'));
  return interaction.reply(eph(`🛡️ **${result.id}** claimed. Run plan: **${result.runsCompleted}/${runTargetText(result)}**, capacity **${result.maxMembers}**${result.requirement ? `, requirement: **${result.requirement}**` : ''}.`));
}

async function submitExtension(interaction, ticketId) {
  const initial = await readGuildState(interaction.guildId);
  const ticket = normalize(initial.carryTickets?.[ticketId]);
  if (!ticket || !ACTIVE.has(ticket.status)) return interaction.reply(eph('That carry session is no longer active.'));
  if (!assignedCarrierOrStaff(interaction.member, initial, ticket, interaction.user.id)) return interaction.reply(eph('Only the assigned Knight or staff can extend this session.'));
  const value = interaction.fields.getStringSelectValues('kc3:party:extend-runs')[0];
  const note = interaction.fields.getTextInputValue('kc3:party:extend-note').trim();
  let result = null;
  await mutateGuildState(interaction.guildId, async (state) => {
    const current = normalize(state.carryTickets?.[ticketId]);
    if (!current) return;
    if (value === 'infinite') current.runTarget = null;
    else if (current.runTarget !== null) current.runTarget += Math.max(1, Number(value) || 1);
    current.extensions += 1;
    current.lastExtensionAt = new Date().toISOString();
    if (note) current.lastExtensionNote = note;
    if (current.status === 'closing') current.status = 'between';
    result = current;
    await syncParty(interaction.guild, state, current);
  });
  return interaction.reply(eph(result ? `➕ Session extended. New progress target: **${result.runsCompleted}/${runTargetText(result)}**.` : 'Could not extend that session.'));
}

async function submitDispute(interaction, ticketId) {
  const initial = await readGuildState(interaction.guildId);
  const ticket = normalize(initial.carryTickets?.[ticketId]);
  if (!ticket || ticket.status !== 'completed') return interaction.reply(eph('That completed carry session could not be found.'));
  const involved = (ticket.participantHistory ?? []).includes(interaction.user.id) || ticket.carrierId === interaction.user.id || staffOnly(interaction.member, initial);
  if (!involved) return interaction.reply(eph('Only people involved in that session or staff can dispute it.'));
  const reason = interaction.fields.getStringSelectValues('kc3:party:dispute-reason')[0];
  const details = interaction.fields.getTextInputValue('kc3:party:dispute-details').trim();
  const dispute = {
    id: `KD-${Date.now().toString(36).toUpperCase()}`,
    ticketId,
    openedBy: interaction.user.id,
    reason,
    details,
    status: 'open',
    createdAt: new Date().toISOString()
  };
  await mutateGuildState(interaction.guildId, async (state) => {
    state.carryDisputes ??= [];
    state.carryDisputes.push(dispute);
    if (state.carryDisputes.length > 1000) state.carryDisputes = state.carryDisputes.slice(-1000);
  });
  const fresh = await readGuildState(interaction.guildId);
  const destinationId = fresh.setup?.channels?.ticketOverview ?? fresh.setup?.channels?.staffCases ?? fresh.setup?.channels?.reports;
  const destination = interaction.guild.channels.cache.get(destinationId);
  if (destination?.isTextBased()) await destination.send({
    embeds: [branded(`⚖️ Carry Dispute • ${dispute.id}`, 0xed4245)
      .setDescription(`Session \`${ticketId}\` requires staff review.`)
      .addFields(
        { name: 'Opened By', value: `<@${interaction.user.id}>`, inline: true },
        { name: 'Reason', value: `**${reason}**`, inline: true },
        { name: 'Carrier', value: ticket.carrierId ? `<@${ticket.carrierId}>` : 'Unknown', inline: true },
        { name: 'Details', value: details.slice(0, 1024) }
      )],
    allowedMentions: { parse: [] }
  }).catch(() => null);
  return interaction.reply(eph(`⚖️ Dispute **${dispute.id}** opened for session \`${ticketId}\`. Staff can review it from the support/case desk.`));
}

export async function handlePartyModal(interaction) {
  if (interaction.customId === 'kc3:party:submit') {
    await createOrMerge(interaction);
    return true;
  }
  if (interaction.customId.startsWith('kc3:party:session-submit:')) {
    await submitSessionPlan(interaction, interaction.customId.split(':').slice(4).join(':'));
    return true;
  }
  if (interaction.customId.startsWith('kc3:party:extend-submit:')) {
    await submitExtension(interaction, interaction.customId.split(':').slice(4).join(':'));
    return true;
  }
  if (interaction.customId.startsWith('kc3:party:dispute-submit:')) {
    await submitDispute(interaction, interaction.customId.split(':').slice(4).join(':'));
    return true;
  }
  return false;
}

export async function installCarryPartiesV3(guild) {
  await guild.channels.fetch();
  const state = await readGuildState(guild.id);
  state.carryTickets ??= {};
  for (const ticket of Object.values(state.carryTickets)) normalize(ticket);
  const merged = await mergeOpenDuplicates(guild, state);
  await refreshPartyPanels(guild, state);
  state.setup ??= {};
  state.setup.carryPartyVersion = 4;
  state.setup.carrySessionVersion = 1;
  await writeGuildState(guild.id, state);
  return { active: activeParties(state).length, merged, version: 4 };
}
