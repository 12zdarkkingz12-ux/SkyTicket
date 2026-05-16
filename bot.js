const {
  Client, GatewayIntentBits, Partials,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder,
  ButtonStyle, Events, Collection
} = require('discord.js');

const db = require('./database');
const { handleInteraction } = require('./tickets');
const { registerCommands }  = require('./commands');
const { notifyPromotionThresholds } = require('./promotion');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel, Partials.Message]
});

// ─── Ready ───────────────────────────────────────────────────────────────────
client.once(Events.ClientReady, async () => {
  console.log(`[Bot] Logged in as ${client.user.tag}`);
  client.user.setActivity('🎫 SkyTicket', { type: 3 }); // Watching

  await registerCommands(client);
  await db.ensureGuild(process.env.GUILD_ID).catch(() => {});

  // مزامنة رتبة النقاط عند الإقلاع
  try {
    const guildData = await db.getGuild(process.env.GUILD_ID);
    if (guildData?.points_role_id) {
      const guild = client.guilds.cache.get(process.env.GUILD_ID);
      if (guild) {
        await guild.members.fetch().catch(() => {});
        const role = guild.roles.cache.get(guildData.points_role_id);
        if (role) {
          let synced = 0;
          for (const [memberId] of role.members) {
            await db.addStaff(guild.id, memberId, 'role_sync').catch(() => {});
            synced++;
          }
          console.log(`[RoleSync] Startup sync: ${synced} members added from role "${role.name}"`);
        }
      }
    }
  } catch (e) {
    console.error('[RoleSync] Startup sync error:', e.message);
  }

  console.log('[Bot] Ready ✅');
});

// ─── Interactions (buttons, modals, selects) ─────────────────────────────────
client.on(Events.InteractionCreate, async interaction => {
  try {
    await handleInteraction(interaction, client);
  } catch (err) {
    console.error('[Interaction]', err);
    const msg = { content: '❌ حدث خطأ غير متوقع. حاول مجدداً.', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(msg).catch(() => {});
    } else {
      await interaction.reply(msg).catch(() => {});
    }
  }
});

// ─── Messages (keyword auto-reply + activity tracking) ───────────────────────
client.on(Events.MessageCreate, async message => {
  if (message.author.bot) return;
  if (!message.guild) return;

  const guildId = message.guild.id;

  // Update last_activity for open tickets
  const ticket = await db.getTicket(message.channel.id).catch(() => null);
  if (ticket && ticket.status !== 'closed') {
    await db.updateLastActivity(message.channel.id).catch(() => {});

    const member = message.member;
    const roleIds = member ? [...member.roles.cache.keys()] : [];
    const isStaff = await db.isStaffOrHasRole(guildId, message.author.id, roleIds).catch(() => false);

    // First staff reply → points + response timer
    if (isStaff && message.author.id !== ticket.user_id && !ticket.first_staff_reply_at) {
      const result = await db.markFirstStaffReply(message.channel.id, message.author.id).catch(() => null);
      if (result?.reward) {
        await notifyPromotionThresholds(
          client,
          guildId,
          message.author.id,
          result.reward.beforePoints,
          result.reward.afterPoints,
          { note: `أول رد داخل التذكرة #${ticket.id}` }
        ).catch(() => {});
      }
    }

    // Keyword auto-reply
    const keywords = await db.getKeywords(guildId, ticket.panel_id).catch(() => []);
    for (const kw of keywords) {
      const text    = kw.case_sensitive ? message.content : message.content.toLowerCase();
      const keyword = kw.case_sensitive ? kw.keyword      : kw.keyword.toLowerCase();

      // Check role restriction
      if (kw.trigger_role_id) {
        const memberRoles = message.member?.roles?.cache;
        if (!memberRoles?.has(kw.trigger_role_id)) continue;
      }

      let matched = false;
      if      (kw.match_type === 'exact')       matched = text === keyword;
      else if (kw.match_type === 'starts_with') matched = text.startsWith(keyword);
      else                                      matched = text.includes(keyword);

      if (matched) {
        await message.reply({ content: kw.response }).catch(() => {});
        await db.incrementKeywordHit(kw.id).catch(() => {});
        break; // Only first match
      }
    }
  }
});

// ─── Role-based Points Sync ───────────────────────────────────────────────────
client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  try {
    const guildId = newMember.guild.id;
    const userId  = newMember.user.id;

    const guildData = await db.getGuild(guildId).catch(() => null);
    if (!guildData?.points_role_id) return;

    const roleId  = guildData.points_role_id;
    const hadRole = oldMember.roles.cache.has(roleId);
    const hasRole = newMember.roles.cache.has(roleId);

    if (!hadRole && hasRole) {
      await db.addStaff(guildId, userId, 'role_sync').catch(() => {});
      console.log(`[RoleSync] Added ${userId} (${newMember.user.username}) via points role`);
    } else if (hadRole && !hasRole) {
      await db.removeStaff(guildId, userId).catch(() => {});
      console.log(`[RoleSync] Removed ${userId} (${newMember.user.username}) via points role`);
    }
  } catch (err) {
    console.error('[RoleSync] GuildMemberUpdate error:', err);
  }
});

// ─── Errors ──────────────────────────────────────────────────────────────────
client.on('error', err => console.error('[Client Error]', err));
process.on('unhandledRejection', err => console.error('[Unhandled]', err));

// ─── Send to log channel ─────────────────────────────────────────────────────
async function sendLog(guildId, embed) {
  try {
    const guildData = await db.getGuild(guildId);
    if (!guildData?.log_channel_id) return;
    const guild   = client.guilds.cache.get(guildId);
    const channel = guild?.channels.cache.get(guildData.log_channel_id);
    if (channel) await channel.send({ embeds: [embed] });
  } catch {}
}

// ─── DM transcript to user ────────────────────────────────────────────────────
async function dmTranscript(userId, ticket, content, guildName) {
  try {
    const user = await client.users.fetch(userId);
    const embed = new EmbedBuilder()
      .setColor('#dc2626')
      .setTitle('📄 نسخة من تذكرتك')
      .setDescription(`تم إغلاق تذكرتك **#${ticket.id}** في سيرفر **${guildName}**.\nيمكنك الاطلاع على محادثة التذكرة أدناه.`)
      .addFields(
        { name: 'السبب', value: ticket.close_reason || 'لم يُذكر سبب', inline: true },
        { name: 'رقم التذكرة', value: `#${ticket.id}`, inline: true }
      )
      .setTimestamp();
    await user.send({ embeds: [embed] }).catch(() => {});
  } catch {}
}

async function startBot() {
  await client.login(process.env.TOKEN);
}

module.exports = { client, startBot, sendLog, dmTranscript };
