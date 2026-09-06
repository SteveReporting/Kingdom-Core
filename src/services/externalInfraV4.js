import { Pool } from 'pg';
import { createClient } from 'redis';
import { readGuildState } from '../storage/store.js';

let pool = null;
let redis = null;
let workerTimer = null;
const localJobs = [];
const health = {
  postgres: 'disabled',
  redis: 'disabled',
  worker: 'stopped',
  lastMirrorAt: null,
  lastError: null
};

async function initPostgres() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return;
  pool = new Pool({
    connectionString: url,
    ssl: String(process.env.DATABASE_SSL).toLowerCase() === 'true' ? { rejectUnauthorized: false } : undefined,
    max: Number(process.env.DATABASE_POOL_MAX || 5)
  });
  await pool.query('select 1');
  await pool.query(`
    create table if not exists kingdom_guild_snapshots (
      guild_id text primary key,
      schema_version integer not null default 4,
      snapshot jsonb not null,
      updated_at timestamptz not null default now()
    );
    create table if not exists kingdom_platform_events (
      id bigserial primary key,
      guild_id text not null,
      event_type text not null,
      event_at timestamptz not null,
      payload jsonb not null default '{}'::jsonb
    );
    create index if not exists kingdom_platform_events_guild_at on kingdom_platform_events(guild_id, event_at desc);
    create table if not exists kingdom_member_profiles (
      guild_id text not null,
      user_id text not null,
      profile jsonb not null,
      updated_at timestamptz not null default now(),
      primary key (guild_id, user_id)
    );
    create table if not exists kingdom_carries (
      guild_id text not null,
      carry_id text not null,
      carry jsonb not null,
      updated_at timestamptz not null default now(),
      primary key (guild_id, carry_id)
    );
    create table if not exists kingdom_market_listings (
      guild_id text not null,
      listing_id text not null,
      listing jsonb not null,
      updated_at timestamptz not null default now(),
      primary key (guild_id, listing_id)
    );
  `);
  health.postgres = 'healthy';
}

async function initRedis() {
  const url = process.env.REDIS_URL?.trim();
  if (!url) return;
  redis = createClient({ url });
  redis.on('error', (error) => {
    health.redis = 'error';
    health.lastError = String(error?.message ?? error);
  });
  await redis.connect();
  await redis.ping();
  health.redis = 'healthy';
}

function summary(state) {
  const tickets = Object.values(state.carryTickets ?? {});
  return {
    schemaVersion: state.platform?.schemaVersion ?? 4,
    kingdom: state.kingdom ?? {},
    carryStats: {
      waiting: tickets.filter((x) => x.status === 'open').length,
      active: tickets.filter((x) => ['claimed', 'ready', 'running'].includes(x.status)).length,
      completed: tickets.filter((x) => x.status === 'completed').length
    },
    analytics: state.analyticsV4 ?? {},
    security: {
      state: state.securityV4?.state ?? 'NORMAL',
      riskScore: state.securityV4?.riskScore ?? 0
    },
    updatedAt: new Date().toISOString()
  };
}

async function mirrorPostgres(guildId, state) {
  if (!pool) return;
  await pool.query(
    `insert into kingdom_guild_snapshots(guild_id, schema_version, snapshot, updated_at)
     values($1,$2,$3,now())
     on conflict(guild_id) do update set schema_version=excluded.schema_version, snapshot=excluded.snapshot, updated_at=now()`,
    [guildId, state.platform?.schemaVersion ?? 4, state]
  );

  const profileEntries = Object.entries(state.identities ?? {});
  for (const [userId, profile] of profileEntries.slice(-1000)) {
    await pool.query(
      `insert into kingdom_member_profiles(guild_id,user_id,profile,updated_at) values($1,$2,$3,now())
       on conflict(guild_id,user_id) do update set profile=excluded.profile, updated_at=now()`,
      [guildId, userId, profile]
    );
  }
  for (const [carryId, carry] of Object.entries(state.carryTickets ?? {}).slice(-1000)) {
    await pool.query(
      `insert into kingdom_carries(guild_id,carry_id,carry,updated_at) values($1,$2,$3,now())
       on conflict(guild_id,carry_id) do update set carry=excluded.carry, updated_at=now()`,
      [guildId, carryId, carry]
    );
  }
  for (const [listingId, listing] of Object.entries(state.marketV4?.listings ?? {}).slice(-500)) {
    await pool.query(
      `insert into kingdom_market_listings(guild_id,listing_id,listing,updated_at) values($1,$2,$3,now())
       on conflict(guild_id,listing_id) do update set listing=excluded.listing, updated_at=now()`,
      [guildId, listingId, listing]
    );
  }
}

