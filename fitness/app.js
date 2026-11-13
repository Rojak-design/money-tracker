/* Fitness — workouts, body measurements and recovery, stored on this device in the shared Rojak store.

   Saved under 'mod:fitness' (see ../core/store.js). Every entry has its own `date` (YYYY-MM-DD) for the day it
   belongs to, and the store adds `savedAt` / `updatedAt`, so other modules (e.g. a habit tracker) can read it:
     workoutTypes:      { id, name, icon, kind, pace, movements: [names], hidden }  your workout types, in the
                          order shown; kind is what's logged: 'cardio' (distance & pace), 'strength' (movements &
                          sets) or 'other' (time & notes)
     workouts:          { id, date, typeId, type (the type's name), kind, durationMin, notes, source,
                          cardio?:    { distanceKm, timeSec, paceSecPerKm, avgHr },
                          movements?: [ { name, sets: [ { reps, weightKg } ] } ] }
     bodyMeasurements:  { id, date, weightKg, heightCm, bodyFatPct }          one per day
     recoveryDays:      { id, date, recoveryScore, hrvMs, restingHr, sleepHours, sleepScore, strain, source }  one per day
   Numbers left empty are saved as null. */
'use strict';

/* ---------- Workout types (you can add, rename, reorder and hide them) ---------- */
// pace: how pace is shown and typed — 'km' (min:sec per km), 'speed' (km/h) or '100m' (min:sec per 100 m, metres).
const DEFAULT_TYPES = [
  { id: 'run', name: 'Run', icon: '🏃', kind: 'cardio', pace: 'km' },
  { id: 'cycle', name: 'Cycle', icon: '🚴', kind: 'cardio', pace: 'speed' },
  { id: 'swim', name: 'Swim', icon: '🏊', kind: 'cardio', pace: '100m' },
  { id: 'walk', name: 'Walk', icon: '🚶', kind: 'cardio', pace: 'km' },
  { id: 'hike', name: 'Hike', icon: '🥾', kind: 'cardio', pace: 'km' },
  { id: 'strength', name: 'Strength', icon: '🏋️', kind: 'strength',
    movements: ['Squat', 'Bench press', 'Deadlift', 'Overhead press', 'Barbell row', 'Pull-up', 'Lunge', 'Hip thrust', 'Leg press', 'Lat pulldown'] },
  { id: 'weightlifting', name: 'Weightlifting', icon: '🏋️‍♀️', kind: 'strength',
    movements: ['Snatch', 'Clean and jerk', 'Clean', 'Jerk', 'Power snatch', 'Power clean', 'Front squat', 'Back squat', 'Snatch pull', 'Clean pull'] },
  { id: 'crossfit', name: 'CrossFit', icon: '⚡', kind: 'strength',
    movements: ['Thruster', 'Wall ball', 'Burpee', 'Box jump', 'Kettlebell swing', 'Pull-up', 'Toes-to-bar', 'Double-under', 'Push press', 'Deadlift'] },
  { id: 'functional', name: 'Functional', icon: '🔥', kind: 'strength',
    movements: ['Burpee', 'Kettlebell swing', 'Goblet squat', 'Box jump', 'Medicine ball slam', 'Battle ropes', 'Sled push', "Farmer's carry", 'Mountain climber'] },
  { id: 'yoga', name: 'Yoga', icon: '🧘', kind: 'other' },
  { id: 'sport', name: 'Sport', icon: '⚽', kind: 'other' },
  { id: 'other', name: 'Other', icon: '💪', kind: 'other' }
];
const KINDS = { cardio: 'Distance & pace', strength: 'Movements & sets', other: 'Time & notes' };
const PACES = { km: 'Pace in min:sec per km', speed: 'Speed in km/h', '100m': 'Pace per 100 m (distance in metres)' };
const ICONS = ['🏃', '🚴', '🏊', '🚶', '🥾', '🏋️', '🏋️‍♀️', '⚡', '🔥', '🤸', '🧘', '⚽', '🏸', '🎾', '🏀', '🥊', '🥋', '🧗', '🚣', '⛷️', '🏄', '💃', '🏓', '💪'];
const sameName = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
const typeOf = (id) => state.workoutTypes.find((t) => t.id === id) || { id: '', name: 'Other', icon: '💪', kind: 'other', pace: 'km', movements: [] };
// A workout's type (by id; by name for anything saved before types had ids).
const typeOfW = (w) => state.workoutTypes.find((t) => t.id === w.typeId) || state.workoutTypes.find((t) => sameName(t.name, w.type)) ||
  { id: '', name: w.type || 'Other', icon: '💪', kind: w.kind || 'other', pace: 'km', movements: [] };

