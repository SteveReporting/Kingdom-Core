export class KingdomNexus {
  constructor({ baseUrl = '', adminToken = '' } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.adminToken = adminToken;
  }

  setAdminToken(token = '') {
    this.adminToken = String(token || '').trim();
    return this;
  }

  async request(path, options = {}) {
    const headers = { 'content-type': 'application/json', ...(options.headers ?? {}) };
    if (this.adminToken) headers.authorization = `Bearer ${this.adminToken}`;
    const response = await fetch(`${this.baseUrl}${path}`, { ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Kingdom Nexus HTTP ${response.status}`);
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
  backup() { return this.request('/api/vault/backup', { method: 'POST', body: '{}' }); }
  ask(prompt, context = {}) { return this.request('/api/ai', { method: 'POST', body: JSON.stringify({ prompt, context }) }); }

  streamLive(onUpdate, onError = null) {
    if (typeof EventSource === 'undefined') throw new Error('EventSource is not available in this runtime.');
    const source = new EventSource(`${this.baseUrl}/api/live/stream`);
    source.addEventListener('live', (event) => {
      try { onUpdate?.(JSON.parse(event.data)); } catch (error) { onError?.(error); }
    });
    if (onError) source.addEventListener('error', onError);
    return () => source.close();
  }
}

if (typeof window !== 'undefined') window.KingdomNexus = KingdomNexus;
