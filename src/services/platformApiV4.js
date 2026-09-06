import http from 'node:http';
import { WebSocketServer } from 'ws';
import { readGuildState } from '../storage/store.js';

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

function membersOf(ticket) {
  return [...new Set((ticket.members ?? [ticket.userId]).filter(Boolean))];
}

async function snapshot(client, guildId) {
  const guild = client.guilds.cache.get(guildId) ?? client.guilds.cache.first();
  if (!guild) return null;
  const state = await readGuildState(guild.id);
  const carries = Object.values(state.carryTickets ?? {});
  const active = carries.filter((x) => ['open', 'claimed', 'ready', 'running'].includes(x.status));
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
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Kingdom Core Live</title>
<style>
:root{color-scheme:dark;font-family:Inter,system-ui,sans-serif;background:#08090d;color:#f5f5f5}body{margin:0;padding:32px;max-width:1200px;margin:auto}.top{display:flex;justify-content:space-between;gap:16px;align-items:end}.eyebrow{color:#d4af37;letter-spacing:.16em;font-size:12px;font-weight:800}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px;margin-top:28px}.card{background:linear-gradient(180deg,#171820,#101116);border:1px solid #2a2d39;border-radius:18px;padding:20px;box-shadow:0 18px 50px #0008}.label{color:#969aaa;font-size:12px;text-transform:uppercase;letter-spacing:.12em}.value{font-size:34px;font-weight:800;margin-top:8px}.gold{color:#e7bb38}.green{color:#57f287}.red{color:#ed4245}.section{margin-top:24px}.row{display:flex;justify-content:space-between;border-bottom:1px solid #242631;padding:12px 0}.muted{color:#969aaa}h1{margin:.25rem 0;font-size:clamp(30px,5vw,58px)}
</style></head><body>
<div class="top"><div><div class="eyebrow">KINGDOM CARRIES • CONTROL PLANE</div><h1>Kingdom Core Live</h1><div class="muted" id="status">Connecting…</div></div></div>
<div class="grid"><div class="card"><div class="label">Members</div><div class="value" id="members">—</div></div><div class="card"><div class="label">Waiting</div><div class="value gold" id="waiting">—</div></div><div class="card"><div class="label">Running Parties</div><div class="value" id="running">—</div></div><div class="card"><div class="label">Knights On Duty</div><div class="value green" id="knights">—</div></div><div class="card"><div class="label">Players Helped</div><div class="value" id="helped">—</div></div><div class="card"><div class="label">Security</div><div class="value" id="security">—</div></div></div>
<div class="card section"><div class="label">Kingdom</div><div class="row"><b id="stage">—</b><span id="xp">—</span></div><div id="houses"></div></div>
<div class="card section"><div class="label">Carry Demand</div><div id="demand"></div></div>
<script>
const q=new URLSearchParams(location.search);const guild=q.get('guild')||'';function render(x){if(!x)return;members.textContent=x.guild.memberCount;waiting.textContent=x.carries.waiting;running.textContent=x.carries.running;knights.textContent=x.knights.onDuty;helped.textContent=x.knights.playersHelped;security.textContent=x.security.state;security.className='value '+(x.security.state==='NORMAL'?'green':x.security.state==='LOCKDOWN'?'red':'gold');stage.textContent=x.kingdom.stage+' • Level '+x.kingdom.level;xp.textContent=x.kingdom.xp+' XP';houses.innerHTML=Object.values(x.kingdom.houses||{}).sort((a,b)=>b.xp-a.xp).map(h=>'<div class="row"><span>'+h.name+'</span><b>'+h.xp+' XP</b></div>').join('');demand.innerHTML=Object.entries(x.carries.forecasts||{}).sort((a,b)=>b[1].requests-a[1].requests).slice(0,10).map(([n,d])=>'<div class="row"><span>'+n+'</span><span>'+d.requests+' demand • ~'+d.estimatedWaitMinutes+'m</span></div>').join('')||'<div class="row muted">No active demand</div>';status.textContent='Live • '+new Date(x.updatedAt).toLocaleTimeString()}
fetch('/api/overview'+(guild?'?guild='+guild:'')).then(r=>r.json()).then(render);const ws=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/ws'+(guild?'?guild='+guild:''));ws.onmessage=e=>render(JSON.parse(e.data));ws.onopen=()=>status.textContent='Live';ws.onclose=()=>status.textContent='Disconnected';
</script></body></html>`;
}

async function handler(client, req, res) {
  const url = new URL(req.url, 'http://localhost');
  const guildId = url.searchParams.get('guild') || client.guilds.cache.first()?.id;
  if (url.pathname === '/') {
    const body = dashboardHtml();
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' });
    return res.end(body);
  }
  if (url.pathname === '/health') {
    return json(res, 200, { ok: true, ping: client.ws.ping, uptimeSeconds: Math.round(process.uptime()), memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024) });
  }
  if (url.pathname === '/api/overview') {
    const data = await snapshot(client, guildId);
    return data ? json(res, 200, data) : json(res, 404, { error: 'guild_not_found' });
  }
  const state = guildId ? await readGuildState(guildId).catch(() => null) : null;
  if (!state) return notFound(res);
  if (url.pathname === '/api/carries') return json(res, 200, Object.values(state.carryTickets ?? {}));
  if (url.pathname === '/api/houses') return json(res, 200, state.kingdom?.houses ?? {});
  if (url.pathname === '/api/marketplace') return json(res, 200, Object.values(state.marketV4?.listings ?? {}).filter((x) => x.status === 'active'));
  if (url.pathname === '/api/leaderboard') {
    const rows = Object.values(state.identities ?? {}).sort((a, b) => (b.kingdomXp ?? 0) - (a.kingdomXp ?? 0)).slice(0, 100);
    return json(res, 200, rows.map((x) => ({ userId: x.userId, kingdomXp: x.kingdomXp ?? 0, prestige: x.prestige ?? 0, stats: x.stats ?? {} })));
  }
  if (url.pathname === '/api/admin/security') {
    if (!authorised(req)) return json(res, 401, { error: 'unauthorised' });
    return json(res, 200, state.securityV4 ?? {});
  }
  if (url.pathname === '/api/admin/config') {
    if (!authorised(req)) return json(res, 401, { error: 'unauthorised' });
    return json(res, 200, { schemaVersion: state.platform?.schemaVersion, featureFlags: state.platform?.featureFlags ?? {} });
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
    json(res, 500, { error: 'internal_error' });
  }));
  wss = new WebSocketServer({ server, path: '/ws' });
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
