export {
  addGenomeRelation,
  genomeKey,
  getGenomeEntity,
  getGenomeRuns,
  getGenomeSnapshot,
  getGenomeStrategies,
  recordDungeonRun,
  recordGenomeObservation,
  registerGenomeStrategy,
  searchGenome,
  upsertGenomeEntity
} from './genome.js';
export { simulateDungeon } from './digitalTwin.js';
export { runOracle } from './oracle.js';
export {
  acknowledgeSentinelAlert,
  getSentinelAlerts,
  getSentinelSnapshot,
  ingestSentinelSignal
} from './sentinel.js';
export {
  getBankAccount,
  getBankHealth,
  listBankRequests,
  releaseBankAsset,
  requestBankDeposit,
  requestBankWithdrawal,
  reviewBankRequest,
  setBankConfig,
  transferBankBalance
} from './assetBank.js';

import { getGenomeSnapshot, recordDungeonRun } from './genome.js';
import { getSentinelSnapshot, ingestSentinelSignal } from './sentinel.js';
import { getBankHealth } from './assetBank.js';

export async function recordRunAndWatch(guildId, input) {
  const run = await recordDungeonRun(guildId, input);
  const watched = [];
  const common = {
    entityKey: `dungeon:${String(run.dungeon).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
    source: run.source,
    context: {
      dungeon: run.dungeon,
      difficulty: run.difficulty,
      partySize: run.partySize,
      actorId: run.actorId,
      runId: run.id
    }
  };

  if (run.success && Number.isFinite(run.clearSeconds)) {
    watched.push(await ingestSentinelSignal(guildId, { ...common, metric: 'run.clear_seconds', value: run.clearSeconds }));
  }
  watched.push(await ingestSentinelSignal(guildId, { ...common, metric: 'run.success', value: run.success ? 1 : 0, changeThreshold: 0.35 }));
  if (Number.isFinite(run.goldT)) watched.push(await ingestSentinelSignal(guildId, { ...common, metric: 'run.gold_t', value: run.goldT }));
  if (Number.isFinite(run.xp)) watched.push(await ingestSentinelSignal(guildId, { ...common, metric: 'run.xp', value: run.xp }));
  if (Number.isFinite(run.deaths)) watched.push(await ingestSentinelSignal(guildId, { ...common, metric: 'run.deaths', value: run.deaths, changeThreshold: 0.5 }));

  return { run, alerts: watched.map((x) => x.alert).filter(Boolean) };
}

export async function getDQSystemSnapshot(guildId) {
  const [genome, sentinel, bank] = await Promise.all([
    getGenomeSnapshot(guildId),
    getSentinelSnapshot(guildId),
    getBankHealth(guildId)
  ]);
  return {
    genome,
    sentinel,
    bank,
    systems: {
      genome: 'online',
      sentinel: 'online',
      digitalTwin: 'online',
      oracle: 'online',
      assetBank: 'online'
    }
  };
}
