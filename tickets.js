const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder,
  ButtonStyle, ModalBuilder, TextInputBuilder,
  TextInputStyle, PermissionFlagsBits, ChannelType,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder
} = require('discord.js');

const db = require('./database');

// ─── Priority config ─────────────────────────────────────────────────────────
const PRIORITY = {
  low:    { emoji: '🟢', label: 'منخفضة', color: '#22c55e' },
  normal: { emoji: '🔴', label: 'عادية',  color: '#dc2626' },
  high:   { emoji: '🟡', label: 'عالية',  color: '#f59e0b' },
  urgent: { emoji: '🔴', label: 'عاجلة',  color: '#ef4444' }
};

function combineLabel(label, fallback, emoji = '') {
  const base = (label && String(label).trim()) || fallback;
  const icon = (emoji && String(emoji).trim()) || '';
  return icon ? `${icon} ${base}` : base;
}

// ════════════════════════════════════════════════════════════════════════════
//  MAIN INTERACTION ROUTER
// ════════════════════════════════════════════════════════════════════════════
async function handleInteraction(interaction, client) {
  const { handleCommand } = require('./commands');

  // ─── Slash Commands ───────────────────────────────────────────────────
  if (interaction.isChatInputCommand()) {
    return handleCommand(interaction, client);
  }

  const id = interaction.customId || '';

  // ─── Buttons ──────────────────────────────────────────────────────────
  if (interaction.isButton()) {
    if (id.startsWith('open_ticket:'))    return handleOpenTicket(interaction, client);
    if (id.startsWith('close_ticket:'))   return handleCloseTicket(interaction, client);
    if (id.startsWith('claim_ticket:'))   return handleClaimTicket(interaction, client);
    if (id.startsWith('confirm_close:'))  return handleConfirmClose(interaction, client);
    if (id.startsWith('cancel_close:'))   return interaction.update({ components: [] });
    if (id.startsWith('rate_ticket:'))    return handleRateTicket(interaction, client);
  }

  // ─── Modals ───────────────────────────────────────────────────────────
  if (interaction.isModalSubmit()) {
    if (id.startsWith('modal_open:'))     return handleOpenModal(interaction, client);
    if (id.startsWith('modal_close:'))    return handleCloseModal(interaction, client);
  }

  // ─── Select Menus ─────────────────────────────────────────────────────
  if (interaction.isStringSelectMenu()) {
    if (id.startsWith('priority_select:')) return handlePrioritySelect(interaction, client);
    if (id.startsWith('rating_select:'))   return handleRatingSelect(interaction, client);
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  OPEN TICKET
// ════════════════════════════════════════════════════════════════════════════
async function handleOpenTicket(interaction, client) {
  const panelId = interaction.customId.split(':')[1];
  const panel   = await db.getPanel(panelId);
  if (!panel) return interaction.reply({ content: '❌ اللوحة غير موجودة.', ephemeral: true });

  const guildId  = interaction.guild.id;
  const userId   = interaction.user.id;

  // Ban check
  const ban = await db.isBanned(guildId, userId);
  if (ban) {
    const embed = new EmbedBuilder()
      .setColor('#ef4444')
      .setTitle('🚫 أنت محظور من فتح التذاكر')
      .addFields(
        { name: 'السبب', value: ban.reason || 'لم يُذكر', inline: true },
        { name: 'حتى',   value: ban.expires_at ? `<t:${Math.floor(new Date(ban.expires_at)/1000)}:R>` : 'دائماً', inline: true }
      );
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  // Ticket limit
  const guildData = await db.getGuild(guildId);
  const open      = await db.getOpenTicketsByUser(guildId, userId);
  if (open.length >= (guildData?.max_tickets_per_user || 1)) {
    return interaction.reply({
      content: `❌ لديك بالفعل **${open.length}** تذكرة مفتوحة. يُرجى إغلاقها أولاً.`,
      ephemeral: true
    });
  }

  // If panel requires a reason, show modal
  if (panel.require_reason) {
    const modal = new ModalBuilder()
      .setCustomId(`modal_open:${panelId}`)
      .setTitle('سبب فتح التذكرة');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('reason')
          .setLabel('ما هو سبب فتح التذكرة؟')
          .setStyle(TextInputStyle.Paragraph)
          .setMinLength(10).setMaxLength(500).setRequired(true)
      )
    );
    return interaction.showModal(modal);
  }

  await createTicketChannel(interaction, client, panel, null);
}

async function handleOpenModal(interaction, client) {
  const panelId = interaction.customId.split(':')[1];
  const panel   = await db.getPanel(panelId);
  const reason  = interaction.fields.getTextInputValue('reason');
  await createTicketChannel(interaction, client, panel, reason);
}

async function createTicketChannel(interaction, client, panel, reason) {
  await interaction.deferReply({ ephemeral: true });

  const guild  = interaction.guild;
  const user   = interaction.user;
  const ticket = await db.getOpenTicketsByUser(guild.id, user.id);
  const num    = (await db.getTicketsByGuild(guild.id)).length + 1;
  const name   = `ticket-${String(num).padStart(4, '0')}`;

  // Permission overrides
  const permissionOverwrites = [
    { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
    { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
    { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory] }
  ];

  // Add all staff members as viewers
  const staffList = await db.getStaff(guild.id);
  for (const s of staffList) {
    permissionOverwrites.push({
      id: s.user_id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
    });
  }

  const channel = await guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: panel.category_open || undefined,
    permissionOverwrites
  });

  const newTicket = await db.createTicket(guild.id, panel.id, channel.id, user.id, reason);

  // Welcome message
  const welcomeText = panel.welcome_message
    .replace('{user}', `<@${user.id}>`)
    .replace('{panel}', panel.name)
    .replace('{ticket}', `#${newTicket.id}`);

  const p      = PRIORITY.normal;
  const embed  = new EmbedBuilder()
    .setColor(panel.embed_color || p.color || '#dc2626')
    .setTitle(`🧾 تذكرة #${newTicket.id}`)
    .setDescription(welcomeText)
    .addFields(
      { name: '👤 المستخدم', value: `<@${user.id}>`, inline: true },
      { name: '📋 اللوحة',   value: panel.name,       inline: true },
      { name: '🔵 الأولوية', value: `${p.emoji} ${p.label}`, inline: true }
    );

  if (reason) embed.addFields({ name: '📝 السبب', value: reason });
  embed.setTimestamp().setFooter({ text: `SkyTicket Crimson • ${guild.name}` });

  // Control buttons
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`close_ticket:${channel.id}`).setLabel(combineLabel(panel.close_button_label, 'إغلاق')).setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`claim_ticket:${channel.id}`).setLabel(combineLabel(panel.claim_button_label, 'استلام')).setStyle(ButtonStyle.Success)
  );

  // Priority select
  const row2 = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`priority_select:${channel.id}`)
      .setPlaceholder(panel.priority_placeholder || 'تغيير الأولوية...')
      .addOptions(
        new StringSelectMenuOptionBuilder().setLabel('🟢 منخفضة').setValue('low'),
        new StringSelectMenuOptionBuilder().setLabel('🔴 عادية').setValue('normal'),
        new StringSelectMenuOptionBuilder().setLabel('🟡 عالية').setValue('high'),
        new StringSelectMenuOptionBuilder().setLabel('🔴 عاجلة (urgent)').setValue('urgent')
      )
  );

  // Ping mention_role if set
  let content = '';
  if (panel.mention_role) content = `<@&${panel.mention_role}>`;

  await channel.send({ content, embeds: [embed], components: [row1, row2] });

  await db.addLog(guild.id, 'TICKET_OPEN', user.id, null, { ticket_id: newTicket.id, panel_id: panel.id });
  await interaction.editReply({ content: `✅ تم فتح تذكرتك: ${channel}` });
}

