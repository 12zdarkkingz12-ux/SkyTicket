const {
  REST, Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType
} = require('discord.js');

const db = require('./database');

// ════════════════════════════════════════════════════════════════════════════
//  COMMAND DEFINITIONS
// ════════════════════════════════════════════════════════════════════════════
const commands = [

  // ─── /panel ───────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('panel')
    .setDescription('إدارة لوحات التذاكر')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub => sub
      .setName('create')
      .setDescription('إنشاء لوحة تذاكر جديدة')
      .addStringOption(o => o.setName('name').setDescription('اسم اللوحة').setRequired(true))
      .addChannelOption(o => o.setName('category_open').setDescription('تصنيف التذاكر المفتوحة').addChannelTypes(ChannelType.GuildCategory))
      .addChannelOption(o => o.setName('category_close').setDescription('تصنيف التذاكر المغلقة').addChannelTypes(ChannelType.GuildCategory))
      .addRoleOption(o => o.setName('mention_role').setDescription('الرتبة التي تُذكر عند فتح التذكرة')))
    .addSubcommand(sub => sub
      .setName('send')
      .setDescription('إرسال لوحة تذاكر في قناة')
      .addStringOption(o => o.setName('panel_id').setDescription('معرف اللوحة').setRequired(true))
      .addChannelOption(o => o.setName('channel').setDescription('القناة (الافتراضي: الحالية)').addChannelTypes(ChannelType.GuildText)))
    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('عرض كل اللوحات الموجودة'))
    .addSubcommand(sub => sub
      .setName('delete')
      .setDescription('حذف لوحة')
      .addStringOption(o => o.setName('panel_id').setDescription('معرف اللوحة').setRequired(true))),

  // ─── /staff ───────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('staff')
    .setDescription('إدارة فريق الدعم')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub => sub
      .setName('add')
      .setDescription('إضافة عضو لفريق الدعم')
      .addUserOption(o => o.setName('user').setDescription('العضو').setRequired(true)))
    .addSubcommand(sub => sub
      .setName('remove')
      .setDescription('إزالة عضو من فريق الدعم')
      .addUserOption(o => o.setName('user').setDescription('العضو').setRequired(true)))
    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('عرض فريق الدعم'))
    .addSubcommand(sub => sub
      .setName('toggle')
      .setDescription('تبديل حالتك (متاح/غير متاح)')),

  // ─── /ban ─────────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('حظر مستخدم من فتح التذاكر')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(o => o.setName('user').setDescription('المستخدم').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('سبب الحظر').setRequired(true))
    .addStringOption(o => o.setName('duration').setDescription('مدة الحظر (مثال: 7d, 30d, permanent)').setRequired(false)),

  // ─── /unban ───────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('unban')
    .setDescription('رفع الحظر عن مستخدم')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(o => o.setName('user').setDescription('المستخدم').setRequired(true)),

  // ─── /stats ───────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('stats')
    .setDescription('إحصائيات نظام التذاكر')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  // ─── /ticket ──────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('إدارة التذكرة الحالية')
    .addSubcommand(sub => sub
      .setName('add')
      .setDescription('إضافة مستخدم للتذكرة')
      .addUserOption(o => o.setName('user').setDescription('المستخدم').setRequired(true)))
    .addSubcommand(sub => sub
      .setName('remove')
      .setDescription('إزالة مستخدم من التذكرة')
      .addUserOption(o => o.setName('user').setDescription('المستخدم').setRequired(true)))
    .addSubcommand(sub => sub
      .setName('priority')
      .setDescription('تعيين أولوية التذكرة')
      .addStringOption(o => o.setName('level')
        .setDescription('مستوى الأولوية').setRequired(true)
        .addChoices(
          { name: '🟢 منخفضة', value: 'low' },
          { name: '🔵 عادية',  value: 'normal' },
          { name: '🟡 عالية',  value: 'high' },
          { name: '🔴 عاجلة',  value: 'urgent' }
        )))
    .addSubcommand(sub => sub
      .setName('transfer')
      .setDescription('نقل التذكرة لعضو دعم آخر')
      .addUserOption(o => o.setName('staff').setDescription('عضو الدعم').setRequired(true)))
    .addSubcommand(sub => sub
      .setName('note')
      .setDescription('إضافة ملاحظة داخلية (مرئية للدعم فقط)')
      .addStringOption(o => o.setName('text').setDescription('نص الملاحظة').setRequired(true))),

].map(c => c.toJSON());

