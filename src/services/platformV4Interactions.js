import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';
import { BRAND, CARRIER_KEYS, STAFF_KEYS } from '../config/blueprint.js';
import { mutateGuildState, readGuildState } from '../storage/store.js';
import { refreshV4Panels } from './platformV4.js';
import {
  applyEmergencyLockdown,
  auditDigitalTwin,
  captureDigitalTwin,
  endEmergencyLockdown,
  repairDigitalTwin,
  scanWebhookRegistry
} from './securityV4.js';

const eph = (content) => ({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });

function branded(title, color = BRAND.color) {
  return new EmbedBuilder().setColor(color).setTitle(title).setFooter({ text: BRAND.footer }).setTimestamp();
}

function hasRoles(member, ids) {
  return ids.some((id) => id && member?.roles?.cache?.has(id));
}

function isStaff(member, state) {
  if (member?.permissions?.has?.(PermissionFlagsBits.Administrator)) return true;
  const roles = state.setup?.roles ?? {};
  return hasRoles(member, STAFF_KEYS.map((k) => roles[k]).filter(Boolean));
}

function isCarrier(member, state) {
  if (isStaff(member, state)) return true;
  const roles = state.setup?.roles ?? {};
  return hasRoles(member, CARRIER_KEYS.map((k) => roles[k]).filter(Boolean));
}

function identity(state, userId) {
  state.identities ??= {};
  state.identities[userId] ??= {
    userId,
    kingdomXp: 0,
    prestige: 0,
    stats: { carriesReceived: 0, carriesCompleted: 0, noShows: 0, events: 0, quests: 0, trades: 0 },
    achievements: [],
    titles: []
  };
  state.identities[userId].stats ??= {};
  return state.identities[userId];
}

function carrierProfile(state, userId) {
  state.carrierOps ??= { profiles: {} };
  state.carrierOps.profiles ??= {};
  state.carrierOps.profiles[userId] ??= {
    userId,
    status: 'off',
    completedRuns: 0,
    playersHelped: 0,
    serviceMinutes: 0,
    commendations: {},
    reputation: { positive: 0, neutral: 0, concerns: 0, score: 100 },
    workload: 0
  };
  return state.carrierOps.profiles[userId];
}

function inferHouse(member, state) {
  const roles = state.setup?.roles ?? {};
  const map = [
    ['houseDrakon', 'House Drakon'],
    ['houseLeonis', 'House Leonis'],
    ['houseAether', 'House Aether'],
    ['houseFenrir', 'House Fenrir']
  ];
  return map.find(([key]) => roles[key] && member.roles.cache.has(roles[key]))?.[1] ?? 'Unaligned';
}

function inferLevel(member, state) {
  const roleMap = state.setup?.levelRoles ?? {};
  for (const [key, id] of Object.entries(roleMap)) {
    if (id && member.roles.cache.has(id)) return key.replace(/^level-?/, '').replaceAll('-', '–');
  }
  const role = member.roles.cache.find((r) => /^Lvl\s/i.test(r.name));
  return role?.name ?? 'Not set';
}

function profileEmbed(member, state) {
  const p = identity(state, member.id);
  const carrier = state.carrierOps?.profiles?.[member.id];
  const reliabilityDenom = (p.stats?.carriesReceived ?? 0) + (p.stats?.noShows ?? 0);
  const reliability = reliabilityDenom ? Math.round(((p.stats.carriesReceived ?? 0) / reliabilityDenom) * 100) : 100;
  return branded(`🪪 Kingdom Identity • ${member.displayName}`, 0x5865f2)
    .setThumbnail(member.displayAvatarURL())
    .addFields(
      { name: 'House', value: `**${inferHouse(member, state)}**`, inline: true },
      { name: 'Level', value: `**${inferLevel(member, state)}**`, inline: true },
      { name: 'Prestige', value: `**${p.prestige ?? 0}**`, inline: true },
      { name: 'Kingdom XP', value: `**${p.kingdomXp ?? 0}**`, inline: true },
      { name: 'Carries Received', value: `**${p.stats?.carriesReceived ?? 0}**`, inline: true },
      { name: 'Reliability', value: `**${reliability}%**`, inline: true },
      { name: 'Carrier Service', value: carrier ? `**${carrier.completedRuns ?? 0}** runs • **${carrier.playersHelped ?? 0}** helped\n**${carrier.serviceMinutes ?? 0}** verified min` : 'Not a registered Knight' },
      { name: 'Achievements', value: p.achievements?.length ? p.achievements.slice(-8).map((x) => `🏆 ${x}`).join('\n') : '_No achievements yet._' }
    );
}

