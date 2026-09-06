import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { BRAND } from '../config/blueprint.js';

function base(title, color = BRAND.color) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setFooter({ text: 'Kingdom Carries • Powered by Kingdom Core' })
    .setTimestamp();
}

function channelUrl(guildId, channelId) {
  return channelId ? `https://discord.com/channels/${guildId}/${channelId}` : null;
}

function linkButton(label, emoji, guildId, channelId) {
  const url = channelUrl(guildId, channelId);
  if (url) return new ButtonBuilder().setLabel(label).setEmoji(emoji).setStyle(ButtonStyle.Link).setURL(url);
  return new ButtonBuilder().setCustomId(`kc2:missing:${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`).setLabel(label).setEmoji(emoji).setStyle(ButtonStyle.Secondary).setDisabled(true);
}

export function welcomePremium(guild, state) {
  const c = state.setup?.channels ?? {};
  const hero = base('👑 KINGDOM CARRIES • ENTER THE REALM')
    .setDescription([
      '**Free carries are the gateway. The Kingdom is everything around them.**',
      '',
      'Request Dungeon Quest carries, join a House, build your progression, trade safely, compete in events and rise through the Realm.',
      '',
      '> **Traveller → Citizen → Noble → Champion.**',
      '> Your activity should mean something here.'
    ].join('\n'))
    .addFields(
      { name: '⚔️ FREE CARRIES', value: 'Private mission tickets • live Knight claiming • completion tracking', inline: true },
      { name: '🏰 KINGDOM HOUSES', value: 'Choose a House • compete • progress with your team', inline: true },
      { name: '📜 PROGRESSION', value: 'Levels • quests • achievements • Kingdom milestones', inline: true },
      { name: '💰 MARKET DISTRICT', value: 'Trading • price checks • treasury • proof', inline: true },
      { name: '🎪 COMMUNITY', value: 'Events • giveaways • campaigns • game nights', inline: true },
      { name: '🕯️ ROYAL SUPPORT', value: 'Private petitions • reports • partnerships • appeals', inline: true }
    );

  const start = base('🗺️ YOUR FIRST FIVE MINUTES', 0x5865f2)
    .setDescription([
      `**01** Read <#${c.rules}>`,
      `**02** Choose your House in <#${c.chooseHouse}>`,
      `**03** Set notifications in <#${c.roles}>`,
      `**04** Select your Dungeon Quest level in <#${c.levelRoles ?? c.kingdomProgress}>`,
      `**05** Need a run? Open <#${c.carryBoard}>`
    ].join('\n'));

  const row = new ActionRowBuilder().addComponents(
    linkButton('Request Carry', '⚔️', guild.id, c.carryBoard),
    linkButton('Applications', '📨', guild.id, c.applicationHub ?? c.staffApplications),
    linkButton('Level Roles', '📈', guild.id, c.levelRoles),
    linkButton('Support', '🕯️', guild.id, c.supportPanel)
  );

  return { embeds: [hero, start], components: [row], allowedMentions: { parse: [] } };
}

export function rulesPremium() {
  const laws = base('📜 THE LAWS OF THE REALM')
    .setDescription('**Simple rules. Consistent enforcement. No unnecessary bureaucracy.**')
    .addFields(
      { name: '01 • Respect people', value: 'No harassment, hate, threats, targeted abuse or deliberate toxicity.' },
      { name: '02 • Carries remain free', value: 'Official Kingdom Carries runs may never be sold or paywalled.' },
      { name: '03 • Trade honestly', value: 'Scams, fake proof, impersonation and knowingly deceptive trades are prohibited.' },
      { name: '04 • Protect the server', value: 'No raids, spam, mass mentions, malicious links, webhook abuse or unauthorized bots.' },
      { name: '05 • Keep content appropriate', value: 'Follow Discord Terms and keep public channels suitable for the community.' },
      { name: '06 • Respect moderation', value: 'Staff actions are logged and should be proportionate. Use the appeal system if you disagree.' }
    );

  const enforcement = base('🛡️ HOW ENFORCEMENT WORKS', 0xed4245)
    .setDescription([
      '**Warnings → timeout → kick → ban** depending on severity and history.',
      'Serious raids, scams, malicious bot activity or credible threats may skip lower stages.',
      '',
      '> Security automation is designed to stop obvious abuse without flooding members with unnecessary bot messages.'
    ].join('\n'));
  return { embeds: [laws, enforcement], allowedMentions: { parse: [] } };
}

export function housePremium() {
  const embed = base('🏰 CHOOSE YOUR HOUSE')
    .setDescription([
      '**Your House is your team inside Kingdom Carries.**',
      'House activity can feed seasonal rankings, quests, campaigns and special events.',
      '',
      'Pick the identity that fits you best. You can only represent **one House at a time**.'
    ].join('\n'))
    .addFields(
      { name: '🐉 HOUSE DRAKON', value: '**Competition • Strength • Ambition**\nFor players who want to win everything.', inline: true },
      { name: '🦁 HOUSE LEONIS', value: '**Loyalty • Community • Leadership**\nFor players who build the Realm around them.', inline: true },
      { name: '🦅 HOUSE AETHER', value: '**Progression • Grinding • Achievement**\nFor players chasing every milestone.', inline: true },
      { name: '🐺 HOUSE FENRIR', value: '**Carries • Combat • Speed**\nFor runners, Knights and dungeon specialists.', inline: true }
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('kc:house:houseDrakon').setLabel('Drakon').setEmoji('🐉').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('kc:house:houseLeonis').setLabel('Leonis').setEmoji('🦁').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('kc:house:houseAether').setLabel('Aether').setEmoji('🦅').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('kc:house:houseFenrir').setLabel('Fenrir').setEmoji('🐺').setStyle(ButtonStyle.Secondary)
  );
  return { embeds: [embed], components: [row], allowedMentions: { parse: [] } };
}

