import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import {
  getMarketValue,
  parseGoldToTrillions,
  recognizeMarketPhoto,
  searchMarketItems
} from '../services/marketIntelligence.js';
import { recordMarketSnapshot } from '../dq/marketBridge.js';

const RARITY_COLORS = {
  Grey: 0x99aab5,
  Green: 0x57f287,
  Blue: 0x3498db,
  Purple: 0x9b59b6,
  Legendary: 0xe67e22,
  Ultimate: 0xed4245
};

export const data = new SlashCommandBuilder()
  .setName('value')
  .setDescription('Kingdom Market Intelligence — value an item or check a trade price.')
  .setDMPermission(false)
  .addStringOption((option) => option
    .setName('mode')
    .setDescription('What should KMI calculate?')
    .setRequired(true)
    .addChoices(
      { name: '📈 Market Value', value: 'market' },
      { name: '⚖️ Is This Fair?', value: 'fair' }
    ))
  .addStringOption((option) => option
    .setName('item')
    .setDescription('Type an item name and select the exact rarity from autocomplete.')
    .setAutocomplete(true))
  .addAttachmentOption((option) => option
    .setName('photo')
    .setDescription('Upload an item screenshot and KMI will read the item and POT.'))
  .addNumberOption((option) => option
    .setName('pot')
    .setDescription('Current POT/potential. Overrides the photo value.'))
  .addIntegerOption((option) => option
    .setName('upgrades')
    .setDescription('Current upgrade count, if known.'))
  .addNumberOption((option) => option
    .setName('base')
    .setDescription('Base POT, if known. KMI can infer POT using +10 per upgrade.'))
  .addStringOption((option) => option
    .setName('gold')
    .setDescription('Fair Trade mode only: requested gold, e.g. 850B, 4.2T or 1Q.'));

export async function autocomplete(interaction) {
  const focused = interaction.options.getFocused(true);
  if (focused.name !== 'item') return interaction.respond([]).catch(() => null);
  try {
    const choices = await searchMarketItems(String(focused.value || ''), 25);
    return interaction.respond(choices).catch(() => null);
  } catch {
    return interaction.respond([]).catch(() => null);
  }
}

function fmtGold(trillions) {
  if (!Number.isFinite(trillions)) return '—';
  if (trillions >= 1000) {
    const value = trillions / 1000;
    return `${Number(value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2))}Q`;
  }
  if (trillions >= 1) return `${Number(trillions.toFixed(trillions >= 100 ? 0 : trillions >= 10 ? 1 : 2))}T`;
  const billions = trillions * 1000;
  return `${Number(billions.toFixed(billions >= 100 ? 0 : billions >= 10 ? 1 : 2))}B`;
}

function fmtPercent(value) {
  if (!Number.isFinite(value)) return '—';
  const percent = value * 100;
  return `${percent >= 0 ? '+' : ''}${percent.toFixed(1)}%`;
}

function inferPot(base, upgrades, min, max) {
  if (!Number.isFinite(base) || !Number.isFinite(upgrades)) return null;
  const inferred = base + upgrades * 10;
  if (Number.isFinite(min) && inferred < min) return null;
  if (Number.isFinite(max) && inferred > max) return null;
  return inferred;
}

function fairVerdict(market, priceT) {
  if (!Number.isFinite(market?.fair_value_t) || !Number.isFinite(priceT)) return null;
  const fair = market.fair_value_t;
  const low = Number.isFinite(market.fair_low_t) ? market.fair_low_t : fair * 0.9;
  const high = Number.isFinite(market.fair_high_t) ? market.fair_high_t : fair * 1.1;
  const difference = priceT / fair - 1;

  if (priceT >= low && priceT <= high) {
    return { title: '✅ FAIR TRADE', text: `The requested price is **${fmtPercent(difference)}** from KMI fair value and sits inside the current fair range.` };
  }
  if (priceT < low) {
    return { title: '📉 BELOW MARKET', text: `The requested price is **${Math.abs(difference * 100).toFixed(1)}% below** KMI fair value.` };
  }
  return { title: '📈 ABOVE MARKET', text: `The requested price is **${Math.abs(difference * 100).toFixed(1)}% above** KMI fair value.` };
}