function demandPayload(state) {
  const rows = Object.entries(state.analyticsV4?.forecasts ?? {})
    .sort((a, b) => (b[1].requests ?? 0) - (a[1].requests ?? 0))
    .slice(0, 15);
  return {
    embeds: [branded('📊 Carry Demand Intelligence', 0x5865f2)
      .setDescription(rows.length ? rows.map(([d, x], i) =>
        `**${i + 1}. ${d}**\n└ ${x.requests ?? 0} demand • ${x.waiting ?? 0} waiting • ~${x.estimatedWaitMinutes ?? 1}m ETA`
      ).join('\n\n') : '_No current carry demand._')],
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] }
  };
}

function applicationsPayload(state) {
  const rows = state.externalApplicationReviews ?? [];
  const counts = { Pending: 0, Interview: 0, Accepted: 0, Denied: 0 };
  const grades = {};
  for (const r of rows) {
    counts[r.decision] = (counts[r.decision] ?? 0) + 1;
    grades[r.grade] = (grades[r.grade] ?? 0) + 1;
  }
  return {
    embeds: [branded('📨 Application Analytics', 0x5865f2)
      .addFields(
        { name: 'Total Reviewed', value: `**${rows.length}**`, inline: true },
        { name: 'Accepted', value: `✅ **${counts.Accepted ?? 0}**`, inline: true },
        { name: 'Interview', value: `💬 **${counts.Interview ?? 0}**`, inline: true },
        { name: 'Denied', value: `❌ **${counts.Denied ?? 0}**`, inline: true },
        { name: 'Pending', value: `🟡 **${counts.Pending ?? 0}**`, inline: true },
        { name: 'Grade Distribution', value: Object.entries(grades).map(([g, n]) => `**${g}:** ${n}`).join(' • ') || 'No grades yet' }
      )],
    flags: MessageFlags.Ephemeral
  };
}

function ticketMetricsPayload(state) {
  const tickets = Object.values(state.tickets ?? {});
  const open = tickets.filter((x) => !['closed', 'resolved'].includes(x.status));
  const oldest = open.map((x) => new Date(x.createdAt ?? Date.now()).getTime()).sort()[0];
  return {
    embeds: [branded('🕯️ Ticket Operations • SLA', 0x5865f2)
      .addFields(
        { name: 'Open', value: `**${open.length}**`, inline: true },
        { name: 'Closed', value: `**${tickets.length - open.length}**`, inline: true },
        { name: 'Escalations', value: `**${Object.keys(state.ticketMetricsV4?.escalations ?? {}).length}**`, inline: true },
        { name: 'Oldest Open', value: oldest ? `<t:${Math.floor(oldest / 1000)}:R>` : 'None', inline: true },
        { name: 'Ownership', value: `**${Object.keys(state.ticketMetricsV4?.claimed ?? {}).length}** claimed`, inline: true },
        { name: 'Summaries', value: `**${Object.keys(state.ticketMetricsV4?.summaries ?? {}).length}** archived`, inline: true }
      )],
    flags: MessageFlags.Ephemeral
  };
}

