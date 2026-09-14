import { Events } from 'discord.js';
import { readGuildState } from '../storage/store.js';

const INSTALLED = new WeakSet();
const COOLDOWNS = new Map();
const CHANNEL_PERSONA_HANDLED = Symbol.for('kingdom-core.channel-persona-handled');
const USER_COOLDOWN_MS = 1_500;

function normalizeName(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function displayName(message) {
  return message.member?.displayName || message.author?.globalName || message.author?.username || 'traveller';
}

function pick(seed, values) {
  if (!values.length) return '';
  let hash = 2166136261;
  for (const char of String(seed ?? '')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return values[Math.abs(hash) % values.length];
}

function stripBotMention(message, content) {
  if (!message.client.user) return content.trim();
  return content.replace(new RegExp(`<@!?${message.client.user.id}>`, 'g'), '').trim();
}

async function repliedToBot(message) {
  const id = message.reference?.messageId;
  if (!id || !message.client.user) return false;
  return message.channel.messages.fetch(id)
    .then((referenced) => referenced.author?.id === message.client.user.id)
    .catch(() => false);
}

function directMention(message) {
  return Boolean(message.client.user && message.mentions?.users?.has(message.client.user.id));
}

async function queueDepth(guildId) {
  const state = await readGuildState(guildId).catch(() => null);
  return Array.isArray(state?.queue) ? state.queue.length : null;
}

function bartenderReply(message, content) {
  const q = content.toLowerCase();
  const name = displayName(message);

  if (/\bbobby\b/i.test(content)) return 'what does bro even do.';
  if (/\b(good morning|morning)\b/.test(q)) return `Morning, ${name}. Bar's open early apparently. 🍻`;
  if (/\b(good night|goodnight|gn)\b/.test(q)) return `Night, ${name}. I'll keep the bar standing. 🍻`;
  if (/^(hi|hello|hey|yo|sup|hiya|heya)\b/.test(q)) return pick(message.id, [
    `Welcome in, ${name}. 🍻 What's happening?`,
    `Yo ${name} — grab a seat. What's the move?`,
    `${name}, welcome back. The usual? 🍺`
  ]);
  if (/\b(how are you|how r u|hru|you good)\b/.test(q)) return 'Still behind the bar, still watching people make questionable Dungeon Quest decisions. I’m good. 🍻';
  if (/\b(thanks|thank you|ty|cheers)\b/.test(q)) return pick(message.id, ['Anytime. 🍻', 'That’s what the bartender is here for.', `No bother, ${name}. 🍺`]);
  if (/\b(gg|ggez|good game)\b/.test(q)) return 'GG. Drinks on whoever carried. 🍻';
  if (/\b(who are you|what are you|bartender)\b/.test(q)) return 'I’m the Kingdom bartender — general-chat menace, part-time guide, full-time keeper of the bar. 🍺';
  if (/\b(price|worth|value|pot price|market value)\b/.test(q)) return 'For actual item values, throw the item into **💎・price-check** — KMI handles the numbers better than my bar napkin does.';
  if (/\b(genome|oracle|digital twin|sentinel|best dungeon|progress in dungeon quest)\b/.test(q)) return 'That’s Kingdom intelligence territory — **❓・game-help** or **⚔️・dungeon-quest** will give you the proper DQ answer. I just pour the drinks. 🍻';
  if (/\b(carry|carries|need a run|need help with a dungeon)\b/.test(q)) return 'If you need a carry, use the live carry system — don’t start bribing random knights in the bar. 🍺';
  if (/\b(beer|pint|drink|ale)\b/.test(q)) return pick(message.id, ['One virtual pint. Don’t spend it all at once. 🍺', 'Coming right up. 🍻', 'Royal tab or personal tab? 🍺']);
  if (/\b(lol|lmao|lmfao|haha|💀)\b/.test(q)) return pick(message.id, ['💀', 'The bar witnessed that.', 'Nahhh 😭', 'I’m staying out of this one. 🍺']);
  if (q.endsWith('?')) return pick(message.id, [
    `Depends what you’re trying to do, ${name}. Give me the details.`,
    'That needs context — go on, give me the full story. 🍻',
    'I can work with that, but you’re gonna have to give me more than one line.'
  ]);

  return pick(`${message.author.id}:${content}`, [
    'Fair enough. 🍻',
    'The bar has heard worse.',
    'Noted. Drinks first, consequences later. 🍺',
    'I’m listening.',
    'That is certainly one way to run a kingdom.',
    'Carry on — I’m keeping score behind the bar.'
  ]);
}

async function merchantReply(message, content) {
  const q = content.toLowerCase();
  if (/\b(price|worth|value|how much|pot)\b/.test(q)) {
    return 'For a live number, post the exact item in **💎・price-check**. I won’t invent a market value in trade-help.';
  }
  if (/\b(scamm|scam|safe trade|middleman)\b/.test(q)) {
    return 'Keep evidence, verify exactly what is being exchanged, and use the guild’s approved trade/support flow if anything looks off. Don’t rush a suspicious trade.';
  }
  if (/\b(trade|offer|fair)\b/.test(q)) {
    return 'Send the exact items/POT on both sides. For values, use **💎・price-check** first; then we can judge whether the trade is actually balanced.';
  }
  return 'Merchant’s here. Give me the exact item, POT, offer or trade question and I’ll point you to the right market flow.';
}

async function quartermasterReply(message, content) {
  const q = content.toLowerCase();
  if (/\b(queue|waiting|how many)\b/.test(q)) {
    const depth = await queueDepth(message.guildId);
    return depth == null ? 'I can’t read the queue count right now.' : `⚔️ Quartermaster report: **${depth}** member${depth === 1 ? '' : 's'} currently in the stored carry queue.`;
  }
  if (/\b(trial|verified carrier|carrier trial)\b/.test(q)) return 'For a carrier trial, follow the current trial-carrier process and have the required runs supervised before verification.';
  if (/\b(carry|run|host|party)\b/.test(q)) return 'Give me the dungeon, difficulty, HC/NM, party size and whether leeching is allowed — that’s enough to turn it into a clean carrier post.';
  return 'Quartermaster online. Ask me about the carry queue, carrier runs, trials or party setup.';
}

async function stewardReply(message, content) {
  const q = content.toLowerCase();
  if (/\b(queue|waiting)\b/.test(q)) {
    const depth = await queueDepth(message.guildId);
    return depth == null ? 'Queue state is unavailable.' : `Current stored carry queue depth: **${depth}**.`;
  }
  if (/\b(ticket|support)\b/.test(q)) return 'If you’re reviewing support, give me the ticket issue and desired action. I’ll keep the response concise and staff-safe.';
  if (/\b(application|app review|staff app|carrier app)\b/.test(q)) return 'Send the applicant details or review criteria and I’ll structure the decision cleanly.';
  if (/\b(announcement|announce|ping)\b/.test(q)) return 'Give me the event/action, who it applies to, and whether it should ping. I’ll format the announcement.';
  return 'Steward online. I can help with staff operations, tickets, applications, queue status and announcements.';
}

const PROFILES = [
  {
    key: 'bartender',
    aliases: ['kingdom-chat', 'general', 'general-chat'],
    mode: () => String(process.env.KINGDOM_BARTENDER_MODE ?? 'all').trim().toLowerCase(),
    callwords: /\b(bartender|keeper|kingdom core)\b/i,
    respond: bartenderReply
  },
  {
    key: 'merchant',
    aliases: ['trade-help'],
    mode: () => 'question',
    callwords: /\b(merchant|trader|trade help)\b/i,
    respond: merchantReply
  },
  {
    key: 'quartermaster',
    aliases: ['knight-chat', 'carrier-chat'],
    mode: () => 'question',
    callwords: /\b(quartermaster|carrier bot|kingdom core)\b/i,
    respond: quartermasterReply
  },
  {
    key: 'steward',
    aliases: ['staff-chat', 'royal-council'],
    mode: () => 'direct',
    callwords: /\b(steward|kingdom core)\b/i,
    respond: stewardReply
  }
];

function resolveProfile(channel) {
  const channelName = normalizeName(channel?.name);
  if (!channelName) return null;
  return PROFILES.find((profile) => profile.aliases.some((alias) => channelName === normalizeName(alias) || channelName.endsWith(normalizeName(alias)))) ?? null;
}

function onCooldown(message, profile) {
  const key = `${message.guildId}:${message.channelId}:${profile.key}:${message.author.id}`;
  const now = Date.now();
  const previous = COOLDOWNS.get(key) ?? 0;
  if (now - previous < USER_COOLDOWN_MS) return true;
  COOLDOWNS.set(key, now);
  return false;
}

async function shouldRespond(profile, message, content) {
  const mode = profile.mode();
  const mentioned = directMention(message);
  const callword = profile.callwords?.test(content) ?? false;
  const reply = message.reference?.messageId ? await repliedToBot(message) : false;

  if (mentioned || callword || reply) return true;
  if (mode === 'all') return true;
  if (mode === 'question') return content.trim().endsWith('?');
  return false;
}

async function handlePersonaMessage(message) {
  if (!message.inGuild?.() || message.author?.bot || !message.channel?.isTextBased?.()) return;
  const profile = resolveProfile(message.channel);
  if (!profile) return;

  // Mark synchronously so legacy/global assistants know this channel owns the message.
  message[CHANNEL_PERSONA_HANDLED] = profile.key;

  const original = String(message.content ?? '').trim();
  const content = stripBotMention(message, original);
  if (!content) return;
  if (!(await shouldRespond(profile, message, content))) return;
  if (onCooldown(message, profile)) return;

  const answer = await profile.respond(message, content);
  if (!answer) return;

  await message.channel.send({
    content: String(answer).slice(0, 1950),
    allowedMentions: { parse: [] }
  });
}

export function installLiveChannelPersonalities(client) {
  if (INSTALLED.has(client)) return;
  INSTALLED.add(client);

  client.on(Events.MessageCreate, (message) => {
    handlePersonaMessage(message).catch((error) => console.error('[ChannelPersona] message handler failed:', error));
  });

  client.once(Events.ClientReady, (readyClient) => {
    const active = [];
    for (const guild of readyClient.guilds.cache.values()) {
      for (const channel of guild.channels.cache.values()) {
        const profile = resolveProfile(channel);
        if (profile) active.push(`${guild.name}/#${channel.name}=${profile.key}`);
      }
    }
    console.log(`[ChannelPersona] live${active.length ? `: ${active.join(', ')}` : ' (no matching channels found)'}.`);
  });
}

export { CHANNEL_PERSONA_HANDLED };