/* ---------- State ---------- */
const emptyState = () => ({ workoutTypes: [], workouts: [], bodyMeasurements: [], recoveryDays: [], settings: {} });
let state = emptyState();

async function load() {
  const saved = await Rojak.load('fitness');
  state = Object.assign(emptyState(), saved || {});
  for (const k of ['workoutTypes', 'workouts', 'bodyMeasurements', 'recoveryDays']) if (!Array.isArray(state[k])) state[k] = [];
  if (migrate() && saved) await save();
}
// Fill in anything added in newer versions. Returns true if something changed.
function migrate() {
  let changed = false;
  if (!state.workoutTypes.length) {
    state.workoutTypes = DEFAULT_TYPES.map((t) => Object.assign({ pace: 'km', hidden: false }, t, { movements: (t.movements || []).slice() }));
    // The first version kept one list of movement names for everything: they go to Strength.
    const str = state.workoutTypes.find((t) => t.id === 'strength');
    for (const n of state.movementNames || []) if (!str.movements.some((m) => sameName(m, n))) str.movements.push(n);
    changed = true;
  }
  if ('movementNames' in state) { delete state.movementNames; changed = true; }
  // Workouts saved before types had ids get their type's id (HIIT is now Functional).
  for (const w of state.workouts) {
    if (w.typeId && state.workoutTypes.some((t) => t.id === w.typeId)) continue;
    if (w.type === 'HIIT') w.type = 'Functional';
    let t = state.workoutTypes.find((x) => sameName(x.name, w.type || 'Other'));
    if (!t) {
      t = { id: uid(), name: w.type || 'Other', icon: '💪', kind: w.kind || 'other', pace: 'km', movements: [], hidden: false };
      state.workoutTypes.push(t);
    }
    w.typeId = t.id; w.type = t.name; w.kind = t.kind;
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

// Times: "28:36" (minutes:seconds), "1:02:30" (hours:minutes:seconds) or "28" (minutes) → seconds.
function parseTime(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (/^\d+([.,]\d+)?$/.test(s)) return Math.round(num(s) * 60);
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
// Pace is stored as seconds per km; it is typed and shown the way each sport usually shows it.
function parsePace(v, how) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (how === 'speed') { const kmh = num(s); return kmh > 0 ? 3600 / kmh : NaN; }
  const sec = /:/.test(s) ? parseTime(s) : Math.round(num(s) * 60); // "5:30" or "5.5" minutes
  if (!(sec > 0)) return NaN;
  return how === '100m' ? sec * 10 : sec;
}
function fmtPace(secPerKm, how, withUnit) {
  if (!(secPerKm > 0)) return '';
  if (how === 'speed') return fmt(3600 / secPerKm, 1) + (withUnit ? ' km/h' : '');
  const sec = how === '100m' ? secPerKm / 10 : secPerKm;
  return fmtTime(sec) + (withUnit ? (how === '100m' ? ' /100 m' : ' /km') : '');
}
const fmtDist = (km, t) => (km == null ? '' : t.pace === '100m' ? `${fmt(km * 1000, 0)} m` : `${fmt(km, 2)} km`);
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
  workouts: { title: 'Workouts', add: 'Add workout', open: () => workoutSheet() },
  body: { title: 'Body', add: 'Add body measurement', open: () => bodySheet() },
  recovery: { title: 'Recovery', add: 'Add recovery', open: () => recoverySheet() }
};
let currentView = 'workouts';
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
  $('#sheet').classList.add('hidden');
  document.body.style.overflow = '';
}
$('#sheet').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeSheet(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#sheet').classList.contains('hidden')) closeSheet(); });

function render() {
  if (currentView === 'workouts') renderWorkouts();
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

/* ---------- Workouts ---------- */
const setCount = (w) => (w.movements || []).reduce((n, m) => n + m.sets.length, 0);
const topWeight = (w) => Math.max(0, ...(w.movements || []).flatMap((m) => m.sets.map((s) => s.weightKg || 0)));
function workoutSummary(w) {
  const parts = [];
  const how = typeOfW(w).pace;
  if (w.cardio) {
    const c = w.cardio;
    if (c.distanceKm != null) parts.push(fmtDist(c.distanceKm, typeOfW(w)));
    if (c.paceSecPerKm) parts.push(fmtPace(c.paceSecPerKm, how, true));
    if (c.avgHr) parts.push(`${c.avgHr} bpm`);
  }
  if (w.movements && w.movements.length) {
    parts.push(w.movements.map((m) => m.name).join(', '));
    parts.push(`${setCount(w)} set${setCount(w) === 1 ? '' : 's'}`);
    if (topWeight(w)) parts.push(`top ${fmt(topWeight(w), 1)} kg`);
  }
  if (!parts.length && w.notes) parts.push(w.notes);
  return parts.join(' · ');
}
function workoutLength(w) {
  if (w.cardio && w.cardio.timeSec) return fmtTime(w.cardio.timeSec);
  if (w.durationMin) return `${fmt(w.durationMin, 0)} min`;
  return '';
}
function renderWorkouts() {
  const list = $('#workoutList');
  const ws = [...state.workouts].sort(byDateDesc);
  if (!ws.length) {
    list.innerHTML = `<div class="empty">No workouts yet.<br>Tap <strong>+</strong> to log a run, a gym session or anything else.</div>`;
    return;
  }
  list.innerHTML = groupedList(ws, (w) => `<button class="item" data-w="${w.id}">
      <span class="ico" aria-hidden="true">${esc(typeOfW(w).icon)}</span>
      <div class="left"><div class="title">${esc(w.type)}</div><div class="sub">${esc(workoutSummary(w)) || '&nbsp;'}</div></div>
      <div class="amt">${esc(workoutLength(w))}</div></button>`);
  $$('[data-w]', list).forEach((el) => el.addEventListener('click', () => workoutSheet(el.dataset.w)));
}

// Add or edit a workout. `copyFrom` starts a new workout from an earlier one (same type, movements and sets).
function workoutSheet(id, copyFrom) {
  const existing = id ? state.workouts.find((w) => w.id === id) : null;
  const src = existing || copyFrom || null;
  // `type` is the id of the workout type picked in the form.
  let type = src ? typeOfW(src).id : (state.workoutTypes.find((t) => !t.hidden) || typeOf('')).id;
  const c = (src && src.cardio) || {};
  openSheet(existing ? 'Edit workout' : 'New workout', `
    <form class="form" id="wForm" novalidate>
      <label>Date <input type="date" id="wDate" value="${esc(existing ? existing.date : today())}" required></label>
      <div><div class="small" style="font-weight:600;margin-bottom:6px">Type</div>
        <div class="types" id="wTypes">${state.workoutTypes.filter((t) => !t.hidden || t.id === type)
          .map((t) => `<button type="button" data-t="${esc(t.id)}">${esc(t.icon)} ${esc(t.name)}</button>`).join('')}</div>
        <div class="hint" style="margin-top:6px">Add or change types under Workouts → <strong>Workout types</strong>.</div></div>

      <div class="box" id="wCardio">
        <h3 id="wCardioHead">Distance, time and pace</h3>
        <div class="grid2">
          <label><span id="wDistLabel">Distance (km)</span><input id="wDist" inputmode="decimal" autocomplete="off"></label>
          <label>Time <input id="wTime" inputmode="numeric" placeholder="mm:ss or h:mm:ss" autocomplete="off"></label>
          <label><span id="wPaceLabel">Pace (min:sec /km)</span><input id="wPace" inputmode="decimal" autocomplete="off"></label>
          <label>Avg heart rate <input id="wHr" inputmode="numeric" placeholder="bpm" autocomplete="off"></label>
        </div>
        <div class="hint">Fill in any two of distance, time and pace — the third is worked out.</div>
      </div>

      <div class="box" id="wStrength">
        <h3>Movements</h3>
        <div id="wMoves" class="form" style="gap:10px"></div>
        <button type="button" class="mini-btn" id="wAddMove">+ Add movement</button>
        <datalist id="moveNames"></datalist>
      </div>

      <label>Duration (minutes) <input id="wDur" inputmode="numeric" autocomplete="off" placeholder="e.g. 45"></label>
      <label>Notes <textarea id="wNotes" placeholder="How did it feel? Where?">${esc(src ? src.notes : '')}</textarea></label>
      <button class="btn" type="submit">${existing ? 'Save changes' : 'Save workout'}</button>
      ${existing ? `<div class="btn-row"><button type="button" class="btn secondary" id="wCopy">Log again</button>
        <button type="button" class="btn danger" id="wDel">Delete</button></div>` : ''}
    </form>`);

  // Cardio: distance, time and pace — the two typed last work out the third.
  const fields = { dist: $('#wDist'), time: $('#wTime'), pace: $('#wPace') };
  let edited = [];
  const how = () => typeOf(type).pace;
  const readDist = () => { const n = num(fields.dist.value); return n == null || isNaN(n) ? n : how() === '100m' ? n / 1000 : n; };
  const showDist = (km) => showDistFor(km, typeOf(type));
  function workOut() {
    const pair = edited.slice(-2);
    if (pair.length < 2) return;
    const d = readDist(), t = parseTime(fields.time.value), p = parsePace(fields.pace.value, how());
    const ok = (x) => x != null && x > 0;
    if (!pair.includes('pace') && ok(d) && ok(t)) fields.pace.value = fmtPace(t / d, how());
    else if (!pair.includes('time') && ok(d) && ok(p)) fields.time.value = fmtTime(p * d);
    else if (!pair.includes('dist') && ok(t) && ok(p)) fields.dist.value = showDist(t / p);
  }
  for (const [k, el] of Object.entries(fields)) {
    el.addEventListener('input', () => { edited = edited.filter((x) => x !== k).concat(el.value.trim() ? [k] : []); workOut(); });
  }
  if (c.distanceKm != null) fields.dist.value = showDistFor(c.distanceKm, typeOf(type));
  if (c.timeSec) fields.time.value = fmtTime(c.timeSec);
  if (c.paceSecPerKm) fields.pace.value = fmtPace(c.paceSecPerKm, typeOf(type).pace);
  if (c.avgHr) $('#wHr').value = c.avgHr;
  // A duration worked out from the cardio time isn't shown, so it follows the time if that changes.
  if (src && src.durationMin && !(c.timeSec && src.durationMin === Math.round(c.timeSec / 60))) $('#wDur').value = src.durationMin;
  // Editing a saved workout: changing the distance or time updates the pace.
  edited = ['pace', 'dist', 'time'].filter((k) => fields[k].value);

  function setType(t) {
    const before = how();
    // Keep the distance and pace the same when switching between sports shown in different units.
    const d = readDist(), p = parsePace(fields.pace.value, before);
    type = t;
    $$('#wTypes button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
    const kind = typeOf(t).kind;
    $('#wCardio').classList.toggle('hidden', kind !== 'cardio');
    $('#wStrength').classList.toggle('hidden', kind !== 'strength');
    $('#wDistLabel').textContent = how() === '100m' ? 'Distance (m)' : 'Distance (km)';
    $('#wPaceLabel').textContent = how() === 'speed' ? 'Speed (km/h)' : how() === '100m' ? 'Pace (min:sec /100 m)' : 'Pace (min:sec /km)';
    fields.pace.placeholder = how() === 'speed' ? 'e.g. 25' : how() === '100m' ? 'e.g. 2:05' : 'e.g. 5:30';
    fields.dist.placeholder = how() === '100m' ? 'e.g. 1500' : 'e.g. 5.2';
    if (before !== how()) {
      if (d > 0) fields.dist.value = showDist(d);
      if (p > 0) fields.pace.value = fmtPace(p, how());
    }
    // This type's movements are suggested first, then movements from your other types.
    const mine = typeOf(t).movements || [];
    $('#moveNames').innerHTML = [...mine, ...allMoveNames().filter((n) => !mine.some((m) => sameName(m, n)))].map((n) => `<option value="${esc(n)}">`).join('');
    $$('#wMoves .mname').forEach((i) => { i.placeholder = `Movement, e.g. ${mine[0] || 'Squat'}`; });
    if (kind === 'strength' && !$('#wMoves').children.length) addMove();
  }
  $$('#wTypes button').forEach((b) => b.addEventListener('click', () => setType(b.dataset.t)));

  // Strength: movements, each with sets of reps × kg.
  function addSet(setsEl, s) {
    const row = document.createElement('div');
    row.className = 'set-row';
    row.innerHTML = `<span class="n"></span>
      <input class="reps" inputmode="numeric" placeholder="reps" aria-label="Reps" value="${s && s.reps != null ? s.reps : ''}">
      <input class="kg" inputmode="decimal" placeholder="kg" aria-label="Weight in kg" value="${s && s.weightKg != null ? s.weightKg : ''}">
      <button type="button" class="x-btn" aria-label="Remove set">✕</button>`;
    $('.x-btn', row).addEventListener('click', () => { row.remove(); numberSets(setsEl); });
    setsEl.appendChild(row);
    numberSets(setsEl);
    return row;
  }
  function numberSets(setsEl) { $$('.set-row', setsEl).forEach((r, i) => { $('.n', r).textContent = i + 1; }); }
  function addMove(m) {
    const el = document.createElement('div');
    el.className = 'move';
    el.innerHTML = `<div class="move-head"><input class="mname" list="moveNames" placeholder="Movement, e.g. ${esc((typeOf(type).movements || [])[0] || 'Squat')}" aria-label="Movement" value="${esc(m ? m.name : '')}" autocomplete="off">
        <button type="button" class="x-btn" aria-label="Remove movement">🗑</button></div>
      <div class="set-row set-head"><span>Set</span><span>Reps</span><span>kg</span><span></span></div>
      <div class="sets"></div>
      <button type="button" class="mini-btn add-set">+ Add set</button>`;
    const setsEl = $('.sets', el);
    $('.move-head .x-btn', el).addEventListener('click', () => el.remove());
    // A new set starts as a copy of the one before, so repeating sets takes one tap.
    $('.add-set', el).addEventListener('click', () => {
      const prev = $$('.set-row', setsEl).pop();
      const row = addSet(setsEl, prev ? { reps: $('.reps', prev).value, weightKg: $('.kg', prev).value } : null);
      $('.reps', row).focus();
    });
    for (const s of (m && m.sets) || [null]) addSet(setsEl, s);
    $('#wMoves').appendChild(el);
    return el;
  }
  $('#wAddMove').addEventListener('click', () => $('.mname', addMove()).focus());
  for (const m of (src && src.movements) || []) addMove(m);
  setType(type);

  $('#wForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const date = $('#wDate').value;
    if (!date) return toast('Pick a date');
    const t = typeOf(type), kind = t.kind;
    let durationMin = num($('#wDur').value);
    if (isNaN(durationMin) || durationMin < 0 || durationMin > 1440) return toast('Check the duration (minutes)');
    const w = { id: existing ? existing.id : uid(), date, typeId: t.id, type: t.name, kind, durationMin: durationMin == null ? null : round(durationMin, 0),
      notes: $('#wNotes').value.trim(), source: existing ? existing.source || 'manual' : 'manual' };

    if (kind === 'cardio') {
      const d = readDist(), t = parseTime(fields.time.value), p = parsePace(fields.pace.value, how()), hr = num($('#wHr').value);
      if (Number.isNaN(d) || (d != null && (d <= 0 || d > 1000))) return toast('Check the distance');
      if (Number.isNaN(t) || (t != null && t <= 0)) return toast('Type the time as mm:ss or h:mm:ss');
      if (Number.isNaN(p)) return toast(how() === 'speed' ? 'Check the speed' : 'Type the pace as min:sec, e.g. 5:30');
      if (Number.isNaN(hr) || (hr != null && (hr < 30 || hr > 230))) return toast('Check the heart rate (bpm)');
      const cardio = { distanceKm: d == null ? null : round(d, 3), timeSec: t, paceSecPerKm: p == null ? null : Math.round(p), avgHr: hr == null ? null : Math.round(hr) };
      // Work out whatever can be worked out from the rest.
      if (!cardio.paceSecPerKm && cardio.distanceKm && cardio.timeSec) cardio.paceSecPerKm = Math.round(cardio.timeSec / cardio.distanceKm);
      if (!cardio.timeSec && cardio.distanceKm && cardio.paceSecPerKm) cardio.timeSec = Math.round(cardio.paceSecPerKm * cardio.distanceKm);
      if (cardio.distanceKm == null && cardio.timeSec && cardio.paceSecPerKm) cardio.distanceKm = round(cardio.timeSec / cardio.paceSecPerKm, 3);
      w.cardio = cardio;
      if (w.durationMin == null && cardio.timeSec) w.durationMin = Math.round(cardio.timeSec / 60);
    }
    if (kind === 'strength') {
      const movements = [];
      for (const el of $$('#wMoves .move')) {
        const name = $('.mname', el).value.trim().replace(/\s+/g, ' ');
        const sets = [];
        for (const r of $$('.sets .set-row', el)) {
          const reps = num($('.reps', r).value), kg = num($('.kg', r).value);
          if (reps == null && kg == null) continue;
          if (reps == null || isNaN(reps) || reps <= 0 || reps > 1000 || reps % 1) return toast(`Check the reps for ${name || 'each set'}`);
          if (isNaN(kg) || (kg != null && (kg < 0 || kg > 1000))) return toast(`Check the weight for ${name || 'each set'}`);
          sets.push({ reps, weightKg: kg == null ? null : round(kg, 2) });
        }
        if (!name && !sets.length) continue;
        if (!name) return toast('Give each movement a name');
        if (!sets.length) return toast(`Add at least one set for ${name}`);
        movements.push({ name: matchName(name, t), sets });
      }
      w.movements = movements;
      // New movements are added to this type's list.
      if (!Array.isArray(t.movements)) t.movements = [];
      for (const m of movements) if (!t.movements.some((n) => sameName(n, m.name))) t.movements.push(m.name);
    }

    if (existing) Object.keys(existing).forEach((k) => { if (!(k in w) && k !== 'savedAt' && k !== 'updatedAt') delete existing[k]; });
    if (existing) Object.assign(existing, w); else state.workouts.push(w);
    await save();
    closeSheet(); render();
    toast(existing ? 'Workout updated' : 'Workout saved 💪');
  });

  if (existing) {
    $('#wCopy').addEventListener('click', () => workoutSheet(null, existing));
    $('#wDel').addEventListener('click', async () => {
      if (!confirm(`Delete the ${existing.type} workout ${onDay(existing.date)}?`)) return;
      state.workouts = state.workouts.filter((x) => x.id !== existing.id);
      await save();
      closeSheet(); render();
      toast('Workout deleted');
    });
  }
}
// A distance as typed in the form: metres for swims, km otherwise (no thousands separators).
const showDistFor = (km, t) => (t.pace === '100m' ? String(Math.round(km * 1000)) : String(round(km, 2)));
// Every movement name in your types and workouts, so "squat" and "Squat" are the same movement in charts later.
function allMoveNames() {
  const seen = new Map();
  for (const t of state.workoutTypes) for (const n of t.movements || []) if (!seen.has(n.toLowerCase())) seen.set(n.toLowerCase(), n);
  for (const w of state.workouts) for (const m of w.movements || []) if (!seen.has(m.name.toLowerCase())) seen.set(m.name.toLowerCase(), m.name);
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}
// The spelling already used for a movement: this type's list first, then anywhere else.
const matchName = (name, t) => ((t && t.movements) || []).find((n) => sameName(n, name)) || allMoveNames().find((n) => sameName(n, name)) || name;

/* ---------- Managing workout types ---------- */
const workoutsOfType = (id) => state.workouts.filter((w) => w.typeId === id);
function typesSheet() {
  const scroll = !$('#sheet').classList.contains('hidden') && $('#sheetTitle').textContent === 'Workout types' ? $('.sheet-panel').scrollTop : 0;
  openSheet('Workout types', `
    <p class="muted small" style="margin-top:0">Tap a type to rename it, change its icon or edit its movements. Use the arrows to change the order they're shown in.</p>
    <div class="list" id="typeList">${state.workoutTypes.map((t, i) => {
      const n = workoutsOfType(t.id).length;
      const sub = [KINDS[t.kind], t.kind === 'strength' ? `${(t.movements || []).length} movement${(t.movements || []).length === 1 ? '' : 's'}` : '', n ? `${n} workout${n === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ');
      return `<div class="type-row">
        <button type="button" class="item${t.hidden ? ' faded' : ''}" data-type="${esc(t.id)}"><span class="ico" aria-hidden="true">${esc(t.icon)}</span>
          <div class="left"><div class="title">${esc(t.name)}${t.hidden ? ' <span class="tag">hidden</span>' : ''}</div><div class="sub">${esc(sub)}</div></div><span class="chev" aria-hidden="true">›</span></button>
        <div class="order"><button type="button" class="x-btn" data-up="${i}" ${i ? '' : 'disabled'} aria-label="Move ${esc(t.name)} up">↑</button>
          <button type="button" class="x-btn" data-down="${i}" ${i < state.workoutTypes.length - 1 ? '' : 'disabled'} aria-label="Move ${esc(t.name)} down">↓</button></div>
      </div>`;
    }).join('')}</div>
    <button type="button" class="btn secondary" id="typeNew">+ New workout type</button>`);
  $('.sheet-panel').scrollTop = scroll;
  $$('[data-type]').forEach((b) => b.addEventListener('click', () => typeSheet(b.dataset.type)));
  const move = async (i, j) => {
    const list = state.workoutTypes;
    [list[i], list[j]] = [list[j], list[i]];
    await save();
    typesSheet();
  };
  $$('[data-up]').forEach((b) => b.addEventListener('click', () => move(+b.dataset.up, +b.dataset.up - 1)));
  $$('[data-down]').forEach((b) => b.addEventListener('click', () => move(+b.dataset.down, +b.dataset.down + 1)));
  $('#typeNew').addEventListener('click', () => typeSheet(null));
}
$('#typesBtn').addEventListener('click', typesSheet);

function typeSheet(id) {
  const t = id ? state.workoutTypes.find((x) => x.id === id) : null;
  const used = t ? workoutsOfType(t.id).length : 0;
  let kind = t ? t.kind : 'strength';
  openSheet(t ? 'Edit workout type' : 'New workout type', `
    <form class="form" id="tForm" novalidate>
      <div class="grid-icon">
        <label>Icon <input id="tIcon" value="${esc(t ? t.icon : '💪')}" maxlength="8" autocomplete="off" style="text-align:center;font-size:22px;padding:8px"></label>
        <label>Name <input id="tName" value="${esc(t ? t.name : '')}" placeholder="e.g. CrossFit" maxlength="40" autocomplete="off"></label>
      </div>
      <div class="icons">${ICONS.map((i) => `<button type="button" data-icon="${i}" aria-label="Use ${i}">${i}</button>`).join('')}</div>
      <div><div class="small" style="font-weight:600;margin-bottom:6px">What you log</div>
        <div class="types" id="tKinds">${Object.entries(KINDS).map(([k, v]) => `<button type="button" data-k="${k}" ${used && k !== kind ? 'disabled' : ''}>${v}</button>`).join('')}</div>
        ${used ? `<div class="hint" style="margin-top:6px">${used} workout${used === 1 ? ' uses' : 's use'} this type, so this can't change. Make a new type instead.</div>` : ''}</div>
      <label id="tPaceWrap">Pace shown as <select id="tPace">${Object.entries(PACES).map(([k, v]) => `<option value="${k}" ${t && t.pace === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <div class="box" id="tMovesBox">
        <h3>Movements</h3>
        <div class="hint">Suggested first when you log this type. Renaming one here also renames it in your past ${esc(t ? t.name : '')} workouts.</div>
        <div id="tMoves" class="form" style="gap:6px"></div>
        <button type="button" class="mini-btn" id="tAddMove">+ Add movement</button>
      </div>
      <label class="check"><input type="checkbox" id="tHidden" ${t && t.hidden ? 'checked' : ''}> Hide from the list when logging a workout</label>
      <button class="btn" type="submit">${t ? 'Save' : 'Add type'}</button>
      ${t ? (used ? `<p class="hint" style="margin:0">Types with workouts can't be deleted — hide it instead.</p>` : `<button type="button" class="btn danger" id="tDel">Delete type</button>`) : ''}
      <button type="button" class="btn secondary" id="tBack">‹ Back to workout types</button>
    </form>`);
  const setKind = (k) => {
    kind = k;
    $$('#tKinds button').forEach((b) => b.classList.toggle('on', b.dataset.k === k));
    $('#tPaceWrap').classList.toggle('hidden', k !== 'cardio');
    $('#tMovesBox').classList.toggle('hidden', k !== 'strength');
  };
  $$('#tKinds button').forEach((b) => b.addEventListener('click', () => setKind(b.dataset.k)));
  $$('[data-icon]').forEach((b) => b.addEventListener('click', () => { $('#tIcon').value = b.dataset.icon; }));
  const addRow = (name) => {
    const row = document.createElement('div');
    row.className = 'move-row';
    row.innerHTML = `<input class="tm" value="${esc(name || '')}" placeholder="Movement name" aria-label="Movement name" autocomplete="off">
      <button type="button" class="x-btn" aria-label="Remove movement">✕</button>`;
    if (name) $('.tm', row).dataset.orig = name;
    $('.x-btn', row).addEventListener('click', () => row.remove());
    $('#tMoves').appendChild(row);
    return row;
  };
  for (const n of (t && t.movements) || []) addRow(n);
  $('#tAddMove').addEventListener('click', () => $('.tm', addRow()).focus());
  setKind(kind);
  $('#tBack').addEventListener('click', typesSheet);

  $('#tForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#tName').value.trim().replace(/\s+/g, ' ');
    if (!name) return toast('Give the type a name');
    const twin = state.workoutTypes.find((x) => x !== t && sameName(x.name, name));
    if (twin) return toast(`There's already a type called ${twin.name}`);
    const icon = $('#tIcon').value.trim() || '💪';
    // Movements: drop empty rows and repeats; renamed ones are renamed in this type's workouts too.
    const movements = [], renames = [];
    for (const i of $$('#tMoves .tm')) {
      const n = i.value.trim().replace(/\s+/g, ' ');
      if (!n || movements.some((m) => sameName(m, n))) continue;
      movements.push(n);
      if (i.dataset.orig && i.dataset.orig !== n) renames.push([i.dataset.orig, n]);
    }
    const entry = t || { id: uid() };
    Object.assign(entry, { name, icon, kind, pace: kind === 'cardio' ? $('#tPace').value : (t && t.pace) || 'km',
      movements: kind === 'strength' ? movements : (t && t.movements) || [], hidden: $('#tHidden').checked });
    if (!t) state.workoutTypes.push(entry);
    for (const w of workoutsOfType(entry.id)) {
      w.type = name;
      for (const m of w.movements || []) { const r = renames.find(([o]) => sameName(o, m.name)); if (r) m.name = r[1]; }
    }
    await save();
    render();
    toast(t ? 'Saved' : `${name} added`);
    typesSheet();
  });
  if (t && !used) $('#tDel').addEventListener('click', async () => {
    if (!confirm(`Delete the workout type ${t.name}?`)) return;
    state.workoutTypes = state.workoutTypes.filter((x) => x !== t);
    await save();
    typesSheet();
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
  { key: 'sleepScore', label: 'Sleep score', unit: '%', min: 0, max: 100, dp: 0, ph: 'e.g. 85' },
  { key: 'strain', label: 'Strain', unit: '0–21', min: 0, max: 21, dp: 1, ph: 'e.g. 12.4' }
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
      r.strain != null ? `Strain ${fmt(r.strain, 1)}` : ''].filter(Boolean).join(' · ');
    return `<button class="item" data-r="${r.id}">
      <span class="ico" aria-hidden="true">🔋</span>
      <div class="left"><div class="title">${esc(niceDate(r.date))}</div><div class="sub">${esc(sub) || '&nbsp;'}</div></div>
      <div class="amt" style="color:${recoveryColor(r.recoveryScore)}">${r.recoveryScore != null ? `${fmt(r.recoveryScore, 0)}%` : ''}</div></button>`;
  }).join('');
  $$('[data-r]', list).forEach((el) => el.addEventListener('click', () => recoverySheet(el.dataset.r)));
}
function recoverySheet(id) {
  const existing = id ? state.recoveryDays.find((r) => r.id === id) : null;
  const val = (f) => { const v = existing && existing[f.key]; if (v == null) return ''; if (f.key !== 'sleepHours') return v; const m = Math.round(v * 60); return `${Math.floor(m / 60)}:${pad(m % 60)}`; };
  openSheet(existing ? 'Edit recovery' : 'Recovery', `
    <form class="form" id="rForm" novalidate>
      <label>Date <input type="date" id="rDate" value="${esc(existing ? existing.date : today())}" required></label>
      <div class="grid2">
        ${RECOVERY_FIELDS.map((f) => `<label>${f.label} <span class="hint">${f.key === 'sleepHours' ? 'h:mm or hours' : f.unit}</span>
          <input id="r_${f.key}" inputmode="${f.key === 'sleepHours' ? 'text' : 'decimal'}" placeholder="${f.ph}" value="${esc(val(f))}" autocomplete="off"></label>`).join('')}
      </div>
      <div class="hint">Fill in whatever your watch or app shows; empty boxes are fine.</div>
      <button class="btn" type="submit">${existing ? 'Save changes' : 'Save'}</button>
      ${existing ? `<button type="button" class="btn danger" id="rDel">Delete</button>` : ''}
    </form>`);
  $('#rForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const date = $('#rDate').value;
    if (!date) return toast('Pick a date');
    const entry = { date, source: existing ? existing.source || 'manual' : 'manual' };
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
