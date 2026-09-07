const nowIso = () => new Date().toISOString();

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function boundedPush(list, value, max = 1_000) {
  list.push(value);
  if (list.length > max) list.splice(0, list.length - max);
}

function stableId(prefix = 'ri') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeText(value) {
  return String(value ?? '').trim().toLowerCase();
}

function values(value) {
  return Object.values(object(value));
}

function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function ensureRealmIntelligenceV10(state) {
  state.realmIntelligenceV10 ??= {};
  const ri = state.realmIntelligenceV10;
  ri.updatedAt = nowIso();

  ri.graph = {
    nodes: object(ri.graph?.nodes),
    edges: object(ri.graph?.edges),
    memberIndex: object(ri.graph?.memberIndex),
    lastRebuildAt: ri.graph?.lastRebuildAt ?? null
  };

  ri.memberContext = {
    cache: object(ri.memberContext?.cache),
    generated: asNumber(ri.memberContext?.generated),
    cacheTtlMs: asNumber(ri.memberContext?.cacheTtlMs, 300_000)
  };

  ri.anomalies = {
    baselines: object(ri.anomalies?.baselines),
    findings: array(ri.anomalies?.findings),
    sensitivity: clamp(ri.anomalies?.sensitivity ?? 2.25, 1.25, 5)
  };

  ri.fairness = {
    audits: array(ri.fairness?.audits),
    maxPriorityJumpPositions: asNumber(ri.fairness?.maxPriorityJumpPositions, 2),
    maxKnightCherryPickRatio: clamp(ri.fairness?.maxKnightCherryPickRatio ?? 0.7, 0.1, 1),
    lastScore: asNumber(ri.fairness?.lastScore, 100)
  };

  ri.capacity = {
    reservations: object(ri.capacity?.reservations),
    standby: object(ri.capacity?.standby),
    windows: object(ri.capacity?.windows),
    maxReservationDaysAhead: asNumber(ri.capacity?.maxReservationDaysAhead, 14)
  };

  ri.recovery = {
    plans: object(ri.recovery?.plans),
    history: array(ri.recovery?.history),
    autoSafeSteps: ['preserve-queue-priority', 'notify-party', 'request-standby-knight', 'reopen-ready-check']
  };

  ri.policy = {
    simulations: array(ri.policy?.simulations),
    shadow: object(ri.policy?.shadow),
    minimumShadowSamples: asNumber(ri.policy?.minimumShadowSamples, 25)
  };

  ri.permissions = {
    compiled: object(ri.permissions?.compiled),
    impactReports: array(ri.permissions?.impactReports),
    intents: object(ri.permissions?.intents)
  };

  ri.incidents = {
    records: object(ri.incidents?.records),
    activeId: ri.incidents?.activeId ?? null,
    timeline: array(ri.incidents?.timeline)
  };

  ri.integrity = {
    findings: array(ri.integrity?.findings),
    repairs: array(ri.integrity?.repairs),
    lastAuditAt: ri.integrity?.lastAuditAt ?? null
  };

  ri.identities = {
    canonical: object(ri.identities?.canonical),
    aliases: object(ri.identities?.aliases),
    history: array(ri.identities?.history)
  };

  ri.routing = {
    history: array(ri.routing?.history),
    rules: {
      carry: ['carry', 'queue', 'dungeon', 'run', 'boss', 'knight'],
      trade: ['trade', 'market', 'item', 'price', 'scam', 'loan'],
      application: ['application', 'apply', 'staff', 'carrier', 'creator'],
      security: ['raid', 'hack', 'bot', 'webhook', 'compromised', 'permission'],
      appeal: ['appeal', 'ban', 'mute', 'warn', 'punishment'],
      event: ['event', 'tournament', 'giveaway', 'rsvp'],
      support: ['help', 'support', 'issue', 'problem'],
      ...object(ri.routing?.rules)
    }
  };

  ri.capacityModel = {
    latest: object(ri.capacityModel?.latest),
    history: array(ri.capacityModel?.history)
  };

  ri.bottlenecks = {
    latest: array(ri.bottlenecks?.latest),
    history: array(ri.bottlenecks?.history)
  };

  ri.search = {
    queries: array(ri.search?.queries),
    maxResults: asNumber(ri.search?.maxResults, 20)
  };

  ri.autopilot = {
    enabled: ri.autopilot?.enabled !== false,
    mode: 'guarded',
    queue: array(ri.autopilot?.queue),
    history: array(ri.autopilot?.history),
    safeActions: [
      'rebalance-queue',
      'replace-no-show',
      'reassign-abandoned-ticket',
      'request-standby-knight',
      'throttle-background-work',
      'repair-known-safe-drift',
      'route-service-request',
      'pause-failing-subsystem'
    ],
    approvalRequired: [
      'ban-member',
      'kick-member',
      'timeout-member',
      'change-dangerous-permission',
      'spend-treasury',
      'delete-channel',
      'delete-role',
      'external-write'
    ],
    lastRunAt: ri.autopilot?.lastRunAt ?? null
  };

  return ri;
}

