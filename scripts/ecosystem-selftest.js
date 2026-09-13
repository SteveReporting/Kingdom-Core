import assert from 'node:assert/strict';
import {
  appendKingdomLedger,
  captureKingdomTimeMachine,
  closeExchangeOffer,
  compareKingdomTimeMachine,
  computeKingdomDecisions,
  createExchangeOffer,
  createFactoryProduct,
  createGatewayLink,
  createKingdomContract,
  createStudioSurface,
  emitKingdomRelay,
  ensureCarryTimeline,
  ensureEcosystemState,
  ensureKingdomId,
  getKingdomIdCard,
  getKingdomNotifications,
  getKingdomOs,
  getKingdomVault,
  kingdomTrust,
  markKingdomNotificationRead,
  notifyKingdomUser,
  referralCodeFor,
  resolveGatewayLink,
  runKingdomLab,
  searchKingdom,
  setExtensionEnabled,
  signKingdomContract,
  smartCarryEta
} from '../src/services/ecosystemV1.js';

const now = Date.now();
const state = {
  setup: { roles: {} },
  platform: { schemaVersion: 10, release: '10.1-realm-intelligence' },
  kingdom: { stage: 'Kingdom', level: 6, xp: 120000 },
  identities: {
    '100': { userId: '100', kingdomXp: 500, prestige: 1, stats: { carriesReceived: 5, noShows: 0 }, website: { displayName: 'Alpha', roblox: { userId: '9001', username: 'AlphaRBX', verifiedAt: new Date(now - 86400000).toISOString() } } },
    '200': { userId: '200', kingdomXp: 200, stats: { carriesReceived: 1, noShows: 1 } }
  },
  carrierOps: { profiles: { '300': { userId: '300', status: 'available', completedRuns: 20, playersHelped: 50, serviceMinutes: 400 }, '301': { userId: '301', status: 'busy', completedRuns: 10, playersHelped: 20, serviceMinutes: 200 } } },
  carryTickets: {
    A: { id: 'A', userId: '100', dungeon: 'Abyssal Void', difficulty: 'Nightmare', mode: 'Hardcore', status: 'open', createdAt: new Date(now - 300000).toISOString() },
    B: { id: 'B', userId: '200', carrierId: '300', dungeon: 'Abyssal Void', difficulty: 'Nightmare', mode: 'Hardcore', status: 'completed', createdAt: new Date(now - 3600000).toISOString(), claimedAt: new Date(now - 3000000).toISOString(), startedAt: new Date(now - 1800000).toISOString(), completedAt: new Date(now - 1200000).toISOString() },
    C: { id: 'C', userId: '200', carrierId: '300', dungeon: 'Abyssal Void', difficulty: 'Nightmare', mode: 'Hardcore', status: 'completed', startedAt: new Date(now - 2600000).toISOString(), completedAt: new Date(now - 2000000).toISOString() },
    D: { id: 'D', userId: '200', carrierId: '300', dungeon: 'Abyssal Void', difficulty: 'Nightmare', mode: 'Hardcore', status: 'completed', startedAt: new Date(now - 3400000).toISOString(), completedAt: new Date(now - 2800000).toISOString() },
    E: { id: 'E', userId: '200', carrierId: '301', dungeon: 'Abyssal Void', difficulty: 'Nightmare', mode: 'Hardcore', status: 'completed', startedAt: new Date(now - 4200000).toISOString(), completedAt: new Date(now - 3600000).toISOString() },
    F: { id: 'F', userId: '200', carrierId: '301', dungeon: 'Abyssal Void', difficulty: 'Nightmare', mode: 'Hardcore', status: 'completed', startedAt: new Date(now - 5000000).toISOString(), completedAt: new Date(now - 4400000).toISOString() }
  },
  marketV4: { listings: { M1: { id: 'M1', sellerId: '100', item: 'Abyssal Blade', price: '4T', notes: 'Purple', status: 'active', createdAt: new Date(now - 1000).toISOString() } }, history: [] },
  treasuryV4: { items: { I1: { id: 'I1', name: 'Royal Staff', quantity: 2, available: 1, addedBy: '999' } }, loans: {}, requests: {}, history: [] },
  eventsV4: { events: { EV1: { id: 'EV1', title: 'Friday Carries', description: 'Community event', status: 'scheduled' } } },
  referralsV4: { referrals: {}, qualified: {} },
  tickets: {}
};

