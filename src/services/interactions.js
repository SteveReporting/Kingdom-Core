import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder,
  MessageFlags, ModalBuilder, PermissionFlagsBits, StringSelectMenuBuilder,
  TextInputBuilder, TextInputStyle
} from 'discord.js';
import { BRAND, CARRIER_KEYS, HOUSE_KEYS, STAFF_KEYS } from '../config/blueprint.js';
import { mutateGuildState, readGuildState } from '../storage/store.js';
import { sendBrandedWebhook } from './webhooks.js';

const DUNGEONS = [
  'Desert Temple','Winter Outpost','Pirate Island',"King's Castle",'The Underworld',
  'Samurai Palace','The Canals','Ghastly Harbor','Steampunk Sewers','Orbital Outpost',
  'Volcanic Chambers','Aquatic Temple','Enchanted Forest','Northern Lands','Gilded Skies',
  'Yokai Peak','Current Highest Dungeon','Boss / Event Mode'
];
const DIFFICULTIES = ['Easy','Medium','Hard','Insane','Nightmare','Insane • Hardcore','Nightmare • Hardcore','Boss / Event'];
const TICKET_TYPES = {
  support: ['Support','🛟',0x5865f2], report: ['Member Report','🚨',0xed4245],
  partnership: ['Partnership','🤝',0x57f287], appeal: ['Appeal','⚖️',0xfee75c]
};

const eph = (content) => ({ content, flags: MessageFlags.Ephemeral });
const stateOf = (i) => readGuildState(i.guildId);
const anyRole = (member, ids) => ids.some((id) => id && member?.roles?.cache?.has(id));
function isStaff(member, state) {
  return member?.permissions?.has?.(PermissionFlagsBits.Administrator) ||
    anyRole(member, STAFF_KEYS.map((k) => state.setup?.roles?.[k]).filter(Boolean));
}
function branded(title, color = BRAND.color) {
  return new EmbedBuilder().setColor(color).setTitle(title).setFooter({ text: BRAND.footer }).setTimestamp();
}
function selectRow(id, placeholder, options) {
  return new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
    .setCustomId(id).setPlaceholder(placeholder).setMinValues(1).setMaxValues(1)
    .addOptions(options.map((label, index) => ({ label, value: String(index) }))));
}
function appButtons(id, interviewDisabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`kc:app:review:approve:${id}`).setLabel('Approve').setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`kc:app:review:interview:${id}`).setLabel('Interview').setEmoji('💬').setStyle(ButtonStyle.Primary).setDisabled(interviewDisabled),
    new ButtonBuilder().setCustomId(`kc:app:review:deny:${id}`).setLabel('Deny').setEmoji('✖️').setStyle(ButtonStyle.Danger)
  );
}
function ticketButtons(id) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`kc:ticket:claim:${id}`).setLabel('Claim').setEmoji('🛡️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`kc:ticket:priority:${id}`).setLabel('Escalate').setEmoji('🚨').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`kc:ticket:close2:${id}`).setLabel('Close').setEmoji('🔒').setStyle(ButtonStyle.Secondary)
  );
}

async function refreshQueue(guild, state) {
  state.queue ??= [];
  const channel = guild.channels.cache.get(state.setup?.channels?.carryQueue);
  if (!channel?.isTextBased()) return;
  const waiting = state.queue.filter((x) => x.status === 'waiting').slice(0, 20);
  const active = state.queue.filter((x) => x.status === 'claimed').length;
  const description = waiting.length
    ? waiting.map((x, n) => `**${n + 1}.** <@${x.userId}> — **${x.dungeon}** • ${x.difficulty}`).join('\n')
    : '_The Royal carry queue is currently empty._';
  const embed = branded('⏳ Live Carry Queue').setDescription(description).addFields(
    { name: 'Waiting', value: String(waiting.length), inline: true },
    { name: 'In Progress', value: String(active), inline: true }
  );
  state.setup.panels ??= {};
  let message = state.setup.panels.liveQueue
    ? await channel.messages.fetch(state.setup.panels.liveQueue).catch(() => null) : null;
  if (message) await message.edit({ embeds: [embed], allowedMentions: { parse: [] } });
  else {
    message = await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
    state.setup.panels.liveQueue = message.id;
  }
}

