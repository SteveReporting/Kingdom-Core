import { PermissionFlagsBits } from 'discord.js';
import { CARRIER_KEYS, STAFF_KEYS } from '../config/blueprint.js';
import { appendKingdomLedger, ensureEcosystemState } from './ecosystemV1.js';

export const KINGDOM_GUILD_ID = '1546168545275150486';

const CAPABILITY_DEFINITIONS = Object.freeze([
  ['guild.member', 'Guild member', 'Account is an active Kingdom Carries Discord member.', 'low', 'Identity'],
  ['carry.view', 'View carries', 'View carry operations allowed for this account.', 'low', 'Carries'],
  ['carry.request', 'Request carries', 'Create a carry request for the signed-in member.', 'low', 'Carries'],
  ['carry.claim', 'Claim carries', 'Claim an open carry as the signed-in carrier.', 'operational', 'Carries'],
  ['carry.start', 'Start carries', 'Start a carry assigned to the signed-in carrier.', 'operational', 'Carries'],
  ['carry.complete', 'Complete carries', 'Mark an assigned carry complete.', 'operational', 'Carries'],
  ['carry.return', 'Return carries', 'Return an assigned carry to the open pool.', 'operational', 'Carries'],
  ['carry.manage', 'Manage all carries', 'Manage and reassign carry operations beyond the actor’s own assignment.', 'sensitive', 'Carries'],
  ['treasury.view', 'View Treasury', 'View authorized Treasury records.', 'low', 'Treasury'],
  ['treasury.request', 'Request Treasury assets', 'Submit a Treasury request.', 'low', 'Treasury'],
  ['treasury.manage_inventory', 'Manage Treasury inventory', 'Add and adjust recorded Treasury inventory.', 'sensitive', 'Treasury'],
  ['treasury.manage_loans', 'Manage Treasury loans', 'Create, return and resolve Treasury loans.', 'sensitive', 'Treasury'],
  ['treasury.approve', 'Approve Treasury requests', 'Approve or reject Treasury requests.', 'critical', 'Treasury'],
  ['treasury.history', 'View Treasury history', 'View authorized Treasury operational history.', 'operational', 'Treasury'],
  ['vault.view', 'View Vault', 'View authorized Kingdom Vault records.', 'low', 'Vault & Asset Bank'],
  ['vault.manage', 'Manage Vault', 'Manage authorized Vault custody records.', 'sensitive', 'Vault & Asset Bank'],
  ['assetbank.view', 'View Asset Bank', 'View authorized Asset Bank records.', 'low', 'Vault & Asset Bank'],
  ['assetbank.manage', 'Manage Asset Bank', 'Review and manage approved Asset Bank operations.', 'critical', 'Vault & Asset Bank'],
  ['marketplace.create', 'Create Marketplace listings', 'Publish a listing as the signed-in member.', 'low', 'Marketplace & Exchange'],
  ['marketplace.manage_own', 'Manage own Marketplace listings', 'Close or mark the actor’s own listing.', 'low', 'Marketplace & Exchange'],
  ['marketplace.moderate', 'Moderate Marketplace', 'Moderate listings created by other members.', 'sensitive', 'Marketplace & Exchange'],
  ['exchange.create', 'Create Exchange offers', 'Publish HAVE/WANT Exchange offers.', 'low', 'Marketplace & Exchange'],
  ['exchange.manage_own', 'Manage own Exchange offers', 'Close the actor’s own Exchange offers.', 'low', 'Marketplace & Exchange'],
  ['exchange.moderate', 'Moderate Exchange', 'Moderate Exchange offers created by others.', 'sensitive', 'Marketplace & Exchange'],
  ['applications.view', 'View applications', 'View application records allowed to the reviewer.', 'operational', 'Applications'],
  ['applications.review', 'Review applications', 'Score and annotate applications without final acceptance authority.', 'sensitive', 'Applications'],
  ['applications.decide', 'Decide applications', 'Accept or reject applications.', 'critical', 'Applications'],
  ['tickets.view', 'View tickets', 'View support tickets allowed to staff.', 'operational', 'Tickets & Events'],
  ['tickets.manage', 'Manage tickets', 'Claim, escalate and resolve tickets.', 'sensitive', 'Tickets & Events'],
  ['events.create', 'Create events', 'Create Kingdom events.', 'sensitive', 'Tickets & Events'],
  ['events.manage', 'Manage events', 'Edit or cancel Kingdom events.', 'sensitive', 'Tickets & Events'],
  ['carriers.view', 'View carrier operations', 'View carrier operational records.', 'operational', 'Carriers & Members'],
  ['carriers.manage', 'Manage carriers', 'Manage carrier status and assignments.', 'sensitive', 'Carriers & Members'],
  ['carriers.verify', 'Verify carriers', 'Record carrier trial verification decisions.', 'critical', 'Carriers & Members'],
  ['members.view', 'View member operations', 'View staff-safe member operational context.', 'operational', 'Carriers & Members'],
  ['members.manage', 'Manage members', 'Perform authorized member-management actions.', 'critical', 'Carriers & Members'],
  ['contracts.create', 'Create Contracts', 'Create structured Kingdom agreements.', 'sensitive', 'Contracts & Ledger'],
  ['contracts.manage', 'Manage Contracts', 'Complete or cancel Kingdom agreements.', 'sensitive', 'Contracts & Ledger'],
  ['notifications.send', 'Send notifications', 'Send authorized Kingdom notifications.', 'sensitive', 'Contracts & Ledger'],
  ['ledger.staff_read', 'Read staff Ledger', 'Read the permission-filtered staff Ledger.', 'sensitive', 'Contracts & Ledger'],
  ['labs.run', 'Run Labs simulations', 'Run non-mutating Kingdom Labs simulations.', 'sensitive', 'Administration'],
  ['studio.manage', 'Manage Studio', 'Manage safe declarative Studio surfaces.', 'critical', 'Administration'],
  ['factory.manage', 'Manage Factory', 'Manage safe predefined Factory products.', 'critical', 'Administration'],
  ['website.content.edit', 'Edit website content', 'Edit approved website text and announcements.', 'sensitive', 'Website'],
  ['website.navigation.edit', 'Edit website navigation', 'Configure safe navigation visibility.', 'critical', 'Website'],
  ['website.modules.manage', 'Manage website modules', 'Configure approved HQ module visibility.', 'critical', 'Website'],
  ['website.permissions.manage', 'Manage website permissions', 'Change Discord role to website capability mappings.', 'critical', 'Website'],
  ['website.settings.manage', 'Manage website settings', 'Change approved HQ settings and maintenance state.', 'critical', 'Website'],
  ['admin.staff', 'Staff administration', 'Access the staff operations workspace.', 'sensitive', 'Administration'],
  ['owner.full_access', 'Discord owner', 'Reserved exclusively for the current Discord guild owner. It cannot be mapped to a role.', 'critical', 'Owner'],
  // Compatibility capabilities used by existing ecosystem services.
  ['identity.read.self', 'Read own identity', 'Read the actor’s own Kingdom identity.', 'low', 'Compatibility'],
  ['notifications.read.self', 'Read own notifications', 'Read the actor’s notifications.', 'low', 'Compatibility'],
  ['notifications.update.self', 'Update own notifications', 'Mark the actor’s notifications read.', 'low', 'Compatibility'],
  ['carry.read.self', 'Read own carries', 'Read the actor’s carry records.', 'low', 'Compatibility'],
  ['carry.read.assigned', 'Read assigned carries', 'Read carries assigned to the actor.', 'low', 'Compatibility'],
  ['carry.control.assigned', 'Control assigned carries', 'Control carries assigned to the actor.', 'operational', 'Compatibility'],
  ['carry.read.all', 'Read all carries', 'Read all carry operations.', 'sensitive', 'Compatibility'],
  ['carry.control.all', 'Control all carries', 'Control all carry operations.', 'critical', 'Compatibility'],
  ['carrier.read.self', 'Read own carrier profile', 'Read the actor’s carrier profile.', 'low', 'Compatibility'],
  ['market.create', 'Create market listing', 'Compatibility Marketplace create permission.', 'low', 'Compatibility'],
  ['market.close.self', 'Close own market listing', 'Compatibility Marketplace close permission.', 'low', 'Compatibility'],
  ['market.moderate', 'Moderate market', 'Compatibility Marketplace moderation permission.', 'sensitive', 'Compatibility'],
  ['referral.read.self', 'Read own referrals', 'Read the actor’s referrals.', 'low', 'Compatibility'],
  ['referral.create', 'Create referrals', 'Create referral attribution.', 'low', 'Compatibility'],
  ['contract.read.self', 'Read own Contracts', 'Read Contracts the actor is party to.', 'low', 'Compatibility'],
  ['contract.sign.self', 'Sign own Contracts', 'Acknowledge Contracts the actor is party to.', 'low', 'Compatibility'],
  ['contract.manage', 'Manage Contracts (compatibility)', 'Compatibility Contract management permission.', 'sensitive', 'Compatibility'],
  ['gateway.resolve', 'Resolve Gateway links', 'Resolve safe Kingdom Gateway destinations.', 'low', 'Compatibility'],
  ['gateway.manage', 'Manage Gateway links', 'Create safe Kingdom Gateway links.', 'sensitive', 'Compatibility'],
  ['search.public', 'Search public data', 'Search public Kingdom data.', 'low', 'Compatibility'],
  ['search.carrier', 'Search carrier data', 'Search carrier-safe Kingdom data.', 'operational', 'Compatibility'],
  ['search.staff', 'Search staff data', 'Search staff-authorized Kingdom data.', 'sensitive', 'Compatibility'],
  ['identity.read.staff', 'Read staff identity context', 'Read staff-safe identity context.', 'sensitive', 'Compatibility'],
  ['treasury.read', 'Read Treasury (compatibility)', 'Compatibility Treasury read permission.', 'operational', 'Compatibility'],
  ['treasury.manage', 'Manage Treasury (compatibility)', 'Compatibility Treasury management permission.', 'critical', 'Compatibility'],
  ['ledger.read', 'Read Ledger (compatibility)', 'Compatibility Ledger permission.', 'sensitive', 'Compatibility'],
  ['relay.read', 'Read Relay', 'Read permission-filtered Relay events.', 'sensitive', 'Compatibility'],
  ['forge.manage', 'Manage Forge', 'Manage authorized Forge workflows and cases.', 'critical', 'Compatibility'],
  ['extensions.manage', 'Manage Extensions', 'Manage trusted Core extension state.', 'critical', 'Compatibility'],
  ['timemachine.capture', 'Use Time Machine', 'Capture and compare Time Machine snapshots.', 'critical', 'Compatibility'],
  ['decision.read', 'Read Decision Engine', 'Read deterministic Kingdom recommendations.', 'operational', 'Compatibility'],
  ['trust.read.staff', 'Read staff Trust context', 'Read staff-authorized Trust signals.', 'sensitive', 'Compatibility'],
]);

