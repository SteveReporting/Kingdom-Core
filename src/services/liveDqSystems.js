import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  Events,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';

import {
  getBankAccount,
  getBankHealth,
  getDQSystemSnapshot,
  getSentinelAlerts,
  recordRunAndWatch,
  requestBankDeposit,
  requestBankWithdrawal,
  reviewBankRequest,
  runOracle,
  searchGenome,
  simulateDungeon,
  transferBankBalance
} from '../dq/index.js';
import { callLocalKingdomAi } from '../nexus/ops.js';
import { getMarketValue, parseGoldToTrillions, searchMarketItems } from './marketIntelligence.js';
import { mutateGuildState, readGuildState } from '../storage/store.js';

const EPHEMERAL = MessageFlags.Ephemeral;
const pendingDeposits = new Map();
const chatCooldowns = new Map();
const installedClients = new WeakSet();
const PANEL_REFRESH_MS = 15 * 60_000;

function normalizeName(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function findTextChannel(guild, aliases = []) {
  const wanted = aliases.map(normalizeName).filter(Boolean);
  const channels = [...guild.channels.cache.values()].filter((channel) => channel?.isTextBased?.() && !channel.isThread?.());
  for (const alias of wanted) {
    const exact = channels.find((channel) => normalizeName(channel.name) === alias);
    if (exact) return exact;
  }
  for (const alias of wanted) {
    const partial = channels.find((channel) => normalizeName(channel.name).endsWith(alias));
    if (partial) return partial;
  }
  return null;
}

function resolveSurfaces(guild) {
  return {
    dq: findTextChannel(guild, ['dungeon-quest', 'dq-chat', 'dq']),
    help: findTextChannel(guild, ['game-help', 'dq-help', 'help']),
    bank: findTextChannel(guild, ['royal-treasury', 'asset-bank', 'treasury']),
    market: findTextChannel(guild, ['price-check', 'pricecheck', 'marketplace']),
    sentinel: findTextChannel(guild, ['security-log', 'audit-log', 'staff-logs', 'carrier-logs'])
  };
}

function fmtGold(trillions) {
  const value = Number(trillions);
  if (!Number.isFinite(value)) return '—';
  if (value >= 1000) return `${Number((value / 1000).toFixed(value >= 100_000 ? 0 : value >= 10_000 ? 1 : 2))}Q`;
  if (value >= 1) return `${Number(value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2))}T`;
  return `${Number((value * 1000).toFixed(value >= 0.1 ? 0 : 1))}B`;
}

function fmtSeconds(seconds) {
  const total = Math.max(0, Math.round(Number(seconds)));
  if (!Number.isFinite(total)) return '—';
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return minutes ? `${minutes}m ${String(secs).padStart(2, '0')}s` : `${secs}s`;
}

function pct(value, digits = 0) {
  return Number.isFinite(Number(value)) ? `${(Number(value) * 100).toFixed(digits)}%` : '—';
}

function compactData(data) {
  if (!data || typeof data !== 'object' || !Object.keys(data).length) return 'No structured facts yet.';
  return Object.entries(data)
    .slice(0, 8)
    .map(([key, value]) => `**${key}:** ${String(value).slice(0, 120)}`)
    .join('\n');
}

function hubRows() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('kcdq:genome').setLabel('Genome').setEmoji('🧬').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('kcdq:twin').setLabel('Digital Twin').setEmoji('🪞').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('kcdq:oracle').setLabel('Oracle').setEmoji('🔮').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('kcdq:sentinel').setLabel('Sentinel').setEmoji('👁️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('kcdq:record').setLabel('Record Run').setEmoji('📥').setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('kcdq:status').setLabel('Live System Status').setEmoji('⚙️').setStyle(ButtonStyle.Secondary)
    )
  ];
}

function bankRows() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('kcdq:bank:balance').setLabel('My Balance').setEmoji('💰').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('kcdq:bank:deposit').setLabel('Deposit').setEmoji('📥').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('kcdq:bank:withdraw').setLabel('Withdraw').setEmoji('📤').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('kcdq:bank:transfer').setLabel('Transfer').setEmoji('🔁').setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('kcdq:bank:review').setLabel('Review Request').setEmoji('🛡️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('kcdq:bank:health').setLabel('Reserve Health').setEmoji('🏦').setStyle(ButtonStyle.Secondary)
    )
  ];
}

