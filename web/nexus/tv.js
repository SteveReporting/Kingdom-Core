const ids = ['members','queue','parties','tickets','completed'];
const setValue = (id, value) => {
  const el = document.getElementById(id);
  if (!el) return;
  const next = value ?? '—';
  if (el.textContent !== String(next)) {
    el.textContent = next;
    el.classList.remove('pulse');
    requestAnimationFrame(() => el.classList.add('pulse'));
  }
};

function applyLive(data) {
  setValue('members', data.guild?.memberCount);
  setValue('queue', data.queueDepth);
  setValue('parties', data.activeCarrySessions);
  setValue('tickets', data.openTickets);
  setValue('completed', data.completedCarries);
  const updated = document.getElementById('updated');
  const state = document.getElementById('liveState');
  if (updated) updated.textContent = `Updated ${new Date(data.updatedAt || Date.now()).toLocaleTimeString()}`;
  if (state) { state.innerHTML = '<i></i> LIVE'; state.classList.remove('offline'); }
}

async function initial() {
  try {
    const response = await fetch('/api/live', { cache:'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    applyLive(await response.json());
  } catch {
    const state = document.getElementById('liveState');
    if (state) { state.textContent = 'NEXUS OFFLINE'; state.classList.add('offline'); }
  }
}

function connect() {
  if (!('EventSource' in window)) return;
  const source = new EventSource('/api/live/stream');
  source.addEventListener('live', (event) => {
    try { applyLive(JSON.parse(event.data)); } catch {}
  });
  source.addEventListener('error', () => {
    const state = document.getElementById('liveState');
    if (state) { state.textContent = 'RECONNECTING'; state.classList.add('offline'); }
  });
}

initial();
connect();
