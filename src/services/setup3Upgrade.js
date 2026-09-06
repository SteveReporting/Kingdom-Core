import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits
} from 'discord.js';
import { BRAND, STAFF_KEYS } from '../config/blueprint.js';
import { readGuildState, writeGuildState } from '../storage/store.js';
import { applicationFilterRow } from './setup3Interactions.js';

const APP_META = {
  staff: { label: 'Royal Staff', emoji: '🛡️', channelKey: 'staffApplications', color: 0x5865f2 },
  carrier: { label: 'Knight / Carrier', emoji: '⚔️', channelKey: 'carrierApplications', color: 0x57f287 },
  creator: { label: 'Creator', emoji: '🎥', channelKey: 'creatorApplications', color: 0xeb459e }
};

function base(title, color = BRAND.color) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setFooter({ text: BRAND.footer })
    .setTimestamp();
}

function channelUrl(guildId, channelId) {
  return `https://discord.com/channels/${guildId}/${channelId}`;
}

function channelMention(state, key, fallback) {
  const id = state.setup?.channels?.[key];
  return id ? `<#${id}>` : fallback;
}

function publicReadOnlyOverwrites(guild, state) {
  const rows = [{
    id: guild.roles.everyone.id,
    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
    deny: [PermissionFlagsBits.SendMessages]
  }];
  for (const key of STAFF_KEYS) {
    const roleId = state.setup?.roles?.[key];
    if (!roleId) continue;
    rows.push({
      id: roleId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages]
    });
  }
  return rows;
}

async function ensureApplicationHub(guild, state) {
  let channel = guild.channels.cache.get(state.setup?.channels?.applicationHub);
  if (!channel || channel.type !== ChannelType.GuildText) {
    channel = guild.channels.cache.find((item) => item.type === ChannelType.GuildText && item.name === '🗂️・application-hub');
  }
  const parent = guild.channels.cache.get(state.setup?.categories?.applications);
  const overwrites = publicReadOnlyOverwrites(guild, state);

  if (!channel) {
    channel = await guild.channels.create({
      name: '🗂️・application-hub',
      type: ChannelType.GuildText,
      parent: parent?.id,
      permissionOverwrites: overwrites,
      reason: 'Kingdom Core /setup3 application hub'
    });
  } else {
    if (parent && channel.parentId !== parent.id) await channel.setParent(parent.id, { lockPermissions: false }).catch(() => null);
    await channel.permissionOverwrites.set(overwrites, 'Kingdom Core /setup3 application hub permissions').catch(() => null);
  }

  state.setup.channels ??= {};
  state.setup.channels.applicationHub = channel.id;
  return channel;
}

async function upsert(channel, state, key, payload, { pin = true } = {}) {
  if (!channel?.isTextBased()) return false;
  state.setup.panels ??= {};
  let message = state.setup.panels[key]
    ? await channel.messages.fetch(state.setup.panels[key]).catch(() => null)
    : null;

  const clean = { ...payload, allowedMentions: { parse: [] } };
  if (message) await message.edit(clean).catch(() => null);
  else {
    message = await channel.send(clean);
    state.setup.panels[key] = message.id;
  }

  if (pin && message && !message.pinned) await message.pin('Kingdom Core /setup3 pinned control panel').catch(() => null);
  return true;
}

