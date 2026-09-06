import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';
import { BRAND, CARRIER_KEYS, HOUSE_KEYS, STAFF_KEYS } from '../config/blueprint.js';
import { mutateGuildState, readGuildState } from '../storage/store.js';

function hasAnyRole(member, roleIds = []) {
  return roleIds.some((id) => id && member.roles.cache.has(id));
}

async function getState(interaction) {
  return readGuildState(interaction.guildId);
}

async function refreshQueue(guild, state) {
  const channelId = state.setup?.channels?.carryQueue;
  const channel = channelId ? guild.channels.cache.get(channelId) : null;
  if (!channel?.isTextBased()) return;

  const waiting = state.queue.filter((entry) => entry.status === 'waiting').slice(0, 20);
  const text = waiting.length
    ? waiting.map((entry, index) => `**${index + 1}.** <@${entry.userId}> — **${entry.dungeon}** • ${entry.difficulty}${entry.notes ? `\n↳ ${entry.notes}` : ''}`).join('\n')
    : '_The carry queue is currently empty._';

  const embed = new EmbedBuilder()
    .setColor(BRAND.color)
    .setTitle('⏳ Live Carry Queue')
    .setDescription(text)
    .setFooter({ text: `${waiting.length} waiting • ${BRAND.footer}` })
    .setTimestamp();

  let message = null;
  const messageId = state.setup?.panels?.liveQueue;
  if (messageId) {
    message = await channel.messages.fetch(messageId).catch(() => null);
  }
  if (message) {
    await message.edit({ embeds: [embed] });
  } else {
    const created = await channel.send({ embeds: [embed] });
    state.setup.panels ??= {};
    state.setup.panels.liveQueue = created.id;
  }
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
    const modal = new ModalBuilder().setCustomId('kc:carry:joinModal').setTitle('Join the Royal Carry Queue');
    const dungeon = new TextInputBuilder().setCustomId('dungeon').setLabel('Dungeon / mode').setPlaceholder('e.g. Volcanic Chambers').setRequired(true).setMaxLength(80).setStyle(TextInputStyle.Short);
    const difficulty = new TextInputBuilder().setCustomId('difficulty').setLabel('Difficulty').setPlaceholder('e.g. Nightmare / Hardcore').setRequired(true).setMaxLength(80).setStyle(TextInputStyle.Short);
    const notes = new TextInputBuilder().setCustomId('notes').setLabel('Optional notes').setPlaceholder('Anything the carrier should know?').setRequired(false).setMaxLength(300).setStyle(TextInputStyle.Paragraph);
    modal.addComponents(new ActionRowBuilder().addComponents(dungeon), new ActionRowBuilder().addComponents(difficulty), new ActionRowBuilder().addComponents(notes));
    await interaction.showModal(modal);
    return;
  }

  if (interaction.customId === 'kc:carry:leave') {
    let removed = false;
    await mutateGuildState(interaction.guildId, async (fresh) => {
      for (const entry of fresh.queue) {
        if (entry.userId === interaction.user.id && entry.status === 'waiting') {
          entry.status = 'cancelled';
          entry.cancelledAt = new Date().toISOString();
          removed = true;
        }
      }
      await refreshQueue(interaction.guild, fresh);
    });
    await interaction.reply({ content: removed ? '✖️ Your carry request was removed.' : 'You do not have an active carry request.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (interaction.customId === 'kc:carry:claim') {
    const allowed = CARRIER_KEYS.map((key) => roleIds[key]);
    if (!hasAnyRole(interaction.member, allowed)) {
      await interaction.reply({ content: 'Only verified/trial Kingdom carriers can claim carry requests.', flags: MessageFlags.Ephemeral });
      return;
    }

    let claimed = null;
    await mutateGuildState(interaction.guildId, async (fresh) => {
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
      await assignments.send(`⚔️ <@${interaction.user.id}> claimed <@${claimed.userId}> — **${claimed.dungeon}** • ${claimed.difficulty}`);
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
      await interaction.reply({ content: 'Only the carrier who claimed this run (or a server administrator) can complete it.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (!completed) {
      await interaction.reply({ content: 'That carry is already closed or could not be found.', flags: MessageFlags.Ephemeral });
      return;
    }

    const results = state.setup?.channels?.carryResults ? interaction.guild.channels.cache.get(state.setup.channels.carryResults) : null;
    if (results?.isTextBased()) {
      await results.send(`✅ <@${completed.userId}> was carried through **${completed.dungeon}** • ${completed.difficulty} by <@${interaction.user.id}>.`);
    }
    await interaction.update({ content: `✅ Carry completed for <@${completed.userId}>.`, components: [] });
    return;
  }

  if (interaction.customId === 'kc:ticket:open') {
    const modal = new ModalBuilder().setCustomId('kc:ticket:openModal').setTitle('Petition the Crown');
    const subject = new TextInputBuilder().setCustomId('subject').setLabel('What do you need help with?').setPlaceholder('Carry / Trade / Report / Staff / Partnership / Other').setRequired(true).setMaxLength(100).setStyle(TextInputStyle.Short);
    const details = new TextInputBuilder().setCustomId('details').setLabel('Details').setPlaceholder('Explain what happened or what you need.').setRequired(true).setMaxLength(1000).setStyle(TextInputStyle.Paragraph);
    modal.addComponents(new ActionRowBuilder().addComponents(subject), new ActionRowBuilder().addComponents(details));
    await interaction.showModal(modal);
    return;
  }

  if (interaction.customId.startsWith('kc:ticket:close:')) {
    if (!interaction.channel || interaction.channel.type !== ChannelType.GuildText) return;
    const ownerId = interaction.customId.split(':')[3];
    const staffIds = STAFF_KEYS.map((key) => roleIds[key]);
    const canClose = interaction.user.id === ownerId || hasAnyRole(interaction.member, staffIds) || interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
    if (!canClose) {
      await interaction.reply({ content: 'You cannot close this petition.', flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.reply({ content: '🔒 Petition closed. This channel is now read-only.' });
    await interaction.channel.permissionOverwrites.edit(ownerId, { SendMessages: false }).catch(() => null);
    if (!interaction.channel.name.startsWith('closed-')) {
      await interaction.channel.setName(`closed-${interaction.channel.name}`.slice(0, 100)).catch(() => null);
    }
  }
}

export async function handleModal(interaction) {
  if (interaction.customId === 'kc:carry:joinModal') {
    const dungeon = interaction.fields.getTextInputValue('dungeon').trim();
    const difficulty = interaction.fields.getTextInputValue('difficulty').trim();
    const notes = interaction.fields.getTextInputValue('notes').trim();
    let existing = false;
    await mutateGuildState(interaction.guildId, async (state) => {
      existing = state.queue.some((entry) => entry.userId === interaction.user.id && ['waiting', 'claimed'].includes(entry.status));
      if (!existing) {
        state.queue.push({
          id: `${Date.now()}-${interaction.user.id}`,
          userId: interaction.user.id,
          dungeon,
          difficulty,
          notes,
          status: 'waiting',
          createdAt: new Date().toISOString()
        });
      }
      await refreshQueue(interaction.guild, state);
    });
    await interaction.reply({
      content: existing ? 'You already have an active carry request.' : `⚔️ Added to the queue for **${dungeon}** • ${difficulty}.`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (interaction.customId === 'kc:ticket:openModal') {
    const state = await getState(interaction);
    const subject = interaction.fields.getTextInputValue('subject').trim();
    const details = interaction.fields.getTextInputValue('details').trim();
    const categoryId = state.setup?.categories?.support;
    const roleIds = state.setup?.roles ?? {};
    const safeName = interaction.user.username.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40) || interaction.user.id;

    const existing = interaction.guild.channels.cache.find((channel) => channel.name.endsWith(safeName) && channel.topic === `Kingdom petition by ${interaction.user.id}` && !channel.name.startsWith('closed-'));
    if (existing) {
      await interaction.reply({ content: `You already have an open petition: <#${existing.id}>`, flags: MessageFlags.Ephemeral });
      return;
    }

    const overwrites = [
      { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
    ];
    for (const key of STAFF_KEYS) {
      if (roleIds[key]) overwrites.push({ id: roleIds[key], allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
    }

    const channel = await interaction.guild.channels.create({
      name: `petition-${safeName}`.slice(0, 100),
      type: ChannelType.GuildText,
      parent: categoryId,
      topic: `Kingdom petition by ${interaction.user.id}`,
      permissionOverwrites: overwrites,
      reason: 'Kingdom Core petition'
    });

    const closeRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`kc:ticket:close:${interaction.user.id}`).setLabel('Close Petition').setEmoji('🔒').setStyle(ButtonStyle.Secondary)
    );
    const embed = new EmbedBuilder()
      .setColor(BRAND.color)
      .setTitle(`📜 ${subject}`)
      .setDescription(details)
      .addFields({ name: 'Petitioner', value: `<@${interaction.user.id}>`, inline: true })
      .setTimestamp()
      .setFooter({ text: BRAND.footer });
    await channel.send({ content: `<@${interaction.user.id}>`, embeds: [embed], components: [closeRow] });
    await interaction.reply({ content: `📜 Your private petition is open: <#${channel.id}>`, flags: MessageFlags.Ephemeral });
  }
}
