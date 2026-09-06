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
import { refreshLiveQueue } from './queueV2.js';
import { sendBrandedWebhook } from './webhooks.js';

const DUNGEONS = [
  'Desert Temple', 'Winter Outpost', 'Pirate Island', "King\'s Castle", 'The Underworld',
  'Samurai Palace', 'The Canals', 'Ghastly Harbor', 'Steampunk Sewers', 'Orbital Outpost',
  'Volcanic Chambers', 'Aquatic Temple', 'Enchanted Forest', 'Northern Lands', 'Gilded Skies',
  'Yokai Peak', 'Current Highest Dungeon', 'Boss / Event Mode'
];

const DIFFICULTIES = ['Easy', 'Medium', 'Hard', 'Insane', 'Nightmare'];
const MODES = ['Normal', 'Hardcore'];

const APP_TYPES = {
  staff: { label: 'Royal Staff', emoji: '🛡️', color: 0x5865f2 },
  carrier: { label: 'Knight / Carrier', emoji: '⚔️', color: 0x57f287 },
  creator: { label: 'Creator', emoji: '🎥', color: 0xeb459e }
};

const GRADES = {
  S: 'Exceptional',
  A: 'Strong',
  B: 'Good',
  C: 'Borderline',
  D: 'Weak',
  F: 'Reject'
};

const FILTERS = {
  pending: { label: 'Pending Applications', emoji: '🟡' },
  staff: { label: 'Staff Applications', emoji: '🛡️' },
  carrier: { label: 'Carrier Applications', emoji: '⚔️' },
  creator: { label: 'Creator Applications', emoji: '🎥' },
  interview: { label: 'Interview Queue', emoji: '💬' },
  approved: { label: 'Approved', emoji: '✅' },
  denied: { label: 'Denied', emoji: '✖️' },
  all: { label: 'All Recent Applications', emoji: '📚' }
};

const eph = (content) => ({ content, flags: MessageFlags.Ephemeral });

function branded(title, color = BRAND.color) {
  return new EmbedBuilder().setColor(color).setTitle(title).setFooter({ text: BRAND.footer }).setTimestamp();
}

function isStaff(member, state) {
  if (member?.permissions?.has?.(PermissionFlagsBits.Administrator)) return true;
  const roleIds = state.setup?.roles ?? {};
  return STAFF_KEYS.some((key) => roleIds[key] && member?.roles?.cache?.has(roleIds[key]));
}

function option(label, value, description, emoji) {
  return { label: label.slice(0, 100), value, description: description?.slice(0, 100), emoji };
}

function appQuestions(type) {
  if (type === 'carrier') return [
    ['roblox', 'Roblox username', 'Your Roblox username', TextInputStyle.Short, 60],
    ['timezone', 'Timezone', 'e.g. GMT / EST', TextInputStyle.Short, 50],
    ['availability', 'Availability', 'When can you normally carry?', TextInputStyle.Paragraph, 300],
    ['experience', 'Dungeon Quest experience', 'Level, gear, dungeons and carrier experience.', TextInputStyle.Paragraph, 500],
    ['why', 'Why should we accept you?', 'What would make you a reliable Knight?', TextInputStyle.Paragraph, 500]
  ];
  if (type === 'creator') return [
    ['platform', 'Main platform', 'YouTube / TikTok / Twitch / other', TextInputStyle.Short, 80],
    ['handle', 'Creator name / handle', 'Your public creator name', TextInputStyle.Short, 100],
    ['audience', 'Audience / reach', 'Followers, views or community size', TextInputStyle.Short, 100],
    ['content', 'What content do you make?', 'Describe your Roblox / Dungeon Quest content.', TextInputStyle.Paragraph, 500],
    ['why', 'What collaboration do you want?', 'Events, promotion, videos, partnership, etc.', TextInputStyle.Paragraph, 500]
  ];
  return [
    ['timezone', 'Timezone', 'e.g. GMT / EST', TextInputStyle.Short, 50],
    ['availability', 'Availability', 'Days and times you can realistically help.', TextInputStyle.Paragraph, 300],
    ['experience', 'Moderation / staff experience', 'Servers, roles and responsibilities.', TextInputStyle.Paragraph, 500],
    ['scenario', 'Handling conflict', 'Give a short example of how you would handle a dispute.', TextInputStyle.Paragraph, 500],
    ['why', 'Why Kingdom Carries?', 'What would you bring to the team?', TextInputStyle.Paragraph, 500]
  ];
}

