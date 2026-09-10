import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder
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
import { parseGoldToTrillions, searchMarketItems } from '../services/marketIntelligence.js';

const EPHEMERAL = MessageFlags.Ephemeral;

export const data = new SlashCommandBuilder()
  .setName('dq')
  .setDescription('Dungeon Quest Genome, Sentinel, Digital Twin, Oracle and Asset Bank.')
  .setDMPermission(false)
  .addSubcommand((sub) => sub
    .setName('status')
    .setDescription('Show the five Dungeon Quest system cores and their current data.'))
  .addSubcommand((sub) => sub
    .setName('genome')
    .setDescription('Search the Dungeon Quest Genome knowledge base.')
    .addStringOption((option) => option.setName('query').setDescription('Item, dungeon, boss, ability, build, mechanic, etc.').setRequired(true)))
  .addSubcommand((sub) => sub
    .setName('record-run')
    .setDescription('Feed a real Dungeon Quest run into Genome, Twin and Sentinel.')
    .addStringOption((option) => option.setName('dungeon').setDescription('Dungeon name.').setRequired(true))
    .addStringOption((option) => option.setName('difficulty').setDescription('Difficulty.').setRequired(true))
    .addBooleanOption((option) => option.setName('success').setDescription('Did the run clear? Defaults to yes.'))
    .addNumberOption((option) => option.setName('clear-seconds').setDescription('Clear time in seconds for a successful run.').setMinValue(1))
    .addIntegerOption((option) => option.setName('party-size').setDescription('Players in the run.').setMinValue(1).setMaxValue(50))
    .addNumberOption((option) => option.setName('power').setDescription('Relevant build power/POT metric if known.').setMinValue(0))
    .addNumberOption((option) => option.setName('health').setDescription('Health if known.').setMinValue(0))
    .addStringOption((option) => option.setName('gold').setDescription('Gold earned, e.g. 850B or 1.4T.'))
    .addNumberOption((option) => option.setName('xp').setDescription('XP earned if known.').setMinValue(0))
    .addIntegerOption((option) => option.setName('deaths').setDescription('Party/player deaths if tracked.').setMinValue(0)))
  .addSubcommand((sub) => sub
    .setName('twin')
    .setDescription('Simulate a Dungeon Quest run using the Digital Twin.')
    .addStringOption((option) => option.setName('dungeon').setDescription('Dungeon name.').setRequired(true))
    .addStringOption((option) => option.setName('difficulty').setDescription('Difficulty.').setRequired(true))
    .addIntegerOption((option) => option.setName('party-size').setDescription('Party size.').setMinValue(1).setMaxValue(50))
    .addNumberOption((option) => option.setName('power').setDescription('Build power/POT metric if known.').setMinValue(0))
    .addNumberOption((option) => option.setName('health').setDescription('Health if known.').setMinValue(0))
    .addNumberOption((option) => option.setName('baseline-seconds').setDescription('Fallback clear-time baseline when Genome has little data.').setMinValue(5))
    .addIntegerOption((option) => option.setName('samples').setDescription('Simulation samples (100-10000).').setMinValue(100).setMaxValue(10000)))
  .addSubcommand((sub) => sub
    .setName('oracle')
    .setDescription('Ask Oracle for the best known Dungeon Quest decision.')
    .addStringOption((option) => option
      .setName('objective')
      .setDescription('What should Oracle optimize?')
      .setRequired(true)
      .addChoices(
        { name: 'Progression', value: 'progress' },
        { name: 'Fastest clears', value: 'speed' },
        { name: 'Gold', value: 'gold' },
        { name: 'XP', value: 'xp' },
        { name: 'Safest clear', value: 'safety' }
      ))
    .addStringOption((option) => option.setName('dungeon').setDescription('Restrict to one dungeon, or use Genome strategies when omitted.'))
    .addStringOption((option) => option.setName('difficulty').setDescription('Difficulty when a dungeon is supplied.'))
    .addIntegerOption((option) => option.setName('party-size').setDescription('Party size.').setMinValue(1).setMaxValue(50))
    .addNumberOption((option) => option.setName('power').setDescription('Build power/POT metric if known.').setMinValue(0))
    .addNumberOption((option) => option.setName('health').setDescription('Health if known.').setMinValue(0))
    .addNumberOption((option) => option.setName('risk').setDescription('Risk tolerance from 0 (safe) to 1 (aggressive).').setMinValue(0).setMaxValue(1)))
  .addSubcommand((sub) => sub
    .setName('sentinel')
    .setDescription('Show recent Dungeon Quest anomalies Sentinel has detected.'))
  .addSubcommand((sub) => sub
    .setName('bank-balance')
    .setDescription('Show a DQ Asset Bank balance.')
    .addUserOption((option) => option.setName('member').setDescription('Member; defaults to you.')))
  .addSubcommand((sub) => sub
    .setName('bank-deposit')
    .setDescription('Request an item deposit into the DQ Asset Bank.')
    .addStringOption((option) => option.setName('item').setDescription('Select an exact KMI item/rarity.').setAutocomplete(true).setRequired(true))
    .addNumberOption((option) => option.setName('pot').setDescription('Current POT/potential, if known.').setMinValue(0))
    .addIntegerOption((option) => option.setName('quantity').setDescription('Number of identical items.').setMinValue(1).setMaxValue(999)))
  .addSubcommand((sub) => sub
    .setName('bank-transfer')
    .setDescription('Transfer Asset Bank balance instantly to another member.')
    .addUserOption((option) => option.setName('member').setDescription('Recipient.').setRequired(true))
    .addStringOption((option) => option.setName('amount').setDescription('Amount, e.g. 850B, 4.2T or 1Q.').setRequired(true))
    .addStringOption((option) => option.setName('memo').setDescription('Optional transfer memo.')))
  .addSubcommand((sub) => sub
    .setName('bank-withdraw')
    .setDescription('Request a withdrawal from your Asset Bank balance.')
    .addStringOption((option) => option.setName('amount').setDescription('Amount, e.g. 850B, 4.2T or 1Q.').setRequired(true))
    .addStringOption((option) => option.setName('settlement').setDescription('Preferred payout: gold, item, or equivalent assets.')))
  .addSubcommand((sub) => sub
    .setName('bank-review')
    .setDescription('Staff: approve/reject a physical deposit or withdrawal after verifying it in game.')
    .addStringOption((option) => option.setName('request').setDescription('Deposit/withdrawal request ID.').setRequired(true))
    .addStringOption((option) => option
      .setName('action')
      .setDescription('Decision.')
      .setRequired(true)
      .addChoices({ name: 'Approve', value: 'approve' }, { name: 'Reject', value: 'reject' }))
    .addStringOption((option) => option.setName('note').setDescription('Optional settlement/review note.')))
  .addSubcommand((sub) => sub
    .setName('bank-health')
    .setDescription('Staff: show Asset Bank reserves, liabilities and pending settlement load.'));

