import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  WebhookClient
} from 'discord.js';
import { BRAND } from '../config/blueprint.js';
import { readGuildState, writeGuildState } from '../storage/store.js';

const DOCS = [
  ['Live ORBAT', '📊', 'CARRIER_ORBAT_URL'],
  ['Governance', '🛡️', 'CARRIER_GOVERNANCE_URL'],
  ['Recruitment SOP', '🎓', 'CARRIER_RECRUITMENT_SOP_URL'],
  ['Management SOP', '⚖️', 'CARRIER_MANAGEMENT_SOP_URL'],
  ['Forms', '📝', 'CARRIER_FORMS_URL'],
  ['Control Sheet', '📈', 'CARRIER_CONTROL_SHEET_URL']
];

function branded(title, color = BRAND.color) {
  return new EmbedBuilder().setColor(color).setTitle(title).setFooter({ text: BRAND.footer }).setTimestamp();
}

async function ensureWebhook(channel, state, key, name, guild) {
  state.setup.webhooks ??= {};
  const saved = state.setup.webhooks[key];
  if (saved?.id && saved?.token) {
    const client = new WebhookClient({ id: saved.id, token: saved.token });
    try {
      await client.send({ content: '', allowedMentions: { parse: [] } }).catch(() => null);
      return saved;
    } finally {
      client.destroy();
    }
  }

  const hooks = await channel.fetchWebhooks().catch(() => null);
  let hook = hooks?.find((item) => item.name === name && item.token);
  if (!hook) {
    hook = await channel.createWebhook({
      name,
      avatar: guild.client.user.displayAvatarURL(),
      reason: 'Kingdom Core /setup3 carrier department'
    });
  }
  const record = { id: hook.id, token: hook.token, channelId: channel.id, name };
  state.setup.webhooks[key] = record;
  return record;
}

async function upsertWebhookPanel(channel, state, key, webhookKey, name, payload, guild) {
  state.setup.webhookPanels ??= {};
  const hook = await ensureWebhook(channel, state, webhookKey, name, guild);
  const client = new WebhookClient({ id: hook.id, token: hook.token });
  let message = null;
  try {
    const oldId = state.setup.webhookPanels[key];
    if (oldId) {
      message = await client.editMessage(oldId, {
        ...payload,
        username: name,
        avatarURL: guild.client.user.displayAvatarURL(),
        allowedMentions: { parse: [] }
      }).catch(() => null);
    }
    if (!message) {
      message = await client.send({
        ...payload,
        username: name,
        avatarURL: guild.client.user.displayAvatarURL(),
        allowedMentions: { parse: [] }
      });
      state.setup.webhookPanels[key] = message.id;
    }
  } finally {
    client.destroy();
  }
  const fetched = await channel.messages.fetch(message.id).catch(() => null);
  if (fetched && !fetched.pinned) await fetched.pin('Kingdom Core carrier department panel').catch(() => null);
  return message;
}

function linkButton(label, emoji, env) {
  const url = process.env[env]?.trim();
  if (url) return new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(label).setEmoji(emoji).setURL(url);
  return new ButtonBuilder().setStyle(ButtonStyle.Secondary).setLabel(`${label} • Not Set`).setEmoji(emoji).setCustomId(`kc3:doc:missing:${env}`).setDisabled(true);
}

function libraryPayload() {
  const embed = branded('📚 Carrier Department Library')
    .setDescription([
      'The central documentation hub for the **Kingdom Carries Carrier Department**.',
      '',
      '**⚔️ Core Documents**',
      '• Carrier Department ORBAT',
      '• Governance & Authority',
      '• Recruitment, Training & Probation SOP',
      '• Management, Discipline & Appeals SOP',
      '• Forms & Operational Templates',
      '• Carrier Department Control Sheet',
      '',
      '**⏱️ Verified Service Time**',
      'Ready checks do **not** start service time. The assigned Knight starts the carry only after the party is assembled and ready.',
      'Grouped carries count the actual run once while member-level completion stats record every member carried.'
    ].join('\n'));
  const rows = [
    new ActionRowBuilder().addComponents(...DOCS.slice(0, 5).map(([label, emoji, env]) => linkButton(label, emoji, env))),
    new ActionRowBuilder().addComponents(linkButton(...DOCS[5]))
  ];
  return { embeds: [embed], components: rows };
}

