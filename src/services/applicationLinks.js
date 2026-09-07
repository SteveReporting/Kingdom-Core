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

const GRADES = ['S', 'A', 'B', 'C', 'D', 'F'];
const DECISIONS = ['Pending', 'Interview', 'Accepted', 'Denied'];
const FINAL_DECISIONS = new Set(['Accepted', 'Denied']);

const FORM_CONFIG = {
  staff: {
    label: 'Royal Staff', emoji: '🛡️', color: 0x5865f2,
    fallbackRoleKey: 'watchman', roleEnv: 'STAFF_ACCEPT_ROLE_IDS',
    docs: [
      ['Staff Onboarding', 'STAFF_ONBOARDING_URL'],
      ['Staff Handbook', 'STAFF_HANDBOOK_URL']
    ]
  },
  carrier: {
    label: 'Knight / Carrier', emoji: '⚔️', color: 0x3498db,
    fallbackRoleKey: 'squireCarrier', roleEnv: 'CARRIER_ACCEPT_ROLE_IDS',
    docs: [
      ['Knight ORBAT', 'CARRIER_ORBAT_URL'],
      ['Governance', 'CARRIER_GOVERNANCE_URL'],
      ['Recruitment SOP', 'CARRIER_RECRUITMENT_SOP_URL'],
      ['Management SOP', 'CARRIER_MANAGEMENT_SOP_URL'],
      ['Forms & Resources', 'CARRIER_FORMS_URL']
    ]
  },
  creator: {
    label: 'Creator', emoji: '🎥', color: 0xeb459e,
    fallbackRoleKey: null, roleEnv: 'CREATOR_ACCEPT_ROLE_IDS',
    docs: [
      ['Creator Onboarding', 'CREATOR_ONBOARDING_URL'],
      ['Creator Guidelines', 'CREATOR_GUIDELINES_URL']
    ]
  }
};

function branded(title, color = BRAND.color) {
  return new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: 'KINGDOM CORE • APPLICATION OPERATING SYSTEM' })
    .setTitle(title)
    .setFooter({ text: 'Kingdom Carries • Review Console vNext' })
    .setTimestamp();
}

function isStaff(member, state) {
  if (member?.permissions?.has?.(PermissionFlagsBits.Administrator)) return true;
  return STAFF_KEYS.some((key) => {
    const id = state.setup?.roles?.[key];
    return id && member?.roles?.cache?.has(id);
  });
}

function appMeta(type) {
  return FORM_CONFIG[type] ?? FORM_CONFIG.staff;
}

function ensureReviewRecord(state, appId) {
  state.applicationReviewVNext ??= {};
  state.applicationReviewVNext[appId] ??= {
    notes: [],
    grade: null,
    decision: 'Pending',
    claimedBy: null,
    updatedAt: new Date().toISOString()
  };
  return state.applicationReviewVNext[appId];
}

function statusCounts(state) {
  const result = { pending: 0, interview: 0, accepted: 0, denied: 0 };
  for (const app of Object.values(state.applications ?? {})) {
    const key = String(app.status ?? 'pending').toLowerCase();
    if (key in result) result[key]++;
  }
  return result;
}

function pendingApps(state) {
  return Object.values(state.applications ?? {})
    .filter((app) => ['pending', 'interview'].includes(String(app.status ?? '').toLowerCase()))
    .sort((a, b) => new Date(a.createdAt ?? 0) - new Date(b.createdAt ?? 0));
}

function answerEntries(app) {
  return Object.entries(app?.answers ?? {}).filter(([, value]) => String(value ?? '').trim());
}

function notePreview(review) {
  const notes = review?.notes ?? [];
  if (!notes.length) return '_No reviewer notes yet._';
  return notes.slice(-4).map((note, index) =>
    `**${notes.length - Math.min(notes.length, 4) + index + 1}.** <@${note.authorId}> • ${String(note.text).slice(0, 260)}`
  ).join('\n');
}

