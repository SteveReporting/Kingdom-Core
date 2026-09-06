import {
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';
import { readGuildState } from '../storage/store.js';

const DUNGEONS = [
  'Desert Temple', 'Winter Outpost', 'Pirate Island', "King\'s Castle", 'The Underworld',
  'Samurai Palace', 'The Canals', 'Ghastly Harbor', 'Steampunk Sewers', 'Orbital Outpost',
  'Volcanic Chambers', 'Aquatic Temple', 'Enchanted Forest', 'Northern Lands', 'Gilded Skies',
  'Yokai Peak', 'Abyssal Void', 'Boss / Event Mode'
];

const DIFFICULTIES = ['Easy', 'Medium', 'Hard', 'Insane', 'Nightmare'];

function option(label, value, description, emoji) {
  return { label, value, description, emoji };
}

function carryModal() {
  const dungeon = new StringSelectMenuBuilder()
    .setCustomId('kc3:carry:dungeon')
    .setPlaceholder('Select your dungeon')
    .setRequired(true)
    .addOptions(DUNGEONS.map((name) => option(name, name, 'Dungeon Quest dungeon', '⚔️')));

  const difficulty = new StringSelectMenuBuilder()
    .setCustomId('kc3:carry:difficulty')
    .setPlaceholder('Select difficulty')
    .setRequired(true)
    .addOptions(DIFFICULTIES.map((name) => option(name, name, 'Dungeon difficulty', '🏰')));

  const mode = new StringSelectMenuBuilder()
    .setCustomId('kc3:carry:mode')
    .setPlaceholder('Select run mode')
    .setRequired(true)
    .addOptions(
      option('Normal', 'Normal', 'Standard run', '🟢'),
      option('Hardcore', 'Hardcore', 'Hardcore enabled', '🔥')
    );

  const notes = new TextInputBuilder()
    .setCustomId('kc3:carry:notes')
    .setPlaceholder('Optional: anything your carrier should know')
    .setRequired(false)
    .setMaxLength(160)
    .setStyle(TextInputStyle.Short);

  return new ModalBuilder()
    .setCustomId('kc3:carry:submit')
    .setTitle('⚔️ Request a Kingdom Carry')
    .addLabelComponents(
      new LabelBuilder().setLabel('Dungeon').setDescription('Choose the dungeon you need carried.').setStringSelectMenuComponent(dungeon),
      new LabelBuilder().setLabel('Difficulty').setDescription('Choose the exact dungeon difficulty.').setStringSelectMenuComponent(difficulty),
      new LabelBuilder().setLabel('Mode').setDescription('Choose Normal or Hardcore.').setStringSelectMenuComponent(mode),
      new LabelBuilder().setLabel('Notes').setDescription('Optional information for the Knight.').setTextInputComponent(notes)
    );
}

export async function openCarryModalV3(interaction) {
  const state = await readGuildState(interaction.guildId);
  if ((state.queue ?? []).some((entry) => entry.userId === interaction.user.id && ['waiting', 'claimed'].includes(entry.status))) {
    return interaction.reply({ content: 'You already have an active carry request.', ephemeral: true });
  }
  return interaction.showModal(carryModal());
}