function fmtGold(trillions) {
  if (!Number.isFinite(Number(trillions))) return '—';
  const value = Number(trillions);
  if (value >= 1000) return `${Number((value / 1000).toFixed(value >= 100_000 ? 0 : value >= 10_000 ? 1 : 2))}Q`;
  if (value >= 1) return `${Number(value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2))}T`;
  return `${Number((value * 1000).toFixed(value >= 0.1 ? 0 : 1))}B`;
}

function fmtSeconds(seconds) {
  if (!Number.isFinite(Number(seconds))) return '—';
  const total = Math.max(0, Math.round(Number(seconds)));
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return minutes ? `${minutes}m ${String(secs).padStart(2, '0')}s` : `${secs}s`;
}

function pct(value, digits = 0) {
  return Number.isFinite(Number(value)) ? `${(Number(value) * 100).toFixed(digits)}%` : '—';
}

function isOperator(interaction) {
  return Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild));
}

function compactData(data) {
  if (!data || typeof data !== 'object' || !Object.keys(data).length) return 'No structured facts yet.';
  return Object.entries(data).slice(0, 8).map(([key, value]) => `**${key}:** ${String(value).slice(0, 120)}`).join('\n');
}

export async function autocomplete(interaction) {
  if (interaction.options.getSubcommand(false) !== 'bank-deposit') return interaction.respond([]).catch(() => null);
  const focused = interaction.options.getFocused(true);
  if (focused.name !== 'item') return interaction.respond([]).catch(() => null);
  try {
    return interaction.respond(await searchMarketItems(String(focused.value || ''), 25));
  } catch {
    return interaction.respond([]).catch(() => null);
  }
}

