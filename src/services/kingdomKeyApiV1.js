import { mutateGuildState, readGuildState } from '../storage/store.js';
import { appendKingdomLedger, ensureEcosystemState } from './ecosystemV1.js';
import { refreshCarryPanels } from './carryTickets.js';
import {
  ensureKingdomKeyState,
  getRoleMappings,
  getWebsiteSettings,
  isGuildOwner,
  kingdomKeyRegistry,
  kingdomKeySession,
  listConfigurableGuildRoles,
  memberCan,
  setRoleMapping,
  updateWebsiteSettings
} from './kingdomKeyV1.js';

const ACTIVE_CARRY = new Set(['open', 'claimed', 'ready', 'running']);

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
  return { userId, member, owner: isGuildOwner(member) };
}

function requireCapability(member, state, capability) {
  if (!memberCan(member, state, capability)) throw apiError('forbidden', `Missing capability: ${capability}`, 403);
}

function requireOwner(member) {
  if (!isGuildOwner(member)) throw apiError('owner_required', 'Only the actual Discord guild owner can perform this action.', 403);
}

function safeTreasuryItem(input, actorId) {
  const name = clean(input?.name, 160);
  if (!name) throw apiError('invalid_item', 'Treasury item name is required.');
  const quantity = Math.max(1, Math.min(9999, Math.floor(Number(input?.quantity ?? 1) || 1)));
  return {
    id: `IT-${Date.now().toString(36).toUpperCase()}`,
    name,
    quantity,
    available: quantity,
    notes: clean(input?.notes, 500) || null,
    addedBy: actorId,
    createdAt: new Date().toISOString()
  };
}

async function mutateCarry(guild, state, actorInfo, carryId, action) {
  let result = null;
  let conflict = null;
  await mutateGuildState(guild.id, async (fresh) => {
    ensureEcosystemState(fresh);
    ensureKingdomKeyState(fresh);
    const ticket = fresh.carryTickets?.[carryId];
    if (!ticket) { conflict = apiError('carry_not_found', 'Carry mission not found.', 404); return; }
    const manageAll = memberCan(actorInfo.member, fresh, 'carry.manage');
    const assigned = ticket.carrierId === actorInfo.userId;
    const now = new Date().toISOString();

    if (action === 'claim') {
      requireCapability(actorInfo.member, fresh, 'carry.claim');
      if (ticket.status !== 'open') { conflict = apiError('mission_already_claimed', 'This carry is no longer open.', 409); return; }
      ticket.status = 'claimed';
      ticket.carrierId = actorInfo.userId;
      ticket.claimedAt = now;
    } else if (action === 'start') {
      requireCapability(actorInfo.member, fresh, 'carry.start');
      if (!assigned && !manageAll) { conflict = apiError('not_assigned', 'Only the assigned carrier or a carry manager can start this mission.', 403); return; }
      if (!['claimed', 'ready', 'running'].includes(ticket.status)) { conflict = apiError('invalid_carry_state', 'This carry cannot be started from its current state.', 409); return; }
      ticket.status = 'running';
      ticket.startedAt ??= now;
    } else if (action === 'return') {
      requireCapability(actorInfo.member, fresh, 'carry.return');
      if (!assigned && !manageAll) { conflict = apiError('not_assigned', 'Only the assigned carrier or a carry manager can return this mission.', 403); return; }
      if (!['claimed', 'ready', 'running'].includes(ticket.status)) { conflict = apiError('invalid_carry_state', 'This carry cannot be returned from its current state.', 409); return; }
      ticket.status = 'open';
      ticket.carrierId = null;
      ticket.claimedAt = null;
      ticket.returnedAt = now;
    } else if (action === 'complete') {
      requireCapability(actorInfo.member, fresh, 'carry.complete');
      if (!assigned && !manageAll) { conflict = apiError('not_assigned', 'Only the assigned carrier or a carry manager can complete this mission.', 403); return; }
      if (!['claimed', 'ready', 'running'].includes(ticket.status)) { conflict = apiError('invalid_carry_state', 'This carry cannot be completed from its current state.', 409); return; }
      ticket.status = 'completed';
      ticket.completedAt = now;
      ticket.completedBy = actorInfo.userId;
      fresh.stats ??= {};
      fresh.stats.completedCarries = (fresh.stats.completedCarries ?? 0) + 1;
    } else {
      conflict = apiError('invalid_action', 'Unsupported carry action.');
      return;
    }

    ticket.websiteActionAt = now;
    appendKingdomLedger(fresh, `carry.website_${action}`, actorInfo.userId, ticket.id, {
      status: ticket.status,
      carrierId: ticket.carrierId ?? null,
      dungeon: ticket.dungeon ?? null
    });
    result = structuredClone(ticket);
    await refreshCarryPanels(guild, fresh).catch(() => null);
  });
  if (conflict) throw conflict;
  if (!result) throw apiError('carry_update_failed', 'Carry state changed before the action completed.', 409);
  return result;
}

