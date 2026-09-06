import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';
import { BRAND, STAFF_KEYS } from '../config/blueprint.js';
import { mutateGuildState, readGuildState } from '../storage/store.js';
import { sendBrandedWebhook } from './webhooks.js';

const FORM_CONFIG = {
  staff: {
    label: 'Staff Application', emoji: '🛡️', env: 'STAFF_APPLICATION_URL', responseEnv: 'STAFF_APPLICATION_RESPONSES_URL'
  },
  carrier: {
    label: 'Carrier Application', emoji: '⚔️', env: 'CARRIER_APPLICATION_URL', responseEnv: 'CARRIER_APPLICATION_RESPONSES_URL'
  },
  creator: {
    label: 'Creator Application', emoji: '🎥', env: 'CREATOR_APPLICATION_URL', responseEnv: 'CREATOR_APPLICATION_RESPONSES_URL'
  }
};

const GRADES = ['S', 'A', 'B', 'C', 'D', 'F'];
const DECISIONS = ['Pending', 'Interview', 'Accepted', 'Denied'];

function branded(title, color = BRAND.color) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setFooter({ text: BRAND.footer })
    .setTimestamp();
}

function isStaff(member, state) {
  if (member?.permissions?.has?.(PermissionFlagsBits.Administrator)) return true;
  return STAFF_KEYS.some((key) => {
    const id = state.setup?.roles?.[key];
    return id && member?.roles?.cache?.has(id);
  });
}

function linkOrDisabled(label, emoji, url, fallbackId) {
  if (url) {
    return new ButtonBuilder().setLabel(label).setEmoji(emoji).setStyle(ButtonStyle.Link).setURL(url);
  }
  return new ButtonBuilder()
    .setCustomId(fallbackId)
    .setLabel(`${label} • Not Configured`)
    .setEmoji(emoji)
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(true);
}

export function applicationHubPayload() {
  const embed = branded('📨 Kingdom Applications • Apply to the Realm')
    .setDescription([
      '**Choose the path you want to apply for.**',
      'Applications open in Google Forms so answers are easier to complete, store and review.',
      '',
      '🛡️ **Royal Staff** — moderation, support, operations and community leadership.',
      '⚔️ **Knight / Carrier** — run free carries and progress through the carrier ranks.',
      '🎥 **Creator** — content, events, collaborations and partnerships.',
      '',
      '> Submit **one accurate application**. Duplicate or joke responses may be ignored.',
      '> Decisions are handled privately by the Royal Council.'
    ].join('\n'))
    .addFields(
      { name: '01 • Apply', value: 'Open the correct form below.', inline: true },
      { name: '02 • Review', value: 'Staff read and grade the response.', inline: true },
      { name: '03 • Decision', value: 'Interview, accept or deny.', inline: true }
    );

  const row = new ActionRowBuilder().addComponents(
    linkOrDisabled('Staff Form', '🛡️', process.env.STAFF_APPLICATION_URL, 'kc2:missing:staff'),
    linkOrDisabled('Carrier Form', '⚔️', process.env.CARRIER_APPLICATION_URL, 'kc2:missing:carrier'),
    linkOrDisabled('Creator Form', '🎥', process.env.CREATOR_APPLICATION_URL, 'kc2:missing:creator')
  );

  return { embeds: [embed], components: [row], allowedMentions: { parse: [] } };
}

export function applicationReviewDeskPayload() {
  const embed = branded('📋 Royal Application Control • Staff Desk', 0x5865f2)
    .setDescription([
      '**One place to read, grade and record every application.**',
      '',
      '1. Open the relevant **Google Forms responses** below.',
      '2. Read the applicant response in full.',
      '3. Press **Log Review** to record applicant, grade, decision and notes in Discord.',
      '4. The review is mirrored through the **Royal Registry** webhook for a clean audit trail.',
      '',
      '> Google Forms remains the source of the raw answers. Discord becomes the decision/audit layer.'
    ].join('\n'))
    .addFields(
      { name: 'Grades', value: '**S** Exceptional • **A** Strong • **B** Good • **C** Borderline • **D** Weak • **F** Reject' },
      { name: 'Decisions', value: 'Pending • Interview • Accepted • Denied' }
    );

  const responses = new ActionRowBuilder().addComponents(
    linkOrDisabled('Staff Responses', '🛡️', process.env.STAFF_APPLICATION_RESPONSES_URL, 'kc2:missing:staff-responses'),
    linkOrDisabled('Carrier Responses', '⚔️', process.env.CARRIER_APPLICATION_RESPONSES_URL, 'kc2:missing:carrier-responses'),
    linkOrDisabled('Creator Responses', '🎥', process.env.CREATOR_APPLICATION_RESPONSES_URL, 'kc2:missing:creator-responses')
  );

  const controls = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('kc2:apps:review').setLabel('Log Review').setEmoji('📝').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('kc2:apps:recent').setLabel('Recent Reviews').setEmoji('📚').setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [responses, controls], allowedMentions: { parse: [] } };
}

