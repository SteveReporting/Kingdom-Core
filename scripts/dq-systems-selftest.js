import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

process.env.DQ_DATA_DIR = 'data/.dq-selftest';

const {
  getBankAccount,
  getBankHealth,
  getDQSystemSnapshot,
  ingestSentinelSignal,
  recordRunAndWatch,
  registerGenomeStrategy,
  requestBankDeposit,
  requestBankWithdrawal,
  reviewBankRequest,
  runOracle,
  simulateDungeon,
  transferBankBalance,
  upsertGenomeEntity
} = await import('../src/dq/index.js');

const guildId = `selftest_${Date.now()}`;
const userA = '100000000000000001';
const userB = '100000000000000002';
const operator = '100000000000000099';

try {
  await upsertGenomeEntity(guildId, {
    kind: 'dungeon',
    name: 'Test Citadel',
    data: { recommendedLevel: 100 },
    confidence: 0.95,
    source: 'selftest'
  });

  await registerGenomeStrategy(guildId, {
    name: 'Citadel Fast',
    dungeon: 'Test Citadel',
    difficulty: 'Nightmare',
    objective: 'speed',
    scenario: { baselineSeconds: 220, partySize: 4, successProbability: 0.88 },
    confidence: 0.8,
    source: 'selftest'
  });
  await registerGenomeStrategy(guildId, {
    name: 'Citadel Safe',
    dungeon: 'Test Citadel',
    difficulty: 'Nightmare',
    objective: 'speed',
    scenario: { baselineSeconds: 245, partySize: 4, successProbability: 0.98 },
    confidence: 0.9,
    source: 'selftest'
  });

  for (let i = 0; i < 14; i += 1) {
    await recordRunAndWatch(guildId, {
      dungeon: 'Test Citadel',
      difficulty: 'Nightmare',
      success: true,
      clearSeconds: 218 + (i % 5),
      partySize: 4,
      power: 1000,
      health: 5000,
      goldT: 0.12,
      xp: 50000,
      deaths: 0,
      actorId: userA,
      source: 'selftest'
    });
  }

  const twin = await simulateDungeon(guildId, {
    dungeon: 'Test Citadel',
    difficulty: 'Nightmare',
    partySize: 4,
    power: 1000,
    health: 5000,
    samples: 500
  });
  assert.ok(twin.clearRate > 0.8);
  assert.ok(twin.expectedClearSeconds > 150 && twin.expectedClearSeconds < 300);
  assert.ok(twin.evidenceCount >= 14);

  const oracle = await runOracle(guildId, {
    objective: 'speed',
    dungeon: 'Test Citadel',
    partySize: 4,
    power: 1000,
    health: 5000,
    riskTolerance: 0.5,
    samples: 300
  });
  assert.ok(oracle.best);
  assert.equal(oracle.evaluated, 2);

  for (let i = 0; i < 10; i += 1) {
    await ingestSentinelSignal(guildId, {
      metric: 'market.example_value_t',
      entityKey: 'item:test-blade',
      value: 10 + ((i % 3) * 0.01),
      source: 'selftest',
      cooldownMs: 0
    });
  }
  const anomaly = await ingestSentinelSignal(guildId, {
    metric: 'market.example_value_t',
    entityKey: 'item:test-blade',
    value: 16,
    source: 'selftest',
    cooldownMs: 0
  });
  assert.ok(anomaly.alert);

  const deposit = await requestBankDeposit(guildId, {
    userId: userA,
    itemKey: 'test-blade|legendary',
    itemName: 'Test Blade',
    rarity: 'Legendary',
    quantity: 1,
    assessedValueT: 10,
    valuationSource: 'selftest'
  });
  assert.equal(deposit.status, 'pending');
  await reviewBankRequest(guildId, {
    requestId: deposit.id,
    action: 'approve',
    operatorId: operator,
    note: 'Selftest receipt'
  });

  let accountA = await getBankAccount(guildId, userA);
  assert.equal(accountA.availableT, 9);

  await transferBankBalance(guildId, {
    fromUserId: userA,
    toUserId: userB,
    amountT: 2,
    memo: 'Selftest transfer'
  });
  accountA = await getBankAccount(guildId, userA);
  const accountB = await getBankAccount(guildId, userB);
  assert.equal(accountA.availableT, 7);
  assert.equal(accountB.availableT, 2);

  const withdrawal = await requestBankWithdrawal(guildId, { userId: userB, amountT: 1 });
  await reviewBankRequest(guildId, {
    requestId: withdrawal.id,
    action: 'approve',
    operatorId: operator,
    note: 'Selftest payout'
  });
  const health = await getBankHealth(guildId);
  assert.ok(health.heldMarketValueT >= 10);
  assert.ok(health.liabilitiesT >= 8);

  const snapshot = await getDQSystemSnapshot(guildId);
  assert.equal(snapshot.systems.genome, 'online');
  assert.equal(snapshot.systems.assetBank, 'online');
  assert.ok(snapshot.genome.runs >= 14);

  console.log('DQ systems selftest passed.');
  console.log(JSON.stringify({
    genomeRuns: snapshot.genome.runs,
    sentinelAlerts: snapshot.sentinel.alerts,
    twinClearRate: twin.clearRate,
    oracleBest: oracle.best.name,
    bankLiabilitiesT: health.liabilitiesT,
    bankCoverage: health.coverageRatio
  }, null, 2));
} finally {
  const target = path.resolve(process.env.DQ_DATA_DIR, `${guildId}.json`);
  await fs.rm(target, { force: true }).catch(() => null);
}
