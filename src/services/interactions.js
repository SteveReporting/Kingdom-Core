import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';
import { BRAND, CARRIER_KEYS, HOUSE_KEYS, STAFF_KEYS } from '../config/blueprint.js';
import { mutateGuildState, readGuildState } from '../storage/store.js';
import { sendBrandedWebhook } from './webhooks.js';

const DUNGEONS = [
  ['Desert Temple', 'desert-temple'],
  ['Winter Outpost', 'winter-outpost'],
  ['Pirate Island', 'pirate-island'],
  ["King's Castle", 'kings-castle'],
  ['The Underworld', 'underworld'],
  ['Samurai Palace', 'samurai-palace'],
  ['The Canals', 'canals'],
  ['Ghastly Harbor', 'ghastly-harbor'],
  ['Steampunk Sewers', 'steampunk-sewers'],
  ['Orbital Outpost', 'orbital-outpost'],
  ['Volcanic Chambers', 'volcanic-chambers'],
  ['Aquatic Temple', 'aquatic-temple'],
  ['Enchanted Forest', 'enchanted-forest'],
  ['Northern Lands', 'northern-lands'],
  ['Gilded Skies', 'gilded-skies'],
  ['Yokai Peak', 'yokai-peak'],
  ['Current Highest Dungeon', 'current-highest'],
  ['Boss / Event Mode', 'boss-event']
].map(([label, value]) => ({ label, value }));

const DIFFICULTIES = [
  { label: 'Easy', value: 'Easy' },
  { label: 'Medium', value: 'Medium' },
  { label: 'Hard', value: 'Hard' },
  { label: 'Insane', value: 'Insane' },
  { label: 'Nightmare', value: 'Nightmare' },
  { label: 'Insane • Hardcore', value: 'Insane • Hardcore' },
  { label: 'Nightmare • Hardcore', value: 'Nightmare • Hardcore' },
  { label: 'Boss / Event', value: 'Boss / Event' }
];

const TICKET_TYPES = {
  support: { label: 'Support', emoji: '🛟', color: 0x5865f2 },
  report: { label: 'Member Report', emoji: '🚨', color: 0xed4245 },
  partnership: { label: 'Partnership', emoji: '🤝', color: 0x57f287 },
  appeal: { label: 'Appeal', emoji: '⚖️', color: 0xfee75c }
};

function hasAnyRole(member, roleIds = []) {
  return roleIds.some((id) => id && member?.roles?.cache?.has(id));
}

function hasStaff(member, state) {
  if (member?.permissions?.has?.(PermissionFlagsBits.Administrator)) return true;
  const roleIds = STAFF_KEYS.map((key) => state.setup?.roles?.[key]).filter(Boolean);
  return hasAnyRole(member, roleIds);
}

async function getState(interaction) {
  return readGuildState(interaction.guildId);
}

function carryDungeonRow() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('kc:carry:dungeon')
      .setPlaceholder('Choose your Dungeon Quest dungeon')
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(DUNGEONS)
  );
}

function carryDifficultyRow() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('kc:carry:difficulty')
      .setPlaceholder('Choose difficulty / hardcore mode')
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(DIFFICULTIES)
  );
}

function appReviewRow(id, interviewDisabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`kc:app:review:approve:${id}`).setLabel('Approve').setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`kc:app:review:interview:${id}`).setLabel('Interview').setEmoji('💬').setStyle(ButtonStyle.Primary).setDisabled(interviewDisabled),
    new ButtonBuilder().setCustomId(`kc:app:review:deny:${id}`).setLabel('Deny').setEmoji('✖️').setStyle(ButtonStyle.Danger)
  );
}

function ticketControlRow(id) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`kc:ticket:claim:${id}`).setLabel('Claim').setEmoji('🛡️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`kc:ticket:priority:${id}`).setLabel('Escalate').setEmoji('🚨').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`kc:ticket:close2:${id}`).setLabel('Close').setEmoji('🔒').setStyle(ButtonStyle.Secondary)
  );
}