function appQuestions(type) {
  if (type === 'carrier') return [
    ['roblox','Roblox username','Your Roblox username',TextInputStyle.Short,60],
    ['timezone','Timezone','e.g. GMT / EST',TextInputStyle.Short,50],
    ['availability','Availability','When can you normally carry?',TextInputStyle.Paragraph,300],
    ['experience','Carrier / DQ experience','Level, gear, dungeons and experience.',TextInputStyle.Paragraph,500],
    ['why','Why should we accept you?','Keep it specific.',TextInputStyle.Paragraph,500]
  ];
  if (type === 'creator') return [
    ['platform','Main platform','YouTube / TikTok / Twitch / other',TextInputStyle.Short,80],
    ['handle','Creator name / handle','Your public creator name',TextInputStyle.Short,100],
    ['audience','Audience / reach','Followers, views or community size',TextInputStyle.Short,100],
    ['content','What content do you make?','Describe your Dungeon Quest / Roblox content.',TextInputStyle.Paragraph,500],
    ['why','What collaboration do you want?','Events, promotion, videos, partnership, etc.',TextInputStyle.Paragraph,500]
  ];
  return [
    ['timezone','Timezone','e.g. GMT / EST',TextInputStyle.Short,50],
    ['availability','Availability','Days/times you can realistically help.',TextInputStyle.Paragraph,300],
    ['experience','Moderation / staff experience','Servers, roles and responsibilities.',TextInputStyle.Paragraph,500],
    ['scenario','How would you handle conflict?','Give a short example.',TextInputStyle.Paragraph,500],
    ['why','Why Kingdom Carries?','What you bring to the team.',TextInputStyle.Paragraph,500]
  ];
}
function appModal(type) {
  const titles = { staff: 'Royal Staff Application', carrier: 'Knight Application', creator: 'Creator Application' };
  const modal = new ModalBuilder().setCustomId(`kc:app:submit:${type}`).setTitle(titles[type] ?? 'Kingdom Application');
  modal.addComponents(...appQuestions(type).map(([id,label,placeholder,style,maxLength]) =>
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(id).setLabel(label)
      .setPlaceholder(placeholder).setStyle(style).setMaxLength(maxLength).setRequired(true))));
  return modal;
}
function ticketModal(type) {
  const [label, emoji] = TICKET_TYPES[type] ?? TICKET_TYPES.support;
  return new ModalBuilder().setCustomId(`kc:ticket:submit:${type}`).setTitle(`${emoji} ${label}`).addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('summary').setLabel('Short summary')
      .setPlaceholder('What is this ticket about?').setRequired(true).setMaxLength(100).setStyle(TextInputStyle.Short)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('details').setLabel('Full details')
      .setPlaceholder('Give staff the information they need.').setRequired(true).setMaxLength(1500).setStyle(TextInputStyle.Paragraph))
  );
}
function ticketOverwrites(guild, state, userId) {
  const roleIds = state.setup?.roles ?? {};
  const staffIds = new Set(STAFF_KEYS.map((k) => roleIds[k]).filter(Boolean));
  const rows = [
    { id: guild.roles.everyone.id, allow: [PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.ViewChannel] },
    { id: userId, allow: [PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory] }
  ];
  for (const id of new Set(Object.values(roleIds).filter(Boolean))) rows.push(staffIds.has(id)
    ? { id, allow: [PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory] }
    : { id, allow: [PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.ViewChannel] });
  return rows;
}
function ticketEmbed(ticket) {
  const [label, emoji, color] = TICKET_TYPES[ticket.type] ?? TICKET_TYPES.support;
  return branded(`${emoji} ${label} • ${ticket.id}`, ticket.priority === 'high' ? 0xed4245 : color)
    .setDescription(ticket.summary).addFields(
      { name: 'Owner', value: `<@${ticket.userId}>`, inline: true },
      { name: 'Channel', value: ticket.channelId ? `<#${ticket.channelId}>` : 'Unavailable', inline: true },
      { name: 'Status', value: ticket.status ?? 'open', inline: true },
      { name: 'Claimed By', value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : 'Unclaimed', inline: true },
      { name: 'Priority', value: ticket.priority === 'high' ? '🚨 Escalated' : 'Normal', inline: true }
    );
}
async function syncTicket(guild, state, ticket) {
  const channel = guild.channels.cache.get(state.setup?.channels?.ticketOverview);
  if (!channel?.isTextBased()) return;
  const payload = { embeds: [ticketEmbed(ticket)], allowedMentions: { parse: [] } };
  let msg = ticket.overviewMessageId ? await channel.messages.fetch(ticket.overviewMessageId).catch(() => null) : null;
  if (msg) await msg.edit(payload);
  else { msg = await channel.send(payload); ticket.overviewMessageId = msg.id; }
}
async function postAppStatus(guild, state, app) {
  const channel = guild.channels.cache.get(state.setup?.channels?.applicationStatus);
  if (!channel?.isTextBased()) return;
  const colors = { approved: 0x57f287, denied: 0xed4245, interview: 0x5865f2 };
  await channel.send({ embeds: [branded(`📌 Application ${app.status.toUpperCase()}`, colors[app.status] ?? BRAND.color)
    .setDescription(`**${app.type.toUpperCase()}** application • ID \`${app.id}\``).addFields(
      { name: 'Applicant', value: `<@${app.userId}>`, inline: true },
      { name: 'Reviewed By', value: app.reviewerId ? `<@${app.reviewerId}>` : 'Pending', inline: true }
    )], allowedMentions: { parse: [] } }).catch(() => null);
}

