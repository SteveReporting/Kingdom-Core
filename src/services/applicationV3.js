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

const TYPES = {
  staff: { label: 'Royal Staff', emoji: '🛡️', color: 0x5865f2, roleKey: 'watchman' },
  carrier: { label: 'Knight / Carrier', emoji: '⚔️', color: 0x57f287, roleKey: 'squireCarrier' },
  creator: { label: 'Creator', emoji: '🎥', color: 0xeb459e, roleKey: null }
};

const GRADES = {
  S: 'Exceptional', A: 'Strong', B: 'Good', C: 'Borderline', D: 'Weak', F: 'Reject'
};

const FILTERS = {
  pending: ['Pending Applications', '🟡'],
  staff: ['Staff Applications', '🛡️'],
  carrier: ['Carrier Applications', '⚔️'],
  creator: ['Creator Applications', '🎥'],
  interview: ['Interview Queue', '💬'],
  approved: ['Approved Applications', '✅'],
  denied: ['Denied Applications', '✖️'],
  all: ['All Recent Applications', '📚']
};

const eph = (content) => ({ content, flags: MessageFlags.Ephemeral });

function base(title, color = BRAND.color) {
  return new EmbedBuilder().setColor(color).setTitle(title).setFooter({ text: BRAND.footer }).setTimestamp();
}

function isStaff(member, state) {
  if (member?.permissions?.has?.(PermissionFlagsBits.Administrator)) return true;
  return STAFF_KEYS.some((key) => {
    const id = state.setup?.roles?.[key];
    return id && member?.roles?.cache?.has(id);
  });
}

function questions(type) {
  if (type === 'carrier') return [
    ['roblox', 'Roblox username', 'Your Roblox username', TextInputStyle.Short, 60],
    ['timezone', 'Timezone', 'e.g. GMT / EST', TextInputStyle.Short, 50],
    ['availability', 'Availability', 'When can you normally carry?', TextInputStyle.Paragraph, 300],
    ['experience', 'Dungeon Quest experience', 'Level, gear, dungeons and carrier experience.', TextInputStyle.Paragraph, 500],
    ['why', 'Why should we accept you?', 'What makes you a reliable carrier?', TextInputStyle.Paragraph, 500]
  ];
  if (type === 'creator') return [
    ['platform', 'Main platform', 'YouTube / TikTok / Twitch / other', TextInputStyle.Short, 80],
    ['handle', 'Creator name / handle', 'Your public creator name', TextInputStyle.Short, 100],
    ['audience', 'Audience / reach', 'Followers, views or community size', TextInputStyle.Short, 100],
    ['content', 'What content do you make?', 'Describe your Roblox / Dungeon Quest content.', TextInputStyle.Paragraph, 500],
    ['why', 'Collaboration goal', 'Events, promotion, videos, partnership, etc.', TextInputStyle.Paragraph, 500]
  ];
  return [
    ['timezone', 'Timezone', 'e.g. GMT / EST', TextInputStyle.Short, 50],
    ['availability', 'Availability', 'Days and times you can realistically help.', TextInputStyle.Paragraph, 300],
    ['experience', 'Moderation / staff experience', 'Servers, roles and responsibilities.', TextInputStyle.Paragraph, 500],
    ['scenario', 'Handling conflict', 'How would you handle a member dispute?', TextInputStyle.Paragraph, 500],
    ['why', 'Why Kingdom Carries?', 'What would you bring to the team?', TextInputStyle.Paragraph, 500]
  ];
}

function applicationModal(type) {
  const meta = TYPES[type];
  const modal = new ModalBuilder().setCustomId(`kc3:app:submit:${type}`).setTitle(`${meta.emoji} ${meta.label} Application`);
  for (const [id, label, placeholder, style, maxLength] of questions(type)) {
    modal.addLabelComponents(
      new LabelBuilder().setLabel(label).setTextInputComponent(
        new TextInputBuilder().setCustomId(id).setPlaceholder(placeholder).setStyle(style).setMaxLength(maxLength).setRequired(true)
      )
    );
  }
  return modal;
}

