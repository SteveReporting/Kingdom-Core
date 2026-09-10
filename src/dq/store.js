import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const locks = new Map();

function dataDir() {
  return path.resolve(String(process.env.DQ_DATA_DIR || 'data/dq'));
}

function safeGuildId(guildId) {
  const value = String(guildId || '').trim();
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid guild id.');
  return value;
}

function defaultState() {
  return {
    version: 1,
    genome: {
      entities: {},
      aliases: {},
      relations: [],
      observations: [],
      strategies: {},
      runs: [],
      updatedAt: null
    },
    sentinel: {
      series: {},
      alerts: [],
      updatedAt: null
    },
    twin: {
      simulations: [],
      updatedAt: null
    },
    oracle: {
      recommendations: [],
      updatedAt: null
    },
    bank: {
      accounts: {},
      assets: {},
      requests: {},
      ledger: [],
      config: {
        creditRate: Number(process.env.DQ_BANK_CREDIT_RATE || 0.9),
        reserveRatio: Number(process.env.DQ_BANK_RESERVE_RATIO || 0.15)
      },
      updatedAt: null
    }
  };
}

function ensureObject(value, fallback = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

export function normalizeDQState(input) {
  const base = defaultState();
  const state = ensureObject(input, {});
  state.version = 1;

  state.genome = { ...base.genome, ...ensureObject(state.genome) };
  state.genome.entities = ensureObject(state.genome.entities);
  state.genome.aliases = ensureObject(state.genome.aliases);
  state.genome.relations = ensureArray(state.genome.relations);
  state.genome.observations = ensureArray(state.genome.observations);
  state.genome.strategies = ensureObject(state.genome.strategies);
  state.genome.runs = ensureArray(state.genome.runs);

  state.sentinel = { ...base.sentinel, ...ensureObject(state.sentinel) };
  state.sentinel.series = ensureObject(state.sentinel.series);
  state.sentinel.alerts = ensureArray(state.sentinel.alerts);

  state.twin = { ...base.twin, ...ensureObject(state.twin) };
  state.twin.simulations = ensureArray(state.twin.simulations);

  state.oracle = { ...base.oracle, ...ensureObject(state.oracle) };
  state.oracle.recommendations = ensureArray(state.oracle.recommendations);

  state.bank = { ...base.bank, ...ensureObject(state.bank) };
  state.bank.accounts = ensureObject(state.bank.accounts);
  state.bank.assets = ensureObject(state.bank.assets);
  state.bank.requests = ensureObject(state.bank.requests);
  state.bank.ledger = ensureArray(state.bank.ledger);
  state.bank.config = { ...base.bank.config, ...ensureObject(state.bank.config) };

  if (!Number.isFinite(Number(state.bank.config.creditRate))) state.bank.config.creditRate = 0.9;
  if (!Number.isFinite(Number(state.bank.config.reserveRatio))) state.bank.config.reserveRatio = 0.15;
  state.bank.config.creditRate = Math.max(0.1, Math.min(1, Number(state.bank.config.creditRate)));
  state.bank.config.reserveRatio = Math.max(0, Math.min(0.95, Number(state.bank.config.reserveRatio)));

  return state;
}

async function ensureDir() {
  await fs.mkdir(dataDir(), { recursive: true });
}

function guildFile(guildId) {
  return path.join(dataDir(), `${safeGuildId(guildId)}.json`);
}

export async function readDQState(guildId) {
  await ensureDir();
  try {
    const raw = await fs.readFile(guildFile(guildId), 'utf8');
    return normalizeDQState(JSON.parse(raw));
  } catch (error) {
    if (error.code === 'ENOENT') return defaultState();
    throw error;
  }
}

export async function writeDQState(guildId, state) {
  await ensureDir();
  const target = guildFile(guildId);
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(normalizeDQState(state), null, 2), 'utf8');
  await fs.rename(temp, target);
}

export async function mutateDQState(guildId, mutator) {
  const key = safeGuildId(guildId);
  const previous = locks.get(key) ?? Promise.resolve();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const queued = previous.then(() => gate);
  locks.set(key, queued);

  await previous;
  try {
    const state = await readDQState(key);
    const result = await mutator(state);
    await writeDQState(key, state);
    return result;
  } finally {
    release();
    if (locks.get(key) === queued) locks.delete(key);
  }
}

export function newDQId(prefix = 'dq') {
  return `${String(prefix).replace(/[^a-z0-9_-]/gi, '').slice(0, 12) || 'dq'}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

export function trimArray(array, max) {
  if (!Array.isArray(array)) return [];
  if (array.length > max) array.splice(0, array.length - max);
  return array;
}
