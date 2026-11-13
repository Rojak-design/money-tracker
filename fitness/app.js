/* Fitness — a calendar of what you did each day, body measurements and recovery, stored on this device in the
   shared Rojak store.

   Saved under 'mod:fitness' (see ../core/store.js). Every entry has its own `date` (YYYY-MM-DD) for the day it
   belongs to, and the store adds `savedAt` / `updatedAt`, so other modules (e.g. a habit tracker) can read it:
     categories:        { id, name, icon, color, words: [words in an activity's name that mean this category] }
                          the kinds of session shown on the calendar, in the order shown
     activities:        { id, date, time ('19:19' or null), name (as in Garmin), catId, source }   the calendar
     nameCats:          { 'activity name (lower case)': catId }   categories you picked for a name, used next time
     bodyMeasurements:  { id, date, weightKg, heightCm, bodyFatPct }          one per day
     recoveryDays:      { id, date, recoveryScore, hrvMs, restingHr, sleepHours, sleepScore, strain, bodyBattery, source,
                          sources: { field: 'Whoop' | 'Garmin' } for numbers read from a screenshot }  one per day
   Kept from earlier versions (not shown, not changed): workoutTypes, workouts, importAliases.
   Numbers left empty are saved as null. */
'use strict';

/* ---------- Categories (you can add, rename, recolour and delete them) ---------- */
const DEFAULT_CATS = [
  { id: 'strength', name: 'Strength', icon: '🏋️‍♀️', color: '#ea580c', words: ['strength', 'lifting', 'weights', 'powerlifting'] },
  { id: 'weightlifting', name: 'Weightlifting', icon: '🏋️‍♀️', color: '#b45309', words: ['weightlifting', 'olympic', 'snatch', 'clean and jerk'] },
  { id: 'crossfit', name: 'CrossFit', icon: '⚡', color: '#dc2626', words: ['crossfit', 'wod', 'metcon', 'amrap', 'emom', 'hiit'] },
  { id: 'gymnastics', name: 'Gymnastics', icon: '🤸‍♀️', color: '#9333ea', words: ['gymnastics', 'handstand', 'muscle-up'] },
  { id: 'easy', name: 'Easy run', icon: '🏃‍♀️', color: '#16a34a', words: ['easy', 'recovery run', 'run', 'running', 'jog'] },
  { id: 'tempo', name: 'Tempo run', icon: '🔥', color: '#d97706', words: ['tempo', 'threshold', 'progression'] },
  { id: 'intervals', name: 'Intervals', icon: '⏱️', color: '#2563eb', words: ['interval', 'repeats', 'track', 'fartlek', 'speed'] },
  { id: 'long', name: 'Long run', icon: '🛣️', color: '#0d9488', words: ['long run', 'long'] },
  { id: 'race', name: 'Race', icon: '🏅', color: '#ca8a04', words: ['race', 'parkrun', 'marathon'] },
  { id: 'cycling', name: 'Cycling', icon: '🚴‍♀️', color: '#0891b2', words: ['cycling', 'bike', 'ride', 'spin'] },
  { id: 'swim', name: 'Swimming', icon: '🏊‍♀️', color: '#0284c7', words: ['swim', 'pool'] },
  { id: 'other', name: 'Other', icon: '💪', color: '#64748b', words: [] }
];
const ICONS = ['🏋️‍♀️', '⚡', '🤸‍♀️', '🏃‍♀️', '🔥', '⏱️', '🛣️', '🏅', '🚴‍♀️', '🏊‍♀️', '🚶‍♀️', '🥾', '🧘‍♀️', '🤾‍♀️', '🚣‍♀️', '🧗‍♀️', '⛹️‍♀️', '🤽‍♀️', '🏄‍♀️', '⛷️', '💃', '🥊', '🎾', '⚽', '🏸', '❤️', '💪', '⭐'];
// The icons of the first version, swapped for the female ones.
const FEMALE = { '🏋️': '🏋️‍♀️', '🤸': '🤸‍♀️', '🏃': '🏃‍♀️', '🚴': '🚴‍♀️', '🏊': '🏊‍♀️', '🚶': '🚶‍♀️', '🧘': '🧘‍♀️', '🧗': '🧗‍♀️', '🚣': '🚣‍♀️' };
const COLORS = ['#ea580c', '#dc2626', '#db2777', '#9333ea', '#2563eb', '#0284c7', '#0891b2', '#0d9488', '#16a34a', '#65a30d', '#ca8a04', '#d97706', '#64748b'];
const sameName = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
const OTHER = { id: 'other', name: 'Other', icon: '💪', color: '#64748b', words: [] };
const catOf = (id) => state.categories.find((c) => c.id === id) || state.categories.find((c) => c.id === 'other') || OTHER;
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// The category for an activity's name: the one you picked for that name before, otherwise the category with the
// longest word found in the name ("Tempo run" → Tempo run, not Easy run; "Gymnastics WOD" → Gymnastics). A name
// like "6x800" counts as intervals.
function guessCat(name) {
  const n = String(name || '').toLowerCase().trim();
  const picked = (state.nameCats || {})[n];
  if (picked && state.categories.some((c) => c.id === picked)) return picked;
  const s = /\b\d+\s*[x×]\s*\d+/.test(n) ? n + ' intervals' : n;
  let best = null, len = 0;
  for (const c of state.categories) for (const w0 of c.words || []) {
    const w = w0.toLowerCase().trim();
    if (w && w.length > len && new RegExp(`(^|[^a-z])${escRe(w)}`).test(s)) { best = c; len = w.length; }
  }
  return (best || catOf('other')).id;
}