export const KINGDOM_CAPABILITIES = Object.freeze(CAPABILITY_DEFINITIONS.map(([id]) => id));
const CAPABILITY_SET = new Set(KINGDOM_CAPABILITIES);

export const CAPABILITY_METADATA = Object.freeze(CAPABILITY_DEFINITIONS.map(([id, name, description, risk, group]) => ({ id, name, description, risk, group })));

const MEMBER_DEFAULTS = Object.freeze([
  'guild.member', 'carry.view', 'carry.request', 'treasury.view', 'treasury.request', 'vault.view', 'assetbank.view',
  'marketplace.create', 'marketplace.manage_own', 'exchange.create', 'exchange.manage_own',
  'identity.read.self', 'notifications.read.self', 'notifications.update.self', 'carry.read.self',
  'market.create', 'market.close.self', 'referral.read.self', 'referral.create', 'contract.read.self',
  'contract.sign.self', 'gateway.resolve', 'search.public'
]);

const CARRIER_DEFAULTS = Object.freeze([
  'carry.view', 'carry.claim', 'carry.start', 'carry.complete', 'carry.return', 'carriers.view',
  'carry.read.assigned', 'carry.control.assigned', 'carrier.read.self', 'search.carrier'
]);

const STAFF_DEFAULTS = Object.freeze([
  'admin.staff', 'carry.view', 'carry.manage', 'treasury.view', 'applications.view', 'tickets.view', 'carriers.view', 'members.view',
  'identity.read.staff', 'notifications.send', 'carry.read.all', 'carry.control.all', 'market.moderate', 'treasury.read',
  'treasury.manage', 'contract.manage', 'gateway.manage', 'ledger.read', 'relay.read', 'forge.manage', 'studio.manage',
  'factory.manage', 'extensions.manage', 'labs.run', 'timemachine.capture', 'decision.read', 'search.staff', 'trust.read.staff'
]);