export function upsertGraphNodeV10(state, type, id, data = {}) {
  const ri = ensureRealmIntelligenceV10(state);
  const key = `${type}:${id}`;
  const current = object(ri.graph.nodes[key]);
  ri.graph.nodes[key] = {
    ...current,
    ...data,
    id,
    type,
    key,
    updatedAt: nowIso(),
    createdAt: current.createdAt ?? nowIso()
  };
  if (type === 'member') ri.graph.memberIndex[id] = key;
  return ri.graph.nodes[key];
}

export function linkGraphNodesV10(state, fromType, fromId, relation, toType, toId, data = {}) {
  const ri = ensureRealmIntelligenceV10(state);
  const fromKey = `${fromType}:${fromId}`;
  const toKey = `${toType}:${toId}`;
  const edgeKey = `${fromKey}|${relation}|${toKey}`;
  ri.graph.edges[edgeKey] = {
    ...object(ri.graph.edges[edgeKey]),
    ...data,
    id: edgeKey,
    from: fromKey,
    to: toKey,
    relation,
    updatedAt: nowIso(),
    createdAt: ri.graph.edges[edgeKey]?.createdAt ?? nowIso()
  };
  return ri.graph.edges[edgeKey];
}

export function rebuildKingdomGraphV10(state, { limitPerSource = 500 } = {}) {
  const ri = ensureRealmIntelligenceV10(state);
  const addMember = (userId, data = {}) => {
    if (!userId) return;
    upsertGraphNodeV10(state, 'member', userId, data);
  };

  for (const [userId, passport] of Object.entries(object(state.membersV10?.passports)).slice(0, limitPerSource)) {
    addMember(userId, { house: passport.house ?? null, reputation: passport.reputation ?? null });
    if (passport.house) {
      upsertGraphNodeV10(state, 'house', passport.house, { name: passport.house });
      linkGraphNodesV10(state, 'member', userId, 'belongs-to', 'house', passport.house);
    }
  }

  for (const [userId, profile] of Object.entries(object(state.knightsV10?.profiles)).slice(0, limitPerSource)) {
    addMember(userId, { knight: true });
    upsertGraphNodeV10(state, 'knight', userId, { reliability: profile.reliability ?? null, specialties: array(profile.specialties) });
    linkGraphNodesV10(state, 'member', userId, 'has-knight-profile', 'knight', userId);
  }

  for (const [carryId, carry] of Object.entries(object(state.carryV10?.requests)).slice(-limitPerSource)) {
    upsertGraphNodeV10(state, 'carry', carryId, { dungeon: carry.dungeon ?? null, status: carry.status ?? null });
    if (carry.userId) {
      addMember(carry.userId);
      linkGraphNodesV10(state, 'member', carry.userId, 'requested', 'carry', carryId);
    }
    if (carry.knightId) {
      addMember(carry.knightId, { knight: true });
      linkGraphNodesV10(state, 'knight', carry.knightId, 'served', 'carry', carryId);
    }
  }

  for (const [caseId, record] of Object.entries(object(state.casesV10?.records)).slice(-limitPerSource)) {
    upsertGraphNodeV10(state, 'case', caseId, { type: record.type ?? 'support', status: record.status ?? null });
    const userId = record.userId ?? record.memberId ?? record.subjectId;
    if (userId) {
      addMember(userId);
      linkGraphNodesV10(state, 'member', userId, 'subject-of', 'case', caseId);
    }
  }

  for (const [applicationId, record] of Object.entries(object(state.applicationsV10?.records)).slice(-limitPerSource)) {
    upsertGraphNodeV10(state, 'application', applicationId, { type: record.type ?? null, status: record.status ?? null });
    if (record.userId) {
      addMember(record.userId);
      linkGraphNodesV10(state, 'member', record.userId, 'submitted', 'application', applicationId);
    }
  }

  ri.graph.lastRebuildAt = nowIso();
  return { nodes: Object.keys(ri.graph.nodes).length, edges: Object.keys(ri.graph.edges).length };
}

