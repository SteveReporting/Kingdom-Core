import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';
import { BRAND, ROLE_BLUEPRINT, STAFF_KEYS } from '../config/blueprint.js';
import { mutateGuildState, readGuildState, writeGuildState } from '../storage/store.js';

const eph = (content) => ({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
const ALL_KEYS = ROLE_BLUEPRINT.map((x) => x.key);

function branded(title, color = BRAND.color) {
  return new EmbedBuilder().setColor(color).setTitle(title).setFooter({ text: BRAND.footer }).setTimestamp();
}

function isStaff(member, state) {
  if (member?.permissions?.has?.(PermissionFlagsBits.Administrator)) return true;
  const roles = state.setup?.roles ?? {};
  return STAFF_KEYS.some((k) => roles[k] && member.roles.cache.has(roles[k]));
}

function publicOverwrites(guild, state) {
  const rows = [{ id: guild.roles.everyone.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] }];
  for (const key of ALL_KEYS) {
    const id = state.setup?.roles?.[key];
    if (id) rows.push({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] });
  }
  return rows;
}

function staffOverwrites(guild, state) {
  const rows = [{ id: guild.roles.everyone.id, allow: [PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.ViewChannel] }];
  for (const key of ALL_KEYS) {
    const id = state.setup?.roles?.[key];
    if (!id) continue;
    if (STAFF_KEYS.includes(key)) rows.push({ id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages] });
    else rows.push({ id, allow: [PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.ViewChannel] });
  }
  return rows;
}

async function ensureChannel(guild, state, key, name, parentId, privateStaff = false) {
  state.setup.channels ??= {};
  let channel = guild.channels.cache.get(state.setup.channels[key]);
  if (!channel || channel.type !== ChannelType.GuildText) channel = guild.channels.cache.find((c) => c.type === ChannelType.GuildText && c.name === name);
  let created = false;
  if (!channel) {
    channel = await guild.channels.create({
      name,
      type: ChannelType.GuildText,
      parent: parentId,
      permissionOverwrites: privateStaff ? staffOverwrites(guild, state) : publicOverwrites(guild, state),
      reason: 'Kingdom Core /setup4 community platform'
    });
    created = true;
  } else {
    if (parentId && channel.parentId !== parentId) await channel.setParent(parentId, { lockPermissions: false }).catch(() => null);
    await channel.permissionOverwrites.set(privateStaff ? staffOverwrites(guild, state) : publicOverwrites(guild, state), 'Kingdom Core v4 community permissions').catch(() => null);
  }
  state.setup.channels[key] = channel.id;
  return { channel, created };
}

async function pin(channel, state, key, payload) {
  state.setup.panels ??= {};
  let msg = state.setup.panels[key] ? await channel.messages.fetch(state.setup.panels[key]).catch(() => null) : null;
  if (msg) await msg.edit(payload).catch(() => null);
  else {
    msg = await channel.send(payload);
    state.setup.panels[key] = msg.id;
  }
  if (!msg.pinned) await msg.pin('Kingdom Core v4 community control panel').catch(() => null);
  return msg;
}

function notificationPayload() {
  return {
    embeds: [branded('🔔 Notification Router • Your Signals, Not Spam')
      .setDescription('Choose exactly what Kingdom Core may notify you about. Smart carry alerts are aggregated around real demand instead of pinging once per request.')],
    components: [new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId('kc4c:notify:topics').setPlaceholder('Toggle notification topics').setMinValues(1).setMaxValues(5).addOptions(
        { label: 'Carry Demand', value: 'carry', emoji: '⚔️', description: 'High-demand carry windows' },
        { label: 'Guild Events', value: 'events', emoji: '🎪', description: 'RSVP reminders and event starts' },
        { label: 'House Activity', value: 'houses', emoji: '🏰', description: 'House wars and seasonal activity' },
        { label: 'Marketplace', value: 'market', emoji: '🏪', description: 'Market/watchlist alerts' },
        { label: 'System Updates', value: 'updates', emoji: '📢', description: 'Important Kingdom updates' }
      )
    )],
    allowedMentions: { parse: [] }
  };
}

