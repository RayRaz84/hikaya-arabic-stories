// Hikaya: library, word section and reader. Stories live in content/stories/*.json
// (see docs/story-format.md); this file only renders them.

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const tokenize = t => String(t).trim().split(/\s+/).filter(Boolean);
const PUNCT = '.,!?;:،؛؟…"\'«»()[]{}-–—';
function splitPunct(tok){let a=0,b=tok.length;while(a<b&&PUNCT.includes(tok[a]))a++;while(b>a&&PUNCT.includes(tok[b-1]))b--;return{lead:tok.slice(0,a),word:tok.slice(a,b),trail:tok.slice(b)}}
function normalize(text, r = {}){let s=String(text??'');if(r.collapseSpaces!==false)s=s.replace(/\s+/g,' ').trim();if(r.trimPunctuation!==false)s=s.split(' ').map(t=>splitPunct(t).word).filter(Boolean).join(' ');if(r.stripDiacritics)s=s.replace(/[ؐ-ًؚ-ٰٟۖ-ۭ]/g,'');if(r.stripTatweel)s=s.replace(/ـ/g,'');if(r.unifyAlef)s=s.replace(/[أإآٱ]/g,'ا');if(r.unifyTaMarbuta)s=s.replace(/ة/g,'ه');if(r.unifyYa)s=s.replace(/ى/g,'ي');return s}
const arNum = n => Number(n).toLocaleString('ar-EG');
const minutes = n => !n ? '' : n === 1 ? 'دقيقة واحدة' : n === 2 ? 'دقيقتان' : `${arNum(n)} دقائق`;
const getJSON = path => fetch(path, {cache:'no-cache'}).then(r => { if (!r.ok) throw Object.assign(new Error(path), {status:r.status}); return r.json(); });

let config = {levels:[], topics:[], answerRules:{default:{}}};
let library = [];          // published index entries
let story = null;          // the open story, with lookups added
const ui = {reading:0, translation:'off', revealed:new Set(), answers:{}};

/* ---------- Progress (this device only) ---------- */
const READ_KEY = 'hikaya-read-v2';
function readList(){try{const v=JSON.parse(localStorage.getItem(READ_KEY)||'[]');return Array.isArray(v)?v:[]}catch{return[]}}
const isRead = s => readList().some(r => r.id === s.id && r.v === s.contentVersion);
function markRead(s){const list=readList().filter(r=>r.id!==s.id);list.push({id:s.id,v:s.contentVersion});try{localStorage.setItem(READ_KEY,JSON.stringify(list))}catch{}}

/* ---------- Library ---------- */
const levelOf = id => config.levels.find(l => l.id === id) || {label:id, short:id};
const topicOf = id => config.topics.find(t => t.id === id)?.label || id;

function cover(s){
  if (s.cover?.src) return `<div class="story-cover"><img src="${esc(s.cover.src)}" alt="${esc(s.cover.alt)}"><span class="cover-label">${esc(levelOf(s.level).short)}</span></div>`;
  return `<div class="story-cover cover-pending" role="img" aria-label="${esc(s.cover?.alt || 'رسم قيد الإعداد')}"><span class="cover-note">رسم قيد الإعداد</span><span class="cover-label">${esc(levelOf(s.level).short)}</span></div>`;
}

function renderFilters(){
  const used = new Set(library.map(s => s.level));
  const levels = config.levels.filter(l => used.has(l.id));
  document.querySelector('.filters').innerHTML = `<button class="active" aria-pressed="true" data-level="all">كل القصص</button>` +
    levels.map(l => `<button aria-pressed="false" data-level="${esc(l.id)}">${esc(l.label)}</button>`).join('');
  document.querySelectorAll('.filters button').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.filters button').forEach(x => { x.classList.remove('active'); x.setAttribute('aria-pressed','false'); });
    b.classList.add('active'); b.setAttribute('aria-pressed','true'); renderCards(b.dataset.level);
  }));
}

