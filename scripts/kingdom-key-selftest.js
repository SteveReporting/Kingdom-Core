import assert from 'node:assert/strict';
import {
  capabilitiesForMember,
  ensureKingdomKeyState,
  getRoleMappings,
  isGuildOwner,
  kingdomKeyRegistry,
  kingdomKeySession,
  memberCan,
  setRoleMapping,
  updateWebsiteSettings
} from '../src/services/kingdomKeyV1.js';

const guild = { id: '1546168545275150486', ownerId: '100' };
const roleMap = new Map();
function role(id, name, position = 1) {
  const value = { id, name, position, color: 0, managed: false, iconURL: () => null };
  roleMap.set(id, value);
  return value;
}
role('carrier', 'Carrier', 10);
role('treasurer', 'Treasurer', 20);
role('staff', 'Staff', 30);

function member(id, roles = [], admin = false) {
  const cache = new Map(roles.map((roleId) => [roleId, roleMap.get(roleId)]));
  return {
    id,
    guild,
    displayName: `Member ${id}`,
    displayAvatarURL: () => null,
    roles: { cache },
    permissions: { has: () => admin }
  };
}

const state = {
  setup: { roles: { verifiedCarrier: 'carrier', staff: 'staff' } },
  platform: {},
  identities: {},
  marketV4: { listings: {}, history: [] },
  referralsV4: { referrals: {}, qualified: {} },
  treasuryV4: { items: {}, loans: {}, requests: {}, history: [] },
  carryTickets: {},
  tickets: {}
};
ensureKingdomKeyState(state);

const ordinary = member('200');
assert.equal(memberCan(ordinary, state, 'carry.request'), true);
assert.equal(memberCan(ordinary, state, 'treasury.approve'), false);

const carrier = member('300', ['carrier']);
assert.equal(memberCan(carrier, state, 'carry.claim'), true);
assert.equal(memberCan(carrier, state, 'carry.complete'), true);

setRoleMapping(state, '100', 'treasurer', ['treasury.manage_inventory', 'treasury.approve', 'owner.full_access'], roleMap.get('treasurer'));
const treasurer = member('400', ['treasurer']);
assert.equal(memberCan(treasurer, state, 'treasury.manage_inventory'), true);
assert.equal(memberCan(treasurer, state, 'treasury.approve'), true);
assert.equal(memberCan(treasurer, state, 'owner.full_access'), false);
assert.equal(getRoleMappings(state).treasurer.capabilities.includes('owner.full_access'), false);

const multi = member('500', ['carrier', 'treasurer']);
assert.equal(memberCan(multi, state, 'carry.claim'), true);
assert.equal(memberCan(multi, state, 'treasury.approve'), true);

const adminNotOwner = member('600', [], true);
assert.equal(memberCan(adminNotOwner, state, 'admin.staff'), true);
assert.equal(memberCan(adminNotOwner, state, 'owner.full_access'), false);

const owner = member('100');
assert.equal(isGuildOwner(owner), true);
assert.equal(memberCan(owner, state, 'owner.full_access'), true);
assert.equal(memberCan(owner, state, 'treasury.approve'), true);

const registry = kingdomKeyRegistry();
assert.equal(registry.guildId, guild.id);
assert.ok(registry.capabilities.some((item) => item.id === 'carry.claim'));
assert.ok(registry.capabilities.some((item) => item.id === 'website.permissions.manage' && item.risk === 'critical'));

const session = kingdomKeySession({ ...guild, roles: { cache: roleMap } }, state, multi);
assert.equal(session.guild.member, true);
assert.equal(session.guild.owner, false);
assert.ok(session.capabilities.includes('carry.claim'));
assert.ok(session.capabilities.includes('treasury.approve'));

const settings = updateWebsiteSettings(state, '100', { heroHeadline: 'Kingdom Carries', arbitraryScript: '<script>x</script>', maintenanceEnabled: true });
assert.equal(settings.heroHeadline, 'Kingdom Carries');
assert.equal(settings.maintenanceEnabled, true);
assert.equal('arbitraryScript' in settings, false);
assert.ok(Array.isArray(state.ecosystemV1.ledger.entries));
assert.ok(state.ecosystemV1.ledger.entries.some((entry) => entry.type === 'kingdom_key.role_mapping_changed'));

const caps = capabilitiesForMember(multi, state);
assert.equal(new Set(caps).size, caps.length);

console.log('Kingdom Key self-test passed.');
