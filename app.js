'use strict';
/* こども作品ギャラリー 試作版
   実装アイデア：①ありがとう儀式 ②現物の保管管理＋QRラベル ⑤連続撮影 ⑥自動補正
                ⑧年齢・学年の自動付与 ⑨名言帳／言い間違い辞典 ⑩プレゼントカード ⑳まるごと書き出し */

// ---------- 小さな道具 ----------
const $ = (s, el = document) => el.querySelector(s);
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
const TYPES = {
  art: { label: '絵', icon: '🎨' },
  craft: { label: '工作', icon: '✂️' },
  shodo: { label: '習字', icon: '🖌️' },
  present: { label: 'プレゼント', icon: '🎁' },
  photo: { label: '写真', icon: '📷' },
  word: { label: 'ことば', icon: '💬' },
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

  view().innerHTML = `
  ${childChips()}
  ${needBackup ? `<a class="banner" href="#settings">💾 ${last ? '前回のバックアップから30日以上たちました' : 'まだ一度も書き出していません'}。思い出を守るために書き出しましょう →</a>` : ''}
  <section class="quick">
    <a href="#add" class="qa big">📷<b>作品を撮ってしまう</b></a>
    <a href="#burst" class="qa">⚡<b>連続撮影</b><small>たまった作品を一気に</small></a>
    <a href="#words/new" class="qa">💬<b>ことば</b><small>名言・言い間違い</small></a>
    <a href="#add/present" class="qa">🎁<b>プレゼント</b><small>もらった物と言葉</small></a>
    <a href="#boxes" class="qa">📦<b>現物の保管</b><small>箱とQRラベル</small></a>
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
  <section><h2>さいきん しまったもの</h2>${recent.length ? `<div class="grid">${recent.map(card).join('')}</div>` : '<p class="empty">まだありません。まずは1枚撮ってみましょう！</p>'}</section>`;
  bindChildChips(home);
  hydrate(view());
}

