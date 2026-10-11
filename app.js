'use strict';
/* キッズギャラリー
   実装アイデア：①ありがとう儀式 ②現物の保管管理＋QRラベル ⑤連続撮影 ⑥自動補正
                ⑧年齢・学年の自動付与 ⑨名言帳／言い間違い辞典 ⑩プレゼントカード ⑳まるごと書き出し */

// アプリのバージョン（「このアプリについて」に表示。機能を変えたら更新する）
const APP_VERSION = '1.4.0';
const APP_VERSION_DATE = '2026-10-11';

// ---------- 小さな道具 ----------
const $ =(s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const view = () => $('#view');

function toast(msg, ms = 2500) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), ms);
}
function openModal(html, cls = '') {
  const m = $('#modal');
  m.className = 'modal open ' + cls;
  m.innerHTML = `<div class="modal-card">${html}</div>`;
  return m.firstElementChild;
}
function closeModal() { const m = $('#modal'); m.className = 'modal'; m.innerHTML = ''; }
function go(h) { if (location.hash === h) router(); else location.hash = h; }
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}
async function hydrate(root = document) {
  for (const el of $$('img[data-blob], audio[data-blob]', root)) {
    const u = await blobURL(el.dataset.blob);
    if (u) el.src = u;
  }
}

// ---------- 定義 ----------
// 立体のアイコン：積み木（赤い四角・青い四角・黄色い三角）。絵文字にぴったりのものがないので、絵を自作
const BLOCKS_ICON = '<svg class="ic" width="1em" height="1em" viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="13" width="9.5" height="9.5" rx="1.4" fill="#e8604c"/><rect x="12.5" y="13" width="9.5" height="9.5" rx="1.4" fill="#4f9bc9"/><path d="M12 1.8 19.2 12.2H4.8Z" fill="#f6c453" stroke="#f6c453" stroke-width="1.6" stroke-linejoin="round"/></svg>';
const TYPES = {
  art: { label: '平面', icon: '🎨', ex: '絵・ぬりえ・切り絵' },
  craft: { label: '立体', icon: BLOCKS_ICON, text: '🧱', ex: '工作・ねんど・ブロック' },
  shodo: { label: '文字', icon: '🖌️', ex: '習字・お手紙・ノート' },
  present: { label: 'プレゼント', icon: '🎁', ex: 'もらった物と言葉' },
  photo: { label: 'プチ記念', icon: '📷', ex: '運動会・発表会など' },
  word: { label: 'ことば', icon: '💬', ex: '名言・言い間違い' },
};
const STATUS = {
  keep: { label: '手元に保管', icon: '📦' },
  jikka: { label: '実家へ送った', icon: '🏠' },
  released: { label: '手放した', icon: '🕊️' },
};
const OCCASIONS = ['誕生日', '母の日', '父の日', '敬老の日', 'クリスマス', '結婚記念日', 'なんでもない日', 'その他'];
const COLORS = ['#f4845f', '#5fa8d3', '#6cb979', '#a98be0', '#e9a93b', '#e86f9a'];

// ---------- 年齢・学年（アイデア⑧） ----------
function parseDate(s) { const [y, m, d] = (s || '').split('-').map(Number); return { y, m, d }; }
function ageLabel(birth, date) {
  if (!birth || !date) return '';
  const b = parseDate(birth), t = parseDate(date);
  let months = (t.y - b.y) * 12 + (t.m - b.m);
  if (t.d < b.d) months--;
  if (months < 0) return '';
  return `${Math.floor(months / 12)}歳${months % 12}か月`;
}
// 4/2〜翌4/1生まれが同じ学年（日本の学校制度）
function gradeLabel(birth, date) {
  if (!birth || !date) return '';
  const b = parseDate(birth), t = parseDate(date);
  const entry = (b.m > 4 || (b.m === 4 && b.d >= 2)) ? b.y + 7 : b.y + 6; // 小学校入学年
  const fy = t.m >= 4 ? t.y : t.y - 1;
  const g = fy - entry + 1;
  if (g >= 1 && g <= 6) return `小${g}`;
  if (g >= 7 && g <= 9) return `中${g - 6}`;
  if (g >= 10) return '';
  return { 0: '年長', '-1': '年中', '-2': '年少' }[g] || '未就園';
}
const fiscalYear = date => { const { y, m } = parseDate(date); return m >= 4 ? y : y - 1; };

// ---------- 状態 ----------
const S = { children: [], items: [], boxes: [], filterChild: 'all', ritualIds: [] };
async function loadAll() {
  S.children = (await DB.all('children')).sort((a, b) => (a.birth || '').localeCompare(b.birth || ''));
  S.items = await DB.all('items');
  S.boxes = (await DB.all('boxes')).sort((a, b) => a.name.localeCompare(b.name, 'ja', { numeric: true }));
}
async function saveItem(i) {
  await DB.put('items', i);
  const k = S.items.findIndex(x => x.id === i.id);
  if (k >= 0) S.items[k] = i; else S.items.push(i);
}
async function deleteItem(i) {
  S.items = S.items.filter(x => x.id !== i.id);
  await DB.del('items', i.id);
  await gcBlobs(itemRefs(i), S.items);
}
const childById = id => S.children.find(c => c.id === id);
const visibleItems = () => S.items.filter(i => S.filterChild === 'all' || i.childId === S.filterChild);
function itemAge(i) {
  const c = childById(i.childId);
  if (!c) return '';
  return [ageLabel(c.birth, i.date), gradeLabel(c.birth, i.date)].filter(Boolean).join('・');
}
const childOptions = sel => S.children.map(c => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
const boxOptions = sel => `<option value="">（未設定）</option>` + S.boxes.map(b => `<option value="${b.id}" ${b.id === sel ? 'selected' : ''}>${esc(b.name)}${b.location ? '（' + esc(b.location) + '）' : ''}</option>`).join('');
const defaultChild = () => (S.filterChild !== 'all' ? S.filterChild : S.children[0]?.id);

// ---------- 共通パーツ ----------
// 「‹ もどる」：前の画面へ（アプリ内で来ていないときは、決まった画面へ）
const NAV = { count: 0 }; // アプリの中で画面を移動した回数（お知らせやQRから直接開いたときは、戻り先がない）
const backBtn = () => '<button type="button" class="back" id="backBtn">‹ もどる</button>';
function bindBack(fallback) {
  const b = $('#backBtn');
  if (b) b.onclick = () => (NAV.count > 1 ? history.back() : go(fallback));
}
function childChips() {
  if (S.children.length < 2) return '';
  return `<div class="chips" id="childChips"><button data-c="all" class="chip ${S.filterChild === 'all' ? 'on' : ''}">みんな</button>${S.children.map(c => `<button data-c="${c.id}" class="chip ${S.filterChild === c.id ? 'on' : ''}" style="--cc:${c.color}">${esc(c.name)}</button>`).join('')}</div>`;
}
function bindChildChips(rerender) {
  $$('#childChips .chip').forEach(b => { b.onclick = () => { S.filterChild = b.dataset.c; rerender(); }; });
}
function card(i) {
  const c = childById(i.childId);
  if (i.type === 'word') {
    return `<a class="card word-card" href="#item/${i.id}"><div class="quote">「${esc(i.word?.text)}」</div><div class="meta">${esc(c?.name || '')} ${esc(ageLabel(c?.birth, i.date))}</div></a>`;
  }
  const ph = i.photos?.[0];
  return `<a class="card" href="#item/${i.id}"><div class="thumb">${ph ? `<img data-blob="${ph.thumb}" alt="">` : `<span class="ph">${TYPES[i.type].icon}</span>`}${i.status === 'released' ? '<span class="badge-rel" title="現物は手放しました">🕊️</span>' : ''}</div><div class="cap"><b>${esc(i.title || TYPES[i.type].label)}</b><span>${esc(c?.name || '')}・${esc(ageLabel(c?.birth, i.date))}</span></div></a>`;
}

// ---------- ホーム画面に追加 ----------
const UA = navigator.userAgent;
const isIOS = /iPhone|iPad|iPod/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = /Android/.test(UA);
const inAppBrowser = /Line\/|FBAN|FBAV|Instagram|MicroMessenger|; wv\)/.test(UA); // LINEなどアプリ内のブラウザ（ここからは追加できない）
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
let installEvt = null; // Chrome・Edgeが出す「インストールできます」の合図（あれば、ボタン1つで追加できる）
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; });
window.addEventListener('appinstalled', () => { installEvt = null; toast('ホーム画面に追加しました'); const c = $('#installCard'); if (c) c.hidden = true; });

const INSTALL_HIDE_KEY = 'kg.installHidden';
function installHidden() {
  try { return Date.now() - Number(localStorage.getItem(INSTALL_HIDE_KEY) || 0) < 30 * 864e5; } catch { return false; }
}
// ホームの上に出す「ホーム画面に追加」の案内（アイコンから開いているときは出さない）
function installCard() {
  if (isStandalone() || installHidden()) return '';
  return `<div class="banner install" id="installCard"><span>📲 ホーム画面に追加すると、すぐ開けます</span>
    <span class="row"><button class="btn small primary" id="instBtn">追加</button><button class="btn small" id="instLater">あとで</button></span></div>`;
}
function bindInstall() {
  const b = $('#instBtn');
  if (b) b.onclick = installGuide;
  const l = $('#instLater');
  if (l) l.onclick = () => { try { localStorage.setItem(INSTALL_HIDE_KEY, String(Date.now())); } catch { } $('#installCard').hidden = true; };
  const s = $('#instSettings');
  if (s) s.onclick = installGuide;
}
async function installGuide() {
  // Chrome・Edge（Android・パソコン）：ボタン1つで追加できる
  if (installEvt) {
    const ev = installEvt;
    installEvt = null;
    try { ev.prompt(); await ev.userChoice; } catch { }
    return;
  }
  const url = location.href.split('#')[0];
  let steps, note = '';
  if (inAppBrowser) {
    steps = ['右上（または右下）の「…」や共有マークをタップ', '「ブラウザで開く」（SafariやChrome）を選ぶ',
      isIOS ? '開いたSafariで、もう一度ここ（「ホーム画面に追加」のしかた）を見る' : '開いたChromeで、もう一度ここ（「ホーム画面に追加」のしかた）を見る'];
    note = 'LINEなどのアプリの中で開いているため、このままでは追加できません。';
  } else if (isIOS) {
    const safari = !/CriOS|EdgiOS|FxiOS|OPiOS/.test(UA);
    steps = [`画面の${/iPad/.test(UA) ? '上' : '下'}にある<b>共有ボタン</b>（□に↑のマーク）をタップ`, '<b>「ホーム画面に追加」</b>をタップ（見つからないときは、メニューを下へスクロール）', '右上の<b>「追加」</b>をタップ'];
    note = (safari ? '' : 'うまくいかないときは、Safariで開き直してください。')
      + 'iPhone・iPadでは、Safariで入れたデータと、ホーム画面のアイコンのデータは<b>別々</b>です。追加したら、アイコンから開いて、そちらで「家族で共有」につないでください（Safari側の作品は、家族共有でそろいます）。';
  } else if (isAndroid) {
    steps = ['Chromeの右上の<b>「︙」</b>をタップ', '<b>「ホーム画面に追加」</b>（または「アプリをインストール」）をタップ', '<b>「追加」</b>をタップ'];
  } else {
    steps = ['ChromeやEdgeの、アドレスバーの右はしにある<b>インストールのアイコン（⊕）</b>をクリック', 'うまく出ないときは「︙」→「アプリ」→<b>「このサイトをアプリとしてインストール」</b>', '「インストール」をクリック'];
    note = 'デスクトップにショートカットだけ置くときは、Chromeの「︙」→「保存と共有」→「ショートカットを作成」。';
  }
  const m = openModal(`<h2>📲 ホーム画面に追加</h2>
    ${note ? `<p class="banner">${note}</p>` : ''}
    <ol class="steps">${steps.map(s => `<li>${s}</li>`).join('')}</ol>
    <div class="row">${inAppBrowser ? '<button class="btn primary" id="gCopy">📋 このアプリのリンクをコピー</button>' : ''}<button class="btn" id="gX">閉じる</button></div>`);
  $('#gX', m).onclick = closeModal;
  const c = $('#gCopy', m);
  if (c) c.onclick = async () => { try { await navigator.clipboard.writeText(url); toast('コピーしました'); } catch { toast('コピーできませんでした'); } };
}
function installPanel() {
  return `<section class="panel"><h2>📲 ホーム画面に追加</h2>${isStandalone()
    ? '<p class="hint">✅ いま、ホーム画面のアイコンから開いています。</p>'
    : '<p class="hint">アイコンをホーム画面に置くと、アプリのようにすぐ開けます。</p><button class="btn wide" id="instSettings">📲 追加のしかたを見る</button>'}</section>`;
}
const qrSvgTag = text => {
  if (typeof qrcode === 'undefined') return '<p class="hint">QR部品を読み込めませんでした</p>';
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
};

// ---------- ホーム ----------
async function home() {
  if (!S.children.length) return onboarding();
  const items = visibleItems();
  const now = new Date(), ty = now.getFullYear();
  const t0 = new Date(ty, now.getMonth(), now.getDate());
  const mem = items.filter(i => {
    if (!i.date) return false;
    const { y, m, d } = parseDate(i.date);
    return y < ty && Math.abs((new Date(ty, m - 1, d) - t0) / 864e5) <= 3;
  }).sort((a, b) => a.date.localeCompare(b.date));
  const recent = [...items].sort((a, b) => b.createdAt - a.createdAt).slice(0, 6);
  const things = items.filter(i => i.type !== 'word');
  const last = (await DB.get('meta', 'lastBackup'))?.value;
  const needBackup = S.items.length > 0 && (!last || Date.now() - last > 30 * 864e5);
  // 作品が12点たまるごとに「作品集をつくりませんか」と声をかける（MUSEUMの自動作品集の考え方）
  const made = Object.fromEntries((await DB.all('meta')).filter(m => m.id.startsWith('bookMade:')).map(m => [m.id.slice(9), m.value]));
  const bookFor = S.children.map(c => {
    const n = S.items.filter(i => i.childId === c.id && i.type !== 'word' && i.photos?.length).length;
    return { c, n, fresh: n - (made[c.id] || 0) };
  }).filter(x => x.fresh >= 12 && (S.filterChild === 'all' || S.filterChild === x.c.id))[0];

  // 案内の帯は1つまで（ホーム画面に追加の案内が出ているときは、お知らせの案内を出さない）
  const ins = installCard();
  const nudge = ins ? '' : await notifyNudge();
  view().innerHTML = `
  ${ins}
  ${childChips()}
  ${bookFor ? `<a class="banner book" href="#book/${bookFor.c.id}">📕 ${esc(bookFor.c.name)}の作品が${bookFor.n}点になりました。作品集（ART BOOK）を自動で作ってみませんか？ →</a>` : ''}
  ${nudge}
  ${needBackup ? `<a class="banner" href="#settings/backup">💾 ${last ? '前回のバックアップから30日以上たちました' : 'まだ一度も書き出していません'}。思い出を守るために書き出しましょう →</a>` : ''}
  <section class="quick">
    <a href="#add" class="qa big">📷<b>作品を撮ってしまう</b></a>
    <a href="#burst" class="qa">⚡<b>連続撮影</b><small>たまった作品を一気に</small></a>
    <a href="#words/new" class="qa">💬<b>ことば</b><small>名言・言い間違い</small></a>
    <a href="#add/present" class="qa">🎁<b>プレゼント</b><small>もらった物と言葉</small></a>
    <a href="#boxes" class="qa">📦<b>現物の保管</b><small>箱とQRラベル</small></a>
    <a href="#book" class="qa wide">📕<b>作品集（ART BOOK）をつくる</b><small>自動レイアウト・A4/A5・PDFで保存</small></a>
  </section>
  ${mem.length ? `<section><h2>📅 思い出のこの日</h2><div class="mem-list">${mem.map(i => {
    const n = ty - parseDate(i.date).y;
    const exact = i.date.slice(5) === today().slice(5);
    return `<div class="mem"><div class="mem-tag">${n}年前${exact ? 'の今日' : 'のこのころ'}</div>${card(i)}</div>`;
  }).join('')}</div></section>` : ''}
  <section class="stats">
    <div><b>${items.length}</b><span>しまった思い出</span></div>
    <div><b>${things.filter(i => i.status === 'keep').length}</b><span>現物を保管中</span></div>
    <div><b>${things.filter(i => i.status === 'released').length}</b><span>手放せた現物</span></div>
  </section>
  <section><h2>さいきん しまったもの${recent.length ? '<a class="more-link push" href="#gallery">すべて見る ›</a>' : ''}</h2>${recent.length ? `<div class="grid">${recent.map(card).join('')}</div>` : '<div class="empty-card"><div class="empty-ic">📷</div><p>まだありません。まずは1枚撮ってみましょう！</p><a class="btn primary" href="#add">＋ しまう</a></div>'}</section>`;
  bindChildChips(home);
  bindInstall();
  bindNotifyNudge();
  hydrate(view());
}

