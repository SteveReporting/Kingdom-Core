import assert from 'node:assert/strict';
import {
  getMemberAchievements,
  getMemberQuestBoard,
  getPublicApplications,
  getPublicEvent,
  getPublicEvents,
  getPublicQuestBoard,
  getPublicSystems,
  getPublicTreasury
} from '../src/services/webPortalV4.js';

const userId = '123456789012345678';
const state = {
  platform: {
    schemaVersion: 10,
    release: '10.1-realm-intelligence',
    featureFlags: { questEngine: true, marketplace: true, analytics: true },
    v10: {
      domains: {
        ai: { enabled: false },
        carryOperations: { enabled: true }
      }
    }
  },
  eventsV4: {
    events: {
      'EV-1': {
        id: 'EV-1',
        title: 'Friday Raid',
        description: 'Run together.',
        startsAt: '2026-09-13T19:00:00.000Z',
        status: 'scheduled',
        rsvp: { going: ['1', '2'], maybe: ['3'], no: [] }
      }
    }
  },
  questsV4: {
    generatedAt: '2026-09-12',
    daily: [{ id: 'D-1', name: 'Answer the Call', description: 'Carry', target: 3, rewardXp: 75 }],
    weekly: [{ id: 'W-1', name: 'Knight of the Week', description: 'Help', target: 25, rewardXp: 500 }],
    community: [{ id: 'C-1', name: "King's Bounty", description: 'Together', target: 100, rewardXp: 1500, progress: 12 }],
    progress: { [userId]: { 'D-1': 2 } },
    completed: { [userId]: { 'W-1': { completedAt: '2026-09-12T20:00:00.000Z' } } }
  },
  identities: {
    [userId]: {
      userId,
      kingdomXp: 1200,
      prestige: 1,
      stats: { carriesReceived: 10, carriesCompleted: 4, quests: 2, trades: 1 },
      achievements: ['First Carry', 'Realm Regular'],
      titles: ['Veteran of the Realm']
    }
  },
  treasuryV4: {
    items: { A: { id: 'A', name: 'Legendary Staff', quantity: 2, available: 1, notes: 'Tracked' } },
    loans: { L: { status: 'loaned' } },
    requests: { R: { status: 'pending' } },
    history: [{ type: 'seed' }]
  },
  applications: {}
};

assert.equal(getPublicEvents(state).length, 1);
assert.equal(getPublicEvent(state, 'EV-1').rsvp.going, 2);
assert.equal(getPublicQuestBoard(state).community[0].progress, 12);
assert.equal(getMemberQuestBoard(state, userId).daily[0].progress, 2);
assert.equal(getMemberQuestBoard(state, userId).weekly[0].completed, true);
assert.deepEqual(getMemberAchievements(state, userId).achievements, ['First Carry', 'Realm Regular']);
assert.equal(getPublicTreasury(state).totals.activeLoans, 1);
assert.equal(getPublicApplications(state).forms.length, 3);

const systems = getPublicSystems(state);
assert.equal(systems.approvedSystems, 389);
assert.equal(systems.domains.find((domain) => domain.key === 'ai').enabled, false);
assert.ok(systems.domains.some((domain) => domain.key === 'webGrowth' && domain.capabilities.includes('web-calendar')));

console.log('Web portal self-test passed.');