function applicationModal(type) {
  const meta = APP_TYPES[type] ?? APP_TYPES.staff;
  const modal = new ModalBuilder()
    .setCustomId(`kc3:app:submit:${type}`)
    .setTitle(`${meta.emoji} ${meta.label} Application`);

  for (const [id, label, placeholder, style, maxLength] of appQuestions(type)) {
    const input = new TextInputBuilder()
      .setCustomId(id)
      .setPlaceholder(placeholder)
      .setStyle(style)
      .setRequired(true)
      .setMaxLength(maxLength);
    modal.addLabelComponents(
      new LabelBuilder().setLabel(label).setTextInputComponent(input)
    );
  }
  return modal;
}

function carryModal() {
  const dungeon = new StringSelectMenuBuilder()
    .setCustomId('kc3:carry:dungeon')
    .setPlaceholder('Select a Dungeon Quest dungeon')
    .setRequired(true)
    .addOptions(DUNGEONS.map((name) => option(name, name, 'Dungeon selection', '⚔️')));

  const difficulty = new StringSelectMenuBuilder()
    .setCustomId('kc3:carry:difficulty')
    .setPlaceholder('Select difficulty')
    .setRequired(true)
    .addOptions(DIFFICULTIES.map((name) => option(name, name, 'Difficulty selection', '🏰')));

  const mode = new StringSelectMenuBuilder()
    .setCustomId('kc3:carry:mode')
    .setPlaceholder('Normal or Hardcore')
    .setRequired(true)
    .addOptions(
      option('Normal', 'Normal', 'Standard dungeon run', '🟢'),
      option('Hardcore', 'Hardcore', 'Hardcore mode enabled', '🔥')
    );

  const notes = new TextInputBuilder()
    .setCustomId('kc3:carry:notes')
    .setPlaceholder('Optional: anything the carrier should know')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(160);

  return new ModalBuilder()
    .setCustomId('kc3:carry:submit')
    .setTitle('⚔️ Request a Kingdom Carry')
    .addLabelComponents(
      new LabelBuilder().setLabel('Dungeon').setDescription('Choose the dungeon you need.').setStringSelectMenuComponent(dungeon),
      new LabelBuilder().setLabel('Difficulty').setDescription('Choose the dungeon difficulty.').setStringSelectMenuComponent(difficulty),
      new LabelBuilder().setLabel('Mode').setDescription('Choose Normal or Hardcore.').setStringSelectMenuComponent(mode),
      new LabelBuilder().setLabel('Notes').setDescription('Optional information for your Knight.').setTextInputComponent(notes)
    );
}

function filterApplications(state, filter) {
  const all = Object.values(state.applications ?? {}).sort((a, b) =>
    new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()
  );
  if (filter === 'all') return all;
  if (['staff', 'carrier', 'creator'].includes(filter)) return all.filter((app) => app.type === filter);
  return all.filter((app) => (app.status ?? 'pending') === filter);
}