function onboarding() {
  view().innerHTML = `
  <section class="hero"><div class="hero-ic">🖼️</div><h1>キッズギャラリー</h1>
  <p>平面・立体・文字・プチ記念・プレゼント・ことば…<br>捨てられない思い出を、写真でしまっておく場所です。</p></section>
  ${installCard()}
  ${Cloud.available() && !Cloud.enabled() ? `<section class="panel"><h2>👨‍👩‍👧 すでに家族で使っていますか？</h2>
    <p class="hint">ほかの端末や、家族がもう使っているときは、お子さんを登録しなくても、つなぐだけで作品が届きます。</p>
    <a class="btn wide" href="#settings/family">👨‍👩‍👧 家族の共有につなぐ</a></section>` : ''}
  <section class="panel"><h2>まずはお子さんを登録</h2>${childFormHTML()}</section>`;
  bindChildForm(null, () => go('#home'));
  bindInstall();
}
function childFormHTML(c = {}) {
  return `<form id="childForm" class="form">
    <label>なまえ（ニックネームでもOK）<input name="name" required value="${esc(c.name || '')}" placeholder="例：はるちゃん"></label>
    <label>誕生日<input name="birth" type="date" required value="${esc(c.birth || '')}"></label>
    <p class="hint">作品に「4歳3か月・年中」のような年齢と学年を自動で付けるために使います。</p>
    <button class="btn primary wide">${c.id ? '保存' : '登録する'}</button></form>`;
}
function bindChildForm(c, done) {
  $('#childForm').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const rec = { ...(c || { id: uid(), color: COLORS[S.children.length % COLORS.length] }), name: f.get('name').trim(), birth: f.get('birth') };
    await DB.put('children', rec);
    await loadAll();
    toast('保存しました');
    done();
  };
}

// ---------- ギャラリー ----------
const G = { type: 'all', status: 'all' };
async function gallery() {
  let items = visibleItems().filter(i => i.type !== 'word');
  if (G.type !== 'all') items = items.filter(i => i.type === G.type);
  if (G.status !== 'all') items = items.filter(i => i.status === G.status);
  items.sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.createdAt - a.createdAt);
  const groups = new Map();
  for (const i of items) {
    const k = i.date ? fiscalYear(i.date) : '日付なし';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(i);
  }
  const header = (fy, list) => {
    let sub = '';
    if (fy !== '日付なし') {
      const c = S.filterChild !== 'all' ? childById(S.filterChild) : (S.children.length === 1 ? S.children[0] : null);
      if (c) sub = gradeLabel(c.birth, `${fy}-10-01`);
    }
    return `<h2>${fy === '日付なし' ? fy : fy + '年度'}${sub ? ` <small>${sub}</small>` : ''}<span class="count">${list.length}点</span></h2>`;
  };
  const typeChips = [['all', 'すべて'], ...Object.entries(TYPES).filter(([k]) => k !== 'word').map(([k, v]) => [k, v.icon + ' ' + v.label])];
  const statusChips = [['all', '現物：すべて'], ...Object.entries(STATUS).map(([k, v]) => [k, v.icon + ' ' + v.label])];
  view().innerHTML = `
  ${childChips()}
  <div class="chips" id="typeChips">${typeChips.map(([k, l]) => `<button class="chip ${G.type === k ? 'on' : ''}" data-t="${k}">${l}</button>`).join('')}</div>
  <div class="chips small" id="statusChips">${statusChips.map(([k, l]) => `<button class="chip ${G.status === k ? 'on' : ''}" data-s="${k}">${l}</button>`).join('')}</div>
  ${items.length ? [...groups].map(([fy, list]) => `<section>${header(fy, list)}<div class="grid">${list.map(card).join('')}</div></section>`).join('')
    : S.items.some(i => i.type !== 'word') ? '<p class="empty">この条件に合う作品はありません</p>'
    : '<div class="empty-card"><div class="empty-ic">🖼️</div><p>まだ作品がありません。<br>下の「＋」から、しまってみましょう。</p><a class="btn primary" href="#add">＋ しまう</a></div>'}`;
  bindChildChips(gallery);
  $$('#typeChips .chip').forEach(b => { b.onclick = () => { G.type = b.dataset.t; gallery(); }; });
  $$('#statusChips .chip').forEach(b => { b.onclick = () => { G.status = b.dataset.s; gallery(); }; });
  hydrate(view());
}

// ---------- 詳細 ----------
async function item(id) {
  const i = S.items.find(x => x.id === id);
  if (!i) { view().innerHTML = '<p class="empty">見つかりません</p>'; return; }
  const c = childById(i.childId);
  view().innerHTML = `
  ${backBtn()}
  <div class="detail">
    ${i.photos?.length ? `<div class="carousel">${i.photos.map(p => `<img data-blob="${p.full}" alt="">`).join('')}</div>${i.photos.length > 1 ? `<p class="hint center">← スワイプで${i.photos.length}枚 →</p>` : ''}` : ''}
    ${i.type === 'word' ? `<blockquote class="big-quote">「${esc(i.word.text)}」</blockquote>${i.word.mistake && i.word.correct ? `<p class="mistake">📖 言い間違い辞典：「${esc(i.word.text)}」→ 正しくは「${esc(i.word.correct)}」</p>` : ''}` : ''}
    <div class="d-head"><span class="type-badge">${TYPES[i.type].icon} ${TYPES[i.type].label}</span>${i.title ? `<h1>${esc(i.title)}</h1>` : ''}</div>
    <dl class="facts">
      <dt>だれ</dt><dd>${esc(c?.name || '未設定')}</dd>
      <dt>いつ</dt><dd>${esc(i.date || '')}<b>${esc(itemAge(i))}</b></dd>
      ${i.type === 'present' ? `<dt>何の日</dt><dd>${esc(i.present?.occasion || '—')}</dd><dt>添えられた言葉</dt><dd>${esc(i.present?.message || '—')}</dd>` : ''}
      ${i.memo ? `<dt>${i.type === 'word' ? '場面' : 'メモ'}</dt><dd>${esc(i.memo).replace(/\n/g, '<br>')}</dd>` : ''}
    </dl>
    ${i.audio ? `<div class="audio-box"><span>🎙️ ${i.type === 'word' ? 'そのときの声' : '本人の解説'}</span><audio controls data-blob="${i.audio}"></audio></div>` : ''}
    ${i.type !== 'word' && i.photos?.length ? `<a class="btn wide" href="#goods/${i.id}">🎁 グッズのイメージを作る（背景を切り抜き）</a>` : ''}
    ${i.type !== 'word' ? statusPanel(i) : ''}
    <div class="row"><a class="btn" href="${i.type === 'word' ? '#words/edit/' + i.id : '#edit/' + i.id}">✏️ 編集</a><button class="btn danger" id="del">🗑️ 削除</button></div>
  </div>`;
  hydrate(view());
  bindBack('#gallery');

  $('#del').onclick = async () => {
    if (!confirm('この思い出を削除しますか？（元に戻せません）')) return;
    await deleteItem(i);
    toast('削除しました');
    history.length > 1 ? history.back() : go('#gallery');
  };
  $$('#statusSeg button').forEach(b => {
    b.onclick = async () => { i.status = b.dataset.s; if (i.status !== 'keep') i.boxId = ''; await saveItem(i); item(id); };
  });
  const sel = $('#boxSel');
  if (sel) sel.onchange = async () => {
    if (sel.value === '__new') {
      const b = await newBoxPrompt();
      if (!b) { sel.value = i.boxId || ''; return; }
      i.boxId = b.id;
    } else i.boxId = sel.value;
    await saveItem(i);
    item(id);
  };
  const un = $('#unrelease');
  if (un) un.onclick = async () => { i.status = 'keep'; i.releasedAt = ''; await saveItem(i); item(id); };
}

function statusPanel(i) {
  if (i.status === 'released') {
    return `<section class="panel released"><h2>🕊️ 現物は手放しました</h2>
      <p>${esc(i.releasedAt || '')} に「ありがとう、さようなら」をしました。</p>
      ${i.thanksAudio ? `<div class="audio-box"><span>ありがとうの声</span><audio controls data-blob="${i.thanksAudio}"></audio></div>` : ''}
      <button class="btn small" id="unrelease">取り消す（現物がまだあった）</button></section>`;
  }
  return `<section class="panel"><h2>現物はどこにある？</h2>
    <div class="seg" id="statusSeg">${['keep', 'jikka'].map(k => `<button data-s="${k}" class="${i.status === k ? 'on' : ''}">${STATUS[k].icon} ${STATUS[k].label}</button>`).join('')}</div>
    ${i.status === 'keep' ? `<label class="inline">保管箱 <select id="boxSel">${boxOptions(i.boxId)}<option value="__new">＋ 新しい箱を作る</option></select></label>` : ''}
    <a class="btn ritual wide" href="#ritual/${i.id}">🕊️「ありがとう、さようなら」をして手放す</a></section>`;
}

async function newBoxPrompt() {
  const name = prompt('新しい箱の名前', `箱${S.boxes.length + 1}`);
  if (!name) return null;
  const location = prompt('置き場所（例：押し入れ上段・左）', '') || '';
  const b = { id: uid(), name: name.trim(), location: location.trim() };
  await DB.put('boxes', b);
  await loadAll();
  return b;
}

// ---------- 追加・編集 ----------
async function add(type) {
  if (!S.children.length) return go('#home');
  if (type === 'word') return go('#words/new');
  if (!type || !TYPES[type]) {
    view().innerHTML = `<h1 class="page-title">何をしまう？</h1>
    <p class="hint lead">種類を選ぶと、写真を撮る画面に進みます。</p>
    <div class="type-grid">${Object.entries(TYPES).map(([k, v]) => `<a class="type-btn" href="${k === 'word' ? '#words/new' : '#add/' + k}"><span>${v.icon}</span>${v.label}<small>${v.ex}</small></a>`).join('')}</div>
    <a class="btn wide" href="#burst">⚡ たくさんある時は「連続撮影」</a>`;
    return;
  }
  const d = {
    id: uid(), type, childId: defaultChild(), date: today(), title: '', memo: '', photos: [],
    status: 'keep', boxId: '', createdAt: Date.now(),
  };
  if (type === 'present') d.present = { occasion: '', message: '' };
  renderForm(d, true);
}
async function edit(id) {
  const i = S.items.find(x => x.id === id);
  if (!i) return go('#gallery');
  if (i.type === 'word') return go('#words/edit/' + id);
  renderForm(structuredClone(i), false);
}

function renderForm(d, isNew) {
  const T = TYPES[d.type];
  d._removed = [];
  view().innerHTML = `<h1 class="page-title">${T.icon} ${T.label}を${isNew ? 'しまう' : '編集'}</h1>
  <section class="panel"><h2>写真 <small>${d.type === 'craft' ? 'いろんな角度から何枚でも' : '複数枚OK'}</small></h2>
    <div class="photo-strip" id="photoStrip"></div></section>
  <form id="itemForm" class="form panel">
    <label>だれの？<select name="childId">${childOptions(d.childId)}</select></label>
    <label>いつ？<input type="date" name="date" value="${esc(d.date)}" required><span class="age-preview" id="agePrev"></span></label>
    <label>題名<input name="title" value="${esc(d.title)}" placeholder="${d.type === 'present' ? '例：かたたたき券' : '例：ママの顔'}"></label>
    ${d.type === 'present' ? `
    <label>何の日にもらった？<select name="occasion"><option value="">選ぶ…</option>${OCCASIONS.map(o => `<option ${d.present?.occasion === o ? 'selected' : ''}>${o}</option>`).join('')}</select></label>
    <label>添えられた言葉<textarea name="message" rows="2" placeholder="例：「いつもありがとう」ってはずかしそうに">${esc(d.present?.message || '')}</textarea></label>` : ''}
    <label>メモ<textarea name="memo" rows="3" placeholder="作ったときの様子、本人の説明など">${esc(d.memo)}</textarea></label>
    <div id="recRow"></div>
    ${isNew ? `<div class="save-choices">
      <p class="hint">現物はどうしますか？</p>
      <button class="btn primary" value="keep">📦 しまう（現物も保管する）</button>
      <button class="btn ritual" value="release">🕊️ しまって「ありがとう、さようなら」</button>
      <button class="btn" value="jikka">🏠 しまう（現物は実家へ送る）</button></div>`
      : `<button class="btn primary wide" value="save">保存</button>`}
  </form>`;

  const strip = $('#photoStrip');
  const renderStrip = () => {
    strip.innerHTML = d.photos.map((p, k) => `<div class="ph-item"><img data-blob="${p.thumb}" alt=""><button type="button" class="x" data-k="${k}" aria-label="削除">✕</button></div>`).join('') +
      `<label class="ph-add">📷<span>撮る</span><input type="file" accept="image/*" capture="environment" hidden></label>
       <label class="ph-add">🖼️<span>選ぶ</span><input type="file" accept="image/*" multiple hidden></label>`;
    hydrate(strip);
    $$('input[type=file]', strip).forEach(inp => {
      inp.onchange = async () => {
        for (const file of inp.files) {
          const r = await openCorrector(file, d.type);
          if (r) d.photos.push({ full: await putBlob(r.full), thumb: await putBlob(r.thumb) });
        }
        renderStrip();
      };
    });
    $$('.x', strip).forEach(b => {
      b.onclick = () => { const p = d.photos.splice(+b.dataset.k, 1)[0]; d._removed.push(p.full, p.thumb); renderStrip(); };
    });
  };
  renderStrip();
  renderRec(d, $('#recRow'), '本人の解説');
  const form = $('#itemForm');
  bindAgePreview(form);

  form.onsubmit = async e => {
    e.preventDefault();
    const act = e.submitter?.value || 'save';
    const f = new FormData(form);
    d.childId = f.get('childId');
    d.date = f.get('date');
    d.title = f.get('title').trim();
    d.memo = f.get('memo').trim();
    if (d.type === 'present') d.present = { occasion: f.get('occasion'), message: f.get('message').trim() };
    if (act === 'release' && !d.photos.length) { toast('手放す前に、写真を1枚撮っておきましょう'); return; }
    if (!d.photos.length && !confirm('写真がありません。このまま保存しますか？')) return;
    if (act === 'keep' || act === 'release') d.status = 'keep';
    if (act === 'jikka') { d.status = 'jikka'; d.boxId = ''; }
    const removed = d._removed;
    delete d._removed;
    await saveItem(d);
    await gcBlobs(removed, S.items);
    if (act === 'release') return go('#ritual/' + d.id);
    toast('しまいました');
    go('#item/' + d.id);
  };
}

function bindAgePreview(form) {
  const cSel = form.querySelector('[name=childId]'), dIn = form.querySelector('[name=date]');
  const upd = () => {
    const c = childById(cSel.value);
    const a = c && dIn.value ? [ageLabel(c.birth, dIn.value), gradeLabel(c.birth, dIn.value)].filter(Boolean).join('・') : '';
    $('#agePrev').textContent = a ? `→ ${a}（自動）` : '';
  };
  cSel.onchange = upd;
  dIn.oninput = upd;
  upd();
}

function renderRec(d, el, label) {
  el.innerHTML = d.audio
    ? `<div class="audio-box"><span>🎙️ ${label}</span><audio controls data-blob="${d.audio}"></audio><button type="button" class="btn small" data-act="del">声を削除</button></div>`
    : `<button type="button" class="btn" data-act="rec">🎙️ ${label}を録音</button>`;
  hydrate(el);
  el.onclick = async e => {
    const a = e.target.closest('[data-act]')?.dataset.act;
    if (a === 'rec') {
      const b = await recordModal(`${label}を録音`, '話し終わったら「止める」を押してください', 60);
      if (b) { d.audio = await putBlob(b); renderRec(d, el, label); }
    } else if (a === 'del') {
      (d._removed ||= []).push(d.audio);
      d.audio = null;
      renderRec(d, el, label);
    }
  };
}

// ---------- 録音 ----------
function recordModal(title, hint, maxSec = 20) {
  return new Promise(async resolve => {
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { toast('マイクが使えません（ブラウザの許可を確認してください）', 4000); return resolve(null); }
    const rec = new MediaRecorder(stream);
    const chunks = [];
    let canceled = false;
    rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    openModal(`<h2>${esc(title)}</h2><p class="hint">${esc(hint)}</p><div class="rec-timer"><span class="rec-dot"></span><span id="recT">0</span>秒</div>
      <div class="row center"><button class="btn primary" id="recStop">⏹ 止める</button><button class="btn" id="recCancel">やめる</button></div>`);
    const t0 = Date.now();
    const stop = () => { if (rec.state !== 'inactive') rec.stop(); };
    const iv = setInterval(() => {
      const s = Math.floor((Date.now() - t0) / 1000);
      const el = $('#recT');
      if (el) el.textContent = s;
      if (s >= maxSec) stop();
    }, 250);
    rec.onstop = () => {
      clearInterval(iv);
      stream.getTracks().forEach(t => t.stop());
      closeModal();
      resolve(canceled || !chunks.length ? null : new Blob(chunks, { type: rec.mimeType || 'audio/webm' }));
    };
    rec.start();
    $('#recStop').onclick = stop;
    $('#recCancel').onclick = () => { canceled = true; stop(); };
  });
}