async function hubPayload(guildId) {
  const snapshot = await getDQSystemSnapshot(guildId);
  return {
    embeds: [new EmbedBuilder()
      .setColor(0x6f42c1)
      .setAuthor({ name: 'KINGDOM DUNGEON QUEST INTELLIGENCE' })
      .setTitle('⚙️ Live DQ Systems')
      .setDescription([
        'The DQ intelligence layer is **live here** — no slash commands required.',
        '',
        'Use the controls below for structured actions. In **game-help**, talk to Kingdom AI normally; in this channel you can also mention Kingdom Core with a DQ question.'
      ].join('\n'))
      .addFields(
        { name: '🧬 Genome', value: `**${snapshot.genome.entities}** entities • **${snapshot.genome.runs}** runs • **${snapshot.genome.strategies}** strategies`, inline: true },
        { name: '🪞 Digital Twin', value: 'Simulation engine trained from recorded Genome runs.', inline: true },
        { name: '🔮 Oracle', value: 'Ranks DQ decisions by progression, speed, gold, XP or safety.', inline: true },
        { name: '👁️ Sentinel', value: `**${snapshot.sentinel.activeAlerts}** active anomaly alert(s)`, inline: true },
        { name: '🏦 Asset Bank', value: `**${snapshot.bank.accounts}** accounts • **${snapshot.bank.heldAssets}** held asset(s)`, inline: true }
      )
      .setFooter({ text: 'Genome → Twin → Oracle • Sentinel watches evidence • live UI only' })
      .setTimestamp()],
    components: hubRows()
  };
}

async function bankPayload(guildId) {
  const health = await getBankHealth(guildId);
  const coverage = Number.isFinite(health.coverageRatio) ? `${health.coverageRatio.toFixed(2)}×` : '—';
  return {
    embeds: [new EmbedBuilder()
      .setColor(0x16a085)
      .setAuthor({ name: 'DQ ASSET BANK' })
      .setTitle('🏦 Royal Treasury • Live Asset Bank')
      .setDescription('Deposits, balances, transfers and withdrawals are handled from this panel. Physical Dungeon Quest assets still require operator verification before credit is created.')
      .addFields(
        { name: 'Held Market Value', value: fmtGold(health.heldMarketValueT), inline: true },
        { name: 'Member Liabilities', value: fmtGold(health.liabilitiesT), inline: true },
        { name: 'Coverage', value: coverage, inline: true },
        { name: 'Pending Deposits', value: String(health.pendingDeposits), inline: true },
        { name: 'Pending Withdrawals', value: String(health.pendingWithdrawals), inline: true }
      )
      .setFooter({ text: 'Kingdom Core • operator-verified DQ assets' })
      .setTimestamp()],
    components: bankRows()
  };
}

function helpPayload() {
  return {
    embeds: [new EmbedBuilder()
      .setColor(0x5865f2)
      .setAuthor({ name: 'KINGDOM AI • LIVE DQ HELP' })
      .setTitle('🤖 Ask normally — no command needed')
      .setDescription([
        'Ask Dungeon Quest questions in this channel and Kingdom AI will answer using live Kingdom context and Genome evidence.',
        '',
        '**If Message Content Intent is not enabled yet:** mention **@Kingdom Core** in the question and the bot can still answer mention-triggered messages.',
        '',
        'Genome is used as the evidence layer; the AI is instructed not to pretend it performed actions it did not perform.'
      ].join('\n'))
      .setFooter({ text: 'Kingdom AI • live conversation surface' })]
  };
}

function marketPayload() {
  return {
    embeds: [new EmbedBuilder()
      .setColor(0x57f287)
      .setAuthor({ name: 'KINGDOM MARKET INTELLIGENCE' })
      .setTitle('💎 Live Price Check')
      .setDescription('Type an item name here for a live KMI lookup. No `/value` command is required for normal price checks.')
      .setFooter({ text: 'Kingdom Core • KMI-backed market data' })]
  };
}

async function ensurePanel(guild, key, channel, payloadFactory) {
  if (!channel?.isTextBased?.()) return null;
  const state = await readGuildState(guild.id);
  const savedId = state.liveDQ?.panels?.[key];
  let message = null;
  if (savedId) message = await channel.messages.fetch(savedId).catch(() => null);
  const payload = await payloadFactory();
  if (message) {
    await message.edit(payload).catch(() => null);
    return message;
  }
  message = await channel.send(payload);
  await message.pin('Kingdom Core live DQ system surface').catch(() => null);
  await mutateGuildState(guild.id, (draft) => {
    draft.liveDQ ??= {};
    draft.liveDQ.panels ??= {};
    draft.liveDQ.panels[key] = message.id;
    draft.liveDQ.updatedAt = new Date().toISOString();
  });
  return message;
}

