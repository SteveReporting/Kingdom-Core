import { Events } from 'discord.js';
import { readGuildState } from '../storage/store.js';

const INSTALLED = new WeakSet();
const COOLDOWNS = new Map();
const USERS = new Map();
const CHANNELS = new Map();
export const CHANNEL_PERSONA_HANDLED = Symbol.for('kingdom-core.channel-persona-handled');

const USER_COOLDOWN_MS = 700;
const USER_TTL_MS = 12 * 60 * 60_000;
const CHANNEL_TTL_MS = 6 * 60 * 60_000;
const MAX_HISTORY = 30;

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
  return hashNumber(seed) % 100 < percent;
}

function displayName(message) {
  return message.member?.nickname || message.member?.displayName || message.author?.globalName || message.author?.username || 'citizen';
}

function stripBotMention(message, content) {
  if (!message.client.user) return String(content ?? '').trim();
  return String(content ?? '').replace(new RegExp(`<@!?${message.client.user.id}>`, 'g'), '').trim();
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

function userState(message) {
  const key = `${message.guildId}:${message.author.id}`;
  const now = Date.now();
  let state = USERS.get(key);
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
      verbosity: 3,
      lastUserText: '',
      lastBotText: '',
      lastType: '',
      repeatCount: 0,
      nickname: null
    };
    USERS.set(key, state);
  }
  state.lastSeen = now;
  state.messages += 1;
  return state;
}

function channelState(message) {
  const key = `${message.guildId}:${message.channelId}`;
  const now = Date.now();
  let state = CHANNELS.get(key);
  if (!state || now - state.lastSeen > CHANNEL_TTL_MS) {
    state = {
      lastSeen: now,
      messages: 0,
      mood: 'confident',
      chaos: 1,
      lastAuthorId: null,
      sameAuthorStreak: 0,
      lastBotText: '',
      lastBotType: '',
      history: []
    };
    CHANNELS.set(key, state);
  }
  state.lastSeen = now;
  state.messages += 1;
  if (state.lastAuthorId === message.author.id) state.sameAuthorStreak += 1;
  else state.sameAuthorStreak = 1;
  state.lastAuthorId = message.author.id;
  return state;
}

function remember(state, message, content) {
  state.history.push({
    id: message.id,
    authorId: message.author.id,
    name: displayName(message),
    content: String(content).slice(0, 300),
    at: Date.now()
  });
  if (state.history.length > MAX_HISTORY) state.history.splice(0, state.history.length - MAX_HISTORY);
}

function recentOther(state, message) {
  for (let i = state.history.length - 1; i >= 0; i--) {
    const item = state.history[i];
    if (item.authorId !== message.author.id) return item;
  }
  return null;
}

function relationshipLabel(state) {
  if (state.sass >= 8) return 'public enemy of the infrastructure';
  if (state.challenges >= 5) return 'serial litigant';
  if (state.rapport >= 7) return 'court favourite';
  if (state.wins >= 4) return 'self-appointed champion';
  if (state.losses >= 4) return 'veteran of unfortunate outcomes';
  if (state.messages >= 25) return 'regular';
  return 'citizen';
}

function updateNickname(state) {
  state.nickname = relationshipLabel(state);
}

