import { readGuildState } from '../storage/store.js';

const ACTIVE = new Set(['open', 'claimed', 'ready', 'running', 'between', 'closing']);

function fail(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  throw error;
}

function membersOf(ticket) {
  return [...new Set((Array.isArray(ticket?.members) ? ticket.members : [ticket?.userId]).filter(Boolean))];
}

function involved(ticket, userId) {
  if (!ticket || !userId) return false;
  return ticket.userId === userId
    || ticket.carrierId === userId
    || membersOf(ticket).includes(userId)
    || (Array.isArray(ticket.participantHistory) && ticket.participantHistory.includes(userId));
}

function ms(value) {
  const time = value ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(time) ? time : null;
}

function clampMinutes(value) {
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.round(value));
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * p;
  const base = Math.floor(position);
  const rest = position - base;
  if (sorted[base + 1] === undefined) return sorted[base];
  return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
}

function durationSamples(state, ticket) {
  const rows = Object.values(state.carryTickets ?? {});
  const values = [];
  for (const row of rows) {
    if (row.id === ticket.id || row.status !== 'completed') continue;
    if (row.dungeon !== ticket.dungeon || row.difficulty !== ticket.difficulty || (row.mode ?? 'Normal') !== (ticket.mode ?? 'Normal')) continue;
    const start = ms(row.startedAt ?? row.firstRunStartedAt ?? row.runStartedAt ?? row.claimedAt);
    const end = ms(row.completedAt ?? row.lastRunCompletedAt);
    if (start === null || end === null || end <= start) continue;
    const runs = Math.max(1, Number(row.runsCompleted) || 1);
    const perRun = (end - start) / 60_000 / runs;
    if (perRun >= 0.5 && perRun <= 180) values.push(perRun);
  }
  return values.slice(-100);
}

function carrierCounts(state) {
  const profiles = Object.values(state.carrierOps?.profiles ?? {});
  let available = 0;
  let busy = 0;
  for (const profile of profiles) {
    if (profile?.status === 'available') available += 1;
    else if (profile?.status === 'busy' || profile?.shiftStartedAt) busy += 1;
  }
  return { available, busy };
}

function queueAheadFor(state, ticket) {
  if (!ACTIVE.has(ticket.status)) return 0;
  const created = ms(ticket.createdAt) ?? Number.MAX_SAFE_INTEGER;
  return Object.values(state.carryTickets ?? {}).filter((row) => {
    if (!ACTIVE.has(row.status) || row.id === ticket.id) return false;
    if ((ms(row.createdAt) ?? Number.MAX_SAFE_INTEGER) >= created) return false;
    return row.dungeon === ticket.dungeon
      && row.difficulty === ticket.difficulty
      && (row.mode ?? 'Normal') === (ticket.mode ?? 'Normal');
  }).length;
}

function confidenceFor(samples) {
  if (samples <= 0) return 0;
  if (samples === 1) return 35;
  if (samples <= 3) return 50;
  if (samples <= 7) return 65;
  if (samples <= 15) return 78;
  return 88;
}

export async function getUnifiedCarryEta(guild, ticketId) {
  const state = await readGuildState(guild.id);
  const ticket = state.carryTickets?.[ticketId];
  if (!ticket) fail('carry_not_found', 'That carry could not be found.', 404);

  const samples = durationSamples(state, ticket);
  const median = percentile(samples, 0.5);
  const lowSample = percentile(samples, 0.25);
  const highSample = percentile(samples, 0.75);
  const queueAhead = queueAheadFor(state, ticket);
  const carriers = carrierCounts(state);

  let estimate = null;
  let low = null;
  let high = null;

  if (['completed', 'cancelled'].includes(ticket.status)) {
    estimate = 0;
    low = 0;
    high = 0;
  } else if (median !== null) {
    const multiplier = ticket.status === 'open' ? Math.max(1, queueAhead + 1) : 1;
    estimate = median * multiplier;
    low = (lowSample ?? median * 0.75) * multiplier;
    high = (highSample ?? median * 1.35) * multiplier;

    if (ticket.status === 'running' && ticket.runStartedAt) {
      const elapsed = Math.max(0, (Date.now() - new Date(ticket.runStartedAt).getTime()) / 60_000);
      estimate = Math.max(0, median - elapsed);
      low = Math.max(0, (lowSample ?? median * 0.75) - elapsed);
      high = Math.max(0, (highSample ?? median * 1.35) - elapsed);
    }
  }

  return {
    carryId: ticket.id,
    status: ticket.status,
    estimateMinutes: clampMinutes(estimate),
    lowMinutes: clampMinutes(low),
    highMinutes: clampMinutes(high),
    confidence: confidenceFor(samples.length),
    samples: samples.length,
    sampleTier: samples.length ? 'matched-history' : 'live-only',
    medianRunMinutes: clampMinutes(median),
    carriersAvailable: carriers.available,
    carriersBusy: carriers.busy,
    queueAhead,
    calculatedAt: new Date().toISOString()
  };
}

function pushEvent(events, id, type, at, actorId = null, meta = undefined) {
  if (!at) return;
  events.push({ id, type, at, actorId, ...(meta ? { meta } : {}) });
}

export async function getUnifiedCarryTimeline(guild, userId, ticketId) {
  const state = await readGuildState(guild.id);
  const ticket = state.carryTickets?.[ticketId];
  if (!ticket) fail('carry_not_found', 'That carry could not be found.', 404);
  if (!involved(ticket, userId)) fail('forbidden', 'You do not have access to that carry timeline.', 403);

  const events = [];
  pushEvent(events, `${ticket.id}:requested`, 'requested', ticket.createdAt, ticket.userId ?? null, {
    dungeon: ticket.dungeon,
    difficulty: ticket.difficulty,
    mode: ticket.mode ?? 'Normal'
  });
  pushEvent(events, `${ticket.id}:claimed`, 'claimed', ticket.claimedAt, ticket.carrierId ?? null);
  pushEvent(events, `${ticket.id}:ready`, 'ready', ticket.readyStartedAt ?? ticket.readyCheckAt, ticket.carrierId ?? null);
  pushEvent(events, `${ticket.id}:started`, 'started', ticket.startedAt ?? ticket.firstRunStartedAt ?? ticket.runStartedAt, ticket.carrierId ?? null);
  pushEvent(events, `${ticket.id}:returned`, 'returned', ticket.returnedAt, ticket.carrierId ?? null);
  pushEvent(events, `${ticket.id}:target`, 'target_reached', ticket.targetReachedAt, ticket.carrierId ?? null, {
    runsCompleted: Number(ticket.runsCompleted) || 0,
    runTarget: ticket.runTarget ?? null
  });
  pushEvent(events, `${ticket.id}:completed`, 'completed', ticket.completedAt, ticket.completedBy ?? ticket.carrierId ?? null, {
    runsCompleted: Number(ticket.runsCompleted) || 0
  });
  pushEvent(events, `${ticket.id}:closed`, 'closed', ticket.closedAt, ticket.closedBy ?? null);
  events.sort((a, b) => (ms(a.at) ?? 0) - (ms(b.at) ?? 0));

  return {
    carryId: ticket.id,
    status: ticket.status,
    timeline: events
  };
}