function questPayload(state, userId) {
  const p = identity(state, userId);
  const q = state.questsV4 ?? {};
  const lines = [
    '**DAILY**',
    ...(q.daily ?? []).map((x) => `📜 **${x.name}** — ${x.description} • ${x.rewardXp} XP`),
    '',
    '**WEEKLY**',
    ...(q.weekly ?? []).map((x) => `⚔️ **${x.name}** — ${x.description} • ${x.rewardXp} XP`),
    '',
    '**KING\'S BOUNTY**',
    ...(q.community ?? []).map((x) => `👑 **${x.name}** — ${x.description} • ${x.rewardXp} XP`)
  ];
  return {
    embeds: [branded('📜 Quest Engine • Your Objectives').setDescription(lines.join('\n')).addFields(
      { name: 'Your Contribution', value: `Kingdom XP **${p.kingdomXp ?? 0}** • Carries received **${p.stats?.carriesReceived ?? 0}** • Carries completed **${p.stats?.carriesCompleted ?? 0}**` }
    )],
    flags: MessageFlags.Ephemeral
  };
}

function housePayload(state) {
  const houses = Object.values(state.kingdom?.houses ?? {}).sort((a, b) => (b.xp ?? 0) - (a.xp ?? 0));
  return {
    embeds: [branded('⚔️ House War • Realm Standings').setDescription(
      houses.map((h, i) => `${['🥇', '🥈', '🥉', '🏰'][i] ?? '•'} **${h.name}** — **${h.xp ?? 0} XP** • ${h.wins ?? 0} wins`).join('\n') || '_No House standings yet._'
    )],
    flags: MessageFlags.Ephemeral
  };
}

function treasuryModal() {
  const item = new TextInputBuilder().setCustomId('kc4:treasury:item').setLabel?.('Item') ?? new TextInputBuilder().setCustomId('kc4:treasury:item');
  item.setPlaceholder('What item / gear do you need?').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(120);
  const reason = new TextInputBuilder().setCustomId('kc4:treasury:reason').setPlaceholder('Why do you need it, and for how long?').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(600);
  return new ModalBuilder().setCustomId('kc4:treasury:submit').setTitle('🏦 Treasury Request').addLabelComponents(
    new LabelBuilder().setLabel('Requested Item').setTextInputComponent(item),
    new LabelBuilder().setLabel('Reason / Loan Context').setTextInputComponent(reason)
  );
}

function marketModal() {
  const item = new TextInputBuilder().setCustomId('kc4:market:item').setPlaceholder('Item name / rarity / dungeon').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(120);
  const price = new TextInputBuilder().setCustomId('kc4:market:price').setPlaceholder('Price or wanted trade').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80);
  const notes = new TextInputBuilder().setCustomId('kc4:market:notes').setPlaceholder('Optional notes').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(180);
  return new ModalBuilder().setCustomId('kc4:market:submit').setTitle('🏪 Create Marketplace Listing').addLabelComponents(
    new LabelBuilder().setLabel('Item').setTextInputComponent(item),
    new LabelBuilder().setLabel('Price / Trade').setTextInputComponent(price),
    new LabelBuilder().setLabel('Notes').setTextInputComponent(notes)
  );
}

function marketBrowse(state) {
  const listings = Object.values(state.marketV4?.listings ?? {}).filter((x) => x.status === 'active').slice(-15).reverse();
  return {
    embeds: [branded('🏪 Kingdom Marketplace • Active Listings').setDescription(listings.length
      ? listings.map((x) => `**${x.item}** — ${x.price}\n└ <@${x.sellerId}>${x.notes ? ` • ${x.notes}` : ''}`).join('\n\n')
      : '_No active listings._')],
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] }
  };
}

function marketIntel(state) {
  const active = Object.values(state.marketV4?.listings ?? {}).filter((x) => x.status === 'active');
  const counts = {};
  for (const x of active) counts[x.item.toLowerCase()] = (counts[x.item.toLowerCase()] ?? 0) + 1;
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  return {
    embeds: [branded('📈 Market Intelligence').setDescription(rows.length
      ? rows.map(([item, n], i) => `**${i + 1}. ${item}** — ${n} active listing${n === 1 ? '' : 's'}`).join('\n')
      : '_Not enough listing history yet. Price intelligence improves as the market records more data._')],
    flags: MessageFlags.Ephemeral
  };
}

