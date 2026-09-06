import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { installCarrierDepartmentV3 } from '../services/carrierDepartmentV3.js';
import { installCarryPartiesV3 } from '../services/carryPartiesV3.js';
import { installCommunityV4 } from '../services/communityV4.js';
import { enforceSetup2Hierarchy } from '../services/hierarchySetup2.js';
import { installPlatformV4 } from '../services/platformV4.js';
import { runV4Maintenance } from '../services/platformV4Runtime.js';
import { installStatsAndVerification } from '../services/serverStatsVerification.js';

export const data = new SlashCommandBuilder()
  .setName('setup4')
  .setDescription('Migrate Kingdom Carries into the Kingdom Core v4 guild operating platform.')
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
    await interaction.editReply(`👑 **Kingdom Core /setup4 • Platform Migration**\n${text}`).catch(() => null);
  };

  await progress('Repairing the live stats + verification foundation…');
  await installStatsAndVerification(interaction.guild);

  await progress('Reconfiguring grouped carries, party joining and ready-check orchestration…');
  const carries = await installCarryPartiesV3(interaction.guild);

  await progress('Repairing Knight Department webhooks, trials and document surfaces…');
  await installCarrierDepartmentV3(interaction.guild);

  await progress('Installing the Kingdom Core v4 control plane and platform schema…');
  const platform = await installPlatformV4(interaction.guild, progress);

  await progress('Installing events, notifications, mentors, archives and staff intelligence…');
  const community = await installCommunityV4(interaction.guild);

  await progress('Running analytics, demand forecasting, quests and system diagnostics…');
  await runV4Maintenance(interaction.guild);

  await progress('Enforcing and verifying the final Discord role hierarchy…');
  const hierarchy = await enforceSetup2Hierarchy(interaction.guild);

  await interaction.editReply([
    '👑 **KINGDOM CORE v4 IS INSTALLED**',
    '',
    '**THE OPERATING PLATFORM**',
    '• Platform schema: **v4**',
    `• New platform categories: **${platform.summary.categoriesCreated}**`,
    `• New control channels: **${platform.summary.channelsCreated}**`,
    `• Community automation channels: **${community.channelsCreated}**`,
    `• Pinned operating dashboards: **${platform.summary.panels + community.panels}**`,
    `• Approved bot registry: **${platform.summary.approvedBots}**`,
    `• Registered webhooks: **${platform.summary.webhooks}**`,
    '',
    '**CARRY ORCHESTRATION**',
    '• grouped matching + live party joining',
    '• ready checks + mission state machine',
    '• demand heatmap + estimated queue times',
    '• recovery/return-to-pool workflow',
    `• duplicate carry parties merged during migration: **${carries.merged}**`,
    '',
    '**KNIGHT OPERATIONS**',
    '• verified service time + workload/reputation records',
    '• commendations + Knight profiles + Academy state',
    '• certifications/service/reputation control surfaces',
    '',
    '**KINGDOM SYSTEMS**',
    '• member identity + Kingdom XP + prestige',
    '• House standings + dynamic quest engine',
    '• treasury approvals + lending ledger',
    '• marketplace listings + market intelligence',
    '• opt-in notification router + smart demand alerts',
    '• Royal Calendar + RSVP + automatic teams + tournaments',
    '• mentor matching + Royal Archives + build advisor',
    '',
    '**COMMAND + SECURITY**',
    '• staff command center + application/ticket analytics',
    '• application/ticket/security/campaign staff briefs',
    '• server digital twin + drift audit/repair',
    '• bot/webhook registry + risk engine + emergency lockdown',
    '• versioned feature flags + health/self-diagnostics',
    '',
    '**PLATFORM ARCHITECTURE**',
    '• event/analytics state + demand forecasts + funnel metrics',
    '• optional read-only HTTP API + live WebSocket dashboard',
    '• optional PostgreSQL + Redis adapters + background worker',
    '• automated maintenance + migration/version state',
    '',
    `**ROLE HIERARCHY:** ${hierarchy.verified} roles verified in order.`,
    '',
    '✅ `/setup4` is idempotent: rerunning it repairs/upgrades the v4 surfaces instead of rebuilding the guild from scratch.'
  ].join('\n'));
}
