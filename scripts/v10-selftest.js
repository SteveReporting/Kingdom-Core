import {
  APPROVED_V10_NUMBERS,
  APPROVED_V10_SYSTEMS,
  EXCLUDED_V10_NUMBERS,
  V10_DOMAINS,
  V10_ENGINE_KEYS,
  V10_FEATURE_COUNT,
  V10_HIGHEST_SYSTEM,
  v10DomainFor
} from '../src/config/approvedSystemsV10.js';
import {
  ensureRealmEnginesV10,
  estimateCarryEtaV10,
  scoreKnightForRequestV10
} from '../src/services/realmEnginesV10.js';
import {
  analyzeChangeImpactV10,
  auditDataIntegrityV10,
  auditQueueFairnessV10,
  bindIdentityAliasV10,
  buildMemberContextV10,
  compilePermissionIntentV10,
  detectOperationalAnomaliesV10,
  enqueueAutopilotActionV10,
  ensureRealmIntelligenceV10,
  modelGuildCapacityV10,
  openIncidentV10,
  planServiceRecoveryV10,
  recordShadowDecisionV10,
  reserveCarryCapacityV10,
  resolveCanonicalIdentityV10,
  routeServiceRequestV10,
  runAutopilotV10,
  searchKingdomV10,
  setStandbyKnightV10,
  simulatePolicyV10,
  upsertGraphNodeV10
} from '../src/services/realmIntelligenceV10.js';

const failures = [];
const expected = Array.from({ length: 390 }, (_, index) => index + 1).filter((number) => number !== 385);
const extensionExpected = [
  ...Array.from({ length: 14 }, (_, index) => 371 + index),
  ...Array.from({ length: 5 }, (_, index) => 386 + index)
];

if (V10_HIGHEST_SYSTEM !== 390) failures.push(`V10_HIGHEST_SYSTEM is ${V10_HIGHEST_SYSTEM}, expected 390.`);
if (V10_FEATURE_COUNT !== 389) failures.push(`V10_FEATURE_COUNT is ${V10_FEATURE_COUNT}, expected 389.`);
if (JSON.stringify(EXCLUDED_V10_NUMBERS) !== JSON.stringify([385])) failures.push('Only system #385 should be excluded.');
if (APPROVED_V10_NUMBERS.length !== 389) failures.push(`Approved number count is ${APPROVED_V10_NUMBERS.length}, expected 389.`);
if (JSON.stringify(APPROVED_V10_NUMBERS) !== JSON.stringify(expected)) failures.push('Approved numbers are not 1..390 with only #385 excluded.');
if (APPROVED_V10_SYSTEMS[385]) failures.push('Rejected system #385 must not exist in the approved manifest.');

for (const number of expected) {
  const system = APPROVED_V10_SYSTEMS[number];
  const domain = v10DomainFor(number);
  if (!system) failures.push(`Missing system #${number}.`);
  if (!domain) failures.push(`Missing domain mapping for #${number}.`);
  if (system && domain && system.domain !== domain.key) failures.push(`System #${number} domain mismatch.`);
  if (system && !system.implementation?.startsWith('shared-engine:')) failures.push(`System #${number} has no shared-engine implementation mapping.`);
}

const extensionNames = extensionExpected.map((number) => APPROVED_V10_SYSTEMS[number]?.name).filter(Boolean);
if (extensionNames.length !== 19) failures.push(`Realm Intelligence extension name count is ${extensionNames.length}, expected 19.`);
if (!extensionNames.includes('Kingdom Graph')) failures.push('Kingdom Graph is missing.');
if (!extensionNames.includes('Realm Autopilot — Guarded Operations')) failures.push('Guarded Realm Autopilot is missing.');

let cursor = 1;
for (const domain of V10_DOMAINS) {
  if (domain.start !== cursor) failures.push(`Domain ${domain.key} starts at ${domain.start}, expected ${cursor}.`);
  if (domain.end < domain.start) failures.push(`Domain ${domain.key} has an invalid range.`);
  if (!domain.capabilities?.length) failures.push(`Domain ${domain.key} has no capability manifest.`);
  cursor = domain.end + 1;
}
if (cursor !== 391) failures.push(`Domain coverage ends at ${cursor - 1}, expected 390.`);
if (new Set(V10_ENGINE_KEYS).size !== V10_ENGINE_KEYS.length) failures.push('Duplicate v10 engine keys detected.');
if (!V10_ENGINE_KEYS.includes('realm-intelligence')) failures.push('Realm Intelligence engine is not registered.');

const state = {};
ensureRealmEnginesV10(state);
const expectedStateKeys = ['carryV10','knightsV10','membersV10','housesV10','questsV10','economyV10','eventsV10','applicationsV10','casesV10','securityV10','analyticsV10','knowledgeV10','integrationsV10','aiV10','legacyV10'];
for (const key of expectedStateKeys) if (!state[key]) failures.push(`Realm engine did not initialise ${key}.`);
if (state.aiV10.enabled !== false) failures.push('AI must remain disabled by default for VPS stability.');

