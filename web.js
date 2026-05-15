const express  = require('express');
const session  = require('express-session');
const passport = require('passport');
const { Strategy: DiscordStrategy } = require('passport-discord');
const path     = require('path');
const db       = require('./database');

const app = express();
const isProduction = process.env.NODE_ENV === 'production' || !!process.env.RENDER || !!process.env.RENDER_SERVICE_ID;

const env = (...names) => {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && String(value).trim() !== '') return value;
  }
  return undefined;
};

const assetVersionRaw = env('ASSET_VERSION');
const assetVersionCandidate = String(assetVersionRaw || '').trim();
const assetVersion = Number.isInteger(Number(assetVersionCandidate)) && assetVersionCandidate !== '' ? assetVersionCandidate : '1';

app.disable('x-powered-by');
app.set('trust proxy', 1);

// ════════════════════════════════════════════════════════════════════════════
//  SETUP
// ════════════════════════════════════════════════════════════════════════════
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.locals.assetVersion = assetVersion;
app.locals.appName = 'SkyTicket';
app.locals.themeColor = '#dc2626';
app.use((req, res, next) => {
  res.locals.assetVersion = assetVersion;
  next();
});


app.use((req, res, next) => {
  req.requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const started = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - started;
    console.log(`[Web] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${ms}ms) [${req.requestId}]`);
  });
  next();
});

app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: isProduction ? '7d' : 0,
  etag: false,
  lastModified: false
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Session ─────────────────────────────────────────────────────────────────
const callbackURL = env('DISCORD_CALLBACK_URL', 'REDIRECT_URI', 'CALLBACK_URL') || 'http://localhost:3000/auth/callback';
const discordClientId = env('DISCORD_CLIENT_ID', 'CLIENT_ID');
const discordClientSecret = env('DISCORD_CLIENT_SECRET', 'CLIENT_SECRET');
const sessionSecret = env('SESSION_SECRET') || 'skyticket_secret';
const sessionStore = new db.SupabaseStore();
if (typeof sessionStore.on === 'function') {
  sessionStore.on('error', (err) => console.error('[SessionStore] Error:', err));
}

app.use((req, res, next) => {
  const noStorePaths = ['/login', '/auth/discord', '/auth/callback', '/auth/discord/callback', '/dashboard', '/guild'];
  if (noStorePaths.some(p => req.path === p || req.path.startsWith(p + '/'))) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  res.setHeader('X-App-Version', assetVersion);
  next();
});

