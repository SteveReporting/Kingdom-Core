import fs from 'node:fs/promises';
import path from 'node:path';
import { ORGANIZER_GROUPS, SOFT_CATEGORY_TARGET } from '../src/services/serverOrganizerV2.js';

const failures = [];
const root = process.cwd();

if (ORGANIZER_GROUPS.length !== 16) failures.push(`setup2 should support up to 16 balanced categories, found ${ORGANIZER_GROUPS.length}.`);
if (SOFT_CATEGORY_TARGET !== 18) failures.push(`setup2 soft category target should be 18, found ${SOFT_CATEGORY_TARGET}.`);
if (new Set(ORGANIZER_GROUPS.map((group) => group.key)).size !== ORGANIZER_GROUPS.length) failures.push('setup2 category keys are not unique.');

const requiredKeys = ['start','news','community','media','voice','events','houses','carries','economy','support','applications','knights','staff','security','systems','archives'];
for (const key of requiredKeys) if (!ORGANIZER_GROUPS.some((group) => group.key === key)) failures.push(`setup2 is missing balanced category group ${key}.`);

const organizerSource = await fs.readFile(path.join(root, 'src', 'services', 'serverOrganizerV2.js'), 'utf8');
const commandSource = await fs.readFile(path.join(root, 'src', 'commands', 'setup2.js'), 'utf8');
const deploySource = await fs.readFile(path.join(root, 'src', 'deploy-commands.js'), 'utf8');
const indexSource = await fs.readFile(path.join(root, 'src', 'index.js'), 'utf8');

if (organizerSource.includes('channel.delete(')) failures.push('setup2 must never delete channels.');
if (!organizerSource.includes('lockPermissions: false')) failures.push('setup2 must preserve channel permission overwrites when moving channels.');
if (!organizerSource.includes('CATEGORY_CAPACITY = 50')) failures.push('setup2 Discord category-capacity guard is missing.');
if (!organizerSource.includes('Current category is only a weak hint')) failures.push('setup2 classification regression: current parent must remain a weak signal.');
if (!organizerSource.includes('removeCategoriesEmptiedByThisRun')) failures.push('setup2 must only clean categories emptied by the current organisation run.');
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

console.log('Kingdom Core setup2 self-test passed: 16-category balanced plan, 18-channel soft target, preview mode, no channel deletion, safe category cleanup, and retired setup5/setup10 routes verified.');
