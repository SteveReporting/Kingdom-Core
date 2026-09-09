export class KingdomNexus {
  constructor({ baseUrl = '', adminToken = '' } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.adminToken = adminToken;
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
  product(slug) { return this.request(`/api/products/${encodeURIComponent(slug)}`); }
  linkIdentity(profile) { return this.request('/api/identity/link', { method: 'POST', body: JSON.stringify(profile) }); }
  saveTenant(tenant) { return this.request('/api/network/tenants', { method: 'POST', body: JSON.stringify(tenant) }); }
  saveCampaign(campaign) { return this.request('/api/creators/campaigns', { method: 'POST', body: JSON.stringify(campaign) }); }
  saveLayout(layout) { return this.request('/api/studio/layouts', { method: 'POST', body: JSON.stringify(layout) }); }
  backup() { return this.request('/api/vault/backup', { method: 'POST', body: '{}' }); }
  ask(prompt, context = {}) { return this.request('/api/ai', { method: 'POST', body: JSON.stringify({ prompt, context }) }); }
}

if (typeof window !== 'undefined') window.KingdomNexus = KingdomNexus;