function healthPayload(guild, state) {
  const h = state.systemV4?.health ?? {};
  return {
    embeds: [branded('🩺 Kingdom Core Diagnostics', 0x57f287)
      .addFields(
        { name: 'Discord Gateway', value: `✅ ${Math.round(guild.client.ws.ping)}ms`, inline: true },
        { name: 'Process Uptime', value: `✅ ${Math.round(process.uptime() / 60)} min`, inline: true },
        { name: 'Memory', value: `✅ ${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB`, inline: true },
        { name: 'Storage', value: `✅ ${h.storage ?? 'json-fallback'}`, inline: true },
        { name: 'Platform API', value: String(process.env.ENABLE_PLATFORM_API).toLowerCase() === 'true' ? '✅ Enabled' : '⚪ Disabled', inline: true },
        { name: 'Schema', value: `✅ v${state.platform?.schemaVersion ?? 4}`, inline: true },
        { name: 'Security State', value: `🛡️ ${state.securityV4?.state ?? 'NORMAL'} • ${state.securityV4?.riskScore ?? 0}/100`, inline: true },
        { name: 'Digital Twin', value: `🪞 ${state.securityV4?.drift?.length ?? 0} finding(s)`, inline: true }
      )],
    flags: MessageFlags.Ephemeral
  };
}

async function refresh(interaction) {
  await mutateGuildState(interaction.guildId, async (state) => refreshV4Panels(interaction.guild, state));
}

