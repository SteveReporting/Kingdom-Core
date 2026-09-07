import { ChannelType } from 'discord.js';

function positionOf(channel) {
  return Number(channel?.rawPosition ?? channel?.position ?? 0);
}

export async function captureGuildStructure(guild) {
  await guild.channels.fetch();

  const categories = [];
  const channels = [];

  for (const channel of guild.channels.cache.values()) {
    if (channel.isThread?.()) continue;
    if (channel.type === ChannelType.GuildCategory) {
      categories.push({
        id: channel.id,
        name: channel.name,
        position: positionOf(channel)
      });
      continue;
    }

    channels.push({
      id: channel.id,
      name: channel.name,
      parentId: channel.parentId ?? null,
      position: positionOf(channel)
    });
  }

  return {
    capturedAt: new Date().toISOString(),
    categories,
    channels
  };
}

export async function restoreGuildStructure(guild, snapshot) {
  await guild.channels.fetch();

  const summary = {
    channelParentsRestored: 0,
    channelPositionsRestored: 0,
    categoryPositionsRestored: 0,
    missingOriginalChannels: 0,
    missingOriginalCategories: 0
  };

  const originalCategoryIds = new Set(snapshot.categories.map((category) => category.id));
  for (const category of snapshot.categories) {
    const current = guild.channels.cache.get(category.id);
    if (!current || current.type !== ChannelType.GuildCategory) {
      summary.missingOriginalCategories++;
      continue;
    }
  }

  if (summary.missingOriginalCategories > 0) {
    throw new Error(`/setup5 structure guard detected ${summary.missingOriginalCategories} original categor${summary.missingOriginalCategories === 1 ? 'y' : 'ies'} missing. Setup5 never intentionally deletes categories, so the migration was stopped before reporting success.`);
  }

  for (const saved of snapshot.channels) {
    const channel = guild.channels.cache.get(saved.id);
    if (!channel || channel.type === ChannelType.GuildCategory || channel.isThread?.()) {
      summary.missingOriginalChannels++;
      continue;
    }

    const validParent = saved.parentId === null || originalCategoryIds.has(saved.parentId);
    if (validParent && channel.parentId !== saved.parentId) {
      const restored = await channel.setParent(saved.parentId, {
        lockPermissions: false,
        reason: 'Kingdom Core /setup5 preserve existing channel location'
      }).catch(() => null);
      if (restored) summary.channelParentsRestored++;
    }
  }

  // Parent changes can alter ordering. Restore positions only for channels/categories
  // that existed before /setup5; newly-created v5 surfaces keep their installer position.
  for (const saved of snapshot.channels) {
    const channel = guild.channels.cache.get(saved.id);
    if (!channel || channel.type === ChannelType.GuildCategory || channel.isThread?.()) continue;
    if (positionOf(channel) === saved.position) continue;
    const restored = await channel.setPosition(saved.position, {
      reason: 'Kingdom Core /setup5 preserve existing channel order'
    }).catch(() => null);
    if (restored) summary.channelPositionsRestored++;
  }

  for (const saved of snapshot.categories) {
    const category = guild.channels.cache.get(saved.id);
    if (!category || category.type !== ChannelType.GuildCategory) continue;
    if (positionOf(category) === saved.position) continue;
    const restored = await category.setPosition(saved.position, {
      reason: 'Kingdom Core /setup5 preserve existing category order'
    }).catch(() => null);
    if (restored) summary.categoryPositionsRestored++;
  }

  await guild.channels.fetch();

  const parentDrift = snapshot.channels.filter((saved) => {
    const current = guild.channels.cache.get(saved.id);
    return current && !current.isThread?.() && current.parentId !== saved.parentId;
  });
  const missingCategories = snapshot.categories.filter((saved) => !guild.channels.cache.has(saved.id));

  if (missingCategories.length || parentDrift.length) {
    throw new Error(`/setup5 structure guard verification failed: ${missingCategories.length} original categories missing, ${parentDrift.length} original channels still in a different category.`);
  }

  return summary;
}