async function refreshQueue(guild, state) {
  state.queue ??= [];
  const channelId = state.setup?.channels?.carryQueue;
  const channel = channelId ? guild.channels.cache.get(channelId) : null;
  if (!channel?.isTextBased()) return;

  const waiting = state.queue.filter((entry) => entry.status === 'waiting').slice(0, 20);
  const claimed = state.queue.filter((entry) => entry.status === 'claimed').length;
  const text = waiting.length
    ? waiting.map((entry, index) => `**${index + 1}.** <@${entry.userId}> — **${entry.dungeon}** • ${entry.difficulty}`).join('\n')
    : '_The Royal carry queue is currently empty._';

  const embed = new EmbedBuilder()
    .setColor(BRAND.color)
    .setTitle('⏳ Live Carry Queue')
    .setDescription(text)
    .addFields(
      { name: 'Waiting', value: String(waiting.length), inline: true },
      { name: 'In Progress', value: String(claimed), inline: true }
    )
    .setFooter({ text: BRAND.footer })
    .setTimestamp();

  let message = null;
  const messageId = state.setup?.panels?.liveQueue;
  if (messageId) message = await channel.messages.fetch(messageId).catch(() => null);
  if (message) {
    await message.edit({ embeds: [embed], allowedMentions: { parse: [] } });
  } else {
    const created = await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
    state.setup.panels ??= {};
    state.setup.panels.liveQueue = created.id;
  }
}

function applicationQuestions(type) {
  if (type === 'carrier') {
    return [
      ['roblox', 'Roblox username', 'Your Roblox username', TextInputStyle.Short, 60],
      ['timezone', 'Timezone', 'e.g. GMT / EST', TextInputStyle.Short, 50],
      ['availability', 'Availability', 'When are you normally able to carry?', TextInputStyle.Paragraph, 300],
      ['experience', 'Carrier / DQ experience', 'Your level, gear, dungeons and experience.', TextInputStyle.Paragraph, 500],
      ['why', 'Why should we accept you?', 'Keep it concise and specific.', TextInputStyle.Paragraph, 500]
    ];
  }
  if (type === 'creator') {
    return [
      ['platform', 'Main platform', 'YouTube / TikTok / Twitch / other', TextInputStyle.Short, 80],
      ['handle', 'Creator name / handle', 'Your public creator name', TextInputStyle.Short, 100],
      ['audience', 'Audience / reach', 'Approximate followers, views or community size', TextInputStyle.Short, 100],
      ['content', 'What content do you make?', 'Describe your Dungeon Quest / Roblox content.', TextInputStyle.Paragraph, 500],
      ['why', 'What collaboration do you want?', 'Events, promotion, videos, partnership, etc.', TextInputStyle.Paragraph, 500]
    ];
  }
  return [
    ['timezone', 'Timezone', 'e.g. GMT / EST', TextInputStyle.Short, 50],
    ['availability', 'Availability', 'Days/times you can realistically help.', TextInputStyle.Paragraph, 300],
    ['experience', 'Moderation / staff experience', 'Servers, roles and responsibilities.', TextInputStyle.Paragraph, 500],
    ['scenario', 'How would you handle conflict?', 'Give a short example of your approach.', TextInputStyle.Paragraph, 500],
    ['why', 'Why Kingdom Carries?', 'Why you want the role and what you bring.', TextInputStyle.Paragraph, 500]
  ];
}

function buildApplicationModal(type) {
  const labels = { staff: 'Royal Staff Application', carrier: 'Knight Application', creator: 'Creator Application' };
  const modal = new ModalBuilder().setCustomId(`kc:app:submit:${type}`).setTitle(labels[type] ?? 'Kingdom Application');
  const rows = applicationQuestions(type).map(([id, label, placeholder, style, maxLength]) =>
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId(id)
        .setLabel(label)
        .setPlaceholder(placeholder)
        .setStyle(style)
        .setMaxLength(maxLength)
        .setRequired(true)
    )
  );
  modal.addComponents(...rows);
  return modal;
}

function buildTicketModal(type) {
  const config = TICKET_TYPES[type] ?? TICKET_TYPES.support;
  const modal = new ModalBuilder().setCustomId(`kc:ticket:submit:${type}`).setTitle(`${config.emoji} ${config.label}`);
  const summary = new TextInputBuilder()
    .setCustomId('summary')
    .setLabel('Short summary')
    .setPlaceholder('What is this ticket about?')
    .setRequired(true)
    .setMaxLength(100)
    .setStyle(TextInputStyle.Short);
  const details = new TextInputBuilder()
    .setCustomId('details')
    .setLabel('Full details')
    .setPlaceholder('Give staff the information they need. Include names/evidence links where relevant.')
    .setRequired(true)
    .setMaxLength(1500)
    .setStyle(TextInputStyle.Paragraph);
  modal.addComponents(new ActionRowBuilder().addComponents(summary), new ActionRowBuilder().addComponents(details));
  return modal;
}