function eventList(state) {
  return Object.values(state.eventsV4?.events ?? {}).filter((e) => e.status !== 'cancelled').sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
}

function calendarPayload(state) {
  const events = eventList(state).filter((e) => new Date(e.startsAt).getTime() > Date.now() - 3600000).slice(0, 10);
  const text = events.length ? events.map((e) => `**${e.title}** • <t:${Math.floor(new Date(e.startsAt).getTime() / 1000)}:F>\n└ ✅ ${e.rsvp?.going?.length ?? 0} • ❔ ${e.rsvp?.maybe?.length ?? 0}`).join('\n\n') : '_No upcoming events are scheduled._';
  return {
    embeds: [branded('📅 Royal Calendar • Live Events').setDescription(text)],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('kc4c:event:create').setLabel('Create Event').setEmoji('➕').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('kc4c:event:refresh').setLabel('Refresh Calendar').setEmoji('🔄').setStyle(ButtonStyle.Secondary)
    )],
    allowedMentions: { parse: [] }
  };
}

function mentorPayload(state) {
  const mentors = Object.keys(state.mentorsV4?.mentors ?? {}).length;
  const active = Object.values(state.mentorsV4?.matches ?? {}).filter((x) => x.status === 'active').length;
  return {
    embeds: [branded('🧭 Mentor Network • New Player Support')
      .setDescription('Mentors are matched to members who want progression help. Matches are tracked so contribution can feed Kingdom XP and mentor reputation.')
      .addFields(
        { name: 'Registered Mentors', value: `**${mentors}**`, inline: true },
        { name: 'Active Matches', value: `**${active}**`, inline: true }
      )],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('kc4c:mentor:join').setLabel('Become a Mentor').setEmoji('🛡️').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('kc4c:mentor:request').setLabel('Find a Mentor').setEmoji('🧭').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('kc4c:mentor:mine').setLabel('My Match').setEmoji('🤝').setStyle(ButtonStyle.Secondary)
    )],
    allowedMentions: { parse: [] }
  };
}

function archivesPayload() {
  return {
    embeds: [branded('📚 Royal Archives • Knowledge + Build Advisor')
      .setDescription([
        '**Search the guild systems without hunting through channels.**',
        '',
        'The Archives can answer common Kingdom Core questions and provide a rule-based Dungeon Quest progression recommendation from your selected level role.',
        'Carrier SOP documents remain in the private Carrier Department Library.'
      ].join('\n'))],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('kc4c:archives:search').setLabel('Search Knowledge').setEmoji('🔎').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('kc4c:archives:build').setLabel('Build / Dungeon Advisor').setEmoji('🛠️').setStyle(ButtonStyle.Success)
    )],
    allowedMentions: { parse: [] }
  };
}

function tournamentPayload(state) {
  const tournament = state.eventsV4?.tournament;
  return {
    embeds: [branded('🏟️ Kingdom Tournament Engine')
      .setDescription(tournament?.bracket?.length
        ? tournament.bracket.map((m, i) => `**Match ${i + 1}** • <@${m[0]}> vs ${m[1] ? `<@${m[1]}>` : '**BYE**'}`).join('\n')
        : 'No active bracket. Staff can generate one from the next event\'s confirmed attendees.')],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('kc4c:tournament:generate').setLabel('Generate Bracket').setEmoji('🏆').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('kc4c:tournament:view').setLabel('View Bracket').setEmoji('📋').setStyle(ButtonStyle.Secondary)
    )],
    allowedMentions: { parse: [] }
  };
}

