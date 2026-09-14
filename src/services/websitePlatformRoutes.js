import {
  closeWebsiteSupportTicket,
  createWebsiteSupportTicket,
  getWebsiteSupportTicket,
  listWebsiteSupportTickets,
  readWebsiteConversation,
  sendWebsiteConversationMessage
} from './websiteRealtimeBridge.js';
import {
  createUnifiedWebsiteCarry,
  getUnifiedCarry,
  joinUnifiedCarry,
  leaveUnifiedCarry,
  listUnifiedJoinableCarries,
  normaliseUnifiedCarryError
} from './unifiedCarryBridge.js';
import {
  getUnifiedCarryEta,
  getUnifiedCarryTimeline
} from './unifiedCarryEcosystem.js';

function route(status, body) {
  return { handled: true, status, body };
}

function decoded(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

export async function handleWebsitePlatformRoute(guild, req, url, { userId, readJsonBody }) {
  const pathname = url.pathname;

  const etaMatch = pathname.match(/^\/api\/ecosystem\/carries\/([^/]+)\/eta$/);
  if (etaMatch) {
    if (req.method !== 'GET') return route(405, { error: 'method_not_allowed', message: 'That ETA action only supports GET.' });
    try {
      return route(200, await getUnifiedCarryEta(guild, decoded(etaMatch[1])));
    } catch (error) {
      const normalised = normaliseUnifiedCarryError(error);
      return route(normalised.status, normalised.body);
    }
  }

  const timelineMatch = pathname.match(/^\/api\/ecosystem\/carries\/([^/]+)\/timeline$/);
  const relevant = Boolean(timelineMatch)
    || pathname.startsWith('/api/tickets')
    || pathname === '/api/carries/request'
    || pathname === '/api/carries/joinable'
    || (pathname !== '/api/carries/mine' && /^\/api\/carries\/[^/]+(?:\/(?:join|leave|messages))?$/.test(pathname));
  if (!relevant) return null;
  if (!userId) return route(401, { error: 'missing_user', message: 'Sign in with Discord first.' });

  try {
    if (timelineMatch) {
      if (req.method !== 'GET') return route(405, { error: 'method_not_allowed', message: 'That timeline action only supports GET.' });
      return route(200, await getUnifiedCarryTimeline(guild, userId, decoded(timelineMatch[1])));
    }

    if (pathname === '/api/tickets/mine' && req.method === 'GET') {
      return route(200, { tickets: await listWebsiteSupportTickets(guild, userId) });
    }
    if (pathname === '/api/tickets/request' && req.method === 'POST') {
      const body = await readJsonBody(req);
      return route(201, { ok: true, ticket: await createWebsiteSupportTicket(guild, userId, body) });
    }

    const ticketMatch = pathname.match(/^\/api\/tickets\/([^/]+)(?:\/(messages|close))?$/);
    if (ticketMatch) {
      const id = decoded(ticketMatch[1]);
      const action = ticketMatch[2] ?? '';
      if (!action && req.method === 'GET') return route(200, { ticket: await getWebsiteSupportTicket(guild, userId, id) });
      if (action === 'messages' && req.method === 'GET') {
        return route(200, await readWebsiteConversation(guild, userId, 'ticket', id, {
          after: url.searchParams.get('after'),
          limit: url.searchParams.get('limit')
        }));
      }
      if (action === 'messages' && req.method === 'POST') {
        const body = await readJsonBody(req);
        return route(201, { message: await sendWebsiteConversationMessage(guild, userId, 'ticket', id, body) });
      }
      if (action === 'close' && req.method === 'POST') return route(200, { ok: true, ticket: await closeWebsiteSupportTicket(guild, userId, id) });
      return route(405, { error: 'method_not_allowed', message: 'That ticket action does not support this request method.' });
    }

    if (pathname === '/api/carries/request' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const ticket = await createUnifiedWebsiteCarry(guild, userId, body);
      return route(201, { ok: true, guildId: guild.id, ticket });
    }

    if (pathname === '/api/carries/joinable' && req.method === 'GET') {
      return route(200, await listUnifiedJoinableCarries(guild, userId));
    }

    const carryMatch = pathname === '/api/carries/mine'
      ? null
      : pathname.match(/^\/api\/carries\/([^/]+)(?:\/(join|leave|messages))?$/);
    if (carryMatch) {
      const id = decoded(carryMatch[1]);
      const action = carryMatch[2] ?? '';
      if (!action && req.method === 'GET') return route(200, { session: await getUnifiedCarry(guild, userId, id) });
      if (action === 'join' && req.method === 'POST') return route(200, { ok: true, session: await joinUnifiedCarry(guild, userId, id) });
      if (action === 'leave' && req.method === 'POST') return route(200, await leaveUnifiedCarry(guild, userId, id));
      if (action === 'messages' && req.method === 'GET') {
        return route(200, await readWebsiteConversation(guild, userId, 'carry', id, {
          after: url.searchParams.get('after'),
          limit: url.searchParams.get('limit')
        }));
      }
      if (action === 'messages' && req.method === 'POST') {
        const body = await readJsonBody(req);
        return route(201, { message: await sendWebsiteConversationMessage(guild, userId, 'carry', id, body) });
      }
      return route(405, { error: 'method_not_allowed', message: 'That carry action does not support this request method.' });
    }

    return null;
  } catch (error) {
    const normalised = normaliseUnifiedCarryError(error);
    return route(normalised.status, normalised.body);
  }
}
