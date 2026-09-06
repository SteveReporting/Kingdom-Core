import { AuditLogEvent, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { BOT_ADD_TRUST_KEYS, BRAND, STAFF_KEYS } from '../config/blueprint.js';
import { readGuildState } from '../storage/store.js';
import { sendBrandedWebhook } from './webhooks.js';

const messageWindows = new Map();
const enforcementCooldowns = new Map();
const raidSignals = new Map();
const lastRaidAlert = new Map();
const securityStateCache = new Map();
const auditRateWindows = new Map();

const HIGH_RISK_AUDIT_ACTIONS = new Set([
  AuditLogEvent.BotAdd,
  AuditLogEvent.MemberBanAdd,
  AuditLogEvent.MemberKick,
  AuditLogEvent.MemberRoleUpdate,
  AuditLogEvent.RoleCreate,
  AuditLogEvent.RoleDelete,
  AuditLogEvent.RoleUpdate,
  AuditLogEvent.ChannelCreate,
  AuditLogEvent.ChannelDelete,
  AuditLogEvent.ChannelUpdate,
  AuditLogEvent.WebhookCreate,
  AuditLogEvent.WebhookDelete,
  AuditLogEvent.WebhookUpdate,
  AuditLogEvent.GuildUpdate
].filter((value) => value !== undefined));

async function cachedState(guildId) {
  const cached = securityStateCache.get(guildId);
  if (cached && cached.expiresAt > Date.now()) return cached.state;
  const state = await readGuildState(guildId);
  securityStateCache.set(guildId, { state, expiresAt: Date.now() + 30_000 });
  return state;
}

function auditName(action) {
  return AuditLogEvent[action] ?? `Action ${String(action)}`;
}

function allowAuditMirror(guildId) {
  const now = Date.now();
  const recent = (auditRateWindows.get(guildId) ?? []).filter((time) => now - time < 10_000);
  if (recent.length >= 8) {
    auditRateWindows.set(guildId, recent);
    return false;
  }
  recent.push(now);
  auditRateWindows.set(guildId, recent);
  return true;
}

async function sendSecurityLog(guild, state, payload) {
  const sent = await sendBrandedWebhook(guild, state, 'security', payload);
  if (sent) return;
  const channelId = state.setup?.channels?.securityLog;
  const channel = channelId ? guild.channels.cache.get(channelId) : null;
  if (channel?.isTextBased()) await channel.send({ ...payload, allowedMentions: { parse: [] } }).catch(() => null);
}

async function sendRaidAlert(guild, state, payload) {
  const channelId = state.setup?.channels?.raidAlerts;
  const channel = channelId ? guild.channels.cache.get(channelId) : null;
  if (channel?.isTextBased()) await channel.send({ ...payload, allowedMentions: { parse: [] } }).catch(() => null);
}

async function isTrustedBotAdder(guild, state, userId) {
  if (!userId) return false;
  if (userId === guild.ownerId) return true;
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return false;
  const trustedRoleIds = BOT_ADD_TRUST_KEYS.map((key) => state.setup?.roles?.[key]).filter(Boolean);
  return trustedRoleIds.some((id) => member.roles.cache.has(id));
}

function changeSummary(entry) {
  const changes = Array.isArray(entry.changes) ? entry.changes : [];
  if (!changes.length) return 'No structured change data.';
  return changes.slice(0, 8).map((change) => `• \`${change.key}\``).join('\n');
}

export async function handleAuditLogEntry(entry, guild, clientUserId) {
  const state = await cachedState(guild.id);
  if (!state.setup?.completedAt) return;

  if (HIGH_RISK_AUDIT_ACTIONS.has(entry.action) && allowAuditMirror(guild.id)) {
    const auditMirrorId = state.setup?.channels?.auditMirror;
    const auditMirror = auditMirrorId ? guild.channels.cache.get(auditMirrorId) : null;
    if (auditMirror?.isTextBased()) {
      const embed = new EmbedBuilder()
        .setColor(BRAND.color)
        .setTitle(`👁️ ${auditName(entry.action)}`)
        .setDescription([
          `**Executor:** ${entry.executorId ? `<@${entry.executorId}>` : 'Unknown'}`,
          `**Target:** ${entry.targetId ? `\`${entry.targetId}\`` : 'Unknown'}`,
          `**Reason:** ${entry.reason || 'None provided'}`,
          '',
          '**Changed fields**',
          changeSummary(entry)
        ].join('\n'))
        .setFooter({ text: 'High-impact audit events only • anti-flood enabled' })
        .setTimestamp();
      await auditMirror.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => null);
    }
  }

  if (entry.action === AuditLogEvent.WebhookCreate) {
    const trusted = await isTrustedBotAdder(guild, state, entry.executorId);
    if (!trusted) {
      await sendSecurityLog(guild, state, {
        embeds: [new EmbedBuilder()
          .setColor(0xfee75c)
          .setTitle('🪝 Webhook Created by Untrusted Role')
          .setDescription(`A webhook was created by ${entry.executorId ? `<@${entry.executorId}>` : 'an unknown user'}. Review the audit mirror before taking action.`)
          .setFooter({ text: BRAND.footer })
          .setTimestamp()]
      });
    }
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
        .setDescription(`**Bot:** <@${addedBotId}>\n**Added by:** ${entry.executorId ? `<@${entry.executorId}>` : 'Unknown'}`)
        .setFooter({ text: BRAND.footer })
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
      .setTitle('🚨 Unauthorized Bot Addition Blocked')
      .setDescription([
        `**Bot:** <@${addedBotId}> (\`${addedBotId}\`)`,
        `**Added by:** ${entry.executorId ? `<@${entry.executorId}>` : 'Unknown'}`,
        `**Result:** ${removed ? 'Bot automatically kicked.' : 'Could not kick bot — move Kingdom Core higher in the role hierarchy.'}`
      ].join('\n'))
      .setFooter({ text: BRAND.footer })
      .setTimestamp()]
  });
}

