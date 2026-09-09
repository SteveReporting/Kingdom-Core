import { randomBytes } from 'node:crypto';
import { PermissionFlagsBits } from 'discord.js';

const oauthStates = new Map();
const sessions = new Map();
const SESSION_COOKIE = 'kingdom_nexus_session';
const STATE_TTL_MS = 10 * 60_000;
const SESSION_TTL_MS = 8 * 60 * 60_000;

function token(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

function publicUrl() {
  return String(process.env.KINGDOM_NEXUS_PUBLIC_URL ?? '').trim().replace(/\/$/, '');
}

export function discordOAuthConfigured() {
  return Boolean(String(process.env.CLIENT_ID ?? '').trim() && String(process.env.DISCORD_OAUTH_CLIENT_SECRET ?? '').trim() && publicUrl());
}

function callbackUrl() {
  return `${publicUrl()}/auth/discord/callback`;
}

function secureCookie() {
  return publicUrl().startsWith('https://');
}

function parseCookies(req) {
  const raw = String(req.headers.cookie ?? '');
  const out = {};
  for (const part of raw.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

function setSessionCookie(res, value, maxAgeSeconds) {
  const secure = secureCookie() ? '; Secure' : '';
  res.setHeader('set-cookie', `${SESSION_COOKIE}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}${secure}`);
}

function clearSessionCookie(res) {
  const secure = secureCookie() ? '; Secure' : '';
  res.setHeader('set-cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`);
}

function prune() {
  const now = Date.now();
  for (const [key, record] of oauthStates) if (record.expiresAt <= now) oauthStates.delete(key);
  for (const [key, record] of sessions) if (record.expiresAt <= now) sessions.delete(key);
}

export function getNexusSession(req) {
  prune();
  const id = parseCookies(req)[SESSION_COOKIE];
  if (!id) return null;
  const session = sessions.get(id);
  if (!session || session.expiresAt <= Date.now()) {
    if (id) sessions.delete(id);
    return null;
  }
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

export function startDiscordOAuth(req, res, url) {
  if (!discordOAuthConfigured()) {
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Discord login is not configured for Kingdom Nexus.');
    return;
  }
  prune();
  const state = token(24);
  const requested = String(url.searchParams.get('return') ?? '/?view=nexus');
  const returnTo = requested.startsWith('/') && !requested.startsWith('//') ? requested.slice(0, 500) : '/?view=nexus';
  oauthStates.set(state, { createdAt: Date.now(), expiresAt: Date.now() + STATE_TTL_MS, returnTo });
  const params = new URLSearchParams({
    client_id: String(process.env.CLIENT_ID).trim(),
    response_type: 'code',
    redirect_uri: callbackUrl(),
    scope: 'identify',
    state,
    prompt: 'none'
  });
  res.writeHead(302, { location: `https://discord.com/oauth2/authorize?${params.toString()}`, 'cache-control': 'no-store' });
  res.end();
}

export async function completeDiscordOAuth(req, res, url, guild) {
  if (!discordOAuthConfigured()) {
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Discord login is not configured for Kingdom Nexus.');
    return;
  }
  prune();
  const state = String(url.searchParams.get('state') ?? '');
  const code = String(url.searchParams.get('code') ?? '');
  const pending = oauthStates.get(state);
  oauthStates.delete(state);
  if (!state || !code || !pending || pending.expiresAt <= Date.now()) {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
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
  const userResponse = await fetch('https://discord.com/api/users/@me', {
    headers: { authorization: `Bearer ${tokens.access_token}` }
  });
  if (!userResponse.ok) throw new Error(`Discord user lookup failed with HTTP ${userResponse.status}`);
  const user = await userResponse.json();

  const member = guild ? await guild.members.fetch(user.id).catch(() => null) : null;
  if (!member) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Your Discord account is not a member of this Kingdom guild.');
    return;
  }

  const operator = member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageGuild);
  const id = token(32);
  sessions.set(id, {
    id,
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS,
    user: {
      id: String(user.id),
      username: String(user.username ?? ''),
      globalName: user.global_name ? String(user.global_name) : null,
      avatar: user.avatar ? String(user.avatar) : null
    },
    guildMember: {
      id: member.id,
      displayName: member.displayName,
      roleIds: [...member.roles.cache.keys()].slice(0, 100)
    },
    operator
  });
  setSessionCookie(res, id, Math.floor(SESSION_TTL_MS / 1000));
  res.writeHead(302, { location: pending.returnTo, 'cache-control': 'no-store' });
  res.end();
}

export function logoutDiscord(req, res) {
  const id = parseCookies(req)[SESSION_COOKIE];
  if (id) sessions.delete(id);
  clearSessionCookie(res);
  res.writeHead(302, { location: '/?view=nexus', 'cache-control': 'no-store' });
  res.end();
}