export async function ensureLiveDQSurfaces(guild) {
  await guild.channels.fetch().catch(() => null);
  const surfaces = resolveSurfaces(guild);
  const results = { dq: false, help: false, bank: false, market: false };

  if (surfaces.dq) {
    results.dq = Boolean(await ensurePanel(guild, 'hub', surfaces.dq, () => hubPayload(guild.id)));
  }
  if (surfaces.help) {
    results.help = Boolean(await ensurePanel(guild, 'help', surfaces.help, async () => helpPayload()));
  }
  if (surfaces.bank) {
    results.bank = Boolean(await ensurePanel(guild, 'bank', surfaces.bank, () => bankPayload(guild.id)));
  }
  if (surfaces.market) {
    results.market = Boolean(await ensurePanel(guild, 'market', surfaces.market, async () => marketPayload()));
  }

  await mutateGuildState(guild.id, (draft) => {
    draft.liveDQ ??= {};
    draft.liveDQ.surfaces = Object.fromEntries(Object.entries(surfaces).map(([key, channel]) => [key, channel?.id ?? null]));
    draft.liveDQ.lastSurfaceSync = new Date().toISOString();
  });

  return { surfaces, results };
}

function textInput(id, label, { placeholder = '', required = true, style = TextInputStyle.Short, maxLength = 200 } = {}) {
  return new TextInputBuilder()
    .setCustomId(id)
    .setLabel(label.slice(0, 45))
    .setPlaceholder(placeholder.slice(0, 100))
    .setStyle(style)
    .setRequired(required)
    .setMaxLength(maxLength);
}

function modal(id, title, inputs) {
  const form = new ModalBuilder().setCustomId(id).setTitle(title.slice(0, 45));
  form.addComponents(...inputs.map((input) => new ActionRowBuilder().addComponents(input)));
  return form;
}

async function showGenomeModal(interaction) {
  return interaction.showModal(modal('kcdqmodal:genome', 'Search DQ Genome', [
    textInput('query', 'What do you want Genome to find?', { placeholder: 'item, dungeon, boss, build, mechanic…', maxLength: 180 })
  ]));
}

async function showTwinModal(interaction) {
  return interaction.showModal(modal('kcdqmodal:twin', 'Run Digital Twin', [
    textInput('dungeon', 'Dungeon', { placeholder: 'e.g. Volcanic Chambers' }),
    textInput('difficulty', 'Difficulty', { placeholder: 'e.g. Nightmare / Hardcore' }),
    textInput('party', 'Party size', { placeholder: '1', required: false, maxLength: 3 }),
    textInput('power', 'Power / POT metric', { placeholder: 'optional', required: false, maxLength: 20 }),
    textInput('baseline', 'Fallback clear seconds', { placeholder: 'optional', required: false, maxLength: 20 })
  ]));
}

async function showOracleModal(interaction) {
  return interaction.showModal(modal('kcdqmodal:oracle', 'Ask DQ Oracle', [
    textInput('objective', 'Objective', { placeholder: 'progress / speed / gold / xp / safety', maxLength: 20 }),
    textInput('dungeon', 'Dungeon', { placeholder: 'optional if Genome has strategies', required: false }),
    textInput('difficulty', 'Difficulty', { placeholder: 'optional', required: false }),
    textInput('party', 'Party size', { placeholder: 'optional', required: false, maxLength: 3 }),
    textInput('risk', 'Risk tolerance 0–1', { placeholder: '0.5', required: false, maxLength: 8 })
  ]));
}

async function showRunModal(interaction) {
  return interaction.showModal(modal('kcdqmodal:record', 'Record Dungeon Quest Run', [
    textInput('dungeon', 'Dungeon'),
    textInput('difficulty', 'Difficulty'),
    textInput('clear', 'Clear time in seconds', { placeholder: 'e.g. 142', maxLength: 12 }),
    textInput('party', 'Party size', { placeholder: '1', required: false, maxLength: 3 }),
    textInput('gold', 'Gold earned', { placeholder: 'e.g. 850B or 1.4T', required: false, maxLength: 20 })
  ]));
}

async function showDepositModal(interaction) {
  return interaction.showModal(modal('kcdqmodal:bank:deposit', 'Asset Bank Deposit', [
    textInput('item', 'Item name', { placeholder: 'Search the KMI catalogue', maxLength: 100 }),
    textInput('pot', 'POT / potential', { placeholder: 'optional', required: false, maxLength: 20 }),
    textInput('quantity', 'Quantity', { placeholder: '1', required: false, maxLength: 3 })
  ]));
}

async function showWithdrawModal(interaction) {
  return interaction.showModal(modal('kcdqmodal:bank:withdraw', 'Asset Bank Withdrawal', [
    textInput('amount', 'Amount', { placeholder: '850B / 4.2T / 1Q', maxLength: 30 }),
    textInput('settlement', 'Preferred settlement', { placeholder: 'gold / item / equivalent assets', required: false, maxLength: 100 })
  ]));
}

