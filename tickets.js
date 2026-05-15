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
  normal: { emoji: '🔵', label: 'عادية',  color: '#3b82f6' },  // FIX: was 🔴 red (confusing)
  high:   { emoji: '🟡', label: 'عالية',  color: '#f59e0b' },
  urgent: { emoji: '🔴', label: 'عاجلة',  color: '#ef4444' }
};

function combineLabel(label, fallback, emoji = '') {
  const base = (label && String(label).trim()) || fallback;
  const icon = (emoji && String(emoji).trim()) || '';
  return icon ? `${icon} ${base}` : base;
}

// ─── Staff check: DB table OR guild role ──────────────────────────────────────
async function checkStaff(guildId, member) {
  const roleIds = [...member.roles.cache.keys()];
  return db.isStaffOrHasRole(guildId, member.id, roleIds);
}

// ─── Build ticket control row (open / unclaimed state) ────────────────────────
function buildOpenRow(channelId, panel) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`close_ticket:${channelId}`)
      .setLabel(combineLabel(panel?.close_button_label, 'إغلاق'))
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`claim_ticket:${channelId}`)
      .setLabel(combineLabel(panel?.claim_button_label, 'استلام'))
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`settings_ticket:${channelId}`)
      .setLabel('⚙️ الإعدادات')
      .setStyle(ButtonStyle.Secondary)
  );
}