function assistantPayload() {
  return {
    embeds: [branded('🧠 Royal Intelligence Desk • Staff Briefs', 0x5865f2)
      .setDescription('Deterministic summaries built from Kingdom Core data. They assist staff; they do **not** automatically accept applications, punish members or make moderation decisions.')],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('kc4c:assist:apps').setLabel('Application Brief').setEmoji('📨').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('kc4c:assist:tickets').setLabel('Ticket Brief').setEmoji('🕯️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('kc4c:assist:security').setLabel('Security Explain').setEmoji('🛡️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('kc4c:assist:campaign').setLabel('Campaign Brief').setEmoji('🐉').setStyle(ButtonStyle.Primary)
    )],
    allowedMentions: { parse: [] }
  };
}

function eventEmbed(event) {
  return branded(`🎪 ${event.title}`, 0x5865f2)
    .setDescription(event.description)
    .addFields(
      { name: 'Starts', value: `<t:${Math.floor(new Date(event.startsAt).getTime() / 1000)}:F>\n<t:${Math.floor(new Date(event.startsAt).getTime() / 1000)}:R>`, inline: true },
      { name: 'Going', value: `✅ **${event.rsvp?.going?.length ?? 0}**`, inline: true },
      { name: 'Maybe', value: `❔ **${event.rsvp?.maybe?.length ?? 0}**`, inline: true }
    );
}

function eventButtons(event) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`kc4c:event:rsvp:${event.id}:going`).setLabel('Attending').setEmoji('✅').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`kc4c:event:rsvp:${event.id}:maybe`).setLabel('Maybe').setEmoji('❔').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`kc4c:event:rsvp:${event.id}:no`).setLabel("Can't Attend").setEmoji('❌').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`kc4c:event:teams:${event.id}`).setLabel('Build Teams').setEmoji('👥').setStyle(ButtonStyle.Primary)
    )
  ];
}

async function refreshCalendar(guild, state) {
  const channel = guild.channels.cache.get(state.setup?.channels?.royalCalendarV4);
  if (!channel?.isTextBased()) return;
  await pin(channel, state, 'royalCalendarV4', calendarPayload(state));
}

async function syncEventMessage(guild, state, event) {
  const channel = guild.channels.cache.get(event.channelId);
  if (!channel?.isTextBased() || !event.messageId) return;
  const msg = await channel.messages.fetch(event.messageId).catch(() => null);
  if (msg) await msg.edit({ embeds: [eventEmbed(event)], components: eventButtons(event), allowedMentions: { parse: [] } }).catch(() => null);
}

export async function installCommunityV4(guild) {
  await guild.channels.fetch();
  const state = await readGuildState(guild.id);
  const publicParent = state.setup?.categories?.kingdomProgressV4 ?? state.setup?.categories?.community;
  const staffParent = state.setup?.categories?.kingdomCommandV4 ?? state.setup?.categories?.staff;
  if (!publicParent || !staffParent) throw new Error('Kingdom Core v4 base categories are missing. Run the main /setup4 migration again.');
  state.eventsV4 ??= { events: {}, attendance: {}, scheduled: {} };
  state.mentorsV4 ??= { mentors: {}, matches: {} };
  state.notificationsV4 ??= { subscriptions: {}, digest: {} };

  const defs = [
    ['notificationCenterV4', '🔔・notification-center', publicParent, false],
    ['royalCalendarV4', '📅・royal-calendar', publicParent, false],
    ['mentorNetworkV4', '🧭・mentor-network', publicParent, false],
    ['royalArchivesV4', '📚・royal-archives', publicParent, false],
    ['tournamentV4', '🏟️・tournaments', publicParent, false],
    ['assistantDeskV4', '🧠・intelligence-desk', staffParent, true]
  ];
  let created = 0;
  for (const def of defs) {
    const result = await ensureChannel(guild, state, ...def);
    created += Number(result.created);
  }
  const c = (key) => guild.channels.cache.get(state.setup.channels[key]);
  await pin(c('notificationCenterV4'), state, 'notificationCenterV4', notificationPayload());
  await pin(c('royalCalendarV4'), state, 'royalCalendarV4', calendarPayload(state));
  await pin(c('mentorNetworkV4'), state, 'mentorNetworkV4', mentorPayload(state));
  await pin(c('royalArchivesV4'), state, 'royalArchivesV4', archivesPayload());
  await pin(c('tournamentV4'), state, 'tournamentV4', tournamentPayload(state));
  await pin(c('assistantDeskV4'), state, 'assistantDeskV4', assistantPayload());
  await writeGuildState(guild.id, state);
  return { channelsCreated: created, panels: 6 };
}