function ticketOverviewEmbed(ticket) {
  const config = TICKET_TYPES[ticket.type] ?? TICKET_TYPES.support;
  return new EmbedBuilder()
    .setColor(ticket.priority === 'high' ? 0xed4245 : config.color)
    .setTitle(`${config.emoji} ${config.label} • ${ticket.id}`)
    .setDescription(ticket.summary)
    .addFields(
      { name: 'Owner', value: `<@${ticket.userId}>`, inline: true },
      { name: 'Channel', value: ticket.channelId ? `<#${ticket.channelId}>` : 'Unavailable', inline: true },
      { name: 'Status', value: ticket.status ?? 'open', inline: true },
      { name: 'Claimed By', value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : 'Unclaimed', inline: true },
      { name: 'Priority', value: ticket.priority === 'high' ? '🚨 Escalated' : 'Normal', inline: true }
    )
    .setFooter({ text: BRAND.footer })
    .setTimestamp(new Date(ticket.updatedAt ?? ticket.createdAt));
}

async function syncTicketOverview(guild, state, ticket) {
  const overviewId = state.setup?.channels?.ticketOverview;
  const overview = overviewId ? guild.channels.cache.get(overviewId) : null;
  if (!overview?.isTextBased()) return;
  const payload = { embeds: [ticketOverviewEmbed(ticket)], allowedMentions: { parse: [] } };
  if (ticket.overviewMessageId) {
    const existing = await overview.messages.fetch(ticket.overviewMessageId).catch(() => null);
    if (existing) {
      await existing.edit(payload).catch(() => null);
      return;
    }
  }
  const message = await overview.send(payload);
  ticket.overviewMessageId = message.id;
}

async function postApplicationStatus(guild, state, application) {
  const channelId = state.setup?.channels?.applicationStatus;
  const channel = channelId ? guild.channels.cache.get(channelId) : null;
  if (!channel?.isTextBased()) return;
  const colors = { approved: 0x57f287, denied: 0xed4245, interview: 0x5865f2 };
  const embed = new EmbedBuilder()
    .setColor(colors[application.status] ?? BRAND.color)
    .setTitle(`📌 Application ${application.status.toUpperCase()}`)
    .setDescription(`**${application.type.toUpperCase()}** application • ID \`${application.id}\``)
    .addFields(
      { name: 'Applicant', value: `<@${application.userId}>`, inline: true },
      { name: 'Reviewed By', value: application.reviewerId ? `<@${application.reviewerId}>` : 'Pending', inline: true }
    )
    .setFooter({ text: BRAND.footer })
    .setTimestamp();
  await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => null);
}

