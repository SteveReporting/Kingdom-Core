import { randomUUID } from 'node:crypto';
import { mutateGuildState, readGuildState } from '../storage/store.js';
import { NEXUS_PRODUCTS, NEXUS_VERSION } from './catalog.js';
import {
  assertPlainObject,
  cleanOptionalText,
  cleanText,
  safeDiscordId,
  safeHttpUrl,
  safeNumber,
  safeRecordId,
  safeStatus
} from './validation.js';

const MAX_AUDIT_EVENTS = 500;

function blankNexus() {
  return {
    schema: 1,
    version: NEXUS_VERSION,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    products: Object.fromEntries(NEXUS_PRODUCTS.map((product) => [product.slug, { enabled: true, status: 'ready' }])),
    network: { tenants: {} },
    identity: { profiles: {} },
    companion: { builds: {}, guides: {} },
    creators: { campaigns: {} },
    studio: { layouts: {}, drafts: {} },
    sentinel: { incidents: [], lastSnapshot: null },
    vault: { backups: [] },
    intelligence: { snapshots: [], lastSnapshot: null },
    ai: { enabled: false, provider: 'local', lastRequestAt: null, lastError: null },
    audit: [],
    integrations: {},
    flags: { lowMemoryMode: true }
  };
}

export function ensureNexusState(state) {
  if (!state.nexus || typeof state.nexus !== 'object') state.nexus = blankNexus();
  state.nexus.schema = 1;
  state.nexus.version = NEXUS_VERSION;
  state.nexus.products ??= {};
  for (const product of NEXUS_PRODUCTS) state.nexus.products[product.slug] ??= { enabled: true, status: 'ready' };
  state.nexus.network ??= { tenants: {} };
  state.nexus.network.tenants ??= {};
  state.nexus.identity ??= { profiles: {} };
  state.nexus.identity.profiles ??= {};
  state.nexus.companion ??= { builds: {}, guides: {} };
  state.nexus.companion.builds ??= {};
  state.nexus.companion.guides ??= {};
  state.nexus.creators ??= { campaigns: {} };
  state.nexus.creators.campaigns ??= {};
  state.nexus.studio ??= { layouts: {}, drafts: {} };
  state.nexus.studio.layouts ??= {};
  state.nexus.studio.drafts ??= {};
  state.nexus.sentinel ??= { incidents: [], lastSnapshot: null };
  state.nexus.sentinel.incidents ??= [];
  state.nexus.vault ??= { backups: [] };
  state.nexus.vault.backups ??= [];
  state.nexus.intelligence ??= { snapshots: [], lastSnapshot: null };
  state.nexus.intelligence.snapshots ??= [];
  state.nexus.ai ??= { enabled: false, provider: 'local', lastRequestAt: null, lastError: null };
  state.nexus.audit ??= [];
  if (!Array.isArray(state.nexus.audit)) state.nexus.audit = [];
  if (state.nexus.audit.length > MAX_AUDIT_EVENTS) state.nexus.audit.splice(0, state.nexus.audit.length - MAX_AUDIT_EVENTS);
  state.nexus.integrations ??= {};
  state.nexus.flags ??= { lowMemoryMode: true };
  state.nexus.updatedAt = new Date().toISOString();
  return state.nexus;
}

export async function getNexusState(guildId) {
  const state = await readGuildState(guildId);
  return ensureNexusState(state);
}

export async function mutateNexusState(guildId, mutator) {
  return mutateGuildState(guildId, async (state) => {
    const nexus = ensureNexusState(state);
    const result = await mutator(nexus, state);
    nexus.updatedAt = new Date().toISOString();
    return result;
  });
}

export async function appendNexusAudit(guildId, event = {}) {
  return mutateNexusState(guildId, (nexus) => {
    const record = {
      id: String(event.id ?? randomUUID()),
      at: new Date().toISOString(),
      actorId: event.actorId ? String(event.actorId) : null,
      actorName: event.actorName ? cleanText(event.actorName, 120) : null,
      action: cleanText(event.action ?? 'unknown', 120),
      targetType: event.targetType ? cleanText(event.targetType, 80) : null,
      targetId: event.targetId ? cleanText(event.targetId, 200) : null,
      outcome: cleanText(event.outcome ?? 'success', 40),
      detail: event.detail ? cleanText(event.detail, 1000) : null
    };
    nexus.audit.push(record);
    if (nexus.audit.length > MAX_AUDIT_EVENTS) nexus.audit.splice(0, nexus.audit.length - MAX_AUDIT_EVENTS);
    return record;
  });
}

export async function linkIdentity(guildId, input = {}) {
  assertPlainObject(input, 'identity');
  const discordId = safeDiscordId(input.discordId, 'Discord user ID');
  const discordName = cleanOptionalText(input.discordName, 120);
  const robloxUsername = cleanOptionalText(input.robloxUsername, 64);
  const robloxUserId = input.robloxUserId == null || input.robloxUserId === '' ? null : cleanText(input.robloxUserId, 32);

  return mutateNexusState(guildId, (nexus) => {
    const current = nexus.identity.profiles[discordId] ?? { discordId, aliases: [], createdAt: new Date().toISOString() };
    const aliases = Array.isArray(current.aliases) ? current.aliases.map((value) => cleanText(value, 120)).filter(Boolean).slice(-20) : [];
    if (current.discordName && discordName && current.discordName !== discordName && !aliases.includes(current.discordName)) aliases.push(cleanText(current.discordName, 120));
    const record = {
      ...current,
      discordId,
      aliases: aliases.slice(-20),
      discordName: discordName ?? current.discordName ?? null,
      robloxUsername: robloxUsername ?? current.robloxUsername ?? null,
      robloxUserId: robloxUserId ?? current.robloxUserId ?? null,
      updatedAt: new Date().toISOString()
    };
    nexus.identity.profiles[discordId] = record;
    return record;
  });
}