async function showTransferModal(interaction) {
  return interaction.showModal(modal('kcdqmodal:bank:transfer', 'Asset Bank Transfer', [
    textInput('member', 'Recipient Discord user ID / mention', { placeholder: '123456789…', maxLength: 40 }),
    textInput('amount', 'Amount', { placeholder: '850B / 4.2T / 1Q', maxLength: 30 }),
    textInput('memo', 'Memo', { placeholder: 'optional', required: false, maxLength: 120 })
  ]));
}

async function showReviewModal(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({ content: 'Asset Bank review requires **Manage Server**.', flags: EPHEMERAL });
  }
  return interaction.showModal(modal('kcdqmodal:bank:review', 'Review Asset Bank Request', [
    textInput('request', 'Request ID', { placeholder: 'dep_… or wd_…', maxLength: 80 }),
    textInput('action', 'Decision', { placeholder: 'approve or reject', maxLength: 10 }),
    textInput('note', 'Settlement / review note', { placeholder: 'optional', required: false, style: TextInputStyle.Paragraph, maxLength: 500 })
  ]));
}

async function replyStatus(interaction) {
  const snapshot = await getDQSystemSnapshot(interaction.guildId);
  return interaction.reply({
    embeds: [new EmbedBuilder()
      .setColor(0x6f42c1)
      .setTitle('⚙️ DQ Systems Online')
      .addFields(
        { name: '🧬 Genome', value: `${snapshot.genome.entities} entities • ${snapshot.genome.runs} runs • ${snapshot.genome.strategies} strategies`, inline: true },
        { name: '👁️ Sentinel', value: `${snapshot.sentinel.series} signals • ${snapshot.sentinel.activeAlerts} active`, inline: true },
        { name: '🪞 Twin', value: 'Online', inline: true },
        { name: '🔮 Oracle', value: 'Online', inline: true },
        { name: '🏦 Bank', value: `${snapshot.bank.accounts} accounts • ${snapshot.bank.heldAssets} held assets`, inline: true }
      )
      .setTimestamp()],
    flags: EPHEMERAL
  });
}

async function replySentinel(interaction) {
  const alerts = await getSentinelAlerts(interaction.guildId, { limit: 8 });
  if (!alerts.length) return interaction.reply({ content: '👁️ Sentinel has no active DQ anomalies right now.', flags: EPHEMERAL });
  return interaction.reply({
    embeds: [new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle('👁️ Active DQ Anomalies')
      .setDescription(alerts.map((alert) => {
        const change = Number.isFinite(alert.relativeChange) ? `${alert.relativeChange >= 0 ? '+' : ''}${(alert.relativeChange * 100).toFixed(1)}%` : 'n/a';
        return `**${String(alert.severity).toUpperCase()} • ${alert.metric}**\n${alert.entityKey} • value ${Number(alert.value).toFixed(2)} • baseline ${Number(alert.baselineMean).toFixed(2)} • ${change}`;
      }).join('\n\n').slice(0, 3900))],
    flags: EPHEMERAL
  });
}

async function replyBankBalance(interaction) {
  const account = await getBankAccount(interaction.guildId, interaction.user.id);
  return interaction.reply({
    embeds: [new EmbedBuilder()
      .setColor(0x1abc9c)
      .setTitle(`🏦 ${interaction.user.username} • Asset Bank`)
      .addFields(
        { name: 'Available', value: `**${fmtGold(account.availableT)}**`, inline: true },
        { name: 'Locked', value: fmtGold(account.lockedT), inline: true },
        { name: 'Total', value: fmtGold(account.totalT), inline: true },
        { name: 'Pending Requests', value: String(account.pendingRequests.length), inline: true },
        { name: 'Lifetime Deposits', value: fmtGold(account.lifetimeDepositsT), inline: true },
        { name: 'Lifetime Withdrawals', value: fmtGold(account.lifetimeWithdrawalsT), inline: true }
      )],
    flags: EPHEMERAL
  });
}

async function replyBankHealth(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({ content: 'Reserve health requires **Manage Server**.', flags: EPHEMERAL });
  }
  const health = await getBankHealth(interaction.guildId);
  return interaction.reply({
    embeds: [new EmbedBuilder()
      .setColor(0x16a085)
      .setTitle('🏦 Asset Bank Reserve Health')
      .addFields(
        { name: 'Held Market Value', value: fmtGold(health.heldMarketValueT), inline: true },
        { name: 'Liabilities', value: fmtGold(health.liabilitiesT), inline: true },
        { name: 'Coverage', value: Number.isFinite(health.coverageRatio) ? `${health.coverageRatio.toFixed(2)}×` : '—', inline: true },
        { name: 'Held Assets', value: String(health.heldAssets), inline: true },
        { name: 'Pending Deposits', value: String(health.pendingDeposits), inline: true },
        { name: 'Pending Withdrawals', value: String(health.pendingWithdrawals), inline: true }
      )],
    flags: EPHEMERAL
  });
}

