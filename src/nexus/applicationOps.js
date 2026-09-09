import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { mutateGuildState, readGuildState } from '../storage/store.js';
import { cleanText, safeRecordId } from './validation.js';

const GRADES = new Set(['S', 'A', 'B', 'C', 'D', 'F']);
const DECISIONS = new Set(['Pending', 'Interview', 'Accepted', 'Denied']);

const CONFIG = {
  staff: {
    label: 'Royal Staff',
    roleEnv: 'STAFF_ACCEPT_ROLE_IDS',
    fallbackRoleKey: 'watchman',
    docs: [['Staff Onboarding', 'STAFF_ONBOARDING_URL'], ['Staff Handbook', 'STAFF_HANDBOOK_URL']]
  },
  carrier: {
    label: 'Knight / Carrier',
    roleEnv: 'CARRIER_ACCEPT_ROLE_IDS',
    fallbackRoleKey: 'squireCarrier',
    docs: [
      ['Knight ORBAT', 'CARRIER_ORBAT_URL'],
      ['Governance', 'CARRIER_GOVERNANCE_URL'],
      ['Recruitment SOP', 'CARRIER_RECRUITMENT_SOP_URL'],
      ['Management SOP', 'CARRIER_MANAGEMENT_SOP_URL'],
      ['Forms & Resources', 'CARRIER_FORMS_URL']
    ]
  },
  creator: {
    label: 'Creator',
    roleEnv: 'CREATOR_ACCEPT_ROLE_IDS',
    fallbackRoleKey: null,
    docs: [['Creator Onboarding', 'CREATOR_ONBOARDING_URL'], ['Creator Guidelines', 'CREATOR_GUIDELINES_URL']]
  }
};

function now() {
  return new Date().toISOString();
}

function reviewRecord(state, appId) {
  const targetId = safeRecordId(appId, 'application id');
  state.applicationReviewVNext ??= {};
  state.applicationReviewVNext[targetId] ??= {
    notes: [],
    grade: null,
    decision: 'Pending',
    claimedBy: null,
    updatedAt: now()
  };
  return state.applicationReviewVNext[targetId];
}

function configFor(type) {
  return CONFIG[String(type ?? 'staff').toLowerCase()] ?? CONFIG.staff;
}

function acceptedRoleIds(config, state) {
  const explicit = String(process.env[config.roleEnv] ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => /^\d{15,22}$/.test(value));
  if (explicit.length) return [...new Set(explicit)];
  const fallback = config.fallbackRoleKey ? state.setup?.roles?.[config.fallbackRoleKey] : null;
  return fallback ? [fallback] : [];
}

async function grantRoles(guild, state, app) {
  const config = configFor(app.type);
  const ids = acceptedRoleIds(config, state);
  const member = await guild.members.fetch(String(app.userId ?? app.discordId)).catch(() => null);
  if (!member) return { member: null, granted: [], failed: ids };
  const granted = [];
  const failed = [];
  for (const id of ids) {
    const role = guild.roles.cache.get(id) ?? await guild.roles.fetch(id).catch(() => null);
    if (!role || !role.editable) {
      failed.push(id);
      continue;
    }
    const ok = await member.roles.add(role, `Nexus application ${app.id} accepted`).then(() => true).catch(() => false);
    (ok ? granted : failed).push(id);
  }
  return { member, granted, failed };
}

