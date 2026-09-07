import {
  APPROVED_V10_NUMBERS,
  APPROVED_V10_SYSTEMS,
  V10_DOMAINS,
  V10_ENGINE_KEYS,
  V10_FEATURE_COUNT,
  v10DomainFor
} from '../src/config/approvedSystemsV10.js';

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

await Promise.all([
  import('../src/commands/setup10.js'),
  import('../src/services/platformV10.js'),
  import('../src/services/compactGuild.js'),
  import('../src/services/maintenanceV5Safe.js'),
  import('../src/services/gatewayHealth.js')
]);

if (failures.length) {
  console.error('Kingdom Core v10 self-test FAILED:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Kingdom Core v10 self-test passed: ${APPROVED_V10_NUMBERS.length} systems, ${V10_DOMAINS.length} domains, ${V10_ENGINE_KEYS.length} shared engines, contiguous roadmap 1..370.`);
