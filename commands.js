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

function getRankInfo(points = 0) {
  const value = Number(points) || 0;
  if (value >= 1500) return { name: '🏆 أسطورة', min: 1500, next: null };
  if (value >= 700)  return { name: '💎 خبير', min: 700, next: 1500 };
  if (value >= 300)  return { name: '🌟 محترف', min: 300, next: 700 };
  if (value >= 100)  return { name: '⚡ نشيط', min: 100, next: 300 };
  return { name: '🌱 مبتدئ', min: 0, next: 100 };
}

function formatDuration(seconds) {
  if (seconds == null || Number.isNaN(seconds)) return '—';
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return `${h}س ${mm}د`;
  }
  return `${m}د ${rem}ث`;
}


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

  // ─── /leaderboard ─────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('عرض لوحة المتصدرين بالنقاط')
    .addStringOption(o => o.setName('scope')
      .setDescription('نوع اللوحة')
      .addChoices(
        { name: 'إجمالي', value: 'total' },
        { name: 'أسبوعي', value: 'weekly' }
      )),

  // ─── /prints ──────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('prints')
    .setDescription('عرض نقاطك أو نقاط مستخدم آخر')
    .addUserOption(o => o.setName('user').setDescription('المستخدم').setRequired(false)),

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

  // ─── /setrank ─────────────────────────────────────────────────────────────
  new SlashCommandBuilder()
    .setName('setrank')
    .setDescription('تعيين رتبة كاملة لعضو في نظام النقاط')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(o => o.setName('user').setDescription('العضو').setRequired(true))
    .addStringOption(o => o.setName('rank')
      .setDescription('الرتبة المطلوبة')
      .setRequired(true)
      .addChoices(
        { name: '🌱 مبتدئ   (0 نقطة)',    value: 'مبتدئ' },
        { name: '⚡ نشيط   (100 نقطة)',   value: 'نشيط' },
        { name: '🌟 محترف  (300 نقطة)',   value: 'محترف' },
        { name: '💎 خبير   (700 نقطة)',   value: 'خبير' },
        { name: '🏆 أسطورة (1500 نقطة)',  value: 'أسطورة' }
      )),

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
            { name: 'الرقم السريع', value: `#${panel.panel_number || '—'}`, inline: true },
            { name: 'المعرف',   value: `\`${panel.id}\``,                   inline: false },
            { name: 'الخطوة التالية', value: `استخدم \`/panel send panel_id:${panel.panel_number || panel.id}\` لإرسالها في قناة` }
          )]
      });
    }

    if (sub === 'send') {
      const rawInput = interaction.options.getString('panel_id')?.trim();
      const ch       = interaction.options.getChannel('channel') || interaction.channel;
      await interaction.deferReply({ ephemeral: true });

      // دعم أكثر من ID مفصولة بمسافة: "1 2 3" أو "1,2,3"
      const ids = rawInput.split(/[\s,]+/).filter(Boolean);

      if (ids.length === 0)
        return interaction.editReply({ content: '❌ أدخل معرف لوحة واحدة على الأقل.' });

      // جيب أول لوحة — هي الواجهة الرئيسية
      const mainPanel = await db.getPanelByRef(interaction.guild.id, ids[0]);
      if (!mainPanel)
        return interaction.editReply({ content: `❌ اللوحة **${ids[0]}** غير موجودة.` });

      const { sendMultiPanelEmbed } = require('./tickets');

      if (ids.length === 1) {
        // سلوك قديم — لوحة واحدة
        await sendPanelEmbed(ch, mainPanel, interaction.guild);
        return interaction.editReply({ content: `✅ تم إرسال اللوحة **#${mainPanel.panel_number || '—'}** في ${ch}.` });
      }

      // أكثر من لوحة — جيب الباقي كأزرار إضافية
      const extraPanels = [];
      const missing     = [];
      for (const id of ids.slice(1)) {
        const p = await db.getPanelByRef(interaction.guild.id, id);
        if (p) extraPanels.push(p);
        else   missing.push(id);
      }

      await sendMultiPanelEmbed(ch, mainPanel, extraPanels, interaction.guild);

      const missNote = missing.length ? `\n⚠️ لوحات غير موجودة: ${missing.join(', ')}` : '';
      return interaction.editReply({
        content: `✅ تم إرسال اللوحة المدمجة في ${ch}. (رئيسية + ${extraPanels.length} أزرار)${missNote}`
      });
    }

    if (sub === 'list') {
      const panels = await db.getPanels(interaction.guild.id);
      if (!panels.length)
        return interaction.reply({ content: '📭 لا توجد لوحات. استخدم `/panel create`', ephemeral: true });

      const embed = new EmbedBuilder()
        .setColor('#dc2626')
        .setTitle('🗂️ لوحات التذاكر')
        .setDescription(panels.map(p => `**#${p.panel_number || '—'}** • ${p.name} — \`${p.id}\``).join('\n'));

      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (sub === 'delete') {
      const panelId = interaction.options.getString('panel_id')?.trim();
      const panel   = await db.getPanelByRef(interaction.guild.id, panelId);
      if (!panel)
        return interaction.reply({ content: '❌ لوحة غير موجودة.', ephemeral: true });

      await db.deletePanel(panel.id);
      return interaction.reply({ content: `✅ تم حذف اللوحة **#${panel.panel_number || '—'} ${panel.name}**.`, ephemeral: true });
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
        .setColor('#dc2626')
        .setTitle('👥 فريق الدعم')
        .setDescription(staffList.map((s, i) =>
          `**${i + 1}.** <@${s.user_id}> • ⭐ النقاط: ${s.points_total || 0} • 🎫 ${s.tickets_closed || 0} • 🔥 الستريك: ${s.streak_days || 0} • ${s.available ? '🟢' : '🔴'}`
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

  // ─── /leaderboard ──────────────────────────────────────────────────────
  if (commandName === 'leaderboard') {
    await interaction.deferReply();
    const scope = interaction.options.getString('scope') || 'total';
    const board = await db.getPointsLeaderboard(interaction.guild.id, scope, 10);

    const lines = await Promise.all(board.map(async (row, index) => {
      const member = interaction.guild.members.cache.get(row.user_id) || await interaction.guild.members.fetch(row.user_id).catch(() => null);
      const name = member?.displayName || member?.user?.username || `<@${row.user_id}>`;
      const rank = getRankInfo(row.points || 0).name;
      const weekly = scope === 'weekly' ? ` • هذا الأسبوع: **${row.points || 0}**` : ` • أسبوعيًا: **${row.weekly_points || 0}**`;
      return `**${index + 1}.** ${name} • **${row.points || 0}** نقطة • ${rank}${weekly}`;
    }));

    const embed = new EmbedBuilder()
      .setColor('#dc2626')
      .setTitle(scope === 'weekly' ? '🏆 لوحة المتصدرين الأسبوعية' : '🏆 لوحة المتصدرين بالنقاط')
      .setDescription(lines.length ? lines.join('\n') : 'لا توجد نقاط بعد.')
      .setFooter({ text: 'SkyTicket Points System' })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
  }

  // ─── /prints ────────────────────────────────────────────────────────────
  if (commandName === 'prints') {
    await interaction.deferReply({ ephemeral: true });
    const target = interaction.options.getUser('user') || interaction.user;
    const summary = await db.getStaffPointsSummary(interaction.guild.id, target.id);
    const weeklyBoard = await db.getPointsLeaderboard(interaction.guild.id, 'weekly', 200);
    const weekly = weeklyBoard.find(x => x.user_id === target.id)?.points || 0;
    const total = summary?.points_total || 0;
    const rank = getRankInfo(total);
    const avgResponse = formatDuration(summary?.avg_response_seconds || 0);

    const embed = new EmbedBuilder()
      .setColor('#dc2626')
      .setTitle(`📊 نقاط ${target.username}`)
      .setThumbnail(target.displayAvatarURL({ size: 128 }))
      .addFields(
        { name: 'النقاط الإجمالية', value: `${total}`, inline: true },
        { name: 'النقاط الأسبوعية', value: `${weekly}`, inline: true },
        { name: 'الرتبة الحالية', value: rank.name, inline: true },
        { name: 'الستريك', value: `${summary?.streak_days || 0} يوم`, inline: true },
        { name: 'أفضل ستريك', value: `${summary?.best_streak || 0} يوم`, inline: true },
        { name: 'متوسط سرعة الرد', value: avgResponse, inline: true }
      )
      .setFooter({ text: summary ? `آخر تحديث للنقاط: ${summary.last_point_date || '—'}` : 'لا يوجد سجل نقاط بعد' })
      .setTimestamp();

    return interaction.editReply({ embeds: [embed] });
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
      .setColor('#dc2626')
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

      const embed = new EmbedBuilder().setColor('#dc2626')
        .setDescription(`📌 تم تغيير أولوية التذكرة إلى **${labels[level]}** بواسطة ${interaction.user}`);
      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'transfer') {
      const isAdmin    = interaction.member.permissions.has('Administrator');
      const isStaffChk = await db.isStaff(interaction.guild.id, interaction.user.id);
      if (!isAdmin && !isStaffChk)
        return interaction.reply({ content: '❌ هذا الأمر للدعم فقط.', ephemeral: true });
      if (!isAdmin && ticket.claimed_by !== interaction.user.id)
        return interaction.reply({ content: '❌ يمكنك فقط نقل التذاكر التي استلمتها.', ephemeral: true });

      const newStaff   = interaction.options.getUser('staff');
      const isNewStaff = await db.isStaff(interaction.guild.id, newStaff.id);
      if (!isNewStaff) return interaction.reply({ content: '❌ هذا المستخدم ليس في فريق الدعم.', ephemeral: true });

      await db.claimTicket(interaction.channel.id, newStaff.id);

      // نفس منطق قفل الصلاحيات الموجود في claim
      const { lockTicketToStaff } = require('./tickets');
      await lockTicketToStaff(interaction.channel, interaction.guild.id, newStaff.id, ticket.user_id);

      await db.addLog(interaction.guild.id, 'TICKET_TRANSFER', interaction.user.id, newStaff.id, { ticket_id: ticket.id });

      const embed = new EmbedBuilder().setColor('#3b82f6')
        .setDescription(`🔄 تم نقل التذكرة من ${interaction.user} إلى ${newStaff}`);
      return interaction.reply({ embeds: [embed] });
    }

    if (sub === 'note') {
      const staffCheck = await db.isStaff(interaction.guild.id, interaction.user.id);
      const isAdmin    = interaction.member.permissions.has('Administrator');
      if (!staffCheck && !isAdmin) return interaction.reply({ content: '❌ هذا الأمر للدعم فقط.', ephemeral: true });
      const text = interaction.options.getString('text');
      await db.addNote(ticket.id, interaction.guild.id, interaction.user.id, text);
      await db.addLog(interaction.guild.id, 'TICKET_NOTE', interaction.user.id, ticket.user_id, { ticket_id: ticket.id, note: text });

      const embed = new EmbedBuilder()
        .setColor('#6366f1')
        .setTitle('📝 ملاحظة داخلية')
        .setDescription(text)
        .setFooter({ text: `بواسطة ${interaction.user.displayName || interaction.user.username}` })
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }
  }

  // ─── /setrank ──────────────────────────────────────────────────────────
  if (commandName === 'setrank') {
    await interaction.deferReply({ ephemeral: true });

    const target   = interaction.options.getUser('user');
    const rankName = interaction.options.getString('rank');
    const threshold = db.RANK_THRESHOLDS[rankName];
    const rankEmojis = { 'مبتدئ': '🌱', 'نشيط': '⚡', 'محترف': '🌟', 'خبير': '💎', 'أسطورة': '🏆' };

    try {
      // Ensure user is in staff table
      await db.addStaff(interaction.guild.id, target.id, interaction.user.id).catch(() => {});
      const result = await db.setUserRankPoints(interaction.guild.id, target.id, rankName);

      const embed = new EmbedBuilder()
        .setColor('#22c55e')
        .setTitle('✅ تم تعيين الرتبة')
        .addFields(
          { name: 'العضو',   value: `${target}`, inline: true },
          { name: 'الرتبة الجديدة', value: `${rankEmojis[rankName]} ${rankName}`, inline: true },
          { name: 'النقاط',  value: `${result.afterPoints}`, inline: true }
        )
        .setTimestamp();

      await db.addLog(interaction.guild.id, 'RANK_SET', interaction.user.id, target.id, { rank: rankName, points: threshold });
      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      return interaction.editReply({ content: `❌ خطأ: ${err.message}` });
    }
  }
}

// ─── Send panel embed ─────────────────────────────────────────────────────────
async function sendPanelEmbed(channel, panel, guild) {
  const styleMap = { DANGER: ButtonStyle.Danger, PRIMARY: ButtonStyle.Primary, SECONDARY: ButtonStyle.Secondary, SUCCESS: ButtonStyle.Success };

  const embed = new EmbedBuilder()
    .setColor(panel.embed_color || '#dc2626')
    .setTitle(`${panel.embed_title || 'فتح تذكرة'}${panel.panel_number ? ` • #${panel.panel_number}` : ''}`)
    .setDescription(panel.embed_description || '');

  if (panel.embed_footer)    embed.setFooter({ text: panel.embed_footer });
  if (panel.embed_image)     embed.setImage(panel.embed_image);
  if (panel.embed_thumbnail) embed.setThumbnail(panel.embed_thumbnail);

  const openEmoji = (panel.button_emoji || '').trim();
  const openLabel = (panel.button_label || 'فتح تذكرة').trim();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`open_ticket:${panel.id}`)
      .setLabel(openEmoji ? `${openEmoji} ${openLabel}` : openLabel)
      .setStyle(styleMap[panel.button_style] || ButtonStyle.Danger)
  );

  const msg = await channel.send({ embeds: [embed], components: [row] });
  await db.setPanelMessage(panel.id, msg.id, channel.id);
  return msg;
}

module.exports = { registerCommands, handleCommand, sendPanelEmbed };