export function notificationsPremium() {
  const embed = base('🔔 YOUR NOTIFICATION LOADOUT')
    .setDescription([
      '**Opt into only what you care about.**',
      'Kingdom Core keeps pings targeted instead of turning every announcement into `@everyone`.',
      '',
      'Click a button to toggle that role on or off.'
    ].join('\n'))
    .addFields(
      { name: '⚔️ Carry Pings', value: 'Carry openings and major carry events', inline: true },
      { name: '🎪 Event Pings', value: 'Guild events, campaigns and game nights', inline: true },
      { name: '🏪 Market Pings', value: 'Marketplace and treasury notices', inline: true },
      { name: '🎁 Giveaways', value: 'Giveaway openings and winners', inline: true },
      { name: '📢 Updates', value: 'Major Kingdom system and server changes', inline: true }
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('kc:role:carryPing').setLabel('Carries').setEmoji('⚔️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('kc:role:eventPing').setLabel('Events').setEmoji('🎪').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('kc:role:marketPing').setLabel('Market').setEmoji('🏪').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('kc:role:giveawayPing').setLabel('Giveaways').setEmoji('🎁').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('kc:role:updatePing').setLabel('Updates').setEmoji('📢').setStyle(ButtonStyle.Secondary)
  );
  return { embeds: [embed], components: [row], allowedMentions: { parse: [] } };
}

export function supportPremium() {
  const embed = base('🕯️ PETITION THE CROWN • PRIVATE SUPPORT')
    .setDescription([
      '**One ticket desk for anything that genuinely needs staff.**',
      'Opening a petition creates a private channel and a staff control-card automatically.',
      '',
      'Choose the route that best matches what you need.'
    ].join('\n'))
    .addFields(
      { name: '🛟 Support', value: 'General server, carry or account/community help', inline: true },
      { name: '🚨 Report', value: 'Member, scam, safety or staff concern', inline: true },
      { name: '🤝 Partnership', value: 'Guild, creator or community collaboration', inline: true },
      { name: '⚖️ Appeal', value: 'Request review of a moderation action', inline: true }
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('kc:ticket:new:support').setLabel('Support').setEmoji('🛟').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('kc:ticket:new:report').setLabel('Report').setEmoji('🚨').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('kc:ticket:new:partnership').setLabel('Partnership').setEmoji('🤝').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('kc:ticket:new:appeal').setLabel('Appeal').setEmoji('⚖️').setStyle(ButtonStyle.Secondary)
  );
  return { embeds: [embed], components: [row], allowedMentions: { parse: [] } };
}

export function securityPremium(config = {}) {
  const spamLimit = config.spamLimit ?? 9;
  const seconds = Math.round((config.spamWindowMs ?? 7000) / 1000);
  const timeout = Math.round((config.spamTimeoutMs ?? 300000) / 60000);
  const embed = base('🛡️ KINGDOM SECURITY • LIVE DEFENCE STACK', 0xed4245)
    .setDescription([
      '**Layered protection without turning the server into a moderation bot feed.**',
      '',
      'Kingdom Core combines Discord AutoMod, audit-log monitoring and event-based safeguards.'
    ].join('\n'))
    .addFields(
      { name: '🤖 BOT GATE', value: config.blockUnauthorizedBots === false ? '🔴 Disabled' : '🟢 Unauthorized bot additions are removed' },
      { name: '💬 MESSAGE BURST SHIELD', value: `🟢 ${spamLimit} messages / ${seconds}s → ${timeout} minute automatic timeout` },
      { name: '📣 MENTION RAID PROTECTION', value: '🟢 Discord AutoMod blocks mass-mention abuse and reports it privately' },
      { name: '👁️ AUDIT WATCH', value: '🟢 High-impact role, channel, webhook, guild and moderation changes are mirrored' },
      { name: '🪝 BRANDED SYSTEM STREAMS', value: '🟢 Security, applications, carries and operations are separated into dedicated webhook streams' },
      { name: '🔕 ANTI-SPAM DESIGN', value: 'Alerts avoid public ping storms; internal bot actions are filtered from noisy audit loops' }
    );
  return { embeds: [embed], allowedMentions: { parse: [] } };
}

export function questPremium() {
  const embed = base('📜 THE ROYAL QUEST BOARD')
    .setDescription([
      '**Carries should contribute to something bigger than a queue number.**',
      'Kingdom quests turn normal activity into server-wide progression.'
    ].join('\n'))
    .addFields(
      { name: '☀️ DAILY', value: 'Complete runs • help members • participate in the Realm', inline: true },
      { name: '🌙 WEEKLY', value: 'Community carry totals • House goals • event objectives', inline: true },
      { name: '👑 KINGDOM', value: 'Long-form campaigns, milestones and world objectives', inline: true }
    )
    .setDescription([
      '**Carries should contribute to something bigger than a queue number.**',
      'Kingdom quests turn normal activity into server-wide progression.',
      '',
      '> Quest automation can build directly on verified carry completions and future event data.'
    ].join('\n'));
  return { embeds: [embed], allowedMentions: { parse: [] } };
}