function memberIsExempt(member, state) {
  if (!member) return true;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  const staffIds = STAFF_KEYS.map((key) => state.setup?.roles?.[key]).filter(Boolean);
  return staffIds.some((id) => member.roles.cache.has(id));
}

function registerRaidSignal(guildId, userId) {
  const now = Date.now();
  const recent = (raidSignals.get(guildId) ?? []).filter((item) => now - item.time < 30_000);
  recent.push({ userId, time: now });
  raidSignals.set(guildId, recent);
  return new Set(recent.map((item) => item.userId)).size;
}

export async function handleMessageSpam(message) {
  if (!message.inGuild() || message.author.bot || !message.member) return;
  const state = await cachedState(message.guildId);
  const config = state.security ?? {};
  if (!config.messageSpamProtection || memberIsExempt(message.member, state)) return;

  const limit = Number(config.spamLimit ?? 9);
  const windowMs = Number(config.spamWindowMs ?? 7000);
  const timeoutMs = Number(config.spamTimeoutMs ?? 300000);
  const key = `${message.guildId}:${message.author.id}`;
  const now = Date.now();
  const recent = (messageWindows.get(key) ?? []).filter((time) => now - time < windowMs);
  recent.push(now);
  messageWindows.set(key, recent);
  if (recent.length < limit) return;

  const last = enforcementCooldowns.get(key) ?? 0;
  if (now - last < 60_000) return;
  enforcementCooldowns.set(key, now);
  messageWindows.set(key, []);

  let timedOut = false;
  if (message.member.moderatable) {
    await message.member.timeout(timeoutMs, `Kingdom Core anti-spam: ${limit} messages inside ${Math.round(windowMs / 1000)}s`)
      .then(() => { timedOut = true; })
      .catch(() => null);
  }

  const uniqueRaidSignals = registerRaidSignal(message.guildId, message.author.id);
  await sendSecurityLog(message.guild, state, {
    embeds: [new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle('💬 Spam Shield Triggered')
      .setDescription([
        `**Member:** <@${message.author.id}> (\`${message.author.id}\`)`,
        `**Burst:** ${recent.length} messages inside ${Math.round(windowMs / 1000)} seconds`,
        `**Action:** ${timedOut ? `${Math.round(timeoutMs / 60000)} minute timeout` : 'Could not timeout — check role hierarchy'}`,
        `**Channel:** <#${message.channelId}>`
      ].join('\n'))
      .setFooter({ text: BRAND.footer })
      .setTimestamp()]
  });

  const lastAlert = lastRaidAlert.get(message.guildId) ?? 0;
  if (uniqueRaidSignals >= 3 && now - lastAlert > 60_000) {
    lastRaidAlert.set(message.guildId, now);
    await sendRaidAlert(message.guild, state, {
      embeds: [new EmbedBuilder()
        .setColor(0xed4245)
        .setTitle('🚨 Possible Coordinated Spam / Raid')
        .setDescription(`**${uniqueRaidSignals} different members** triggered the burst detector within 30 seconds. Staff should review recent joins and the security log.`)
        .setFooter({ text: BRAND.footer })
        .setTimestamp()]
    });
  }
}
