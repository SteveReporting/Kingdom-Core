import { mutateGuildState, readGuildState } from '../storage/store.js';
import {
  allSmartCarryEtas,
  appendKingdomLedger,
  capabilitiesForMember,
  captureKingdomTimeMachine,
  claimReferralCode,
  closeExchangeOffer,
  closeKingdomContract,
  closeMarketplaceListing,
  compareKingdomTimeMachine,
  computeKingdomDecisions,
  createExchangeOffer,
  createFactoryProduct,
  createGatewayLink,
  createKingdomContract,
  createStudioSurface,
  ensureCarryTimeline,
  ensureEcosystemState,
  getEcosystemMemberPortal,
  getIntelligenceContext,
  getKingdomNotifications,
  getKingdomOs,
  getKingdomVault,
  isEcosystemStaff,
  kingdomTrust,
  markKingdomNotificationRead,
  memberCan,
  referralCodeFor,
  resolveGatewayLink,
  runKingdomLab,
  searchKingdom,
  setExtensionEnabled,
  signKingdomContract,
  smartCarryEta
} from './ecosystemV1.js';

function apiError(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status });
}

function clean(value, max = 240) {
  return typeof value === 'string' ? value.trim().slice(0, max) : String(value ?? '').trim().slice(0, max);
}

function pathId(pathname, pattern) {
  const match = pathname.match(pattern);
  return match ? decodeURIComponent(match[1]) : null;
}

async function actor(guild, requestUserId, state) {
  const userId = requestUserId();
  if (!userId) throw apiError('missing_user', 'Sign in with Discord first.', 401);
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) throw apiError('not_guild_member', 'Join the Kingdom Carries Discord first.', 403);
  return { userId, member, capabilities: capabilitiesForMember(member, state) };
}

function requireCapability(member, state, capability) {
  if (!memberCan(member, state, capability)) throw apiError('forbidden', `Missing capability: ${capability}`, 403);
}

function asPortalError(error) {
  return {
    status: Number(error?.status) || 500,
    body: {
      error: error?.code || 'internal_error',
      message: Number(error?.status) ? String(error.message || error) : 'Kingdom Core could not complete that request.'
    }
  };
}

