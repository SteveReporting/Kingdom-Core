import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  StringSelectMenuBuilder
} from 'discord.js';
import { BRAND, CARRIER_KEYS, STAFF_KEYS } from '../config/blueprint.js';
import { mutateGuildState, readGuildState } from '../storage/store.js';
import { sendBrandedWebhook } from './webhooks.js';

const DUNGEONS = [
  'Desert Temple', 'Winter Outpost', 'Pirate Island', "King's Castle", 'The Underworld',
  'Samurai Palace', 'The Canals', 'Ghastly Harbor', 'Steampunk Sewers', 'Orbital Outpost',
  'Volcanic Chambers', 'Aquatic Temple', 'Enchanted Forest', 'Northern Lands', 'Gilded Skies',
  'Yokai Peak', 'Current Highest Dungeon', 'Boss / Event Mode'
];

const DIFFICULTIES = [
  'Easy', 'Medium', 'Hard', 'Insane', 'Nightmare',
  'Insane • Hardcore', 'Nightmare • Hardcore', 'Boss / Event'
];

const eph = (content) => ({ content, flags: MessageFlags.Ephemeral });
const anyRole = (member, ids) => ids.some((id) => id && member?.roles?.cache?.has(id));

function carrierOrStaff(member, state) {
  if (member?.permissions?.has?.(PermissionFlagsBits.Administrator)) return true;
  const roleIds = state.setup?.roles ?? {};
  const allowed = [...CARRIER_KEYS, ...STAFF_KEYS].map((key) => roleIds[key]).filter(Boolean);
  return anyRole(member, allowed);
}

function isStaff(member, state) {
  if (member?.permissions?.has?.(PermissionFlagsBits.Administrator)) return true;
  const roleIds = state.setup?.roles ?? {};
  return anyRole(member, STAFF_KEYS.map((key) => roleIds[key]).filter(Boolean));
}

function branded(title, color = BRAND.color) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setFooter({ text: BRAND.footer })
    .setTimestamp();
}

function selectRow(id, placeholder, options) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(id)
      .setPlaceholder(placeholder)
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(options.map((label, index) => ({ label, value: String(index) })))
  );
}

function queueControls(waiting, active) {
  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('kc:carry:join').setLabel('Request Carry').setEmoji('⚔️').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('kc:carry:leave').setLabel('Leave Queue').setEmoji('✖️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('kc:carry:claim').setLabel('Claim Next').setEmoji('🛡️').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('kc:qv2:refresh').setLabel('Refresh').setEmoji('🔄').setStyle(ButtonStyle.Secondary)
    )
  ];

  const manageable = [...waiting, ...active].slice(0, 25);
  if (manageable.length) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('kc:qv2:manage')
        .setPlaceholder('🛡️ Carrier controls • select a request')
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(manageable.map((entry, index) => ({
          label: `${entry.status === 'claimed' ? 'In Progress' : `#${index + 1}`} • ${entry.dungeon}`.slice(0, 100),
          description: `${entry.difficulty} • member …${entry.userId.slice(-6)}`.slice(0, 100),
          value: entry.id,
          emoji: entry.status === 'claimed' ? '⚔️' : '⏳'
        })))
    ));
  }

  return rows;
}

export async function refreshLiveQueue(guild, state) {
  state.queue ??= [];
  const channel = guild.channels.cache.get(state.setup?.channels?.carryQueue);
  if (!channel?.isTextBased()) return false;

  const waitingAll = state.queue.filter((entry) => entry.status === 'waiting');
  const activeAll = state.queue.filter((entry) => entry.status === 'claimed');
  const waiting = waitingAll.slice(0, 20);
  const active = activeAll.slice(0, 10);

  const waitingText = waiting.length
    ? waiting.map((entry, index) =>
      `**${index + 1}.** <@${entry.userId}>\n└ **${entry.dungeon}** • ${entry.difficulty}`
    ).join('\n')
    : '_No members are currently waiting._';

  const activeText = active.length
    ? active.map((entry) =>
      `⚔️ <@${entry.userId}> • **${entry.dungeon}** • ${entry.difficulty}\n└ Knight: ${entry.carrierId ? `<@${entry.carrierId}>` : 'Assigning…'}`
    ).join('\n')
    : '_No carries are currently in progress._';

  const embed = branded('⚔️ Kingdom Carries • Live Queue')
    .setDescription([
      '**Live mission control for free Dungeon Quest carries.**',
      'Members can request or leave a carry below. Knights can claim and manage requests directly from this panel.',
      '',
      '━━━━━━━━━━━━━━━━━━━━',
      '**⏳ WAITING FOR A KNIGHT**',
      waitingText,
      '',
      '**🛡️ IN PROGRESS**',
      activeText
    ].join('\n'))
    .addFields(
      { name: 'Queue', value: waitingAll.length ? `🟢 **${waitingAll.length} waiting**` : '⚪ **Empty**', inline: true },
      { name: 'Active Missions', value: `⚔️ **${activeAll.length}**`, inline: true },
      { name: 'Completed', value: `🏆 **${state.stats?.completedCarries ?? 0}**`, inline: true }
    );

  state.setup ??= {};
  state.setup.panels ??= {};
  let message = state.setup.panels.liveQueue
    ? await channel.messages.fetch(state.setup.panels.liveQueue).catch(() => null)
    : null;

  const payload = {
    embeds: [embed],
    components: queueControls(waitingAll.slice(0, 20), activeAll.slice(0, 10)),
    allowedMentions: { parse: [] }
  };

  if (message) {
    await message.edit(payload);
  } else {
    message = await channel.send(payload);
    state.setup.panels.liveQueue = message.id;
  }
  return true;
}