function renderCards(level = 'all'){
  const grid = document.querySelector('#story-grid');
  const list = library.filter(s => level === 'all' || s.level === level);
  document.querySelector('#library-count').innerHTML = library.length ? `${arNum(library.length)} ${library.length > 2 && library.length < 11 ? 'قصص' : 'قصة'} <span>✳</span>` : '';
  if (!library.length) {
    grid.innerHTML = `<div class="empty-library"><h3>القصص الأولى قيد الكتابة.</h3><p>نكتب قصصنا ونراجعها قبل نشرها. عُد قريبًا.</p><p lang="en" dir="ltr">The first stories are being written and reviewed. Check back soon.</p></div>`;
    document.querySelector('#progress-note').textContent = '';
    return;
  }
  grid.innerHTML = list.map(s => {
    const i = library.indexOf(s);
    const words = (s.focus || []).join(' · ');
    return `<article class="story-card">${cover(s)}<div class="card-body"><div class="card-meta"><span>${esc(s.topics.map(topicOf).join('، '))}</span><span>${minutes(s.readingMinutes)} للقراءة</span></div><h3>${esc(s.title.ar)}</h3><p>${esc(s.description.ar || s.description.en)}</p><div class="card-bottom"><button onclick="openStory(${i})" aria-label="اقرأ ${esc(s.title.ar)}">اقرأ القصة ←</button><span>${isRead(s) ? '✓ قرأتها' : esc(words)}</span></div></div></article>`;
  }).join('');
  const done = library.filter(isRead).length;
  document.querySelector('#progress-note').textContent = done ? `حكايتك مستمرّة — قرأت ${arNum(done)} من ${arNum(library.length)} على هذا الجهاز.` : '';
}

/* ---------- Words section: built from published stories ---------- */
async function renderWords(){
  const box = document.querySelector('#word-list'), ex = document.querySelector('#word-example');
  const entries = [];
  for (const meta of library.slice(0, 6)) {
    try {
      const s = prepare(await getJSON(`content/stories/${meta.slug}.json`));
      for (const v of s.vocabulary.slice(0, 3)) { const a = v.anchors?.[0]; if (a) entries.push({v, s, sid:a.sentence}); }
    } catch {}
  }
  if (!entries.length) { box.innerHTML = ''; ex.innerHTML = `ستظهر هنا كلمات من القصص بعد نشرها. <span lang="en" dir="ltr">Words from the stories will appear here once they are published.</span>`; return; }
  box.innerHTML = entries.slice(0, 8).map((e, i) => `<button data-word="${i}" aria-pressed="false">${esc(e.v.headword.full)}</button>`).join('');
  box.querySelectorAll('[data-word]').forEach(b => b.onclick = () => {
    box.querySelectorAll('[data-word]').forEach(x => { x.classList.remove('selected'); x.setAttribute('aria-pressed','false'); });
    b.classList.add('selected'); b.setAttribute('aria-pressed','true');
    const e = entries[b.dataset.word], sn = e.s.sentences.get(e.sid);
    ex.innerHTML = `${esc(sn.text.full)} <span lang="en" dir="ltr">${esc(e.v.gloss)} — ${esc(sn.translation)}</span>`;
  });
}

/* ---------- Story data ---------- */
function prepare(raw){
  const sentences = new Map(), anchors = new Map(), vocab = new Map(raw.vocabulary.map(v => [v.id, v]));
  raw.readings.forEach((r, ri) => r.paragraphs.forEach(p => p.sentences.forEach(sn => sentences.set(sn.id, {...sn, reading:ri}))));
  for (const v of raw.vocabulary) for (const a of v.anchors || []) (anchors.get(a.sentence) || anchors.set(a.sentence, []).get(a.sentence)).push({vocab:v.id, start:a.tokens[0], end:a.tokens[1]});
  return {...raw, sentences, anchors, vocab};
}