// ---------- 自動補正エディタ（アイデア⑥） ----------
async function openCorrector(file, type) {
  let im;
  try { im = await Imaging.loadImage(file); } catch { toast('この画像は読み込めませんでした'); return null; }
  let src = Imaging.toCanvas(im, 2400);
  const full = () => [{ x: 0, y: 0 }, { x: src.width, y: 0 }, { x: src.width, y: src.height }, { x: 0, y: src.height }];
  const auto = () => Imaging.detectQuad(src).quad || full();
  let quad = auto();
  const flat = ['art', 'shodo', 'present'].includes(type);
  const adj = { b: 0, s: 1 };

  return new Promise(resolve => {
    openModal(`<h2>写真をととのえる</h2>
      <div class="corr-wrap">
        <div class="corr-stage" id="stage"><canvas id="srcC"></canvas><svg id="qSvg" preserveAspectRatio="none"></svg></div>
        <div class="corr-result"><canvas id="outC"></canvas><small>できあがり</small></div>
      </div>
      <div class="toggles">
        <label><input type="checkbox" id="tWarp" ${flat ? 'checked' : ''}> 四隅を合わせて切り抜く（ゆがみ補正）</label>
        <label><input type="checkbox" id="tEnh" ${flat ? 'checked' : ''}> 紙を白く・色をくっきり</label>
      </div>
      <p class="hint" id="qHint">● を動かして、作品の四隅に合わせてください</p>
      <div class="row"><button class="btn small" id="cAuto">🔍 自動で検出</button><button class="btn small" id="cFull">⬜ 写真全体</button><button class="btn small" id="cRotL" aria-label="左に回す">↺ 左へ</button><button class="btn small" id="cRotR" aria-label="右に回す">↻ 右へ</button></div>
      <div class="sliders">
        <label>☀️ 明るさ <input type="range" id="sB" min="-50" max="50" value="0"><output id="oB">0</output></label>
        <label>🎨 あざやかさ <input type="range" id="sS" min="40" max="220" value="100"><output id="oS">100</output></label>
        <button class="btn small" id="cReset">調整をもどす</button>
      </div>
      <div class="row"><button class="btn" id="cCancel">やめる</button><button class="btn primary" id="cOk">この写真を使う</button></div>`, 'wide');

    const sc = $('#srcC'), svg = $('#qSvg');
    let r = 1;
    const setupSrc = () => {
      const disp = Imaging.toCanvas(src, 900);
      sc.width = disp.width; sc.height = disp.height;
      sc.getContext('2d').drawImage(disp, 0, 0);
      svg.setAttribute('viewBox', `0 0 ${src.width} ${src.height}`);
      r = Math.max(src.width, src.height) * 0.03;
    };

    const process = max => {
      const c = $('#tWarp').checked ? Imaging.warp(src, quad, max) : Imaging.toCanvas(src, max);
      if ($('#tEnh').checked) Imaging.enhance(c);
      if (adj.b || adj.s !== 1) Imaging.adjust(c, adj.b, adj.s);
      return c;
    };
    let pending = 0;
    const preview = () => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => {
        const o = process(480), oc = $('#outC');
        if (!oc) return;
        oc.width = o.width; oc.height = o.height;
        oc.getContext('2d').drawImage(o, 0, 0);
      });
    };
    const drawQuad = () => {
      const on = $('#tWarp').checked;
      svg.style.display = on ? '' : 'none';
      $('#qHint').style.visibility = on ? '' : 'hidden';
      svg.innerHTML = `<polygon points="${quad.map(p => `${p.x},${p.y}`).join(' ')}" fill="rgba(244,132,95,.15)" stroke="#f4845f" stroke-width="${r / 4}"/>` +
        quad.map((p, k) => `<circle cx="${p.x}" cy="${p.y}" r="${r * 1.8}" fill="transparent" data-k="${k}"/><circle cx="${p.x}" cy="${p.y}" r="${r * 0.7}" fill="#fff" stroke="#f4845f" stroke-width="${r / 3}" pointer-events="none"/>`).join('');
    };
    let drag = -1;
    svg.onpointerdown = e => {
      const k = e.target.dataset?.k;
      if (k == null) return;
      drag = +k;
      svg.setPointerCapture(e.pointerId);
    };
    svg.onpointermove = e => {
      if (drag < 0) return;
      const b = svg.getBoundingClientRect();
      quad[drag] = {
        x: Math.min(src.width, Math.max(0, (e.clientX - b.left) / b.width * src.width)),
        y: Math.min(src.height, Math.max(0, (e.clientY - b.top) / b.height * src.height)),
      };
      drawQuad();
    };
    svg.onpointerup = svg.onpointercancel = () => { if (drag >= 0) { drag = -1; preview(); } };
    $('#tWarp').onchange = () => { drawQuad(); preview(); };
    $('#tEnh').onchange = preview;
    $('#cAuto').onclick = () => { quad = auto(); $('#tWarp').checked = true; drawQuad(); preview(); };
    $('#cFull').onclick = () => { quad = full(); drawQuad(); preview(); };
    const rot = dir => { src = Imaging.rotate(src, dir); quad = auto(); setupSrc(); drawQuad(); preview(); };
    $('#cRotL').onclick = () => rot(-1);
    $('#cRotR').onclick = () => rot(1);
    const sB = $('#sB'), sS = $('#sS');
    sB.oninput = () => { adj.b = +sB.value; $('#oB').textContent = sB.value; preview(); };
    sS.oninput = () => { adj.s = sS.value / 100; $('#oS').textContent = sS.value; preview(); };
    $('#cReset').onclick = () => { sB.value = 0; sS.value = 100; sB.oninput(); sS.oninput(); };
    $('#cCancel').onclick = () => { closeModal(); resolve(null); };
    $('#cOk').onclick = async () => {
      $('#cOk').disabled = true;
      $('#cOk').textContent = '処理中…';
      await new Promise(r => setTimeout(r, 30));
      try {
        const out = process(1600);
        const res = { full: await Imaging.toBlob(out), thumb: await Imaging.toBlob(Imaging.toCanvas(out, 400)) };
        closeModal();
        resolve(res);
      } catch (err) {
        toast(err.message);
        $('#cOk').disabled = false;
        $('#cOk').textContent = 'この写真を使う';
      }
    };
    setupSrc();
    drawQuad();
    preview();
  });
}

// ---------- 連続撮影（アイデア⑤） ----------
let camStream = null, burstTimer = null, burstShots = [], recog = null;
function stopCamera() {
  if (burstTimer) { clearInterval(burstTimer); burstTimer = null; }
  if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null; }
  if (recog) { try { recog.stop(); } catch { } recog = null; }
}

async function burst() {
  if (!S.children.length) return go('#home');
  burstShots.forEach(s => URL.revokeObjectURL(s.url));
  burstShots = [];
  view().innerHTML = `<h1 class="page-title">⚡ 連続撮影</h1>
  <p class="hint">作品を1枚ずつカメラの前に置いてください。手がどいて画面が静止すると、自動でパシャッと撮ります。撮ったら次の作品を上に重ねるだけ。</p>
  <div class="cam"><video id="vid" playsinline muted autoplay></video><div class="flash" id="flash"></div>
    <div class="cam-count" id="camCount">0枚</div><div class="cam-status" id="camStatus">カメラを準備中…</div></div>
  <div class="row"><label class="switch"><input type="checkbox" id="autoT" checked> 自動シャッター</label><button class="btn primary" id="shutter">📸 手動で撮る</button></div>
  <div class="burst-strip" id="bStrip"></div>
  <button class="btn wide primary" id="bDone" disabled>撮り終わった → まとめて整理</button>
  <p class="hint center">カメラが使えないときは <label class="link">写真をまとめて選ぶ<input type="file" accept="image/*" multiple id="bFiles" hidden></label></p>`;

  const vid = $('#vid'), st = $('#camStatus');
  $('#bFiles').onchange = async e => {
    st.textContent = '取り込み中…';
    for (const f of e.target.files) {
      try { await addShot(Imaging.toCanvas(await Imaging.loadImage(f), 2400)); } catch { }
    }
    st.textContent = `${burstShots.length}枚 取り込みました`;
  };
  $('#bDone').onclick = burstReview;
  $('#bStrip').onclick = e => { const k = e.target.dataset.k; if (k != null) recorrectShot(+k, renderBurstStrip); };

  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false });
  } catch {
    st.textContent = 'カメラが使えません。下の「写真をまとめて選ぶ」から取り込めます';
    $('#shutter').disabled = true;
    return;
  }
  if (!location.hash.startsWith('#burst')) { stopCamera(); return; }
  vid.srcObject = camStream;
  await vid.play().catch(() => { });

  const sc = document.createElement('canvas');
  sc.width = 64; sc.height = 48;
  const sx = sc.getContext('2d', { willReadFrequently: true });
  let prev = null, ref = null, lastSig = null, stillSince = 0, busy = false;

  const shoot = async () => {
    if (busy || vid.readyState < 2) return;
    busy = true;
    const f = $('#flash');
    f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
    try { await addShot(Imaging.toCanvas(vid, 2400)); } finally { busy = false; }
  };
  $('#shutter').onclick = () => { ref = lastSig; shoot(); };

  // 動き検出：動いている→止まった、かつ前回撮影時と見た目が違う、なら撮影
  burstTimer = setInterval(() => {
    if (vid.readyState < 2 || busy) return;
    const sig = Imaging.frameSig(vid, sx);
    const motion = prev ? Imaging.diff(sig, prev) : 99;
    prev = sig; lastSig = sig;
    const now = performance.now();
    if (motion > 5) { stillSince = 0; st.textContent = '✋ 作品を置いたら、手をどけてください'; return; }
    if (!stillSince) stillSince = now;
    const changed = !ref || Imaging.diff(sig, ref) > 14;
    if (!changed) { st.textContent = burstShots.length ? '✅ 撮れました。次の作品をどうぞ' : '作品をカメラの前に置いてください'; return; }
    if (!$('#autoT').checked) { st.textContent = '手動モード：📸ボタンで撮影'; return; }
    if (now - stillSince < 1200) { st.textContent = '⏳ そのまま…'; return; }
    if (Imaging.detectQuad(vid).ratio < 0.04) { ref = sig; st.textContent = '作品をカメラの前に置いてください'; return; }
    ref = sig; stillSince = 0;
    shoot();
  }, 150);
}

async function addShot(src) {
  const { quad } = Imaging.detectQuad(src);
  const out = quad ? Imaging.warp(src, quad, 1600) : Imaging.toCanvas(src, 1600);
  Imaging.enhance(out);
  const s = { orig: await Imaging.toBlob(src, 0.9), full: await Imaging.toBlob(out), thumb: await Imaging.toBlob(Imaging.toCanvas(out, 400)), title: '' };
  s.url = URL.createObjectURL(s.thumb);
  burstShots.push(s);
  renderBurstStrip();
}
function renderBurstStrip() {
  const el = $('#bStrip');
  if (!el) return;
  el.innerHTML = burstShots.map((s, k) => `<img src="${s.url}" data-k="${k}" alt="" title="タップで補正しなおす">`).join('');
  $('#camCount').textContent = burstShots.length + '枚';
  $('#bDone').disabled = !burstShots.length;
}
async function recorrectShot(k, after) {
  const s = burstShots[k];
  const r = await openCorrector(s.orig, 'art');
  if (!r) return;
  URL.revokeObjectURL(s.url);
  Object.assign(s, { full: r.full, thumb: r.thumb, url: URL.createObjectURL(r.thumb) });
  after();
}

function burstReview() {
  stopCamera();
  if (!burstShots.length) return;
  const render = () => {
    view().innerHTML = `<h1 class="page-title">まとめて整理（${burstShots.length}枚）</h1>
    <form id="bForm" class="form panel">
      <label>だれの？<select name="childId">${childOptions(defaultChild())}</select></label>
      <label>種類<select name="type">${Object.entries(TYPES).filter(([k]) => k !== 'word').map(([k, v]) => `<option value="${k}">${v.text || v.icon} ${v.label}</option>`).join('')}</select></label>
      <label>いつごろ？<input type="date" name="date" value="${today()}" required><span class="age-preview" id="agePrev"></span></label>
      <p class="hint">日付はだいたいでOK。あとから1枚ずつ直せます。</p>
      <label>現物は？<select name="status">
        <option value="keep">📦 手元に保管する</option><option value="jikka">🏠 実家へ送る</option><option value="released">🕊️ 写真だけ残して手放す（ありがとう儀式へ）</option></select></label>
      <label id="boxLbl">入れる箱<select name="boxId">${boxOptions(S.boxes[0]?.id || '')}</select></label>
    </form>
    <p class="hint">写真をタップすると切り抜きをやり直せます。</p>
    <div class="grid" id="bGrid">${burstShots.map((s, k) => `<div class="card"><div class="thumb"><img src="${s.url}" data-k="${k}" class="re" alt=""><button type="button" class="x" data-k="${k}" aria-label="削除">✕</button></div><input class="mini" data-k="${k}" placeholder="題名（任意）" value="${esc(s.title)}"></div>`).join('')}</div>
    <button class="btn primary wide" id="bSave">${burstShots.length}点をしまう</button>`;
    const form = $('#bForm');
    bindAgePreview(form);
    const st = form.querySelector('[name=status]');
    st.onchange = () => { $('#boxLbl').hidden = st.value !== 'keep'; };
    $$('#bGrid .x').forEach(b => {
      b.onclick = () => {
        const s = burstShots.splice(+b.dataset.k, 1)[0];
        URL.revokeObjectURL(s.url);
        burstShots.length ? render() : go('#burst');
      };
    });
    $$('#bGrid .re').forEach(im => { im.onclick = () => recorrectShot(+im.dataset.k, render); });
    $$('#bGrid input.mini').forEach(inp => { inp.oninput = () => { burstShots[+inp.dataset.k].title = inp.value; }; });
    $('#bSave').onclick = async () => {
      if (!form.reportValidity()) return;
      const f = new FormData(form);
      const status = f.get('status');
      const btn = $('#bSave');
      btn.disabled = true;
      const ids = [];
      for (const s of burstShots) {
        const it = {
          id: uid(), type: f.get('type'), childId: f.get('childId'), date: f.get('date'), title: s.title.trim(), memo: '',
          photos: [{ full: await putBlob(s.full), thumb: await putBlob(s.thumb) }],
          status: status === 'jikka' ? 'jikka' : 'keep', boxId: status === 'keep' ? (f.get('boxId') || '') : '', createdAt: Date.now(),
        };
        if (it.type === 'present') it.present = { occasion: '', message: '' };
        await saveItem(it);
        ids.push(it.id);
        btn.textContent = `保存中… ${ids.length}/${burstShots.length}`;
      }
      burstShots.forEach(s => URL.revokeObjectURL(s.url));
      burstShots = [];
      if (status === 'released') { S.ritualIds = ids; return go('#ritual/batch'); }
      toast(`${ids.length}点をしまいました`);
      go('#gallery');
    };
  };
  render();
}

// ---------- ありがとう儀式（アイデア①） ----------
async function ritual(id) {
  const ids = id === 'batch' ? S.ritualIds : [id];
  const its = ids.map(x => S.items.find(i => i.id === x)).filter(Boolean);
  if (!its.length) return go('#home');
  const names = [...new Set(its.map(i => childById(i.childId)?.name).filter(Boolean))].join('と');
  view().innerHTML = `<div class="ritual-stage" id="rs">
    <div class="frames">${its.slice(0, 6).map(i => `<div class="frame"><img data-blob="${i.photos?.[0]?.thumb || ''}" alt=""></div>`).join('')}${its.length > 6 ? `<div class="more">ほか${its.length - 6}点</div>` : ''}</div>
    <div class="r-text" id="rText"><h1>ありがとう、さようなら</h1>
      <p>${esc(names)}${names ? '、' : ''}${its.length > 1 ? 'この作品たち' : 'この作品'}に<br>「ありがとう」を言ってみよう</p></div>
    <div class="row center" id="rBtns"><button class="btn primary" id="rRec">🎙️ ありがとうを録音</button><button class="btn" id="rSkip">録音せずに進む</button></div>
  </div>`;
  hydrate(view());
  let thanks = null;
  const step2 = () => {
    $('#rText').innerHTML = `<h1>${thanks ? '🎙️ 声をしまいました' : 'じゅんびOK'}</h1><p>いっしょにボタンを押してね</p>`;
    $('#rBtns').innerHTML = `<button class="btn ritual big" id="rBye">🕊️ さようなら</button>`;
    $('#rBye').onclick = finish;
  };
  $('#rRec').onclick = async () => {
    const b = await recordModal('ありがとうを録音', '作品に向かって「ありがとう」を言ってね', 15);
    if (b) { thanks = await putBlob(b); step2(); }
  };
  $('#rSkip').onclick = step2;

  async function finish() {
    $('#rBtns').innerHTML = '';
    $('#rs').classList.add('fly');
    sparkle($('#rs'));
    for (const i of its) {
      i.status = 'released';
      i.releasedAt = today();
      i.boxId = '';
      if (thanks) i.thanksAudio = thanks;
      await saveItem(i);
    }
    setTimeout(() => {
      $('#rText').innerHTML = `<h1>🕊️</h1><p>思い出は、このアプリの中に<br>ずっと残っているよ</p>`;
      $('#rBtns').innerHTML = `<a class="btn primary" href="${its.length > 1 ? '#gallery' : '#item/' + its[0].id}">ギャラリーで見る</a>`;
    }, 2200);
  }
}
function sparkle(stage) {
  const marks = ['✨', '⭐', '💫', '🌟', '🕊️'];
  for (let k = 0; k < 24; k++) {
    const s = document.createElement('span');
    s.className = 'spark';
    s.textContent = marks[k % marks.length];
    s.style.left = Math.random() * 100 + '%';
    s.style.top = 40 + Math.random() * 50 + '%';
    s.style.animationDelay = Math.random() * 0.8 + 's';
    stage.appendChild(s);
    setTimeout(() => s.remove(), 3500);
  }
}