export function buildMemberContextV10(state, userId) {
  const ri = ensureRealmIntelligenceV10(state);
  const cached = ri.memberContext.cache[userId];
  if (cached && Date.now() - new Date(cached.generatedAt).getTime() < ri.memberContext.cacheTtlMs) return cached;

  const activeCarries = Object.entries(object(state.carryV10?.requests))
    .filter(([, item]) => item.userId === userId && !['completed', 'cancelled', 'closed'].includes(item.status))
    .slice(-10)
    .map(([id, item]) => ({ id, dungeon: item.dungeon ?? null, status: item.status ?? null }));
  const cases = Object.entries(object(state.casesV10?.records))
    .filter(([, item]) => [item.userId, item.memberId, item.subjectId].includes(userId))
    .slice(-10)
    .map(([id, item]) => ({ id, type: item.type ?? null, status: item.status ?? null }));
  const applications = Object.entries(object(state.applicationsV10?.records))
    .filter(([, item]) => item.userId === userId)
    .slice(-10)
    .map(([id, item]) => ({ id, type: item.type ?? null, status: item.status ?? null }));
  const memberNode = ri.graph.nodes[`member:${userId}`] ?? null;
  const edges = values(ri.graph.edges).filter((edge) => edge.from === `member:${userId}` || edge.to === `member:${userId}`).slice(-50);

  const context = {
    userId,
    passport: state.membersV10?.passports?.[userId] ?? null,
    knight: state.knightsV10?.profiles?.[userId] ?? null,
    reputation: state.membersV10?.reputation?.[userId] ?? null,
    activeCarries,
    cases,
    applications,
    graph: { node: memberNode, relationships: edges },
    tradeReputation: state.economyV10?.traderReputation?.[userId] ?? null,
    generatedAt: nowIso()
  };
  ri.memberContext.cache[userId] = context;
  ri.memberContext.generated++;
  return context;
}

function metricStats(samples = []) {
  const list = samples.map(Number).filter(Number.isFinite);
  if (!list.length) return { mean: 0, stddev: 0, count: 0 };
  const mean = list.reduce((sum, value) => sum + value, 0) / list.length;
  const variance = list.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / list.length;
  return { mean, stddev: Math.sqrt(variance), count: list.length };
}

export function detectOperationalAnomaliesV10(state, metrics = {}) {
  const ri = ensureRealmIntelligenceV10(state);
  const findings = [];
  for (const [name, currentRaw] of Object.entries(metrics)) {
    const current = Number(currentRaw);
    if (!Number.isFinite(current)) continue;
    const baseline = ri.anomalies.baselines[name] ?? { samples: [] };
    baseline.samples = array(baseline.samples).map(Number).filter(Number.isFinite).slice(-60);
    const stats = metricStats(baseline.samples);
    const delta = current - stats.mean;
    const z = stats.stddev > 0 ? Math.abs(delta) / stats.stddev : 0;
    if (stats.count >= 8 && z >= ri.anomalies.sensitivity) {
      const finding = {
        id: stableId('anomaly'),
        metric: name,
        current,
        baseline: Math.round(stats.mean * 100) / 100,
        zScore: Math.round(z * 100) / 100,
        direction: delta > 0 ? 'up' : 'down',
        at: nowIso()
      };
      findings.push(finding);
      boundedPush(ri.anomalies.findings, finding, 500);
    }
    baseline.samples.push(current);
    baseline.samples = baseline.samples.slice(-60);
    baseline.updatedAt = nowIso();
    ri.anomalies.baselines[name] = baseline;
  }
  return findings;
}

export function auditQueueFairnessV10(state, completed = []) {
  const ri = ensureRealmIntelligenceV10(state);
  const items = array(completed).filter((x) => x && typeof x === 'object');
  let violations = 0;
  const details = [];
  const byKnight = new Map();

  for (const item of items) {
    const joined = asNumber(item.queuePositionAtJoin, 0);
    const served = asNumber(item.queuePositionWhenServed, joined);
    const priorityAllowed = Boolean(item.priorityReason);
    const jumped = Math.max(0, joined - served);
    if (!priorityAllowed && jumped > ri.fairness.maxPriorityJumpPositions) {
      violations++;
      details.push({ type: 'queue-jump', requestId: item.id ?? null, jumped });
    }
    if (item.knightId) {
      const row = byKnight.get(item.knightId) ?? { total: 0, easy: 0 };
      row.total++;
      if (item.difficulty === 'easy' || asNumber(item.difficultyScore, 50) <= 30) row.easy++;
      byKnight.set(item.knightId, row);
    }
  }

  for (const [knightId, row] of byKnight.entries()) {
    if (row.total >= 5 && row.easy / row.total > ri.fairness.maxKnightCherryPickRatio) {
      violations++;
      details.push({ type: 'possible-cherry-picking', knightId, ratio: Math.round((row.easy / row.total) * 100) / 100 });
    }
  }

  const score = items.length ? Math.max(0, Math.round(100 - (violations / items.length) * 100)) : 100;
  const audit = { id: stableId('fairness'), score, violations, sampleSize: items.length, details: details.slice(0, 50), at: nowIso() };
  ri.fairness.lastScore = score;
  boundedPush(ri.fairness.audits, audit, 200);
  return audit;
}

