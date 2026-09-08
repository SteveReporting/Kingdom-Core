import { EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { analyseServerForSetup3, organiseServerV3, SETUP3_GROUPS } from '../services/serverOrganizerV3.js';

export const data = new SlashCommandBuilder()
  .setName('setup3')
  .setDescription('Organise Kingdom Carries into the curated category layout without touching protected carry/economy/knight zones.')
  .addBooleanOption((option) => option
    .setName('preview')
    .setDescription('Preview the category plan without moving or creating anything.'))
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false);

function planLines(counts) {
  return SETUP3_GROUPS
    .filter((group) => (counts[group.key] ?? 0) > 0)
    .map((group) => `${group.name.replace(/━/g, '').trim()} • **${counts[group.key]}** channel(s)`)
    .join('\n');
}

export async function execute(interaction) {
  if (!interaction.inGuild()) return;
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: 'Only a server administrator can run **/setup3**.', flags: MessageFlags.Ephemeral });
  }

  const preview = interaction.options.getBoolean('preview') ?? false;
  const me = interaction.guild.members.me;
  const required = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels];
  if (!me || required.some((permission) => !me.permissions.has(permission))) {
    return interaction.reply({
      content: 'Kingdom Core needs **View Channel** and **Manage Channels** to organise the server.',
      flags: MessageFlags.Ephemeral
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const before = await analyseServerForSetup3(interaction.guild);

  if (preview) {
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('🏰 Setup3 • Curated Structure Preview')
      .setDescription([
        `Analysed **${before.channels.length}** live channels.`,
        '',
        '**Carries, Market & Treasury, and Knights are protected and will not be edited.**',
        'Unknown/ambiguous channels are left exactly where they are rather than dumped into a random category.'
      ].join('\n'))
      .addFields(
        { name: '📂 Planned Categories', value: planLines(before.counts).slice(0, 1024) || '_No moves required._' },
        { name: '🛡️ Protected Zones', value: `Carries: **${before.protectedCounts.carries ?? 0}**\nMarket & Treasury: **${before.protectedCounts.economy ?? 0}**\nKnights: **${before.protectedCounts.knights ?? 0}**`, inline: true },
        { name: '❔ Left In Place', value: `**${before.unclassified}** ambiguous channel(s)`, inline: true }
      )
      .setFooter({ text: 'Kingdom Core • /setup3 preview' })
      .setTimestamp();
    return interaction.editReply({ embeds: [embed] });
  }

  let last = 0;
  const progress = async (text) => {
    const now = Date.now();
    if (now - last < 700) return;
    last = now;
    await interaction.editReply(`🏰 **KINGDOM CORE • SETUP3**\n${text}`).catch(() => null);
  };

  await organiseServerV3(interaction.guild, { preview: false, onProgress: progress });
  const after = await analyseServerForSetup3(interaction.guild);

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle('🏰 Setup3 • Server Organised')
    .setDescription([
      `Analysed and organised **${after.channels.length}** live channels into the curated Kingdom layout.`,
      '',
      '**Protected:** Carries • Market & Treasury • Knights',
      '**Safety:** no channels are deleted; permission overwrites are preserved when a channel moves; uncertain channels stay where they were.'
    ].join('\n'))
    .addFields(
      { name: '📂 Curated Layout', value: planLines(after.counts).slice(0, 1024) || '_No target categories currently contain matched channels._' },
      { name: '🛡️ Protected Zones', value: `Carries: **${after.protectedCounts.carries ?? 0}**\nMarket & Treasury: **${after.protectedCounts.economy ?? 0}**\nKnights: **${after.protectedCounts.knights ?? 0}**`, inline: true },
      { name: '❔ Left In Place', value: `**${after.unclassified}** ambiguous channel(s)`, inline: true }
    )
    .setFooter({ text: 'Kingdom Core • curated organisation only' })
    .setTimestamp();

  await interaction.editReply({ content: '', embeds: [embed] });
}