function trialsPayload() {
  return {
    embeds: [branded('🛡️ Squire Trials • Carrier Probation', 0x5865f2)
      .setDescription([
        '**Trial carriers are supervised before receiving full Knight status.**',
        '',
        '1. A Squire asks a verified Knight or senior carrier to supervise.',
        '2. Complete **5 successful supervised carries**.',
        '3. The supervisor records reliability, communication, pace and rule compliance.',
        '4. Staff issue a **Pass / Extend / Fail** decision.',
        '',
        '> Never sacrifice member safety or server rules just to complete a trial faster.'
      ].join('\n'))
      .addFields(
        { name: 'Ready Check', value: 'The party must be assembled before a run starts.', inline: true },
        { name: 'Grouping', value: 'Compatible requests can be merged into one party.', inline: true },
        { name: 'Evidence', value: 'Use logs/control sheets where required.', inline: true }
      )]
  };
}

function announcementsPayload() {
  return {
    embeds: [branded('⚔️ Knight Command • Carrier Information')
      .setDescription([
        '**Carrier workflow:** Request → Group → Claim → Ready Check → Carry → Complete',
        '',
        '• Carries are free.',
        '• Use the live queue before opening duplicate missions.',
        '• Merge matching requests whenever practical.',
        '• Ready-check every grouped party.',
        '• Use the private carry ticket for coordination.',
        '• Complete the mission only after the run has actually finished.'
      ].join('\n'))]
  };
}

function assignmentsPayload() {
  return {
    embeds: [branded('📋 Mission Dispatch • Active Carry Operations', 0x57f287)
      .setDescription([
        'The **live queue and carry-control board** are the source of truth for active missions.',
        '',
        '🟡 **Open** — waiting for a Knight',
        '🛡️ **Claimed** — Knight assigned',
        '✅ **Ready Check** — party assembling',
        '⚔️ **Running** — carry in progress',
        '🏆 **Complete** — run logged',
        '',
        '> Members may join compatible active parties before the run starts.'
      ].join('\n'))]
  };
}

export async function installCarrierDepartmentV3(guild) {
  await guild.channels.fetch();
  const state = await readGuildState(guild.id);
  const ch = (key) => guild.channels.cache.get(state.setup?.channels?.[key]);
  const announcements = ch('carrierAnnouncements');
  const trials = ch('carrierTrials');
  const guides = ch('carrierGuides');
  const assignments = ch('carrierAssignments');
  const required = [announcements, trials, guides, assignments];
  if (required.some((channel) => !channel?.isTextBased())) {
    throw new Error('Carrier Department channels are missing. Run /setup before /setup3.');
  }

  await upsertWebhookPanel(announcements, state, 'carrierInfoV3', 'carrierInfoV3', '⚔️ Knight Command', announcementsPayload(), guild);
  await upsertWebhookPanel(trials, state, 'carrierTrialsV3', 'carrierTrialsV3', '🛡️ Trial Command', trialsPayload(), guild);
  await upsertWebhookPanel(guides, state, 'carrierLibraryV3', 'carrierLibraryV3', '📚 Carrier Library', libraryPayload(), guild);
  await upsertWebhookPanel(assignments, state, 'carrierAssignmentsV3', 'carrierAssignmentsV3', '📋 Mission Dispatch', assignmentsPayload(), guild);

  await writeGuildState(guild.id, state);
  return { panels: 4, documents: DOCS.length };
}