async function handleButton(interaction) {
  switch (interaction.customId) {
    case 'kcdq:genome': return showGenomeModal(interaction);
    case 'kcdq:twin': return showTwinModal(interaction);
    case 'kcdq:oracle': return showOracleModal(interaction);
    case 'kcdq:sentinel': return replySentinel(interaction);
    case 'kcdq:record': return showRunModal(interaction);
    case 'kcdq:status': return replyStatus(interaction);
    case 'kcdq:bank:balance': return replyBankBalance(interaction);
    case 'kcdq:bank:deposit': return showDepositModal(interaction);
    case 'kcdq:bank:withdraw': return showWithdrawModal(interaction);
    case 'kcdq:bank:transfer': return showTransferModal(interaction);
    case 'kcdq:bank:review': return showReviewModal(interaction);
    case 'kcdq:bank:health': return replyBankHealth(interaction);
    default: return false;
  }
}

async function handleGenomeModal(interaction) {
  const query = interaction.fields.getTextInputValue('query').trim();
  const results = await searchGenome(interaction.guildId, query, { limit: 8 });
  if (!results.length) return interaction.reply({ content: `Genome has no knowledge matching **${query}** yet. Record real runs and observations to grow it.`, flags: EPHEMERAL });
  return interaction.reply({
    embeds: [new EmbedBuilder()
      .setColor(0x2ecc71)
      .setAuthor({ name: 'DUNGEON QUEST GENOME' })
      .setTitle(`🧬 ${query}`)
      .setDescription(results.map((entity, index) => `### ${index + 1}. ${entity.name}\n**Type:** ${entity.kind} • **Confidence:** ${pct(entity.confidence)}\n${compactData(entity.data)}`).join('\n\n').slice(0, 3900))],
    flags: EPHEMERAL
  });
}

async function handleTwinModal(interaction) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const twin = await simulateDungeon(interaction.guildId, {
    dungeon: interaction.fields.getTextInputValue('dungeon').trim(),
    difficulty: interaction.fields.getTextInputValue('difficulty').trim(),
    partySize: Number(interaction.fields.getTextInputValue('party')) || undefined,
    power: Number(interaction.fields.getTextInputValue('power')) || undefined,
    baselineSeconds: Number(interaction.fields.getTextInputValue('baseline')) || undefined,
    samples: 2000
  });
  return interaction.editReply({
    embeds: [new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle(`🪞 ${twin.dungeon} • ${twin.difficulty}`)
      .addFields(
        { name: 'Expected Clear', value: fmtSeconds(twin.expectedClearSeconds), inline: true },
        { name: 'Clear Rate', value: pct(twin.clearRate, 1), inline: true },
        { name: 'Confidence', value: `${pct(twin.confidence)} • ${twin.evidenceCount} real runs`, inline: true },
        { name: 'Fast / Median / Slow', value: `${fmtSeconds(twin.clearTimeP10)} • ${fmtSeconds(twin.clearTimeP50)} • ${fmtSeconds(twin.clearTimeP90)}`, inline: false }
      )
      .setFooter({ text: `${twin.sampleCount.toLocaleString()} simulations • model ${twin.modelVersion}` })]
  });
}

async function handleOracleModal(interaction) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const objective = interaction.fields.getTextInputValue('objective').trim().toLowerCase();
  if (!['progress', 'speed', 'gold', 'xp', 'safety'].includes(objective)) {
    return interaction.editReply('Objective must be **progress, speed, gold, xp, or safety**.');
  }
  const result = await runOracle(interaction.guildId, {
    objective,
    dungeon: interaction.fields.getTextInputValue('dungeon').trim() || undefined,
    difficulty: interaction.fields.getTextInputValue('difficulty').trim() || undefined,
    partySize: Number(interaction.fields.getTextInputValue('party')) || undefined,
    riskTolerance: Number(interaction.fields.getTextInputValue('risk')) || 0.5
  });
  const best = result.best;
  return interaction.editReply({
    embeds: [new EmbedBuilder()
      .setColor(0x9b59b6)
      .setTitle(`🔮 Oracle • ${objective.toUpperCase()}`)
      .setDescription(`## ${best.name}\n**Score:** ${best.score100}/100\n${best.reason}`)
      .addFields(...result.alternatives.slice(0, 4).map((entry, index) => ({
        name: `Alternative ${index + 1} • ${entry.name}`,
        value: `Score **${entry.score100}/100** • ${entry.reason}`.slice(0, 1024)
      })))
      .setFooter({ text: `${result.evaluated} strategy/scenario candidate(s) evaluated` })]
  });
}

