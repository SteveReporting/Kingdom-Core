import { getGenomeStrategies } from './genome.js';
import { simulateDungeon } from './digitalTwin.js';
import { mutateDQState, newDQId, trimArray } from './store.js';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function finite(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalize(values, value, higherIsBetter = true) {
  const clean = values.filter(Number.isFinite);
  if (!clean.length || !Number.isFinite(value)) return 0.5;
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  if (max - min < 1e-9) return 0.5;
  const raw = (value - min) / (max - min);
  return higherIsBetter ? raw : 1 - raw;
}

function objectiveWeights(objective) {
  switch (objective) {
    case 'speed': return { clearRate: 0.20, clearTime: 0.65, gold: 0.05, xp: 0.10 };
    case 'gold': return { clearRate: 0.20, clearTime: 0.10, gold: 0.65, xp: 0.05 };
    case 'xp': return { clearRate: 0.20, clearTime: 0.10, gold: 0.05, xp: 0.65 };
    case 'safety': return { clearRate: 0.75, clearTime: 0.20, gold: 0.025, xp: 0.025 };
    default: return { clearRate: 0.35, clearTime: 0.25, gold: 0.15, xp: 0.25 };
  }
}

function explain(result, objective) {
  const twin = result.twin;
  const bits = [];
  if (Number.isFinite(twin.clearRate)) bits.push(`${Math.round(twin.clearRate * 100)}% simulated clear rate`);
  if (Number.isFinite(twin.expectedClearSeconds)) bits.push(`${Math.round(twin.expectedClearSeconds)}s expected clear`);
  if ((objective === 'gold' || objective === 'progress') && Number.isFinite(twin.goldPerHourT)) bits.push(`${Number(twin.goldPerHourT.toFixed(2))}T/h expected gold`);
  if ((objective === 'xp' || objective === 'progress') && Number.isFinite(twin.xpPerHour)) bits.push(`${Math.round(twin.xpPerHour).toLocaleString()} XP/h expected`);
  bits.push(`${Math.round(twin.confidence * 100)}% model confidence`);
  return bits.join(' • ');
}

export async function runOracle(guildId, input = {}) {
  const objective = String(input.objective || 'progress').trim().toLowerCase();
  let candidates = Array.isArray(input.candidates) ? input.candidates.filter(Boolean) : [];

  if (!candidates.length) {
    const strategies = await getGenomeStrategies(guildId, {
      dungeon: input.dungeon,
      objective: input.onlyMatchingObjective === false ? '' : objective
    });
    candidates = strategies.map((strategy) => ({
      id: strategy.id,
      name: strategy.name,
      dungeon: strategy.dungeon,
      difficulty: strategy.difficulty,
      scenario: strategy.scenario,
      confidence: strategy.confidence
    }));
  }

  if (!candidates.length && input.dungeon) {
    candidates = [{
      id: 'current-scenario',
      name: `${input.dungeon} ${input.difficulty || ''}`.trim(),
      dungeon: input.dungeon,
      difficulty: input.difficulty || 'Unknown',
      scenario: {}
    }];
  }

  if (!candidates.length) throw new Error('Oracle has no candidate DQ strategies yet. Add Genome strategies or provide a dungeon.');
  if (candidates.length > 20) candidates = candidates.slice(0, 20);

  const evaluated = [];
  for (const candidate of candidates) {
    const scenario = {
      ...(candidate.scenario || {}),
      dungeon: candidate.dungeon || input.dungeon,
      difficulty: candidate.difficulty || input.difficulty,
      partySize: finite(input.partySize, finite(candidate.scenario?.partySize, undefined)),
      power: finite(input.power, finite(candidate.scenario?.power, undefined)),
      health: finite(input.health, finite(candidate.scenario?.health, undefined)),
      samples: clamp(Math.floor(finite(input.samples, 1200)), 100, 10_000)
    };
    const twin = await simulateDungeon(guildId, scenario);
    evaluated.push({
      id: candidate.id || newDQId('candidate'),
      name: candidate.name || `${scenario.dungeon} ${scenario.difficulty || ''}`.trim(),
      dungeon: scenario.dungeon,
      difficulty: scenario.difficulty || 'Unknown',
      sourceConfidence: clamp(finite(candidate.confidence, 0.6), 0, 1),
      twin
    });
  }

  const weights = objectiveWeights(objective);
  const clearRates = evaluated.map((entry) => entry.twin.clearRate);
  const clearTimes = evaluated.map((entry) => entry.twin.expectedClearSeconds);
  const goldRates = evaluated.map((entry) => entry.twin.goldPerHourT);
  const xpRates = evaluated.map((entry) => entry.twin.xpPerHour);
  const riskTolerance = clamp(finite(input.riskTolerance, 0.5), 0, 1);

  for (const entry of evaluated) {
    const dimensions = {
      clearRate: normalize(clearRates, entry.twin.clearRate, true),
      clearTime: normalize(clearTimes, entry.twin.expectedClearSeconds, false),
      gold: normalize(goldRates, entry.twin.goldPerHourT, true),
      xp: normalize(xpRates, entry.twin.xpPerHour, true)
    };
    const weighted = Object.entries(weights).reduce((sum, [key, weight]) => sum + dimensions[key] * weight, 0);
    const confidence = clamp((entry.twin.confidence * 0.8) + (entry.sourceConfidence * 0.2), 0, 1);
    const safetyPenalty = Math.max(0, 0.9 - entry.twin.clearRate) * (1 - riskTolerance) * 0.6;
    entry.score = clamp((weighted * 0.82) + (confidence * 0.18) - safetyPenalty, 0, 1);
    entry.score100 = Math.round(entry.score * 1000) / 10;
    entry.reason = explain(entry, objective);
  }

  evaluated.sort((a, b) => b.score - a.score);
  const recommendation = {
    id: newDQId('oracle'),
    objective,
    riskTolerance,
    best: evaluated[0],
    alternatives: evaluated.slice(1, 5),
    evaluated: evaluated.length,
    createdAt: new Date().toISOString()
  };

  await mutateDQState(guildId, (state) => {
    state.oracle.recommendations.push(recommendation);
    trimArray(state.oracle.recommendations, 500);
    state.oracle.updatedAt = recommendation.createdAt;
  });

  return recommendation;
}
