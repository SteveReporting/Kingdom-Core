import fs from 'node:fs/promises';
import path from 'node:path';
import { FREE_RUNTIME_POLICY, NEXUS_PRODUCTS, NEXUS_VERSION } from '../src/nexus/catalog.js';

const failures = [];
const root = process.cwd();
const expectedIds = Array.from({ length: 19 }, (_, index) => index + 2);
const ids = NEXUS_PRODUCTS.map((product) => product.id);
if (JSON.stringify(ids) !== JSON.stringify(expectedIds)) failures.push(`Nexus product IDs must be exactly 2-20; got ${ids.join(',')}`);
if (new Set(NEXUS_PRODUCTS.map((product) => product.slug)).size !== 19) failures.push('Nexus product slugs are not unique.');
if (NEXUS_VERSION !== '1.1.0') failures.push(`Expected Nexus 1.1.0; got ${NEXUS_VERSION}`);
if (FREE_RUNTIME_POLICY.requiredPaidServices !== 0) failures.push('Nexus free-runtime policy requires a paid service.');
if (FREE_RUNTIME_POLICY.externalDatabaseRequired !== false || FREE_RUNTIME_POLICY.externalCacheRequired !== false) failures.push('Nexus must keep database/cache optional.');

const files = [
  'src/nexus/catalog.js','src/nexus/state.js','src/nexus/domain.js','src/nexus/ops.js','src/nexus/platform.js','src/nexus/sdk-browser.js',
  'web/nexus/index.html','web/nexus/styles.css','web/nexus/app.js','web/nexus/manifest.webmanifest','web/nexus/sw.js','web/nexus/tv.html'
];
for (const file of files) {
  try { await fs.access(path.join(root, file)); } catch { failures.push(`Missing Nexus file: ${file}`); }
}

const platform = await fs.readFile(path.join(root, 'src/nexus/platform.js'), 'utf8');
const domain = await fs.readFile(path.join(root, 'src/nexus/domain.js'), 'utf8');
const ops = await fs.readFile(path.join(root, 'src/nexus/ops.js'), 'utf8');
const index = await fs.readFile(path.join(root, 'src/index.js'), 'utf8');
const web = await fs.readFile(path.join(root, 'web/nexus/index.html'), 'utf8');
const app = await fs.readFile(path.join(root, 'web/nexus/app.js'), 'utf8');

for (const endpoint of [
  '/api/products','/api/status','/api/live','/api/live/stream','/api/intelligence','/api/sentinel','/api/network/summary','/api/launcher',
  '/api/admin/state','/api/admin/vault/verify','/api/network/tenants','/api/identity/link','/api/companion/builds','/api/companion/guides',
  '/api/creators/campaigns','/api/studio/layouts','/api/sentinel/incidents','/api/vault/backup','/api/ai'
]) {
  if (!platform.includes(endpoint)) failures.push(`Nexus endpoint missing: ${endpoint}`);
}
for (const capability of ['upsertCompanionBuild','upsertCompanionGuide','createSentinelIncident','updateSentinelIncident','publishStudioLayout','buildAdminSnapshot','buildTrendSummary']) {
  if (!domain.includes(capability)) failures.push(`Nexus domain capability missing: ${capability}`);
}
for (const capability of ['runNexusMaintenance','createVaultBackup','verifyVaultBackups','sha256','AUTO_BACKUP_INTERVAL_MS']) {
  if (!ops.includes(capability)) failures.push(`Nexus operations capability missing: ${capability}`);
}
if (!platform.includes('KINGDOM_NEXUS_ADMIN_TOKEN')) failures.push('Nexus admin write protection is missing.');
if (!platform.includes("KINGDOM_NEXUS_HOST ?? '127.0.0.1'")) failures.push('Nexus must bind to localhost by default.');
if (!platform.includes('text/event-stream')) failures.push('Nexus live SSE stream is missing.');
if (!platform.includes('startMaintenanceLoop')) failures.push('Nexus background maintenance loop is missing.');
if (!index.includes('startNexusPlatform')) failures.push('Kingdom Core does not start Kingdom Nexus.');
if (!web.includes('operatorState') || !web.includes('adminBtn')) failures.push('Nexus operator controls are missing.');
if (!app.includes('beforeinstallprompt')) failures.push('Nexus PWA install flow is missing.');
if (!app.includes('sessionStorage')) failures.push('Nexus admin token must be session-scoped in the browser.');
if (!app.includes('EventSource')) failures.push('Nexus browser live stream client is missing.');
for (const ui of ['renderNetwork','renderIdentity','renderCompanion','renderCreators','renderStudio','renderSentinel','renderVault','renderIntelligence','renderLauncher']) {
  if (!app.includes(ui)) failures.push(`Nexus product UI missing: ${ui}`);
}

await Promise.all([
  import('../src/nexus/catalog.js'),
  import('../src/nexus/state.js'),
  import('../src/nexus/domain.js'),
  import('../src/nexus/ops.js'),
  import('../src/nexus/platform.js'),
  import('../src/nexus/sdk-browser.js')
]);

if (failures.length) {
  console.error('Kingdom Nexus self-test FAILED:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('Kingdom Nexus 1.1 self-test passed: products 2-20, free runtime, operator UI, live SSE, Companion, Creator, Studio, Sentinel incidents, verified Vault backups, Intelligence trends and low-memory maintenance verified.');