async function handleApplicationReview(interaction, action, id) {
  let application = null;
  let alreadyClosed = false;
  const initial = await getState(interaction);
  if (!hasStaff(interaction.member, initial)) {
    await interaction.reply({ content: 'Only Kingdom staff can review applications.', flags: MessageFlags.Ephemeral });
    return;
  }

  await mutateGuildState(interaction.guildId, async (state) => {
    state.applications ??= {};
    const app = state.applications[id];
    if (!app) return;
    if (['approved', 'denied'].includes(app.status)) {
      alreadyClosed = true;
      application = app;
      return;
    }
    app.status = action === 'approve' ? 'approved' : action === 'deny' ? 'denied' : 'interview';
    app.reviewerId = interaction.user.id;
    app.reviewedAt = new Date().toISOString();
    application = app;
  });

  if (!application) {
    await interaction.reply({ content: 'That application could not be found.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (alreadyClosed) {
    await interaction.reply({ content: `That application is already **${application.status}**.`, flags: MessageFlags.Ephemeral });
    return;
  }

  if (application.status === 'approved') {
    const state = await getState(interaction);
    const roleKey = application.type === 'carrier' ? 'squireCarrier' : application.type === 'staff' ? 'watchman' : null;
    const roleId = roleKey ? state.setup?.roles?.[roleKey] : null;
    const member = await interaction.guild.members.fetch(application.userId).catch(() => null);
    if (member && roleId) await member.roles.add(roleId, `Kingdom Core application ${application.id} approved`).catch(() => null);
  }

  const colors = { approved: 0x57f287, denied: 0xed4245, interview: 0x5865f2 };
  const updated = EmbedBuilder.from(interaction.message.embeds[0])
    .setColor(colors[application.status] ?? BRAND.color)
    .addFields({ name: 'Review Decision', value: `**${application.status.toUpperCase()}** by <@${interaction.user.id}>` })
    .setTimestamp();
  await interaction.update({
    embeds: [updated],
    components: application.status === 'interview' ? [appReviewRow(id, true)] : [],
    allowedMentions: { parse: [] }
  });

  const state = await getState(interaction);
  await postApplicationStatus(interaction.guild, state, application);
  await sendBrandedWebhook(interaction.guild, state, 'registry', {
    embeds: [new EmbedBuilder()
      .setColor(colors[application.status] ?? BRAND.color)
      .setTitle('📝 Application Decision')
      .setDescription(`**${application.type.toUpperCase()}** application \`${application.id}\` → **${application.status.toUpperCase()}**`)
      .addFields(
        { name: 'Applicant', value: `<@${application.userId}>`, inline: true },
        { name: 'Reviewer', value: `<@${interaction.user.id}>`, inline: true }
      )
      .setFooter({ text: BRAND.footer })
      .setTimestamp()]
  });
}

export async function handleButton(interaction) {
  const state = await getState(interaction);
  const roleIds = state.setup?.roles ?? {};

  if (interaction.customId.startsWith('kc:house:')) {
    const key = interaction.customId.split(':')[2];
    if (!HOUSE_KEYS.includes(key) || !roleIds[key]) return;
    const member = interaction.member;
    const remove = HOUSE_KEYS.filter((houseKey) => houseKey !== key).map((houseKey) => roleIds[houseKey]).filter(Boolean);
    await member.roles.remove(remove).catch(() => null);
    await member.roles.add(roleIds[key]);
    const role = interaction.guild.roles.cache.get(roleIds[key]);
    await interaction.reply({ content: `🏰 You now represent **${role?.name ?? 'your House'}**.`, flags: MessageFlags.Ephemeral });
    return;
  }

  if (interaction.customId.startsWith('kc:role:')) {
    const key = interaction.customId.split(':')[2];
    const id = roleIds[key];
    if (!id) return;
    const member = interaction.member;
    const role = interaction.guild.roles.cache.get(id);
    if (member.roles.cache.has(id)) {
      await member.roles.remove(id);
      await interaction.reply({ content: `🔕 Removed **${role?.name ?? 'notification'}**.`, flags: MessageFlags.Ephemeral });
    } else {
      await member.roles.add(id);
      await interaction.reply({ content: `🔔 Enabled **${role?.name ?? 'notification'}**.`, flags: MessageFlags.Ephemeral });
    }
    return;
  }

  if (interaction.customId === 'kc:carry:join') {
    const active = (state.queue ?? []).some((entry) => entry.userId === interaction.user.id && ['waiting', 'claimed'].includes(entry.status));
    if (active) {
      await interaction.reply({ content: 'You already have an active carry request.', flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.reply({
      content: '⚔️ **Step 1/2 — Select your dungeon**',
      components: [carryDungeonRow()],
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (interaction.customId === 'kc:carry:leave') {
    let removed = false;
    await mutateGuildState(interaction.guildId, async (fresh) => {
      fresh.queue ??= [];
      for (const entry of fresh.queue) {
        if (entry.userId === interaction.user.id && entry.status === 'waiting') {
          entry.status = 'cancelled';
          entry.cancelledAt = new Date().toISOString();
          removed = true;
        }
      }
      fresh.pendingCarries ??= {};
      delete fresh.pendingCarries[interaction.user.id];
      await refreshQueue(interaction.guild, fresh);
    });
    await interaction.reply({ content: removed ? '✖️ Your carry request was removed.' : 'You do not have a waiting carry request.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (interaction.customId === 'kc:carry:claim') {
    const allowed = CARRIER_KEYS.map((key) => roleIds[key]);
    if (!hasAnyRole(interaction.member, allowed)) {
      await interaction.reply({ content: 'Only Kingdom carriers can claim carry requests.', flags: MessageFlags.Ephemeral });
      return;
    }

    let claimed = null;
    await mutateGuildState(interaction.guildId, async (fresh) => {
      fresh.queue ??= [];
      claimed = fresh.queue.find((entry) => entry.status === 'waiting') ?? null;
      if (claimed) {
        claimed.status = 'claimed';
        claimed.carrierId = interaction.user.id;
        claimed.claimedAt = new Date().toISOString();
      }
      await refreshQueue(interaction.guild, fresh);
    });

    if (!claimed) {
      await interaction.reply({ content: 'The carry queue is empty.', flags: MessageFlags.Ephemeral });
      return;
    }

    const assignmentsId = state.setup?.channels?.carrierAssignments;
    const assignments = assignmentsId ? interaction.guild.channels.cache.get(assignmentsId) : null;
    if (assignments?.isTextBased()) {
      await assignments.send({
        content: `⚔️ <@${interaction.user.id}> claimed <@${claimed.userId}> — **${claimed.dungeon}** • ${claimed.difficulty}`,
        allowedMentions: { users: [interaction.user.id, claimed.userId], roles: [] }
      });
    }
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`kc:carry:complete:${claimed.id}`).setLabel('Mark Complete').setEmoji('✅').setStyle(ButtonStyle.Success)
    );
    await interaction.reply({ content: `🛡️ You claimed <@${claimed.userId}> — **${claimed.dungeon}** • ${claimed.difficulty}`, components: [row], flags: MessageFlags.Ephemeral });
    return;
  }

  if (interaction.customId.startsWith('kc:carry:complete:')) {
    const id = interaction.customId.split(':')[3];
    const allowed = CARRIER_KEYS.map((key) => roleIds[key]);
    if (!hasAnyRole(interaction.member, allowed)) {
      await interaction.reply({ content: 'Only Kingdom carriers can complete a carry.', flags: MessageFlags.Ephemeral });
      return;
    }

    let completed = null;
    let wrongCarrier = false;
    await mutateGuildState(interaction.guildId, async (fresh) => {
      fresh.queue ??= [];
      const target = fresh.queue.find((entry) => entry.id === id && entry.status === 'claimed') ?? null;
      if (target && target.carrierId !== interaction.user.id && !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        wrongCarrier = true;
        return;
      }
      completed = target;
      if (completed) {
        completed.status = 'completed';
        completed.completedAt = new Date().toISOString();
        fresh.stats ??= {};
        fresh.stats.completedCarries = (fresh.stats.completedCarries ?? 0) + 1;
      }
      await refreshQueue(interaction.guild, fresh);
    });

    if (wrongCarrier) {
      await interaction.reply({ content: 'Only the carrier who claimed this run (or an administrator) can complete it.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (!completed) {
      await interaction.reply({ content: 'That carry is already closed or could not be found.', flags: MessageFlags.Ephemeral });
      return;
    }

    const results = state.setup?.channels?.carryResults ? interaction.guild.channels.cache.get(state.setup.channels.carryResults) : null;
    if (results?.isTextBased()) {
      await results.send({
        content: `✅ <@${completed.userId}> completed **${completed.dungeon}** • ${completed.difficulty} with <@${interaction.user.id}>.`,
        allowedMentions: { parse: [] }
      });
    }
    const webhookState = await getState(interaction);
    await sendBrandedWebhook(interaction.guild, webhookState, 'dispatch', {
      embeds: [new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle('⚔️ Carry Mission Complete')
        .setDescription(`**${completed.dungeon}** • ${completed.difficulty}`)
        .addFields(
          { name: 'Member', value: `<@${completed.userId}>`, inline: true },
          { name: 'Knight', value: `<@${interaction.user.id}>`, inline: true }
        )
        .setFooter({ text: BRAND.footer })
        .setTimestamp()]
    });
    await interaction.update({ content: `✅ Carry completed for <@${completed.userId}>.`, components: [] });
    return;
  }

  if (interaction.customId.startsWith('kc:app:start:')) {
    const type = interaction.customId.split(':')[3];
    if (!['staff', 'carrier', 'creator'].includes(type)) return;
    const duplicate = Object.values(state.applications ?? {}).some((app) => app.userId === interaction.user.id && app.type === type && ['pending', 'interview'].includes(app.status));
    if (duplicate) {
      await interaction.reply({ content: `You already have an active **${type}** application.`, flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.showModal(buildApplicationModal(type));
    return;
  }

  if (interaction.customId.startsWith('kc:app:review:')) {
    const [, , , action, id] = interaction.customId.split(':');
    await handleApplicationReview(interaction, action, id);
    return;
  }

  if (interaction.customId.startsWith('kc:ticket:new:')) {
    const type = interaction.customId.split(':')[3];
    if (!TICKET_TYPES[type]) return;
    await interaction.showModal(buildTicketModal(type));
    return;
  }

  if (interaction.customId === 'kc:ticket:open') {
    await interaction.showModal(buildTicketModal('support'));
    return;
  }

  if (interaction.customId.startsWith('kc:ticket:claim:')) {
    if (!hasStaff(interaction.member, state)) {
      await interaction.reply({ content: 'Only staff can claim a petition.', flags: MessageFlags.Ephemeral });
      return;
    }
    const id = interaction.customId.split(':')[3];
    let ticket = null;
    await mutateGuildState(interaction.guildId, async (fresh) => {
      fresh.tickets ??= {};
      ticket = fresh.tickets[id] ?? null;
      if (!ticket || ticket.status === 'closed') return;
      ticket.claimedBy ??= interaction.user.id;
      ticket.updatedAt = new Date().toISOString();
      await syncTicketOverview(interaction.guild, fresh, ticket);
    });
    if (!ticket) {
      await interaction.reply({ content: 'Ticket not found.', flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.reply({ content: `🛡️ Ticket claimed by <@${ticket.claimedBy}>.`, allowedMentions: { parse: [] } });
    return;
  }

  if (interaction.customId.startsWith('kc:ticket:priority:')) {
    if (!hasStaff(interaction.member, state)) {
      await interaction.reply({ content: 'Only staff can escalate a petition.', flags: MessageFlags.Ephemeral });
      return;
    }
    const id = interaction.customId.split(':')[3];
    let ticket = null;
    await mutateGuildState(interaction.guildId, async (fresh) => {
      fresh.tickets ??= {};
      ticket = fresh.tickets[id] ?? null;
      if (!ticket || ticket.status === 'closed') return;
      ticket.priority = 'high';
      ticket.updatedAt = new Date().toISOString();
      await syncTicketOverview(interaction.guild, fresh, ticket);
    });
    await interaction.reply({ content: ticket ? '🚨 Ticket escalated to high priority.' : 'Ticket not found.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (interaction.customId.startsWith('kc:ticket:close2:')) {
    const id = interaction.customId.split(':')[3];
    let ticket = null;
    let canClose = false;
    await mutateGuildState(interaction.guildId, async (fresh) => {
      fresh.tickets ??= {};
      ticket = fresh.tickets[id] ?? null;
      if (!ticket) return;
      canClose = interaction.user.id === ticket.userId || hasStaff(interaction.member, fresh);
      if (!canClose || ticket.status === 'closed') return;
      ticket.status = 'closed';
      ticket.closedBy = interaction.user.id;
      ticket.closedAt = new Date().toISOString();
      ticket.updatedAt = ticket.closedAt;
      await syncTicketOverview(interaction.guild, fresh, ticket);
    });

    if (!ticket) {
      await interaction.reply({ content: 'Ticket not found.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (!canClose) {
      await interaction.reply({ content: 'Only the ticket owner or Kingdom staff can close this petition.', flags: MessageFlags.Ephemeral });
      return;
    }

    const archiveId = state.setup?.channels?.ticketTranscripts;
    const archive = archiveId ? interaction.guild.channels.cache.get(archiveId) : null;
    if (archive?.isTextBased()) {
      const config = TICKET_TYPES[ticket.type] ?? TICKET_TYPES.support;
      const embed = new EmbedBuilder()
        .setColor(config.color)
        .setTitle(`🧾 Closed Ticket • ${ticket.id}`)
        .setDescription(ticket.summary)
        .addFields(
          { name: 'Owner', value: `<@${ticket.userId}>`, inline: true },
          { name: 'Closed By', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Type', value: config.label, inline: true },
          { name: 'Details', value: ticket.details.slice(0, 1024) }
        )
        .setFooter({ text: BRAND.footer })
        .setTimestamp();
      await archive.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => null);
    }

    await interaction.reply({ content: '🔒 Petition closed. This channel is now read-only.' });
    await interaction.channel?.permissionOverwrites?.edit(ticket.userId, { SendMessages: false, ReadMessageHistory: true }).catch(() => null);
    if (interaction.channel?.name && !interaction.channel.name.startsWith('closed-')) {
      await interaction.channel.setName(`closed-${interaction.channel.name}`.slice(0, 100)).catch(() => null);
    }
    return;
  }

  if (interaction.customId.startsWith('kc:ticket:close:')) {
    if (!interaction.channel || interaction.channel.type !== ChannelType.GuildText) return;
    const ownerId = interaction.customId.split(':')[3];
    const canClose = interaction.user.id === ownerId || hasStaff(interaction.member, state);
    if (!canClose) {
      await interaction.reply({ content: 'You cannot close this petition.', flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.reply({ content: '🔒 Petition closed. This channel is now read-only.' });
    await interaction.channel.permissionOverwrites.edit(ownerId, { SendMessages: false, ReadMessageHistory: true }).catch(() => null);
    if (!interaction.channel.name.startsWith('closed-')) await interaction.channel.setName(`closed-${interaction.channel.name}`.slice(0, 100)).catch(() => null);
  }
}

export async function handleSelect(interaction) {
  if (interaction.customId === 'kc:carry:dungeon') {
    const chosen = interaction.values[0];
    const dungeon = DUNGEONS.find((item) => item.value === chosen)?.label;
    if (!dungeon) return;
    await mutateGuildState(interaction.guildId, async (state) => {
      state.pendingCarries ??= {};
      state.pendingCarries[interaction.user.id] = { dungeon, createdAt: new Date().toISOString() };
    });
    await interaction.update({
      content: `⚔️ **Step 2/2 — ${dungeon}**\nNow select your difficulty / mode.`,
      components: [carryDifficultyRow()]
    });
    return;
  }

  if (interaction.customId === 'kc:carry:difficulty') {
    const difficulty = interaction.values[0];
    let dungeon = null;
    let existing = false;
    let position = 0;
    await mutateGuildState(interaction.guildId, async (state) => {
      state.queue ??= [];
      state.pendingCarries ??= {};
      dungeon = state.pendingCarries[interaction.user.id]?.dungeon ?? null;
      if (!dungeon) return;
      existing = state.queue.some((entry) => entry.userId === interaction.user.id && ['waiting', 'claimed'].includes(entry.status));
      if (!existing) {
        state.queue.push({
          id: `${Date.now()}-${interaction.user.id}`,
          userId: interaction.user.id,
          dungeon,
          difficulty,
          status: 'waiting',
          createdAt: new Date().toISOString()
        });
        position = state.queue.filter((entry) => entry.status === 'waiting').length;
      }
      delete state.pendingCarries[interaction.user.id];
      await refreshQueue(interaction.guild, state);
    });

    if (!dungeon) {
      await interaction.update({ content: 'That carry selection expired. Press **Request Carry** again.', components: [] });
      return;
    }
    await interaction.update({
      content: existing
        ? 'You already have an active carry request.'
        : `✅ Added to the Royal queue.\n**Dungeon:** ${dungeon}\n**Difficulty:** ${difficulty}\n**Queue position:** ${position}`,
      components: []
    });
  }
}

export async function handleModal(interaction) {
  if (interaction.customId.startsWith('kc:app:submit:')) {
    const type = interaction.customId.split(':')[3];
    if (!['staff', 'carrier', 'creator'].includes(type)) return;
    const answers = Object.fromEntries(applicationQuestions(type).map(([id, label]) => [label, interaction.fields.getTextInputValue(id).trim()]));
    let duplicate = false;
    let application = null;

    await mutateGuildState(interaction.guildId, async (state) => {
      state.applications ??= {};
      duplicate = Object.values(state.applications).some((app) => app.userId === interaction.user.id && app.type === type && ['pending', 'interview'].includes(app.status));
      if (duplicate) return;
      const id = `${Date.now().toString(36)}${interaction.user.id.slice(-4)}`;
      application = {
        id,
        type,
        userId: interaction.user.id,
        username: interaction.user.username,
        answers,
        status: 'pending',
        createdAt: new Date().toISOString()
      };
      state.applications[id] = application;
    });

    if (duplicate) {
      await interaction.reply({ content: `You already have an active **${type}** application.`, flags: MessageFlags.Ephemeral });
      return;
    }

    const state = await getState(interaction);
    const reviewId = state.setup?.channels?.applicationsReview;
    const review = reviewId ? interaction.guild.channels.cache.get(reviewId) : null;
    if (!review?.isTextBased()) {
      await interaction.reply({ content: 'The application review desk is unavailable. Ask an administrator to run `/setup2`.', flags: MessageFlags.Ephemeral });
      return;
    }

    const typeLabels = { staff: 'Royal Staff', carrier: 'Knight / Carrier', creator: 'Creator' };
    const embed = new EmbedBuilder()
      .setColor(BRAND.color)
      .setTitle(`📝 ${typeLabels[type]} Application • ${application.id}`)
      .setDescription(`Applicant: <@${interaction.user.id}> • \`${interaction.user.id}\``)
      .addFields(Object.entries(answers).map(([name, value]) => ({ name, value: value.slice(0, 1024) })))
      .addFields({ name: 'Status', value: '**PENDING REVIEW**' })
      .setFooter({ text: BRAND.footer })
      .setTimestamp();
    const message = await review.send({ embeds: [embed], components: [appReviewRow(application.id)], allowedMentions: { parse: [] } });

    await mutateGuildState(interaction.guildId, async (fresh) => {
      if (fresh.applications?.[application.id]) {
        fresh.applications[application.id].reviewMessageId = message.id;
        fresh.applications[application.id].reviewChannelId = review.id;
      }
    });

    await interaction.reply({ content: `✅ Your **${typeLabels[type]}** application was submitted. ID: \`${application.id}\``, flags: MessageFlags.Ephemeral });
    return;
  }

  if (interaction.customId.startsWith('kc:ticket:submit:')) {
    const type = interaction.customId.split(':')[3];
    const config = TICKET_TYPES[type] ?? TICKET_TYPES.support;
    const summary = interaction.fields.getTextInputValue('summary').trim();
    const details = interaction.fields.getTextInputValue('details').trim();
    const state = await getState(interaction);
    const openTicket = Object.values(state.tickets ?? {}).find((ticket) => ticket.userId === interaction.user.id && ticket.status === 'open');
    if (openTicket) {
      await interaction.reply({ content: `You already have an open petition: <#${openTicket.channelId}>`, flags: MessageFlags.Ephemeral });
      return;
    }

    const categoryId = state.setup?.categories?.tickets;
    const safeName = interaction.user.username.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 28) || interaction.user.id.slice(-8);
    const ticketId = `${Date.now().toString(36)}${interaction.user.id.slice(-4)}`;
    const overwrites = [
      { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
    ];

    const channel = await interaction.guild.channels.create({
      name: `${type}-${safeName}`.slice(0, 100),
      type: ChannelType.GuildText,
      parent: categoryId,
      topic: `Kingdom Core ticket ${ticketId} • ${type} • owner ${interaction.user.id}`,
      permissionOverwrites: overwrites,
      reason: `Kingdom Core ${config.label} ticket`
    });

    const ticket = {
      id: ticketId,
      type,
      userId: interaction.user.id,
      channelId: channel.id,
      summary,
      details,
      status: 'open',
      priority: 'normal',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const embed = new EmbedBuilder()
      .setColor(config.color)
      .setTitle(`${config.emoji} ${config.label} • ${ticketId}`)
      .setDescription([
        `**${summary}**`,
        '',
        details,
        '',
        '━━━━━━━━━━━━━━━━━━━━',
        'A staff member can **claim** this ticket. Use **Escalate** only when genuinely urgent.'
      ].join('\n'))
      .addFields({ name: 'Petitioner', value: `<@${interaction.user.id}>`, inline: true })
      .setFooter({ text: BRAND.footer })
      .setTimestamp();
    const header = await channel.send({
      content: `<@${interaction.user.id}>`,
      embeds: [embed],
      components: [ticketControlRow(ticketId)],
      allowedMentions: { users: [interaction.user.id], roles: [] }
    });
    ticket.headerMessageId = header.id;

    await mutateGuildState(interaction.guildId, async (fresh) => {
      fresh.tickets ??= {};
      fresh.tickets[ticketId] = ticket;
      await syncTicketOverview(interaction.guild, fresh, ticket);
    });

    await interaction.reply({ content: `🎫 Your private ${config.label.toLowerCase()} ticket is open: <#${channel.id}>`, flags: MessageFlags.Ephemeral });
    return;
  }

  if (interaction.customId === 'kc:carry:joinModal') {
    await interaction.reply({ content: 'The carry system has been upgraded. Use **Request Carry** on the current carry panel to select a dungeon and difficulty.', flags: MessageFlags.Ephemeral });
  }
}