function eventModal() {
  const title = new TextInputBuilder().setCustomId('kc4c:event:title').setPlaceholder('Friday Kingdom Raid').setRequired(true).setMaxLength(80).setStyle(TextInputStyle.Short);
  const when = new TextInputBuilder().setCustomId('kc4c:event:when').setPlaceholder('2026-09-12 20:00 UTC').setRequired(true).setMaxLength(40).setStyle(TextInputStyle.Short);
  const description = new TextInputBuilder().setCustomId('kc4c:event:description').setPlaceholder('What are we doing? Who can join?').setRequired(true).setMaxLength(800).setStyle(TextInputStyle.Paragraph);
  return new ModalBuilder().setCustomId('kc4c:event:submit').setTitle('🎪 Create Kingdom Event').addLabelComponents(
    new LabelBuilder().setLabel('Event Title').setTextInputComponent(title),
    new LabelBuilder().setLabel('Start Time').setDescription('Use a clear UTC date/time.').setTextInputComponent(when),
    new LabelBuilder().setLabel('Description').setTextInputComponent(description)
  );
}

function searchModal() {
  const query = new TextInputBuilder().setCustomId('kc4c:archives:query').setPlaceholder('How do I become a Knight?').setRequired(true).setMaxLength(200).setStyle(TextInputStyle.Short);
  return new ModalBuilder().setCustomId('kc4c:archives:search-submit').setTitle('🔎 Search Royal Archives').addLabelComponents(
    new LabelBuilder().setLabel('Question').setTextInputComponent(query)
  );
}

function knowledgeAnswer(query) {
  const q = query.toLowerCase();
  if (q.includes('knight') || q.includes('carrier')) return 'Apply through the **Carrier Application** form, enter Knight Academy, complete the required supervised service/training, then receive your carrier qualification. Your service time, runs, players helped and commendations are tracked by Kingdom Core.';
  if (q.includes('carry')) return 'Open the **Live Carry Queue**, request your dungeon/difficulty/mode, or join an already-forming compatible party. Matching requests are grouped automatically. Once claimed, the Knight starts a Ready Check before the run begins.';
  if (q.includes('house')) return 'Choose one Kingdom House. Carries, quests, events and contribution can feed House XP. The House War panel shows live standings.';
  if (q.includes('treasury') || q.includes('loan')) return 'Use the **Royal Treasury** panel to request an item. Staff approve or deny the request, and loans are recorded in the Treasury ledger rather than handled as untracked DMs.';
  if (q.includes('market') || q.includes('trade')) return 'Use **Marketplace Live** to publish a listing. Kingdom Core keeps a listing history and market-intelligence dataset as activity grows.';
  if (q.includes('ticket') || q.includes('support')) return 'Open a petition/support ticket. Staff can claim, escalate and resolve cases through the Ticket Operations console; response and resolution metrics are tracked.';
  if (q.includes('security')) return 'Kingdom Security tracks audit events, approved bots/webhooks, risk state and digital-twin drift. High-risk activity can trigger lockdown; staff can snapshot, audit and repair configuration.';
  return 'I could not match that to a built-in Archive topic yet. Try keywords such as **carry, Knight, House, treasury, marketplace, ticket, security**. Carrier-specific SOP documents are available in the private Carrier Department Library.';
}