async function reviewApplication(interaction, action, id) {
  const initial = await stateOf(interaction);
  if (!isStaff(interaction.member, initial)) return interaction.reply(eph('Only Kingdom staff can review applications.'));
  let app = null, closed = false;
  await mutateGuildState(interaction.guildId, async (state) => {
    state.applications ??= {};
    app = state.applications[id] ?? null;
    if (!app) return;
    if (['approved','denied'].includes(app.status)) { closed = true; return; }
    app.status = action === 'approve' ? 'approved' : action === 'deny' ? 'denied' : 'interview';
    app.reviewerId = interaction.user.id; app.reviewedAt = new Date().toISOString();
  });
  if (!app) return interaction.reply(eph('That application could not be found.'));
  if (closed) return interaction.reply(eph(`That application is already **${app.status}**.`));
  const fresh = await stateOf(interaction);
  if (app.status === 'approved') {
    const key = app.type === 'carrier' ? 'squireCarrier' : app.type === 'staff' ? 'watchman' : null;
    const member = await interaction.guild.members.fetch(app.userId).catch(() => null);
    if (member && key && fresh.setup?.roles?.[key]) await member.roles.add(fresh.setup.roles[key], `Application ${id} approved`).catch(() => null);
  }
  const colors = { approved: 0x57f287, denied: 0xed4245, interview: 0x5865f2 };
  const embed = EmbedBuilder.from(interaction.message.embeds[0]).setColor(colors[app.status] ?? BRAND.color)
    .addFields({ name: 'Review Decision', value: `**${app.status.toUpperCase()}** by <@${interaction.user.id}>` }).setTimestamp();
  await interaction.update({ embeds: [embed], components: app.status === 'interview' ? [appButtons(id,true)] : [], allowedMentions: { parse: [] } });
  await postAppStatus(interaction.guild, fresh, app);
  await sendBrandedWebhook(interaction.guild, fresh, 'registry', { embeds: [branded('📝 Application Decision', colors[app.status] ?? BRAND.color)
    .setDescription(`**${app.type.toUpperCase()}** application \`${id}\` → **${app.status.toUpperCase()}**`).addFields(
      { name: 'Applicant', value: `<@${app.userId}>`, inline: true }, { name: 'Reviewer', value: `<@${interaction.user.id}>`, inline: true }
    )] });
}

