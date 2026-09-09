import { randomBytes, timingSafeEqual } from 'node:crypto';
import { PermissionFlagsBits } from 'discord.js';

const oauthStates = new Map();
const sessions = new Map();
const SECURE_SESSION_COOKIE = '__Host-kingdom_nexus_session';
const LOCAL_SESSION_COOKIE = 'kingdom_nexus_session';
const STATE_TTL_MS = 5 * 60_000;
const SESSION_TTL_MS = 4 * 60 * 60_000;
const SESSION_REVALIDATE_MS = 30_000;
const MAX_PENDING_STATES = 2_000;
const MAX_SESSIONS = 2_000;

function token(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

function publicUrl() {
  return String(process.env.KINGDOM_NEXUS_PUBLIC_URL ?? '').trim().replace(/\/$/, '');
}

export function discordOAuthConfigured() {
  return Boolean(
    String(process.env.CLIENT_ID ?? '').trim() &&
    String(process.env.DISCORD_OAUTH_CLIENT_SECRET ?? '').trim() &&
    publicUrl().startsWith('https://')
  );
}

function callbackUrl() {
  return `${publicUrl()}/auth/discord/callback`;
}

function secureCookie() {
  return publicUrl().startsWith('https://');
}

function sessionCookieName() {
  return secureCookie() ? SECURE_SESSION_COOKIE : LOCAL_SESSION_COOKIE;
}

function parseCookies(req) {
  const raw = String(req.headers.cookie ?? '');
  const out = {};
  for (const part of raw.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

function sessionIdFromRequest(req) {
  const cookies = parseCookies(req);
  return cookies[SECURE_SESSION_COOKIE] ?? cookies[LOCAL_SESSION_COOKIE] ?? null;
}

function setSessionCookie(res, value, maxAgeSeconds) {
  const name = sessionCookieName();
  const secure = secureCookie() ? '; Secure' : '';
  res.setHeader(
    'set-cookie',
    `${name}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}; Priority=High${secure}`
  );
}

function clearSessionCookie(res) {
  const secure = secureCookie() ? '; Secure' : '';
  const expired = [
    `${SECURE_SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Priority=High; Secure`,
    `${LOCAL_SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Priority=High${secure}`
  ];
  res.setHeader('set-cookie', expired);
}

function prune() {
  const now = Date.now();
  for (const [key, record] of oauthStates) if (record.expiresAt <= now) oauthStates.delete(key);
  for (const [key, record] of sessions) if (record.expiresAt <= now) sessions.delete(key);
  while (oauthStates.size > MAX_PENDING_STATES) oauthStates.delete(oauthStates.keys().next().value);
  while (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left ?? ''));
  const b = Buffer.from(String(right ?? ''));
  if (!a.length || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function csvIds(value) {
  return new Set(
    String(value ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function operatorForMember(member, userId) {
  if (!member) return false;
  const roleAllowlist = csvIds(process.env.KINGDOM_NEXUS_OPERATOR_ROLE_IDS);
  const userAllowlist = csvIds(process.env.KINGDOM_NEXUS_OPERATOR_USER_IDS);
  const permissionOperator = member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageGuild);
  const roleOperator = [...roleAllowlist].some((roleId) => member.roles.cache.has(roleId));
  const userOperator = userAllowlist.has(String(userId));
  return permissionOperator || roleOperator || userOperator;
}

export function getNexusSession(req) {
  prune();
  const id = sessionIdFromRequest(req);
  if (!id) return null;
  const session = sessions.get(id);
  if (!session || session.expiresAt <= Date.now()) {
    sessions.delete(id);
    return null;
  }
  return session;
}

export async function revalidateNexusSession(req, guild) {
  const session = getNexusSession(req);
  if (!session) return null;

  // Fail closed if Discord is unavailable. The session record is retained so a
  // transient reconnect does not force a new OAuth flow, but it cannot be used
  // until guild membership can be verified again.
  if (!guild) return null;

  const now = Date.now();
  let member = guild.members.cache.get(String(session.user?.id ?? '')) ?? null;
  const stale = now - Number(session.lastValidatedAt ?? 0) >= SESSION_REVALIDATE_MS;
  if (!member || stale) {
    member = await guild.members.fetch(String(session.user?.id ?? '')).catch(() => null);
  }
  if (!member) {
    if (session.id) sessions.delete(session.id);
    return null;
  }

  const wasOperator = Boolean(session.operator);
  const operator = operatorForMember(member, session.user.id);
  session.guildMember = { id: member.id, displayName: member.displayName };
  session.operator = operator;
  session.lastValidatedAt = now;

  // If elevated access was revoked, rotate CSRF material immediately so an
  // already-open operator page cannot replay a previously issued write token.
  if (wasOperator && !operator) session.csrfToken = token(24);
  return session;
}

export function isOperatorSession(req) {
  return Boolean(getNexusSession(req)?.operator);
}

export function publicSession(req) {
  const session = getNexusSession(req);
  if (!session) return null;
  return {
    user: session.user,
    guildMember: session.guildMember,
    operator: Boolean(session.operator),
    expiresAt: new Date(session.expiresAt).toISOString()
  };
}

export function csrfTokenForRequest(req) {
  return getNexusSession(req)?.csrfToken ?? null;
}

export function validCsrfToken(req) {
  const session = getNexusSession(req);
  if (!session) return false;
  return safeEqual(req.headers['x-kingdom-csrf'], session.csrfToken);
}

function noStoreHeaders(extra = {}) {
  return {
    'cache-control': 'no-store, max-age=0',
    'pragma': 'no-cache',
    ...extra
  };
}

export function startDiscordOAuth(req, res, url) {
  if (!discordOAuthConfigured()) {
    res.writeHead(503, noStoreHeaders({ 'content-type': 'text/plain; charset=utf-8' }));
    res.end('Discord login is not configured for Kingdom Nexus.');
    return;
  }

  prune();
  const state = token(24);
  const requested = String(url.searchParams.get('return') ?? '/');
  const returnTo = requested.startsWith('/') && !requested.startsWith('//') && !requested.includes('\\')
    ? requested.slice(0, 500)
    : '/';
  oauthStates.set(state, { createdAt: Date.now(), expiresAt: Date.now() + STATE_TTL_MS, returnTo });
  prune();

  const params = new URLSearchParams({
    client_id: String(process.env.CLIENT_ID).trim(),
    response_type: 'code',
    redirect_uri: callbackUrl(),
    scope: 'identify',
    state,
    prompt: 'consent'
  });
  res.writeHead(302, noStoreHeaders({ location: `https://discord.com/oauth2/authorize?${params.toString()}` }));
  res.end();
}

async function revokeDiscordToken(accessToken) {
  if (!accessToken) return;
  const form = new URLSearchParams({
    client_id: String(process.env.CLIENT_ID).trim(),
    client_secret: String(process.env.DISCORD_OAUTH_CLIENT_SECRET).trim(),
    token: String(accessToken),
    token_type_hint: 'access_token'
  });
  await fetch('https://discord.com/api/oauth2/token/revoke', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form
  }).catch(() => null);
}

export async function completeDiscordOAuth(req, res, url, guild) {
  if (!discordOAuthConfigured()) {
    res.writeHead(503, noStoreHeaders({ 'content-type': 'text/plain; charset=utf-8' }));
    res.end('Discord login is not configured for Kingdom Nexus.');
    return;
  }

  prune();
  const oauthError = String(url.searchParams.get('error') ?? '');
  if (oauthError) {
    res.writeHead(400, noStoreHeaders({ 'content-type': 'text/plain; charset=utf-8' }));
    res.end('Discord login was cancelled or denied.');
    return;
  }

  const state = String(url.searchParams.get('state') ?? '');
  const code = String(url.searchParams.get('code') ?? '');
  const pending = oauthStates.get(state);
  oauthStates.delete(state);
  if (!state || !code || !pending || pending.expiresAt <= Date.now()) {
    res.writeHead(400, noStoreHeaders({ 'content-type': 'text/plain; charset=utf-8' }));
    res.end('Invalid or expired Discord login attempt.');
    return;
  }

  const form = new URLSearchParams({
    client_id: String(process.env.CLIENT_ID).trim(),
    client_secret: String(process.env.DISCORD_OAUTH_CLIENT_SECRET).trim(),
    grant_type: 'authorization_code',
    code,
    redirect_uri: callbackUrl()
  });
  const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form
  });
  if (!tokenResponse.ok) throw new Error(`Discord OAuth token exchange failed with HTTP ${tokenResponse.status}`);
  const tokens = await tokenResponse.json();
  const accessToken = String(tokens.access_token ?? '');
  if (!accessToken) throw new Error('Discord OAuth did not return an access token.');

  let user;
  try {
    const userResponse = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { authorization: `Bearer ${accessToken}` }
    });
    if (!userResponse.ok) throw new Error(`Discord user lookup failed with HTTP ${userResponse.status}`);
    user = await userResponse.json();
  } finally {
    await revokeDiscordToken(accessToken);
  }

  const member = guild ? await guild.members.fetch(user.id).catch(() => null) : null;
  if (!member) {
    res.writeHead(403, noStoreHeaders({ 'content-type': 'text/plain; charset=utf-8' }));
    res.end('Your Discord account is not a member of this Kingdom guild.');
    return;
  }

  const operator = operatorForMember(member, user.id);

  for (const [sessionId, existing] of sessions) {
    if (existing.user?.id === String(user.id)) sessions.delete(sessionId);
  }

  const id = token(32);
  sessions.set(id, {
    id,
    csrfToken: token(24),
    createdAt: Date.now(),
    lastValidatedAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS,
    user: {
      id: String(user.id),
      username: String(user.username ?? ''),
      globalName: user.global_name ? String(user.global_name) : null,
      avatar: user.avatar ? String(user.avatar) : null
    },
    guildMember: {
      id: member.id,
      displayName: member.displayName
    },
    operator
  });
  prune();

  setSessionCookie(res, id, Math.floor(SESSION_TTL_MS / 1000));
  res.writeHead(302, noStoreHeaders({ location: pending.returnTo }));
  res.end();
}

export function logoutDiscord(req, res) {
  const id = sessionIdFromRequest(req);
  if (id) sessions.delete(id);
  clearSessionCookie(res);
  res.writeHead(302, noStoreHeaders({ location: '/' }));
  res.end();
}
