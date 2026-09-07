import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const failures = [];

const read = (file) => fs.readFile(path.join(root, file), 'utf8');
const [command, service, appReview, ui, deploy, index] = await Promise.all([
  read('src/commands/uipgrade.js'),
  read('src/services/uiUpgrade.js'),
  read('src/services/applicationLinks.js'),
  read('src/ui/realmUiVNext.js'),
  read('src/deploy-commands.js'),
  read('src/index.js')
]);

if (!command.includes("setName('uipgrade')")) failures.push('UIpgrade slash command is missing.');
if (deploy.includes('setupCommand') || deploy.includes('setup2Command') || deploy.includes('setup3Command')) failures.push('A retired setup command is still deployed.');
if (!deploy.includes('uiUpgradeCommand')) failures.push('UIpgrade is not registered for deployment.');
if (index.includes("interaction.commandName === 'setup") || index.includes("interaction.commandName === 'setup2") || index.includes("interaction.commandName === 'setup3")) failures.push('A retired setup command is still routed at runtime.');
if (!index.includes("interaction.commandName === 'uipgrade'")) failures.push('UIpgrade is not routed at runtime.');
if (!index.includes("interaction.customId.startsWith('kc:app:review:')")) failures.push('Legacy application review buttons can still bypass the full grader.');

if (service.includes('channel.delete(')) failures.push('UIpgrade must never delete channels.');
for (const protectedTerm of ['announcements/news', 'general/community chat', 'security/audit/mod logs']) {
  if (!service.includes(protectedTerm)) failures.push(`UIpgrade protection marker missing: ${protectedTerm}`);
}
if (!service.includes('bulkDelete') || !service.includes('message.delete()')) failures.push('UIpgrade does not support clearing both recent and older presentation messages.');
if (!service.includes('state.setup.panels = {}')) failures.push('UIpgrade does not invalidate stale panel message IDs before rebuilding.');

for (const capability of [
  'Open Next Application', 'Notepad', 'Grade & Decide', 'Answer ${page + 1}/${entries.length}',
  'grantAcceptedRoles', 'dmDecision', 'STAFF_ACCEPT_ROLE_IDS', 'CARRIER_ACCEPT_ROLE_IDS', 'CREATOR_ACCEPT_ROLE_IDS'
]) {
  if (!appReview.includes(capability)) failures.push(`Application grader capability missing: ${capability}`);
}
if (!appReview.includes("setCustomId('kc:app:start:staff')") || !appReview.includes("setCustomId('kc:app:start:carrier')")) failures.push('Discord-native application intake buttons are missing.');
if (!ui.includes('REALM INTERFACE') || !ui.includes('UI vNext')) failures.push('UI vNext visual system markers are missing.');

await Promise.all([
  import('../src/commands/uipgrade.js'),
  import('../src/services/uiUpgrade.js'),
  import('../src/services/applicationLinks.js'),
  import('../src/ui/realmUiVNext.js'),
  import('../src/ui/kingdomV4Ui.js')
]);

if (failures.length) {
  console.error('Kingdom Core UIpgrade self-test FAILED:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Kingdom Core UIpgrade self-test passed: setup commands retired, protected-channel purge rules present, UI vNext imports resolved, and paged application grading/roles/DM onboarding verified.');
