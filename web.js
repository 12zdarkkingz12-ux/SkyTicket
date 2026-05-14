const express  = require('express');
const session  = require('express-session');
const passport = require('passport');
const { Strategy: DiscordStrategy } = require('passport-discord');
const path     = require('path');
const db       = require('./database');

const app = express();

// ════════════════════════════════════════════════════════════════════════════
//  SETUP
// ════════════════════════════════════════════════════════════════════════════
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Session ─────────────────────────────────────────────────────────────────
app.use(session({
  store:             new db.SupabaseStore(),
  secret:            process.env.SESSION_SECRET || 'skyticket_secret',
  resave:            false,
  saveUninitialized: false,
  cookie:            { secure: process.env.NODE_ENV === 'production', maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

// ─── Passport Discord OAuth2 ─────────────────────────────────────────────────
passport.use(new DiscordStrategy({
  clientID:     process.env.CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET,
  callbackURL:  process.env.REDIRECT_URI,
  scope:        ['identify', 'guilds']
}, (_at, _rt, profile, done) => done(null, profile)));

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

app.use(passport.initialize());
app.use(passport.session());

// ════════════════════════════════════════════════════════════════════════════
//  MIDDLEWARE
// ════════════════════════════════════════════════════════════════════════════
function ensureAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  req.session.returnTo = req.originalUrl;
  res.redirect('/login');
}

// Critical: verify user has Administrator permission in the target guild
async function ensureGuildAdmin(req, res, next) {
  const guildId = req.body?.guild_id || req.params?.guildId || req.params?.id;
  if (!guildId) return res.status(400).json({ error: 'معرف السيرفر مطلوب' });

  try {
    const { client } = require('./bot');
    const guild      = client.guilds.cache.get(guildId);
    if (!guild) return res.status(404).json({ error: 'البوت ليس في هذا السيرفر' });

    const member = await guild.members.fetch(req.user.id).catch(() => null);
    if (!member || !member.permissions.has('Administrator'))
      return res.status(403).json({ error: 'ليس لديك الصلاحيات الكافية' });

    req.guild  = guild;
    req.member = member;
    next();
  } catch {
    return res.status(500).json({ error: 'خطأ في التحقق من الصلاحيات' });
  }
}

// Middleware that rejects non-admins at page level (not API)
async function ensureGuildAdminPage(req, res, next) {
  const guildId = req.params.id;
  try {
    const { client } = require('./bot');
    const guild  = client.guilds.cache.get(guildId);
    if (!guild) return res.status(404).render('error', { message: 'السيرفر غير موجود أو البوت لم يُضاف بعد' });

    const member = await guild.members.fetch(req.user.id).catch(() => null);
    if (!member || !member.permissions.has('Administrator'))
      return res.status(403).render('error', { message: 'ليس لديك الصلاحيات الكافية للوصول إلى لوحة التحكم' });

    req.guild  = guild;
    req.member = member;
    next();
  } catch {
    return res.status(500).render('error', { message: 'حدث خطأ. حاول مجدداً.' });
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  AUTH ROUTES
// ════════════════════════════════════════════════════════════════════════════
app.get('/login', (req, res) => {
  if (req.isAuthenticated()) return res.redirect('/dashboard');
  res.render('login');
});

app.get('/auth/discord', passport.authenticate('discord'));

app.get('/auth/callback', passport.authenticate('discord', {
  failureRedirect: '/login'
}), (req, res) => {
  const to = req.session.returnTo || '/dashboard';
  delete req.session.returnTo;
  res.redirect(to);
});

app.get('/logout', (req, res) => {
  req.logout(() => res.redirect('/login'));
});

// ════════════════════════════════════════════════════════════════════════════
//  DASHBOARD PAGES
// ════════════════════════════════════════════════════════════════════════════
app.get('/', (req, res) => res.redirect('/dashboard'));

app.get('/dashboard', ensureAuth, async (req, res) => {
  try {
    const { client } = require('./bot');
    const guild = client.guilds.cache.get(process.env.GUILD_ID);
    if (!guild) return res.render('dashboard', { user: req.user, guild: null });
    res.redirect(`/guild/${guild.id}`);
  } catch {
    res.render('dashboard', { user: req.user, guild: null });
  }
});

app.get('/guild/:id', ensureAuth, ensureGuildAdminPage, async (req, res) => {
  try {
    const guild     = req.guild;
    const guildData = await db.getGuild(guild.id) || {};
    const [panels, staffList, keywords, allTickets, bans, logs, stats] = await Promise.all([
      db.getPanels(guild.id),
      db.getStaff(guild.id),
      db.getAllKeywords(guild.id),
      db.getTicketsByGuild(guild.id),
      db.getBans(guild.id),
      db.getLogs(guild.id, 50),
      db.getGuildStats(guild.id)
    ]);

    // Resolve usernames from Discord cache for tickets
    const enriched = allTickets.slice(0, 100).map(t => ({
      ...t,
      userTag:  guild.members.cache.get(t.user_id)?.user?.tag  || t.user_id,
      staffTag: t.claimed_by ? guild.members.cache.get(t.claimed_by)?.user?.tag || t.claimed_by : null,
      panelName: panels.find(p => p.id === t.panel_id)?.name || '—'
    }));

    res.render('guild_dashboard', {
      user:      req.user,
      guild:     { id: guild.id, name: guild.name, icon: guild.iconURL({ dynamic: true }) },
      guildData,
      panels,
      staff:     staffList,
      keywords,
      tickets:   enriched,
      bans,
      logs,
      stats
    });
  } catch (err) {
    console.error('[Dashboard]', err);
    res.status(500).render('error', { message: 'حدث خطأ في تحميل لوحة التحكم' });
  }
});

// ════════════════════════════════════════════════════════════════════════════
//  API — STATS
// ════════════════════════════════════════════════════════════════════════════
app.get('/api/guild/:guildId/stats', ensureAuth, ensureGuildAdmin, async (req, res) => {
  try {
    const stats = await db.getGuildStats(req.params.guildId);
    res.json(stats);
  } catch { res.status(500).json({ error: 'خطأ في قراءة الإحصائيات' }); }
});

// ════════════════════════════════════════════════════════════════════════════
//  API — PANELS
// ════════════════════════════════════════════════════════════════════════════
app.post('/api/panel', ensureAuth, ensureGuildAdmin, async (req, res) => {
  try {
    const { guild_id, name, description, embed_title, embed_description,
            embed_color, embed_footer, welcome_message, close_message,
            button_label, button_style, category_open, category_close,
            mention_role, require_reason, dm_on_close } = req.body;

    const panel = await db.createPanel(guild_id, {
      name, description, embed_title, embed_description,
      embed_color: embed_color || '#4f7ef7',
      embed_footer, welcome_message, close_message,
      button_label: button_label || '🎫 فتح تذكرة',
      button_style: button_style || 'PRIMARY',
      category_open:  category_open  || null,
      category_close: category_close || null,
      mention_role:   mention_role   || null,
      require_reason: require_reason === 'true',
      dm_on_close:    dm_on_close    !== 'false'
    });

    await db.addLog(guild_id, 'PANEL_CREATE', req.user.id, null, { panel_id: panel.id, name });
    res.json({ success: true, panel });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/panel/:panelId', ensureAuth, async (req, res) => {
  try {
    const panel = await db.getPanel(req.params.panelId);
    if (!panel) return res.status(404).json({ error: 'اللوحة غير موجودة' });

    // Verify admin on that guild
    const { client } = require('./bot');
    const guild  = client.guilds.cache.get(panel.guild_id);
    const member = await guild?.members.fetch(req.user.id).catch(() => null);
    if (!member?.permissions.has('Administrator')) return res.status(403).json({ error: 'ليس لديك الصلاحيات الكافية' });

    const updates = {};
    const allowed = ['name','description','embed_title','embed_description','embed_color','embed_footer',
                     'welcome_message','close_message','button_label','button_style','require_reason',
                     'dm_on_close','category_open','category_close','mention_role','embed_image','embed_thumbnail'];
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

    const updated = await db.updatePanel(req.params.panelId, updates);
    await db.addLog(panel.guild_id, 'PANEL_EDIT', req.user.id, null, { panel_id: panel.id });
    res.json({ success: true, panel: updated });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/panel/:panelId', ensureAuth, async (req, res) => {
  try {
    const panel = await db.getPanel(req.params.panelId);
    if (!panel) return res.status(404).json({ error: 'اللوحة غير موجودة' });

    const { client } = require('./bot');
    const guild  = client.guilds.cache.get(panel.guild_id);
    const member = await guild?.members.fetch(req.user.id).catch(() => null);
    if (!member?.permissions.has('Administrator')) return res.status(403).json({ error: 'ليس لديك الصلاحيات الكافية' });

    await db.deletePanel(panel.id);
    await db.addLog(panel.guild_id, 'PANEL_DELETE', req.user.id, null, { name: panel.name });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Send panel to a channel
app.post('/api/panel/:panelId/send', ensureAuth, async (req, res) => {
  try {
    const panel  = await db.getPanel(req.params.panelId);
    if (!panel) return res.status(404).json({ error: 'اللوحة غير موجودة' });

    const { client } = require('./bot');
    const guild  = client.guilds.cache.get(panel.guild_id);
    const member = await guild?.members.fetch(req.user.id).catch(() => null);
    if (!member?.permissions.has('Administrator')) return res.status(403).json({ error: 'ليس لديك الصلاحيات الكافية' });

    const { channel_id } = req.body;
    const channel = guild.channels.cache.get(channel_id);
    if (!channel) return res.status(404).json({ error: 'القناة غير موجودة' });

    const { sendPanelEmbed } = require('./commands');
    await sendPanelEmbed(channel, panel, guild);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ════════════════════════════════════════════════════════════════════════════
//  API — STAFF
// ════════════════════════════════════════════════════════════════════════════
app.post('/api/staff', ensureAuth, ensureGuildAdmin, async (req, res) => {
  try {
    const { guild_id, user_id } = req.body;
    const staff = await db.addStaff(guild_id, user_id, req.user.id);
    await db.addLog(guild_id, 'STAFF_ADD', req.user.id, user_id, {});
    res.json({ success: true, staff });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/staff/:userId/:guildId', ensureAuth, ensureGuildAdmin, async (req, res) => {
  try {
    const { userId, guildId } = req.params;
    req.body = { guild_id: guildId }; // for ensureGuildAdmin compat
    await db.removeStaff(guildId, userId);
    await db.addLog(guildId, 'STAFF_REMOVE', req.user.id, userId, {});
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ════════════════════════════════════════════════════════════════════════════
//  API — KEYWORDS
// ════════════════════════════════════════════════════════════════════════════
app.post('/api/keyword', ensureAuth, ensureGuildAdmin, async (req, res) => {
  try {
    const { guild_id, panel_id, keyword, response, match_type, case_sensitive } = req.body;
    const kw = await db.addKeyword(guild_id, panel_id || null, keyword, response, match_type || 'contains', case_sensitive === 'true');
    res.json({ success: true, keyword: kw });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/keyword/:id', ensureAuth, async (req, res) => {
  try {
    // Verify ownership via guild_id in query
    const guildId = req.query.guild_id;
    if (guildId) {
      const { client } = require('./bot');
      const guild  = client.guilds.cache.get(guildId);
      const member = await guild?.members.fetch(req.user.id).catch(() => null);
      if (!member?.permissions.has('Administrator')) return res.status(403).json({ error: 'ليس لديك الصلاحيات الكافية' });
    }
    await db.deleteKeyword(req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ════════════════════════════════════════════════════════════════════════════
//  API — BANS
// ════════════════════════════════════════════════════════════════════════════
app.post('/api/ban', ensureAuth, ensureGuildAdmin, async (req, res) => {
  try {
    const { guild_id, user_id, reason, duration } = req.body;
    let expiresAt = null;
    if (duration && duration !== 'permanent') {
      const days = parseInt(duration);
      if (!isNaN(days)) expiresAt = new Date(Date.now() + days * 86400000).toISOString();
    }
    const ban = await db.banUser(guild_id, user_id, reason, req.user.id, expiresAt);
    await db.addLog(guild_id, 'BAN', req.user.id, user_id, { reason });
    res.json({ success: true, ban });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/ban/:guildId/:userId', ensureAuth, ensureGuildAdmin, async (req, res) => {
  try {
    req.body = { guild_id: req.params.guildId };
    await db.unbanUser(req.params.guildId, req.params.userId);
    await db.addLog(req.params.guildId, 'UNBAN', req.user.id, req.params.userId, {});
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ════════════════════════════════════════════════════════════════════════════
//  API — SETTINGS
// ════════════════════════════════════════════════════════════════════════════
app.post('/api/guild/:guildId/settings', ensureAuth, ensureGuildAdmin, async (req, res) => {
  try {
    const allowed = ['max_tickets_per_user','auto_close_hours','auto_close_warn_hours',
                     'log_channel_id','dm_transcript','ping_on_open','require_close_reason','ticket_prefix'];
    const updates = {};
    allowed.forEach(k => {
      if (req.body[k] !== undefined) {
        if (['dm_transcript','ping_on_open','require_close_reason'].includes(k))
          updates[k] = req.body[k] === 'true' || req.body[k] === true;
        else if (['max_tickets_per_user','auto_close_hours','auto_close_warn_hours'].includes(k))
          updates[k] = parseInt(req.body[k]);
        else updates[k] = req.body[k];
      }
    });
    await db.updateGuildSettings(req.params.guildId, updates);
    await db.addLog(req.params.guildId, 'SETTINGS_UPDATE', req.user.id, null, updates);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ════════════════════════════════════════════════════════════════════════════
//  API — TRANSCRIPT
// ════════════════════════════════════════════════════════════════════════════
app.get('/api/transcript/:ticketId', ensureAuth, async (req, res) => {
  try {
    const ticket = await db.getTicketById(req.params.ticketId);
    if (!ticket) return res.status(404).json({ error: 'التذكرة غير موجودة' });

    const { client } = require('./bot');
    const guild  = client.guilds.cache.get(ticket.guild_id);
    const member = await guild?.members.fetch(req.user.id).catch(() => null);
    if (!member?.permissions.has('Administrator')) return res.status(403).json({ error: 'ليس لديك الصلاحيات الكافية' });

    const transcript = await db.getTranscript(ticket.id);
    res.json({ content: transcript?.content || null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ════════════════════════════════════════════════════════════════════════════
//  API — CHANNELS (for dropdowns)
// ════════════════════════════════════════════════════════════════════════════
app.get('/api/guild/:guildId/channels', ensureAuth, ensureGuildAdmin, async (req, res) => {
  try {
    const { client } = require('./bot');
    const guild    = client.guilds.cache.get(req.params.guildId);
    const channels = guild.channels.cache
      .filter(c => c.type === 0) // Text channels only
      .map(c => ({ id: c.id, name: c.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json(channels);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/guild/:guildId/categories', ensureAuth, ensureGuildAdmin, async (req, res) => {
  try {
    const { client } = require('./bot');
    const guild = client.guilds.cache.get(req.params.guildId);
    const cats  = guild.channels.cache
      .filter(c => c.type === 4) // Category channels
      .map(c => ({ id: c.id, name: c.name }));
    res.json(cats);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/guild/:guildId/roles', ensureAuth, ensureGuildAdmin, async (req, res) => {
  try {
    const { client } = require('./bot');
    const guild = client.guilds.cache.get(req.params.guildId);
    const roles = guild.roles.cache
      .filter(r => !r.managed && r.name !== '@everyone')
      .map(r => ({ id: r.id, name: r.name, color: r.hexColor }))
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json(roles);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ════════════════════════════════════════════════════════════════════════════
//  HEALTH (for UptimeRobot)
// ════════════════════════════════════════════════════════════════════════════
app.get('/health', (req, res) => {
  const { client } = require('./bot');
  res.status(200).json({
    status: 'ok',
    bot:    client?.isReady() ? 'online' : 'offline',
    uptime: process.uptime()
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  ERROR PAGES
// ════════════════════════════════════════════════════════════════════════════
app.use((req, res) => res.status(404).render('error', { message: 'الصفحة غير موجودة (404)' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { message: 'خطأ في الخادم (500)' });
});

// ════════════════════════════════════════════════════════════════════════════
//  START
// ════════════════════════════════════════════════════════════════════════════
function startWeb() {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`[Web] Dashboard running on port ${port} ✅`));
}

module.exports = { startWeb };