// ════════════════════════════════════════════════════════════════════════════
//  CLAIM TICKET
// ════════════════════════════════════════════════════════════════════════════
async function handleClaimTicket(interaction, client) {
  const channelId = interaction.customId.split(':')[1];
  const ticket    = await db.getTicket(channelId);
  if (!ticket) return interaction.reply({ content: '❌ التذكرة غير موجودة.', ephemeral: true });
  if (ticket.status === 'closed') return interaction.reply({ content: '❌ هذه التذكرة مغلقة.', ephemeral: true });

  const staffCheck = await db.isStaff(interaction.guild.id, interaction.user.id);
  const isAdmin    = interaction.member.permissions.has('Administrator');
  if (!staffCheck && !isAdmin) return interaction.reply({ content: '❌ هذا الزر للدعم فقط.', ephemeral: true });

  if (ticket.claimed_by && ticket.claimed_by !== interaction.user.id)
    return interaction.reply({ content: `❌ هذه التذكرة مُستلمة بالفعل من <@${ticket.claimed_by}>.`, ephemeral: true });

  await db.claimTicket(channelId, interaction.user.id);

  const embed = new EmbedBuilder()
    .setColor('#dc2626')
    .setDescription(`✅ تم استلام التذكرة بواسطة ${interaction.user}\n\nسيتم مساعدتك في أقرب وقت ممكن.`);

  await interaction.update({ components: [] });
  await interaction.channel.send({ embeds: [embed] });
  await db.addLog(interaction.guild.id, 'TICKET_CLAIM', interaction.user.id, ticket.user_id, { ticket_id: ticket.id });
}