// ---------- ことば：名言帳・言い間違い辞典（アイデア⑨） ----------
const W = { tab: 'all' };
async function words(mode, id) {
  if (mode === 'new' || mode === 'edit') return wordForm(mode === 'edit' ? id : null);
  let list = visibleItems().filter(i => i.type === 'word');
  const mist = W.tab === 'mistake';
  if (mist) list = list.filter(i => i.word?.mistake).sort((a, b) => a.word.text.localeCompare(b.word.text, 'ja'));
  else list.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  view().innerHTML = `${childChips()}
  <div class="seg" id="wTabs"><button data-w="all" class="${mist ? '' : 'on'}">💬 名言帳</button><button data-w="mistake" class="${mist ? 'on' : ''}">📖 言い間違い辞典</button></div>
  <a class="btn primary wide" href="#words/new">＋ ことばを残す</a>
  ${!list.length ? `<div class="empty-card"><div class="empty-ic">${mist ? '📖' : '💬'}</div><p>${mist ? '「言い間違い」にチェックを付けたことばが、<br>ここに辞典のように並びます' : 'まだありません。<br>こどもの「今しか言わない言葉」を残しましょう'}</p></div>` :
    mist ? list.map(i => { const c = childById(i.childId); return `<a class="dict-row" href="#item/${i.id}"><span class="wrong">${esc(i.word.text)}</span><span class="arrow">→</span><span class="right">${esc(i.word.correct || '？')}</span><small>${esc(c?.name || '')}・${esc(ageLabel(c?.birth, i.date))}（${esc(i.date)}）</small></a>`; }).join('')
      : `<div class="word-list">${list.map(i => { const c = childById(i.childId); return `<a class="word-item" href="#item/${i.id}"><div class="quote">「${esc(i.word.text)}」</div>${i.memo ? `<div class="scene">${esc(i.memo)}</div>` : ''}<div class="meta">${esc(c?.name || '')}・${esc(itemAge(i))}・${esc(i.date)}${i.audio ? ' 🎙️' : ''}</div></a>`; }).join('')}</div>`}`;
  bindChildChips(() => words());
  $$('#wTabs button').forEach(b => { b.onclick = () => { W.tab = b.dataset.w; words(); }; });
}

function wordForm(id) {
  if (!S.children.length) return go('#home');
  const ex = id ? S.items.find(i => i.id === id) : null;
  const d = ex ? structuredClone(ex) : {
    id: uid(), type: 'word', childId: defaultChild(), date: today(), title: '', memo: '', photos: [],
    status: '', createdAt: Date.now(), word: { text: '', mistake: false, correct: '' },
  };
  d._removed = [];
  view().innerHTML = `<h1 class="page-title">💬 ことばを${ex ? '編集' : '残す'}</h1>
  <form id="wForm" class="form panel">
    <label>だれが言った？<select name="childId">${childOptions(d.childId)}</select></label>
    <label>いつ？<input type="date" name="date" value="${esc(d.date)}" required><span class="age-preview" id="agePrev"></span></label>
    <label>なんて言った？<textarea name="text" rows="3" required placeholder="例：おつきさま、ずっとついてくるね">${esc(d.word.text)}</textarea></label>
    <div class="row"><button type="button" class="btn" id="dict">🎤 音声で入力</button></div>
    <label class="check"><input type="checkbox" name="mistake" ${d.word.mistake ? 'checked' : ''}> 言い間違い・こども語（辞典に入れる）</label>
    <label id="corrLbl" ${d.word.mistake ? '' : 'hidden'}>正しくは？<input name="correct" value="${esc(d.word.correct || '')}" placeholder="例：とうもろこし"></label>
    <label>どんな場面で？<textarea name="memo" rows="2" placeholder="例：夜のドライブ中、窓の外を見て">${esc(d.memo)}</textarea></label>
    <div id="recRow"></div>
    <button class="btn primary wide">💾 保存</button>
  </form>`;
  const form = $('#wForm');
  bindAgePreview(form);
  renderRec(d, $('#recRow'), '本人の声');
  const mk = form.querySelector('[name=mistake]');
  mk.onchange = () => { $('#corrLbl').hidden = !mk.checked; };

  const btn = $('#dict'), ta = form.querySelector('[name=text]');
  btn.onclick = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast('このブラウザは音声入力に未対応です。キーボードのマイクボタンを使ってください', 4500); return; }
    if (recog) { recog.stop(); return; }
    const base = ta.value ? ta.value + ' ' : '';
    recog = new SR();
    recog.lang = 'ja-JP';
    recog.interimResults = true;
    recog.continuous = true;
    recog.onresult = ev => { let t = ''; for (let k = 0; k < ev.results.length; k++) t += ev.results[k][0].transcript; ta.value = base + t; };
    recog.onerror = ev => toast('音声入力エラー：' + ev.error);
    recog.onend = () => { recog = null; btn.textContent = '🎤 音声で入力'; btn.classList.remove('listening'); };
    recog.start();
    btn.textContent = '⏹ 聞いています…（押すと終了）';
    btn.classList.add('listening');
  };

  form.onsubmit = async e => {
    e.preventDefault();
    if (recog) recog.stop();
    const f = new FormData(form);
    d.childId = f.get('childId');
    d.date = f.get('date');
    d.word = { text: f.get('text').trim(), mistake: !!f.get('mistake'), correct: (f.get('correct') || '').trim() };
    d.memo = f.get('memo').trim();
    const removed = d._removed;
    delete d._removed;
    await saveItem(d);
    await gcBlobs(removed, S.items);
    toast('ことばを残しました');
    go('#words');
  };
}

// ---------- 現物の保管（アイデア②） ----------
async function boxes() {
  const things = S.items.filter(i => i.type !== 'word');
  const by = s => things.filter(i => i.status === s).length;
  const inBox = id => things.filter(i => i.boxId === id && i.status === 'keep').length;
  const noBox = things.filter(i => i.status === 'keep' && !i.boxId).length;
  view().innerHTML = `<h1 class="page-title">📦 現物の保管</h1>
  <section class="stats">
    <div><b>${by('keep')}</b><span>📦 手元</span></div><div><b>${by('jikka')}</b><span>🏠 実家</span></div><div><b>${by('released')}</b><span>🕊️ 手放した</span></div>
  </section>
  <section><h2>保管箱${S.boxes.length ? '<a class="btn small push" href="#labels">🏷️ QRラベルを印刷</a>' : ''}</h2>
    ${S.boxes.length ? S.boxes.map(b => `<a class="box-row" href="#box/${b.id}"><span class="box-ic">📦</span><div><b>${esc(b.name)}</b><small>${esc(b.location || '置き場所 未設定')}</small></div><span class="count">${inBox(b.id)}点</span></a>`).join('') : '<div class="empty-card"><div class="empty-ic">📦</div><p>まだ箱がありません。<br>箱を作ると、作品を「どの箱に入れたか」記録でき、<br>QRラベルを貼って中身をスマホで見られます。</p></div>'}
    ${noBox ? `<p class="hint">※ 箱が決まっていない保管品が ${noBox}点 あります（作品の画面で箱を選べます）</p>` : ''}
  </section>
  <form id="boxForm" class="form panel"><h2>箱を追加</h2>
    <label>名前<input name="name" value="箱${S.boxes.length + 1}" required></label>
    <label>置き場所<input name="location" placeholder="例：押し入れ上段・左"></label>
    <button class="btn primary wide">追加</button></form>`;
  $('#boxForm').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    await DB.put('boxes', { id: uid(), name: f.get('name').trim(), location: f.get('location').trim() });
    await loadAll();
    toast('箱を追加しました');
    boxes();
  };
}

async function box(id) {
  const b = S.boxes.find(x => x.id === id);
  if (!b) { view().innerHTML = '<p class="empty">この箱は見つかりません。<br>（別の端末で作った箱かもしれません）</p>'; return; }
  const its = S.items.filter(i => i.boxId === id && i.status === 'keep');
  view().innerHTML = `${backBtn()}<h1 class="page-title">📦 ${esc(b.name)}の中身</h1>
  <p class="hint">置き場所：${esc(b.location || '未設定')}</p>
  ${its.length ? `<div class="grid">${its.map(card).join('')}</div>` : '<p class="empty">この箱に入っている作品はまだありません</p>'}
  <form id="boxEdit" class="form panel"><h2>箱の情報</h2>
    <label>名前<input name="name" value="${esc(b.name)}" required></label>
    <label>置き場所<input name="location" value="${esc(b.location || '')}"></label>
    <div class="row"><button class="btn primary">保存</button><button type="button" class="btn danger" id="boxDel">箱を削除</button></div></form>`;
  hydrate(view());
  bindBack('#boxes');
  $('#boxEdit').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    await DB.put('boxes', { ...b, name: f.get('name').trim(), location: f.get('location').trim() });
    await loadAll();
    toast('保存しました');
    box(id);
  };
  $('#boxDel').onclick = async () => {
    if (!confirm(`「${b.name}」を削除しますか？（中の作品の記録は消えず、箱が「未設定」になります）`)) return;
    for (const i of S.items.filter(i => i.boxId === id)) { i.boxId = ''; await saveItem(i); }
    await DB.del('boxes', id);
    await loadAll();
    go('#boxes');
  };
}

function labels() {
  const base = location.href.split('#')[0];
  const local = /^(localhost|127\.|\[::1\])/.test(location.hostname) || location.protocol === 'file:';
  const qrSvg = text => {
    if (typeof qrcode === 'undefined') return '<p class="hint">QR部品を読み込めませんでした</p>';
    const q = qrcode(0, 'M');
    q.addData(text);
    q.make();
    return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  };
  view().innerHTML = `<div class="no-print"><h1 class="page-title">🏷️ 保管箱のQRラベル</h1>
    <p class="hint">印刷して箱に貼ってください。スマホでQRを読むと、その箱の中身一覧が開きます。</p>
    ${local ? '<p class="banner">⚠️ いまはパソコンの中（localhost）で開いているため、スマホでQRを読んでも開けません。アプリをネット上に公開してから印刷するのがおすすめです。</p>' : ''}
    <div class="row"><button class="btn primary" id="doPrint">🖨️ 印刷する</button><a class="btn" href="#boxes">戻る</a></div></div>
  <div class="labels">${S.boxes.map(b => `<div class="label"><div class="qr">${qrSvg(base + '#box/' + b.id)}</div><div><div class="l-name">${esc(b.name)}</div><div class="l-loc">${esc(b.location || '')}</div><div class="l-app">キッズギャラリー｜読み取ると中身が見られます</div></div></div>`).join('') || '<p class="empty">箱がありません</p>'}</div>`;
  $('#doPrint').onclick = () => print();
}

// ---------- 設定（メニュー → 各ページ）・書き出し（アイデア⑳） ----------
const SETTINGS_PAGES = {
  family: ['👨‍👩‍👧', '家族で共有'], notify: ['🔔', 'お知らせ'], children: ['👧', 'こども'],
  backup: ['💾', 'バックアップ・作品集'], about: ['ℹ️', 'このアプリについて'],
};
const menuRow = (href, ic, title, sub = '') => `<a class="menu-row" href="${href}"><span class="menu-ic">${ic}</span><span class="menu-txt"><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}</span><span class="chev" aria-hidden="true">›</span></a>`;
async function settings(sub) {
  await Cloud.ready?.(); // 古い cloud.js と混ざっても止まらないように
  if (sub && SETTINGS_PAGES[sub]) return settingsPage(sub);
  const last = (await DB.get('meta', 'lastBackup'))?.value;
  const cfg = Cloud.get();
  const pushOn = Cloud.enabled() && (await DB.get('meta', 'push'))?.value;
  view().innerHTML = `<h1 class="page-title">設定</h1>
  <nav class="menu">
    ${menuRow('#settings/family', '👨‍👩‍👧', '家族で共有', !Cloud.available() ? '準備中' : cfg ? `${esc(cfg.familyName)}・あなたは「${esc(cfg.memberName)}」` : 'まだつながっていません')}
    ${menuRow('#settings/notify', '🔔', 'お知らせ', pushOn ? 'この端末で受け取っています' : '家族が作品をしまったら、通知でお知らせ')}
    ${menuRow('#settings/children', '👧', 'こども', S.children.map(c => esc(c.name)).join('・') || 'まだ登録していません')}
  </nav>
  <nav class="menu">
    ${menuRow('#settings/backup', '💾', 'バックアップ・作品集', last ? '前回の書き出し ' + new Date(last).toLocaleDateString('ja-JP') : 'まだ一度も書き出していません')}
    ${isStandalone() ? '' : `<button type="button" class="menu-row" id="mInstall"><span class="menu-ic">📲</span><span class="menu-txt"><b>ホーム画面に追加</b><small>アイコンから、すぐ開けるように</small></span><span class="chev" aria-hidden="true">›</span></button>`}
  </nav>
  <nav class="menu">
    ${menuRow('#help', '❓', '使い方', 'はじめての方・こまったときに')}
    ${menuRow('#settings/about', 'ℹ️', 'このアプリについて', `バージョン ${APP_VERSION}`)}
  </nav>`;
  const mi = $('#mInstall');
  if (mi) mi.onclick = installGuide;
}
const backLink = (href = '#settings', label = '設定') => `<a class="back" href="${href}">‹ ${label}</a>`;
async function settingsPage(sub) {
  const [ic, title] = SETTINGS_PAGES[sub];
  const head = `${backLink()}<h1 class="page-title">${ic} ${title}</h1>`;
  const t = today();
  if (sub === 'family') { view().innerHTML = head + '<div id="cloudPanel"></div>'; return cloudPanel(); }
  if (sub === 'notify') { view().innerHTML = head + '<section class="panel" id="notifyPanel"></section>'; return notifyPanel(); }
  if (sub === 'children') {
    view().innerHTML = head + `<section class="panel">
      ${S.children.length ? S.children.map(c => `<div class="child-row"><span class="dot" style="background:${c.color}"></span><span class="grow"><b>${esc(c.name)}</b><small>${esc(c.birth)}（いま ${ageLabel(c.birth, t)}・${gradeLabel(c.birth, t)}）</small></span><button class="btn small" data-edit="${c.id}">編集</button></div>`).join('') : '<p class="empty">まだ登録していません</p>'}
      <button class="btn primary wide" id="addChild">＋ こどもを追加</button>
      <p class="hint">誕生日を入れると、作品に「4歳3か月・年中」のような年齢と学年が自動で付きます。</p></section>`;
    $$('[data-edit]').forEach(b => {
      b.onclick = () => {
        const c = childById(b.dataset.edit);
        const used = S.items.some(i => i.childId === c.id);
        openModal(`<h2>${esc(c.name)}を編集</h2>${childFormHTML(c)}<div class="row">${used ? '' : '<button class="btn danger small" id="cDel">このこどもを削除</button>'}<button class="btn small" id="cClose">閉じる</button></div>`);
        bindChildForm(c, () => { closeModal(); settingsPage('children'); });
        $('#cClose').onclick = closeModal;
        const del = $('#cDel');
        if (del) del.onclick = async () => { await DB.del('children', c.id); await loadAll(); closeModal(); settingsPage('children'); };
      };
    });
    $('#addChild').onclick = () => {
      openModal(`<h2>こどもを追加</h2>${childFormHTML()}<button class="btn small" id="cClose">閉じる</button>`);
      bindChildForm(null, () => { closeModal(); settingsPage('children'); });
      $('#cClose').onclick = closeModal;
    };
    return;
  }
  if (sub === 'backup') {
    const est = await navigator.storage?.estimate?.().catch(() => null);
    const last = (await DB.get('meta', 'lastBackup'))?.value;
    view().innerHTML = head + `<section class="panel"><h2>💾 まるごと書き出し</h2>
      <p>アプリがなくなっても、スマホを替えても思い出が残るように、<b>ふつうの写真フォルダ</b>の形でまるごと書き出せます。</p>
      <p class="hint">前回の書き出し：${last ? new Date(last).toLocaleDateString('ja-JP') : 'まだありません'}${est ? `　／　使用容量 約${(est.usage / 1048576).toFixed(1)}MB` : ''}</p>
      <button class="btn primary wide" id="exp">📦 まるごと書き出す（ZIP）</button>
      <label class="btn wide">♻️ 書き出したZIPから復元<input type="file" accept=".zip,application/zip" id="imp" hidden></label>
      <p class="hint">ZIPの中身：こどもごと・年度ごとのフォルダに分けた写真／ことば一覧（テキスト）／声の録音／復元用データ。パソコンでもそのまま開いて見られます。</p></section>
    <section class="panel"><h2>📕 作品集（ART BOOK）</h2>
      <p class="hint">作品を自動でレイアウトして、PDFで保存・印刷できます。</p>
      <a class="btn wide" href="#book">📕 作品集をつくる</a></section>`;
    $('#exp').onclick = exportZip;
    $('#imp').onchange = e => { if (e.target.files[0]) importZip(e.target.files[0]); };
    return;
  }
  // about
  view().innerHTML = head + `<section class="panel about">
    <div class="about-head"><img src="icon-192.png" alt="" width="56" height="56"><div><b>キッズギャラリー</b><small>バージョン ${APP_VERSION}（${APP_VERSION_DATE}）</small></div></div>
    <p class="hint">${Cloud.enabled()
      ? 'データは、この端末と、家族で共有しているクラウドの両方に保存されます。それでも、ときどき「まるごと書き出し」でバックアップしておくと安心です。'
      : 'データはこの端末のブラウザの中だけに保存されます（サーバーには送られません）。ブラウザのデータを消すと思い出も消えるので、定期的に書き出してください。'}</p></section>
  <section class="panel"><h3>アプリを新しくしても、作品は消えません</h3>
    <p class="hint">見た目の変更や、機能の追加・変更があっても、保存してある作品・ことば・こどもの記録はそのまま使えます。データはアプリ本体とは別の場所に保存されているためです。</p>
    <h3>消えてしまうのは、こんなとき</h3>
    <ul class="hint">
      <li>ブラウザの「サイトデータ」を消したとき、ホーム画面のアイコンを削除したとき</li>
      <li>アプリを開くアドレス（URL）が変わったとき（新しいアドレスでは空から始まります）</li>
    </ul>
    <p class="hint">どちらも、家族共有をつなぐか「まるごと書き出し」をしておけば、元に戻せます。</p>
    <h3>アドレスから開くときと、ホーム画面のアイコンから開くとき</h3>
    <ul class="hint">
      <li><b>Android・パソコン：</b>どちらから開いても同じデータです。</li>
      <li><b>iPhone・iPad：</b>Safariで開いたときと、ホーム画面のアイコンから開いたときで、データは<b>別々</b>です。ふだんはどちらか一方だけで使ってください。</li>
      <li>両方で見たいときは、どちらでも「家族共有」をつなぐと、同じ内容にそろいます。</li>
      <li>同じ人の端末は、「家族で共有」の<b>「別の端末を追加」</b>のコードやQRで、招待をもらいなおさずに追加できます。</li>
    </ul>
    <h3>家族共有のしくみ</h3>
    <ul class="hint">
      <li>変更は自動でクラウドに送られ、家族の変更も自動で届きます（アプリを開いたときや、ネットにつながったとき、1分ごと）。</li>
      <li>圏外でも使えます。つながると自動でそろいます。</li>
      <li>同じ作品を別々の端末で直したときは、<b>あとから直した方</b>が残ります。</li>
      <li>写真と声は、必要なときにクラウドから取り寄せます。</li>
    </ul></section>`;
}

