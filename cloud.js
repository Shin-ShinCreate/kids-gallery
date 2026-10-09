'use strict';
// 家族共有（クラウド同期）。端末の中のデータが本体で、変更を送り、家族の変更を受け取る。
//  ・作品／こども／保管箱の記録は「最後に更新した方が勝つ」ルールでそろえる
//  ・写真・声は、送る前にクラウドへ上げ、端末にないものは見るときに取り寄せる
const Cloud = (() => {
  const KINDS = ['children', 'items', 'boxes'];
  let cfg = null;             // {token, familyId, familyName, memberId, memberName, role, rev}
  let busy = false, again = false, timer = null, poll = null;
  const st = { state: 'off', msg: '', last: 0 };
  const listeners = new Set();
  const hooks = { refresh: () => { }, revoked: () => { } };

  const base = () => (typeof CLOUD_URL === 'string' ? CLOUD_URL : '').replace(/\/+$/, '');
  const available = () => !!base();
  const enabled = () => !!cfg;
  const setState = (state, msg = '') => {
    st.state = state; st.msg = msg;
    if (state === 'ok') st.last = Date.now();
    listeners.forEach(f => f(st));
  };

  async function request(path, { method = 'GET', body, auth = true, raw, type } = {}) {
    const h = {};
    if (auth && cfg) h.Authorization = 'Bearer ' + cfg.token;
    let payload = raw;
    if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    if (type) h['Content-Type'] = type;
    let res;
    try { res = await fetch(base() + path, { method, headers: h, body: payload }); }
    catch { throw Object.assign(new Error('ネットにつながっていません'), { offline: true }); }
    if (res.status === 401 && auth && cfg) {
      await disconnect(true);
      throw Object.assign(new Error('この端末は家族から外されました'), { revoked: true });
    }
    if (!res.ok) {
      let m = '';
      try { m = (await res.json()).error; } catch { }
      throw Object.assign(new Error(m || `サーバーエラー（${res.status}）`), { status: res.status });
    }
    return res;
  }
  const json = async (path, opts) => (await request(path, opts)).json();

  const save = () => DB.putRaw('meta', { id: 'cloud', ...cfg });

  async function init() {
    if (!available()) return;
    cfg = (await DB.get('meta', 'cloud')) || null;
    if (!cfg) return;
    setState('idle');
    DB.onChange = () => schedule(2500);
    if (!poll) {
      poll = setInterval(() => { if (!document.hidden) schedule(0); }, 60000);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(300); });
      window.addEventListener('online', () => schedule(300));
    }
    schedule(300);
  }

  async function markAllDirty() {
    for (const kind of KINDS) {
      for (const d of await DB.all(kind)) {
        await DB.putRaw('outbox', { id: kind + ':' + d.id, kind, docId: d.id, deleted: false, updatedAt: d.updatedAt || d.createdAt || Date.now() });
      }
    }
  }

  async function connect(r) {
    cfg = { token: r.token, familyId: r.family.id, familyName: r.family.name, memberId: r.me.id, memberName: r.me.name, role: r.me.role, rev: 0 };
    await save();
    await markAllDirty(); // この端末にすでにある作品も、家族のギャラリーに加える
    DB.onChange = () => schedule(2500);
    await init();
    schedule(0);
  }

  async function create(setupKey, familyName, memberName, deviceName) {
    await connect(await json('/api/family', { method: 'POST', auth: false, body: { setupKey, familyName, memberName, deviceName } }));
  }
  async function join(code, memberName, deviceName) {
    await connect(await json('/api/join', { method: 'POST', auth: false, body: { code, memberName, deviceName } }));
  }
  // 同じ人の別の端末として、つなぐ（新しいメンバーはつくらない）
  async function joinDevice(code, deviceName) {
    await connect(await json('/api/device-join', { method: 'POST', auth: false, body: { code, deviceName } }));
  }
  async function disconnect(revoked = false) {
    cfg = null;
    DB.onChange = null;
    await DB.delRaw('meta', 'cloud');
    await DB.clearRaw('outbox');
    setState('off');
    if (revoked) hooks.revoked();
  }

  const info = () => json('/api/family');
  const invite = () => json('/api/invite', { method: 'POST' });
  const deviceInvite = () => json('/api/device-invite', { method: 'POST' });
  const removeMember = id => request('/api/members/' + id, { method: 'DELETE' });
  const removeDevice = id => request('/api/devices/' + id, { method: 'DELETE' });
  // この端末の共有をやめる：サーバーの端末一覧からも外す（つながらないときは、この端末だけ外す）
  async function leave() {
    try { await removeDevice((await info()).me.deviceId); } catch { }
    await disconnect();
  }

  // ---------- 写真・声 ----------
  const inflight = new Map();
  let active = 0;
  const waiters = [];
  async function slot() {
    if (active >= 4) await new Promise(r => waiters.push(r));
    active++;
  }
  const release = () => { active--; waiters.shift()?.(); };

  function fetchBlob(id) {
    if (!cfg) return Promise.resolve(null);
    if (inflight.has(id)) return inflight.get(id);
    const p = (async () => {
      await slot();
      try {
        const res = await request('/api/blob/' + encodeURIComponent(id));
        const rec = { id, blob: await res.blob(), synced: true };
        await DB.putRaw('blobs', rec);
        return rec;
      } catch { return null; }
      finally { release(); inflight.delete(id); }
    })();
    inflight.set(id, p);
    return p;
  }

  async function uploadBlobs(ids) {
    for (const id of ids) {
      const rec = await DB.get('blobs', id);
      if (!rec || rec.synced) continue; // 端末にない＝クラウドにすでにある
      await request('/api/blob/' + encodeURIComponent(id), { method: 'PUT', raw: rec.blob, type: rec.blob.type || 'application/octet-stream' });
      rec.synced = true;
      await DB.putRaw('blobs', rec);
    }
  }

  // ---------- 同期 ----------
  function schedule(ms = 0) {
    if (!cfg) return;
    clearTimeout(timer);
    timer = setTimeout(sync, ms);
  }

  async function push() {
    const out = await DB.all('outbox');
    if (!out.length) return 0;
    const sendable = [];
    for (const o of out) {
      if (o.deleted) { sendable.push({ o, doc: { kind: o.kind, id: o.docId, updatedAt: o.updatedAt, deleted: true } }); continue; }
      const d = await DB.get(o.kind, o.docId);
      if (!d) { await DB.delRaw('outbox', o.id); continue; }
      sendable.push({ o, doc: { kind: o.kind, id: o.docId, updatedAt: d.updatedAt || o.updatedAt, deleted: false, data: JSON.stringify(d) }, d });
    }
    let sent = 0;
    for (let k = 0; k < sendable.length; k += 20) {
      const chunk = sendable.slice(k, k + 20);
      for (const c of chunk) if (c.d && c.o.kind === 'items') await uploadBlobs(itemRefs(c.d));
      await json('/api/sync', { method: 'POST', body: { docs: chunk.map(c => c.doc) } });
      for (const c of chunk) {
        const now = await DB.get('outbox', c.o.id); // 送っている間にまた変更されていたら残す
        if (now && now.updatedAt === c.o.updatedAt) await DB.delRaw('outbox', c.o.id);
      }
      sent += chunk.length;
      if (sendable.length > 20) setState('syncing', `送信中 ${sent}/${sendable.length}`);
    }
    return sent;
  }

  async function applyDocs(docs, gone) {
    const outbox = new Map((await DB.all('outbox')).map(o => [o.id, o]));
    let changed = false;
    for (const d of docs) {
      const ob = outbox.get(d.kind + ':' + d.id);
      if (ob && ob.updatedAt > d.updated_at) continue; // 端末側のほうが新しい（あとで送る）
      const local = await DB.get(d.kind, d.id);
      if (d.deleted) {
        if (local) { await DB.delRaw(d.kind, d.id); changed = true; if (d.kind === 'items') gone.push(...itemRefs(local)); }
      } else if (!local || (local.updatedAt || 0) < d.updated_at) {
        const data = JSON.parse(d.data);
        data.updatedAt = d.updated_at;
        await DB.putRaw(d.kind, data);
        changed = true;
        if (d.kind === 'items' && local) {
          const keep = new Set(itemRefs(data));
          gone.push(...itemRefs(local).filter(r => !keep.has(r)));
        }
      }
    }
    return changed;
  }

  async function pull() {
    let changed = false;
    const gone = [];
    for (;;) {
      const r = await json(`/api/sync?since=${cfg.rev || 0}&limit=200`);
      if (r.docs.length && await applyDocs(r.docs, gone)) changed = true;
      cfg.rev = r.next;
      await save();
      if (!r.more) break;
    }
    return { changed, gone };
  }

  async function sync() {
    if (!cfg) return;
    if (busy) { again = true; return; }
    busy = true;
    setState('syncing', '同期中…');
    try {
      await push();
      const { changed, gone } = await pull();
      if (changed) {
        await hooks.refresh(gone);
      }
      setState('ok');
    } catch (e) {
      if (e.revoked) return;
      setState(e.offline ? 'offline' : 'error', e.message);
    } finally {
      busy = false;
      if (again) { again = false; schedule(500); }
    }
  }

  const syncNow = () => { schedule(0); };
  const get = () => cfg;
  const pending = async () => (await DB.all('outbox')).length;

  return {
    available, enabled, init, create, join, joinDevice, disconnect, leave, info, invite, deviceInvite, removeMember, removeDevice,
    fetchBlob, syncNow, get, pending, state: st,
    on: f => { listeners.add(f); return () => listeners.delete(f); },
    hooks,
  };
})();
