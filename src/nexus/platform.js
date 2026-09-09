import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { NEXUS_PRODUCTS, FREE_RUNTIME_POLICY, NEXUS_VERSION, productBySlug } from './catalog.js';
import { getNexusState, linkIdentity, upsertCreatorCampaign, upsertStudioLayout, upsertTenant } from './state.js';
import { readGuildState } from '../storage/store.js';
import {
  buildIntelligenceSnapshot,
  buildSentinelSnapshot,
  callLocalKingdomAi,
  createVaultBackup,
  runNexusMaintenance,
  verifyVaultBackups
} from './ops.js';
import {
  buildAdminSnapshot,
  buildTrendSummary,
  createSentinelIncident,
  publishStudioLayout,
  updateSentinelIncident,
  upsertCompanionBuild,
  upsertCompanionGuide
} from './domain.js';

const WEB_ROOT = path.resolve('web', 'nexus');
let server = null;
let maintenanceTimer = null;
let initialMaintenanceTimer = null;

function baseHeaders(extra = {}) {
  return {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'SAMEORIGIN',
    'referrer-policy': 'same-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    ...extra
  };
}

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, baseHeaders({
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  }));
  res.end(body);
}

function text(res, status, value, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, baseHeaders({
    'content-type': type,
    'content-length': Buffer.byteLength(value)
  }));
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
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('Invalid JSON request body'), { statusCode: 400 });
  }
}

function chosenGuild(client) {
  const configured = String(process.env.GUILD_ID ?? '').trim();
  return (configured && client.guilds.cache.get(configured)) || client.guilds.cache.first() || null;
}

