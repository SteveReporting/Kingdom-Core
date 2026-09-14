import { EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { runLiveGuildSetup } from '../services/liveGuildSetup.js';

export const data = new SlashCommandBuilder()
  .setName('setup1')
  .setDescription('Use the current live guild structure as the canonical Kingdom Core setup.')
  .addBooleanOption((option) => option
    .setName('preview')
    .setDescription('Show what setup1 would do without creating or changing anything.'))
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false);

export async function execute(interaction) {
  if (!interaction.inGuild()) return;

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      content: 'Only a server administrator can run **/setup1**.',
      flags: MessageFlags.Ephemeral
    });
  }

  const preview = interaction.options.getBoolean('preview') ?? false;
  const me = interaction.guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ViewChannel)) {
    return interaction.reply({
      content: 'Kingdom Core needs **View Channel** so /setup1 can read the live server structure.',
      flags: MessageFlags.Ephemeral
    });
  }

  if (!preview && !me.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return interaction.reply({
      content: 'Kingdom Core needs **Manage Channels** so /setup1 can recreate a missing channel/category if the saved live setup detects one.',
      flags: MessageFlags.Ephemeral
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await runLiveGuildSetup(interaction.guild, { preview });
  const categoryCount = result.current.categories.length;
  const channelCount = result.current.channels.length;
  const missingCategories = result.diff.missingCategories.length;
  const missingChannels = result.diff.missingChannels.length;

  if (preview) {
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('🏰 Setup1 • Live Structure Preview')
      .setDescription([
        `Read **${categoryCount} categories** and **${channelCount} channels** directly from the live guild.`,
        '',
        result.baselineExists
          ? 'The saved Setup1 baseline exists. Preview is comparing the live server against that baseline.'
          : 'No Setup1 baseline exists yet. Running **/setup1** will adopt the server exactly as it is now as the baseline.',
        '',
        '**No existing channel/category is renamed, moved, reordered, deleted, or re-parented by Setup1.**'
      ].join('\n'))
      .addFields(
        { name: 'Missing Saved Categories', value: `**${missingCategories}**`, inline: true },
        { name: 'Missing Saved Channels', value: `**${missingChannels}**`, inline: true },
        { name: 'Source of Truth', value: '**Live Discord guild**', inline: true }
      )
      .setFooter({ text: 'Kingdom Core • /setup1 preview' })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  }

  const repair = result.repair;
  const embed = new EmbedBuilder()
    .setColor(repair.failures.length ? 0xfee75c : 0x57f287)
    .setTitle('🏰 Setup1 • Live Guild Locked In')
    .setDescription([
      result.baselineExists
        ? 'The current live guild has been re-read and saved as the new Setup1 baseline.'
        : 'The current live guild has been captured as the first Setup1 baseline.',
      '',
      '**Existing category placement and channel order were not changed.**',
      'Only previously-saved items that were completely missing were eligible to be recreated, and recreated items are appended so existing positions stay untouched.'
    ].join('\n'))
    .addFields(
      { name: 'Live Categories', value: `**${categoryCount}**`, inline: true },
      { name: 'Live Channels', value: `**${channelCount}**`, inline: true },
      { name: 'Categories Recreated', value: `**${repair.categoriesCreated}**`, inline: true },
      { name: 'Channels Recreated', value: `**${repair.channelsCreated}**`, inline: true },
      { name: 'Unsupported Missing Types', value: `**${repair.skippedUnsupported}**`, inline: true },
      {
        name: 'Failures',
        value: repair.failures.length ? repair.failures.slice(0, 6).join('\n').slice(0, 1024) : '**0**',
        inline: false
      }
    )
    .setFooter({ text: 'Kingdom Core • current guild is the setup structure' })
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}
