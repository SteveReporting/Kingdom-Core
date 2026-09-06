import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { installCarrierDepartmentV3 } from '../services/carrierDepartmentV3.js';
import { installCarryPartiesV3 } from '../services/carryPartiesV3.js';
import { enforceSetup2Hierarchy } from '../services/hierarchySetup2.js';
import { installStatsAndVerification } from '../services/serverStatsVerification.js';

export const data = new SlashCommandBuilder()
  .setName('setup3')
  .setDescription('Add server stats, verification, grouped carries, ready checks and carrier department panels.')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false);

export async function execute(interaction) {
  if (!interaction.inGuild()) return;
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: 'Only a server administrator can run `/setup3`.', flags: MessageFlags.Ephemeral });
  }
  if (!interaction.guild.members.me?.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: 'Kingdom Core needs **Administrator** for `/setup3`.', flags: MessageFlags.Ephemeral });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  let last = 0;
  const progress = async (text) => {
    const now = Date.now();
    if (now - last < 600) return;
    last = now;
    await interaction.editReply(`🏰 **Kingdom Core /setup3**\n${text}`).catch(() => null);
  };

  await progress('Building live Server Stats and the Bloxlink verification gatehouse…');
  const stats = await installStatsAndVerification(interaction.guild);

  await progress('Upgrading carries into grouped parties with live joining and ready checks…');
  const carries = await installCarryPartiesV3(interaction.guild);

  await progress('Installing Carrier Department webhook panels, trials and document library…');
  const carrier = await installCarrierDepartmentV3(interaction.guild);

  await progress('Re-verifying the Kingdom role hierarchy after the addon…');
  const hierarchy = await enforceSetup2Hierarchy(interaction.guild);

  await interaction.editReply([
    '✨ **Kingdom Core `/setup3` complete.**',
    '',
    '**SERVER STATS + VERIFICATION**',
    '• `📊 SERVER STATS 📊` category installed',
    '• `all-members-*`, `members-*`, `bots-*` counters installed',
    '• `✅・VERIFICATION` category installed',
    '• `guide` + `✅・bloxlink-verification` installed and pinned',
    `• Member split currently: **${stats.snapshot.exact ? 'EXACT' : 'CACHE-BASED'}**`,
    '',
    '**GROUPED CARRIES**',
    '• Members can **join active carries from the Live Queue**',
    '• Exact matching requests automatically merge into one party',
    '• Carrier claim → **Ready Check** → everyone Ready → Start Carry → Complete',
    '• Knights/staff can remove party members before the run',
    `• Existing duplicate open requests merged: **${carries.merged}**`,
    '',
    '**CARRIER DEPARTMENT**',
    `• Branded webhook control panels installed: **${carrier.panels}**`,
    `• Carrier document slots: **${carrier.documents}**`,
    '• Knight Command / Trial Command / Carrier Library / Mission Dispatch',
    '',
    '**ROLE HIERARCHY**',
    `• Verified roles in correct order: **${hierarchy.verified}**`,
    '',
    stats.snapshot.exact
      ? '✅ Server human/bot counts are live and exact.'
      : '⚠️ For exact human/bot counters, enable the Discord **Server Members Intent** and set `ENABLE_MEMBER_STATS_INTENT=true` in `.env`, then restart Kingdom Core.'
  ].join('\n'));
}
