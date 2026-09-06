import { mutateGuildState, readGuildState } from '../storage/store.js';

function pushLedger(state, action, actorId, targetId, details = {}) {
  state.platform ??= {};
  state.platform.auditLedger ??= [];
  state.platform.auditLedger.push({
    id: `AUD-${Date.now().toString(36).toUpperCase()}`,
    at: new Date().toISOString(),
    action,
    actorId: actorId ?? null,
    targetId: targetId ?? null,
    details
  });
  if (state.platform.auditLedger.length > 3000) state.platform.auditLedger = state.platform.auditLedger.slice(-3000);
}

export async function recordAuditLedgerEventV4(entry, guild, botUserId) {
  if (!entry || entry.executorId === botUserId) return false;
  await mutateGuildState(guild.id, async (state) => {
    if (!state.platform?.schemaVersion) return;
    pushLedger(state, 'discord.audit', entry.executorId ?? entry.executor?.id ?? null, entry.targetId ?? entry.target?.id ?? null, {
      action: entry.action,
      reason: entry.reason ?? null,
      changes: Array.isArray(entry.changes) ? entry.changes.slice(0, 12).map((x) => x.key) : []
    });
  });
  return true;
}

export async function runPlatformAutomationV4(guild) {
  const state = await readGuildState(guild.id);
  if (!state.platform?.schemaVersion) return false;

  const listings = Object.values(state.marketV4?.listings ?? {}).filter((x) => x.status === 'active');
  const watchlists = state.marketV4?.watchlists ?? {};
  const notified = state.marketV4?.notified ?? {};
  const deliveries = [];

  for (const [userId, queries] of Object.entries(watchlists)) {
    for (const listing of listings) {
      if (listing.sellerId === userId) continue;
      if (notified[userId]?.[listing.id]) continue;
      const haystack = `${listing.item ?? ''} ${listing.price ?? ''} ${listing.notes ?? ''}`.toLowerCase();
      const matched = (queries ?? []).find((q) => haystack.includes(String(q).toLowerCase()));
      if (!matched) continue;
      deliveries.push({ userId, listing, matched });
      if (deliveries.length >= 100) break;
    }
    if (deliveries.length >= 100) break;
  }

  const delivered = [];
  for (const item of deliveries) {
    const member = await guild.members.fetch(item.userId).catch(() => null);
    if (!member) continue;
    const sent = await member.send({
      content: [
        '🔔 **Kingdom Marketplace Watch**',
        `A listing matched **${item.matched}**.`,
        '',
        `**${item.listing.item}** — ${item.listing.price}`,
        item.listing.notes ? `> ${item.listing.notes}` : '',
        `Seller: <@${item.listing.sellerId}>`
      ].filter(Boolean).join('\n'),
      allowedMentions: { parse: [] }
    }).then(() => true).catch(() => false);
    if (sent) delivered.push(item);
  }

  if (delivered.length) {
    await mutateGuildState(guild.id, async (fresh) => {
      fresh.marketV4 ??= {};
      fresh.marketV4.notified ??= {};
      for (const item of delivered) {
        fresh.marketV4.notified[item.userId] ??= {};
        fresh.marketV4.notified[item.userId][item.listing.id] = new Date().toISOString();
        pushLedger(fresh, 'market.watch_notified', null, item.userId, { listingId: item.listing.id, matched: item.matched });
      }
    });
  }
  return { delivered: delivered.length };
}
