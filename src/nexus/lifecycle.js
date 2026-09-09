import { mutateNexusState } from './state.js';

function requireId(value, label = 'id') {
  const id = String(value ?? '').trim();
  if (!id) throw new Error(`${label} is required`);
  return id;
}

export async function removeTenant(guildId, id) {
  const target = requireId(id, 'tenant id');
  return mutateNexusState(guildId, (nexus) => {
    const current = nexus.network?.tenants?.[target];
    if (!current) throw new Error('tenant not found');
    delete nexus.network.tenants[target];
    return current;
  });
}

export async function unlinkIdentity(guildId, discordId) {
  const target = requireId(discordId, 'discord id');
  return mutateNexusState(guildId, (nexus) => {
    const current = nexus.identity?.profiles?.[target];
    if (!current) throw new Error('identity profile not found');
    delete nexus.identity.profiles[target];
    return current;
  });
}

export async function removeCompanionBuild(guildId, id) {
  const target = requireId(id, 'build id');
  return mutateNexusState(guildId, (nexus) => {
    const current = nexus.companion?.builds?.[target];
    if (!current) throw new Error('build not found');
    delete nexus.companion.builds[target];
    return current;
  });
}

export async function removeCompanionGuide(guildId, id) {
  const target = requireId(id, 'guide id');
  return mutateNexusState(guildId, (nexus) => {
    const current = nexus.companion?.guides?.[target];
    if (!current) throw new Error('guide not found');
    delete nexus.companion.guides[target];
    return current;
  });
}

export async function removeCreatorCampaign(guildId, id) {
  const target = requireId(id, 'campaign id');
  return mutateNexusState(guildId, (nexus) => {
    const current = nexus.creators?.campaigns?.[target];
    if (!current) throw new Error('campaign not found');
    delete nexus.creators.campaigns[target];
    return current;
  });
}

export async function removeStudioLayout(guildId, id) {
  const target = requireId(id, 'layout id');
  return mutateNexusState(guildId, (nexus) => {
    const current = nexus.studio?.layouts?.[target];
    if (!current) throw new Error('layout not found');
    delete nexus.studio.layouts[target];
    if (nexus.studio?.drafts?.[target]) delete nexus.studio.drafts[target];
    return current;
  });
}

export async function listAuditEvents(guildId, limit = 200) {
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 200));
  return mutateNexusState(guildId, (nexus) => [...(nexus.audit ?? [])].slice(-safeLimit).reverse());
}
