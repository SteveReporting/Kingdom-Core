import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits
} from 'discord.js';
import { BRAND, STAFF_KEYS } from '../config/blueprint.js';
import { readGuildState, writeGuildState } from '../storage/store.js';

const STATS_RENAME_COOLDOWN_MS = 10 * 60_000;
const STATS_QUEUE_DELAY_MS = 1_500;
const statsRenameState = new Map();

function readOnlyOverwrites(guild, state) {
  const rows = [{
    id: guild.roles.everyone.id,
    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
    deny: [PermissionFlagsBits.SendMessages]
  }];
  for (const key of STAFF_KEYS) {
    const id = state.setup?.roles?.[key];
    if (!id) continue;
    rows.push({
      id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages]
    });
  }
  return rows;
}

function verificationOverwrites(guild) {
  return [{
    id: guild.roles.everyone.id,
    allow: [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.UseApplicationCommands
    ]
  }];
}

async function ensureCategory(guild, state, key, name) {
  let channel = guild.channels.cache.get(state.setup?.categories?.[key]);
  if (!channel || channel.type !== ChannelType.GuildCategory) {
    channel = guild.channels.cache.find((item) => item.type === ChannelType.GuildCategory && item.name === name);
  }
  if (!channel) {
    channel = await guild.channels.create({ name, type: ChannelType.GuildCategory, reason: 'Kingdom Core /setup3' });
  }
  state.setup.categories ??= {};
  state.setup.categories[key] = channel.id;
  return channel;
}

async function ensureText(guild, state, key, name, parentId, overwrites) {
  let channel = guild.channels.cache.get(state.setup?.channels?.[key]);
  if (!channel || channel.type !== ChannelType.GuildText) {
    channel = guild.channels.cache.find((item) => item.type === ChannelType.GuildText && item.name.startsWith(name.split('{')[0]));
  }
  if (!channel) {
    channel = await guild.channels.create({
      name: name.replace('{count}', '0'),
      type: ChannelType.GuildText,
      parent: parentId,
      permissionOverwrites: overwrites,
      reason: 'Kingdom Core /setup3'
    });
  } else {
    if (parentId && channel.parentId !== parentId) await channel.setParent(parentId, { lockPermissions: false }).catch(() => null);
    if (overwrites) await channel.permissionOverwrites.set(overwrites, 'Kingdom Core /setup3 permissions').catch(() => null);
  }
  state.setup.channels ??= {};
  state.setup.channels[key] = channel.id;
  return channel;
}

async function upsertPinned(channel, state, marker, payload) {
  state.setup.panels ??= {};
  let message = state.setup.panels[marker]
    ? await channel.messages.fetch(state.setup.panels[marker]).catch(() => null)
    : null;
  if (message) await message.edit(payload).catch(() => null);
  else {
    message = await channel.send(payload);
    state.setup.panels[marker] = message.id;
  }
  if (!message.pinned) await message.pin('Kingdom Core /setup3 control panel').catch(() => null);
  return message;
}

function guidePayload(verificationChannelId) {
  const embed = new EmbedBuilder()
    .setColor(BRAND.color)
    .setTitle('✅ Kingdom Verification • Gatehouse')
    .setDescription([
      '**Verify your Roblox account before using member services that require identity checks.**',
      '',
      `1. Go to <#${verificationChannelId}>.`,
      '2. Use the **Bloxlink verification flow** available there.',
      '3. Complete the Roblox ownership check.',
      '4. Return to the server once Bloxlink confirms verification.',
      '',
      '> Kingdom Core creates and maintains the verification area; Bloxlink itself remains the Roblox verification provider.'
    ].join('\n'))
    .addFields(
      { name: 'Why verify?', value: 'Cleaner carries, safer trading, easier staff checks and consistent Roblox identity.' },
      { name: 'Having trouble?', value: 'Open a petition through the support system and staff can help.' }
    )
    .setFooter({ text: BRAND.footer })
    .setTimestamp();
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Open Verification Channel').setEmoji('✅').setURL(`https://discord.com/channels/@me/${verificationChannelId}`).setDisabled(true)
  );
  return { embeds: [embed], components: [], allowedMentions: { parse: [] } };
}

function countSnapshot(guild) {
  const total = guild.memberCount ?? guild.members.cache.size;
  const cached = guild.members.cache.size;
  const bots = guild.members.cache.filter((member) => member.user.bot).size;
  const humans = Math.max(0, cached - bots);
  const exact = cached >= total;
  return {
    total,
    humans: exact ? total - bots : humans,
    bots,
    exact
  };
}