/** Sentence as HTML: anchored words become buttons (interactive) or <mark> (markVocab). */
function sentenceHTML(sid, {interactive = false, markVocab = null} = {}){
  const tokens = tokenize(story.sentences.get(sid).text.full);
  const anchors = story.anchors.get(sid) || [];
  const out = [];
  for (let i = 0; i < tokens.length;) {
    const a = anchors.find(x => x.start === i);
    if (!a) { out.push(esc(tokens[i])); i++; continue; }
    const part = tokens.slice(a.start, a.end), first = splitPunct(part[0]), last = splitPunct(part[part.length - 1]);
    const words = part.length === 1 ? first.word : [part[0].slice(first.lead.length), ...part.slice(1, -1), last.trail ? part.at(-1).slice(0, -last.trail.length) : part.at(-1)].join(' ');
    const inner = interactive
      ? `<button class="vocab" type="button" aria-haspopup="dialog" aria-expanded="false" data-vocab="${esc(a.vocab)}" data-sentence="${esc(sid)}">${esc(words)}</button>`
      : markVocab === a.vocab ? `<mark>${esc(words)}</mark>` : esc(words);
    out.push(esc(first.lead) + inner + esc(last.trail));
    i = a.end;
  }
  return out.join(' ');
}

/* ---------- Reader ---------- */
const reader = document.querySelector('#reader');

async function openStory(i){
  if (!library[i]) { document.querySelector('#stories').scrollIntoView(); return; }
  await openSlug(library[i].slug);
}

async function openSlug(slug, {preview = false} = {}){
  let raw;
  try { raw = await getJSON(`content/stories/${encodeURIComponent(slug)}.json`); }
  catch { document.querySelector('#reader-content').innerHTML = `<h2>تعذّر فتح الحكاية.</h2><p lang="en" dir="ltr">The story could not be loaded. Check your connection and try again.</p>`; reader.showModal(); return; }
  if (raw.status !== 'published' && !preview) return;
  story = prepare(raw); story.preview = preview && raw.status !== 'published';
  Object.assign(ui, {reading:0, translation:'off', answers:{}}); ui.revealed.clear();
  renderReader(); reader.showModal(); reader.scrollTop = 0;
}