function applicationBrowserPayload(state, filter = 'pending', page = 0) {
  const meta = FILTERS[filter] ?? FILTERS.pending;
  const apps = filterApplications(state, filter);
  const pages = Math.max(1, Math.ceil(apps.length / 25));
  const safePage = Math.max(0, Math.min(page, pages - 1));
  const shown = apps.slice(safePage * 25, safePage * 25 + 25);

  const embed = branded(`${meta.emoji} ${meta.label}`)
    .setDescription([
      `**${apps.length} application${apps.length === 1 ? '' : 's'} found.**`,
      shown.length
        ? 'Select an application below to open its full review card, answers, grade and decision controls.'
        : '_There are no applications in this view._',
      '',
      `Page **${safePage + 1}/${pages}**`
    ].join('\n'));

  const components = [];
  if (shown.length) {
    components.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`kc3:apps:pick:${filter}:${safePage}`)
        .setPlaceholder('Select an application to review')
        .addOptions(shown.map((app) => {
          const type = APP_TYPES[app.type] ?? APP_TYPES.staff;
          const status = (app.status ?? 'pending').toUpperCase();
          return option(
            `${type.emoji} ${app.username ?? app.userId} • ${status}`,
            app.id,
            `${type.label} • ${app.grade ? `Grade ${app.grade}` : 'Ungraded'} • ${app.id}`,
            type.emoji
          );
        }))
    ));
  }

  if (pages > 1) {
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`kc3:apps:page:${filter}:${safePage - 1}`).setLabel('Previous').setEmoji('◀️').setStyle(ButtonStyle.Secondary).setDisabled(safePage <= 0),
      new ButtonBuilder().setCustomId(`kc3:apps:page:${filter}:${safePage + 1}`).setLabel('Next').setEmoji('▶️').setStyle(ButtonStyle.Secondary).setDisabled(safePage >= pages - 1)
    ));
  }

  return { embeds: [embed], components, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } };
}

function appDetailPayload(app, filter = 'pending', page = 0) {
  const type = APP_TYPES[app.type] ?? APP_TYPES.staff;
  const color = app.status === 'approved' ? 0x57f287 : app.status === 'denied' ? 0xed4245 : app.status === 'interview' ? 0x5865f2 : type.color;
  const embed = branded(`${type.emoji} ${type.label} Application • ${app.id}`, color)
    .setDescription(`Applicant: <@${app.userId}> • \`${app.userId}\``)
    .addFields(
      ...Object.entries(app.answers ?? {}).map(([name, value]) => ({ name, value: String(value).slice(0, 1024) })),
      { name: 'Status', value: `**${String(app.status ?? 'pending').toUpperCase()}**`, inline: true },
      { name: 'Grade', value: app.grade ? `**${app.grade}** • ${GRADES[app.grade] ?? ''}` : '**Ungraded**', inline: true },
      { name: 'Reviewer', value: app.reviewerId ? `<@${app.reviewerId}>` : 'Unassigned', inline: true },
      { name: 'Review Notes', value: app.reviewNotes?.length ? app.reviewNotes.slice(-3).map((note) => `• ${note.text} — <@${note.by}>`).join('\n').slice(0, 1024) : '_No review notes yet._' }
    );

  const gradeRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`kc3:apps:grade:${app.id}:${filter}:${page}`)
      .setPlaceholder(app.grade ? `Current grade: ${app.grade}` : 'Grade this application')
      .addOptions(Object.entries(GRADES).map(([grade, description]) => option(`Grade ${grade}`, grade, description, grade === 'S' ? '🏆' : grade === 'F' ? '❌' : '📊')))
  );

  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`kc3:apps:decision:approve:${app.id}:${filter}:${page}`).setLabel('Approve').setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`kc3:apps:decision:interview:${app.id}:${filter}:${page}`).setLabel('Interview').setEmoji('💬').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`kc3:apps:decision:deny:${app.id}:${filter}:${page}`).setLabel('Deny').setEmoji('✖️').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`kc3:apps:note:${app.id}:${filter}:${page}`).setLabel('Add Note').setEmoji('📝').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`kc3:apps:back:${filter}:${page}`).setLabel('Back').setEmoji('↩️').setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [gradeRow, actionRow], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } };
}

