import { ChannelType } from 'discord.js';
import { readGuildState, writeGuildState } from '../storage/store.js';

function positionOf(channel) {
  return Number(channel?.rawPosition ?? channel?.position ?? 0);
}

function serializeOverwrites(channel) {
  return [...channel.permissionOverwrites.cache.values()].map((overwrite) => ({
    id: overwrite.id,
    type: overwrite.type,
    allow: overwrite.allow.bitfield.toString(),
    deny: overwrite.deny.bitfield.toString()
  }));
}

function serializeChannel(channel) {
  const base = {
    id: channel.id,
    name: channel.name,
    type: channel.type,
    parentId: channel.parentId ?? null,
    position: positionOf(channel),
    permissionOverwrites: serializeOverwrites(channel)
  };

  if ('topic' in channel) base.topic = channel.topic ?? null;
  if ('nsfw' in channel) base.nsfw = Boolean(channel.nsfw);
  if ('rateLimitPerUser' in channel) base.rateLimitPerUser = Number(channel.rateLimitPerUser ?? 0);
  if ('bitrate' in channel) base.bitrate = Number(channel.bitrate ?? 0);
  if ('userLimit' in channel) base.userLimit = Number(channel.userLimit ?? 0);

  return base;
}

export async function captureLiveGuildStructure(guild) {
  await guild.channels.fetch();

  const categories = [];
  const channels = [];

  for (const channel of guild.channels.cache.values()) {
    if (channel.isThread?.()) continue;
    if (channel.type === ChannelType.GuildCategory) categories.push(serializeChannel(channel));
    else channels.push(serializeChannel(channel));
  }

  categories.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  channels.sort((a, b) => {
    const parent = String(a.parentId ?? '').localeCompare(String(b.parentId ?? ''));
    return parent || a.position - b.position || a.name.localeCompare(b.name);
  });

  return {
    capturedAt: new Date().toISOString(),
    guildId: guild.id,
    guildName: guild.name,
    categories,
    channels
  };
}

export function compareStructures(baseline, current) {
  if (!baseline) {
    return {
      missingCategories: [],
      missingChannels: []
    };
  }

  const categoryIds = new Set(current.categories.map((item) => item.id));
  const channelIds = new Set(current.channels.map((item) => item.id));

  return {
    missingCategories: baseline.categories.filter((item) => !categoryIds.has(item.id)),
    missingChannels: baseline.channels.filter((item) => !channelIds.has(item.id))
  };
}

function deserializeOverwrites(saved = []) {
  return saved.map((overwrite) => ({
    id: overwrite.id,
    type: overwrite.type,
    allow: BigInt(overwrite.allow || '0'),
    deny: BigInt(overwrite.deny || '0')
  }));
}

function creatableChannelType(type) {
  return [
    ChannelType.GuildText,
    ChannelType.GuildAnnouncement,
    ChannelType.GuildVoice,
    ChannelType.GuildStageVoice,
    ChannelType.GuildForum,
    ChannelType.GuildMedia
  ].includes(type);
}

function createOptions(saved, parentId = null) {
  const options = {
    name: saved.name,
    type: saved.type,
    permissionOverwrites: deserializeOverwrites(saved.permissionOverwrites),
    reason: 'Kingdom Core /setup1 restore missing live-structure item'
  };

  if (parentId) options.parent = parentId;

  if ([ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildMedia].includes(saved.type)) {
    if (saved.topic !== undefined) options.topic = saved.topic;
    if (saved.nsfw !== undefined) options.nsfw = saved.nsfw;
    if (saved.rateLimitPerUser !== undefined) options.rateLimitPerUser = saved.rateLimitPerUser;
  }

  if ([ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(saved.type)) {
    if (saved.bitrate) options.bitrate = saved.bitrate;
    if (saved.userLimit !== undefined) options.userLimit = saved.userLimit;
  }

  return options;
}

async function recreateMissingItems(guild, diff) {
  const recreatedCategoryIds = new Map();
  const summary = {
    categoriesCreated: 0,
    channelsCreated: 0,
    skippedUnsupported: 0,
    failures: []
  };

  // New items are intentionally created at Discord's default/end position.
  // We never setPosition/setParent on an existing channel or category.
  for (const saved of diff.missingCategories) {
    try {
      const created = await guild.channels.create(createOptions({ ...saved, type: ChannelType.GuildCategory }));
      recreatedCategoryIds.set(saved.id, created.id);
      summary.categoriesCreated++;
    } catch (error) {
      summary.failures.push(`Category ${saved.name}: ${String(error?.message ?? error).slice(0, 180)}`);
    }
  }

  await guild.channels.fetch();

  for (const saved of diff.missingChannels) {
    if (!creatableChannelType(saved.type)) {
      summary.skippedUnsupported++;
      continue;
    }

    let parentId = null;
    if (saved.parentId) {
      if (guild.channels.cache.has(saved.parentId)) parentId = saved.parentId;
      else if (recreatedCategoryIds.has(saved.parentId)) parentId = recreatedCategoryIds.get(saved.parentId);
    }

    try {
      await guild.channels.create(createOptions(saved, parentId));
      summary.channelsCreated++;
    } catch (error) {
      summary.failures.push(`Channel ${saved.name}: ${String(error?.message ?? error).slice(0, 180)}`);
    }
  }

  return summary;
}

export async function runLiveGuildSetup(guild, { preview = false } = {}) {
  const state = await readGuildState(guild.id);
  const current = await captureLiveGuildStructure(guild);
  const baseline = state.setup1?.structure ?? null;
  const diff = compareStructures(baseline, current);

  if (preview) {
    return {
      preview: true,
      baselineExists: Boolean(baseline),
      current,
      diff,
      repair: null
    };
  }

  let repair = {
    categoriesCreated: 0,
    channelsCreated: 0,
    skippedUnsupported: 0,
    failures: []
  };

  if (baseline) {
    repair = await recreateMissingItems(guild, diff);
  }

  const finalStructure = await captureLiveGuildStructure(guild);
  state.setup1 = {
    version: 1,
    source: 'live-guild',
    structure: finalStructure,
    updatedAt: new Date().toISOString()
  };
  await writeGuildState(guild.id, state);

  return {
    preview: false,
    baselineExists: Boolean(baseline),
    current: finalStructure,
    diff,
    repair
  };
}
