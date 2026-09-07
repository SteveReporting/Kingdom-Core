const nowIso = () => new Date().toISOString();

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function boundedPush(list, value, max = 5_000) {
  list.push(value);
  if (list.length > max) list.splice(0, list.length - max);
}

export function ensureRealmEnginesV10(state) {
  state.realmV10 ??= {};
  state.realmV10.updatedAt = nowIso();

  state.carryV10 = {
    ...object(state.carryV10),
    config: {
      matchWeights: { reliability: 0.28, specialist: 0.22, availability: 0.2, region: 0.12, workload: 0.1, mentorFit: 0.08 },
      fairness: { longestWaitFirst: true, friendPriorityDisabled: true, graceRejoinMinutes: 10, afkConfirmMinutes: 20 },
      ETA: { enabled: true, confidence: true, sampleWindow: 50 },
      overflow: { enabled: true, targetWaitingPerParty: 6 },
      surge: { enabled: true, threshold: 12 },
      ...object(state.carryV10?.config)
    },
    requests: object(state.carryV10?.requests),
    parties: object(state.carryV10?.parties),
    checkpoints: object(state.carryV10?.checkpoints),
    benchmarks: object(state.carryV10?.benchmarks),
    specialists: object(state.carryV10?.specialists),
    ratings: array(state.carryV10?.ratings),
    anonymousFeedback: array(state.carryV10?.anonymousFeedback),
    disputes: object(state.carryV10?.disputes),
    noShows: object(state.carryV10?.noShows),
    demand: object(state.carryV10?.demand),
    forecasts: object(state.carryV10?.forecasts)
  };

  state.knightsV10 = {
    ...object(state.knightsV10),
    profiles: object(state.knightsV10?.profiles),
    availability: object(state.knightsV10?.availability),
    certifications: object(state.knightsV10?.certifications),
    mentors: object(state.knightsV10?.mentors),
    reviews: object(state.knightsV10?.reviews),
    awards: array(state.knightsV10?.awards),
    hallOfFame: array(state.knightsV10?.hallOfFame),
    career: {
      milestones: [10, 25, 50, 100, 250, 500, 1_000],
      promotionEvidenceRequired: true,
      fatigueWarningMinutes: 180,
      loadBalance: true,
      ...object(state.knightsV10?.career)
    }
  };

  state.membersV10 = {
    ...object(state.membersV10),
    passports: object(state.membersV10?.passports),
    goals: object(state.membersV10?.goals),
    achievements: object(state.membersV10?.achievements),
    titles: object(state.membersV10?.titles),
    badges: object(state.membersV10?.badges),
    reputation: object(state.membersV10?.reputation),
    anniversaries: object(state.membersV10?.anniversaries),
    returning: object(state.membersV10?.returning)
  };

  state.housesV10 = {
    ...object(state.housesV10),
    season: { id: 'season-1', active: true, startedAt: state.housesV10?.season?.startedAt ?? nowIso(), ...object(state.housesV10?.season) },
    xp: object(state.housesV10?.xp),
    objectives: object(state.housesV10?.objectives),
    rivalries: array(state.housesV10?.rivalries),
    alliances: array(state.housesV10?.alliances),
    championships: array(state.housesV10?.championships),
    legacy: object(state.housesV10?.legacy),
    councils: object(state.housesV10?.councils)
  };

  state.questsV10 = {
    ...object(state.questsV10),
    dynamic: object(state.questsV10?.dynamic),
    hidden: object(state.questsV10?.hidden),
    chains: object(state.questsV10?.chains),
    contracts: object(state.questsV10?.contracts),
    community: object(state.questsV10?.community),
    streaks: object(state.questsV10?.streaks),
    rerolls: object(state.questsV10?.rerolls),
    antiFarm: { repeatedActionWindowMinutes: 10, maxIdenticalProgress: 20, ...object(state.questsV10?.antiFarm) },
    realm: { level: 1, legacyPoints: 0, upgrades: [], votes: {}, ...object(state.questsV10?.realm) },
    season: { storylineChapter: 1, records: {}, ...object(state.questsV10?.season) }
  };

  state.economyV10 = {
    ...object(state.economyV10),
    budgets: { events: 0, knights: 0, giveaways: 0, reserve: 0, ...object(state.economyV10?.budgets) },
    spendingRequests: object(state.economyV10?.spendingRequests),
    approvals: object(state.economyV10?.approvals),
    assets: object(state.economyV10?.assets),
    reservations: object(state.economyV10?.reservations),
    custodians: object(state.economyV10?.custodians),
    audits: array(state.economyV10?.audits),
    priceHistory: object(state.economyV10?.priceHistory),
    traderReputation: object(state.economyV10?.traderReputation),
    disputes: object(state.economyV10?.disputes),
    scamReports: object(state.economyV10?.scamReports),
    bounties: object(state.economyV10?.bounties),
    giveawayHistory: array(state.economyV10?.giveawayHistory),
    forecast: object(state.economyV10?.forecast)
  };

  state.eventsV10 = {
    ...object(state.eventsV10),
    recommendations: object(state.eventsV10?.recommendations),
    waitlists: object(state.eventsV10?.waitlists),
    checkIns: object(state.eventsV10?.checkIns),
    teams: object(state.eventsV10?.teams),
    tournaments: object(state.eventsV10?.tournaments),
    leagues: object(state.eventsV10?.leagues),
    highlights: array(state.eventsV10?.highlights),
    recaps: object(state.eventsV10?.recaps),
    performance: object(state.eventsV10?.performance),
    calendar: object(state.eventsV10?.calendar),
    notificationPreferences: object(state.eventsV10?.notificationPreferences),
    digests: object(state.eventsV10?.digests),
    cooldowns: object(state.eventsV10?.cooldowns)
  };

  state.applicationsV10 = {
    ...object(state.applicationsV10),
    records: object(state.applicationsV10?.records),
    rubrics: object(state.applicationsV10?.rubrics),
    reviewerCalibration: object(state.applicationsV10?.reviewerCalibration),
    interviews: object(state.applicationsV10?.interviews),
    appeals: object(state.applicationsV10?.appeals),
    recruitmentSources: object(state.applicationsV10?.recruitmentSources),
    staffingForecast: object(state.applicationsV10?.staffingForecast)
  };

  state.casesV10 = {
    ...object(state.casesV10),
    records: object(state.casesV10?.records),
    ownership: object(state.casesV10?.ownership),
    collaborators: object(state.casesV10?.collaborators),
    evidence: object(state.casesV10?.evidence),
    links: object(state.casesV10?.links),
    SLA: { firstResponseMinutes: 30, escalationMinutes: 120, ...object(state.casesV10?.SLA) },
    resolutionTemplates: object(state.casesV10?.resolutionTemplates),
    satisfaction: array(state.casesV10?.satisfaction),
    staffAvailability: object(state.casesV10?.staffAvailability),
    dutyRotation: object(state.casesV10?.dutyRotation),
    workload: object(state.casesV10?.workload),
    training: object(state.casesV10?.training)
  };

  state.securityV10 = {
    ...object(state.securityV10),
    permissionSimulations: array(state.securityV10?.permissionSimulations),
    approvals: object(state.securityV10?.approvals),
    botQuarantine: object(state.securityV10?.botQuarantine),
    webhooks: object(state.securityV10?.webhooks),
    incidents: array(state.securityV10?.incidents),
    lockdownProfiles: object(state.securityV10?.lockdownProfiles),
    snapshots: array(state.securityV10?.snapshots),
    configVersions: array(state.securityV10?.configVersions),
    canary: object(state.securityV10?.canary),
    health: object(state.securityV10?.health),
    circuitBreaker: {
      maxRestarts: 5,
      windowMinutes: 10,
      restartDelayMs: 10_000,
      exponentialBackoff: true,
      ...object(state.securityV10?.circuitBreaker)
    },
    resourceBudgets: {
      backgroundConcurrency: 1,
      AIConcurrency: 0,
      analyticsConcurrency: 1,
      ...object(state.securityV10?.resourceBudgets)
    }
  };

  state.analyticsV10 = {
    ...object(state.analyticsV10),
    events: array(state.analyticsV10?.events),
    cohorts: object(state.analyticsV10?.cohorts),
    funnels: object(state.analyticsV10?.funnels),
    abandonment: object(state.analyticsV10?.abandonment),
    demand: object(state.analyticsV10?.demand),
    supply: object(state.analyticsV10?.supply),
    serviceQuality: object(state.analyticsV10?.serviceQuality),
    houseHealth: object(state.analyticsV10?.houseHealth),
    growthSources: object(state.analyticsV10?.growthSources),
    creatorCampaigns: object(state.analyticsV10?.creatorCampaigns),
    churn: object(state.analyticsV10?.churn),
    pulse: object(state.analyticsV10?.pulse),
    reports: object(state.analyticsV10?.reports),
    decisions: array(state.analyticsV10?.decisions),
    policyVersions: array(state.analyticsV10?.policyVersions),
    changelog: array(state.analyticsV10?.changelog),
    knownIssues: object(state.analyticsV10?.knownIssues),
    featureRequests: object(state.analyticsV10?.featureRequests)
  };

  state.knowledgeV10 = {
    ...object(state.knowledgeV10),
    articles: object(state.knowledgeV10?.articles),
    guides: object(state.knowledgeV10?.guides),
    guideVerification: object(state.knowledgeV10?.guideVerification),
    FAQMetrics: object(state.knowledgeV10?.FAQMetrics),
    buildProfiles: object(state.knowledgeV10?.buildProfiles),
    itemComparisons: object(state.knowledgeV10?.itemComparisons)
  };

  state.integrationsV10 = {
    ...object(state.integrationsV10),
    statusPage: object(state.integrationsV10?.statusPage),
    discordOAuth: object(state.integrationsV10?.discordOAuth),
    roleSync: object(state.integrationsV10?.roleSync),
    webSessions: object(state.integrationsV10?.webSessions),
    outboundWebhooks: object(state.integrationsV10?.outboundWebhooks),
    permissions: object(state.integrationsV10?.permissions),
    audit: array(state.integrationsV10?.audit),
    partners: object(state.integrationsV10?.partners),
    campaigns: object(state.integrationsV10?.campaigns),
    inviteCodes: object(state.integrationsV10?.inviteCodes),
    records: object(state.integrationsV10?.records),
    timeCapsules: array(state.integrationsV10?.timeCapsules)
  };

  state.aiV10 = {
    ...object(state.aiV10),
    enabled: false,
    provider: null,
    localEndpoint: null,
    resourceGovernor: true,
    disabledReason: 'vps-stability',
    features: {
      helpdesk: false,
      carryAssistant: false,
      ticketSummaries: false,
      applicationAssistant: false,
      securityExplainer: false,
      eventWriter: false,
      knowledgeSearch: false,
      buildAssistant: false
    }
  };

  state.legacyV10 = {
    ...object(state.legacyV10),
    eras: object(state.legacyV10?.eras),
    foundingTimeline: array(state.legacyV10?.foundingTimeline),
    baselines: object(state.legacyV10?.baselines),
    records: object(state.legacyV10?.records),
    backups: object(state.legacyV10?.backups),
    dependencyMap: object(state.legacyV10?.dependencyMap),
    migrations: array(state.legacyV10?.migrations),
    configDiffs: array(state.legacyV10?.configDiffs),
    exports: array(state.legacyV10?.exports)
  };

  return state;
}

