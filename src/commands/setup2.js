import { EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { ORGANIZER_GROUPS, SOFT_CATEGORY_TARGET, organiseServerV2 } from '../services/serverOrganizerV2.js';

export const data = new SlashCommandBuilder()
  .setName('setup2')
  .setDescription('Analyse the live server and organise channels into a balanced category structure.')
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
    await interaction.editReply(`🏰 **KINGDOM CORE /setup2 • BALANCED SERVER ORGANISER**\n${text}`).catch(() => null);
  };

  const result = await organiseServerV2(interaction.guild, { preview, onProgress: progress });
  const groupLines = ORGANIZER_GROUPS
    .filter((group) => (result.counts[group.key] ?? 0) > 0)
    .map((group) => `**${group.name.replace(/━/g, '').trim()}** · ${result.counts[group.key]} channel(s)`)
    .join('\n');

  const largestGroup = ORGANIZER_GROUPS.find((group) => group.key === result.largestCategoryKey);
  const overloadText = result.overloadedCategoryKeys.length
    ? result.overloadedCategoryKeys
        .map((key) => ORGANIZER_GROUPS.find((group) => group.key === key)?.name.replace(/━/g, '').trim() ?? key)
        .join(', ')
    : 'None';

  const embed = new EmbedBuilder()
    .setColor(0xd4af37)
    .setTitle(preview ? '🏰 Kingdom Server Organisation Preview' : '🏰 Kingdom Server Reorganised')
    .setDescription([
      `Analysed **${result.analysedChannels}** live channels across the whole server.`,
      '',
      preview
        ? 'No channels or categories were changed. Run `/setup2` without `preview:true` to apply this plan.'
        : 'The server was redistributed into smaller purpose-built sections. **No channels were deleted.**'
    ].join('\n'))
    .addFields(
      {
        name: `📂 Balanced Category Plan · ${result.categoriesUsed}/${ORGANIZER_GROUPS.length} used`,
        value: groupLines || 'No movable channels were found.'
      },
      {
        name: preview ? '🔎 Planned Changes' : '✅ Applied Changes',
        value: [
          `Channels ${preview ? 'to move' : 'moved'}: **${result.channelsMoved}**`,
          `Already correctly placed: **${result.channelsAlreadyCorrect}**`,
          `Categories ${preview ? 'needed' : 'created'}: **${result.categoriesCreated}**`,
          `Categories ${preview ? 'that would be renamed' : 'renamed'}: **${result.categoriesRenamed}**`,
          `Categories emptied by this run ${preview ? 'that would be removed' : 'removed'}: **${result.emptyCategoriesRemoved}**`
        ].join('\n'),
        inline: false
      },
      {
        name: '⚖️ Balance Check',
        value: [
          `Largest planned section: **${largestGroup?.name.replace(/━/g, '').trim() ?? 'N/A'}** · **${result.largestCategorySize}** channel(s)`,
          `Preferred soft ceiling: **${SOFT_CATEGORY_TARGET} channels/category**`,
          `Sections above that ceiling: **${overloadText}**`,
          `Maximum possible organiser structure: **${ORGANIZER_GROUPS.length} categories**`
        ].join('\n')
      },
      {
        name: '🛡️ Safety',
        value: [
          '**0 channels deleted**',
          'Channel permission overwrites are preserved when channels move.',
          'Existing categories are reused only when their names clearly match the intended section.',
          'Only categories emptied by this `/setup2` run are eligible for removal.',
          result.channelsSkippedCapacity ? `Discord category-capacity skips: **${result.channelsSkippedCapacity}**` : 'No category-capacity skips.',
          result.channelsFailed ? `Move failures: **${result.channelsFailed}**` : 'No move failures.'
        ].join('\n')
      }
    )
    .setFooter({ text: 'Kingdom Core setup2 • balanced organisation only — no platform installation' })
    .setTimestamp();

  await interaction.editReply({ content: '', embeds: [embed] });
}
