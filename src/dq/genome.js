import { mutateDQState, newDQId, readDQState, trimArray } from './store.js';

function clean(value) {
  return String(value ?? '').trim();
}

export function genomeKey(kind, name) {
  const k = clean(kind).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'entity';
  const n = clean(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!n) throw new Error('Genome entity name is required.');
  return `${k}:${n}`;
}

export async function upsertGenomeEntity(guildId, input) {
  const kind = clean(input?.kind || 'entity').toLowerCase();
  const name = clean(input?.name);
  if (!name) throw new Error('Genome entity name is required.');
  const key = clean(input?.key) || genomeKey(kind, name);
  const now = new Date().toISOString();
  const aliases = [...new Set((input?.aliases || []).map(clean).filter(Boolean))];
  const confidence = Math.max(0, Math.min(1, Number(input?.confidence ?? 0.75)));

  return mutateDQState(guildId, (state) => {
    const previous = state.genome.entities[key] || {};
    const entity = {
      ...previous,
      key,
      kind,
      name,
      aliases: [...new Set([...(previous.aliases || []), ...aliases])],
      data: { ...(previous.data || {}), ...(input?.data || {}) },
      confidence: Math.max(Number(previous.confidence || 0), confidence),
      source: input?.source || previous.source || 'manual',
      createdAt: previous.createdAt || now,
      updatedAt: now
    };
    state.genome.entities[key] = entity;
    const aliasValues = [name, key, ...entity.aliases];
    for (const alias of aliasValues) state.genome.aliases[clean(alias).toLowerCase()] = key;
    state.genome.updatedAt = now;
    return entity;
  });
}

export async function addGenomeRelation(guildId, input) {
  const from = clean(input?.from);
  const to = clean(input?.to);
  const type = clean(input?.type || 'related_to').toLowerCase();
  if (!from || !to) throw new Error('Genome relation requires from and to keys.');
  const now = new Date().toISOString();

  return mutateDQState(guildId, (state) => {
    const duplicate = state.genome.relations.find((r) => r.from === from && r.to === to && r.type === type);
    if (duplicate) {
      duplicate.data = { ...(duplicate.data || {}), ...(input?.data || {}) };
      duplicate.updatedAt = now;
      state.genome.updatedAt = now;
      return duplicate;
    }
    const relation = {
      id: newDQId('rel'),
      from,
      to,
      type,
      data: input?.data || {},
      confidence: Math.max(0, Math.min(1, Number(input?.confidence ?? 0.75))),
      source: input?.source || 'manual',
      createdAt: now,
      updatedAt: now
    };
    state.genome.relations.push(relation);
    trimArray(state.genome.relations, 20_000);
    state.genome.updatedAt = now;
    return relation;
  });
}

export async function recordGenomeObservation(guildId, input) {
  const metric = clean(input?.metric).toLowerCase();
  if (!metric) throw new Error('Genome observation metric is required.');
  const value = Number(input?.value);
  if (!Number.isFinite(value)) throw new Error('Genome observation value must be numeric.');
  const observation = {
    id: newDQId('obs'),
    metric,
    value,
    unit: clean(input?.unit) || null,
    entityKey: clean(input?.entityKey) || null,
    context: input?.context || {},
    source: input?.source || 'manual',
    confidence: Math.max(0, Math.min(1, Number(input?.confidence ?? 0.8))),
    timestamp: input?.timestamp || new Date().toISOString()
  };

  return mutateDQState(guildId, (state) => {
    state.genome.observations.push(observation);
    trimArray(state.genome.observations, 50_000);
    state.genome.updatedAt = observation.timestamp;
    return observation;
  });
}

export async function recordDungeonRun(guildId, input) {
  const dungeon = clean(input?.dungeon);
  const difficulty = clean(input?.difficulty || 'Unknown');
  if (!dungeon) throw new Error('Dungeon name is required.');
  const clearSeconds = Number(input?.clearSeconds);
  const success = input?.success !== false;
  if (success && (!Number.isFinite(clearSeconds) || clearSeconds <= 0)) throw new Error('Successful runs require clearSeconds.');
  const now = input?.timestamp || new Date().toISOString();
  const run = {
    id: newDQId('run'),
    dungeon,
    difficulty,
    success,
    clearSeconds: Number.isFinite(clearSeconds) ? clearSeconds : null,
    partySize: Math.max(1, Math.min(50, Number(input?.partySize || 1))),
    power: Number.isFinite(Number(input?.power)) ? Number(input.power) : null,
    health: Number.isFinite(Number(input?.health)) ? Number(input.health) : null,
    goldT: Number.isFinite(Number(input?.goldT)) ? Number(input.goldT) : null,
    xp: Number.isFinite(Number(input?.xp)) ? Number(input.xp) : null,
    deaths: Number.isFinite(Number(input?.deaths)) ? Math.max(0, Number(input.deaths)) : null,
    build: input?.build || null,
    source: input?.source || 'manual',
    actorId: clean(input?.actorId) || null,
    timestamp: now
  };

  await upsertGenomeEntity(guildId, {
    kind: 'dungeon',
    name: dungeon,
    aliases: [],
    data: { lastDifficultySeen: difficulty },
    source: run.source,
    confidence: 0.95
  });

  return mutateDQState(guildId, (state) => {
    state.genome.runs.push(run);
    trimArray(state.genome.runs, 50_000);
    state.genome.updatedAt = now;
    return run;
  });
}

