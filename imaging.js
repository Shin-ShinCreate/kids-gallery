'use strict';
// 画像処理：作品の四隅検出・ゆがみ補正（射影変換）・色補正・動き検出
const Imaging = (() => {
  const dims = s => [s.naturalWidth || s.videoWidth || s.width, s.naturalHeight || s.videoHeight || s.height];

  function loadImage(blob) {
    return new Promise((res, rej) => {
      const u = URL.createObjectURL(blob);
      const im = new Image();
      im.onload = () => { URL.revokeObjectURL(u); res(im); };
      im.onerror = () => { URL.revokeObjectURL(u); rej(new Error('画像を読み込めません')); };
      im.src = u;
    });
  }

  function toCanvas(src, maxSide) {
    const [w, h] = dims(src);
    const s = Math.min(1, maxSide / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * s));
    c.height = Math.max(1, Math.round(h * s));
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    return c;
  }

  const toBlob = (c, q = 0.86) => new Promise(r => c.toBlob(r, 'image/jpeg', q));

  const polyArea = q => Math.abs(q.reduce((a, p, i) => {
    const n = q[(i + 1) % q.length];
    return a + p.x * n.y - n.x * p.y;
  }, 0)) / 2;

  // 背景（画像のふち）と色が違う領域を作品とみなし、その四隅を推定する
  function detectQuad(src) {
    const [W, H] = dims(src);
    const s = 160 / Math.max(W, H);
    const w = Math.max(8, Math.round(W * s)), h = Math.max(8, Math.round(H * s));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(src, 0, 0, w, h);
    const d = x.getImageData(0, 0, w, h).data;

    const R = [], G = [], B = [];
    const take = (i, j) => { const k = (j * w + i) * 4; R.push(d[k]); G.push(d[k + 1]); B.push(d[k + 2]); };
    for (let i = 0; i < w; i++) { take(i, 0); take(i, 1); take(i, h - 1); take(i, h - 2); }
    for (let j = 0; j < h; j++) { take(0, j); take(1, j); take(w - 1, j); take(w - 2, j); }
    const med = a => a.sort((p, q) => p - q)[a.length >> 1];
    const br = med(R), bg = med(G), bb = med(B);

    const mask = new Uint8Array(w * h);
    for (let p = 0, k = 0; p < w * h; p++, k += 4) {
      mask[p] = (Math.abs(d[k] - br) + Math.abs(d[k + 1] - bg) + Math.abs(d[k + 2] - bb)) > 70 ? 1 : 0;
    }
    let n = 0, minS = 1e9, maxS = -1e9, minD = 1e9, maxD = -1e9, tl, tr, brc, bl;
    for (let j = 1; j < h - 1; j++) {
      for (let i = 1; i < w - 1; i++) {
        const p = j * w + i;
        // 上下左右も前景のときだけ数える（ノイズ除去）
        if (!(mask[p] && mask[p - 1] && mask[p + 1] && mask[p - w] && mask[p + w])) continue;
        n++;
        const sm = i + j, df = i - j;
        if (sm < minS) { minS = sm; tl = [i, j]; }
        if (sm > maxS) { maxS = sm; brc = [i, j]; }
        if (df > maxD) { maxD = df; tr = [i, j]; }
        if (df < minD) { minD = df; bl = [i, j]; }
      }
    }
    const ratio = n / (w * h);
    if (!tl || ratio < 0.04 || ratio > 0.95) return { quad: null, ratio };
    // 縮小画像の1画素ぶん内側を採用（机のふちが写り込まないように）
    const k = 1 / s;
    const quad = [tl, tr, brc, bl].map(([i, j]) => ({ x: i * k, y: j * k }));
    if (polyArea(quad) < 0.12 * W * H) return { quad: null, ratio };
    return { quad, ratio };
  }

  function solve(A, b) {
    const n = b.length;
    const M = A.map((r, i) => [...r, b[i]]);
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      [M[c], M[p]] = [M[p], M[c]];
      const pv = M[c][c];
      if (Math.abs(pv) < 1e-12) throw new Error('四隅の指定が正しくありません');
      for (let k = c; k <= n; k++) M[c][k] /= pv;
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = M[r][c];
        if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    return M.map(r => r[n]);
  }

  // from の4点を to の4点へ移す射影変換（ホモグラフィ）行列
  function homography(from, to) {
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const { x, y } = from[i], { x: u, y: v } = to[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    return [...solve(A, b), 1];
  }

  const pixCache = new WeakMap();
  function pixels(c) {
    let v = pixCache.get(c);
    if (!v) {
      v = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
      pixCache.set(c, v);
    }
    return v;
  }

  // 四隅 quad（左上・右上・右下・左下）で囲まれた範囲を正面から見た長方形に直す
  function warp(src, quad, maxSide) {
    const L = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    let W = Math.max(L(quad[0], quad[1]), L(quad[3], quad[2]));
    let H = Math.max(L(quad[0], quad[3]), L(quad[1], quad[2]));
    const s = Math.min(1, maxSide / Math.max(W, H));
    W = Math.max(2, Math.round(W * s)); H = Math.max(2, Math.round(H * s));
    const h = homography([{ x: 0, y: 0 }, { x: W - 1, y: 0 }, { x: W - 1, y: H - 1 }, { x: 0, y: H - 1 }], quad);
    const sd = pixels(src), sw = src.width, sh = src.height;
    const out = document.createElement('canvas');
    out.width = W; out.height = H;
    const ctx = out.getContext('2d');
    const img = ctx.createImageData(W, H);
    const o = img.data;
    for (let v = 0, k = 0; v < H; v++) {
      for (let u = 0; u < W; u++, k += 4) {
        const z = h[6] * u + h[7] * v + h[8];
        let x = (h[0] * u + h[1] * v + h[2]) / z, y = (h[3] * u + h[4] * v + h[5]) / z;
        if (x < 0) x = 0; else if (x > sw - 1.001) x = sw - 1.001;
        if (y < 0) y = 0; else if (y > sh - 1.001) y = sh - 1.001;
        const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0;
        const p = (y0 * sw + x0) * 4, q = p + sw * 4;
        for (let c = 0; c < 3; c++) {
          const a = sd[p + c] + (sd[p + 4 + c] - sd[p + c]) * fx;
          const b = sd[q + c] + (sd[q + 4 + c] - sd[q + c]) * fx;
          o[k + c] = a + (b - a) * fy;
        }
        o[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return out;
  }

  // 紙を白く・色をくっきり（チャンネルごとのレベル補正＝白とびしない範囲で明暗を引き伸ばす）
  function enhance(canvas) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const im = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = im.data, n = d.length / 4;
    const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
    for (let i = 0; i < d.length; i += 4) { hist[0][d[i]]++; hist[1][d[i + 1]]++; hist[2][d[i + 2]]++; }
    const pct = (hh, p) => { let acc = 0; for (let v = 0; v < 256; v++) { acc += hh[v]; if (acc >= n * p) return v; } return 255; };
    const lut = [0, 1, 2].map(c => {
      // 白点（紙の色）を255に、黒点は控えめに下げる。紙の色が白より濃くならないよう hi は 255 以下に保つ
      const hi = Math.max(40, pct(hist[c], 0.97));
      const lo = Math.min(Math.round(pct(hist[c], 0.01) * 0.5), hi - 40);
      const t = new Uint8ClampedArray(256);
      for (let v = 0; v < 256; v++) t[v] = (v - lo) * 255 / (hi - lo);
      return t;
    });
    for (let i = 0; i < d.length; i += 4) { d[i] = lut[0][d[i]]; d[i + 1] = lut[1][d[i + 1]]; d[i + 2] = lut[2][d[i + 2]]; }
    ctx.putImageData(im, 0, 0);
    return canvas;
  }

  // 連続撮影用：カメラ映像を 64x48 の白黒に縮めた「指紋」
  function frameSig(video, ctx) {
    ctx.drawImage(video, 0, 0, 64, 48);
    const d = ctx.getImageData(0, 0, 64, 48).data;
    const g = new Float32Array(64 * 48);
    for (let i = 0; i < g.length; i++) g[i] = d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11;
    return g;
  }
  function diff(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
    return s / a.length;
  }

  return { loadImage, toCanvas, toBlob, detectQuad, warp, enhance, frameSig, diff, dims };
})();