// ════════════════════════════════════════════════════════════════════════════
//  CLOSE TICKET
// ════════════════════════════════════════════════════════════════════════════
async function handleCloseTicket(interaction, client) {
  const channelId = interaction.customId.split(':')[1];
  const ticket    = await db.getTicket(channelId);
  if (!ticket) return interaction.reply({ content: '❌ التذكرة غير موجودة.', ephemeral: true });
  if (ticket.status === 'closed') return interaction.reply({ content: '❌ هذه التذكرة مغلقة بالفعل.', ephemeral: true });

  const guildData  = await db.getGuild(interaction.guild.id);
  const isOwner    = interaction.user.id === ticket.user_id;
  const staffCheck = await db.isStaff(interaction.guild.id, interaction.user.id);
  const isAdmin    = interaction.member.permissions.has('Administrator');

  if (!isOwner && !staffCheck && !isAdmin)
    return interaction.reply({ content: '❌ ليس لديك صلاحية إغلاق هذه التذكرة.', ephemeral: true });

  // If close reason is required, show modal
  if (guildData?.require_close_reason && (staffCheck || isAdmin)) {
    const modal = new ModalBuilder()
      .setCustomId(`modal_close:${channelId}`)
      .setTitle('سبب إغلاق التذكرة');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('reason')
          .setLabel('سبب الإغلاق')
          .setStyle(TextInputStyle.Paragraph)
          .setMinLength(5).setMaxLength(500).setRequired(true)
      )
    );
    return interaction.showModal(modal);
  }

  // Confirm close
  const embed = new EmbedBuilder()
    .setColor('#f59e0b')
    .setTitle('⚠️ تأكيد الإغلاق')
    .setDescription('هل أنت متأكد من إغلاق هذه التذكرة؟');

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`confirm_close:${channelId}:`).setLabel(panel?.confirm_close_label || 'نعم، أغلق').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`cancel_close:${channelId}`).setLabel(panel?.cancel_close_label || 'إلغاء').setStyle(ButtonStyle.Secondary)
  );

  return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
}

async function handleCloseModal(interaction, client) {
  const channelId = interaction.customId.split(':')[1];
  const reason    = interaction.fields.getTextInputValue('reason');
  await doClose(interaction, client, channelId, reason);
}

async function handleConfirmClose(interaction, client) {
  const parts     = interaction.customId.split(':');
  const channelId = parts[1];
  const reason    = parts[2] || null;
  await interaction.update({ components: [] });
  await doClose(interaction, client, channelId, reason);
}

