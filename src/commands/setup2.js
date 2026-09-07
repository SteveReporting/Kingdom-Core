import { EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { ORGANIZER_GROUPS, organiseServerV2 } from '../services/serverOrganizerV2.js';

export const data = new SlashCommandBuilder()
  .setName('setup2')
  .setDescription('Analyse the live server and organise channels into a compact category structure.')
  .addBooleanOption((option) =>
    option
      .setName('preview')
      .setDescription('Show the organisation plan without moving channels or changing categories.')
      .setRequired(false)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false);

export async function execute(interaction) {
  if (!interaction.inGuild()) return;
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: 'Only a server administrator can run `/setup2`.', flags: MessageFlags.Ephemeral });
  }

  const me = interaction.guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return interaction.reply({
      content: 'Kingdom Core needs **Manage Channels** before `/setup2` can organise the server.',
      flags: MessageFlags.Ephemeral
    });
  }

  const preview = interaction.options.getBoolean('preview') ?? false;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  let lastUpdate = 0;
  const progress = async (text) => {
    const now = Date.now();
    if (now - lastUpdate < 650) return;
    lastUpdate = now;
    await interaction.editReply(`🏰 **KINGDOM CORE /setup2 • SERVER ORGANISER**\n${text}`).catch(() => null);
  };

  const result = await organiseServerV2(interaction.guild, { preview, onProgress: progress });
  const groupLines = ORGANIZER_GROUPS
    .filter((group) => (result.counts[group.key] ?? 0) > 0)
    .map((group) => `**${group.name.replace(/━/g, '').trim()}** · ${result.counts[group.key]} channel(s)`)
    .join('\n');

  const embed = new EmbedBuilder()
    .setColor(0xd4af37)
    .setTitle(preview ? '🏰 Kingdom Server Organisation Preview' : '🏰 Kingdom Server Organised')
    .setDescription([
      `Analysed **${result.analysedChannels}** live channels across the whole server.`,
      '',
      preview
        ? 'No channels or categories were changed. Run `/setup2` without `preview:true` to apply this plan.'
        : 'The server was consolidated into a compact structure. **No channels were deleted.**'
    ].join('\n'))
    .addFields(
      {
        name: `📂 Category Plan · ${result.categoriesUsed}/${ORGANIZER_GROUPS.length} used`,
        value: groupLines || 'No movable channels were found.'
      },
      {
        name: preview ? '🔎 Planned Changes' : '✅ Applied Changes',
        value: [
          `Channels ${preview ? 'to move' : 'moved'}: **${result.channelsMoved}**`,
          `Already in the right place: **${result.channelsAlreadyCorrect}**`,
          `Categories ${preview ? 'needed' : 'created'}: **${result.categoriesCreated}**`,
          `Categories ${preview ? 'that would be renamed' : 'renamed'}: **${result.categoriesRenamed}**`,
          `Empty old categories ${preview ? 'that would be removed' : 'removed'}: **${result.emptyCategoriesRemoved}**`
        ].join('\n'),
        inline: false
      },
      {
        name: '🛡️ Safety',
        value: [
          '**0 channels deleted**',
          'Existing channel permission overwrites are preserved when channels move.',
          `Maximum target structure: **${ORGANIZER_GROUPS.length} categories**.`,
          result.channelsSkippedCapacity ? `Category-capacity skips: **${result.channelsSkippedCapacity}**` : 'No category-capacity skips.',
          result.channelsFailed ? `Move failures: **${result.channelsFailed}**` : 'No move failures.'
        ].join('\n')
      }
    )
    .setFooter({ text: 'Kingdom Core setup2 • organisation only — no platform installation' })
    .setTimestamp();

  await interaction.editReply({ content: '', embeds: [embed] });
}