const safe = s => String(s || '').replace(/[\\/:*?"<>|\r\n\t]/g, '_').trim().slice(0, 40);
const audioExt = b => (/mp4|m4a|aac/.test(b.type) ? 'm4a' : /ogg/.test(b.type) ? 'ogg' : 'webm');
const audioType = p => (p.endsWith('.m4a') ? 'audio/mp4' : p.endsWith('.ogg') ? 'audio/ogg' : 'audio/webm');
const README = `キッズギャラリー 書き出しデータ

・こどもの名前のフォルダ → 年度のフォルダの中に、作品の写真が入っています。
  ファイル名は「日付_種類_題名_番号.jpg」です。
・「ことば.txt」には、名言帳と言い間違い辞典の内容が入っています。
・「声の録音」フォルダには、本人の解説・ことばの声・ありがとうの声が入っています。
・「_復元用データ.json」は、アプリに戻すためのデータです。消さないでください。

アプリの「設定 → 書き出したZIPから復元」で、このZIPをそのまま読み込めます。
`;

async function exportZip() {
  if (typeof JSZip === 'undefined') return toast('書き出し部品を読み込めませんでした（ネット接続を確認）', 4000);
  const btn = $('#exp');
  btn.disabled = true;
  try {
    const zip = new JSZip();
    const top = 'キッズギャラリー';
    const data = { app: 'kids-gallery', version: 1, exportedAt: new Date().toISOString(), children: S.children, boxes: S.boxes, items: [] };
    const used = new Set();
    const uniq = p => { let q = p, n = 2; while (used.has(q)) q = p.replace(/(\.\w+)$/, `_${n++}$1`); used.add(q); return q; };
    const getB = async id => (await getBlobRec(id))?.blob;
    let n = 0;
    for (const i of S.items) {
      btn.textContent = `書き出し中… ${++n}/${S.items.length}`;
      const c = childById(i.childId);
      const cdir = `${top}/${safe(c?.name) || '未設定'}`;
      const fy = i.date ? fiscalYear(i.date) + '年度' : '日付なし';
      const name = [i.date || '日付なし', TYPES[i.type].label, safe(i.title || (i.type === 'word' ? i.word.text : ''))].filter(Boolean).join('_');
      const rec = { ...i, files: { photos: [], audio: null, thanksAudio: null } };
      delete rec.photos; delete rec.audio; delete rec.thanksAudio;
      for (const [k, p] of (i.photos || []).entries()) {
        const b = await getB(p.full);
        if (!b) continue;
        const path = uniq(`${cdir}/${fy}/${name}_${k + 1}.jpg`);
        zip.file(path, b);
        rec.files.photos.push(path);
      }
      for (const key of ['audio', 'thanksAudio']) {
        if (!i[key]) continue;
        const b = await getB(i[key]);
        if (!b) continue;
        const path = uniq(`${cdir}/声の録音/${name}_${key === 'audio' ? '声' : 'ありがとう'}.${audioExt(b)}`);
        zip.file(path, b);
        rec.files[key] = path;
      }
      data.items.push(rec);
    }
    for (const c of S.children) {
      const ws = S.items.filter(i => i.childId === c.id && i.type === 'word').sort((a, b) => a.date.localeCompare(b.date));
      if (!ws.length) continue;
      const lines = ws.map(w => `${w.date}（${ageLabel(c.birth, w.date)}）「${w.word.text}」${w.word.mistake && w.word.correct ? `　→ 正しくは「${w.word.correct}」` : ''}${w.memo ? `\n　場面：${w.memo}` : ''}`);
      zip.file(`${top}/${safe(c.name)}/ことば.txt`, `${c.name}のことば\n\n` + lines.join('\n'));
    }
    zip.file(`${top}/_復元用データ.json`, JSON.stringify(data, null, 1));
    zip.file(`${top}/はじめにお読みください.txt`, README);
    btn.textContent = 'ZIPを作成中…';
    const blob = await zip.generateAsync({ type: 'blob' });
    download(blob, `キッズギャラリー_${today()}.zip`);
    await DB.put('meta', { id: 'lastBackup', value: Date.now() });
    toast('書き出しました');
  } catch (err) {
    toast('書き出しに失敗しました：' + err.message, 5000);
  }
  settings();
}

async function importZip(file) {
  if (typeof JSZip === 'undefined') return toast('部品を読み込めませんでした（ネット接続を確認）');
  let zip, data, jf;
  try {
    zip = await JSZip.loadAsync(file);
    jf = Object.values(zip.files).find(f => f.name.endsWith('_復元用データ.json'));
    if (!jf) return toast('復元用データが見つかりません', 4000);
    data = JSON.parse(await jf.async('string'));
  } catch { return toast('ZIPを読み込めませんでした', 4000); }
  if (!confirm(`${data.items.length}件の思い出を復元します。\nいまこのアプリにあるデータは置き換わります。よろしいですか？`)) return;
  for (const s of ['children', 'items', 'boxes', 'blobs']) await DB.clear(s);
  urlCache.forEach(u => URL.revokeObjectURL(u));
  urlCache.clear();
  for (const c of data.children) await DB.put('children', c);
  for (const b of data.boxes) await DB.put('boxes', b);
  let n = 0;
  for (const r of data.items) {
    const it = { ...r, photos: [] };
    delete it.files;
    for (const p of r.files?.photos || []) {
      const f = zip.file(p);
      if (!f) continue;
      const jb = new Blob([await f.async('blob')], { type: 'image/jpeg' });
      const th = await Imaging.toBlob(Imaging.toCanvas(await Imaging.loadImage(jb), 400));
      it.photos.push({ full: await putBlob(jb), thumb: await putBlob(th) });
    }
    for (const key of ['audio', 'thanksAudio']) {
      const p = r.files?.[key];
      const f = p && zip.file(p);
      if (f) it[key] = await putBlob(new Blob([await f.async('blob')], { type: audioType(p) }));
    }
    await DB.put('items', it);
    toast(`復元中… ${++n}/${data.items.length}`, 60000);
  }
  await loadAll();
  toast('復元しました');
  go('#home');
}

// ---------- 作品集 ART BOOK（自動レイアウト→印刷 / PDF） ----------
const B = { child: null, fy: 'all', sel: null, cover: null, size: 'A4', finish: 'standard', per: 'auto', words: true };
const PAGE_MM = { A4: [210, 297], A5: [148, 210] };

function bookPool(cid) {
  const all = S.items.filter(i => i.childId === cid && i.type !== 'word' && i.photos?.length)
    .sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.createdAt - b.createdAt);
  const fyOf = i => (i.date ? fiscalYear(i.date) : 0);
  const years = [...new Set(all.map(fyOf))].sort();
  return { all, years, pool: all.filter(i => B.fy === 'all' || fyOf(i) === +B.fy), fyOf };
}

async function book(childId) {
  if (!S.children.length) return go('#home');
  const cid = childId && childById(childId) ? childId
    : (B.child && childById(B.child) ? B.child : (S.filterChild !== 'all' ? S.filterChild : S.children[0].id));
  if (B.child !== cid) Object.assign(B, { child: cid, fy: 'all', sel: null, cover: null });
  const c = childById(cid);
  const { all, years, pool } = bookPool(cid);
  if (!B.sel) B.sel = new Set(pool.map(i => i.id));
  const chosen = () => pool.filter(i => B.sel.has(i.id));
  const opt = (key, val, label) => `<button type="button" class="${B[key] === val ? 'on' : ''}" data-k="${key}" data-v="${val}">${label}</button>`;

  view().innerHTML = `<div class="no-print">
    <h1 class="page-title">📕 作品集（ART BOOK）</h1>
    ${S.children.length > 1 ? `<div class="chips">${S.children.map(x => `<a class="chip ${x.id === cid ? 'on' : ''}" style="--cc:${x.color}" href="#book/${x.id}">${esc(x.name)}</a>`).join('')}</div>` : ''}
    ${!all.length ? `<p class="empty">${esc(c.name)}の、写真つきの作品がまだありません。<br>作品をしまうと、ここで自動で作品集になります。</p>` : `
    <section class="panel"><h2>① しあげ</h2>
      <div class="opt"><span>サイズ</span><div class="seg" data-g="opt">${opt('size', 'A4', 'A4（大きめ）')}${opt('size', 'A5', 'A5（持ち運び）')}</div></div>
      <div class="opt"><span>しあげ</span><div class="seg" data-g="opt">${opt('finish', 'standard', 'スタンダード')}${opt('finish', 'premium', '✨プレミアム')}</div></div>
      <div class="opt"><span>1ページの作品数</span><div class="seg" data-g="opt">${opt('per', 'auto', 'おまかせ')}${opt('per', '1', '1点')}${opt('per', '2', '2点')}${opt('per', '4', '4点')}</div></div>
      ${years.length > 1 ? `<div class="opt"><span>年度</span><div class="seg wrap" data-g="fy"><button type="button" class="${B.fy === 'all' ? 'on' : ''}" data-v="all">ぜんぶ</button>${years.map(y => `<button type="button" class="${String(B.fy) === String(y) ? 'on' : ''}" data-v="${y}">${y ? y + '年度' : '日付なし'}</button>`).join('')}</div></div>` : ''}
      <label class="check"><input type="checkbox" id="bWords" ${B.words ? 'checked' : ''}> 「ことば集」のページも入れる</label>
    </section>
    <section class="panel"><h2>② のせる作品 <small id="bCount"></small></h2>
      <p class="hint">タップで入れる／はずす。<b>⭐</b>を押した作品が表紙になります。</p>
      <div class="pick-grid" id="pickGrid">${pool.map(i => `<div class="pick ${B.sel.has(i.id) ? 'on' : ''}" data-id="${i.id}"><img data-blob="${i.photos[0].thumb}" alt=""><span class="ck">✓</span><button type="button" class="star" data-id="${i.id}" aria-label="表紙にする">⭐</button></div>`).join('')}</div>
      <div class="row"><button class="btn small" id="pickAll">ぜんぶ選ぶ</button><button class="btn small" id="pickNone">ぜんぶはずす</button></div>
    </section>
    <section class="panel"><h2>③ できあがり <small id="bPages"></small></h2>
      <p class="hint">下のプレビューを確認して、「印刷 / PDFに保存」を押してください。表示された画面で送信先を<b>「PDFに保存」</b>にするとPDFになります。<br>
      ※ 余白は「なし」、倍率は「100％」にするときれいです。製本の注文機能はまだなく、PDFを印刷所やコンビニ印刷に持ち込む使い方です。</p>
      <button class="btn primary wide" id="doPrint">🖨️ 印刷 / PDFに保存</button></section>`}
  </div>
  <div class="book-pages" id="bookPages"></div>`;
  if (!all.length) return;
  hydrate(view());

  const upd = () => {
    $('#bCount').textContent = `${chosen().length} / ${pool.length}点`;
    renderBookPages(c, chosen());
  };
  upd();
  $$('[data-g=opt] button').forEach(b => { b.onclick = () => { B[b.dataset.k] = b.dataset.v; book(cid); }; });
  $$('[data-g=fy] button').forEach(b => { b.onclick = () => { B.fy = b.dataset.v; B.sel = null; B.cover = null; book(cid); }; });
  $('#bWords')?.addEventListener('change', e => { B.words = e.target.checked; upd(); });
  $('#pickGrid').onclick = e => {
    const star = e.target.closest('.star');
    const cell = e.target.closest('.pick');
    if (!cell) return;
    const id = cell.dataset.id;
    if (star) {
      B.cover = id;
      B.sel.add(id);
      cell.classList.add('on');
      $$('.pick .star').forEach(s => s.classList.toggle('on', s.dataset.id === id));
      toast('表紙にしました');
    } else {
      B.sel.has(id) ? B.sel.delete(id) : B.sel.add(id);
      cell.classList.toggle('on', B.sel.has(id));
    }
    upd();
  };
  $$('.pick .star').forEach(s => s.classList.toggle('on', s.dataset.id === B.cover));
  $('#pickAll').onclick = () => { pool.forEach(i => B.sel.add(i.id)); $$('.pick').forEach(p => p.classList.add('on')); upd(); };
  $('#pickNone').onclick = () => { B.sel.clear(); $$('.pick').forEach(p => p.classList.remove('on')); upd(); };
  $('#doPrint').onclick = async () => {
    if (!chosen().length) return toast('作品を1点以上えらんでください');
    await DB.put('meta', { id: 'bookMade:' + cid, value: all.length });
    print();
  };
}

function renderBookPages(c, items) {
  const host = $('#bookPages');
  const [pw, ph] = PAGE_MM[B.size];
  let st = $('#pageStyle');
  if (!st) { st = document.createElement('style'); st.id = 'pageStyle'; document.head.appendChild(st); }
  st.textContent = `@page { size: ${B.size}; margin: 0; }`;
  const zoom = Math.min(1, (Math.min(window.innerWidth, 720) - 32) / (pw * 3.7795));
  host.style.setProperty('--z', zoom);
  host.style.setProperty('--pw', pw + 'mm');
  host.style.setProperty('--ph', ph + 'mm');
  if (!items.length) { host.innerHTML = '<p class="empty no-print">作品が選ばれていません</p>'; $('#bPages').textContent = ''; return; }

  const fyOf = i => (i.date ? fiscalYear(i.date) : 0);
  const per = B.per === 'auto' ? (items.length <= 6 ? 1 : items.length <= 24 ? 2 : 4) : +B.per;
  const cover = items.find(i => i.id === B.cover) || items[0];
  const prem = B.finish === 'premium';
  const pg = (cls, inner) => `<section class="pg ${B.size} ${prem ? 'premium' : ''} ${cls}">${inner}</section>`;
  const range = `${items[0].date || ''} 〜 ${items[items.length - 1].date || ''}`;
  const pages = [];

  pages.push(pg('p-cover', `<div class="cv-art">${`<img data-blob="${cover.photos[0].full}" alt="">`}</div>
    <h1>${esc(c.name)}の作品集</h1><p>${esc(range)}　${items.length}点</p>`));

  const groups = new Map();
  for (const i of items) { const k = fyOf(i); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); }
  const chapters = groups.size > 1 || prem;
  for (const [fy, list] of groups) {
    if (chapters) {
      pages.push(pg('p-chapter', `<div><small>${fy ? esc(gradeLabel(c.birth, fy + '-10-01')) : ''}</small><h2>${fy ? fy + '年度' : '日付なし'}</h2><p>${list.length}点</p></div>`));
    }
    for (let k = 0; k < list.length; k += per) {
      const chunk = list.slice(k, k + per);
      pages.push(pg(`p-works per${per}`, chunk.map(i => `<figure><div class="fig-img"><img data-blob="${i.photos[0].full}" alt=""></div>
        <figcaption><b>${esc(i.title || TYPES[i.type].label)}</b><span>${esc(i.date || '')}　${esc(ageLabel(c.birth, i.date))}${gradeLabel(c.birth, i.date) ? '・' + esc(gradeLabel(c.birth, i.date)) : ''}</span>
        ${i.type === 'present' && (i.present?.occasion || i.present?.message) ? `<em>${esc(i.present.occasion || '')}${i.present.message ? '「' + esc(i.present.message) + '」' : ''}</em>` : ''}
        ${i.memo ? `<span class="memo">${esc(i.memo)}</span>` : ''}</figcaption></figure>`).join('')));
    }
  }

  if (B.words) {
    const inRange = i => B.fy === 'all' || fyOf(i) === +B.fy;
    const ws = S.items.filter(i => i.childId === c.id && i.type === 'word' && inRange(i)).sort((a, b) => a.date.localeCompare(b.date));
    for (let k = 0; k < ws.length; k += 8) {
      pages.push(pg('p-words', `${k === 0 ? '<h2>ことば集</h2>' : ''}` + ws.slice(k, k + 8).map(w => `<div class="w"><q>${esc(w.word.text)}</q><small>${esc(w.date)}　${esc(ageLabel(c.birth, w.date))}${w.word.mistake && w.word.correct ? '　→ 正しくは「' + esc(w.word.correct) + '」' : ''}</small></div>`).join('')));
    }
  }

  // 製本しやすいよう、奥付を含めたページ数を4の倍数に（足りない分は書き込める「メモ」ページ）
  while ((pages.length + 1) % 4) pages.push(pg('p-memo', '<div class="memo-lines"><p>ここに、思い出を書き込めます</p></div>'));
  pages.push(pg('p-back', `<div><p>${esc(c.name)}の作品集</p><small>作品 ${items.length}点　${esc(today())} 作成</small><small>キッズギャラリー</small></div>`));

  host.innerHTML = pages.join('');
  hydrate(host);
  $('#bPages').textContent = `全${pages.length}ページ`;
}