function buildEmbed({ market, pot, upgrades, base, photo, photoConfidence, mode, tradeGold }) {
  const itemName = market.item_name || 'Unknown Item';
  const rarity = market.rarity || 'Unknown';
  const minPot = Number.isFinite(market.min_potential) ? market.min_potential : null;
  const maxPot = Number.isFinite(market.max_potential) ? market.max_potential : null;
  const potPercent = Number.isFinite(pot) && Number.isFinite(minPot) && Number.isFinite(maxPot) && maxPot > minPot
    ? Math.round(((pot - minPot) / (maxPot - minPot)) * 100)
    : null;

  const statBits = [];
  if (Number.isFinite(pot)) statBits.push(`**POT:** ${pot}${Number.isFinite(maxPot) ? ` / ${maxPot}` : ''}${potPercent != null ? ` • ${Math.max(0, Math.min(100, potPercent))}%` : ''}`);
  if (Number.isFinite(upgrades)) statBits.push(`**Upgrades:** ${upgrades}`);
  if (Number.isFinite(base)) statBits.push(`**Base:** ${base}`);
  if (Number.isFinite(photoConfidence)) statBits.push(`**Photo:** ${photoConfidence}% confidence`);

  const embed = new EmbedBuilder()
    .setColor(RARITY_COLORS[rarity] || 0x5865f2)
    .setAuthor({ name: 'KINGDOM MARKET INTELLIGENCE' })
    .setTitle(mode === 'fair' ? '⚖️ Fair Trade Check' : '📈 Market Value')
    .setDescription(`### ${itemName} • ${rarity}\n${statBits.join(' • ') || '*No extra item stats supplied*'}`)
    .setFooter({ text: 'KMI • recent market weighted • duplicate/outlier filtered • POT adjusted' })
    .setTimestamp();

  if (photo) embed.setThumbnail(photo.url);

  if (!Number.isFinite(market.fair_value_t)) {
    embed.addFields({
      name: 'Market Status',
      value: `**Collecting data.** KMI does not yet have enough reliable observations for this exact market.\nSamples: **${market.sample_count || 0}**`
    });
    return embed;
  }

  embed.addFields(
    { name: 'KMI Fair Value', value: `## ${fmtGold(market.fair_value_t)}`, inline: true },
    { name: 'Fair Range', value: `${fmtGold(market.fair_low_t)} – ${fmtGold(market.fair_high_t)}`, inline: true },
    { name: 'Confidence', value: `**${market.confidence ?? 0}%** • ${market.sample_count ?? 0} samples`, inline: true },
    { name: '24H / 7D', value: `${fmtGold(market.value_24h_t)} / ${fmtGold(market.value_7d_t)}`, inline: true },
    { name: '24H vs 7D', value: fmtPercent(market.trend_24h_vs_7d), inline: true },
    { name: '24H Volume', value: String(market.volume_24h ?? 0), inline: true }
  );

  if (mode === 'fair' && Number.isFinite(tradeGold)) {
    const verdict = fairVerdict(market, tradeGold);
    embed.addFields(
      { name: 'Requested Gold', value: `## ${fmtGold(tradeGold)}`, inline: true },
      { name: verdict.title, value: verdict.text, inline: false }
    );
  }
  return embed;
}

export async function execute(interaction) {
  if (!interaction.inGuild()) return;

  const mode = interaction.options.getString('mode', true);
  const itemInput = interaction.options.getString('item');
  const photo = interaction.options.getAttachment('photo');
  let pot = interaction.options.getNumber('pot');
  let upgrades = interaction.options.getInteger('upgrades');
  let base = interaction.options.getNumber('base');
  const goldInput = interaction.options.getString('gold');

  if (!itemInput && !photo) {
    return interaction.reply({
      content: 'Give KMI either an **item** from autocomplete or an **item screenshot** in `photo`.',
      flags: MessageFlags.Ephemeral
    });
  }

  if (mode === 'fair' && !goldInput) {
    return interaction.reply({
      content: 'For **Is This Fair?**, add the `gold` being requested, for example `850B`, `4.2T` or `1Q`.',
      flags: MessageFlags.Ephemeral
    });
  }

  const tradeGold = mode === 'fair' ? parseGoldToTrillions(goldInput) : null;
  if (mode === 'fair' && !Number.isFinite(tradeGold)) {
    return interaction.reply({
      content: 'I could not understand that gold amount. Use something like **850B**, **4.2T**, **1Q**, or a bare number in trillions.',
      flags: MessageFlags.Ephemeral
    });
  }

  if (photo && !(photo.contentType || '').startsWith('image/')) {
    return interaction.reply({ content: '`photo` must be an image.', flags: MessageFlags.Ephemeral });
  }

  await interaction.deferReply();

  try {
    let scan = null;
    if (photo) scan = await recognizeMarketPhoto(photo.url);

    const itemKey = itemInput || scan?.itemKey;
    if (!itemKey) {
      return interaction.editReply('KMI could not identify that screenshot. Upload a clearer item image or type the item and select it from autocomplete.');
    }

    pot = Number.isFinite(pot) ? pot : scan?.pot ?? null;
    upgrades = Number.isFinite(upgrades) ? upgrades : scan?.upgrades ?? null;
    base = Number.isFinite(base) ? base : scan?.base ?? null;

    let detail = await getMarketValue(itemKey, pot);
    let market = detail.market;

    if (!Number.isFinite(pot)) {
      const inferred = inferPot(base, upgrades, market.min_potential, market.max_potential);
      if (Number.isFinite(inferred)) {
        pot = inferred;
        detail = await getMarketValue(itemKey, pot);
        market = detail.market;
      }
    }

    if (Number.isFinite(pot)) {
      if (Number.isFinite(market.min_potential) && pot < market.min_potential) {
        return interaction.editReply(`That POT is below the canonical **${market.item_name} • ${market.rarity}** range of **${market.min_potential}–${market.max_potential}**.`);
      }
      if (Number.isFinite(market.max_potential) && pot > market.max_potential) {
        return interaction.editReply(`That POT is above the canonical **${market.item_name} • ${market.rarity}** range of **${market.min_potential}–${market.max_potential}**.`);
      }
    }

    await recordMarketSnapshot(interaction.guildId, {
      itemKey,
      market,
      pot,
      actorId: interaction.user.id,
      source: 'kmi-value-command'
    }).catch((error) => console.warn('[KMI → DQ bridge]', error?.message || error));

    return interaction.editReply({
      embeds: [buildEmbed({
        market,
        pot,
        upgrades,
        base,
        photo,
        photoConfidence: scan?.confidence ?? null,
        mode,
        tradeGold
      })]
    });
  } catch (error) {
    console.error('[KMI /value]', error);
    return interaction.editReply(`Kingdom Market Intelligence is unavailable right now: ${String(error?.message || error).slice(0, 800)}`);
  }
}
