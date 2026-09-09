import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, timingSafeEqual } from 'node:crypto';
import { NEXUS_PRODUCTS, FREE_RUNTIME_POLICY, NEXUS_VERSION, productBySlug } from './catalog.js';
import { appendNexusAudit, getNexusState, linkIdentity, upsertCreatorCampaign, upsertStudioLayout, upsertTenant } from './state.js';
import { readGuildState } from '../storage/store.js';
import {
  buildIntelligenceSnapshot,
  buildSentinelSnapshot,
  callLocalKingdomAi,
  createVaultBackup,
  refreshSystemReadiness,
  restoreVaultBackup,
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
import {
  listAuditEvents,
  removeCompanionBuild,
  removeCompanionGuide,
  removeCreatorCampaign,
  removeStudioLayout,
  removeTenant,
  unlinkIdentity
} from './lifecycle.js';
import {
  completeDiscordOAuth,
  csrfTokenForRequest,
  discordOAuthConfigured,
  getNexusSession,
  isOperatorSession,
  logoutDiscord,
  publicSession,
  startDiscordOAuth,
  validCsrfToken
} from './auth.js';
import {
  buildApplicationsPayload,
  buildCompanionPayload,
  buildCreatorsPayload,
  buildIdentityPayload,
  buildLivePayload,
  buildNetworkPayload,
  buildStudioPayload,
  buildVaultPayload
} from './webData.js';
import { addApplicationReviewNote, finalizeApplicationReview } from './applicationOps.js';

const WEB_ROOT = path.resolve('web', 'nexus');
const OPERATOR_READS = new Set(['/api/identity', '/api/applications', '/api/vault', '/api/studio/layouts', '/api/audit']);
const rateBuckets = new Map();
let server = null;
let maintenanceTimer = null;
let initialMaintenanceTimer = null;

function baseHeaders(extra = {}) {
  return {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'x-permitted-cross-domain-policies': 'none',
    'referrer-policy': 'no-referrer',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    ...extra
  };
}

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, baseHeaders({
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store, max-age=0',
    pragma: 'no-cache'
  }));
  res.end(body);
}

function text(res, status, value, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, baseHeaders({
    'content-type': type,
    'content-length': Buffer.byteLength(value),
    'cache-control': 'no-store, max-age=0'
  }));
  res.end(value);
}

function digest(value) {
  return createHash('sha256').update(String(value ?? ''), 'utf8').digest();
}

function secureEqual(left, right) {
  return timingSafeEqual(digest(left), digest(right));
}

function isLoopback(address) {
  const value = String(address ?? '').toLowerCase();
  return value === '127.0.0.1' || value === '::1' || value === '::ffff:127.0.0.1';
}

function recoveryTokenAuthorized(req) {
  if (!isLoopback(req.socket?.remoteAddress)) return false;
  const expected = String(process.env.KINGDOM_NEXUS_ADMIN_TOKEN ?? '').trim();
  const supplied = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '').trim();
  return Boolean(expected && supplied && secureEqual(expected, supplied));
}

function adminAuthorized(req) {
  return isOperatorSession(req) || recoveryTokenAuthorized(req);
}

function reviewerId(req, client) {
  return publicSession(req)?.user?.id ?? client.user?.id ?? 'kingdom-nexus';
}

function requestIdentity(req) {
  return getNexusSession(req)?.user?.id ?? String(req.headers['cf-connecting-ip'] ?? req.socket?.remoteAddress ?? 'unknown');
}