function welcomePayload(guild, state) {
  const embed = base('👑 KINGDOM CARRIES • REALM HUB')
    .setDescription([
      '**Free carries. Real progression. One Kingdom.**',
      'Everything important is routed through the panels below — no command hunting and no clutter.',
      '',
      '━━━━━━━━━━━━━━━━━━━━',
      `⚔️ **Get Carried**  →  ${channelMention(state, 'carryBoard', '#carry-board')}`,
      `⏳ **Live Queue**  →  ${channelMention(state, 'carryQueue', '#live-queue')}`,
      `🏰 **Choose a House**  →  ${channelMention(state, 'chooseHouse', '#choose-your-house')}`,
      `📈 **Choose Your Level**  →  ${channelMention(state, 'levelRoles', '#level-roles')}`,
      `📝 **Applications**  →  ${channelMention(state, 'applicationHub', '#application-hub')}`,
      `🕯️ **Support**  →  ${channelMention(state, 'supportPanel', '#petition-the-crown')}`,
      '',
      '**Kingdom loop**',
      '`REQUEST → QUEUE → KNIGHT → COMPLETE → PROGRESS`',
      '',
      '_Carries are free. Staff actions and system events are logged by Kingdom Core._'
    ].join('\n'));

  const buttons = new ActionRowBuilder();
  const links = [
    ['carryBoard', 'Request Carry', '⚔️'],
    ['carryQueue', 'Live Queue', '⏳'],
    ['chooseHouse', 'Houses', '🏰'],
    ['applicationHub', 'Applications', '📝'],
    ['supportPanel', 'Support', '🛟']
  ];
  for (const [key, label, emoji] of links) {
    const id = state.setup?.channels?.[key];
    if (id) buttons.addComponents(new ButtonBuilder().setLabel(label).setEmoji(emoji).setStyle(ButtonStyle.Link).setURL(channelUrl(guild.id, id)));
  }
  return { embeds: [embed], components: buttons.components.length ? [buttons] : [] };
}

function rulesPayload() {
  return {
    embeds: [base('📜 LAWS OF THE REALM')
      .setDescription([
        '**01  Respect people.** No harassment, hate, threats or targeted abuse.',
        '**02  Keep trades honest.** No scams, fake proof or deceptive listings.',
        '**03  Carries are free.** Official Kingdom Carries runs are never sold.',
        '**04  No raids or spam.** Flooding, mass mentions and webhook abuse trigger protection.',
        '**05  Keep content appropriate.** Follow Discord rules and server standards.',
        '**06  Staff actions are accountable.** Moderation is logged and can be reviewed.',
        '',
        '━━━━━━━━━━━━━━━━━━━━',
        '_Use common sense. Security systems may automatically restrict obvious abuse._'
      ].join('\n'))]
  };
}

function housePayload() {
  const embed = base('🏰 CHOOSE YOUR HOUSE')
    .setDescription([
      '**Your House is your team inside the Kingdom.**',
      'Choose the identity that fits you — House activity feeds seasonal competition, quests and future rewards.',
      '',
      '🐉 **DRAKON**  •  Power, competition, ambition',
      '🦁 **LEONIS**  •  Loyalty, community, leadership',
      '🦅 **AETHER**  •  Progression, grinding, achievements',
      '🐺 **FENRIR**  •  Carries, combat, speedrunning',
      '',
      '━━━━━━━━━━━━━━━━━━━━',
      '**One House at a time.** Picking another House automatically moves you.'
    ].join('\n'));
  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('kc:house:houseDrakon').setLabel('House Drakon').setEmoji('🐉').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('kc:house:houseLeonis').setLabel('House Leonis').setEmoji('🦁').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('kc:house:houseAether').setLabel('House Aether').setEmoji('🦅').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('kc:house:houseFenrir').setLabel('House Fenrir').setEmoji('🐺').setStyle(ButtonStyle.Secondary)
    )]
  };
}

function notificationPayload() {
  return {
    embeds: [base('🔔 NOTIFICATION CONTROL')
      .setDescription([
        '**Choose what Kingdom Carries is allowed to ping you for.**',
        'Each button toggles the matching notification role — press it again to remove it.',
        '',
        '⚔️ **Carries** • carry openings and activity',
        '🎪 **Events** • scheduled community events',
        '🏪 **Market** • marketplace alerts',
        '🎁 **Giveaways** • reward drops',
        '📢 **Updates** • important Kingdom changes',
        '',
        '_No role is mandatory. Kingdom Core avoids unnecessary mass pings._'
      ].join('\n'))],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('kc:role:carryPing').setLabel('Carries').setEmoji('⚔️').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('kc:role:eventPing').setLabel('Events').setEmoji('🎪').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('kc:role:marketPing').setLabel('Market').setEmoji('🏪').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('kc:role:giveawayPing').setLabel('Giveaways').setEmoji('🎁').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('kc:role:updatePing').setLabel('Updates').setEmoji('📢').setStyle(ButtonStyle.Secondary)
    )]
  };
}

