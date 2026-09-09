export const NEXUS_VERSION = '1.2.0';

export const NEXUS_PRODUCTS = Object.freeze([
  { id: 1, slug: 'core', name: 'Kingdom Core', type: 'discord-runtime', summary: 'The live Discord runtime that powers Kingdom Carries automation, moderation, carries, applications and guild operations.', capabilities: ['Discord gateway', 'carry operations', 'applications', 'moderation and security', 'maintenance automation'] },
  { id: 2, slug: 'platform', name: 'Kingdom Platform', type: 'bot-platform', summary: 'The modular service layer behind Kingdom Core: shared domain services, automation engines, integrations and operator controls.', capabilities: ['shared services', 'event-driven modules', 'automation engines', 'integration layer', 'single-process low-memory mode'] },
  { id: 3, slug: 'mobile', name: 'Kingdom Mobile', type: 'pwa', summary: 'Installable mobile experience for carries, events, profiles, notifications and guild operations.', capabilities: ['PWA install', 'mobile-first UI', 'offline shell', 'standalone app mode', 'touch-friendly operations'] },
  { id: 4, slug: 'desktop', name: 'Kingdom Desktop Control Centre', type: 'pwa-desktop', summary: 'Installable desktop command centre for staff and operators without a paid app store or proprietary runtime.', capabilities: ['desktop install', 'staff console', 'live operations', 'keyboard-friendly UI', 'standalone window'] },
  { id: 5, slug: 'network', name: 'Kingdom Network', type: 'multi-tenant-platform', summary: 'Multi-guild control plane for partner, satellite and future Kingdom guilds.', capabilities: ['tenant registry', 'guild isolation', 'network status', 'shared platform primitives', 'tenant lifecycle'] },
  { id: 6, slug: 'cloud', name: 'Kingdom Cloud', type: 'self-hosted-platform', summary: 'Private self-hosted API, persistence, backups, runtime services and connectivity on infrastructure you control.', capabilities: ['private HTTP services', 'local persistence', 'optional Postgres/Redis', 'Cloudflare private connectivity', 'zero required SaaS'] },
  { id: 7, slug: 'identity', name: 'Kingdom Identity', type: 'identity-platform', summary: 'Canonical member identity joining Discord sessions with Roblox-facing profile data and rename-safe history.', capabilities: ['Discord OAuth session', 'canonical profile', 'Roblox identity field', 'rename-safe aliases', 'role-aware access'] },
  { id: 8, slug: 'launcher', name: 'Kingdom Launcher', type: 'installable-shell', summary: 'One launch surface for Discord, Dungeon Quest, Kingdom tools, installed apps and live status.', capabilities: ['PWA launcher', 'deep links', 'status shortcuts', 'install actions', 'no installer fee'] },
  { id: 9, slug: 'companion', name: 'Kingdom Companion', type: 'game-companion', summary: 'Non-exploit Dungeon Quest companion for builds, progression, guides and carry readiness.', capabilities: ['build profiles', 'guide library', 'progression notes', 'carry readiness', 'member-safe tooling'] },
  { id: 10, slug: 'live', name: 'Kingdom Live', type: 'live-operations', summary: 'Real-time operations view for carries, queue demand, events and service health.', capabilities: ['live queue', 'active sessions', 'service health', 'Server-Sent Events stream', 'snapshot fallback'] },
  { id: 11, slug: 'tv', name: 'Kingdom TV', type: 'broadcast-ui', summary: 'OBS and browser-source friendly live display for streams, events and large-format operations.', capabilities: ['TV route', 'live refresh', 'large-format layout', 'stream overlay ready', 'chromeless mode'] },
  { id: 12, slug: 'creators', name: 'Kingdom Creator Platform', type: 'creator-portal', summary: 'Campaign, collaboration and event control surface for approved creators.', capabilities: ['campaign registry', 'creator links', 'event hooks', 'performance fields', 'operator campaign controls'] },
  { id: 13, slug: 'api', name: 'Kingdom API', type: 'developer-api', summary: 'Documented HTTP API exposing safe Kingdom data and controlled authenticated actions.', capabilities: ['documented endpoints', 'Discord session writes', 'CSRF protection', 'live stream endpoint', 'operator authorization'] },
  { id: 14, slug: 'sdk', name: 'Kingdom SDK', type: 'developer-sdk', summary: 'Zero-dependency JavaScript client for the Kingdom API and live stream.', capabilities: ['JS client', 'live stream client', 'browser/node compatible', 'same-origin sessions', 'no external package required'] },
  { id: 15, slug: 'studio', name: 'Kingdom Studio', type: 'visual-builder', summary: 'Visual configuration layer for panels, layouts and reusable server experiences.', capabilities: ['layout registry', 'draft configs', 'publishing', 'safe publish model', 'operator-only editing'] },
  { id: 16, slug: 'sentinel', name: 'Kingdom Sentinel', type: 'security-platform', summary: 'Independent security posture, risk snapshots, dangerous-permission visibility and incident command.', capabilities: ['risk snapshot', 'admin-bot visibility', 'incident lifecycle', 'permission health', 'operator incident controls'] },
  { id: 17, slug: 'vault', name: 'Kingdom Vault', type: 'backup-platform', summary: 'State snapshots and disaster-recovery records with retention, checksums and verification.', capabilities: ['on-demand backup', 'automatic backup', 'SHA-256 verification', 'retention', 'recovery records'] },
  { id: 18, slug: 'intelligence', name: 'Kingdom Intelligence', type: 'analytics-platform', summary: 'Operational analytics and trend history built directly from Kingdom state.', capabilities: ['queue metrics', 'carry metrics', 'case metrics', 'historical trend window', 'resource telemetry'] },
  { id: 19, slug: 'ai', name: 'Kingdom AI', type: 'ai-gateway', summary: 'Private AI gateway for Kingdom context, summaries and operator assistance using an endpoint you control.', capabilities: ['local endpoint support', 'provider abstraction', 'hard timeout', 'context limits', 'operator-only execution'] },
  { id: 20, slug: 'nexus', name: 'Kingdom Nexus', type: 'unified-control-plane', summary: 'The secure unified command centre joining every Kingdom system into one ecosystem.', capabilities: ['single navigation', 'Discord identity', 'shared API', 'shared state', 'shared security', 'installable clients'] }
]);

export const FREE_RUNTIME_POLICY = Object.freeze({
  requiredPaidServices: 0,
  defaultStorage: 'existing Kingdom Core JSON state + local Vault snapshots',
  defaultHosting: 'existing Oracle VM',
  mobileDistribution: 'installable PWA',
  desktopDistribution: 'installable PWA',
  ai: 'disabled until an operator-owned compatible endpoint is configured',
  externalDatabaseRequired: false,
  externalCacheRequired: false,
  appStoreRequired: false
});

export function productBySlug(slug) {
  const value = String(slug ?? '').toLowerCase();
  if (value === 'core2') return NEXUS_PRODUCTS.find((product) => product.slug === 'platform') ?? null;
  return NEXUS_PRODUCTS.find((product) => product.slug === value) ?? null;
}