export function reserveCarryCapacityV10(state, reservation = {}) {
  const ri = ensureRealmIntelligenceV10(state);
  const start = new Date(reservation.startAt ?? Date.now());
  const max = Date.now() + ri.capacity.maxReservationDaysAhead * 86_400_000;
  if (!Number.isFinite(start.getTime()) || start.getTime() > max) throw new Error('Carry capacity reservation is outside the allowed booking window.');
  const id = reservation.id ?? stableId('capacity');
  ri.capacity.reservations[id] = {
    id,
    dungeon: reservation.dungeon ?? 'any',
    startAt: start.toISOString(),
    endAt: new Date(reservation.endAt ?? start.getTime() + 3_600_000).toISOString(),
    slots: Math.max(1, asNumber(reservation.slots, 1)),
    knightId: reservation.knightId ?? null,
    members: array(reservation.members),
    status: reservation.status ?? 'open',
    createdAt: ri.capacity.reservations[id]?.createdAt ?? nowIso(),
    updatedAt: nowIso()
  };
  return ri.capacity.reservations[id];
}

export function setStandbyKnightV10(state, knightId, availability = {}) {
  const ri = ensureRealmIntelligenceV10(state);
  ri.capacity.standby[knightId] = {
    knightId,
    region: availability.region ?? null,
    dungeons: array(availability.dungeons),
    until: availability.until ?? null,
    priority: asNumber(availability.priority, 0),
    status: availability.status ?? 'standby',
    updatedAt: nowIso()
  };
  return ri.capacity.standby[knightId];
}

export function selectStandbyKnightsV10(state, request = {}, limit = 5) {
  const ri = ensureRealmIntelligenceV10(state);
  const now = Date.now();
  return values(ri.capacity.standby)
    .filter((x) => x.status === 'standby' && (!x.until || new Date(x.until).getTime() > now))
    .map((x) => {
      let score = asNumber(x.priority, 0);
      if (!request.region || !x.region || request.region === x.region) score += 25;
      if (!request.dungeon || !x.dungeons.length || x.dungeons.includes(request.dungeon)) score += 40;
      const reliability = asNumber(state.knightsV10?.profiles?.[x.knightId]?.reliability, 0.75);
      score += reliability * 35;
      return { ...x, score: Math.round(score * 10) / 10 };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, limit));
}

export function planServiceRecoveryV10(state, interruption = {}) {
  const ri = ensureRealmIntelligenceV10(state);
  const standby = selectStandbyKnightsV10(state, interruption, 3);
  const steps = ['preserve-queue-priority', 'notify-party'];
  if (standby.length) steps.push('request-standby-knight');
  else steps.push('return-party-to-priority-pool');
  if (interruption.readyCheckStarted) steps.push('reopen-ready-check');
  if (interruption.channelId) steps.push('preserve-existing-party-channel');

  const id = stableId('recovery');
  const plan = {
    id,
    carryId: interruption.carryId ?? null,
    reason: interruption.reason ?? 'interrupted',
    replacementCandidates: standby.map((x) => x.knightId),
    steps,
    status: 'planned',
    createdAt: nowIso()
  };
  ri.recovery.plans[id] = plan;
  boundedPush(ri.recovery.history, { ...plan }, 500);
  return plan;
}

export function simulatePolicyV10(state, proposal = {}) {
  const ri = ensureRealmIntelligenceV10(state);
  const type = proposal.type ?? 'generic';
  let sampleSize = 0;
  let currentPass = 0;
  let proposedPass = 0;

  if (type === 'knight-promotion-threshold') {
    const currentThreshold = asNumber(proposal.currentThreshold, 75);
    const proposedThreshold = asNumber(proposal.proposedThreshold, currentThreshold);
    const profiles = values(state.knightsV10?.profiles);
    sampleSize = profiles.length;
    for (const profile of profiles) {
      const carries = asNumber(profile.completedCarries ?? profile.carries, 0);
      if (carries >= currentThreshold) currentPass++;
      if (carries >= proposedThreshold) proposedPass++;
    }
  } else if (type === 'queue-priority-wait-minutes') {
    const currentThreshold = asNumber(proposal.currentThreshold, 30);
    const proposedThreshold = asNumber(proposal.proposedThreshold, currentThreshold);
    const requests = values(state.carryV10?.requests);
    sampleSize = requests.length;
    for (const request of requests) {
      const wait = asNumber(request.waitMinutes, 0);
      if (wait >= currentThreshold) currentPass++;
      if (wait >= proposedThreshold) proposedPass++;
    }
  }

  const simulation = {
    id: stableId('policy'),
    type,
    proposal,
    sampleSize,
    currentPass,
    proposedPass,
    delta: proposedPass - currentPass,
    impactPercent: sampleSize ? Math.round(((proposedPass - currentPass) / sampleSize) * 10_000) / 100 : 0,
    at: nowIso()
  };
  boundedPush(ri.policy.simulations, simulation, 200);
  return simulation;
}

