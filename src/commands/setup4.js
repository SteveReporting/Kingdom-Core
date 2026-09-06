import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { installCarrierDepartmentV3 } from '../services/carrierDepartmentV3.js';
import { installCarryPartiesV3 } from '../services/carryPartiesV3.js';
import { installCommunityV4 } from '../services/communityV4.js';
import { enforceSetup2Hierarchy } from '../services/hierarchySetup2.js';
import { installPlatformV4 } from '../services/platformV4.js';
import { runPlatformAutomationV4 } from '../services/platformV4Automation.js';
import { installPlatformV4Complete, runPlatformV4CompleteMaintenance } from '../services/platformV4Complete.js';
import { runV4Maintenance } from '../services/platformV4Runtime.js';
import { installStatsAndVerification } from '../services/serverStatsVerification.js';

export const data = new SlashCommandBuilder()
  .setName('setup4')
  .setDescription('Install or repair the advanced Kingdom Core v4.2 operating platform.')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false);

export async function execute(interaction) {
  if (!interaction.inGuild()) return;
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: 'Only a server administrator can run `/setup4`.', flags: MessageFlags.Ephemeral });
  }
  if (!interaction.guild.members.me?.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: 'Kingdom Core needs **Administrator** for `/setup4`.', flags: MessageFlags.Ephemeral });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  let last = 0;
  const progress = async (text) => {
    const now = Date.now();
    if (now - last < 450) return;
    last = now;
    await interaction.editReply(`👑 **KINGDOM CORE /setup4 • v4.2 MIGRATION**\n${text}`).catch(() => null);
  };

  await progress('01/08 • Repairing live statistics + verification intelligence…');
  await installStatsAndVerification(interaction.guild);

  await progress('02/08 • Repairing grouped carry orchestration and ready checks…');
  const carries = await installCarryPartiesV3(interaction.guild);

  await progress('03/08 • Repairing Knight Department webhooks, trials and documents…');
  await installCarrierDepartmentV3(interaction.guild);

  await progress('04/08 • Installing the v4 platform schema, security and core controls…');
  const platform = await installPlatformV4(interaction.guild, progress);

  await progress('05/08 • Installing community automation, events, mentors and Archives…');
  const community = await installCommunityV4(interaction.guild);

  await progress('06/08 • Installing premium v4.2 control planes and missing workflows…');
  const complete = await installPlatformV4Complete(interaction.guild);

  await progress('07/08 • Running event, quest, House, referral, watchlist and analytics automation…');
  await runV4Maintenance(interaction.guild);
  await runPlatformAutomationV4(interaction.guild);
  await runPlatformV4CompleteMaintenance(interaction.guild);

  await progress('08/08 • Enforcing and verifying the final role hierarchy…');
  const hierarchy = await enforceSetup2Hierarchy(interaction.guild);

  await interaction.editReply([
    '👑 **KINGDOM CORE v4.2 • ADVANCED PLATFORM ONLINE**',
    '',
    `• Base platform channels added only where missing: **${platform.summary.channelsCreated}**`,
    `• Community channels added only where missing: **${community.channelsCreated}**`,
    `• Premium control surfaces added/repaired: **${complete.created}**`,
    `• Premium pinned dashboards refreshed: **${complete.panels}**`,
    `• Compatible carry parties merged: **${carries.merged ?? 0}**`,
    '',
    '**CARRY + KNIGHT**',
    '• grouped/joinable carries • ready checks • state machine • recovery • no-shows',
    '• demand/ETA intelligence • service time • reputation • commendations • Academy • coverage',
    '',
    '**KINGDOM + ECONOMY**',
    '• identities • XP • prestige • Houses • live quest progression • quality referrals',
    '• treasury approvals/inventory/loans • marketplace search/watchlists/intelligence',
    '',
    '**STAFF + SECURITY**',
    '• application scoring/analytics • unified ticket ownership/SLA/escalation/summaries',
    '• audit ledger • bot/webhook governance • risk engine • lockdown • drift detection/repair',
    '',
    '**PLATFORM**',
    '• public/member/Knight/staff dashboards • analytics • workflow/event engine',
    '• staging + integration/permission tests • digital twin • optional API/WebSocket/Postgres/Redis/worker',
    '',
    `✅ Final role hierarchy verified: **${hierarchy.verified} roles**.`,
    '✅ `/setup4` is idempotent: rerunning repairs v4.2 rather than intentionally wiping the server.'
  ].join('\n'));
}