function carryPayload(guild, state) {
  const embed = base('⚔️ ROYAL CARRY DESK')
    .setDescription([
      '**Free Dungeon Quest carries with a live tracked queue.**',
      '',
      '`REQUEST → WAIT → CLAIMED → CARRY → COMPLETE`',
      '',
      '**Request Carry** opens one clean popup where you choose:',
      '• Dungeon',
      '• Difficulty',
      '• Normal / Hardcore',
      '• Optional notes for your Knight',
      '',
      `Your live position and carrier status appear in ${channelMention(state, 'carryQueue', '#live-queue')}.`,
      '**One active request per member.**'
    ].join('\n'));
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('kc3:carry:open').setLabel('Request Carry').setEmoji('⚔️').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('kc:carry:leave').setLabel('Leave Queue').setEmoji('✖️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('kc:carry:claim').setLabel('Claim Next').setEmoji('🛡️').setStyle(ButtonStyle.Primary)
  );
  const live = state.setup?.channels?.carryQueue;
  if (live) row.addComponents(new ButtonBuilder().setLabel('Open Live Queue').setEmoji('⏳').setStyle(ButtonStyle.Link).setURL(channelUrl(guild.id, live)));
  return { embeds: [embed], components: [row] };
}

function supportPayload() {
  return {
    embeds: [base('🕯️ PETITION THE CROWN')
      .setDescription([
        '**One private desk for every issue.**',
        'Pick the route that best matches what you need; Kingdom Core creates a private ticket and adds it to the staff control board.',
        '',
        '🛟 **Support** • carries, server help, general questions',
        '🚨 **Report** • member, scam or staff concern',
        '🤝 **Partnership** • guild, creator or community collaboration',
        '⚖️ **Appeal** • moderation or punishment appeal',
        '',
        '_Tickets include claim status, priority controls and a closure record._'
      ].join('\n'))],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('kc:ticket:new:support').setLabel('Support').setEmoji('🛟').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('kc:ticket:new:report').setLabel('Report').setEmoji('🚨').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('kc:ticket:new:partnership').setLabel('Partnership').setEmoji('🤝').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('kc:ticket:new:appeal').setLabel('Appeal').setEmoji('⚖️').setStyle(ButtonStyle.Secondary)
    )]
  };
}

function questPayload() {
  return {
    embeds: [base('📜 ROYAL QUEST BOARD')
      .setDescription([
        '**DAILY MISSIONS**',
        '⚔️ Complete **2 Dungeon Quest runs**',
        '🤝 Help **1 member of the Realm**',
        '',
        '**WEEKLY KINGDOM OBJECTIVE**',
        '🏆 Complete **100 official carries** as a community',
        '',
        '**COMING THROUGH KINGDOM PROGRESSION**',
        '🗺️ Campaigns  •  ☠️ World Bosses  •  🎖️ Achievements  •  🏰 House competition',
        '',
        '_Completed carries feed the Kingdom statistics used by progression systems._'
      ].join('\n'))]
  };
}

function appPanelPayload(type) {
  const meta = APP_META[type];
  return {
    embeds: [base(`${meta.emoji} ${meta.label.toUpperCase()} APPLICATION`, meta.color)
      .setDescription([
        `**Apply for ${meta.label} in Kingdom Carries.**`,
        '',
        '**What happens next**',
        '1. Open the application form below.',
        '2. Your answers go privately to the Royal Application Control.',
        '3. Staff can **grade**, add notes, move you to **Interview**, **Approve**, or **Deny**.',
        '4. Final decisions are logged in the application status system.',
        '',
        '_Only one active application of this type per member._'
      ].join('\n'))],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`kc3:app:start:${type}`).setLabel(`Open ${meta.label} Form`).setEmoji(meta.emoji).setStyle(type === 'carrier' ? ButtonStyle.Success : type === 'creator' ? ButtonStyle.Secondary : ButtonStyle.Primary)
    )]
  };
}

