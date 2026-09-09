const $ = (selector) => document.querySelector(selector);
let installPrompt = null;
let statusData = null;

const navCore = [
  ['nexus','Nexus'],['live','Live'],['network','Network'],['identity','Identity'],['companion','Companion'],['creators','Creators'],['studio','Studio'],['sentinel','Sentinel'],['vault','Vault'],['intelligence','Intelligence'],['api','API']
];

function route() {
  return new URLSearchParams(location.search).get('view') || 'nexus';
}

function setRoute(slug) {
  const url = new URL(location.href);
  url.searchParams.set('view', slug);
  history.pushState({}, '', url);
  render();
}

async function fetchJson(path) {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function metric(label, value) {
  return `<article class="card metric"><div class="metric-label">${label}</div><div class="metric-value">${value ?? '—'}</div></article>`;
}

function capabilities(product) {
  return `<ul class="clean">${(product.capabilities || []).map((item) => `<li>${item}</li>`).join('')}</ul>`;
}

function productCard(product) {
  return `<div class="product" data-product="${product.slug}"><small>#${product.id} • ${product.type}</small><h3>${product.name}</h3><p>${product.summary}</p></div>`;
}

function heroFor(product) {
  const runtime = product?.runtime || { status: 'ready' };
  return `<h2>${product?.name || 'Kingdom Nexus'}</h2><p>${product?.summary || 'One shared operating platform joining every Kingdom Carries product without nineteen separate hosting bills.'}</p><div class="hero-meta"><span class="pill"><strong>${runtime.status || 'ready'}</strong> runtime</span><span class="pill">zero required paid services</span><span class="pill">shared Kingdom Core state</span></div>`;
}

function renderNexus(products) {
  const live = statusData?.intelligence || {};
  return [
    metric('Members', statusData?.guild?.memberCount), metric('Queue Depth', live.queueDepth), metric('Active Carry Parties', live.activeCarryParties),
    `<article class="card full"><h3>Kingdom Ecosystem</h3><p>Products #2–#20 run as one low-memory platform. Mobile, desktop and launcher use the same installable PWA; API, Sentinel, Vault, Intelligence, Studio and Network share one state model.</p><div class="product-grid">${products.map(productCard).join('')}</div></article>`
  ].join('');
}

function renderProduct(product) {
  return `<article class="card wide"><span class="status">Platform ready</span><h3>${product.name}</h3><p>${product.summary}</p>${capabilities(product)}</article><article class="card"><h3>Free Runtime</h3><p>No paid service is required. This product shares the existing Kingdom Core process, local JSON persistence and your current Oracle host.</p></article>`;
}

function renderLive() {
  const s = statusData?.intelligence || {};
  return [metric('Queue', s.queueDepth), metric('Active Carries', s.activeCarryParties), metric('Open Tickets', s.openTickets), metric('Completed Carries', s.completedCarries), `<article class="card full"><h3>Live Operations</h3><p>Public-safe operational data from Kingdom Core. No private ticket content, application answers, staff notes or member records are exposed here.</p></article>`].join('');
}

function renderSentinel() {
  const s = statusData?.sentinel || {};
  return `<article class="card metric"><div class="metric-label">Current Risk</div><div class="metric-value risk-${s.risk || 'normal'}">${String(s.risk || 'unknown').toUpperCase()}</div></article>${metric('Administrator Roles', s.administratorRoles)}${metric('Privileged Bots Cached', s.privilegedBotsCached)}<article class="card full"><h3>Sentinel</h3><p>Security remains independent from UI logic. Nexus only publishes a safe health snapshot here; dangerous changes still stay behind Discord permissions and explicit admin actions.</p></article>`;
}

function renderIntelligence() {
  const s = statusData?.intelligence || {};
  return [metric('Members Cached', s.membersCached), metric('Applications', s.applications), metric('Open Tickets', s.openTickets), metric('Completed Carries', s.completedCarries), `<article class="card full"><h3>Kingdom Intelligence</h3><p>Operational analytics are calculated from Kingdom data already on your server, avoiding a paid warehouse for the default deployment.</p></article>`].join('');
}

function renderApi() {
  return `<article class="card full"><h3>Kingdom API</h3><p>Read-only public-safe routes are available without credentials. Write operations require your private Nexus admin token.</p><div class="api-code">GET /health\nGET /api/products\nGET /api/status\nGET /api/live\nGET /api/intelligence\nGET /api/sentinel\nGET /api/openapi\n\nAuthorization: Bearer &lt;KINGDOM_NEXUS_ADMIN_TOKEN&gt;\nPOST /api/network/tenants\nPOST /api/identity/link\nPOST /api/creators/campaigns\nPOST /api/studio/layouts\nPOST /api/vault/backup\nPOST /api/ai</div></article>`;
}

function renderSpecial(slug, product) {
  if (slug === 'nexus') return renderNexus(statusData.products || []);
  if (slug === 'live') return renderLive();
  if (slug === 'sentinel') return renderSentinel();
  if (slug === 'intelligence') return renderIntelligence();
  if (slug === 'api') return renderApi();
  return renderProduct(product);
}

function renderNav() {
  const products = statusData?.products || [];
  const bySlug = Object.fromEntries(products.map((p) => [p.slug, p]));
  const current = route();
  $('#nav').innerHTML = navCore.map(([slug,label], i) => `<a href="?view=${slug}" class="nav-item ${current === slug ? 'active' : ''}" data-route="${slug}"><span class="nav-index">${String(i+1).padStart(2,'0')}</span>${label}</a>`).join('');
  document.querySelectorAll('[data-route]').forEach((el) => el.addEventListener('click', (event) => { event.preventDefault(); setRoute(el.dataset.route); }));
  return bySlug;
}

function render() {
  if (!statusData) return;
  const bySlug = renderNav();
  const slug = route();
  const product = bySlug[slug] || bySlug.nexus;
  $('#pageTitle').textContent = product?.name || 'Kingdom Nexus';
  $('#hero').innerHTML = heroFor(product);
  $('#content').innerHTML = renderSpecial(slug, product);
  document.querySelectorAll('[data-product]').forEach((el) => el.addEventListener('click', () => setRoute(el.dataset.product)));
}

async function boot() {
  try {
    statusData = await fetchJson('/api/status');
    $('#healthDot').classList.add('ok');
    $('#healthText').textContent = `Nexus ${statusData.version} online`;
    render();
  } catch (error) {
    $('#healthText').textContent = 'Nexus unavailable';
    $('#hero').innerHTML = `<h2>Kingdom Nexus</h2><p>Could not reach the local Nexus API. ${error.message}</p>`;
  }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => null);
}

window.addEventListener('popstate', render);
window.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); installPrompt = event; $('#installBtn').hidden = false; });
$('#installBtn').addEventListener('click', async () => { if (!installPrompt) return; installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; $('#installBtn').hidden = true; });
boot();