export async function handleButton(interaction) {
  const state = await stateOf(interaction), roleIds = state.setup?.roles ?? {};
  if (interaction.customId.startsWith('kc:house:')) {
    const key = interaction.customId.split(':')[2];
    if (!HOUSE_KEYS.includes(key) || !roleIds[key]) return;
    await interaction.member.roles.remove(HOUSE_KEYS.filter((x) => x !== key).map((x) => roleIds[x]).filter(Boolean)).catch(() => null);
    await interaction.member.roles.add(roleIds[key]);
    return interaction.reply(eph(`🏰 You now represent **${interaction.guild.roles.cache.get(roleIds[key])?.name ?? 'your House'}**.`));
  }
  if (interaction.customId.startsWith('kc:role:')) {
    const id = roleIds[interaction.customId.split(':')[2]];
    if (!id) return;
    const role = interaction.guild.roles.cache.get(id), has = interaction.member.roles.cache.has(id);
    if (has) await interaction.member.roles.remove(id); else await interaction.member.roles.add(id);
    return interaction.reply(eph(`${has ? '🔕 Removed' : '🔔 Enabled'} **${role?.name ?? 'notification'}**.`));
  }
  if (interaction.customId === 'kc:carry:join') {
    if ((state.queue ?? []).some((x) => x.userId === interaction.user.id && ['waiting','claimed'].includes(x.status)))
      return interaction.reply(eph('You already have an active carry request.'));
    return interaction.reply({ content: '⚔️ **Step 1/2 — Select your dungeon**', components: [selectRow('kc:carry:dungeon','Choose your Dungeon Quest dungeon',DUNGEONS)], flags: MessageFlags.Ephemeral });
  }
  if (interaction.customId === 'kc:carry:leave') {
    let removed = false;
    await mutateGuildState(interaction.guildId, async (s) => {
      s.queue ??= []; for (const x of s.queue) if (x.userId === interaction.user.id && x.status === 'waiting') { x.status='cancelled'; x.cancelledAt=new Date().toISOString(); removed=true; }
      s.pendingCarries ??= {}; delete s.pendingCarries[interaction.user.id]; await refreshQueue(interaction.guild,s);
    });
    return interaction.reply(eph(removed ? '✖️ Your carry request was removed.' : 'You do not have a waiting carry request.'));
  }
  if (interaction.customId === 'kc:carry:claim') {
    if (!anyRole(interaction.member,CARRIER_KEYS.map((k)=>roleIds[k]).filter(Boolean))) return interaction.reply(eph('Only Kingdom carriers can claim carry requests.'));
    let claimed = null;
    await mutateGuildState(interaction.guildId, async (s) => {
      s.queue ??= []; claimed = s.queue.find((x)=>x.status==='waiting') ?? null;
      if (claimed) { claimed.status='claimed'; claimed.carrierId=interaction.user.id; claimed.claimedAt=new Date().toISOString(); }
      await refreshQueue(interaction.guild,s);
    });
    if (!claimed) return interaction.reply(eph('The carry queue is empty.'));
    const assignments = interaction.guild.channels.cache.get(state.setup?.channels?.carrierAssignments);
    if (assignments?.isTextBased()) await assignments.send({ content:`⚔️ <@${interaction.user.id}> claimed <@${claimed.userId}> — **${claimed.dungeon}** • ${claimed.difficulty}`, allowedMentions:{parse:[]} });
    return interaction.reply({ content:`🛡️ You claimed <@${claimed.userId}> — **${claimed.dungeon}** • ${claimed.difficulty}`,
      components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`kc:carry:complete:${claimed.id}`).setLabel('Mark Complete').setEmoji('✅').setStyle(ButtonStyle.Success))], flags:MessageFlags.Ephemeral });
  }
  if (interaction.customId.startsWith('kc:carry:complete:')) {
    if (!anyRole(interaction.member,CARRIER_KEYS.map((k)=>roleIds[k]).filter(Boolean))) return interaction.reply(eph('Only Kingdom carriers can complete a carry.'));
    const id=interaction.customId.split(':')[3]; let done=null, wrong=false;
    await mutateGuildState(interaction.guildId, async (s)=>{
      s.queue??=[]; const x=s.queue.find((q)=>q.id===id&&q.status==='claimed');
      if (x && x.carrierId!==interaction.user.id && !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) { wrong=true; return; }
      done=x??null; if(done){done.status='completed';done.completedAt=new Date().toISOString();s.stats??={};s.stats.completedCarries=(s.stats.completedCarries??0)+1;} await refreshQueue(interaction.guild,s);
    });
    if(wrong) return interaction.reply(eph('Only the carrier who claimed this run (or an administrator) can complete it.'));
    if(!done) return interaction.reply(eph('That carry is already closed or could not be found.'));
    const results=interaction.guild.channels.cache.get(state.setup?.channels?.carryResults);
    if(results?.isTextBased()) await results.send({content:`✅ <@${done.userId}> completed **${done.dungeon}** • ${done.difficulty} with <@${interaction.user.id}>.`,allowedMentions:{parse:[]}});
    const fresh=await stateOf(interaction); await sendBrandedWebhook(interaction.guild,fresh,'dispatch',{embeds:[branded('⚔️ Carry Mission Complete',0x57f287).setDescription(`**${done.dungeon}** • ${done.difficulty}`).addFields({name:'Member',value:`<@${done.userId}>`,inline:true},{name:'Knight',value:`<@${interaction.user.id}>`,inline:true})]});
    return interaction.update({content:`✅ Carry completed for <@${done.userId}>.`,components:[]});
  }
  if (interaction.customId.startsWith('kc:app:start:')) {
    const type=interaction.customId.split(':')[3]; if(!['staff','carrier','creator'].includes(type)) return;
    if(Object.values(state.applications??{}).some((a)=>a.userId===interaction.user.id&&a.type===type&&['pending','interview'].includes(a.status))) return interaction.reply(eph(`You already have an active **${type}** application.`));
    return interaction.showModal(appModal(type));
  }
  if (interaction.customId.startsWith('kc:app:review:')) {
    const [, , , action, id]=interaction.customId.split(':'); return reviewApplication(interaction,action,id);
  }
  if (interaction.customId.startsWith('kc:ticket:new:')) {
    const type=interaction.customId.split(':')[3]; if(TICKET_TYPES[type]) return interaction.showModal(ticketModal(type)); return;
  }
  if (interaction.customId === 'kc:ticket:open') return interaction.showModal(ticketModal('support'));
  if (interaction.customId.startsWith('kc:ticket:claim:')) {
    if(!isStaff(interaction.member,state)) return interaction.reply(eph('Only staff can claim a petition.'));
    const id=interaction.customId.split(':')[3]; let ticket=null;
    await mutateGuildState(interaction.guildId,async(s)=>{ticket=s.tickets?.[id]??null;if(ticket&&ticket.status!=='closed'){ticket.claimedBy??=interaction.user.id;ticket.updatedAt=new Date().toISOString();await syncTicket(interaction.guild,s,ticket);}});
    return interaction.reply(ticket?{content:`🛡️ Ticket claimed by <@${ticket.claimedBy}>.`,allowedMentions:{parse:[]}}:eph('Ticket not found.'));
  }
  if (interaction.customId.startsWith('kc:ticket:priority:')) {
    if(!isStaff(interaction.member,state)) return interaction.reply(eph('Only staff can escalate a petition.'));
    const id=interaction.customId.split(':')[3]; let ticket=null;
    await mutateGuildState(interaction.guildId,async(s)=>{ticket=s.tickets?.[id]??null;if(ticket&&ticket.status!=='closed'){ticket.priority='high';ticket.updatedAt=new Date().toISOString();await syncTicket(interaction.guild,s,ticket);}});
    return interaction.reply(eph(ticket?'🚨 Ticket escalated to high priority.':'Ticket not found.'));
  }
  if (interaction.customId.startsWith('kc:ticket:close2:')) {
    const id=interaction.customId.split(':')[3]; let ticket=null,allowed=false;
    await mutateGuildState(interaction.guildId,async(s)=>{ticket=s.tickets?.[id]??null;if(!ticket)return;allowed=interaction.user.id===ticket.userId||isStaff(interaction.member,s);if(!allowed||ticket.status==='closed')return;ticket.status='closed';ticket.closedBy=interaction.user.id;ticket.closedAt=new Date().toISOString();ticket.updatedAt=ticket.closedAt;await syncTicket(interaction.guild,s,ticket);});
    if(!ticket)return interaction.reply(eph('Ticket not found.')); if(!allowed)return interaction.reply(eph('Only the ticket owner or Kingdom staff can close this petition.'));
    const archive=interaction.guild.channels.cache.get(state.setup?.channels?.ticketTranscripts), [label,,color]=TICKET_TYPES[ticket.type]??TICKET_TYPES.support;
    if(archive?.isTextBased()) await archive.send({embeds:[branded(`🧾 Closed Ticket • ${ticket.id}`,color).setDescription(ticket.summary).addFields({name:'Owner',value:`<@${ticket.userId}>`,inline:true},{name:'Closed By',value:`<@${interaction.user.id}>`,inline:true},{name:'Type',value:label,inline:true},{name:'Details',value:ticket.details.slice(0,1024)})],allowedMentions:{parse:[]}}).catch(()=>null);
    await interaction.reply({content:'🔒 Petition closed. This channel is now read-only.'}); await interaction.channel?.permissionOverwrites?.edit(ticket.userId,{SendMessages:false,ReadMessageHistory:true}).catch(()=>null);
    if(interaction.channel?.name&&!interaction.channel.name.startsWith('closed-')) await interaction.channel.setName(`closed-${interaction.channel.name}`.slice(0,100)).catch(()=>null); return;
  }
  if (interaction.customId.startsWith('kc:ticket:close:')) {
    if(!interaction.channel||interaction.channel.type!==ChannelType.GuildText)return; const ownerId=interaction.customId.split(':')[3];
    if(interaction.user.id!==ownerId&&!isStaff(interaction.member,state))return interaction.reply(eph('You cannot close this petition.'));
    await interaction.reply({content:'🔒 Petition closed. This channel is now read-only.'}); await interaction.channel.permissionOverwrites.edit(ownerId,{SendMessages:false,ReadMessageHistory:true}).catch(()=>null);
    if(!interaction.channel.name.startsWith('closed-'))await interaction.channel.setName(`closed-${interaction.channel.name}`.slice(0,100)).catch(()=>null);
  }
}