async function handleRecordModal(interaction) {
  const clearSeconds = Number(interaction.fields.getTextInputValue('clear'));
  if (!Number.isFinite(clearSeconds) || clearSeconds <= 0) {
    return interaction.reply({ content: 'Clear time must be a positive number of seconds.', flags: EPHEMERAL });
  }
  const goldRaw = interaction.fields.getTextInputValue('gold').trim();
  const goldT = goldRaw ? parseGoldToTrillions(goldRaw) : null;
  if (goldRaw && !Number.isFinite(goldT)) return interaction.reply({ content: 'I could not parse that gold amount.', flags: EPHEMERAL });
  const result = await recordRunAndWatch(interaction.guildId, {
    dungeon: interaction.fields.getTextInputValue('dungeon').trim(),
    difficulty: interaction.fields.getTextInputValue('difficulty').trim(),
    success: true,
    clearSeconds,
    partySize: Number(interaction.fields.getTextInputValue('party')) || 1,
    goldT,
    actorId: interaction.user.id,
    source: 'discord-live-ui'
  });
  if (result.alerts.length) {
    const surface = resolveSurfaces(interaction.guild).sentinel || resolveSurfaces(interaction.guild).dq;
    if (surface) {
      await surface.send(`👁️ **DQ Sentinel:** ${result.alerts.length} new anomaly/anomalies detected from run \`${result.run.id}\`: ${result.alerts.map((x) => `${x.metric} (${x.severity})`).join(', ')}`).catch(() => null);
    }
  }
  return interaction.reply({ content: `🧬 Run \`${result.run.id}\` recorded. Genome learned from it and Sentinel checked the evidence.`, flags: EPHEMERAL });
}

async function handleDepositModal(interaction) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const query = interaction.fields.getTextInputValue('item').trim();
  const potRaw = interaction.fields.getTextInputValue('pot').trim();
  const pot = potRaw ? Number(potRaw) : null;
  const quantity = Math.max(1, Math.min(999, Number(interaction.fields.getTextInputValue('quantity')) || 1));
  const choices = await searchMarketItems(query, 25);
  if (!choices.length) return interaction.editReply(`No KMI items matched **${query}**.`);
  const key = `${interaction.guildId}:${interaction.user.id}`;
  pendingDeposits.set(key, { pot: Number.isFinite(pot) ? pot : null, quantity, createdAt: Date.now() });
  const menu = new StringSelectMenuBuilder()
    .setCustomId('kcdq:bank:deposit:select')
    .setPlaceholder('Choose the exact item / rarity')
    .addOptions(choices.map((choice) => ({ label: choice.name, value: choice.value })));
  return interaction.editReply({
    content: 'Select the exact KMI item/rarity to create the deposit request:',
    components: [new ActionRowBuilder().addComponents(menu)]
  });
}

async function handleDepositSelect(interaction) {
  const key = `${interaction.guildId}:${interaction.user.id}`;
  const pending = pendingDeposits.get(key);
  if (!pending || Date.now() - pending.createdAt > 10 * 60_000) {
    pendingDeposits.delete(key);
    return interaction.reply({ content: 'That deposit selection expired. Press **Deposit** again.', flags: EPHEMERAL });
  }
  pendingDeposits.delete(key);
  await interaction.deferReply({ flags: EPHEMERAL });
  const request = await requestBankDeposit(interaction.guildId, {
    userId: interaction.user.id,
    itemKey: interaction.values[0],
    pot: pending.pot,
    quantity: pending.quantity
  });
  return interaction.editReply([
    '🏦 **Asset Bank deposit request created**',
    `**${request.quantity}× ${request.itemName}${request.rarity ? ` • ${request.rarity}` : ''}**`,
    `KMI value: **${fmtGold(request.marketValueT)}**`,
    `Bank credit after physical verification: **${fmtGold(request.creditValueT)}**`,
    `Request: \`${request.id}\``,
    '',
    '**No balance has been created yet.** An authorized operator must verify receipt of the physical DQ asset first.'
  ].join('\n'));
}

