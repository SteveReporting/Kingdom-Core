export const V10_HIGHEST_SYSTEM = 390;
export const EXCLUDED_V10_NUMBERS = Object.freeze([385]);
export const V10_FEATURE_COUNT = V10_HIGHEST_SYSTEM - EXCLUDED_V10_NUMBERS.length;

export const V10_DOMAINS = Object.freeze([
  { key: 'carryOperations', start: 1, end: 41, label: 'Carry Operations', engine: 'carry-orchestrator', capabilities: ['matchmaking','party-building','multi-queue','fairness','ETA','instant-fill','overflow','regional-routing','specialists','difficulty','adaptive-parties','recovery','handoffs','checkpoints','timers','benchmarks','stall-detection','no-show-replacement','AFK-protection','grace-rejoin','readiness','launch','completion-proof','disputes','quality','feedback','reliability','priority-rules','abuse-detection','forecasting','coverage','shifts','surge','event-mode','rotations'] },
  { key: 'knightOperations', start: 42, end: 62, label: 'Knight Operations', engine: 'knight-career', capabilities: ['milestones','service-hours','efficiency','consistency','improvement','personal-dashboard','career-path','promotion-readiness','review-packs','academy','mentors','mentor-quality','certifications','load-balancing','fatigue-protection','availability-modes','commendations','royal-commendations','monthly-reviews','season-awards','hall-of-fame'] },
  { key: 'memberIdentity', start: 63, end: 78, label: 'Member Identity & Progression', engine: 'member-passport', capabilities: ['passport','activity-timeline','contribution','reputation','achievements','titles','badges','goals','next-action','guided-journey','onboarding-missions','returning-member-flow','anniversaries','founding-recognition'] },
  { key: 'houses', start: 79, end: 92, label: 'Kingdom Houses', engine: 'house-engine', capabilities: ['house-identity','house-xp','seasons','objectives','carry-challenges','event-challenges','quest-board','captains','council','rivalries','alliances','championships','legacy','health-heatmap'] },
  { key: 'questsRealm', start: 93, end: 114, label: 'Quests, Seasons & Realm Progression', engine: 'quest-engine', capabilities: ['dynamic-quests','community-quests','hidden-quests','chains','weekly-contracts','knight-contracts','staff-missions','house-contracts','emergency-quests','difficulty-scaling','anti-farming','rerolls','streaks','seasons','storyline','progress-track','records','prestige','legacy-points','kingdom-level','realm-upgrades','community-votes'] },
  { key: 'economyMarket', start: 115, end: 140, label: 'Treasury, Lending & Marketplace', engine: 'economy-engine', capabilities: ['ledger','requests','multi-approval','budgets','forecasting','health-score','lending','reservations','borrower-reliability','overdue-alerts','custodians','asset-audits','listings','search','price-history','trends','watchlists','trade-reputation','verified-traders','scam-workflow','trade-disputes','suspicious-trades','exchange-events','giveaway-fairness','contribution-giveaways','bounties'] },
  { key: 'eventsUx', start: 141, end: 180, label: 'Events, Notifications & UX', engine: 'experience-engine', capabilities: ['event-hub','recommendations','RSVP-reliability','waitlists','auto-teams','check-in','event-control','tournaments','leagues','swiss','house-tournaments','MVP','highlights','recaps','performance','dynamic-rewards','suggestion-voting','calendar','timezone-aware','quiet-hours','notification-intelligence','smart-carry-pings','escalation','digests','cooldowns','notification-center','missed-activity','live-status','transparency','knight-dashboard','staff-dashboard','crown-dashboard','member-dashboard','mobile-first','context-actions','zero-command','command-palette','universal-search','quick-actions','recent-actions'] },
  { key: 'applicationsRecruitment', start: 181, end: 194, label: 'Applications & Recruitment', engine: 'application-os', capabilities: ['application-os','triage','rubrics','blind-review','reviewer-calibration','conflict-detection','duplicate-detection','interview-scheduling','scorecards','evidence-packs','appeals','analytics','recruitment-funnel','staffing-forecast'] },
  { key: 'ticketsStaff', start: 195, end: 214, label: 'Tickets & Staff Operations', engine: 'case-engine', capabilities: ['unified-console','ownership','collaboration','SLA','escalation','priority','duplicate-detection','linked-cases','timeline','evidence-locker','resolution-templates','summaries','satisfaction','workload-balancing','availability','duty-rotation','contribution-analytics','burnout-indicator','promotion-evidence','training'] },
  { key: 'securityReliability', start: 215, end: 250, label: 'Security, Safety & Runtime Reliability', engine: 'reliability-engine', capabilities: ['permission-simulator','drift-detection','approval','bot-firewall','bot-quarantine','webhook-registry','unknown-webhooks','risk-score','lockdowns','selective-lockdown','incident-timeline','digital-twin','safe-repair','destructive-approval','snapshots','rollback','permission-tests','integration-tests','staging','feature-flags','house-flags','canary','diagnostics','health-dashboard','crash-recovery','restart-circuit-breaker','resource-guard','low-memory-mode','job-scheduler','background-queue','maintenance-locks','rate-budget','discord-backoff','smart-panel-refresh','event-driven-updates','cold-archive'] },
  { key: 'analyticsGovernance', start: 251, end: 280, label: 'Analytics, Governance & Product Operations', engine: 'analytics-engine', capabilities: ['warehouse','retention','cohorts','engagement-funnel','carry-funnel','abandonment','demand','supply','service-quality','house-health','event-retention','application-quality','referral-quality','growth-sources','creator-campaigns','churn-signals','return-campaigns','kingdom-pulse','weekly-report','monthly-report','historical-records','archive-search','decision-register','policy-versioning','changelog','staff-changelog','known-issues','feature-requests','roadmap-voting','suggestion-lifecycle'] },
  { key: 'knowledge', start: 281, end: 290, label: 'Knowledge & Dungeon Quest Help', engine: 'knowledge-engine', capabilities: ['knowledge-base','context-help','build-advisor','prep-checklist','progression-advisor','item-comparison','guide-library','guide-verification','outdated-guide-detection','FAQ-analytics'] },
  { key: 'ai', start: 291, end: 300, label: 'Optional AI Layer', engine: 'ai-adapter', capabilities: ['helpdesk','carry-assistant','ticket-summary','application-assistant','security-explainer','event-writer','knowledge-search','build-assistant','resource-governor','provider-abstraction'] },
  { key: 'webGrowth', start: 301, end: 341, label: 'Web, Integrations, Partnerships & Growth', engine: 'integration-engine', capabilities: ['status-page','account-linking','web-queue','operations-map','knight-portal','staff-portal','member-passport','house-pages','web-market','web-calendar','transparency-page','discord-oauth','role-sync','websocket','PWA','personal-home','deep-links','QR-check-in','creator-portal','partnerships','cross-guild-events','partner-reputation','inter-guild-tournaments','overflow-partners','alliance-calendar','kingdom-api','outbound-webhooks','integration-permissions','integration-audit','announcement-sync','creator-pages','link-shortener','campaign-codes','referral-trees','milestones','time-capsules','realm-records','record-alerts','kingdom-newspaper','personal-year-review','guild-year-review'] },
  { key: 'legacyPlatform', start: 342, end: 370, label: 'Legacy, Control Plane & Infrastructure', engine: 'platform-engine', capabilities: ['legacy-archive','founding-timeline','system-generations','ops-scoreboard','before-after-analytics','crown-control-plane','emergency-switches','maintenance-mode','read-only-mode','data-export','backups','backup-verification','disaster-recovery','dependency-map','graceful-degradation','offline-buffer','idempotent-migrations','schema-migrations','config-diff','dry-run','approval-migrations','startup-self-test','safe-mode','PM2-circuit-breaker','memory-monitor','CPU-monitor','adaptive-maintenance','resource-budgets','migration-readiness'] },
  { key: 'realmIntelligence', start: 371, end: 390, label: 'Realm Intelligence & Operations', engine: 'realm-intelligence', capabilities: ['kingdom-graph','universal-member-context','operational-anomaly-detection','queue-fairness-auditor','carry-capacity-reservation','standby-knight-network','service-recovery-director','policy-simulation','shadow-mode','permission-compiler','change-impact-analyzer','incident-commander','data-integrity-engine','identity-resolution','dynamic-service-routing','guild-capacity-model','bottleneck-attribution','kingdom-command-search','guarded-realm-autopilot'] }
]);

