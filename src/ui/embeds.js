import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { BRAND } from '../config/blueprint.js';

function baseEmbed(color = BRAND.color) {
  return new EmbedBuilder()
    .setColor(color)
    .setFooter({ text: BRAND.footer })
    .setTimestamp();
}

export function welcomePanel(channels) {
  const embed = baseEmbed()
    .setTitle('👑 Welcome to Kingdom Carries')
    .setDescription([
      '**The Realm of Free Carries.**',
      'Request runs, join a House, progress through the Kingdom and build your reputation.',
      '',
      `⚔️ **Carries** — ${channels.carryBoard ?? '#carry-board'}`,
      `🏰 **Houses** — ${channels.chooseHouse ?? '#choose-your-house'}`,
      `📜 **Quests** — ${channels.quests ?? '#quest-board'}`,
      `💰 **Market** — ${channels.marketplace ?? '#marketplace'}`,
      `🕯️ **Support** — ${channels.supportPanel ?? '#petition-the-crown'}`
    ].join('\n'));
  return { embeds: [embed] };
}

export function rulesPanel() {
  const embed = baseEmbed()
    .setTitle('📜 Laws of the Realm')
    .setDescription([
      '**01 • Respect the Realm** — no harassment, hate, threats or targeted abuse.',
      '**02 • Trade Honestly** — scams, fake proof and dishonest trades are prohibited.',
      '**03 • Carries Stay Free** — official Kingdom Carries runs may never be sold.',
      '**04 • No Spam or Raids** — mass pings, message floods, webhook abuse and raids are blocked.',
      '**05 • Keep It Appropriate** — follow Discord rules and keep content suitable for the server.',
      '**06 • Staff Actions Are Logged** — moderation should be proportionate and reviewable.',
      '',
      '_Common sense applies. Security systems may automatically restrict obvious spam or unauthorized bots._'
    ].join('\n'));
  return { embeds: [embed] };
}

export function housePanel() {
  const embed = baseEmbed()
    .setTitle('🏰 Choose Your House')
    .setDescription([
      '> Your House is your team inside the Kingdom. House activity contributes to seasonal competition and progression.',
      '',
      '**🐉 Drakon** — competition, strength and ambition.',
      '**🦁 Leonis** — loyalty, community and leadership.',
      '**🦅 Aether** — progression, grinding and achievements.',
      '**🐺 Fenrir** — carries, combat and speedrunning.',
      '',
      '**One House at a time.** You can change later.'
    ].join('\n'));

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('kc:house:houseDrakon').setLabel('Drakon').setEmoji('🐉').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('kc:house:houseLeonis').setLabel('Leonis').setEmoji('🦁').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('kc:house:houseAether').setLabel('Aether').setEmoji('🦅').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('kc:house:houseFenrir').setLabel('Fenrir').setEmoji('🐺').setStyle(ButtonStyle.Secondary)
  );
  return { embeds: [embed], components: [row] };
}

export function notificationPanel() {
  const embed = baseEmbed()
    .setTitle('🔔 Notification Control')
    .setDescription('Choose only the alerts you want. Kingdom Core avoids unnecessary mass pings.');

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('kc:role:carryPing').setLabel('Carries').setEmoji('⚔️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('kc:role:eventPing').setLabel('Events').setEmoji('🎪').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('kc:role:marketPing').setLabel('Market').setEmoji('🏪').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('kc:role:giveawayPing').setLabel('Giveaways').setEmoji('🎁').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('kc:role:updatePing').setLabel('Updates').setEmoji('📢').setStyle(ButtonStyle.Secondary)
  );
  return { embeds: [embed], components: [row] };
}

export function carryPanel() {
  const embed = baseEmbed()
    .setTitle('⚔️ Royal Carry Board')
    .setDescription([
      '> **Free Dungeon Quest carries — built around a live first-come queue.**',
      '',
      '**1. Request Carry** — choose your dungeon from a menu.',
      '**2. Choose Difficulty** — select the exact difficulty/mode.',
      '**3. Wait in Queue** — your position is shown automatically.',
      '**4. Knight Claims Run** — a carrier takes the oldest request.',
      '**5. Completion Logged** — completed runs feed Kingdom statistics.',
      '',
      'You can have **one active request** at a time. No typing dungeon names or difficulties.'
    ].join('\n'));

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('kc:carry:join').setLabel('Request Carry').setEmoji('⚔️').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('kc:carry:leave').setLabel('Leave Queue').setEmoji('✖️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('kc:carry:claim').setLabel('Claim Next').setEmoji('🛡️').setStyle(ButtonStyle.Primary)
  );
  return { embeds: [embed], components: [row] };
}

export function supportPanel() {
  const embed = baseEmbed()
    .setTitle('🕯️ Petition the Crown')
    .setDescription([
      '> One private ticket system for the entire Kingdom.',
      '',
      '**🛟 Support** — general help, carry or account/server questions.',
      '**🚨 Report** — privately report a member, scam or staff concern.',
      '**🤝 Partnership** — guild, creator or community collaboration.',
      '**⚖️ Appeal** — appeal a moderation decision.',
      '',
      'Your ticket gets a private channel, staff overview entry, claim status and closure record.'
    ].join('\n'));

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('kc:ticket:new:support').setLabel('Support').setEmoji('🛟').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('kc:ticket:new:report').setLabel('Report').setEmoji('🚨').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('kc:ticket:new:partnership').setLabel('Partnership').setEmoji('🤝').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('kc:ticket:new:appeal').setLabel('Appeal').setEmoji('⚖️').setStyle(ButtonStyle.Secondary)
  );
  return { embeds: [embed], components: [row] };
}

