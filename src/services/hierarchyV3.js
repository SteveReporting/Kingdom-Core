import { ROLE_BLUEPRINT } from '../config/blueprint.js';
import { LEVEL_TIERS } from './levelRoles.js';
import { readGuildState } from '../storage/store.js';

const PING_KEYS = new Set(['carryPing', 'eventPing', 'marketPing', 'giveawayPing', 'updatePing']);

function uniqueRoles(items) {
  const seen = new Set();
  return items.filter((role) => {
    if (!role || seen.has(role.id)) return false;
    seen.add(role.id);
    return true;
  });
}

function resolveBlueprintRole(guild, state, definition) {
  const savedId = state.setup?.roles?.[definition.key];
  return guild.roles.cache.get(savedId) ??
    guild.roles.cache.find((role) => !role.managed && role.name === definition.name) ??
    null;
}

function resolveLevelRole(guild, state, tier) {
  const savedId = state.setup?.levelRoles?.[tier.key];
  return guild.roles.cache.get(savedId) ??
    guild.roles.cache.find((role) => !role.managed && role.name === tier.role) ??
    null;
}

function desiredHierarchy(guild, state) {
  // Exact visible order from highest to lowest beneath the Kingdom Core bot role:
  // leadership/staff -> carriers -> member progression -> Houses -> level bands -> ping roles.
  const main = ROLE_BLUEPRINT.filter((definition) => !PING_KEYS.has(definition.key))
    .map((definition) => resolveBlueprintRole(guild, state, definition));

  // Higher Dungeon Quest levels belong above lower ones.
  const levels = [...LEVEL_TIERS].reverse().map((tier) => resolveLevelRole(guild, state, tier));

  const pings = ROLE_BLUEPRINT.filter((definition) => PING_KEYS.has(definition.key))
    .map((definition) => resolveBlueprintRole(guild, state, definition));

  return uniqueRoles([...main, ...levels, ...pings]);
}

function verifyOrder(roles) {
  const problems = [];
  for (let index = 0; index < roles.length - 1; index++) {
    const upper = roles[index];
    const lower = roles[index + 1];
    if (upper.position <= lower.position) {
      problems.push(`${upper.name} should be above ${lower.name}`);
    }
  }
  return problems;
}

export async function enforceRoleHierarchyV3(guild) {
  await guild.roles.fetch();
  const state = await readGuildState(guild.id);
  const me = await guild.members.fetchMe();
  const botRole = me.roles.highest;

  if (!botRole || botRole.position <= 1) {
    throw new Error('Kingdom Core bot role is too low in the server hierarchy. Move the Kingdom Core role above every role it needs to manage, then run /setup3 again.');
  }

  const desired = desiredHierarchy(guild, state);
  if (!desired.length) return { moved: 0, verified: 0, skipped: 0, botRole: botRole.name };

  const editable = [];
  const uneditable = [];
  for (const role of desired) {
    if (role.editable && role.position < botRole.position) editable.push(role);
    else uneditable.push(role);
  }

  // Any Kingdom role below the bot should be editable. If it is not, don't pretend the repair worked.
  const blockedBelowBot = uneditable.filter((role) => role.position < botRole.position && !role.managed);
  if (blockedBelowBot.length) {
    throw new Error(`Discord would not let Kingdom Core move: ${blockedBelowBot.map((role) => role.name).join(', ')}. Check Manage Roles and role hierarchy.`);
  }

  // Roles already above Kingdom Core cannot be moved by the bot. Keep them where the owner placed them,
  // and enforce the full exact order for every editable Kingdom role directly underneath the bot.
  const highestTarget = botRole.position - 1;
  if (highestTarget < editable.length) {
    throw new Error('Kingdom Core does not have enough hierarchy space beneath its bot role to order all managed roles. Move the Kingdom Core bot role higher, then rerun /setup3.');
  }

  const positions = editable.map((role, index) => ({
    role: role.id,
    position: highestTarget - index
  }));

  await guild.roles.setPositions(positions);
  await guild.roles.fetch();

  const refreshed = editable.map((role) => guild.roles.cache.get(role.id)).filter(Boolean);
  let problems = verifyOrder(refreshed);

  // One retry using individual role moves. This handles servers with unrelated roles interspersed in the stack.
  if (problems.length) {
    const currentMe = await guild.members.fetchMe();
    let target = currentMe.roles.highest.position - 1;
    for (const role of refreshed) {
      const current = guild.roles.cache.get(role.id);
      if (current?.editable) {
        await current.setPosition(target, 'Kingdom Core /setup3 enforced hierarchy');
        target--;
      }
    }
    await guild.roles.fetch();
    const retried = editable.map((role) => guild.roles.cache.get(role.id)).filter(Boolean);
    problems = verifyOrder(retried);
  }

  if (problems.length) {
    throw new Error(`Role hierarchy verification failed: ${problems.slice(0, 4).join('; ')}. Move the Kingdom Core bot role to the top of the managed stack and rerun /setup3.`);
  }

  return {
    moved: editable.length,
    verified: editable.length,
    skipped: uneditable.length,
    botRole: botRole.name,
    topManaged: refreshed[0]?.name ?? null,
    bottomManaged: refreshed.at(-1)?.name ?? null
  };
}
