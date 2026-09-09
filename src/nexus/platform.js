import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { NEXUS_PRODUCTS, FREE_RUNTIME_POLICY, NEXUS_VERSION, productBySlug } from './catalog.js';
import { getNexusState, linkIdentity, upsertCreatorCampaign, upsertStudioLayout, upsertTenant } from './state.js';
import { buildIntelligenceSnapshot, buildSentinelSnapshot, callLocalKingdomAi, createVaultBackup } from './ops.js';

const WEB_ROOT = path.resolve('web', 'nexus');
let server = null;

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  res.end(body);
}

function text(res, status, value, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'content-type': type,
    'content-length': Buffer.byteLength(value),
    'x-content-type-options': 'nosniff'
  });
  res.end(value);
}

function adminAuthorized(req) {
  const expected = String(process.env.KINGDOM_NEXUS_ADMIN_TOKEN ?? '').trim();
  if (!expected) return false;
  const supplied = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '').trim();
  return supplied.length > 0 && supplied === expected;
}

async function readBody(req, limit = 250_000) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Request body too large'), { statusCode: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function chosenGuild(client) {
  const configured = String(process.env.GUILD_ID ?? '').trim();
  return (configured && client.guilds.cache.get(configured)) || client.guilds.cache.first() || null;
}

function safeLive(state, guild) {
  const queue = Array.isArray(state.queue) ? state.queue : [];
  const rawParties = state.carryParties ?? state.parties ?? {};
  const activeParties = Object.values(rawParties).filter((party) => !['ended', 'closed', 'completed'].includes(String(party?.status ?? '').toLowerCase()));
  return {
    guild: guild ? { id: guild.id, name: guild.name, memberCount: guild.memberCount ?? null } : null,
    queueDepth: queue.length,
    activeCarrySessions: activeParties.length,
    completedCarries: Number(state.stats?.completedCarries ?? 0),
    updatedAt: new Date().toISOString()
  };
}

async function staticFile(res, requestPath) {
  const clean = requestPath === '/' ? '/index.html' : requestPath;
  const file = path.resolve(WEB_ROOT, `.${clean}`);
  if (!file.startsWith(WEB_ROOT)) return false;
  try {
    const data = await fs.readFile(file);
    const ext = path.extname(file).toLowerCase();
    const type = ({
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.webmanifest': 'application/manifest+json; charset=utf-8',
      '.svg': 'image/svg+xml'
    })[ext] ?? 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, 'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=300' });
    res.end(data);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function openApiDocument() {
  return {
    name: 'Kingdom Nexus API',
    version: NEXUS_VERSION,
    auth: 'Write/admin endpoints use Authorization: Bearer <KINGDOM_NEXUS_ADMIN_TOKEN>.',
    endpoints: [
      'GET /health', 'GET /api/products', 'GET /api/status', 'GET /api/live',
      'GET /api/intelligence', 'GET /api/sentinel', 'GET /api/openapi',
      'POST /api/network/tenants', 'POST /api/identity/link', 'POST /api/creators/campaigns',
      'POST /api/studio/layouts', 'POST /api/vault/backup', 'POST /api/ai'
    ]
  };
}