async function handleWithdrawModal(interaction) {
  const amountT = parseGoldToTrillions(interaction.fields.getTextInputValue('amount'));
  if (!Number.isFinite(amountT)) return interaction.reply({ content: 'I could not parse that withdrawal amount.', flags: EPHEMERAL });
  const request = await requestBankWithdrawal(interaction.guildId, {
    userId: interaction.user.id,
    amountT,
    preferredSettlement: interaction.fields.getTextInputValue('settlement').trim() || undefined
  });
  return interaction.reply({ content: `🏦 Withdrawal \`${request.id}\` created for **${fmtGold(request.amountT)}**. The amount is locked until an operator settles or rejects it.`, flags: EPHEMERAL });
}

async function handleTransferModal(interaction) {
  const rawMember = interaction.fields.getTextInputValue('member');
  const memberId = rawMember.match(/\d{15,22}/)?.[0];
  if (!memberId || memberId === interaction.user.id) return interaction.reply({ content: 'Enter a different valid Discord user ID or mention.', flags: EPHEMERAL });
  const user = await interaction.client.users.fetch(memberId).catch(() => null);
  if (!user || user.bot) return interaction.reply({ content: 'The recipient must be a real Discord user.', flags: EPHEMERAL });
  const amountT = parseGoldToTrillions(interaction.fields.getTextInputValue('amount'));
  if (!Number.isFinite(amountT)) return interaction.reply({ content: 'I could not parse that transfer amount.', flags: EPHEMERAL });
  const result = await transferBankBalance(interaction.guildId, {
    fromUserId: interaction.user.id,
    toUserId: memberId,
    amountT,
    memo: interaction.fields.getTextInputValue('memo').trim() || undefined
  });
  return interaction.reply({ content: `🏦 Transferred **${fmtGold(amountT)}** to <@${memberId}>. New available balance: **${fmtGold(result.from.availableT)}**.`, flags: EPHEMERAL });
}

async function handleReviewModal(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ content: 'Asset Bank review requires **Manage Server**.', flags: EPHEMERAL });
  const action = interaction.fields.getTextInputValue('action').trim().toLowerCase();
  if (!['approve', 'reject'].includes(action)) return interaction.reply({ content: 'Decision must be **approve** or **reject**.', flags: EPHEMERAL });
  const result = await reviewBankRequest(interaction.guildId, {
    requestId: interaction.fields.getTextInputValue('request').trim(),
    action,
    operatorId: interaction.user.id,
    note: interaction.fields.getTextInputValue('note').trim() || undefined
  });
  const amount = result.request.type === 'deposit' ? result.request.creditValueT : result.request.amountT;
  return interaction.reply({ content: `🏦 Request \`${result.request.id}\` **${result.request.status}** for <@${result.request.userId}> • **${fmtGold(amount)}**.`, flags: EPHEMERAL });
}

async function handleModal(interaction) {
  switch (interaction.customId) {
    case 'kcdqmodal:genome': return handleGenomeModal(interaction);
    case 'kcdqmodal:twin': return handleTwinModal(interaction);
    case 'kcdqmodal:oracle': return handleOracleModal(interaction);
    case 'kcdqmodal:record': return handleRecordModal(interaction);
    case 'kcdqmodal:bank:deposit': return handleDepositModal(interaction);
    case 'kcdqmodal:bank:withdraw': return handleWithdrawModal(interaction);
    case 'kcdqmodal:bank:transfer': return handleTransferModal(interaction);
    case 'kcdqmodal:bank:review': return handleReviewModal(interaction);
    default: return false;
  }
}

async function marketReply(message, query) {
  try {
    const matches = await searchMarketItems(query, 5);
    if (!matches.length) return message.reply({ content: `I could not find a KMI item matching **${query}**.`, allowedMentions: { repliedUser: false } });
    const detailed = [];
    for (const match of matches.slice(0, 3)) {
      const detail = await getMarketValue(match.value).catch(() => null);
      const market = detail?.market;
      detailed.push(market
        ? `**${market.item_name ?? match.name}** • ${market.rarity ?? ''}\nFair value: **${fmtGold(market.fair_value_t)}**${Number.isFinite(Number(market.confidence)) ? ` • confidence ${pct(market.confidence)}` : ''}`
        : `**${match.name}**`);
    }
    return message.reply({
      embeds: [new EmbedBuilder().setColor(0x57f287).setTitle('💎 KMI Price Check').setDescription(detailed.join('\n\n').slice(0, 3900)).setTimestamp()],
      allowedMentions: { repliedUser: false }
    });
  } catch (error) {
    return message.reply({ content: `KMI lookup failed: ${String(error?.message ?? error).slice(0, 500)}`, allowedMentions: { repliedUser: false } }).catch(() => null);
  }
}

