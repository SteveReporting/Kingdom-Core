import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { installLevelRoles } from '../services/levelRoles.js';
import { installQueueV2 } from '../services/queueV2.js';
import { finishPermissionMatrix } from '../services/setup2Finishing.js';
import { installSetup3Ui } from '../services/setup3Upgrade.js';
import { upgradeGuild } from '../services/setupUpgrade.js';

export const data = new SlashCommandBuilder()
  .setName('setup3')
  .setDescription('Install the Kingdom Core v3 UI, application console, carry popup and level roles.')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false);

export async function execute(interaction) {
  if (!interaction.inGuild()) return;
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: 'Only a server administrator can run `/setup3`.', flags: MessageFlags.Ephemeral });
  }

  const me = interaction.guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      content: 'Kingdom Core needs **Administrator** before `/setup3` can repair roles, permissions, reactions and pinned control panels.',
      flags: MessageFlags.Ephemeral
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  let lastProgress = 0;
  const progress = async (message) => {
    const now = Date.now();
    if (now - lastProgress > 650) {
      lastProgress = now;
      await interaction.editReply(`👑 **Kingdom Core v3 Upgrade**\n${message}`).catch(() => null);
    }
  };

  await progress('Re-applying the safe setup2 security and workflow baseline…');
  const base = await upgradeGuild(interaction.guild, progress);

  await progress('Finishing explicit role/channel permission matrices…');
  const permissionRepairs = await finishPermissionMatrix(interaction.guild);

  await progress('Refreshing the live carry mission console…');
  const queue = await installQueueV2(interaction.guild);

  await progress('Creating self-assign Dungeon Quest level roles…');
  const levels = await installLevelRoles(interaction.guild);

  await progress('Installing polished Kingdom UI and the application control center…');
  const ui = await installSetup3Ui(interaction.guild, progress);

  const s = base.summary;
  await interaction.editReply([
    '✨ **Kingdom Core `/setup3` complete.**',
    '',
    '**SERVER REPAIR**',
    `• Roles reordered: **${s.rolesReordered}**`,
    `• Permission targets repaired: **${s.permissionsRepaired + permissionRepairs}**`,
    `• AutoMod rules updated: **${s.automodChanged}**`,
    '',
    '**V3 UI**',
    `• Panels upgraded/pinned: **${ui.summary.panelsUpdated} / ${ui.summary.panelsPinned}**`,
    `• New UI channels: **${ui.summary.channelsCreated}**`,
    `• Live carry console: **${queue ? 'READY' : 'UNCHANGED'}**`,
    '',
    '**APPLICATION SYSTEM**',
    '• Unified Application Hub with links for Staff / Carrier / Creator / Status',
    '• Staff Review Console with Pending / type / Interview / Approved / Denied / All views',
    '• Application grades: **S / A / B / C / D / F**',
    '• Private reviewer notes + Interview / Approve / Deny controls',
    '',
    '**CARRY SYSTEM**',
    '• Request Carry now opens a **popup modal**',
    '• Dungeon + Difficulty + Normal/Hardcore are dropdowns **inside the popup**',
    '• Live Queue still supports claim / remove / return / complete controls',
    '',
    '**LEVEL ROLES**',
    `• Self-assign level roles created: **${levels.roles}**`,
    '• `Lvl 0-9` → `Lvl 200+`',
    '• Dungeon progression is shown beside every range',
    '• **Lvl 150-159 → 🌋 Volcanic Chambers**',
    '• Members can hold only one level role at a time',
    '',
    '✅ Existing Kingdom channels were not rebuilt. `/setup3` upgrades and repairs the current server.'
  ].join('\n'));
}