async function updatePublicApplicationStatus(guild, state, app) {
  const channel = guild.channels.cache.get(state.setup?.channels?.applicationStatus);
  if (!channel?.isTextBased()) return;
  const type = APP_TYPES[app.type] ?? APP_TYPES.staff;
  const color = app.status === 'approved' ? 0x57f287 : app.status === 'denied' ? 0xed4245 : 0x5865f2;
  await channel.send({
    embeds: [branded(`${type.emoji} Application ${String(app.status).toUpperCase()}`, color)
      .setDescription(`**${type.label}** application • \`${app.id}\``)
      .addFields(
        { name: 'Applicant', value: `<@${app.userId}>`, inline: true },
        { name: 'Grade', value: app.grade ?? 'Not graded', inline: true }
      )],
    allowedMentions: { parse: [] }
  }).catch(() => null);
}

async function syncOriginalReviewCard(guild, app) {
  if (!app.reviewChannelId || !app.reviewMessageId) return;
  const channel = guild.channels.cache.get(app.reviewChannelId);
  if (!channel?.isTextBased()) return;
  const message = await channel.messages.fetch(app.reviewMessageId).catch(() => null);
  if (!message) return;
  const type = APP_TYPES[app.type] ?? APP_TYPES.staff;
  const color = app.status === 'approved' ? 0x57f287 : app.status === 'denied' ? 0xed4245 : app.status === 'interview' ? 0x5865f2 : type.color;
  const embed = branded(`${type.emoji} ${type.label} Application • ${app.id}`, color)
    .setDescription(`Applicant: <@${app.userId}> • \`${app.userId}\``)
    .addFields(
      ...Object.entries(app.answers ?? {}).map(([name, value]) => ({ name, value: String(value).slice(0, 1024) })),
      { name: 'Status', value: `**${String(app.status ?? 'pending').toUpperCase()}**`, inline: true },
      { name: 'Grade', value: app.grade ?? 'Ungraded', inline: true },
      { name: 'Reviewer', value: app.reviewerId ? `<@${app.reviewerId}>` : 'Pending', inline: true }
    );
  await message.edit({ embeds: [embed], components: [], allowedMentions: { parse: [] } }).catch(() => null);
}

async function handleApplicationDecision(interaction, action, id, filter, page) {
  const initial = await readGuildState(interaction.guildId);
  if (!isStaff(interaction.member, initial)) return interaction.reply(eph('Only Kingdom staff can review applications.'));

  let app = null;
  await mutateGuildState(interaction.guildId, async (state) => {
    app = state.applications?.[id] ?? null;
    if (!app) return;
    app.status = action === 'approve' ? 'approved' : action === 'deny' ? 'denied' : 'interview';
    app.reviewerId = interaction.user.id;
    app.reviewedAt = new Date().toISOString();
  });
  if (!app) return interaction.reply(eph('That application could not be found.'));

  const fresh = await readGuildState(interaction.guildId);
  if (app.status === 'approved') {
    const roleKey = app.type === 'carrier' ? 'squireCarrier' : app.type === 'staff' ? 'watchman' : null;
    const roleId = roleKey ? fresh.setup?.roles?.[roleKey] : null;
    const member = await interaction.guild.members.fetch(app.userId).catch(() => null);
    if (member && roleId) await member.roles.add(roleId, `Kingdom application ${id} approved`).catch(() => null);
  }

  await updatePublicApplicationStatus(interaction.guild, fresh, app);
  await syncOriginalReviewCard(interaction.guild, app);
  await sendBrandedWebhook(interaction.guild, fresh, 'registry', {
    embeds: [branded('📝 Application Decision', app.status === 'approved' ? 0x57f287 : app.status === 'denied' ? 0xed4245 : 0x5865f2)
      .setDescription(`Application \`${id}\` → **${app.status.toUpperCase()}**`)
      .addFields(
        { name: 'Applicant', value: `<@${app.userId}>`, inline: true },
        { name: 'Reviewer', value: `<@${interaction.user.id}>`, inline: true },
        { name: 'Grade', value: app.grade ?? 'Ungraded', inline: true }
      )]
  }).catch(() => null);

  return interaction.update(appDetailPayload(app, filter, Number(page)));
}