function scheduleStatsRename(guild, targets) {
  let slot = statsRenameState.get(guild.id);
  if (!slot) {
    slot = { desired: new Map(), timer: null, running: false, lastRunAt: 0 };
    statsRenameState.set(guild.id, slot);
  }

  for (const [id, name] of targets) {
    if (id && name) slot.desired.set(id, name);
  }

  if (!slot.running && !slot.timer && slot.desired.size) {
    const elapsed = Date.now() - slot.lastRunAt;
    const cooldownRemaining = Math.max(0, STATS_RENAME_COOLDOWN_MS - elapsed);
    const delay = Math.max(STATS_QUEUE_DELAY_MS, cooldownRemaining);
    slot.timer = setTimeout(() => {
      flushStatsRenames(guild, slot).catch((error) => {
        console.error('[ServerStats] background rename flush failed:', error);
      });
    }, delay);
    slot.timer.unref?.();
  }

  return slot.desired.size;
}

async function flushStatsRenames(guild, slot) {
  if (slot.running) return;
  slot.timer = null;
  slot.running = true;
  slot.lastRunAt = Date.now();
  const batch = [...slot.desired.entries()];
  slot.desired.clear();

  try {
    for (const [id, name] of batch) {
      const channel = guild.channels.cache.get(id);
      if (channel?.type === ChannelType.GuildText && channel.name !== name) {
        await channel.setName(name, 'Kingdom Core live server stats').catch((error) => {
          console.warn(`[ServerStats] failed to rename ${id}: ${String(error?.message ?? error)}`);
        });
      }
    }
  } finally {
    slot.running = false;
    if (slot.desired.size) scheduleStatsRename(guild, []);
  }
}

export async function updateServerStats(guild) {
  const state = await readGuildState(guild.id);
  const ids = state.setup?.statsChannels;
  if (!ids) return { updated: false, exact: false, queued: 0 };

  const snapshot = countSnapshot(guild);
  const targets = [
    [ids.all, `all-members-${snapshot.total}`],
    [ids.members, `members-${snapshot.humans}`],
    [ids.bots, `bots-${snapshot.bots}`]
  ];
  const queued = scheduleStatsRename(guild, targets);
  return { updated: true, exact: snapshot.exact, queued, ...snapshot };
}

export async function installStatsAndVerification(guild) {
  await guild.channels.fetch();
  const state = await readGuildState(guild.id);
  state.setup ??= {};

  const statsCategory = await ensureCategory(guild, state, 'serverStats', '📊 SERVER STATS 📊');
  const ro = readOnlyOverwrites(guild, state);
  const all = await ensureText(guild, state, 'statsAll', 'all-members-{count}', statsCategory.id, ro);
  const members = await ensureText(guild, state, 'statsMembers', 'members-{count}', statsCategory.id, ro);
  const bots = await ensureText(guild, state, 'statsBots', 'bots-{count}', statsCategory.id, ro);
  state.setup.statsChannels = { all: all.id, members: members.id, bots: bots.id };

  const verificationCategory = await ensureCategory(guild, state, 'verification', '✅・VERIFICATION');
  const guide = await ensureText(guild, state, 'verificationGuide', 'guide', verificationCategory.id, ro);
  const bloxlink = await ensureText(guild, state, 'bloxlinkVerification', '✅・bloxlink-verification', verificationCategory.id, verificationOverwrites(guild));

  await upsertPinned(guide, state, 'verificationGuide', guidePayload(bloxlink.id));
  const verifyPanel = {
    embeds: [new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle('✅ Bloxlink Verification')
      .setDescription([
        '**Use Bloxlink in this channel to verify your Roblox account.**',
        '',
        'Run the verification command/button provided by Bloxlink, complete the Roblox check, then return here.',
        '',
        '> Keep this channel for verification only.'
      ].join('\n'))
      .setFooter({ text: BRAND.footer })
      .setTimestamp()],
    allowedMentions: { parse: [] }
  };
  await upsertPinned(bloxlink, state, 'bloxlinkVerification', verifyPanel);

  await writeGuildState(guild.id, state);
  const snapshot = await updateServerStats(guild);
  return { statsCategoryId: statsCategory.id, verificationCategoryId: verificationCategory.id, snapshot };
}