export async function handleV4Button(interaction) {
  const id = interaction.customId;
  if (!id.startsWith('kc4:')) return false;
  const state = await readGuildState(interaction.guildId);

  if (id === 'kc4:ops:refresh') {
    if (!isStaff(interaction.member, state)) return interaction.reply(eph('Only Kingdom staff can use Kingdom Command.'));
    await refresh(interaction);
    return interaction.reply(eph('🔄 Kingdom Command refreshed.'));
  }
  if (id === 'kc4:ops:demand') {
    if (!isStaff(interaction.member, state)) return interaction.reply(eph('Only Kingdom staff can view operational demand intelligence.'));
    return interaction.reply(demandPayload(state));
  }
  if (id === 'kc4:ops:applications') {
    if (!isStaff(interaction.member, state)) return interaction.reply(eph('Only Kingdom staff can view application analytics.'));
    return interaction.reply(applicationsPayload(state));
  }
  if (id === 'kc4:ops:tickets') {
    if (!isStaff(interaction.member, state)) return interaction.reply(eph('Only Kingdom staff can view ticket analytics.'));
    return interaction.reply(ticketMetricsPayload(state));
  }

  if (id === 'kc4:profile:self' || id === 'kc4:carrier:profile') {
    let embed;
    await mutateGuildState(interaction.guildId, async (fresh) => {
      const p = identity(fresh, interaction.user.id);
      p.discordName = interaction.user.username;
      p.displayName = interaction.member.displayName;
      p.house = inferHouse(interaction.member, fresh);
      p.level = inferLevel(interaction.member, fresh);
      p.lastSeenAt = new Date().toISOString();
      embed = profileEmbed(interaction.member, fresh);
    });
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }
  if (id === 'kc4:profile:prestige') {
    let result = null;
    await mutateGuildState(interaction.guildId, async (fresh) => {
      const p = identity(fresh, interaction.user.id);
      if ((p.kingdomXp ?? 0) < 1000) return;
      p.kingdomXp -= 1000;
      p.prestige = (p.prestige ?? 0) + 1;
      p.achievements ??= [];
      p.achievements.push(`Prestige ${p.prestige}`);
      result = p.prestige;
    });
    return interaction.reply(eph(result ? `✨ You reached **Prestige ${result}**.` : 'You need at least **1,000 personal Kingdom XP** to prestige.'));
  }
  if (id === 'kc4:quests:mine') return interaction.reply(questPayload(state, interaction.user.id));
  if (id === 'kc4:houses:standings') return interaction.reply(housePayload(state));

  if (id === 'kc4:carrier:shift') {
    if (!isCarrier(interaction.member, state)) return interaction.reply(eph('Only Knights/carriers can record verified service.'));
    let text = '';
    await mutateGuildState(interaction.guildId, async (fresh) => {
      const p = carrierProfile(fresh, interaction.user.id);
      if (p.shiftStartedAt) {
        const minutes = Math.max(1, Math.round((Date.now() - new Date(p.shiftStartedAt).getTime()) / 60000));
        p.serviceMinutes = (p.serviceMinutes ?? 0) + minutes;
        p.lastShiftMinutes = minutes;
        p.shiftStartedAt = null;
        p.status = 'off';
        text = `⏹️ Service stopped. **${minutes} verified minutes** recorded.`;
      } else {
        p.shiftStartedAt = new Date().toISOString();
        p.status = 'available';
        text = '▶️ Verified service started. Complete carries normally; grouped parties count wall-clock time once.';
      }
    });
    await refresh(interaction);
    return interaction.reply(eph(text));
  }
  if (id === 'kc4:carrier:academy') {
    if (!isCarrier(interaction.member, state)) return interaction.reply(eph('Knight Academy is for the carrier team.'));
    const p = carrierProfile(state, interaction.user.id);
    const academy = state.carrierOps?.academy?.[interaction.user.id] ?? {};
    return interaction.reply({
      embeds: [branded('🎓 My Knight Academy Progress').addFields(
        { name: 'Supervised Runs', value: `**${academy.supervisedRuns ?? Math.min(5, p.completedRuns ?? 0)}/5**`, inline: true },
        { name: 'Knowledge Check', value: academy.knowledgePassed ? '✅ Passed' : '⬜ Pending', inline: true },
        { name: 'Certification', value: (state.carrierOps?.certifications?.[interaction.user.id] ?? []).join(', ') || 'Base carrier qualification', inline: true },
        { name: 'Service', value: `**${p.serviceMinutes ?? 0} min** • ${p.playersHelped ?? 0} players helped` }
      )],
      flags: MessageFlags.Ephemeral
    });
  }
  if (id === 'kc4:carrier:commend') {
    const eligible = Object.values(state.carryTickets ?? {})
      .filter((t) => t.status === 'completed' && t.carrierId && (t.members ?? [t.userId]).includes(interaction.user.id))
      .slice(-25).reverse();
    const unique = [...new Map(eligible.map((t) => [t.carrierId, t])).values()].slice(0, 25);
    if (!unique.length) return interaction.reply(eph('Complete a carry before commending a Knight.'));
    return interaction.reply({
      embeds: [branded('🏅 Commend a Knight').setDescription('Choose a Knight from one of your completed carries.')],
      components: [new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId('kc4:commend:target').setPlaceholder('Select a Knight').addOptions(
          unique.map((t) => ({ label: `Knight ${t.carrierId.slice(-6)}`, description: `${t.dungeon} • ${t.id}`.slice(0, 100), value: t.carrierId, emoji: '🛡️' }))
        )
      )],
      flags: MessageFlags.Ephemeral
    });
  }

  if (id === 'kc4:treasury:request') return interaction.showModal(treasuryModal());
  if (id === 'kc4:market:create') return interaction.showModal(marketModal());
  if (id === 'kc4:market:browse') return interaction.reply(marketBrowse(state));
  if (id === 'kc4:market:intel') return interaction.reply(marketIntel(state));

  if (id === 'kc4:security:audit') {
    if (!isStaff(interaction.member, state)) return interaction.reply(eph('Only Kingdom staff can audit server drift.'));
    const findings = await auditDigitalTwin(interaction.guild, state);
    await mutateGuildState(interaction.guildId, async (fresh) => { fresh.securityV4.drift = findings; });
    return interaction.reply({ embeds: [branded('🪞 Digital Twin Audit', findings.length ? 0xfee75c : 0x57f287).setDescription(
      findings.length ? findings.slice(0, 20).map((x) => `• **${x.severity.toUpperCase()}** — ${x.message}`).join('\n') : '✅ **No drift detected.** The live server matches the latest snapshot.'
    )], flags: MessageFlags.Ephemeral });
  }
  if (id === 'kc4:security:repair' || id === 'kc4:system:repair') {
    if (!isStaff(interaction.member, state)) return interaction.reply(eph('Only Kingdom staff can run self-repair.'));
    const result = await repairDigitalTwin(interaction.guild);
    await refresh(interaction);
    return interaction.reply(eph(`🛠️ Repair pass complete: **${result.repaired} repaired**, **${result.skipped} skipped**.`));
  }
  if (id === 'kc4:security:snapshot') {
    if (!isStaff(interaction.member, state)) return interaction.reply(eph('Only Kingdom staff can create server snapshots.'));
    let snap;
    await mutateGuildState(interaction.guildId, async (fresh) => {
      snap = await captureDigitalTwin(interaction.guild, fresh);
      fresh.securityV4.snapshots ??= [];
      fresh.securityV4.snapshots.push(snap);
      if (fresh.securityV4.snapshots.length > 10) fresh.securityV4.snapshots = fresh.securityV4.snapshots.slice(-10);
    });
    return interaction.reply(eph(`📸 Snapshot **${snap.id}** captured.`));
  }
  if (id === 'kc4:security:registry') {
    if (!isStaff(interaction.member, state)) return interaction.reply(eph('Only Kingdom staff can view security registries.'));
    const hooks = await scanWebhookRegistry(interaction.guild);
    const approved = state.securityV4?.approvedBots ?? [];
    return interaction.reply({ embeds: [branded('📚 Bot + Webhook Registry').addFields(
      { name: 'Approved Bots', value: approved.length ? approved.map((x) => `<@${x}>`).join('\n').slice(0, 1024) : 'None', inline: true },
      { name: 'Registered Webhooks', value: Object.values(hooks).length ? Object.values(hooks).slice(0, 15).map((x) => `• **${x.name}** • <#${x.channelId}>`).join('\n') : 'None', inline: true }
    )], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  }
  if (id === 'kc4:security:lockdown') {
    if (!isStaff(interaction.member, state)) return interaction.reply(eph('Only Kingdom staff can trigger lockdown.'));
    const result = await applyEmergencyLockdown(interaction.guild, `Manual lockdown by ${interaction.user.id}`);
    await refresh(interaction);
    return interaction.reply(eph(result.already ? 'Lockdown is already active.' : `🚨 **LOCKDOWN ACTIVE** — ${result.changed} public text surfaces restricted.`));
  }
  if (id === 'kc4:security:unlock') {
    if (!isStaff(interaction.member, state)) return interaction.reply(eph('Only Kingdom staff can end lockdown.'));
    const result = await endEmergencyLockdown(interaction.guild);
    await refresh(interaction);
    return interaction.reply(eph(result.already ? 'Lockdown is not active.' : `🔓 Lockdown ended — ${result.changed} channel overwrites restored.`));
  }

  if (id === 'kc4:system:health') return interaction.reply(healthPayload(interaction.guild, state));
  if (id === 'kc4:system:flags') {
    if (!isStaff(interaction.member, state)) return interaction.reply(eph('Only Kingdom staff can view feature configuration.'));
    const flags = Object.entries(state.platform?.featureFlags ?? {});
    return interaction.reply({
      embeds: [branded('🚩 Feature Flags').setDescription(flags.map(([k, v]) => `${v ? '🟢' : '⚫'} **${k}**`).join('\n').slice(0, 4000))],
      flags: MessageFlags.Ephemeral
    });
  }
  return false;
}

export async function handleV4Select(interaction) {
  const id = interaction.customId;
  if (!id.startsWith('kc4:')) return false;
  const state = await readGuildState(interaction.guildId);

  if (id === 'kc4:carrier:status') {
    if (!isCarrier(interaction.member, state)) return interaction.reply(eph('Only Knights/carriers can set carrier duty status.'));
    const value = interaction.values[0];
    await mutateGuildState(interaction.guildId, async (fresh) => {
      const p = carrierProfile(fresh, interaction.user.id);
      p.status = value;
      p.statusChangedAt = new Date().toISOString();
    });
    return interaction.reply(eph(`${value === 'available' ? '🟢' : value === 'busy' ? '🟡' : '🔴'} Carrier status set to **${value.toUpperCase()}**.`));
  }

  if (id === 'kc4:commend:target') {
    const target = interaction.values[0];
    return interaction.update({
      embeds: [branded('🏅 Choose a Commendation').setDescription(`Commending <@${target}>. Pick the strongest reason.`)],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`kc4:commend:give:${target}:friendly`).setLabel('Friendly').setEmoji('❤️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`kc4:commend:give:${target}:fast`).setLabel('Fast').setEmoji('⚡').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`kc4:commend:give:${target}:helpful`).setLabel('Helpful').setEmoji('🧭').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`kc4:commend:give:${target}:patient`).setLabel('Patient').setEmoji('🤝').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`kc4:commend:give:${target}:leader`).setLabel('Leadership').setEmoji('👑').setStyle(ButtonStyle.Success)
      )],
      allowedMentions: { parse: [] }
    });
  }
  return false;
}