function compactStatus(status) {
  const value = String(status ?? 'pending').toLowerCase();
  if (value === 'accepted' || value === 'approved') return '🟢 ACCEPTED';
  if (value === 'denied') return '🔴 DENIED';
  if (value === 'interview') return '🔵 INTERVIEW';
  return '🟡 PENDING';
}

function pageControls(appId, page, total) {
  const prev = Math.max(0, page - 1);
  const next = Math.min(Math.max(0, total - 1), page + 1);
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`kc2:apps:view:${appId}:${prev}`).setLabel('Previous').setEmoji('◀️').setStyle(ButtonStyle.Secondary).setDisabled(page <= 0),
      new ButtonBuilder().setCustomId(`kc2:apps:view:${appId}:overview`).setLabel('Overview').setEmoji('🪪').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`kc2:apps:view:${appId}:${next}`).setLabel('Next').setEmoji('▶️').setStyle(ButtonStyle.Secondary).setDisabled(page >= total - 1)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`kc2:apps:note:${appId}:${page}`).setLabel('Notepad').setEmoji('🗒️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`kc2:apps:decision:${appId}:${page}`).setLabel('Grade & Decide').setEmoji('📊').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`kc2:apps:refresh:${appId}:${page}`).setLabel('Refresh').setEmoji('🔄').setStyle(ButtonStyle.Secondary)
    )
  ];
}

function reviewOverviewPayload(app, review) {
  const meta = appMeta(app.type);
  const answers = answerEntries(app);
  const embed = branded(`${meta.emoji} ${meta.label} • Application ${app.id}`, meta.color)
    .setDescription([
      `### ${compactStatus(app.status)}`,
      `Applicant: <@${app.userId}> • \`${app.userId}\``,
      `Submitted: <t:${Math.floor(new Date(app.createdAt ?? Date.now()).getTime() / 1000)}:R>`,
      '',
      `**${answers.length} written answer${answers.length === 1 ? '' : 's'}** are available. Use **Next** to read them page by page.`
    ].join('\n'))
    .addFields(
      { name: 'Current Grade', value: review.grade ? `**${review.grade}**` : '_Not graded_', inline: true },
      { name: 'Decision', value: `**${review.decision ?? 'Pending'}**`, inline: true },
      { name: 'Lead Reviewer', value: review.claimedBy ? `<@${review.claimedBy}>` : '_Unassigned_', inline: true },
      { name: '🗒️ Reviewer Notepad', value: notePreview(review) }
    );
  return { embeds: [embed], components: pageControls(app.id, 0, Math.max(1, answers.length)), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } };
}

function reviewAnswerPayload(app, review, requestedPage = 0) {
  const entries = answerEntries(app);
  if (!entries.length) return reviewOverviewPayload(app, review);
  const page = Math.max(0, Math.min(entries.length - 1, Number(requestedPage) || 0));
  const [question, answer] = entries[page];
  const meta = appMeta(app.type);
  const embed = branded(`${meta.emoji} ${meta.label} • Answer ${page + 1}/${entries.length}`, meta.color)
    .setDescription(`Applicant: <@${app.userId}> • Application \`${app.id}\``)
    .addFields(
      { name: `❓ ${question}`.slice(0, 256), value: String(answer).slice(0, 1024) || '_No answer_' },
      { name: '📍 Review Progress', value: `Answer **${page + 1} of ${entries.length}** • ${compactStatus(app.status)} • Grade **${review.grade ?? '—'}**` },
      { name: '🗒️ Notepad', value: notePreview(review) }
    );
  return { embeds: [embed], components: pageControls(app.id, page, entries.length), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } };
}

function findApplication(state, id) {
  return state.applications?.[id] ?? null;
}

function firstPending(state) {
  return pendingApps(state)[0] ?? null;
}