export async function upsertTenant(guildId, input = {}) {
  assertPlainObject(input, 'network tenant');
  const id = safeDiscordId(input.id ?? input.discordId, 'Discord guild ID');
  const name = cleanText(input.name, 120);
  if (!name) throw Object.assign(new Error('tenant name is required.'), { statusCode: 400 });

  return mutateNexusState(guildId, (nexus) => {
    const current = nexus.network.tenants[id] ?? { id, discordId: id, createdAt: new Date().toISOString() };
    const record = {
      ...current,
      id,
      discordId: id,
      name,
      status: safeStatus(input.status ?? current.status, ['active', 'paused', 'retired'], 'active'),
      owner: cleanOptionalText(input.owner ?? current.owner, 120),
      ownerName: cleanOptionalText(input.ownerName ?? current.ownerName, 120),
      ownerId: cleanOptionalText(input.ownerId ?? current.ownerId, 32),
      members: safeNumber(input.members ?? current.members, { min: 0, max: 10_000_000, fallback: 0 }),
      carries: safeNumber(input.carries ?? current.carries, { min: 0, max: 1_000_000_000, fallback: 0 }),
      health: safeNumber(input.health ?? current.health, { min: 0, max: 100, fallback: 100 }),
      region: cleanOptionalText(input.region ?? current.region, 80),
      lastSync: cleanOptionalText(input.lastSync ?? current.lastSync, 64),
      updatedAt: new Date().toISOString()
    };
    nexus.network.tenants[id] = record;
    return record;
  });
}

export async function upsertCreatorCampaign(guildId, input = {}) {
  assertPlainObject(input, 'creator campaign');
  const id = safeRecordId(input.id ?? randomUUID(), 'campaign id');
  const name = cleanText(input.name, 160);
  if (!name) throw Object.assign(new Error('campaign name is required.'), { statusCode: 400 });

  return mutateNexusState(guildId, (nexus) => {
    const current = nexus.creators.campaigns[id] ?? { id, createdAt: new Date().toISOString() };
    const record = {
      ...current,
      id,
      name,
      creator: cleanOptionalText(input.creator ?? input.creatorName ?? current.creator ?? current.creatorName, 120),
      creatorName: cleanOptionalText(input.creatorName ?? input.creator ?? current.creatorName ?? current.creator, 120),
      creatorId: cleanOptionalText(input.creatorId ?? current.creatorId, 200),
      platform: cleanOptionalText(input.platform ?? current.platform, 80),
      audience: safeNumber(input.audience ?? input.followers ?? current.audience, { min: 0, max: 1_000_000_000, fallback: 0 }),
      referrals: safeNumber(input.referrals ?? current.referrals, { min: 0, max: 1_000_000_000, fallback: 0 }),
      events: safeNumber(input.events ?? input.eventCount ?? current.events, { min: 0, max: 1_000_000, fallback: 0 }),
      url: input.url !== undefined || input.campaignUrl !== undefined ? safeHttpUrl(input.url ?? input.campaignUrl) : (current.url ?? null),
      avatarUrl: input.avatarUrl !== undefined ? safeHttpUrl(input.avatarUrl) : (current.avatarUrl ?? null),
      status: safeStatus(input.status ?? current.status, ['active', 'paused', 'completed', 'draft'], 'active'),
      startDate: cleanOptionalText(input.startDate ?? current.startDate, 64),
      endDate: cleanOptionalText(input.endDate ?? current.endDate, 64),
      updatedAt: new Date().toISOString()
    };
    nexus.creators.campaigns[id] = record;
    return record;
  });
}

export async function upsertStudioLayout(guildId, input = {}) {
  assertPlainObject(input, 'studio layout');
  const id = safeRecordId(input.id ?? randomUUID(), 'layout id');
  const name = cleanText(input.name, 160);
  if (!name) throw Object.assign(new Error('layout name is required.'), { statusCode: 400 });

  return mutateNexusState(guildId, (nexus) => {
    const current = nexus.studio.layouts[id] ?? { id, createdAt: new Date().toISOString(), version: 1 };
    const record = {
      ...current,
      id,
      name,
      type: cleanOptionalText(input.type ?? current.type, 80) ?? 'panel',
      target: cleanOptionalText(input.target ?? current.target, 200),
      status: safeStatus(input.status ?? current.status, ['draft', 'published', 'archived'], 'draft'),
      version: safeNumber(input.version ?? current.version, { min: 1, max: 1_000_000, fallback: 1 }),
      publishedAt: cleanOptionalText(input.publishedAt ?? current.publishedAt, 64),
      updatedAt: new Date().toISOString()
    };
    nexus.studio.layouts[id] = record;
    return record;
  });
}