const score = scoreKnightForRequestV10({ reliability: 0.9, specialties: ['VC'], status: 'available', region: 'EU', activeLoad: 0, maxLoad: 2 }, { dungeon: 'VC', region: 'EU' });
if (!(score > 0 && score <= 100)) failures.push(`Knight match score is invalid: ${score}.`);
state.carryV10.demand.VC = { waiting: 6, availableKnights: 2, avgRunMinutes: 8, samples: 10 };
const eta = estimateCarryEtaV10(state, 'VC');
if (eta.minutes !== 24 || eta.confidence < 40) failures.push(`Carry ETA engine produced unexpected output: ${JSON.stringify(eta)}.`);

state.membersV10.passports.u1 = { username: 'Tester', house: 'Drakon' };
state.knightsV10.profiles.k1 = { status: 'available', reliability: 0.95, specialties: ['VC'], completedCarries: 120 };
state.carryV10.requests.c1 = { userId: 'u1', dungeon: 'VC', status: 'active' };
state.casesV10.staffAvailability = {};
state.setup = { channels: { carryBoard: 'chan1' }, roles: {} };
state.platform = { v10: { hubs: { carryOperations: 'chan1' } } };
state.marketV4 = { listings: {} };
state.treasuryV4 = { loans: {} };
ensureRealmIntelligenceV10(state);
upsertGraphNodeV10(state, 'member', 'u1', { username: 'Tester' });
bindIdentityAliasV10(state, 'u1', 'roblox', 'TesterRBLX');
if (resolveCanonicalIdentityV10(state, { roblox: 'TesterRBLX' }) !== 'u1') failures.push('Identity resolution smoke test failed.');
if (buildMemberContextV10(state, 'u1').userId !== 'u1') failures.push('Member context smoke test failed.');
if (routeServiceRequestV10(state, 'I need a VC carry').route !== 'carry') failures.push('Dynamic routing smoke test failed.');
if (!compilePermissionIntentV10({ visibility: 'private', viewRoles: ['r1'] }).roles.r1?.view) failures.push('Permission compiler smoke test failed.');
if (!analyzeChangeImpactV10(state, { targetId: 'chan1' }).impacts.length) failures.push('Change impact smoke test failed.');
setStandbyKnightV10(state, 'k1', { dungeons: ['VC'] });
if (!planServiceRecoveryV10(state, { carryId: 'c1', dungeon: 'VC' }).replacementCandidates.includes('k1')) failures.push('Recovery director smoke test failed.');
if (!reserveCarryCapacityV10(state, { dungeon: 'VC', slots: 4 }).id) failures.push('Capacity reservation smoke test failed.');
if (modelGuildCapacityV10(state).availableKnights !== 1) failures.push('Guild capacity model smoke test failed.');
if (!openIncidentV10(state, { title: 'Test incident' }).id) failures.push('Incident commander smoke test failed.');
if (!Array.isArray(auditDataIntegrityV10(state).findings)) failures.push('Integrity engine smoke test failed.');
if (!Array.isArray(searchKingdomV10(state, 'Tester'))) failures.push('Kingdom search smoke test failed.');
if (auditQueueFairnessV10(state, []).score !== 100) failures.push('Queue fairness smoke test failed.');
if (!Array.isArray(detectOperationalAnomaliesV10(state, { queue: 1 }))) failures.push('Anomaly detection smoke test failed.');
if (!simulatePolicyV10(state, { type: 'knight-promotion-threshold', currentThreshold: 75, proposedThreshold: 100 }).id) failures.push('Policy simulation smoke test failed.');
if (!recordShadowDecisionV10(state, 'matchmaker', 'a', 'a').samples.length) failures.push('Shadow mode smoke test failed.');
const unsafe = enqueueAutopilotActionV10(state, { type: 'ban-member' });
if (!unsafe.approvalRequired) failures.push('Autopilot must require approval for destructive actions.');
const safe = enqueueAutopilotActionV10(state, { type: 'rebalance-queue' });
if (safe.approvalRequired) failures.push('Safe autopilot action was incorrectly blocked for approval.');
if (runAutopilotV10(state, { pressure: 'normal' }).executed < 1) failures.push('Guarded autopilot safe-action smoke test failed.');

await Promise.all([
  import('../src/commands/setup10.js'),
  import('../src/services/platformV10.js'),
  import('../src/services/realmEnginesV10.js'),
  import('../src/services/realmRuntimeV10.js'),
  import('../src/services/realmIntelligenceV10.js'),
  import('../src/services/realmIntelligenceRuntimeV10.js'),
  import('../src/services/compactGuild.js'),
  import('../src/services/maintenanceV5Safe.js'),
  import('../src/services/gatewayHealth.js')
]);

if (failures.length) {
  console.error('Kingdom Core v10 self-test FAILED:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Kingdom Core v10 self-test passed: ${APPROVED_V10_NUMBERS.length} approved systems through #${V10_HIGHEST_SYSTEM}, #385 excluded, ${V10_DOMAINS.length} domains, ${V10_ENGINE_KEYS.length} shared engines, 19 Realm Intelligence extensions validated.`);