export const CAPABILITY_PRESETS = Object.freeze({
  Carrier: CARRIER_DEFAULTS,
  'Trial Carrier': ['carry.view', 'carry.claim', 'carriers.view', 'carry.read.assigned', 'carrier.read.self'],
  Treasurer: ['treasury.view', 'treasury.manage_inventory', 'treasury.manage_loans', 'treasury.approve', 'treasury.history', 'vault.view', 'vault.manage', 'assetbank.view', 'assetbank.manage', 'treasury.read', 'treasury.manage', 'forge.manage'],
  'Application Reviewer': ['applications.view', 'applications.review'],
  Moderator: ['tickets.view', 'tickets.manage', 'marketplace.moderate', 'market.moderate'],
  'Carrier Manager': ['carry.view', 'carry.manage', 'carriers.view', 'carriers.manage', 'carriers.verify', 'carry.read.all', 'carry.control.all'],
  Administrator: ['admin.staff', 'members.view', 'members.manage', 'notifications.send', 'ledger.staff_read', 'ledger.read']
});

function roleIds(state, keys) {
  return keys.map((key) => state.setup?.roles?.[key]).filter(Boolean);
}

function hasAnyRole(member, ids) {
  return ids.some((id) => member?.roles?.cache?.has?.(id));
}

export function ensureKingdomKeyState(state) {
  const eco = ensureEcosystemState(state);
  eco.key ??= { version: 1, roleMappings: {}, websiteSettings: {}, updatedAt: new Date().toISOString() };
  eco.key.roleMappings ??= {};
  eco.key.websiteSettings ??= {};
  eco.key.version = 1;
  return eco.key;
}