export function scoreKnightForRequestV10(profile = {}, request = {}) {
  const weights = {
    reliability: 0.28,
    specialist: 0.22,
    availability: 0.2,
    region: 0.12,
    workload: 0.1,
    mentorFit: 0.08
  };
  const reliability = Math.max(0, Math.min(1, Number(profile.reliability ?? 0.75)));
  const specialist = request.dungeon && array(profile.specialties).includes(request.dungeon) ? 1 : 0.45;
  const availability = profile.status === 'available' ? 1 : profile.status === 'specialist-only' ? 0.65 : 0;
  const region = !request.region || !profile.region || request.region === profile.region ? 1 : 0.55;
  const workload = 1 - Math.max(0, Math.min(1, Number(profile.activeLoad ?? 0) / Math.max(1, Number(profile.maxLoad ?? 2))));
  const mentorFit = request.needsMentor && profile.mentor ? 1 : 0.5;
  return Math.round(1000 * (
    reliability * weights.reliability +
    specialist * weights.specialist +
    availability * weights.availability +
    region * weights.region +
    workload * weights.workload +
    mentorFit * weights.mentorFit
  )) / 10;
}

export function estimateCarryEtaV10(state, dungeon) {
  ensureRealmEnginesV10(state);
  const demand = state.carryV10.demand?.[dungeon] ?? {};
  const waiting = Number(demand.waiting ?? 0);
  const available = Math.max(0, Number(demand.availableKnights ?? 0));
  const avgRunMinutes = Math.max(1, Number(demand.avgRunMinutes ?? 8));
  if (!waiting) return { minutes: 0, confidence: 95 };
  if (!available) return { minutes: Math.max(avgRunMinutes, waiting * avgRunMinutes), confidence: 35 };
  const minutes = Math.max(1, Math.ceil((waiting / available) * avgRunMinutes));
  const samples = Number(demand.samples ?? 0);
  const confidence = Math.max(40, Math.min(95, 45 + samples * 3));
  return { minutes, confidence };
}