function applicationHubPayload(guild, state) {
  const c = state.setup?.channels ?? {};
  const embed = base('🗂️ KINGDOM APPLICATION HUB')
    .setDescription([
      '**Choose the department you want to apply for.**',
      'Each application has its own information page and structured form.',
      '',
      '🛡️ **Royal Staff** • moderation, support and Kingdom operations',
      '⚔️ **Knight / Carrier** • official free carry team',
      '🎥 **Creator** • events, media and collaborations',
      '📌 **Application Status** • public decision feed',
      '',
      '━━━━━━━━━━━━━━━━━━━━',
      '_Use the channel links for details or start a form directly below._'
    ].join('\n'));

  const linkRow = new ActionRowBuilder();
  const links = [
    ['staffApplications', 'Staff Applications', '🛡️'],
    ['carrierApplications', 'Carrier Applications', '⚔️'],
    ['creatorApplications', 'Creator Applications', '🎥'],
    ['applicationStatus', 'Application Status', '📌']
  ];
  for (const [key, label, emoji] of links) {
    if (c[key]) linkRow.addComponents(new ButtonBuilder().setLabel(label).setEmoji(emoji).setStyle(ButtonStyle.Link).setURL(channelUrl(guild.id, c[key])));
  }

  const startRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('kc3:app:start:staff').setLabel('Apply for Staff').setEmoji('🛡️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('kc3:app:start:carrier').setLabel('Apply for Carrier').setEmoji('⚔️').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('kc3:app:start:creator').setLabel('Apply as Creator').setEmoji('🎥').setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [...(linkRow.components.length ? [linkRow] : []), startRow] };
}

function applicationReviewPayload(state) {
  const apps = Object.values(state.applications ?? {});
  const count = (status) => apps.filter((app) => (app.status ?? 'pending') === status).length;
  const embed = base('📝 ROYAL APPLICATION CONTROL')
    .setDescription([
      '**Staff application dashboard.** Select a view below and Kingdom Core displays every matching application in a private browser.',
      '',
      `🟡 **Pending**  ${count('pending')}`,
      `💬 **Interview**  ${count('interview')}`,
      `✅ **Approved**  ${count('approved')}`,
      `✖️ **Denied**  ${count('denied')}`,
      `📚 **Total Stored**  ${apps.length}`,
      '',
      '**Review tools**',
      '📊 Grade **S / A / B / C / D / F**',
      '📝 Add private reviewer notes',
      '💬 Move to interview',
      '✅ Approve and assign the correct trial role where applicable',
      '✖️ Deny and close the application',
      '',
      '_Use the selector — you do not need to scroll through old application messages._'
    ].join('\n'));
  return { embeds: [embed], components: [applicationFilterRow()] };
}

function applicationStatusPayload() {
  return {
    embeds: [base('📌 APPLICATION STATUS')
      .setDescription([
        '**Kingdom application decisions appear below.**',
        'Private answers and staff review notes never appear here.',
        '',
        'Possible states: `PENDING` → `INTERVIEW` → `APPROVED / DENIED`',
        '_Keep your application ID if you need to reference your submission._'
      ].join('\n'))]
  };
}

function ticketOverviewPayload() {
  return {
    embeds: [base('🎫 PETITION CONTROL BOARD')
      .setDescription([
        '**Private staff overview for every open ticket.**',
        '',
        'Each petition card records:',
        '👤 Owner  •  🗂️ Type  •  🛡️ Claimed staff member  •  🚨 Priority  •  📍 Channel',
        '',
        '**Controls**',
        '🛡️ **Claim** • take ownership of the case',
        '🚨 **Escalate** • mark urgent / high priority',
        '🔒 **Close** • archive the outcome and lock the ticket',
        '',
        '_Closed ticket summaries are preserved in the transcript/archive channel._'
      ].join('\n'))]
  };
}

function securityPayload(state) {
  const sec = state.security ?? {};
  return {
    embeds: [base('🛡️ KINGDOM SECURITY CENTER', 0xed4245)
      .setDescription([
        '**Layered protection for Kingdom Carries.**',
        '',
        `🤖 **Unauthorized Bot Gate**  •  ${sec.blockUnauthorizedBots === false ? 'OFF' : 'ON'}`,
        `💬 **Message Burst Shield**  •  ${sec.messageSpamProtection === false ? 'OFF' : 'ON'}`,
        `⏱️ **Burst Threshold**  •  ${sec.spamLimit ?? 9} messages / ${Math.round((sec.spamWindowMs ?? 7000) / 1000)}s`,
        `🔇 **Automatic Timeout**  •  ${Math.round((sec.spamTimeoutMs ?? 300000) / 60000)} minutes`,
        '',
        '**Discord AutoMod**',
        '📣 Mention-raid detection  •  🧱 Generic spam blocking  •  🚨 security alert routing',
        '',
        '**Audit Watch**',
        '👁️ Bot additions  •  roles  •  channels  •  webhooks  •  bans/kicks  •  high-impact guild changes',
        '',
        '**Branded system streams**',
        '🔐 Kingdom Security  •  📜 Royal Registry  •  ⚔️ Knight Dispatch',
        '',
        '_System messages suppress unnecessary mentions to reduce Discord anti-spam risk._'
      ].join('\n'))]
  };
}

async function pinExistingPanel(guild, state, channelKey, panelKey) {
  const channel = guild.channels.cache.get(state.setup?.channels?.[channelKey]);
  const messageId = state.setup?.panels?.[panelKey];
  if (!channel?.isTextBased() || !messageId) return false;
  const message = await channel.messages.fetch(messageId).catch(() => null);
  if (!message) return false;
  if (!message.pinned) await message.pin('Kingdom Core /setup3 pin all core UI').catch(() => null);
  return true;
}

export async function installSetup3Ui(guild, onProgress = async () => {}) {
  await guild.channels.fetch();
  const state = await readGuildState(guild.id);
  state.setup ??= {};
  if (!state.setup.completedAt) throw new Error('Run /setup once before /setup3.');

  const summary = { panelsUpdated: 0, panelsPinned: 0, channelsCreated: 0 };

  await onProgress('Building the unified application hub…');
  const hadHub = Boolean(state.setup?.channels?.applicationHub && guild.channels.cache.get(state.setup.channels.applicationHub));
  const appHub = await ensureApplicationHub(guild, state);
  if (!hadHub) summary.channelsCreated++;

  const channel = (key) => guild.channels.cache.get(state.setup?.channels?.[key]);

  await onProgress('Replacing core panels with Kingdom Core v3 UI…');
  const panels = [
    [channel('welcome'), 'welcome', welcomePayload(guild, state)],
    [channel('rules'), 'rules', rulesPayload()],
    [channel('chooseHouse'), 'houses', housePayload()],
    [channel('roles'), 'notifications', notificationPayload()],
    [channel('carryBoard'), 'carry', carryPayload(guild, state)],
    [channel('supportPanel'), 'support', supportPayload()],
    [channel('quests'), 'quests', questPayload()],
    [appHub, 'applicationHub', applicationHubPayload(guild, state)],
    [channel('staffApplications'), 'appStaff', appPanelPayload('staff')],
    [channel('carrierApplications'), 'appCarrier', appPanelPayload('carrier')],
    [channel('creatorApplications'), 'appCreator', appPanelPayload('creator')],
    [channel('applicationsReview'), 'appReviewGuide', applicationReviewPayload(state)],
    [channel('applicationStatus'), 'appStatus', applicationStatusPayload()],
    [channel('ticketOverview'), 'ticketOverview', ticketOverviewPayload()],
    [channel('securityCenter'), 'securityCenter', securityPayload(state)]
  ];

  for (const [target, key, payload] of panels) {
    if (await upsert(target, state, key, payload, { pin: true })) summary.panelsUpdated++;
  }

  await onProgress('Pinning every Kingdom Core control panel…');
  const known = [
    ['welcome', 'welcome'], ['rules', 'rules'], ['chooseHouse', 'houses'], ['roles', 'notifications'],
    ['carryBoard', 'carry'], ['carryQueue', 'liveQueue'], ['supportPanel', 'support'], ['quests', 'quests'],
    ['applicationHub', 'applicationHub'], ['staffApplications', 'appStaff'], ['carrierApplications', 'appCarrier'],
    ['creatorApplications', 'appCreator'], ['applicationsReview', 'appReviewGuide'], ['applicationStatus', 'appStatus'],
    ['ticketOverview', 'ticketOverview'], ['securityCenter', 'securityCenter']
  ];
  for (const [channelKey, panelKey] of known) summary.panelsPinned += Number(await pinExistingPanel(guild, state, channelKey, panelKey));

  state.setup.version = 4;
  state.setup.upgrade3At = new Date().toISOString();
  await writeGuildState(guild.id, state);
  return { summary, state };
}