// ---------- グッズのイメージ（背景切り抜き） ----------
const GOODS = {
  tshirt: { label: '👕 Tシャツ', colors: ['#ffffff', '#f7d9d2', '#cfe6f5', '#dcefd0', '#fbe9b0', '#2d3a4f'] },
  case: { label: '📱 スマホケース', colors: ['#ffffff', '#f7d9d2', '#cfe6f5', '#d9cdf0', '#2d3a4f'] },
  tote: { label: '👜 トートバッグ', colors: ['#f3ead8', '#ffffff', '#e8c6c0', '#b9d3c2', '#2d3a4f'] },
  key: { label: '🔑 アクリルキーホルダー', colors: [] },
};
const GS = { kind: 'tshirt', color: {}, thr: 60, photo: 0 };
const cutCache = new Map();

async function cutFor(photoId, thr) {
  const k = photoId + ':' + thr;
  if (cutCache.has(k)) return cutCache.get(k);
  const r = await getBlobRec(photoId);
  if (!r) return null;
  const out = Imaging.cutout(await Imaging.loadImage(r.blob), thr);
  cutCache.clear();
  cutCache.set(k, out);
  return out;
}

async function goods(id) {
  const i = S.items.find(x => x.id === id);
  if (!i || !i.photos?.length) return go('#gallery');
  if (GS.id !== id) Object.assign(GS, { id, photo: 0 });
  const ph = i.photos[Math.min(GS.photo, i.photos.length - 1)];
  const g = GOODS[GS.kind];
  const col = GS.color[GS.kind] || g.colors[0];
  view().innerHTML = `<h1 class="page-title">🎁 グッズのイメージ</h1>
  <p class="hint">背景を切り抜いて、絵の部分だけをグッズにのせたイメージです（実際の注文はまだできません）。</p>
  ${i.photos.length > 1 ? `<div class="photo-strip" id="gPhotos">${i.photos.map((p, k) => `<div class="ph-item ${k === GS.photo ? 'sel' : ''}" data-k="${k}"><img data-blob="${p.thumb}" alt=""></div>`).join('')}</div>` : ''}
  <div class="seg wrap" id="gKinds">${Object.entries(GOODS).map(([k, v]) => `<button class="${GS.kind === k ? 'on' : ''}" data-k="${k}">${v.label}</button>`).join('')}</div>
  <div class="goods-stage"><canvas id="gCanvas" width="800" height="800"></canvas><div class="busy" id="gBusy">切り抜き中…</div></div>
  ${g.colors.length ? `<div class="swatches" id="gColors">${g.colors.map(cl => `<button type="button" class="${cl === col ? 'on' : ''}" data-c="${cl}" style="background:${cl}" aria-label="色"></button>`).join('')}</div>` : ''}
  <div class="sliders"><label>✂️ 切り抜きの強さ <input type="range" id="gThr" min="25" max="140" value="${GS.thr}"><output id="oThr">${GS.thr}</output></label>
    <p class="hint">背景が残るときは右へ、絵が欠けるときは左へ動かします。</p></div>
  <div class="row"><button class="btn primary" id="gSave">🖼️ このイメージを保存</button><button class="btn" id="gPng">✂️ 切り抜き画像（透明PNG）を保存</button></div>
  <a class="btn wide" href="#item/${i.id}">← 作品にもどる</a>`;
  hydrate(view());

  let token = 0;
  const draw = async () => {
    const my = ++token;
    $('#gBusy').hidden = false;
    await new Promise(r => setTimeout(r, 20));
    const art = await cutFor(ph.full, GS.thr);
    if (my !== token) return;
    $('#gBusy').hidden = true;
    if (!art) { toast('切り抜けませんでした。切り抜きの強さを下げてください', 4000); return; }
    drawGoods($('#gCanvas'), art, GS.kind, GS.color[GS.kind] || GOODS[GS.kind].colors[0]);
  };
  $$('#gPhotos .ph-item').forEach(el => { el.onclick = () => { GS.photo = +el.dataset.k; goods(id); }; });
  $$('#gKinds button').forEach(b => { b.onclick = () => { GS.kind = b.dataset.k; goods(id); }; });
  $$('#gColors button').forEach(b => { b.onclick = () => { GS.color[GS.kind] = b.dataset.c; goods(id); }; });
  const thr = $('#gThr');
  let t;
  thr.oninput = () => { $('#oThr').textContent = thr.value; clearTimeout(t); t = setTimeout(() => { GS.thr = +thr.value; draw(); }, 250); };
  $('#gSave').onclick = () => $('#gCanvas').toBlob(b => download(b, `グッズイメージ_${GS.kind}_${today()}.png`), 'image/png');
  $('#gPng').onclick = async () => {
    const art = await cutFor(ph.full, GS.thr);
    if (!art) return toast('切り抜けませんでした');
    art.toBlob(b => download(b, `切り抜き_${safe(i.title) || 'さくひん'}_${today()}.png`), 'image/png');
  };
  draw();
}

function fitDraw(ctx, art, cx, cy, bw, bh) {
  const s = Math.min(bw / art.width, bh / art.height);
  const w = art.width * s, h = art.height * s;
  ctx.drawImage(art, cx - w / 2, cy - h / 2, w, h);
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

function drawGoods(cv, art, kind, color) {
  const ctx = cv.getContext('2d');
  ctx.setTransform(2, 0, 0, 2, 0, 0); // 400x400 の座標で描く
  ctx.clearRect(0, 0, 400, 400);
  const bg = ctx.createLinearGradient(0, 0, 0, 400);
  bg.addColorStop(0, '#fbf3e8'); bg.addColorStop(1, '#efe3d3');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 400, 400);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.shadowColor = 'rgba(80,50,20,.22)';
  const base = (draw) => { ctx.shadowBlur = 14; ctx.shadowOffsetY = 6; draw(); ctx.shadowBlur = 0; ctx.shadowOffsetY = 0; };

  if (kind === 'tshirt') {
    const p = new Path2D('M130 44 L58 74 L18 152 L74 178 L96 142 L96 362 L304 362 L304 142 L326 178 L382 152 L342 74 L270 44 Q200 90 130 44 Z');
    base(() => { ctx.fillStyle = color; ctx.fill(p); });
    ctx.strokeStyle = 'rgba(0,0,0,.2)'; ctx.lineWidth = 2; ctx.stroke(p);
    ctx.beginPath(); ctx.moveTo(130, 44); ctx.quadraticCurveTo(200, 90, 270, 44); ctx.stroke();
    fitDraw(ctx, art, 200, 215, 150, 170);
  } else if (kind === 'case') {
    const rr = new Path2D(); rr.roundRect(126, 26, 148, 348, 30);
    base(() => { ctx.fillStyle = color; ctx.fill(rr); });
    ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 3; ctx.stroke(rr);
    fitDraw(ctx, art, 200, 240, 118, 210);
    const cam = new Path2D(); cam.roundRect(138, 38, 58, 58, 14);
    ctx.fillStyle = 'rgba(30,30,30,.88)'; ctx.fill(cam);
    ctx.fillStyle = '#555';
    for (const [x, y] of [[154, 54], [180, 54], [154, 80], [180, 80]]) { ctx.beginPath(); ctx.arc(x, y, 8, 0, 7); ctx.fill(); }
  } else if (kind === 'tote') {
    ctx.strokeStyle = color === '#ffffff' ? '#d9d2c4' : color; ctx.lineWidth = 12;
    ctx.beginPath(); ctx.moveTo(150, 140); ctx.bezierCurveTo(150, 40, 250, 40, 250, 140); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,.15)'; ctx.lineWidth = 1.5; ctx.stroke();
    base(() => { ctx.fillStyle = color; ctx.fillRect(86, 130, 228, 240); });
    ctx.strokeStyle = 'rgba(0,0,0,.2)'; ctx.lineWidth = 2; ctx.strokeRect(86, 130, 228, 240);
    fitDraw(ctx, art, 200, 252, 160, 180);
  } else {
    // アクリルキーホルダー：白いふちを付けた切り抜き
    const s = Math.min(230 / art.width, 250 / art.height);
    const w = Math.max(1, Math.round(art.width * s)), h = Math.max(1, Math.round(art.height * s));
    const pad = 22;
    const tmp = document.createElement('canvas');
    tmp.width = w + pad * 2; tmp.height = h + pad * 2;
    const t = tmp.getContext('2d');
    const sil = document.createElement('canvas');
    sil.width = w; sil.height = h;
    const sx = sil.getContext('2d');
    sx.drawImage(art, 0, 0, w, h);
    sx.globalCompositeOperation = 'source-in';
    sx.fillStyle = '#fff'; sx.fillRect(0, 0, w, h);
    for (const R of [12, 8, 4]) for (let a = 0; a < 32; a++) t.drawImage(sil, pad + Math.cos(a / 32 * 6.2832) * R, pad + Math.sin(a / 32 * 6.2832) * R);
    t.drawImage(art, pad, pad, w, h);
    const x0 = 200 - tmp.width / 2, y0 = 214 - tmp.height / 2;
    ctx.shadowBlur = 14; ctx.shadowOffsetY = 6;
    ctx.drawImage(tmp, x0, y0);
    ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    // 輪っかは、切り抜きのいちばん上の点（その行の横の中心）に付ける
    const td = t.getImageData(0, 0, tmp.width, tmp.height).data;
    let topY = 0, topX = tmp.width / 2;
    find: for (let y = 0; y < tmp.height; y++) {
      let sum = 0, cnt = 0;
      for (let x = 0; x < tmp.width; x++) if (td[(y * tmp.width + x) * 4 + 3] > 128) { sum += x; cnt++; }
      if (cnt) { topY = y; topX = sum / cnt; break find; }
    }
    const rx = x0 + topX, ry = y0 + topY;
    ctx.strokeStyle = '#9aa0a6'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(rx, ry - 4, 15, 0, 7); ctx.stroke();
    ctx.strokeStyle = '#c9cdd1'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(rx, ry - 4, 10, 0, 7); ctx.stroke();
  }
}

// ---------- 家族で共有（クラウド同期） ----------
const fmtMB = b => (b / 1048576 < 10 ? (b / 1048576).toFixed(1) : Math.round(b / 1048576)) + 'MB';
const CLOUD_STATE = {
  off: ['', ''], idle: ['☁️', '共有中'], syncing: ['🔄', '同期中'], ok: ['☁️', '同期ずみ'],
  offline: ['📴', 'オフライン'], error: ['⚠️', '同期できません'],
};
function updateBadge() {
  const b = $('#cloudBadge');
  if (!b) return;
  const on = Cloud.enabled();
  b.hidden = !on;
  if (!on) return;
  const [ic, label] = CLOUD_STATE[Cloud.state.state] || CLOUD_STATE.idle;
  b.textContent = ic;
  b.title = `${label}${Cloud.state.msg && Cloud.state.state !== 'syncing' ? '：' + Cloud.state.msg : ''}`;
  b.className = 'cloud-badge ' + Cloud.state.state;
}

async function cloudPanel() {
  await Cloud.ready?.(); // 古い cloud.js と混ざっても止まらないように
  const el = $('#cloudPanel');
  if (!el) return;
  if (!Cloud.available()) {
    el.innerHTML = '<section class="panel"><p class="hint">家族で共有するためのサーバーは、まだ準備中です。</p></section>';
    return;
  }
  const cfg = Cloud.get();
  if (!cfg) {
    el.innerHTML = `<section class="panel"><p>家族みんなのスマホで、同じギャラリーを見たり、作品を追加したりできます。写真は<b>あなた専用のクラウド</b>に預けられ、招待した家族だけが見られます。</p></section>
      <p class="section-label">あてはまるものを選んでください</p>
      <div class="choice-list">
        <button class="choice" id="cCreate"><span class="choice-ic">🏠</span><span><b>家族のギャラリーをつくる</b><small>家族で最初に使う人</small></span></button>
        <button class="choice" id="cJoin"><span class="choice-ic">🔑</span><span><b>招待コードで参加する</b><small>家族から招待コードをもらった人</small></span></button>
        <button class="choice" id="cDevJoin"><span class="choice-ic">📱</span><span><b>別の端末で使っている人</b><small>自分のスマホやPCで、もう使っている人（招待は要りません）</small></span></button>
      </div>`;
    $('#cCreate').onclick = cloudCreateModal;
    $('#cJoin').onclick = cloudJoinModal;
    $('#cDevJoin').onclick = () => cloudDeviceJoinModal();
    return;
  }
  el.innerHTML = `<section class="panel"><p class="hint">読み込み中…</p></section>`;
  let inf;
  try { inf = await Cloud.info(); }
  catch (e) {
    if (e.revoked) return cloudPanel();
    el.innerHTML = `<section class="panel"><p><b>${esc(cfg.familyName)}</b>　<span class="hint">あなた：${esc(cfg.memberName)}</span></p><p class="banner">⚠️ ${esc(e.message)}</p>
      <button class="btn wide" id="cSync">🔄 もう一度つなぐ</button><button class="btn danger wide small" id="cLeave">この端末の共有をやめる</button></section>`;
    $('#cSync').onclick = () => { Cloud.syncNow(); setTimeout(cloudPanel, 1200); };
    $('#cLeave').onclick = leaveCloud;
    return;
  }
  Cloud.syncMe(inf.me);
  const owner = inf.me.role === 'owner';
  const pct = Math.min(100, Math.round(inf.usage.bytes / inf.usage.limit * 100));
  const st = CLOUD_STATE[Cloud.state.state] || CLOUD_STATE.idle;
  const pushOn = (await DB.get('meta', 'push'))?.value;
  const lastSync = Cloud.state.last ? '　最後の同期 ' + new Date(Cloud.state.last).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : '';
  el.innerHTML = `
    <section class="panel family-card">
      <div class="fam-head"><div class="grow"><small class="hint">家族</small><b class="fam-name">${esc(inf.family.name)}</b></div>${owner ? '<button class="btn small" id="cFamRename">✏️ 名前</button>' : ''}</div>
      <p class="hint" id="cState">${st[0]} ${st[1]}${lastSync}</p>
      <button class="btn small" id="cSync">🔄 いま同期する</button>
    </section>
    <section class="panel"><h2>👥 メンバー <span class="count">${inf.members.length}人</span></h2>
      <div class="members">${inf.members.map(m => {
        const me = m.id === inf.me.id;
        const btn = me ? `<button class="btn small" data-rename-me="1">✏️ 名前を変える</button>`
          : owner ? `<button class="btn small" data-member="${m.id}">編集</button>` : '';
        return `<div class="member"><span>${m.role === 'owner' ? '👑' : '👤'} <b>${esc(m.name)}</b>${me ? '<small class="tag">あなた</small>' : ''}${m.role === 'owner' ? '<small class="tag soft">つくった人</small>' : ''}</span>${btn}</div>`;
      }).join('')}</div>
      <button class="btn primary wide" id="cInvite">✉️ 家族を招待する</button>
      ${owner ? '<p class="hint">同じ人が2人いるときは、「編集」→「同じ人をまとめる」で1人にできます。</p>' : ''}
    </section>
    <section class="panel"><h2>📱 あなたの端末 <span class="count">${(inf.devices || []).length}台</span></h2>
      <div class="members">${(inf.devices || []).map(d => `<div class="member"><span>${d.id === inf.me.deviceId ? '📍' : '📱'} <b>${esc(d.name)}</b>${d.id === inf.me.deviceId ? '<small class="tag">この端末</small>' : ''}<br><small class="hint">最後に使った日：${new Date(d.last_seen).toLocaleDateString('ja-JP')}</small></span><button class="btn small" data-device="${d.id}">編集</button></div>`).join('')}</div>
      <button class="btn wide" id="cDevAdd">📲 別の端末を追加する</button>
      <p class="hint">スマホ・タブレット・パソコンなど、同じ人が使う端末を、招待をもらいなおさずに追加できます。</p>
    </section>
    <a class="panel menu-row solo" href="#settings/notify"><span class="menu-ic">🔔</span><span class="menu-txt"><b>お知らせ</b><small>${pushOn ? 'この端末で受け取っています' : '家族が作品をしまったら、通知でお知らせ'}</small></span><span class="chev">›</span></a>
    <section class="panel">
      <div class="usage"><div class="bar"><i style="width:${Math.max(pct, inf.usage.bytes ? 1 : 0)}%"></i></div>
        <small>クラウドの使用量 ${fmtMB(inf.usage.bytes)} / ${fmtMB(inf.usage.limit)}（写真${inf.usage.files}ファイル）</small></div>
      ${owner ? '' : '<button class="btn wide" id="cClaim">👑 つくった人の端末をなくしたとき</button>'}
      <button class="btn danger wide" id="cLeave">この端末の共有をやめる</button>
    </section>`;
  const reload = () => cloudPanel();
  $('#cInvite').onclick = cloudInviteModal;
  $('#cDevAdd').onclick = cloudDeviceInviteModal;
  $('#cSync').onclick = () => { Cloud.syncNow(); toast('同期しています…'); setTimeout(cloudPanel, 2000); };
  $('#cLeave').onclick = leaveCloud;
  const cl = $('#cClaim');
  if (cl) cl.onclick = claimOwnerModal;
  const fr = $('#cFamRename');
  if (fr) fr.onclick = () => nameModal('家族の名前を変える', inf.family.name, 'みんなの画面に表示されます。', async n => { await Cloud.renameFamily(n); }, reload);
  const rm = $('[data-rename-me]');
  if (rm) rm.onclick = () => nameModal('あなたの名前を変える', inf.me.name, '家族の一覧や、お知らせ（「◯◯が しまいました」）に出る名前です。', async n => { await Cloud.renameMember(inf.me.id, n); }, reload);
  $$('[data-member]').forEach(b => { b.onclick = () => memberModal(inf.members.find(m => m.id === b.dataset.member), inf); });
  $$('[data-device]').forEach(b => { b.onclick = () => deviceModal(inf.devices.find(d => d.id === b.dataset.device), inf); });
}