export function recordRealmEventV10(state, type, payload = {}) {
  ensureRealmEnginesV10(state);
  const event = { id: `v10-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, type, at: nowIso(), ...payload };
  boundedPush(state.analyticsV10.events, event, 10_000);
  return event;
}

export function applyResourcePolicyV10(state, resources) {
  ensureRealmEnginesV10(state);
  const severe = ['high', 'critical'].includes(resources?.pressure);
  state.securityV10.health.resourcePressure = resources?.pressure ?? 'normal';
  state.securityV10.resourceBudgets.backgroundConcurrency = 1;
  state.securityV10.resourceBudgets.analyticsConcurrency = severe ? 0 : 1;
  state.securityV10.resourceBudgets.AIConcurrency = 0;
  state.aiV10.enabled = false;
  state.aiV10.resourceGovernor = true;
  state.realmV10.runtimeMode = resources?.pressure === 'critical'
    ? 'critical-graceful-degradation'
    : severe
      ? 'low-memory'
      : resources?.pressure === 'guarded'
        ? 'guarded'
        : 'normal';
  return state.realmV10.runtimeMode;
}

export function runRealmEnginesV10(state, resources = {}) {
  ensureRealmEnginesV10(state);
  const runtimeMode = applyResourcePolicyV10(state, resources);
  const oldDemand = state.analyticsV4?.demand ?? {};
  for (const [dungeon, value] of Object.entries(oldDemand)) {
    state.carryV10.demand[dungeon] = {
      ...object(state.carryV10.demand[dungeon]),
      ...object(value),
      updatedAt: nowIso()
    };
  }

  const openCases = Object.values(state.casesV10.records).filter((x) => !['closed', 'resolved', 'cancelled'].includes(x.status)).length;
  const activeEvents = Object.values(state.eventsV10.calendar).filter((x) => !['completed', 'cancelled'].includes(x.status)).length;
  const activeRequests = Object.values(state.carryV10.requests).filter((x) => !['completed', 'cancelled', 'closed'].includes(x.status)).length;
  state.analyticsV10.pulse = {
    score: Math.max(0, Math.min(100, 100 - openCases * 2 - (runtimeMode === 'critical-graceful-degradation' ? 30 : runtimeMode === 'low-memory' ? 12 : 0))),
    openCases,
    activeEvents,
    activeRequests,
    runtimeMode,
    updatedAt: nowIso()
  };
  return state.analyticsV10.pulse;
}