async function executeStatus(interaction) {
  const snapshot = await getDQSystemSnapshot(interaction.guildId);
  const embed = new EmbedBuilder()
    .setColor(0x6f42c1)
    .setAuthor({ name: 'KINGDOM DUNGEON QUEST INTELLIGENCE' })
    .setTitle('⚙️ DQ Systems Online')
    .setDescription('Five connected Dungeon Quest systems running on the same evidence layer.')
    .addFields(
      { name: '🧬 Genome', value: `**${snapshot.genome.entities}** entities • **${snapshot.genome.runs}** recorded runs • **${snapshot.genome.strategies}** strategies`, inline: true },
      { name: '👁️ Sentinel', value: `**${snapshot.sentinel.series}** signals • **${snapshot.sentinel.activeAlerts}** active alerts`, inline: true },
      { name: '🪞 Digital Twin', value: 'Empirical simulation engine • learns from Genome runs', inline: true },
      { name: '🔮 Oracle', value: 'Decision engine • ranks DQ strategies by objective/risk', inline: true },
      { name: '🏦 Asset Bank', value: `${snapshot.bank.accounts} accounts • ${snapshot.bank.heldAssets} held assets • ${fmtGold(snapshot.bank.liabilitiesT)} liabilities`, inline: true }
    )
    .setFooter({ text: 'Genome → Twin → Oracle • Sentinel watches evidence • Asset Bank uses KMI valuation' })
    .setTimestamp();
  return interaction.reply({ embeds: [embed], flags: EPHEMERAL });
}

async function executeGenome(interaction) {
  const query = interaction.options.getString('query', true);
  const results = await searchGenome(interaction.guildId, query, { limit: 8 });
  if (!results.length) {
    return interaction.reply({ content: `Genome has no knowledge matching **${query}** yet. Feed runs/data into it first.`, flags: EPHEMERAL });
  }
  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setAuthor({ name: 'DUNGEON QUEST GENOME' })
    .setTitle(`🧬 ${query}`)
    .setDescription(results.map((entity, index) => `### ${index + 1}. ${entity.name}\n**Type:** ${entity.kind} • **Confidence:** ${pct(entity.confidence)}\n${compactData(entity.data)}`).join('\n\n').slice(0, 3900))
    .setFooter({ text: `${results.length} Genome match(es)` });
  return interaction.reply({ embeds: [embed], flags: EPHEMERAL });
}

async function executeRecordRun(interaction) {
  const success = interaction.options.getBoolean('success') ?? true;
  const clearSeconds = interaction.options.getNumber('clear-seconds');
  if (success && !Number.isFinite(clearSeconds)) {
    return interaction.reply({ content: 'A successful run needs `clear-seconds` so Genome/Twin can learn from it.', flags: EPHEMERAL });
  }
  const goldInput = interaction.options.getString('gold');
  const goldT = goldInput ? parseGoldToTrillions(goldInput) : null;
  if (goldInput && !Number.isFinite(goldT)) return interaction.reply({ content: 'I could not parse that gold amount.', flags: EPHEMERAL });

  const result = await recordRunAndWatch(interaction.guildId, {
    dungeon: interaction.options.getString('dungeon', true),
    difficulty: interaction.options.getString('difficulty', true),
    success,
    clearSeconds,
    partySize: interaction.options.getInteger('party-size') || 1,
    power: interaction.options.getNumber('power'),
    health: interaction.options.getNumber('health'),
    goldT,
    xp: interaction.options.getNumber('xp'),
    deaths: interaction.options.getInteger('deaths'),
    actorId: interaction.user.id,
    source: 'discord-run-record'
  });

  const alertText = result.alerts.length
    ? `\n\n⚠️ **Sentinel detected ${result.alerts.length} anomaly/anomalies:** ${result.alerts.map((x) => `${x.metric} (${x.severity})`).join(', ')}`
    : '';
  return interaction.reply({
    content: `🧬 Run **${result.run.id}** added to Genome. Digital Twin can now learn from it.${alertText}`,
    flags: EPHEMERAL
  });
}

