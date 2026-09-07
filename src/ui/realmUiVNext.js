import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { BRAND } from '../config/blueprint.js';
import { applicationHubPayload, applicationReviewDeskPayload } from '../services/applicationLinks.js';

const C = {
  gold: 0xd4af37,
  royal: 0x7c3aed,
  blue: 0x3498db,
  green: 0x57f287,
  red: 0xed4245,
  amber: 0xf1c40f,
  slate: 0x5865f2
};

function base(guild, title, subtitle, color = C.gold) {
  const embed = new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: 'KINGDOM CARRIES • REALM INTERFACE' })
    .setTitle(title)
    .setDescription(subtitle)
    .setFooter({ text: 'Kingdom Core • UI vNext' })
    .setTimestamp();
  const icon = guild?.iconURL?.({ size: 128 });
  if (icon) embed.setThumbnail(icon);
  return embed;
}

function row(...items) {
  return new ActionRowBuilder().addComponents(...items.filter(Boolean));
}

function button(id, label, emoji, style = ButtonStyle.Secondary) {
  return new ButtonBuilder().setCustomId(id).setLabel(label).setEmoji(emoji).setStyle(style);
}

function link(label, emoji, url) {
  if (!/^https?:\/\//i.test(String(url ?? ''))) return null;
  return new ButtonBuilder().setLabel(label).setEmoji(emoji).setStyle(ButtonStyle.Link).setURL(url);
}

function channelMention(guild, state, key, fallback = 'Not configured') {
  const id = state.setup?.channels?.[key];
  return id && guild.channels.cache.has(id) ? `<#${id}>` : fallback;
}

export function welcomeVNext(guild, state) {
  return {
    embeds: [base(guild, '👑 Welcome to Kingdom Carries', '**Free Dungeon Quest carries, organised like a real operating guild.**')
      .addFields(
        { name: '⚔️ Get Carried', value: `${channelMention(guild, state, 'carryBoard')}\nJoin the live queue and follow your run from request to completion.`, inline: true },
        { name: '🏰 Join a House', value: `${channelMention(guild, state, 'chooseHouse')}\nDrakon • Leonis • Aether • Fenrir.`, inline: true },
        { name: '🕯️ Need Help?', value: `${channelMention(guild, state, 'supportPanel')}\nPrivate support, reports, appeals and partnerships.`, inline: true },
        { name: 'START HERE', value: '1. Verify your account\n2. Read the important information\n3. Choose notification roles\n4. Join a House\n5. Use the carry board' }
      )],
    components: [row(
      button('kc:carry:join', 'Request a Carry', '⚔️', ButtonStyle.Success),
      button('kc:ticket:new:support', 'Get Support', '🕯️', ButtonStyle.Primary)
    )],
    allowedMentions: { parse: [] }
  };
}

export function verificationVNext(guild) {
  return {
    embeds: [base(guild, '✅ Verification Gate', 'Verify once, then Kingdom Core can safely connect your server identity to carries, progression and applications.', C.green)
      .addFields(
        { name: '01 • Verify with Bloxlink', value: 'Use the Bloxlink verification command/button available in this channel.' },
        { name: '02 • Confirm your nickname', value: 'Your Discord identity should match the Roblox account you intend to use in Dungeon Quest.' },
        { name: '03 • Continue', value: 'Once verified, continue through the server guide and choose your House/notification roles.' },
        { name: 'Privacy', value: 'Kingdom Core stores operational guild data such as carry/application state; never post passwords, cookies or private account credentials.' }
      )],
    allowedMentions: { parse: [] }
  };
}

export function rulesVNext(guild) {
  return {
    embeds: [base(guild, '📜 Laws of the Realm', 'Simple rules, consistently enforced.', C.amber)
      .addFields(
        { name: '01 • Respect', value: 'No harassment, hate, threats, targeted abuse or deliberate disruption.' },
        { name: '02 • Carries Stay Free', value: 'Official Kingdom Carries runs are free. Do not charge members for official carries.' },
        { name: '03 • Trade Honestly', value: 'No scams, fake proof, impersonation or deceptive listings.' },
        { name: '04 • No Spam / Raids', value: 'No message floods, mass mentions, malicious webhooks, unauthorized bots or coordinated disruption.' },
        { name: '05 • Use the Right Systems', value: 'Use support, applications, carries and marketplace tools instead of bypassing them through DMs.' },
        { name: '06 • Discord Rules Apply', value: 'Discord Terms and Community Guidelines always apply.' }
      )],
    allowedMentions: { parse: [] }
  };
}

export function houseVNext(guild) {
  return {
    embeds: [base(guild, '🏰 Choose Your House', 'Your House is your team inside the Kingdom.', C.royal)
      .addFields(
        { name: '🐉 Drakon', value: 'Competition • ambition • strength', inline: true },
        { name: '🦁 Leonis', value: 'Loyalty • leadership • community', inline: true },
        { name: '🦅 Aether', value: 'Progression • grinding • achievement', inline: true },
        { name: '🐺 Fenrir', value: 'Carries • combat • speed', inline: true },
        { name: 'House System', value: 'House activity feeds progression, quests, events and seasonal competition. You may only represent one House at a time.' }
      )],
    components: [row(
      button('kc:house:houseDrakon', 'Drakon', '🐉', ButtonStyle.Danger),
      button('kc:house:houseLeonis', 'Leonis', '🦁', ButtonStyle.Primary),
      button('kc:house:houseAether', 'Aether', '🦅', ButtonStyle.Primary),
      button('kc:house:houseFenrir', 'Fenrir', '🐺', ButtonStyle.Secondary)
    )],
    allowedMentions: { parse: [] }
  };
}

export function notificationsVNext(guild) {
  return {
    embeds: [base(guild, '🔔 Notification Centre', 'Choose only what you actually want to be pinged for.', C.blue)
      .addFields(
        { name: '⚔️ Carry Pings', value: 'Carry openings, demand and service events.', inline: true },
        { name: '🎪 Event Pings', value: 'Guild events and tournaments.', inline: true },
        { name: '🏪 Market Pings', value: 'Marketplace and trading alerts.', inline: true },
        { name: '🎁 Giveaway Pings', value: 'Giveaways and reward drops.', inline: true },
        { name: '📢 Update Pings', value: 'Important Kingdom updates.', inline: true }
      )],
    components: [row(
      button('kc:role:carryPing', 'Carries', '⚔️', ButtonStyle.Primary),
      button('kc:role:eventPing', 'Events', '🎪', ButtonStyle.Primary),
      button('kc:role:marketPing', 'Market', '🏪', ButtonStyle.Success),
      button('kc:role:giveawayPing', 'Giveaways', '🎁', ButtonStyle.Success),
      button('kc:role:updatePing', 'Updates', '📢', ButtonStyle.Secondary)
    )],
    allowedMentions: { parse: [] }
  };
}

export function guideVNext(guild, state) {
  return {
    embeds: [base(guild, '🗺️ Kingdom Server Guide', 'Everything important, without making you read a wall of channels.')
      .addFields(
        { name: '⚔️ Carries', value: `${channelMention(guild, state, 'carryBoard')} — request and track free carries.` },
        { name: '💰 Market', value: `${channelMention(guild, state, 'marketplace')} — trading, price checks and treasury systems.` },
        { name: '📨 Applications', value: `${channelMention(guild, state, 'applicationHub')} — staff, Knight and creator applications.` },
        { name: '🏰 Houses', value: `${channelMention(guild, state, 'chooseHouse')} — choose your House and join its community.` },
        { name: '🕯️ Support', value: `${channelMention(guild, state, 'supportPanel')} — one private entry point for help, reports, appeals and partnerships.` },
        { name: 'Progression', value: 'Carry participation, quests, Houses, service and community contributions feed Kingdom progression.' }
      )],
    allowedMentions: { parse: [] }
  };
}

export function levelRolesVNext(guild) {
  return {
    embeds: [base(guild, '📈 Realm Progression Roles', 'Activity roles recognise long-term participation without replacing meaningful staff or Knight ranks.', C.royal)
      .addFields(
        { name: 'How it works', value: 'Participate normally. Kingdom Core tracks eligible progression and updates your milestone role when requirements are met.' },
        { name: 'Do not farm', value: 'Spam, low-quality messages and artificial activity are not legitimate progression.' },
        { name: 'Keep roles meaningful', value: 'Staff, House and Knight roles are separate from activity progression.' }
      )],
    allowedMentions: { parse: [] }
  };
}

export function carryBoardVNext(guild) {
  return {
    embeds: [base(guild, '⚔️ Royal Carry Board', '**Free carries. Live queue. Clear ownership.**', C.green)
      .addFields(
        { name: '01 • Request', value: 'Press **Request Carry** and choose the exact dungeon/difficulty.', inline: true },
        { name: '02 • Queue', value: 'Kingdom Core places you into the live queue and tracks your position.', inline: true },
        { name: '03 • Knight', value: 'An available Knight claims the oldest suitable request.', inline: true },
        { name: '04 • Ready', value: 'Follow the ready-check instructions when your party is formed.', inline: true },
        { name: '05 • Complete', value: 'Completion feeds service history and Kingdom statistics.', inline: true },
        { name: 'Rule', value: '**One active request per member. Official carries are free.**', inline: true }
      )],
    components: [row(
      button('kc:carry:join', 'Request Carry', '⚔️', ButtonStyle.Success),
      button('kc:carry:leave', 'Leave Queue', '✖️', ButtonStyle.Secondary),
      button('kc:carry:claim', 'Claim Next', '🛡️', ButtonStyle.Primary)
    )],
    allowedMentions: { parse: [] }
  };
}

export function supportVNext(guild) {
  return {
    embeds: [base(guild, '🕯️ Petition the Crown', 'One clean support entry point. Your case becomes private immediately.', C.slate)
      .addFields(
        { name: '🛟 Support', value: 'General server, carry or account-related help.', inline: true },
        { name: '🚨 Report', value: 'Privately report a member, scam or staff concern.', inline: true },
        { name: '🤝 Partnership', value: 'Guild, creator or community collaboration.', inline: true },
        { name: '⚖️ Appeal', value: 'Appeal a moderation decision with context/evidence.', inline: true },
        { name: 'Case Handling', value: 'Tickets have ownership, escalation, status and an auditable resolution trail.' }
      )],
    components: [row(
      button('kc:ticket:new:support', 'Support', '🛟', ButtonStyle.Primary),
      button('kc:ticket:new:report', 'Report', '🚨', ButtonStyle.Danger),
      button('kc:ticket:new:partnership', 'Partnership', '🤝', ButtonStyle.Success),
      button('kc:ticket:new:appeal', 'Appeal', '⚖️', ButtonStyle.Secondary)
    )],
    allowedMentions: { parse: [] }
  };
}

export function applicationStatusVNext(guild) {
  return {
    embeds: [base(guild, '📌 Application Status', 'Final application outcomes are posted here. Written answers and reviewer notes remain private to staff.', C.blue)
      .addFields(
        { name: 'Status Flow', value: '🟡 Pending → 🔵 Interview (if needed) → 🟢 Accepted / 🔴 Denied' },
        { name: 'Accepted Applicants', value: 'Kingdom Core grants configured role access and sends onboarding resources by DM.' }
      )],
    allowedMentions: { parse: [] }
  };
}

export function genericInfoVNext(guild, title, description, color = C.gold, fields = []) {
  return { embeds: [base(guild, title, description, color).addFields(...fields)], allowedMentions: { parse: [] } };
}

export function securityVNext(guild, state) {
  return {
    embeds: [base(guild, '🛡️ Kingdom Security Command', 'Security controls and health belong here; raw logs remain in dedicated log channels.', C.red)
      .addFields(
        { name: 'Bot Authorization', value: state.security?.blockUnauthorizedBots === false ? '🟡 Restricted protection disabled' : '🟢 Unauthorized bot protection enabled', inline: true },
        { name: 'Operational State', value: `**${String(state.securityV4?.state ?? 'NORMAL').toUpperCase()}**`, inline: true },
        { name: 'Risk', value: `**${state.securityV4?.riskScore ?? 0}/100**`, inline: true },
        { name: 'Protected Surfaces', value: 'Audit events • bot additions • webhooks • spam/raid signals • permission drift • lockdown controls' },
        { name: 'Safety Model', value: 'Known-safe repairs may be automated. Destructive security actions still require staff authority.' }
      )],
    allowedMentions: { parse: [] }
  };
}

export function staffCommandVNext(guild, state) {
  const openApps = Object.values(state.applications ?? {}).filter((a) => ['pending', 'interview'].includes(String(a.status ?? '').toLowerCase())).length;
  const openTickets = Object.values(state.tickets ?? state.petitions ?? {}).filter((t) => !['closed', 'resolved'].includes(String(t.status ?? '').toLowerCase())).length;
  return {
    embeds: [base(guild, '👑 Staff Command Centre', 'The operational front door for Kingdom staff.', C.royal)
      .addFields(
        { name: '📨 Applications', value: `**${openApps}** awaiting action`, inline: true },
        { name: '🕯️ Cases', value: `**${openTickets}** open/active`, inline: true },
        { name: '🛡️ Security', value: `Risk **${state.securityV4?.riskScore ?? 0}/100**`, inline: true },
        { name: 'Use the dedicated consoles', value: 'Application grading, ticket ownership, security controls and analytics remain separated so staff do not need dozens of slash commands.' }
      )],
    components: [row(
      button('kc2:apps:next', 'Review Applications', '📨', ButtonStyle.Primary)
    )],
    allowedMentions: { parse: [] }
  };
}

export function eventVNext(guild) {
  return genericInfoVNext(guild, '🎪 Kingdom Events', 'Scheduled events, competitions and community sessions appear here.', C.royal, [
    { name: 'How to join', value: 'Use the RSVP controls on an event when they appear. Times should use Discord timestamps so they display in your timezone.' },
    { name: 'Event standards', value: 'Show up if you RSVP, follow host instructions and keep event channels clear while the event is running.' }
  ]);
}

export function giveawayVNext(guild) {
  return genericInfoVNext(guild, '🎁 Royal Giveaways', 'Official Kingdom giveaways and reward drops appear here.', C.green, [
    { name: 'Fairness', value: 'Entries and winners should be recorded by Kingdom systems where possible. Never pay to enter an official Kingdom giveaway.' },
    { name: 'Safety', value: 'Staff will never ask for your password, cookie, token or recovery code to deliver a prize.' }
  ]);
}

export function treasuryVNext(guild) {
  return genericInfoVNext(guild, '💰 Royal Treasury', 'Guild assets, lending and treasury requests are tracked rather than handled through random DMs.', C.amber, [
    { name: 'Ledger', value: 'Tracked donations, loans and approved treasury actions feed the Kingdom ledger.' },
    { name: 'Borrowing', value: 'Borrowed items should have an owner/custodian, borrower and return state.' },
    { name: 'Approvals', value: 'Sensitive treasury decisions remain staff-controlled.' }
  ]);
}

export function questVNext(guild) {
  return genericInfoVNext(guild, '📜 Royal Quest Board', 'Useful activity becomes progression: carries, events, mentoring and House objectives.', C.royal, [
    { name: 'Personal', value: 'Your quests should reward actual participation, not message farming.' },
    { name: 'House', value: 'House quests contribute to collaborative seasonal goals.' },
    { name: 'Realm', value: 'Community objectives can react to real guild needs such as carry demand.' }
  ]);
}

export function applicationHubVNext() {
  return applicationHubPayload();
}

export function applicationReviewVNext(state) {
  return applicationReviewDeskPayload(state);
}

export const REALM_UI_COLORS = C;
