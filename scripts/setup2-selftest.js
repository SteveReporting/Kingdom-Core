import fs from 'node:fs/promises';
import path from 'node:path';
import { ORGANIZER_GROUPS } from '../src/services/serverOrganizerV2.js';

const failures = [];
const root = process.cwd();

if (ORGANIZER_GROUPS.length !== 7) failures.push(`setup2 should target exactly 7 compact categories, found ${ORGANIZER_GROUPS.length}.`);
if (new Set(ORGANIZER_GROUPS.map((group) => group.key)).size !== ORGANIZER_GROUPS.length) failures.push('setup2 category keys are not unique.');

const organizerSource = await fs.readFile(path.join(root, 'src', 'services', 'serverOrganizerV2.js'), 'utf8');
const commandSource = await fs.readFile(path.join(root, 'src', 'commands', 'setup2.js'), 'utf8');
const deploySource = await fs.readFile(path.join(root, 'src', 'deploy-commands.js'), 'utf8');
const indexSource = await fs.readFile(path.join(root, 'src', 'index.js'), 'utf8');

if (organizerSource.includes('channel.delete(')) failures.push('setup2 must never delete channels.');
if (!organizerSource.includes("lockPermissions: false")) failures.push('setup2 must preserve channel permission overwrites when moving channels.');
if (!organizerSource.includes('CATEGORY_CAPACITY = 50')) failures.push('setup2 category-capacity guard is missing.');
if (!commandSource.includes("setName('setup2')")) failures.push('/setup2 slash command definition is missing.');
if (!commandSource.includes("setName('preview')")) failures.push('/setup2 preview mode is missing.');
if (!deploySource.includes('setup2Command')) failures.push('/setup2 is not registered for deployment.');
if (deploySource.includes('setup5Command') || deploySource.includes('setup10Command')) failures.push('Retired /setup5 or /setup10 is still registered for deployment.');
if (!indexSource.includes("interaction.commandName === 'setup2'")) failures.push('/setup2 is not routed in src/index.js.');
if (indexSource.includes("interaction.commandName === 'setup5'") || indexSource.includes("interaction.commandName === 'setup10'")) failures.push('Retired /setup5 or /setup10 is still routed at runtime.');

await Promise.all([
  import('../src/commands/setup2.js'),
  import('../src/services/serverOrganizerV2.js')
]);

if (failures.length) {
  console.error('Kingdom Core setup2 self-test FAILED:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Kingdom Core setup2 self-test passed: 7-category cap, preview mode, no channel deletion, permission-preserving moves, and retired setup5/setup10 routes verified.');
