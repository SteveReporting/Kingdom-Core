import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder
} from 'discord.js';
import { BRAND } from '../config/blueprint.js';

export const KC4_COLORS = {
  royal: 0xd4af37,
  command: 0x7c3aed,
  success: 0x57f287,
  warning: 0xfee75c,
  danger: 0xed4245,
  economy: 0xf1c40f,
  carrier: 0x3498db,
  security: 0xe74c3c,
  neutral: 0x5865f2
};

export function bar(value, max = 100, width = 10) {
  const safeMax = Math.max(1, Number(max) || 1);
  const ratio = Math.max(0, Math.min(1, (Number(value) || 0) / safeMax));
  const filled = Math.round(ratio * width);
  return `${'▰'.repeat(filled)}${'▱'.repeat(Math.max(0, width - filled))}`;
}

export function compactNumber(n) {
  const value = Number(n) || 0;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return String(value);
}

export function duration(minutes = 0) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return h ? `${h}h ${rest}m` : `${rest}m`;
}

export function panel(title, subtitle, color = KC4_COLORS.royal) {
  return new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: 'KINGDOM CARRIES • REALM OPERATING PLATFORM' })
    .setTitle(title)
    .setDescription(subtitle)
    .setFooter({ text: `${BRAND.footer} • UI vNext` })
    .setTimestamp();
}

export function section(title, body) {
  return `### ${title}\n${body}`;
}

export function metric(name, value, hint = '') {
  return { name, value: `**${value}**${hint ? `\n${hint}` : ''}`, inline: true };
}

export function stateBadge(state) {
  const s = String(state ?? 'NORMAL').toUpperCase();
  if (s === 'LOCKDOWN') return '🔴 LOCKDOWN';
  if (s === 'HIGH') return '🟠 HIGH';
  if (s === 'ELEVATED') return '🟡 ELEVATED';
  if (s === 'WATCH') return '🟣 WATCH';
  return '🟢 NORMAL';
}

export function statusDot(status) {
  return {
    available: '🟢',
    busy: '🟡',
    off: '🔴',
    open: '🟡',
    claimed: '🔵',
    ready: '🟢',
    running: '⚔️',
    completed: '✅',
    pending: '🟡',
    approved: '✅',
    denied: '❌',
    accepted: '✅',
    interview: '💬'
  }[String(status ?? '').toLowerCase()] ?? '⚪';
}

export function button(id, label, emoji, style = ButtonStyle.Secondary, disabled = false) {
  return new ButtonBuilder().setCustomId(id).setLabel(label).setEmoji(emoji).setStyle(style).setDisabled(disabled);
}

export function row(...components) {
  return new ActionRowBuilder().addComponents(...components.filter(Boolean));
}

export function select(id, placeholder, options, { min = 1, max = 1 } = {}) {
  return new StringSelectMenuBuilder()
    .setCustomId(id)
    .setPlaceholder(placeholder)
    .setMinValues(min)
    .setMaxValues(max)
    .addOptions(options.slice(0, 25));
}

export function empty(text = 'Nothing needs attention right now.') {
  return `> ${text}`;
}

export function rankMedal(index) {
  return ['🥇', '🥈', '🥉'][index] ?? `**${index + 1}.**`;
}

export function timestamp(value, style = 'R') {
  const ms = new Date(value ?? Date.now()).getTime();
  return Number.isFinite(ms) ? `<t:${Math.floor(ms / 1000)}:${style}>` : 'Unknown';
}
