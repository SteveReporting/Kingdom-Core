export const BRAND = {
  name: 'Kingdom Carries',
  botName: 'Kingdom Core',
  color: 0xd4af37,
  footer: 'Kingdom Core • The system behind the realm.'
};

export const ROLE_BLUEPRINT = [
  { key: 'crown', name: '👑 The Crown', color: 0xf1c40f, hoist: true, permissions: ['Administrator'] },
  { key: 'regent', name: '♛ Regent', color: 0xe5b80b, hoist: true, permissions: ['ManageGuild', 'ManageRoles', 'ManageChannels', 'ManageWebhooks', 'ManageMessages', 'ModerateMembers', 'KickMembers', 'BanMembers', 'ViewAuditLog'] },
  { key: 'council', name: '⚜️ Royal Council', color: 0xc9a227, hoist: true, permissions: ['ManageChannels', 'ManageMessages', 'ModerateMembers', 'KickMembers', 'BanMembers', 'ViewAuditLog'] },
  { key: 'lordCommander', name: '⚔️ Lord Commander', color: 0xb7950b, hoist: true, permissions: ['ManageMessages', 'ModerateMembers', 'KickMembers'] },
  { key: 'chancellor', name: '📜 Chancellor', color: 0xb7950b, hoist: true, permissions: ['ManageMessages', 'ManageEvents'] },
  { key: 'steward', name: '🗝️ Steward', color: 0xa88616, hoist: true, permissions: ['ManageMessages'] },
  { key: 'gatekeeper', name: '🔐 Gatekeeper', color: 0x5865f2, hoist: true, permissions: ['ViewAuditLog', 'ManageMessages', 'ModerateMembers'] },

  { key: 'royalGuard', name: '🛡️ Royal Guard', color: 0x992d22, hoist: true, permissions: ['ManageMessages', 'ModerateMembers', 'KickMembers', 'BanMembers'] },
  { key: 'castleGuard', name: '🏰 Castle Guard', color: 0xc27c0e, hoist: true, permissions: ['ManageMessages', 'ModerateMembers', 'KickMembers'] },
  { key: 'watchman', name: '🔭 Watchman', color: 0xe67e22, hoist: true, permissions: ['ManageMessages', 'ModerateMembers'] },
  { key: 'scribe', name: '✒️ Royal Scribe', color: 0x9b59b6, hoist: true, permissions: ['ManageMessages'] },
  { key: 'herald', name: '📯 Herald', color: 0x3498db, hoist: true, permissions: ['ManageMessages', 'ManageEvents'] },
  { key: 'courtMage', name: '🔮 Court Mage', color: 0x71368a, hoist: true, permissions: ['ManageWebhooks'] },

  { key: 'royalChampion', name: '🏆 Royal Champion', color: 0xf1c40f, hoist: true, permissions: [] },
  { key: 'knightCaptain', name: '🗡️ Knight Captain', color: 0x95a5a6, hoist: true, permissions: ['ManageMessages'] },
  { key: 'royalKnight', name: '⚔️ Royal Knight', color: 0xbcc0c0, hoist: true, permissions: [] },
  { key: 'knight', name: '⚔️ Knight', color: 0x99aab5, hoist: true, permissions: [] },
  { key: 'squireCarrier', name: '🛡️ Squire • Carrier Trial', color: 0x7f8c8d, hoist: false, permissions: [] },

  { key: 'founding', name: '🏛️ Founding Citizen', color: 0xd4af37, hoist: false, permissions: [] },
  { key: 'championRealm', name: '🏆 Champion of the Realm', color: 0xf1c40f, hoist: false, permissions: [] },
  { key: 'prince', name: '👑 Prince', color: 0xe91e63, hoist: false, permissions: [] },
  { key: 'duke', name: '⚜️ Duke', color: 0x9b59b6, hoist: false, permissions: [] },
  { key: 'count', name: '🏵️ Count', color: 0x8e44ad, hoist: false, permissions: [] },
  { key: 'baron', name: '🦚 Baron', color: 0x2980b9, hoist: false, permissions: [] },
  { key: 'noble', name: '💠 Noble', color: 0x3498db, hoist: false, permissions: [] },
  { key: 'citizen', name: '🏘️ Citizen', color: 0x2ecc71, hoist: false, permissions: [] },
  { key: 'traveller', name: '🧭 Traveller', color: 0x95a5a6, hoist: false, permissions: [] },

  { key: 'houseDrakon', name: '🐉 House Drakon', color: 0xe74c3c, hoist: false, permissions: [] },
  { key: 'houseLeonis', name: '🦁 House Leonis', color: 0xf39c12, hoist: false, permissions: [] },
  { key: 'houseAether', name: '🦅 House Aether', color: 0x3498db, hoist: false, permissions: [] },
  { key: 'houseFenrir', name: '🐺 House Fenrir', color: 0x607d8b, hoist: false, permissions: [] },

  { key: 'carryPing', name: '🔔 Carry Pings', color: 0x5865f2, hoist: false, permissions: [] },
  { key: 'eventPing', name: '🎪 Event Pings', color: 0xeb459e, hoist: false, permissions: [] },
  { key: 'marketPing', name: '🏪 Market Pings', color: 0x57f287, hoist: false, permissions: [] },
  { key: 'giveawayPing', name: '🎁 Giveaway Pings', color: 0xf1c40f, hoist: false, permissions: [] },
  { key: 'updatePing', name: '📢 Update Pings', color: 0x3498db, hoist: false, permissions: [] }
];