function renderReader(){
  const s = story, r = s.readings[ui.reading], level = levelOf(s.level);
  const trOn = level.translations !== false;
  const tab = (label, i) => `<button role="tab" aria-selected="${i === ui.reading}" tabindex="${i === ui.reading ? 0 : -1}" data-reading="${i}">${esc(label)}</button>`;
  const trBtn = (mode, label) => `<button role="radio" aria-checked="${ui.translation === mode}" data-tr="${mode}">${label}</button>`;
  document.querySelector('#reader-content').innerHTML = `
    <div class="eyebrow">${esc(level.short)} · ${esc(s.topics.map(topicOf).join('، '))} · فصحى مبسّطة</div>
    <h2>${esc(s.title.ar)}</h2>${s.title.en ? `<p class="reader-en" lang="en" dir="ltr">${esc(s.title.en)}</p>` : ''}
    <p class="reader-deck">${esc(s.description.ar || s.description.en)}</p>
    ${s.preview ? `<p class="notice"><b>معاينة:</b> هذه الحكاية غير منشورة. <span lang="en" dir="ltr">Preview: not listed in the library.</span></p>` : ''}
    ${s.contentState === 'sample' ? `<p class="notice"><b>محتوى تجريبي.</b> <span lang="en" dir="ltr">Sample text for testing the reader, not approved learning material.</span></p>` : ''}
    <div class="reader-controls">
      ${s.readings.length > 1 ? `<div role="tablist" aria-label="نسخ الحكاية" class="version-tabs">${s.readings.map((x, i) => tab(x.label, i)).join('')}</div>` : ''}
      ${trOn ? `<div role="radiogroup" aria-label="الترجمة" class="tr-modes">${trBtn('off','بلا ترجمة')}${trBtn('pick','جملة بجملة')}${trBtn('all','كل الترجمة')}</div>` : ''}
      <button id="listen">▷ استمع</button>
    </div>
    <p class="reader-hint" lang="en" dir="ltr">Read for the meaning. Tap an underlined word for its meaning. Translation stays hidden until you ask for it.</p>
    <div id="audio-status" class="audio-status" role="status"></div>
    <div class="story-text" id="story-text">${r.paragraphs.map(p => `<p>${p.sentences.map((sn, k) => {
      const shown = ui.translation === 'all' || (ui.translation === 'pick' && ui.revealed.has(sn.id));
      const btn = trOn && ui.translation === 'pick' && sn.translation ? ` <button class="sent-btn" lang="en" dir="ltr" data-tr-sentence="${esc(sn.id)}" aria-expanded="${shown}" aria-label="Translation of this sentence">EN</button>` : '';
      const tr = trOn && shown && sn.translation ? `<span class="translation sent-tr" lang="en" dir="ltr">${esc(sn.translation)}</span>` : '';
      return `<span class="sentence" id="s-${esc(sn.id)}" tabindex="-1">${sentenceHTML(sn.id, {interactive:true})}</span>${btn}${tr}`;
    }).join(' ')}</p>`).join('')}</div>
    <section class="glossary"><h3>كلمات من الحكاية</h3><div class="glossary-list">${s.vocabulary.map(v => `<details><summary>${esc(v.headword.full)}</summary><span lang="en" dir="ltr">${esc(v.gloss)}${v.note ? ` — ${esc(v.note)}` : ''}</span></details>`).join('')}</div></section>
    ${quizHTML()}
    <button class="complete-btn" id="complete">${isRead(s) ? '✓ قرأت هذه الحكاية' : 'أنهيت القراءة ✓'}</button>
    ${library.length > 1 && !s.preview ? `<button class="text-button next-btn" id="next">الحكاية التالية ←</button>` : ''}`;
  bindReader();
}

/* ---------- Questions ---------- */
const comp = () => story.activities?.comprehension;
function quizHTML(){
  const c = comp(); if (!c?.items?.length) return '';
  const item = (it, n) => {
    const head = `<p class="q-num">السؤال ${arNum(n)}</p>`;
    let body = '';
    if (it.type === 'choice') body = `<p class="q-prompt">${esc(it.prompt)}</p><div class="quiz-options">${it.options.map(o => `<button data-pick="${esc(o.id)}" aria-pressed="false">${esc(o.text)}</button>`).join('')}</div>`;
    if (it.type === 'truefalse') body = `<p class="q-prompt">${esc(it.statement)}</p><div class="quiz-options"><button data-pick="true" aria-pressed="false">صح</button><button data-pick="false" aria-pressed="false">خطأ</button></div>`;
    if (it.type === 'sequence') {
      const order = ui.answers[it.id]?.order || shuffled(it.steps.map(x => x.id), it.id);
      ui.answers[it.id] = {...ui.answers[it.id], order};
      body = `<p class="q-prompt q-en" lang="en" dir="ltr">${esc(it.prompt)}</p><ol class="seq">${order.map((sid, k) => `<li><span>${esc(it.steps.find(x => x.id === sid).text)}</span><span class="seq-moves"><button data-move="${esc(sid)}" data-dir="-1" ${k === 0 ? 'disabled' : ''} aria-label="Move earlier">↑</button><button data-move="${esc(sid)}" data-dir="1" ${k === order.length - 1 ? 'disabled' : ''} aria-label="Move later">↓</button></span></li>`).join('')}</ol>`;
    }
    if (it.type === 'shortanswer') body = `<p class="q-prompt">${esc(it.prompt)}</p><input class="q-input" lang="ar" dir="rtl" autocomplete="off" aria-label="إجابتك" value="${esc(ui.answers[it.id]?.typed || '')}"><p class="q-hint" lang="en" dir="ltr">${esc(it.hint || 'Type your answer in Arabic.')}</p>`;
    return `<div class="q" data-item="${esc(it.id)}">${head}${body}<button class="check-btn" data-check="${esc(it.id)}">تحقّق</button><div class="q-feedback" aria-live="polite"></div></div>`;
  };
  return `<section class="quiz"><h3>هل فهمت الحكاية؟</h3><p class="quiz-intro" lang="en" dir="ltr">${esc(c.instructions)}</p>${c.items.map((it, i) => item(it, i + 1)).join('')}<p class="score" aria-live="polite"></p></section>`;
}

