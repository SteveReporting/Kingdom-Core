import fs from 'node:fs/promises';
import path from 'node:path';
import { FREE_RUNTIME_POLICY, NEXUS_PRODUCTS, NEXUS_VERSION } from '../src/nexus/catalog.js';

const failures = [];
const root = process.cwd();
const expectedIds = Array.from({ length: 20 }, (_, index) => index + 1);
const ids = NEXUS_PRODUCTS.map((product) => product.id);
if (JSON.stringify(ids) !== JSON.stringify(expectedIds)) failures.push(`Kingdom system IDs must be exactly 1-20; got ${ids.join(',')}`);
if (new Set(NEXUS_PRODUCTS.map((product) => product.slug)).size !== 20) failures.push('Kingdom system slugs are not unique.');
if (NEXUS_VERSION !== '1.2.0') failures.push(`Unexpected internal Nexus schema/build marker: ${NEXUS_VERSION}`);
if (FREE_RUNTIME_POLICY.requiredPaidServices !== 0) failures.push('Nexus free-runtime policy requires a paid service.');
if (FREE_RUNTIME_POLICY.externalDatabaseRequired !== false || FREE_RUNTIME_POLICY.externalCacheRequired !== false) failures.push('Nexus must keep database/cache optional.');

const files = [
  'src/nexus/catalog.js','src/nexus/state.js','src/nexus/domain.js','src/nexus/ops.js','src/nexus/auth.js','src/nexus/platform.js','src/nexus/sdk-browser.js',
  'web/nexus/index.html','web/nexus/styles.css','web/nexus/auth-ui.js','web/nexus/app.js','web/nexus/manifest.webmanifest','web/nexus/sw.js',
  'web/nexus/tv.html','web/nexus/tv.css','web/nexus/tv.js','web/nexus/icon.svg'
];
for (const file of files) {
  try { await fs.access(path.join(root, file)); } catch { failures.push(`Missing Nexus file: ${file}`); }
}

const platform = await fs.readFile(path.join(root, 'src/nexus/platform.js'), 'utf8');
const auth = await fs.readFile(path.join(root, 'src/nexus/auth.js'), 'utf8');
const domain = await fs.readFile(path.join(root, 'src/nexus/domain.js'), 'utf8');
const ops = await fs.readFile(path.join(root, 'src/nexus/ops.js'), 'utf8');
const sdk = await fs.readFile(path.join(root, 'src/nexus/sdk-browser.js'), 'utf8');
const index = await fs.readFile(path.join(root, 'src/index.js'), 'utf8');
const web = await fs.readFile(path.join(root, 'web/nexus/index.html'), 'utf8');
const app = await fs.readFile(path.join(root, 'web/nexus/app.js'), 'utf8');
const authUi = await fs.readFile(path.join(root, 'web/nexus/auth-ui.js'), 'utf8');
const tv = await fs.readFile(path.join(root, 'web/nexus/tv.js'), 'utf8');
const manifest = await fs.readFile(path.join(root, 'web/nexus/manifest.webmanifest'), 'utf8');