export function recordShadowDecisionV10(state, system, proposed, actual, meta = {}) {
  const ri = ensureRealmIntelligenceV10(state);
  const bucket = ri.policy.shadow[system] ?? { samples: [], agreementRate: 0 };
  const same = JSON.stringify(proposed) === JSON.stringify(actual);
  boundedPush(bucket.samples, { proposed, actual, same, meta, at: nowIso() }, 250);
  bucket.agreementRate = bucket.samples.length
    ? Math.round((bucket.samples.filter((x) => x.same).length / bucket.samples.length) * 10_000) / 100
    : 0;
  bucket.readyForReview = bucket.samples.length >= ri.policy.minimumShadowSamples;
  bucket.updatedAt = nowIso();
  ri.policy.shadow[system] = bucket;
  return bucket;
}

export function compilePermissionIntentV10(intent = {}) {
  const visibility = intent.visibility ?? 'members';
  const posting = intent.posting ?? 'members';
  const manage = array(intent.manageRoles);
  const view = array(intent.viewRoles);
  const send = array(intent.sendRoles);

  const compiled = {
    everyone: {
      view: visibility === 'public' || visibility === 'members',
      send: posting === 'members' || posting === 'public'
    },
    roles: {},
    constraints: {
      denyUnlisted: visibility === 'private',
      staffOverride: intent.staffOverride !== false
    }
  };

  for (const roleId of new Set([...view, ...send, ...manage])) {
    compiled.roles[roleId] = {
      view: view.includes(roleId) || send.includes(roleId) || manage.includes(roleId),
      send: send.includes(roleId) || manage.includes(roleId),
      manage: manage.includes(roleId)
    };
  }
  return compiled;
}

export function analyzeChangeImpactV10(state, change = {}) {
  const ri = ensureRealmIntelligenceV10(state);
  const id = change.id ?? change.targetId ?? null;
  const impacts = [];
  if (id) {
    for (const [key, value] of Object.entries(object(state.setup?.channels))) {
      if (value === id) impacts.push({ type: 'managed-channel', key });
    }
    for (const [key, value] of Object.entries(object(state.setup?.roles))) {
      if (value === id) impacts.push({ type: 'managed-role', key });
    }
    for (const [domain, hubId] of Object.entries(object(state.platform?.v10?.hubs))) {
      if (hubId === id) impacts.push({ type: 'v10-domain-hub', domain });
    }
    const graphRefs = values(ri.graph.edges).filter((edge) => edge.from.endsWith(`:${id}`) || edge.to.endsWith(`:${id}`)).length;
    if (graphRefs) impacts.push({ type: 'graph-relationships', count: graphRefs });
  }

  const risk = impacts.some((x) => ['managed-role', 'v10-domain-hub'].includes(x.type)) ? 'high'
    : impacts.length >= 3 ? 'medium'
      : impacts.length ? 'guarded'
        : 'low';
  const report = { id: stableId('impact'), change, impacts, risk, requiresApproval: ['high', 'medium'].includes(risk), at: nowIso() };
  boundedPush(ri.permissions.impactReports, report, 300);
  return report;
}

export function openIncidentV10(state, incident = {}) {
  const ri = ensureRealmIntelligenceV10(state);
  const id = incident.id ?? stableId('incident');
  const record = {
    id,
    title: incident.title ?? 'Kingdom incident',
    severity: incident.severity ?? 'medium',
    affected: array(incident.affected),
    status: 'active',
    containment: array(incident.containment),
    ownerId: incident.ownerId ?? null,
    timeline: [{ at: nowIso(), event: 'incident-opened' }],
    openedAt: nowIso(),
    updatedAt: nowIso()
  };
  ri.incidents.records[id] = record;
  ri.incidents.activeId = id;
  boundedPush(ri.incidents.timeline, { incidentId: id, event: 'opened', at: nowIso() }, 500);
  return record;
}

