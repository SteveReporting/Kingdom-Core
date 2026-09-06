import { EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { BRAND } from '../config/blueprint.js';
import { readGuildState } from '../storage/store.js';

export const data = new SlashCommandBuilder()
  .setName('mod')
  .setDescription('Kingdom moderation tools.')
  .setDMPermission(false)
  .addSubcommand((sub) => sub
    .setName('timeout')
    .setDescription('Timeout a member.')
    .addUserOption((o) => o.setName('user').setDescription('Member to timeout').setRequired(true))
    .addIntegerOption((o) => o.setName('minutes').setDescription('Timeout length in minutes').setRequired(true).setMinValue(1).setMaxValue(40320))
    .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(400)))
  .addSubcommand((sub) => sub
    .setName('untimeout')
    .setDescription('Remove a member timeout.')
    .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(400)))
  .addSubcommand((sub) => sub
    .setName('kick')
    .setDescription('Kick a member.')
    .addUserOption((o) => o.setName('user').setDescription('Member to kick').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(400)))
  .addSubcommand((sub) => sub
    .setName('ban')
    .setDescription('Ban a member.')
    .addUserOption((o) => o.setName('user').setDescription('User to ban').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(400)))
  .addSubcommand((sub) => sub
    .setName('unban')
    .setDescription('Unban a user by ID.')
    .addStringOption((o) => o.setName('user_id').setDescription('Discord user ID').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(400)));

async function logAction(interaction, action, target, reason, extra = '') {
  const state = await readGuildState(interaction.guildId);
  const channelId = state.setup?.channels?.modLogs;
  const channel = channelId ? interaction.guild.channels.cache.get(channelId) : null;
  if (!channel?.isTextBased()) return;
  const embed = new EmbedBuilder()
    .setColor(BRAND.color)
    .setTitle(`🔨 ${action}`)
    .addFields(
      { name: 'Target', value: target, inline: true },
      { name: 'Moderator', value: `<@${interaction.user.id}>`, inline: true },
      { name: 'Reason', value: reason || 'No reason provided.' }
    )
    .setTimestamp();
  if (extra) embed.addFields({ name: 'Details', value: extra });
  await channel.send({ embeds: [embed] }).catch(() => null);
}

function deny(interaction, permission) {
  return !interaction.memberPermissions?.has(permission) && !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
}

export async function execute(interaction) {
  if (!interaction.inGuild()) return;
  const sub = interaction.options.getSubcommand();
  const reason = interaction.options.getString('reason') || 'No reason provided.';

  if (sub === 'timeout' || sub === 'untimeout') {
    if (deny(interaction, PermissionFlagsBits.ModerateMembers)) {
      return interaction.reply({ content: 'You need **Timeout Members** to use this.', flags: MessageFlags.Ephemeral });
    }
    const user = interaction.options.getUser('user', true);
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member || !member.moderatable) {
      return interaction.reply({ content: 'I cannot moderate that member. Check the role hierarchy.', flags: MessageFlags.Ephemeral });
    }
    const minutes = sub === 'timeout' ? interaction.options.getInteger('minutes', true) : null;
    await member.timeout(minutes ? minutes * 60_000 : null, `${reason} • by ${interaction.user.tag}`);
    await logAction(interaction, sub === 'timeout' ? 'Member Timed Out' : 'Timeout Removed', `<@${user.id}>`, reason, minutes ? `${minutes} minute(s)` : 'Timeout cleared');
    return interaction.reply({ content: `✅ ${sub === 'timeout' ? `Timed out <@${user.id}> for **${minutes} minute(s)**.` : `Removed timeout from <@${user.id}>.`}`, flags: MessageFlags.Ephemeral });
  }

  if (sub === 'kick') {
    if (deny(interaction, PermissionFlagsBits.KickMembers)) {
      return interaction.reply({ content: 'You need **Kick Members** to use this.', flags: MessageFlags.Ephemeral });
    }
    const user = interaction.options.getUser('user', true);
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member || !member.kickable) {
      return interaction.reply({ content: 'I cannot kick that member. Check the role hierarchy.', flags: MessageFlags.Ephemeral });
    }
    await member.kick(`${reason} • by ${interaction.user.tag}`);
    await logAction(interaction, 'Member Kicked', `${user.tag} (${user.id})`, reason);
    return interaction.reply({ content: `✅ Kicked **${user.tag}**.`, flags: MessageFlags.Ephemeral });
  }

  if (sub === 'ban') {
    if (deny(interaction, PermissionFlagsBits.BanMembers)) {
      return interaction.reply({ content: 'You need **Ban Members** to use this.', flags: MessageFlags.Ephemeral });
    }
    const user = interaction.options.getUser('user', true);
    await interaction.guild.members.ban(user.id, { reason: `${reason} • by ${interaction.user.tag}` });
    await logAction(interaction, 'User Banned', `${user.tag} (${user.id})`, reason);
    return interaction.reply({ content: `✅ Banned **${user.tag}**.`, flags: MessageFlags.Ephemeral });
  }

  if (sub === 'unban') {
    if (deny(interaction, PermissionFlagsBits.BanMembers)) {
      return interaction.reply({ content: 'You need **Ban Members** to use this.', flags: MessageFlags.Ephemeral });
    }
    const userId = interaction.options.getString('user_id', true).trim();
    if (!/^\d{15,22}$/.test(userId)) {
      return interaction.reply({ content: 'That does not look like a valid Discord user ID.', flags: MessageFlags.Ephemeral });
    }
    const unbanned = await interaction.guild.members.unban(userId, `${reason} • by ${interaction.user.tag}`).then(() => true).catch(() => false);
    if (!unbanned) {
      return interaction.reply({ content: 'I could not unban that ID. They may not be banned, or the ID may be wrong.', flags: MessageFlags.Ephemeral });
    }
    await logAction(interaction, 'User Unbanned', userId, reason);
    return interaction.reply({ content: `✅ Unbanned **${userId}**.`, flags: MessageFlags.Ephemeral });
  }
}