async function notifyClaim(guild, state, entry, carrierId) {
  const assignments = guild.channels.cache.get(state.setup?.channels?.carrierAssignments);
  if (assignments?.isTextBased()) {
    await assignments.send({
      embeds: [branded('🛡️ Carry Mission Claimed', 0x5865f2)
        .setDescription(`**${entry.dungeon}** • ${entry.difficulty}`)
        .addFields(
          { name: 'Member', value: `<@${entry.userId}>`, inline: true },
          { name: 'Knight', value: `<@${carrierId}>`, inline: true }
        )],
      allowedMentions: { parse: [] }
    }).catch(() => null);
  }

  await sendBrandedWebhook(guild, state, 'dispatch', {
    embeds: [branded('⚔️ Knight Dispatch', 0x5865f2)
      .setDescription(`A carry mission has been claimed.`)
      .addFields(
        { name: 'Dungeon', value: entry.dungeon, inline: true },
        { name: 'Difficulty', value: entry.difficulty, inline: true },
        { name: 'Member', value: `<@${entry.userId}>`, inline: true },
        { name: 'Knight', value: `<@${carrierId}>`, inline: true }
      )]
  }).catch(() => null);
}

async function claimEntry(interaction, requestedId = null) {
  const initial = await readGuildState(interaction.guildId);
  if (!carrierOrStaff(interaction.member, initial)) {
    await interaction.reply(eph('Only Kingdom carriers or staff can claim carry requests.'));
    return;
  }

  let claimed = null;
  await mutateGuildState(interaction.guildId, async (state) => {
    state.queue ??= [];
    claimed = requestedId
      ? state.queue.find((entry) => entry.id === requestedId && entry.status === 'waiting') ?? null
      : state.queue.find((entry) => entry.status === 'waiting') ?? null;
    if (!claimed) return;
    claimed.status = 'claimed';
    claimed.carrierId = interaction.user.id;
    claimed.claimedAt = new Date().toISOString();
    await refreshLiveQueue(interaction.guild, state);
  });

  if (!claimed) {
    await interaction.reply(eph('That request is no longer waiting, or the queue is empty.'));
    return;
  }

  const fresh = await readGuildState(interaction.guildId);
  await notifyClaim(interaction.guild, fresh, claimed, interaction.user.id);
  await interaction.reply({
    embeds: [branded('🛡️ Mission Claimed', 0x57f287)
      .setDescription(`You are now carrying <@${claimed.userId}>.`)
      .addFields(
        { name: 'Dungeon', value: claimed.dungeon, inline: true },
        { name: 'Difficulty', value: claimed.difficulty, inline: true }
      )],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`kc:carry:complete:${claimed.id}`).setLabel('Complete Carry').setEmoji('✅').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`kc:qv2:release:${claimed.id}`).setLabel('Return to Queue').setEmoji('↩️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`kc:qv2:remove:${claimed.id}`).setLabel('Remove Request').setEmoji('🗑️').setStyle(ButtonStyle.Danger)
    )],
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] }
  });
}

async function removeEntry(interaction, id) {
  const initial = await readGuildState(interaction.guildId);
  if (!carrierOrStaff(interaction.member, initial)) return interaction.reply(eph('Only carriers or staff can remove queue requests.'));

  let removed = null;
  let denied = false;
  await mutateGuildState(interaction.guildId, async (state) => {
    state.queue ??= [];
    const entry = state.queue.find((item) => item.id === id && ['waiting', 'claimed'].includes(item.status));
    if (!entry) return;
    if (entry.status === 'claimed' && entry.carrierId !== interaction.user.id && !isStaff(interaction.member, state)) {
      denied = true;
      return;
    }
    entry.status = 'removed';
    entry.removedBy = interaction.user.id;
    entry.removedAt = new Date().toISOString();
    removed = entry;
    await refreshLiveQueue(interaction.guild, state);
  });

  if (denied) return interaction.reply(eph('Only the assigned carrier or staff can remove an in-progress carry.'));
  if (!removed) return interaction.reply(eph('That request is already closed or no longer exists.'));
  return interaction.reply(eph(`🗑️ Removed <@${removed.userId}> from the carry queue.`));
}

