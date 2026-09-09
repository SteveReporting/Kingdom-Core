export class KingdomNexus {
  constructor({ baseUrl = '', adminToken = '' } = {}) {
    this.baseUrl = String(baseUrl || '').replace(/\/$/, '');
    this.adminToken = String(adminToken || '').trim();
    this.csrfToken = '';
  }

  setAdminToken(token = '') {
    this.adminToken = String(token || '').trim();
    return this;
  }

  async me() {
    const data = await this.request('/api/me', { skipCsrf: true });
    this.csrfToken = typeof data?.csrfToken === 'string' ? data.csrfToken : '';
    return data;
  }

  async ensureCsrf() {
    if (this.csrfToken) return this.csrfToken;
    await this.me();
    return this.csrfToken;
  }

  async request(path, options = {}) {
    const method = String(options.method ?? 'GET').toUpperCase();
    const headers = { accept: 'application/json', ...(options.headers ?? {}) };
    const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
    const hasBody = options.body !== undefined && options.body !== null;

    if (hasBody && !headers['content-type'] && !headers['Content-Type']) headers['content-type'] = 'application/json';
    if (this.adminToken) headers.authorization = `Bearer ${this.adminToken}`;
    if (isWrite && !options.skipCsrf && !this.adminToken) {
      const csrf = await this.ensureCsrf();
      if (!csrf) throw new Error('Kingdom Nexus secure session is missing. Sign in with Discord first.');
      headers['x-kingdom-csrf'] = csrf;
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      method,
      headers,
      credentials: options.credentials ?? 'include',
      cache: options.cache ?? 'no-store'
    });
    const raw = await response.text();
    let data = {};
    if (raw) {
      try { data = JSON.parse(raw); } catch { data = { value: raw }; }
    }
    if (!response.ok) throw new Error(data.error || data.message || `Kingdom Nexus HTTP ${response.status}`);
    if (path === '/api/me') this.csrfToken = typeof data?.csrfToken === 'string' ? data.csrfToken : '';
    return data;
  }

  health() { return this.request('/health'); }
  products() { return this.request('/api/products'); }
  status() { return this.request('/api/status'); }
  live() { return this.request('/api/live'); }
  intelligence() { return this.request('/api/intelligence'); }
  sentinel() { return this.request('/api/sentinel'); }
  networkSummary() { return this.request('/api/network/summary'); }
  launcher() { return this.request('/api/launcher'); }
  companion() { return this.request('/api/companion'); }
  creators() { return this.request('/api/creators'); }
  identity() { return this.request('/api/identity'); }
  applications() { return this.request('/api/applications'); }
  vault() { return this.request('/api/vault'); }
  studio() { return this.request('/api/studio/layouts'); }
  apiDocument() { return this.request('/api/openapi'); }
  product(slug) { return this.request(`/api/products/${encodeURIComponent(slug)}`); }

  adminState() { return this.request('/api/admin/state'); }
  verifyBackups() { return this.request('/api/admin/vault/verify'); }

  linkIdentity(profile) { return this.request('/api/identity/link', { method: 'POST', body: JSON.stringify(profile) }); }
  saveTenant(tenant) { return this.request('/api/network/tenants', { method: 'POST', body: JSON.stringify(tenant) }); }
  saveBuild(build) { return this.request('/api/companion/builds', { method: 'POST', body: JSON.stringify(build) }); }
  saveGuide(guide) { return this.request('/api/companion/guides', { method: 'POST', body: JSON.stringify(guide) }); }
  saveCampaign(campaign) { return this.request('/api/creators/campaigns', { method: 'POST', body: JSON.stringify(campaign) }); }
  saveLayout(layout) { return this.request('/api/studio/layouts', { method: 'POST', body: JSON.stringify(layout) }); }
  publishLayout(id) { return this.request(`/api/studio/layouts/${encodeURIComponent(id)}/publish`, { method: 'POST', body: '{}' }); }
  openIncident(incident) { return this.request('/api/sentinel/incidents', { method: 'POST', body: JSON.stringify(incident) }); }
  updateIncident(id, patch) { return this.request(`/api/sentinel/incidents/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }); }
  addApplicationNote(id, text) { return this.request(`/api/applications/${encodeURIComponent(id)}/notes`, { method: 'POST', body: JSON.stringify({ text }) }); }
  reviewApplication(id, review) { return this.request(`/api/applications/${encodeURIComponent(id)}/review`, { method: 'POST', body: JSON.stringify(review) }); }
  backup() { return this.request('/api/vault/backup', { method: 'POST', body: '{}' }); }
  restoreBackup({ file = '', sha256 = '' } = {}) {
    if (!file && !sha256) throw new Error('A Vault file or SHA-256 checksum is required.');
    return this.request('/api/vault/restore', { method: 'POST', body: JSON.stringify({ file, sha256, confirm: 'RESTORE' }) });
  }
  ask(prompt, context = {}) { return this.request('/api/ai', { method: 'POST', body: JSON.stringify({ prompt, context }) }); }

  streamLive(onUpdate, onError = null) {
    if (typeof EventSource === 'undefined') throw new Error('EventSource is not available in this runtime.');
    const source = new EventSource(`${this.baseUrl}/api/live/stream`, { withCredentials: true });
    const read = (event) => {
      try { onUpdate?.(JSON.parse(event.data)); } catch (error) { onError?.(error); }
    };
    source.addEventListener('live', read);
    source.addEventListener('message', read);
    if (onError) source.addEventListener('error', onError);
    return () => source.close();
  }
}

if (typeof window !== 'undefined') window.KingdomNexus = KingdomNexus;