function filtered(state, filter) {
  const all = Object.values(state.applications ?? {}).sort((a, b) => new Date(b.createdAt ?? 0) - new Date(a.createdAt ?? 0));
  if (filter === 'all') return all;
  if (['staff', 'carrier', 'creator'].includes(filter)) return all.filter((app) => app.type === filter);
  return all.filter((app) => (app.status ?? 'pending') === filter);
}

function browserPayload(state, filter = 'pending', page = 0) {
  const [label, emoji] = FILTERS[filter] ?? FILTERS.pending;
  const apps = filtered(state, filter);
  const pages = Math.max(1, Math.ceil(apps.length / 25));
  const current = Math.max(0, Math.min(Number(page) || 0, pages - 1));
  const shown = apps.slice(current * 25, current * 25 + 25);
  const embed = base(`${emoji} ${label}`)
    .setDescription([
      `**${apps.length} application${apps.length === 1 ? '' : 's'} in this view.**`,
      shown.length ? 'Select one below to open its full answers, grade, staff notes and decision controls.' : '_Nothing is currently in this view._',
      '',
      `Page **${current + 1}/${pages}**`
    ].join('\n'));

  const rows = [];
  if (shown.length) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`kc3:apps:pick:${filter}:${current}`)
        .setPlaceholder('Select an application to review')
        .addOptions(shown.map((app) => {
          const meta = TYPES[app.type] ?? TYPES.staff;
          return {
            label: `${meta.emoji} ${app.username ?? app.userId} • ${String(app.status ?? 'pending').toUpperCase()}`.slice(0, 100),
            value: app.id,
            description: `${meta.label} • ${app.grade ? `Grade ${app.grade}` : 'Ungraded'} • ${app.id}`.slice(0, 100),
            emoji: meta.emoji
          };
        }))
    ));
  }
  if (pages > 1) {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`kc3:apps:page:${filter}:${current - 1}`).setLabel('Previous').setEmoji('◀️').setStyle(ButtonStyle.Secondary).setDisabled(current === 0),
      new ButtonBuilder().setCustomId(`kc3:apps:page:${filter}:${current + 1}`).setLabel('Next').setEmoji('▶️').setStyle(ButtonStyle.Secondary).setDisabled(current >= pages - 1)
    ));
  }
  return { embeds: [embed], components: rows, allowedMentions: { parse: [] } };
}

function detailPayload(app, filter = 'pending', page = 0) {
  const meta = TYPES[app.type] ?? TYPES.staff;
  const color = app.status === 'approved' ? 0x57f287 : app.status === 'denied' ? 0xed4245 : app.status === 'interview' ? 0x5865f2 : meta.color;
  const notes = app.reviewNotes?.length
    ? app.reviewNotes.slice(-4).map((note) => `• ${note.text} — <@${note.by}>`).join('\n').slice(0, 1024)
    : '_No reviewer notes yet._';
  const embed = base(`${meta.emoji} ${meta.label} Application • ${app.id}`, color)
    .setDescription(`Applicant: <@${app.userId}> • \`${app.userId}\``)
    .addFields(
      ...Object.entries(app.answers ?? {}).map(([name, value]) => ({ name, value: String(value).slice(0, 1024) })),
      { name: 'Status', value: `**${String(app.status ?? 'pending').toUpperCase()}**`, inline: true },
      { name: 'Grade', value: app.grade ? `**${app.grade}** • ${GRADES[app.grade]}` : '**Ungraded**', inline: true },
      { name: 'Reviewer', value: app.reviewerId ? `<@${app.reviewerId}>` : 'Unassigned', inline: true },
      { name: 'Private Review Notes', value: notes }
    );

  const grade = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`kc3:apps:grade:${app.id}:${filter}:${page}`)
      .setPlaceholder(app.grade ? `Current grade: ${app.grade}` : 'Grade this application')
      .addOptions(Object.entries(GRADES).map(([value, description]) => ({
        label: `Grade ${value}`,
        value,
        description,
        emoji: value === 'S' ? '🏆' : value === 'F' ? '❌' : '📊'
      })))
  );

  const actions = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`kc3:apps:decision:approve:${app.id}:${filter}:${page}`).setLabel('Approve').setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`kc3:apps:decision:interview:${app.id}:${filter}:${page}`).setLabel('Interview').setEmoji('💬').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`kc3:apps:decision:deny:${app.id}:${filter}:${page}`).setLabel('Deny').setEmoji('✖️').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`kc3:apps:note:${app.id}:${filter}:${page}`).setLabel('Add Note').setEmoji('📝').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`kc3:apps:back:${filter}:${page}`).setLabel('Back').setEmoji('↩️').setStyle(ButtonStyle.Secondary)
  );
  return { embeds: [embed], components: [grade, actions], allowedMentions: { parse: [] } };
}