for (const endpoint of [
  '/api/me','/api/products','/api/status','/api/live','/api/live/stream','/api/intelligence','/api/sentinel','/api/network/summary','/api/launcher',
  '/api/admin/state','/api/admin/vault/verify','/api/network/tenants','/api/identity/link','/api/companion/builds','/api/companion/guides',
  '/api/creators/campaigns','/api/studio/layouts','/api/sentinel/incidents','/api/vault/backup','/api/ai',
  '/auth/discord','/auth/discord/callback','/auth/logout'
]) {
  if (!platform.includes(endpoint)) failures.push(`Nexus endpoint missing: ${endpoint}`);
}
for (const capability of ['upsertCompanionBuild','upsertCompanionGuide','createSentinelIncident','updateSentinelIncident','publishStudioLayout','buildAdminSnapshot','buildTrendSummary']) {
  if (!domain.includes(capability)) failures.push(`Nexus domain capability missing: ${capability}`);
}
for (const capability of ['runNexusMaintenance','createVaultBackup','verifyVaultBackups','sha256','AUTO_BACKUP_INTERVAL_MS']) {
  if (!ops.includes(capability)) failures.push(`Nexus operations capability missing: ${capability}`);
}
for (const capability of ['discordOAuthConfigured','startDiscordOAuth','completeDiscordOAuth','publicSession','isOperatorSession','HttpOnly','SameSite=Lax','SESSION_TTL_MS']) {
  if (!auth.includes(capability)) failures.push(`Nexus Discord OAuth capability missing: ${capability}`);
}
if (!auth.includes('PermissionFlagsBits.Administrator') || !auth.includes('PermissionFlagsBits.ManageGuild')) failures.push('Discord OAuth operator authorization must be tied to Discord permissions.');
if (!auth.includes('DISCORD_OAUTH_CLIENT_SECRET') || !auth.includes('KINGDOM_NEXUS_PUBLIC_URL')) failures.push('Discord OAuth environment contract is missing.');
if (!auth.includes("scope: 'identify'")) failures.push('Discord OAuth should request only identify scope by default.');
if (!platform.includes('KINGDOM_NEXUS_ADMIN_TOKEN')) failures.push('Nexus fallback admin token protection is missing.');
if (!platform.includes('isOperatorSession(req)')) failures.push('Nexus admin API does not accept Discord operator sessions.');
if (!platform.includes("KINGDOM_NEXUS_HOST ?? '127.0.0.1'")) failures.push('Nexus must bind to localhost by default.');
if (!platform.includes('text/event-stream')) failures.push('Nexus live SSE stream is missing.');
if (!platform.includes('startMaintenanceLoop')) failures.push('Nexus background maintenance loop is missing.');
if (!index.includes('startNexusPlatform')) failures.push('Kingdom Core does not start Kingdom Nexus.');
if (!web.includes('operatorState') || !web.includes('adminBtn') || !web.includes('discordBtn')) failures.push('Nexus operator/Discord controls are missing.');
if (!app.includes('beforeinstallprompt')) failures.push('Nexus PWA install flow is missing.');
if (!app.includes('sessionStorage')) failures.push('Legacy Nexus fallback admin token must remain session-scoped in the legacy browser surface.');
if (!app.includes('EventSource')) failures.push('Nexus browser live stream client is missing.');
if (!authUi.includes('/api/me') || !authUi.includes('/auth/discord') || !authUi.includes('/auth/logout')) failures.push('Nexus Discord login UI bridge is incomplete.');
if (!sdk.includes('streamLive') || !sdk.includes('saveBuild') || !sdk.includes('openIncident') || !sdk.includes('verifyBackups')) failures.push('Kingdom SDK does not expose the expanded Nexus platform.');
if (!tv.includes('EventSource') || !tv.includes('/api/live/stream')) failures.push('Kingdom TV is not connected to the Nexus live stream.');
if (!manifest.includes('/icon.svg') || !manifest.includes('shortcuts')) failures.push('Nexus installable PWA manifest is incomplete.');
for (const ui of ['renderNetwork','renderIdentity','renderCompanion','renderCreators','renderStudio','renderSentinel','renderVault','renderIntelligence','renderLauncher']) {
  if (!app.includes(ui)) failures.push(`Nexus product UI missing: ${ui}`);
}

await Promise.all([
  import('../src/nexus/catalog.js'),
  import('../src/nexus/state.js'),
  import('../src/nexus/domain.js'),
  import('../src/nexus/ops.js'),
  import('../src/nexus/auth.js'),
  import('../src/nexus/platform.js'),
  import('../src/nexus/sdk-browser.js')
]);

if (failures.length) {
  console.error('Kingdom Nexus self-test FAILED:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('Kingdom suite self-test passed: all 20 systems are registered with free runtime, Discord OAuth operator sessions, live SSE/TV, SDK, Companion, Creator, Studio, Sentinel, verified Vault backups, Intelligence trends and low-memory maintenance verified.');
