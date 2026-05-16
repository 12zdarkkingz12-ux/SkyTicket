-- ╔══════════════════════════════════════════════════════════════╗
-- ║ SkyTicket — Unified Database Schema                          ║
-- ║ Fresh install + safe migration + RLS disabled                ║
-- ╚══════════════════════════════════════════════════════════════╝

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ==============================================================
-- GUILDS
-- ==============================================================
CREATE TABLE IF NOT EXISTS guilds (
  id                     TEXT PRIMARY KEY,
  max_tickets_per_user   INTEGER DEFAULT 1,
  auto_close_hours       INTEGER DEFAULT 72,
  auto_close_warn_hours  INTEGER DEFAULT 48,
  log_channel_id         TEXT,
  rating_channel_id      TEXT,
  staff_role_id          TEXT,
  points_role_id         TEXT,
  promotion_role_id      TEXT,
  promotion_channel_id   TEXT,
  dm_transcript          BOOLEAN DEFAULT false,
  ping_on_open           BOOLEAN DEFAULT true,
  require_close_reason   BOOLEAN DEFAULT false,
  ticket_prefix          TEXT DEFAULT 'ticket',
  created_at             TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE IF EXISTS guilds
  ADD COLUMN IF NOT EXISTS max_tickets_per_user   INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS auto_close_hours       INTEGER DEFAULT 72,
  ADD COLUMN IF NOT EXISTS auto_close_warn_hours  INTEGER DEFAULT 48,
  ADD COLUMN IF NOT EXISTS log_channel_id         TEXT,
  ADD COLUMN IF NOT EXISTS rating_channel_id      TEXT,
  ADD COLUMN IF NOT EXISTS staff_role_id          TEXT,
  ADD COLUMN IF NOT EXISTS points_role_id         TEXT,
  ADD COLUMN IF NOT EXISTS promotion_role_id      TEXT,
  ADD COLUMN IF NOT EXISTS promotion_channel_id   TEXT,
  ADD COLUMN IF NOT EXISTS dm_transcript          BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS ping_on_open           BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS require_close_reason   BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS ticket_prefix          TEXT DEFAULT 'ticket',
  ADD COLUMN IF NOT EXISTS created_at             TIMESTAMPTZ DEFAULT NOW();

-- ==============================================================
-- PANELS
-- ==============================================================
CREATE TABLE IF NOT EXISTS panels (
  id                   TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  panel_number         INTEGER,
  guild_id             TEXT REFERENCES guilds(id) ON DELETE CASCADE,
  name                 TEXT NOT NULL,
  description          TEXT DEFAULT 'افتح تذكرة للحصول على الدعم',
  category_open        TEXT,
  category_close       TEXT,
  mention_role         TEXT,

  embed_title          TEXT DEFAULT '🎫 فتح تذكرة',
  embed_description    TEXT DEFAULT 'اضغط على الزر أدناه لفتح تذكرة دعم',
  embed_color          TEXT DEFAULT '#dc2626',
  embed_footer         TEXT,
  embed_image          TEXT,
  embed_thumbnail      TEXT,

  welcome_message      TEXT DEFAULT 'مرحباً {user}! سيتم مساعدتك قريباً.',
  close_message        TEXT DEFAULT 'تم إغلاق التذكرة. شكراً لتواصلك معنا!',
  claim_message        TEXT DEFAULT '✅ تم استلام تذكرتك من قبل {staff}',

  button_label         TEXT DEFAULT 'فتح تذكرة',
  button_emoji         TEXT DEFAULT '🎫',
  button_style         TEXT DEFAULT 'DANGER',
  close_button_label   TEXT DEFAULT 'إغلاق',
  claim_button_label   TEXT DEFAULT 'استلام',
  confirm_close_label  TEXT DEFAULT 'نعم، أغلق',
  cancel_close_label   TEXT DEFAULT 'إلغاء',

  priority_placeholder TEXT DEFAULT 'تغيير الأولوية...',
  rating_placeholder   TEXT DEFAULT 'قيّم تجربتك (اختياري)',

  require_reason       BOOLEAN DEFAULT false,
  auto_claim           BOOLEAN DEFAULT false,
  dm_on_close          BOOLEAN DEFAULT true,

  message_id           TEXT,
  channel_id           TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_panels_guild ON panels(guild_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_panels_guild_number ON panels(guild_id, panel_number);

ALTER TABLE IF EXISTS panels
  ADD COLUMN IF NOT EXISTS panel_number         INTEGER,
  ADD COLUMN IF NOT EXISTS description          TEXT DEFAULT 'افتح تذكرة للحصول على الدعم',
  ADD COLUMN IF NOT EXISTS category_open        TEXT,
  ADD COLUMN IF NOT EXISTS category_close       TEXT,
  ADD COLUMN IF NOT EXISTS mention_role         TEXT,
  ADD COLUMN IF NOT EXISTS embed_title          TEXT DEFAULT '🎫 فتح تذكرة',
  ADD COLUMN IF NOT EXISTS embed_description    TEXT DEFAULT 'اضغط على الزر أدناه لفتح تذكرة دعم',
  ADD COLUMN IF NOT EXISTS embed_color          TEXT DEFAULT '#dc2626',
  ADD COLUMN IF NOT EXISTS embed_footer         TEXT,
  ADD COLUMN IF NOT EXISTS embed_image          TEXT,
  ADD COLUMN IF NOT EXISTS embed_thumbnail      TEXT,
  ADD COLUMN IF NOT EXISTS welcome_message      TEXT DEFAULT 'مرحباً {user}! سيتم مساعدتك قريباً.',
  ADD COLUMN IF NOT EXISTS close_message        TEXT DEFAULT 'تم إغلاق التذكرة. شكراً لتواصلك معنا!',
  ADD COLUMN IF NOT EXISTS claim_message        TEXT DEFAULT '✅ تم استلام تذكرتك من قبل {staff}',
  ADD COLUMN IF NOT EXISTS button_label         TEXT DEFAULT 'فتح تذكرة',
  ADD COLUMN IF NOT EXISTS button_emoji         TEXT DEFAULT '🎫',
  ADD COLUMN IF NOT EXISTS button_style         TEXT DEFAULT 'DANGER',
  ADD COLUMN IF NOT EXISTS close_button_label   TEXT DEFAULT 'إغلاق',
  ADD COLUMN IF NOT EXISTS claim_button_label   TEXT DEFAULT 'استلام',
  ADD COLUMN IF NOT EXISTS confirm_close_label  TEXT DEFAULT 'نعم، أغلق',
  ADD COLUMN IF NOT EXISTS cancel_close_label   TEXT DEFAULT 'إلغاء',
  ADD COLUMN IF NOT EXISTS priority_placeholder TEXT DEFAULT 'تغيير الأولوية...',
  ADD COLUMN IF NOT EXISTS rating_placeholder   TEXT DEFAULT 'قيّم تجربتك (اختياري)',
  ADD COLUMN IF NOT EXISTS require_reason       BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_claim           BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS dm_on_close          BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS message_id           TEXT,
  ADD COLUMN IF NOT EXISTS channel_id           TEXT,
  ADD COLUMN IF NOT EXISTS created_at           TIMESTAMPTZ DEFAULT NOW();

-- ==============================================================
-- TICKETS
-- ==============================================================
CREATE TABLE IF NOT EXISTS tickets (
  id              SERIAL PRIMARY KEY,
  guild_id        TEXT REFERENCES guilds(id) ON DELETE CASCADE,
  panel_id        TEXT REFERENCES panels(id) ON DELETE SET NULL,
  channel_id      TEXT UNIQUE NOT NULL,
  user_id         TEXT NOT NULL,
  claimed_by      TEXT,
  claimed_at      TIMESTAMPTZ,
  first_staff_reply_at TIMESTAMPTZ,
  first_staff_reply_by  TEXT,
  status          TEXT DEFAULT 'open',
  priority        TEXT DEFAULT 'normal',
  open_reason     TEXT,
  close_reason    TEXT,
  rating          INTEGER,
  rating_comment  TEXT,
  tags            JSONB DEFAULT '[]'::jsonb,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  closed_at       TIMESTAMPTZ,
  last_activity   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tickets_guild         ON tickets(guild_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status        ON tickets(guild_id, status);
CREATE INDEX IF NOT EXISTS idx_tickets_user          ON tickets(guild_id, user_id);
CREATE INDEX IF NOT EXISTS idx_tickets_panel         ON tickets(panel_id);
CREATE INDEX IF NOT EXISTS idx_tickets_last_activity  ON tickets(last_activity);

ALTER TABLE IF EXISTS tickets
  ADD COLUMN IF NOT EXISTS claimed_by      TEXT,
  ADD COLUMN IF NOT EXISTS claimed_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS first_staff_reply_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS first_staff_reply_by  TEXT,
  ADD COLUMN IF NOT EXISTS status          TEXT DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS priority        TEXT DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS open_reason     TEXT,
  ADD COLUMN IF NOT EXISTS close_reason    TEXT,
  ADD COLUMN IF NOT EXISTS rating          INTEGER,
  ADD COLUMN IF NOT EXISTS rating_comment  TEXT,
  ADD COLUMN IF NOT EXISTS tags            JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at      TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS closed_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_activity   TIMESTAMPTZ DEFAULT NOW();

-- ==============================================================
-- STAFF
-- ==============================================================
CREATE TABLE IF NOT EXISTS staff (
  user_id         TEXT NOT NULL,
  guild_id        TEXT REFERENCES guilds(id) ON DELETE CASCADE,
  added_by        TEXT,
  available       BOOLEAN DEFAULT true,
  max_concurrent  INTEGER DEFAULT 10,
  tickets_closed  INTEGER DEFAULT 0,
  points_total    INTEGER DEFAULT 0,
  points_weekly   INTEGER DEFAULT 0,
  streak_days     INTEGER DEFAULT 0,
  best_streak     INTEGER DEFAULT 0,
  last_point_date DATE,
  avg_response_seconds INTEGER DEFAULT 0,
  total_response_seconds BIGINT DEFAULT 0,
  response_count  INTEGER DEFAULT 0,
  avg_rating      NUMERIC(3,2) DEFAULT 0,
  total_ratings   INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, guild_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_guild ON staff(guild_id);

ALTER TABLE IF EXISTS staff
  ADD COLUMN IF NOT EXISTS added_by        TEXT,
  ADD COLUMN IF NOT EXISTS available       BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS max_concurrent  INTEGER DEFAULT 10,
  ADD COLUMN IF NOT EXISTS tickets_closed  INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS points_total    INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS points_weekly   INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS streak_days     INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS best_streak     INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_point_date DATE,
  ADD COLUMN IF NOT EXISTS avg_response_seconds INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_response_seconds BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS response_count  INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_rating      NUMERIC(3,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_ratings   INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_at      TIMESTAMPTZ DEFAULT NOW();

-- ==============================================================
-- PROMOTION RULES
-- ==============================================================
CREATE TABLE IF NOT EXISTS promotion_rules (
  id               SERIAL PRIMARY KEY,
  guild_id         TEXT REFERENCES guilds(id) ON DELETE CASCADE,
  threshold_points INTEGER NOT NULL DEFAULT 0,
  label            TEXT DEFAULT 'تنبيه ترقية',
  enabled          BOOLEAN DEFAULT true,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_promotion_rules_guild_threshold
  ON promotion_rules(guild_id, threshold_points);

ALTER TABLE IF EXISTS promotion_rules
  ADD COLUMN IF NOT EXISTS threshold_points INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS label            TEXT DEFAULT 'تنبيه ترقية',
  ADD COLUMN IF NOT EXISTS enabled          BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_at       TIMESTAMPTZ DEFAULT NOW();

CREATE TABLE IF NOT EXISTS promotion_alerts (
  id               SERIAL PRIMARY KEY,
  guild_id         TEXT REFERENCES guilds(id) ON DELETE CASCADE,
  user_id          TEXT NOT NULL,
  rule_id          INTEGER REFERENCES promotion_rules(id) ON DELETE CASCADE,
  points_at_trigger INTEGER DEFAULT 0,
  notified_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (guild_id, user_id, rule_id)
);

ALTER TABLE IF EXISTS promotion_alerts
  ADD COLUMN IF NOT EXISTS points_at_trigger INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notified_at      TIMESTAMPTZ DEFAULT NOW();

-- ==============================================================
-- POINT EVENTS
-- ==============================================================
CREATE TABLE IF NOT EXISTS staff_point_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id    TEXT REFERENCES guilds(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL,
  ticket_id   INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
  source      TEXT NOT NULL,
  points      INTEGER NOT NULL,
  details     JSONB DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_points_guild ON staff_point_events(guild_id);
CREATE INDEX IF NOT EXISTS idx_staff_points_user  ON staff_point_events(user_id);
CREATE INDEX IF NOT EXISTS idx_staff_points_time  ON staff_point_events(created_at DESC);

ALTER TABLE IF EXISTS staff_point_events
  ADD COLUMN IF NOT EXISTS ticket_id   INTEGER,
  ADD COLUMN IF NOT EXISTS source      TEXT DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS points      INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS details     JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at  TIMESTAMPTZ DEFAULT NOW();

-- ==============================================================
-- TICKET NOTES
-- ==============================================================
CREATE TABLE IF NOT EXISTS ticket_notes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id    INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
  guild_id     TEXT NOT NULL,
  author_id    TEXT NOT NULL,
  content      TEXT NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notes_ticket ON ticket_notes(ticket_id);

ALTER TABLE IF EXISTS ticket_notes
  ADD COLUMN IF NOT EXISTS guild_id     TEXT,
  ADD COLUMN IF NOT EXISTS author_id    TEXT,
  ADD COLUMN IF NOT EXISTS content      TEXT,
  ADD COLUMN IF NOT EXISTS created_at   TIMESTAMPTZ DEFAULT NOW();

-- ==============================================================
-- KEYWORDS
-- ==============================================================
CREATE TABLE IF NOT EXISTS keywords (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id        TEXT REFERENCES guilds(id) ON DELETE CASCADE,
  panel_id        TEXT REFERENCES panels(id) ON DELETE CASCADE,
  keyword         TEXT NOT NULL,
  response        TEXT NOT NULL,
  match_type      TEXT DEFAULT 'contains',
  case_sensitive  BOOLEAN DEFAULT false,
  enabled         BOOLEAN DEFAULT true,
  hit_count       INTEGER DEFAULT 0,
  trigger_role_id TEXT DEFAULT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_keywords_guild ON keywords(guild_id);
CREATE INDEX IF NOT EXISTS idx_keywords_panel ON keywords(panel_id);

ALTER TABLE IF EXISTS keywords
  ADD COLUMN IF NOT EXISTS panel_id        TEXT,
  ADD COLUMN IF NOT EXISTS keyword         TEXT,
  ADD COLUMN IF NOT EXISTS response        TEXT,
  ADD COLUMN IF NOT EXISTS match_type      TEXT DEFAULT 'contains',
  ADD COLUMN IF NOT EXISTS case_sensitive  BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS enabled         BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS hit_count       INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS trigger_role_id TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS created_at      TIMESTAMPTZ DEFAULT NOW();

-- ==============================================================
-- BANS
-- ==============================================================
CREATE TABLE IF NOT EXISTS bans (
  user_id     TEXT NOT NULL,
  guild_id    TEXT REFERENCES guilds(id) ON DELETE CASCADE,
  reason      TEXT,
  banned_by   TEXT,
  expires_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, guild_id)
);

CREATE INDEX IF NOT EXISTS idx_bans_guild       ON bans(guild_id);
CREATE INDEX IF NOT EXISTS idx_bans_expires_at  ON bans(expires_at);

ALTER TABLE IF EXISTS bans
  ADD COLUMN IF NOT EXISTS reason      TEXT,
  ADD COLUMN IF NOT EXISTS banned_by   TEXT,
  ADD COLUMN IF NOT EXISTS expires_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_at  TIMESTAMPTZ DEFAULT NOW();

-- ==============================================================
-- TRANSCRIPTS
-- NOTE: unique ticket_id keeps upsert() aligned with a single row per ticket
-- ==============================================================
CREATE TABLE IF NOT EXISTS transcripts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   INTEGER UNIQUE REFERENCES tickets(id) ON DELETE CASCADE,
  guild_id    TEXT NOT NULL,
  content     TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transcripts_ticket ON transcripts(ticket_id);

ALTER TABLE IF EXISTS transcripts
  ADD COLUMN IF NOT EXISTS guild_id    TEXT,
  ADD COLUMN IF NOT EXISTS content     TEXT,
  ADD COLUMN IF NOT EXISTS created_at  TIMESTAMPTZ DEFAULT NOW();

-- ==============================================================
-- LOGS
-- ==============================================================
CREATE TABLE IF NOT EXISTS logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id    TEXT NOT NULL,
  action      TEXT NOT NULL,
  actor_id    TEXT,
  target_id   TEXT,
  details     JSONB DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_logs_guild       ON logs(guild_id);
CREATE INDEX IF NOT EXISTS idx_logs_created_at  ON logs(created_at DESC);

ALTER TABLE IF EXISTS logs
  ADD COLUMN IF NOT EXISTS action      TEXT,
  ADD COLUMN IF NOT EXISTS actor_id    TEXT,
  ADD COLUMN IF NOT EXISTS target_id   TEXT,
  ADD COLUMN IF NOT EXISTS details     JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at  TIMESTAMPTZ DEFAULT NOW();

-- ==============================================================
-- SESSIONS
-- ==============================================================
CREATE TABLE IF NOT EXISTS sessions (
  sid     TEXT PRIMARY KEY,
  sess    JSONB NOT NULL,
  expire  TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions(expire);

ALTER TABLE IF EXISTS sessions
  ADD COLUMN IF NOT EXISTS sess    JSONB NOT NULL,
  ADD COLUMN IF NOT EXISTS expire  TIMESTAMPTZ NOT NULL;

-- ==============================================================
-- RLS DISABLE
-- ==============================================================
ALTER TABLE IF EXISTS guilds       DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS panels       DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS tickets      DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS staff        DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS ticket_notes  DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS staff_point_events DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS keywords     DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS bans         DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS transcripts  DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS logs         DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS sessions     DISABLE ROW LEVEL SECURITY;

-- ==============================================================
-- GRANTS
-- ==============================================================
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO anon;

GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO postgres;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO anon;

COMMIT;