async function releaseEntry(interaction, id) {
  const initial = await readGuildState(interaction.guildId);
  if (!carrierOrStaff(interaction.member, initial)) return interaction.reply(eph('Only carriers or staff can return a mission to the queue.'));

  let released = null;
  let denied = false;
  await mutateGuildState(interaction.guildId, async (state) => {
    state.queue ??= [];
    const entry = state.queue.find((item) => item.id === id && item.status === 'claimed');
    if (!entry) return;
    if (entry.carrierId !== interaction.user.id && !isStaff(interaction.member, state)) {
      denied = true;
      return;
    }
    entry.status = 'waiting';
    entry.carrierId = null;
    entry.claimedAt = null;
    entry.releasedAt = new Date().toISOString();
    released = entry;
    await refreshLiveQueue(interaction.guild, state);
  });

  if (denied) return interaction.reply(eph('Only the assigned carrier or staff can return that mission.'));
  if (!released) return interaction.reply(eph('That mission is no longer in progress.'));
  return interaction.reply(eph(`↩️ <@${released.userId}> was returned to the waiting queue.`));
}

async function completeEntry(interaction, id) {
  const initial = await readGuildState(interaction.guildId);
  if (!carrierOrStaff(interaction.member, initial)) return interaction.reply(eph('Only carriers or staff can complete carry missions.'));

  let completed = null;
  let denied = false;
  await mutateGuildState(interaction.guildId, async (state) => {
    state.queue ??= [];
    const entry = state.queue.find((item) => item.id === id && item.status === 'claimed');
    if (!entry) return;
    if (entry.carrierId !== interaction.user.id && !isStaff(interaction.member, state)) {
      denied = true;
      return;
    }
    entry.status = 'completed';
    entry.completedAt = new Date().toISOString();
    entry.completedBy = interaction.user.id;
    state.stats ??= {};
    state.stats.completedCarries = (state.stats.completedCarries ?? 0) + 1;
    completed = entry;
    await refreshLiveQueue(interaction.guild, state);
  });

  if (denied) return interaction.reply(eph('Only the assigned carrier or staff can complete that mission.'));
  if (!completed) return interaction.reply(eph('That mission is already closed or could not be found.'));

  const fresh = await readGuildState(interaction.guildId);
  const results = interaction.guild.channels.cache.get(fresh.setup?.channels?.carryResults);
  if (results?.isTextBased()) {
    await results.send({
      embeds: [branded('✅ Carry Completed', 0x57f287)
        .setDescription(`**${completed.dungeon}** • ${completed.difficulty}`)
        .addFields(
          { name: 'Member', value: `<@${completed.userId}>`, inline: true },
          { name: 'Knight', value: `<@${interaction.user.id}>`, inline: true }
        )],
      allowedMentions: { parse: [] }
    }).catch(() => null);
  }

  await sendBrandedWebhook(interaction.guild, fresh, 'dispatch', {
    embeds: [branded('🏆 Mission Complete', 0x57f287)
      .setDescription(`**${completed.dungeon}** • ${completed.difficulty}`)
      .addFields(
        { name: 'Member', value: `<@${completed.userId}>`, inline: true },
        { name: 'Knight', value: `<@${interaction.user.id}>`, inline: true }
      )]
  }).catch(() => null);

  if (interaction.isButton() && interaction.message?.flags !== undefined) {
    return interaction.reply(eph(`✅ Carry completed for <@${completed.userId}>.`));
  }
}