function buildAdvice(member) {
  const role = member.roles.cache.find((r) => /^Lvl\s/i.test(r.name));
  const match = role?.name.match(/(\d+)/);
  const level = match ? Number(match[1]) : null;
  const ranges = [
    [0, 39, 'Desert Temple / Winter Outpost', 'Focus on basic gear progression and learning dungeon mechanics.'],
    [40, 59, 'Pirate Island / King\'s Castle', 'Replace weak early gear and prioritise survivability.'],
    [60, 79, 'The Underworld / Samurai Palace', 'Build toward a consistent damage set before pushing HC.'],
    [80, 99, 'The Canals / Ghastly Harbor', 'Start specialising your build and keep gear near your current dungeon tier.'],
    [100, 119, 'Steampunk Sewers / Orbital Outpost', 'Prioritise a complete same-tier set and strong weapon before harder modes.'],
    [120, 139, 'Aquatic Temple / Enchanted Forest', 'Optimise stats around your class and use carries to bridge gear gaps.'],
    [140, 149, 'Northern Lands', 'Prepare a full high-tier setup before the Volcanic jump.'],
    [150, 159, 'Volcanic Chambers', '🌋 Current progression target: Volcanic Chambers. Build around consistent boss survival first, then damage.'],
    [160, 174, 'Gilded Skies', 'Push your Gilded-tier set and only move into HC when clears are reliable.'],
    [175, 189, 'Yokai Peak', 'Optimise endgame stats and keep a dependable party/solo setup.'],
    [190, 999, 'Abyssal Void / current endgame', 'Endgame: optimise best-in-slot gear, achievements, carries and prestige goals.']
  ];
  const row = level == null ? null : ranges.find(([a, b]) => level >= a && level <= b);
  return row ? `**Detected:** ${role.name}\n**Recommended progression:** ${row[2]}\n${row[3]}` : 'Select a **Lvl** role in the level-roles channel first, then the advisor can map you to a Dungeon Quest progression range.';
}

function applicationBrief(state) {
  const rows = (state.externalApplicationReviews ?? []).slice(-25);
  const accepted = rows.filter((x) => x.decision === 'Accepted').length;
  const denied = rows.filter((x) => x.decision === 'Denied').length;
  const interviews = rows.filter((x) => x.decision === 'Interview').length;
  const ungraded = rows.filter((x) => !x.grade).length;
  return `**Recent review window:** ${rows.length}\n✅ Accepted: **${accepted}**\n💬 Interview: **${interviews}**\n❌ Denied: **${denied}**\n📊 Ungraded: **${ungraded}**\n\nUse the Application Review desk for the actual human decision.`;
}

function ticketBrief(state) {
  const tickets = Object.values(state.tickets ?? {});
  const open = tickets.filter((x) => !['closed', 'resolved'].includes(x.status));
  const types = {};
  for (const t of open) types[t.type ?? 'support'] = (types[t.type ?? 'support'] ?? 0) + 1;
  return `**Open backlog:** ${open.length}\n${Object.entries(types).map(([k, n]) => `• ${k}: **${n}**`).join('\n') || 'No open tickets.'}\n\nClaim ownership before replying; escalate cases that need higher authority.`;
}

function securityBrief(state) {
  const sec = state.securityV4 ?? {};
  const incidents = (sec.incidents ?? []).slice(-5).reverse();
  return `**State:** ${sec.state ?? 'NORMAL'} • **Risk ${sec.riskScore ?? 0}/100**\n**Drift findings:** ${sec.drift?.length ?? 0}\n**Lockdown:** ${sec.lockdown?.active ? 'ACTIVE' : 'inactive'}\n\n${incidents.length ? incidents.map((x) => `• Audit action ${x.action} added **${x.riskAdded}** risk`).join('\n') : 'No recent v4 security incidents.'}`;
}

function campaignBrief(state) {
  const hottest = Object.entries(state.analyticsV4?.forecasts ?? {}).sort((a, b) => (b[1].requests ?? 0) - (a[1].requests ?? 0))[0];
  const target = hottest?.[0] ?? 'the Realm';
  const demand = hottest?.[1]?.requests ?? 0;
  return `**Campaign Seed — The Crown's Call**\n\nThe Kingdom stands at **${state.kingdom?.stage ?? 'Settlement'}**, and the greatest pressure is currently at **${target}** with **${demand}** active demand.\n\n**Objective:** rally Houses and Knights to clear 100 successful player carries, award House XP for contribution, and publish a Hall of Champions result when the target is met.`;
}