function resourceRows(config) {
  const buttons = config.docs
    .map(([label, env]) => [label, process.env[env]])
    .filter(([, url]) => /^https?:\/\//i.test(String(url ?? '')))
    .slice(0, 5)
    .map(([label, url]) => new ButtonBuilder().setLabel(label).setStyle(ButtonStyle.Link).setURL(url));
  return buttons.length ? [new ActionRowBuilder().addComponents(...buttons)] : [];
}

async function dmApplicant(guild, app, review, roleResult) {
  if (review.decision === 'Pending') return false;
  const user = roleResult.member?.user ?? await guild.client.users.fetch(String(app.userId ?? app.discordId)).catch(() => null);
  if (!user) return false;
  const config = configFor(app.type);
  const accepted = review.decision === 'Accepted';
  const interview = review.decision === 'Interview';
  const embed = new EmbedBuilder()
    .setColor(accepted ? 0x57f287 : interview ? 0x5865f2 : 0xed4245)
    .setAuthor({ name: 'KINGDOM CARRIES • APPLICATIONS' })
    .setTitle(accepted ? `Welcome to ${config.label}` : interview ? `${config.label} Application • Interview` : `${config.label} Application Decision`)
    .setDescription(
      accepted
        ? `Your Kingdom Carries application has been **accepted** with grade **${review.grade}**. Your Discord access has been updated where configured. Use the resources below before beginning.`
        : interview
          ? `Your **${config.label}** application has moved to **Interview**. Staff will contact you with the next step.`
          : `Thank you for applying for **${config.label}**. Your application was reviewed and was not accepted this time.`
    )
    .addFields(
      { name: 'Application', value: `\`${cleanText(app.id, 100)}\``, inline: true },
      { name: 'Grade', value: `**${review.grade ?? '—'}**`, inline: true },
      { name: 'Decision', value: `**${review.decision}**`, inline: true },
      ...(review.finalNote ? [{ name: 'Reviewer Message', value: String(review.finalNote).slice(0, 1024) }] : [])
    )
    .setFooter({ text: 'Kingdom Nexus • Kingdom Core' })
    .setTimestamp();
  return user.send({ embeds: [embed], components: accepted ? resourceRows(config) : [] }).then(() => true).catch(() => false);
}

async function postStatus(guild, state, app, review, roleResult, reviewerId, dmSent) {
  const channelId = state.setup?.channels?.applicationStatus;
  const channel = channelId ? guild.channels.cache.get(channelId) : null;
  if (!channel?.isTextBased()) return false;
  const embed = new EmbedBuilder()
    .setColor(review.decision === 'Accepted' ? 0x57f287 : review.decision === 'Denied' ? 0xed4245 : 0x5865f2)
    .setAuthor({ name: 'KINGDOM NEXUS • APPLICATION REVIEW' })
    .setTitle(`Application ${cleanText(app.id, 100)} • ${review.decision}`)
    .setDescription(`<@${app.userId ?? app.discordId}>`)
    .addFields(
      { name: 'Grade', value: String(review.grade ?? '—'), inline: true },
      { name: 'Reviewer', value: `<@${reviewerId}>`, inline: true },
      { name: 'Applicant DM', value: dmSent ? '✅ Delivered' : '⚠️ Not delivered', inline: true },
      { name: 'Roles granted', value: roleResult.granted.length ? roleResult.granted.map((id) => `<@&${id}>`).join(', ') : '_None / manual_' }
    )
    .setTimestamp();
  await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => null);
  return true;
}

export async function addApplicationReviewNote(guildId, appId, reviewerId, text) {
  const targetId = safeRecordId(appId, 'application id');
  const reviewer = cleanText(reviewerId, 100) || 'kingdom-nexus';
  const note = cleanText(text, 1600);
  if (!note) throw Object.assign(new Error('Reviewer note is required.'), { statusCode: 400 });
  return mutateGuildState(guildId, (state) => {
    const app = state.applications?.[targetId];
    if (!app || typeof app !== 'object') throw Object.assign(new Error('Application not found.'), { statusCode: 404 });
    const review = reviewRecord(state, targetId);
    review.notes.push({ authorId: reviewer, text: note, at: now() });
    if (review.notes.length > 100) review.notes = review.notes.slice(-100);
    review.claimedBy ??= reviewer;
    review.updatedAt = now();
    return review;
  });
}

export async function finalizeApplicationReview(guild, appId, reviewerId, input = {}) {
  const targetId = safeRecordId(appId, 'application id');
  const reviewer = cleanText(reviewerId, 100) || 'kingdom-nexus';
  const grade = String(input.grade ?? '').toUpperCase();
  const decisionRaw = String(input.decision ?? '').toLowerCase();
  const decision = decisionRaw === 'accept' || decisionRaw === 'accepted'
    ? 'Accepted'
    : decisionRaw === 'deny' || decisionRaw === 'denied'
      ? 'Denied'
      : decisionRaw === 'interview'
        ? 'Interview'
        : decisionRaw === 'pending'
          ? 'Pending'
          : String(input.decision ?? '');
  if (!GRADES.has(grade)) throw Object.assign(new Error('Grade must be S, A, B, C, D or F.'), { statusCode: 400 });
  if (!DECISIONS.has(decision)) throw Object.assign(new Error('Decision must be Pending, Interview, Accepted or Denied.'), { statusCode: 400 });

  let application = null;
  await mutateGuildState(guild.id, (state) => {
    const app = state.applications?.[targetId];
    if (!app || typeof app !== 'object') throw Object.assign(new Error('Application not found.'), { statusCode: 404 });
    const review = reviewRecord(state, targetId);
    review.grade = grade;
    review.decision = decision;
    review.finalNote = cleanText(input.finalNote ?? input.note, 900);
    review.claimedBy = reviewer;
    review.updatedAt = now();
    review.finalizedAt = ['Accepted', 'Denied'].includes(decision) ? now() : null;
    app.status = decision === 'Accepted' ? 'accepted' : decision === 'Denied' ? 'denied' : decision.toLowerCase();
    app.reviewerId = reviewer;
    app.reviewedAt = now();
    application = { ...app };
  });

  const state = await readGuildState(guild.id);
  const review = state.applicationReviewVNext?.[targetId] ?? {};
  let roleResult = { member: null, granted: [], failed: [] };
  if (decision === 'Accepted') roleResult = await grantRoles(guild, state, application);
  const dmSent = await dmApplicant(guild, application, review, roleResult);
  if (decision !== 'Pending') await postStatus(guild, state, application, review, roleResult, reviewer, dmSent);

  return {
    application,
    review,
    rolesGranted: roleResult.granted,
    rolesFailed: roleResult.failed,
    dmSent
  };
}