export function isGuildOwner(member) {
  return Boolean(member?.guild?.ownerId && member.guild.ownerId === member.id);
}

export function isEcosystemCarrier(member, state) {
  if (!member) return false;
  const mapped = capabilitiesForMember(member, state);
  return mapped.includes('carry.claim') || mapped.includes('carry.manage') || mapped.includes('owner.full_access');
}

export function isEcosystemStaff(member, state) {
  if (!member) return false;
  const mapped = capabilitiesForMember(member, state);
  return mapped.includes('admin.staff') || mapped.includes('owner.full_access');
}

export function capabilitiesForMember(member, state) {
  if (!member) return [];
  const key = ensureKingdomKeyState(state);
  const caps = new Set(MEMBER_DEFAULTS);

  // Preserve existing configured Kingdom roles while moving authorization to explicit capabilities.
  if (hasAnyRole(member, roleIds(state, CARRIER_KEYS))) for (const cap of CARRIER_DEFAULTS) caps.add(cap);
  if (hasAnyRole(member, roleIds(state, STAFF_KEYS)) || member.permissions?.has?.(PermissionFlagsBits.Administrator)) {
    for (const cap of STAFF_DEFAULTS) caps.add(cap);
  }

  for (const roleId of member.roles?.cache?.keys?.() ?? []) {
    const mapped = key.roleMappings[roleId];
    for (const cap of mapped?.capabilities ?? []) if (CAPABILITY_SET.has(cap) && cap !== 'owner.full_access') caps.add(cap);
  }

  if (isGuildOwner(member)) {
    for (const cap of KINGDOM_CAPABILITIES) caps.add(cap);
    caps.add('owner.full_access');
  }
  return [...caps].sort();
}

export function memberCan(member, state, capability) {
  if (isGuildOwner(member)) return true;
  return capabilitiesForMember(member, state).includes(capability);
}