async function doClose(interaction, client, channelId, reason = null) {
  const ticket = await db.getTicket(channelId);
  if (!ticket || ticket.status === 'closed') return;

  const channel = interaction.guild.channels.cache.get(channelId) || interaction.channel;
  const panel   = ticket.panel_id ? await db.getPanel(ticket.panel_id) : null;

  // Save transcript
  let transcriptContent = '';
  try {
    const { createTranscript } = require('discord-html-transcripts');
    const file = await createTranscript(channel);
    transcriptContent = file.attachment?.toString('utf-8') || '';
    await db.saveTranscript(ticket.id, interaction.guild.id, transcriptContent);
  } catch {}

  await db.closeTicket(channelId, reason, ticket.claimed_by);

  if (ticket.claimed_by)
    await db.incrementStaffClosed(interaction.guild.id, ticket.claimed_by);

  await db.addLog(interaction.guild.id, 'TICKET_CLOSE', interaction.user.id, ticket.user_id, {
    ticket_id: ticket.id, reason
  });

  // DM user if panel.dm_on_close
  if (panel?.dm_on_close) {
    const { dmTranscript } = require('./bot');
    await dmTranscript(ticket.user_id, { ...ticket, close_reason: reason }, transcriptContent, interaction.guild.name);
  }

  // Closing embed + rating
  const embed = new EmbedBuilder()
    .setColor('#dc2626')
    .setTitle('🔒 تم إغلاق التذكرة')
    .setDescription(`شكراً على تواصلك معنا!\n${panel?.close_message || ''}`)
    .setTimestamp();
  if (reason) embed.addFields({ name: 'سبب الإغلاق', value: reason });

  const ratingRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`rating_select:${channelId}`)
      .setPlaceholder(panel?.rating_placeholder || 'قيّم تجربتك (اختياري)')
      .addOptions(
        new StringSelectMenuOptionBuilder().setLabel('⭐ 1 - ضعيف').setValue('1'),
        new StringSelectMenuOptionBuilder().setLabel('⭐⭐ 2 - مقبول').setValue('2'),
        new StringSelectMenuOptionBuilder().setLabel('⭐⭐⭐ 3 - جيد').setValue('3'),
        new StringSelectMenuOptionBuilder().setLabel('⭐⭐⭐⭐ 4 - ممتاز').setValue('4'),
        new StringSelectMenuOptionBuilder().setLabel('⭐⭐⭐⭐⭐ 5 - رائع').setValue('5')
      )
  );

  await channel.send({ embeds: [embed], components: [ratingRow] });

  // Move to closed category, lock channel
  if (panel?.category_close) {
    await channel.setParent(panel.category_close, { lockPermissions: false }).catch(() => {});
  }
  await channel.permissionOverwrites.edit(ticket.user_id, {
    SendMessages: false
  }).catch(() => {});

  // Send to log channel
  const { sendLog } = require('./bot');
  const logEmbed = new EmbedBuilder()
    .setColor('#ef4444')
    .setTitle('🔒 تذكرة مغلقة')
    .addFields(
      { name: 'التذكرة',    value: `#${ticket.id}`,            inline: true },
      { name: 'المستخدم',   value: `<@${ticket.user_id}>`,      inline: true },
      { name: 'المغلق من',  value: `<@${interaction.user.id}>`, inline: true }
    );
  if (reason) logEmbed.addFields({ name: 'السبب', value: reason });
  await sendLog(interaction.guild.id, logEmbed);
}

// ════════════════════════════════════════════════════════════════════════════
//  PRIORITY SELECT
// ════════════════════════════════════════════════════════════════════════════
async function handlePrioritySelect(interaction, client) {
  const channelId = interaction.customId.split(':')[1];
  const staffCheck = await db.isStaff(interaction.guild.id, interaction.user.id);
  const isAdmin    = interaction.member.permissions.has('Administrator');
  if (!staffCheck && !isAdmin) return interaction.reply({ content: '❌ هذا الخيار للدعم فقط.', ephemeral: true });

  const level  = interaction.values[0];
  const p      = PRIORITY[level];
  await db.setTicketPriority(channelId, level);

  const embed = new EmbedBuilder()
    .setColor(p.color)
    .setDescription(`📌 **الأولوية:** ${p.emoji} ${p.label} — بواسطة ${interaction.user}`);

  await interaction.reply({ embeds: [embed] });
}

// ════════════════════════════════════════════════════════════════════════════
//  RATING SELECT
// ════════════════════════════════════════════════════════════════════════════
async function handleRatingSelect(interaction, client) {
  const channelId = interaction.customId.split(':')[1];
  const ticket    = await db.getTicket(channelId);
  if (!ticket) return interaction.update({ components: [] });

  // Only the ticket owner can rate
  if (interaction.user.id !== ticket.user_id)
    return interaction.reply({ content: '❌ فقط صاحب التذكرة يمكنه التقييم.', ephemeral: true });

  const rating = parseInt(interaction.values[0]);
  await db.rateTicket(channelId, rating);

  if (ticket.claimed_by) {
    await db.incrementStaffClosed(interaction.guild.id, ticket.claimed_by, rating);
  }

  const stars  = '⭐'.repeat(rating);
  const embed  = new EmbedBuilder()
    .setColor('#f59e0b')
    .setDescription(`${stars} شكراً على تقييمك! **(${rating}/5)**\nتقييمك يساعدنا على تحسين خدمتنا.`);

  await interaction.update({ components: [] });
  await interaction.channel.send({ embeds: [embed] });
}

// ─── Export ────────────────────────────────────────────────────────────────
module.exports = { handleInteraction, sendPanelEmbed: require('./commands').sendPanelEmbed };