// ─── Build ticket control row (claimed state) ─────────────────────────────────
function buildClaimedRow(channelId, panel) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`close_ticket:${channelId}`)
      .setLabel(combineLabel(panel?.close_button_label, 'إغلاق'))
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`unclaim_ticket:${channelId}`)
      .setLabel('↩️ إلغاء الاستلام')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`settings_ticket:${channelId}`)
      .setLabel('⚙️ الإعدادات')
      .setStyle(ButtonStyle.Secondary)
  );
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
    if (id.startsWith('open_ticket:'))     return handleOpenTicket(interaction, client);
    if (id.startsWith('close_ticket:'))    return handleCloseTicket(interaction, client);
    if (id.startsWith('claim_ticket:'))    return handleClaimTicket(interaction, client);
    if (id.startsWith('unclaim_ticket:'))  return handleUnclaimTicket(interaction, client);
    if (id.startsWith('settings_ticket:')) return handleSettingsTicket(interaction, client);
    if (id.startsWith('rename_ticket:'))   return handleRenameTicketBtn(interaction, client);
    if (id.startsWith('ping_owner:'))      return handlePingOwner(interaction, client);
    if (id.startsWith('confirm_close:'))   return handleConfirmClose(interaction, client);
    if (id.startsWith('cancel_close:'))    return interaction.update({ components: [] });
    if (id.startsWith('delete_ticket:'))   return handleDeleteTicket(interaction, client);
    if (id.startsWith('confirm_delete:'))  return handleConfirmDelete(interaction, client);
    if (id.startsWith('cancel_delete:'))   return interaction.update({ content: '↩️ تم إلغاء الحذف.', embeds: [], components: [] });
  }

  // ─── Modals ───────────────────────────────────────────────────────────
  if (interaction.isModalSubmit()) {
    if (id.startsWith('modal_open:'))   return handleOpenModal(interaction, client);
    if (id.startsWith('modal_close:'))  return handleCloseModal(interaction, client);
    if (id.startsWith('modal_rename:')) return handleRenameModal(interaction, client);
  }

  // ─── Select Menus ─────────────────────────────────────────────────────
  if (interaction.isStringSelectMenu()) {
    if (id.startsWith('rating_select:')) return handleRatingSelect(interaction, client);
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  OPEN TICKET
// ════════════════════════════════════════════════════════════════════════════
async function handleOpenTicket(interaction, client) {
  const panelId = interaction.customId.split(':')[1];
  const panel   = await db.getPanel(panelId);
  if (!panel) return interaction.reply({ content: '❌ اللوحة غير موجودة.', ephemeral: true });

  const guildId = interaction.guild.id;
  const userId  = interaction.user.id;

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

  const guild     = interaction.guild;
  const user      = interaction.user;
  const guildData = await db.getGuild(guild.id);
  const num       = (await db.getTicketsByGuild(guild.id)).length + 1;
  const prefix    = guildData?.ticket_prefix || 'ticket';
  const name      = `${prefix}-${String(num).padStart(4, '0')}`;

  // Permission overrides
  const permissionOverwrites = [
    { id: guild.roles.everyone, deny: [PermissionFlagsBits.ViewChannel] },
    { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
    { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory] }
  ];

  // Add individual DB staff members
  const staffList = await db.getStaff(guild.id);
  for (const s of staffList) {
    permissionOverwrites.push({
      id: s.user_id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
    });
  }

  // Add staff role if configured (role-based staff)
  if (guildData?.staff_role_id) {
    permissionOverwrites.push({
      id: guildData.staff_role_id,
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

  const welcomeText = (panel.welcome_message || 'مرحباً {user}! سيتم مساعدتك قريباً.')
    .replace('{user}', `<@${user.id}>`)
    .replace('{panel}', panel.name)
    .replace('{ticket}', `#${newTicket.id}`);

  const embed = new EmbedBuilder()
    .setColor(panel.embed_color || '#3b82f6')
    .setTitle(`🧾 تذكرة #${newTicket.id}`)
    .setDescription(welcomeText)
    .addFields(
      { name: '👤 المستخدم', value: `<@${user.id}>`, inline: true },
      { name: '📋 اللوحة',   value: panel.name,       inline: true }
    );

  if (reason) embed.addFields({ name: '📝 السبب', value: reason });
  embed.setTimestamp().setFooter({ text: `SkyTicket • ${guild.name}` });

  // Row: close | claim | settings  (priority select removed — useless)
  const row = buildOpenRow(channel.id, panel);

  let content = '';
  if (panel.mention_role) content = `<@&${panel.mention_role}>`;

  await channel.send({ content, embeds: [embed], components: [row] });

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

  const isStaff = await checkStaff(interaction.guild.id, interaction.member);
  const isAdmin = interaction.member.permissions.has('Administrator');
  if (!isStaff && !isAdmin)
    return interaction.reply({ content: '❌ هذا الزر للدعم فقط.', ephemeral: true });

  if (ticket.claimed_by === interaction.user.id)
    return interaction.reply({ content: '❌ أنت مستلم هذه التذكرة بالفعل.', ephemeral: true });

  if (ticket.claimed_by && ticket.claimed_by !== interaction.user.id)
    return interaction.reply({ content: `❌ هذه التذكرة مُستلمة بالفعل من <@${ticket.claimed_by}>.`, ephemeral: true });

  // Auto-insert into staff table so points are tracked (for role-based staff)
  await db.addStaff(interaction.guild.id, interaction.user.id, 'auto').catch(() => {});

  await db.claimTicket(channelId, interaction.user.id);

  const panel = ticket.panel_id ? await db.getPanel(ticket.panel_id) : null;

  const embed = new EmbedBuilder()
    .setColor('#22c55e')
    .setDescription(`✅ تم استلام التذكرة بواسطة ${interaction.user}\n\nسيتم مساعدتك في أقرب وقت ممكن.`);

  // FIX: update to claimed row (close | unclaim | settings) instead of removing all buttons
  const row = buildClaimedRow(channelId, panel);
  await interaction.update({ components: [row] });
  await interaction.channel.send({ embeds: [embed] });
  await db.addLog(interaction.guild.id, 'TICKET_CLAIM', interaction.user.id, ticket.user_id, { ticket_id: ticket.id });
}

// ════════════════════════════════════════════════════════════════════════════
//  UNCLAIM TICKET
// ════════════════════════════════════════════════════════════════════════════
async function handleUnclaimTicket(interaction, client) {
  const channelId = interaction.customId.split(':')[1];
  const ticket    = await db.getTicket(channelId);
  if (!ticket) return interaction.reply({ content: '❌ التذكرة غير موجودة.', ephemeral: true });

  const isAdmin = interaction.member.permissions.has('Administrator');
  if (ticket.claimed_by !== interaction.user.id && !isAdmin)
    return interaction.reply({ content: '❌ يمكنك فقط إلغاء استلام التذاكر التي استلمتها.', ephemeral: true });

  await db.unclaimTicket(channelId);

  const panel = ticket.panel_id ? await db.getPanel(ticket.panel_id) : null;
  const row   = buildOpenRow(channelId, panel);

  const embed = new EmbedBuilder()
    .setColor('#6b7280')
    .setDescription(`↩️ تم إلغاء استلام التذكرة بواسطة ${interaction.user}`);

  await interaction.update({ components: [row] });
  await interaction.channel.send({ embeds: [embed] });
  await db.addLog(interaction.guild.id, 'TICKET_UNCLAIM', interaction.user.id, ticket.user_id, { ticket_id: ticket.id });
}

// ════════════════════════════════════════════════════════════════════════════
//  SETTINGS TICKET — ephemeral actions panel
// ════════════════════════════════════════════════════════════════════════════
async function handleSettingsTicket(interaction, client) {
  const channelId = interaction.customId.split(':')[1];
  const ticket    = await db.getTicket(channelId);
  if (!ticket) return interaction.reply({ content: '❌ التذكرة غير موجودة.', ephemeral: true });

  const isStaff = await checkStaff(interaction.guild.id, interaction.member);
  const isAdmin = interaction.member.permissions.has('Administrator');
  if (!isStaff && !isAdmin)
    return interaction.reply({ content: '❌ هذا الزر للدعم فقط.', ephemeral: true });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`rename_ticket:${channelId}`)
      .setLabel('✏️ تغيير اسم التذكرة')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`ping_owner:${channelId}`)
      .setLabel('📢 استدعاء صاحب التذكرة')
      .setStyle(ButtonStyle.Secondary)
  );

  await interaction.reply({
    content: '⚙️ **إعدادات التذكرة** — اختر إجراءً:',
    components: [row],
    ephemeral: true
  });
}

// ─── Rename — button shows modal ──────────────────────────────────────────────
async function handleRenameTicketBtn(interaction, client) {
  const channelId = interaction.customId.split(':')[1];

  const modal = new ModalBuilder()
    .setCustomId(`modal_rename:${channelId}`)
    .setTitle('تغيير اسم التذكرة');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('new_name')
        .setLabel('الاسم الجديد')
        .setStyle(TextInputStyle.Short)
        .setMinLength(2)
        .setMaxLength(100)
        .setRequired(true)
        .setValue(interaction.channel?.name || '')
    )
  );

  return interaction.showModal(modal);
}

