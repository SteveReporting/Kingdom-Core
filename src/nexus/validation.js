const FORBIDDEN_RECORD_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const SAFE_RECORD_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function badRequest(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

export function safeRecordId(value, label = 'id', max = 200) {
  const id = String(value ?? '').trim();
  if (!id) throw badRequest(`${label} is required.`);
  if (id.length > max || CONTROL_CHARS.test(id) || FORBIDDEN_RECORD_KEYS.has(id.toLowerCase()) || !SAFE_RECORD_ID.test(id)) {
    throw badRequest(`${label} is invalid.`);
  }
  return id;
}

export function safeDiscordId(value, label = 'Discord ID') {
  const id = safeRecordId(value, label, 24);
  if (!/^\d{10,24}$/.test(id)) throw badRequest(`${label} must be a numeric Discord ID.`);
  return id;
}

export function cleanText(value, max = 500) {
  if (value === undefined || value === null) return '';
  const text = String(value).replace(CONTROL_CHARS, ' ').trim();
  return text.slice(0, Math.max(0, max));
}

export function cleanOptionalText(value, max = 500) {
  const text = cleanText(value, max);
  return text || null;
}

export function safeNumber(value, { min = 0, max = Number.MAX_SAFE_INTEGER, fallback = 0 } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export function safeHttpUrl(value, { max = 2048, nullable = true } = {}) {
  const raw = cleanText(value, max);
  if (!raw) return nullable ? null : '';
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw badRequest('URL is invalid.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw badRequest('URL must use HTTP or HTTPS.');
  return url.toString().slice(0, max);
}

export function safeStatus(value, allowed, fallback) {
  const candidate = cleanText(value, 40).toLowerCase();
  if (!candidate) return fallback;
  return allowed.includes(candidate) ? candidate : fallback;
}

export function assertPlainObject(value, label = 'payload') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw badRequest(`${label} must be a JSON object.`);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) throw badRequest(`${label} is invalid.`);
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_RECORD_KEYS.has(key.toLowerCase()) || CONTROL_CHARS.test(key) || key.length > 120) {
      throw badRequest(`${label} contains an invalid field.`);
    }
  }
  return value;
}
