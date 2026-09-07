import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
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
import { installStatsAndVerification } from '../services/serverStatsVerification.js';
import { finishPermissionMatrix } from '../services/setup2Finishing.js';
import { installUltimateSetup2 } from '../services/setup2Ultimate.js';
import { setupGuild } from '../services/setupGuild.js';
import { upgradeGuild } from '../services/setupUpgrade.js';

export const data = new SlashCommandBuilder()
  .setName('setup5')
  .setDescription('Install or repair the complete approved Kingdom Core v5 platform.')
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
    await interaction.editReply(`👑 **KINGDOM CORE /setup5 • v5 PLATFORM MIGRATION**\n${text}`).catch(() => null);
  };

  await progress('01/11 • Scanning and repairing the existing Kingdom structure…');
  const base = await setupGuild(interaction.guild, progress);

  await progress('02/11 • Repairing permissions, applications, tickets and base security…');
  const upgraded = await upgradeGuild(interaction.guild, progress);
  const permissionRepairs = await finishPermissionMatrix(interaction.guild);
  const levels = await installLevelRoles(interaction.guild);
  const premium = await installUltimateSetup2(interaction.guild, progress);

  await progress('03/11 • Repairing verification intelligence and live server statistics…');
  const stats = await installStatsAndVerification(interaction.guild);

  await progress('04/11 • Rebuilding grouped/joinable carries, ready checks and mission orchestration…');
  const carries = await installCarryPartiesV3(interaction.guild);

  await progress('05/11 • Repairing Knight Command, Academy, service, reputation and carrier documents…');
  const carrier = await installCarrierDepartmentV3(interaction.guild);

  await progress('06/11 • Repairing Kingdom progression, Houses, quests, economy and core control planes…');
  const platform = await installPlatformV4(interaction.guild, progress);

  await progress('07/11 • Repairing events, notifications, mentors, archives and staff intelligence…');
  const community = await installCommunityV4(interaction.guild);

  await progress('08/11 • Rebuilding approved advanced workflows, premium dashboards and assurance tooling…');
  const advanced = await installPlatformV4Complete(interaction.guild);
  const v5 = await installPlatformV5(interaction.guild);

  await progress('09/11 • Running heartbeat-safe analytics, referrals, watchlists and security automation…');
  await runV4Maintenance(interaction.guild);
  await runPlatformAutomationV4(interaction.guild);
  await runHeartbeatSafePlatformMaintenance(interaction.guild);
  await runCommunityMaintenance(interaction.guild);

  await progress('10/11 • Enforcing the final role hierarchy after every required role exists…');
  const hierarchy = await enforceSetup2Hierarchy(interaction.guild);

  await progress('11/11 • Capturing the v5 digital twin and verifying the live platform…');
  const verification = await finalizePlatformV5(interaction.guild);

  const b = base.summary;
  const u = upgraded.summary;
  const p = premium.summary;
  await interaction.editReply([
    '👑 **KINGDOM CORE v5 • APPROVED ROADMAP ONLINE**',
    '',
    '**APPROVED SYSTEMS**',
    `• Roadmap systems installed/reasserted: **${v5.approved}**`,
    `• Major platform domains verified: **${verification.coverage.passed}/${verification.coverage.total}**`,
    `• Digital-twin drift immediately after migration: **${verification.drift}**`,
    `• Snapshot: **${verification.snapshotId}**`,
    '',
    '**CARRY ORCHESTRATION • #4–8, #18–20**',
    '• smart request grouping + joinable active parties + ready checks',
    '• mission lifecycle + recovery + no-show/reliability tracking',
    '• demand heatmaps + predicted queue times',
    `• compatible parties merged during setup: **${carries.merged ?? 0}**`,
    '',
    '**KNIGHT OPERATIONS • #14–16, #66, #89**',
    '• verified service time + reputation + commendations + Academy/coverage intelligence',
    `• carrier control panels repaired: **${carrier.panels ?? 0}**`,
    '',
    '**KINGDOM • #21, #24, #28, #31, #61, #63–83**',
    '• progression + Houses + quests + prestige + verification intelligence',
    '• server/live dashboards + member/Knight/staff control planes',
    '• notifications + events/RSVP/teams/tournaments + referrals + mentors + Archives/advisors',
    '',
    '**ECONOMY • #33–38**',
    '• treasury ledger + approvals + item lending',
    '• marketplace + search + watchlists + intelligence',
    '',
    '**APPLICATIONS + TICKETS • #41–52**',
    '• application workflow + scoring + analytics',
    '• unified ticket console + ownership + SLA + escalation + summaries + audit ledger',
    '',
    '**SECURITY • #53–57, #101, #106**',
    '• permission drift + bot firewall + webhook registry + risk engine + lockdown',
    '• automatic repair + server digital twin',
    '',
    '**PLATFORM • #84–109**',
    '• analytics/retention/funnels/forecasting + feature/config/workflow engines',
    '• event bus + Postgres/Redis/worker adapters + API/WebSocket + observability',
    '• diagnostics + versioning + staging + integration/permission tests + control plane',
    '',
    '**REPAIR SUMMARY**',
    `• Base roles created/repaired: **${b.rolesCreated}/${b.rolesUpdated}**`,
    `• Permission targets repaired: **${(u.permissionsRepaired ?? 0) + permissionRepairs}**`,
    `• Premium base panels updated: **${p.panelsUpdated ?? 0}**`,
    `• Advanced v4/v5 control surfaces created/repaired: **${advanced.created ?? 0}**`,
    `• Platform/community channels added only where missing: **${platform.summary.channelsCreated + community.channelsCreated + (advanced.created ?? 0)}**`,
    `• Level roles installed: **${levels.roles}**`,
    `• Server stats mode: **${stats.snapshot.exact ? 'exact' : 'cache-based'}**`,
    `• Final role hierarchy verified: **${hierarchy.verified} roles**`,
    '',
    '✅ `/setup5` is additive/idempotent and now uses heartbeat-safe maintenance so Discord gateway heartbeats are not starved during the migration.'
  ].join('\n'));
}