/* ---------- State ---------- */
const emptyState = () => ({ categories: [], activities: [], nameCats: {}, bodyMeasurements: [], recoveryDays: [], settings: {} });
let state = emptyState();

async function load() {
  const saved = await Rojak.load('fitness');
  state = Object.assign(emptyState(), saved || {});
  for (const k of ['categories', 'activities', 'bodyMeasurements', 'recoveryDays']) if (!Array.isArray(state[k])) state[k] = [];
  if (!state.nameCats || typeof state.nameCats !== 'object') state.nameCats = {};
  if (!state.settings || typeof state.settings !== 'object') state.settings = {};
  if (migrate() && saved) await save();
}
// Fill in anything added in newer versions. Returns true if something changed.
function migrate() {
  let changed = false;
  if (!state.categories.length) { state.categories = DEFAULT_CATS.map((c) => Object.assign({}, c, { words: c.words.slice() })); state.settings.catsV2 = true; changed = true; }
  // Female icons, and Weightlifting as a category of its own (after Strength): activities it now matches move to it,
  // unless you picked their category yourself.
  if (!state.settings.catsV2) {
    for (const c of state.categories) if (FEMALE[c.icon]) c.icon = FEMALE[c.icon];
    if (!state.categories.some((c) => c.id === 'weightlifting' || sameName(c.name, 'Weightlifting'))) {
      const st = state.categories.find((c) => c.id === 'strength');
      if (st) st.words = (st.words || []).filter((w) => w !== 'weightlifting');
      const wl = DEFAULT_CATS.find((c) => c.id === 'weightlifting');
      state.categories.splice(st ? state.categories.indexOf(st) + 1 : 0, 0, Object.assign({}, wl, { words: wl.words.slice() }));
      for (const a of state.activities) if (a.catId === 'strength' && guessCat(a.name) === 'weightlifting') a.catId = 'weightlifting';
    }
    state.settings.catsV2 = true;
    changed = true;
  }
  // Workouts logged in the earlier version go on the calendar (the workouts themselves are kept as they were).
  if (!state.settings.calendarFromWorkouts) {
    for (const w of state.workouts || []) {
      if (!w.date) continue;
      state.activities.push({ id: uid(), date: w.date, time: null, name: w.type || 'Workout', catId: guessCat(w.type), source: 'workout log' });
    }
    state.settings.calendarFromWorkouts = true;
    changed = true;
  }
  return changed;
}
function save() {
  return Rojak.save('fitness', state).catch((err) => {
    console.error(err);
    toast('Could not save! Storage may be full.');
  });
}

/* ---------- Helpers ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => isoDay(new Date());
const dayDate = (iso) => new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
function niceDate(iso) {
  if (!iso) return '';
  const t = today();
  if (iso === t) return 'Today';
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (iso === isoDay(y)) return 'Yesterday';
  const d = dayDate(iso);
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}
// "today", "yesterday" or "on Tue, 10 Nov", for use in a sentence.
const onDay = (iso) => { const n = niceDate(iso); return n === 'Today' || n === 'Yesterday' ? n.toLowerCase() : 'on ' + n; };
// A number typed in a field (accepts a comma as the decimal point); null when empty or not a number.
function num(v) {
  const s = String(v ?? '').trim().replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}
const round = (n, dp) => (n == null ? null : Math.round(n * 10 ** dp) / 10 ** dp);
const fmt = (n, dp = 1) => (n == null ? '' : (+n.toFixed(dp)).toLocaleString(undefined, { maximumFractionDigits: dp }));

// Many phone number keypads have no ":" key, so a dot or comma works as one: "2.40" is 2:40.
const colons = (s) => String(s ?? '').trim().replace(/\s*[.,:]\s*/g, ':');
// Times: "28:36" or "28.36" (minutes:seconds), "1:02:30" (hours:minutes:seconds) or "28" (minutes) → seconds.
function parseTime(v) {
  const s = colons(v);
  if (!s) return null;
  if (/^\d+$/.test(s)) return +s * 60;
  const m = s.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  if (!m) return NaN;
  return m[3] != null ? +m[1] * 3600 + +m[2] * 60 + +m[3] : +m[1] * 60 + +m[2];
}
function fmtTime(sec) {
  if (sec == null || !Number.isFinite(sec)) return '';
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
const fmtSleep = (h) => { if (h == null) return ''; const m = Math.round(h * 60); return `${Math.floor(m / 60)}h ${pad(m % 60)}m`; };
// Sleep typed as "7:30" or "7.5" hours.
function parseSleep(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2}):(\d{1,2})$/);
  if (m) return +m[1] + +m[2] / 60;
  const h = s.match(/^(\d{1,2})\s*h(?:\s*(\d{1,2})\s*m?)?$/i);
  if (h) return +h[1] + (+h[2] || 0) / 60;
  return num(s);
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2600);
}