// ════════════════════════════════════════════════════════════════════════════
//  REGISTER
// ════════════════════════════════════════════════════════════════════════════
async function registerCommands(client) {
  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  try {
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );
    console.log('[Commands] Registered ✅');
  } catch (err) {
    console.error('[Commands] Failed:', err);
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  HANDLERS
// ════════════════════════════════════════════════════════════════════════════
async function handleCommand(interaction, client) {
  const { commandName } = interaction;

  // ─── /panel ────────────────────────────────────────────────────────────
  if (commandName === 'panel') {
    const sub = interaction.options.getSubcommand();

    if (sub === 'create') {
      const name          = interaction.options.getString('name');
      const categoryOpen  = interaction.options.getChannel('category_open');
      const categoryClose = interaction.options.getChannel('category_close');
      const mentionRole   = interaction.options.getRole('mention_role');

      await interaction.deferReply({ ephemeral: true });

      const panel = await db.createPanel(interaction.guild.id, {
        name,
        category_open:  categoryOpen?.id  || null,
        category_close: categoryClose?.id || null,
        mention_role:   mentionRole?.id   || null
      });

      return interaction.editReply({
        embeds: [new EmbedBuilder()
          .setColor('#22c55e')
          .setTitle('✅ تم إنشاء اللوحة')
          .addFields(
            { name: 'الاسم',    value: panel.name,                          inline: true },
            { name: 'المعرف',   value: `\`${panel.id}\``,                   inline: true },
            { name: 'الخطوة التالية', value: `استخدم \`/panel send panel_id:${panel.id}\` لإرسالها في قناة` }
          )]
      });
    }

    if (sub === 'send') {
      const panelId = interaction.options.getString('panel_id');
      const ch      = interaction.options.getChannel('channel') || interaction.channel;
      await interaction.deferReply({ ephemeral: true });

      const panel = await db.getPanel(panelId);
      if (!panel || panel.guild_id !== interaction.guild.id)
        return interaction.editReply({ content: '❌ لوحة غير موجودة.' });

      const { sendPanelEmbed } = require('./tickets');
      await sendPanelEmbed(ch, panel, interaction.guild);
      return interaction.editReply({ content: `✅ تم إرسال اللوحة في ${ch}.` });
    }

    if (sub === 'list') {
      const panels = await db.getPanels(interaction.guild.id);
      if (!panels.length)
        return interaction.reply({ content: '📭 لا توجد لوحات. استخدم `/panel create`', ephemeral: true });

      const embed = new EmbedBuilder()
        .setColor('#4f7ef7')
        .setTitle('🗂️ لوحات التذاكر')
        .setDescription(panels.map(p => `**${p.name}** — \`${p.id}\``).join('\n'));

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (sub === 'delete') {
      const panelId = interaction.options.getString('panel_id');
      const panel   = await db.getPanel(panelId);
      if (!panel || panel.guild_id !== interaction.guild.id)
        return interaction.reply({ content: '❌ لوحة غير موجودة.', ephemeral: true });

      await db.deletePanel(panelId);
      return interaction.reply({ content: `✅ تم حذف اللوحة **${panel.name}**.`, ephemeral: true });
    }
  }

  // ─── /staff ────────────────────────────────────────────────────────────
  if (commandName === 'staff') {
    const sub = interaction.options.getSubcommand();

    if (sub === 'add') {
      const user = interaction.options.getUser('user');
      await db.addStaff(interaction.guild.id, user.id, interaction.user.id);
      const embed = new EmbedBuilder().setColor('#22c55e')
        .setTitle('✅ تمت إضافة عضو الدعم')
        .setDescription(`تم إضافة ${user} لفريق الدعم.`);
      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'remove') {
      const user = interaction.options.getUser('user');
      await db.removeStaff(interaction.guild.id, user.id);
      return interaction.reply({ content: `✅ تم إزالة ${user} من فريق الدعم.` });
    }

    if (sub === 'list') {
      const staffList = await db.getStaff(interaction.guild.id);
      if (!staffList.length)
        return interaction.reply({ content: '📭 لا يوجد أعضاء دعم.', ephemeral: true });

      const embed = new EmbedBuilder()
        .setColor('#4f7ef7')
        .setTitle('👥 فريق الدعم')
        .setDescription(staffList.map((s, i) =>
          `**${i + 1}.** <@${s.user_id}> • 🎫 ${s.tickets_closed} • ⭐ ${s.avg_rating || '—'} • ${s.available ? '🟢' : '🔴'}`
        ).join('\n'));

      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'toggle') {
      const staff = await db.getStaff(interaction.guild.id);
      const me    = staff.find(s => s.user_id === interaction.user.id);
      if (!me) return interaction.reply({ content: '❌ لست في فريق الدعم.', ephemeral: true });

      await db.updateStaffAvailability(interaction.guild.id, interaction.user.id, !me.available);
      return interaction.reply({
        content: !me.available ? '🟢 أنت الآن **متاح** لاستلام التذاكر.' : '🔴 أنت الآن **غير متاح**.',
        ephemeral: true
      });
    }
  }

  // ─── /ban ──────────────────────────────────────────────────────────────
  if (commandName === 'ban') {
    const user     = interaction.options.getUser('user');
    const reason   = interaction.options.getString('reason');
    const duration = interaction.options.getString('duration') || 'permanent';

    let expiresAt = null;
    if (duration !== 'permanent') {
      const days = parseInt(duration);
      if (!isNaN(days)) expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    }

    await db.banUser(interaction.guild.id, user.id, reason, interaction.user.id, expiresAt);
    await db.addLog(interaction.guild.id, 'BAN', interaction.user.id, user.id, { reason, expiresAt });

    const embed = new EmbedBuilder()
      .setColor('#ef4444')
      .setTitle('🚫 تم الحظر من التذاكر')
      .addFields(
        { name: 'المستخدم', value: `${user} (${user.id})`,                              inline: true },
        { name: 'السبب',    value: reason,                                                inline: true },
        { name: 'المدة',    value: expiresAt ? `حتى <t:${Math.floor(new Date(expiresAt)/1000)}:F>` : 'دائم', inline: true }
      ).setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }

  // ─── /unban ────────────────────────────────────────────────────────────
  if (commandName === 'unban') {
    const user = interaction.options.getUser('user');
    await db.unbanUser(interaction.guild.id, user.id);
    await db.addLog(interaction.guild.id, 'UNBAN', interaction.user.id, user.id, {});
    return interaction.reply({ content: `✅ تم رفع الحظر عن ${user}.` });
  }

  // ─── /stats ────────────────────────────────────────────────────────────
  if (commandName === 'stats') {
    await interaction.deferReply();
    const stats = await db.getGuildStats(interaction.guild.id);
    const embed = new EmbedBuilder()
      .setColor('#4f7ef7')
      .setTitle('📊 إحصائيات SkyTicket')
      .setThumbnail(interaction.guild.iconURL())
      .addFields(
        { name: '🎫 إجمالي التذاكر',  value: stats.totalTickets.toString(), inline: true },
        { name: '🟢 مفتوحة',          value: stats.openTickets.toString(),  inline: true },
        { name: '✅ مغلقة اليوم',      value: stats.closedToday.toString(),  inline: true },
        { name: '👥 فريق الدعم',       value: stats.totalStaff.toString(),   inline: true },
        { name: '⭐ متوسط التقييم',    value: stats.avgRating ? `${stats.avgRating}/5` : '—', inline: true }
      )
      .setTimestamp();
    return interaction.editReply({ embeds: [embed] });
  }

  // ─── /ticket ───────────────────────────────────────────────────────────
  if (commandName === 'ticket') {
    const sub    = interaction.options.getSubcommand();
    const ticket = await db.getTicket(interaction.channel.id);
    if (!ticket) return interaction.reply({ content: '❌ هذه القناة ليست تذكرة.', ephemeral: true });

    if (sub === 'add') {
      const user = interaction.options.getUser('user');
      await interaction.channel.permissionOverwrites.create(user, { ViewChannel: true, SendMessages: true });
      return interaction.reply({ content: `✅ تمت إضافة ${user} للتذكرة.` });
    }

    if (sub === 'remove') {
      const user = interaction.options.getUser('user');
      if (user.id === ticket.user_id) return interaction.reply({ content: '❌ لا يمكن إزالة صاحب التذكرة.', ephemeral: true });
      await interaction.channel.permissionOverwrites.delete(user);
      return interaction.reply({ content: `✅ تمت إزالة ${user} من التذكرة.` });
    }

    if (sub === 'priority') {
      const staffCheck = await db.isStaff(interaction.guild.id, interaction.user.id);
      const isAdmin    = interaction.member.permissions.has('Administrator');
      if (!staffCheck && !isAdmin) return interaction.reply({ content: '❌ هذا الأمر للدعم فقط.', ephemeral: true });

      const level  = interaction.options.getString('level');
      const labels = { low: '🟢 منخفضة', normal: '🔵 عادية', high: '🟡 عالية', urgent: '🔴 عاجلة' };
      await db.setTicketPriority(interaction.channel.id, level);

      const embed = new EmbedBuilder().setColor('#4f7ef7')
        .setDescription(`📌 تم تغيير أولوية التذكرة إلى **${labels[level]}** بواسطة ${interaction.user}`);
      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'transfer') {
      const isAdmin = interaction.member.permissions.has('Administrator');
      if (!isAdmin && ticket.claimed_by !== interaction.user.id)
        return interaction.reply({ content: '❌ يمكنك فقط نقل التذاكر التي استلمتها.', ephemeral: true });

      const newStaff  = interaction.options.getUser('staff');
      const isNewStaff = await db.isStaff(interaction.guild.id, newStaff.id);
      if (!isNewStaff) return interaction.reply({ content: '❌ هذا المستخدم ليس في فريق الدعم.', ephemeral: true });

      await db.claimTicket(interaction.channel.id, newStaff.id);
      await interaction.channel.permissionOverwrites.create(newStaff, { ViewChannel: true, SendMessages: true });

      const embed = new EmbedBuilder().setColor('#4f7ef7')
        .setDescription(`🔄 تم نقل التذكرة من ${interaction.user} إلى ${newStaff}`);
      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'note') {
      const staffCheck = await db.isStaff(interaction.guild.id, interaction.user.id);
      const isAdmin    = interaction.member.permissions.has('Administrator');
      if (!staffCheck && !isAdmin) return interaction.reply({ content: '❌ هذا الأمر للدعم فقط.', ephemeral: true });

      const text = interaction.options.getString('text');
      await db.addNote(ticket.id, interaction.guild.id, interaction.user.id, text);

      const embed = new EmbedBuilder()
        .setColor('#6366f1')
        .setTitle('📝 ملاحظة داخلية')
        .setDescription(text)
        .setFooter({ text: `بواسطة ${interaction.user.tag}` })
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }
  }
}

// ─── Send panel embed ─────────────────────────────────────────────────────────
async function sendPanelEmbed(channel, panel, guild) {
  const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
  const db = require('./database');

  const styleMap = { PRIMARY: ButtonStyle.Primary, SECONDARY: ButtonStyle.Secondary, SUCCESS: ButtonStyle.Success, DANGER: ButtonStyle.Danger };

  const embed = new EmbedBuilder()
    .setColor(panel.embed_color || '#4f7ef7')
    .setTitle(panel.embed_title)
    .setDescription(panel.embed_description);

  if (panel.embed_footer)    embed.setFooter({ text: panel.embed_footer });
  if (panel.embed_image)     embed.setImage(panel.embed_image);
  if (panel.embed_thumbnail) embed.setThumbnail(panel.embed_thumbnail);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`open_ticket:${panel.id}`)
      .setLabel(panel.button_label)
      .setStyle(styleMap[panel.button_style] || ButtonStyle.Primary)
  );

  const msg = await channel.send({ embeds: [embed], components: [row] });
  await db.setPanelMessage(panel.id, msg.id, channel.id);
  return msg;
}

module.exports = { registerCommands, handleCommand, sendPanelEmbed };
