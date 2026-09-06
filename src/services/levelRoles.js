import { ChannelType, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { BRAND, STAFF_KEYS } from '../config/blueprint.js';
import { readGuildState, writeGuildState } from '../storage/store.js';

export const LEVEL_TIERS = [
  { key: '0-9', role: 'Lvl 0-9', emoji: '🟤', dungeon: '🏜️ Desert Temple' },
  { key: '10-19', role: 'Lvl 10-19', emoji: '🟠', dungeon: '🏜️ Desert Temple' },
  { key: '20-29', role: 'Lvl 20-29', emoji: '🟡', dungeon: '🏜️ Desert Temple' },
  { key: '30-39', role: 'Lvl 30-39', emoji: '🟢', dungeon: '❄️ Winter Outpost' },
  { key: '40-49', role: 'Lvl 40-49', emoji: '🔵', dungeon: '❄️ Winter Outpost' },
  { key: '50-59', role: 'Lvl 50-59', emoji: '🟣', dungeon: '❄️ Winter Outpost' },
  { key: '60-69', role: 'Lvl 60-69', emoji: '🏴‍☠️', dungeon: '🏴‍☠️ Pirate Island' },
  { key: '70-79', role: 'Lvl 70-79', emoji: '👑', dungeon: "👑 King's Castle" },
  { key: '80-89', role: 'Lvl 80-89', emoji: '🔥', dungeon: '🔥 The Underworld' },
  { key: '90-99', role: 'Lvl 90-99', emoji: '🌸', dungeon: '🌸 Samurai Palace' },
  { key: '100-109', role: 'Lvl 100-109', emoji: '🌊', dungeon: '🌊 The Canals' },
  { key: '110-119', role: 'Lvl 110-119', emoji: '👻', dungeon: '👻 Ghastly Harbor' },
  { key: '120-129', role: 'Lvl 120-129', emoji: '⚙️', dungeon: '⚙️ Steampunk Sewers' },
  { key: '130-139', role: 'Lvl 130-139', emoji: '🛰️', dungeon: '⚙️ Steampunk Sewers → 🚀 Orbital Outpost' },
  { key: '140-149', role: 'Lvl 140-149', emoji: '🚀', dungeon: '🚀 Orbital Outpost' },
  { key: '150-159', role: 'Lvl 150-159', emoji: '🌋', dungeon: '🌋 Volcanic Chambers' },
  { key: '160-169', role: 'Lvl 160-169', emoji: '🐚', dungeon: '🐚 Aquatic Temple' },
  { key: '170-179', role: 'Lvl 170-179', emoji: '🌲', dungeon: '🌲 Enchanted Forest' },
  { key: '180-189', role: 'Lvl 180-189', emoji: '🪓', dungeon: '🪓 Northern Lands' },
  { key: '190-199', role: 'Lvl 190-199', emoji: '🐉', dungeon: '🐉 Gilded Skies' },
  { key: '200+', role: 'Lvl 200+', emoji: '👹', dungeon: '👹 Yokai Peak → 🕳️ Abyssal Void at 210+' }
];

function panelEmbed(title, tiers, note) {
  return new EmbedBuilder()
    .setColor(BRAND.color)
    .setTitle(title)
    .setDescription([
      '**React with the icon beside your current level range.**',
      'Kingdom Core gives you exactly one level role and removes your old one automatically.',
      '',
      ...tiers.map((tier) => `${tier.emoji}  **Lvl ${tier.key}**  •  ${tier.dungeon}`),
      '',
      note,
      '_These are progression labels only; they do not grant staff or carrier permissions._'
    ].join('\n'))
    .setFooter({ text: BRAND.footer })
    .setTimestamp();
}

function publicReadOnlyOverwrites(guild, state) {
  const rows = [{
    id: guild.roles.everyone.id,
    allow: [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.AddReactions
    ],
    deny: [PermissionFlagsBits.SendMessages]
  }];
  for (const key of STAFF_KEYS) {
    const roleId = state.setup?.roles?.[key];
    if (!roleId) continue;
    rows.push({
      id: roleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.AddReactions
      ]
    });
  }
  return rows;
}

async function ensureLevelRoles(guild, state) {
  state.setup.levelRoles ??= {};
  await guild.roles.fetch();

  // Create from highest to lowest so Discord naturally leaves the highest bands above the lower bands.
  for (const tier of [...LEVEL_TIERS].reverse()) {
    let role = guild.roles.cache.get(state.setup.levelRoles[tier.key]);
    if (!role) role = guild.roles.cache.find((item) => !item.managed && item.name === tier.role);
    if (!role) {
      role = await guild.roles.create({
        name: tier.role,
        hoist: false,
        mentionable: false,
        permissions: [],
        reason: 'Kingdom Core /setup3 level reaction roles'
      });
    }
    state.setup.levelRoles[tier.key] = role.id;
  }
}

