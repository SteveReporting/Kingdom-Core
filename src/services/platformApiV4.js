import http from 'node:http';
import { WebSocketServer } from 'ws';
import { readGuildState } from '../storage/store.js';
import {
  createWebsiteCarryTicket,
  getWebsiteMemberProfile,
  normaliseWebsiteBridgeError,
  updateWebsiteMemberProfile
} from './websiteBridge.js';
import { handleWebsitePlatformRoute } from './websitePlatformRoutes.js';

let server = null;
let wss = null;
let broadcastTimer = null;

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(data),
    'cache-control': 'no-store'
  });
  res.end(data);
}

function notFound(res) {
  json(res, 404, { error: 'not_found' });
}

function authorised(req) {
  const required = process.env.API_ADMIN_TOKEN?.trim();
  if (!required) return false;
  return req.headers.authorization === `Bearer ${required}`;
}

function requestUserId(req) {
  const value = req.headers['x-kingdom-user-id'];
  return Array.isArray(value) ? value[0] : String(value ?? '').trim();
}

async function readJsonBody(req, maxBytes = 32 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error('request_too_large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('invalid_json'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function membersOf(ticket) {
  return [...new Set((ticket.members ?? [ticket.userId]).filter(Boolean))];
}

function publicTicket(guild, ticket) {
  const carrier = ticket.carrierId ? guild.members.cache.get(ticket.carrierId) : null;
  return {
    id: ticket.id,
    userId: ticket.userId,
    username: ticket.displayName || ticket.username || 'Member',
    dungeon: ticket.dungeon,
    difficulty: ticket.difficulty,
    mode: ticket.mode,
    level: ticket.level ?? null,
    robloxUsername: ticket.robloxUsername ?? null,
    region: ticket.region ?? null,
    partyRequirements: ticket.partyRequirements ?? null,
    notes: ticket.notes ?? '',
    status: ticket.status,
    carrierId: ticket.carrierId ?? null,
    carrierName: carrier?.displayName ?? carrier?.user?.username ?? null,
    memberCount: membersOf(ticket).length,
    maxMembers: ticket.maxMembers ?? null,
    runsCompleted: ticket.runsCompleted ?? null,
    runTarget: ticket.runTarget ?? null,
    requirement: ticket.requirement ?? null,
    createdAt: ticket.createdAt,
    claimedAt: ticket.claimedAt ?? null,
    startedAt: ticket.startedAt ?? null,
    completedAt: ticket.completedAt ?? null,
    closedAt: ticket.closedAt ?? null,
    source: ticket.source ?? 'discord'
  };
}

async function snapshot(client, guildId) {
  const guild = client.guilds.cache.get(guildId) ?? client.guilds.cache.first();
  if (!guild) return null;
  const state = await readGuildState(guild.id);
  const carries = Object.values(state.carryTickets ?? {});
  const active = carries.filter((x) => ['open', 'claimed', 'ready', 'running', 'between', 'closing'].includes(x.status));
  const profiles = Object.values(state.carrierOps?.profiles ?? {});
  const houses = state.kingdom?.houses ?? {};
  return {
    guild: { id: guild.id, name: guild.name, memberCount: guild.memberCount },
    kingdom: {
      stage: state.kingdom?.stage ?? 'Settlement',
      level: state.kingdom?.level ?? 1,
      xp: state.kingdom?.xp ?? 0,
      houses
    },
    carries: {
      waiting: active.filter((x) => x.status === 'open').reduce((n, x) => n + membersOf(x).length, 0),
      activeParties: active.length,
      running: active.filter((x) => x.status === 'running').length,
      completedPlayers: state.stats?.completedCarries ?? 0,
      demand: state.analyticsV4?.demand ?? {},
      forecasts: state.analyticsV4?.forecasts ?? {}
    },
    knights: {
      registered: profiles.length,
      onDuty: profiles.filter((x) => ['available', 'busy'].includes(x.status) || x.shiftStartedAt).length,
      playersHelped: profiles.reduce((n, x) => n + (x.playersHelped ?? 0), 0),
      serviceMinutes: profiles.reduce((n, x) => n + (x.serviceMinutes ?? 0), 0)
    },
    marketplace: {
      activeListings: Object.values(state.marketV4?.listings ?? {}).filter((x) => x.status === 'active').length
    },
    security: {
      state: state.securityV4?.state ?? 'NORMAL',
      riskScore: state.securityV4?.riskScore ?? 0
    },
    system: {
      schemaVersion: state.platform?.schemaVersion ?? null,
      ping: client.ws.ping,
      uptimeSeconds: Math.round(process.uptime()),
      memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024)
    },
    updatedAt: new Date().toISOString()
  };
}

function dashboardHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kingdom Core Live</title><style>:root{color-scheme:dark;font-family:system-ui;background:#08090d;color:#f5f5f5}body{margin:0 auto;max-width:1100px;padding:32px}.eyebrow{color:#d4af37;letter-spacing:.16em;font-size:12px;font-weight:800}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-top:24px}.card{background:#121319;border:1px solid #2a2d39;border-radius:16px;padding:20px}.label{color:#969aaa;font-size:12px;text-transform:uppercase}.value{font-size:34px;font-weight:800;margin-top:8px}.gold{color:#e7bb38}</style></head><body><div class="eyebrow">KINGDOM CARRIES • CONTROL PLANE</div><h1>Kingdom Core Live</h1><p id="status">Connecting…</p><div class="grid"><div class="card"><div class="label">Members</div><div class="value" id="members">—</div></div><div class="card"><div class="label">Waiting</div><div class="value gold" id="waiting">—</div></div><div class="card"><div class="label">Running</div><div class="value" id="running">—</div></div><div class="card"><div class="label">Knights</div><div class="value" id="knights">—</div></div></div><script>const q=new URLSearchParams(location.search),g=q.get('guild')||'';function r(x){if(!x)return;members.textContent=x.guild.memberCount;waiting.textContent=x.carries.waiting;running.textContent=x.carries.running;knights.textContent=x.knights.onDuty;status.textContent='Live • '+new Date(x.updatedAt).toLocaleTimeString()}fetch('/api/overview'+(g?'?guild='+g:'')).then(x=>x.json()).then(r);const ws=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/ws'+(g?'?guild='+g:''));ws.onmessage=e=>r(JSON.parse(e.data));ws.onclose=()=>status.textContent='Disconnected';</script></body></html>`;
}