function docButtons(meta) {
  const buttons = meta.docs
    .map(([label, env]) => [label, process.env[env]])
    .filter(([, url]) => /^https?:\/\//i.test(String(url ?? '')))
    .slice(0, 5)
    .map(([label, url], index) => new ButtonBuilder()
      .setLabel(label.slice(0, 80))
      .setStyle(ButtonStyle.Link)
      .setURL(url)
      .setEmoji(['📘', '📜', '🧭', '⚙️', '🔗'][index]));
  return buttons.length ? [new ActionRowBuilder().addComponents(...buttons)] : [];
}

function configuredRoleIds(meta, state) {
  const explicit = String(process.env[meta.roleEnv] ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => /^\d{15,22}$/.test(value));
  if (explicit.length) return [...new Set(explicit)];
  const fallback = meta.fallbackRoleKey ? state.setup?.roles?.[meta.fallbackRoleKey] : null;
  return fallback ? [fallback] : [];
}

async function grantAcceptedRoles(guild, state, app) {
  const meta = appMeta(app.type);
  const roleIds = configuredRoleIds(meta, state);
  const member = await guild.members.fetch(app.userId).catch(() => null);
  if (!member) return { member: null, granted: [], failed: roleIds };
  const granted = [];
  const failed = [];
  for (const roleId of roleIds) {
    const role = guild.roles.cache.get(roleId);
    if (!role || !role.editable) { failed.push(roleId); continue; }
    const ok = await member.roles.add(role, `Application ${app.id} accepted`).then(() => true).catch(() => false);
    if (ok) granted.push(roleId); else failed.push(roleId);
  }
  return { member, granted, failed };
}

async function dmDecision(guild, app, review, roleResult) {
  const meta = appMeta(app.type);
  const user = roleResult.member?.user ?? await guild.client.users.fetch(app.userId).catch(() => null);
  if (!user) return false;
  const accepted = review.decision === 'Accepted';
  const interview = review.decision === 'Interview';
  const color = accepted ? 0x57f287 : interview ? 0x5865f2 : 0xed4245;
  const title = accepted
    ? `${meta.emoji} Welcome to ${meta.label}`
    : interview
      ? `💬 ${meta.label} Application • Interview`
      : `📨 ${meta.label} Application Decision`;
  const description = accepted
    ? [
      `Your application to **Kingdom Carries** has been **accepted** with grade **${review.grade ?? '—'}**.`,
      '',
      roleResult.granted.length ? `Your Discord access has been updated with **${roleResult.granted.length} role${roleResult.granted.length === 1 ? '' : 's'}**.` : 'Your application has been accepted. A staff member will complete any remaining access manually.',
      '',
      'Use the resources below before beginning. If anything is unclear, open a support ticket rather than guessing.'
    ].join('\n')
    : interview
      ? `Your **${meta.label}** application has moved to **Interview**. Staff will contact you with the next step.`
      : `Thank you for applying for **${meta.label}**. Your application has been reviewed and was not accepted this time.`;
  const embed = branded(title, color)
    .setDescription(description)
    .addFields(
      { name: 'Application', value: `\`${app.id}\``, inline: true },
      { name: 'Grade', value: `**${review.grade ?? '—'}**`, inline: true },
      { name: 'Decision', value: `**${review.decision}**`, inline: true },
      ...(review.finalNote ? [{ name: 'Reviewer Message', value: String(review.finalNote).slice(0, 1024) }] : [])
    );
  return user.send({ embeds: [embed], components: accepted ? docButtons(meta) : [], allowedMentions: { parse: [] } })
    .then(() => true)
    .catch(() => false);
}

async function postDecision(guild, state, app, review, roleResult, reviewerId, dmSent) {
  const channel = guild.channels.cache.get(state.setup?.channels?.applicationStatus);
  const meta = appMeta(app.type);
  const color = review.decision === 'Accepted' ? 0x57f287 : review.decision === 'Denied' ? 0xed4245 : 0x5865f2;
  const embed = branded(`${meta.emoji} Application Decision • ${app.id}`, color)
    .setDescription(`<@${app.userId}> • **${meta.label}**`)
    .addFields(
      { name: 'Grade', value: `**${review.grade ?? '—'}**`, inline: true },
      { name: 'Decision', value: `**${review.decision}**`, inline: true },
      { name: 'Reviewer', value: `<@${reviewerId}>`, inline: true },
      { name: 'Roles Granted', value: roleResult.granted.length ? roleResult.granted.map((id) => `<@&${id}>`).join(', ') : '_None / manual_', inline: false },
      { name: 'Applicant DM', value: dmSent ? '✅ Delivered' : '⚠️ Could not DM', inline: true },
      ...(review.finalNote ? [{ name: 'Final Note', value: String(review.finalNote).slice(0, 1024) }] : [])
    );
  if (channel?.isTextBased()) await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => null);
  await sendBrandedWebhook(guild, state, 'registry', { embeds: [embed] }).catch(() => null);
}