export async function handleV4CommendButton(interaction) {
  if (!interaction.customId.startsWith('kc4:commend:give:')) return false;
  const [, , , targetId, kind] = interaction.customId.split(':');
  let accepted = false;
  await mutateGuildState(interaction.guildId, async (state) => {
    const eligible = Object.values(state.carryTickets ?? {}).some((t) =>
      t.status === 'completed' && t.carrierId === targetId && (t.members ?? [t.userId]).includes(interaction.user.id));
    if (!eligible) return;
    const duplicate = (state.carrierOps?.commendations ?? []).some((x) => x.fromId === interaction.user.id && x.toId === targetId && x.kind === kind && Date.now() - new Date(x.at).getTime() < 86400000);
    if (duplicate) return;
    const p = carrierProfile(state, targetId);
    p.commendations ??= {};
    p.commendations[kind] = (p.commendations[kind] ?? 0) + 1;
    p.reputation ??= { positive: 0, neutral: 0, concerns: 0, score: 100 };
    p.reputation.positive = (p.reputation.positive ?? 0) + 1;
    p.reputation.score = Math.min(100, Math.round(90 + Math.min(10, p.reputation.positive / 5)));
    state.carrierOps.commendations ??= [];
    state.carrierOps.commendations.push({ fromId: interaction.user.id, toId: targetId, kind, at: new Date().toISOString() });
    accepted = true;
  });
  return interaction.update({ content: accepted ? `🏅 Commendation recorded for <@${targetId}>: **${kind}**.` : 'That commendation could not be recorded or was already given recently.', embeds: [], components: [], allowedMentions: { parse: [] } });
}

