import { getNexusState, mutateNexusState } from './state.js';
import { safeDiscordId, safeRecordId } from './validation.js';

export async function removeTenant(guildId, id) {
  const target = safeDiscordId(id, 'tenant Discord guild ID');
  return mutateNexusState(guildId, (nexus) => {
    const current = nexus.network?.tenants?.[target];
    if (!current) throw Object.assign(new Error('tenant not found.'), { statusCode: 404 });
    delete nexus.network.tenants[target];
    return current;
  });
}

export async function unlinkIdentity(guildId, discordId) {
  const target = safeDiscordId(discordId, 'Discord user ID');
  return mutateNexusState(guildId, (nexus) => {
    const current = nexus.identity?.profiles?.[target];
    if (!current) throw Object.assign(new Error('identity profile not found.'), { statusCode: 404 });
    delete nexus.identity.profiles[target];
    return current;
  });
}

export async function removeCompanionBuild(guildId, id) {
  const target = safeRecordId(id, 'build id');
  return mutateNexusState(guildId, (nexus) => {
    const current = nexus.companion?.builds?.[target];
    if (!current) throw Object.assign(new Error('build not found.'), { statusCode: 404 });
    delete nexus.companion.builds[target];
    return current;
  });
}

export async function removeCompanionGuide(guildId, id) {
  const target = safeRecordId(id, 'guide id');
  return mutateNexusState(guildId, (nexus) => {
    const current = nexus.companion?.guides?.[target];
    if (!current) throw Object.assign(new Error('guide not found.'), { statusCode: 404 });
    delete nexus.companion.guides[target];
    return current;
  });
}

export async function removeCreatorCampaign(guildId, id) {
  const target = safeRecordId(id, 'campaign id');
  return mutateNexusState(guildId, (nexus) => {
    const current = nexus.creators?.campaigns?.[target];
    if (!current) throw Object.assign(new Error('campaign not found.'), { statusCode: 404 });
    delete nexus.creators.campaigns[target];
    return current;
  });
}

export async function removeStudioLayout(guildId, id) {
  const target = safeRecordId(id, 'layout id');
  return mutateNexusState(guildId, (nexus) => {
    const current = nexus.studio?.layouts?.[target];
    if (!current) throw Object.assign(new Error('layout not found.'), { statusCode: 404 });
    delete nexus.studio.layouts[target];
    if (nexus.studio?.drafts?.[target]) delete nexus.studio.drafts[target];
    return current;
  });
}

export async function listAuditEvents(guildId, limit = 200) {
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 200));
  const nexus = await getNexusState(guildId);
  return [...(nexus.audit ?? [])].slice(-safeLimit).reverse();
}