async function markLegacyReviewCard(guild, app, review) {
  if (!app.reviewChannelId || !app.reviewMessageId) return;
  const channel = guild.channels.cache.get(app.reviewChannelId);
  if (!channel?.isTextBased()) return;
  const message = await channel.messages.fetch(app.reviewMessageId).catch(() => null);
  if (!message) return;
  const meta = appMeta(app.type);
  const embed = branded(`${meta.emoji} ${meta.label} Application • ${app.id}`, review.decision === 'Accepted' ? 0x57f287 : review.decision === 'Denied' ? 0xed4245 : 0x5865f2)
    .setDescription(`Applicant: <@${app.userId}>\n${compactStatus(app.status)}`)
    .addFields(
      { name: 'Grade', value: `**${review.grade ?? '—'}**`, inline: true },
      { name: 'Decision', value: `**${review.decision}**`, inline: true },
      { name: 'Reviewer Notes', value: notePreview(review) }
    );
  await message.edit({ embeds: [embed], components: [], allowedMentions: { parse: [] } }).catch(() => null);
}

function openByIdModal() {
  const input = new TextInputBuilder()
    .setCustomId('kc2:apps:open-id')
    .setLabel('Application ID')
    .setPlaceholder('Paste the application ID')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(80);
  return new ModalBuilder().setCustomId('kc2:apps:open-submit').setTitle('Open Application').addComponents(new ActionRowBuilder().addComponents(input));
}

function noteModal(appId, page) {
  const input = new TextInputBuilder()
    .setCustomId('kc2:apps:note-text')
    .setLabel('Reviewer Notepad')
    .setPlaceholder('Strengths, concerns, checks to make, interview notes, evidence…')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(1600);
  return new ModalBuilder().setCustomId(`kc2:apps:note-submit:${appId}:${page}`).setTitle('Application Notepad').addComponents(new ActionRowBuilder().addComponents(input));
}

function decisionModal(appId, page) {
  const grade = new StringSelectMenuBuilder()
    .setCustomId('kc2:apps:grade')
    .setPlaceholder('Choose final grade')
    .setRequired(true)
    .addOptions(GRADES.map((value) => ({ label: `Grade ${value}`, value, emoji: value === 'S' ? '🏆' : value === 'F' ? '❌' : '📊' })));
  const decision = new StringSelectMenuBuilder()
    .setCustomId('kc2:apps:decision')
    .setPlaceholder('Choose decision')
    .setRequired(true)
    .addOptions(DECISIONS.map((value) => ({
      label: value,
      value,
      emoji: value === 'Accepted' ? '✅' : value === 'Denied' ? '❌' : value === 'Interview' ? '💬' : '🟡'
    })));
  const note = new TextInputBuilder()
    .setCustomId('kc2:apps:final-note')
    .setPlaceholder('Optional message/reason shown in the applicant DM.')
    .setRequired(false)
    .setMaxLength(900)
    .setStyle(TextInputStyle.Paragraph);
  return new ModalBuilder()
    .setCustomId(`kc2:apps:decision-submit:${appId}:${page}`)
    .setTitle('Grade & Decide')
    .addLabelComponents(
      new LabelBuilder().setLabel('Grade').setStringSelectMenuComponent(grade),
      new LabelBuilder().setLabel('Decision').setStringSelectMenuComponent(decision),
      new LabelBuilder().setLabel('Applicant Message / Final Note').setTextInputComponent(note)
    );
}