export function updateIncidentV10(state, incidentId, update = {}) {
  const ri = ensureRealmIntelligenceV10(state);
  const record = ri.incidents.records[incidentId];
  if (!record) return null;
  Object.assign(record, update, { updatedAt: nowIso() });
  boundedPush(record.timeline ??= [], { at: nowIso(), event: update.event ?? 'updated', note: update.note ?? null }, 250);
  boundedPush(ri.incidents.timeline, { incidentId, event: update.event ?? 'updated', at: nowIso() }, 500);
  if (['resolved', 'closed'].includes(record.status) && ri.incidents.activeId === incidentId) ri.incidents.activeId = null;
  return record;
}

export function auditDataIntegrityV10(state, { repair = false } = {}) {
  const ri = ensureRealmIntelligenceV10(state);
  const findings = [];
  const repairs = [];

  for (const [id, request] of Object.entries(object(state.carryV10?.requests))) {
    if (request.status === 'completed' && request.active === true) {
      findings.push({ type: 'completed-carry-marked-active', id, safeRepair: true });
      if (repair) {
        request.active = false;
        repairs.push({ type: 'set-carry-inactive', id });
      }
    }
  }

  for (const [id, loan] of Object.entries(object(state.treasuryV4?.loans))) {
    if (['returned', 'closed'].includes(loan.status) && loan.overdue === true) {
      findings.push({ type: 'returned-loan-marked-overdue', id, safeRepair: true });
      if (repair) {
        loan.overdue = false;
        repairs.push({ type: 'clear-loan-overdue', id });
      }
    }
  }

  for (const [userId] of Object.entries(object(state.knightsV10?.profiles))) {
    const passport = state.membersV10?.passports?.[userId];
    if (!passport) findings.push({ type: 'knight-without-member-passport', userId, safeRepair: false });
  }

  for (const [caseId, ownerId] of Object.entries(object(state.casesV10?.ownership))) {
    if (!state.casesV10?.records?.[caseId]) findings.push({ type: 'orphan-case-owner', caseId, ownerId, safeRepair: true });
  }
  if (repair) {
    for (const finding of findings.filter((x) => x.type === 'orphan-case-owner')) {
      delete state.casesV10.ownership[finding.caseId];
      repairs.push({ type: 'remove-orphan-case-owner', caseId: finding.caseId });
    }
  }

  ri.integrity.findings = findings.slice(-500);
  ri.integrity.lastAuditAt = nowIso();
  for (const item of repairs) boundedPush(ri.integrity.repairs, { ...item, at: nowIso() }, 500);
  return { findings, repairs };
}

export function bindIdentityAliasV10(state, canonicalId, aliasType, aliasValue) {
  const ri = ensureRealmIntelligenceV10(state);
  const key = `${aliasType}:${normalizeText(aliasValue)}`;
  ri.identities.aliases[key] = canonicalId;
  const record = ri.identities.canonical[canonicalId] ?? { canonicalId, aliases: [] };
  if (!record.aliases.some((x) => x.type === aliasType && normalizeText(x.value) === normalizeText(aliasValue))) {
    record.aliases.push({ type: aliasType, value: aliasValue, addedAt: nowIso() });
  }
  record.updatedAt = nowIso();
  ri.identities.canonical[canonicalId] = record;
  boundedPush(ri.identities.history, { canonicalId, aliasType, aliasValue, at: nowIso() }, 1_000);
  return record;
}

export function resolveCanonicalIdentityV10(state, identifiers = {}) {
  const ri = ensureRealmIntelligenceV10(state);
  for (const [type, value] of Object.entries(identifiers)) {
    if (value == null) continue;
    const direct = type === 'discordId' && ri.identities.canonical[String(value)] ? String(value) : null;
    if (direct) return direct;
    const canonical = ri.identities.aliases[`${type}:${normalizeText(value)}`];
    if (canonical) return canonical;
  }
  return identifiers.discordId ? String(identifiers.discordId) : null;
}

export function routeServiceRequestV10(state, text) {
  const ri = ensureRealmIntelligenceV10(state);
  const normalized = normalizeText(text);
  let best = { route: 'support', score: 0 };
  for (const [route, words] of Object.entries(ri.routing.rules)) {
    const score = array(words).reduce((sum, word) => sum + (normalized.includes(normalizeText(word)) ? 1 : 0), 0);
    if (score > best.score) best = { route, score };
  }
  const result = {
    id: stableId('route'),
    route: best.route,
    confidence: Math.min(100, 45 + best.score * 18),
    text: String(text ?? '').slice(0, 500),
    at: nowIso()
  };
  boundedPush(ri.routing.history, result, 1_000);
  return result;
}

