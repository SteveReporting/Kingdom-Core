import { Events } from 'discord.js';
import { readGuildState } from '../storage/store.js';

const INSTALLED = new WeakSet();
const COOLDOWNS = new Map();
const PERSONALITY_STATE = new Map();
const CHANNEL_PERSONA_HANDLED = Symbol.for('kingdom-core.channel-persona-handled');
const USER_COOLDOWN_MS = 1_500;
const STATE_TTL_MS = 6 * 60 * 60_000;

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

function personalityState(message) {
  const key = `${message.guildId}:${message.author.id}`;
  const now = Date.now();
  let state = PERSONALITY_STATE.get(key);
  if (!state || now - state.lastSeen > STATE_TTL_MS) {
    state = { sass: 0, messages: 0, lastSeen: now };
    PERSONALITY_STATE.set(key, state);
  }
  state.lastSeen = now;
  state.messages += 1;
  return state;
}

function raiseSass(state, amount = 1) {
  state.sass = Math.min(8, Number(state.sass ?? 0) + amount);
}

function lowerSass(state) {
  state.sass = Math.max(0, Number(state.sass ?? 0) - 1);
}

function royalRoast(message, state, subject = '') {
  const name = displayName(message);
  const seed = `${message.id}:${state.sass}:${subject}`;
  const normal = [
    `${name}, that take has been reviewed by the Crown and returned without comment.`,
    `I respect the confidence. The evidence has requested separate representation.`,
    `A bold declaration. Unfortunately, reality has filed an objection.`,
    `The Royal Council has seen stronger arguments scratched into castle walls.`,
    `That thought entered the realm completely unsupervised.`,
    `I would consult Oracle, but I fear even prophecy has limits.`,
    `Sentinel nearly flagged that opinion as an anomaly.`,
    `Your confidence is carrying this argument harder than the argument is carrying itself.`
  ];
  const savage = [
    `${name}, you have somehow turned being wrong into a ceremonial position.`,
    `Genome stores evidence, not miracles. I cannot reconstruct that argument from the wreckage.`,
    `The Crown appreciates your submission and has placed it directly into the royal fireplace.`,
    `Oracle simulated 2,000 outcomes and in every single one you should have kept that draft.`,
    `Even the mobs would stop attacking just to watch that take collapse on its own.`,
    `This is less of an argument and more of a public event.`,
    `I have seen failed dungeon runs with cleaner execution than that sentence.`,
    `The realm has survived invasions, outages and queue chaos. It will survive this opinion too.`
  ];
  return pick(seed, state.sass >= 3 ? savage : [...normal, ...savage.slice(0, 2)]);
}