function onboarding() {
  view().innerHTML = `
  <section class="hero"><div class="hero-ic">🖼️</div><h1>こども作品ギャラリー</h1>
  <p>絵・工作・習字・プレゼント・ことば…<br>捨てられない思い出を、写真でしまっておく場所です。</p></section>
  <section class="panel"><h2>まずはお子さんを登録</h2>${childFormHTML()}</section>`;
  bindChildForm(null, () => go('#home'));
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
  ${items.length ? [...groups].map(([fy, list]) => `<section>${header(fy, list)}<div class="grid">${list.map(card).join('')}</div></section>`).join('') : '<p class="empty">該当する作品はありません</p>'}`;
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
    ${i.type !== 'word' ? statusPanel(i) : ''}
    <div class="row"><a class="btn" href="${i.type === 'word' ? '#words/edit/' + i.id : '#edit/' + i.id}">✏️ 編集</a><button class="btn danger" id="del">🗑️ 削除</button></div>
  </div>`;
  hydrate(view());

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
    <div class="type-grid">${Object.entries(TYPES).map(([k, v]) => `<a class="type-btn" href="${k === 'word' ? '#words/new' : '#add/' + k}"><span>${v.icon}</span>${v.label}</a>`).join('')}</div>
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
  const src = Imaging.toCanvas(im, 2400);
  const full = () => [{ x: 0, y: 0 }, { x: src.width, y: 0 }, { x: src.width, y: src.height }, { x: 0, y: src.height }];
  const auto = () => Imaging.detectQuad(src).quad || full();
  let quad = auto();
  const flat = ['art', 'shodo', 'present'].includes(type);

  return new Promise(resolve => {
    openModal(`<h2>写真をととのえる</h2>
      <div class="corr-wrap">
        <div class="corr-stage" id="stage"><canvas id="srcC"></canvas><svg id="qSvg" viewBox="0 0 ${src.width} ${src.height}" preserveAspectRatio="none"></svg></div>
        <div class="corr-result"><canvas id="outC"></canvas><small>できあがり</small></div>
      </div>
      <div class="toggles">
        <label><input type="checkbox" id="tWarp" ${flat ? 'checked' : ''}> 四隅を合わせて切り抜く（ゆがみ補正）</label>
        <label><input type="checkbox" id="tEnh" ${flat ? 'checked' : ''}> 紙を白く・色をくっきり</label>
      </div>
      <p class="hint" id="qHint">● を動かして、作品の四隅に合わせてください</p>
      <div class="row"><button class="btn small" id="cAuto">🔍 自動で検出</button><button class="btn small" id="cFull">⬜ 写真全体</button></div>
      <div class="row"><button class="btn" id="cCancel">やめる</button><button class="btn primary" id="cOk">この写真を使う</button></div>`, 'wide');

    const sc = $('#srcC');
    const disp = Imaging.toCanvas(src, 900);
    sc.width = disp.width; sc.height = disp.height;
    sc.getContext('2d').drawImage(disp, 0, 0);
    const svg = $('#qSvg');
    const r = Math.max(src.width, src.height) * 0.03;

    const process = max => {
      let c = $('#tWarp').checked ? Imaging.warp(src, quad, max) : Imaging.toCanvas(src, max);
      if ($('#tEnh').checked) Imaging.enhance(c);
      return c;
    };
    const preview = () => {
      const o = process(480), oc = $('#outC');
      oc.width = o.width; oc.height = o.height;
      oc.getContext('2d').drawImage(o, 0, 0);
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
      <label>種類<select name="type">${Object.entries(TYPES).filter(([k]) => k !== 'word').map(([k, v]) => `<option value="${k}">${v.icon} ${v.label}</option>`).join('')}</select></label>
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
  ${!list.length ? `<p class="empty">${mist ? '「言い間違い」にチェックを付けたことばが、ここに辞典のように並びます' : 'まだありません。こどもの「今しか言わない言葉」を残しましょう'}</p>` :
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
    ${S.boxes.length ? S.boxes.map(b => `<a class="box-row" href="#box/${b.id}"><span class="box-ic">📦</span><div><b>${esc(b.name)}</b><small>${esc(b.location || '置き場所 未設定')}</small></div><span class="count">${inBox(b.id)}点</span></a>`).join('') : '<p class="empty">まだ箱がありません。下から追加しましょう</p>'}
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
  view().innerHTML = `<h1 class="page-title">📦 ${esc(b.name)}の中身</h1>
  <p class="hint">置き場所：${esc(b.location || '未設定')}</p>
  ${its.length ? `<div class="grid">${its.map(card).join('')}</div>` : '<p class="empty">この箱に入っている作品はまだありません</p>'}
  <form id="boxEdit" class="form panel"><h2>箱の情報</h2>
    <label>名前<input name="name" value="${esc(b.name)}" required></label>
    <label>置き場所<input name="location" value="${esc(b.location || '')}"></label>
    <div class="row"><button class="btn primary">保存</button><button type="button" class="btn danger" id="boxDel">箱を削除</button></div></form>`;
  hydrate(view());
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
  <div class="labels">${S.boxes.map(b => `<div class="label"><div class="qr">${qrSvg(base + '#box/' + b.id)}</div><div><div class="l-name">${esc(b.name)}</div><div class="l-loc">${esc(b.location || '')}</div><div class="l-app">こども作品ギャラリー｜読み取ると中身が見られます</div></div></div>`).join('') || '<p class="empty">箱がありません</p>'}</div>`;
  $('#doPrint').onclick = () => print();
}

// ---------- 設定・書き出し（アイデア⑳） ----------
async function settings() {
  const est = await navigator.storage?.estimate?.().catch(() => null);
  const last = (await DB.get('meta', 'lastBackup'))?.value;
  const t = today();
  view().innerHTML = `<h1 class="page-title">⚙️ 設定とバックアップ</h1>
  <section class="panel"><h2>👧 こども</h2>
    ${S.children.map(c => `<div class="child-row"><span class="dot" style="background:${c.color}"></span><b>${esc(c.name)}</b><small>${esc(c.birth)}（いま ${ageLabel(c.birth, t)}・${gradeLabel(c.birth, t)}）</small><button class="btn small" data-edit="${c.id}">編集</button></div>`).join('')}
    <button class="btn wide" id="addChild">＋ こどもを追加</button></section>
  <section class="panel"><h2>💾 思い出を守る</h2>
    <p>アプリがなくなっても、スマホを替えても思い出が残るように、<b>ふつうの写真フォルダ</b>の形でまるごと書き出せます。</p>
    <p class="hint">前回の書き出し：${last ? new Date(last).toLocaleDateString('ja-JP') : 'まだありません'}${est ? `　／　使用容量 約${(est.usage / 1048576).toFixed(1)}MB` : ''}</p>
    <button class="btn primary wide" id="exp">📦 まるごと書き出す（ZIP）</button>
    <a class="btn wide" href="#book">📕 作品集をつくる（PDFで保存・印刷）</a>
    <label class="btn wide">♻️ 書き出したZIPから復元<input type="file" accept=".zip,application/zip" id="imp" hidden></label>
    <p class="hint">ZIPの中身：こどもごと・年度ごとのフォルダに分けた写真／ことば一覧（テキスト）／声の録音／復元用データ。パソコンでもそのまま開いて見られます。</p></section>
  <section class="panel"><h2>この試作版について</h2>
    <p class="hint">データはこの端末のブラウザの中だけに保存されます（サーバーには送られません）。ブラウザのデータを消すと思い出も消えるので、定期的に書き出してください。</p></section>`;
  $$('[data-edit]').forEach(b => {
    b.onclick = () => {
      const c = childById(b.dataset.edit);
      const used = S.items.some(i => i.childId === c.id);
      openModal(`<h2>${esc(c.name)}を編集</h2>${childFormHTML(c)}<div class="row">${used ? '' : '<button class="btn danger small" id="cDel">このこどもを削除</button>'}<button class="btn small" id="cClose">閉じる</button></div>`);
      bindChildForm(c, () => { closeModal(); settings(); });
      $('#cClose').onclick = closeModal;
      const del = $('#cDel');
      if (del) del.onclick = async () => { await DB.del('children', c.id); await loadAll(); closeModal(); settings(); };
    };
  });
  $('#addChild').onclick = () => {
    openModal(`<h2>こどもを追加</h2>${childFormHTML()}<button class="btn small" id="cClose">閉じる</button>`);
    bindChildForm(null, () => { closeModal(); settings(); });
    $('#cClose').onclick = closeModal;
  };
  $('#exp').onclick = exportZip;
  $('#imp').onchange = e => { if (e.target.files[0]) importZip(e.target.files[0]); };
}

const safe = s => String(s || '').replace(/[\\/:*?"<>|\r\n\t]/g, '_').trim().slice(0, 40);
const audioExt = b => (/mp4|m4a|aac/.test(b.type) ? 'm4a' : /ogg/.test(b.type) ? 'ogg' : 'webm');
const audioType = p => (p.endsWith('.m4a') ? 'audio/mp4' : p.endsWith('.ogg') ? 'audio/ogg' : 'audio/webm');
const README = `こども作品ギャラリー 書き出しデータ

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
    const top = 'こども作品ギャラリー';
    const data = { app: 'kids-gallery', version: 1, exportedAt: new Date().toISOString(), children: S.children, boxes: S.boxes, items: [] };
    const used = new Set();
    const uniq = p => { let q = p, n = 2; while (used.has(q)) q = p.replace(/(\.\w+)$/, `_${n++}$1`); used.add(q); return q; };
    const getB = async id => (await DB.get('blobs', id))?.blob;
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
    download(blob, `こども作品ギャラリー_${today()}.zip`);
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

// ---------- 作品集（印刷 / PDF） ----------
function book(childId) {
  const kids = childId ? [childById(childId)].filter(Boolean) : S.children;
  const section = c => {
    const its = S.items.filter(i => i.childId === c.id).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    if (!its.length) return '';
    const groups = new Map();
    for (const i of its) { const k = i.date ? fiscalYear(i.date) : 0; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(i); }
    return `<section class="b-cover"><div class="b-ic">🖼️</div><h1>${esc(c.name)}の作品集</h1><p>${esc(its[0].date)} 〜 ${esc(its[its.length - 1].date)}　${its.length}点</p></section>` +
      [...groups].map(([fy, list]) => `<section class="b-year"><h2>${fy ? fy + '年度　' + gradeLabel(c.birth, fy + '-10-01') : '日付なし'}</h2>
        <div class="b-grid">${list.filter(i => i.type !== 'word').map(i => `<figure class="b-item">${i.photos?.[0] ? `<img data-blob="${i.photos[0].full}" alt="">` : ''}<figcaption><b>${esc(i.title || TYPES[i.type].label)}</b>　${esc(i.date)}（${esc(ageLabel(c.birth, i.date))}）${i.type === 'present' && i.present?.message ? `<br>「${esc(i.present.message)}」` : ''}${i.memo ? `<br>${esc(i.memo)}` : ''}</figcaption></figure>`).join('')}</div>
        ${list.filter(i => i.type === 'word').map(i => `<div class="b-word">「${esc(i.word.text)}」<small>${esc(i.date)}・${esc(ageLabel(c.birth, i.date))}</small></div>`).join('')}</section>`).join('');
  };
  view().innerHTML = `<div class="no-print"><h1 class="page-title">📕 作品集</h1>
    ${S.children.length > 1 ? `<div class="chips"><a class="chip ${!childId ? 'on' : ''}" href="#book">みんな</a>${S.children.map(c => `<a class="chip ${childId === c.id ? 'on' : ''}" href="#book/${c.id}">${esc(c.name)}</a>`).join('')}</div>` : ''}
    <p class="hint">「印刷 / PDFに保存」→ 送信先（プリンター）で「PDFに保存」を選ぶと、PDFの作品集になります。</p>
    <button class="btn primary" id="doPrint">🖨️ 印刷 / PDFに保存</button></div>
  <div class="book">${kids.map(section).join('') || '<p class="empty">まだ作品がありません</p>'}</div>`;
  $('#doPrint').onclick = () => print();
  hydrate(view());
}

// ---------- ルーター ----------
const routes = { home, gallery, item, add, edit, burst, ritual, words, boxes, box, labels, settings, book };
const TAB_OF = { item: 'gallery', edit: 'gallery', burst: 'add', ritual: 'gallery', box: 'boxes', labels: 'boxes' };
async function router() {
  stopCamera();
  closeModal();
  const [name, ...args] = (location.hash.slice(1) || 'home').split('/');
  const fn = routes[name] || home;
  const tab = TAB_OF[name] || name;
  $$('#tabbar a').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
  window.scrollTo(0, 0);
  try { await fn(...args.map(decodeURIComponent)); }
  catch (err) { console.error(err); view().innerHTML = `<p class="empty">エラーが起きました：${esc(err.message)}</p>`; }
}
window.addEventListener('hashchange', router);

(async function init() {
  await loadAll();
  navigator.storage?.persist?.().catch(() => { });
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => { });
  }
  router();
})();