function reviewModal() {
  const type = new StringSelectMenuBuilder()
    .setCustomId('kc2:apps:type')
    .setPlaceholder('Select application type')
    .setRequired(true)
    .addOptions(Object.entries(FORM_CONFIG).map(([value, config]) => ({
      label: config.label,
      value,
      emoji: config.emoji
    })));

  const grade = new StringSelectMenuBuilder()
    .setCustomId('kc2:apps:grade')
    .setPlaceholder('Select grade')
    .setRequired(true)
    .addOptions(GRADES.map((value) => ({ label: `Grade ${value}`, value, emoji: value === 'S' ? '🏆' : value === 'F' ? '❌' : '📊' })));

  const decision = new StringSelectMenuBuilder()
    .setCustomId('kc2:apps:decision')
    .setPlaceholder('Select decision')
    .setRequired(true)
    .addOptions(DECISIONS.map((value) => ({
      label: value,
      value,
      emoji: value === 'Accepted' ? '✅' : value === 'Denied' ? '❌' : value === 'Interview' ? '💬' : '🟡'
    })));

  const applicant = new TextInputBuilder()
    .setCustomId('kc2:apps:applicant')
    .setPlaceholder('Discord username / ID or Roblox username')
    .setRequired(true)
    .setMaxLength(100)
    .setStyle(TextInputStyle.Short);

  const notes = new TextInputBuilder()
    .setCustomId('kc2:apps:notes')
    .setPlaceholder('Key reasons, concerns, strengths, interview notes, etc.')
    .setRequired(true)
    .setMaxLength(1200)
    .setStyle(TextInputStyle.Paragraph);

  return new ModalBuilder()
    .setCustomId('kc2:apps:review-submit')
    .setTitle('📋 Log Application Review')
    .addLabelComponents(
      new LabelBuilder().setLabel('Application Type').setStringSelectMenuComponent(type),
      new LabelBuilder().setLabel('Applicant').setTextInputComponent(applicant),
      new LabelBuilder().setLabel('Grade').setStringSelectMenuComponent(grade),
      new LabelBuilder().setLabel('Decision').setStringSelectMenuComponent(decision),
      new LabelBuilder().setLabel('Review Notes').setTextInputComponent(notes)
    );
}

export async function handleApplicationLinkButton(interaction) {
  const state = await readGuildState(interaction.guildId);
  if (!isStaff(interaction.member, state)) {
    return interaction.reply({ content: 'Only Kingdom staff can use the application review controls.', flags: MessageFlags.Ephemeral });
  }

  if (interaction.customId === 'kc2:apps:review') return interaction.showModal(reviewModal());

  if (interaction.customId === 'kc2:apps:recent') {
    const recent = [...(state.externalApplicationReviews ?? [])].slice(-10).reverse();
    const embed = branded('📚 Recent Application Reviews', 0x5865f2)
      .setDescription(recent.length
        ? recent.map((item, index) => [
          `**${index + 1}. ${item.applicant}** • ${FORM_CONFIG[item.type]?.label ?? item.type}`,
          `Grade **${item.grade}** • **${item.decision}** • by <@${item.reviewerId}>`
        ].join('\n')).join('\n\n')
        : '_No external-form reviews have been logged yet._');
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  }
}

export async function handleApplicationLinkModal(interaction) {
  if (interaction.customId !== 'kc2:apps:review-submit') return false;
  const initial = await readGuildState(interaction.guildId);
  if (!isStaff(interaction.member, initial)) {
    await interaction.reply({ content: 'Only Kingdom staff can log application reviews.', flags: MessageFlags.Ephemeral });
    return true;
  }

  const type = interaction.fields.getStringSelectValues('kc2:apps:type')[0];
  const grade = interaction.fields.getStringSelectValues('kc2:apps:grade')[0];
  const decision = interaction.fields.getStringSelectValues('kc2:apps:decision')[0];
  const applicant = interaction.fields.getTextInputValue('kc2:apps:applicant').trim();
  const notes = interaction.fields.getTextInputValue('kc2:apps:notes').trim();
  const id = `${Date.now().toString(36)}-${interaction.user.id.slice(-4)}`;

  const record = {
    id, type, grade, decision, applicant, notes,
    reviewerId: interaction.user.id,
    createdAt: new Date().toISOString()
  };

  await mutateGuildState(interaction.guildId, async (state) => {
    state.externalApplicationReviews ??= [];
    state.externalApplicationReviews.push(record);
    if (state.externalApplicationReviews.length > 500) state.externalApplicationReviews = state.externalApplicationReviews.slice(-500);
  });

  const state = await readGuildState(interaction.guildId);
  const reviewChannel = interaction.guild.channels.cache.get(state.setup?.channels?.applicationsReview);
  const meta = FORM_CONFIG[type] ?? FORM_CONFIG.staff;
  const color = decision === 'Accepted' ? 0x57f287 : decision === 'Denied' ? 0xed4245 : decision === 'Interview' ? 0x5865f2 : BRAND.color;
  const embed = branded(`${meta.emoji} ${meta.label} Review • ${id}`, color)
    .setDescription(`**Applicant:** ${applicant}`)
    .addFields(
      { name: 'Grade', value: `**${grade}**`, inline: true },
      { name: 'Decision', value: `**${decision}**`, inline: true },
      { name: 'Reviewer', value: `<@${interaction.user.id}>`, inline: true },
      { name: 'Review Notes', value: notes.slice(0, 1024) }
    );

  if (reviewChannel?.isTextBased()) {
    await reviewChannel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => null);
  }
  await sendBrandedWebhook(interaction.guild, state, 'registry', { embeds: [embed] }).catch(() => null);

  await interaction.reply({
    content: `✅ Review logged for **${applicant}** — Grade **${grade}**, **${decision}**.`,
    flags: MessageFlags.Ephemeral
  });
  return true;
}
