import {
  APPROVED_V10_NUMBERS,
  APPROVED_V10_SYSTEMS,
  V10_DOMAINS,
  V10_ENGINE_KEYS,
  V10_FEATURE_COUNT,
  v10DomainFor
} from '../src/config/approvedSystemsV10.js';
import {
  ensureRealmEnginesV10,
  estimateCarryEtaV10,
  scoreKnightForRequestV10
} from '../src/services/realmEnginesV10.js';

const failures = [];
const expected = Array.from({ length: 370 }, (_, index) => index + 1);

if (V10_FEATURE_COUNT !== 370) failures.push(`V10_FEATURE_COUNT is ${V10_FEATURE_COUNT}, expected 370.`);
if (APPROVED_V10_NUMBERS.length !== 370) failures.push(`Approved number count is ${APPROVED_V10_NUMBERS.length}, expected 370.`);
if (JSON.stringify(APPROVED_V10_NUMBERS) !== JSON.stringify(expected)) failures.push('Approved numbers are not the exact contiguous range 1..370.');

for (const number of expected) {
  const system = APPROVED_V10_SYSTEMS[number];
  const domain = v10DomainFor(number);
  if (!system) failures.push(`Missing system #${number}.`);
  if (!domain) failures.push(`Missing domain mapping for #${number}.`);
  if (system && domain && system.domain !== domain.key) failures.push(`System #${number} domain mismatch.`);
  if (system && !system.implementation?.startsWith('shared-engine:')) failures.push(`System #${number} has no shared-engine implementation mapping.`);
}

let cursor = 1;
for (const domain of V10_DOMAINS) {
  if (domain.start !== cursor) failures.push(`Domain ${domain.key} starts at ${domain.start}, expected ${cursor}.`);
  if (domain.end < domain.start) failures.push(`Domain ${domain.key} has an invalid range.`);
  if (!domain.capabilities?.length) failures.push(`Domain ${domain.key} has no capability manifest.`);
  cursor = domain.end + 1;
}
if (cursor !== 371) failures.push(`Domain coverage ends at ${cursor - 1}, expected 370.`);
if (new Set(V10_ENGINE_KEYS).size !== V10_ENGINE_KEYS.length) failures.push('Duplicate v10 engine keys detected.');

const sample = {};
ensureRealmEnginesV10(sample);
const expectedStateKeys = ['carryV10','knightsV10','membersV10','housesV10','questsV10','economyV10','eventsV10','applicationsV10','casesV10','securityV10','analyticsV10','knowledgeV10','integrationsV10','aiV10','legacyV10'];
for (const key of expectedStateKeys) if (!sample[key]) failures.push(`Realm engine did not initialise ${key}.`);
if (sample.aiV10.enabled !== false) failures.push('AI must remain disabled by default for VPS stability.');

const score = scoreKnightForRequestV10({ reliability: 0.9, specialties: ['VC'], status: 'available', region: 'EU', activeLoad: 0, maxLoad: 2 }, { dungeon: 'VC', region: 'EU' });
if (!(score > 0 && score <= 100)) failures.push(`Knight match score is invalid: ${score}.`);
sample.carryV10.demand.VC = { waiting: 6, availableKnights: 2, avgRunMinutes: 8, samples: 10 };
const eta = estimateCarryEtaV10(sample, 'VC');
if (eta.minutes !== 24 || eta.confidence < 40) failures.push(`Carry ETA engine produced unexpected output: ${JSON.stringify(eta)}.`);

await Promise.all([
  import('../src/commands/setup10.js'),
  import('../src/services/platformV10.js'),
  import('../src/services/realmEnginesV10.js'),
  import('../src/services/realmRuntimeV10.js'),
  import('../src/services/compactGuild.js'),
  import('../src/services/maintenanceV5Safe.js'),
  import('../src/services/gatewayHealth.js')
]);

if (failures.length) {
  console.error('Kingdom Core v10 self-test FAILED:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Kingdom Core v10 self-test passed: ${APPROVED_V10_NUMBERS.length} systems, ${V10_DOMAINS.length} domains, ${V10_ENGINE_KEYS.length} shared engines, contiguous roadmap 1..370, Realm engine primitives healthy.`);
