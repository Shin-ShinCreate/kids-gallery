-- キッズギャラリー 家族共有用データベース（Cloudflare D1）
CREATE TABLE IF NOT EXISTS families (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,                 -- owner / member
  token_hash TEXT NOT NULL UNIQUE,    -- 合言葉（トークン）はハッシュにして保存
  created INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS members_family ON members (family_id);

CREATE TABLE IF NOT EXISTS invites (
  code TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL,
  used_by TEXT
);

-- 端末。合言葉（トークン）は、メンバーではなく端末ごとに持つ。
-- 同じ人（メンバー）が、スマホ・タブレット・PCなど複数の端末をつなげられる。
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS devices_member ON devices (member_id);

-- 「端末を追加」用のコード（同じ人の別の端末をつなぐ。30分・1回きり）
CREATE TABLE IF NOT EXISTS device_invites (
  code TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  family_id TEXT NOT NULL,
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL,
  used_by TEXT
);

CREATE TABLE IF NOT EXISTS revs (
  family_id TEXT PRIMARY KEY,
  rev INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS docs (
  family_id TEXT NOT NULL,
  kind TEXT NOT NULL,                 -- children / items / boxes
  id TEXT NOT NULL,
  data TEXT,
  updated_at INTEGER NOT NULL,
  rev INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (family_id, kind, id)
);
CREATE INDEX IF NOT EXISTS docs_rev ON docs (family_id, rev);

CREATE TABLE IF NOT EXISTS blobs (
  family_id TEXT NOT NULL,
  id TEXT NOT NULL,
  size INTEGER NOT NULL,
  created INTEGER NOT NULL,
  PRIMARY KEY (family_id, id)
);
