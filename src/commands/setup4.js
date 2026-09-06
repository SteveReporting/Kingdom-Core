import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { installCarrierDepartmentV3 } from '../services/carrierDepartmentV3.js';
import { installCarryPartiesV3 } from '../services/carryPartiesV3.js';
import { installCommunityV4 } from '../services/communityV4.js';
import { enforceSetup2Hierarchy } from '../services/hierarchySetup2.js';
import { installPlatformV4 } from '../services/platformV4.js';
import { installPlatformV4Complete, runPlatformV4CompleteMaintenance } from '../services/platformV4Complete.js';
import { runV4Maintenance } from '../services/platformV4Runtime.js';
import { installStatsAndVerification } from '../services/serverStatsVerification.js';

export const data = new SlashCommandBuilder()
  .setName('setup4')
  .setDescription('Install/repair the complete Kingdom Core v4 guild operating platform.')
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
    await interaction.editReply(`👑 **KINGDOM CORE /setup4 • COMPLETE PLATFORM MIGRATION**\n${text}`).catch(() => null);
  };

  await progress('01/09 • Repairing live statistics + verification intelligence…');
  await installStatsAndVerification(interaction.guild);

  await progress('02/09 • Rebuilding grouped carry orchestration, live joining and ready checks…');
  const carries = await installCarryPartiesV3(interaction.guild);

  await progress('03/09 • Repairing Knight Department webhooks, trials and documents…');
  await installCarrierDepartmentV3(interaction.guild);

  await progress('04/09 • Installing the core v4 schema, security and operating surfaces…');
  const platform = await installPlatformV4(interaction.guild, progress);

  await progress('05/09 • Installing events, notifications, mentors, archives and staff intelligence…');
  const community = await installCommunityV4(interaction.guild);

  await progress('06/09 • Completing approved v4.2 workflows, ledgers, consoles and premium UI…');
  const complete = await installPlatformV4Complete(interaction.guild);

  await progress('07/09 • Running analytics, retention, coverage, referrals, SLA and workflow maintenance…');
  await runV4Maintenance(interaction.guild);
  await runPlatformV4CompleteMaintenance(interaction.guild);

  await progress('08/09 • Capturing/validating platform assurance state…');
  await runPlatformV4CompleteMaintenance(interaction.guild);

  await progress('09/09 • Enforcing and verifying the final Discord role hierarchy…');
  const hierarchy = await enforceSetup2Hierarchy(interaction.guild);

  await interaction.editReply([
    '👑 **KINGDOM CORE v4.2 • COMPLETE PLATFORM ONLINE**',
    '',
    '**MIGRATION**',
    `• Base platform categories created/repaired: **${platform.summary.categoriesCreated}**`,
    `• Base control channels created/repaired: **${platform.summary.channelsCreated}**`,
    `• Community channels created/repaired: **${community.channelsCreated}**`,
    `• Premium control surfaces created/repaired: **${complete.created}**`,
    `• Premium pinned dashboards refreshed: **${complete.panels}**`,
    `• Duplicate compatible carry parties merged: **${carries.merged}**`,
    '',
    '**CARRY + KNIGHT OPERATIONS**',
    '• grouped carry orchestration + joinable live parties + ready checks',
    '• demand heatmap + predicted wait + recovery + no-show reliability',
    '• verified service + reputation + commendations + skill matrix + coverage planning',
    '',
    '**KINGDOM + ECONOMY**',
    '• Kingdom progression + House standings + quests + prestige',
    '• tracked treasury inventory + approvals + lending ledger',
    '• marketplace search + watchlists + market intelligence',
    '• member identity + verification/progression intelligence + quality referrals',
    '',
    '**STAFF OPERATIONS**',
    '• application workflow + structured scoring + analytics + staff briefs',
    '• unified ticket console + ownership + SLA + escalation + summaries',
    '• full v4 audit ledger + security risk + bot/webhook registry + drift repair + lockdown',
    '',
    '**PLATFORM**',
    '• public live operations + member dashboard + Knight Command + Royal Control Plane',
    '• event bus + workflow engine + retention/funnel/demand/coverage analytics',
    '• optional PostgreSQL + Redis + worker + HTTP API + WebSocket live feed',
    '• feature configuration + observability + self diagnostics + auto repair',
    '• staging support + runtime integration tests + real Discord permission tests + digital twin',
    '',
    `**ROLE HIERARCHY:** **${hierarchy.verified}** roles verified in order.`,
    '',
    '✅ `/setup4` is idempotent. Rerun it to repair v4.2 surfaces instead of recreating the server.'
  ].join('\n'));
}