function shuffled(ids, seed){
  const a = [...ids]; let x = [...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) || 1;
  for (let i = a.length - 1; i > 0; i--) { x = (x * 1103515245 + 12345) >>> 0; const j = x % (i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  if (a.every((v, i) => v === ids[i])) a.push(a.shift()); // never start solved
  return a;
}

function check(it, box){
  const ans = ui.answers[it.id] || {};
  let ok, extra = '';
  if (it.type === 'choice') { if (ans.pick == null) return need(box); ok = ans.pick === it.answer; }
  if (it.type === 'truefalse') { if (ans.pick == null) return need(box); ok = (ans.pick === 'true') === it.answer; if (it.answer === false && it.correction) extra = `<p>التصحيح: <span class="ar-line">${esc(it.correction)}</span></p>`; }
  if (it.type === 'sequence') ok = ans.order.every((sid, i) => sid === it.steps[i].id);
  if (it.type === 'shortanswer') {
    const rules = config.answerRules[it.rules] || config.answerRules.default;
    const typed = normalize(box.querySelector('.q-input').value, rules);
    if (!typed) return need(box);
    ok = it.accepted.some(a => normalize(a, rules) === typed);
    if (!ok) extra = `<p>إجابة مقبولة: <span class="ar-line">${esc(it.accepted[0])}</span></p>`;
  }
  const ev = it.evidence?.find(e => story.sentences.get(e)?.reading === ui.reading) || it.evidence?.[0];
  box.querySelector('.q-feedback').innerHTML = `<div class="feedback-box ${ok ? 'ok' : 'no'}"><p class="fb-title">${ok ? 'صحيح!' : 'ليس تمامًا.'}</p>${extra}<p lang="en" dir="ltr">${esc(it.explanation)}</p>${ev ? `<p class="ar-line">«${sentenceHTML(ev)}»</p><button class="text-button evidence" data-evidence="${esc(ev)}">أرني في الحكاية ←</button>` : ''}</div>`;
  ui.answers[it.id] = {...ans, checked:true, ok};
  const items = comp().items, done = items.filter(x => ui.answers[x.id]?.checked);
  if (done.length === items.length) document.querySelector('.quiz .score').textContent = `${arNum(done.filter(x => ui.answers[x.id].ok).length)} من ${arNum(items.length)} إجابات صحيحة.`;
}
const need = box => { box.querySelector('.q-feedback').innerHTML = `<p class="q-hint">اختر إجابة أولًا. <span lang="en" dir="ltr">Answer first.</span></p>`; };

function showSentence(sid){
  const sn = story.sentences.get(sid); if (!sn) return;
  if (sn.reading !== ui.reading) { ui.reading = sn.reading; renderReader(); }
  const el = document.getElementById(`s-${sid}`);
  el.scrollIntoView({block:'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
  el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 2200);
  el.focus({preventScroll:true});
}

/* ---------- Word popover ---------- */
let pop = null;
function closePop(restore = true){ if (!pop) return; pop.el.remove(); pop.btn.setAttribute('aria-expanded','false'); if (restore) pop.btn.focus(); pop = null; }
function openPop(btn){
  const same = pop?.btn === btn; closePop(false); if (same) { btn.focus(); return; }
  const v = story.vocab.get(btn.dataset.vocab);
  const el = document.createElement('div');
  el.className = 'vocab-pop'; el.setAttribute('role','dialog'); el.setAttribute('aria-label', v.headword.full); el.tabIndex = -1;
  el.innerHTML = `<button class="pop-close" aria-label="إغلاق">✕</button><p class="pop-word">${esc(btn.textContent)}</p><p class="pop-gloss" lang="en" dir="ltr">${esc(v.gloss)}</p><p class="pop-sentence">${sentenceHTML(btn.dataset.sentence, {markVocab:v.id})}</p>${v.note ? `<p class="pop-note" lang="en" dir="ltr">${esc(v.note)}</p>` : ''}${v.audio?.src ? `<button class="text-button pop-audio">▷ استمع للكلمة</button>` : ''}`;
  reader.append(el);
  el.querySelector('.pop-close').onclick = () => closePop();
  el.querySelector('.pop-audio')?.addEventListener('click', () => new Audio(v.audio.src).play().catch(() => {}));
  btn.setAttribute('aria-expanded','true'); pop = {el, btn}; el.focus();
}
reader.addEventListener('cancel', e => { if (pop) { e.preventDefault(); closePop(); } }); // Esc closes the word first, then the story
reader.addEventListener('pointerdown', e => { if (pop && !pop.el.contains(e.target) && e.target !== pop.btn) closePop(false); });

/* ---------- Reader events ---------- */
function bindReader(){
  const root = document.querySelector('#reader-content');
  root.onclick = e => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.reading) { stopAudio(); ui.reading = Number(t.dataset.reading); ui.revealed.clear(); renderReader(); document.querySelector(`[data-reading="${ui.reading}"]`).focus(); }
    else if (t.dataset.tr) { ui.translation = t.dataset.tr; ui.revealed.clear(); renderReader(); document.querySelector(`[data-tr="${t.dataset.tr}"]`).focus(); }
    else if (t.dataset.trSentence) { const id = t.dataset.trSentence; ui.revealed.has(id) ? ui.revealed.delete(id) : ui.revealed.add(id); renderReader(); document.querySelector(`[data-tr-sentence="${id}"]`).focus(); }
    else if (t.classList.contains('vocab')) openPop(t);
    else if (t.dataset.pick) { const q = t.closest('.q'); ui.answers[q.dataset.item] = {...ui.answers[q.dataset.item], pick:t.dataset.pick}; q.querySelectorAll('[data-pick]').forEach(b => b.setAttribute('aria-pressed', String(b === t))); }
    else if (t.dataset.move) {
      const q = t.closest('.q'), id = q.dataset.item, order = ui.answers[id].order, i = order.indexOf(t.dataset.move), j = i + Number(t.dataset.dir);
      [order[i], order[j]] = [order[j], order[i]];
      const it = comp().items.find(x => x.id === id); q.outerHTML = quizItemRefresh(it);
      document.querySelector(`.q[data-item="${id}"] [data-move="${t.dataset.move}"]:not([disabled])`)?.focus();
    }
    else if (t.dataset.check) { const it = comp().items.find(x => x.id === t.dataset.check); check(it, t.closest('.q')); }
    else if (t.dataset.evidence) showSentence(t.dataset.evidence);
    else if (t.id === 'listen') listen();
    else if (t.id === 'complete') { markRead(story); t.textContent = '✓ قرأت هذه الحكاية'; renderCards(document.querySelector('.filters .active')?.dataset.level || 'all'); }
    else if (t.id === 'next') { stopAudio(); const i = library.findIndex(x => x.slug === story.slug); openSlug(library[(i + 1) % library.length].slug); }
  };
  root.oninput = e => { const q = e.target.closest('.q'); if (q && e.target.classList.contains('q-input')) ui.answers[q.dataset.item] = {...ui.answers[q.dataset.item], typed:e.target.value}; };
  root.onkeydown = e => {
    if (e.key === 'Enter' && e.target.classList.contains('q-input')) e.target.closest('.q').querySelector('[data-check]').click();
    const tab = e.target.closest('[role=tab]');
    if (tab && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { // RTL: left moves forward
      const n = story.readings.length; ui.reading = (ui.reading + (e.key === 'ArrowLeft' ? 1 : -1) + n) % n; ui.revealed.clear(); renderReader(); document.querySelector(`[data-reading="${ui.reading}"]`).focus();
    }
  };
}
function quizItemRefresh(it){
  const tmp = document.createElement('div'); tmp.innerHTML = quizHTML();
  return tmp.querySelector(`.q[data-item="${it.id}"]`).outerHTML;
}

/* ---------- Audio: a real recording when the story has one, else the device voice ---------- */
let player = null;
function stopAudio(){ if ('speechSynthesis' in window) speechSynthesis.cancel(); if (player) { player.pause(); player = null; } }
function listen(){
  const status = document.querySelector('#audio-status'), btn = document.querySelector('#listen');
  const playing = player || ('speechSynthesis' in window && speechSynthesis.speaking);
  if (playing) { stopAudio(); status.textContent = 'توقّف الصوت.'; btn.textContent = '▷ استمع'; return; }
  const r = story.readings[ui.reading];
  if (r.audio?.src) {
    player = new Audio(r.audio.src);
    player.onended = () => { player = null; btn.textContent = '▷ استمع'; };
    player.onerror = () => { player = null; status.textContent = 'تعذّر تشغيل التسجيل.'; btn.textContent = '▷ استمع'; };
    player.play().catch(() => {}); btn.textContent = '□ إيقاف'; status.textContent = 'تسجيل صوتي للحكاية.'; return;
  }
  if (!('speechSynthesis' in window)) { status.textContent = 'الصوت غير متاح في هذا المتصفّح. يمكنك متابعة القراءة.'; return; }
  const voice = speechSynthesis.getVoices().find(v => v.lang.toLowerCase().startsWith('ar'));
  if (!voice) { status.textContent = 'لا يتوفّر صوت عربي على هذا الجهاز. يمكنك متابعة القراءة أو تفعيل صوت عربي من إعدادات الجهاز.'; return; }
  const u = new SpeechSynthesisUtterance(r.paragraphs.flatMap(p => p.sentences.map(s => s.text.full)).join(' '));
  u.voice = voice; u.lang = voice.lang; u.rate = .78;
  status.textContent = 'قراءة آلية بصوت الجهاز، وليست تسجيلًا معتمدًا.'; btn.textContent = '□ إيقاف';
  u.onend = () => { const b = document.querySelector('#listen'); if (b) b.textContent = '▷ استمع'; };
  u.onerror = () => { status.textContent = 'تعذّر تشغيل الصوت. حاول مرة أخرى.'; btn.textContent = '▷ استمع'; };
  speechSynthesis.speak(u);
}

document.querySelector('.close').onclick = () => reader.close();
reader.addEventListener('close', () => { stopAudio(); closePop(false); });
reader.addEventListener('click', e => { if (e.target === reader) { const r = reader.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) reader.close(); } });

/* ---------- Start ---------- */
(async () => {
  try {
    [config, library] = await Promise.all([getJSON('content/config.json'), getJSON('content/index.json').then(d => d.stories.filter(s => s.status === 'published'))]);
  } catch {
    document.querySelector('#story-grid').innerHTML = `<div class="empty-library"><h3>تعذّر تحميل القصص.</h3><p lang="en" dir="ltr">The stories could not be loaded. Refresh the page to try again.</p></div>`;
    return;
  }
  renderFilters(); renderCards(); renderWords();
  const preview = new URLSearchParams(location.search).get('preview');
  if (preview && /^[a-z0-9-]+$/.test(preview)) openSlug(preview, {preview:true});
})();
