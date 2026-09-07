import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { installCarrierDepartmentV3 } from '../services/carrierDepartmentV3.js';
import { installCarryPartiesV3 } from '../services/carryPartiesV3.js';
import { installCommunityV4, runCommunityMaintenance } from '../services/communityV4.js';
import { compactGuildStructure, seedCompactCategoryAliases } from '../services/compactGuild.js';
import { enforceSetup2Hierarchy } from '../services/hierarchySetup2.js';
import { installLevelRoles } from '../services/levelRoles.js';
import { runHeartbeatSafePlatformMaintenance } from '../services/maintenanceV5Safe.js';
import { installPlatformV4 } from '../services/platformV4.js';
import { runPlatformAutomationV4 } from '../services/platformV4Automation.js';
import { installPlatformV4Complete } from '../services/platformV4Complete.js';
import { runV4Maintenance } from '../services/platformV4Runtime.js';
import { finalizePlatformV5, installPlatformV5 } from '../services/platformV5.js';
import { finalizePlatformV10, installPlatformV10, runV10Maintenance } from '../services/platformV10.js';
import { installRealmEnginesRuntimeV10, runRealmMaintenanceV10 } from '../services/realmRuntimeV10.js';
import { installStatsAndVerification } from '../services/serverStatsVerification.js';
import { finishPermissionMatrix } from '../services/setup2Finishing.js';
import { installUltimateSetup2 } from '../services/setup2Ultimate.js';
import { setupGuild } from '../services/setupGuild.js';
import { upgradeGuild } from '../services/setupUpgrade.js';

export const data = new SlashCommandBuilder()
  .setName('setup10')
  .setDescription('Converge Kingdom Carries into the complete 370-system Kingdom Core v10 Realm OS.')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false);