export function applicationHubPayload() {
  const embed = branded('📨 Kingdom Applications • Enter the Realm')
    .setDescription([
      'Choose the path that fits you. Applications are completed **inside Discord** so every written answer can be reviewed, paged, graded and audited from Kingdom Core.',
      '',
      '🛡️ **Royal Staff** — moderation, support and Kingdom operations.',
      '⚔️ **Knight / Carrier** — run free carries and progress through the Knight ranks.',
      '🎥 **Creator** — content, events and collaboration.',
      '',
      '> One active application per type. Write specific answers; reviewers see them exactly as submitted.'
    ].join('\n'))
    .addFields(
      { name: '01 • Apply', value: 'Complete the Discord form.', inline: true },
      { name: '02 • Review', value: 'Staff read every answer page.', inline: true },
      { name: '03 • Result', value: 'Grade, role access and DM onboarding.', inline: true }
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('kc:app:start:staff').setLabel('Staff Application').setEmoji('🛡️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('kc:app:start:carrier').setLabel('Knight Application').setEmoji('⚔️').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('kc:app:start:creator').setLabel('Creator Application').setEmoji('🎥').setStyle(ButtonStyle.Secondary)
  );
  return { embeds: [embed], components: [row], allowedMentions: { parse: [] } };
}

export function applicationReviewDeskPayload(state = {}) {
  const counts = statusCounts(state);
  const pending = pendingApps(state);
  const embed = branded('📋 Royal Application Review • Grading Desk', 0x7c3aed)
    .setDescription([
      '**Read the application here — not in another website.**',
      'Open the next applicant, move through their written answers page by page, keep private reviewer notes, then assign a grade and decision.',
      '',
      'Accepted applicants receive the configured Discord role(s) automatically and a private onboarding DM with their document/resource links.'
    ].join('\n'))
    .addFields(
      { name: '🟡 Pending', value: `**${counts.pending}**`, inline: true },
      { name: '🔵 Interview', value: `**${counts.interview}**`, inline: true },
      { name: '🟢 Accepted', value: `**${counts.accepted}**`, inline: true },
      { name: '🔴 Denied', value: `**${counts.denied}**`, inline: true },
      { name: 'Queue', value: pending.length ? `**${pending.length}** application${pending.length === 1 ? '' : 's'} awaiting action.` : '_Review queue clear._', inline: false },
      { name: 'Grade Scale', value: '**S** exceptional • **A** strong • **B** good • **C** borderline • **D** weak • **F** reject' }
    );
  const controls = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('kc2:apps:next').setLabel('Open Next Application').setEmoji('📨').setStyle(ButtonStyle.Primary).setDisabled(!pending.length),
    new ButtonBuilder().setCustomId('kc2:apps:open').setLabel('Open by ID').setEmoji('🔎').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('kc2:apps:recent').setLabel('Recent Decisions').setEmoji('📚').setStyle(ButtonStyle.Secondary)
  );
  return { embeds: [embed], components: [controls], allowedMentions: { parse: [] } };
}

