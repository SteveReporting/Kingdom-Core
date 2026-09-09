import { randomUUID } from 'node:crypto';
import { mutateNexusState } from './state.js';

function now() {
  return new Date().toISOString();
}

function cleanText(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

export async function upsertCompanionBuild(guildId, input = {}) {
  const id = String(input.id ?? randomUUID());
  const name = cleanText(input.name, 120);
  if (!name) throw new Error('build name is required');
  return mutateNexusState(guildId, (nexus) => {
    const current = nexus.companion.builds[id] ?? { id, createdAt: now() };
    const record = {
      ...current,
      ...input,
      id,
      name,
      class: cleanText(input.class ?? current.class, 80) || null,
      dungeon: cleanText(input.dungeon ?? current.dungeon, 120) || null,
      difficulty: cleanText(input.difficulty ?? current.difficulty, 80) || null,
      notes: cleanText(input.notes ?? current.notes, 4000) || null,
      gear: Array.isArray(input.gear) ? input.gear.slice(0, 30).map((item) => cleanText(item, 120)) : (current.gear ?? []),
      updatedAt: now()
    };
    nexus.companion.builds[id] = record;
    return record;
  });
}

export async function upsertCompanionGuide(guildId, input = {}) {
  const id = String(input.id ?? randomUUID());
  const title = cleanText(input.title, 160);
  if (!title) throw new Error('guide title is required');
  return mutateNexusState(guildId, (nexus) => {
    const current = nexus.companion.guides[id] ?? { id, createdAt: now() };
    const record = {
      ...current,
      ...input,
      id,
      title,
      dungeon: cleanText(input.dungeon ?? current.dungeon, 120) || null,
      body: cleanText(input.body ?? current.body, 12000) || '',
      verified: Boolean(input.verified ?? current.verified ?? false),
      updatedAt: now()
    };
    nexus.companion.guides[id] = record;
    return record;
  });
}

export async function createSentinelIncident(guildId, input = {}) {
  const title = cleanText(input.title, 160);
  if (!title) throw new Error('incident title is required');
  return mutateNexusState(guildId, (nexus) => {
    const incident = {
      id: String(input.id ?? randomUUID()),
      title,
      severity: ['low', 'medium', 'high', 'critical'].includes(String(input.severity)) ? String(input.severity) : 'medium',
      status: 'open',
      source: cleanText(input.source, 120) || 'manual',
      summary: cleanText(input.summary, 4000) || null,
      createdAt: now(),
      updatedAt: now(),
      events: [{ at: now(), type: 'opened', note: cleanText(input.note, 1000) || null }]
    };
    nexus.sentinel.incidents.unshift(incident);
    if (nexus.sentinel.incidents.length > 200) nexus.sentinel.incidents.length = 200;
    return incident;
  });
}

export async function updateSentinelIncident(guildId, id, input = {}) {
  return mutateNexusState(guildId, (nexus) => {
    const incident = nexus.sentinel.incidents.find((item) => item.id === id);
    if (!incident) throw new Error('incident not found');
    const status = cleanText(input.status, 30);
    if (status && ['open', 'investigating', 'contained', 'closed'].includes(status)) incident.status = status;
    if (input.summary !== undefined) incident.summary = cleanText(input.summary, 4000) || null;
    if (input.severity && ['low', 'medium', 'high', 'critical'].includes(String(input.severity))) incident.severity = String(input.severity);
    incident.updatedAt = now();
    incident.events ??= [];
    incident.events.push({ at: now(), type: status || 'note', note: cleanText(input.note, 1000) || null });
    if (incident.events.length > 100) incident.events.splice(0, incident.events.length - 100);
    return incident;
  });
}

export async function publishStudioLayout(guildId, id) {
  return mutateNexusState(guildId, (nexus) => {
    const layout = nexus.studio.layouts[id];
    if (!layout) throw new Error('layout not found');
    layout.version = Number(layout.version ?? 0) + 1;
    layout.status = 'published';
    layout.publishedAt = now();
    layout.updatedAt = now();
    return layout;
  });
}

export function buildAdminSnapshot(nexus) {
  return {
    network: { tenants: Object.values(nexus.network?.tenants ?? {}) },
    identity: { profiles: Object.values(nexus.identity?.profiles ?? {}) },
    companion: {
      builds: Object.values(nexus.companion?.builds ?? {}),
      guides: Object.values(nexus.companion?.guides ?? {})
    },
    creators: { campaigns: Object.values(nexus.creators?.campaigns ?? {}) },
    studio: { layouts: Object.values(nexus.studio?.layouts ?? {}) },
    sentinel: {
      incidents: nexus.sentinel?.incidents ?? [],
      lastSnapshot: nexus.sentinel?.lastSnapshot ?? null
    },
    vault: { backups: nexus.vault?.backups ?? [] },
    intelligence: {
      lastSnapshot: nexus.intelligence?.lastSnapshot ?? null,
      snapshots: (nexus.intelligence?.snapshots ?? []).slice(-96)
    },
    ai: {
      enabled: Boolean(nexus.ai?.enabled),
      provider: nexus.ai?.provider ?? 'local',
      lastRequestAt: nexus.ai?.lastRequestAt ?? null,
      lastError: nexus.ai?.lastError ?? null
    },
    flags: nexus.flags ?? {}
  };
}

export function buildTrendSummary(snapshots = []) {
  const history = snapshots.filter(Boolean);
  if (!history.length) return { points: 0, deltas: {} };
  const first = history[0];
  const last = history[history.length - 1];
  const keys = ['membersCached', 'queueDepth', 'openTickets', 'applications', 'activeCarryParties', 'completedCarries'];
  const deltas = {};
  for (const key of keys) {
    const a = Number(first?.[key]);
    const b = Number(last?.[key]);
    deltas[key] = Number.isFinite(a) && Number.isFinite(b) ? b - a : null;
  }
  return { points: history.length, from: first.at ?? null, to: last.at ?? null, deltas };
}