export async function handleSetup3Button(interaction) {
  const id = interaction.customId;

  if (id === 'kc3:carry:open') {
    const state = await readGuildState(interaction.guildId);
    if ((state.queue ?? []).some((entry) => entry.userId === interaction.user.id && ['waiting', 'claimed'].includes(entry.status))) {
      return interaction.reply(eph('You already have an active carry request.'));
    }
    return interaction.showModal(carryModal());
  }

  if (id.startsWith('kc3:app:start:')) {
    const type = id.split(':')[3];
    if (!APP_TYPES[type]) return;
    const state = await readGuildState(interaction.guildId);
    if (Object.values(state.applications ?? {}).some((app) => app.userId === interaction.user.id && app.type === type && ['pending', 'interview'].includes(app.status))) {
      return interaction.reply(eph(`You already have an active **${APP_TYPES[type].label}** application.`));
    }
    return interaction.showModal(applicationModal(type));
  }

  if (id.startsWith('kc3:apps:page:')) {
    const [, , , filter, page] = id.split(':');
    const state = await readGuildState(interaction.guildId);
    if (!isStaff(interaction.member, state)) return interaction.reply(eph('Only Kingdom staff can use the application console.'));
    return interaction.update(applicationBrowserPayload(state, filter, Number(page)));
  }

  if (id.startsWith('kc3:apps:back:')) {
    const [, , , filter, page] = id.split(':');
    const state = await readGuildState(interaction.guildId);
    if (!isStaff(interaction.member, state)) return interaction.reply(eph('Only Kingdom staff can use the application console.'));
    return interaction.update(applicationBrowserPayload(state, filter, Number(page)));
  }

  if (id.startsWith('kc3:apps:decision:')) {
    const [, , , action, appId, filter, page] = id.split(':');
    return handleApplicationDecision(interaction, action, appId, filter, page);
  }

  if (id.startsWith('kc3:apps:note:')) {
    const [, , , appId, filter, page] = id.split(':');
    const state = await readGuildState(interaction.guildId);
    if (!isStaff(interaction.member, state)) return interaction.reply(eph('Only Kingdom staff can add application review notes.'));
    const noteInput = new TextInputBuilder()
      .setCustomId('kc3:apps:note-text')
      .setPlaceholder('Private review note for this application')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(800);
    const modal = new ModalBuilder()
      .setCustomId(`kc3:apps:note-submit:${appId}:${filter}:${page}`)
      .setTitle('📝 Add Review Note')
      .addLabelComponents(new LabelBuilder().setLabel('Review note').setTextInputComponent(noteInput));
    return interaction.showModal(modal);
  }
}