// 名前を入れる小さな画面（家族・自分・ほかの人・端末の名前の変更で共通）
function nameModal(title, current, hint, save, done) {
  const m = openModal(`<h2>✏️ ${esc(title)}</h2>
    <form id="nForm" class="form">
      <label>新しい名前<input name="name" required maxlength="40" value="${esc(current)}" autocomplete="off"></label>
      ${hint ? `<p class="hint">${hint}</p>` : ''}
      <div class="row"><button class="btn primary">保存</button><button type="button" class="btn" id="nX">やめる</button></div></form>`);
  const inp = $('[name=name]', m);
  inp.focus(); inp.select();
  $('#nX', m).onclick = closeModal;
  $('#nForm', m).onsubmit = async e => {
    e.preventDefault();
    const name = inp.value.trim(), btn = e.submitter;
    if (!name) return;
    btn.disabled = true;
    try { await save(name); closeModal(); toast('名前を変えました'); done?.(); }
    catch (err) { toast(err.message, 4000); btn.disabled = false; }
  };
}

// つくった人が、ほかのメンバーを編集する（名前・まとめる・外す）
function memberModal(mb, inf) {
  if (!mb) return;
  const others = inf.members.filter(x => x.id !== mb.id);
  const m = openModal(`<h2>👤 ${esc(mb.name)}</h2>
    <div class="action-list">
      <button class="choice" id="mmRename"><span class="choice-ic">✏️</span><span><b>名前を変える</b><small>一覧やお知らせに出る名前</small></span></button>
      ${mb.role !== 'owner' && others.length ? '<button class="choice" id="mmMerge"><span class="choice-ic">👥</span><span><b>同じ人をまとめる</b><small>同じ人が2人いるとき、1人にします（端末はそのまま使えます）</small></span></button>' : ''}
      ${mb.role !== 'owner' ? '<button class="choice danger" id="mmRemove"><span class="choice-ic">🚪</span><span><b>家族から外す</b><small>その人の端末は、すべて使えなくなります</small></span></button>' : ''}
    </div>
    <button class="btn wide" id="mmX">閉じる</button>`);
  $('#mmX', m).onclick = closeModal;
  $('#mmRename', m).onclick = () => nameModal(`${mb.name}の名前を変える`, mb.name, '', async n => { await Cloud.renameMember(mb.id, n); }, cloudPanel);
  const mg = $('#mmMerge', m);
  if (mg) mg.onclick = () => cloudMergeModal(mb.id, mb.name, inf.members);
  const rv = $('#mmRemove', m);
  if (rv) rv.onclick = async () => {
    if (!confirm(`「${mb.name}」を家族から外しますか？\n・その人の端末は、すべて使えなくなります\n・家族の作品は消えません\n（同じ人が2人いるだけのときは、「同じ人をまとめる」を使うと、端末をそのまま使えます）`)) return;
    try { await Cloud.removeMember(mb.id); closeModal(); toast('外しました'); cloudPanel(); } catch (e) { toast(e.message, 4000); }
  };
}

// 自分の端末を編集する（名前・外す）
function deviceModal(d, inf) {
  if (!d) return;
  const here = d.id === inf.me.deviceId;
  const m = openModal(`<h2>${here ? '📍' : '📱'} ${esc(d.name)}</h2>
    <div class="action-list">
      <button class="choice" id="dmRename"><span class="choice-ic">✏️</span><span><b>名前を変える</b><small>「パパのiPhone」など、見分けやすい名前に</small></span></button>
      ${here ? '' : '<button class="choice danger" id="dmRemove"><span class="choice-ic">🚪</span><span><b>この端末を外す</b><small>なくした・使わなくなった端末を止めます（端末の中のデータは残ります）</small></span></button>'}
    </div>
    ${here ? '<p class="hint">この端末を止めるときは、画面の下の「この端末の共有をやめる」を使います。</p>' : ''}
    <button class="btn wide" id="dmX">閉じる</button>`);
  $('#dmX', m).onclick = closeModal;
  $('#dmRename', m).onclick = () => nameModal('端末の名前を変える', d.name, '', async n => { await Cloud.renameDevice(d.id, n); }, cloudPanel);
  const rv = $('#dmRemove', m);
  if (rv) rv.onclick = async () => {
    if (!confirm(`「${d.name}」を外しますか？\n（その端末からは、新しい作品が見られなくなります。端末の中のデータは残ります）`)) return;
    try { await Cloud.removeDevice(d.id); closeModal(); toast('外しました'); cloudPanel(); } catch (e) { toast(e.message, 4000); }
  };
}

// 「つくった人」を引き継ぐ（つくった人の端末をなくしたときなど）
function claimOwnerModal() {
  const m = openModal(`<h2>👑 つくった人を引き継ぐ</h2>
    <p>「つくった人」の端末をなくしたときなどに、<b>あなたを「つくった人」</b>にします。つくった人は、メンバーの名前の変更・まとめる・外す、ができます。</p>
    <form id="oForm" class="form">
      <label>設定キー<input name="key" type="password" required autocomplete="off" placeholder="家族のギャラリーをつくったときに入れたキー"></label>
      <div class="banner"><ul class="steps">
        <li>前のつくった人は「参加した人」になります（家族からは外れません）。</li>
        <li>家族の作品は、消えません。</li>
      </ul></div>
      <div class="row"><button class="btn primary">引き継ぐ</button><button type="button" class="btn" id="oX">やめる</button></div></form>`);
  $('#oX', m).onclick = closeModal;
  $('#oForm', m).onsubmit = async e => {
    e.preventDefault();
    const btn = e.submitter;
    btn.disabled = true;
    try { await Cloud.claimOwner(new FormData(e.target).get('key').trim()); closeModal(); toast('あなたが「つくった人」になりました'); cloudPanel(); }
    catch (err) { toast(err.message, 4000); btn.disabled = false; }
  };
}

// ---------- お知らせ（プッシュ通知） ----------
async function notifyPanel() {
  await Cloud.ready?.(); // 古い cloud.js と混ざっても止まらないように
  const el = $('#notifyPanel');
  if (!el) return;
  const intro = '<p>家族のだれかが作品やことばをしまったとき、<b>この端末にお知らせ</b>が届きます。<br><span class="hint">自分でしまったときは届きません。端末ごとに設定します。</span></p>';
  if (!Cloud.enabled()) {
    el.innerHTML = intro + '<p class="banner">お知らせは「家族で共有」につなぐと使えます。</p><a class="btn primary wide" href="#settings/family">👨‍👩‍👧 家族で共有へ</a>';
    return;
  }
  if (!Cloud.pushSupported()) {
    el.innerHTML = intro + (isIOS && !isStandalone()
      ? '<p class="banner">iPhone・iPadでは、<b>ホーム画面のアイコンから開いたとき</b>に使えます（iOS 16.4以降）。</p><button class="btn primary wide" id="nGuide">📲 ホーム画面に追加のしかた</button>'
      : '<p class="banner">この端末・ブラウザは、お知らせに対応していません。</p>');
    const g = $('#nGuide');
    if (g) g.onclick = installGuide;
    return;
  }
  const sub = await Cloud.pushSubscription().catch(() => null);
  const on = !!sub && !!(await DB.get('meta', 'push'))?.value;
  const denied = Notification.permission === 'denied';
  const howAllow = isIOS ? 'iPhoneの「設定」→「通知」→「キッズギャラリー」で「通知を許可」をオンにします。'
    : isAndroid ? 'ホーム画面のアイコンを長押し →「アプリ情報」→「通知」をオンにします。'
    : 'アドレスバー左の鍵（またはサイト情報）マーク →「通知」を「許可」にします。';
  el.innerHTML = intro + (on
    ? '<div class="state on">✅ この端末で受け取っています</div><button class="btn wide" id="nTest">🔔 テストのお知らせを出す</button><button class="btn wide" id="nOff">お知らせを止める</button>'
    : denied
      ? `<div class="state off">🔕 お知らせがブロックされています</div><p class="hint">${howAllow}<br>許可したら、この画面を開きなおしてください。</p>`
      : '<div class="state off">🔕 いまは受け取っていません</div><button class="btn primary wide" id="nOn">🔔 お知らせを受け取る</button><p class="hint">押すと「通知を許可しますか？」と聞かれるので、「許可」を選んでください。</p>');
  const onB = $('#nOn'), offB = $('#nOff'), testB = $('#nTest');
  if (onB) onB.onclick = async () => {
    onB.disabled = true;
    try { await Cloud.pushOn(); toast('お知らせを受け取るようにしました'); } catch (e) { toast(e.message, 5000); }
    notifyPanel();
  };
  if (offB) offB.onclick = async () => { await Cloud.pushOff(); toast('お知らせを止めました'); notifyPanel(); };
  if (testB) testB.onclick = async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification('キッズギャラリー', { body: 'これはテストのお知らせです。家族が作品をしまうと、このように届きます。', icon: 'icon-192.png', tag: 'kg-test' });
    } catch (e) { toast('テストを出せませんでした：' + e.message, 4000); }
  };
}

// 同じ人が2人いるとき：1人にまとめる（まとめる側の端末は、まとめ先の端末になる）
function cloudMergeModal(fromId, fromName, members) {
  const targets = members.filter(x => x.id !== fromId);
  const m = openModal(`<h2>👥 同じ人をまとめる</h2>
    <p>「<b>${esc(fromName)}</b>」を、次の人にまとめます。</p>
    <form id="mForm" class="form">
      <label>まとめ先（この名前が残ります）<select name="into" required>${targets.map(x => `<option value="${x.id}">${x.role === 'owner' ? '👑 ' : '👤 '}${esc(x.name)}${x.role === 'owner' ? '（つくった人）' : ''}</option>`).join('')}</select></label>
      <div class="banner">
        <b>まとめる前に確認してください</b>
        <ul class="steps">
          <li>同じ人なのは、本当にこの2人ですか？（<b>元に戻せません</b>）</li>
          <li>「${esc(fromName)}」の名前は一覧から消え、その端末は、まとめ先の端末として引き続き使えます（つなぎなおしは要りません）。</li>
          <li>家族の作品・ことばは、<b>消えません</b>。</li>
          <li>つなげられる端末は、まとめ先が10台までです。</li>
        </ul>
      </div>
      <div class="row"><button class="btn primary">まとめる</button><button type="button" class="btn" id="mX">やめる</button></div></form>`);
  $('#mX', m).onclick = closeModal;
  $('#mForm', m).onsubmit = async e => {
    e.preventDefault();
    const into = new FormData(e.target).get('into'), btn = e.submitter;
    btn.disabled = true;
    try {
      await Cloud.mergeMember(fromId, into);
      closeModal(); toast('まとめました'); cloudPanel();
    } catch (err) { toast(err.message, 5000); btn.disabled = false; }
  };
}

async function leaveCloud() {
  if (!confirm('この端末の家族共有をやめますか？\n・この端末のデータは残ります\n・クラウドのデータも残り、ほかの家族は使い続けられます\n・あなたのほかの端末が1台もないときは、戻るのに新しい招待が必要です')) return;
  await Cloud.leave();
  toast('共有をやめました');
  router({ keep: true });
}

function cloudCreateModal() {
  const m = openModal(`<h2>🏠 家族のギャラリーをつくる</h2>
    <form id="cForm" class="form">
      <label>家族の名前<input name="family" required maxlength="40" placeholder="例：やまだ家"></label>
      <label>あなたの呼び名<input name="me" required maxlength="40" placeholder="例：ママ"></label>
      <label>設定キー<input name="key" type="password" required autocomplete="off" placeholder="サーバーを設置した人が決めたキー"></label>
      <p class="hint">このスマホにすでにある作品も、家族のギャラリーに加わります。</p>
      <div class="row"><button class="btn primary">つくる</button><button type="button" class="btn" id="cX">やめる</button></div></form>`);
  $('#cX', m).onclick = closeModal;
  $('#cForm', m).onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target), btn = e.submitter;
    btn.disabled = true;
    try {
      await Cloud.create(f.get('key').trim(), f.get('family').trim(), f.get('me').trim(), deviceLabel());
      closeModal(); toast('家族のギャラリーをつくりました'); cloudPanel(); updateBadge(); afterConnect();
    } catch (err) { toast(err.message, 4000); btn.disabled = false; }
  };
}

function cloudJoinModal() {
  const m = openModal(`<h2>🔑 招待コードで参加</h2>
    <form id="cForm" class="form">
      <label>招待コード（8文字）<input name="code" required maxlength="9" autocapitalize="characters" autocomplete="off" placeholder="例：ABCD-EFGH" style="text-transform:uppercase;letter-spacing:.15em"></label>
      <label>あなたの呼び名<input name="me" required maxlength="40" placeholder="例：パパ"></label>
      <p class="hint">このスマホにすでにある作品も、家族のギャラリーに加わります。</p>
      <div class="row"><button class="btn primary">参加する</button><button type="button" class="btn" id="cX">やめる</button></div></form>`);
  $('#cX', m).onclick = closeModal;
  $('#cForm', m).onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target), btn = e.submitter;
    btn.disabled = true;
    try {
      await Cloud.join(f.get('code').trim(), f.get('me').trim(), deviceLabel());
      closeModal(); toast('家族のギャラリーに参加しました'); cloudPanel(); updateBadge(); afterConnect();
    } catch (err) { toast(err.message, 4000); btn.disabled = false; }
  };
}

async function cloudInviteModal() {
  let r;
  try { r = await Cloud.invite(); } catch (e) { return toast(e.message, 4000); }
  const code = r.code.slice(0, 4) + '-' + r.code.slice(4);
  const url = location.href.split('#')[0];
  const text = `キッズギャラリーに招待します。\n\n① アプリを開く：${url}\n② 右上の ⚙️ →「家族で共有」→「招待コードで参加する」\n③ 招待コード：${code}\n\n（コードは3日間・1回だけ使えます）`;
  const m = openModal(`<h2>✉️ 家族を招待</h2>
    <p>招待コード</p><div class="invite-code">${code}</div>
    <p class="hint">3日間、1人だけが使えます。別の家族を招待するときは、もう一度つくってください。</p>
    <div class="row"><button class="btn primary" id="iShare">📤 LINEなどで送る</button><button class="btn" id="iCopy">📋 コピー</button><button class="btn" id="iX">閉じる</button></div>`);
  $('#iX', m).onclick = closeModal;
  $('#iCopy', m).onclick = async () => { try { await navigator.clipboard.writeText(text); toast('コピーしました'); } catch { toast('コピーできませんでした'); } };
  $('#iShare', m).onclick = async () => {
    if (navigator.share) { try { await navigator.share({ text }); } catch { } }
    else { try { await navigator.clipboard.writeText(text); toast('共有に未対応のため、コピーしました'); } catch { } }
  };
}

// この端末の呼び名（「あなたの端末」の一覧に出る）
function deviceLabel() {
  const kind = /iPhone|iPod/.test(UA) ? 'iPhone' : isIOS ? 'iPad'
    : isAndroid ? (/Mobile/.test(UA) ? 'Androidスマホ' : 'Androidタブレット')
    : /Windows/.test(UA) ? 'Windowsパソコン' : /Macintosh/.test(UA) ? 'Mac' : /CrOS/.test(UA) ? 'Chromebook' : 'パソコン';
  return `${kind}（${isStandalone() ? 'ホーム画面のアイコン' : 'ブラウザ'}）`;
}