export async function routeNotification(guild, topic, content) {
  const state = await readGuildState(guild.id);
  const subs = state.notificationsV4?.subscriptions ?? {};
  const recipients = Object.entries(subs).filter(([, topics]) => topics?.includes(topic)).map(([id]) => id);
  let sent = 0;
  for (const userId of recipients.slice(0, 100)) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) continue;
    await member.send({ content, allowedMentions: { parse: [] } }).then(() => sent++).catch(() => null);
  }
  return sent;
}

export async function runCommunityMaintenance(guild) {
  const state = await readGuildState(guild.id);
  if (!state.platform?.schemaVersion) return false;
  const now = Date.now();
  for (const event of eventList(state)) {
    const start = new Date(event.startsAt).getTime();
    if (!event.reminded30 && start > now && start - now <= 30 * 60_000) {
      const sent = await routeNotification(guild, 'events', `🎪 **${event.title}** starts <t:${Math.floor(start / 1000)}:R>. Check the Royal Calendar for details.`);
      await mutateGuildState(guild.id, async (fresh) => {
        const current = fresh.eventsV4?.events?.[event.id];
        if (current) { current.reminded30 = true; current.reminderSent = sent; }
      });
    }
  }
  const waiting = Object.values(state.analyticsV4?.demand ?? {}).reduce((n, x) => n + (x.waiting ?? 0), 0);
  const last = new Date(state.notificationsV4?.digest?.lastCarryDemandAt ?? 0).getTime();
  if (waiting >= 10 && now - last > 60 * 60_000) {
    const hottest = Object.entries(state.analyticsV4?.forecasts ?? {}).sort((a, b) => (b[1].waiting ?? 0) - (a[1].waiting ?? 0)).slice(0, 3);
    const text = hottest.map(([d, x]) => `• **${d}** — ${x.waiting ?? 0} waiting`).join('\n');
    await routeNotification(guild, 'carry', `⚔️ **Kingdom Carry Demand**\n${text}`);
    await mutateGuildState(guild.id, async (fresh) => {
      fresh.notificationsV4.digest ??= {};
      fresh.notificationsV4.digest.lastCarryDemandAt = new Date().toISOString();
    });
  }
  return true;
}

