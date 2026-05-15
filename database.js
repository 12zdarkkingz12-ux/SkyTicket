const { createClient } = require('@supabase/supabase-js');
const session = require('express-session');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

function logSessionStoreError(method, sid, err) {
  console.error(`[SessionStore] ${method} failed${sid ? ` (sid=${sid})` : ''}:`, err?.message || err);
}

// ─── Helper ──────────────────────────────────────────────────────────────────
function handle(result) {
  if (result.error) throw result.error;
  return result.data;
}

function getRiyadhDateKey(date = new Date()) {
  // Riyadh = UTC+3, no DST.
  return new Date(date.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function getYesterdayKey(date = new Date()) {
  return getRiyadhDateKey(new Date(date.getTime() - 24 * 60 * 60 * 1000));
}

function getResponsePoints(responseSeconds) {
  if (responseSeconds == null || Number.isNaN(responseSeconds)) return 0;
  if (responseSeconds <= 5 * 60) return 12;
  if (responseSeconds <= 15 * 60) return 8;
  if (responseSeconds <= 30 * 60) return 5;
  if (responseSeconds <= 60 * 60) return 2;
  return 1;
}

function getStreakBonus(streakDays) {
  const bonuses = { 3: 5, 7: 15, 14: 30, 30: 60 };
  return bonuses[streakDays] || 0;
}

function normalizePoints(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.floor(n) : 0;
}

// ════════════════════════════════════════════════════════════════════════════
//  SESSION STORE  (persistent sessions via Supabase)
// ════════════════════════════════════════════════════════════════════════════
class SupabaseStore extends session.Store {
  async get(sid, cb) {
    try {
      const { data, error } = await supabase
        .from('sessions').select('sess,expire').eq('sid', sid).maybeSingle();
      if (error) throw error;
      if (!data) return cb(null, null);
      if (data.expire && new Date(data.expire) < new Date()) return cb(null, null);
      cb(null, data.sess || null);
    } catch (e) {
      logSessionStoreError('get', sid, e);
      cb(null, null);
    }
  }
  async set(sid, sess, cb) {
    try {
      const expire = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
      const { error } = await supabase.from('sessions').upsert({ sid, sess, expire }, { onConflict: 'sid' });
      if (error) throw error;
      cb(null);
    } catch (e) {
      logSessionStoreError('set', sid, e);
      cb(e);
    }
  }
  async destroy(sid, cb) {
    try {
      const { error } = await supabase.from('sessions').delete().eq('sid', sid);
      if (error) throw error;
      cb(null);
    } catch (e) {
      logSessionStoreError('destroy', sid, e);
      cb(e);
    }
  }
  async touch(sid, sess, cb) {
    try {
      const expire = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const { error } = await supabase.from('sessions').upsert({ sid, sess, expire }, { onConflict: 'sid' });
      if (error) throw error;
      cb(null);
    } catch (e) {
      logSessionStoreError('touch', sid, e);
      cb(e);
    }
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

async function getPromotionRules(guildId) {
  const { data } = await supabase
    .from('promotion_rules')
    .select('*')
    .eq('guild_id', guildId)
    .order('threshold_points', { ascending: true });
  return data || [];
}

async function addPromotionRule(guildId, thresholdPoints, label = 'تنبيه ترقية') {
  await ensureGuild(guildId);
  return handle(await supabase
    .from('promotion_rules')
    .upsert({
      guild_id: guildId,
      threshold_points: normalizePoints(thresholdPoints),
      label: label || 'تنبيه ترقية'
    }, { onConflict: 'guild_id,threshold_points' })
    .select()
    .single());
}

async function deletePromotionRule(ruleId) {
  return handle(await supabase.from('promotion_rules').delete().eq('id', ruleId));
}

async function markPromotionAlert(guildId, userId, ruleId, pointsAtTrigger) {
  const { data, error } = await supabase.from('promotion_alerts').insert({
    guild_id: guildId,
    user_id: userId,
    rule_id: ruleId,
    points_at_trigger: normalizePoints(pointsAtTrigger)
  }).select().single();

  if (error) {
    if ((error.code === '23505') || /duplicate key/i.test(error.message || '')) return null;
    throw error;
  }
  return data;
}

// ════════════════════════════════════════════════════════════════════════════
//  PANELS
// ════════════════════════════════════════════════════════════════════════════
async function ensurePanelNumbers(guildId) {
  if (!guildId) return;
  const { data, error } = await supabase
    .from('panels')
    .select('id, panel_number, created_at')
    .eq('guild_id', guildId)
    .order('created_at', { ascending: true });
  if (error || !data?.length) return;

  let maxNumber = data.reduce((max, row) => {
    const n = Number(row.panel_number);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);

  for (const row of data) {
    if (Number.isFinite(Number(row.panel_number)) && Number(row.panel_number) > 0) continue;
    maxNumber += 1;
    await supabase.from('panels').update({ panel_number: maxNumber }).eq('id', row.id);
  }
}

async function getPanelByRef(guildId, panelRef) {
  if (!panelRef) return null;
  const direct = await supabase.from('panels').select('*').eq('id', panelRef).maybeSingle();
  if (direct.data) return direct.data;

  const num = Number(panelRef);
  if (Number.isInteger(num) && num > 0) {
    if (guildId) await ensurePanelNumbers(guildId);
    let q = supabase.from('panels').select('*').eq('panel_number', num);
    if (guildId) q = q.eq('guild_id', guildId);
    const { data } = await q.maybeSingle();
    return data || null;
  }
  return direct.data || null;
}
async function createPanel(guildId, data) {
  await ensureGuild(guildId);
  await ensurePanelNumbers(guildId);
  const { data: latest } = await supabase
    .from('panels')
    .select('panel_number')
    .eq('guild_id', guildId)
    .order('panel_number', { ascending: false })
    .limit(1);
  const nextNumber = (latest?.[0]?.panel_number || 0) + 1;
  return handle(await supabase
    .from('panels').insert({ guild_id: guildId, panel_number: nextNumber, ...data }).select().single());
}

async function getPanels(guildId) {
  await ensurePanelNumbers(guildId);
  const { data } = await supabase
    .from('panels').select('*').eq('guild_id', guildId).order('panel_number', { ascending: true });
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
    .update({ claimed_by: staffId, claimed_at: new Date().toISOString(), status: 'claimed', last_activity: new Date().toISOString() })
    .eq('channel_id', channelId).select().single());
}

async function unclaimTicket(channelId) {
  return handle(await supabase.from('tickets')
    .update({ claimed_by: null, claimed_at: null, first_staff_reply_at: null, first_staff_reply_by: null, status: 'open', last_activity: new Date().toISOString() })
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
    .from('staff').select('*').eq('guild_id', guildId).order('points_total', { ascending: false });
  return data || [];
}

async function isStaff(guildId, userId) {
  const { data } = await supabase.from('staff')
    .select('user_id').eq('guild_id', guildId).eq('user_id', userId).maybeSingle();
  return !!data;
}

// Check staff via DB table OR via guild staff role
async function isStaffOrHasRole(guildId, userId, memberRoleIds = []) {
  const { data } = await supabase.from('staff')
    .select('user_id').eq('guild_id', guildId).eq('user_id', userId).maybeSingle();
  if (data) return true;

  const guildData = await getGuild(guildId);
  if (guildData?.staff_role_id && memberRoleIds.includes(guildData.staff_role_id)) return true;

  return false;
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

// Update staff rating only (no tickets_closed increment) — called from rating select
async function updateStaffRating(guildId, userId, rating) {
  const { data } = await supabase.from('staff')
    .select('avg_rating, total_ratings').eq('guild_id', guildId).eq('user_id', userId).maybeSingle();
  if (!data) return;

  const total = (data.total_ratings || 0) + 1;
  const avg   = (((data.avg_rating || 0) * (data.total_ratings || 0)) + rating) / total;
  await supabase.from('staff').update({
    total_ratings: total,
    avg_rating: Math.round(avg * 100) / 100
  }).eq('guild_id', guildId).eq('user_id', userId);
}

async function recordPointEvent(guildId, userId, points, source, details = {}) {
  if (!guildId || !userId || !points) return null;
  return handle(await supabase.from('staff_point_events').insert({
    guild_id: guildId,
    user_id: userId,
    points,
    source,
    details
  }).select().single());
}

async function awardPoints(guildId, userId, points, source, details = {}) {
  const value = normalizePoints(points);
  if (!guildId || !userId || value === 0) return null;

  const { data } = await supabase
    .from('staff')
    .select('points_total, points_weekly')
    .eq('guild_id', guildId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!data) return null;

  const beforePoints = data.points_total || 0;
  const update = {
    points_total: beforePoints + value,
    points_weekly: (data.points_weekly || 0) + value
  };

  await supabase.from('staff')
    .update(update)
    .eq('guild_id', guildId)
    .eq('user_id', userId);

  await recordPointEvent(guildId, userId, value, source, details).catch(() => null);
  return { beforePoints, afterPoints: update.points_total, pointsAdded: value };
}

async function awardResponsePoints(guildId, userId, responseSeconds, details = {}) {
  const points = getResponsePoints(responseSeconds);
  if (!points) return null;

  const { data } = await supabase
    .from('staff')
    .select('points_total, points_weekly, avg_response_seconds, total_response_seconds, response_count')
    .eq('guild_id', guildId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!data) return null;

  const beforePoints = data.points_total || 0;
  const responseCount = (data.response_count || 0) + 1;
  const totalResponseSeconds = (data.total_response_seconds || 0) + Math.max(0, Math.round(responseSeconds || 0));
  const avgResponseSeconds = Math.round(totalResponseSeconds / responseCount);

  await supabase.from('staff').update({
    points_total: beforePoints + points,
    points_weekly: (data.points_weekly || 0) + points,
    total_response_seconds: totalResponseSeconds,
    response_count: responseCount,
    avg_response_seconds: avgResponseSeconds
  }).eq('guild_id', guildId).eq('user_id', userId);

  await recordPointEvent(guildId, userId, points, 'response', { responseSeconds, ...details }).catch(() => null);
  return { beforePoints, afterPoints: beforePoints + points, points };
}

async function awardClosePoints(guildId, userId, ticket, details = {}) {
  if (!guildId || !userId || !ticket) return null;

  const { data } = await supabase
    .from('staff')
    .select('points_total, points_weekly, streak_days, best_streak, last_point_date')
    .eq('guild_id', guildId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!data) return null;

  const beforePoints = data.points_total || 0;
  const today = getRiyadhDateKey();
  const yesterday = getYesterdayKey();
  let streakDays = data.streak_days || 0;
  if (data.last_point_date === yesterday) streakDays += 1;
  else if (data.last_point_date === today) streakDays = streakDays || 1;
  else streakDays = 1;

  const streakBonus = getStreakBonus(streakDays);
  const points = 10 + streakBonus;

  const update = {
    points_total: beforePoints + points,
    points_weekly: (data.points_weekly || 0) + points,
    streak_days: streakDays,
    best_streak: Math.max(data.best_streak || 0, streakDays),
    last_point_date: today
  };

  await supabase.from('staff')
    .update(update)
    .eq('guild_id', guildId)
    .eq('user_id', userId);

  await recordPointEvent(guildId, userId, 10, 'close', { ...details, streakDays }).catch(() => null);
  if (streakBonus) await recordPointEvent(guildId, userId, streakBonus, 'streak_bonus', { ...details, streakDays }).catch(() => null);

  return { beforePoints, afterPoints: update.points_total, pointsAdded: points, streakBonus, streakDays };
}

async function markFirstStaffReply(channelId, staffId) {
  const ticket = await getTicket(channelId);
  if (!ticket || ticket.status === 'closed' || ticket.first_staff_reply_at) return null;

  const now = new Date().toISOString();
  const responseSeconds = ticket.created_at
    ? Math.max(0, Math.round((new Date(now).getTime() - new Date(ticket.created_at).getTime()) / 1000))
    : null;

  const updated = await handle(await supabase.from('tickets')
    .update({
      first_staff_reply_at: now,
      first_staff_reply_by: staffId,
      last_activity: now
    })
    .eq('channel_id', channelId)
    .select()
    .single());

  const reward = await awardResponsePoints(ticket.guild_id, staffId, responseSeconds, {
    ticket_id: ticket.id,
    channel_id: channelId
  }).catch(() => null);

  return { ticket: updated, reward };
}

async function getPointsLeaderboard(guildId, scope = 'total', limit = 10) {
  if (scope === 'weekly') {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase.from('staff_point_events')
      .select('user_id, points, created_at')
      .eq('guild_id', guildId)
      .gte('created_at', since);

    const totals = new Map();
    for (const row of data || []) {
      totals.set(row.user_id, (totals.get(row.user_id) || 0) + (row.points || 0));
    }
    return [...totals.entries()]
      .map(([user_id, points]) => ({ user_id, points }))
      .sort((a, b) => b.points - a.points)
      .slice(0, limit);
  }

  const { data } = await supabase.from('staff')
    .select('user_id, points_total, points_weekly, streak_days, best_streak, avg_response_seconds, response_count, available, tickets_closed')
    .eq('guild_id', guildId)
    .order('points_total', { ascending: false })
    .limit(limit);

  return (data || []).map(row => ({
    user_id: row.user_id,
    points: row.points_total || 0,
    weekly_points: row.points_weekly || 0,
    streak_days: row.streak_days || 0,
    best_streak: row.best_streak || 0,
    avg_response_seconds: row.avg_response_seconds || 0,
    response_count: row.response_count || 0,
    available: row.available,
    tickets_closed: row.tickets_closed || 0
  }));
}

async function getStaffPointsSummary(guildId, userId) {
  const { data } = await supabase.from('staff')
    .select('*')
    .eq('guild_id', guildId)
    .eq('user_id', userId)
    .maybeSingle();
  return data;
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
async function addKeyword(guildId, panelId, keyword, response, matchType = 'contains', caseSensitive = false, triggerRoleId = null) {
  await ensureGuild(guildId);
  return handle(await supabase.from('keywords').insert({
    guild_id: guildId,
    panel_id: panelId || null,
    keyword,
    response,
    match_type: matchType,
    case_sensitive: caseSensitive,
    trigger_role_id: triggerRoleId || null,
    enabled: true
  }).select().single());
}

async function getKeywords(guildId, panelId = null) {
  let q = supabase.from('keywords').select('*').eq('guild_id', guildId).eq('enabled', true);
  if (panelId) q = q.or(`panel_id.eq.${panelId},panel_id.is.null`);
  else q = q.is('panel_id', null);
  const { data } = await q;
  return data || [];
}

// ─── Set user points to a specific rank's minimum threshold ──────────────────
const RANK_THRESHOLDS = {
  'مبتدئ':   0,
  'نشيط':   100,
  'محترف':  300,
  'خبير':   700,
  'أسطورة': 1500
};

async function setUserRankPoints(guildId, userId, rankName) {
  const threshold = RANK_THRESHOLDS[rankName];
  if (threshold === undefined) throw new Error(`رتبة غير معروفة: ${rankName}`);
  await ensureGuild(guildId);
  // Ensure staff row exists
  await supabase.from('staff').upsert({
    guild_id: guildId,
    user_id: userId,
    points_total: threshold,
    points_weekly: threshold > 0 ? threshold : 0
  }, { onConflict: 'guild_id,user_id', ignoreDuplicates: false });
  const { data } = await supabase.from('staff')
    .select('points_total')
    .eq('guild_id', guildId)
    .eq('user_id', userId)
    .maybeSingle();
  return { afterPoints: data?.points_total || threshold };
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
  getPromotionRules, addPromotionRule, deletePromotionRule, markPromotionAlert,
  // Panels
  createPanel, getPanels, getPanel, getPanelByRef, ensurePanelNumbers, updatePanel, deletePanel, setPanelMessage,
  // Tickets
  createTicket, getTicket, getTicketById, getOpenTicketsByUser,
  getTicketsByGuild, getTicketsForAutoClose, updateTicket,
  closeTicket, claimTicket, unclaimTicket, setTicketPriority, rateTicket, updateLastActivity,
  // Staff
  addStaff, removeStaff, getStaff, isStaff, isStaffOrHasRole,
  updateStaffAvailability, incrementStaffClosed, updateStaffRating,
  // Points
  recordPointEvent, awardPoints, awardResponsePoints, awardClosePoints, markFirstStaffReply,
  getPointsLeaderboard, getStaffPointsSummary,
  // Notes
  addNote, getNotes,
  // Keywords
  addKeyword, getKeywords, getAllKeywords, deleteKeyword, incrementKeywordHit,
  // Ranks
  setUserRankPoints, RANK_THRESHOLDS,
  // Bans
  banUser, unbanUser, isBanned, getBans,
  // Transcripts
  saveTranscript, getTranscript,
  // Logs
  addLog, getLogs,
  // Stats
  getGuildStats
};
