function values(value) {
  return Array.isArray(value) ? value : Object.values(value ?? {});
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function displayMember(member) {
  if (!member) return null;
  return {
    discordId: member.id,
    id: member.id,
    username: member.user?.username ?? member.displayName,
    name: member.displayName,
    globalName: member.user?.globalName ?? null,
    avatar: member.user?.avatar ?? null,
    avatarUrl: member.displayAvatarURL?.({ size: 128 }) ?? null,
    roles: member.roles?.cache
      ? [...member.roles.cache.values()]
          .filter((role) => role.id !== member.guild.id)
          .sort((a, b) => b.position - a.position)
          .map((role) => role.name)
      : [],
    joinedAt: member.joinedAt?.toISOString?.() ?? null
  };
}

function houseFromRoles(roles = []) {
  const role = roles.find((name) => /house\s+(drakon|leonis|aether|fenrir)/i.test(String(name)));
  return role?.match(/house\s+(.+)/i)?.[1] ?? null;
}

export function buildLivePayload(state, guild) {
  const rawQueue = Array.isArray(state.queue) ? state.queue : [];
  const rawParties = values(state.carryParties ?? state.parties);
  const activeParties = rawParties.filter((party) => !['ended', 'closed', 'completed', 'cancelled'].includes(String(party?.status ?? '').toLowerCase()));
  const openTickets = values(state.tickets).filter((ticket) => !['closed', 'resolved', 'done'].includes(String(ticket?.status ?? '').toLowerCase())).length;

  const queue = rawQueue.slice(0, 200).map((entry, index) => ({
    id: entry.id ?? entry.requestId ?? `${index}`,
    member: entry.username ?? entry.displayName ?? entry.robloxUsername ?? entry.userId ?? entry.memberId ?? null,
    memberId: entry.userId ?? entry.memberId ?? null,
    request: entry.dungeon ?? entry.request ?? entry.type ?? entry.mode ?? null,
    dungeon: entry.dungeon ?? null,
    difficulty: entry.difficulty ?? entry.mode ?? null,
    joinedAt: entry.joinedAt ?? entry.createdAt ?? entry.queuedAt ?? null,
    status: entry.status ?? 'waiting'
  }));

  const sessions = activeParties.slice(0, 100).map((party, index) => {
    const completedRuns = number(party.completedRuns ?? party.runsCompleted ?? party.runCount);
    const targetRuns = party.unlimited || party.targetRuns === Infinity ? '∞' : (party.targetRuns ?? party.runsTarget ?? null);
    const participants = values(party.members ?? party.participants ?? party.roster);
    return {
      ...party,
      id: party.id ?? party.partyId ?? `${index}`,
      title: party.title ?? party.dungeon ?? party.name ?? 'Carry session',
      dungeon: party.dungeon ?? party.mode ?? null,
      difficulty: party.difficulty ?? null,
      carrier: party.carrierName ?? party.carrierUsername ?? party.carrierId ?? party.hostId ?? party.host ?? null,
      client: party.clientName ?? party.memberName ?? party.userId ?? party.clientId ?? null,
      status: party.status ?? 'running',
      startedAt: party.startedAt ?? party.createdAt ?? party.openedAt ?? null,
      completedRuns,
      targetRuns,
      progress: targetRuns == null ? String(completedRuns) : `${completedRuns} / ${targetRuns}`,
      participants,
      partySize: participants.length,
      maxPartySize: party.maxPartySize ?? party.maxMembers ?? party.capacity ?? null
    };
  });

  const sourceEvents = Array.isArray(state.events)
    ? state.events
    : Array.isArray(state.activity)
      ? state.activity
      : Array.isArray(state.eventLog)
        ? state.eventLog
        : [];
  const events = sourceEvents.slice(-100).reverse().map((event) => ({
    type: event.type ?? event.event ?? 'event',
    title: event.title ?? event.type ?? event.event ?? 'Event',
    message: event.message ?? event.description ?? event.title ?? event.type ?? 'Kingdom Core event',
    detail: event.detail ?? event.description ?? null,
    at: event.at ?? event.timestamp ?? event.createdAt ?? null
  }));

  return {
    guild: guild ? { id: guild.id, name: guild.name, memberCount: guild.memberCount ?? null } : null,
    members: guild?.memberCount ?? null,
    queueDepth: queue.length,
    queue,
    activeCarrySessions: sessions.length,
    activeCarries: sessions.length,
    sessions,
    openTickets,
    completedCarries: number(state.stats?.completedCarries ?? state.platform?.analytics?.completedCarries),
    pendingApplications: values(state.applications).filter((app) => ['pending', 'reviewing', 'interview'].includes(String(app?.status ?? 'pending').toLowerCase())).length,
    operatorsOnline: guild?.members?.cache
      ? [...guild.members.cache.values()].filter((member) => !member.user?.bot && member.presence?.status && member.presence.status !== 'offline' && (member.permissions?.has?.('ManageGuild') || member.permissions?.has?.('Administrator'))).length
      : 0,
    events,
    updatedAt: new Date().toISOString()
  };
}

export function buildIdentityPayload(guild, nexus, state) {
  const profiles = values(nexus.identity?.profiles);
  const byId = new Map(profiles.map((profile) => [String(profile.discordId ?? profile.discord_id ?? profile.id ?? ''), profile]));
  const members = guild?.members?.cache ? [...guild.members.cache.values()].filter((member) => !member.user?.bot) : [];

  const merged = members.map((member) => {
    const basic = displayMember(member);
    const profile = byId.get(member.id) ?? {};
    const roles = basic.roles ?? [];
    return {
      ...profile,
      ...basic,
      robloxUsername: profile.robloxUsername ?? profile.roblox ?? profile.roblox_name ?? null,
      robloxId: profile.robloxUserId ?? profile.robloxId ?? profile.roblox_id ?? null,
      house: profile.house ?? houseFromRoles(roles),
      aliases: profile.aliases ?? profile.history ?? [],
      carriesCompleted: number(profile.carriesCompleted ?? state.carrierStats?.[member.id]?.completed ?? state.memberStats?.[member.id]?.carriesCompleted),
      applications: number(profile.applications ?? values(state.applications).filter((app) => String(app.userId ?? app.discordId) === member.id).length),
      lastSeen: profile.lastSeen ?? profile.updatedAt ?? null
    };
  });

  const known = new Set(merged.map((profile) => String(profile.discordId ?? profile.id)));
  for (const profile of profiles) {
    const id = String(profile.discordId ?? profile.discord_id ?? profile.id ?? '');
    if (id && !known.has(id)) merged.push(profile);
  }

  return { members: merged, profiles: merged, total: merged.length };
}

export function buildApplicationsPayload(state, guild) {
  const reviews = state.applicationReviewVNext ?? {};
  const applications = values(state.applications).map((app) => {
    const review = reviews[app.id] ?? {};
    const member = guild?.members?.cache?.get?.(String(app.userId ?? app.discordId ?? '')) ?? null;
    const answers = app.answers && !Array.isArray(app.answers)
      ? Object.entries(app.answers).map(([question, answer]) => ({ question, answer }))
      : (app.answers ?? app.responses ?? []);
    return {
      ...app,
      id: app.id,
      discordId: app.userId ?? app.discordId ?? null,
      applicant: member?.displayName ?? member?.user?.username ?? app.username ?? app.applicant ?? app.userId ?? 'Unknown',
      username: member?.user?.username ?? app.username ?? null,
      avatar: member?.displayAvatarURL?.({ size: 128 }) ?? null,
      robloxUsername: app.robloxUsername ?? app.roblox ?? app.answers?.['Roblox Username'] ?? null,
      type: app.type ?? app.applicationType ?? 'staff',
      status: app.status ?? review.decision ?? 'Pending',
      stage: app.status ?? review.decision ?? 'Pending',
      score: review.grade ?? app.grade ?? app.score ?? null,
      grade: review.grade ?? app.grade ?? app.score ?? null,
      reviewer: review.claimedBy ?? app.reviewerId ?? app.reviewer ?? null,
      reviewerNotes: review.notes ?? [],
      notes: review.notes ?? [],
      finalNote: review.finalNote ?? null,
      decision: review.decision ?? app.status ?? 'Pending',
      answers,
      submittedAt: app.createdAt ?? app.submittedAt ?? null,
      createdAt: app.createdAt ?? app.submittedAt ?? null,
      reviewedAt: app.reviewedAt ?? review.finalizedAt ?? review.updatedAt ?? null
    };
  }).sort((a, b) => new Date(b.createdAt ?? 0) - new Date(a.createdAt ?? 0));

  const counts = { pending: 0, reviewing: 0, interview: 0, accepted: 0, denied: 0 };
  for (const app of applications) {
    const key = String(app.status ?? 'pending').toLowerCase();
    if (key in counts) counts[key]++;
  }
  const pending = counts.pending + counts.reviewing + counts.interview;
  return { applications, pending, count: applications.length, counts };
}

export function buildCompanionPayload(nexus, state) {
  return {
    builds: values(nexus.companion?.builds),
    guides: values(nexus.companion?.guides),
    dungeons: values(nexus.companion?.dungeons ?? state.companion?.dungeons ?? state.platform?.dungeons),
    readiness: values(nexus.companion?.readiness ?? state.companion?.readiness ?? state.platform?.carryReadiness)
  };
}

export function buildCreatorsPayload(nexus) {
  const campaigns = values(nexus.creators?.campaigns);
  const live = campaigns.filter((item) => ['active', 'live', 'running'].includes(String(item.status ?? 'active').toLowerCase()));
  return {
    creators: campaigns,
    campaigns,
    activeCreators: new Set(live.map((item) => item.creatorId ?? item.creator ?? item.creatorName ?? item.id)).size,
    liveCampaigns: live.length,
    referrals: campaigns.reduce((sum, item) => sum + number(item.referrals ?? item.referralCount), 0),
    reach: campaigns.reduce((sum, item) => sum + number(item.audience ?? item.followers ?? item.reach), 0)
  };
}

export function buildVaultPayload(nexus, verification = null) {
  const verifyByFile = new Map(values(verification).map((item) => [String(item.file ?? ''), item]));
  const backups = values(nexus.vault?.backups)
    .map((item) => {
      const check = verifyByFile.get(String(item.file ?? ''));
      return {
        ...item,
        timestamp: item.at ?? item.createdAt ?? item.timestamp ?? null,
        createdAt: item.at ?? item.createdAt ?? item.timestamp ?? null,
        size: number(item.bytes ?? item.size),
        checksum: item.sha256 ?? item.checksum ?? null,
        verified: check?.verified ?? item.verified ?? false,
        exists: check?.exists ?? item.exists ?? null,
        status: check ? (check.verified ? 'ok' : 'failed') : (item.status ?? 'pending')
      };
    })
    .sort((a, b) => new Date(b.timestamp ?? 0) - new Date(a.timestamp ?? 0));

  const verified = backups.filter((item) => item.verified === true);
  return {
    backups,
    snapshots: backups,
    latest: backups[0]?.timestamp ?? null,
    oldest: backups.at(-1)?.timestamp ?? null,
    healthy: backups.length > 0 && verified.length === backups.length,
    retention: backups.length,
    retentionCount: backups.length,
    totalSnapshots: backups.length,
    totalSize: backups.reduce((sum, item) => sum + number(item.size), 0),
    verified: verified.length,
    integrityChecks: backups.slice(0, 25).map((item) => ({
      name: item.file ?? item.id ?? 'Snapshot',
      status: item.verified ? 'ok' : item.exists === false ? 'failed' : 'pending',
      at: item.timestamp
    }))
  };
}

export function buildStudioPayload(nexus) {
  const layouts = values(nexus.studio?.layouts).sort((a, b) => new Date(b.updatedAt ?? 0) - new Date(a.updatedAt ?? 0));
  return { layouts, data: layouts, count: layouts.length };
}

export function buildNetworkPayload(nexus, guild, state = {}) {
  const tenants = values(nexus.network?.tenants);
  const primary = guild ? {
    id: guild.id,
    discordId: guild.id,
    name: guild.name,
    status: 'active',
    members: guild.memberCount ?? null,
    carries: number(state.stats?.completedCarries ?? state.platform?.analytics?.completedCarries),
    health: 100,
    lastSync: new Date().toISOString(),
    region: process.env.KINGDOM_REGION ?? 'UK',
    primary: true
  } : null;
  const seen = new Set(primary ? [primary.id] : []);
  const guilds = [];
  if (primary) guilds.push(primary);
  for (const tenant of tenants) {
    const id = String(tenant.discordId ?? tenant.id ?? '');
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    guilds.push({
      ...tenant,
      id: tenant.id ?? tenant.discordId,
      discordId: tenant.discordId ?? tenant.id,
      status: tenant.status ?? 'active',
      members: tenant.members ?? tenant.memberCount ?? null,
      carries: tenant.carries ?? tenant.carryCount ?? 0,
      health: tenant.health ?? tenant.healthScore ?? null,
      lastSync: tenant.lastSync ?? tenant.updatedAt ?? null
    });
  }
  return {
    tenants,
    guilds,
    totalGuilds: guilds.length,
    active: guilds.filter((item) => String(item.status ?? 'active').toLowerCase() === 'active').length,
    members: guilds.reduce((sum, item) => sum + number(item.members), 0),
    totalMembers: guilds.reduce((sum, item) => sum + number(item.members), 0),
    totalCarries: guilds.reduce((sum, item) => sum + number(item.carries), 0),
    lastSync: new Date().toISOString(),
    healthChecks: [
      { name: 'Kingdom Core', status: 'healthy' },
      { name: 'Kingdom Nexus API', status: 'healthy' },
      { name: 'Discord Gateway', status: guild ? 'healthy' : 'degraded' }
    ],
    platform: 'Kingdom Network'
  };
}
