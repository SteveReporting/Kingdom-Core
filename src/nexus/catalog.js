export const NEXUS_VERSION = '1.0.0';

export const NEXUS_PRODUCTS = Object.freeze([
  { id: 2, slug: 'core2', name: 'Kingdom Core 2', type: 'bot-platform', summary: 'Modular Discord gateway, API, workers and shared domain services.', capabilities: ['Discord gateway', 'shared services', 'event-driven modules', 'single-process low-memory mode'] },
  { id: 3, slug: 'mobile', name: 'Kingdom Mobile', type: 'pwa', summary: 'Installable mobile experience for carries, events, profiles and notifications.', capabilities: ['PWA install', 'mobile-first UI', 'offline shell', 'push-ready architecture'] },
  { id: 4, slug: 'desktop', name: 'Kingdom Desktop Control Centre', type: 'pwa-desktop', summary: 'Installable staff command centre without a paid app-store or proprietary runtime.', capabilities: ['desktop install', 'staff console', 'live operations', 'keyboard-friendly UI'] },
  { id: 5, slug: 'network', name: 'Kingdom Network', type: 'multi-tenant-platform', summary: 'Multi-guild control plane for future partner or satellite guilds.', capabilities: ['tenant registry', 'guild isolation', 'network status', 'shared platform primitives'] },
  { id: 6, slug: 'cloud', name: 'Kingdom Cloud', type: 'self-hosted-platform', summary: 'Self-hosted API, persistence, backups and services on infrastructure you already control.', capabilities: ['self-hosted HTTP', 'JSON fallback persistence', 'optional Postgres/Redis', 'zero required SaaS'] },
  { id: 7, slug: 'identity', name: 'Kingdom Identity', type: 'identity-platform', summary: 'Canonical member identity joining Discord and Roblox-facing profile data.', capabilities: ['canonical profile', 'Discord ID', 'Roblox identity field', 'rename-safe history'] },
  { id: 8, slug: 'launcher', name: 'Kingdom Launcher', type: 'installable-shell', summary: 'One installable launch surface for Discord, Dungeon Quest, Kingdom tools and live status.', capabilities: ['PWA launcher', 'deep links', 'status shortcuts', 'no installer fee'] },
  { id: 9, slug: 'companion', name: 'Kingdom Companion', type: 'game-companion', summary: 'Non-exploit Dungeon Quest companion for builds, progression, guides and carry readiness.', capabilities: ['build profiles', 'guide library', 'progression notes', 'carry readiness'] },
  { id: 10, slug: 'live', name: 'Kingdom Live', type: 'public-live-site', summary: 'Real-time public operations view for carries, queue demand, events and service health.', capabilities: ['live queue', 'active sessions', 'service health', 'public-safe metrics'] },
  { id: 11, slug: 'tv', name: 'Kingdom TV', type: 'broadcast-ui', summary: 'OBS/browser-source friendly live display for streams and events.', capabilities: ['TV route', 'auto-refresh', 'large-format layout', 'stream overlay ready'] },
  { id: 12, slug: 'creators', name: 'Kingdom Creator Platform', type: 'creator-portal', summary: 'Campaign and collaboration control surface for approved creators.', capabilities: ['campaign registry', 'creator links', 'event hooks', 'performance fields'] },
  { id: 13, slug: 'api', name: 'Kingdom API', type: 'developer-api', summary: 'Documented HTTP API exposing safe Kingdom data and controlled actions.', capabilities: ['versioned endpoints', 'admin-token writes', 'public-safe reads', 'health endpoint'] },
  { id: 14, slug: 'sdk', name: 'Kingdom SDK', type: 'developer-sdk', summary: 'Zero-dependency JavaScript client for the Kingdom API.', capabilities: ['JS client', 'typed-style methods', 'browser/node compatible', 'no external package required'] },
  { id: 15, slug: 'studio', name: 'Kingdom Studio', type: 'visual-builder', summary: 'Visual configuration layer for panels, layouts and reusable server experiences.', capabilities: ['layout registry', 'draft configs', 'version fields', 'safe publish model'] },
  { id: 16, slug: 'sentinel', name: 'Kingdom Sentinel', type: 'security-platform', summary: 'Independent security health and configuration-risk surface.', capabilities: ['risk snapshot', 'admin-bot visibility', 'incident state', 'permission health'] },
  { id: 17, slug: 'vault', name: 'Kingdom Vault', type: 'backup-platform', summary: 'Local state snapshots and disaster-recovery records with retention.', capabilities: ['on-demand backup', 'local retention', 'restore-ready files', 'no cloud storage bill'] },
  { id: 18, slug: 'intelligence', name: 'Kingdom Intelligence', type: 'analytics-platform', summary: 'Operational analytics built from the same Kingdom state instead of a paid warehouse.', capabilities: ['queue metrics', 'carry metrics', 'case metrics', 'snapshot summaries'] },
  { id: 19, slug: 'ai', name: 'Kingdom AI', type: 'local-ai-gateway', summary: 'Optional local/open-compatible AI gateway that is disabled unless a free local endpoint is configured.', capabilities: ['local endpoint only by default', 'provider abstraction', 'hard timeout', 'off switch'] },
  { id: 20, slug: 'nexus', name: 'Kingdom Nexus', type: 'unified-control-plane', summary: 'One control plane joining every Kingdom product into a single ecosystem.', capabilities: ['single navigation', 'shared identity', 'shared API', 'shared state', 'shared security'] }
]);

export const FREE_RUNTIME_POLICY = Object.freeze({
  requiredPaidServices: 0,
  defaultStorage: 'existing Kingdom Core JSON state + local Vault snapshots',
  defaultHosting: 'existing Oracle VM',
  mobileDistribution: 'installable PWA',
  desktopDistribution: 'installable PWA',
  ai: 'disabled unless a user-owned local/OpenAI-compatible free endpoint is configured',
  externalDatabaseRequired: false,
  externalCacheRequired: false,
  appStoreRequired: false
});

export function productBySlug(slug) {
  return NEXUS_PRODUCTS.find((product) => product.slug === String(slug ?? '').toLowerCase()) ?? null;
}
