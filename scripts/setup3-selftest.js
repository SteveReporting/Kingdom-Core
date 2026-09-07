import fs from 'node:fs/promises';
import path from 'node:path';
import { SETUP3_GROUPS, SETUP3_PROTECTED_ZONES } from '../src/services/serverOrganizerV3.js';

const failures = [];
const root = process.cwd();
const requiredGroups = ['start','verification','important','community','applications','staff','security','support','houses','events','social','systems','archives'];
const actualGroups = SETUP3_GROUPS.map((group) => group.key);
for (const key of requiredGroups) if (!actualGroups.includes(key)) failures.push(`Missing setup3 group: ${key}`);
if (new Set(actualGroups).size !== actualGroups.length) failures.push('setup3 group keys are not unique.');

const protectedKeys = SETUP3_PROTECTED_ZONES.map((zone) => zone.key).sort();
if (JSON.stringify(protectedKeys) !== JSON.stringify(['carries','economy','knights'])) {
  failures.push(`Protected setup3 zones are wrong: ${protectedKeys.join(', ')}`);
}

const serviceSource = await fs.readFile(path.join(root, 'src', 'services', 'serverOrganizerV3.js'), 'utf8');
const commandSource = await fs.readFile(path.join(root, 'src', 'commands', 'setup3.js'), 'utf8');
const deploySource = await fs.readFile(path.join(root, 'src', 'deploy-commands.js'), 'utf8');
const indexSource = await fs.readFile(path.join(root, 'src', 'index.js'), 'utf8');

if (serviceSource.includes('channel.delete(')) failures.push('setup3 must never delete channels.');
if (!serviceSource.includes('lockPermissions: false')) failures.push('setup3 must preserve channel permission overwrites while moving channels.');
if (!serviceSource.includes('protectedZoneForCategory')) failures.push('setup3 protected-zone guard is missing.');
if (!serviceSource.includes("welcome: 'verification'")) failures.push('setup3 must map welcome to Verification.');
if (!serviceSource.includes("guide: 'verification'")) failures.push('setup3 must map guide to Verification.');
if (!serviceSource.includes("'server-guide': 'important'")) failures.push('setup3 must map server-guide to Important.');
if (!serviceSource.includes("'kingdom-chat': 'community'")) failures.push('setup3 must map kingdom-chat to Community.');
if (!serviceSource.includes("'application-hub': 'applications'")) failures.push('setup3 application hub mapping is missing.');
if (!serviceSource.includes("name: '━━ 🛡️ KINGDOM SECURITY ━━'")) failures.push('setup3 Kingdom Security category is missing.');
if (!serviceSource.includes("reason: 'leave-in-place'")) failures.push('setup3 must leave ambiguous channels in place instead of dumping them into a generic category.');
if (!commandSource.includes("setName('setup3')")) failures.push('/setup3 slash command definition is missing.');
if (!commandSource.includes("setName('preview')")) failures.push('/setup3 preview mode is missing.');
if (!deploySource.includes('setup3Command')) failures.push('/setup3 is not registered for deployment.');
if (!indexSource.includes("interaction.commandName === 'setup3'")) failures.push('/setup3 is not routed at runtime.');

await Promise.all([
  import('../src/commands/setup3.js'),
  import('../src/services/serverOrganizerV3.js')
]);

if (failures.length) {
  console.error('Kingdom Core setup3 self-test FAILED:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Kingdom Core setup3 self-test passed: curated category map, protected Carries/Market/Knights zones, preview mode, permission-preserving moves, no channel deletion, and leave-in-place fallback verified.');
