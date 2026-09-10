import { recordGenomeObservation, upsertGenomeEntity } from './genome.js';
import { ingestSentinelSignal } from './sentinel.js';

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function confidence01(value, fallback = 0.7) {
  const number = finite(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number > 1 ? number / 100 : number));
}

export async function recordMarketSnapshot(guildId, input = {}) {
  const itemKey = String(input.itemKey || '').trim();
  const market = input.market || {};
  const itemName = String(market.item_name || input.itemName || itemKey || 'Unknown Item').trim();
  if (!itemKey) throw new Error('Market bridge requires itemKey.');
  const entityKey = `item:${itemKey}`;
  const source = input.source || 'kmi';
  const confidence = confidence01(market.confidence, 0.75);
  const context = {
    itemKey,
    itemName,
    rarity: market.rarity || null,
    pot: Number.isFinite(Number(input.pot)) ? Number(input.pot) : null,
    sampleCount: finite(market.sample_count),
    actorId: input.actorId || null
  };

  await upsertGenomeEntity(guildId, {
    key: entityKey,
    kind: 'item',
    name: itemName,
    aliases: [itemKey, `${itemName} ${market.rarity || ''}`.trim()],
    confidence,
    source,
    data: {
      rarity: market.rarity || null,
      minPotential: finite(market.min_potential),
      maxPotential: finite(market.max_potential),
      lastFairValueT: finite(market.fair_value_t),
      fairLowT: finite(market.fair_low_t),
      fairHighT: finite(market.fair_high_t),
      value24hT: finite(market.value_24h_t),
      value7dT: finite(market.value_7d_t),
      volume24h: finite(market.volume_24h),
      lastSampleCount: finite(market.sample_count)
    }
  });

  const observed = [];
  const metrics = [
    ['market.fair_value_t', market.fair_value_t, 'T'],
    ['market.fair_low_t', market.fair_low_t, 'T'],
    ['market.fair_high_t', market.fair_high_t, 'T'],
    ['market.value_24h_t', market.value_24h_t, 'T'],
    ['market.value_7d_t', market.value_7d_t, 'T'],
    ['market.volume_24h', market.volume_24h, 'trades']
  ];

  for (const [metric, rawValue, unit] of metrics) {
    const value = finite(rawValue);
    if (!Number.isFinite(value)) continue;
    observed.push(await recordGenomeObservation(guildId, {
      metric,
      value,
      unit,
      entityKey,
      context,
      source,
      confidence
    }));
  }

  const alerts = [];
  if (Number.isFinite(finite(market.fair_value_t))) {
    const result = await ingestSentinelSignal(guildId, {
      metric: 'market.fair_value_t',
      value: Number(market.fair_value_t),
      entityKey,
      context,
      source,
      minSamples: 8,
      baselineWindow: 30,
      changeThreshold: 0.12,
      zThreshold: 3
    });
    if (result.alert) alerts.push(result.alert);
  }
  if (Number.isFinite(finite(market.volume_24h))) {
    const result = await ingestSentinelSignal(guildId, {
      metric: 'market.volume_24h',
      value: Number(market.volume_24h),
      entityKey,
      context,
      source,
      minSamples: 8,
      baselineWindow: 30,
      changeThreshold: 0.35,
      zThreshold: 3.5
    });
    if (result.alert) alerts.push(result.alert);
  }

  return { entityKey, observations: observed.length, alerts };
}