function safeLive(state, guild) {
  const queue = Array.isArray(state.queue) ? state.queue : [];
  const rawParties = state.carryParties ?? state.parties ?? {};
  const activeParties = Object.values(rawParties).filter((party) => !['ended', 'closed', 'completed'].includes(String(party?.status ?? '').toLowerCase()));
  const openTickets = Object.values(state.tickets ?? {}).filter((ticket) => !['closed', 'resolved', 'done'].includes(String(ticket?.status ?? '').toLowerCase())).length;
  return {
    guild: guild ? { id: guild.id, name: guild.name, memberCount: guild.memberCount ?? null } : null,
    queueDepth: queue.length,
    activeCarrySessions: activeParties.length,
    openTickets,
    completedCarries: Number(state.stats?.completedCarries ?? state.platform?.analytics?.completedCarries ?? 0),
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
    res.writeHead(200, baseHeaders({
      'content-type': type,
      'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
      ...(ext === '.html' ? { 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'" } : {})
    }));
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
    auth: 'Admin endpoints use Authorization: Bearer <KINGDOM_NEXUS_ADMIN_TOKEN>.',
    public: [
      'GET /health', 'GET /api/products', 'GET /api/status', 'GET /api/live',
      'GET /api/live/stream', 'GET /api/intelligence', 'GET /api/sentinel',
      'GET /api/network/summary', 'GET /api/launcher', 'GET /api/openapi',
      'GET /api/products/:slug', 'GET /api/sdk/kingdom-nexus.js'
    ],
    admin: [
      'GET /api/admin/state', 'GET /api/admin/vault/verify',
      'POST /api/network/tenants', 'POST /api/identity/link',
      'POST /api/companion/builds', 'POST /api/companion/guides',
      'POST /api/creators/campaigns', 'POST /api/studio/layouts',
      'POST /api/studio/layouts/:id/publish',
      'POST /api/sentinel/incidents', 'PATCH /api/sentinel/incidents/:id',
      'POST /api/vault/backup', 'POST /api/ai'
    ]
  };
}

async function streamLive(req, res, client, guildId) {
  res.writeHead(200, baseHeaders({
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive'
  }));
  let closed = false;
  const send = async () => {
    if (closed || res.destroyed) return;
    const guild = chosenGuild(client);
    const state = await readGuildState(guildId);
    res.write(`event: live\ndata: ${JSON.stringify(safeLive(state, guild))}\n\n`);
  };
  await send();
  const timer = setInterval(() => send().catch(() => null), 5_000);
  timer.unref?.();
  req.on('close', () => {
    closed = true;
    clearInterval(timer);
  });
}

function launcherPayload() {
  const links = [
    ['Discord', process.env.KINGDOM_DISCORD_URL],
    ['Dungeon Quest', process.env.KINGDOM_GAME_URL],
    ['Kingdom Website', process.env.KINGDOM_WEBSITE_URL]
  ].filter(([, url]) => String(url ?? '').trim()).map(([name, url]) => ({ name, url: String(url).trim() }));
  return { links, installable: true, mode: 'PWA', paidRuntimeRequired: false };
}

async function apiHandler(req, res, client, url) {
  const guild = chosenGuild(client);
  const guildId = guild?.id ?? String(process.env.GUILD_ID ?? '').trim();
  if (!guildId) return json(res, 503, { error: 'No Kingdom guild is available.' });

  if (req.method === 'GET' && url.pathname === '/health') {
    return json(res, 200, { ok: true, product: 'Kingdom Nexus', version: NEXUS_VERSION, guildId, uptimeSeconds: Math.floor(process.uptime()) });
  }
  if (req.method === 'GET' && url.pathname === '/api/products') return json(res, 200, { products: NEXUS_PRODUCTS, freeRuntime: FREE_RUNTIME_POLICY });
  if (req.method === 'GET' && url.pathname === '/api/openapi') return json(res, 200, openApiDocument());
  if (req.method === 'GET' && url.pathname === '/api/launcher') return json(res, 200, launcherPayload());

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
    const state = await readGuildState(guildId);
    return json(res, 200, safeLive(state, guild));
  }
  if (req.method === 'GET' && url.pathname === '/api/live/stream') return streamLive(req, res, client, guildId);

  if (req.method === 'GET' && url.pathname === '/api/intelligence') {
    const nexus = await getNexusState(guildId);
    const snapshot = guild ? await buildIntelligenceSnapshot(guild) : nexus.intelligence.lastSnapshot;
    const history = nexus.intelligence.snapshots.slice(-48);
    return json(res, 200, { snapshot, history, trend: buildTrendSummary(history) });
  }

  if (req.method === 'GET' && url.pathname === '/api/sentinel') {
    const nexus = await getNexusState(guildId);
    const snapshot = guild ? await buildSentinelSnapshot(guild) : nexus.sentinel.lastSnapshot;
    return json(res, 200, {
      snapshot,
      incidentsOpen: nexus.sentinel.incidents.filter((incident) => incident.status !== 'closed').length,
      criticalOpen: nexus.sentinel.incidents.filter((incident) => incident.status !== 'closed' && incident.severity === 'critical').length
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/network/summary') {
    const nexus = await getNexusState(guildId);
    const tenants = Object.values(nexus.network.tenants ?? {});
    return json(res, 200, {
      tenants: tenants.length,
      active: tenants.filter((tenant) => String(tenant.status ?? 'active') === 'active').length,
      platform: 'Kingdom Network'
    });
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/products/')) {
    const product = productBySlug(url.pathname.split('/').pop());
    return product ? json(res, 200, product) : json(res, 404, { error: 'Unknown product.' });
  }

  if (req.method === 'GET' && url.pathname === '/api/sdk/kingdom-nexus.js') {
    const sdk = await fs.readFile(path.resolve('src', 'nexus', 'sdk-browser.js'), 'utf8');
    return text(res, 200, sdk, 'text/javascript; charset=utf-8');
  }

  const isAdminPath = url.pathname.startsWith('/api/admin/');
  const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
  if ((isAdminPath || isWrite) && !adminAuthorized(req)) {
    return json(res, 403, { error: 'Admin access is disabled or the Nexus admin token is invalid.' });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/state') {
    const nexus = await getNexusState(guildId);
    return json(res, 200, buildAdminSnapshot(nexus));
  }
  if (req.method === 'GET' && url.pathname === '/api/admin/vault/verify') {
    const backups = await verifyVaultBackups(guildId);
    return json(res, 200, { backups, verified: backups.filter((item) => item.verified).length, total: backups.length });
  }

  if (req.method === 'POST' && url.pathname === '/api/network/tenants') return json(res, 200, await upsertTenant(guildId, await readBody(req)));
  if (req.method === 'POST' && url.pathname === '/api/identity/link') return json(res, 200, await linkIdentity(guildId, await readBody(req)));
  if (req.method === 'POST' && url.pathname === '/api/companion/builds') return json(res, 200, await upsertCompanionBuild(guildId, await readBody(req)));
  if (req.method === 'POST' && url.pathname === '/api/companion/guides') return json(res, 200, await upsertCompanionGuide(guildId, await readBody(req)));
  if (req.method === 'POST' && url.pathname === '/api/creators/campaigns') return json(res, 200, await upsertCreatorCampaign(guildId, await readBody(req)));
  if (req.method === 'POST' && url.pathname === '/api/studio/layouts') return json(res, 200, await upsertStudioLayout(guildId, await readBody(req)));

  const studioPublish = url.pathname.match(/^\/api\/studio\/layouts\/([^/]+)\/publish$/);
  if (req.method === 'POST' && studioPublish) return json(res, 200, await publishStudioLayout(guildId, decodeURIComponent(studioPublish[1])));

  if (req.method === 'POST' && url.pathname === '/api/sentinel/incidents') return json(res, 200, await createSentinelIncident(guildId, await readBody(req)));
  const incidentPatch = url.pathname.match(/^\/api\/sentinel\/incidents\/([^/]+)$/);
  if (req.method === 'PATCH' && incidentPatch) return json(res, 200, await updateSentinelIncident(guildId, decodeURIComponent(incidentPatch[1]), await readBody(req)));

  if (req.method === 'POST' && url.pathname === '/api/vault/backup') return json(res, 200, await createVaultBackup(guildId));
  if (req.method === 'POST' && url.pathname === '/api/ai') {
    const body = await readBody(req);
    const answer = await callLocalKingdomAi(body.prompt ?? '', body.context ?? {});
    return json(res, 200, { answer });
  }

  return json(res, 404, { error: 'Not found.' });
}

function startMaintenanceLoop(client) {
  if (maintenanceTimer) return;
  const pass = async () => {
    for (const guild of client.guilds.cache.values()) {
      await runNexusMaintenance(guild).catch((error) => console.error(`[Nexus] maintenance failed for ${guild.name}:`, error.message));
      await new Promise((resolve) => setImmediate(resolve));
    }
  };
  initialMaintenanceTimer = setTimeout(() => pass().catch(() => null), 30_000);
  initialMaintenanceTimer.unref?.();
  maintenanceTimer = setInterval(() => pass().catch(() => null), 5 * 60_000);
  maintenanceTimer.unref?.();
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
  startMaintenanceLoop(client);
  return server;
}

export function stopNexusPlatform() {
  if (initialMaintenanceTimer) clearTimeout(initialMaintenanceTimer);
  if (maintenanceTimer) clearInterval(maintenanceTimer);
  initialMaintenanceTimer = null;
  maintenanceTimer = null;
  if (!server) return;
  server.close();
  server = null;
}