export async function handleEcosystemApi(guild, req, url, helpers) {
  if (!url.pathname.startsWith('/api/ecosystem/')) return false;
  const { json, readJsonBody, requestUserId } = helpers;
  const state = await readGuildState(guild.id);
  ensureEcosystemState(state);

  try {
    if (url.pathname === '/api/ecosystem/os' && req.method === 'GET') {
      return json(200, getKingdomOs(state));
    }

    if (url.pathname === '/api/ecosystem/etas' && req.method === 'GET') {
      return json(200, { etas: allSmartCarryEtas(state), updatedAt: new Date().toISOString() });
    }

    const carryEtaId = pathId(url.pathname, /^\/api\/ecosystem\/carries\/([^/]+)\/eta$/);
    if (carryEtaId && req.method === 'GET') {
      const ticket = state.carryTickets?.[carryEtaId];
      if (!ticket) throw apiError('carry_not_found', 'Carry mission not found.', 404);
      return json(200, smartCarryEta(state, ticket));
    }

    const carryTimelineId = pathId(url.pathname, /^\/api\/ecosystem\/carries\/([^/]+)\/timeline$/);
    if (carryTimelineId && req.method === 'GET') {
      const a = await actor(guild, requestUserId, state);
      const ticket = state.carryTickets?.[carryTimelineId];
      if (!ticket) throw apiError('carry_not_found', 'Carry mission not found.', 404);
      const owns = ticket.userId === a.userId || (ticket.members ?? []).includes(a.userId) || ticket.carrierId === a.userId;
      if (!owns && !isEcosystemStaff(a.member, state)) throw apiError('forbidden', 'That carry timeline is private.', 403);
      return json(200, { carryId: ticket.id, timeline: ensureCarryTimeline(ticket), status: ticket.status });
    }

    if (url.pathname === '/api/ecosystem/member' && req.method === 'GET') {
      const a = await actor(guild, requestUserId, state);
      return json(200, await getEcosystemMemberPortal(guild, a.userId));
    }

    if (url.pathname === '/api/ecosystem/notifications' && req.method === 'GET') {
      const a = await actor(guild, requestUserId, state);
      const unreadOnly = url.searchParams.get('unread') === '1';
      return json(200, { notifications: getKingdomNotifications(state, a.userId, { unreadOnly, limit: 100 }) });
    }

    if (url.pathname === '/api/ecosystem/notifications/read' && req.method === 'POST') {
      const a = await actor(guild, requestUserId, state);
      const body = await readJsonBody();
      let changed = 0;
      await mutateGuildState(guild.id, async (fresh) => {
        ensureEcosystemState(fresh);
        changed = markKingdomNotificationRead(fresh, a.userId, clean(body.id, 100) || null);
      });
      return json(200, { ok: true, changed });
    }

    if (url.pathname === '/api/ecosystem/referrals/code' && req.method === 'GET') {
      const a = await actor(guild, requestUserId, state);
      let code;
      await mutateGuildState(guild.id, async (fresh) => { code = referralCodeFor(fresh, a.userId); });
      return json(200, code);
    }

    if (url.pathname === '/api/ecosystem/referrals/claim' && req.method === 'POST') {
      const a = await actor(guild, requestUserId, state);
      const body = await readJsonBody();
      return json(201, await claimReferralCode(guild, a.userId, body.code));
    }

    const listingCloseId = pathId(url.pathname, /^\/api\/ecosystem\/marketplace\/([^/]+)\/close$/);
    if (listingCloseId && req.method === 'POST') {
      const a = await actor(guild, requestUserId, state);
      const body = await readJsonBody();
      return json(200, await closeMarketplaceListing(guild, a.userId, listingCloseId, body.status || 'closed'));
    }

    if (url.pathname === '/api/ecosystem/search' && req.method === 'GET') {
      const a = await actor(guild, requestUserId, state);
      const results = searchKingdom(state, url.searchParams.get('q') ?? '', { limit: 30 });
      const visible = isEcosystemStaff(a.member, state)
        ? results
        : results.filter((row) => row.type !== 'identity' || row.meta?.kingdomId === state.identities?.[a.userId]?.kingdomId);
      return json(200, { results: visible });
    }

    if (url.pathname === '/api/ecosystem/trust' && req.method === 'GET') {
      const a = await actor(guild, requestUserId, state);
      return json(200, kingdomTrust(state, a.userId));
    }

    if (url.pathname === '/api/ecosystem/contracts' && req.method === 'GET') {
      const a = await actor(guild, requestUserId, state);
      const contracts = Object.values(state.ecosystemV1?.contracts ?? {}).filter((x) => x.parties?.includes(a.userId) || isEcosystemStaff(a.member, state));
      return json(200, { contracts });
    }

    if (url.pathname === '/api/ecosystem/contracts' && req.method === 'POST') {
      const a = await actor(guild, requestUserId, state);
      requireCapability(a.member, state, 'contract.manage');
      const body = await readJsonBody();
      let contract;
      await mutateGuildState(guild.id, async (fresh) => { contract = createKingdomContract(fresh, a.userId, body); });
      return json(201, contract);
    }

    const contractSignId = pathId(url.pathname, /^\/api\/ecosystem\/contracts\/([^/]+)\/sign$/);
    if (contractSignId && req.method === 'POST') {
      const a = await actor(guild, requestUserId, state);
      let contract;
      await mutateGuildState(guild.id, async (fresh) => { contract = signKingdomContract(fresh, a.userId, contractSignId); });
      return json(200, contract);
    }

    const contractCloseId = pathId(url.pathname, /^\/api\/ecosystem\/contracts\/([^/]+)\/close$/);
    if (contractCloseId && req.method === 'POST') {
      const a = await actor(guild, requestUserId, state);
      requireCapability(a.member, state, 'contract.manage');
      const body = await readJsonBody();
      let contract;
      await mutateGuildState(guild.id, async (fresh) => { contract = closeKingdomContract(fresh, a.userId, contractCloseId, clean(body.status, 30) || 'completed'); });
      return json(200, contract);
    }

    if (url.pathname === '/api/ecosystem/exchange' && req.method === 'GET') {
      await actor(guild, requestUserId, state);
      const offers = Object.values(state.ecosystemV1?.exchange?.offers ?? {}).filter((x) => x.status === 'active').slice(-200).reverse();
      return json(200, { offers });
    }

    if (url.pathname === '/api/ecosystem/exchange' && req.method === 'POST') {
      const a = await actor(guild, requestUserId, state);
      const body = await readJsonBody();
      let offer;
      await mutateGuildState(guild.id, async (fresh) => { offer = createExchangeOffer(fresh, a.userId, body); });
      return json(201, offer);
    }

    const exchangeCloseId = pathId(url.pathname, /^\/api\/ecosystem\/exchange\/([^/]+)\/close$/);
    if (exchangeCloseId && req.method === 'POST') {
      const a = await actor(guild, requestUserId, state);
      const body = await readJsonBody();
      let offer;
      await mutateGuildState(guild.id, async (fresh) => { offer = closeExchangeOffer(fresh, a.userId, exchangeCloseId, clean(body.status, 30) || 'closed'); });
      return json(200, offer);
    }

    if (url.pathname === '/api/ecosystem/vault' && req.method === 'GET') {
      await actor(guild, requestUserId, state);
      return json(200, getKingdomVault(state));
    }

    const gatewaySlug = pathId(url.pathname, /^\/api\/ecosystem\/gateway\/([^/]+)$/);
    if (gatewaySlug && req.method === 'GET') {
      let record;
      await mutateGuildState(guild.id, async (fresh) => { record = resolveGatewayLink(fresh, gatewaySlug); });
      if (!record) throw apiError('gateway_not_found', 'Gateway link not found.', 404);
      return json(200, record);
    }

    if (url.pathname === '/api/ecosystem/gateway' && req.method === 'POST') {
      const a = await actor(guild, requestUserId, state);
      requireCapability(a.member, state, 'gateway.manage');
      const body = await readJsonBody();
      let record;
      await mutateGuildState(guild.id, async (fresh) => { record = createGatewayLink(fresh, a.userId, body); });
      return json(201, record);
    }

    if (url.pathname === '/api/ecosystem/intelligence-context' && req.method === 'GET') {
      const a = await actor(guild, requestUserId, state);
      requireCapability(a.member, state, 'decision.read');
      return json(200, getIntelligenceContext(guild, state, a.userId));
    }

    if (url.pathname === '/api/ecosystem/decisions' && req.method === 'GET') {
      const a = await actor(guild, requestUserId, state);
      requireCapability(a.member, state, 'decision.read');
      return json(200, { recommendations: computeKingdomDecisions(state) });
    }

    if (url.pathname === '/api/ecosystem/ledger' && req.method === 'GET') {
      const a = await actor(guild, requestUserId, state);
      requireCapability(a.member, state, 'ledger.read');
      const limit = Math.max(1, Math.min(250, Number(url.searchParams.get('limit') ?? 100)));
      return json(200, { anchorHash: state.ecosystemV1.ledger.anchorHash, sequence: state.ecosystemV1.ledger.sequence, entries: state.ecosystemV1.ledger.entries.slice(-limit).reverse() });
    }

    if (url.pathname === '/api/ecosystem/relay' && req.method === 'GET') {
      const a = await actor(guild, requestUserId, state);
      requireCapability(a.member, state, 'relay.read');
      const limit = Math.max(1, Math.min(250, Number(url.searchParams.get('limit') ?? 100)));
      return json(200, { sequence: state.ecosystemV1.relay.sequence, events: state.ecosystemV1.relay.events.slice(-limit).reverse() });
    }

    if (url.pathname === '/api/ecosystem/timemachine/snapshots' && req.method === 'GET') {
      const a = await actor(guild, requestUserId, state);
      requireCapability(a.member, state, 'timemachine.capture');
      const snapshots = Object.values(state.ecosystemV1.timeMachine.snapshots).map(({ data: _data, ...meta }) => meta).sort((x, y) => new Date(y.createdAt) - new Date(x.createdAt));
      return json(200, { snapshots });
    }

    if (url.pathname === '/api/ecosystem/timemachine/snapshots' && req.method === 'POST') {
      const a = await actor(guild, requestUserId, state);
      requireCapability(a.member, state, 'timemachine.capture');
      const body = await readJsonBody();
      let snapshot;
      await mutateGuildState(guild.id, async (fresh) => { snapshot = captureKingdomTimeMachine(fresh, a.userId, body.label); });
      return json(201, snapshot);
    }

    if (url.pathname === '/api/ecosystem/timemachine/compare' && req.method === 'GET') {
      const a = await actor(guild, requestUserId, state);
      requireCapability(a.member, state, 'timemachine.capture');
      return json(200, compareKingdomTimeMachine(state, clean(url.searchParams.get('a'), 100), clean(url.searchParams.get('b'), 100)));
    }

    if (url.pathname === '/api/ecosystem/labs' && req.method === 'POST') {
      const a = await actor(guild, requestUserId, state);
      requireCapability(a.member, state, 'labs.run');
      const body = await readJsonBody();
      let run;
      await mutateGuildState(guild.id, async (fresh) => { run = runKingdomLab(fresh, a.userId, body); });
      return json(201, run);
    }

    if (url.pathname === '/api/ecosystem/studio/surfaces' && req.method === 'POST') {
      const a = await actor(guild, requestUserId, state);
      requireCapability(a.member, state, 'studio.manage');
      const body = await readJsonBody();
      let surface;
      await mutateGuildState(guild.id, async (fresh) => { surface = createStudioSurface(fresh, a.userId, body); });
      return json(201, surface);
    }

    if (url.pathname === '/api/ecosystem/factory/products' && req.method === 'POST') {
      const a = await actor(guild, requestUserId, state);
      requireCapability(a.member, state, 'factory.manage');
      const body = await readJsonBody();
      let product;
      await mutateGuildState(guild.id, async (fresh) => { product = createFactoryProduct(fresh, a.userId, body); });
      return json(201, product);
    }

    const extensionId = pathId(url.pathname, /^\/api\/ecosystem\/extensions\/([^/]+)$/);
    if (extensionId && req.method === 'POST') {
      const a = await actor(guild, requestUserId, state);
      requireCapability(a.member, state, 'extensions.manage');
      const body = await readJsonBody();
      let result;
      await mutateGuildState(guild.id, async (fresh) => { result = setExtensionEnabled(fresh, a.userId, extensionId, body.enabled !== false); });
      return json(200, result);
    }

    if (url.pathname === '/api/ecosystem/admin/ledger/append' && req.method === 'POST') {
      const a = await actor(guild, requestUserId, state);
      requireCapability(a.member, state, 'ledger.read');
      const body = await readJsonBody();
      let entry;
      await mutateGuildState(guild.id, async (fresh) => { entry = appendKingdomLedger(fresh, clean(body.type, 120) || 'manual.note', a.userId, clean(body.subjectId, 100) || null, body.payload ?? {}); });
      return json(201, entry);
    }

    return json(404, { error: 'not_found' });
  } catch (error) {
    const out = asPortalError(error);
    return json(out.status, out.body);
  }
}