export async function handleSetup3Select(interaction) {
  const id = interaction.customId;
  const state = await readGuildState(interaction.guildId);

  if (id === 'kc3:apps:filter') {
    if (!isStaff(interaction.member, state)) return interaction.reply(eph('Only Kingdom staff can use the application console.'));
    const filter = interaction.values[0] ?? 'pending';
    return interaction.reply(applicationBrowserPayload(state, filter, 0));
  }

  if (id.startsWith('kc3:apps:pick:')) {
    if (!isStaff(interaction.member, state)) return interaction.reply(eph('Only Kingdom staff can use the application console.'));
    const [, , , filter, page] = id.split(':');
    const app = state.applications?.[interaction.values[0]];
    if (!app) return interaction.reply(eph('That application no longer exists.'));
    return interaction.update(appDetailPayload(app, filter, Number(page)));
  }

  if (id.startsWith('kc3:apps:grade:')) {
    if (!isStaff(interaction.member, state)) return interaction.reply(eph('Only Kingdom staff can grade applications.'));
    const [, , , appId, filter, page] = id.split(':');
    const grade = interaction.values[0];
    let app = null;
    await mutateGuildState(interaction.guildId, async (fresh) => {
      app = fresh.applications?.[appId] ?? null;
      if (!app) return;
      app.grade = grade;
      app.graderId = interaction.user.id;
      app.gradedAt = new Date().toISOString();
      app.reviewerId ??= interaction.user.id;
    });
    if (!app) return interaction.reply(eph('That application no longer exists.'));
    const latest = await readGuildState(interaction.guildId);
    await syncOriginalReviewCard(interaction.guild, app);
    await sendBrandedWebhook(interaction.guild, latest, 'registry', {
      embeds: [branded('📊 Application Graded').setDescription(`Application \`${app.id}\` received **Grade ${grade} — ${GRADES[grade]}**.`)
        .addFields({ name: 'Graded By', value: `<@${interaction.user.id}>`, inline: true })]
    }).catch(() => null);
    return interaction.update(appDetailPayload(app, filter, Number(page)));
  }
}

