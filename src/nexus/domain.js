import { randomUUID } from 'node:crypto';
import { mutateNexusState } from './state.js';
import { assertPlainObject, cleanOptionalText, cleanText, safeRecordId, safeStatus } from './validation.js';

function now() {
  return new Date().toISOString();
}

export async function upsertCompanionBuild(guildId, input = {}) {
  assertPlainObject(input, 'companion build');
  const id = safeRecordId(input.id ?? randomUUID(), 'build id');
  const name = cleanText(input.name, 120);
  if (!name) throw Object.assign(new Error('build name is required.'), { statusCode: 400 });
  return mutateNexusState(guildId, (nexus) => {
    const current = nexus.companion.builds[id] ?? { id, createdAt: now() };
    const gearInput = Array.isArray(input.gear) ? input.gear : null;
    const record = {
      ...current,
      id,
      name,
      class: cleanOptionalText(input.class ?? current.class, 80),
      dungeon: cleanOptionalText(input.dungeon ?? current.dungeon, 120),
      difficulty: cleanOptionalText(input.difficulty ?? current.difficulty, 80),
      notes: cleanOptionalText(input.notes ?? current.notes, 4000),
      gear: gearInput ? gearInput.slice(0, 30).map((item) => cleanText(item, 120)).filter(Boolean) : (Array.isArray(current.gear) ? current.gear.slice(0, 30) : []),
      updatedAt: now()
    };
    nexus.companion.builds[id] = record;
    return record;
  });
}

export async function upsertCompanionGuide(guildId, input = {}) {
  assertPlainObject(input, 'companion guide');
  const id = safeRecordId(input.id ?? randomUUID(), 'guide id');
  const title = cleanText(input.title, 160);
  if (!title) throw Object.assign(new Error('guide title is required.'), { statusCode: 400 });
  return mutateNexusState(guildId, (nexus) => {
    const current = nexus.companion.guides[id] ?? { id, createdAt: now() };
    const record = {
      ...current,
      id,
      title,
      dungeon: cleanOptionalText(input.dungeon ?? current.dungeon, 120),
      body: cleanText(input.body ?? current.body, 12000),
      verified: Boolean(input.verified ?? current.verified ?? false),
      updatedAt: now()
    };
    nexus.companion.guides[id] = record;
    return record;
  });
}

export async function upsertCompanionDungeon(guildId, input = {}) {
  assertPlainObject(input, 'companion dungeon');
  const id = safeRecordId(input.id ?? randomUUID(), 'dungeon id');
  const name = cleanText(input.name ?? input.title, 160);
  if (!name) throw Object.assign(new Error('dungeon name is required.'), { statusCode: 400 });
  return mutateNexusState(guildId, (nexus) => {
    const current = nexus.companion.dungeons[id] ?? { id, createdAt: now() };
    const record = {
      ...current,
      id,
      name,
      difficulty: cleanOptionalText(input.difficulty ?? current.difficulty, 80),
      location: cleanOptionalText(input.location ?? input.world ?? current.location, 120),
      rewards: cleanOptionalText(input.rewards ?? current.rewards, 1000),
      notes: cleanOptionalText(input.notes ?? current.notes, 4000),
      status: safeStatus(input.status ?? current.status, ['active', 'legacy', 'hidden'], 'active'),
      updatedAt: now()
    };
    nexus.companion.dungeons[id] = record;
    return record;
  });
}

export async function upsertCompanionReadiness(guildId, input = {}) {
  assertPlainObject(input, 'carry readiness rule');
  const id = safeRecordId(input.id ?? randomUUID(), 'readiness id');
  const name = cleanText(input.name ?? input.title ?? input.requirement, 160);
  if (!name) throw Object.assign(new Error('readiness requirement is required.'), { statusCode: 400 });
  return mutateNexusState(guildId, (nexus) => {
    const current = nexus.companion.readiness[id] ?? { id, createdAt: now() };
    const record = {
      ...current,
      id,
      name,
      description: cleanOptionalText(input.description ?? input.detail ?? current.description, 2000),
      category: cleanOptionalText(input.category ?? current.category, 80),
      required: input.required === undefined ? Boolean(current.required ?? true) : Boolean(input.required),
      status: safeStatus(input.status ?? current.status, ['active', 'optional', 'hidden'], 'active'),
      updatedAt: now()
    };
    nexus.companion.readiness[id] = record;
    return record;
  });
}

