require('dotenv').config();
const cron = require('node-cron');
const { startBot, client } = require('./bot');
const { startWeb } = require('./web');
const db = require('./database');

// ─── Startup ─────────────────────────────────────────────────────────────────
console.log(`
 ╔═══════════════════════════════╗
 ║   🔴 SkyTicket Crimson  v2.1.0   ║
 ║      Developed by Dark        ║
 ╚═══════════════════════════════╝
`);

(async () => {
  await startBot();
  await startWeb();

  // ─── Cron: Auto-close tickets every 30 min ─────────────────────────────
  cron.schedule('*/30 * * * *', () => checkAutoClose());

  // ─── Cron: Cleanup expired bans every hour ─────────────────────────────
  cron.schedule('0 * * * *', () => cleanExpiredBans());

  // ─── Cron: Cleanup old sessions daily ─────────────────────────────────
  cron.schedule('0 0 * * *', () => cleanSessions());
})();

// ════════════════════════════════════════════════════════════════════════════
//  AUTO-CLOSE
// ════════════════════════════════════════════════════════════════════════════
async function checkAutoClose() {
  try {
    const guild = client.guilds.cache.get(process.env.GUILD_ID);
    if (!guild) return;

    const guildData = await db.getGuild(guild.id);
    if (!guildData) return;

    const closeHours = guildData.auto_close_hours || 72;
    const warnHours  = guildData.auto_close_warn_hours || 48;

    const tickets = await db.getTicketsForAutoClose(guild.id, warnHours);

    for (const ticket of tickets) {
      const channel = guild.channels.cache.get(ticket.channel_id);
      if (!channel) continue;

      const inactiveMs   = Date.now() - new Date(ticket.last_activity).getTime();
      const inactiveHrs  = inactiveMs / (1000 * 60 * 60);

      if (inactiveHrs >= closeHours) {
        // ── Close the ticket ────────────────────────────────────────────
        await db.closeTicket(ticket.channel_id, 'إغلاق تلقائي بسبب عدم النشاط');
        await db.addLog(guild.id, 'AUTO_CLOSE', null, ticket.user_id, { ticket_id: ticket.id });

        const { EmbedBuilder } = require('discord.js');
        const embed = new EmbedBuilder()
          .setColor('#ef4444')
          .setTitle('🔒 تم إغلاق التذكرة تلقائياً')
          .setDescription(`تم إغلاق هذه التذكرة بسبب عدم النشاط لمدة **${closeHours} ساعة**.`)
          .setTimestamp();

        await channel.send({ embeds: [embed] }).catch(() => {});
        await new Promise(r => setTimeout(r, 5000));

        // Save transcript
        try {
          const { createTranscript } = require('discord-html-transcripts');
          const transcript = await createTranscript(channel);
          const content = transcript.attachment?.toString('utf-8') || '';
          await db.saveTranscript(ticket.id, guild.id, content);
        } catch {}

        await channel.delete('Auto-close: inactive').catch(() => {});

        if (ticket.claimed_by) {
          await db.incrementStaffClosed(guild.id, ticket.claimed_by);
        }

      } else if (inactiveHrs >= warnHours) {
        // ── Send warning (only once per ticket by checking a flag) ──────
        const remaining = Math.round(closeHours - inactiveHrs);
        const { EmbedBuilder } = require('discord.js');
        const embed = new EmbedBuilder()
          .setColor('#f59e0b')
          .setTitle('⚠️ تحذير: انتهاء التذكرة')
          .setDescription(`<@${ticket.user_id}> ستُغلق هذه التذكرة خلال **${remaining} ساعة** إذا لم يكن هناك أي نشاط.\n\nأرسل أي رسالة لمنع الإغلاق التلقائي.`)
          .setTimestamp();
        await channel.send({ embeds: [embed] }).catch(() => {});
      }
    }
  } catch (err) {
    console.error('[AutoClose] Error:', err.message);
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  CLEANUP
// ════════════════════════════════════════════════════════════════════════════
async function cleanExpiredBans() {
  try {
    const { supabase } = require('./database');
    await supabase.from('bans').delete().lt('expires_at', new Date().toISOString()).not('expires_at', 'is', null);
  } catch {}
}

async function cleanSessions() {
  try {
    const { supabase } = require('./database');
    await supabase.from('sessions').delete().lt('expire', new Date().toISOString());
  } catch {}
}
