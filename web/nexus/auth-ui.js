const SESSION_OPERATOR_MARKER = '__discord_operator_session__';

async function loadSession() {
  try {
    const response = await fetch('/api/me', { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

function returnPath() {
  return `${location.pathname}${location.search}${location.hash}`;
}

const data = await loadSession();
const button = document.getElementById('discordBtn');
if (button && data) {
  const session = data.session;
  if (session?.operator) {
    sessionStorage.setItem('kingdomNexusAdminToken', SESSION_OPERATOR_MARKER);
  } else if (sessionStorage.getItem('kingdomNexusAdminToken') === SESSION_OPERATOR_MARKER) {
    sessionStorage.removeItem('kingdomNexusAdminToken');
  }

  if (session) {
    const name = session.guildMember?.displayName || session.user?.globalName || session.user?.username || 'Discord';
    button.hidden = false;
    button.textContent = `LOGOUT • ${name}`;
    button.title = session.operator ? 'Discord operator session' : 'Discord member session';
    button.addEventListener('click', () => {
      if (sessionStorage.getItem('kingdomNexusAdminToken') === SESSION_OPERATOR_MARKER) sessionStorage.removeItem('kingdomNexusAdminToken');
      location.href = '/auth/logout';
    });
  } else if (data.discordOAuthConfigured) {
    button.hidden = false;
    button.textContent = 'DISCORD LOGIN';
    button.addEventListener('click', () => {
      location.href = `/auth/discord?return=${encodeURIComponent(returnPath())}`;
    });
  }
}