export async function createSentinelIncident(guildId, input = {}) {
  assertPlainObject(input, 'sentinel incident');
  const title = cleanText(input.title, 160);
  if (!title) throw Object.assign(new Error('incident title is required.'), { statusCode: 400 });
  const id = safeRecordId(input.id ?? randomUUID(), 'incident id');
  return mutateNexusState(guildId, (nexus) => {
    const incident = {
      id,
      title,
      severity: ['low', 'medium', 'high', 'critical'].includes(String(input.severity)) ? String(input.severity) : 'medium',
      status: 'open',
      source: cleanText(input.source, 120) || 'manual',
      summary: cleanOptionalText(input.summary, 4000),
      createdAt: now(),
      updatedAt: now(),
      events: [{ at: now(), type: 'opened', note: cleanOptionalText(input.note, 1000) }]
    };
    nexus.sentinel.incidents.unshift(incident);
    if (nexus.sentinel.incidents.length > 200) nexus.sentinel.incidents.length = 200;
    return incident;
  });
}

export async function updateSentinelIncident(guildId, id, input = {}) {
  assertPlainObject(input, 'sentinel incident update');
  const targetId = safeRecordId(id, 'incident id');
  return mutateNexusState(guildId, (nexus) => {
    const incident = nexus.sentinel.incidents.find((item) => item.id === targetId);
    if (!incident) throw Object.assign(new Error('incident not found.'), { statusCode: 404 });
    const status = cleanText(input.status, 30).toLowerCase();
    if (status && ['open', 'investigating', 'contained', 'closed'].includes(status)) incident.status = status;
    if (input.summary !== undefined) incident.summary = cleanOptionalText(input.summary, 4000);
    if (input.severity && ['low', 'medium', 'high', 'critical'].includes(String(input.severity))) incident.severity = String(input.severity);
    incident.updatedAt = now();
    incident.events ??= [];
    incident.events.push({ at: now(), type: status || 'note', note: cleanOptionalText(input.note, 1000) });
    if (incident.events.length > 100) incident.events.splice(0, incident.events.length - 100);
    return incident;
  });
}

export async function publishStudioLayout(guildId, id) {
  const targetId = safeRecordId(id, 'layout id');
  return mutateNexusState(guildId, (nexus) => {
    const layout = nexus.studio.layouts[targetId];
    if (!layout) throw Object.assign(new Error('layout not found.'), { statusCode: 404 });

    const publishedAt = now();
    const currentVersion = Math.max(1, Number(layout.version ?? 1));
    const nextVersion = layout.publishedAt ? currentVersion + 1 : currentVersion;
    const snapshot = {
      version: nextVersion,
      publishedAt,
      name: layout.name,
      type: layout.type,
      target: layout.target ?? null,
      components: Array.isArray(layout.components) ? layout.components.map((component) => ({ ...component })) : []
    };

    layout.version = nextVersion;
    layout.status = 'published';
    layout.publishedAt = publishedAt;
    layout.updatedAt = publishedAt;
    layout.history = Array.isArray(layout.history) ? layout.history : [];
    layout.history.push(snapshot);
    if (layout.history.length > 20) layout.history.splice(0, layout.history.length - 20);
    if (nexus.studio?.drafts?.[targetId]) delete nexus.studio.drafts[targetId];
    return layout;
  });
}

export function buildAdminSnapshot(nexus) {
  return {
    network: { tenants: Object.values(nexus.network?.tenants ?? {}) },
    identity: { profiles: Object.values(nexus.identity?.profiles ?? {}) },
    companion: {
      builds: Object.values(nexus.companion?.builds ?? {}),
      guides: Object.values(nexus.companion?.guides ?? {}),
      dungeons: Object.values(nexus.companion?.dungeons ?? {}),
      readiness: Object.values(nexus.companion?.readiness ?? {})
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