async function handler(client, req, res) {
  const url = new URL(req.url, 'http://localhost');
  const guildId = url.searchParams.get('guild') || client.guilds.cache.first()?.id;
  const guild = client.guilds.cache.get(guildId) ?? client.guilds.cache.first();

  if (url.pathname === '/health') {
    return json(res, 200, {
      ok: true,
      ping: client.ws.ping,
      uptimeSeconds: Math.round(process.uptime()),
      memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024)
    });
  }

  if (!authorised(req)) return json(res, 401, { error: 'unauthorised' });
  if (url.pathname === '/') {
    const body = dashboardHtml();
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': Buffer.byteLength(body),
      'cache-control': 'no-store'
    });
    return res.end(body);
  }
  if (url.pathname === '/api/overview') {
    const data = await snapshot(client, guildId);
    return data ? json(res, 200, data) : json(res, 404, { error: 'guild_not_found' });
  }
  if (!guild) return json(res, 404, { error: 'guild_not_found' });

  const websiteRoute = await handleWebsitePlatformRoute(guild, req, url, {
    userId: requestUserId(req),
    readJsonBody
  });
  if (websiteRoute?.handled) return json(res, websiteRoute.status, websiteRoute.body);

  if (url.pathname === '/api/carries/request' && req.method === 'POST') {
    const userId = requestUserId(req);
    if (!userId) return json(res, 401, { error: 'missing_user' });
    try {
      const body = await readJsonBody(req);
      const result = await createWebsiteCarryTicket(guild, { ...body, userId });
      return json(res, 201, {
        ok: true,
        guildId: result.guildId,
        ticket: publicTicket(guild, result.ticket)
      });
    } catch (error) {
      const normalised = normaliseWebsiteBridgeError(error);
      return json(res, normalised.status, normalised.body);
    }
  }

  if (url.pathname === '/api/member' && req.method === 'GET') {
    const userId = requestUserId(req);
    if (!userId) return json(res, 401, { error: 'missing_user' });
    try {
      return json(res, 200, await getWebsiteMemberProfile(guild, userId));
    } catch (error) {
      const normalised = normaliseWebsiteBridgeError(error);
      return json(res, normalised.status, normalised.body);
    }
  }

  if (url.pathname === '/api/member' && req.method === 'PATCH') {
    const userId = requestUserId(req);
    if (!userId) return json(res, 401, { error: 'missing_user' });
    try {
      const body = await readJsonBody(req);
      return json(res, 200, await updateWebsiteMemberProfile(guild, userId, body));
    } catch (error) {
      const normalised = normaliseWebsiteBridgeError(error);
      return json(res, normalised.status, normalised.body);
    }
  }

  const state = await readGuildState(guild.id).catch(() => null);
  if (!state) return notFound(res);

  if (url.pathname === '/api/carries/mine' && req.method === 'GET') {
    const userId = requestUserId(req);
    if (!userId) return json(res, 401, { error: 'missing_user' });
    const tickets = Object.values(state.carryTickets ?? {})
      .filter((ticket) => ticket.userId === userId || membersOf(ticket).includes(userId) || (ticket.participantHistory ?? []).includes(userId))
      .sort((a, b) => new Date(b.createdAt ?? 0) - new Date(a.createdAt ?? 0))
      .map((ticket) => publicTicket(guild, ticket));
    return json(res, 200, tickets);
  }

  if (url.pathname === '/api/carries') {
    const tickets = Object.values(state.carryTickets ?? {})
      .sort((a, b) => new Date(a.createdAt ?? 0) - new Date(b.createdAt ?? 0))
      .map((ticket) => publicTicket(guild, ticket));
    return json(res, 200, tickets);
  }
  if (url.pathname === '/api/houses') return json(res, 200, state.kingdom?.houses ?? {});
  if (url.pathname === '/api/marketplace') return json(res, 200, Object.values(state.marketV4?.listings ?? {}).filter((x) => x.status === 'active'));
  if (url.pathname === '/api/leaderboard') {
    const rows = Object.values(state.identities ?? {})
      .sort((a, b) => (b.kingdomXp ?? 0) - (a.kingdomXp ?? 0))
      .slice(0, 100);
    return json(res, 200, rows.map((x) => ({
      userId: x.userId,
      kingdomXp: x.kingdomXp ?? 0,
      prestige: x.prestige ?? 0,
      stats: x.stats ?? {}
    })));
  }
  if (url.pathname === '/api/admin/security') return json(res, 200, state.securityV4 ?? {});
  if (url.pathname === '/api/admin/config') {
    return json(res, 200, {
      schemaVersion: state.platform?.schemaVersion,
      featureFlags: state.platform?.featureFlags ?? {}
    });
  }
  return notFound(res);
}

export async function startPlatformApi(client) {
  if (String(process.env.ENABLE_PLATFORM_API).toLowerCase() !== 'true') return null;
  if (server) return server;
  const host = process.env.API_HOST?.trim() || '127.0.0.1';
  const port = Number(process.env.API_PORT || 8787);
  server = http.createServer((req, res) => handler(client, req, res).catch((error) => {
    console.error('Platform API error:', error);
    json(res, Number(error?.status) || 500, { error: error?.message || 'internal_error' });
  }));
  wss = new WebSocketServer({
    server,
    path: '/ws',
    verifyClient: ({ req }) => authorised(req)
  });
  wss.on('connection', async (socket, request) => {
    const url = new URL(request.url, 'http://localhost');
    const guildId = url.searchParams.get('guild') || client.guilds.cache.first()?.id;
    const data = await snapshot(client, guildId).catch(() => null);
    if (data) socket.send(JSON.stringify(data));
    socket.kingdomGuildId = guildId;
  });
  broadcastTimer = setInterval(async () => {
    for (const socket of wss.clients) {
      if (socket.readyState !== 1) continue;
      const data = await snapshot(client, socket.kingdomGuildId).catch(() => null);
      if (data) socket.send(JSON.stringify(data));
    }
  }, 15_000);
  broadcastTimer.unref?.();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });
  console.log(`Kingdom Core platform API listening on http://${host}:${port}`);
  return server;
}

export async function stopPlatformApi() {
  if (broadcastTimer) clearInterval(broadcastTimer);
  if (wss) wss.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  broadcastTimer = null;
  wss = null;
  server = null;
}