export async function execute(interaction) {
  if (!interaction.inGuild()) return;
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: 'Only a server administrator can run `/setup10`.', flags: MessageFlags.Ephemeral });
  }
  const me = interaction.guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: 'Kingdom Core needs **Administrator** before `/setup10` can converge the Realm OS.', flags: MessageFlags.Ephemeral });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  let last = 0;
  const progress = async (text) => {
    const now = Date.now();
    if (now - last < 600) return;
    last = now;
    await interaction.editReply(`👑 **KINGDOM CORE /setup10 • REALM OS**\n${text}`).catch(() => null);
  };

  await progress('01/10 • Reading the live server map and reusing existing category/channel IDs…');
  await seedCompactCategoryAliases(interaction.guild).catch(() => null);
  const base = await setupGuild(interaction.guild, progress);

  await progress('02/10 • Repairing permissions, applications, tickets, roles and security without duplicating surfaces…');
  const upgraded = await upgradeGuild(interaction.guild, progress);
  const permissionRepairs = await finishPermissionMatrix(interaction.guild);
  const levels = await installLevelRoles(interaction.guild);
  const premium = await installUltimateSetup2(interaction.guild, progress);

  await progress('03/10 • Repairing verification, statistics, carries, ready checks and Knight operations…');
  const stats = await installStatsAndVerification(interaction.guild);
  const carries = await installCarryPartiesV3(interaction.guild);
  const carrier = await installCarrierDepartmentV3(interaction.guild);

  await progress('04/10 • Repairing Houses, quests, progression, economy, events, mentors and notification systems…');
  const platform = await installPlatformV4(interaction.guild, progress);
  const community = await installCommunityV4(interaction.guild);

  await progress('05/10 • Repairing existing premium dashboards, workflows, security, analytics and control planes…');
  const advanced = await installPlatformV4Complete(interaction.guild);
  const v5 = await installPlatformV5(interaction.guild);

  await progress('06/10 • Installing the 370-system v10 shared engines and routing them into existing hubs…');
  const v10 = await installPlatformV10(interaction.guild);
  const realm = await installRealmEnginesRuntimeV10(interaction.guild);

  await progress('07/10 • Running heartbeat-safe maintenance and low-memory resource guards…');
  await runV4Maintenance(interaction.guild);
  await runPlatformAutomationV4(interaction.guild);
  await runHeartbeatSafePlatformMaintenance(interaction.guild);
  await runCommunityMaintenance(interaction.guild);
  await runRealmMaintenanceV10(interaction.guild);
  await runV10Maintenance(interaction.guild);

  await progress('08/10 • Converging duplicate categories and removing only safe empty duplicate channels…');
  const compact = await compactGuildStructure(interaction.guild, progress);

  await progress('09/10 • Enforcing the final role hierarchy after all roles exist…');
  const hierarchy = await enforceSetup2Hierarchy(interaction.guild);

  await progress('10/10 • Capturing the digital twin and verifying the converged v10 Realm OS…');
  const v5Verification = await finalizePlatformV5(interaction.guild);
  const v10Verification = await finalizePlatformV10(interaction.guild);

  const b = base.summary;
  const u = upgraded.summary;
  const p = premium.summary;
  const c = compact.summary;
  const s = v10Verification.structure;
  const r = v10Verification.resources;

  await interaction.editReply([
    '👑 **KINGDOM CORE v10 • REALM OS ONLINE**',
    '',
    '**370-SYSTEM ROADMAP**',
    `• Approved systems registered: **${v10Verification.approved}/370**`,
    `• Shared domain engines: **${v10.engines}** across **${v10.domains}** major domains`,
    `• Runtime engine mode: **${realm.runtimeMode}**`,
    `• Domain hubs mapped into existing channels: **${v10Verification.mappedHubs}/${v10.domains}**`,
    '• AI systems #291–300 are installed as an adapter but **temporarily disabled** for VPS stability.',
    '',
    '**NO CHANNEL-SPRAWL DESIGN**',
    '• v10 reuses the existing carry, member, House, quest, market, event, support, Knight, staff, security and analytics surfaces.',
    `• New v10 fallback channels created only if no usable control surface existed: **${v10.fallbackChannelsCreated}**`,
    `• Categories consolidated/removed: **${c.categoriesRemoved}** obsolete duplicates`,
    `• Channels moved into the shared category layout: **${c.channelsMoved}**`,
    `• Safe empty duplicate channels removed: **${c.duplicateChannelsRemoved}**`,
    `• Populated duplicates deliberately preserved: **${c.populatedDuplicatesSkipped}**`,
    '',
    '**LIVE STRUCTURE AFTER CONVERGENCE**',
    `• Categories: **${s.categories}**`,
    `• Text/announcement surfaces: **${s.text + s.announcements}**`,
    `• Voice surfaces: **${s.voice}**`,
    `• Remaining exact duplicate-name groups: **${s.exactDuplicateGroups}**`,
    '',
    '**RESOURCE / STABILITY**',
    `• VPS resource mode: **${r.pressure}**`,
    `• Kingdom Core RSS: **${r.processRssMb} MB**`,
    `• Host free memory at verification: **${r.freeMemoryMb} MB**`,
    '• Background concurrency is capped at **1**, heavy analytics are throttled, panel refreshes are throttled and AI stays off.',
    '',
    '**PLATFORM REPAIR**',
    `• Base roles created/repaired: **${b.rolesCreated}/${b.rolesUpdated}**`,
    `• Permission targets repaired: **${(u.permissionsRepaired ?? 0) + permissionRepairs}**`,
    `• Premium base panels repaired: **${p.panelsUpdated ?? 0}**`,
    `• Advanced control surfaces created only where missing: **${advanced.created ?? 0}**`,
    `• Existing platform/community channels created only where absent: **${platform.summary.channelsCreated + community.channelsCreated + (advanced.created ?? 0)}**`,
    `• Level roles installed: **${levels.roles}**`,
    `• Verification stats mode: **${stats.snapshot.exact ? 'exact' : 'cache-based'}**`,
    `• Carry parties merged during migration: **${carries.merged ?? 0}**`,
    `• Knight panels repaired: **${carrier.panels ?? 0}**`,
    `• v5 compatibility systems retained: **${v5.approved}**`,
    `• Digital twin drift after migration: **${v5Verification.drift}**`,
    `• Final role hierarchy verified: **${hierarchy.verified} roles**`,
    '',
    '✅ `/setup10` is idempotent and convergence-first: it reads what is already there, reuses IDs, centralises features into shared hubs, removes only safe empty duplicates, and preserves populated/manual channels.'
  ].join('\n'));
}