function safeRole(role) {
  return {
    id: role.id,
    name: role.name,
    color: role.color ? `#${role.color.toString(16).padStart(6, '0')}` : null,
    iconUrl: role.iconURL?.({ size: 64 }) ?? null,
    position: role.position,
    managed: Boolean(role.managed)
  };
}

export function kingdomKeySession(guild, state, member) {
  const owner = isGuildOwner(member);
  const roles = [...member.roles.cache.values()]
    .filter((role) => role.id !== guild.id)
    .sort((a, b) => b.position - a.position)
    .map(safeRole);
  return {
    authenticated: true,
    guild: { id: guild.id, member: true, owner },
    user: {
      id: member.id,
      displayName: member.displayName,
      avatarUrl: member.displayAvatarURL?.({ size: 128 }) ?? null
    },
    roles,
    capabilities: capabilitiesForMember(member, state),
    refreshedAt: new Date().toISOString()
  };
}

export function kingdomKeyRegistry() {
  const groups = {};
  for (const item of CAPABILITY_METADATA.filter((x) => x.group !== 'Compatibility')) {
    groups[item.group] ??= [];
    groups[item.group].push(item);
  }
  return { guildId: KINGDOM_GUILD_ID, capabilities: CAPABILITY_METADATA, groups, presets: CAPABILITY_PRESETS };
}

export function listConfigurableGuildRoles(guild) {
  return [...guild.roles.cache.values()]
    .filter((role) => role.id !== guild.id && !role.managed)
    .sort((a, b) => b.position - a.position)
    .map(safeRole);
}

export function getRoleMappings(state) {
  const key = ensureKingdomKeyState(state);
  return structuredClone(key.roleMappings);
}

export function setRoleMapping(state, actorId, roleId, capabilities, role = null) {
  const key = ensureKingdomKeyState(state);
  const before = key.roleMappings[roleId] ? structuredClone(key.roleMappings[roleId]) : null;
  const cleanCaps = [...new Set(Array.isArray(capabilities) ? capabilities.filter((cap) => CAPABILITY_SET.has(cap) && cap !== 'owner.full_access') : [])].sort();
  if (cleanCaps.length) {
    key.roleMappings[roleId] = {
      roleId,
      roleName: role?.name ?? before?.roleName ?? null,
      capabilities: cleanCaps,
      updatedAt: new Date().toISOString(),
      updatedBy: actorId
    };
  } else {
    delete key.roleMappings[roleId];
  }
  key.updatedAt = new Date().toISOString();
  appendKingdomLedger(state, 'kingdom_key.role_mapping_changed', actorId, roleId, {
    before: before?.capabilities ?? [],
    after: cleanCaps,
    roleName: role?.name ?? before?.roleName ?? null
  });
  return key.roleMappings[roleId] ?? { roleId, capabilities: [] };
}

const WEBSITE_SETTING_KEYS = new Set([
  'heroHeadline', 'heroSubtitle', 'announcement', 'maintenanceMessage', 'maintenanceEnabled',
  'featuredModules', 'navigationVisibility', 'moduleVisibility'
]);

export function getWebsiteSettings(state) {
  return structuredClone(ensureKingdomKeyState(state).websiteSettings);
}

export function updateWebsiteSettings(state, actorId, patch = {}) {
  const key = ensureKingdomKeyState(state);
  const before = structuredClone(key.websiteSettings);
  for (const [name, value] of Object.entries(patch ?? {})) {
    if (!WEBSITE_SETTING_KEYS.has(name)) continue;
    if (typeof value === 'string') key.websiteSettings[name] = value.trim().slice(0, 2000);
    else if (typeof value === 'boolean') key.websiteSettings[name] = value;
    else if (Array.isArray(value)) key.websiteSettings[name] = value.slice(0, 50).map((x) => String(x).slice(0, 100));
    else if (value && typeof value === 'object') key.websiteSettings[name] = Object.fromEntries(Object.entries(value).slice(0, 100).map(([k, v]) => [String(k).slice(0, 100), Boolean(v)]));
  }
  key.updatedAt = new Date().toISOString();
  appendKingdomLedger(state, 'kingdom_key.website_settings_changed', actorId, null, { before, after: key.websiteSettings });
  return structuredClone(key.websiteSettings);
}
