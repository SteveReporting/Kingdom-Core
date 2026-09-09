const $ = (selector) => document.querySelector(selector);
let installPrompt = null;
let statusData = null;
let adminData = null;
let adminToken = sessionStorage.getItem('kingdomNexusAdminToken') || '';
let liveSource = null;

const navCore = [
  ['nexus','Nexus'],['live','Live'],['network','Network'],['identity','Identity'],['companion','Companion'],['creators','Creators'],['studio','Studio'],['sentinel','Sentinel'],['vault','Vault'],['intelligence','Intelligence'],['launcher','Launcher'],['api','API']
];

const esc = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

function route() {
  return new URLSearchParams(location.search).get('view') || 'nexus';
}

function setRoute(slug) {
  const url = new URL(location.href);
  url.searchParams.set('view', slug);
  history.pushState({}, '', url);
  render();
  hydrateRoute(slug).catch(showError);
}

async function fetchJson(path, options = {}) {
  const response = await fetch(path, { cache: 'no-store', ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function adminFetch(path, options = {}) {
  if (!adminToken) throw new Error('Unlock admin mode first.');
  return fetchJson(path, {
    ...options,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${adminToken}`,
      ...(options.headers || {})
    }
  });
}

async function refreshAdmin() {
  if (!adminToken) {
    adminData = null;
    updateOperatorState();
    return null;
  }
  try {
    adminData = await adminFetch('/api/admin/state');
    updateOperatorState();
    return adminData;
  } catch (error) {
    adminData = null;
    adminToken = '';
    sessionStorage.removeItem('kingdomNexusAdminToken');
    updateOperatorState();
    throw error;
  }
}

function updateOperatorState() {
  const unlocked = Boolean(adminToken && adminData);
  $('#operatorState').textContent = unlocked ? 'OPERATOR MODE' : 'PUBLIC MODE';
  $('#operatorState').classList.toggle('active', unlocked);
  $('#adminBtn').textContent = unlocked ? 'LOCK' : 'ADMIN';
}

function notify(message, type = 'ok') {
  const el = $('#notice');
  el.hidden = false;
  el.className = `notice ${type}`;
  el.textContent = message;
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => { el.hidden = true; }, 5000);
}

function showError(error) {
  console.error(error);
  notify(error?.message || String(error), 'error');
}

function metric(label, value, extra = '') {
  return `<article class="card metric"><div class="metric-label">${esc(label)}</div><div class="metric-value ${extra}">${esc(value ?? '—')}</div></article>`;
}

function capabilities(product) {
  return `<ul class="clean">${(product.capabilities || []).map((item) => `<li>${esc(item)}</li>`).join('')}</ul>`;
}

function productCard(product) {
  return `<div class="product" data-product="${esc(product.slug)}"><small>#${esc(product.id)} • ${esc(product.type)}</small><h3>${esc(product.name)}</h3><p>${esc(product.summary)}</p></div>`;
}

function heroFor(product) {
  const runtime = product?.runtime || { status: 'ready' };
  return `<h2>${esc(product?.name || 'Kingdom Nexus')}</h2><p>${esc(product?.summary || 'One shared operating platform joining every Kingdom Carries product without nineteen separate hosting bills.')}</p><div class="hero-meta"><span class="pill"><strong>${esc(runtime.status || 'ready')}</strong> runtime</span><span class="pill">zero required paid services</span><span class="pill">shared Kingdom Core state</span>${adminData ? '<span class="pill operator"><strong>operator</strong> unlocked</span>' : ''}</div>`;
}

function formCard(title, action, fields, button = 'Save') {
  const inputs = fields.map((field) => {
    if (field.type === 'textarea') return `<label>${esc(field.label)}<textarea name="${esc(field.name)}" placeholder="${esc(field.placeholder || '')}" ${field.required ? 'required' : ''}></textarea></label>`;
    if (field.type === 'select') return `<label>${esc(field.label)}<select name="${esc(field.name)}">${field.options.map(([value,label]) => `<option value="${esc(value)}">${esc(label)}</option>`).join('')}</select></label>`;
    return `<label>${esc(field.label)}<input name="${esc(field.name)}" type="${esc(field.type || 'text')}" placeholder="${esc(field.placeholder || '')}" ${field.required ? 'required' : ''}></label>`;
  }).join('');
  return `<article class="card wide"><h3>${esc(title)}</h3><form class="nexus-form" data-action="${esc(action)}">${inputs}<button class="primary" type="submit">${esc(button)}</button></form></article>`;
}

function adminLockedCard() {
  return `<article class="card full locked-card"><h3>Operator access required</h3><p>This surface contains private guild administration data. Press <strong>ADMIN</strong> above and enter the Nexus admin token. The token is kept only in this browser tab/session.</p></article>`;
}

function tableCard(title, rows, columns) {
  const body = rows.length ? rows.map((row) => `<tr>${columns.map((col) => `<td>${col.render ? col.render(row) : esc(row[col.key] ?? '—')}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${columns.length}" class="empty">Nothing here yet.</td></tr>`;
  return `<article class="card full"><div class="card-head"><h3>${esc(title)}</h3><span>${rows.length} record${rows.length === 1 ? '' : 's'}</span></div><div class="table-wrap"><table><thead><tr>${columns.map((col) => `<th>${esc(col.label)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div></article>`;
}

function renderNexus(products) {
  const live = statusData?.intelligence || {};
  return [
    metric('Members', statusData?.guild?.memberCount),
    metric('Queue Depth', live.queueDepth),
    metric('Active Carry Parties', live.activeCarryParties ?? live.activeCarrySessions),
    `<article class="card full"><h3>Kingdom Ecosystem</h3><p>Products #2–#20 now share one API, one installable client, one security boundary and one low-memory runtime. The individual products below open into their own operating surfaces instead of running as nineteen VPS processes.</p><div class="product-grid">${products.map(productCard).join('')}</div></article>`
  ].join('');
}

function renderProduct(product) {
  return `<article class="card wide"><span class="status">Platform ready</span><h3>${esc(product.name)}</h3><p>${esc(product.summary)}</p>${capabilities(product)}</article><article class="card"><h3>Free Runtime</h3><p>No paid service is required by default. This product shares Kingdom Core, local JSON persistence and the current Oracle host.</p></article>`;
}

function renderLive() {
  const s = statusData?.intelligence || {};
  return [
    metric('Queue', s.queueDepth),
    metric('Active Carries', s.activeCarryParties ?? s.activeCarrySessions),
    metric('Open Tickets', s.openTickets),
    metric('Completed Carries', s.completedCarries),
    `<article class="card full"><div class="card-head"><h3>Live Operations Stream</h3><span class="live-badge"><i></i> SSE LIVE</span></div><p>The browser is subscribed to Kingdom Core using a native Server-Sent Events stream. Queue and carry counters refresh without polling the entire platform.</p><div id="liveUpdated" class="muted">Waiting for stream…</div></article>`
  ].join('');
}

function renderNetwork() {
  if (!adminData) return `${metric('Network Tenants', '—')}${adminLockedCard()}`;
  const tenants = adminData.network?.tenants || [];
  return [
    metric('Registered Guilds', tenants.length),
    metric('Active Guilds', tenants.filter((t) => String(t.status || 'active') === 'active').length),
    formCard('Register / Update Guild', 'network-tenant', [
      { name:'id', label:'Discord Guild ID', required:true, placeholder:'123456789...' },
      { name:'name', label:'Guild Name', required:true, placeholder:'Partner Guild' },
      { name:'status', label:'Status', type:'select', options:[['active','Active'],['paused','Paused'],['staging','Staging']] },
      { name:'owner', label:'Owner / Contact', placeholder:'Discord user or note' }
    ], 'Save Guild'),
    tableCard('Kingdom Network Tenants', tenants, [
      { key:'name', label:'Guild' }, { key:'id', label:'Guild ID' }, { key:'status', label:'Status' }, { key:'owner', label:'Contact' }
    ])
  ].join('');
}

function renderIdentity() {
  if (!adminData) return adminLockedCard();
  const profiles = adminData.identity?.profiles || [];
  return [
    metric('Linked Identities', profiles.length),
    formCard('Link Kingdom Identity', 'identity-link', [
      { name:'discordId', label:'Discord User ID', required:true },
      { name:'discordName', label:'Discord Name' },
      { name:'robloxUsername', label:'Roblox Username' },
      { name:'robloxUserId', label:'Roblox User ID' }
    ], 'Link Identity'),
    tableCard('Canonical Member Directory', profiles, [
      { key:'discordName', label:'Discord' }, { key:'discordId', label:'Discord ID' }, { key:'robloxUsername', label:'Roblox' },
      { label:'Aliases', render:(row) => esc((row.aliases || []).join(', ') || '—') }
    ])
  ].join('');
}

function renderCompanion() {
  if (!adminData) return `<article class="card wide"><h3>Dungeon Quest Companion</h3><p>Build profiles, carry readiness and verified guides live here. Operator mode is required to edit the library.</p></article>${adminLockedCard()}`;
  const builds = adminData.companion?.builds || [];
  const guides = adminData.companion?.guides || [];
  return [
    metric('Builds', builds.length), metric('Guides', guides.length),
    formCard('Create Build Profile', 'companion-build', [
      { name:'name', label:'Build Name', required:true }, { name:'class', label:'Class / Role' },
      { name:'dungeon', label:'Dungeon' }, { name:'difficulty', label:'Difficulty' },
      { name:'notes', label:'Notes', type:'textarea', placeholder:'Gear, strategy, carry readiness…' }
    ], 'Save Build'),
    formCard('Create Guide', 'companion-guide', [
      { name:'title', label:'Guide Title', required:true }, { name:'dungeon', label:'Dungeon' },
      { name:'body', label:'Guide', type:'textarea', required:true }
    ], 'Save Guide'),
    tableCard('Build Library', builds, [
      { key:'name', label:'Build' }, { key:'class', label:'Class' }, { key:'dungeon', label:'Dungeon' }, { key:'difficulty', label:'Difficulty' }
    ]),
    tableCard('Guide Library', guides, [
      { key:'title', label:'Guide' }, { key:'dungeon', label:'Dungeon' },
      { label:'Verified', render:(row) => row.verified ? '<span class="good">YES</span>' : '<span class="muted">NO</span>' }
    ])
  ].join('');
}

function renderCreators() {
  if (!adminData) return adminLockedCard();
  const campaigns = adminData.creators?.campaigns || [];
  return [
    metric('Campaigns', campaigns.length),
    formCard('New Creator Campaign', 'creator-campaign', [
      { name:'name', label:'Campaign Name', required:true }, { name:'creator', label:'Creator / Channel' },
      { name:'url', label:'Campaign / Creator URL', type:'url' },
      { name:'status', label:'Status', type:'select', options:[['planned','Planned'],['live','Live'],['complete','Complete']] }
    ], 'Create Campaign'),
    tableCard('Creator Campaigns', campaigns, [
      { key:'name', label:'Campaign' }, { key:'creator', label:'Creator' }, { key:'status', label:'Status' },
      { label:'Link', render:(row) => row.url ? `<a class="inline-link" href="${esc(row.url)}" target="_blank" rel="noopener">OPEN</a>` : '—' }
    ])
  ].join('');
}

function renderStudio() {
  if (!adminData) return adminLockedCard();
  const layouts = adminData.studio?.layouts || [];
  return [
    metric('Layouts', layouts.length), metric('Published', layouts.filter((x) => x.status === 'published').length),
    formCard('Create Studio Layout', 'studio-layout', [
      { name:'name', label:'Layout Name', required:true },
      { name:'surface', label:'Surface', type:'select', options:[['discord-panel','Discord Panel'],['website','Website'],['tv','TV / Stream'],['application','Application Flow']] },
      { name:'description', label:'Description', type:'textarea' }
    ], 'Save Draft'),
    tableCard('Studio Layouts', layouts, [
      { key:'name', label:'Layout' }, { key:'surface', label:'Surface' }, { key:'version', label:'Version' }, { key:'status', label:'Status' },
      { label:'Action', render:(row) => `<button class="mini" data-publish-layout="${esc(row.id)}">PUBLISH</button>` }
    ])
  ].join('');
}

function renderSentinel() {
  const s = statusData?.sentinel || {};
  const publicCards = `${metric('Current Risk', String(s.risk || 'unknown').toUpperCase(), `risk-${esc(s.risk || 'normal')}`)}${metric('Administrator Roles', s.administratorRoles)}${metric('Privileged Bots Cached', s.privilegedBotsCached)}`;
  if (!adminData) return `${publicCards}${adminLockedCard()}`;
  const incidents = adminData.sentinel?.incidents || [];
  return `${publicCards}${formCard('Open Security Incident', 'sentinel-incident', [
    { name:'title', label:'Incident Title', required:true },
    { name:'severity', label:'Severity', type:'select', options:[['low','Low'],['medium','Medium'],['high','High'],['critical','Critical']] },
    { name:'source', label:'Source', placeholder:'manual / audit / raid / bot' },
    { name:'summary', label:'Summary', type:'textarea' }
  ], 'Open Incident')}${tableCard('Incident Command', incidents, [
    { key:'title', label:'Incident' }, { key:'severity', label:'Severity' }, { key:'status', label:'Status' },
    { label:'Action', render:(row) => row.status === 'closed' ? '<span class="muted">CLOSED</span>' : `<button class="mini" data-incident-status="investigating" data-incident-id="${esc(row.id)}">INVESTIGATE</button> <button class="mini danger" data-incident-status="closed" data-incident-id="${esc(row.id)}">CLOSE</button>` }
  ])}`;
}

function renderVault() {
  if (!adminData) return adminLockedCard();
  const backups = adminData.vault?.backups || [];
  return `${metric('Local Backups', backups.length)}<article class="card wide"><h3>Kingdom Vault</h3><p>Backups are written to the existing VPS filesystem with retention. No cloud storage subscription is required.</p><button class="primary" data-action-button="vault-backup">CREATE BACKUP NOW</button></article>${tableCard('Backup Registry', backups.slice().reverse(), [
    { key:'at', label:'Created' }, { key:'file', label:'Local File' }
  ])}`;
}

function renderIntelligence() {
  const s = statusData?.intelligence || {};
  return [
    metric('Members Cached', s.membersCached), metric('Applications', s.applications), metric('Open Tickets', s.openTickets), metric('Completed Carries', s.completedCarries),
    `<article class="card full" id="trendCard"><h3>Kingdom Intelligence</h3><p>Loading operational trend window…</p></article>`
  ].join('');
}

function renderLauncher() {
  return `<article class="card full" id="launcherCard"><h3>Kingdom Launcher</h3><p>Loading configured Kingdom destinations…</p></article>`;
}

function renderApi() {
  return `<article class="card full"><h3>Kingdom API</h3><p>Public-safe reads require no secret. All writes and private state are behind the Nexus operator token.</p><div class="api-code">GET /health\nGET /api/products\nGET /api/status\nGET /api/live\nGET /api/live/stream\nGET /api/intelligence\nGET /api/sentinel\nGET /api/network/summary\nGET /api/launcher\nGET /api/openapi\n\nAuthorization: Bearer &lt;KINGDOM_NEXUS_ADMIN_TOKEN&gt;\nGET  /api/admin/state\nPOST /api/network/tenants\nPOST /api/identity/link\nPOST /api/companion/builds\nPOST /api/companion/guides\nPOST /api/creators/campaigns\nPOST /api/studio/layouts\nPOST /api/studio/layouts/:id/publish\nPOST /api/sentinel/incidents\nPATCH /api/sentinel/incidents/:id\nPOST /api/vault/backup\nPOST /api/ai</div></article>`;
}

function renderSpecial(slug, product) {
  if (slug === 'nexus') return renderNexus(statusData.products || []);
  if (slug === 'live') return renderLive();
  if (slug === 'network') return renderNetwork();
  if (slug === 'identity') return renderIdentity();
  if (slug === 'companion') return renderCompanion();
  if (slug === 'creators') return renderCreators();
  if (slug === 'studio') return renderStudio();
  if (slug === 'sentinel') return renderSentinel();
  if (slug === 'vault') return renderVault();
  if (slug === 'intelligence') return renderIntelligence();
  if (slug === 'launcher') return renderLauncher();
  if (slug === 'api') return renderApi();
  return renderProduct(product);
}

function renderNav() {
  const products = statusData?.products || [];
  const bySlug = Object.fromEntries(products.map((p) => [p.slug, p]));
  const current = route();
  $('#nav').innerHTML = navCore.map(([slug,label], i) => `<a href="?view=${slug}" class="nav-item ${current === slug ? 'active' : ''}" data-route="${slug}"><span class="nav-index">${String(i+1).padStart(2,'0')}</span>${esc(label)}</a>`).join('');
  document.querySelectorAll('[data-route]').forEach((el) => el.addEventListener('click', (event) => { event.preventDefault(); setRoute(el.dataset.route); }));
  return bySlug;
}

function bindDynamicActions() {
  document.querySelectorAll('[data-product]').forEach((el) => el.addEventListener('click', () => setRoute(el.dataset.product)));
}

function render() {
  if (!statusData) return;
  const bySlug = renderNav();
  const slug = route();
  const product = bySlug[slug] || bySlug.nexus;
  $('#pageTitle').textContent = product?.name || (slug === 'launcher' ? 'Kingdom Launcher' : 'Kingdom Nexus');
  $('#hero').innerHTML = heroFor(product);
  $('#content').innerHTML = renderSpecial(slug, product);
  bindDynamicActions();
}

async function hydrateRoute(slug) {
  if (slug === 'intelligence') {
    const data = await fetchJson('/api/intelligence');
    const trend = data.trend || { points: 0, deltas: {} };
    const el = $('#trendCard');
    if (el) el.innerHTML = `<div class="card-head"><h3>48-Point Trend Window</h3><span>${esc(trend.points)} snapshots</span></div><div class="trend-grid">${Object.entries(trend.deltas || {}).map(([key,value]) => `<div><span>${esc(key)}</span><strong class="${Number(value) > 0 ? 'up' : Number(value) < 0 ? 'down' : ''}">${value == null ? '—' : `${Number(value) > 0 ? '+' : ''}${esc(value)}`}</strong></div>`).join('')}</div>`;
  }
  if (slug === 'launcher') {
    const data = await fetchJson('/api/launcher');
    const el = $('#launcherCard');
    if (el) el.innerHTML = `<div class="card-head"><h3>Kingdom Launcher</h3><span>${data.installable ? 'INSTALLABLE PWA' : 'WEB'}</span></div><p>One launch surface for the Kingdom ecosystem.</p><div class="launcher-grid">${(data.links || []).length ? data.links.map((link) => `<a class="launch-tile" href="${esc(link.url)}" target="_blank" rel="noopener"><strong>${esc(link.name)}</strong><span>OPEN ↗</span></a>`).join('') : '<span class="empty">Add KINGDOM_DISCORD_URL / KINGDOM_GAME_URL / KINGDOM_WEBSITE_URL to expose launcher shortcuts.</span>'}</div>`;
  }
}

async function submitForm(form) {
  const action = form.dataset.action;
  const body = Object.fromEntries(new FormData(form).entries());
  const routes = {
    'network-tenant': ['/api/network/tenants', 'POST'],
    'identity-link': ['/api/identity/link', 'POST'],
    'companion-build': ['/api/companion/builds', 'POST'],
    'companion-guide': ['/api/companion/guides', 'POST'],
    'creator-campaign': ['/api/creators/campaigns', 'POST'],
    'studio-layout': ['/api/studio/layouts', 'POST'],
    'sentinel-incident': ['/api/sentinel/incidents', 'POST']
  };
  const target = routes[action];
  if (!target) return;
  await adminFetch(target[0], { method: target[1], body: JSON.stringify(body) });
  form.reset();
  await refreshAdmin();
  render();
  notify('Saved to Kingdom Nexus.');
}

async function handleActionButton(target) {
  if (target.dataset.actionButton === 'vault-backup') {
    await adminFetch('/api/vault/backup', { method: 'POST', body: '{}' });
    await refreshAdmin();
    render();
    notify('Vault backup created.');
    return;
  }
  if (target.dataset.publishLayout) {
    await adminFetch(`/api/studio/layouts/${encodeURIComponent(target.dataset.publishLayout)}/publish`, { method:'POST', body:'{}' });
    await refreshAdmin();
    render();
    notify('Studio layout published.');
    return;
  }
  if (target.dataset.incidentId && target.dataset.incidentStatus) {
    await adminFetch(`/api/sentinel/incidents/${encodeURIComponent(target.dataset.incidentId)}`, {
      method:'PATCH',
      body: JSON.stringify({ status: target.dataset.incidentStatus })
    });
    await refreshAdmin();
    render();
    notify(`Incident moved to ${target.dataset.incidentStatus}.`);
  }
}

function connectLiveStream() {
  if (!('EventSource' in window) || liveSource) return;
  liveSource = new EventSource('/api/live/stream');
  liveSource.addEventListener('live', (event) => {
    try {
      const live = JSON.parse(event.data);
      statusData.intelligence = { ...(statusData.intelligence || {}), ...live, activeCarryParties: live.activeCarrySessions };
      if (route() === 'live' || route() === 'nexus') render();
      const stamp = $('#liveUpdated');
      if (stamp) stamp.textContent = `Last live update: ${new Date(live.updatedAt).toLocaleTimeString()}`;
    } catch {}
  });
}

async function unlockAdmin() {
  if (adminToken && adminData) {
    adminToken = '';
    adminData = null;
    sessionStorage.removeItem('kingdomNexusAdminToken');
    updateOperatorState();
    render();
    notify('Operator mode locked.');
    return;
  }
  const token = prompt('Enter KINGDOM_NEXUS_ADMIN_TOKEN. It will only be stored in this browser session.');
  if (!token) return;
  adminToken = token.trim();
  sessionStorage.setItem('kingdomNexusAdminToken', adminToken);
  try {
    await refreshAdmin();
    render();
    notify('Operator mode unlocked.');
  } catch (error) {
    showError(error);
  }
}

async function boot() {
  try {
    statusData = await fetchJson('/api/status');
    if (adminToken) await refreshAdmin().catch(() => null);
    $('#healthDot').classList.add('ok');
    $('#healthText').textContent = `Nexus ${statusData.version} online`;
    updateOperatorState();
    render();
    await hydrateRoute(route());
    connectLiveStream();
  } catch (error) {
    $('#healthText').textContent = 'Nexus unavailable';
    $('#hero').innerHTML = `<h2>Kingdom Nexus</h2><p>Could not reach the local Nexus API. ${esc(error.message)}</p>`;
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => null);
}

window.addEventListener('popstate', () => { render(); hydrateRoute(route()).catch(showError); });
window.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); installPrompt = event; $('#installBtn').hidden = false; });
$('#installBtn').addEventListener('click', async () => { if (!installPrompt) return; installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; $('#installBtn').hidden = true; });
$('#adminBtn').addEventListener('click', unlockAdmin);
$('#content').addEventListener('submit', (event) => { if (!event.target.matches('.nexus-form')) return; event.preventDefault(); submitForm(event.target).catch(showError); });
$('#content').addEventListener('click', (event) => { const target = event.target.closest('[data-action-button],[data-publish-layout],[data-incident-id]'); if (target) handleActionButton(target).catch(showError); });
boot();