const APPLICATION_COPY = {
  staff: {
    title: '🛡️ Royal Staff Application',
    description: 'Apply to help moderate and operate Kingdom Carries. Applications are read privately by the Royal Council.',
    button: 'Apply for Staff',
    emoji: '🛡️',
    style: ButtonStyle.Primary
  },
  carrier: {
    title: '⚔️ Knight Application',
    description: 'Apply to become a carrier. Accepted applicants begin as **Squire • Carrier Trial** before verification.',
    button: 'Apply for Carrier',
    emoji: '⚔️',
    style: ButtonStyle.Success
  },
  creator: {
    title: '🎥 Creator Application',
    description: 'Apply as a creator for events, collaborations, promotion and Kingdom content.',
    button: 'Apply as Creator',
    emoji: '🎥',
    style: ButtonStyle.Secondary
  }
};

export function applicationPanel(type) {
  const copy = APPLICATION_COPY[type] ?? APPLICATION_COPY.staff;
  const embed = baseEmbed()
    .setTitle(copy.title)
    .setDescription([
      `> ${copy.description}`,
      '',
      '**How it works**',
      '• Submit the form once.',
      '• Your answers are posted to the private application review panel.',
      '• Staff can mark it **Interview**, **Approve**, or **Deny**.',
      '• Decisions are recorded in the application status system.',
      '',
      '_Do not spam applications. Pending applications cannot be duplicated._'
    ].join('\n'));
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`kc:app:start:${type}`).setLabel(copy.button).setEmoji(copy.emoji).setStyle(copy.style)
  );
  return { embeds: [embed], components: [row] };
}

export function applicationReviewPanel() {
  return {
    embeds: [baseEmbed()
      .setTitle('📝 Royal Application Review Desk')
      .setDescription([
        '> New applications appear below as structured review cards.',
        '',
        '**Approve** — accepts the application and grants the trial role where applicable.',
        '**Interview** — marks it for follow-up without granting permissions.',
        '**Deny** — closes the application.',
        '',
        'Every decision records the reviewer and timestamp. Staff applications only grant the lowest trial staff role when approved.'
      ].join('\n'))]
  };
}

export function applicationStatusPanel() {
  return {
    embeds: [baseEmbed()
      .setTitle('📌 Application Status')
      .setDescription('Application decisions are recorded here without DM spam. Individual answers remain private in the Royal Council review channel.')]
  };
}

export function ticketOverviewPanel() {
  return {
    embeds: [baseEmbed()
      .setTitle('🎫 Petition Overview')
      .setDescription([
        '> Staff control center for all private petitions.',
        '',
        'New tickets create an overview card below with **type, owner, channel, priority and claim status**.',
        'Use the controls inside each ticket to **claim**, **escalate**, or **close** it.',
        'Closed tickets are made read-only and recorded in the transcript/archive channel.'
      ].join('\n'))]
  };
}

export function securityPanel(config = {}) {
  const spamLimit = config.spamLimit ?? 9;
  const windowSeconds = Math.round((config.spamWindowMs ?? 7000) / 1000);
  const timeoutMinutes = Math.round((config.spamTimeoutMs ?? 300000) / 60000);
  return {
    embeds: [baseEmbed(0xed4245)
      .setTitle('🛡️ Kingdom Security Command Center')
      .setDescription([
        '> Layered server protection using Discord AutoMod + Kingdom Core event detection.',
        '',
        '**🤖 Bot Gate**',
        `Unauthorized bot additions: **${config.blockUnauthorizedBots === false ? 'OFF' : 'ON'}**`,
        'Only the server owner / trusted Crown roles may add bots.',
        '',
        '**💬 Spam Shield**',
        `Message burst limit: **${spamLimit} messages / ${windowSeconds}s**`,
        `Automatic timeout: **${timeoutMinutes} minutes**`,
        'Coordinated bursts from multiple members trigger a raid warning.',
        '',
        '**📣 AutoMod**',
        'Generic Discord spam detection + mention raid protection feed into security logs.',
        '',
        '**👁️ Audit Watch**',
        'High-impact role, channel, webhook, moderation and guild changes are mirrored without flooding every minor audit event.',
        '',
        '**🪝 Webhook Streams**',
        'Branded Kingdom Security / Royal Registry / Knight Dispatch webhooks are separated from interactive bot panels.',
        '',
        '_Security alerts suppress unnecessary mentions and the bot does not send unsolicited DMs._'
      ].join('\n'))]
  };
}

export function questPanel() {
  const embed = baseEmbed()
    .setTitle('📜 Royal Quest Board')
    .setDescription([
      '**Daily Quests**',
      '• Complete 2 Dungeon Quest runs',
      '• Help one member of the realm',
      '',
      '**Weekly Kingdom Goal**',
      '• Complete 100 official carries as a community',
      '',
      '_Quest progression, Houses, campaigns and achievements can build on completed carry data._'
    ].join('\n'));
  return { embeds: [embed] };
}
