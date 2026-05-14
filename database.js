const { createClient } = require('@supabase/supabase-js');
const session = require('express-session');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ─── Helper ──────────────────────────────────────────────────────────────────
function handle(result) {
  if (result.error) throw result.error;
  return result.data;
}

// ════════════════════════════════════════════════════════════════════════════
//  SESSION STORE  (persistent sessions via Supabase)
// ════════════════════════════════════════════════════════════════════════════
class SupabaseStore extends session.Store {
  async get(sid, cb) {
    try {
      const { data } = await supabase
        .from('sessions').select('sess,expire').eq('sid', sid).maybeSingle();
      if (!data || new Date(data.expire) < new Date()) return cb(null, null);
      cb(null, data.sess);
    } catch (e) { cb(null, null); }
  }
  async set(sid, sess, cb) {
    try {
      const expire = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
      await supabase.from('sessions').upsert({ sid, sess, expire });
      cb(null);
    } catch (e) { cb(e); }
  }
  async destroy(sid, cb) {
    try {
      await supabase.from('sessions').delete().eq('sid', sid);
      cb(null);
    } catch (e) { cb(e); }
  }
  async touch(sid, sess, cb) {
    try {
      const expire = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await supabase.from('sessions').update({ expire }).eq('sid', sid);
      cb(null);
    } catch (e) { cb(e); }
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  GUILDS
// ════════════════════════════════════════════════════════════════════════════
async function ensureGuild(guildId) {
  const { data } = await supabase
    .from('guilds').select('id').eq('id', guildId).maybeSingle();
  if (!data) {
    await supabase.from('guilds').insert({ id: guildId });
  }
}

async function getGuild(guildId) {
  const { data } = await supabase
    .from('guilds').select('*').eq('id', guildId).maybeSingle();
  return data;
}

async function updateGuildSettings(guildId, settings) {
  await ensureGuild(guildId);
  return handle(await supabase
    .from('guilds').update(settings).eq('id', guildId));
}

// ════════════════════════════════════════════════════════════════════════════
//  PANELS
// ════════════════════════════════════════════════════════════════════════════
async function createPanel(guildId, data) {
  await ensureGuild(guildId);
  return handle(await supabase
    .from('panels').insert({ guild_id: guildId, ...data }).select().single());
}

async function getPanels(guildId) {
  const { data } = await supabase
    .from('panels').select('*').eq('guild_id', guildId).order('created_at', { ascending: true });
  return data || [];
}

async function getPanel(panelId) {
  const { data } = await supabase
    .from('panels').select('*').eq('id', panelId).maybeSingle();
  return data;
}

async function updatePanel(panelId, updates) {
  return handle(await supabase
    .from('panels').update(updates).eq('id', panelId).select().single());
}

async function deletePanel(panelId) {
  return handle(await supabase.from('panels').delete().eq('id', panelId));
}

async function setPanelMessage(panelId, messageId, channelId) {
  return handle(await supabase
    .from('panels').update({ message_id: messageId, channel_id: channelId }).eq('id', panelId));
}

// ════════════════════════════════════════════════════════════════════════════
//  TICKETS
// ════════════════════════════════════════════════════════════════════════════
async function createTicket(guildId, panelId, channelId, userId, openReason = null) {
  await ensureGuild(guildId);
  return handle(await supabase.from('tickets')
    .insert({ guild_id: guildId, panel_id: panelId, channel_id: channelId, user_id: userId, open_reason: openReason })
    .select().single());
}

async function getTicket(channelId) {
  const { data } = await supabase
    .from('tickets').select('*').eq('channel_id', channelId).maybeSingle();
  return data;
}

async function getTicketById(id) {
  const { data } = await supabase
    .from('tickets').select('*').eq('id', id).maybeSingle();
  return data;
}

async function getOpenTicketsByUser(guildId, userId) {
  const { data } = await supabase.from('tickets')
    .select('id').eq('guild_id', guildId).eq('user_id', userId).eq('status', 'open');
  return data || [];
}

async function getTicketsByGuild(guildId, status = null) {
  let q = supabase.from('tickets').select('*').eq('guild_id', guildId).order('created_at', { ascending: false });
  if (status) q = q.eq('status', status);
  const { data } = await q;
  return data || [];
}

async function getTicketsForAutoClose(guildId, hours) {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const { data } = await supabase.from('tickets')
    .select('*').eq('guild_id', guildId).in('status', ['open', 'claimed'])
    .lt('last_activity', cutoff);
  return data || [];
}

async function updateTicket(channelId, updates) {
  return handle(await supabase
    .from('tickets').update(updates).eq('channel_id', channelId).select().single());
}

async function closeTicket(channelId, closeReason = null, staffId = null) {
  return handle(await supabase.from('tickets').update({
    status: 'closed',
    close_reason: closeReason,
    closed_at: new Date().toISOString(),
    claimed_by: staffId || undefined
  }).eq('channel_id', channelId).select().single());
}

async function claimTicket(channelId, staffId) {
  return handle(await supabase.from('tickets')
    .update({ claimed_by: staffId, status: 'claimed', last_activity: new Date().toISOString() })
    .eq('channel_id', channelId).select().single());
}

async function setTicketPriority(channelId, priority) {
  return handle(await supabase
    .from('tickets').update({ priority }).eq('channel_id', channelId).select().single());
}

async function rateTicket(channelId, rating, comment = null) {
  return handle(await supabase
    .from('tickets').update({ rating, rating_comment: comment }).eq('channel_id', channelId).select().single());
}

async function updateLastActivity(channelId) {
  await supabase.from('tickets')
    .update({ last_activity: new Date().toISOString() }).eq('channel_id', channelId);
}

// ════════════════════════════════════════════════════════════════════════════
//  STAFF
// ════════════════════════════════════════════════════════════════════════════
async function addStaff(guildId, userId, addedBy) {
  await ensureGuild(guildId);
  return handle(await supabase.from('staff')
    .upsert({ guild_id: guildId, user_id: userId, added_by: addedBy })
    .select().single());
}

async function removeStaff(guildId, userId) {
  return handle(await supabase.from('staff')
    .delete().eq('guild_id', guildId).eq('user_id', userId));
}

async function getStaff(guildId) {
  const { data } = await supabase
    .from('staff').select('*').eq('guild_id', guildId).order('tickets_closed', { ascending: false });
  return data || [];
}

async function isStaff(guildId, userId) {
  const { data } = await supabase.from('staff')
    .select('user_id').eq('guild_id', guildId).eq('user_id', userId).maybeSingle();
  return !!data;
}

async function updateStaffAvailability(guildId, userId, available) {
  return handle(await supabase.from('staff')
    .update({ available }).eq('guild_id', guildId).eq('user_id', userId));
}

async function incrementStaffClosed(guildId, userId, rating = null) {
  // Fetch current stats
  const { data } = await supabase.from('staff')
    .select('tickets_closed, avg_rating, total_ratings').eq('guild_id', guildId).eq('user_id', userId).maybeSingle();
  if (!data) return;

  const updates = { tickets_closed: (data.tickets_closed || 0) + 1 };
  if (rating) {
    const total = (data.total_ratings || 0) + 1;
    const avg = (((data.avg_rating || 0) * (data.total_ratings || 0)) + rating) / total;
    updates.total_ratings = total;
    updates.avg_rating = Math.round(avg * 100) / 100;
  }
  await supabase.from('staff').update(updates).eq('guild_id', guildId).eq('user_id', userId);
}

// ════════════════════════════════════════════════════════════════════════════
//  TICKET NOTES
// ════════════════════════════════════════════════════════════════════════════
async function addNote(ticketId, guildId, authorId, content) {
  return handle(await supabase.from('ticket_notes')
    .insert({ ticket_id: ticketId, guild_id: guildId, author_id: authorId, content })
    .select().single());
}

async function getNotes(ticketId) {
  const { data } = await supabase.from('ticket_notes')
    .select('*').eq('ticket_id', ticketId).order('created_at');
  return data || [];
}

// ════════════════════════════════════════════════════════════════════════════
//  KEYWORDS
// ════════════════════════════════════════════════════════════════════════════
async function addKeyword(guildId, panelId, keyword, response, matchType = 'contains', caseSensitive = false) {
  await ensureGuild(guildId);
  return handle(await supabase.from('keywords').insert({
    guild_id: guildId,
    panel_id: panelId || null,
    keyword,
    response,
    match_type: matchType,
    case_sensitive: caseSensitive
  }).select().single());
}

async function getKeywords(guildId, panelId = null) {
  let q = supabase.from('keywords').select('*').eq('guild_id', guildId).eq('enabled', true);
  if (panelId) q = q.or(`panel_id.eq.${panelId},panel_id.is.null`);
  const { data } = await q;
  return data || [];
}

async function getAllKeywords(guildId) {
  const { data } = await supabase.from('keywords').select('*').eq('guild_id', guildId).order('created_at');
  return data || [];
}

async function deleteKeyword(keywordId) {
  return handle(await supabase.from('keywords').delete().eq('id', keywordId));
}

async function incrementKeywordHit(keywordId) {
  const { data } = await supabase.from('keywords').select('hit_count').eq('id', keywordId).maybeSingle();
  if (data) await supabase.from('keywords').update({ hit_count: (data.hit_count || 0) + 1 }).eq('id', keywordId);
}

// ════════════════════════════════════════════════════════════════════════════
//  BANS
// ════════════════════════════════════════════════════════════════════════════
async function banUser(guildId, userId, reason, bannedBy, expiresAt = null) {
  await ensureGuild(guildId);
  return handle(await supabase.from('bans')
    .upsert({ guild_id: guildId, user_id: userId, reason, banned_by: bannedBy, expires_at: expiresAt })
    .select().single());
}

async function unbanUser(guildId, userId) {
  return handle(await supabase.from('bans').delete().eq('guild_id', guildId).eq('user_id', userId));
}

async function isBanned(guildId, userId) {
  const { data } = await supabase.from('bans')
    .select('*').eq('guild_id', guildId).eq('user_id', userId).maybeSingle();
  if (!data) return false;
  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    await unbanUser(guildId, userId);
    return false;
  }
  return data;
}

async function getBans(guildId) {
  const { data } = await supabase.from('bans').select('*').eq('guild_id', guildId).order('created_at', { ascending: false });
  return data || [];
}

// ════════════════════════════════════════════════════════════════════════════
//  TRANSCRIPTS
// ════════════════════════════════════════════════════════════════════════════
async function saveTranscript(ticketId, guildId, content) {
  return handle(await supabase.from('transcripts')
    .upsert({ ticket_id: ticketId, guild_id: guildId, content })
    .select().single());
}

async function getTranscript(ticketId) {
  const { data } = await supabase.from('transcripts')
    .select('*').eq('ticket_id', ticketId).maybeSingle();
  return data;
}

// ════════════════════════════════════════════════════════════════════════════
//  LOGS
// ════════════════════════════════════════════════════════════════════════════
async function addLog(guildId, action, actorId = null, targetId = null, details = {}) {
  return supabase.from('logs').insert({ guild_id: guildId, action, actor_id: actorId, target_id: targetId, details });
}

async function getLogs(guildId, limit = 50) {
  const { data } = await supabase.from('logs')
    .select('*').eq('guild_id', guildId).order('created_at', { ascending: false }).limit(limit);
  return data || [];
}

// ════════════════════════════════════════════════════════════════════════════
//  STATS
// ════════════════════════════════════════════════════════════════════════════
async function getGuildStats(guildId) {
  const [allTickets, openTickets, staffList] = await Promise.all([
    getTicketsByGuild(guildId),
    getTicketsByGuild(guildId, 'open'),
    getStaff(guildId)
  ]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const closedToday = allTickets.filter(t => t.closed_at && new Date(t.closed_at) >= today).length;
  const rated = allTickets.filter(t => t.rating);
  const avgRating = rated.length ? (rated.reduce((s, t) => s + t.rating, 0) / rated.length).toFixed(1) : 0;

  // Last 7 days tickets
  const daily = {};
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = d.toISOString().split('T')[0];
    daily[key] = 0;
  }
  allTickets.forEach(t => {
    const key = t.created_at?.split('T')[0];
    if (key && daily.hasOwnProperty(key)) daily[key]++;
  });

  return {
    totalTickets: allTickets.length,
    openTickets: openTickets.length,
    closedToday,
    totalStaff: staffList.length,
    avgRating: parseFloat(avgRating),
    daily
  };
}

module.exports = {
  supabase,
  SupabaseStore,
  // Guilds
  ensureGuild, getGuild, updateGuildSettings,
  // Panels
  createPanel, getPanels, getPanel, updatePanel, deletePanel, setPanelMessage,
  // Tickets
  createTicket, getTicket, getTicketById, getOpenTicketsByUser,
  getTicketsByGuild, getTicketsForAutoClose, updateTicket,
  closeTicket, claimTicket, setTicketPriority, rateTicket, updateLastActivity,
  // Staff
  addStaff, removeStaff, getStaff, isStaff,
  updateStaffAvailability, incrementStaffClosed,
  // Notes
  addNote, getNotes,
  // Keywords
  addKeyword, getKeywords, getAllKeywords, deleteKeyword, incrementKeywordHit,
  // Bans
  banUser, unbanUser, isBanned, getBans,
  // Transcripts
  saveTranscript, getTranscript,
  // Logs
  addLog, getLogs,
  // Stats
  getGuildStats
};
