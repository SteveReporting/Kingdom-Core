import { EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { SETUP3_GROUPS, SETUP3_PROTECTED_ZONES, organiseServerV3 } from '../services/serverOrganizerV3.js';

export const data = new SlashCommandBuilder()
  .setName('setup3')
  .setDescription('Apply the curated Kingdom Carries server structure while preserving protected sections.')
  .addBooleanOption((option) =>
    option
      .setName('preview')
      .setDescription('Show the setup3 organisation plan without moving any channels.')
      .setRequired(false)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false);

export async function execute(interaction) {
  if (!interaction.inGuild()) return;
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: 'Only a server administrator can run `/setup3`.', flags: MessageFlags.Ephemeral });
  }

  const me = interaction.guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return interaction.reply({
      content: 'Kingdom Core needs **Manage Channels** before `/setup3` can organise the server.',
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
    await interaction.editReply(`🏰 **KINGDOM CORE /setup3 • CURATED SERVER STRUCTURE**\n${text}`).catch(() => null);
  };

  const result = await organiseServerV3(interaction.guild, { preview, onProgress: progress });

  const arranged = SETUP3_GROUPS
    .filter((group) => (result.counts[group.key] ?? 0) > 0)
    .map((group) => `**${group.name.replace(/━/g, '').trim()}** · ${result.counts[group.key]} channel(s)`)
    .join('\n');

  const protectedLines = SETUP3_PROTECTED_ZONES
    .map((zone) => `**${zone.label}** · ${result.protectedCounts[zone.key] ?? 0} channel(s) untouched`)
    .join('\n');

  const unclassified = result.unclassifiedNames.length
    ? result.unclassifiedNames.map((name) => `• ${name}`).join('\n')
    : 'None — every non-protected channel matched a curated section.';

  const embed = new EmbedBuilder()
    .setColor(0xd4af37)
    .setTitle(preview ? '🏰 setup3 • Curated Structure Preview' : '🏰 setup3 • Curated Structure Applied')
    .setDescription([
      `Analysed **${result.analysedChannels}** live channels.`,
      '',
      preview
        ? 'This is a dry run. **Nothing was moved or deleted.**'
        : 'The curated Kingdom Carries structure has been applied. **No channels were deleted.**'
    ].join('\n'))
    .addFields(
      {
        name: '📂 Curated Sections',
        value: arranged || 'No curated moves were required.'
      },
      {
        name: '🛡️ Protected — Never Edited by setup3',
        value: protectedLines
      },
      {
        name: preview ? '🔎 Planned Changes' : '✅ Applied Changes',
        value: [
          `Channels ${preview ? 'to move' : 'moved'}: **${result.channelsMoved}**`,
          `Already correct: **${result.channelsAlreadyCorrect}**`,
          `Categories ${preview ? 'needed' : 'created'}: **${result.categoriesCreated}**`,
          `Categories ${preview ? 'to rename' : 'renamed'}: **${result.categoriesRenamed}**`,
          `Old empty organiser categories ${preview ? 'removable' : 'removed'}: **${result.emptyLegacyCategoriesRemoved}**`,
          `Protected channels untouched: **${result.protectedTotal}**`,
          `Unclear channels deliberately left in place: **${result.unclassified}**`
        ].join('\n')
      },
      {
        name: '🧭 Left in Place by Design',
        value: unclassified.slice(0, 1000)
      },
      {
        name: '🔒 Safety',
        value: [
          '**0 channels deleted**',
          'Carries, Market & Treasury and Knights are protected zones.',
          'Existing per-channel permission overwrites are preserved when a channel moves.',
          'Unknown channels are left where they are instead of being dumped into Community or Staff HQ.',
          result.channelsSkippedCapacity ? `Category-capacity skips: **${result.channelsSkippedCapacity}**` : 'No category-capacity skips.',
          result.channelsFailed ? `Move failures: **${result.channelsFailed}**` : 'No move failures.'
        ].join('\n')
      }
    )
    .setFooter({ text: 'Kingdom Core setup3 • curated structure only' })
    .setTimestamp();

  await interaction.editReply({ content: '', embeds: [embed] });
}
