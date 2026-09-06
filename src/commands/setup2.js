import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { upgradeGuild } from '../services/setupUpgrade.js';

export const data = new SlashCommandBuilder()
  .setName('setup2')
  .setDescription('Apply the Kingdom Core UI, security, permission and workflow upgrade.')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false);

export async function execute(interaction) {
  if (!interaction.inGuild()) return;

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({ content: 'Only a server administrator can run `/setup2`.', flags: MessageFlags.Ephemeral });
    return;
  }

  const me = interaction.guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({
      content: 'Kingdom Core needs **Administrator** before `/setup2` can repair hierarchy and permissions.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  let lastProgress = 0;
  const result = await upgradeGuild(interaction.guild, async (message) => {
    const now = Date.now();
    if (now - lastProgress > 900) {
      lastProgress = now;
      await interaction.editReply(`🛡️ **Kingdom Core Upgrade**\n${message}`).catch(() => null);
    }
  });

  const s = result.summary;
  await interaction.editReply([
    '✨ **Kingdom Core v2 upgrade applied.**',
    '',
    `Roles reordered: **${s.rolesReordered}**`,
    `Permission targets repaired: **${s.permissionsRepaired}**`,
    `Upgrade channels created: **${s.channelsCreated}**`,
    `Panels upgraded: **${s.panelsUpgraded}**`,
    `Branded webhooks prepared: **${s.webhooksPrepared}**`,
    `AutoMod rules created/updated: **${s.automodChanged}**`,
    '',
    'No original Kingdom categories or channels were recreated. `/setup2` only repairs and upgrades the requested systems.'
  ].join('\n'));
}
