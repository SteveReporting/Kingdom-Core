import { mutateGuildState, readGuildState } from '../storage/store.js';
import { NEXUS_PRODUCTS, NEXUS_VERSION } from './catalog.js';

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
    integrations: {},
    flags: { lowMemoryMode: true }
  };
}

export function ensureNexusState(state) {
  if (!state.nexus || typeof state.nexus !== 'object') state.nexus = blankNexus();
  state.nexus.schema = 1;
  state.nexus.version = NEXUS_VERSION;
  state.nexus.products ??= {};
  for (const product of NEXUS_PRODUCTS) {
    state.nexus.products[product.slug] ??= { enabled: true, status: 'ready' };
  }
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

export async function linkIdentity(guildId, { discordId, discordName = null, robloxUsername = null, robloxUserId = null }) {
  if (!discordId) throw new Error('discordId is required');
  return mutateNexusState(guildId, (nexus) => {
    const current = nexus.identity.profiles[discordId] ?? {
      discordId,
      aliases: [],
      createdAt: new Date().toISOString()
    };
    if (current.discordName && discordName && current.discordName !== discordName && !current.aliases.includes(current.discordName)) {
      current.aliases.push(current.discordName);
    }
    current.discordName = discordName ?? current.discordName ?? null;
    current.robloxUsername = robloxUsername ?? current.robloxUsername ?? null;
    current.robloxUserId = robloxUserId ?? current.robloxUserId ?? null;
    current.updatedAt = new Date().toISOString();
    nexus.identity.profiles[discordId] = current;
    return current;
  });
}

export async function upsertTenant(guildId, tenant) {
  if (!tenant?.id || !tenant?.name) throw new Error('tenant id and name are required');
  return mutateNexusState(guildId, (nexus) => {
    const record = {
      ...(nexus.network.tenants[tenant.id] ?? {}),
      ...tenant,
      id: String(tenant.id),
      name: String(tenant.name),
      updatedAt: new Date().toISOString()
    };
    nexus.network.tenants[record.id] = record;
    return record;
  });
}

export async function upsertCreatorCampaign(guildId, campaign) {
  const id = String(campaign?.id ?? crypto.randomUUID());
  if (!campaign?.name) throw new Error('campaign name is required');
  return mutateNexusState(guildId, (nexus) => {
    const record = {
      ...(nexus.creators.campaigns[id] ?? {}),
      ...campaign,
      id,
      name: String(campaign.name),
      updatedAt: new Date().toISOString()
    };
    nexus.creators.campaigns[id] = record;
    return record;
  });
}

export async function upsertStudioLayout(guildId, layout) {
  const id = String(layout?.id ?? crypto.randomUUID());
  if (!layout?.name) throw new Error('layout name is required');
  return mutateNexusState(guildId, (nexus) => {
    const record = {
      ...(nexus.studio.layouts[id] ?? {}),
      ...layout,
      id,
      name: String(layout.name),
      version: Number(layout.version ?? nexus.studio.layouts[id]?.version ?? 1),
      updatedAt: new Date().toISOString()
    };
    nexus.studio.layouts[id] = record;
    return record;
  });
}