export function modelGuildCapacityV10(state) {
  const ri = ensureRealmIntelligenceV10(state);
  const profiles = values(state.knightsV10?.profiles);
  const available = profiles.filter((x) => ['available', 'standby'].includes(x.status)).length;
  const runTimes = Object.values(object(state.carryV10?.demand)).map((x) => asNumber(x.avgRunMinutes, 8)).filter((x) => x > 0);
  const avgRunMinutes = runTimes.length ? runTimes.reduce((a, b) => a + b, 0) / runTimes.length : 8;
  const carriesPerHour = available ? Math.round((available * 60 / Math.max(1, avgRunMinutes)) * 10) / 10 : 0;
  const staffAvailable = values(state.casesV10?.staffAvailability).filter((x) => x.status === 'available').length;
  const openApplications = values(state.applicationsV10?.records).filter((x) => !['accepted', 'rejected', 'withdrawn'].includes(x.status)).length;
  const openCases = values(state.casesV10?.records).filter((x) => !['closed', 'resolved', 'cancelled'].includes(x.status)).length;

  const latest = {
    availableKnights: available,
    averageRunMinutes: Math.round(avgRunMinutes * 10) / 10,
    estimatedCarriesPerHour: carriesPerHour,
    staffAvailable,
    openCases,
    openApplications,
    servicePressure: carriesPerHour === 0 && values(state.carryV10?.requests).length ? 'critical' : openCases > Math.max(5, staffAvailable * 8) ? 'high' : 'normal',
    calculatedAt: nowIso()
  };
  ri.capacityModel.latest = latest;
  boundedPush(ri.capacityModel.history, latest, 200);
  return latest;
}

export function attributeBottlenecksV10(state, metrics = {}) {
  const ri = ensureRealmIntelligenceV10(state);
  const capacity = ri.capacityModel.latest?.calculatedAt ? ri.capacityModel.latest : modelGuildCapacityV10(state);
  const causes = [];
  const waiting = asNumber(metrics.waiting ?? state.analyticsV10?.pulse?.activeRequests, 0);
  const readyDelay = asNumber(metrics.readyCheckDelayMinutes, 0);
  const noShowRate = asNumber(metrics.noShowRate, 0);
  const failureRate = asNumber(metrics.failureRate, 0);
  const regionMismatchRate = asNumber(metrics.regionMismatchRate, 0);

  if (waiting > 0 && capacity.availableKnights === 0) causes.push({ cause: 'insufficient-knight-supply', confidence: 98 });
  if (waiting > capacity.estimatedCarriesPerHour * 2 && capacity.estimatedCarriesPerHour > 0) causes.push({ cause: 'demand-exceeds-capacity', confidence: 90 });
  if (readyDelay >= 5) causes.push({ cause: 'ready-check-delay', confidence: Math.min(95, 60 + readyDelay * 4) });
  if (noShowRate >= 0.15) causes.push({ cause: 'member-no-shows', confidence: Math.min(95, 55 + noShowRate * 100) });
  if (failureRate >= 0.12) causes.push({ cause: 'run-failure-rate', confidence: Math.min(95, 55 + failureRate * 100) });
  if (regionMismatchRate >= 0.2) causes.push({ cause: 'regional-mismatch', confidence: Math.min(95, 50 + regionMismatchRate * 100) });
  if (!causes.length) causes.push({ cause: 'no-dominant-bottleneck-detected', confidence: 60 });

  causes.sort((a, b) => b.confidence - a.confidence);
  ri.bottlenecks.latest = causes;
  boundedPush(ri.bottlenecks.history, { causes, at: nowIso() }, 200);
  return causes;
}

function addSearchResult(results, scope, id, label, data, query) {
  const haystack = normalizeText(`${id} ${label} ${JSON.stringify(data)}`);
  if (!haystack.includes(query)) return;
  results.push({ scope, id, label, data });
}