export async function registerGenomeStrategy(guildId, input) {
  const name = clean(input?.name);
  const dungeon = clean(input?.dungeon);
  if (!name || !dungeon) throw new Error('Strategy requires name and dungeon.');
  const id = clean(input?.id) || genomeKey('strategy', name);
  const now = new Date().toISOString();
  const strategy = {
    id,
    name,
    dungeon,
    difficulty: clean(input?.difficulty || 'Any'),
    objective: clean(input?.objective || 'progress').toLowerCase(),
    scenario: { ...(input?.scenario || {}) },
    tags: [...new Set((input?.tags || []).map(clean).filter(Boolean))],
    source: input?.source || 'manual',
    confidence: Math.max(0, Math.min(1, Number(input?.confidence ?? 0.7))),
    updatedAt: now
  };
  return mutateDQState(guildId, (state) => {
    state.genome.strategies[id] = { ...(state.genome.strategies[id] || {}), ...strategy };
    state.genome.updatedAt = now;
    return state.genome.strategies[id];
  });
}

export async function searchGenome(guildId, query, options = {}) {
  const state = await readDQState(guildId);
  const q = clean(query).toLowerCase();
  const kind = clean(options.kind).toLowerCase();
  const limit = Math.max(1, Math.min(50, Number(options.limit || 10)));
  const exactKey = state.genome.aliases[q] || q;
  const entities = Object.values(state.genome.entities);
  const scored = [];
  for (const entity of entities) {
    if (kind && entity.kind !== kind) continue;
    const haystack = [entity.key, entity.name, ...(entity.aliases || [])].join(' ').toLowerCase();
    let score = 0;
    if (entity.key === exactKey) score = 100;
    else if (entity.name.toLowerCase() === q) score = 95;
    else if (haystack.startsWith(q)) score = 80;
    else if (q && haystack.includes(q)) score = 60;
    else if (!q) score = 1;
    if (score > 0) scored.push({ score, entity });
  }
  return scored.sort((a, b) => b.score - a.score || b.entity.confidence - a.entity.confidence).slice(0, limit).map((x) => x.entity);
}

export async function getGenomeEntity(guildId, keyOrAlias) {
  const state = await readDQState(guildId);
  const raw = clean(keyOrAlias);
  const key = state.genome.aliases[raw.toLowerCase()] || raw;
  return state.genome.entities[key] || null;
}

export async function getGenomeRuns(guildId, filters = {}) {
  const state = await readDQState(guildId);
  const dungeon = clean(filters.dungeon).toLowerCase();
  const difficulty = clean(filters.difficulty).toLowerCase();
  const limit = Math.max(1, Math.min(10_000, Number(filters.limit || 2_000)));
  return state.genome.runs
    .filter((run) => (!dungeon || run.dungeon.toLowerCase() === dungeon) && (!difficulty || run.difficulty.toLowerCase() === difficulty))
    .slice(-limit);
}

export async function getGenomeStrategies(guildId, filters = {}) {
  const state = await readDQState(guildId);
  const dungeon = clean(filters.dungeon).toLowerCase();
  const objective = clean(filters.objective).toLowerCase();
  return Object.values(state.genome.strategies).filter((strategy) => {
    if (dungeon && strategy.dungeon.toLowerCase() !== dungeon) return false;
    if (objective && strategy.objective !== objective) return false;
    return true;
  });
}

export async function getGenomeSnapshot(guildId) {
  const state = await readDQState(guildId);
  const entities = Object.values(state.genome.entities);
  const confidence = entities.length ? entities.reduce((sum, x) => sum + Number(x.confidence || 0), 0) / entities.length : 0;
  const kinds = {};
  for (const entity of entities) kinds[entity.kind] = (kinds[entity.kind] || 0) + 1;
  return {
    entities: entities.length,
    relations: state.genome.relations.length,
    observations: state.genome.observations.length,
    strategies: Object.keys(state.genome.strategies).length,
    runs: state.genome.runs.length,
    averageConfidence: confidence,
    kinds,
    updatedAt: state.genome.updatedAt
  };
}