async function aiReply(message, prompt) {
  const cooldownKey = `${message.guildId}:${message.author.id}`;
  const last = chatCooldowns.get(cooldownKey) ?? 0;
  if (Date.now() - last < 4_000) return;
  chatCooldowns.set(cooldownKey, Date.now());

  await message.channel.sendTyping().catch(() => null);
  const [genome, snapshot] = await Promise.all([
    searchGenome(message.guildId, prompt, { limit: 6 }).catch(() => []),
    getDQSystemSnapshot(message.guildId).catch(() => null)
  ]);
  const context = {
    guild: { id: message.guildId, name: message.guild?.name },
    genome: genome.map((entity) => ({ name: entity.name, kind: entity.kind, confidence: entity.confidence, data: entity.data })),
    dqSystems: snapshot
  };

  try {
    const answer = await callLocalKingdomAi(prompt, context);
    if (answer) {
      return message.reply({ content: answer.slice(0, 1950), allowedMentions: { repliedUser: false } });
    }
  } catch {
    // Fall back to structured Genome evidence below when the model endpoint is unavailable.
  }

  if (genome.length) {
    const evidence = genome.slice(0, 4).map((entity) => `**${entity.name}** (${entity.kind}, ${pct(entity.confidence)})\n${compactData(entity.data)}`).join('\n\n');
    return message.reply({
      content: `🤖 The generative AI endpoint is unavailable, but Genome is still live. Closest evidence:\n\n${evidence}`.slice(0, 1950),
      allowedMentions: { repliedUser: false }
    });
  }
  return message.reply({
    content: '🤖 Kingdom AI is waiting for its local model endpoint, and Genome does not have matching evidence yet. The live DQ panels are still available.',
    allowedMentions: { repliedUser: false }
  });
}

async function handleMessage(message) {
  if (!message.inGuild?.() || message.author?.bot) return;
  const surfaces = resolveSurfaces(message.guild);
  const channelId = message.channelId;
  const mentioned = Boolean(message.client.user && message.mentions?.users?.has(message.client.user.id));
  const repliedToBot = Boolean(message.reference?.messageId && await message.channel.messages.fetch(message.reference.messageId).then((m) => m.author.id === message.client.user.id).catch(() => false));
  let content = String(message.content ?? '').trim();
  if (message.client.user) content = content.replace(new RegExp(`<@!?${message.client.user.id}>`, 'g'), '').trim();
  if (!content) return;

  if (surfaces.market?.id === channelId) {
    return marketReply(message, content);
  }

  const dedicatedHelp = surfaces.help?.id === channelId;
  const dqMention = surfaces.dq?.id === channelId && (mentioned || repliedToBot);
  if (dedicatedHelp || dqMention || mentioned || repliedToBot) {
    return aiReply(message, content);
  }
}

async function handleInteraction(interaction) {
  if (!interaction.inGuild?.()) return;
  try {
    if (interaction.isButton?.() && interaction.customId.startsWith('kcdq:')) {
      const handled = await handleButton(interaction);
      if (handled !== false) return;
    }
    if (interaction.isModalSubmit?.() && interaction.customId.startsWith('kcdqmodal:')) {
      const handled = await handleModal(interaction);
      if (handled !== false) return;
    }
    if (interaction.isStringSelectMenu?.() && interaction.customId === 'kcdq:bank:deposit:select') {
      return handleDepositSelect(interaction);
    }
  } catch (error) {
    const payload = { content: `DQ live system error: ${String(error?.message ?? error).slice(0, 1200)}`, flags: EPHEMERAL };
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => null);
    else await interaction.reply(payload).catch(() => null);
  }
}

export function installLiveDQSystems(client) {
  if (installedClients.has(client)) return;
  installedClients.add(client);

  client.once(Events.ClientReady, async (readyClient) => {
    for (const guild of readyClient.guilds.cache.values()) {
      await ensureLiveDQSurfaces(guild).catch((error) => console.error(`[LiveDQ] surface sync failed for ${guild.name}:`, error));
    }
    const timer = setInterval(() => {
      for (const guild of readyClient.guilds.cache.values()) {
        ensureLiveDQSurfaces(guild).catch((error) => console.error(`[LiveDQ] refresh failed for ${guild.name}:`, error));
      }
      for (const [key, pending] of pendingDeposits) {
        if (Date.now() - pending.createdAt > 10 * 60_000) pendingDeposits.delete(key);
      }
    }, PANEL_REFRESH_MS);
    timer.unref?.();
  });

  client.on(Events.MessageCreate, (message) => {
    handleMessage(message).catch((error) => console.error('[LiveDQ] message handler failed:', error));
  });

  client.on(Events.InteractionCreate, (interaction) => {
    handleInteraction(interaction).catch((error) => console.error('[LiveDQ] interaction handler failed:', error));
  });
}