export async function handleApplicationLinkButton(interaction) {
  const state = await readGuildState(interaction.guildId);
  if (!isStaff(interaction.member, state)) {
    if (interaction.customId.startsWith('kc2:apps:') || interaction.customId.startsWith('kc:app:review:')) {
      await interaction.reply({ content: 'Only Kingdom staff can use the application review controls.', flags: MessageFlags.Ephemeral }).catch(() => null);
      return true;
    }
    return false;
  }

  if (interaction.customId === 'kc2:apps:next') {
    const app = firstPending(state);
    if (!app) return interaction.reply({ content: '✅ The application queue is clear.', flags: MessageFlags.Ephemeral });
    const review = ensureReviewRecord(state, app.id);
    await mutateGuildState(interaction.guildId, async (fresh) => {
      const r = ensureReviewRecord(fresh, app.id);
      r.claimedBy ??= interaction.user.id;
      r.updatedAt = new Date().toISOString();
    });
    return interaction.reply(reviewOverviewPayload(app, { ...review, claimedBy: review.claimedBy ?? interaction.user.id }));
  }

  if (interaction.customId === 'kc2:apps:open') return interaction.showModal(openByIdModal());

  if (interaction.customId === 'kc2:apps:recent') {
    const apps = Object.values(state.applications ?? {})
      .filter((app) => ['accepted', 'approved', 'denied'].includes(String(app.status ?? '').toLowerCase()))
      .sort((a, b) => new Date(b.reviewedAt ?? b.createdAt ?? 0) - new Date(a.reviewedAt ?? a.createdAt ?? 0))
      .slice(0, 10);
    const embed = branded('📚 Recent Application Decisions', 0x5865f2)
      .setDescription(apps.length ? apps.map((app, index) => {
        const review = state.applicationReviewVNext?.[app.id] ?? {};
        return `**${index + 1}.** ${appMeta(app.type).emoji} <@${app.userId}> • **${review.grade ?? '—'}** • ${compactStatus(app.status)} • \`${app.id}\``;
      }).join('\n') : '_No final application decisions yet._');
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  }

  if (interaction.customId.startsWith('kc:app:review:')) {
    const parts = interaction.customId.split(':');
    const appId = parts.at(-1);
    const app = findApplication(state, appId);
    if (!app) return interaction.reply({ content: 'That application no longer exists.', flags: MessageFlags.Ephemeral });
    const review = ensureReviewRecord(state, app.id);
    return interaction.reply(reviewOverviewPayload(app, review));
  }

  const parts = interaction.customId.split(':');
  if (parts[0] === 'kc2' && parts[1] === 'apps' && ['view', 'refresh'].includes(parts[2])) {
    const appId = parts[3];
    const pageRaw = parts[4] ?? '0';
    const fresh = await readGuildState(interaction.guildId);
    const app = findApplication(fresh, appId);
    if (!app) return interaction.update({ content: 'Application not found.', embeds: [], components: [] });
    const review = ensureReviewRecord(fresh, appId);
    const payload = pageRaw === 'overview' ? reviewOverviewPayload(app, review) : reviewAnswerPayload(app, review, Number(pageRaw));
    delete payload.flags;
    return interaction.update(payload);
  }

  if (parts[0] === 'kc2' && parts[1] === 'apps' && parts[2] === 'note') {
    return interaction.showModal(noteModal(parts[3], Number(parts[4]) || 0));
  }

  if (parts[0] === 'kc2' && parts[1] === 'apps' && parts[2] === 'decision') {
    return interaction.showModal(decisionModal(parts[3], Number(parts[4]) || 0));
  }

  return false;
}