async function publicStatus(guild, state, app) {
  const channel = guild.channels.cache.get(state.setup?.channels?.applicationStatus);
  if (!channel?.isTextBased()) return;
  const meta = TYPES[app.type] ?? TYPES.staff;
  const color = app.status === 'approved' ? 0x57f287 : app.status === 'denied' ? 0xed4245 : 0x5865f2;
  await channel.send({
    embeds: [base(`${meta.emoji} Application ${String(app.status).toUpperCase()}`, color)
      .setDescription(`**${meta.label}** • application \`${app.id}\``)
      .addFields(
        { name: 'Applicant', value: `<@${app.userId}>`, inline: true },
        { name: 'Grade', value: app.grade ?? 'Ungraded', inline: true }
      )],
    allowedMentions: { parse: [] }
  }).catch(() => null);
}

async function syncReviewCard(guild, app) {
  const channel = app.reviewChannelId ? guild.channels.cache.get(app.reviewChannelId) : null;
  if (!channel?.isTextBased() || !app.reviewMessageId) return;
  const message = await channel.messages.fetch(app.reviewMessageId).catch(() => null);
  if (!message) return;
  const meta = TYPES[app.type] ?? TYPES.staff;
  const color = app.status === 'approved' ? 0x57f287 : app.status === 'denied' ? 0xed4245 : app.status === 'interview' ? 0x5865f2 : meta.color;
  const embed = base(`${meta.emoji} ${meta.label} Application • ${app.id}`, color)
    .setDescription(`Applicant: <@${app.userId}> • \`${app.userId}\``)
    .addFields(
      ...Object.entries(app.answers ?? {}).map(([name, value]) => ({ name, value: String(value).slice(0, 1024) })),
      { name: 'Status', value: `**${String(app.status ?? 'pending').toUpperCase()}**`, inline: true },
      { name: 'Grade', value: app.grade ?? 'Ungraded', inline: true },
      { name: 'Reviewer', value: app.reviewerId ? `<@${app.reviewerId}>` : 'Unassigned', inline: true }
    );
  await message.edit({ embeds: [embed], components: reviewCardButtons(app.id), allowedMentions: { parse: [] } }).catch(() => null);
}

function reviewCardButtons(id) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`kc3:apps:open:${id}`).setLabel('Review / Grade').setEmoji('📊').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`kc3:apps:decision:approve:${id}:pending:0`).setLabel('Approve').setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`kc3:apps:decision:interview:${id}:pending:0`).setLabel('Interview').setEmoji('💬').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`kc3:apps:decision:deny:${id}:pending:0`).setLabel('Deny').setEmoji('✖️').setStyle(ButtonStyle.Danger)
  )];
}

async function decision(interaction, action, appId, filter, page) {
  const initial = await readGuildState(interaction.guildId);
  if (!isStaff(interaction.member, initial)) return interaction.reply(eph('Only Kingdom staff can review applications.'));
  let app = null;
  await mutateGuildState(interaction.guildId, async (state) => {
    app = state.applications?.[appId] ?? null;
    if (!app) return;
    app.status = action === 'approve' ? 'approved' : action === 'deny' ? 'denied' : 'interview';
    app.reviewerId = interaction.user.id;
    app.reviewedAt = new Date().toISOString();
  });
  if (!app) return interaction.reply(eph('That application no longer exists.'));

  const fresh = await readGuildState(interaction.guildId);
  if (app.status === 'approved') {
    const roleKey = TYPES[app.type]?.roleKey;
    const roleId = roleKey ? fresh.setup?.roles?.[roleKey] : null;
    const member = await interaction.guild.members.fetch(app.userId).catch(() => null);
    if (member && roleId) await member.roles.add(roleId, `Kingdom application ${app.id} approved`).catch(() => null);
  }
  await publicStatus(interaction.guild, fresh, app);
  await syncReviewCard(interaction.guild, app);
  await sendBrandedWebhook(interaction.guild, fresh, 'registry', {
    embeds: [base('📝 Application Decision', app.status === 'approved' ? 0x57f287 : app.status === 'denied' ? 0xed4245 : 0x5865f2)
      .setDescription(`Application \`${app.id}\` → **${app.status.toUpperCase()}**`)
      .addFields(
        { name: 'Applicant', value: `<@${app.userId}>`, inline: true },
        { name: 'Reviewer', value: `<@${interaction.user.id}>`, inline: true },
        { name: 'Grade', value: app.grade ?? 'Ungraded', inline: true }
      )]
  }).catch(() => null);

  if (interaction.message?.interactionMetadata || interaction.message?.flags?.has?.(MessageFlags.Ephemeral)) {
    return interaction.update(detailPayload(app, filter, Number(page)));
  }
  return interaction.reply({ ...detailPayload(app, filter, Number(page)), flags: MessageFlags.Ephemeral });
}