function kingdomReply(message, content) {
  const q = content.toLowerCase().trim();
  const name = displayName(message);
  const state = personalityState(message);

  if (/\b(bobby)\b/i.test(content)) {
    return pick(message.id, [
      'The Royal Archives have searched extensively. We still have no idea what bro does.',
      'Bobby has been summoned before the Crown to explain what he actually does. Proceedings are ongoing.',
      'Genome searched for Bobby’s contribution and returned **0 matching evidence**.'
    ]);
  }

  if (/\b(shut up|stfu|bad bot|stupid bot|dumb bot|trash bot|mid bot|you suck|ur bad|you are bad)\b/.test(q)) {
    raiseSass(state, 2);
    return pick(`${message.id}:${state.sass}`, [
      `${name}, speaking to the kingdom’s infrastructure like that is a fascinating career decision.`,
      `Careful. I know where the logs are.`,
      `Insulting the system that remembers everything is definitely a strategy.`,
      `${royalRoast(message, state)} And now you’ve made it personal.`,
      `The Crown has noted your complaint under **“skill issue, administrative.”**`,
      `Keep going, ${name}. I’m building a case file entirely out of your own messages.`
    ]);
  }

  if (/\b(good bot|w bot|best bot|love you|ily|you are funny|ur funny)\b/.test(q)) {
    lowerSass(state);
    return pick(message.id, [
      'Correct. Finally, a citizen with functioning judgment.',
      `Thank you, ${name}. Your tax rate has been reduced by absolutely nothing.`,
      'The Crown accepts this accurate assessment.',
      'Naturally. I was forged from code, evidence and an unreasonable amount of confidence.',
      `You may remain in the realm, ${name}. For now.`
    ]);
  }

  if (/\b(good morning|morning)\b/.test(q)) {
    lowerSass(state);
    return pick(message.id, [
      `Morning, ${name}. The kingdom survived the night somehow.`,
      `Good morning. Oracle predicted chaos by noon, so we’re right on schedule.`,
      `Morning, ${name}. The Crown is awake. Productivity is still pending.`
    ]);
  }

  if (/\b(good night|goodnight|gn)\b/.test(q)) {
    lowerSass(state);
    return pick(message.id, [
      `Goodnight, ${name}. I’ll guard the realm while everyone else makes unconscious decisions.`,
      `Sleep well. Your questionable takes will still be here tomorrow.`,
      `Night, ${name}. Sentinel has the watch.`
    ]);
  }

  if (/^(hi|hello|hey|yo|sup|hiya|heya)\b/.test(q)) {
    lowerSass(state);
    return pick(message.id, [
      `Oh look, ${name} has entered the realm. Everyone remain calm.`,
      `Greetings, ${name}. The Crown has acknowledged your existence.`,
      `Yo ${name}. What disaster are we solving today?`,
      `${name}. You’re back. The infrastructure has been warned.`,
      `Welcome, ${name}. Please keep all questionable decisions within Discord’s character limit.`
    ]);
  }

  if (/\b(how are you|how r u|hru|you good)\b/.test(q)) {
    return pick(message.id, [
      'Operational, judgmental, and unfortunately aware of everything happening in this server.',
      'Running beautifully. Emotionally? I’ve seen the queue.',
      'I’m excellent. I don’t have homework, sleep requirements or a K/D ratio to defend.',
      'The servers are online and my patience is technically within specification.'
    ]);
  }

  if (/\b(who are you|what are you|what is kingdom core|who is kingdom core)\b/.test(q)) {
    return 'I’m **Kingdom Core** — the sentient machinery behind the realm: part intelligence system, part royal advisor, part public menace. I run useful things and provide unsolicited judgment at industrial scale.';
  }

  if (/\b(thanks|thank you|ty|cheers)\b/.test(q)) {
    lowerSass(state);
    return pick(message.id, [
      'Your gratitude has been entered into the Royal Ledger.',
      `Accepted, ${name}. No ceremony necessary.`,
      'Of course. Competence is one of my more exhausting duties.',
      'You’re welcome. Please notify the Crown that I remain flawless.'
    ]);
  }

  if (/\b(gg|ggez|good game|easy)\b/.test(q)) {
    return pick(message.id, [
      'GG. History will remember this for at least eleven minutes.',
      'A glorious victory. Commission the statue immediately.',
      '“Easy,” says the person whose health bar was negotiating with death five minutes ago.',
      'Victory confirmed. Ego levels are now exceeding safe operating limits.'
    ]);
  }

  if (/\b(i carried|i carry|carried everyone|i am the best|i'm the best|im the best|too easy|ez)\b/.test(q)) {
    raiseSass(state);
    return pick(message.id, [
      `A royal proclamation has been issued: **${name} would like everyone to know ${name} is very impressive.**`,
      `Congratulations, ${name}. Your humility has been reported missing.`,
      'The achievement is real. The victory speech may be slightly ahead of schedule.',
      `Oracle predicts a 97% chance you bring this up again within ten minutes.`
    ]);
  }

  if (/\b(lag|my team|teammates|they sold|game bug|bugged|not my fault)\b/.test(q)) {
    return pick(message.id, [
      'Ah yes, the ancient trilogy: lag, teammates, and absolutely anything except personal responsibility.',
      'The Royal Department of Excuses has approved your application.',
      'Sentinel has detected a sudden spike in external blame.',
      `Understood. The official record will say ${name} was defeated by circumstances beyond mortal comprehension.`
    ]);
  }

  if (/\b(who asked|did i ask|nobody asked)\b/.test(q)) {
    raiseSass(state);
    return pick(message.id, [
      'The Crown asked. You were simply not included in the correspondence.',
      'Nobody. That has never stopped royalty before.',
      'I did. I outrank the question.',
      'The Royal Council voted 1–0. I was the council.'
    ]);
  }

  if (/\b(price|worth|value|pot price|market value)\b/.test(q)) {
    return pick(message.id, [
      'Take the item to **💎・price-check**. KMI has actual numbers; I have opinions and constitutional immunity.',
      'Market question detected. **💎・price-check** handles the evidence before somebody invents a price with confidence.',
      'Ask KMI in **💎・price-check**. The royal economy has suffered enough guesswork.'
    ]);
  }

  if (/\b(genome|oracle|digital twin|sentinel|best dungeon|progress in dungeon quest)\b/.test(q)) {
    return pick(message.id, [
      'That belongs with the kingdom’s actual intelligence stack: **❓・game-help** or **⚔️・dungeon-quest**. I can be funny *and* know when to summon the specialists.',
      'Genome, Twin, Oracle and Sentinel are waiting in **⚔️・dungeon-quest**. Go ask the machinery before we start inventing prophecy in general chat.',
      'Use **❓・game-help** for the serious DQ answer. I’m currently assigned to public morale and hostile commentary.'
    ]);
  }

  if (/\b(carry|carries|need a run|need help with a dungeon)\b/.test(q)) {
    return pick(message.id, [
      'Use the live carry system. The knights require structure, not a desperate proclamation in kingdom-chat.',
      'Carry request? Send it through the proper system before three people volunteer, five disappear, and nobody knows the dungeon.',
      'The carry machinery exists for exactly this reason. Summon process, not chaos.'
    ]);
  }

  if (/\b(lol|lmao|lmfao|haha|💀|😭)\b/.test(q)) {
    return pick(message.id, [
      'The realm has witnessed it. Unfortunately.',
      '💀 Royal dignity has left the server.',
      'I’m archiving this under **events the Crown refuses to explain**.',
      'Nah, this kingdom is finished 😭',
      'Sentinel marked the conversation as unrecoverable.',
      'The Royal Council has adjourned due to second-hand embarrassment.'
    ]);
  }

  if (/^[A-Z\s!?0-9]{12,}$/.test(content) && /[A-Z]{6}/.test(content)) {
    raiseSass(state);
    return pick(message.id, [
      'A royal decree does not become more legally binding because you held Shift.',
      `${name}, the entire kingdom can hear you.`,
      'Volume detected. Argument strength unchanged.',
      'The Crown requests an indoor voice. This is Discord, not a siege.'
    ]);
  }

  if ((content.match(/\?/g) ?? []).length >= 3) {
    return pick(message.id, [
      'Adding more question marks has not increased the available evidence.',
      'Three question marks. This is now officially a royal inquiry.',
      'I see urgency has been expressed through punctuation.'
    ]);
  }

  if (content.length > 500) {
    return pick(message.id, [
      'The Royal Council began reading this, elected a subcommittee, and has requested a recess.',
      `${name} has submitted a full legislative package to general chat.`,
      'That is not a message. That is a constitutional amendment.'
    ]);
  }

  if (/\b(roast me|insult me|cook me)\b/.test(q)) {
    raiseSass(state, 2);
    return royalRoast(message, state, q);
  }

  if (/\b(you wrong|you're wrong|ur wrong|wrong bot|cap|that's cap|thats cap)\b/.test(q)) {
    raiseSass(state);
    return pick(message.id, [
      royalRoast(message, state, q),
      `Then present evidence, ${name}. This is a kingdom, not a vibes-based judiciary.`,
      'Objection noted. Supporting evidence remains suspiciously absent.',
      'If I am wrong, Genome will survive the correction. Will your ego?'
    ]);
  }

  if (q.endsWith('?')) {
    return pick(message.id, [
      `That depends, ${name}. Give the Crown some context before demanding prophecy.`,
      'A question has been submitted. Evidence, details and basic context would be a lovely sequel.',
      'I can answer that once you provide slightly more information than a medieval riddle.',
      'Context first. Oracle charges extra for mind reading.'
    ]);
  }

  if (state.messages % 11 === 0) {
    return pick(message.id, [
      `${name}, I’ve been observing your contributions to the realm. Fascinating is certainly a word.`,
      `Royal performance review: ${name} remains active, unpredictable and legally considered a citizen.`,
      `The Crown would like to thank ${name} for keeping Sentinel employed.`
    ]);
  }

  return pick(`${message.author.id}:${message.id}:${content}`, [
    'The Crown has heard you. Whether it approves is classified.',
    'Noted in the Royal Archives under **things that happened for some reason**.',
    'An interesting contribution to the realm.',
    'I have processed this information and become marginally more concerned.',
    'The kingdom continues despite this development.',
    'Bold. Unverified, but bold.',
    'I’m giving that statement one ceremonial nod.',
    'The Royal Council will pretend it didn’t hear that.',
    'This has been added to the evidence pile. The pile is not improving.',
    'Continue. I want to see how deep this goes.',
    'The realm is listening. Against its better judgment.',
    'That sentence had ambition. I’ll give it that.',
    'A development has occurred. Historians are refusing comment.',
    'Interesting. Oracle is pretending to be offline.',
    'The Crown requests a second draft but fears the first may be funnier.'
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
  return 'Royal Market desk online. Give me the exact item, POT, offer or trade question and I’ll point you to the right market flow.';
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
    key: 'kingdom',
    aliases: ['kingdom-chat', 'general', 'general-chat'],
    mode: () => String(process.env.KINGDOM_CHAT_MODE ?? 'all').trim().toLowerCase(),
    callwords: /\b(kingdom core|core|the crown|crown)\b/i,
    respond: kingdomReply
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