export const CATEGORY_BLUEPRINT = [
  { key: 'arrival', name: '━━ 👑 ARRIVAL ━━' },
  { key: 'kingdom', name: '━━ 🏰 THE KINGDOM ━━' },
  { key: 'carries', name: '━━ ⚔️ CARRIES ━━' },
  { key: 'progression', name: '━━ 📜 PROGRESSION ━━' },
  { key: 'houses', name: '━━ 🏰 HOUSES ━━' },
  { key: 'market', name: '━━ 💰 MARKET DISTRICT ━━' },
  { key: 'community', name: '━━ 🎪 COMMUNITY ━━' },
  { key: 'support', name: '━━ 🕯️ SUPPORT ━━' },
  { key: 'applications', name: '━━ 📝 APPLICATIONS ━━' },
  { key: 'carrier', name: '━━ 🛡️ KNIGHTS\' QUARTERS ━━', privateFor: 'carriers' },
  { key: 'staff', name: '━━ 👑 ROYAL COUNCIL ━━', privateFor: 'staff' },
  { key: 'security', name: '━━ 🔐 KINGDOM SECURITY ━━', privateFor: 'staff' }
];

export const CHANNEL_BLUEPRINT = [
  { key: 'welcome', category: 'arrival', name: '👑・welcome', type: 'text', readOnly: true },
  { key: 'rules', category: 'arrival', name: '📜・rules', type: 'text', readOnly: true },
  { key: 'announcements', category: 'arrival', name: '📯・announcements', type: 'announcement', readOnly: true },
  { key: 'chooseHouse', category: 'arrival', name: '🏰・choose-your-house', type: 'text', readOnly: true },
  { key: 'roles', category: 'arrival', name: '🔔・notification-roles', type: 'text', readOnly: true },
  { key: 'serverGuide', category: 'arrival', name: '🗺️・server-guide', type: 'text', readOnly: true },

  { key: 'general', category: 'kingdom', name: '💬・kingdom-chat', type: 'text' },
  { key: 'dqChat', category: 'kingdom', name: '⚔️・dungeon-quest', type: 'text' },
  { key: 'showcase', category: 'kingdom', name: '🏆・loot-showcase', type: 'text' },
  { key: 'media', category: 'kingdom', name: '📸・media', type: 'text' },
  { key: 'help', category: 'kingdom', name: '❓・game-help', type: 'text' },
  { key: 'guides', category: 'kingdom', name: '📚・dq-guides', type: 'text', readOnly: true },

  { key: 'carryBoard', category: 'carries', name: '⚔️・carry-board', type: 'text', readOnly: true },
  { key: 'carryQueue', category: 'carries', name: '⏳・live-queue', type: 'text', readOnly: true },
  { key: 'carryResults', category: 'carries', name: '✅・completed-carries', type: 'text', readOnly: true },
  { key: 'carrySchedule', category: 'carries', name: '📅・carry-schedule', type: 'text', readOnly: true },
  { key: 'carryParty1', category: 'carries', name: '⚔️ Carry Party I', type: 'voice' },
  { key: 'carryParty2', category: 'carries', name: '⚔️ Carry Party II', type: 'voice' },
  { key: 'carryParty3', category: 'carries', name: '⚔️ Carry Party III', type: 'voice' },

  { key: 'quests', category: 'progression', name: '📜・quest-board', type: 'text', readOnly: true },
  { key: 'leaderboards', category: 'progression', name: '🏆・leaderboards', type: 'text', readOnly: true },
  { key: 'achievements', category: 'progression', name: '🎖️・achievements', type: 'text', readOnly: true },
  { key: 'campaigns', category: 'progression', name: '🗺️・campaigns', type: 'text', readOnly: true },
  { key: 'kingdomProgress', category: 'progression', name: '👑・kingdom-progress', type: 'text', readOnly: true },
  { key: 'worldBoss', category: 'progression', name: '☠️・world-boss', type: 'text', readOnly: true },
  { key: 'hallOfFame', category: 'progression', name: '🏛️・hall-of-fame', type: 'text', readOnly: true },

  { key: 'houseHall', category: 'houses', name: '🏰・house-hall', type: 'text', readOnly: true },
  { key: 'drakonChat', category: 'houses', name: '🐉・drakon-hall', type: 'text', accessFor: ['houseDrakon'] },
  { key: 'leonisChat', category: 'houses', name: '🦁・leonis-hall', type: 'text', accessFor: ['houseLeonis'] },
  { key: 'aetherChat', category: 'houses', name: '🦅・aether-hall', type: 'text', accessFor: ['houseAether'] },
  { key: 'fenrirChat', category: 'houses', name: '🐺・fenrir-hall', type: 'text', accessFor: ['houseFenrir'] },

  { key: 'marketplace', category: 'market', name: '🏪・marketplace', type: 'text' },
  { key: 'treasury', category: 'market', name: '💰・royal-treasury', type: 'text', readOnly: true },
  { key: 'tradeHelp', category: 'market', name: '🤝・trade-help', type: 'text' },
  { key: 'priceCheck', category: 'market', name: '💎・price-check', type: 'text' },
  { key: 'tradeProof', category: 'market', name: '🧾・trade-proof', type: 'text' },

  { key: 'events', category: 'community', name: '🎪・events', type: 'text', readOnly: true },
  { key: 'giveaways', category: 'community', name: '🎁・giveaways', type: 'text', readOnly: true },
  { key: 'suggestions', category: 'community', name: '💡・suggestions', type: 'text' },
  { key: 'polls', category: 'community', name: '📊・polls', type: 'text' },
  { key: 'offTopic', category: 'community', name: '🌙・off-topic', type: 'text' },
  { key: 'kingdomHall', category: 'community', name: '🏰 Kingdom Hall', type: 'voice' },
  { key: 'gameNight', category: 'community', name: '🎮 Game Night', type: 'voice' },

  { key: 'supportPanel', category: 'support', name: '🕯️・petition-the-crown', type: 'text', readOnly: true },
  { key: 'faq', category: 'support', name: '📚・royal-archives', type: 'text', readOnly: true },
  { key: 'appeals', category: 'support', name: '⚖️・appeals-info', type: 'text', readOnly: true },
  { key: 'reportInfo', category: 'support', name: '🚨・report-a-member', type: 'text', readOnly: true },

  { key: 'staffApplications', category: 'applications', name: '📝・staff-applications', type: 'text', readOnly: true },
  { key: 'carrierApplications', category: 'applications', name: '⚔️・carrier-applications', type: 'text', readOnly: true },
  { key: 'creatorApplications', category: 'applications', name: '🎥・creator-applications', type: 'text', readOnly: true },

  { key: 'carrierAnnouncements', category: 'carrier', name: '📯・knight-announcements', type: 'text', readOnly: true },
  { key: 'carrierChat', category: 'carrier', name: '⚔️・knight-chat', type: 'text' },
  { key: 'carrierAssignments', category: 'carrier', name: '📋・carry-assignments', type: 'text', readOnly: true },
  { key: 'carrierTrials', category: 'carrier', name: '🛡️・trial-carriers', type: 'text' },
  { key: 'carrierGuides', category: 'carrier', name: '📚・carrier-guides', type: 'text', readOnly: true },
  { key: 'carrierLogs', category: 'carrier', name: '📊・carrier-logs', type: 'text', readOnly: true },
  { key: 'carrierVoice', category: 'carrier', name: '🛡️ Knights Chamber', type: 'voice' },

  { key: 'council', category: 'staff', name: '👑・royal-council', type: 'text' },
  { key: 'staffChat', category: 'staff', name: '🛡️・staff-chat', type: 'text' },
  { key: 'staffCommands', category: 'staff', name: '🤖・staff-commands', type: 'text' },
  { key: 'staffCases', category: 'staff', name: '📁・case-discussion', type: 'text' },
  { key: 'reports', category: 'staff', name: '🚨・reports', type: 'text' },
  { key: 'applicationsReview', category: 'staff', name: '📝・application-review', type: 'text' },
  { key: 'partnerships', category: 'staff', name: '🤝・partnerships', type: 'text' },
  { key: 'staffLogs', category: 'staff', name: '📜・staff-logs', type: 'text', readOnly: true },
  { key: 'modLogs', category: 'staff', name: '🔨・moderation-logs', type: 'text', readOnly: true },
  { key: 'staffVoice', category: 'staff', name: '👑 Council Chamber', type: 'voice' },

  { key: 'securityLog', category: 'security', name: '🔐・security-log', type: 'text', readOnly: true },
  { key: 'auditMirror', category: 'security', name: '👁️・audit-mirror', type: 'text', readOnly: true },
  { key: 'botSecurity', category: 'security', name: '🤖・bot-security', type: 'text', readOnly: true },
  { key: 'raidAlerts', category: 'security', name: '🚨・raid-alerts', type: 'text', readOnly: true }
];

export const HOUSE_KEYS = ['houseDrakon', 'houseLeonis', 'houseAether', 'houseFenrir'];
export const STAFF_KEYS = ['crown', 'regent', 'council', 'lordCommander', 'chancellor', 'steward', 'gatekeeper', 'royalGuard', 'castleGuard', 'watchman', 'scribe', 'herald', 'courtMage'];
export const CARRIER_KEYS = ['royalChampion', 'knightCaptain', 'royalKnight', 'knight', 'squireCarrier'];
export const BOT_ADD_TRUST_KEYS = ['crown', 'regent'];
