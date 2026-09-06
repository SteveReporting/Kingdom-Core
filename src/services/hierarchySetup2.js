import { ROLE_BLUEPRINT } from '../config/blueprint.js';
import { LEVEL_TIERS } from './levelRoles.js';
import { readGuildState } from '../storage/store.js';

const PING_KEYS = new Set(['carryPing', 'eventPing', 'marketPing', 'giveawayPing', 'updatePing']);

function unique(items) {
  const seen = new Set();
  return items.filter((role) => {
    if (!role || seen.has(role.id)) return false;
    seen.add(role.id);
    return true;
  });
}

function findBlueprintRole(guild, state, definition) {
  return guild.roles.cache.get(state.setup?.roles?.[definition.key]) ??
    guild.roles.cache.find((role) => !role.managed && role.name === definition.name) ?? null;
}

function findLevelRole(guild, state, tier) {
  return guild.roles.cache.get(state.setup?.levelRoles?.[tier.key]) ??
    guild.roles.cache.find((role) => !role.managed && role.name === tier.role) ?? null;
}

function desiredRoles(guild, state) {
  const main = ROLE_BLUEPRINT
    .filter((definition) => !PING_KEYS.has(definition.key))
    .map((definition) => findBlueprintRole(guild, state, definition));
  const levels = [...LEVEL_TIERS].reverse().map((tier) => findLevelRole(guild, state, tier));
  const pings = ROLE_BLUEPRINT
    .filter((definition) => PING_KEYS.has(definition.key))
    .map((definition) => findBlueprintRole(guild, state, definition));
  return unique([...main, ...levels, ...pings]);
}

function verify(roles) {
  const failures = [];
  for (let i = 0; i < roles.length - 1; i++) {
    if (roles[i].position <= roles[i + 1].position) {
      failures.push(`${roles[i].name} must be above ${roles[i + 1].name}`);
    }
  }
  return failures;
}

export async function enforceSetup2Hierarchy(guild) {
  await guild.roles.fetch();
  const state = await readGuildState(guild.id);
  const me = await guild.members.fetchMe();
  const ceiling = me.roles.highest;

  if (!ceiling || ceiling.position <= 1) {
    throw new Error('Move the Kingdom Core bot role above the entire Kingdom role stack, then run /setup2 again.');
  }

  const desired = desiredRoles(guild, state);
  const blocked = desired.filter((role) => role.position >= ceiling.position || !role.editable);
  if (blocked.length) {
    throw new Error(`Kingdom Core cannot reorder: ${blocked.slice(0, 8).map((role) => role.name).join(', ')}. Put the Kingdom Core bot role above them and make sure it has Manage Roles.`);
  }

  if (ceiling.position - 1 < desired.length) {
    throw new Error('The Kingdom Core bot role is not high enough to fit the complete ordered role stack beneath it. Move it higher and rerun /setup2.');
  }

  let target = ceiling.position - 1;
  for (const role of desired) {
    const current = guild.roles.cache.get(role.id);
    if (!current?.editable) throw new Error(`Discord stopped Kingdom Core from moving ${role.name}.`);
    await current.setPosition(target, 'Kingdom Core /setup2 strict hierarchy');
    target--;
  }

  await guild.roles.fetch();
  const refreshed = desired.map((role) => guild.roles.cache.get(role.id)).filter(Boolean);
  const failures = verify(refreshed);
  if (failures.length) {
    throw new Error(`Role hierarchy verification failed: ${failures.slice(0, 5).join('; ')}`);
  }

  return {
    verified: refreshed.length,
    botRole: ceiling.name,
    highest: refreshed[0]?.name ?? null,
    lowest: refreshed.at(-1)?.name ?? null
  };
}
