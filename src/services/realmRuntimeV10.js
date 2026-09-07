import { readGuildState, writeGuildState } from '../storage/store.js';
import { getV10ResourceSnapshot, PLATFORM_V10_SCHEMA } from './platformV10.js';
import { ensureRealmEnginesV10, recordRealmEventV10, runRealmEnginesV10 } from './realmEnginesV10.js';

export async function installRealmEnginesRuntimeV10(guild) {
  const state = await readGuildState(guild.id);
  ensureRealmEnginesV10(state);
  const resources = getV10ResourceSnapshot();
  const pulse = runRealmEnginesV10(state, resources);
  recordRealmEventV10(state, 'realm.v10.installed', {
    guildId: guild.id,
    runtimeMode: state.realmV10.runtimeMode,
    pressure: resources.pressure
  });
  state.realmV10.installedAt ??= new Date().toISOString();
  state.realmV10.lastMaintenanceAt = new Date().toISOString();
  await writeGuildState(guild.id, state);
  return {
    runtimeMode: state.realmV10.runtimeMode,
    pulse,
    resources,
    engines: 15
  };
}

export async function runRealmMaintenanceV10(guild) {
  const state = await readGuildState(guild.id);
  if ((state.platform?.schemaVersion ?? 0) < PLATFORM_V10_SCHEMA) return false;
  ensureRealmEnginesV10(state);
  const resources = getV10ResourceSnapshot();
  runRealmEnginesV10(state, resources);
  state.realmV10.lastMaintenanceAt = new Date().toISOString();
  await writeGuildState(guild.id, state);
  return true;
}