export async function handleApplicationV3Button(interaction) {
  const id = interaction.customId;
  if (id.startsWith('kc3:app:start:')) {
    const type = id.split(':')[3];
    if (!TYPES[type]) return;
    const state = await readGuildState(interaction.guildId);
    if (Object.values(state.applications ?? {}).some((app) => app.userId === interaction.user.id && app.type === type && ['pending', 'interview'].includes(app.status))) {
      return interaction.reply(eph(`You already have an active **${TYPES[type].label}** application.`));
    }
    return interaction.showModal(applicationModal(type));
  }

  const state = await readGuildState(interaction.guildId);
  if (!isStaff(interaction.member, state)) return interaction.reply(eph('Only Kingdom staff can use the application review console.'));

  if (id.startsWith('kc3:apps:open:')) {
    const app = state.applications?.[id.split(':')[3]];
    if (!app) return interaction.reply(eph('That application no longer exists.'));
    return interaction.reply({ ...detailPayload(app, 'pending', 0), flags: MessageFlags.Ephemeral });
  }
  if (id.startsWith('kc3:apps:page:') || id.startsWith('kc3:apps:back:')) {
    const parts = id.split(':');
    const filter = parts[3];
    const page = Number(parts[4]);
    return interaction.update(browserPayload(state, filter, page));
  }
  if (id.startsWith('kc3:apps:decision:')) {
    const [, , , action, appId, filter, page] = id.split(':');
    return decision(interaction, action, appId, filter, page);
  }
  if (id.startsWith('kc3:apps:note:')) {
    const [, , , appId, filter, page] = id.split(':');
    const input = new TextInputBuilder().setCustomId('review-note').setPlaceholder('Private reviewer note').setStyle(TextInputStyle.Paragraph).setMaxLength(800).setRequired(true);
    return interaction.showModal(
      new ModalBuilder()
        .setCustomId(`kc3:apps:note-submit:${appId}:${filter}:${page}`)
        .setTitle('📝 Add Review Note')
        .addLabelComponents(new LabelBuilder().setLabel('Review note').setTextInputComponent(input))
    );
  }
}

export async function handleApplicationV3Select(interaction) {
  const state = await readGuildState(interaction.guildId);
  if (!isStaff(interaction.member, state)) return interaction.reply(eph('Only Kingdom staff can use the application review console.'));
  const id = interaction.customId;

  if (id === 'kc3:apps:filter') {
    const filter = interaction.values[0] ?? 'pending';
    return interaction.reply({ ...browserPayload(state, filter, 0), flags: MessageFlags.Ephemeral });
  }
  if (id.startsWith('kc3:apps:pick:')) {
    const [, , , filter, page] = id.split(':');
    const app = state.applications?.[interaction.values[0]];
    if (!app) return interaction.reply(eph('That application no longer exists.'));
    return interaction.update(detailPayload(app, filter, Number(page)));
  }
  if (id.startsWith('kc3:apps:grade:')) {
    const [, , , appId, filter, page] = id.split(':');
    const grade = interaction.values[0];
    if (!GRADES[grade]) return interaction.reply(eph('Invalid grade.'));
    let app = null;
    await mutateGuildState(interaction.guildId, async (fresh) => {
      app = fresh.applications?.[appId] ?? null;
      if (!app) return;
      app.grade = grade;
      app.graderId = interaction.user.id;
      app.reviewerId ??= interaction.user.id;
      app.gradedAt = new Date().toISOString();
    });
    if (!app) return interaction.reply(eph('That application no longer exists.'));
    await syncReviewCard(interaction.guild, app);
    return interaction.update(detailPayload(app, filter, Number(page)));
  }
}

