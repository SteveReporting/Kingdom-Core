import { EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { runUiUpgrade } from '../services/uiUpgrade.js';

export const data = new SlashCommandBuilder()
  .setName('uipgrade')
  .setDescription('Rebuild Kingdom Carries presentation channels with the premium UI vNext.')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false);

export async function execute(interaction) {
  if (!interaction.inGuild()) return;
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: 'Only a server administrator can run **UIpgrade**.', flags: MessageFlags.Ephemeral });
  }

  const me = interaction.guild.members.me;
  const required = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ManageMessages
  ];
  if (!me || required.some((permission) => !me.permissions.has(permission))) {
    return interaction.reply({
      content: 'Kingdom Core needs **View Channel**, **Read Message History**, **Send Messages** and **Manage Messages** before UIpgrade can rebuild the presentation surfaces.',
      flags: MessageFlags.Ephemeral
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  let last = 0;
  const progress = async (text) => {
    const now = Date.now();
    if (now - last < 650) return;
    last = now;
    await interaction.editReply(`👑 **KINGDOM CORE • UIpgrade**\n${text}`).catch(() => null);
  };

  const result = await runUiUpgrade(interaction.guild, progress);
  const embed = new EmbedBuilder()
    .setColor(result.failures.length ? 0xfee75c : 0x57f287)
    .setAuthor({ name: 'KINGDOM CARRIES • REALM INTERFACE' })
    .setTitle('👑 UIpgrade Complete')
    .setDescription([
      'Kingdom Carries has been rebuilt onto the **UI vNext** presentation layer.',
      '',
      '**Human conversation/history was protected by design.** Announcement/news channels, general/community chat, Dungeon Quest chat, media/showcase, active tickets/carry tickets and security/audit logs were not purge targets.'
    ].join('\n'))
    .addFields(
      { name: 'Presentation Surfaces Rebuilt', value: `**${result.channelsCleared}**`, inline: true },
      { name: 'Old Messages Removed', value: `**${result.messagesDeleted}**`, inline: true },
      { name: 'New Panels Published', value: `**${result.panelsSent}**`, inline: true },
      { name: 'Pinned Interfaces', value: `**${result.panelsPinned}**`, inline: true },
      { name: 'Application Review', value: '✅ Paged answers\n✅ Reviewer notepad\n✅ S–F grading\n✅ Interview / Accept / Deny\n✅ Accepted-role assignment\n✅ Applicant DM + onboarding links', inline: false },
      { name: 'Failures', value: result.failures.length ? result.failures.slice(0, 8).join('\n').slice(0, 1024) : '**0** — all resolved presentation surfaces rebuilt.', inline: false }
    )
    .setFooter({ text: 'Kingdom Core • UI vNext' })
    .setTimestamp();

  await interaction.editReply({ content: '', embeds: [embed] });
}
