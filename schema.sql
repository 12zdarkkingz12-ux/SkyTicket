-- ╔══════════════════════════════════════╗
-- ║    SkyTicket Pro — Database Schema   ║
-- ║         by Dark  •  v2.0.0           ║
-- ╚══════════════════════════════════════╝

-- ─── Guilds ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS guilds (
  id                    TEXT PRIMARY KEY,
  max_tickets_per_user  INTEGER DEFAULT 1,
  auto_close_hours      INTEGER DEFAULT 72,
  auto_close_warn_hours INTEGER DEFAULT 48,
  log_channel_id        TEXT,
  dm_transcript         BOOLEAN DEFAULT false,
  ping_on_open          BOOLEAN DEFAULT true,
  require_close_reason  BOOLEAN DEFAULT false,
  ticket_prefix         TEXT DEFAULT 'ticket',
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Panels ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS panels (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id          TEXT REFERENCES guilds(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  description       TEXT DEFAULT 'افتح تذكرة للحصول على الدعم',
  category_open     TEXT,
  category_close    TEXT,
  mention_role      TEXT,
  embed_title       TEXT DEFAULT '🎫 فتح تذكرة',
  embed_description TEXT DEFAULT 'اضغط على الزر أدناه لفتح تذكرة دعم',
  embed_color       TEXT DEFAULT '#4f7ef7',
  embed_footer      TEXT,
  embed_image       TEXT,
  embed_thumbnail   TEXT,
  welcome_message   TEXT DEFAULT 'مرحباً {user}! سيتم مساعدتك قريباً.',
  close_message     TEXT DEFAULT 'تم إغلاق التذكرة. شكراً لتواصلك معنا!',
  claim_message     TEXT DEFAULT '✅ تم استلام تذكرتك من قبل {staff}',
  button_label      TEXT DEFAULT '🎫 فتح تذكرة',
  button_style      TEXT DEFAULT 'PRIMARY',
  require_reason    BOOLEAN DEFAULT false,
  auto_claim        BOOLEAN DEFAULT false,
  dm_on_close       BOOLEAN DEFAULT true,
  message_id        TEXT,
  channel_id        TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_panels_guild ON panels(guild_id);

-- ─── Tickets ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tickets (
  id            SERIAL PRIMARY KEY,
  guild_id      TEXT REFERENCES guilds(id) ON DELETE CASCADE,
  panel_id      TEXT REFERENCES panels(id) ON DELETE SET NULL,
  channel_id    TEXT UNIQUE NOT NULL,
  user_id       TEXT NOT NULL,
  claimed_by    TEXT,
  status        TEXT DEFAULT 'open',     -- open | claimed | closed
  priority      TEXT DEFAULT 'normal',   -- low | normal | high | urgent
  open_reason   TEXT,
  close_reason  TEXT,
  rating        INTEGER,
  rating_comment TEXT,
  tags          JSONB DEFAULT '[]',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  closed_at     TIMESTAMPTZ,
  last_activity TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tickets_guild   ON tickets(guild_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status  ON tickets(guild_id, status);
CREATE INDEX IF NOT EXISTS idx_tickets_user    ON tickets(guild_id, user_id);
CREATE INDEX IF NOT EXISTS idx_tickets_panel   ON tickets(panel_id);

-- ─── Staff ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staff (
  user_id         TEXT NOT NULL,
  guild_id        TEXT REFERENCES guilds(id) ON DELETE CASCADE,
  added_by        TEXT,
  available       BOOLEAN DEFAULT true,
  max_concurrent  INTEGER DEFAULT 10,
  tickets_closed  INTEGER DEFAULT 0,
  avg_rating      NUMERIC(3,2) DEFAULT 0,
  total_ratings   INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, guild_id)
);
CREATE INDEX IF NOT EXISTS idx_staff_guild ON staff(guild_id);

-- ─── Ticket Notes (internal) ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ticket_notes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id  INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
  guild_id   TEXT NOT NULL,
  author_id  TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notes_ticket ON ticket_notes(ticket_id);

-- ─── Keywords ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS keywords (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id        TEXT REFERENCES guilds(id) ON DELETE CASCADE,
  panel_id        TEXT REFERENCES panels(id) ON DELETE CASCADE,
  keyword         TEXT NOT NULL,
  response        TEXT NOT NULL,
  match_type      TEXT DEFAULT 'contains',  -- exact | contains | starts_with
  case_sensitive  BOOLEAN DEFAULT false,
  enabled         BOOLEAN DEFAULT true,
  hit_count       INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_keywords_guild ON keywords(guild_id);

-- ─── Bans ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bans (
  user_id    TEXT NOT NULL,
  guild_id   TEXT REFERENCES guilds(id) ON DELETE CASCADE,
  reason     TEXT,
  banned_by  TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, guild_id)
);
CREATE INDEX IF NOT EXISTS idx_bans_guild ON bans(guild_id);

-- ─── Transcripts ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transcripts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id  INTEGER REFERENCES tickets(id) ON DELETE CASCADE,
  guild_id   TEXT NOT NULL,
  content    TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_transcripts_ticket ON transcripts(ticket_id);

-- ─── Logs ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS logs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id   TEXT NOT NULL,
  action     TEXT NOT NULL,
  actor_id   TEXT,
  target_id  TEXT,
  details    JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_logs_guild      ON logs(guild_id);
CREATE INDEX IF NOT EXISTS idx_logs_created_at ON logs(created_at DESC);

-- ─── Sessions (Persistent auth) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  sid     TEXT PRIMARY KEY,
  sess    JSONB NOT NULL,
  expire  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions(expire);