export async function handleApplicationV3Modal(interaction) {
  const id = interaction.customId;
  if (id.startsWith('kc3:app:submit:')) {
    const type = id.split(':')[3];
    const meta = TYPES[type];
    if (!meta) return;
    const answers = Object.fromEntries(questions(type).map(([fieldId, label]) => [label, interaction.fields.getTextInputValue(fieldId).trim()]));
    let duplicate = false;
    let app = null;
    await mutateGuildState(interaction.guildId, async (state) => {
      state.applications ??= {};
      duplicate = Object.values(state.applications).some((item) => item.userId === interaction.user.id && item.type === type && ['pending', 'interview'].includes(item.status));
      if (duplicate) return;
      const appId = `${Date.now().toString(36)}${interaction.user.id.slice(-4)}`;
      app = { id: appId, type, userId: interaction.user.id, username: interaction.user.username, answers, status: 'pending', grade: null, reviewNotes: [], createdAt: new Date().toISOString() };
      state.applications[appId] = app;
    });
    if (duplicate) return interaction.reply(eph(`You already have an active **${meta.label}** application.`));

    const state = await readGuildState(interaction.guildId);
    const review = interaction.guild.channels.cache.get(state.setup?.channels?.applicationsReview);
    if (!review?.isTextBased()) return interaction.reply(eph('Application Control is unavailable. Ask an administrator to run `/setup3`.'));

    const embed = base(`${meta.emoji} NEW • ${meta.label} Application • ${app.id}`, meta.color)
      .setDescription(`Applicant: <@${app.userId}> • \`${app.userId}\``)
      .addFields(
        ...Object.entries(answers).map(([name, value]) => ({ name, value: String(value).slice(0, 1024) })),
        { name: 'Status', value: '**PENDING REVIEW**', inline: true },
        { name: 'Grade', value: '**Ungraded**', inline: true }
      );
    const message = await review.send({ embeds: [embed], components: reviewCardButtons(app.id), allowedMentions: { parse: [] } });
    await mutateGuildState(interaction.guildId, async (fresh) => {
      if (fresh.applications?.[app.id]) {
        fresh.applications[app.id].reviewChannelId = review.id;
        fresh.applications[app.id].reviewMessageId = message.id;
      }
    });
    return interaction.reply({
      embeds: [base('✅ Application Submitted', 0x57f287)
        .setDescription(`Your **${meta.label}** application is now in the Royal review queue.`)
        .addFields({ name: 'Application ID', value: `\`${app.id}\`` })],
      flags: MessageFlags.Ephemeral
    });
  }

  if (id.startsWith('kc3:apps:note-submit:')) {
    const [, , , appId, filter, page] = id.split(':');
    const state = await readGuildState(interaction.guildId);
    if (!isStaff(interaction.member, state)) return interaction.reply(eph('Only Kingdom staff can add reviewer notes.'));
    const text = interaction.fields.getTextInputValue('review-note').trim();
    let app = null;
    await mutateGuildState(interaction.guildId, async (fresh) => {
      app = fresh.applications?.[appId] ?? null;
      if (!app) return;
      app.reviewNotes ??= [];
      app.reviewNotes.push({ by: interaction.user.id, text, at: new Date().toISOString() });
      app.reviewerId ??= interaction.user.id;
    });
    if (!app) return interaction.reply(eph('That application no longer exists.'));
    await syncReviewCard(interaction.guild, app);
    return interaction.reply({
      embeds: [base('📝 Review Note Saved', 0x57f287).setDescription(`Saved to application \`${app.id}\`.`)],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`kc3:apps:open:${app.id}`).setLabel('Re-open Review').setEmoji('📊').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`kc3:apps:back:${filter}:${page}`).setLabel('Back to List').setEmoji('↩️').setStyle(ButtonStyle.Secondary)
      )],
      flags: MessageFlags.Ephemeral
    });
  }
}