async function executeTwin(interaction) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const twin = await simulateDungeon(interaction.guildId, {
    dungeon: interaction.options.getString('dungeon', true),
    difficulty: interaction.options.getString('difficulty', true),
    partySize: interaction.options.getInteger('party-size') || undefined,
    power: interaction.options.getNumber('power') ?? undefined,
    health: interaction.options.getNumber('health') ?? undefined,
    baselineSeconds: interaction.options.getNumber('baseline-seconds') ?? undefined,
    samples: interaction.options.getInteger('samples') || 2000
  });
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setAuthor({ name: 'DQ DIGITAL TWIN' })
    .setTitle(`🪞 ${twin.dungeon} • ${twin.difficulty}`)
    .addFields(
      { name: 'Expected Clear', value: fmtSeconds(twin.expectedClearSeconds), inline: true },
      { name: 'Clear Rate', value: pct(twin.clearRate, 1), inline: true },
      { name: 'Confidence', value: `${pct(twin.confidence)} • ${twin.evidenceCount} real runs`, inline: true },
      { name: 'Fast / Median / Slow', value: `${fmtSeconds(twin.clearTimeP10)} • ${fmtSeconds(twin.clearTimeP50)} • ${fmtSeconds(twin.clearTimeP90)}`, inline: false }
    )
    .setFooter({ text: `${twin.sampleCount.toLocaleString()} simulations • ${twin.evidenceSource} evidence • model ${twin.modelVersion}` })
    .setTimestamp();
  if (Number.isFinite(twin.goldPerHourT)) embed.addFields({ name: 'Expected Gold', value: `${fmtGold(twin.expectedGoldT)} / run • ${fmtGold(twin.goldPerHourT)} / hour`, inline: true });
  if (Number.isFinite(twin.xpPerHour)) embed.addFields({ name: 'Expected XP', value: `${Math.round(twin.expectedXp).toLocaleString()} / run • ${Math.round(twin.xpPerHour).toLocaleString()} / hour`, inline: true });
  return interaction.editReply({ embeds: [embed] });
}

async function executeOracle(interaction) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const result = await runOracle(interaction.guildId, {
    objective: interaction.options.getString('objective', true),
    dungeon: interaction.options.getString('dungeon') || undefined,
    difficulty: interaction.options.getString('difficulty') || undefined,
    partySize: interaction.options.getInteger('party-size') || undefined,
    power: interaction.options.getNumber('power') ?? undefined,
    health: interaction.options.getNumber('health') ?? undefined,
    riskTolerance: interaction.options.getNumber('risk') ?? 0.5,
    samples: 1200
  });
  const best = result.best;
  const alternatives = result.alternatives.length
    ? result.alternatives.map((entry, index) => `**${index + 2}. ${entry.name}** — ${entry.score100}/100\n${entry.reason}`).join('\n\n')
    : 'No additional Genome strategies are available yet.';
  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setAuthor({ name: 'DQ ORACLE' })
    .setTitle(`🔮 ${best.name}`)
    .setDescription(`### Oracle Score: ${best.score100}/100\n${best.reason}`)
    .addFields({ name: 'Alternatives', value: alternatives.slice(0, 1024) })
    .setFooter({ text: `Objective: ${result.objective} • ${result.evaluated} candidate(s) evaluated` })
    .setTimestamp();
  return interaction.editReply({ embeds: [embed] });
}

