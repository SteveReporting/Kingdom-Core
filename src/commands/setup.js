import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { setupGuild } from '../services/setupGuild.js';

export const data = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Build or repair the complete Kingdom Carries server.')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false);

export async function execute(interaction) {
  if (!interaction.inGuild()) return;

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({ content: 'Only a server administrator can run `/setup`.', flags: MessageFlags.Ephemeral });
    return;
  }

  const me = interaction.guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({
      content: 'Kingdom Core needs the **Administrator** permission before `/setup` can build and secure the realm.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  let lastProgress = 0;
  const result = await setupGuild(interaction.guild, async (message) => {
    const now = Date.now();
    if (now - lastProgress > 1200) {
      lastProgress = now;
      await interaction.editReply(`👑 **Kingdom Core**\n${message}`).catch(() => null);
    }
  });

  const s = result.summary;
  await interaction.editReply([
    '👑 **The realm is ready.**',
    '',
    `Roles created: **${s.rolesCreated}**`,
    `Roles repaired: **${s.rolesUpdated}**`,
    `Categories created: **${s.categoriesCreated}**`,
    `Channels created: **${s.channelsCreated}**`,
    `Panels created: **${s.panelsCreated}**`,
    `AutoMod rules created: **${s.automodCreated}**`,
    `Security settings hardened: **${s.securityChanges}**`,
    '',
    'Kingdom Core also enabled its unauthorized-bot guard and moderation logging.',
    'Running `/setup` again is safe: it repairs missing Kingdom Core pieces instead of deleting the server.'
  ].join('\n'));
}
