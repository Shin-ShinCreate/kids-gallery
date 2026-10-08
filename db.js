'use strict';
// IndexedDB（ブラウザ内のデータベース）の薄いラッパー
// children / items / boxes は家族共有（クラウド同期）の対象。変更するたびに outbox（送信待ち）へ記録する。
const SYNCED = new Set(['children', 'items', 'boxes']);

const DB = (() => {
  let dbp;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open('kids-gallery', 2);
      r.onupgradeneeded = () => {
        const d = r.result;
        for (const s of ['children', 'items', 'boxes', 'blobs', 'meta', 'outbox']) {
          if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' });
        }
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function tx(store, mode, fn) {
    const d = await open();
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode);
      const req = fn(t.objectStore(store));
      let out;
      if (req) req.onsuccess = () => { out = req.result; };
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  }
  const api = {
    onChange: null, // 同期の対象が変わったときに呼ばれる
    all: s => tx(s, 'readonly', st => st.getAll()),
    get: (s, id) => tx(s, 'readonly', st => st.get(id)),
    putRaw: (s, v) => tx(s, 'readwrite', st => st.put(v)),
    delRaw: (s, id) => tx(s, 'readwrite', st => st.delete(id)),
    clearRaw: s => tx(s, 'readwrite', st => st.clear()),
    async put(s, v) {
      if (SYNCED.has(s)) v.updatedAt = Date.now();
      await api.putRaw(s, v);
      if (SYNCED.has(s)) {
        await api.putRaw('outbox', { id: s + ':' + v.id, kind: s, docId: v.id, deleted: false, updatedAt: v.updatedAt });
        api.onChange?.();
      }
    },
    async del(s, id) {
      await api.delRaw(s, id);
      if (SYNCED.has(s)) {
        await api.putRaw('outbox', { id: s + ':' + id, kind: s, docId: id, deleted: true, updatedAt: Date.now() });
        api.onChange?.();
      }
    },
    async clear(s) {
      if (SYNCED.has(s)) {
        const now = Date.now();
        for (const d of await api.all(s)) await api.putRaw('outbox', { id: s + ':' + d.id, kind: s, docId: d.id, deleted: true, updatedAt: now });
      }
      await api.clearRaw(s);
      if (SYNCED.has(s)) api.onChange?.();
    },
  };
  return api;
})();

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

async function putBlob(blob) {
  const id = uid();
  await DB.put('blobs', { id, blob });
  return id;
}

// 端末にない写真・声は、クラウドから取り寄せる
async function getBlobRec(id) {
  if (!id) return null;
  let r = await DB.get('blobs', id);
  if (!r && typeof Cloud !== 'undefined' && Cloud.enabled()) r = await Cloud.fetchBlob(id);
  return r || null;
}

const urlCache = new Map();
async function blobURL(id) {
  if (!id) return '';
  if (urlCache.has(id)) return urlCache.get(id);
  const r = await getBlobRec(id);
  if (!r) return '';
  const u = URL.createObjectURL(r.blob);
  urlCache.set(id, u);
  return u;
}

function itemRefs(i) {
  return [...(i.photos || []).flatMap(p => [p.full, p.thumb]), i.audio, i.thanksAudio].filter(Boolean);
}

// 他の思い出から参照されていない画像・音声だけを端末から削除する
// （クラウド側の掃除は、サーバーが作品の更新・削除に合わせて行う）
async function gcBlobs(ids, items) {
  if (!ids || !ids.length) return;
  const refs = new Set(items.flatMap(itemRefs));
  for (const id of ids) {
    if (!refs.has(id)) {
      await DB.delRaw('blobs', id);
      if (urlCache.has(id)) { URL.revokeObjectURL(urlCache.get(id)); urlCache.delete(id); }
    }
  }
}