async function executeSentinel(interaction) {
  const alerts = await getSentinelAlerts(interaction.guildId, { limit: 8 });
  if (!alerts.length) return interaction.reply({ content: '👁️ Sentinel has no active DQ anomalies right now.', flags: EPHEMERAL });
  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setAuthor({ name: 'DQ SENTINEL' })
    .setTitle('👁️ Active Anomalies')
    .setDescription(alerts.map((alert) => {
      const change = Number.isFinite(alert.relativeChange) ? `${alert.relativeChange >= 0 ? '+' : ''}${(alert.relativeChange * 100).toFixed(1)}%` : 'n/a';
      return `### ${alert.severity.toUpperCase()} • ${alert.metric}\n**${alert.entityKey}** • value **${Number(alert.value).toFixed(2)}** • baseline **${Number(alert.baselineMean).toFixed(2)}** • change **${change}**\n\`${alert.id}\``;
    }).join('\n\n').slice(0, 3900))
    .setTimestamp();
  return interaction.reply({ embeds: [embed], flags: EPHEMERAL });
}

async function executeBankBalance(interaction) {
  const member = interaction.options.getUser('member') || interaction.user;
  if (member.id !== interaction.user.id && !isOperator(interaction)) {
    return interaction.reply({ content: 'You can only view your own Asset Bank balance.', flags: EPHEMERAL });
  }
  const account = await getBankAccount(interaction.guildId, member.id);
  const embed = new EmbedBuilder()
    .setColor(0x1abc9c)
    .setAuthor({ name: 'DQ ASSET BANK' })
    .setTitle(`🏦 ${member.username}`)
    .addFields(
      { name: 'Available', value: `## ${fmtGold(account.availableT)}`, inline: true },
      { name: 'Locked', value: fmtGold(account.lockedT), inline: true },
      { name: 'Total Balance', value: fmtGold(account.totalT), inline: true },
      { name: 'Pending Requests', value: String(account.pendingRequests.length), inline: true },
      { name: 'Lifetime Deposits', value: fmtGold(account.lifetimeDepositsT), inline: true },
      { name: 'Lifetime Withdrawals', value: fmtGold(account.lifetimeWithdrawalsT), inline: true }
    )
    .setFooter({ text: 'Internal balance is backed by verified DQ assets held by the guild.' });
  return interaction.reply({ embeds: [embed], flags: EPHEMERAL });
}

async function executeBankDeposit(interaction) {
  await interaction.deferReply({ flags: EPHEMERAL });
  const request = await requestBankDeposit(interaction.guildId, {
    userId: interaction.user.id,
    itemKey: interaction.options.getString('item', true),
    pot: interaction.options.getNumber('pot'),
    quantity: interaction.options.getInteger('quantity') || 1
  });
  return interaction.editReply([
    `🏦 **Asset Bank deposit request created**`,
    `**${request.quantity}× ${request.itemName}${request.rarity ? ` • ${request.rarity}` : ''}**`,
    `KMI market value: **${fmtGold(request.marketValueT)}**`,
    `Bank credit after verification: **${fmtGold(request.creditValueT)}** (${Math.round(request.creditRate * 100)}% credit rate)`,
    `Request: \`${request.id}\``,
    '',
    '**No balance has been created yet.** Give the physical item(s) to an authorized Asset Bank operator; they approve the request only after verifying receipt in Dungeon Quest.'
  ].join('\n'));
}

async function executeBankTransfer(interaction) {
  const member = interaction.options.getUser('member', true);
  if (member.bot) return interaction.reply({ content: 'Asset Bank balances cannot be transferred to bots.', flags: EPHEMERAL });
  const amountT = parseGoldToTrillions(interaction.options.getString('amount', true));
  if (!Number.isFinite(amountT)) return interaction.reply({ content: 'I could not parse that amount.', flags: EPHEMERAL });
  const result = await transferBankBalance(interaction.guildId, {
    fromUserId: interaction.user.id,
    toUserId: member.id,
    amountT,
    memo: interaction.options.getString('memo')
  });
  return interaction.reply({
    content: `🏦 Transferred **${fmtGold(amountT)}** to <@${member.id}> instantly. Your available balance is now **${fmtGold(result.from.availableT)}**.\nLedger: \`${result.ledger.id}\``,
    flags: EPHEMERAL
  });
}