function rateAllowed(req, scope, limit, windowMs) {
  const now = Date.now();
  const key = `${scope}:${requestIdentity(req)}`;
  const current = rateBuckets.get(key);
  if (!current || current.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  current.count += 1;
  if (rateBuckets.size > 10_000) {
    for (const [bucketKey, bucket] of rateBuckets) if (bucket.resetAt <= now) rateBuckets.delete(bucketKey);
  }
  return current.count <= limit;
}

function validBrowserWrite(req) {
  if (!isOperatorSession(req)) return true;
  const expectedOrigin = String(process.env.KINGDOM_NEXUS_PUBLIC_URL ?? '').trim().replace(/\/$/, '');
  const origin = String(req.headers.origin ?? '').trim().replace(/\/$/, '');
  if (!expectedOrigin.startsWith('https://') || origin !== expectedOrigin) return false;
  const fetchSite = String(req.headers['sec-fetch-site'] ?? '').toLowerCase();
  if (fetchSite && fetchSite !== 'same-origin') return false;
  return validCsrfToken(req);
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

function auditActor(req) {
  const session = publicSession(req);
  if (session?.user?.id) {
    return {
      actorId: session.user.id,
      actorName: session.user.globalName ?? session.user.username ?? session.guildMember?.displayName ?? null
    };
  }
  if (recoveryTokenAuthorized(req)) return { actorId: 'local-recovery', actorName: 'Local recovery operator' };
  return { actorId: null, actorName: null };
}

async function recordAudit(guildId, req, action, targetType, targetId, detail = null) {
  const actor = auditActor(req);
  try {
    await appendNexusAudit(guildId, { ...actor, action, targetType, targetId, detail, outcome: 'success' });
  } catch (error) {
    console.error('[Nexus] audit write failed:', error?.message ?? error);
  }
}

async function auditedResult(res, guildId, req, action, targetType, targetId, result, detail = null) {
  await recordAudit(guildId, req, action, targetType, targetId, detail);
  return json(res, 200, result);
}

async function staticFile(res, requestPath) {
  const clean = requestPath === '/' ? '/index.html' : requestPath;
  const file = path.resolve(WEB_ROOT, `.${clean}`);
  const relative = path.relative(WEB_ROOT, file);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return false;
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
      ...(ext === '.html' ? {
        'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://cdn.discordapp.com; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self' https://discord.com"
      } : {})
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
    auth: 'Operational reads require a signed-in Kingdom guild member. Operator writes require a Discord operator session and CSRF token. The recovery bearer token is local-only.',
    public: ['GET /health', 'GET /api/me', 'GET /auth/discord', 'GET /auth/discord/callback', 'GET /auth/logout'],
    member: [
      'GET /api/products', 'GET /api/status', 'GET /api/live', 'GET /api/live/stream',
      'GET /api/intelligence', 'GET /api/sentinel', 'GET /api/network/summary',
      'GET /api/launcher', 'GET /api/companion', 'GET /api/creators',
      'GET /api/openapi', 'GET /api/products/:slug', 'GET /api/sdk/kingdom-nexus.js'
    ],
    operator: [
      'GET /api/identity', 'GET /api/applications', 'GET /api/vault', 'GET /api/studio/layouts', 'GET /api/audit',
      'GET /api/admin/state', 'GET /api/admin/vault/verify',
      'POST /api/network/tenants', 'DELETE /api/network/tenants/:id',
      'POST /api/identity/link', 'DELETE /api/identity/:discordId',
      'POST /api/companion/builds', 'DELETE /api/companion/builds/:id',
      'POST /api/companion/guides', 'DELETE /api/companion/guides/:id',
      'POST /api/creators/campaigns', 'DELETE /api/creators/campaigns/:id',
      'POST /api/studio/layouts', 'POST /api/studio/layouts/:id/publish', 'DELETE /api/studio/layouts/:id',
      'POST /api/sentinel/incidents', 'PATCH /api/sentinel/incidents/:id',
      'POST /api/applications/:id/notes', 'POST /api/applications/:id/review',
      'POST /api/vault/backup', 'POST /api/vault/restore', 'POST /api/ai'
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
    res.write(`event: live\ndata: ${JSON.stringify(buildLivePayload(state, guild))}\n\n`);
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
  return {
    links,
    installable: true,
    mode: 'PWA',
    paidRuntimeRequired: false,
    publicUrl: String(process.env.KINGDOM_NEXUS_PUBLIC_URL ?? '').trim() || null,
    updatedAt: new Date().toISOString()
  };
}

async function apiHandler(req, res, client, url) {
  const guild = chosenGuild(client);
  const guildId = guild?.id ?? String(process.env.GUILD_ID ?? '').trim();
  if (!guildId) return json(res, 503, { error: 'Kingdom Core is not ready.' });

  if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true, product: 'Kingdom Nexus' });
  if (req.method === 'GET' && url.pathname === '/api/me') {
    const session = publicSession(req);
    return json(res, 200, { session, csrfToken: session ? csrfTokenForRequest(req) : null, discordOAuthConfigured: discordOAuthConfigured() });
  }

  if (!getNexusSession(req) && !recoveryTokenAuthorized(req)) return json(res, 401, { error: 'Sign in with Discord to access Kingdom Nexus.' });

  if (req.method === 'GET' && url.pathname === '/api/products') return json(res, 200, { products: NEXUS_PRODUCTS, freeRuntime: FREE_RUNTIME_POLICY });
  if (req.method === 'GET' && url.pathname === '/api/openapi') return json(res, 200, openApiDocument());
  if (req.method === 'GET' && url.pathname === '/api/launcher') return json(res, 200, launcherPayload());

  if (req.method === 'GET' && url.pathname === '/api/status') {
    if (guild) await refreshSystemReadiness(guild);
    const nexus = await getNexusState(guildId);
    const intelligence = guild ? await buildIntelligenceSnapshot(guild) : nexus.intelligence.lastSnapshot;
    const sentinel = guild ? await buildSentinelSnapshot(guild) : nexus.sentinel.lastSnapshot;
    return json(res, 200, {
      version: NEXUS_VERSION,
      guild: guild ? { id: guild.id, name: guild.name, memberCount: guild.memberCount ?? null } : { id: guildId },
      products: NEXUS_PRODUCTS.map((product) => ({ ...product, runtime: nexus.products[product.slug] ?? { enabled: true, status: 'checking' } })),
      intelligence,
      sentinel,
      freeRuntime: FREE_RUNTIME_POLICY
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/live') {
    const state = await readGuildState(guildId);
    return json(res, 200, buildLivePayload(state, guild));
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
    const operator = adminAuthorized(req);
    return json(res, 200, {
      snapshot,
      incidents: operator ? nexus.sentinel.incidents : [],
      incidentsOpen: nexus.sentinel.incidents.filter((incident) => incident.status !== 'closed').length,
      criticalOpen: nexus.sentinel.incidents.filter((incident) => incident.status !== 'closed' && incident.severity === 'critical').length
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/network/summary') {
    const nexus = await getNexusState(guildId);
    const state = await readGuildState(guildId);
    return json(res, 200, buildNetworkPayload(nexus, guild, state));
  }
  if (req.method === 'GET' && url.pathname === '/api/companion') {
    const nexus = await getNexusState(guildId);
    const state = await readGuildState(guildId);
    return json(res, 200, buildCompanionPayload(nexus, state));
  }
  if (req.method === 'GET' && url.pathname === '/api/creators') {
    const nexus = await getNexusState(guildId);
    return json(res, 200, buildCreatorsPayload(nexus));
  }

  if (req.method === 'GET' && OPERATOR_READS.has(url.pathname) && !adminAuthorized(req)) return json(res, 403, { error: 'Operator access is required.' });

  if (req.method === 'GET' && url.pathname === '/api/identity') {
    const nexus = await getNexusState(guildId);
    const state = await readGuildState(guildId);
    return json(res, 200, buildIdentityPayload(guild, nexus, state));
  }
  if (req.method === 'GET' && url.pathname === '/api/applications') {
    const state = await readGuildState(guildId);
    return json(res, 200, buildApplicationsPayload(state, guild));
  }
  if (req.method === 'GET' && url.pathname === '/api/vault') {
    const nexus = await getNexusState(guildId);
    const verification = await verifyVaultBackups(guildId);
    return json(res, 200, buildVaultPayload(nexus, verification));
  }
  if (req.method === 'GET' && url.pathname === '/api/studio/layouts') {
    const nexus = await getNexusState(guildId);
    return json(res, 200, buildStudioPayload(nexus));
  }
  if (req.method === 'GET' && url.pathname === '/api/audit') {
    const limit = Number(url.searchParams.get('limit') ?? 200);
    return json(res, 200, { events: await listAuditEvents(guildId, limit) });
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
  if ((isAdminPath || isWrite) && !adminAuthorized(req)) return json(res, 403, { error: 'Operator access is required.' });
  if (isWrite && !rateAllowed(req, 'write', 60, 60_000)) return json(res, 429, { error: 'Too many operator requests. Try again shortly.' });
  if (isWrite && !validBrowserWrite(req)) return json(res, 403, { error: 'Security validation failed. Refresh Nexus and try again.' });

  if (req.method === 'GET' && url.pathname === '/api/admin/state') {
    const nexus = await getNexusState(guildId);
    return json(res, 200, buildAdminSnapshot(nexus));
  }
  if (req.method === 'GET' && url.pathname === '/api/admin/vault/verify') {
    const backups = await verifyVaultBackups(guildId);
    return json(res, 200, { backups, verified: backups.filter((item) => item.verified).length, total: backups.length });
  }

  if (req.method === 'POST' && url.pathname === '/api/network/tenants') {
    const body = await readBody(req);
    const result = await upsertTenant(guildId, body);
    return auditedResult(res, guildId, req, 'network.tenant.upsert', 'tenant', result.id, result);
  }
  const tenantDelete = url.pathname.match(/^\/api\/network\/tenants\/([^/]+)$/);
  if (req.method === 'DELETE' && tenantDelete) {
    const id = decodeURIComponent(tenantDelete[1]);
    const removed = await removeTenant(guildId, id);
    return auditedResult(res, guildId, req, 'network.tenant.delete', 'tenant', id, { ok: true, removed });
  }

  if (req.method === 'POST' && url.pathname === '/api/identity/link') {
    const body = await readBody(req);
    const result = await linkIdentity(guildId, body);
    return auditedResult(res, guildId, req, 'identity.link', 'identity', result.discordId, result);
  }
  const identityDelete = url.pathname.match(/^\/api\/identity\/([^/]+)$/);
  if (req.method === 'DELETE' && identityDelete) {
    const id = decodeURIComponent(identityDelete[1]);
    const removed = await unlinkIdentity(guildId, id);
    return auditedResult(res, guildId, req, 'identity.unlink', 'identity', id, { ok: true, removed });
  }

  if (req.method === 'POST' && url.pathname === '/api/companion/builds') {
    const result = await upsertCompanionBuild(guildId, await readBody(req));
    return auditedResult(res, guildId, req, 'companion.build.upsert', 'build', result.id, result);
  }
  const buildDelete = url.pathname.match(/^\/api\/companion\/builds\/([^/]+)$/);
  if (req.method === 'DELETE' && buildDelete) {
    const id = decodeURIComponent(buildDelete[1]);
    const removed = await removeCompanionBuild(guildId, id);
    return auditedResult(res, guildId, req, 'companion.build.delete', 'build', id, { ok: true, removed });
  }

  if (req.method === 'POST' && url.pathname === '/api/companion/guides') {
    const result = await upsertCompanionGuide(guildId, await readBody(req));
    return auditedResult(res, guildId, req, 'companion.guide.upsert', 'guide', result.id, result);
  }
  const guideDelete = url.pathname.match(/^\/api\/companion\/guides\/([^/]+)$/);
  if (req.method === 'DELETE' && guideDelete) {
    const id = decodeURIComponent(guideDelete[1]);
    const removed = await removeCompanionGuide(guildId, id);
    return auditedResult(res, guildId, req, 'companion.guide.delete', 'guide', id, { ok: true, removed });
  }

  if (req.method === 'POST' && url.pathname === '/api/creators/campaigns') {
    const result = await upsertCreatorCampaign(guildId, await readBody(req));
    return auditedResult(res, guildId, req, 'creator.campaign.upsert', 'campaign', result.id, result);
  }
  const campaignDelete = url.pathname.match(/^\/api\/creators\/campaigns\/([^/]+)$/);
  if (req.method === 'DELETE' && campaignDelete) {
    const id = decodeURIComponent(campaignDelete[1]);
    const removed = await removeCreatorCampaign(guildId, id);
    return auditedResult(res, guildId, req, 'creator.campaign.delete', 'campaign', id, { ok: true, removed });
  }

  if (req.method === 'POST' && url.pathname === '/api/studio/layouts') {
    const result = await upsertStudioLayout(guildId, await readBody(req));
    return auditedResult(res, guildId, req, 'studio.layout.upsert', 'layout', result.id, result);
  }
  const studioPublish = url.pathname.match(/^\/api\/studio\/layouts\/([^/]+)\/publish$/);
  if (req.method === 'POST' && studioPublish) {
    const id = decodeURIComponent(studioPublish[1]);
    const result = await publishStudioLayout(guildId, id);
    return auditedResult(res, guildId, req, 'studio.layout.publish', 'layout', id, result);
  }
  const layoutDelete = url.pathname.match(/^\/api\/studio\/layouts\/([^/]+)$/);
  if (req.method === 'DELETE' && layoutDelete) {
    const id = decodeURIComponent(layoutDelete[1]);
    const removed = await removeStudioLayout(guildId, id);
    return auditedResult(res, guildId, req, 'studio.layout.delete', 'layout', id, { ok: true, removed });
  }

  if (req.method === 'POST' && url.pathname === '/api/sentinel/incidents') {
    const result = await createSentinelIncident(guildId, await readBody(req));
    return auditedResult(res, guildId, req, 'sentinel.incident.create', 'incident', result.id, result);
  }
  const incidentPatch = url.pathname.match(/^\/api\/sentinel\/incidents\/([^/]+)$/);
  if (req.method === 'PATCH' && incidentPatch) {
    const id = decodeURIComponent(incidentPatch[1]);
    const result = await updateSentinelIncident(guildId, id, await readBody(req));
    return auditedResult(res, guildId, req, 'sentinel.incident.update', 'incident', id, result, result.status ?? null);
  }

  const applicationNotes = url.pathname.match(/^\/api\/applications\/([^/]+)\/notes$/);
  if (req.method === 'POST' && applicationNotes) {
    const id = decodeURIComponent(applicationNotes[1]);
    const body = await readBody(req);
    const result = await addApplicationReviewNote(guildId, id, reviewerId(req, client), body.text ?? body.note);
    return auditedResult(res, guildId, req, 'application.note.add', 'application', id, result);
  }
  const applicationReview = url.pathname.match(/^\/api\/applications\/([^/]+)\/review$/);
  if (req.method === 'POST' && applicationReview) {
    if (!guild) return json(res, 503, { error: 'Discord guild is unavailable.' });
    const id = decodeURIComponent(applicationReview[1]);
    const body = await readBody(req);
    const result = await finalizeApplicationReview(guild, id, reviewerId(req, client), body);
    return auditedResult(res, guildId, req, 'application.review.finalize', 'application', id, result, body.decision ?? null);
  }

  if (req.method === 'POST' && url.pathname === '/api/vault/backup') {
    const result = await createVaultBackup(guildId);
    return auditedResult(res, guildId, req, 'vault.backup.create', 'backup', result.file, result);
  }
  if (req.method === 'POST' && url.pathname === '/api/vault/restore') {
    const body = await readBody(req);
    const result = await restoreVaultBackup(guildId, body);
    return auditedResult(res, guildId, req, 'vault.backup.restore', 'backup', body.file ?? result.file ?? null, result);
  }
  if (req.method === 'POST' && url.pathname === '/api/ai') {
    const body = await readBody(req);
    const answer = await callLocalKingdomAi(body.prompt ?? '', body.context ?? {});
    await recordAudit(guildId, req, 'ai.query', 'ai', null, `promptLength=${String(body.prompt ?? '').length}`);
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
      const guild = chosenGuild(client);
      if (req.method === 'GET' && url.pathname === '/auth/discord') {
        if (!rateAllowed(req, 'oauth-start', 20, 60_000)) return text(res, 429, 'Too many login attempts. Try again shortly.');
        return startDiscordOAuth(req, res, url);
      }
      if (req.method === 'GET' && url.pathname === '/auth/discord/callback') {
        if (!rateAllowed(req, 'oauth-callback', 30, 60_000)) return text(res, 429, 'Too many login attempts. Try again shortly.');
        return await completeDiscordOAuth(req, res, url, guild);
      }
      if (req.method === 'GET' && url.pathname === '/auth/logout') return logoutDiscord(req, res);
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

  server.maxHeadersCount = 100;
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 100;

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