async function mirrorRedis(guildId, state) {
  if (!redis?.isOpen) return;
  const data = JSON.stringify(summary(state));
  await redis.set(`kingdom:${guildId}:overview`, data, { EX: 600 });
  await redis.publish(`kingdom:${guildId}:updates`, data);
}

async function processJobs(client) {
  while (localJobs.length) {
    const job = localJobs.shift();
    try {
      if (job.type === 'mirror-guild') {
        const state = await readGuildState(job.guildId);
        await Promise.all([mirrorPostgres(job.guildId, state), mirrorRedis(job.guildId, state)]);
      }
    } catch (error) {
      health.lastError = String(error?.message ?? error);
    }
  }

  if (redis?.isOpen) {
    for (let i = 0; i < 20; i++) {
      const raw = await redis.rPop('kingdom:jobs').catch(() => null);
      if (!raw) break;
      try {
        const job = JSON.parse(raw);
        if (job.type === 'mirror-guild' && client.guilds.cache.has(job.guildId)) {
          const state = await readGuildState(job.guildId);
          await Promise.all([mirrorPostgres(job.guildId, state), mirrorRedis(job.guildId, state)]);
        }
      } catch (error) {
        health.lastError = String(error?.message ?? error);
      }
    }
  }
}

export async function enqueueInfraJob(job) {
  if (redis?.isOpen) {
    await redis.lPush('kingdom:jobs', JSON.stringify(job));
    return 'redis';
  }
  localJobs.push(job);
  return 'memory';
}

export async function mirrorGuildState(guildId) {
  const state = await readGuildState(guildId);
  await Promise.all([mirrorPostgres(guildId, state), mirrorRedis(guildId, state)]);
  health.lastMirrorAt = new Date().toISOString();
}

export function getExternalInfraHealth() {
  return { ...health, queueDepth: localJobs.length };
}

export async function startExternalInfra(client) {
  try {
    await initPostgres();
  } catch (error) {
    health.postgres = 'error';
    health.lastError = String(error?.message ?? error);
    console.error('PostgreSQL v4 adapter error:', error);
  }
  try {
    await initRedis();
  } catch (error) {
    health.redis = 'error';
    health.lastError = String(error?.message ?? error);
    console.error('Redis v4 adapter error:', error);
  }

  health.worker = 'healthy';
  workerTimer = setInterval(async () => {
    for (const guild of client.guilds.cache.values()) {
      await enqueueInfraJob({ type: 'mirror-guild', guildId: guild.id, at: new Date().toISOString() }).catch(() => null);
    }
    await processJobs(client).catch((error) => {
      health.worker = 'error';
      health.lastError = String(error?.message ?? error);
    });
    health.lastMirrorAt = new Date().toISOString();
  }, Number(process.env.WORKER_INTERVAL_MS || 60_000));
  workerTimer.unref?.();
  return getExternalInfraHealth();
}

export async function stopExternalInfra() {
  if (workerTimer) clearInterval(workerTimer);
  workerTimer = null;
  if (redis?.isOpen) await redis.quit().catch(() => null);
  redis = null;
  if (pool) await pool.end().catch(() => null);
  pool = null;
  health.worker = 'stopped';
}