export async function handleCommunityV4Button(interaction) {
  if (!interaction.customId.startsWith('kc4c:')) return false;
  const id = interaction.customId;
  const state = await readGuildState(interaction.guildId);

  if (id === 'kc4c:event:create') {
    if (!isStaff(interaction.member, state)) return interaction.reply(eph('Only Kingdom staff can create scheduled events.'));
    return interaction.showModal(eventModal());
  }
  if (id === 'kc4c:event:refresh') {
    await mutateGuildState(interaction.guildId, async (fresh) => refreshCalendar(interaction.guild, fresh));
    return interaction.reply(eph('🔄 Royal Calendar refreshed.'));
  }
  if (id.startsWith('kc4c:event:rsvp:')) {
    const [, , , eventId, choice] = id.split(':');
    let event = null;
    await mutateGuildState(interaction.guildId, async (fresh) => {
      event = fresh.eventsV4?.events?.[eventId] ?? null;
      if (!event) return;
      event.rsvp ??= { going: [], maybe: [], no: [] };
      for (const key of ['going', 'maybe', 'no']) event.rsvp[key] = event.rsvp[key].filter((x) => x !== interaction.user.id);
      event.rsvp[choice].push(interaction.user.id);
      await syncEventMessage(interaction.guild, fresh, event);
      await refreshCalendar(interaction.guild, fresh);
    });
    return interaction.reply(eph(event ? `RSVP updated: **${choice.toUpperCase()}** for **${event.title}**.` : 'That event no longer exists.'));
  }
  if (id.startsWith('kc4c:event:teams:')) {
    if (!isStaff(interaction.member, state)) return interaction.reply(eph('Only staff can build event teams.'));
    const eventId = id.split(':')[3];
    const event = state.eventsV4?.events?.[eventId];
    if (!event) return interaction.reply(eph('Event not found.'));
    const users = event.rsvp?.going ?? [];
    if (!users.length) return interaction.reply(eph('Nobody is marked Attending yet.'));
    const size = Math.max(2, Number(event.teamSize ?? 8));
    const teams = [];
    for (let i = 0; i < users.length; i += size) teams.push(users.slice(i, i + size));
    return interaction.reply({ embeds: [branded(`👥 ${event.title} • Auto Teams`).setDescription(teams.map((t, i) => `**Team ${i + 1}**\n${t.map((u) => `<@${u}>`).join(' • ')}`).join('\n\n'))], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  }

  if (id === 'kc4c:mentor:join') {
    await mutateGuildState(interaction.guildId, async (fresh) => {
      fresh.mentorsV4 ??= { mentors: {}, matches: {} };
      fresh.mentorsV4.mentors[interaction.user.id] = { userId: interaction.user.id, active: true, joinedAt: new Date().toISOString(), matches: fresh.mentorsV4.mentors[interaction.user.id]?.matches ?? 0 };
    });
    return interaction.reply(eph('🛡️ You are now registered as an **active mentor**.'));
  }
  if (id === 'kc4c:mentor:request') {
    let match = null;
    await mutateGuildState(interaction.guildId, async (fresh) => {
      fresh.mentorsV4 ??= { mentors: {}, matches: {} };
      const existing = Object.values(fresh.mentorsV4.matches).find((x) => x.memberId === interaction.user.id && x.status === 'active');
      if (existing) { match = existing; return; }
      const mentor = Object.values(fresh.mentorsV4.mentors).filter((x) => x.active && x.userId !== interaction.user.id).sort((a, b) => (a.matches ?? 0) - (b.matches ?? 0))[0];
      if (!mentor) return;
      const id2 = `MENT-${Date.now().toString(36).toUpperCase()}`;
      match = { id: id2, memberId: interaction.user.id, mentorId: mentor.userId, status: 'active', createdAt: new Date().toISOString() };
      fresh.mentorsV4.matches[id2] = match;
      mentor.matches = (mentor.matches ?? 0) + 1;
    });
    return interaction.reply(eph(match ? `🤝 Mentor match created: <@${match.mentorId}>.` : 'No active mentors are available yet.'));
  }
  if (id === 'kc4c:mentor:mine') {
    const match = Object.values(state.mentorsV4?.matches ?? {}).find((x) => (x.memberId === interaction.user.id || x.mentorId === interaction.user.id) && x.status === 'active');
    return interaction.reply(eph(match ? `🤝 Active mentor match: <@${match.mentorId}> ↔ <@${match.memberId}>` : 'You do not have an active mentor match.'));
  }

  if (id === 'kc4c:archives:search') return interaction.showModal(searchModal());
  if (id === 'kc4c:archives:build') return interaction.reply({ embeds: [branded('🛠️ Dungeon / Build Advisor').setDescription(buildAdvice(interaction.member))], flags: MessageFlags.Ephemeral });

  if (id === 'kc4c:tournament:generate') {
    if (!isStaff(interaction.member, state)) return interaction.reply(eph('Only staff can generate tournament brackets.'));
    const event = eventList(state).find((e) => (e.rsvp?.going?.length ?? 0) >= 2);
    if (!event) return interaction.reply(eph('Need an upcoming event with at least two confirmed attendees.'));
    const players = [...event.rsvp.going];
    const bracket = [];
    for (let i = 0; i < players.length; i += 2) bracket.push([players[i], players[i + 1] ?? null]);
    await mutateGuildState(interaction.guildId, async (fresh) => { fresh.eventsV4.tournament = { eventId: event.id, bracket, createdAt: new Date().toISOString() }; });
    return interaction.reply({ embeds: [branded('🏆 Tournament Bracket Generated').setDescription(bracket.map((m, i) => `**Match ${i + 1}** • <@${m[0]}> vs ${m[1] ? `<@${m[1]}>` : '**BYE**'}`).join('\n'))], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  }
  if (id === 'kc4c:tournament:view') return interaction.reply({ ...tournamentPayload(state), flags: MessageFlags.Ephemeral });

  if (id.startsWith('kc4c:assist:')) {
    if (!isStaff(interaction.member, state)) return interaction.reply(eph('Only Kingdom staff can use the intelligence desk.'));
    const type = id.split(':')[2];
    const text = type === 'apps' ? applicationBrief(state) : type === 'tickets' ? ticketBrief(state) : type === 'security' ? securityBrief(state) : campaignBrief(state);
    return interaction.reply({ embeds: [branded(`🧠 ${type.toUpperCase()} BRIEF`, 0x5865f2).setDescription(text)], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  }
  return false;
}

export async function handleCommunityV4Select(interaction) {
  if (interaction.customId !== 'kc4c:notify:topics') return false;
  await mutateGuildState(interaction.guildId, async (state) => {
    state.notificationsV4 ??= { subscriptions: {}, digest: {} };
    state.notificationsV4.subscriptions[interaction.user.id] = interaction.values;
  });
  return interaction.reply(eph(`🔔 Notification topics saved: **${interaction.values.join(', ')}**.`));
}

export async function handleCommunityV4Modal(interaction) {
  if (interaction.customId === 'kc4c:archives:search-submit') {
    const query = interaction.fields.getTextInputValue('kc4c:archives:query').trim();
    return interaction.reply({ embeds: [branded('📚 Royal Archives • Search Result').setDescription(`**Question:** ${query}\n\n${knowledgeAnswer(query)}`)], flags: MessageFlags.Ephemeral });
  }
  if (interaction.customId !== 'kc4c:event:submit') return false;
  const state = await readGuildState(interaction.guildId);
  if (!isStaff(interaction.member, state)) return interaction.reply(eph('Only Kingdom staff can create events.'));
  const title = interaction.fields.getTextInputValue('kc4c:event:title').trim();
  const rawWhen = interaction.fields.getTextInputValue('kc4c:event:when').trim();
  const description = interaction.fields.getTextInputValue('kc4c:event:description').trim();
  const parsed = new Date(rawWhen.replace(/\sUTC$/i, 'Z').replace(' ', 'T'));
  if (!Number.isFinite(parsed.getTime())) return interaction.reply(eph('I could not parse that start time. Use something like `2026-09-12 20:00 UTC`.'));
  const id = `EV-${Date.now().toString(36).toUpperCase()}`;
  const event = { id, title, description, startsAt: parsed.toISOString(), status: 'scheduled', createdBy: interaction.user.id, createdAt: new Date().toISOString(), teamSize: 8, rsvp: { going: [], maybe: [], no: [] } };
  const calendar = interaction.guild.channels.cache.get(state.setup?.channels?.royalCalendarV4);
  if (!calendar?.isTextBased()) return interaction.reply(eph('Royal Calendar channel is missing. Rerun `/setup4`.'));
  const msg = await calendar.send({ embeds: [eventEmbed(event)], components: eventButtons(event), allowedMentions: { parse: [] } });
  event.channelId = calendar.id;
  event.messageId = msg.id;
  await mutateGuildState(interaction.guildId, async (fresh) => {
    fresh.eventsV4 ??= { events: {}, attendance: {}, scheduled: {} };
    fresh.eventsV4.events[id] = event;
    await refreshCalendar(interaction.guild, fresh);
  });
  return interaction.reply(eph(`🎪 Event **${title}** created in <#${calendar.id}>.`));
}