const EXPLICIT_SYSTEM_NAMES = Object.freeze({
  371: 'Kingdom Graph',
  372: 'Universal Member Context',
  373: 'Operational Anomaly Detection',
  374: 'Queue Fairness Auditor',
  375: 'Carry Capacity Reservation',
  376: 'Standby Knight Network',
  377: 'Service Recovery Director',
  378: 'Policy Simulation Engine',
  379: 'Shadow Mode',
  380: 'Permission Compiler',
  381: 'Change Impact Analyzer',
  382: 'Kingdom Incident Commander',
  383: 'Data Integrity Engine',
  384: 'Identity Resolution Engine',
  386: 'Dynamic Service Routing',
  387: 'Guild Capacity Model',
  388: 'Bottleneck Attribution',
  389: 'Kingdom Command Search',
  390: 'Realm Autopilot — Guarded Operations'
});

export const APPROVED_V10_NUMBERS = Object.freeze(
  Array.from({ length: V10_HIGHEST_SYSTEM }, (_, index) => index + 1)
    .filter((number) => !EXCLUDED_V10_NUMBERS.includes(number))
);

export function v10DomainFor(number) {
  return V10_DOMAINS.find((domain) => number >= domain.start && number <= domain.end) ?? null;
}

export const APPROVED_V10_SYSTEMS = Object.freeze(Object.fromEntries(
  APPROVED_V10_NUMBERS.map((number) => {
    const domain = v10DomainFor(number);
    return [number, {
      number,
      name: EXPLICIT_SYSTEM_NAMES[number] ?? `${domain?.label ?? 'Kingdom Core'} • System ${number}`,
      domain: domain?.key ?? 'unknown',
      engine: domain?.engine ?? 'platform-engine',
      implementation: `shared-engine:${domain?.engine ?? 'platform-engine'}`,
      enabled: true
    }];
  })
));

export const V10_ENGINE_KEYS = Object.freeze([...new Set(V10_DOMAINS.map((domain) => domain.engine))]);