ensureEcosystemState(state);
assert.equal(state.ecosystemV1.version, 1);

const kid = ensureKingdomId(state, '100', { discordUsername: 'alpha' });
assert.ok(kid.startsWith('KID-'));
assert.equal(getKingdomIdCard(state, '100').providers.roblox.username, 'AlphaRBX');

const first = appendKingdomLedger(state, 'test.first', '100', 'A', { ok: true });
const second = appendKingdomLedger(state, 'test.second', '100', 'A', { ok: true });
assert.equal(second.previousHash, first.hash);
assert.notEqual(second.hash, first.hash);
assert.ok(emitKingdomRelay(state, 'test.relay', '100', { x: 1 }).sequence >= 1);

const notification = notifyKingdomUser(state, '100', { type: 'test', title: 'Hello', body: 'World' });
assert.equal(getKingdomNotifications(state, '100', { unreadOnly: true }).length, 1);
assert.equal(markKingdomNotificationRead(state, '100', notification.id), 1);
assert.equal(getKingdomNotifications(state, '100', { unreadOnly: true }).length, 0);

const eta = smartCarryEta(state, 'A');
assert.ok(eta.estimateMinutes >= 1);
assert.ok(eta.highMinutes >= eta.lowMinutes);
assert.ok(eta.confidence >= 20 && eta.confidence <= 95);

assert.ok(ensureCarryTimeline(state.carryTickets.B).some((x) => x.type === 'completed'));
const referral = referralCodeFor(state, '100');
assert.ok(referral.code.startsWith('K'));
assert.ok(referral.url.includes(referral.code));

assert.ok(searchKingdom(state, 'Abyssal').length >= 2);
assert.equal(kingdomTrust(state, '100').dimensions.carryReliability.score, 100);

const contract = createKingdomContract(state, '999', { title: 'Asset custody', parties: ['100'], terms: 'Return the asset when due.' });
assert.equal(signKingdomContract(state, '100', contract.id).status, 'active');

const link = createGatewayLink(state, '999', { slug: 'help', target: '/help', label: 'Help' });
assert.equal(resolveGatewayLink(state, 'help').target, '/help');

const snapA = captureKingdomTimeMachine(state, '999', 'Before');
state.kingdom.xp += 500;
const snapB = captureKingdomTimeMachine(state, '999', 'After');
assert.ok(compareKingdomTimeMachine(state, snapA.id, snapB.id).changed >= 1);

assert.equal(runKingdomLab(state, '999', { type: 'carry-surge', addedPlayers: 50 }).result.addedPlayers, 50);
assert.equal(createStudioSurface(state, '999', { name: 'Member Home', audience: 'member', widgets: [{ type: 'queue', source: 'carries.active', title: 'Queue' }] }).widgets.length, 1);
assert.equal(createFactoryProduct(state, '999', { template: 'service-programme', name: 'Carry Service' }).template, 'service-programme');
assert.equal(setExtensionEnabled(state, '999', 'kingdom-ledger', false).installation.enabled, false);
assert.equal(setExtensionEnabled(state, '999', 'kingdom-ledger', true).installation.enabled, true);

const offer1 = createExchangeOffer(state, '100', { offer: 'Abyssal Blade', want: '4T gold' });
const offer2 = createExchangeOffer(state, '200', { offer: '4T gold', want: 'Abyssal Blade' });
assert.ok(offer2.matchedWith.includes(offer1.id));
assert.equal(closeExchangeOffer(state, '200', offer2.id, 'completed').status, 'completed');

assert.equal(getKingdomVault(state).totals.records, 1);
assert.ok(Array.isArray(computeKingdomDecisions(state)));
const os = getKingdomOs(state);
assert.equal(os.modules.id, true);
assert.equal(os.modules.forge, true);

console.log('Kingdom ecosystem foundation self-test passed.');
