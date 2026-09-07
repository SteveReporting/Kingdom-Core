import { EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { installCarrierDepartmentV3 } from '../services/carrierDepartmentV3.js';
import { installCarryPartiesV3 } from '../services/carryPartiesV3.js';
import { installCommunityV4, runCommunityMaintenance } from '../services/communityV4.js';
import { enforceSetup2Hierarchy } from '../services/hierarchySetup2.js';
import { installLevelRoles } from '../services/levelRoles.js';
import { runHeartbeatSafePlatformMaintenance } from '../services/maintenanceV5Safe.js';
import { installPlatformV4 } from '../services/platformV4.js';
import { runPlatformAutomationV4 } from '../services/platformV4Automation.js';
import { installPlatformV4Complete } from '../services/platformV4Complete.js';
import { runV4Maintenance } from '../services/platformV4Runtime.js';
import { finalizePlatformV5, installPlatformV5 } from '../services/platformV5.js';
import { captureGuildStructure, restoreGuildStructure } from '../services/preserveGuildStructure.js';
import { installStatsAndVerification } from '../services/serverStatsVerification.js';
import { finishPermissionMatrix } from '../services/setup2Finishing.js';
import { installUltimateSetup2 } from '../services/setup2Ultimate.js';
import { setupGuild } from '../services/setupGuild.js';
import { upgradeGuild } from '../services/setupUpgrade.js';

export const data = new SlashCommandBuilder()
  .setName('setup5')
  .setDescription('Install or repair v5 without moving channels or deleting categories.')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false);

export async function execute(interaction) {
  if (!interaction.inGuild()) return;
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: 'Only a server administrator can run `/setup5`.', flags: MessageFlags.Ephemeral });
  }
  const me = interaction.guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: 'Kingdom Core needs **Administrator** before `/setup5` can repair the platform.', flags: MessageFlags.Ephemeral });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  let last = 0;
  const progress = async (text) => {
    const now = Date.now();
    if (now - last < 500) return;
    last = now;
    await interaction.editReply(`👑 **KINGDOM CORE /setup5 • STRUCTURE-SAFE v5**\n${text}`).catch(() => null);
  };

  await progress('01/11 • Capturing the current channel/category layout before touching platform systems…');
  const structureSnapshot = await captureGuildStructure(interaction.guild);
  const base = await setupGuild(interaction.guild, progress, { preserveExistingChannelParents: true });

  await progress('02/11 • Repairing permissions, applications, tickets and base security…');
  const upgraded = await upgradeGuild(interaction.guild, progress);
  const permissionRepairs = await finishPermissionMatrix(interaction.guild);
  const levels = await installLevelRoles(interaction.guild);
  const premium = await installUltimateSetup2(interaction.guild, progress);

  await progress('03/11 • Repairing verification intelligence and live server statistics…');
  const stats = await installStatsAndVerification(interaction.guild);

  await progress('04/11 • Repairing grouped/joinable carries, ready checks and mission orchestration…');
  const carries = await installCarryPartiesV3(interaction.guild);

  await progress('05/11 • Repairing Knight Command, Academy, service, reputation and carrier documents…');
  const carrier = await installCarrierDepartmentV3(interaction.guild);

  await progress('06/11 • Repairing progression, Houses, quests, economy and control planes…');
  const platform = await installPlatformV4(interaction.guild, progress);

  await progress('07/11 • Repairing events, notifications, mentors, archives and staff intelligence…');
  const community = await installCommunityV4(interaction.guild);

  await progress('08/11 • Repairing advanced workflows, premium dashboards and assurance tooling…');
  const advanced = await installPlatformV4Complete(interaction.guild);
  const v5 = await installPlatformV5(interaction.guild);

  await progress('09/11 • Running heartbeat-safe analytics, referrals, watchlists and security automation…');
  await runV4Maintenance(interaction.guild);
  await runPlatformAutomationV4(interaction.guild);
  await runHeartbeatSafePlatformMaintenance(interaction.guild);
  await runCommunityMaintenance(interaction.guild);

  await progress('10/11 • Restoring and verifying the exact pre-existing channel/category placement…');
  const structure = await restoreGuildStructure(interaction.guild, structureSnapshot);

  await progress('11/11 • Verifying role hierarchy and capturing the final v5 digital twin…');
  const hierarchy = await enforceSetup2Hierarchy(interaction.guild);
  const verification = await finalizePlatformV5(interaction.guild);

  const b = base.summary;
  const u = upgraded.summary;
  const p = premium.summary;

  const completion = new EmbedBuilder()
    .setColor(0xd4af37)
    .setTitle('👑 KINGDOM CORE v5 • STRUCTURE-SAFE SETUP COMPLETE')
    .setDescription('v5 was installed/repaired while protecting the server layout. Existing channels stay in their original categories and original categories are never intentionally deleted by `/setup5`.')
    .addFields(
      {
        name: '🏰 Structure Protection',
        value: [
          `Original categories missing: **${structure.missingOriginalCategories}**`,
          `Channel parents restored: **${structure.channelParentsRestored}**`,
          `Channel positions restored: **${structure.channelPositionsRestored}**`,
          `Category positions restored: **${structure.categoryPositionsRestored}**`,
          'Category compaction/deletion: **DISABLED for /setup5**'
        ].join('\n')
      },
      {
        name: '⚙️ Platform',
        value: [
          `Roadmap systems: **${v5.approved}**`,
          `Coverage: **${verification.coverage.passed}/${verification.coverage.total}**`,
          `Digital-twin drift: **${verification.drift}**`,
          `Roles created/repaired: **${b.rolesCreated}/${b.rolesUpdated}**`,
          `Permission repairs: **${(u.permissionsRepaired ?? 0) + permissionRepairs}**`,
          `Premium panels repaired: **${p.panelsUpdated ?? 0}**`
        ].join('\n')
      },
      {
        name: '⚔️ Operations',
        value: [
          `Carry parties merged: **${carries.merged ?? 0}**`,
          `Knight panels repaired: **${carrier.panels ?? 0}**`,
          `Advanced surfaces repaired/created where missing: **${advanced.created ?? 0}**`,
          `Platform/community surfaces created only where missing: **${platform.summary.channelsCreated + community.channelsCreated + (advanced.created ?? 0)}**`,
          `Level roles: **${levels.roles}** · stats: **${stats.snapshot.exact ? 'exact' : 'cache-based'}**`,
          `Hierarchy verified: **${hierarchy.verified} roles**`
        ].join('\n')
      }
    )
    .setFooter({ text: 'Kingdom Core /setup5 • no channel relocation • no category deletion' })
    .setTimestamp();

  await interaction.editReply({ content: '', embeds: [completion] });
}
