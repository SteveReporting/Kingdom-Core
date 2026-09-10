import { mutateDQState, newDQId, readDQState, trimArray } from './store.js';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function stddev(values, avg = mean(values)) {
  if (values.length < 2 || !Number.isFinite(avg)) return 0;
  return Math.sqrt(values.reduce((sum, value) => sum + ((value - avg) ** 2), 0) / (values.length - 1));
}

function seriesKey(input) {
  const metric = String(input?.metric || '').trim().toLowerCase();
  if (!metric) throw new Error('Sentinel metric is required.');
  const entityKey = String(input?.entityKey || 'global').trim().toLowerCase();
  return `${metric}|${entityKey}`;
}

function severityFor(zScore, relativeChange) {
  const z = Math.abs(zScore || 0);
  const r = Math.abs(relativeChange || 0);
  if (z >= 5 || r >= 0.75) return 'critical';
  if (z >= 4 || r >= 0.45) return 'high';
  if (z >= 3 || r >= 0.25) return 'medium';
  return 'low';
}

export async function ingestSentinelSignal(guildId, input) {
  const value = Number(input?.value);
  if (!Number.isFinite(value)) throw new Error('Sentinel signal value must be numeric.');
  const key = seriesKey(input);
  const now = input?.timestamp || new Date().toISOString();
  const minSamples = clamp(Math.floor(Number(input?.minSamples || 8)), 4, 100);
  const baselineWindow = clamp(Math.floor(Number(input?.baselineWindow || 30)), minSamples, 250);
  const zThreshold = Number.isFinite(Number(input?.zThreshold)) ? Number(input.zThreshold) : 3;
  const changeThreshold = Number.isFinite(Number(input?.changeThreshold)) ? Number(input.changeThreshold) : 0.15;

  return mutateDQState(guildId, (state) => {
    const series = state.sentinel.series[key] || {
      key,
      metric: String(input.metric).trim().toLowerCase(),
      entityKey: String(input?.entityKey || 'global').trim(),
      points: [],
      lastAlertAt: null
    };

    const prior = series.points.slice(-baselineWindow);
    const priorValues = prior.map((point) => Number(point.value)).filter(Number.isFinite);
    const baselineMean = mean(priorValues);
    const baselineStd = stddev(priorValues, baselineMean);
    const relativeChange = Number.isFinite(baselineMean) && Math.abs(baselineMean) > 1e-9
      ? (value - baselineMean) / Math.abs(baselineMean)
      : null;
    const zScore = Number.isFinite(baselineMean) && baselineStd > 1e-9
      ? (value - baselineMean) / baselineStd
      : null;

    const point = {
      id: newDQId('sig'),
      value,
      context: input?.context || {},
      source: input?.source || 'system',
      timestamp: now
    };
    series.points.push(point);
    trimArray(series.points, 500);
    series.updatedAt = now;

    let alert = null;
    const enoughSamples = priorValues.length >= minSamples;
    const zTriggered = Number.isFinite(zScore) && Math.abs(zScore) >= zThreshold;
    const changeTriggered = Number.isFinite(relativeChange) && Math.abs(relativeChange) >= changeThreshold;
    const cooldownMs = Number(input?.cooldownMs || 60 * 60 * 1000);
    const cooldownClear = !series.lastAlertAt || (Date.parse(now) - Date.parse(series.lastAlertAt)) >= cooldownMs;

    if (enoughSamples && cooldownClear && (zTriggered || changeTriggered)) {
      alert = {
        id: newDQId('alert'),
        metric: series.metric,
        entityKey: series.entityKey,
        value,
        baselineMean,
        baselineStd,
        zScore,
        relativeChange,
        severity: severityFor(zScore, relativeChange),
        direction: Number.isFinite(baselineMean) && value < baselineMean ? 'down' : 'up',
        evidenceCount: priorValues.length,
        context: input?.context || {},
        source: input?.source || 'system',
        createdAt: now,
        acknowledgedAt: null,
        acknowledgedBy: null
      };
      state.sentinel.alerts.push(alert);
      trimArray(state.sentinel.alerts, 2_000);
      series.lastAlertAt = now;
    }

    state.sentinel.series[key] = series;
    state.sentinel.updatedAt = now;
    return { point, alert, baseline: { mean: baselineMean, stddev: baselineStd, relativeChange, zScore, samples: priorValues.length } };
  });
}

export async function acknowledgeSentinelAlert(guildId, alertId, userId) {
  return mutateDQState(guildId, (state) => {
    const alert = state.sentinel.alerts.find((entry) => entry.id === alertId);
    if (!alert) return null;
    alert.acknowledgedAt = new Date().toISOString();
    alert.acknowledgedBy = String(userId || '').trim() || null;
    state.sentinel.updatedAt = alert.acknowledgedAt;
    return alert;
  });
}

export async function getSentinelAlerts(guildId, options = {}) {
  const state = await readDQState(guildId);
  const includeAcknowledged = options.includeAcknowledged === true;
  const severity = String(options.severity || '').trim().toLowerCase();
  const limit = clamp(Math.floor(Number(options.limit || 10)), 1, 100);
  return state.sentinel.alerts
    .filter((alert) => includeAcknowledged || !alert.acknowledgedAt)
    .filter((alert) => !severity || alert.severity === severity)
    .slice(-limit)
    .reverse();
}

export async function getSentinelSnapshot(guildId) {
  const state = await readDQState(guildId);
  const alerts = state.sentinel.alerts;
  const active = alerts.filter((alert) => !alert.acknowledgedAt);
  return {
    series: Object.keys(state.sentinel.series).length,
    alerts: alerts.length,
    activeAlerts: active.length,
    critical: active.filter((alert) => alert.severity === 'critical').length,
    high: active.filter((alert) => alert.severity === 'high').length,
    updatedAt: state.sentinel.updatedAt
  };
}
