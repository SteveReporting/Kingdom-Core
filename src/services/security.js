import { AuditLogEvent, EmbedBuilder } from 'discord.js';
import { BOT_ADD_TRUST_KEYS, BRAND } from '../config/blueprint.js';
import { readGuildState } from '../storage/store.js';

async function sendSecurityLog(guild, state, payload) {
  const channelId = state.setup?.channels?.securityLog;
  const channel = channelId ? guild.channels.cache.get(channelId) : null;
  if (channel?.isTextBased()) await channel.send(payload).catch(() => null);
}

async function isTrustedBotAdder(guild, state, userId) {
  if (!userId) return false;
  if (userId === guild.ownerId) return true;
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return false;
  const trustedRoleIds = BOT_ADD_TRUST_KEYS.map((key) => state.setup?.roles?.[key]).filter(Boolean);
  return trustedRoleIds.some((id) => member.roles.cache.has(id));
}

export async function handleAuditLogEntry(entry, guild, clientUserId) {
  const state = await readGuildState(guild.id);
  if (!state.setup?.completedAt) return;

  const auditMirrorId = state.setup?.channels?.auditMirror;
  const auditMirror = auditMirrorId ? guild.channels.cache.get(auditMirrorId) : null;
  if (auditMirror?.isTextBased()) {
    const embed = new EmbedBuilder()
      .setColor(BRAND.color)
      .setTitle('👁️ Audit Event')
      .setDescription(`**Action:** ${String(entry.action)}\n**Executor:** ${entry.executorId ? `<@${entry.executorId}>` : 'Unknown'}\n**Target:** ${entry.targetId ?? 'Unknown'}`)
      .setTimestamp();
    await auditMirror.send({ embeds: [embed] }).catch(() => null);
  }

  if (entry.action !== AuditLogEvent.BotAdd || !state.security?.blockUnauthorizedBots) return;
  const addedBotId = entry.targetId;
  if (!addedBotId || addedBotId === clientUserId) return;

  const trusted = await isTrustedBotAdder(guild, state, entry.executorId);
  const botMember = await guild.members.fetch(addedBotId).catch(() => null);

  if (trusted) {
    await sendSecurityLog(guild, state, {
      embeds: [new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle('🤖 Authorized Bot Added')
        .setDescription(`Bot <@${addedBotId}> was added by ${entry.executorId ? `<@${entry.executorId}>` : 'an unknown user'}.`)
        .setTimestamp()]
    });
    return;
  }

  let removed = false;
  if (botMember?.kickable) {
    await botMember.kick('Kingdom Core: unauthorized bot addition blocked').then(() => { removed = true; }).catch(() => null);
  }

  await sendSecurityLog(guild, state, {
    embeds: [new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle('🚨 Unauthorized Bot Addition')
      .setDescription([
        `**Bot:** <@${addedBotId}> (${addedBotId})`,
        `**Added by:** ${entry.executorId ? `<@${entry.executorId}>` : 'Unknown'}`,
        `**Action:** ${removed ? 'Bot automatically kicked.' : 'Could not kick bot — check Kingdom Core role hierarchy.'}`
      ].join('\n'))
      .setTimestamp()]
  });
}