export async function handleKingdomKeyApi(guild, req, url, helpers) {
  if (!url.pathname.startsWith('/api/ecosystem/')) return false;
  const { json, readJsonBody, requestUserId } = helpers;

  try {
    const state = await readGuildState(guild.id);
    ensureEcosystemState(state);
    ensureKingdomKeyState(state);

    if (url.pathname === '/api/ecosystem/key/registry' && req.method === 'GET') {
      const a = await actor(guild, requestUserId, state);
      return json(200, { ...kingdomKeyRegistry(), session: kingdomKeySession(guild, state, a.member) });
    }

    if (url.pathname === '/api/ecosystem/key/session' && req.method === 'GET') {
      const a = await actor(guild, requestUserId, state);
      return json(200, kingdomKeySession(guild, state, a.member));
    }

    if (url.pathname === '/api/ecosystem/key/roles' && req.method === 'GET') {
      const a = await actor(guild, requestUserId, state);
      requireOwner(a.member);
      return json(200, { roles: listConfigurableGuildRoles(guild), mappings: getRoleMappings(state) });
    }

    if (url.pathname === '/api/ecosystem/key/mappings' && req.method === 'GET') {
      const a = await actor(guild, requestUserId, state);
      requireOwner(a.member);
      return json(200, { mappings: getRoleMappings(state), registry: kingdomKeyRegistry() });
    }

    const mappingRoleId = pathId(url.pathname, /^\/api\/ecosystem\/key\/mappings\/([^/]+)$/);
    if (mappingRoleId && ['PUT', 'POST'].includes(req.method)) {
      const a = await actor(guild, requestUserId, state);
      requireOwner(a.member);
      const role = guild.roles.cache.get(mappingRoleId);
      if (!role || role.id === guild.id || role.managed) throw apiError('invalid_role', 'That Discord role cannot be configured.', 400);
      const body = await readJsonBody();
      let mapping;
      await mutateGuildState(guild.id, async (fresh) => {
        ensureKingdomKeyState(fresh);
        mapping = setRoleMapping(fresh, a.userId, role.id, body.capabilities, role);
      });
      return json(200, mapping);
    }

    if (url.pathname === '/api/ecosystem/key/website' && req.method === 'GET') {
      const a = await actor(guild, requestUserId, state);
      requireOwner(a.member);
      return json(200, { settings: getWebsiteSettings(state) });
    }

    if (url.pathname === '/api/ecosystem/key/website' && ['PATCH', 'POST'].includes(req.method)) {
      const a = await actor(guild, requestUserId, state);
      requireOwner(a.member);
      const body = await readJsonBody();
      let settings;
      await mutateGuildState(guild.id, async (fresh) => { settings = updateWebsiteSettings(fresh, a.userId, body); });
      return json(200, { settings });
    }

    const carryAction = url.pathname.match(/^\/api\/ecosystem\/carries\/([^/]+)\/(claim|start|return|complete)$/);
    if (carryAction && req.method === 'POST') {
      const a = await actor(guild, requestUserId, state);
      return json(200, await mutateCarry(guild, state, a, decodeURIComponent(carryAction[1]), carryAction[2]));
    }

    if (url.pathname === '/api/ecosystem/treasury/items' && req.method === 'POST') {
      const a = await actor(guild, requestUserId, state);
      requireCapability(a.member, state, 'treasury.manage_inventory');
      const body = await readJsonBody();
      const item = safeTreasuryItem(body, a.userId);
      await mutateGuildState(guild.id, async (fresh) => {
        ensureEcosystemState(fresh);
        fresh.treasuryV4.items[item.id] = item;
        fresh.treasuryV4.history.push({ type: 'item-added', itemId: item.id, at: item.createdAt, actorId: a.userId });
        appendKingdomLedger(fresh, 'treasury.website_item_added', a.userId, item.id, { name: item.name, quantity: item.quantity });
      });
      return json(201, item);
    }

    if (url.pathname === '/api/ecosystem/treasury/loans' && req.method === 'POST') {
      const a = await actor(guild, requestUserId, state);
      requireCapability(a.member, state, 'treasury.manage_loans');
      const body = await readJsonBody();
      const itemId = clean(body.itemId, 100);
      const borrowerId = clean(body.borrowerId, 40).replace(/\D/g, '');
      const due = clean(body.due, 64);
      if (!itemId || !borrowerId || !due) throw apiError('invalid_loan', 'Item, borrower and due date are required.');
      let loan;
      await mutateGuildState(guild.id, async (fresh) => {
        ensureEcosystemState(fresh);
        const item = fresh.treasuryV4.items[itemId];
        if (!item) throw apiError('item_not_found', 'Treasury item not found.', 404);
        if ((item.available ?? 0) < 1) throw apiError('item_unavailable', 'No available quantity remains for this item.', 409);
        const id = `LN-${Date.now().toString(36).toUpperCase()}`;
        item.available = Math.max(0, Number(item.available ?? 0) - 1);
        loan = { id, itemId, borrowerId, due, status: 'loaned', createdAt: new Date().toISOString(), createdBy: a.userId };
        fresh.treasuryV4.loans[id] = loan;
        fresh.treasuryV4.history.push({ type: 'loan-created', loanId: id, itemId, borrowerId, at: loan.createdAt, actorId: a.userId });
        appendKingdomLedger(fresh, 'treasury.website_loan_created', a.userId, id, { itemId, borrowerId, due });
      });
      return json(201, loan);
    }

    const returnLoanId = pathId(url.pathname, /^\/api\/ecosystem\/treasury\/loans\/([^/]+)\/return$/);
    if (returnLoanId && req.method === 'POST') {
      const a = await actor(guild, requestUserId, state);
      requireCapability(a.member, state, 'treasury.manage_loans');
      let loan;
      await mutateGuildState(guild.id, async (fresh) => {
        ensureEcosystemState(fresh);
        const current = fresh.treasuryV4.loans[returnLoanId];
        if (!current) throw apiError('loan_not_found', 'Treasury loan not found.', 404);
        if (current.status === 'returned') throw apiError('loan_already_returned', 'This loan has already been returned.', 409);
        current.status = 'returned';
        current.returnedAt = new Date().toISOString();
        current.returnedBy = a.userId;
        const item = fresh.treasuryV4.items[current.itemId];
        if (item) item.available = Math.min(Number(item.quantity ?? item.available ?? 1), Number(item.available ?? 0) + 1);
        fresh.treasuryV4.history.push({ type: 'loan-returned', loanId: current.id, itemId: current.itemId, at: current.returnedAt, actorId: a.userId });
        appendKingdomLedger(fresh, 'treasury.website_loan_returned', a.userId, current.id, { itemId: current.itemId });
        loan = structuredClone(current);
      });
      return json(200, loan);
    }

    const requestDecisionId = pathId(url.pathname, /^\/api\/ecosystem\/treasury\/requests\/([^/]+)\/decision$/);
    if (requestDecisionId && req.method === 'POST') {
      const a = await actor(guild, requestUserId, state);
      requireCapability(a.member, state, 'treasury.approve');
      const body = await readJsonBody();
      const decision = clean(body.decision, 20).toLowerCase();
      if (!['approved', 'rejected'].includes(decision)) throw apiError('invalid_decision', 'Decision must be approved or rejected.');
      let record;
      await mutateGuildState(guild.id, async (fresh) => {
        ensureEcosystemState(fresh);
        const current = fresh.treasuryV4.requests[requestDecisionId];
        if (!current) throw apiError('request_not_found', 'Treasury request not found.', 404);
        if (!['pending', 'open', 'requested'].includes(String(current.status ?? 'pending'))) throw apiError('request_already_decided', 'This request is already decided.', 409);
        current.status = decision;
        current.reviewedAt = new Date().toISOString();
        current.reviewedBy = a.userId;
        current.reviewNote = clean(body.note, 500) || null;
        appendKingdomLedger(fresh, 'treasury.website_request_decided', a.userId, requestDecisionId, { decision, itemId: current.itemId ?? null });
        record = structuredClone(current);
      });
      return json(200, record);
    }

    return false;
  } catch (error) {
    return json(Number(error?.status) || 500, {
      error: error?.code || 'internal_error',
      message: Number(error?.status) ? String(error.message || error) : 'Kingdom Core could not complete that request.'
    });
  }
}
