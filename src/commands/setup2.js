import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { enforceSetup2Hierarchy } from '../services/hierarchySetup2.js';
import { installLevelRoles } from '../services/levelRoles.js';
import { finishPermissionMatrix } from '../services/setup2Finishing.js';
import { installUltimateSetup2 } from '../services/setup2Ultimate.js';
import { upgradeGuild } from '../services/setupUpgrade.js';

export const data = new SlashCommandBuilder()
  .setName('setup2')
  .setDescription('Install the consolidated Kingdom Core premium UI, tickets, applications, security and hierarchy.')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false);

export async function execute(interaction) {
  if (!interaction.inGuild()) return;
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: 'Only a server administrator can run `/setup2`.', flags: MessageFlags.Ephemeral });
  }

  const me = interaction.guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      content: 'Kingdom Core needs **Administrator** before `/setup2` can repair permissions, create private carry tickets and enforce the hierarchy.',
      flags: MessageFlags.Ephemeral
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  let lastProgress = 0;
  const progress = async (message) => {
    const now = Date.now();
    if (now - lastProgress > 650) {
      lastProgress = now;
      await interaction.editReply(`👑 **Kingdom Core • Consolidated Setup 2**\n${message}`).catch(() => null);
    }
  };

  await progress('Repairing security, permissions and moderation foundations…');
  const baseline = await upgradeGuild(interaction.guild, progress);

  await progress('Applying explicit X/✓ permission matrices and message-history access…');
  const permissionRepairs = await finishPermissionMatrix(interaction.guild);

  await progress('Installing Dungeon Quest level reaction roles…');
  const levels = await installLevelRoles(interaction.guild);

  await progress('Installing premium UI, Google Forms applications, carry tickets and staff control centers…');
  const ultimate = await installUltimateSetup2(interaction.guild, progress);

  // Must run LAST. This verifies the hierarchy after every setup2-created role exists.
  await progress('Forcing and verifying the final role hierarchy against Discord…');
  const hierarchy = await enforceSetup2Hierarchy(interaction.guild);

  const b = baseline.summary;
  const u = ultimate.summary;
  await interaction.editReply([
    '✨ **KINGDOM CORE • `/setup2` COMPLETE**',
    '',
    '**👑 ROLE HIERARCHY**',
    `• Verified in Discord: **${hierarchy.verified} roles**`,
    `• Highest Kingdom role: **${hierarchy.highest ?? 'N/A'}**`,
    `• Lowest managed role: **${hierarchy.lowest ?? 'N/A'}**`,
    `• Hierarchy ceiling: **${hierarchy.botRole}**`,
    '',
    '**⚔️ CARRY SYSTEM**',
    '• Request Carry → popup selector → **private carry ticket**',
    '• Dedicated **LIVE CARRY TICKETS** category',
    '• Knight/staff **Carry Control** dashboard',
    '• Claim • Start • Return • Complete • Remove/Close controls',
    '',
    '**📨 APPLICATIONS**',
    '• Popup applications removed from the active UI',
    '• Public application panels now use **Google Forms links**',
    '• Staff response links + Discord Grade / Decision / Review logging',
    '',
    '**🎫 SUPPORT & OPERATIONS**',
    '• Staff petition browser + claim/escalate/close controls',
    '• Application review desk and carry operations board',
    '',
    '**🎨 UI / WEBHOOKS**',
    `• Premium panels updated: **${u.panelsUpdated}**`,
    `• Panels pinned: **${u.panelsPinned}**`,
    `• New categories/channels: **${u.categoriesCreated + u.channelsCreated}**`,
    `• Branded webhook streams prepared: **${u.webhooksPrepared + b.webhooksPrepared}**`,
    '',
    '**🛡️ SECURITY**',
    `• Permission targets repaired: **${b.permissionsRepaired + permissionRepairs}**`,
    `• AutoMod rules created/updated: **${b.automodChanged}**`,
    '• Unauthorized-bot guard + audit watch + message-burst protection remain enabled',
    '',
    '**📈 LEVEL ROLES**',
    `• Level roles installed: **${levels.roles}**`,
    '• `Lvl 0-9` → `Lvl 200+` with Dungeon Quest progression labels',
    '',
    '✅ `/setup3` is no longer part of the active command system. This `/setup2` is the single upgrade path.'
  ].join('\n'));
}
