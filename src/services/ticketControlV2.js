import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  StringSelectMenuBuilder
} from 'discord.js';
import { BRAND, STAFF_KEYS } from '../config/blueprint.js';
import { mutateGuildState, readGuildState } from '../storage/store.js';

const eph = (content) => ({ content, flags: MessageFlags.Ephemeral });

function branded(title, color = BRAND.color) {
  return new EmbedBuilder().setColor(color).setTitle(title).setFooter({ text: BRAND.footer }).setTimestamp();
}

function isStaff(member, state) {
  if (member?.permissions?.has?.(PermissionFlagsBits.Administrator)) return true;
  return STAFF_KEYS.some((key) => {
    const id = state.setup?.roles?.[key];
    return id && member?.roles?.cache?.has(id);
  });
}

function openTickets(state) {
  return Object.values(state.tickets ?? {})
    .filter((ticket) => ticket.status !== 'closed')
    .sort((a, b) => new Date(a.createdAt ?? 0) - new Date(b.createdAt ?? 0));
}

export function ticketControlPayload(state = {}) {
  const tickets = openTickets(state);
  const escalated = tickets.filter((ticket) => ticket.priority === 'high');
  const unclaimed = tickets.filter((ticket) => !ticket.claimedBy);
  const preview = tickets.slice(0, 8).map((ticket, index) =>
    `**${index + 1}.** <@${ticket.userId}> • **${String(ticket.type ?? 'support').toUpperCase()}**\n└ ${ticket.claimedBy ? `Claimed by <@${ticket.claimedBy}>` : 'Unclaimed'}${ticket.priority === 'high' ? ' • 🚨 High priority' : ''}`
  ).join('\n');

  const embed = branded('🎫 Petition Control • Staff Operations', 0x5865f2)
    .setDescription([
      '**All private support petitions in one staff console.**',
      'Browse a ticket, jump straight to the channel, claim it, escalate it or close it.',
      '',
      preview || '_No open petitions._'
    ].join('\n'))
    .addFields(
      { name: 'Open', value: `🎫 **${tickets.length}**`, inline: true },
      { name: 'Unclaimed', value: `🟡 **${unclaimed.length}**`, inline: true },
      { name: 'Escalated', value: `🚨 **${escalated.length}**`, inline: true }
    );

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('kc2:tickets:browse').setLabel('Browse Tickets').setEmoji('🗂️').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('kc2:tickets:refresh').setLabel('Refresh').setEmoji('🔄').setStyle(ButtonStyle.Secondary)
    )],
    allowedMentions: { parse: [] }
  };
}

export async function refreshTicketControl(guild, state) {
  const channel = guild.channels.cache.get(state.setup?.channels?.ticketOverview);
  if (!channel?.isTextBased()) return false;
  state.setup.panels ??= {};
  let message = state.setup.panels.ticketControlV2
    ? await channel.messages.fetch(state.setup.panels.ticketControlV2).catch(() => null)
    : null;
  if (message) await message.edit(ticketControlPayload(state)).catch(() => null);
  else {
    message = await channel.send(ticketControlPayload(state));
    state.setup.panels.ticketControlV2 = message.id;
  }
  if (!message.pinned) await message.pin('Kingdom Core /setup2 petition control').catch(() => null);
  return true;
}

export async function handleTicketControlButton(interaction) {
  if (!interaction.customId.startsWith('kc2:tickets:')) return false;
  const state = await readGuildState(interaction.guildId);
  if (!isStaff(interaction.member, state)) {
    await interaction.reply(eph('Only Kingdom staff can use the petition control console.'));
    return true;
  }

  if (interaction.customId === 'kc2:tickets:refresh') {
    await mutateGuildState(interaction.guildId, async (fresh) => refreshTicketControl(interaction.guild, fresh));
    await interaction.reply(eph('🔄 Petition control refreshed.'));
    return true;
  }

  if (interaction.customId === 'kc2:tickets:browse') {
    const tickets = openTickets(state).slice(0, 25);
    const embed = branded('🗂️ Open Petitions', 0x5865f2)
      .setDescription(tickets.length ? 'Select a petition to open its staff controls.' : '_No open petitions._');
    const components = [];
    if (tickets.length) {
      components.push(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('kc2:tickets:pick')
          .setPlaceholder('Select a petition')
          .addOptions(tickets.map((ticket) => ({
            label: `${String(ticket.type ?? 'support').toUpperCase()} • ${ticket.summary ?? ticket.id}`.slice(0, 100),
            description: `${ticket.claimedBy ? 'Claimed' : 'Unclaimed'}${ticket.priority === 'high' ? ' • HIGH PRIORITY' : ''} • ${ticket.id}`.slice(0, 100),
            value: ticket.id,
            emoji: ticket.priority === 'high' ? '🚨' : '🎫'
          })))
      ));
    }
    await interaction.reply({ embeds: [embed], components, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    return true;
  }
  return false;
}

export async function handleTicketControlSelect(interaction) {
  if (interaction.customId !== 'kc2:tickets:pick') return false;
  const state = await readGuildState(interaction.guildId);
  if (!isStaff(interaction.member, state)) {
    await interaction.reply(eph('Only Kingdom staff can use the petition browser.'));
    return true;
  }
  const ticket = state.tickets?.[interaction.values[0]];
  if (!ticket || ticket.status === 'closed') {
    await interaction.reply(eph('That petition is already closed or no longer exists.'));
    return true;
  }

  const embed = branded(`🎫 ${String(ticket.type ?? 'support').toUpperCase()} • ${ticket.id}`, ticket.priority === 'high' ? 0xed4245 : BRAND.color)
    .setDescription(ticket.summary ?? '_No summary_')
    .addFields(
      { name: 'Owner', value: `<@${ticket.userId}>`, inline: true },
      { name: 'Channel', value: ticket.channelId ? `<#${ticket.channelId}>` : 'Unavailable', inline: true },
      { name: 'Claimed By', value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : 'Unclaimed', inline: true },
      { name: 'Priority', value: ticket.priority === 'high' ? '🚨 High' : 'Normal', inline: true },
      ...(ticket.details ? [{ name: 'Details', value: String(ticket.details).slice(0, 1024) }] : [])
    );

  const controls = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`kc:ticket:claim:${ticket.id}`).setLabel('Claim').setEmoji('🛡️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`kc:ticket:priority:${ticket.id}`).setLabel('Escalate').setEmoji('🚨').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`kc:ticket:close2:${ticket.id}`).setLabel('Close').setEmoji('🔒').setStyle(ButtonStyle.Secondary)
  );

  await interaction.update({ embeds: [embed], components: [controls], allowedMentions: { parse: [] } });
  return true;
}
