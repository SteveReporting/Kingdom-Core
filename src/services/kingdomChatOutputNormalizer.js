const PATCHED = Symbol.for('kingdom-core.kingdom-chat-output-normalized');

function normalizeName(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function isKingdomChat(channel) {
  const name = normalizeName(channel?.name);
  return name === 'kingdom-chat' || name === 'general' || name === 'general-chat';
}

function cleanText(value) {
  return String(value ?? '')
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function normalizePayload(payload) {
  if (typeof payload === 'string') return cleanText(payload);
  if (!payload || typeof payload !== 'object' || typeof payload.content !== 'string') return payload;
  return { ...payload, content: cleanText(payload.content) };
}

function patchChannel(channel) {
  if (!channel?.isTextBased?.() || !isKingdomChat(channel) || channel[PATCHED]) return;

  const originalSend = channel.send.bind(channel);
  Object.defineProperty(channel, PATCHED, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });

  Object.defineProperty(channel, 'send', {
    configurable: true,
    enumerable: false,
    writable: true,
    value(payload) {
      return originalSend(normalizePayload(payload));
    }
  });
}

export function installKingdomChatOutputNormalizer(client) {
  client.once('clientReady', (readyClient) => {
    for (const guild of readyClient.guilds.cache.values()) {
      for (const channel of guild.channels.cache.values()) patchChannel(channel);
    }
  });

  client.on('channelCreate', (channel) => patchChannel(channel));
}