// 「端末を追加」：いま使っている端末で、追加用のコードとQRを出す
async function cloudDeviceInviteModal() {
  let r;
  try { r = await Cloud.deviceInvite(); } catch (e) { return toast(e.message, 4000); }
  const code = r.code.slice(0, 4) + '-' + r.code.slice(4);
  const url = location.href.split('#')[0];
  const link = `${url}#adddevice/${r.code}`;
  const until = new Date(r.expires).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  const text = `キッズギャラリーに、あなたの別の端末を追加します。\n\n① 追加したい端末で、このリンクを開く：\n${link}\n\n（開けないときは、アプリを開いて 右上の ⚙️ →「家族で共有」→「別の端末で使っている人」に、コード ${code} を入れます）\n\n※コードは${until}まで・1回だけ使えます`;
  const m = openModal(`<h2>📲 あなたの別の端末を追加</h2>
    <p>追加したい端末で、アプリを開き、「家族で共有」→「別の端末で使っている人」にこのコードを入れてください。QRコードを読み取っても開けます。</p>
    <div class="invite-code">${code}</div>
    <div class="qr-box">${qrSvgTag(link)}</div>
    <p class="hint">${until}まで有効・1回だけ使えます。追加した端末は、招待をもらいなおさなくても、あなたと同じ名前でつながります。</p>
    <div class="row"><button class="btn primary" id="dShare">📤 自分に送る</button><button class="btn" id="dCopy">📋 コピー</button><button class="btn" id="dX">閉じる</button></div>`);
  $('#dX', m).onclick = () => { closeModal(); cloudPanel(); };
  $('#dCopy', m).onclick = async () => { try { await navigator.clipboard.writeText(text); toast('コピーしました'); } catch { toast('コピーできませんでした'); } };
  $('#dShare', m).onclick = async () => {
    if (navigator.share) { try { await navigator.share({ text }); } catch { } }
    else { try { await navigator.clipboard.writeText(text); toast('共有に未対応のため、コピーしました'); } catch { } }
  };
}

// 「端末を追加」：追加される側の端末で、コードを入れてつなぐ
function cloudDeviceJoinModal(prefill = '') {
  const iosWarn = isIOS && !isStandalone() && !inAppBrowser
    ? `<p class="banner">iPhone・iPadでは、Safariとホーム画面のアイコンでデータが別々です。<b>アイコンで使うなら、先に「ホーム画面に追加」</b>して、アイコンから開いてこのコードを入れてください（コードは30分有効です）。<br><button type="button" class="btn small" id="dGuide">追加のしかたを見る</button></p>` : '';
  const m = openModal(`<h2>📱 別の端末で使っている人</h2>
    <form id="cForm" class="form">
      ${iosWarn}
      <p class="hint">すでに使っている端末で、「家族で共有」→「別の端末を追加する」を押すと、コードが出ます。</p>
      <label>端末追加コード（8文字）<input name="code" required maxlength="9" autocapitalize="characters" autocomplete="off" value="${esc(prefill)}" placeholder="例：ABCD-EFGH" style="text-transform:uppercase;letter-spacing:.15em"></label>
      <label>この端末の名前<input name="dev" required maxlength="40" value="${esc(deviceLabel())}"></label>
      <p class="hint">この端末にすでにある作品も、家族のギャラリーに加わります。</p>
      <div class="row"><button class="btn primary">つなぐ</button><button type="button" class="btn" id="cX">やめる</button></div></form>`);
  $('#cX', m).onclick = () => { closeModal(); if (location.hash.startsWith('#adddevice')) go('#settings/family'); };
  const g = $('#dGuide', m);
  if (g) g.onclick = installGuide;
  $('#cForm', m).onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target), btn = e.submitter;
    btn.disabled = true;
    try {
      await Cloud.joinDevice(f.get('code').trim(), f.get('dev').trim());
      toast('この端末をつなぎました'); updateBadge(); go('#settings/family'); afterConnect();
    } catch (err) { toast(err.message, 4000); btn.disabled = false; }
  };
}
// QRやリンクから開いたとき：設定の画面を開いて、コード入りで「端末を追加」を出す
async function adddevice(code = '') {
  await settings('family');
  if (!Cloud.available()) return;
  if (Cloud.enabled()) return toast('この端末は、すでに家族につながっています', 4000);
  cloudDeviceJoinModal(code.replace(/[^A-Za-z0-9]/g, '').toUpperCase().replace(/^(.{4})(.+)$/, '$1-$2'));
}

// 家族の更新が届いたときの画面の更新
Cloud.hooks.refresh = async gone => {
  await loadAll();
  await gcBlobs(gone, S.items);
  const modalOpen = $('#modal').classList.contains('open');
  const [name, ...args] = (location.hash.slice(1) || 'home').split('/');
  const readOnlyView = ['home', 'gallery', 'boxes', 'box', 'item', 'help'].includes(name) || (name === 'settings' && !args.length) || (name === 'words' && !args.length);
  if (!modalOpen && readOnlyView) { await router({ keep: true }); toast('家族の更新が届きました'); }
  else toast('家族の更新が届きました（画面を開きなおすと反映されます）', 4000);
};
Cloud.hooks.revoked = () => { toast('この端末は家族の共有から外されました（データは残っています）', 5000); updateBadge(); if (location.hash.startsWith('#settings')) router({ keep: true }); };
Cloud.on(() => {
  updateBadge();
  const s = $('#cState');
  if (s) { const st = CLOUD_STATE[Cloud.state.state] || CLOUD_STATE.idle; s.textContent = `${st[0]} ${st[1]}${Cloud.state.state === 'error' || Cloud.state.state === 'offline' ? '：' + Cloud.state.msg : ''}`; }
});

// ---------- お知らせの案内（ホーム） ----------
const NUDGE_KEY = 'kg.notifyNudge';
// 家族につながっていて、まだ「受け取る／受け取らない」を決めていない端末にだけ出す
async function notifyNudge() {
  await Cloud.ready?.(); // 古い cloud.js と混ざっても止まらないように
  if (!Cloud.enabled() || !Cloud.pushSupported() || Notification.permission === 'denied') return '';
  if ((await DB.get('meta', 'push')) !== undefined) return '';
  try { if (Date.now() - Number(localStorage.getItem(NUDGE_KEY) || 0) < 14 * 864e5) return ''; } catch { }
  return `<div class="banner nudge" id="nudge"><span>🔔 家族が作品をしまったら、お知らせで受け取りませんか？</span>
    <span class="row"><button class="btn small primary" id="nudgeOn">受け取る</button><button class="btn small" id="nudgeLater">あとで</button></span></div>`;
}
function bindNotifyNudge() {
  const on = $('#nudgeOn'), later = $('#nudgeLater');
  if (on) on.onclick = async () => {
    on.disabled = true;
    try { await Cloud.pushOn(); toast('お知らせを受け取るようにしました'); $('#nudge').hidden = true; }
    catch (e) { toast(e.message, 5000); on.disabled = false; }
  };
  if (later) later.onclick = () => { try { localStorage.setItem(NUDGE_KEY, String(Date.now())); } catch { } $('#nudge').hidden = true; };
}
// 家族につないだ直後：お知らせを受け取るか聞く（対応している端末だけ）
function afterConnect() {
  if (!Cloud.pushSupported() || Notification.permission === 'denied') return;
  setTimeout(() => {
    const m = openModal(`<div class="center"><div class="big-ic">🔔</div><h2>お知らせを受け取りますか？</h2>
      <p>家族が作品やことばをしまったとき、この端末に通知が届きます。</p></div>
      <button class="btn primary wide" id="acOn">受け取る</button><button class="btn wide" id="acLater">あとで（設定からいつでも変えられます）</button>`);
    $('#acLater', m).onclick = closeModal;
    $('#acOn', m).onclick = async () => {
      try { await Cloud.pushOn(); toast('お知らせを受け取るようにしました'); } catch (e) { toast(e.message, 5000); }
      closeModal();
      if (location.hash.startsWith('#settings')) router({ keep: true });
    };
  }, 700);
}

// ---------- はじめての案内（ツアー） ----------
const TOUR = [
  { ic: '🖼️', t: 'キッズギャラリーへようこそ', d: '子どもの作品・ことば・プレゼントを、写真に撮って<b>「しまって」</b>おくアプリです。現物を減らしても、思い出は残せます。' },
  { ic: '＋', t: '下の「＋」で しまう', d: '種類（平面・立体・文字など）を選んで、撮るだけ。<b>年齢と学年は自動</b>で付きます。たくさんあるときは「連続撮影」が便利です。' },
  { ic: '📦', t: '現物は、どうする？', d: '<b>手元に保管</b>・<b>実家へ送る</b>・<b>「ありがとう、さようなら」で手放す</b>から選べます。保管箱にはQRラベルを貼れます。' },
  { ic: '👨‍👩‍👧', t: '家族で共有・お知らせ', d: '招待コードで家族とつながると、同じギャラリーを見られます。家族が作品をしまうと、<b>お知らせ</b>で届きます。' },
  { ic: '💾', t: '思い出を守る', d: 'ときどき<b>「まるごと書き出し」</b>をすると安心です。作品集（PDF）もつくれます。迷ったら、右上の<b>「？」</b>から使い方を見られます。' },
];
function tour(k = 0) {
  if ($('#modal').classList.contains('open') && !$('#modal').classList.contains('tour')) return;
  const s = TOUR[k], last = k === TOUR.length - 1;
  // 2枚目からは中身だけ入れかえる（せり出す動きをくり返さない）
  const box = $('#modal.open.tour .modal-card');
  const show = html => (box ? (box.innerHTML = html, box) : openModal(html, 'tour'));
  const m = show(`<div class="tour-slide">
      <div class="tour-ic">${s.ic}</div>
      <h2>${s.t}</h2>
      <p>${s.d}</p>
      <div class="dots">${TOUR.map((_, n) => `<i class="${n === k ? 'on' : ''}"></i>`).join('')}</div>
    </div>
    <div class="tour-nav">${k ? '<button class="btn" id="tPrev">もどる</button>' : '<button class="btn ghost" id="tSkip">スキップ</button>'}<button class="btn primary" id="tNext">${last ? 'はじめる' : 'つぎへ'}</button></div>`);
  const done = async () => { await DB.putRaw('meta', { id: 'tourDone', value: Date.now() }); closeModal(); };
  $('#tNext', m).onclick = () => (last ? done() : tour(k + 1));
  const prev = $('#tPrev', m), skip = $('#tSkip', m);
  if (prev) prev.onclick = () => tour(k - 1);
  if (skip) skip.onclick = done;
}

// ---------- 使い方 ----------
const HELP = [
  ['はじめに', [
    ['このアプリでできること', '子どもの作品（平面・立体・文字・プチ記念）、プレゼント、ことばを、写真や文字で「しまって」おけます。年齢・学年は自動で付き、家族と共有したり、作品集にしたりできます。'],
    ['ホーム画面に追加する', 'アイコンをホーム画面に置くと、アプリのようにすぐ開けます。<br>⚙️ 設定 →「ホーム画面に追加」で、あなたの端末に合った手順が出ます。<br><b>iPhone：</b>Safariの共有ボタン（□に↑）→「ホーム画面に追加」。'],
    ['こどもを登録・編集する', '⚙️ 設定 →「こども」。誕生日を入れると、作品に年齢と学年が自動で付きます。'],
  ]],
  ['しまう', [
    ['作品をしまう', '① 下の<b>「＋」</b>を押す ② 種類を選ぶ ③「撮る」か「選ぶ」で写真を入れる ④ だれの・いつ・題名を入れて、現物をどうするか選ぶ。'],
    ['たくさんあるとき（連続撮影）', '「＋」→「たくさんある時は連続撮影」。作品を置いて手をどけると、自動で撮れます。最後にまとめて整理できます。'],
    ['写真のゆがみ・明るさ', '撮ると自動で四隅を見つけて、まっすぐ・白く整えます。うまくいかないときは、四隅の点を指で動かしたり、回転・明るさを調整できます。'],
    ['ことばを残す', '下の「ことば」→「＋ ことばを残す」。音声入力や、本人の声の録音もできます。言い間違いにチェックすると「言い間違い辞典」に並びます。'],
  ]],
  ['見る・整理する', [
    ['ギャラリーで探す', '下の「ギャラリー」。種類や「現物：手元・実家・手放した」で絞りこめます。年度ごとに並びます。'],
    ['現物の保管とQRラベル', '下の「保管」で箱を作り、作品の画面で箱を選びます。「QRラベルを印刷」で箱に貼ると、スマホで読み取って中身を見られます。'],
    ['「ありがとう、さようなら」', '現物を手放すときの小さな儀式です。写真は残り、手放した日と「ありがとう」の声を記録できます。'],
  ]],
  ['家族で共有', [
    ['家族とつながる', '⚙️ 設定 →「家族で共有」。最初の1人が「家族のギャラリーをつくる」、ほかの人は「招待コードで参加する」。招待コードは「家族を招待する」で作れます（3日間・1回だけ）。'],
    ['自分の別の端末を追加する', 'すでに使っている端末で「家族で共有」→「別の端末を追加する」。出てきたコード（30分・1回だけ）を、新しい端末の「別の端末で使っている人」に入れます。<b>招待をもらいなおす必要はありません。</b>'],
    ['名前を変える', '「家族で共有」の自分の行の「名前を変える」。つくった人は、ほかの人の「編集」→「名前を変える」でも変えられます。端末の名前も「編集」で変えられます。'],
    ['同じ人が2人いるとき', 'つくった人が、消したい方の「編集」→「同じ人をまとめる」→ 残す名前を選びます。その人の端末は、そのまま使えます。元に戻せないので、同じ人か確かめてから。'],
    ['つくった人の端末をなくしたとき', '「家族で共有」のいちばん下「つくった人の端末をなくしたとき」から、設定キーを入れると、あなたが「つくった人」になります。'],
  ]],
  ['お知らせ', [
    ['お知らせを受け取る', '⚙️ 設定 →「お知らせ」→「お知らせを受け取る」→「許可」。家族が作品をしまうと、この端末に通知が届きます（自分でしまったときは届きません）。'],
    ['iPhone・iPadでのお知らせ', 'ホーム画面のアイコンから開いたときだけ使えます（iOS 16.4以降）。先に「ホーム画面に追加」してから、アイコンで開いて設定してください。'],
    ['お知らせが来ない', '① 設定の「お知らせ」が「受け取っています」か ② 端末の設定で、このアプリの通知が許可されているか ③「テストのお知らせを出す」で表示されるか、を確かめてください。'],
  ]],
  ['思い出を守る・こまったとき', [
    ['バックアップ（まるごと書き出し）', '⚙️ 設定 →「バックアップ・作品集」→「まるごと書き出す」。こどもごと・年度ごとの写真フォルダのZIPになります。同じ画面の「ZIPから復元」で戻せます。'],
    ['作品集をつくる', 'ホームの「作品集をつくる」。表紙や章を自動でレイアウトし、PDFで保存・印刷できます。'],
    ['iPhoneで、Safariとアイコンの中身がちがう', 'iPhone・iPadでは、Safariとホーム画面のアイコンで保存場所が別々です。両方で「家族で共有」につなぐと、同じ内容にそろいます。'],
    ['新しい画面にならない', 'アプリを閉じて開きなおしてください（ホーム画面のアイコンの場合は2回）。'],
  ]],
];
function help() {
  view().innerHTML = `<h1 class="page-title">❓ 使い方</h1>
  <button class="btn wide" id="hTour">▶️ はじめての案内をもう一度見る</button>
  ${HELP.map(([sec, qs]) => `<p class="section-label">${sec}</p><div class="help-list">${qs.map(([q, a]) => `<details class="help"><summary>${q}</summary><div class="help-a">${a}</div></details>`).join('')}</div>`).join('')}
  <p class="hint center">バージョン ${APP_VERSION}</p>`;
  $('#hTour').onclick = () => tour(0);
}

// ---------- ルーター ----------
const routes = { home, gallery, item, add, edit, burst, ritual, words, boxes, box, labels, settings, book, goods, adddevice, help };
const TAB_OF = { item: 'gallery', edit: 'gallery', burst: 'add', ritual: 'gallery', box: 'boxes', labels: 'boxes', goods: 'gallery', book: 'gallery' };
async function router(opts) {
  const keep = opts?.keep === true ? window.scrollY : 0;
  if (!opts?.keep) NAV.count++;
  stopCamera();
  $('#pageStyle')?.remove(); // 作品集用の用紙サイズ指定は、作品集の画面だけで有効にする
  closeModal();
  const [name, ...args] = (location.hash.slice(1) || 'home').split('/');
  const fn = routes[name] || home;
  const tab = TAB_OF[name] || name;
  $$('#tabbar a').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
  window.scrollTo(0, keep);
  try { await fn(...args.map(decodeURIComponent)); }
  catch (err) { console.error(err); view().innerHTML = `<p class="empty">エラーが起きました：${esc(err.message)}</p>`; }
  if (keep) window.scrollTo(0, keep);
}
window.addEventListener('hashchange', () => router());

(async function init() {
  await loadAll();
  navigator.storage?.persist?.().catch(() => { });
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => { });
  }
  // お知らせを押してアプリが開いたとき：その作品を見せる
  navigator.serviceWorker?.addEventListener('message', e => { if (e.data?.go) location.hash = e.data.go; });
  router();
  // はじめて開いたときだけ、使い方の案内を出す（QRやお知らせから開いたときは邪魔しない）
  if (!(await DB.get('meta', 'tourDone')) && ['', '#home'].includes(location.hash)) setTimeout(tour, 400);
  Cloud.init().then(() => {
    updateBadge();
    // 最初の画面（お子さんの登録）は、家族につながっているかどうかで中身が変わるので、つながりを読んだあとに描きなおす
    if (!S.children.length && ['', '#home'].includes(location.hash) && !$('#modal').classList.contains('open')) router();
  }).catch(e => console.error(e));
})();