/* ---------- Views ---------- */
const VIEWS = {
  calendar: { title: 'Calendar', add: 'Add a session', open: () => daySheet(today(), true) },
  body: { title: 'Body', add: 'Add body measurement', open: () => bodySheet() },
  recovery: { title: 'Recovery', add: 'Add recovery', open: () => recoverySheet() }
};
let currentView = 'calendar';
function show(view) {
  currentView = view;
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + view));
  $$('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $('#viewTitle').textContent = VIEWS[view].title;
  $('#fab').setAttribute('aria-label', VIEWS[view].add);
  render();
  window.scrollTo(0, 0);
}
$$('.tabbar button').forEach((b) => b.addEventListener('click', () => show(b.dataset.view)));
$('#fab').addEventListener('click', () => VIEWS[currentView].open());

function openSheet(title, html) {
  $('#sheetTitle').textContent = title;
  $('#sheetBody').innerHTML = html;
  $('#sheet').classList.remove('hidden');
  $('.sheet-panel').scrollTop = 0;
  document.body.style.overflow = 'hidden';
}
function closeSheet() {
  catsBack = null;
  $('#sheet').classList.add('hidden');
  document.body.style.overflow = '';
  if (updateReady) location.reload();
}
// When a new version of the app arrives, reload to use it — but not while a form is open.
let updateReady = false;
if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if ($('#sheet').classList.contains('hidden')) location.reload(); else updateReady = true;
  });
}
$('#sheet').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeSheet(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#sheet').classList.contains('hidden')) closeSheet(); });

function render() {
  if (currentView === 'calendar') renderCalendar();
  if (currentView === 'body') renderBody();
  if (currentView === 'recovery') renderRecovery();
}
const byDateDesc = (a, b) => (b.date + (b.savedAt || '')).localeCompare(a.date + (a.savedAt || ''));
// A list of entries grouped under date headings.
function groupedList(entries, itemHtml) {
  let last = null, html = '';
  for (const e of entries) {
    if (e.date !== last) { html += `<div class="date-head">${esc(niceDate(e.date))}</div>`; last = e.date; }
    html += itemHtml(e);
  }
  return html;
}


/* ---------- Calendar ---------- */
let calMonth = null; // 'YYYY-MM' shown
const byTime = (a, b) => (a.time || '99').localeCompare(b.time || '99') || (a.savedAt || '').localeCompare(b.savedAt || '');
const dayActs = (iso) => state.activities.filter((a) => a.date === iso).sort(byTime);
// Monday of the week a day is in.
function weekStart(iso) { const d = dayDate(iso); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return isoDay(d); }
function addDays(iso, n) { const d = dayDate(iso); d.setDate(d.getDate() + n); return isoDay(d); }
// "🏋️ Strength 2 · 🏃 Easy run 3", in category order.
function countChips(acts) {
  if (!acts.length) return '<span class="muted small">Nothing yet</span>';
  const n = {};
  for (const a of acts) n[catOf(a.catId).id] = (n[catOf(a.catId).id] || 0) + 1;
  const order = state.categories.map((c) => c.id).concat(OTHER.id);
  return Object.keys(n).sort((a, b) => order.indexOf(a) - order.indexOf(b)).map((id) => { const c = catOf(id);
    return `<span class="count-chip" style="--c:${c.color}">${c.icon} ${esc(c.name)} <strong>${n[id]}</strong></span>`; }).join('');
}
function renderCalendar() {
  if (!calMonth) calMonth = today().slice(0, 7);
  const [y, m] = calMonth.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const lead = (first.getDay() + 6) % 7, days = new Date(y, m, 0).getDate();
  const t = today();
  let cells = '';
  for (let i = 0; i < lead; i++) cells += '<div class="day blank"></div>';
  for (let d = 1; d <= days; d++) {
    const iso = `${calMonth}-${pad(d)}`, acts = dayActs(iso);
    cells += `<button type="button" class="day${iso === t ? ' today' : ''}${iso > t ? ' future' : ''}" data-day="${iso}" aria-label="${esc(niceDate(iso))}: ${acts.length ? esc(acts.map((a) => catOf(a.catId).name).join(', ')) : 'nothing'}">
      <span class="n">${d}</span><span class="marks">${acts.slice(0, 4).map((a) => { const c = catOf(a.catId); return `<span class="mark" style="--c:${c.color}" title="${esc(a.name)}">${c.icon}</span>`; }).join('')}${acts.length > 4 ? `<span class="more">+${acts.length - 4}</span>` : ''}</span></button>`;
  }
  const ws = weekStart(t), we = addDays(ws, 6);
  const monthActs = state.activities.filter((a) => a.date.slice(0, 7) === calMonth);
  const weekActs = state.activities.filter((a) => a.date >= ws && a.date <= we);
  $('#calendar').innerHTML = `<div class="card cal">
      <div class="cal-head"><button type="button" class="icon-btn" data-cal="-1" aria-label="Previous month">‹</button>
        <h2>${esc(first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }))}</h2>
        <button type="button" class="icon-btn" data-cal="1" aria-label="Next month">›</button></div>
      <div class="cal-grid">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((x) => `<div class="dow">${x}</div>`).join('')}${cells}</div>
      ${calMonth !== t.slice(0, 7) ? '<button type="button" class="link-btn" data-cal="0">Back to this month</button>' : ''}
    </div>
    <div class="card"><h2>This week</h2><div class="counts">${countChips(weekActs)}</div></div>
    <div class="card"><h2>${esc(first.toLocaleDateString(undefined, { month: 'long' }))}</h2><div class="counts">${countChips(monthActs)}</div></div>
    ${state.activities.length ? '' : '<div class="empty">Nothing on the calendar yet.<br>Tap <strong>📷 Import from Garmin</strong> and pick a screenshot of Garmin Connect\'s <strong>All Activities</strong> list, or tap a day.</div>'}`;
  $$('[data-cal]').forEach((b) => b.addEventListener('click', () => {
    const k = +b.dataset.cal;
    if (!k) calMonth = today().slice(0, 7);
    else { const d = new Date(y, m - 1 + k, 1); calMonth = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; }
    renderCalendar();
  }));
  $$('[data-day]').forEach((b) => b.addEventListener('click', () => daySheet(b.dataset.day)));
}
const catOptions = (sel) => state.categories.map((c) => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${c.icon} ${esc(c.name)}</option>`).join('');
// A day's sessions: change their category or name, add or delete.
function daySheet(iso, addNew) {
  reopen = () => daySheet(iso);
  const acts = dayActs(iso);
  const row = (a) => `<div class="act-row" data-id="${a ? a.id : ''}">
      <select class="acat" aria-label="Category">${catOptions(a ? a.catId : guessCat(''))}</select>
      <input class="aname" placeholder="Name (optional)" aria-label="Name" value="${esc(a ? a.name : '')}" autocomplete="off">
      <button type="button" class="x-btn" aria-label="Delete">🗑</button>
      ${a && a.time ? `<span class="muted small atime">${esc(a.time)}</span>` : ''}</div>`;
  openSheet(niceDate(iso), `<form class="form" id="dForm" novalidate>
      <label>Date <input type="date" id="dDate" value="${esc(iso)}" required></label>
      <div id="acts">${acts.map(row).join('')}</div>
      <div class="row-btns"><button type="button" class="mini-btn" id="addAct">+ Add a session</button><button type="button" class="link-btn" data-cats>Edit categories ›</button></div>
      <div class="hint">The category is what shows on the calendar. Change it for an imported name and that name gets this category next time too.</div>
      <button class="btn" type="submit">Save</button>
    </form>`);
  const bindRow = (el) => {
    $('.x-btn', el).addEventListener('click', () => el.remove());
    // Typing a name picks its category, until you pick one yourself.
    const sel = $('.acat', el);
    sel.addEventListener('change', () => { sel.dataset.chosen = '1'; });
    $('.aname', el).addEventListener('change', () => { if (!sel.dataset.chosen && !el.dataset.id) sel.value = guessCat($('.aname', el).value); });
  };
  $$('.act-row').forEach(bindRow);
  const add = () => { $('#acts').insertAdjacentHTML('beforeend', row(null)); const el = $('#acts').lastElementChild; bindRow(el); return el; };
  $('#addAct').addEventListener('click', () => $('.acat', add()).focus());
  if (addNew || !acts.length) add();
  $('#dForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const date = $('#dDate').value;
    if (!date) return toast('Pick a date');
    const keep = new Set();
    for (const el of $$('.act-row')) {
      const catId = $('.acat', el).value, name = $('.aname', el).value.trim() || catOf(catId).name;
      const was = el.dataset.id ? state.activities.find((a) => a.id === el.dataset.id) : null;
      // A category picked for a name that would have got another one: remember it for that name.
      if (catId !== guessCat(name) && !sameName(name, catOf(catId).name)) state.nameCats[name.toLowerCase()] = catId;
      if (was) { Object.assign(was, { date, name, catId }); keep.add(was.id); }
      else { const a = { id: uid(), date, time: null, name, catId, source: 'manual' }; state.activities.push(a); keep.add(a.id); }
    }
    state.activities = state.activities.filter((a) => a.date !== iso || keep.has(a.id));
    await save();
    closeSheet();
    calMonth = date.slice(0, 7);
    render();
    toast('Saved');
  });
}

/* ---------- Managing categories ---------- */
let catsBack = null;
function catsSheet() {
  openSheet('Categories', `<div class="form">
      <div class="hint">Shown on the calendar in this order. Each has words that put an activity in it by its name — the longest word found wins, so "Tempo run" is a tempo run even though "run" means an easy run.</div>
      <div class="list">${state.categories.map((c, i) => `<div class="item cat-item">
        <span class="ico" style="background:color-mix(in srgb, ${c.color} 22%, transparent)">${c.icon}</span>
        <button type="button" class="left link-like" data-cat="${c.id}"><div class="title">${esc(c.name)}</div><div class="sub">${esc((c.words || []).join(', ')) || (c.id === 'other' ? 'anything not matched' : 'no words')}</div></button>
        <span class="order"><button type="button" class="icon-btn" data-up="${i}" ${i ? '' : 'disabled'} aria-label="Move up">↑</button><button type="button" class="icon-btn" data-down="${i}" ${i < state.categories.length - 1 ? '' : 'disabled'} aria-label="Move down">↓</button></span></div>`).join('')}</div>
      <button type="button" class="btn secondary" id="newCat">+ New category</button>
      ${catsBack ? '<button type="button" class="btn" id="catsDone">Done</button>' : ''}</div>`);
  if (catsBack) $('#catsDone').addEventListener('click', () => { const b = catsBack; catsBack = null; b(); });
  $$('[data-cat]').forEach((b) => b.addEventListener('click', () => catSheet(b.dataset.cat)));
  const move = async (i, j) => { const c = state.categories; [c[i], c[j]] = [c[j], c[i]]; await save(); catsSheet(); render(); };
  $$('[data-up]').forEach((b) => b.addEventListener('click', () => move(+b.dataset.up, +b.dataset.up - 1)));
  $$('[data-down]').forEach((b) => b.addEventListener('click', () => move(+b.dataset.down, +b.dataset.down + 1)));
  $('#newCat').addEventListener('click', () => catSheet(null));
}
$('#catsBtn').addEventListener('click', () => { catsBack = null; catsSheet(); });
// "Edit categories" in the day and import screens.
document.addEventListener('click', (e) => { const b = e.target.closest('[data-cats]'); if (b) { catsBack = reopen; catsSheet(); } });
// The day or import screen open now, to go back to after editing categories.
let reopen = null;
function catSheet(id) {
  const c = id ? state.categories.find((x) => x.id === id) : null;
  const used = c ? state.activities.filter((a) => a.catId === c.id).length : 0;
  let icon = c ? c.icon : '💪', color = c ? c.color : COLORS[state.categories.length % COLORS.length];
  openSheet(c ? 'Edit category' : 'New category', `<form class="form" id="cForm" novalidate>
      <label>Name <input id="cName" value="${esc(c ? c.name : '')}" placeholder="e.g. Hyrox" autocomplete="off"></label>
      <div><div class="label-t">Icon</div><div class="chips" id="cIcons">${ICONS.map((x) => `<button type="button" class="chip${x === icon ? ' on' : ''}" data-icon="${x}">${x}</button>`).join('')}</div></div>
      <div><div class="label-t">Colour</div><div class="chips" id="cColors">${COLORS.map((x) => `<button type="button" class="swatch${x === color ? ' on' : ''}" data-color="${x}" style="background:${x}" aria-label="Colour ${x}"></button>`).join('')}</div></div>
      <label>Words in an activity's name <span class="hint">separated by commas</span>
        <textarea id="cWords" rows="2" placeholder="e.g. hyrox, sled">${esc(c ? (c.words || []).join(', ') : '')}</textarea></label>
      <button class="btn" type="submit">Save</button>
      ${c && c.id !== 'other' ? `<button type="button" class="btn danger" id="cDel">Delete${used ? ` (${used} session${used > 1 ? 's' : ''} move to Other)` : ''}</button>` : ''}
      <button type="button" class="btn secondary" id="cBack">Back</button>
    </form>`);
  $$('[data-icon]').forEach((b) => b.addEventListener('click', () => { icon = b.dataset.icon; $$('[data-icon]').forEach((x) => x.classList.toggle('on', x === b)); }));
  $$('[data-color]').forEach((b) => b.addEventListener('click', () => { color = b.dataset.color; $$('[data-color]').forEach((x) => x.classList.toggle('on', x === b)); }));
  $('#cBack').addEventListener('click', catsSheet);
  $('#cForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#cName').value.trim();
    if (!name) return toast('Give it a name');
    if (state.categories.some((x) => x !== c && sameName(x.name, name))) return toast('There is already a category with that name');
    const words = [...new Set($('#cWords').value.split(',').map((w) => w.trim().toLowerCase()).filter(Boolean))];
    if (c) Object.assign(c, { name, icon, color, words });
    else state.categories.push({ id: uid(), name, icon, color, words });
    await save(); render(); catsSheet();
  });
  if ($('#cDel')) $('#cDel').addEventListener('click', async () => {
    if (!confirm(`Delete ${c.name}?${used ? ` Its ${used} session${used > 1 ? 's' : ''} will show as Other.` : ''}`)) return;
    for (const a of state.activities) if (a.catId === c.id) a.catId = 'other';
    for (const [k, v] of Object.entries(state.nameCats)) if (v === c.id) delete state.nameCats[k];
    state.categories = state.categories.filter((x) => x !== c);
    await save(); render(); catsSheet();
  });
}

/* ---------- Body measurements (one per day) ---------- */
const latestWith = (list, key) => [...list].sort(byDateDesc).find((e) => e[key] != null);
function bmi(weightKg, heightCm) { return weightKg && heightCm ? weightKg / (heightCm / 100) ** 2 : null; }
function renderBody() {
  const ms = [...state.bodyMeasurements].sort(byDateDesc);
  const w = latestWith(ms, 'weightKg'), h = latestWith(ms, 'heightCm'), f = latestWith(ms, 'bodyFatPct');
  // Change in weight since the entry before the latest.
  const prev = w ? ms.find((e) => e.weightKg != null && e.date < w.date) : null;
  const diff = w && prev ? w.weightKg - prev.weightKg : null;
  const b = w && h ? bmi(w.weightKg, h.heightCm) : null;
  $('#bodyLatest').innerHTML = ms.length ? `<div class="card"><h2>Latest</h2><div class="tiles">
      <div class="tile"><div class="label">Weight</div><div class="value">${w ? fmt(w.weightKg, 1) + '<small>kg</small>' : '–'}</div>
        <div class="label">${diff == null ? (w ? esc(niceDate(w.date)) : '') : `${diff > 0 ? '+' : diff < 0 ? '−' : '±'}${fmt(Math.abs(diff), 1)} since ${esc(niceDate(prev.date))}`}</div></div>
      <div class="tile"><div class="label">BMI</div><div class="value">${b ? fmt(b, 1) : '–'}</div><div class="label">${h ? `${fmt(h.heightCm, 1)} cm tall` : 'add your height'}</div></div>
      <div class="tile"><div class="label">Body fat</div><div class="value">${f ? fmt(f.bodyFatPct, 1) + '<small>%</small>' : '–'}</div><div class="label">${f ? esc(niceDate(f.date)) : 'optional'}</div></div>
    </div></div>` : '';
  const list = $('#bodyList');
  if (!ms.length) {
    list.innerHTML = `<div class="empty">No measurements yet.<br>Tap <strong>+</strong> to add your weight and height.</div>`;
    return;
  }
  list.innerHTML = ms.map((m) => `<button class="item" data-b="${m.id}">
      <span class="ico" aria-hidden="true">⚖️</span>
      <div class="left"><div class="title">${esc(niceDate(m.date))}</div>
        <div class="sub">${[m.heightCm != null ? `${fmt(m.heightCm, 1)} cm` : '', m.bodyFatPct != null ? `${fmt(m.bodyFatPct, 1)}% body fat` : ''].filter(Boolean).join(' · ') || '&nbsp;'}</div></div>
      <div class="amt">${m.weightKg != null ? `${fmt(m.weightKg, 1)} kg` : ''}</div></button>`).join('');
  $$('[data-b]', list).forEach((el) => el.addEventListener('click', () => bodySheet(el.dataset.b)));
}
function bodySheet(id) {
  const existing = id ? state.bodyMeasurements.find((m) => m.id === id) : null;
  const lastH = latestWith(state.bodyMeasurements, 'heightCm');
  const v = (x) => (x == null ? '' : x);
  openSheet(existing ? 'Edit measurement' : 'Body measurement', `
    <form class="form" id="bForm" novalidate>
      <label>Date <input type="date" id="bDate" value="${esc(existing ? existing.date : today())}" required></label>
      <div class="grid2">
        <label>Body weight (kg) <input id="bWeight" inputmode="decimal" placeholder="e.g. 68.4" value="${v(existing && existing.weightKg)}"></label>
        <label>Height (cm) <input id="bHeight" inputmode="decimal" placeholder="e.g. 170" value="${v(existing ? existing.heightCm : lastH && lastH.heightCm)}"></label>
      </div>
      <label>Body fat % <span class="hint">optional</span><input id="bFat" inputmode="decimal" placeholder="e.g. 22.5" value="${v(existing && existing.bodyFatPct)}"></label>
      <button class="btn" type="submit">${existing ? 'Save changes' : 'Save'}</button>
      ${existing ? `<button type="button" class="btn danger" id="bDel">Delete</button>` : ''}
    </form>`);
  $('#bForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const date = $('#bDate').value;
    if (!date) return toast('Pick a date');
    const weightKg = num($('#bWeight').value), heightCm = num($('#bHeight').value), bodyFatPct = num($('#bFat').value);
    if (Number.isNaN(weightKg) || (weightKg != null && (weightKg < 20 || weightKg > 400))) return toast('Check the body weight (kg)');
    if (Number.isNaN(heightCm) || (heightCm != null && (heightCm < 50 || heightCm > 260))) return toast('Check the height (cm)');
    if (Number.isNaN(bodyFatPct) || (bodyFatPct != null && (bodyFatPct < 2 || bodyFatPct > 75))) return toast('Check the body fat %');
    if (weightKg == null && heightCm == null && bodyFatPct == null) return toast('Fill in at least one number');
    const entry = { date, weightKg: round(weightKg, 2), heightCm: round(heightCm, 1), bodyFatPct: round(bodyFatPct, 1) };
    if (!(await saveDaily('bodyMeasurements', existing, entry, 'measurement'))) return;
    closeSheet(); render();
    toast('Saved');
  });
  if (existing) $('#bDel').addEventListener('click', () => deleteDaily('bodyMeasurements', existing, 'measurement'));
}

/* ---------- Recovery (one per day) ---------- */
const RECOVERY_FIELDS = [
  { key: 'recoveryScore', label: 'Recovery score', unit: '%', min: 0, max: 100, dp: 0, ph: 'e.g. 72' },
  { key: 'hrvMs', label: 'HRV', unit: 'ms', min: 1, max: 300, dp: 0, ph: 'e.g. 65' },
  { key: 'restingHr', label: 'Resting heart rate', unit: 'bpm', min: 25, max: 150, dp: 0, ph: 'e.g. 54' },
  { key: 'sleepHours', label: 'Sleep', unit: 'hours', min: 0, max: 24, dp: 2, ph: 'e.g. 7:30' },
  { key: 'sleepScore', label: 'Sleep quality', unit: '% (Whoop sleep performance, Garmin sleep score)', min: 0, max: 100, dp: 0, ph: 'e.g. 85' },
  { key: 'strain', label: 'Strain', unit: '0–21', min: 0, max: 21, dp: 1, ph: 'e.g. 12.4' },
  { key: 'bodyBattery', label: 'Body Battery', unit: '0–100 (Garmin)', min: 0, max: 100, dp: 0, ph: 'e.g. 48' }
];
// Whoop's colours for the recovery score: green 67+, yellow 34–66, red below.
const recoveryColor = (s) => (s == null ? '' : s >= 67 ? 'var(--good)' : s >= 34 ? '#d49b00' : 'var(--danger)');
function recoveryValue(r, key) {
  const v = r[key];
  if (v == null) return '–';
  if (key === 'sleepHours') return fmtSleep(v);
  if (key === 'recoveryScore' || key === 'sleepScore') return `${fmt(v, 0)}<small>%</small>`;
  if (key === 'hrvMs') return `${fmt(v, 0)}<small>ms</small>`;
  if (key === 'restingHr') return `${fmt(v, 0)}<small>bpm</small>`;
  return fmt(v, 1);
}
function renderRecovery() {
  const rs = [...state.recoveryDays].sort(byDateDesc);
  $('#recoveryLatest').innerHTML = rs.length ? `<div class="card"><h2>Latest</h2><div class="tiles">
    ${RECOVERY_FIELDS.map((f) => { const r = latestWith(rs, f.key); return `<div class="tile"><div class="label">${f.key === 'restingHr' ? 'Resting HR' : f.key === 'recoveryScore' ? 'Recovery' : f.label}</div>
      <div class="value"${f.key === 'recoveryScore' && r ? ` style="color:${recoveryColor(r.recoveryScore)}"` : ''}>${r ? recoveryValue(r, f.key) : '–'}</div>
      <div class="label">${r ? esc(niceDate(r.date)) : '&nbsp;'}</div></div>`; }).join('')}
    </div></div>` : '';
  const list = $('#recoveryList');
  if (!rs.length) {
    list.innerHTML = `<div class="empty">No recovery data yet.<br>Tap <strong>+</strong> to add today's recovery, HRV and sleep.</div>`;
    return;
  }
  list.innerHTML = rs.map((r) => {
    const sub = [r.hrvMs != null ? `HRV ${fmt(r.hrvMs, 0)} ms` : '', r.restingHr != null ? `RHR ${fmt(r.restingHr, 0)}` : '',
      r.sleepHours != null ? `Sleep ${fmtSleep(r.sleepHours)}${r.sleepScore != null ? ` (${fmt(r.sleepScore, 0)}%)` : ''}` : r.sleepScore != null ? `Sleep ${fmt(r.sleepScore, 0)}%` : '',
      r.strain != null ? `Strain ${fmt(r.strain, 1)}` : '', r.bodyBattery != null ? `Body Battery ${fmt(r.bodyBattery, 0)}` : ''].filter(Boolean).join(' · ');
    return `<button class="item" data-r="${r.id}">
      <span class="ico" aria-hidden="true">🔋</span>
      <div class="left"><div class="title">${esc(niceDate(r.date))}</div><div class="sub">${esc(sub) || '&nbsp;'}</div></div>
      <div class="amt" style="color:${recoveryColor(r.recoveryScore)}">${r.recoveryScore != null ? `${fmt(r.recoveryScore, 0)}%` : ''}</div></button>`;
  }).join('');
  $$('[data-r]', list).forEach((el) => el.addEventListener('click', () => recoverySheet(el.dataset.r)));
}
// Add or edit a day's recovery. `imp` (from a screenshot import): { date, values: {field: number}, notes: {field: text},
// source: {field: 'Whoop'|'Garmin'}, banner, onDone }. The numbers read go over that day's entry, if there is one.
function recoverySheet(id, imp) {
  const existing = id ? state.recoveryDays.find((r) => r.id === id) : imp ? state.recoveryDays.find((r) => r.date === imp.date) : null;
  const show = (f, v) => { if (v == null) return ''; if (f.key !== 'sleepHours') return v; const m = Math.round(v * 60); return `${Math.floor(m / 60)}:${pad(m % 60)}`; };
  const val = (f) => show(f, imp && imp.values[f.key] != null ? imp.values[f.key] : existing && existing[f.key]);
  // Under each number read from a screenshot: where it came from, and what it was before.
  const note = (f) => {
    if (!imp || imp.values[f.key] == null) return '';
    const was = existing && existing[f.key] != null && existing[f.key] !== imp.values[f.key] ? ` · was ${show(f, existing[f.key])}` : '';
    return `<span class="from">📷 ${esc(imp.notes[f.key] || 'from screenshot')}${esc(was)}</span>`;
  };
  openSheet(imp ? 'Check imported recovery' : existing ? 'Edit recovery' : 'Recovery', `
    <form class="form" id="rForm" novalidate>
      ${imp ? imp.banner : ''}
      <label>Date <input type="date" id="rDate" value="${esc(imp ? imp.date : existing ? existing.date : today())}" required></label>
      <div class="grid2">
        ${RECOVERY_FIELDS.map((f) => `<label${imp && imp.values[f.key] != null ? ' class="imported"' : ''}>${f.label} <span class="hint">${f.key === 'sleepHours' ? 'h:mm or hours' : f.unit}</span>
          <input id="r_${f.key}" inputmode="${f.key === 'sleepHours' ? 'text' : 'decimal'}" placeholder="${f.ph}" value="${esc(val(f))}" autocomplete="off">${note(f)}</label>`).join('')}
      </div>
      <div class="hint">Fill in whatever your watch or app shows; empty boxes are fine.</div>
      <button class="btn" type="submit">${existing ? 'Save changes' : 'Save'}</button>
      ${existing ? `<button type="button" class="btn danger" id="rDel">Delete</button>` : ''}
    </form>`);
  $('#rForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const date = $('#rDate').value;
    if (!date) return toast('Pick a date');
    const entry = { date, source: existing ? existing.source || 'manual' : imp ? 'screenshot' : 'manual' };
    // Which numbers came from Whoop or Garmin (kept for numbers not changed since).
    if (existing && existing.sources) entry.sources = Object.assign({}, existing.sources);
    if (imp) for (const [k, src] of Object.entries(imp.source || {})) (entry.sources || (entry.sources = {}))[k] = src;
    for (const f of RECOVERY_FIELDS) {
      const raw = $('#r_' + f.key).value;
      const n = f.key === 'sleepHours' ? parseSleep(raw) : num(raw);
      if (Number.isNaN(n) || (n != null && (n < f.min || n > f.max))) return toast(`Check the ${f.key === 'hrvMs' ? 'HRV' : f.label.toLowerCase()} (${f.min}–${f.max}${f.key === 'sleepHours' ? ' hours' : ''})`);
      entry[f.key] = round(n, f.dp);
    }
    if (RECOVERY_FIELDS.every((f) => entry[f.key] == null)) return toast('Fill in at least one number');
    if (!(await saveDaily('recoveryDays', existing, entry, 'recovery entry'))) return;
    closeSheet(); render();
    toast('Saved');
    if (imp && imp.onDone) imp.onDone();
  });
  if (existing) $('#rDel').addEventListener('click', () => deleteDaily('recoveryDays', existing, 'recovery entry'));
}

// Body measurements and recovery are one entry per day: saving on a day that already has one replaces it.
async function saveDaily(listKey, existing, entry, what) {
  const list = state[listKey];
  const clash = list.find((x) => x.date === entry.date && (!existing || x.id !== existing.id));
  if (clash && !confirm(`There's already a ${what} ${onDay(entry.date)}. Replace it with this one?`)) return false;
  if (clash) state[listKey] = list.filter((x) => x !== clash);
  if (existing) Object.assign(existing, entry);
  else state[listKey].push(Object.assign({ id: uid() }, entry));
  await save();
  return true;
}
async function deleteDaily(listKey, existing, what) {
  if (!confirm(`Delete the ${what} ${onDay(existing.date)}?`)) return;
  state[listKey] = state[listKey].filter((x) => x.id !== existing.id);
  await save();
  closeSheet(); render();
  toast('Deleted');
}

/* ---------- Start ---------- */
async function init() {
  try {
    await load();
  } catch (err) {
    console.error(err);
    toast('Could not open storage on this browser');
  }
  render();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('../sw.js').catch(() => {});
}
init();