export async function handleSelect(interaction) {
  if(interaction.customId==='kc:carry:dungeon'){
    const dungeon=DUNGEONS[Number(interaction.values[0])]; if(!dungeon)return;
    await mutateGuildState(interaction.guildId,async(s)=>{s.pendingCarries??={};s.pendingCarries[interaction.user.id]={dungeon,createdAt:new Date().toISOString()};});
    return interaction.update({content:`⚔️ **Step 2/2 — ${dungeon}**\nNow select your difficulty / mode.`,components:[selectRow('kc:carry:difficulty','Choose difficulty / hardcore mode',DIFFICULTIES)]});
  }
  if(interaction.customId==='kc:carry:difficulty'){
    const difficulty=DIFFICULTIES[Number(interaction.values[0])]; let dungeon=null,existing=false,position=0;
    await mutateGuildState(interaction.guildId,async(s)=>{s.queue??=[];s.pendingCarries??={};dungeon=s.pendingCarries[interaction.user.id]?.dungeon??null;if(!dungeon)return;existing=s.queue.some((x)=>x.userId===interaction.user.id&&['waiting','claimed'].includes(x.status));if(!existing){s.queue.push({id:`${Date.now()}-${interaction.user.id}`,userId:interaction.user.id,dungeon,difficulty,status:'waiting',createdAt:new Date().toISOString()});position=s.queue.filter((x)=>x.status==='waiting').length;}delete s.pendingCarries[interaction.user.id];await refreshQueue(interaction.guild,s);});
    if(!dungeon)return interaction.update({content:'That carry selection expired. Press **Request Carry** again.',components:[]});
    return interaction.update({content:existing?'You already have an active carry request.':`✅ Added to the Royal queue.\n**Dungeon:** ${dungeon}\n**Difficulty:** ${difficulty}\n**Queue position:** ${position}`,components:[]});
  }
}

