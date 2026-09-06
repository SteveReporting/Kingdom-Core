import fs from 'node:fs/promises';
import path from 'node:path';

const DATA_DIR = path.resolve('data');
const guildLocks = new Map();

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

function guildFile(guildId) {
  return path.join(DATA_DIR, `${guildId}.json`);
}

export async function readGuildState(guildId) {
  await ensureDir();
  try {
    const raw = await fs.readFile(guildFile(guildId), 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return {
      version: 1,
      setup: {},
      queue: [],
      tickets: {},
      stats: { completedCarries: 0 }
    };
  }
}

export async function writeGuildState(guildId, state) {
  await ensureDir();
  const target = guildFile(guildId);
  const temp = `${target}.tmp`;
  await fs.writeFile(temp, JSON.stringify(state, null, 2), 'utf8');
  await fs.rename(temp, target);
}

export async function mutateGuildState(guildId, mutator) {
  const previous = guildLocks.get(guildId) ?? Promise.resolve();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const queued = previous.then(() => gate);
  guildLocks.set(guildId, queued);

  await previous;
  try {
    const state = await readGuildState(guildId);
    const result = await mutator(state);
    await writeGuildState(guildId, state);
    return result;
  } finally {
    release();
    if (guildLocks.get(guildId) === queued) {
      guildLocks.delete(guildId);
    }
  }
}