async function handleRenameModal(interaction, client) {
  const channelId = interaction.customId.split(':')[1];
  const rawName   = interaction.fields.getTextInputValue('new_name');
  // Sanitize: lowercase, spaces → dashes, strip invalid chars
  const newName = rawName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\u0600-\u06ff-]/g, '').slice(0, 100);

  if (!newName) return interaction.reply({ content: '❌ الاسم المدخل غير صالح.', ephemeral: true });

  try {
    await interaction.channel.setName(newName);
    await interaction.reply({ content: `✅ تم تغيير اسم التذكرة إلى **${newName}**`, ephemeral: true });
  } catch {
    await interaction.reply({ content: '❌ فشل تغيير الاسم. تأكد من صلاحيات البوت.', ephemeral: true });
  }
}

// ─── Ping owner ───────────────────────────────────────────────────────────────
async function handlePingOwner(interaction, client) {
  const channelId = interaction.customId.split(':')[1];
  const ticket    = await db.getTicket(channelId);
  if (!ticket) return interaction.reply({ content: '❌ التذكرة غير موجودة.', ephemeral: true });

  // Close the ephemeral settings panel
  await interaction.update({ content: '✅ تم إرسال الاستدعاء.', components: [] });

  await interaction.channel.send({
    content: `📢 <@${ticket.user_id}> — فريق الدعم بانتظارك! يرجى الرد في أقرب وقت ممكن.`
  });
}