export async function handleModal(interaction) {
  if(interaction.customId.startsWith('kc:app:submit:')){
    const type=interaction.customId.split(':')[3]; if(!['staff','carrier','creator'].includes(type))return;
    const answers=Object.fromEntries(appQuestions(type).map(([id,label])=>[label,interaction.fields.getTextInputValue(id).trim()])); let duplicate=false,app=null;
    await mutateGuildState(interaction.guildId,async(s)=>{s.applications??={};duplicate=Object.values(s.applications).some((a)=>a.userId===interaction.user.id&&a.type===type&&['pending','interview'].includes(a.status));if(duplicate)return;const id=`${Date.now().toString(36)}${interaction.user.id.slice(-4)}`;app={id,type,userId:interaction.user.id,username:interaction.user.username,answers,status:'pending',createdAt:new Date().toISOString()};s.applications[id]=app;});
    if(duplicate)return interaction.reply(eph(`You already have an active **${type}** application.`)); const state=await stateOf(interaction), review=interaction.guild.channels.cache.get(state.setup?.channels?.applicationsReview);
    if(!review?.isTextBased())return interaction.reply(eph('The application review desk is unavailable. Ask an administrator to run `/setup2`.'));
    const labels={staff:'Royal Staff',carrier:'Knight / Carrier',creator:'Creator'}; const embed=branded(`📝 ${labels[type]} Application • ${app.id}`).setDescription(`Applicant: <@${interaction.user.id}> • \`${interaction.user.id}\``).addFields(...Object.entries(answers).map(([name,value])=>({name,value:value.slice(0,1024)})),{name:'Status',value:'**PENDING REVIEW**'});
    const msg=await review.send({embeds:[embed],components:[appButtons(app.id)],allowedMentions:{parse:[]}}); await mutateGuildState(interaction.guildId,async(s)=>{if(s.applications?.[app.id]){s.applications[app.id].reviewMessageId=msg.id;s.applications[app.id].reviewChannelId=review.id;}});
    return interaction.reply(eph(`✅ Your **${labels[type]}** application was submitted. ID: \`${app.id}\``));
  }
  if(interaction.customId.startsWith('kc:ticket:submit:')){
    const type=interaction.customId.split(':')[3], [label,emoji,color]=TICKET_TYPES[type]??TICKET_TYPES.support;
    const summary=interaction.fields.getTextInputValue('summary').trim(),details=interaction.fields.getTextInputValue('details').trim(),state=await stateOf(interaction);
    const open=Object.values(state.tickets??{}).find((t)=>t.userId===interaction.user.id&&t.status==='open'); if(open)return interaction.reply(eph(`You already have an open petition: <#${open.channelId}>`));
    const safe=interaction.user.username.toLowerCase().replace(/[^a-z0-9-]/g,'').slice(0,28)||interaction.user.id.slice(-8), id=`${Date.now().toString(36)}${interaction.user.id.slice(-4)}`;
    const channel=await interaction.guild.channels.create({name:`${type}-${safe}`.slice(0,100),type:ChannelType.GuildText,parent:state.setup?.categories?.tickets,topic:`Kingdom Core ticket ${id} • ${type} • owner ${interaction.user.id}`,permissionOverwrites:ticketOverwrites(interaction.guild,state,interaction.user.id),reason:`Kingdom Core ${label} ticket`});
    const ticket={id,type,userId:interaction.user.id,channelId:channel.id,summary,details,status:'open',priority:'normal',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
    const header=await channel.send({content:`<@${interaction.user.id}>`,embeds:[branded(`${emoji} ${label} • ${id}`,color).setDescription(`**${summary}**\n\n${details}\n\n━━━━━━━━━━━━━━━━━━━━\nA staff member can **claim** this ticket. Use **Escalate** only when genuinely urgent.`).addFields({name:'Petitioner',value:`<@${interaction.user.id}>`,inline:true})],components:[ticketButtons(id)],allowedMentions:{users:[interaction.user.id],roles:[]}}); ticket.headerMessageId=header.id;
    await mutateGuildState(interaction.guildId,async(s)=>{s.tickets??={};s.tickets[id]=ticket;await syncTicket(interaction.guild,s,ticket);}); return interaction.reply(eph(`🎫 Your private ${label.toLowerCase()} ticket is open: <#${channel.id}>`));
  }
  if(interaction.customId==='kc:carry:joinModal') return interaction.reply(eph('The carry system has been upgraded. Use **Request Carry** on the current carry panel.'));
}