app.use(session({
  store:             sessionStore,
  secret:            sessionSecret,
  resave:            false,
  saveUninitialized: false,
  proxy:             true,
  name:              'skyticket.sid',
  cookie:            {
    secure: isProduction,
    httpOnly: true,
    sameSite: isProduction ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));

// ─── Passport Discord OAuth2 ─────────────────────────────────────────────────
passport.use(new DiscordStrategy({
  clientID:     discordClientId,
  clientSecret: discordClientSecret,
  callbackURL,
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
if (!discordClientId || !discordClientSecret) {
  console.warn('[Web] Discord OAuth env is incomplete. Expected DISCORD_CLIENT_ID/CLIENT_ID and DISCORD_CLIENT_SECRET/CLIENT_SECRET.');
}

app.get('/login', (req, res) => {
  if (req.isAuthenticated()) return res.redirect('/dashboard');
  res.render('login', {
    error: req.query.error || null,
    callbackURL: isProduction ? 'Discord OAuth جاهز' : callbackURL,
    assetVersion
  });
});

const discordAuth = passport.authenticate('discord', { scope: ['identify', 'guilds'] });

app.get(['/auth', '/auth/discord'], discordAuth);

function handleDiscordCallback(req, res, next) {
  passport.authenticate('discord', (err, user, info) => {
    if (err) {
      console.error('[Auth] OAuth error:', err);
      return next(err);
    }

    if (!user) {
      console.warn('[Auth] OAuth rejected:', info || 'unknown');
      return res.redirect('/login?error=' + encodeURIComponent('فشل تسجيل الدخول عبر Discord'));
    }

    const redirectTo = req.session?.returnTo || '/dashboard';

    req.logIn(user, (loginErr) => {
      if (loginErr) {
        console.error('[Auth] Login session error:', loginErr);
        return next(loginErr);
      }

      if (req.session) delete req.session.returnTo;

      if (!req.session || typeof req.session.save !== 'function') {
        console.error('[Auth] Session object missing after login', { hasSession: !!req.session, sessionID: req.sessionID });
        return res.redirect(redirectTo);
      }

      req.session.save((saveErr) => {
        if (saveErr) {
          console.error('[Auth] Session save error:', saveErr);
          return next(saveErr);
        }
        console.log('[Auth] Login success:', {
          user: user.id || user.username,
          sessionID: req.sessionID,
          redirect: redirectTo,
          cookie: req.session?.cookie ? { secure: req.session.cookie.secure, sameSite: req.session.cookie.sameSite } : null
        });
        res.redirect(redirectTo);
      });
    });
  })(req, res, next);
}

app.get(['/auth/callback', '/auth/discord/callback'], handleDiscordCallback);

app.get('/logout', (req, res) => {
  const finish = () => res.redirect('/login');
  if (!req.logout) return finish();
  req.logout((err) => {
    if (err) console.error('[Auth] Logout error:', err);
    if (req.session) {
      req.session.destroy(() => finish());
    } else {
      finish();
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  DASHBOARD PAGES
// ════════════════════════════════════════════════════════════════════════════
app.get('/', (req, res) => res.redirect('/dashboard'));

app.get('/dashboard', ensureAuth, async (req, res) => {
  try {
    const guilds = Array.isArray(req.user?.guilds) ? req.user.guilds : [];
    const { client } = require('./bot');
    const manageable = guilds.filter(g => client.guilds.cache.has(g.id));
    if (manageable.length === 1) return res.redirect(`/guild/${manageable[0].id}`);
    res.render('dashboard', { user: req.user, guilds: manageable });
  } catch {
    res.render('dashboard', { user: req.user, guilds: [] });
  }
});

app.get('/guild/:id', ensureAuth, ensureGuildAdminPage, async (req, res) => {
  try {
    const guild     = req.guild;
    const guildData = await db.getGuild(guild.id) || {};
    const [panels, staffList, keywords, allTickets, bans, logs, stats, promotionRules] = await Promise.all([
      db.getPanels(guild.id),
      db.getStaff(guild.id),
      db.getAllKeywords(guild.id),
      db.getTicketsByGuild(guild.id),
      db.getBans(guild.id),
      db.getLogs(guild.id, 50),
      db.getGuildStats(guild.id),
      db.getPromotionRules(guild.id)
    ]);

    const categoryChannels = guild.channels.cache
      .filter(ch => ch?.type === 4)
      .sort((a, b) => a.position - b.position)
      .map(ch => ({ id: ch.id, name: ch.name }));

    // Collect all user IDs we need to resolve
    const allUserIds = new Set([
      ...staffList.map(s => s.user_id),
      ...bans.map(b => [b.user_id, b.banned_by]).flat().filter(Boolean),
      ...logs.map(l => [l.actor_id, l.target_id]).flat().filter(Boolean)
    ]);

    // Fetch unknown members from Discord
    for (const uid of allUserIds) {
      if (!guild.members.cache.has(uid)) {
        await guild.members.fetch(uid).catch(() => {});
      }
    }

    // Helper to get display name
    const resolveName = (uid) => {
      if (!uid) return null;
      const m = guild.members.cache.get(uid);
      return m?.displayName || m?.user?.username || uid;
    };

    // Resolve usernames from Discord cache for tickets
    const enriched = allTickets.slice(0, 100).map(t => ({
      ...t,
      userTag:   resolveName(t.user_id)  || t.user_id,
      staffTag:  t.claimed_by ? (resolveName(t.claimed_by) || t.claimed_by) : null,
      panelName: panels.find(p => p.id === t.panel_id)?.name || '—'
    }));

    // Enrich staff with display names
    const enrichedStaff = staffList.map(s => ({
      ...s,
      displayName: resolveName(s.user_id) || s.user_id
    }));

    // Enrich bans with display names
    const enrichedBans = bans.map(b => ({
      ...b,
      displayName:   resolveName(b.user_id)  || b.user_id,
      bannedByName:  resolveName(b.banned_by) || b.banned_by || '—'
    }));

    // Enrich logs with display names
    const enrichedLogs = logs.map(l => ({
      ...l,
      actorName:  resolveName(l.actor_id)  || l.actor_id  || '—',
      targetName: resolveName(l.target_id) || l.target_id || '—'
    }));

    // Get guild roles for keyword trigger selector
    const guildRoles = guild.roles.cache
      .filter(r => !r.managed && r.id !== guild.id)
      .sort((a, b) => b.position - a.position)
      .map(r => ({ id: r.id, name: r.name }));

    res.render('guild_dashboard', {
      user:      req.user,
      guild:     { id: guild.id, name: guild.name, icon: guild.iconURL({ dynamic: true }) },
      guildData,
      panels,
      staff:     enrichedStaff,
      keywords,
      tickets:   enriched,
      bans:      enrichedBans,
      logs:      enrichedLogs,
      stats,
      promotionRules,
      categoryChannels,
      guildRoles
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
            embed_color, embed_footer, embed_image, embed_thumbnail,
            welcome_message, close_message,
            button_label, button_emoji, button_style,
            close_button_label, claim_button_label,
            confirm_close_label, cancel_close_label,
            priority_placeholder, rating_placeholder,
            category_open, category_close,
            mention_role, require_reason, dm_on_close } = req.body;

    const panel = await db.createPanel(guild_id, {
      name, description, embed_title, embed_description,
      embed_color: embed_color || '#dc2626',
      embed_footer, embed_image, embed_thumbnail,
      welcome_message, close_message,
      button_label: button_label || 'فتح تذكرة',
      button_emoji: button_emoji || '🎫',
      button_style: button_style || 'DANGER',
      close_button_label: close_button_label || 'إغلاق',
      claim_button_label: claim_button_label || 'استلام',
      confirm_close_label: confirm_close_label || 'نعم، أغلق',
      cancel_close_label: cancel_close_label || 'إلغاء',
      priority_placeholder: priority_placeholder || 'تغيير الأولوية...',
      rating_placeholder: rating_placeholder || 'قيّم تجربتك (اختياري)',
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
    let panel = await db.getPanel(req.params.panelId);
    if (!panel) panel = await db.getPanelByRef(req.body.guild_id || req.params.guildId || req.params.id || null, req.params.panelId);
    if (!panel) return res.status(404).json({ error: 'اللوحة غير موجودة' });

    // Verify admin on that guild
    const { client } = require('./bot');
    const guild  = client.guilds.cache.get(panel.guild_id);
    const member = await guild?.members.fetch(req.user.id).catch(() => null);
    if (!member?.permissions.has('Administrator')) return res.status(403).json({ error: 'ليس لديك الصلاحيات الكافية' });

    const updates = {};
    const allowed = ['name','description','embed_title','embed_description','embed_color','embed_footer','embed_image','embed_thumbnail',
                     'welcome_message','close_message','button_label','button_emoji','button_style',
                     'close_button_label','claim_button_label','confirm_close_label','cancel_close_label',
                     'priority_placeholder','rating_placeholder','require_reason',
                     'dm_on_close','category_open','category_close','mention_role'];
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

    const updated = await db.updatePanel(req.params.panelId, updates);
    await db.addLog(panel.guild_id, 'PANEL_EDIT', req.user.id, null, { panel_id: panel.id });
    res.json({ success: true, panel: updated });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/panel/:panelId', ensureAuth, async (req, res) => {
  try {
    let panel = await db.getPanel(req.params.panelId);
    if (!panel) panel = await db.getPanelByRef(req.body.guild_id || req.params.guildId || req.params.id || null, req.params.panelId);
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
    let panel  = await db.getPanel(req.params.panelId);
    if (!panel) panel = await db.getPanelByRef(req.body.guild_id || req.params.guildId || req.params.id || null, req.params.panelId);
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
    const { guild_id, panel_id, keyword, response, match_type, case_sensitive, trigger_role_id } = req.body;
    const kw = await db.addKeyword(guild_id, panel_id || null, keyword, response, match_type || 'contains', case_sensitive === 'true', trigger_role_id || null);
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
                     'log_channel_id','dm_transcript','ping_on_open','require_close_reason',
                     'ticket_prefix','rating_channel_id','staff_role_id','promotion_role_id','promotion_channel_id'];
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
//  API — PROMOTION RULES
// ════════════════════════════════════════════════════════════════════════════
app.get('/api/guild/:guildId/promotion-rules', ensureAuth, ensureGuildAdmin, async (req, res) => {
  try {
    res.json(await db.getPromotionRules(req.params.guildId));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/guild/:guildId/promotion-rules', ensureAuth, ensureGuildAdmin, async (req, res) => {
  try {
    const threshold = parseInt(req.body.threshold_points);
    if (!Number.isFinite(threshold) || threshold <= 0) {
      return res.status(400).json({ error: 'أدخل عدد نقاط صحيح' });
    }
    const label = (req.body.label || 'تنبيه ترقية').trim();
    const rule = await db.addPromotionRule(req.params.guildId, threshold, label);
    await db.addLog(req.params.guildId, 'PROMOTION_RULE_CREATE', req.user.id, null, { rule_id: rule.id, threshold });
    res.json({ success: true, rule });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/guild/:guildId/promotion-rules/:ruleId', ensureAuth, ensureGuildAdmin, async (req, res) => {
  try {
    await db.deletePromotionRule(req.params.ruleId);
    await db.addLog(req.params.guildId, 'PROMOTION_RULE_DELETE', req.user.id, null, { rule_id: req.params.ruleId });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ════════════════════════════════════════════════════════════════════════════
//  API — SET RANK
// ════════════════════════════════════════════════════════════════════════════
app.post('/api/guild/:guildId/set-rank', ensureAuth, ensureGuildAdmin, async (req, res) => {
  try {
    const { user_id, rank } = req.body;
    if (!user_id || !rank) return res.status(400).json({ error: 'user_id و rank مطلوبان' });
    // Ensure staff row
    await db.addStaff(req.params.guildId, user_id, req.user.id).catch(() => {});
    const result = await db.setUserRankPoints(req.params.guildId, user_id, rank);
    await db.addLog(req.params.guildId, 'RANK_SET', req.user.id, user_id, { rank, points: result.afterPoints });
    res.json({ success: true, afterPoints: result.afterPoints });
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

app.get('/api/guild/:guildId/members', ensureAuth, ensureGuildAdmin, async (req, res) => {
  try {
    const { client } = require('./bot');
    const guild = client.guilds.cache.get(req.params.guildId);
    if (!guild) return res.status(404).json({ error: 'السيرفر غير موجود' });

    try {
      await guild.members.fetch();
    } catch (fetchErr) {
      console.warn('[Web] Member fetch fallback:', fetchErr?.message || fetchErr);
    }

    const members = guild.members.cache
      .filter(m => m?.user && !m.user.bot)
      .map(m => ({
        id: m.id,
        name: m.displayName || m.user.username || m.user.tag || m.id,
        tag: m.user.tag || m.user.username || m.id,
        avatar: m.user.displayAvatarURL?.({ size: 64 }) || null
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ar'));

    res.json(members);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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
app.use((req, res) => res.status(404).render('error', { message: 'الصفحة غير موجودة (404)', assetVersion }));

app.use((err, req, res, next) => {
  console.error('[Web] Unhandled error:', {
    message: err?.message,
    stack: err?.stack,
    path: req?.originalUrl,
    method: req?.method,
    requestId: req?.requestId
  });
  if (res.headersSent) return next(err);
  res.status(500).render('error', { message: 'خطأ في الخادم (500)', assetVersion });
});

// ════════════════════════════════════════════════════════════════════════════
//  START
// ════════════════════════════════════════════════════════════════════════════
function startWeb() {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`[Web] Dashboard running on port ${port} ✅`);
    console.log(`[Web] Asset version: ${assetVersion}`);
    console.log(`[Web] OAuth callback: ${callbackURL}`);
    console.log(`[Web] OAuth client configured: ${discordClientId ? 'yes' : 'no'}`);
    console.log(`[Web] Production mode: ${isProduction ? 'yes' : 'no'}`);
    if (!discordClientId || !discordClientSecret) {
      console.warn('[Web] Missing Discord OAuth env vars. Set DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET or CLIENT_ID / CLIENT_SECRET.');
    }
  });
}

module.exports = { startWeb };
