import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { BRAND } from '../config/blueprint.js';

function baseEmbed() {
  return new EmbedBuilder().setColor(BRAND.color).setFooter({ text: BRAND.footer });
}

export function welcomePanel(channels) {
  const embed = baseEmbed()
    .setTitle('👑 Welcome to Kingdom Carries')
    .setDescription(
      [
        'Enter as a **Traveller**. Rise as a **Knight**.',
        '',
        `⚔️ Request free carries in ${channels.carryBoard ?? '#carry-board'}`,
        `🏰 Choose a House in ${channels.chooseHouse ?? '#choose-your-house'}`,
        `📜 Follow quests and campaigns in ${channels.quests ?? '#quest-board'}`,
        `💰 Trade through ${channels.marketplace ?? '#marketplace'}`,
        `🕯️ Need help? Use ${channels.supportPanel ?? '#petition-the-crown'}.`
      ].join('\n')
    );

  return { embeds: [embed] };
}

export function rulesPanel() {
  const embed = baseEmbed()
    .setTitle('📜 Laws of the Realm')
    .setDescription([
      '**1. Respect the realm.** No harassment, hate, threats, or targeted abuse.',
      '**2. No scams or dishonest trades.** Evidence may be requested by staff.',
      '**3. Carries are free.** Never charge members for an official Kingdom Carries run.',
      '**4. Do not spam, raid, mass ping, or abuse bots/webhooks.**',
      '**5. Keep content appropriate for Discord and the server.**',
      '**6. Follow staff direction and Discord Terms of Service.**',
      '',
      'Common sense applies. Staff actions should be proportionate and logged.'
    ].join('\n'));
  return { embeds: [embed] };
}

export function housePanel() {
  const embed = baseEmbed()
    .setTitle('🏰 Choose Your House')
    .setDescription([
      '**🐉 House Drakon** — competitive players and raw power.',
      '**🦁 House Leonis** — loyalty, community, and leadership.',
      '**🦅 House Aether** — progression, grinding, and achievements.',
      '**🐺 House Fenrir** — carries, combat, and speedrunning.',
      '',
      'You may change House later. You can belong to only one House at a time.'
    ].join('\n'));

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('kc:house:houseDrakon').setLabel('Drakon').setEmoji('🐉').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('kc:house:houseLeonis').setLabel('Leonis').setEmoji('🦁').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('kc:house:houseAether').setLabel('Aether').setEmoji('🦅').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('kc:house:houseFenrir').setLabel('Fenrir').setEmoji('🐺').setStyle(ButtonStyle.Secondary)
  );
  return { embeds: [embed], components: [row] };
}

export function notificationPanel() {
  const embed = baseEmbed()
    .setTitle('🔔 Choose Notifications')
    .setDescription('Toggle only the notifications you actually want. No unnecessary mass pings.');

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('kc:role:carryPing').setLabel('Carry Pings').setEmoji('⚔️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('kc:role:eventPing').setLabel('Event Pings').setEmoji('🎪').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('kc:role:marketPing').setLabel('Market Pings').setEmoji('🏪').setStyle(ButtonStyle.Primary)
  );
  return { embeds: [embed], components: [row] };
}

export function carryPanel() {
  const embed = baseEmbed()
    .setTitle('⚔️ Royal Carry Board')
    .setDescription([
      'Free Dungeon Quest carries for members of the realm.',
      '',
      '**Join Queue** — submit the dungeon and difficulty you need.',
      '**Leave Queue** — remove your current request.',
      '**Claim Next** — verified carriers can claim the oldest waiting request.',
      '',
      'One active request per member. Please be ready when a Knight claims your run.'
    ].join('\n'));

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('kc:carry:join').setLabel('Join Queue').setEmoji('⚔️').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('kc:carry:leave').setLabel('Leave Queue').setEmoji('✖️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('kc:carry:claim').setLabel('Claim Next').setEmoji('🛡️').setStyle(ButtonStyle.Primary)
  );
  return { embeds: [embed], components: [row] };
}

export function supportPanel() {
  const embed = baseEmbed()
    .setTitle('🕯️ Petition the Crown')
    .setDescription('Need help with a carry, trade, report, staff matter, partnership, or something else? Open one private petition.');
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('kc:ticket:open').setLabel('Open Petition').setEmoji('📜').setStyle(ButtonStyle.Primary)
  );
  return { embeds: [embed], components: [row] };
}

export function questPanel() {
  const embed = baseEmbed()
    .setTitle('📜 Royal Quest Board')
    .setDescription([
      '**Daily Quests**',
      '• Complete 2 Dungeon Quest runs',
      '• Help one member of the realm',
      '',
      '**Weekly Kingdom Goal**',
      '• Complete 100 official carries as a community',
      '',
      '_Automated quests, XP, achievements, campaigns, world bosses and seasonal progression are ready to be layered onto this foundation._'
    ].join('\n'));
  return { embeds: [embed] };
}
