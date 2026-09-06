import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { installCarrierDepartmentV3 } from '../services/carrierDepartmentV3.js';
import { installCarryPartiesV3 } from '../services/carryPartiesV3.js';
import { installCommunityV4 } from '../services/communityV4.js';
import { enforceSetup2Hierarchy } from '../services/hierarchySetup2.js';
import { installLevelRoles } from '../services/levelRoles.js';
import { installPlatformV4 } from '../services/platformV4.js';
import { installPlatformV4Complete, runPlatformV4CompleteMaintenance } from '../services/platformV4Complete.js';
import { runV4Maintenance } from '../services/platformV4Runtime.js';
import { installStatsAndVerification } from '../services/serverStatsVerification.js';
import { finishPermissionMatrix } from '../services/setup2Finishing.js';
import { installUltimateSetup2 } from '../services/setup2Ultimate.js';
import { setupGuild } from '../services/setupGuild.js';
import { upgradeGuild } from '../services/setupUpgrade.js';

export const data = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Install, migrate or repair the complete Kingdom Core platform.')
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
      content: 'Kingdom Core needs **Administrator** before `/setup` can install and repair the platform.',
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  let lastProgress = 0;
  const progress = async (message) => {
    const now = Date.now();
    if (now - lastProgress < 650) return;
    lastProgress = now;
    await interaction.editReply(`👑 **Kingdom Core • Unified Setup**\n${message}`).catch(() => null);
  };

  await progress('Restoring and repairing the original Kingdom category layout…');
  const base = await setupGuild(interaction.guild, progress);

  await progress('Repairing permissions, tickets, applications and security…');
  const upgraded = await upgradeGuild(interaction.guild, progress);
  const permissionRepairs = await finishPermissionMatrix(interaction.guild);
  const levels = await installLevelRoles(interaction.guild);
  const premium = await installUltimateSetup2(interaction.guild, progress);

  await progress('Repairing verification, server stats and grouped carry operations…');
  const stats = await installStatsAndVerification(interaction.guild);
  const carries = await installCarryPartiesV3(interaction.guild);
  const carrier = await installCarrierDepartmentV3(interaction.guild);

  await progress('Installing and repairing Kingdom Core platform systems…');
  const platform = await installPlatformV4(interaction.guild, progress);
  const community = await installCommunityV4(interaction.guild);
  const complete = await installPlatformV4Complete(interaction.guild);
  await runV4Maintenance(interaction.guild);
  await runPlatformV4CompleteMaintenance(interaction.guild);

  // Category consolidation is intentionally disabled. The bot restores/repairs
  // the original category structure and leaves final manual ordering to staff.
  await progress('Leaving category ordering untouched for manual organisation…');

  // Must run last so every role created by every generation is in final order.
  await progress('Verifying the final role hierarchy…');
  const hierarchy = await enforceSetup2Hierarchy(interaction.guild);

  const b = base.summary;
  const u = upgraded.summary;
  const p = premium.summary;

  await interaction.editReply([
    '✨ **KINGDOM CORE • `/setup` COMPLETE**',
    '',
    '**ONE SETUP COMMAND**',
    '• `/setup` installs, upgrades and repairs every Kingdom Core generation.',
    '• `/setup2`, `/setup3` and `/setup4` remain retired.',
    '• Automatic category consolidation/reordering is disabled.',
    '• The original Kingdom categories are restored/reused; staff can order them manually.',
    '',
    '**CARRY + KNIGHT OPERATIONS**',
    '• Private carry tickets + grouped parties + ready checks',
    '• Live queue + carry control + mission state machine',
    '• Carrier profiles, trials, service time, reputation and commendations',
    `• Existing duplicate carry parties merged: **${carries.merged ?? 0}**`,
    `• Carrier control panels repaired: **${carrier.panels ?? 0}**`,
    '',
    '**KINGDOM PLATFORM**',
    '• Member identity, XP, prestige, Houses and quests',
    '• Marketplace + treasury + lending systems',
    '• Events, RSVP, notifications, mentors and archives',
    '• Applications, support tickets, analytics and staff command centre',
    '• Security, digital twin, audit/repair and platform health',
    '• Website/API + realtime platform support',
    `• Premium v4.2 control surfaces repaired: **${complete.panels ?? 0}**`,
    '',
    '**REPAIRS / INSTALLATION**',
    `• Base roles created/repaired: **${b.rolesCreated}/${b.rolesUpdated}**`,
    `• Base categories restored/created: **${b.categoriesCreated}**`,
    `• Permission targets repaired: **${(u.permissionsRepaired ?? 0) + permissionRepairs}**`,
    `• Premium panels updated: **${p.panelsUpdated ?? 0}**`,
    `• Platform channels added only where missing: **${platform.summary.channelsCreated + community.channelsCreated + (complete.created ?? 0)}**`,
    `• Level roles installed: **${levels.roles}**`,
    `• Verification stats mode: **${stats.snapshot.exact ? 'exact' : 'cache-based'}**`,
    `• Final hierarchy verified: **${hierarchy.verified} roles**`,
    '',
    '✅ `/setup` will no longer merge categories, delete categories, or reorganise the server into the compact layout.'
  ].join('\n'));
}
