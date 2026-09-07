import { readGuildState, writeGuildState } from '../storage/store.js';
import { getV10ResourceSnapshot, PLATFORM_V10_SCHEMA } from './platformV10.js';
import { ensureRealmIntelligenceV10, runRealmIntelligenceV10 } from './realmIntelligenceV10.js';

const DEFAULT_MIN_INTERVAL_MS = 15 * 60 * 1000;

function due(lastRunAt, minIntervalMs = DEFAULT_MIN_INTERVAL_MS) {
  if (!lastRunAt) return true;
  const last = new Date(lastRunAt).getTime();
  return !Number.isFinite(last) || Date.now() - last >= minIntervalMs;
}

export async function installRealmIntelligenceRuntimeV10(guild) {
  const state = await readGuildState(guild.id);
  ensureRealmIntelligenceV10(state);
  state.platform ??= {};
  state.platform.migrations ??= [];
  if (!state.platform.migrations.includes('v10-realm-intelligence-371-390-except-385')) {
    state.platform.migrations.push('v10-realm-intelligence-371-390-except-385');
  }
  const resources = getV10ResourceSnapshot();
  const pulse = runRealmIntelligenceV10(state, resources);
  state.realmIntelligenceV10.installedAt ??= new Date().toISOString();
  state.realmIntelligenceV10.lastMaintenanceAt = new Date().toISOString();
  await writeGuildState(guild.id, state);
  return {
    approvedExtensions: 19,
    excluded: [385],
    pulse,
    resources
  };
}

export async function runRealmIntelligenceMaintenanceV10(guild) {
  const state = await readGuildState(guild.id);
  if ((state.platform?.schemaVersion ?? 0) < PLATFORM_V10_SCHEMA) return false;
  ensureRealmIntelligenceV10(state);
  const interval = Number(state.platform?.v10?.resourcePolicy?.heavyAnalyticsMinIntervalMs ?? DEFAULT_MIN_INTERVAL_MS);
  if (!due(state.realmIntelligenceV10.lastMaintenanceAt, Math.max(DEFAULT_MIN_INTERVAL_MS, interval))) return false;
  const resources = getV10ResourceSnapshot();
  runRealmIntelligenceV10(state, resources);
  state.realmIntelligenceV10.lastMaintenanceAt = new Date().toISOString();
  await writeGuildState(guild.id, state);
  return true;
}