export async function handleApplicationLinkModal(interaction) {
  if (!interaction.customId.startsWith('kc2:apps:')) return false;
  const state = await readGuildState(interaction.guildId);
  if (!isStaff(interaction.member, state)) {
    await interaction.reply({ content: 'Only Kingdom staff can review applications.', flags: MessageFlags.Ephemeral }).catch(() => null);
    return true;
  }

  if (interaction.customId === 'kc2:apps:open-submit') {
    const id = interaction.fields.getTextInputValue('kc2:apps:open-id').trim();
    const app = findApplication(state, id);
    if (!app) {
      await interaction.reply({ content: `No application found with ID \`${id}\`.`, flags: MessageFlags.Ephemeral });
      return true;
    }
    const review = ensureReviewRecord(state, id);
    await interaction.reply(reviewOverviewPayload(app, review));
    return true;
  }

  const parts = interaction.customId.split(':');
  if (parts[2] === 'note-submit') {
    const appId = parts[3];
    const page = Number(parts[4]) || 0;
    const text = interaction.fields.getTextInputValue('kc2:apps:note-text').trim();
    await mutateGuildState(interaction.guildId, async (fresh) => {
      const review = ensureReviewRecord(fresh, appId);
      review.notes.push({ authorId: interaction.user.id, text, at: new Date().toISOString() });
      if (review.notes.length > 100) review.notes = review.notes.slice(-100);
      review.claimedBy ??= interaction.user.id;
      review.updatedAt = new Date().toISOString();
    });
    const fresh = await readGuildState(interaction.guildId);
    const app = findApplication(fresh, appId);
    if (!app) {
      await interaction.reply({ content: 'Application no longer exists.', flags: MessageFlags.Ephemeral });
      return true;
    }
    await interaction.reply(reviewAnswerPayload(app, ensureReviewRecord(fresh, appId), page));
    return true;
  }

  if (parts[2] === 'decision-submit') {
    const appId = parts[3];
    const page = Number(parts[4]) || 0;
    const grade = interaction.fields.getStringSelectValues('kc2:apps:grade')[0];
    const decision = interaction.fields.getStringSelectValues('kc2:apps:decision')[0];
    const finalNote = interaction.fields.getTextInputValue('kc2:apps:final-note').trim();
    if (!GRADES.includes(grade) || !DECISIONS.includes(decision)) {
      await interaction.reply({ content: 'Invalid grade or decision.', flags: MessageFlags.Ephemeral });
      return true;
    }

    let app = null;
    await mutateGuildState(interaction.guildId, async (fresh) => {
      app = fresh.applications?.[appId] ?? null;
      if (!app) return;
      const review = ensureReviewRecord(fresh, appId);
      review.grade = grade;
      review.decision = decision;
      review.finalNote = finalNote;
      review.claimedBy = interaction.user.id;
      review.updatedAt = new Date().toISOString();
      review.finalizedAt = FINAL_DECISIONS.has(decision) ? new Date().toISOString() : null;
      app.status = decision === 'Accepted' ? 'accepted' : decision === 'Denied' ? 'denied' : decision.toLowerCase();
      app.reviewerId = interaction.user.id;
      app.reviewedAt = new Date().toISOString();
    });

    if (!app) {
      await interaction.reply({ content: 'Application no longer exists.', flags: MessageFlags.Ephemeral });
      return true;
    }

    const fresh = await readGuildState(interaction.guildId);
    const review = ensureReviewRecord(fresh, appId);
    let roleResult = { member: null, granted: [], failed: [] };
    let dmSent = false;
    if (decision === 'Accepted') roleResult = await grantAcceptedRoles(interaction.guild, fresh, app);
    if (decision !== 'Pending') dmSent = await dmDecision(interaction.guild, app, review, roleResult);
    if (decision !== 'Pending') await postDecision(interaction.guild, fresh, app, review, roleResult, interaction.user.id, dmSent);
    await markLegacyReviewCard(interaction.guild, app, review);

    const payload = reviewAnswerPayload(app, review, page);
    delete payload.flags;
    await interaction.reply({
      content: `${decision === 'Accepted' ? '✅' : decision === 'Denied' ? '❌' : decision === 'Interview' ? '💬' : '🟡'} Application \`${appId}\` → **${decision}**, grade **${grade}**.${decision === 'Accepted' ? ` Roles granted: **${roleResult.granted.length}**.` : ''}${decision !== 'Pending' ? ` Applicant DM: **${dmSent ? 'sent' : 'failed'}**.` : ''}`,
      embeds: payload.embeds,
      components: payload.components,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] }
    });
    return true;
  }

  return false;
}