async function executeBankWithdrawal(interaction) {
  const amountT = parseGoldToTrillions(interaction.options.getString('amount', true));
  if (!Number.isFinite(amountT)) return interaction.reply({ content: 'I could not parse that amount.', flags: EPHEMERAL });
  const request = await requestBankWithdrawal(interaction.guildId, {
    userId: interaction.user.id,
    amountT,
    preferredSettlement: interaction.options.getString('settlement')
  });
  return interaction.reply({
    content: `🏦 Withdrawal **${request.id}** created for **${fmtGold(request.amountT)}**. That balance is locked until an operator settles or rejects the request.`,
    flags: EPHEMERAL
  });
}

async function executeBankReview(interaction) {
  if (!isOperator(interaction)) return interaction.reply({ content: 'This Asset Bank action requires **Manage Server**.', flags: EPHEMERAL });
  const result = await reviewBankRequest(interaction.guildId, {
    requestId: interaction.options.getString('request', true),
    action: interaction.options.getString('action', true),
    operatorId: interaction.user.id,
    note: interaction.options.getString('note')
  });
  const amount = result.request.type === 'deposit' ? result.request.creditValueT : result.request.amountT;
  return interaction.reply({
    content: `🏦 Request \`${result.request.id}\` **${result.request.status}** for <@${result.request.userId}> • **${fmtGold(amount)}**.`,
    flags: EPHEMERAL
  });
}

async function executeBankHealth(interaction) {
  if (!isOperator(interaction)) return interaction.reply({ content: 'This Asset Bank action requires **Manage Server**.', flags: EPHEMERAL });
  const health = await getBankHealth(interaction.guildId);
  const coverage = Number.isFinite(health.coverageRatio) ? `${health.coverageRatio.toFixed(2)}×` : '—';
  const embed = new EmbedBuilder()
    .setColor(0x16a085)
    .setAuthor({ name: 'DQ ASSET BANK • RESERVE CONTROL' })
    .setTitle('🏦 Bank Health')
    .addFields(
      { name: 'Held Market Value', value: fmtGold(health.heldMarketValueT), inline: true },
      { name: 'Member Liabilities', value: fmtGold(health.liabilitiesT), inline: true },
      { name: 'Coverage', value: coverage, inline: true },
      { name: 'Held Assets', value: String(health.heldAssets), inline: true },
      { name: 'Pending Deposits', value: String(health.pendingDeposits), inline: true },
      { name: 'Pending Withdrawals', value: String(health.pendingWithdrawals), inline: true },
      { name: 'Credit Rate', value: pct(health.creditRate), inline: true },
      { name: 'Ledger Entries', value: String(health.ledgerEntries), inline: true }
    )
    .setFooter({ text: 'Physical DQ asset movements remain operator-verified; ledger movements are automatic.' })
    .setTimestamp();
  return interaction.reply({ embeds: [embed], flags: EPHEMERAL });
}

export async function execute(interaction) {
  if (!interaction.inGuild()) return;
  const subcommand = interaction.options.getSubcommand();
  switch (subcommand) {
    case 'status': return executeStatus(interaction);
    case 'genome': return executeGenome(interaction);
    case 'record-run': return executeRecordRun(interaction);
    case 'twin': return executeTwin(interaction);
    case 'oracle': return executeOracle(interaction);
    case 'sentinel': return executeSentinel(interaction);
    case 'bank-balance': return executeBankBalance(interaction);
    case 'bank-deposit': return executeBankDeposit(interaction);
    case 'bank-transfer': return executeBankTransfer(interaction);
    case 'bank-withdraw': return executeBankWithdrawal(interaction);
    case 'bank-review': return executeBankReview(interaction);
    case 'bank-health': return executeBankHealth(interaction);
    default: return interaction.reply({ content: 'Unknown DQ system action.', flags: EPHEMERAL });
  }
}
