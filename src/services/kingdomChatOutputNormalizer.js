const PATCHED = Symbol.for('kingdom-core.kingdom-chat-output-normalized');
const DUPLICATE_WINDOW_MS = 2 * 60_000;
const MAX_SENTENCES = 2;
const MAX_CHARS = 260;

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

function compactText(value) {
  const text = cleanText(value);
  if (!text) return text;

  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [text];
  let compact = sentences
    .slice(0, MAX_SENTENCES)
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ');

  if (compact.length <= MAX_CHARS) return compact;

  const sliced = compact.slice(0, MAX_CHARS + 1);
  const lastSpace = sliced.lastIndexOf(' ');
  compact = sliced.slice(0, lastSpace > 170 ? lastSpace : MAX_CHARS).trim();
  return `${compact.replace(/[,:;\-–—]+$/, '')}…`;
}

function avoidImmediateRepeat(text, state) {
  const now = Date.now();
  if (text && text === state.lastText && now - state.lastAt <= DUPLICATE_WINDOW_MS) {
    state.repeats += 1;
    const alternates = [
      'nah I literally just said that 😭 what do you mean?',
      'okay that sounded rehearsed 💀 say what you actually mean.',
      'yeah no, I am not copy-pasting myself twice. what are you on about?',
      'reset. that reply was getting NPC-ish 😭 what did you mean?'
    ];
    const replacement = alternates[state.repeats % alternates.length];
    state.lastText = replacement;
    state.lastAt = now;
    return replacement;
  }

  state.repeats = 0;
  state.lastText = text;
  state.lastAt = now;
  return text;
}

function normalizePayload(payload, state) {
  if (typeof payload === 'string') {
    return avoidImmediateRepeat(compactText(payload), state);
  }
  if (!payload || typeof payload !== 'object' || typeof payload.content !== 'string') return payload;

  const content = avoidImmediateRepeat(compactText(payload.content), state);
  return { ...payload, content };
}

function patchChannel(channel) {
  if (!channel?.isTextBased?.() || !isKingdomChat(channel) || channel[PATCHED]) return;

  const originalSend = channel.send.bind(channel);
  const state = { lastText: '', lastAt: 0, repeats: 0 };

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
      return originalSend(normalizePayload(payload, state));
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
