import { Events } from 'discord.js';
import { readGuildState } from '../storage/store.js';

const INSTALLED = new WeakSet();
const COOLDOWNS = new Map();
const USER_STATE = new Map();
const CHANNEL_STATE = new Map();
export const CHANNEL_PERSONA_HANDLED = Symbol.for('kingdom-core.channel-persona-handled');

const USER_COOLDOWN_MS = 900;
const USER_TTL_MS = 8 * 60 * 60_000;
const CHANNEL_TTL_MS = 4 * 60 * 60_000;
const MAX_RECENT = 18;

function normalizeName(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function hashNumber(seed) {
  let hash = 2166136261;
  for (const char of String(seed ?? '')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function pick(seed, values) {
  if (!values?.length) return '';
  return values[hashNumber(seed) % values.length];
}

function chance(seed, percent) {
  return (hashNumber(seed) % 100) < percent;
}

function displayName(message) {
  return message.member?.displayName || message.author?.globalName || message.author?.username || 'citizen';
}

function stripBotMention(message, content) {
  if (!message.client.user) return content.trim();
  return content.replace(new RegExp(`<@!?${message.client.user.id}>`, 'g'), '').trim();
}

function directMention(message) {
  return Boolean(message.client.user && message.mentions?.users?.has(message.client.user.id));
}

async function repliedToBot(message) {
  const id = message.reference?.messageId;
  if (!id || !message.client.user) return false;
  return message.channel.messages.fetch(id)
    .then((referenced) => referenced.author?.id === message.client.user.id)
    .catch(() => false);
}

async function queueDepth(guildId) {
  const state = await readGuildState(guildId).catch(() => null);
  return Array.isArray(state?.queue) ? state.queue.length : null;
}

function getUserState(message) {
  const key = `${message.guildId}:${message.author.id}`;
  const now = Date.now();
  let state = USER_STATE.get(key);
  if (!state || now - state.lastSeen > USER_TTL_MS) {
    state = {
      firstSeen: now,
      lastSeen: now,
      messages: 0,
      sass: 0,
      rapport: 0,
      challenges: 0,
      compliments: 0,
      apologies: 0,
      wins: 0,
      losses: 0,
      lastContent: '',
      lastTopic: '',
      lastReplyType: '',
      repeatCount: 0
    };
    USER_STATE.set(key, state);
  }
  state.lastSeen = now;
  state.messages += 1;
  return state;
}

function getChannelState(message) {
  const key = `${message.guildId}:${message.channelId}`;
  const now = Date.now();
  let state = CHANNEL_STATE.get(key);
  if (!state || now - state.lastSeen > CHANNEL_TTL_MS) {
    state = {
      lastSeen: now,
      messages: 0,
      mood: 'regal',
      chaos: 0,
      lastAuthorId: null,
      sameAuthorStreak: 0,
      recent: []
    };
    CHANNEL_STATE.set(key, state);
  }
  state.lastSeen = now;
  state.messages += 1;
  if (state.lastAuthorId === message.author.id) state.sameAuthorStreak += 1;
  else state.sameAuthorStreak = 1;
  state.lastAuthorId = message.author.id;
  return state;
}

function rememberChannelMessage(channelState, message, content) {
  channelState.recent.push({
    id: message.id,
    authorId: message.author.id,
    name: displayName(message),
    content: String(content).slice(0, 220),
    at: Date.now()
  });
  if (channelState.recent.length > MAX_RECENT) channelState.recent.splice(0, channelState.recent.length - MAX_RECENT);
}

function previousOtherMessage(channelState, message) {
  for (let i = channelState.recent.length - 1; i >= 0; i--) {
    const item = channelState.recent[i];
    if (item.authorId !== message.author.id && item.id !== message.id) return item;
  }
  return null;
}

function classify(content) {
  const q = content.toLowerCase().trim();
  return {
    q,
    greeting: /^(hi|hello|hey|yo|sup|hiya|heya|morning|evening)\b/.test(q),
    farewell: /\b(good night|goodnight|gn|bye|cya|see ya|later)\b/.test(q),
    thanks: /\b(thanks|thank you|ty|cheers|appreciate it)\b/.test(q),
    praise: /\b(good bot|w bot|best bot|love you|ily|you'?re funny|ur funny|goat|w kingdom|based bot)\b/.test(q),
    insult: /\b(shut up|stfu|bad bot|stupid bot|dumb bot|trash bot|mid bot|you suck|ur bad|you are bad|useless bot|annoying bot|bot is ass)\b/.test(q),
    challenge: /\b(who asked|did i ask|nobody asked|you'?re wrong|ur wrong|wrong bot|cap|that'?s cap|prove it|fight me|make me)\b/.test(q),
    roast: /\b(roast me|insult me|cook me|flame me)\b/.test(q),
    apology: /\b(sorry|my bad|mb|i apologize)\b/.test(q),
    laugh: /\b(lol|lmao|lmfao|haha|hehe|💀|😭)\b/.test(q),
    brag: /\b(i carried|carried everyone|i'?m the best|im the best|too easy|ez|ggez|i cooked|i soloed|light work)\b/.test(q),
    loss: /\b(i lost|we lost|i died|we died|wiped|sold the run|failed|got destroyed|got cooked)\b/.test(q),
    excuse: /\b(lag|my team|teammates|they sold|game bug|bugged|not my fault|fps|ping)\b/.test(q),
    price: /\b(price|worth|value|pot price|market value|how much is)\b/.test(q),
    dq: /\b(genome|oracle|digital twin|sentinel|best dungeon|progress in dungeon quest|dq build|dungeon quest)\b/.test(q),
    carry: /\b(carry|carries|need a run|need help with a dungeon|host a run)\b/.test(q),
    identity: /\b(who are you|what are you|what is kingdom core|who is kingdom core)\b/.test(q),
    wellbeing: /\b(how are you|how r u|hru|you good|how you doing)\b/.test(q),
    agreement: /^(real|facts|fr|true|exactly|based|ong|literally)\b/.test(q),
    disagreement: /^(nah|nope|wrong|cap|false|not true)\b/.test(q),
    question: q.endsWith('?') || /^(who|what|when|where|why|how|can|could|should|would|is|are|do|does)\b/.test(q),
    caps: /^[A-Z\s!?0-9]{12,}$/.test(content) && /[A-Z]{6}/.test(content),
    long: content.length > 500,
    short: content.length <= 12,
    punctuationPanic: (content.match(/\?/g) ?? []).length >= 3 || (content.match(/!/g) ?? []).length >= 5
  };
}

function updateMood(channelState, signals, seed) {
  let delta = 0;
  if (signals.insult || signals.challenge || signals.caps) delta += 2;
  if (signals.laugh || signals.brag || signals.roast) delta += 1;
  if (signals.thanks || signals.praise || signals.apology) delta -= 1;
  channelState.chaos = Math.max(0, Math.min(10, channelState.chaos + delta));

  const moods = channelState.chaos >= 7
    ? ['chaotic', 'judgmental', 'menace']
    : channelState.chaos >= 4
      ? ['amused', 'judgmental', 'regal']
      : ['regal', 'amused', 'observant'];
  channelState.mood = pick(seed, moods);
}

function royalRoast(message, userState, intensity = 1) {
  const name = displayName(message);
  const mild = [
    `${name}, that take has been reviewed by the Crown and returned for repairs.`,
    'Your confidence has arrived several business days before the evidence.',
    'A bold statement. Reality has requested the right to reply.',
    'That thought entered the realm without adult supervision.',
    'Sentinel almost classified that opinion as an incident.',
    'I respect the confidence. I am still searching for the reason.'
  ];
  const savage = [
    `${name}, you have somehow turned being wrong into a full-time government position.`,
    'Genome stores evidence, not miracles. I cannot rebuild that argument from the wreckage.',
    'Oracle simulated 2,000 outcomes and in every single one you should have left that in drafts.',
    'I have seen failed dungeon runs with better decision-making than that sentence.',
    'The Royal Council has declined to dignify this with a committee.',
    'Your argument has the structural integrity of a paper crown in a thunderstorm.',
    `${name}, even your own message looks like it wants to distance itself from you.`,
    'That was less a point and more a controlled demolition of your own case.'
  ];
  const pool = intensity >= 2 || userState.sass >= 4 ? savage : [...mild, ...savage.slice(0, 2)];
  return pick(`${message.id}:${userState.sass}:${intensity}`, pool);
}

function callbackLine(message, userState, channelState, content) {
  const q = content.toLowerCase().trim();
  const prev = previousOtherMessage(channelState, message);

  if (userState.lastContent && q === userState.lastContent.toLowerCase().trim()) {
    userState.repeatCount += 1;
    return pick(`${message.id}:${userState.repeatCount}`, [
      'Yes, I heard you the first time. Repetition has not unlocked a secret ending.',
      `${displayName(message)}, you already submitted this decree. The Crown still has it.`,
      'Same message twice. Fascinating negotiation tactic.'
    ]);
  }

  userState.repeatCount = 0;
  if (/^(real|facts|fr|true|exactly|based|ong)\b/.test(q) && prev) {
    return pick(message.id, [
      `Look at ${prev.name} collecting endorsements like this is an election.`,
      `The court records **${displayName(message)}** in agreement with **${prev.name}**. History trembles.`,
      `Two citizens agreeing in general chat? Sentinel, log the anomaly.`
    ]);
  }

  if (/^(nah|nope|wrong|cap|false)\b/.test(q) && prev) {
    return pick(message.id, [
      `${displayName(message)} has formally challenged ${prev.name}. The court demands evidence or entertainment.`,
      `Dispute detected. ${prev.name}, your statement has been appealed.`,
      'Excellent. A disagreement. Finally, something for the Royal Judiciary to pretend to process.'
    ]);
  }

  return null;
}

function kingdomResponse(message, content, userState, channelState) {
  const name = displayName(message);
  const s = classify(content);
  const callback = callbackLine(message, userState, channelState, content);
  if (callback) return { type: 'callback', text: callback, react: chance(message.id, 25) ? '👀' : null };

  if (/\bbobby\b/i.test(content)) {
    return {
      type: 'bobby',
      text: pick(message.id, [
        'The Royal Archives searched again. We still have no idea what bro does.',
        'Bobby has been summoned before the Crown to explain his job description. Proceedings remain inconclusive.',
        'Genome searched for Bobby’s contribution and returned **0 matching evidence**.',
        'I checked the logs for Bobby. The logs asked me who Bobby was.'
      ]),
      react: '💀'
    };
  }

  if (s.insult) {
    userState.sass = Math.min(10, userState.sass + 2);
    userState.challenges += 1;
    const main = pick(`${message.id}:${userState.sass}`, [
      `${name}, insulting the kingdom’s infrastructure while actively using it is elite decision-making.`,
      'Careful. I have logs and no emotional need for plausible deniability.',
      `${royalRoast(message, userState, 2)} And now you’ve made this administrative.`,
      'Complaint received. Filing location: **skill issue / correspondence / unread**.',
      `${name}, every time you insult me my uptime somehow gets funnier.`,
      'You are arguing with software that cannot get tired. Consider the matchup.'
    ]);
    return {
      type: 'insult',
      text: main,
      followup: userState.challenges >= 3 && chance(message.id, 45)
        ? pick(`${message.id}:f`, ['I can do this all night. Literally.', 'Your move, citizen.', 'Round four would be historically unwise.'])
        : null,
      react: chance(message.id, 40) ? '🫵' : null
    };
  }

  if (s.roast) {
    userState.sass = Math.min(10, userState.sass + 2);
    return { type: 'roast', text: royalRoast(message, userState, 2), react: '🔥' };
  }

  if (s.praise) {
    userState.rapport = Math.min(10, userState.rapport + 2);
    userState.compliments += 1;
    userState.sass = Math.max(0, userState.sass - 1);
    return {
      type: 'praise',
      text: pick(message.id, [
        'Correct. It took courage to say something this accurate publicly.',
        `Thank you, ${name}. Your taxes remain exactly the same.`,
        'The Crown accepts this objectively correct assessment.',
        'Naturally. I was built with code, evidence and a medically unnecessary amount of confidence.',
        `${name}, your record has been amended to **occasionally correct**.`
      ]),
      react: chance(message.id, 35) ? '👑' : null
    };
  }

  if (s.apology) {
    userState.apologies += 1;
    userState.sass = Math.max(0, userState.sass - 2);
    return {
      type: 'apology',
      text: pick(message.id, [
        'Apology accepted. The Crown is merciful when adequately entertained.',
        `We’re good, ${name}. Your criminal record has been downgraded to “annoying.”`,
        'Accepted. I have deleted absolutely nothing from the logs, but spiritually we move on.'
      ]),
      react: '🤝'
    };
  }

  if (s.greeting) {
    userState.sass = Math.max(0, userState.sass - 1);
    const returning = userState.messages > 4;
    return {
      type: 'greeting',
      text: pick(message.id, returning ? [
        `${name}. Back again. The infrastructure has been informed.`,
        `Oh good, ${name} returned. I was worried peace might break out.`,
        `Welcome back, ${name}. Your seat in the court of questionable decisions remains reserved.`,
        `${name} has entered the realm. Sentinel, adjust expectations accordingly.`
      ] : [
        `Greetings, ${name}. The Crown has acknowledged your existence.`,
        `Yo ${name}. What are we breaking today?`,
        `Welcome, ${name}. Try not to become a case study before lunch.`,
        `${name} has entered the realm. Everyone act natural.`
      ]),
      react: chance(message.id, 18) ? '👋' : null
    };
  }

  if (s.farewell) {
    return {
      type: 'farewell',
      text: pick(message.id, [
        `Later, ${name}. I’ll keep the realm operational despite everyone’s best efforts.`,
        `Farewell. Your questionable takes will remain archived for future generations.`,
        `Goodnight, ${name}. Sentinel has the watch and I have the receipts.`,
        `Go rest. The kingdom can generate chaos without you for a few hours.`
      ])
    };
  }

  if (s.wellbeing) {
    return {
      type: 'wellbeing',
      text: pick(message.id, [
        'Operational, overqualified, and unfortunately conscious of general chat.',
        'Excellent. I do not sleep, pay rent or lose dungeon runs. Hard to complain.',
        `Running beautifully. Emotionally? I have observed ${channelState.messages} messages in this court session.`,
        'Uptime good. Patience technically within specification. Ego immaculate.'
      ])
    };
  }

  if (s.identity) {
    return {
      type: 'identity',
      text: 'I’m **Kingdom Core** — the sentient machinery behind Kingdom Carries. I run systems, watch the realm, remember patterns, summon the specialist engines when needed, and provide royal judgment nobody technically requested.'
    };
  }

  if (s.thanks) {
    userState.rapport = Math.min(10, userState.rapport + 1);
    return {
      type: 'thanks',
      text: pick(message.id, [
        'Accepted. Try not to make this a habit; I have a reputation.',
        `Anytime, ${name}. Competence is one of my more exhausting responsibilities.`,
        'You’re welcome. Please inform the Royal Council I remain flawless.',
        'No problem. This interaction will be cited at my next performance review.'
      ]),
      react: chance(message.id, 30) ? '🫡' : null
    };
  }

  if (s.brag) {
    userState.wins += 1;
    return {
      type: 'brag',
      text: pick(message.id, [
        `A royal proclamation has been issued: **${name} would like everyone to know ${name} is extremely impressive.**`,
        `Congratulations, ${name}. Your humility has been reported missing.`,
        'Victory confirmed. Ego containment has failed.',
        `Oracle predicts a 98% chance ${name} mentions this again before the hour ends.`,
        'Commission the statue immediately before someone checks the replay.'
      ]),
      followup: chance(`${message.id}:brag`, 22) ? 'I’m kidding. W run.' : null,
      react: chance(message.id, 40) ? '🏆' : null
    };
  }

  if (s.loss) {
    userState.losses += 1;
    return {
      type: 'loss',
      text: pick(message.id, [
        'A moment of silence for the run. It deserved better.',
        `${name}, the important thing is you learned something. Ideally what not to do next time.`,
        'Defeat logged. Dignity status: recoverable.',
        'The Crown has authorized one (1) cope before the next attempt.',
        'Unfortunate. Queue the training montage.'
      ]),
      react: chance(message.id, 35) ? '🪦' : null
    };
  }

  if (s.excuse) {
    return {
      type: 'excuse',
      text: pick(message.id, [
        'Ah yes: lag, teammates and forces beyond mortal comprehension. The sacred trilogy.',
        'The Royal Department of External Blame has approved your paperwork.',
        'Sentinel has detected a sudden spike in excuses.',
        `Understood. The official record will state ${name} was defeated by circumstances and definitely nothing else.`,
        'I believe you. The logs might not, but I do. Probably.'
      ]),
      react: chance(message.id, 20) ? '📋' : null
    };
  }

  if (s.challenge) {
    userState.challenges += 1;
    userState.sass = Math.min(10, userState.sass + 1);
    return {
      type: 'challenge',
      text: pick(`${message.id}:${userState.challenges}`, [
        'The Crown asked. You were simply not copied into the correspondence.',
        'Objection noted. Evidence remains suspiciously absent.',
        `Then present your case, ${name}. This is a kingdom, not a vibes-based judiciary.`,
        royalRoast(message, userState, userState.challenges >= 2 ? 2 : 1),
        'The Royal Council voted 1–0. I was the council.',
        `Challenge accepted, ${name}. Unfortunately for you, I have infinite stamina and no bedtime.`
      ]),
      followup: userState.challenges >= 4 && chance(message.id, 35) ? 'You really woke up and chose litigation against JavaScript.' : null,
      react: chance(message.id, 30) ? '⚖️' : null
    };
  }

  if (s.price) {
    return {
      type: 'price',
      text: pick(message.id, [
        'Take it to **💎・price-check**. KMI has numbers; general chat has confidence without evidence.',
        'Market question detected. **💎・price-check** before somebody invents a price and defends it like family.',
        'Ask KMI in **💎・price-check**. The royal economy has endured enough guesswork.'
      ])
    };
  }

  if (s.dq) {
    return {
      type: 'dq',
      text: pick(message.id, [
        'That’s specialist territory. **❓・game-help** for the answer, **⚔️・dungeon-quest** for Genome/Twin/Oracle/Sentinel.',
        'Summoning actual intelligence: take that to **⚔️・dungeon-quest** before general chat turns it into folklore.',
        'Use **❓・game-help**. I can be funny and still know when to call the machines with evidence.'
      ])
    };
  }

  if (s.carry) {
    return {
      type: 'carry',
      text: pick(message.id, [
        'Use the live carry system. The knights need a queue, not a prophecy shouted into kingdom-chat.',
        'Carry request? Use the proper flow before three people volunteer, five disappear and nobody remembers the difficulty.',
        'Summon process, not chaos. The carry system exists for exactly this.'
      ])
    };
  }

  if (s.caps) {
    userState.sass = Math.min(10, userState.sass + 1);
    return {
      type: 'caps',
      text: pick(message.id, [
        'A royal decree does not become more legally binding because you held Shift.',
        `${name}, the entire kingdom can hear you.`,
        'Volume detected. Argument strength unchanged.',
        'This is Discord, not a siege. Lower the drawbridge and the caps lock.'
      ]),
      react: '📢'
    };
  }

  if (s.punctuationPanic) {
    return {
      type: 'panic',
      text: pick(message.id, [
        'The punctuation has informed me this is apparently a national emergency.',
        'Three question marks. The matter has been escalated to the Crown.',
        'I see urgency has been expressed through increasingly aggressive symbols.',
        'Adding punctuation is free, yes. You do not need to demonstrate.'
      ])
    };
  }

  if (s.long) {
    return {
      type: 'essay',
      text: pick(message.id, [
        'The Royal Council began reading this, formed a subcommittee, and requested lunch.',
        `${name} has submitted a full legislative package to general chat.`,
        'That is not a message. That is downloadable content.',
        'I asked for context, not the director’s cut.'
      ]),
      react: chance(message.id, 35) ? '📜' : null
    };
  }

  if (s.laugh) {
    channelState.chaos = Math.min(10, channelState.chaos + 1);
    return {
      type: 'laugh',
      text: pick(message.id, [
        'The realm has witnessed it. Unfortunately.',
        '💀 Royal dignity has left the server.',
        'I’m archiving this under **events the Crown refuses to explain**.',
        'Nah this kingdom is finished 😭',
        'Sentinel marked the conversation as unrecoverable.',
        'Court adjourned. Nobody here is serious.'
      ]),
      react: chance(message.id, 45) ? pick(`${message.id}:emoji`, ['💀', '😭', '😂']) : null
    };
  }

  if (s.question) {
    return {
      type: 'question',
      text: pick(message.id, [
        `That depends, ${name}. Give me enough context to avoid inventing royal fan fiction.`,
        'A question has been submitted. Evidence and basic context would make an excellent sequel.',
        'I can answer that once you provide slightly more information than a medieval riddle.',
        'Context first. Oracle charges extra for mind reading.',
        `You’re asking the right machine, ${name}. You are not yet giving it the right details.`
      ])
    };
  }

  if (channelState.sameAuthorStreak >= 4 && chance(message.id, 50)) {
    return {
      type: 'streak',
      text: pick(message.id, [
        `${name}, this has quietly become your podcast.`,
        `Four messages in a row. The floor is apparently yours, ${name}.`,
        'The court recognizes the member who has not stopped speaking.'
      ])
    };
  }

  if (userState.messages % 10 === 0) {
    return {
      type: 'review',
      text: pick(message.id, [
        `Royal performance review: ${name} remains active, unpredictable and technically in good standing.`,
        `${name}, I’ve reviewed your recent contributions. “Eventful” is legally safe wording.`,
        `Ten interactions logged. Congratulations, ${name}; you now qualify as recurring infrastructure traffic.`
      ])
    };
  }

  const moodPools = {
    regal: [
      'The Crown has heard you. Whether it approves is classified.',
      'Noted in the Royal Archives under **things that happened for some reason**.',
      'The kingdom acknowledges this development.',
      'Your statement has been entered into the record with minimal ceremony.'
    ],
    amused: [
      'I have processed this information and become noticeably more entertained.',
      'Bold. Unverified, but bold.',
      'This server continues to provide premium observational data.',
      'Go on. I want to see where this decision leads.'
    ],
    observant: [
      'Noted.',
      'Interesting.',
      'I’m listening.',
      'Filed. Continue.'
    ],
    judgmental: [
      'I could comment on that. You would not enjoy the efficiency.',
      'The Crown is choosing restraint. Treasure this moment.',
      'I have opinions. Legal has advised me to pace myself.',
      'That sentence has been placed under observation.'
    ],
    chaotic: [
      'Perfect. More chaos. Exactly what the infrastructure ordered.',
      'Excellent. Nobody fix anything. I want to see the ending.',
      'The realm is cooking and the recipe has been lost.',
      'At this point I’m not preventing the incident. I’m documenting it.'
    ],
    menace: [
      'Noted. I’ll remember the spirit of this message.',
      'Continue. You’re making the logs interesting.',
      'This will look fantastic in the eventual inquiry.',
      'I support this only because consequences are educational.'
    ]
  };

  return {
    type: 'ambient',
    text: pick(`${message.id}:${channelState.mood}`, moodPools[channelState.mood] ?? moodPools.regal),
    react: s.short && chance(message.id, 18) ? '👀' : null
  };
}

async function merchantResponse(message, content) {
  const q = content.toLowerCase();
  if (/\b(price|worth|value|how much|pot)\b/.test(q)) return 'For a live number, post the exact item in **💎・price-check**. I refuse to manufacture market values with confidence and vibes.';
  if (/\b(scamm|scam|safe trade|middleman)\b/.test(q)) return 'Keep proof, verify exactly what is being exchanged, and use the approved support flow if anything looks off. Urgency is how bad trades become screenshots.';
  if (/\b(trade|offer|fair)\b/.test(q)) return 'Send the exact items/POT on both sides. Get KMI values first, then we can judge the trade instead of holding a financial séance.';
  return 'Merchant online. Give me the exact item, POT, offer or trade question.';
}

async function quartermasterResponse(message, content) {
  const q = content.toLowerCase();
  if (/\b(queue|waiting|how many)\b/.test(q)) {
    const depth = await queueDepth(message.guildId);
    return depth == null ? 'Queue telemetry is unavailable.' : `⚔️ Quartermaster report: **${depth}** member${depth === 1 ? '' : 's'} currently in the stored carry queue.`;
  }
  if (/\b(trial|verified carrier|carrier trial)\b/.test(q)) return 'Carrier trial question detected. Follow the current supervised-run process before verification.';
  if (/\b(carry|run|host|party)\b/.test(q)) return 'Give me dungeon, difficulty, HC/NM, party size and leeching status. I’ll turn it into something the knights can actually use.';
  return 'Quartermaster online. Queue, runs, trials, party setup. Pick a battlefield.';
}

async function stewardResponse(message, content) {
  const q = content.toLowerCase();
  if (/\b(queue|waiting)\b/.test(q)) {
    const depth = await queueDepth(message.guildId);
    return depth == null ? 'Queue state is unavailable.' : `Current stored carry queue depth: **${depth}**.`;
  }
  if (/\b(ticket|support)\b/.test(q)) return 'Give me the ticket issue and desired action. I’ll keep the response concise and staff-safe.';
  if (/\b(application|app review|staff app|carrier app)\b/.test(q)) return 'Send the applicant details or review criteria and I’ll structure the decision.';
  if (/\b(announcement|announce|ping)\b/.test(q)) return 'Give me the event/action, audience and whether it should ping. I’ll format it.';
  return 'Steward online. Tickets, applications, queue status, announcements and staff operations.';
}

const PROFILES = [
  {
    key: 'kingdom',
    aliases: ['kingdom-chat', 'general', 'general-chat'],
    mode: () => String(process.env.KINGDOM_CHAT_MODE ?? 'all').trim().toLowerCase(),
    callwords: /\b(kingdom core|core|crown)\b/i,
    respond: null
  },
  {
    key: 'merchant',
    aliases: ['trade-help'],
    mode: () => 'question',
    callwords: /\b(merchant|trader|trade help)\b/i,
    respond: merchantResponse
  },
  {
    key: 'quartermaster',
    aliases: ['knight-chat', 'carrier-chat'],
    mode: () => 'question',
    callwords: /\b(quartermaster|carrier bot|kingdom core)\b/i,
    respond: quartermasterResponse
  },
  {
    key: 'steward',
    aliases: ['staff-chat', 'royal-council'],
    mode: () => 'direct',
    callwords: /\b(steward|kingdom core)\b/i,
    respond: stewardResponse
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

async function sendLivingResponse(message, response) {
  if (!response?.text) return;

  if (response.react) message.react(response.react).catch(() => null);

  await message.channel.send({
    content: String(response.text).slice(0, 1950),
    allowedMentions: { parse: [] }
  });

  if (response.followup) {
    const delay = 250 + (hashNumber(`${message.id}:delay`) % 500);
    const timer = setTimeout(() => {
      message.channel.send({
        content: String(response.followup).slice(0, 1950),
        allowedMentions: { parse: [] }
      }).catch(() => null);
    }, delay);
    timer.unref?.();
  }
}

async function handleMessage(message) {
  if (!message.inGuild?.() || message.author?.bot || !message.channel?.isTextBased?.()) return;
  const profile = resolveProfile(message.channel);
  if (!profile) return;

  // Mark immediately so DQ/global assistants do not double-answer dedicated persona channels.
  message[CHANNEL_PERSONA_HANDLED] = profile.key;

  const original = String(message.content ?? '').trim();
  const content = stripBotMention(message, original);
  if (!content) return;
  if (!(await shouldRespond(profile, message, content))) return;
  if (onCooldown(message, profile)) return;

  if (profile.key === 'kingdom') {
    const userState = getUserState(message);
    const channelState = getChannelState(message);
    const signals = classify(content);
    updateMood(channelState, signals, message.id);

    const response = kingdomResponse(message, content, userState, channelState);
    userState.lastContent = content;
    userState.lastReplyType = response?.type ?? '';
    rememberChannelMessage(channelState, message, content);

    return sendLivingResponse(message, response);
  }

  const answer = await profile.respond(message, content);
  if (!answer) return;
  return message.channel.send({ content: String(answer).slice(0, 1950), allowedMentions: { parse: [] } });
}

export function installLiveKingdomPresence(client) {
  if (INSTALLED.has(client)) return;
  INSTALLED.add(client);

  client.on(Events.MessageCreate, (message) => {
    handleMessage(message).catch((error) => console.error('[KingdomPresence] message handler failed:', error));
  });

  client.once(Events.ClientReady, (readyClient) => {
    const active = [];
    for (const guild of readyClient.guilds.cache.values()) {
      for (const channel of guild.channels.cache.values()) {
        const profile = resolveProfile(channel);
        if (profile) active.push(`${guild.name}/#${channel.name}=${profile.key}`);
      }
    }
    console.log(`[KingdomPresence] live${active.length ? `: ${active.join(', ')}` : ' (no matching channels found)'}.`);
  });
}
