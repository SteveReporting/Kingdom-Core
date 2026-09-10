import { getMarketValue } from '../services/marketIntelligence.js';
import { mutateDQState, newDQId, readDQState, trimArray } from './store.js';

function clean(value) {
  return String(value ?? '').trim();
}

function money(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.round(number * 1_000_000) / 1_000_000;
}

function ensurePositive(value, label) {
  const number = money(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${label} must be greater than zero.`);
  return number;
}

function accountFor(state, userId) {
  const id = clean(userId);
  if (!id) throw new Error('Bank user id is required.');
  if (!state.bank.accounts[id]) {
    state.bank.accounts[id] = {
      userId: id,
      availableT: 0,
      lockedT: 0,
      lifetimeDepositsT: 0,
      lifetimeWithdrawalsT: 0,
      lifetimeTransfersInT: 0,
      lifetimeTransfersOutT: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }
  return state.bank.accounts[id];
}

function addLedger(state, entry) {
  const record = {
    id: newDQId('ledger'),
    createdAt: new Date().toISOString(),
    ...entry
  };
  state.bank.ledger.push(record);
  trimArray(state.bank.ledger, 20_000);
  state.bank.updatedAt = record.createdAt;
  return record;
}

export async function requestBankDeposit(guildId, input) {
  const userId = clean(input?.userId);
  const itemKey = clean(input?.itemKey);
  const quantity = Math.max(1, Math.min(999, Math.floor(Number(input?.quantity || 1))));
  if (!userId || !itemKey) throw new Error('Deposit requires a user and item.');

  const state = await readDQState(guildId);
  const creditRate = Math.max(0.1, Math.min(1, Number(state.bank.config.creditRate || 0.9)));
  let unitMarketValueT = money(input?.assessedValueT);
  let valuationSource = clean(input?.valuationSource) || 'manual';
  let marketSnapshot = null;

  if (!Number.isFinite(unitMarketValueT)) {
    const detail = await getMarketValue(itemKey, Number.isFinite(Number(input?.pot)) ? Number(input.pot) : null);
    marketSnapshot = detail?.market || null;
    unitMarketValueT = money(marketSnapshot?.fair_value_t);
    valuationSource = 'kmi';
  }
  unitMarketValueT = ensurePositive(unitMarketValueT, 'Assessed market value');

  const marketValueT = money(unitMarketValueT * quantity);
  const creditValueT = money(marketValueT * creditRate);
  const now = new Date().toISOString();
  const request = {
    id: newDQId('dep'),
    type: 'deposit',
    status: 'pending',
    userId,
    itemKey,
    itemName: marketSnapshot?.item_name || clean(input?.itemName) || itemKey,
    rarity: marketSnapshot?.rarity || clean(input?.rarity) || null,
    pot: Number.isFinite(Number(input?.pot)) ? Number(input.pot) : null,
    quantity,
    unitMarketValueT,
    marketValueT,
    creditRate,
    creditValueT,
    valuationSource,
    valuationConfidence: Number.isFinite(Number(marketSnapshot?.confidence)) ? Number(marketSnapshot.confidence) : null,
    marketSnapshot,
    note: clean(input?.note) || null,
    createdAt: now,
    reviewedAt: null,
    reviewedBy: null
  };

  return mutateDQState(guildId, (draft) => {
    draft.bank.requests[request.id] = request;
    draft.bank.updatedAt = now;
    return request;
  });
}

export async function requestBankWithdrawal(guildId, input) {
  const userId = clean(input?.userId);
  const amountT = ensurePositive(input?.amountT, 'Withdrawal');
  const now = new Date().toISOString();
  return mutateDQState(guildId, (state) => {
    const account = accountFor(state, userId);
    if (account.availableT + 1e-9 < amountT) throw new Error(`Insufficient available balance. Available: ${account.availableT}T.`);
    account.availableT = money(account.availableT - amountT);
    account.lockedT = money(account.lockedT + amountT);
    account.updatedAt = now;
    const request = {
      id: newDQId('wd'),
      type: 'withdrawal',
      status: 'pending',
      userId,
      amountT,
      preferredSettlement: clean(input?.preferredSettlement) || 'gold_or_equivalent_assets',
      note: clean(input?.note) || null,
      createdAt: now,
      reviewedAt: null,
      reviewedBy: null
    };
    state.bank.requests[request.id] = request;
    addLedger(state, {
      type: 'withdrawal_hold',
      userId,
      amountT,
      requestId: request.id,
      availableAfterT: account.availableT,
      lockedAfterT: account.lockedT
    });
    return request;
  });
}

export async function transferBankBalance(guildId, input) {
  const fromUserId = clean(input?.fromUserId);
  const toUserId = clean(input?.toUserId);
  const amountT = ensurePositive(input?.amountT, 'Transfer');
  if (!fromUserId || !toUserId || fromUserId === toUserId) throw new Error('Transfer requires two different users.');
  const now = new Date().toISOString();

  return mutateDQState(guildId, (state) => {
    const from = accountFor(state, fromUserId);
    const to = accountFor(state, toUserId);
    if (from.availableT + 1e-9 < amountT) throw new Error(`Insufficient available balance. Available: ${from.availableT}T.`);
    from.availableT = money(from.availableT - amountT);
    to.availableT = money(to.availableT + amountT);
    from.lifetimeTransfersOutT = money(from.lifetimeTransfersOutT + amountT);
    to.lifetimeTransfersInT = money(to.lifetimeTransfersInT + amountT);
    from.updatedAt = now;
    to.updatedAt = now;
    const ledger = addLedger(state, {
      type: 'internal_transfer',
      fromUserId,
      toUserId,
      amountT,
      memo: clean(input?.memo) || null,
      fromAvailableAfterT: from.availableT,
      toAvailableAfterT: to.availableT
    });
    return { ledger, from: { ...from }, to: { ...to } };
  });
}

export async function reviewBankRequest(guildId, input) {
  const requestId = clean(input?.requestId);
  const operatorId = clean(input?.operatorId);
  const action = clean(input?.action).toLowerCase();
  if (!requestId || !operatorId) throw new Error('Review requires a request id and operator.');
  if (!['approve', 'reject'].includes(action)) throw new Error('Review action must be approve or reject.');
  const now = new Date().toISOString();

  return mutateDQState(guildId, (state) => {
    const request = state.bank.requests[requestId];
    if (!request) throw new Error('Bank request not found.');
    if (request.status !== 'pending') throw new Error(`Bank request is already ${request.status}.`);
    const account = accountFor(state, request.userId);

    if (request.type === 'deposit') {
      if (action === 'approve') {
        const asset = {
          id: newDQId('asset'),
          depositorId: request.userId,
          itemKey: request.itemKey,
          itemName: request.itemName,
          rarity: request.rarity,
          pot: request.pot,
          quantity: request.quantity,
          marketValueT: request.marketValueT,
          creditValueT: request.creditValueT,
          valuationSource: request.valuationSource,
          status: 'held',
          depositRequestId: request.id,
          receivedBy: operatorId,
          receivedAt: now,
          releasedAt: null,
          releasedBy: null,
          releaseReason: null
        };
        state.bank.assets[asset.id] = asset;
        account.availableT = money(account.availableT + request.creditValueT);
        account.lifetimeDepositsT = money(account.lifetimeDepositsT + request.creditValueT);
        account.updatedAt = now;
        request.assetId = asset.id;
        addLedger(state, {
          type: 'deposit_credit',
          userId: request.userId,
          amountT: request.creditValueT,
          marketValueT: request.marketValueT,
          requestId: request.id,
          assetId: asset.id,
          operatorId,
          availableAfterT: account.availableT
        });
      }
    } else if (request.type === 'withdrawal') {
      if (account.lockedT + 1e-9 < request.amountT) throw new Error('Withdrawal lock is inconsistent with the account ledger.');
      account.lockedT = money(account.lockedT - request.amountT);
      if (action === 'approve') {
        account.lifetimeWithdrawalsT = money(account.lifetimeWithdrawalsT + request.amountT);
        addLedger(state, {
          type: 'withdrawal_settled',
          userId: request.userId,
          amountT: request.amountT,
          requestId: request.id,
          operatorId,
          settlementNote: clean(input?.note) || null,
          availableAfterT: account.availableT,
          lockedAfterT: account.lockedT
        });
      } else {
        account.availableT = money(account.availableT + request.amountT);
        addLedger(state, {
          type: 'withdrawal_released',
          userId: request.userId,
          amountT: request.amountT,
          requestId: request.id,
          operatorId,
          availableAfterT: account.availableT,
          lockedAfterT: account.lockedT
        });
      }
      account.updatedAt = now;
    } else {
      throw new Error(`Unsupported bank request type: ${request.type}`);
    }

    request.status = action === 'approve' ? 'approved' : 'rejected';
    request.reviewedAt = now;
    request.reviewedBy = operatorId;
    request.reviewNote = clean(input?.note) || null;
    state.bank.updatedAt = now;
    return { request: { ...request }, account: { ...account } };
  });
}

export async function releaseBankAsset(guildId, input) {
  const assetId = clean(input?.assetId);
  const operatorId = clean(input?.operatorId);
  if (!assetId || !operatorId) throw new Error('Asset release requires an asset id and operator.');
  const now = new Date().toISOString();
  return mutateDQState(guildId, (state) => {
    const asset = state.bank.assets[assetId];
    if (!asset) throw new Error('Bank asset not found.');
    if (asset.status !== 'held') throw new Error(`Bank asset is already ${asset.status}.`);
    asset.status = 'released';
    asset.releasedAt = now;
    asset.releasedBy = operatorId;
    asset.releaseReason = clean(input?.reason) || 'settlement';
    addLedger(state, {
      type: 'asset_released',
      assetId,
      operatorId,
      marketValueT: asset.marketValueT,
      reason: asset.releaseReason,
      requestId: clean(input?.requestId) || null
    });
    return { ...asset };
  });
}

export async function getBankAccount(guildId, userId) {
  const state = await readDQState(guildId);
  const id = clean(userId);
  const account = state.bank.accounts[id] || {
    userId: id,
    availableT: 0,
    lockedT: 0,
    lifetimeDepositsT: 0,
    lifetimeWithdrawalsT: 0,
    lifetimeTransfersInT: 0,
    lifetimeTransfersOutT: 0
  };
  const requests = Object.values(state.bank.requests)
    .filter((request) => request.userId === id && request.status === 'pending')
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return { ...account, totalT: money(account.availableT + account.lockedT), pendingRequests: requests };
}

export async function listBankRequests(guildId, options = {}) {
  const state = await readDQState(guildId);
  const status = clean(options.status || 'pending').toLowerCase();
  const limit = Math.max(1, Math.min(100, Number(options.limit || 20)));
  return Object.values(state.bank.requests)
    .filter((request) => !status || request.status === status)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, limit);
}

export async function getBankHealth(guildId) {
  const state = await readDQState(guildId);
  const accounts = Object.values(state.bank.accounts);
  const assets = Object.values(state.bank.assets).filter((asset) => asset.status === 'held');
  const liabilitiesT = money(accounts.reduce((sum, account) => sum + Number(account.availableT || 0) + Number(account.lockedT || 0), 0));
  const heldMarketValueT = money(assets.reduce((sum, asset) => sum + Number(asset.marketValueT || 0), 0));
  const heldCreditValueT = money(assets.reduce((sum, asset) => sum + Number(asset.creditValueT || 0), 0));
  const coverageRatio = liabilitiesT > 0 ? heldMarketValueT / liabilitiesT : null;
  const pendingDeposits = Object.values(state.bank.requests).filter((request) => request.type === 'deposit' && request.status === 'pending').length;
  const pendingWithdrawals = Object.values(state.bank.requests).filter((request) => request.type === 'withdrawal' && request.status === 'pending').length;
  return {
    accounts: accounts.length,
    heldAssets: assets.length,
    liabilitiesT,
    heldMarketValueT,
    heldCreditValueT,
    coverageRatio,
    creditRate: state.bank.config.creditRate,
    reserveRatio: state.bank.config.reserveRatio,
    pendingDeposits,
    pendingWithdrawals,
    ledgerEntries: state.bank.ledger.length,
    updatedAt: state.bank.updatedAt
  };
}

export async function setBankConfig(guildId, input) {
  return mutateDQState(guildId, (state) => {
    if (Number.isFinite(Number(input?.creditRate))) state.bank.config.creditRate = Math.max(0.1, Math.min(1, Number(input.creditRate)));
    if (Number.isFinite(Number(input?.reserveRatio))) state.bank.config.reserveRatio = Math.max(0, Math.min(0.95, Number(input.reserveRatio)));
    state.bank.updatedAt = new Date().toISOString();
    return { ...state.bank.config };
  });
}
