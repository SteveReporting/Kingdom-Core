import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { installQueueV2 } from '../services/queueV2.js';
import { finishPermissionMatrix } from '../services/setup2Finishing.js';
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
  const progress = async (message) => {
    const now = Date.now();
    if (now - lastProgress > 700) {
      lastProgress = now;
      await interaction.editReply(`🛡️ **Kingdom Core Upgrade**\n${message}`).catch(() => null);
    }
  };

  const result = await upgradeGuild(interaction.guild, progress);

  await progress('Finishing explicit red-X permission matrices…');
  const finalPermissionRepairs = await finishPermissionMatrix(interaction.guild);

  await progress('Installing the interactive live carry mission console…');
  const liveQueueUpgraded = await installQueueV2(interaction.guild);

  const s = result.summary;
  await interaction.editReply([
    '✨ **Kingdom Core `/setup2` upgrade applied.**',
    '',
    `Roles reordered: **${s.rolesReordered}**`,
    `Permission targets repaired: **${s.permissionsRepaired + finalPermissionRepairs}**`,
    `Upgrade channels created: **${s.channelsCreated}**`,
    `Panels upgraded: **${s.panelsUpgraded}**`,
    `Live carry console: **${liveQueueUpgraded ? 'UPGRADED' : 'UNCHANGED'}**`,
    `Branded webhooks prepared: **${s.webhooksPrepared}**`,
    `AutoMod rules created/updated: **${s.automodChanged}**`,
    '',
    '✅ Role hierarchy fixed',
    '✅ Explicit X/✓ channel permission matrices applied while keeping Read Message History enabled',
    '✅ Applications, ticket desk, security center and webhook UI upgraded',
    '✅ Live queue now supports Request Carry, Leave Queue, Claim Next, carrier request controls, removal and completion',
    '',
    'No original Kingdom categories or channels were recreated. `/setup2` only repairs and upgrades these systems.'
  ].join('\n'));
}