export async function handleV4Modal(interaction) {
  if (!interaction.customId.startsWith('kc4:')) return false;

  if (interaction.customId === 'kc4:treasury:submit') {
    const item = interaction.fields.getTextInputValue('kc4:treasury:item').trim();
    const reason = interaction.fields.getTextInputValue('kc4:treasury:reason').trim();
    const id = `TR-${Date.now().toString(36).toUpperCase()}`;
    let reviewChannelId = null;
    await mutateGuildState(interaction.guildId, async (state) => {
      state.treasuryV4 ??= { requests: {} };
      state.treasuryV4.requests ??= {};
      state.treasuryV4.requests[id] = { id, userId: interaction.user.id, item, reason, status: 'pending', createdAt: new Date().toISOString() };
      reviewChannelId = state.setup?.channels?.treasuryRequestsV4;
    });
    const channel = interaction.guild.channels.cache.get(reviewChannelId);
    if (channel?.isTextBased()) {
      await channel.send({
        embeds: [branded(`🏦 Treasury Request • ${id}`).setDescription(`**${item}**\n> ${reason}`).addFields({ name: 'Requester', value: `<@${interaction.user.id}>` })],
        components: [new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`kc4:treasury:decision:${id}:approved`).setLabel('Approve').setEmoji('✅').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`kc4:treasury:decision:${id}:denied`).setLabel('Deny').setEmoji('❌').setStyle(ButtonStyle.Danger)
        )],
        allowedMentions: { parse: [] }
      }).catch(() => null);
    }
    return interaction.reply(eph(`✅ Treasury request **${id}** submitted for staff review.`));
  }

  if (interaction.customId === 'kc4:market:submit') {
    const item = interaction.fields.getTextInputValue('kc4:market:item').trim();
    const price = interaction.fields.getTextInputValue('kc4:market:price').trim();
    const notes = interaction.fields.getTextInputValue('kc4:market:notes').trim();
    const id = `MK-${Date.now().toString(36).toUpperCase()}`;
    let channelId = null;
    await mutateGuildState(interaction.guildId, async (state) => {
      state.marketV4 ??= { listings: {}, history: [] };
      state.marketV4.listings ??= {};
      state.marketV4.listings[id] = { id, sellerId: interaction.user.id, item, price, notes, status: 'active', createdAt: new Date().toISOString() };
      state.marketV4.history ??= [];
      state.marketV4.history.push({ id, item, price, sellerId: interaction.user.id, at: new Date().toISOString(), event: 'listed' });
      channelId = state.setup?.channels?.marketplaceV4;
      const p = identity(state, interaction.user.id);
      p.stats.trades = (p.stats.trades ?? 0) + 1;
    });
    const channel = interaction.guild.channels.cache.get(channelId);
    if (channel?.isTextBased()) {
      await channel.send({
        embeds: [branded(`🏪 Marketplace Listing • ${id}`, 0x57f287).setDescription(`**${item}**\nPrice / Trade: **${price}**${notes ? `\n> ${notes}` : ''}`).addFields({ name: 'Seller', value: `<@${interaction.user.id}>` })],
        allowedMentions: { parse: [] }
      }).catch(() => null);
    }
    return interaction.reply(eph(`✅ Listing **${id}** published.`));
  }
  return false;
}

