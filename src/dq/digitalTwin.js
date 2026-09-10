import crypto from 'node:crypto';
import { getGenomeRuns } from './genome.js';
import { mutateDQState, newDQId, trimArray } from './store.js';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function stddev(values, avg = mean(values)) {
  if (!values.length || !Number.isFinite(avg)) return null;
  if (values.length === 1) return 0;
  const variance = values.reduce((sum, value) => sum + ((value - avg) ** 2), 0) / (values.length - 1);
  return Math.sqrt(Math.max(0, variance));
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * clamp(p, 0, 1);
  const low = Math.floor(index);
  const high = Math.ceil(index);
  if (low === high) return sorted[low];
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
}

function seededRandom(seedText) {
  const digest = crypto.createHash('sha256').update(String(seedText)).digest();
  let seed = digest.readUInt32LE(0) || 1;
  return () => {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(rand) {
  const u = Math.max(Number.EPSILON, rand());
  const v = Math.max(Number.EPSILON, rand());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function averageFinite(records, field) {
  const values = records.map((record) => Number(record[field])).filter(Number.isFinite);
  return mean(values);
}

function modelFromRuns(runs, scenario) {
  const successes = runs.filter((run) => run.success && Number.isFinite(Number(run.clearSeconds)));
  const clearTimes = successes.map((run) => Number(run.clearSeconds));
  const observedPowers = successes.map((run) => Number(run.power)).filter(Number.isFinite);
  const observedHealth = runs.map((run) => Number(run.health)).filter(Number.isFinite);
  const observedParty = runs.map((run) => Number(run.partySize)).filter(Number.isFinite);

  let clearMean = mean(clearTimes);
  let clearStd = stddev(clearTimes, clearMean);
  let successRate = runs.length ? successes.length / runs.length : null;
  let evidence = runs.length;
  let source = evidence >= 5 ? 'empirical' : 'bootstrap';

  if (!Number.isFinite(clearMean)) clearMean = Number(scenario.baselineSeconds || 300);
  if (!Number.isFinite(clearStd) || clearStd <= 0) clearStd = Math.max(8, clearMean * Number(scenario.clearVariance || 0.12));
  if (!Number.isFinite(successRate)) successRate = 1 - Number(scenario.deathRisk ?? 0.15);

  const currentPower = Number(scenario.power);
  const baselinePower = median(observedPowers);
  if (Number.isFinite(currentPower) && currentPower > 0 && Number.isFinite(baselinePower) && baselinePower > 0) {
    clearMean *= clamp((baselinePower / currentPower) ** 0.55, 0.55, 1.8);
  }

  const currentParty = Number(scenario.partySize);
  const baselineParty = median(observedParty);
  if (Number.isFinite(currentParty) && currentParty > 0 && Number.isFinite(baselineParty) && baselineParty > 0) {
    clearMean *= clamp((baselineParty / currentParty) ** 0.22, 0.72, 1.35);
  }

  const currentHealth = Number(scenario.health);
  const baselineHealth = median(observedHealth);
  if (Number.isFinite(currentHealth) && currentHealth > 0 && Number.isFinite(baselineHealth) && baselineHealth > 0) {
    const ratio = clamp(currentHealth / baselineHealth, 0.3, 3);
    const odds = successRate / Math.max(0.0001, 1 - successRate);
    const adjustedOdds = odds * (ratio ** 0.7);
    successRate = adjustedOdds / (1 + adjustedOdds);
  }

  if (Number.isFinite(Number(scenario.successProbability))) successRate = Number(scenario.successProbability);
  if (Number.isFinite(Number(scenario.timeMultiplier))) clearMean *= Number(scenario.timeMultiplier);

  return {
    evidence,
    source,
    clearMean: Math.max(5, clearMean),
    clearStd: Math.max(1, clearStd),
    successRate: clamp(successRate, 0.01, 0.999),
    goldMeanT: Number.isFinite(Number(scenario.goldT)) ? Number(scenario.goldT) : averageFinite(successes, 'goldT'),
    xpMean: Number.isFinite(Number(scenario.xp)) ? Number(scenario.xp) : averageFinite(successes, 'xp')
  };
}

export async function simulateDungeon(guildId, scenario = {}) {
  const dungeon = String(scenario.dungeon || '').trim();
  const difficulty = String(scenario.difficulty || '').trim();
  if (!dungeon) throw new Error('Digital Twin requires a dungeon.');

  const sampleCount = clamp(Math.floor(Number(scenario.samples || 2000)), 100, 20_000);
  const history = await getGenomeRuns(guildId, { dungeon, difficulty, limit: 5_000 });
  const model = modelFromRuns(history, scenario);
  const rand = seededRandom(scenario.seed || `${guildId}|${dungeon}|${difficulty}|${JSON.stringify(scenario)}|${history.length}`);

  const clearTimes = [];
  const goldReturns = [];
  const xpReturns = [];
  let successes = 0;

  for (let i = 0; i < sampleCount; i += 1) {
    if (rand() > model.successRate) continue;
    successes += 1;
    const clearSeconds = Math.max(5, model.clearMean + normal(rand) * model.clearStd);
    clearTimes.push(clearSeconds);
    if (Number.isFinite(model.goldMeanT)) goldReturns.push(Math.max(0, model.goldMeanT * (1 + normal(rand) * 0.08)));
    if (Number.isFinite(model.xpMean)) xpReturns.push(Math.max(0, model.xpMean * (1 + normal(rand) * 0.04)));
  }

  const confidence = clamp(
    (model.source === 'empirical' ? 0.45 : 0.15) + Math.min(0.45, Math.log10(Math.max(1, model.evidence)) * 0.18),
    0.1,
    0.95
  );

  const result = {
    id: newDQId('twin'),
    modelVersion: 'dq-twin-1',
    dungeon,
    difficulty: difficulty || 'Unknown',
    sampleCount,
    evidenceCount: model.evidence,
    evidenceSource: model.source,
    confidence,
    clearRate: successes / sampleCount,
    expectedClearSeconds: mean(clearTimes),
    clearTimeP10: percentile(clearTimes, 0.10),
    clearTimeP50: percentile(clearTimes, 0.50),
    clearTimeP90: percentile(clearTimes, 0.90),
    expectedGoldT: mean(goldReturns),
    expectedXp: mean(xpReturns),
    goldPerHourT: Number.isFinite(mean(goldReturns)) && Number.isFinite(mean(clearTimes)) ? mean(goldReturns) * 3600 / mean(clearTimes) : null,
    xpPerHour: Number.isFinite(mean(xpReturns)) && Number.isFinite(mean(clearTimes)) ? mean(xpReturns) * 3600 / mean(clearTimes) : null,
    scenario: {
      partySize: Number.isFinite(Number(scenario.partySize)) ? Number(scenario.partySize) : null,
      power: Number.isFinite(Number(scenario.power)) ? Number(scenario.power) : null,
      health: Number.isFinite(Number(scenario.health)) ? Number(scenario.health) : null
    },
    createdAt: new Date().toISOString()
  };

  await mutateDQState(guildId, (state) => {
    state.twin.simulations.push(result);
    trimArray(state.twin.simulations, 1_000);
    state.twin.updatedAt = result.createdAt;
  });

  return result;
}