export function searchKingdomV10(state, query, { limit = 20, scopes = null } = {}) {
  const ri = ensureRealmIntelligenceV10(state);
  const q = normalizeText(query);
  if (!q) return [];
  const allowed = scopes ? new Set(scopes) : null;
  const results = [];
  const include = (scope) => !allowed || allowed.has(scope);

  if (include('members')) {
    for (const [id, data] of Object.entries(object(state.membersV10?.passports))) addSearchResult(results, 'members', id, data.displayName ?? data.username ?? id, data, q);
  }
  if (include('carries')) {
    for (const [id, data] of Object.entries(object(state.carryV10?.requests))) addSearchResult(results, 'carries', id, data.dungeon ?? id, data, q);
  }
  if (include('cases')) {
    for (const [id, data] of Object.entries(object(state.casesV10?.records))) addSearchResult(results, 'cases', id, data.type ?? id, data, q);
  }
  if (include('applications')) {
    for (const [id, data] of Object.entries(object(state.applicationsV10?.records))) addSearchResult(results, 'applications', id, data.type ?? id, data, q);
  }
  if (include('events')) {
    for (const [id, data] of Object.entries(object(state.eventsV10?.calendar))) addSearchResult(results, 'events', id, data.name ?? id, data, q);
  }
  if (include('market')) {
    for (const [id, data] of Object.entries(object(state.marketV4?.listings))) addSearchResult(results, 'market', id, data.item ?? id, data, q);
  }
  if (include('graph')) {
    for (const [id, data] of Object.entries(ri.graph.nodes)) addSearchResult(results, 'graph', id, data.type ?? id, data, q);
  }

  const clipped = results.slice(0, Math.min(Math.max(1, limit), ri.search.maxResults));
  boundedPush(ri.search.queries, { query: String(query).slice(0, 200), count: clipped.length, scopes: scopes ?? 'all', at: nowIso() }, 500);
  return clipped;
}

export function enqueueAutopilotActionV10(state, action = {}) {
  const ri = ensureRealmIntelligenceV10(state);
  const type = action.type ?? 'unknown';
  const safe = ri.autopilot.safeActions.includes(type);
  const approvalRequired = !safe || ri.autopilot.approvalRequired.includes(type);
  const record = {
    id: action.id ?? stableId('autopilot'),
    type,
    payload: object(action.payload),
    status: approvalRequired ? 'awaiting-approval' : 'queued',
    safe,
    approvalRequired,
    reason: action.reason ?? null,
    createdAt: nowIso()
  };
  boundedPush(ri.autopilot.queue, record, 500);
  return record;
}

export function runAutopilotV10(state, resources = {}) {
  const ri = ensureRealmIntelligenceV10(state);
  if (!ri.autopilot.enabled) return { executed: 0, held: 0, actions: [] };
  const critical = resources.pressure === 'critical';
  const executed = [];
  let held = 0;

  for (const action of ri.autopilot.queue) {
    if (action.status !== 'queued') {
      if (action.status === 'awaiting-approval') held++;
      continue;
    }
    if (!action.safe) {
      action.status = 'awaiting-approval';
      held++;
      continue;
    }
    if (critical && !['throttle-background-work', 'pause-failing-subsystem'].includes(action.type)) {
      action.status = 'deferred-resource-pressure';
      continue;
    }

    // Guarded Autopilot records deterministic safe decisions. Existing domain
    // handlers perform the Discord/API mutation so this layer never bypasses
    // permission, moderation or treasury approval boundaries.
    action.status = 'approved-safe-action';
    action.executedAt = nowIso();
    executed.push(action);
    boundedPush(ri.autopilot.history, { ...action }, 1_000);
  }

  ri.autopilot.queue = ri.autopilot.queue.filter((x) => !['approved-safe-action', 'cancelled'].includes(x.status)).slice(-500);
  ri.autopilot.lastRunAt = nowIso();
  return { executed: executed.length, held, actions: executed };
}

export function runRealmIntelligenceV10(state, resources = {}) {
  const ri = ensureRealmIntelligenceV10(state);
  const graph = rebuildKingdomGraphV10(state, { limitPerSource: resources.pressure === 'normal' ? 500 : 150 });
  const capacity = modelGuildCapacityV10(state);
  const bottlenecks = attributeBottlenecksV10(state);
  const anomalies = detectOperationalAnomaliesV10(state, {
    activeRequests: asNumber(state.analyticsV10?.pulse?.activeRequests, 0),
    openCases: asNumber(state.analyticsV10?.pulse?.openCases, 0),
    availableKnights: capacity.availableKnights,
    carriesPerHour: capacity.estimatedCarriesPerHour
  });
  const integrity = auditDataIntegrityV10(state, { repair: true });

  if (resources.pressure === 'high' || resources.pressure === 'critical') {
    enqueueAutopilotActionV10(state, { type: 'throttle-background-work', reason: `resource-pressure:${resources.pressure}` });
  }
  const autopilot = runAutopilotV10(state, resources);

  ri.lastPulse = {
    graph,
    capacity,
    bottlenecks: bottlenecks.slice(0, 3),
    anomalies: anomalies.length,
    integrityFindings: integrity.findings.length,
    safeRepairs: integrity.repairs.length,
    autopilotExecuted: autopilot.executed,
    at: nowIso()
  };
  return ri.lastPulse;
}