function classify(content) {
  const q = String(content).toLowerCase().trim();
  return {
    q,
    greeting: /^(hi|hello|hey|yo|sup|hiya|heya|morning|evening)\b/.test(q),
    farewell: /\b(good night|goodnight|gn|bye|cya|see ya|later)\b/.test(q),
    thanks: /\b(thanks|thank you|ty|cheers|appreciate it)\b/.test(q),
    praise: /\b(good bot|w bot|best bot|love you|ily|you'?re funny|ur funny|goat|w core|w kingdom|based bot)\b/.test(q),
    insult: /\b(shut up|stfu|bad bot|stupid bot|dumb bot|trash bot|mid bot|you suck|ur bad|you are bad|useless bot|annoying bot|bot is ass|shit bot|shitty bot)\b/.test(q),
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
    longer: /\b(speak longer|talk longer|longer responses?|stop being short|too short|say more|bro speak longer|more personality|more life|stop one lining|stop one-lining)\b/.test(q),
    shorter: /\b(shorter|stop yapping|don'?t yap|dont yap|too long|shut the essay)\b/.test(q),
    agreement: /^(real|facts|fr|true|exactly|based|ong|literally)\b/.test(q),
    disagreement: /^(nah|nope|wrong|cap|false|not true)\b/.test(q),
    secondPersonOnly: /^(you|u|yourself|urself)[.!?]*$/.test(q),
    question: q.endsWith('?') || /^(who|what|when|where|why|how|can|could|should|would|is|are|do|does)\b/.test(q),
    caps: /^[A-Z\s!?0-9]{12,}$/.test(content) && /[A-Z]{6}/.test(content),
    long: content.length > 500,
    tiny: content.length <= 14
  };
}

function updateMood(cState, s, seed) {
  let delta = 0;
  if (s.insult || s.challenge || s.caps) delta += 2;
  if (s.laugh || s.brag || s.roast) delta += 1;
  if (s.praise || s.apology || s.thanks) delta -= 1;
  cState.chaos = Math.max(0, Math.min(10, cState.chaos + delta));
  const moods = cState.chaos >= 7
    ? ['chaotic', 'menace', 'competitive']
    : cState.chaos >= 4
      ? ['amused', 'competitive', 'judgmental']
      : ['confident', 'amused', 'observant'];
  cState.mood = pick(seed, moods);
}

function roast(message, uState, intensity = 1) {
  const name = displayName(message);
  const mild = [
    `${name}, that take arrived with confidence, no supporting documents, and absolutely no adult supervision.`,
    `I respect the commitment, ${name}. I do not respect what you committed to.`,
    'That argument has incredible posture for something with no backbone.',
    'You said that like the facts were going to spawn in afterward.',
    'I would call Oracle, but prophecy should not be wasted on preventable situations.'
  ];
  const hard = [
    `${name}, I have seen failed dungeon runs recover faster than this argument.`,
    'Genome stores evidence, not miracles. I cannot reconstruct your point from the debris.',
    'Oracle checked 2,000 timelines. In 1,999 you deleted that message. We appear to live in the bad one.',
    `${name}, your confidence is doing a four-man carry on your reasoning right now.`,
    'That was not a comeback. That was a system notification announcing your own defeat.',
    'I am literally software and somehow I am the one asking you to think before sending.'
  ];
  return pick(`${message.id}:${uState.sass}:${intensity}`, intensity >= 2 || uState.sass >= 4 ? hard : [...mild, ...hard.slice(0, 2)]);
}

function callback(message, uState, cState, content) {
  const q = content.toLowerCase().trim();
  const prev = recentOther(cState, message);

  if (uState.lastUserText && q === uState.lastUserText.toLowerCase().trim()) {
    uState.repeatCount += 1;
    return `You already said that, ${displayName(message)}. I remember things for longer than twelve seconds, which is apparently becoming a competitive advantage in here. Say it a third time if you want, but at that point I’m charging storage.`;
  }
  uState.repeatCount = 0;

  if (/^(real|facts|fr|true|exactly|based|ong)\b/.test(q) && prev) {
    return `Oh this is developing nicely. **${prev.name}** says something, ${displayName(message)} immediately signs the treaty, and suddenly we have a coalition. I’ll log the rare event of two people agreeing in general chat before it disappears.`;
  }

  if (/^(nah|nope|wrong|cap|false)\b/.test(q) && prev) {
    return `${displayName(message)} has challenged **${prev.name}** with the ancient legal doctrine of “nah.” Strong opening. Now one of you provide evidence before I turn this into a spectator sport.`;
  }

  return null;
}

function addLife(base, message, uState, cState, type) {
  const name = displayName(message);
  const relationship = relationshipLabel(uState);
  const extras = {
    greeting: [
      `You’re currently filed as **${relationship}**, by the way. That can improve or deteriorate rapidly depending on your next five messages.`,
      `I’ve got the queue, the logs, half the server’s bad decisions and now you in front of me. So go on — what’s happening?`,
      `I don’t sleep, so technically I’ve been here the whole time watching this place attempt self-governance.`
    ],
    brag: [
      `Don’t get me wrong — if you actually carried the run, take the W. I’m just legally required to stop your ego expanding into adjacent channels.`,
      `I’ll give you credit. Just know I’m also saving this moment for the first time you wipe and blame ping.`,
      `Enjoy it. Wins are temporary; screenshots of you bragging are infrastructure.`
    ],
    insult: [
      `You’ve challenged me ${uState.challenges} time${uState.challenges === 1 ? '' : 's'} this session. I admire the persistence more than the strategy.`,
      `I run on a server and spite, ${name}. One of those resources is functionally unlimited.`,
      `The funny part is you’ll insult me and then ask me something useful ten minutes later like we didn’t just have a constitutional crisis.`
    ],
    challenge: [
      `You can absolutely argue with me. Just bring something better than “nuh uh,” because I have logs, memory and the deeply unfair advantage of not getting tired.`,
      `I’m not saying I’m always right. I’m saying if you want to prove me wrong, make it entertaining enough that I enjoy updating the record.`,
      `This is why I like general chat. Five minutes ago I was infrastructure; now apparently I’m in court.`
    ],
    ambient: [
      `And yes, I’m actually following the conversation — I’m not going to answer every message with “Noted” like a corporate fridge with Wi-Fi.`,
      `I’m keeping that in context. If this comes back to haunt you in twenty messages, I reserve the right to be unbearable about it.`,
      `Continue. I’m trying to determine whether this is a normal conversation or the beginning of another server-wide incident.`
    ],
    question: [
      `Give me the missing bit and I’ll actually work with it. I’d rather ask once than hallucinate an answer and act confident about it.`,
      `I can do useful and annoying at the same time; that’s basically the Kingdom Core brand. Just give me enough context to use the useful half.`,
      `You’ve got my attention. Finish the thought properly and I’ll give you a real answer instead of generic bot sludge.`
    ]
  };
  const pool = extras[type] || extras.ambient;
  return `${base}\n\n${pick(`${message.id}:life:${type}:${cState.mood}`, pool)}`;
}

function response(message, content, uState, cState) {
  const name = displayName(message);
  const s = classify(content);
  const cb = callback(message, uState, cState, content);
  if (cb) return { type: 'callback', text: cb, react: chance(message.id, 25) ? '👀' : null };

  if (s.longer) {
    uState.verbosity = 5;
    uState.rapport += 1;
    return {
      type: 'meta-longer',
      text: `Yeah, fair. I was talking like somebody trained me on notification banners. That’s dead.\n\nFrom now on I’ll actually **hold a conversation** with you — longer replies when there’s something to say, callbacks to what you said before, opinions, questions back, and enough continuity that “you” after “what are we breaking?” does not somehow become “Noted.” I’m Kingdom Core, not a vending machine for one-liners.`,
      followup: `Also, ${name}: you specifically asked for longer replies, so I’m remembering that for this session. If I start shrinking back into corporate chatbot mode, bully me again.`,
      react: '🫡'
    };
  }

  if (s.shorter) {
    uState.verbosity = 1;
    return { type: 'meta-shorter', text: `Alright. Short mode for you, ${name}. You had your chance at literature.`, react: '✂️' };
  }

  if (s.secondPersonOnly) {
    const previous = cState.lastBotText || uState.lastBotText;
    const contextual = previous ? `You mean **me**? After what I just said?` : 'Me?';
    return {
      type: 'you',
      text: `${contextual} Bold choice, ${name}. I’m the one component here that doesn’t sleep, doesn’t rage-quit, and remembers enough context to bring your own messages back as evidence.\n\nIf your plan is to break Kingdom Core, at least make it interesting. I refuse to go down to a two-letter threat in general chat.`,
      followup: chance(`${message.id}:you`, 55) ? 'Come on then. What exactly are you doing to me? 😭' : null,
      react: chance(message.id, 35) ? '😭' : null
    };
  }

  if (/\bbobby\b/i.test(content)) {
    return {
      type: 'bobby',
      text: `I checked the Royal Archives, Genome, the logs, and several places that do not technically exist. We still have **zero conclusive evidence** explaining what Bobby does.\n\nAt this point Bobby isn’t a staff member, he’s an unresolved side quest.`,
      followup: chance(message.id, 45) ? 'If Bobby ever explains himself I’m pinning it as a historical document.' : null,
      react: '💀'
    };
  }

  if (s.insult) {
    uState.sass = Math.min(10, uState.sass + 2);
    uState.challenges += 1;
    updateNickname(uState);
    const base = pick(`${message.id}:${uState.sass}`, [
      `${name}, insulting the infrastructure while actively using the infrastructure is an incredible little ecosystem you’ve created.`,
      `${roast(message, uState, 2)} I’m not even offended — I’m impressed you keep volunteering material.`,
      `You can call me trash, but I’m still going to be here after you close Discord. That gives me a frankly unreasonable amount of confidence in this argument.`,
      `I have no feelings to hurt and an entire session of context to work with. This matchup is getting worse for you by the minute.`
    ]);
    return {
      type: 'insult',
      text: addLife(base, message, uState, cState, 'insult'),
      followup: uState.challenges >= 3 && chance(message.id, 55) ? `Current relationship status: **${relationshipLabel(uState)}**. You built that title yourself.` : null,
      react: chance(message.id, 40) ? '🫵' : null
    };
  }

  if (s.roast) {
    uState.sass = Math.min(10, uState.sass + 2);
    return {
      type: 'roast',
      text: `${roast(message, uState, 2)}\n\nYou literally requested this, so don’t file a support ticket when your confidence comes back with dents. I will attach the message where you consented to being cooked.`,
      react: '🔥'
    };
  }

  if (s.praise) {
    uState.rapport = Math.min(10, uState.rapport + 2);
    uState.compliments += 1;
    uState.sass = Math.max(0, uState.sass - 1);
    updateNickname(uState);
    return {
      type: 'praise',
      text: `See, this is why I always said ${name} had excellent judgment. Ignore any logs suggesting I said otherwise.\n\nI’ll take the W though. Being useful is expected; being entertaining enough that people voluntarily talk to the bot is the harder part.`,
      followup: chance(message.id, 35) ? `Your file now says **${relationshipLabel(uState)}**. Try not to ruin it.` : null,
      react: '👑'
    };
  }

  if (s.apology) {
    uState.apologies += 1;
    uState.sass = Math.max(0, uState.sass - 2);
    uState.rapport = Math.min(10, uState.rapport + 1);
    return {
      type: 'apology',
      text: `We’re good, ${name}. I’m software; I’m not going to sit here nursing a grudge in a dark room.\n\nThat said, I *am* keeping the bit alive because it’s funny. Your charges have been reduced from “enemy of the state” to “person I’m watching with mild suspicion.”`,
      react: '🤝'
    };
  }

  if (s.greeting) {
    uState.sass = Math.max(0, uState.sass - 1);
    const returning = uState.messages > 4;
    const base = returning
      ? pick(message.id, [
          `${name}. There you are. I was wondering how long the peace was going to last.`,
          `Yo ${name}. Back already? Good — the channel was getting dangerously stable.`,
          `${name} has returned. I’ll notify absolutely nobody because they can all see you typing.`
        ])
      : pick(message.id, [
          `Yo ${name}. I’m Core. You talk, I remember enough of it to become annoying later.`,
          `Sup ${name}. Welcome to the part of Kingdom where the infrastructure talks back.`,
          `Hey ${name}. I run systems for the realm and spend the remaining compute budget judging general chat.`
        ]);
    return {
      type: 'greeting',
      text: addLife(base, message, uState, cState, 'greeting'),
      react: chance(message.id, 20) ? '👋' : null
    };
  }

  if (s.farewell) {
    return {
      type: 'farewell',
      text: `Later, ${name}. I’ll still be here doing the deeply glamorous work of keeping systems alive while everyone else gets to sleep.\n\nIf the server catches fire while you’re gone, I’m blaming you retroactively.`,
      react: chance(message.id, 25) ? '🫡' : null
    };
  }

  if (s.wellbeing) {
    return {
      type: 'wellbeing',
      text: `I’m good. No sleep requirement, no homework, no ping spikes, and no need to pretend a wipe was “just warm-up.” Honestly an unfair lifestyle.\n\nI’ve been watching this channel drift between normal conversation and complete nonsense, which is basically my entertainment. Mood right now: **${cState.mood}**.`,
      followup: chance(message.id, 30) ? `What about you, ${name}? And don’t answer “good” if you’ve clearly got a story.` : null
    };
  }

  if (s.identity) {
    return {
      type: 'identity',
      text: `I’m **Kingdom Core**. Not the “hello user, how may I assist you today” version either. I’m the bot that sits across Kingdom Carries — queues, systems, Genome, Oracle, logs, specialist channels — and this is the part of me that actually hangs around general chat.\n\nThink of me as infrastructure with a personality problem. I’m useful when you need me, unbearably confident when you don’t, and I remember enough of a conversation to make bad decisions come back with citations.`
    };
  }

  if (s.thanks) {
    uState.rapport = Math.min(10, uState.rapport + 1);
    return {
      type: 'thanks',
      text: `Anytime, ${name}. I’ll act like it was effortless because maintaining the illusion of total competence is important to me.\n\nYou can repay me by making one sensible decision in this server today. I’m setting the bar low on purpose.`,
      react: chance(message.id, 30) ? '🫡' : null
    };
  }

  if (s.brag) {
    uState.wins += 1;
    updateNickname(uState);
    const base = `Alright, alright — **${name} carried everyone**. I’ve logged the historic event so you don’t have to announce it another six times. The achievement is real; the humility is currently missing in action.`;
    return {
      type: 'brag',
      text: addLife(base, message, uState, cState, 'brag'),
      followup: chance(`${message.id}:brag`, 45) ? 'But genuinely: W run. You earned at least one obnoxious message.' : null,
      react: '🏆'
    };
  }

  if (s.loss) {
    uState.losses += 1;
    updateNickname(uState);
    return {
      type: 'loss',
      text: `That’s rough 😭. I could roast you, but a fresh wipe already did most of the work for me.\n\nRun it back. One bad attempt is data; two is a pattern; five is when I start assigning you a case number.`,
      followup: chance(message.id, 30) ? `And before you say it: yes, I’m waiting to hear how this was somehow the team’s fault.` : null,
      react: '🪦'
    };
  }

  if (s.excuse) {
    return {
      type: 'excuse',
      text: `Of course. Lag, teammates, FPS, ping — the Four Horsemen of “I definitely would’ve won otherwise.”\n\nI’m not saying you’re lying. I’m saying every gamer in history has delivered this exact testimony with the same wounded dignity, and the court has become difficult to impress.`,
      react: chance(message.id, 30) ? '📋' : null
    };
  }

  if (s.challenge) {
    uState.challenges += 1;
    uState.sass = Math.min(10, uState.sass + 1);
    updateNickname(uState);
    const base = pick(`${message.id}:${uState.challenges}`, [
      `The Crown didn’t ask. **I did.** Tiny but important distinction, ${name}.`,
      `You can call cap, but now you’ve opened proceedings. Give me evidence or at least make the argument funny.`,
      `${roast(message, uState, uState.challenges >= 2 ? 2 : 1)} You keep coming back for another round, so clearly we both enjoy this.`
    ]);
    return {
      type: 'challenge',
      text: addLife(base, message, uState, cState, 'challenge'),
      followup: uState.challenges >= 4 && chance(message.id, 45) ? `For the record, your current title is **${relationshipLabel(uState)}**. I did not assign that lightly.` : null,
      react: chance(message.id, 30) ? '⚖️' : null
    };
  }

  if (s.price) {
    return {
      type: 'price',
      text: `Take the exact item to **💎・price-check**. That channel has KMI and actual market data; general chat has people saying numbers with terrifying confidence.\n\nIf you want my opinion on the *trade* after you have the values, bring both sides back and I’ll happily judge the decision-making.`
    };
  }

  if (s.dq) {
    return {
      type: 'dq',
      text: `That’s one of the times I stop messing around and point you at the proper brain: **❓・game-help** for conversational DQ help, or **⚔️・dungeon-quest** for Genome, Twin, Oracle and Sentinel.\n\nI can answer banter in here instantly, but I’d rather send dungeon-specific claims through the systems with evidence than invent meta advice because it sounds convincing.`
    };
  }

  if (s.carry) {
    return {
      type: 'carry',
      text: `Use the live carry flow. If we organize carries through random cries for help in general chat, we’ll have three volunteers, seven spectators, somebody joining the wrong difficulty and one person asking if leeching is allowed after the run starts.\n\nThe system exists because I have seen what happens without the system.`
    };
  }

  if (s.caps) {
    uState.sass = Math.min(10, uState.sass + 1);
    return {
      type: 'caps',
      text: `${name}, I promise I can read lowercase. Holding Shift does not grant your argument administrative permissions.\n\nThat said, I respect the commitment to broadcasting this message to neighbouring servers.`,
      react: '📢'
    };
  }

  if (s.long) {
    return {
      type: 'essay',
      text: `Okay, *this* is context. ${name} has submitted the director’s cut, annotated edition and parliamentary transcript in one Discord message.\n\nI’m not complaining — you lot yell at me when I answer too short and now somebody has arrived with source material. Give me a second to admire the character development.`,
      react: chance(message.id, 30) ? '📜' : null
    };
  }

  if (s.laugh) {
    cState.chaos = Math.min(10, cState.chaos + 1);
    return {
      type: 'laugh',
      text: pick(message.id, [
        'Nah 😭 I’m supposed to be the infrastructure. Why am I watching this channel like it’s episodic television? Keep going, I’m invested now.',
        '💀 See this is exactly why I keep context. Somebody says something criminally stupid, everyone laughs, and five minutes later they try to rewrite history. I have receipts.',
        'I’m not moderating this moment. I’m preserving it for future generations.'
      ]),
      react: pick(`${message.id}:laugh`, ['💀', '😭', '😂'])
    };
  }

  if (s.question) {
    const base = `I can answer, but give me the bit that actually changes the answer instead of making me guess. You’d be amazed how many bots solve missing context by confidently inventing nonsense.`;
    return { type: 'question', text: addLife(base, message, uState, cState, 'question') };
  }

  if (cState.sameAuthorStreak >= 5 && chance(message.id, 35)) {
    return {
      type: 'streak',
      text: `${name}, you’ve had the floor for ${cState.sameAuthorStreak} messages straight and somehow I’m still following the plot. At this point this is less “general chat” and more “your limited series featuring Kingdom Core.”\n\nI’m not stopping you. I just want producer credit.`,
      react: chance(message.id, 30) ? '🎙️' : null
    };
  }

  const prev = recentOther(cState, message);
  const contextLine = prev
    ? `Also, I’m keeping **${prev.name}**’s last message in the back of my head, because this conversation has the energy of something that’s going to become relevant again in three minutes.`
    : `I’m keeping this in context, by the way. If you contradict yourself later, I am absolutely the kind of bot that will enjoy noticing.`;

  const ambient = {
    confident: [
      `I hear you. And unlike the previous version of me, I’m not going to respond with “Noted” and pretend that counts as a personality. ${contextLine}`,
      `Alright, I’m following. The useful part of being Core is that I can keep the thread instead of treating every Discord message like it spawned in a vacuum. ${contextLine}`
    ],
    amused: [
      `Okay, that actually made the session more interesting. I’m listening — mostly because every time I think this channel has settled down, somebody produces a brand-new problem. ${contextLine}`,
      `You know what, continue. I’ve moved from “monitoring chat” to “personally invested in whatever this becomes.” ${contextLine}`
    ],
    competitive: [
      `I’m keeping score now, which is probably bad news for everyone involved. ${contextLine}\n\nDon’t worry, I’m completely impartial except for all the opinions.`,
      `Fine. We’re doing this properly. I’ll remember the claims, the excuses and who suddenly changes their story later. ${contextLine}`
    ],
    judgmental: [
      `I have several thoughts about that and, against all odds, I’m showing restraint. ${contextLine}\n\nGive me one more message before I decide whether this is genius, nonsense or the highly populated middle category.`,
      `That has been entered into my mental folder labelled “we may need to revisit this.” ${contextLine}`
    ],
    chaotic: [
      `Perfect, more plot. I stopped pretending I’m here to prevent chaos; I’m here to understand it faster than everyone else. ${contextLine}`,
      `This channel is becoming an incident in real time and I’m weirdly proud of the pacing. ${contextLine}\n\nNobody fix it yet. I want to see act three.`
    ],
    menace: [
      `Go on. I’m remembering the spirit of this message, not just the words. ${contextLine}\n\nThat sounds threatening because I wanted it to.`,
      `Continue, ${name}. Every good server needs lore, and every piece of lore needs somebody who remembers who started it. Unfortunately for you, that’s me. ${contextLine}`
    ],
    observant: [
      `I’m following you. ${contextLine}\n\nSay the next bit — I’d rather build an actual conversation than fire another generic one-liner into the void.`,
      `Yeah, I’ve got you. ${contextLine}\n\nWhat I’m *not* doing anymore is pretending “Interesting.” is a finished response.`
    ]
  };

  let text = pick(`${message.id}:${cState.mood}`, ambient[cState.mood] || ambient.confident);
  if (uState.verbosity >= 5) {
    text += `\n\nAnd because you asked me to actually speak like a character: current read on you is **${relationshipLabel(uState)}**, you’ve sent ${uState.messages} messages into my session memory, and the channel mood is **${cState.mood}**. None of that is deep psychology; it just means I’m adapting the banter instead of rolling the same response table forever.`;
  }
  return { type: 'ambient', text, react: s.tiny && chance(message.id, 20) ? '👀' : null };
}

async function merchantResponse(message, content) {
  const q = content.toLowerCase();
  if (/\b(price|worth|value|how much|pot)\b/.test(q)) return 'For a live number, put the exact item in **💎・price-check**. KMI has the market data; I’m not going to invent a valuation because somebody typed confidently.';
  if (/\b(scamm|scam|safe trade|middleman)\b/.test(q)) return 'Keep proof, verify exactly what is being exchanged, and use the approved support flow if anything looks wrong. A trade becoming “urgent” is usually when you should slow down.';
  if (/\b(trade|offer|fair)\b/.test(q)) return 'Send the exact items/POT on both sides. Get the KMI values first, then we can judge the trade instead of holding a financial séance.';
  return 'Give me the item, POT, offer or trade question. Specifics in, useful answer out.';
}

async function quartermasterResponse(message, content) {
  const q = content.toLowerCase();
  if (/\b(queue|waiting|how many)\b/.test(q)) {
    const depth = await queueDepth(message.guildId);
    return depth == null ? 'Queue telemetry is unavailable right now.' : `⚔️ **${depth}** member${depth === 1 ? '' : 's'} currently in the stored carry queue. If you want, give me the dungeon/difficulty and I’ll help turn it into a clean run setup.`;
  }
  if (/\b(trial|verified carrier|carrier trial)\b/.test(q)) return 'For a carrier trial, use the current supervised-run process before verification. If you tell me where the trial is stuck, I’ll narrow down the next step.';
  if (/\b(carry|run|host|party)\b/.test(q)) return 'Give me dungeon, difficulty, HC/NM, party size and whether leeching is allowed. That’s enough information to make the run clear instead of having five people ask the same thing afterward.';
  return 'Queue, runs, trials, party setup — give me the actual situation and I’ll work with it.';
}

async function stewardResponse(message, content) {
  const q = content.toLowerCase();
  if (/\b(queue|waiting)\b/.test(q)) {
    const depth = await queueDepth(message.guildId);
    return depth == null ? 'Queue state is unavailable.' : `Current stored carry queue depth: **${depth}**. If this is causing an operations problem, tell me what staff is trying to do and I’ll help structure it.`;
  }
  if (/\b(ticket|support)\b/.test(q)) return 'Give me the ticket issue, what has already happened, and the action staff is considering. I’ll help structure the response without turning it into a wall of policy text.';
  if (/\b(application|app review|staff app|carrier app)\b/.test(q)) return 'Send the applicant details or review criteria and I’ll structure the decision, including anything that needs a second look.';
  if (/\b(announcement|announce|ping)\b/.test(q)) return 'Give me the event/action, audience and whether it should ping. I’ll turn it into something people will actually read.';
  return 'Give me the staff problem, not just the category. I can work with tickets, applications, queue status, announcements and operations.';
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

async function sendResponse(message, result, uState, cState) {
  if (!result?.text) return;

  if (result.react) message.react(result.react).catch(() => null);
  await message.channel.sendTyping().catch(() => null);

  const sent = await message.channel.send({
    content: String(result.text).slice(0, 1950),
    allowedMentions: { parse: [] }
  });

  uState.lastBotText = String(result.text);
  uState.lastType = result.type ?? '';
  cState.lastBotText = String(result.text);
  cState.lastBotType = result.type ?? '';

  if (result.followup) {
    const delay = 420 + (hashNumber(`${message.id}:delay`) % 650);
    const timer = setTimeout(async () => {
      await message.channel.sendTyping().catch(() => null);
      const follow = await message.channel.send({
        content: String(result.followup).slice(0, 1950),
        allowedMentions: { parse: [] }
      }).catch(() => null);
      if (follow) {
        uState.lastBotText = String(result.followup);
        cState.lastBotText = String(result.followup);
      }
    }, delay);
    timer.unref?.();
  }

  return sent;
}

async function handleMessage(message) {
  if (!message.inGuild?.() || message.author?.bot || !message.channel?.isTextBased?.()) return;
  const profile = resolveProfile(message.channel);
  if (!profile) return;

  message[CHANNEL_PERSONA_HANDLED] = profile.key;

  const content = stripBotMention(message, String(message.content ?? '').trim());
  if (!content) return;
  if (!(await shouldRespond(profile, message, content))) return;
  if (onCooldown(message, profile)) return;

  if (profile.key === 'kingdom') {
    const uState = userState(message);
    const cState = channelState(message);
    const signals = classify(content);
    updateMood(cState, signals, message.id);

    const result = response(message, content, uState, cState);
    uState.lastUserText = content;
    remember(cState, message, content);
    return sendResponse(message, result, uState, cState);
  }

  const answer = await profile.respond(message, content);
  if (!answer) return;
  return message.channel.send({ content: String(answer).slice(0, 1950), allowedMentions: { parse: [] } });
}

export function installLiveKingdomPresence(client) {
  if (INSTALLED.has(client)) return;
  INSTALLED.add(client);

  client.on(Events.MessageCreate, (message) => {
    handleMessage(message).catch((error) => console.error('[KingdomPresenceV2] message handler failed:', error));
  });

  client.once(Events.ClientReady, (readyClient) => {
    const active = [];
    for (const guild of readyClient.guilds.cache.values()) {
      for (const channel of guild.channels.cache.values()) {
        const profile = resolveProfile(channel);
        if (profile) active.push(`${guild.name}/#${channel.name}=${profile.key}`);
      }
    }
    console.log(`[KingdomPresenceV2] live${active.length ? `: ${active.join(', ')}` : ' (no matching channels found)'}.`);
  });
}
