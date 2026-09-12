function baseUrl() {
  const configured = String(process.env.KMI_API_URL || '').trim().replace(/\/+$/, '');
  if (!configured) {
    throw new Error('Kingdom Market Intelligence is not configured. Set KMI_API_URL to the dedicated KMI service endpoint.');
  }
  return configured;
}

function headers(jsonBody = false) {
  const out = { accept: 'application/json' };
  if (jsonBody) out['content-type'] = 'application/json';
  const key = String(process.env.KMI_API_KEY || '').trim();
  if (key) out['x-admin-key'] = key;
  return out;
}

async function request(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.KMI_API_TIMEOUT_MS || 12_000));
  timer.unref?.();
  try {
    const response = await fetch(`${baseUrl()}${path}`, { ...options, signal: controller.signal });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = { error: text || `HTTP ${response.status}` }; }
    if (!response.ok) throw new Error(payload?.error || `KMI API returned HTTP ${response.status}`);
    return payload;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Kingdom Market Intelligence timed out.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function searchMarketItems(query, limit = 25) {
  const payload = await request(`/api/items?q=${encodeURIComponent(String(query || ''))}&limit=${Math.min(25, Math.max(1, Number(limit) || 25))}`, {
    headers: headers()
  });
  const choices = [];
  for (const item of Array.isArray(payload) ? payload : []) {
    for (const variant of item.rarities || []) {
      const range = Number.isFinite(variant.min_potential) && Number.isFinite(variant.max_potential)
        ? `POT ${variant.min_potential}–${variant.max_potential}`
        : 'POT ?';
      choices.push({
        name: `${item.item_name} • ${variant.rarity} • ${range}`.slice(0, 100),
        value: String(variant.key).slice(0, 100)
      });
      if (choices.length >= 25) return choices;
    }
  }
  return choices;
}

export async function getMarketValue(itemKey, pot = null) {
  const suffix = Number.isFinite(pot) ? `&pot=${encodeURIComponent(pot)}` : '';
  return request(`/api/item?key=${encodeURIComponent(itemKey)}${suffix}`, { headers: headers() });
}

export async function recognizeMarketPhoto(imageUrl) {
  const payload = await request('/api/manual', {
    method: 'POST',
    headers: headers(true),
    body: JSON.stringify({ image_url: imageUrl })
  });
  const observation = payload?.observations?.[0];
  if (!observation) return null;
  return {
    itemKey: observation.itemKey,
    itemName: observation.itemName,
    rarity: observation.rarity,
    pot: Number.isFinite(observation.pot) ? observation.pot : null,
    upgrades: Number.isFinite(observation.upgrades) ? observation.upgrades : null,
    base: Number.isFinite(observation.base) ? observation.base : null,
    confidence: Math.round(100 * Math.max(0, Math.min(1, observation.extractionConfidence ?? 0)))
  };
}

export function parseGoldToTrillions(input) {
  const source = String(input || '').trim().replaceAll(',', '');
  if (!source) return null;
  const match = source.match(/^([0-9]+(?:\.[0-9]+)?)\s*(b|t|q|billion|trillion|quadrillion)?$/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = String(match[2] || 't').toLowerCase();
  if (unit === 'b' || unit === 'billion') return value / 1000;
  if (unit === 'q' || unit === 'quadrillion') return value * 1000;
  return value;
}