export async function handleQueueButton(interaction) {
  const id = interaction.customId;
  const state = await readGuildState(interaction.guildId);

  if (id === 'kc:carry:join') {
    if ((state.queue ?? []).some((entry) => entry.userId === interaction.user.id && ['waiting', 'claimed'].includes(entry.status))) {
      return interaction.reply(eph('You already have an active carry request.'));
    }
    return interaction.reply({
      embeds: [branded('⚔️ Request a Carry').setDescription('**Step 1 of 2** — choose the Dungeon Quest dungeon you need.')],
      components: [selectRow('kc:carry:dungeon', 'Choose your dungeon', DUNGEONS)],
      flags: MessageFlags.Ephemeral
    });
  }

  if (id === 'kc:carry:leave') {
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
      await refreshLiveQueue(interaction.guild, fresh);
    });
    return interaction.reply(eph(removed ? '✖️ Your carry request was removed.' : 'You do not have a waiting carry request.'));
  }

  if (id === 'kc:carry:claim') return claimEntry(interaction);
  if (id === 'kc:qv2:refresh') {
    await mutateGuildState(interaction.guildId, async (fresh) => refreshLiveQueue(interaction.guild, fresh));
    return interaction.reply(eph('🔄 Live queue refreshed.'));
  }
  if (id.startsWith('kc:qv2:claim:')) return claimEntry(interaction, id.split(':')[3]);
  if (id.startsWith('kc:qv2:remove:')) return removeEntry(interaction, id.split(':')[3]);
  if (id.startsWith('kc:qv2:release:')) return releaseEntry(interaction, id.split(':')[3]);
  if (id.startsWith('kc:carry:complete:')) return completeEntry(interaction, id.split(':')[3]);
}

export async function handleQueueSelect(interaction) {
  const id = interaction.customId;

  if (id === 'kc:carry:dungeon') {
    const dungeon = DUNGEONS[Number(interaction.values[0])];
    if (!dungeon) return;
    await mutateGuildState(interaction.guildId, async (state) => {
      state.pendingCarries ??= {};
      state.pendingCarries[interaction.user.id] = { dungeon, createdAt: new Date().toISOString() };
    });
    return interaction.update({
      embeds: [branded('⚔️ Request a Carry').setDescription(`**Step 2 of 2** — **${dungeon}**\nChoose your difficulty / mode.`)],
      components: [selectRow('kc:carry:difficulty', 'Choose difficulty / hardcore mode', DIFFICULTIES)]
    });
  }

  if (id === 'kc:carry:difficulty') {
    const difficulty = DIFFICULTIES[Number(interaction.values[0])];
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
      await refreshLiveQueue(interaction.guild, state);
    });

    if (!dungeon) return interaction.update({ content: 'That carry selection expired. Press **Request Carry** again.', embeds: [], components: [] });
    return interaction.update({
      embeds: [branded(existing ? '⚠️ Existing Carry Request' : '✅ Added to Live Queue', existing ? 0xfee75c : 0x57f287)
        .setDescription(existing
          ? 'You already have an active carry request.'
          : `**Dungeon:** ${dungeon}\n**Difficulty:** ${difficulty}\n**Queue position:** #${position}`)],
      components: []
    });
  }

  if (id === 'kc:qv2:manage') {
    const state = await readGuildState(interaction.guildId);
    if (!carrierOrStaff(interaction.member, state)) return interaction.reply(eph('Only carriers or staff can use queue management controls.'));
    const entry = (state.queue ?? []).find((item) => item.id === interaction.values[0] && ['waiting', 'claimed'].includes(item.status));
    if (!entry) return interaction.reply(eph('That request is no longer active. Refresh the queue.'));

    const buttons = entry.status === 'waiting'
      ? new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`kc:qv2:claim:${entry.id}`).setLabel('Claim Selected').setEmoji('🛡️').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`kc:qv2:remove:${entry.id}`).setLabel('Remove Request').setEmoji('🗑️').setStyle(ButtonStyle.Danger)
      )
      : new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`kc:carry:complete:${entry.id}`).setLabel('Complete').setEmoji('✅').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`kc:qv2:release:${entry.id}`).setLabel('Return to Queue').setEmoji('↩️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`kc:qv2:remove:${entry.id}`).setLabel('Remove Request').setEmoji('🗑️').setStyle(ButtonStyle.Danger)
      );

    return interaction.reply({
      embeds: [branded(entry.status === 'claimed' ? '⚔️ Active Mission Controls' : '⏳ Waiting Request Controls')
        .addFields(
          { name: 'Member', value: `<@${entry.userId}>`, inline: true },
          { name: 'Dungeon', value: entry.dungeon, inline: true },
          { name: 'Difficulty', value: entry.difficulty, inline: true },
          { name: 'Status', value: entry.status === 'claimed' ? 'In Progress' : 'Waiting', inline: true },
          { name: 'Knight', value: entry.carrierId ? `<@${entry.carrierId}>` : 'Unclaimed', inline: true }
        )],
      components: [buttons],
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] }
    });
  }
}

export async function installQueueV2(guild) {
  let updated = false;
  await mutateGuildState(guild.id, async (state) => {
    state.setup ??= {};
    state.setup.queueVersion = 2;
    updated = await refreshLiveQueue(guild, state);
  });
  return updated;
}