async function apiHandler(req, res, client, url) {
  const guild = chosenGuild(client);
  const guildId = guild?.id ?? String(process.env.GUILD_ID ?? '').trim();
  if (!guildId) return json(res, 503, { error: 'No Kingdom guild is available.' });

  if (req.method === 'GET' && url.pathname === '/health') {
    return json(res, 200, { ok: true, product: 'Kingdom Nexus', version: NEXUS_VERSION, guildId, uptimeSeconds: Math.floor(process.uptime()) });
  }
  if (req.method === 'GET' && url.pathname === '/api/products') {
    return json(res, 200, { products: NEXUS_PRODUCTS, freeRuntime: FREE_RUNTIME_POLICY });
  }
  if (req.method === 'GET' && url.pathname === '/api/openapi') return json(res, 200, openApiDocument());

  if (req.method === 'GET' && url.pathname === '/api/status') {
    const nexus = await getNexusState(guildId);
    const intelligence = guild ? await buildIntelligenceSnapshot(guild) : nexus.intelligence.lastSnapshot;
    const sentinel = guild ? await buildSentinelSnapshot(guild) : nexus.sentinel.lastSnapshot;
    return json(res, 200, {
      version: NEXUS_VERSION,
      guild: guild ? { id: guild.id, name: guild.name, memberCount: guild.memberCount ?? null } : { id: guildId },
      products: NEXUS_PRODUCTS.map((product) => ({ ...product, runtime: nexus.products[product.slug] ?? { enabled: true, status: 'ready' } })),
      intelligence,
      sentinel,
      freeRuntime: FREE_RUNTIME_POLICY
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/live') {
    const { default: _unused } = {};
    const stateModule = await import('../storage/store.js');
    const state = await stateModule.readGuildState(guildId);
    return json(res, 200, safeLive(state, guild));
  }

  if (req.method === 'GET' && url.pathname === '/api/intelligence') {
    const nexus = await getNexusState(guildId);
    const snapshot = guild ? await buildIntelligenceSnapshot(guild) : nexus.intelligence.lastSnapshot;
    return json(res, 200, { snapshot, history: nexus.intelligence.snapshots.slice(-24) });
  }

  if (req.method === 'GET' && url.pathname === '/api/sentinel') {
    const nexus = await getNexusState(guildId);
    const snapshot = guild ? await buildSentinelSnapshot(guild) : nexus.sentinel.lastSnapshot;
    return json(res, 200, { snapshot, incidentsOpen: nexus.sentinel.incidents.filter((incident) => incident.status !== 'closed').length });
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/products/')) {
    const product = productBySlug(url.pathname.split('/').pop());
    return product ? json(res, 200, product) : json(res, 404, { error: 'Unknown product.' });
  }

  if (req.method === 'GET' && url.pathname === '/api/sdk/kingdom-nexus.js') {
    const sdk = await fs.readFile(path.resolve('src', 'nexus', 'sdk-browser.js'), 'utf8');
    return text(res, 200, sdk, 'text/javascript; charset=utf-8');
  }

  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !adminAuthorized(req)) {
    return json(res, 403, { error: 'Admin writes are disabled or the Nexus admin token is invalid.' });
  }

  if (req.method === 'POST' && url.pathname === '/api/network/tenants') return json(res, 200, await upsertTenant(guildId, await readBody(req)));
  if (req.method === 'POST' && url.pathname === '/api/identity/link') return json(res, 200, await linkIdentity(guildId, await readBody(req)));
  if (req.method === 'POST' && url.pathname === '/api/creators/campaigns') return json(res, 200, await upsertCreatorCampaign(guildId, await readBody(req)));
  if (req.method === 'POST' && url.pathname === '/api/studio/layouts') return json(res, 200, await upsertStudioLayout(guildId, await readBody(req)));
  if (req.method === 'POST' && url.pathname === '/api/vault/backup') return json(res, 200, await createVaultBackup(guildId));
  if (req.method === 'POST' && url.pathname === '/api/ai') {
    const body = await readBody(req);
    const answer = await callLocalKingdomAi(body.prompt ?? '', body.context ?? {});
    return json(res, 200, { answer });
  }

  return json(res, 404, { error: 'Not found.' });
}

export async function startNexusPlatform(client) {
  if (String(process.env.KINGDOM_NEXUS_ENABLED ?? 'true').toLowerCase() === 'false') {
    console.log('[Nexus] disabled by KINGDOM_NEXUS_ENABLED=false');
    return null;
  }
  if (server) return server;

  const host = String(process.env.KINGDOM_NEXUS_HOST ?? '127.0.0.1');
  const port = Number(process.env.KINGDOM_NEXUS_PORT ?? 8791);
  server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      if (url.pathname.startsWith('/api/') || url.pathname === '/health') return await apiHandler(req, res, client, url);
      if (url.pathname === '/tv') return staticFile(res, '/tv.html');
      if (await staticFile(res, url.pathname)) return;
      return staticFile(res, '/index.html');
    } catch (error) {
      const status = Number(error?.statusCode ?? 500);
      console.error('[Nexus] request failed:', error);
      return json(res, status, { error: status === 500 ? 'Kingdom Nexus request failed.' : String(error.message ?? error) });
    }
  });

  server.on('error', (error) => {
    console.error(`[Nexus] server error on ${host}:${port}:`, error.message);
    if (error.code === 'EADDRINUSE') server = null;
  });
  server.listen(port, host, () => console.log(`[Nexus] Kingdom Nexus available at http://${host}:${port}`));
  server.unref?.();
  return server;
}

export function stopNexusPlatform() {
  if (!server) return;
  server.close();
  server = null;
}
