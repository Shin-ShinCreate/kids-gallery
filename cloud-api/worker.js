// こども作品ギャラリー 家族共有API（Cloudflare Workers + D1 + R2）
// 無料枠に収めるため、1回のリクエストで使う D1 の問い合わせ数を少なく保っている。

const MAX_BLOB = 12 * 1024 * 1024;          // 1ファイルの上限（12MB）
const QUOTA = 9 * 1024 * 1024 * 1024;       // R2無料枠（10GB）を超えないための上限（9GB）
const INVITE_TTL = 3 * 24 * 3600 * 1000;    // 招待コードの有効期間（3日）
const KINDS = new Set(['children', 'items', 'boxes']);
const BLOB_TYPES = /^(image\/(jpeg|png|webp)|audio\/[\w.+-]+)(;.*)?$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const sha256 = async s => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
const randomToken = () => hex(crypto.getRandomValues(new Uint8Array(32)));
const randomCode = () => {
  const r = crypto.getRandomValues(new Uint8Array(8));
  return [...r].map(b => CODE_CHARS[b % CODE_CHARS.length]).join('');
};
function safeEqual(a, b) {
  a = String(a); b = String(b);
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}

function corsHeaders(req, env) {
  const origin = req.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const h = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
  if (allowed.includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

export default {
  async fetch(req, env) {
    const cors = corsHeaders(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    let res;
    try {
      res = await route(req, env, new URL(req.url));
    } catch (e) {
      if (e instanceof HttpError) res = json({ error: e.message }, e.status);
      else { console.error(e); res = json({ error: 'サーバーでエラーが起きました' }, 500); }
    }
    res = new Response(res.body, res);
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
    return res;
  },
};

async function readJson(req, limit = 2 * 1024 * 1024) {
  const text = await req.text();
  if (text.length > limit) fail(413, 'データが大きすぎます');
  try { return JSON.parse(text); } catch { return fail(400, '形式が正しくありません'); }
}

async function auth(req, env) {
  const m = /^Bearer ([0-9a-f]{64})$/.exec(req.headers.get('Authorization') || '');
  if (!m) fail(401, 'ログインが必要です');
  const row = await env.DB.prepare(
    'SELECT m.id, m.name, m.role, m.family_id, f.name AS family_name FROM members m JOIN families f ON f.id = m.family_id WHERE m.token_hash = ? AND m.revoked = 0'
  ).bind(await sha256(m[1])).first();
  if (!row) fail(401, 'この端末は家族から外されています');
  return row;
}

async function route(req, env, url) {
  const p = url.pathname, method = req.method;
  if (p === '/' || p === '/api/health') return json({ ok: true, name: 'kids-gallery-api' });
  if (!p.startsWith('/api/')) fail(404, 'not found');

  if (p === '/api/family' && method === 'POST') return createFamily(req, env);
  if (p === '/api/join' && method === 'POST') return joinFamily(req, env);

  const me = await auth(req, env);
  if (p === '/api/family' && method === 'GET') return familyInfo(env, me);
  if (p === '/api/invite' && method === 'POST') return createInvite(env, me);
  if (p === '/api/sync' && method === 'GET') return pullDocs(env, me, url);
  if (p === '/api/sync' && method === 'POST') return pushDocs(req, env, me);

  let m = /^\/api\/members\/([\w-]+)$/.exec(p);
  if (m && method === 'DELETE') return removeMember(env, me, m[1]);
  m = /^\/api\/blob\/([\w-]+)$/.exec(p);
  if (m) {
    if (!ID_RE.test(m[1])) fail(400, 'idが正しくありません');
    if (method === 'PUT') return putBlob(req, env, me, m[1]);
    if (method === 'GET') return getBlob(env, me, m[1]);
  }
  return fail(404, 'not found');
}

// ---------- 家族の作成・参加 ----------
async function createFamily(req, env) {
  const b = await readJson(req);
  if (!env.SETUP_KEY || !safeEqual(b.setupKey || '', env.SETUP_KEY)) fail(403, '設定キーが違います');
  const familyName = String(b.familyName || '').trim().slice(0, 40);
  const memberName = String(b.memberName || '').trim().slice(0, 40);
  if (!familyName || !memberName) fail(400, '家族の名前とあなたの呼び名を入れてください');
  const fid = crypto.randomUUID(), mid = crypto.randomUUID(), token = randomToken(), now = Date.now();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO families (id, name, created) VALUES (?, ?, ?)').bind(fid, familyName, now),
    env.DB.prepare('INSERT INTO members (id, family_id, name, role, token_hash, created) VALUES (?, ?, ?, ?, ?, ?)').bind(mid, fid, memberName, 'owner', await sha256(token), now),
    env.DB.prepare('INSERT INTO revs (family_id, rev) VALUES (?, 0)').bind(fid),
  ]);
  return json({ token, family: { id: fid, name: familyName }, me: { id: mid, name: memberName, role: 'owner' } });
}

async function joinFamily(req, env) {
  const b = await readJson(req);
  const code = String(b.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const memberName = String(b.memberName || '').trim().slice(0, 40);
  if (code.length !== 8 || !memberName) fail(400, '招待コードと呼び名を入れてください');
  const mid = crypto.randomUUID(), token = randomToken(), now = Date.now();
  // コードは1回きり。使えた人だけが家族に入れる
  const used = await env.DB.prepare(
    'UPDATE invites SET used_by = ? WHERE code = ? AND used_by IS NULL AND expires > ? RETURNING family_id'
  ).bind(mid, code, now).first();
  if (!used) fail(403, '招待コードが違うか、期限切れ・使用済みです');
  await env.DB.prepare('INSERT INTO members (id, family_id, name, role, token_hash, created) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(mid, used.family_id, memberName, 'member', await sha256(token), now).run();
  const fam = await env.DB.prepare('SELECT id, name FROM families WHERE id = ?').bind(used.family_id).first();
  return json({ token, family: fam, me: { id: mid, name: memberName, role: 'member' } });
}

async function familyInfo(env, me) {
  const [members, usage] = await env.DB.batch([
    env.DB.prepare('SELECT id, name, role, created FROM members WHERE family_id = ? AND revoked = 0 ORDER BY created').bind(me.family_id),
    env.DB.prepare('SELECT COALESCE(SUM(size), 0) AS bytes, COUNT(*) AS files FROM blobs WHERE family_id = ?').bind(me.family_id),
  ]);
  return json({
    family: { id: me.family_id, name: me.family_name },
    me: { id: me.id, name: me.name, role: me.role },
    members: members.results,
    usage: { bytes: usage.results[0].bytes, files: usage.results[0].files, limit: QUOTA },
  });
}

async function createInvite(env, me) {
  const code = randomCode(), now = Date.now();
  await env.DB.prepare('INSERT INTO invites (code, family_id, created, expires) VALUES (?, ?, ?, ?)')
    .bind(code, me.family_id, now, now + INVITE_TTL).run();
  return json({ code, expires: now + INVITE_TTL });
}

async function removeMember(env, me, id) {
  if (me.role !== 'owner') fail(403, '外せるのは、家族をつくった人だけです');
  if (id === me.id) fail(400, '自分自身は外せません');
  const r = await env.DB.prepare('UPDATE members SET revoked = 1 WHERE id = ? AND family_id = ? AND role != ?')
    .bind(id, me.family_id, 'owner').run();
  if (!r.meta.changes) fail(404, 'メンバーが見つかりません');
  return json({ ok: true });
}

// ---------- 同期 ----------
async function pullDocs(env, me, url) {
  const since = Math.max(0, parseInt(url.searchParams.get('since') || '0', 10) || 0);
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') || '200', 10) || 200));
  const [docs, rev] = await env.DB.batch([
    env.DB.prepare('SELECT kind, id, data, updated_at, rev, deleted FROM docs WHERE family_id = ? AND rev > ? ORDER BY rev LIMIT ?').bind(me.family_id, since, limit),
    env.DB.prepare('SELECT rev FROM revs WHERE family_id = ?').bind(me.family_id),
  ]);
  const rows = docs.results;
  const more = rows.length === limit;
  return json({ docs: rows, more, next: rows.length ? rows[rows.length - 1].rev : (rev.results[0]?.rev ?? since) });
}

const blobRefs = data => {
  try {
    const d = typeof data === 'string' ? JSON.parse(data) : data;
    return [...(d.photos || []).flatMap(p => [p.full, p.thumb]), d.audio, d.thanksAudio].filter(x => typeof x === 'string' && ID_RE.test(x));
  } catch { return []; }
};

async function pushDocs(req, env, me) {
  const b = await readJson(req, 4 * 1024 * 1024);
  const docs = Array.isArray(b.docs) ? b.docs : fail(400, '形式が正しくありません');
  if (docs.length > 20) fail(413, '一度に送れるのは20件までです');
  for (const d of docs) {
    if (!KINDS.has(d.kind) || !ID_RE.test(String(d.id)) || !Number.isFinite(d.updatedAt)) fail(400, 'データの形式が正しくありません');
    if (!d.deleted && (typeof d.data !== 'string' || d.data.length > 100000)) fail(400, 'データが大きすぎます');
  }
  if (!docs.length) return json({ ok: true, applied: 0 });

  const fid = me.family_id;
  // 既存の記録をまとめて1回で読む（古い更新を捨てる判定と、不要になった写真の掃除に使う）
  const ph = docs.map(() => '(?, ?)').join(',');
  const binds = docs.flatMap(d => [d.kind, String(d.id)]);
  const existing = (await env.DB.prepare(`SELECT kind, id, data, updated_at, deleted FROM docs WHERE family_id = ? AND (kind, id) IN (VALUES ${ph})`).bind(fid, ...binds).all()).results;
  const ex = new Map(existing.map(r => [r.kind + ':' + r.id, r]));

  const accepted = docs.filter(d => {
    const e = ex.get(d.kind + ':' + d.id);
    return !e || d.updatedAt >= e.updated_at;
  });
  if (!accepted.length) return json({ ok: true, applied: 0 });

  // 版番号をまとめて確保
  const top = (await env.DB.prepare('UPDATE revs SET rev = rev + ? WHERE family_id = ? RETURNING rev').bind(accepted.length, fid).first()).rev;
  const stmts = accepted.map((d, k) => env.DB.prepare(
    `INSERT INTO docs (family_id, kind, id, data, updated_at, rev, deleted) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (family_id, kind, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, rev = excluded.rev, deleted = excluded.deleted`
  ).bind(fid, d.kind, String(d.id), d.deleted ? null : d.data, d.updatedAt, top - accepted.length + 1 + k, d.deleted ? 1 : 0));

  // 作品から外れた写真・声は、クラウドからも消す（削除された作品の分も）
  const stale = new Set();
  for (const d of accepted) {
    if (d.kind !== 'items') continue;
    const e = ex.get('items:' + d.id);
    if (!e || e.deleted || !e.data) continue;
    const keep = new Set(d.deleted ? [] : blobRefs(d.data));
    for (const r of blobRefs(e.data)) if (!keep.has(r)) stale.add(r);
  }
  if (stale.size) {
    const ids = [...stale];
    stmts.push(env.DB.prepare(`DELETE FROM blobs WHERE family_id = ? AND id IN (${ids.map(() => '?').join(',')})`).bind(fid, ...ids));
  }
  await env.DB.batch(stmts);
  if (stale.size) await env.BLOBS.delete([...stale].map(id => `${fid}/${id}`));
  return json({ ok: true, applied: accepted.length });
}

// ---------- 写真・声のファイル ----------
async function putBlob(req, env, me, id) {
  const type = req.headers.get('Content-Type') || '';
  if (!BLOB_TYPES.test(type)) fail(415, 'この種類のファイルは保存できません');
  const len = parseInt(req.headers.get('Content-Length') || '0', 10);
  if (len > MAX_BLOB) fail(413, 'ファイルが大きすぎます');
  const body = await req.arrayBuffer();
  if (!body.byteLength || body.byteLength > MAX_BLOB) fail(413, 'ファイルのサイズが正しくありません');
  const used = (await env.DB.prepare('SELECT COALESCE(SUM(size), 0) AS bytes FROM blobs WHERE family_id = ?').bind(me.family_id).first()).bytes;
  if (used + body.byteLength > QUOTA) fail(507, 'クラウドの無料容量がいっぱいです');
  await env.BLOBS.put(`${me.family_id}/${id}`, body, { httpMetadata: { contentType: type } });
  await env.DB.prepare('INSERT OR REPLACE INTO blobs (family_id, id, size, created) VALUES (?, ?, ?, ?)')
    .bind(me.family_id, id, body.byteLength, Date.now()).run();
  return json({ ok: true });
}

async function getBlob(env, me, id) {
  const o = await env.BLOBS.get(`${me.family_id}/${id}`);
  if (!o) fail(404, 'ファイルが見つかりません');
  return new Response(o.body, {
    headers: {
      'Content-Type': o.httpMetadata?.contentType || 'application/octet-stream',
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  });
}
