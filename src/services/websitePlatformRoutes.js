import {
  closeWebsiteSupportTicket,
  createWebsiteSupportTicket,
  getWebsiteCarrySession,
  getWebsiteSupportTicket,
  joinWebsiteCarrySession,
  leaveWebsiteCarrySession,
  listWebsiteJoinableCarries,
  listWebsiteSupportTickets,
  normaliseRealtimeBridgeError,
  readWebsiteConversation,
  sendWebsiteConversationMessage
} from './websiteRealtimeBridge.js';

function route(status, body) {
  return { handled: true, status, body };
}

function decoded(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

export async function handleWebsitePlatformRoute(guild, req, url, { userId, readJsonBody }) {
  const pathname = url.pathname;

  // /api/carries/request belongs to the original website carry-request bridge in
  // platformApiV4. Do not interpret the literal word "request" as a carry ID.
  if (pathname === '/api/carries/request') return null;

  const relevant = pathname.startsWith('/api/tickets')
    || pathname === '/api/carries/joinable'
    || /^\/api\/carries\/[^/]+(?:\/(?:join|leave|messages))?$/.test(pathname);
  if (!relevant) return null;
  if (!userId) return route(401, { error: 'missing_user', message: 'Sign in with Discord first.' });

  try {
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

    if (pathname === '/api/carries/joinable' && req.method === 'GET') {
      return route(200, await listWebsiteJoinableCarries(guild, userId));
    }

    const carryMatch = pathname.match(/^\/api\/carries\/([^/]+)(?:\/(join|leave|messages))?$/);
    if (carryMatch) {
      const id = decoded(carryMatch[1]);
      const action = carryMatch[2] ?? '';
      if (!action && req.method === 'GET') return route(200, { session: await getWebsiteCarrySession(guild, userId, id) });
      if (action === 'join' && req.method === 'POST') return route(200, { ok: true, session: await joinWebsiteCarrySession(guild, userId, id) });
      if (action === 'leave' && req.method === 'POST') return route(200, await leaveWebsiteCarrySession(guild, userId, id));
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
    const normalised = normaliseRealtimeBridgeError(error);
    return route(normalised.status, normalised.body);
  }
}
