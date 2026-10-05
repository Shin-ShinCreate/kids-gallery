'use strict';
// IndexedDB（ブラウザ内のデータベース）の薄いラッパー
const DB = (() => {
  let dbp;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open('kids-gallery', 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        for (const s of ['children', 'items', 'boxes', 'blobs', 'meta']) {
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
  return {
    all: s => tx(s, 'readonly', st => st.getAll()),
    get: (s, id) => tx(s, 'readonly', st => st.get(id)),
    put: (s, v) => tx(s, 'readwrite', st => st.put(v)),
    del: (s, id) => tx(s, 'readwrite', st => st.delete(id)),
    clear: s => tx(s, 'readwrite', st => st.clear()),
  };
})();

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

async function putBlob(blob) {
  const id = uid();
  await DB.put('blobs', { id, blob });
  return id;
}

const urlCache = new Map();
async function blobURL(id) {
  if (!id) return '';
  if (urlCache.has(id)) return urlCache.get(id);
  const r = await DB.get('blobs', id);
  if (!r) return '';
  const u = URL.createObjectURL(r.blob);
  urlCache.set(id, u);
  return u;
}

function itemRefs(i) {
  return [...(i.photos || []).flatMap(p => [p.full, p.thumb]), i.audio, i.thanksAudio].filter(Boolean);
}

// 他の思い出から参照されていない画像・音声だけを削除する
async function gcBlobs(ids, items) {
  if (!ids || !ids.length) return;
  const refs = new Set(items.flatMap(itemRefs));
  for (const id of ids) {
    if (!refs.has(id)) {
      await DB.del('blobs', id);
      if (urlCache.has(id)) { URL.revokeObjectURL(urlCache.get(id)); urlCache.delete(id); }
    }
  }
}
