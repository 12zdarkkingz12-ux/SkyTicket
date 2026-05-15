const { EmbedBuilder } = require('discord.js');
const db = require('./database');

async function notifyPromotionThresholds(client, guildId, userId, beforePoints, afterPoints, context = {}) {
  try {
    const start = Number(beforePoints) || 0;
    const end = Number(afterPoints) || 0;
    if (!guildId || !userId || end <= 0 || end <= start) return [];

    const guildData = await db.getGuild(guildId);
    const rules = await db.getPromotionRules(guildId);
    if (!guildData || !rules.length) return [];

    const guild = client.guilds.cache.get(guildId);
    if (!guild) return [];

    const member = await guild.members.fetch(userId).catch(() => null);
    const channel = guildData.promotion_channel_id
      ? guild.channels.cache.get(guildData.promotion_channel_id)
      : null;

    const triggered = [];
    for (const rule of rules) {
      const threshold = Number(rule.threshold_points) || 0;
      if (!rule.enabled || threshold <= 0) continue;
      if (!(start < threshold && end >= threshold)) continue;

      const alert = await db.markPromotionAlert(guildId, userId, rule.id, end).catch(() => null);
      if (!alert) continue;

      triggered.push(rule);

      const embed = new EmbedBuilder()
        .setColor('#dc2626')
        .setTitle(`📌 تنبيه ترقية — ${rule.label || 'تنبيه ترقية'}`)
        .setDescription([
          `${member ? member : `<@${userId}>`} وصل إلى **${end}** نقطة.`,
          `الشرط المحدد: **${threshold}** نقطة.`,
          context.note ? `
${context.note}` : ''
        ].filter(Boolean).join('
'))
        .addFields(
          { name: 'العضو', value: `<@${userId}>`, inline: true },
          { name: 'النقاط', value: `${end}`, inline: true },
          { name: 'الشرط', value: `${threshold}`, inline: true }
        )
        .setFooter({ text: 'مراجعة يدوية بواسطة مسؤول الترقية' })
        .setTimestamp();

      const content = guildData.promotion_role_id ? `<@&${guildData.promotion_role_id}>` : null;
      const payload = { embeds: [embed] };
      if (content) payload.content = content;

      if (channel && channel.isTextBased()) {
        await channel.send(payload).catch(() => null);
      } else if (guildData.promotion_role_id) {
        const role = guild.roles.cache.get(guildData.promotion_role_id);
        if (role) {
          for (const target of role.members.values()) {
            await target.send({ embeds: [embed] }).catch(() => null);
          }
        }
      }
    }

    return triggered;
  } catch (err) {
    console.error('[PromotionNotify]', err);
    return [];
  }
}

module.exports = { notifyPromotionThresholds };