// ════════════════════════════════════════════════════════════════════════════
//  CLOSE TICKET
// ════════════════════════════════════════════════════════════════════════════
async function handleCloseTicket(interaction, client) {
  const channelId = interaction.customId.split(':')[1];
  const ticket    = await db.getTicket(channelId);
  if (!ticket) return interaction.reply({ content: '❌ التذكرة غير موجودة.', ephemeral: true });
  if (ticket.status === 'closed') return interaction.reply({ content: '❌ هذه التذكرة مغلقة بالفعل.', ephemeral: true });

  const guildData = await db.getGuild(interaction.guild.id);
  // FIX: panel was referenced but never fetched in this scope (was ReferenceError)
  const panel     = ticket.panel_id ? await db.getPanel(ticket.panel_id) : null;
  const isOwner   = interaction.user.id === ticket.user_id;
  const isStaff   = await checkStaff(interaction.guild.id, interaction.member);
  const isAdmin   = interaction.member.permissions.has('Administrator');

  if (!isOwner && !isStaff && !isAdmin)
    return interaction.reply({ content: '❌ ليس لديك صلاحية إغلاق هذه التذكرة.', ephemeral: true });

  // Show close-reason modal if required
  if (guildData?.require_close_reason && (isStaff || isAdmin)) {
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

  const creditedStaff = ticket.claimed_by || ticket.first_staff_reply_by;
  if (creditedStaff) {
    await db.incrementStaffClosed(interaction.guild.id, creditedStaff).catch(() => {});
    const reward = await db.awardClosePoints(interaction.guild.id, creditedStaff, ticket, {
      ticket_id: ticket.id,
      closed_by: interaction.user.id,
      reason
    }).catch(() => null);

    if (reward?.afterPoints != null) {
      const { client } = require('./bot');
      const { notifyPromotionThresholds } = require('./promotion');
      await notifyPromotionThresholds(
        client,
        interaction.guild.id,
        creditedStaff,
        reward.beforePoints,
        reward.afterPoints,
        { note: `إغلاق التذكرة #${ticket.id}` }
      ).catch(() => {});
    }
  }

  await db.addLog(interaction.guild.id, 'TICKET_CLOSE', interaction.user.id, ticket.user_id, {
    ticket_id: ticket.id, reason
  });

  if (panel?.dm_on_close) {
    const { dmTranscript } = require('./bot');
    await dmTranscript(ticket.user_id, { ...ticket, close_reason: reason }, transcriptContent, interaction.guild.name);
  }

  const embed = new EmbedBuilder()
    .setColor('#dc2626')
    .setTitle('🔒 تم إغلاق التذكرة')
    .setDescription(`شكراً على تواصلك معنا!\n${panel?.close_message || ''}`)
    .setTimestamp();
  if (reason) embed.addFields({ name: 'سبب الإغلاق', value: reason });

  // ─── زر الحذف في القناة ───────────────────────────────────────────────
  const deleteRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`delete_ticket:${channelId}`)
      .setLabel('🗑️ حذف التذكرة')
      .setStyle(ButtonStyle.Danger)
  );

  await channel.send({ embeds: [embed], components: [deleteRow] });

  // ─── إرسال التقييم على الخاص لصاحب التذكرة ──────────────────────────
  try {
    const ticketOwner = await client.users.fetch(ticket.user_id).catch(() => null);
    if (ticketOwner) {
      const dmEmbed = new EmbedBuilder()
        .setColor('#f59e0b')
        .setTitle('⭐ كيف كانت تجربتك معنا؟')
        .setDescription(
          `تم إغلاق تذكرتك **#${ticket.id}** في سيرفر **${interaction.guild.name}**.\n\n` +
          `يسعدنا معرفة رأيك في الخدمة المقدمة — قيّم تجربتك من 1 إلى 5 نجوم:`
        )
        .setFooter({ text: 'SkyTicket • نظام التقييم' })
        .setTimestamp();

      const dmRatingRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`rating_select:${channelId}:${interaction.guild.id}`)
          .setPlaceholder(panel?.rating_placeholder || 'قيّم تجربتك (اختياري)')
          .addOptions(
            new StringSelectMenuOptionBuilder().setLabel('⭐ 1 - ضعيف').setValue('1'),
            new StringSelectMenuOptionBuilder().setLabel('⭐⭐ 2 - مقبول').setValue('2'),
            new StringSelectMenuOptionBuilder().setLabel('⭐⭐⭐ 3 - جيد').setValue('3'),
            new StringSelectMenuOptionBuilder().setLabel('⭐⭐⭐⭐ 4 - ممتاز').setValue('4'),
            new StringSelectMenuOptionBuilder().setLabel('⭐⭐⭐⭐⭐ 5 - رائع').setValue('5')
          )
      );

      await ticketOwner.send({ embeds: [dmEmbed], components: [dmRatingRow] }).catch(() => {});
    }
  } catch {}

  if (panel?.category_close) {
    await channel.setParent(panel.category_close, { lockPermissions: false }).catch(() => {});
  }
  await channel.permissionOverwrites.edit(ticket.user_id, { SendMessages: false }).catch(() => {});

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
//  RATING SELECT
// ════════════════════════════════════════════════════════════════════════════
async function handleRatingSelect(interaction, client) {
  const parts     = interaction.customId.split(':');
  const channelId = parts[1];
  const guildId   = parts[2] || interaction.guild?.id;

  const ticket = await db.getTicket(channelId);
  if (!ticket) return interaction.update({ components: [] });

  if (interaction.user.id !== ticket.user_id)
    return interaction.reply({ content: '❌ فقط صاحب التذكرة يمكنه التقييم.', ephemeral: true });

  const rating = parseInt(interaction.values[0]);
  await db.rateTicket(channelId, rating);

  // FIX: use updateStaffRating (not incrementStaffClosed) to avoid double-counting tickets_closed
  if (ticket.claimed_by) {
    await db.updateStaffRating(guildId, ticket.claimed_by, rating);
  }

  const stars = '⭐'.repeat(rating);
  const embed = new EmbedBuilder()
    .setColor('#f59e0b')
    .setDescription(`${stars} شكراً على تقييمك! **(${rating}/5)**\nتقييمك يساعدنا على تحسين خدمتنا.`);

  await interaction.update({ components: [] });

  // إذا كان في الخاص نرسل الشكر كرسالة جديدة، وإذا في القناة نرسل فيها
  if (interaction.guild) {
    await interaction.channel.send({ embeds: [embed] });
  } else {
    await interaction.followUp({ embeds: [embed] }).catch(() => {});
  }

  // Send rating to the dedicated rating channel if configured
  const guildData = await db.getGuild(guildId);
  if (guildData?.rating_channel_id) {
    try {
      const guild    = client.guilds.cache.get(guildId);
      const ratingCh = guild?.channels.cache.get(guildData.rating_channel_id);
      if (ratingCh) {
        const staffMention = ticket.claimed_by ? `<@${ticket.claimed_by}>` : '—';
        const logEmbed = new EmbedBuilder()
          .setColor('#f59e0b')
          .setTitle('⭐ تقييم جديد وصل')
          .addFields(
            { name: '🎫 التذكرة',  value: `#${ticket.id}`,        inline: true },
            { name: '👤 العميل',   value: `<@${ticket.user_id}>`, inline: true },
            { name: '🛡️ الدعم',   value: staffMention,             inline: true },
            { name: '⭐ التقييم',  value: `${stars} (${rating}/5)`, inline: false }
          )
          .setTimestamp();
        await ratingCh.send({ embeds: [logEmbed] });
      }
    } catch {}
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  DELETE TICKET
// ════════════════════════════════════════════════════════════════════════════
async function handleDeleteTicket(interaction, client) {
  const channelId = interaction.customId.split(':')[1];
  const ticket    = await db.getTicket(channelId);
  if (!ticket) return interaction.reply({ content: '❌ التذكرة غير موجودة.', ephemeral: true });

  const isStaff = await checkStaff(interaction.guild.id, interaction.member);
  const isAdmin = interaction.member.permissions.has('Administrator');
  if (!isStaff && !isAdmin)
    return interaction.reply({ content: '❌ هذا الزر للدعم والإداريين فقط.', ephemeral: true });

  const embed = new EmbedBuilder()
    .setColor('#dc2626')
    .setTitle('🗑️ تأكيد الحذف')
    .setDescription('هل أنت متأكد من **حذف هذه القناة نهائياً**؟ لا يمكن التراجع عن هذا الإجراء.');

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`confirm_delete:${channelId}`)
      .setLabel('نعم، احذف')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`cancel_delete:${channelId}`)
      .setLabel('إلغاء')
      .setStyle(ButtonStyle.Secondary)
  );

  return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
}

async function handleConfirmDelete(interaction, client) {
  const channelId = interaction.customId.split(':')[1];
  const channel   = interaction.channel;

  await interaction.update({
    content: '🗑️ **سيتم حذف القناة خلال 3 ثواني...**',
    embeds: [],
    components: []
  });

  setTimeout(async () => {
    try {
      await channel.delete('حذف التذكرة بواسطة فريق الدعم');
    } catch (e) {
      console.error('[DeleteTicket]', e);
    }
  }, 3000);
}

// ─── Export ────────────────────────────────────────────────────────────────
module.exports = { handleInteraction, sendPanelEmbed: require('./commands').sendPanelEmbed };