export async function handleV4DecisionButton(interaction) {
  const id = interaction.customId;
  if (!id.startsWith('kc4:treasury:decision:')) return false;
  const state = await readGuildState(interaction.guildId);
  if (!isStaff(interaction.member, state)) return interaction.reply(eph('Only Kingdom staff can decide treasury requests.'));
  const [, , , requestId, decision] = id.split(':');
  let request = null;
  await mutateGuildState(interaction.guildId, async (fresh) => {
    request = fresh.treasuryV4?.requests?.[requestId] ?? null;
    if (!request || request.status !== 'pending') return;
    request.status = decision;
    request.reviewedBy = interaction.user.id;
    request.reviewedAt = new Date().toISOString();
    fresh.treasuryV4.history ??= [];
    fresh.treasuryV4.history.push({ type: 'request-decision', requestId, decision, reviewerId: interaction.user.id, at: new Date().toISOString() });
  });
  if (!request) return interaction.reply(eph('That treasury request is no longer pending.'));
  return interaction.update({
    embeds: [branded(`🏦 Treasury Request • ${requestId}`, decision === 'approved' ? 0x57f287 : 0xed4245).setDescription(`**${request.item}**\n> ${request.reason}`).addFields(
      { name: 'Requester', value: `<@${request.userId}>`, inline: true },
      { name: 'Decision', value: `**${decision.toUpperCase()}**`, inline: true },
      { name: 'Reviewed By', value: `<@${interaction.user.id}>`, inline: true }
    )],
    components: [],
    allowedMentions: { parse: [] }
  });
}