export async function handleSetup3Modal(interaction) {
  const id = interaction.customId;

  if (id === 'kc3:carry:submit') {
    const dungeon = interaction.fields.getStringSelectValues('kc3:carry:dungeon')[0];
    const difficulty = interaction.fields.getStringSelectValues('kc3:carry:difficulty')[0];
    const mode = interaction.fields.getStringSelectValues('kc3:carry:mode')[0];
    const notes = interaction.fields.getTextInputValue('kc3:carry:notes').trim();
    if (!dungeon || !difficulty || !mode) return interaction.reply(eph('The carry form was incomplete. Please try again.'));

    let existing = false;
    let position = 0;
    let entry = null;
    await mutateGuildState(interaction.guildId, async (state) => {
      state.queue ??= [];
      existing = state.queue.some((item) => item.userId === interaction.user.id && ['waiting', 'claimed'].includes(item.status));
      if (existing) return;
      entry = {
        id: `${Date.now()}-${interaction.user.id}`,
        userId: interaction.user.id,
        dungeon,
        difficulty: `${difficulty} • ${mode}`,
        baseDifficulty: difficulty,
        mode,
        notes,
        status: 'waiting',
        createdAt: new Date().toISOString()
      };
      state.queue.push(entry);
      position = state.queue.filter((item) => item.status === 'waiting').length;
      await refreshLiveQueue(interaction.guild, state);
    });

    if (existing) return interaction.reply(eph('You already have an active carry request.'));
    return interaction.reply({
      embeds: [branded('✅ Carry Request Submitted', 0x57f287)
        .setDescription('Your request is now visible in the **Live Carry Queue**.')
        .addFields(
          { name: 'Dungeon', value: dungeon, inline: true },
          { name: 'Difficulty', value: difficulty, inline: true },
          { name: 'Mode', value: mode, inline: true },
          { name: 'Queue Position', value: `#${position}`, inline: true },
          ...(notes ? [{ name: 'Notes', value: notes }] : [])
        )],
      flags: MessageFlags.Ephemeral
    });
  }

  if (id.startsWith('kc3:app:submit:')) {
    const type = id.split(':')[3];
    const meta = APP_TYPES[type];
    if (!meta) return;
    const answers = Object.fromEntries(appQuestions(type).map(([fieldId, label]) => [label, interaction.fields.getTextInputValue(fieldId).trim()]));
    let duplicate = false;
    let app = null;

    await mutateGuildState(interaction.guildId, async (state) => {
      state.applications ??= {};
      duplicate = Object.values(state.applications).some((item) => item.userId === interaction.user.id && item.type === type && ['pending', 'interview'].includes(item.status));
      if (duplicate) return;
      const appId = `${Date.now().toString(36)}${interaction.user.id.slice(-4)}`;
      app = {
        id: appId,
        type,
        userId: interaction.user.id,
        username: interaction.user.username,
        answers,
        status: 'pending',
        grade: null,
        reviewNotes: [],
        createdAt: new Date().toISOString()
      };
      state.applications[appId] = app;
    });

    if (duplicate) return interaction.reply(eph(`You already have an active **${meta.label}** application.`));
    const state = await readGuildState(interaction.guildId);
    const reviewChannel = interaction.guild.channels.cache.get(state.setup?.channels?.applicationsReview);
    if (!reviewChannel?.isTextBased()) return interaction.reply(eph('The application review desk is unavailable. Ask an administrator to run `/setup3`.'));

    const reviewEmbed = branded(`${meta.emoji} NEW • ${meta.label} Application • ${app.id}`, meta.color)
      .setDescription(`Applicant: <@${app.userId}> • \`${app.userId}\``)
      .addFields(
        ...Object.entries(answers).map(([name, value]) => ({ name, value: String(value).slice(0, 1024) })),
        { name: 'Status', value: '**PENDING REVIEW**', inline: true },
        { name: 'Grade', value: '**Ungraded**', inline: true }
      );

    const message = await reviewChannel.send({
      embeds: [reviewEmbed],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`kc3:apps:decision:approve:${app.id}:pending:0`).setLabel('Approve').setEmoji('✅').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`kc3:apps:decision:interview:${app.id}:pending:0`).setLabel('Interview').setEmoji('💬').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`kc3:apps:decision:deny:${app.id}:pending:0`).setLabel('Deny').setEmoji('✖️').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`kc3:apps:note:${app.id}:pending:0`).setLabel('Review').setEmoji('📝').setStyle(ButtonStyle.Secondary)
      )],
      allowedMentions: { parse: [] }
    });

    await mutateGuildState(interaction.guildId, async (fresh) => {
      if (fresh.applications?.[app.id]) {
        fresh.applications[app.id].reviewChannelId = reviewChannel.id;
        fresh.applications[app.id].reviewMessageId = message.id;
      }
    });

    return interaction.reply({
      embeds: [branded('✅ Application Submitted', 0x57f287)
        .setDescription(`Your **${meta.label}** application has been sent to the Royal review desk.`)
        .addFields({ name: 'Application ID', value: `\`${app.id}\``, inline: true })],
      flags: MessageFlags.Ephemeral
    });
  }

  if (id.startsWith('kc3:apps:note-submit:')) {
    const [, , , , appId, filter, page] = id.split(':');
    const state = await readGuildState(interaction.guildId);
    if (!isStaff(interaction.member, state)) return interaction.reply(eph('Only Kingdom staff can add review notes.'));
    const text = interaction.fields.getTextInputValue('kc3:apps:note-text').trim();
    let app = null;
    await mutateGuildState(interaction.guildId, async (fresh) => {
      app = fresh.applications?.[appId] ?? null;
      if (!app) return;
      app.reviewNotes ??= [];
      app.reviewNotes.push({ by: interaction.user.id, text, at: new Date().toISOString() });
      app.reviewerId ??= interaction.user.id;
    });
    if (!app) return interaction.reply(eph('That application could not be found.'));
    await syncOriginalReviewCard(interaction.guild, app);
    return interaction.reply({
      embeds: [branded('📝 Review Note Added', 0x57f287).setDescription(`Note saved to application \`${appId}\`.`)],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`kc3:apps:back:${filter}:${page}`).setLabel('Return to Application List').setEmoji('↩️').setStyle(ButtonStyle.Secondary)
      )],
      flags: MessageFlags.Ephemeral
    });
  }
}

export function applicationFilterRow() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('kc3:apps:filter')
      .setPlaceholder('Select which applications to display')
      .addOptions(Object.entries(FILTERS).map(([value, meta]) => option(meta.label, value, 'Open this application view', meta.emoji)))
  );
}