async function ensureLevelChannel(guild, state) {
  let channel = guild.channels.cache.get(state.setup?.channels?.levelRoles);
  if (!channel || channel.type !== ChannelType.GuildText) {
    channel = guild.channels.cache.find((item) => item.type === ChannelType.GuildText && item.name === '📈・level-roles');
  }
  const parent = guild.channels.cache.get(state.setup?.categories?.progression);
  const overwrites = publicReadOnlyOverwrites(guild, state);

  if (!channel) {
    channel = await guild.channels.create({
      name: '📈・level-roles',
      type: ChannelType.GuildText,
      parent: parent?.id,
      permissionOverwrites: overwrites,
      reason: 'Kingdom Core /setup3 level role panel'
    });
  } else {
    if (parent && channel.parentId !== parent.id) await channel.setParent(parent.id, { lockPermissions: false }).catch(() => null);
    await channel.permissionOverwrites.set(overwrites, 'Kingdom Core /setup3 level-role permissions').catch(() => null);
  }

  state.setup.channels ??= {};
  state.setup.channels.levelRoles = channel.id;
  return channel;
}

async function ensureReactionPanel(channel, state, key, tiers, title, note) {
  state.setup.panels ??= {};
  let message = state.setup.panels[key]
    ? await channel.messages.fetch(state.setup.panels[key]).catch(() => null)
    : null;
  const payload = { embeds: [panelEmbed(title, tiers, note)], allowedMentions: { parse: [] } };

  if (message) await message.edit(payload).catch(() => null);
  else {
    message = await channel.send(payload);
    state.setup.panels[key] = message.id;
  }

  if (!message.pinned) await message.pin('Kingdom Core /setup3 level-role control panel').catch(() => null);
  for (const tier of tiers) await message.react(tier.emoji).catch(() => null);
  return message.id;
}

export async function installLevelRoles(guild) {
  await guild.channels.fetch();
  const state = await readGuildState(guild.id);
  state.setup ??= {};

  await ensureLevelRoles(guild, state);
  const channel = await ensureLevelChannel(guild, state);

  const first = LEVEL_TIERS.slice(0, 10);
  const second = LEVEL_TIERS.slice(10);
  const panel1 = await ensureReactionPanel(
    channel,
    state,
    'levelRolesEarly',
    first,
    '📈 Level Roles • 0–99',
    '**Early → mid progression.** Pick the band containing your current Roblox Dungeon Quest level.'
  );
  const panel2 = await ensureReactionPanel(
    channel,
    state,
    'levelRolesLate',
    second,
    '🏆 Level Roles • 100–200+',
    '**Late → endgame progression.** Volcanic Chambers begins in the **150–159** band.'
  );

  state.setup.levelRolePanelIds = [panel1, panel2];
  state.setup.levelRoleVersion = 3;
  await writeGuildState(guild.id, state);
  return { roles: LEVEL_TIERS.length, channelId: channel.id, panels: 2 };
}

function matchingTier(emojiName) {
  return LEVEL_TIERS.find((tier) => tier.emoji === emojiName) ?? null;
}

export async function handleLevelReactionAdd(reaction, user) {
  if (user.bot) return;
  if (reaction.partial) await reaction.fetch().catch(() => null);
  const guild = reaction.message.guild;
  if (!guild) return;

  const state = await readGuildState(guild.id);
  if (!(state.setup?.levelRolePanelIds ?? []).includes(reaction.message.id)) return;
  const tier = matchingTier(reaction.emoji.name);
  if (!tier) return;

  const member = await guild.members.fetch(user.id).catch(() => null);
  const selectedRoleId = state.setup?.levelRoles?.[tier.key];
  if (!member || !selectedRoleId) return;

  const allRoleIds = Object.values(state.setup.levelRoles ?? {}).filter(Boolean);
  const remove = allRoleIds.filter((id) => id !== selectedRoleId && member.roles.cache.has(id));
  if (remove.length) await member.roles.remove(remove, 'Kingdom Core level role changed').catch(() => null);
  if (!member.roles.cache.has(selectedRoleId)) await member.roles.add(selectedRoleId, `Kingdom Core level role ${tier.key}`).catch(() => null);

  // Keep the reaction UI clean: one selected level reaction per member across both pinned panels.
  for (const panelId of state.setup.levelRolePanelIds ?? []) {
    const channel = guild.channels.cache.get(state.setup?.channels?.levelRoles);
    const message = channel?.isTextBased() ? await channel.messages.fetch(panelId).catch(() => null) : null;
    if (!message) continue;
    for (const item of message.reactions.cache.values()) {
      if (message.id === reaction.message.id && item.emoji.name === reaction.emoji.name) continue;
      await item.users.remove(user.id).catch(() => null);
    }
  }
}

export async function handleLevelReactionRemove(reaction, user) {
  if (user.bot) return;
  if (reaction.partial) await reaction.fetch().catch(() => null);
  const guild = reaction.message.guild;
  if (!guild) return;

  const state = await readGuildState(guild.id);
  if (!(state.setup?.levelRolePanelIds ?? []).includes(reaction.message.id)) return;
  const tier = matchingTier(reaction.emoji.name);
  const roleId = tier ? state.setup?.levelRoles?.[tier.key] : null;
  if (!roleId) return;

  const member = await guild.members.fetch(user.id).catch(() => null);
  if (member?.roles.cache.has(roleId)) await member.roles.remove(roleId, 'Kingdom Core level reaction removed').catch(() => null);
}
