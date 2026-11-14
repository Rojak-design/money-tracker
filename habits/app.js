/* Habits — daily, weekly and monthly habits with streaks and completion %, stored on this device in the shared
   Rojak store.

   Saved under 'mod:habits' (see ../core/store.js). Every entry has a date (YYYY-MM-DD), and the store adds
   `savedAt` / `updatedAt`:
     habits:  { id, name, kind: 'manual', freq: 'daily' | 'weekly' | 'monthly', target (times per week / month;
                1 for daily), date (the start date) }
     checks:  { id, habitId, date }   one per day a habit was ticked as done
   Periods are days, weeks (Monday to Sunday) or calendar months. Days, weeks and months before a habit's start
   date don't count. The first week or month, when the start date falls part-way through it, counts if the target
   was met but isn't held against you if it wasn't. The current day / week / month isn't counted as missed until
   it's over. */
'use strict';

/* ---------- State ---------- */
const emptyState = () => ({ habits: [], checks: [], settings: {} });
let state = emptyState();

async function load() {
  const saved = await Rojak.load('habits');
  state = Object.assign(emptyState(), saved || {});
  for (const k of ['habits', 'checks']) if (!Array.isArray(state[k])) state[k] = [];
  if (!state.settings || typeof state.settings !== 'object') state.settings = {};
  // The store treats entries in a list it dates for the first time as saved before Rojak (dated by their own
  // `date`). Saving the empty lists first means the first habit gets the real time it was saved.
  if (!saved) await save();
}
function save() {
  return Rojak.save('habits', state).catch((err) => {
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
const isISO = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
function addDays(iso, n) { const d = dayDate(iso); d.setDate(d.getDate() + n); return isoDay(d); }
function addMonths(iso, n) { const d = dayDate(iso.slice(0, 8) + '01'); d.setMonth(d.getMonth() + n); return isoDay(d); }
// Monday of the week a day is in.
function weekStart(iso) { const d = dayDate(iso); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return isoDay(d); }
const daysBetween = (a, b) => Math.round((dayDate(b) - dayDate(a)) / 864e5);
function niceDate(iso, withYear) {
  const d = dayDate(iso);
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short',
    year: withYear || d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2600);
}

/* ---------- Periods ---------- */
// How each kind of habit splits time into periods: where the period a day is in starts, the next period's start,
// and the period's last day.
const FREQS = {
  daily: { label: 'Daily', unit: 'day', units: 'days', start: (iso) => iso, next: (s) => addDays(s, 1), end: (s) => s },
  weekly: { label: 'Weekly', unit: 'week', units: 'weeks', start: weekStart, next: (s) => addDays(s, 7), end: (s) => addDays(s, 6) },
  monthly: { label: 'Monthly', unit: 'month', units: 'months', start: (iso) => iso.slice(0, 8) + '01', next: (s) => addMonths(s, 1), end: (s) => addDays(addMonths(s, 1), -1) }
};
const freqOf = (h) => FREQS[h.freq] || FREQS.daily;
const targetOf = (h) => (h.freq === 'daily' ? 1 : Math.max(1, +h.target || 1));
const started = (h, t = today()) => h.date <= t;
function freqText(h) {
  if (h.freq === 'weekly') return `${targetOf(h)}× a week`;
  if (h.freq === 'monthly') return targetOf(h) === 1 ? 'Once a month' : `${targetOf(h)}× a month`;
  return 'Daily';
}

// The days a habit was ticked, from its start date on.
function doneDays(h) {
  const s = new Set();
  for (const c of state.checks) if (c.habitId === h.id && c.date >= h.date) s.add(c.date);
  return s;
}
// How many times the habit was done in a period.
function countIn(days, from, to) {
  let n = 0;
  for (const d of days) if (d >= from && d <= to) n++;
  return n;
}

// Each period from the one the habit starts in up to the one today is in:
//   { start, end, value, target, status }
// status: 'met'      the target was reached
//         'missed'   the period is over and the target wasn't reached
//         'open'     today is in it and the target isn't reached yet (not counted)
//         'partial'  the first period began before the start date and the target wasn't reached (not counted)
function periods(h, t = today()) {
  const f = freqOf(h), target = targetOf(h), days = doneDays(h);
  const out = [];
  if (!started(h, t)) return out;
  const counts = {};
  for (const d of days) if (d <= t) { const k = f.start(d); counts[k] = (counts[k] || 0) + 1; }
  const last = f.start(t);
  for (let s = f.start(h.date); s <= last; s = f.next(s)) {
    const end = f.end(s), value = counts[s] || 0;
    let status;
    if (value >= target) status = 'met';
    else if (end >= t) status = 'open';
    else if (s < h.date) status = 'partial';
    else status = 'missed';
    out.push({ start: s, end, value, target, status });
  }
  return out;
}
// Streak (periods met in a row up to now; the current one counts once it's met), best streak and completion %.
function stats(h, t = today()) {
  const ps = periods(h, t);
  let met = 0, missed = 0, run = 0, best = 0;
  for (const p of ps) {
    if (p.status === 'met') { met++; run++; best = Math.max(best, run); }
    else if (p.status === 'missed' || p.status === 'partial') { if (p.status === 'missed') missed++; run = 0; }
  }
  // `run` is now the streak: an open period at the end doesn't break it.
  const counted = met + missed;
  return { periods: ps, current: ps[ps.length - 1] || null, streak: run, best, met, counted, pct: counted ? Math.round((met / counted) * 100) : null };
}

/* ---------- Ticking ---------- */
const isDone = (h, iso) => state.checks.some((c) => c.habitId === h.id && c.date === iso);
async function toggle(h, iso) {
  if (iso < h.date || iso > today()) return;
  const i = state.checks.findIndex((c) => c.habitId === h.id && c.date === iso);
  if (i >= 0) state.checks.splice(i, 1);
  else state.checks.push({ id: uid(), habitId: h.id, date: iso });
  await save();
  render();
}

/* ---------- Habit list ---------- */
const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
function plural(n, one, many) { return `${n} ${n === 1 ? one : many}`; }
function progressLine(h, st, t) {
  const p = st.current;
  if (!p || h.freq === 'daily') return '';
  const f = freqOf(h);
  const left = daysBetween(t, p.end);
  const word = h.freq === 'weekly' ? 'this week' : 'this month';
  const tail = p.value >= p.target ? ' · target met ✓' : left > 0 ? ` · ${plural(left, 'day', 'days')} left` : ' · last day';
  const pct = Math.min(100, Math.round((p.value / p.target) * 100));
  return `<div class="progress-line"><strong>${p.value} of ${p.target}</strong> ${word}${tail}${p.start < h.date ? ` <span class="muted">(started part-way through the ${f.unit})</span>` : ''}</div>
    <div class="bar"><div style="width:${pct}%"></div></div>`;
}
function habitCard(h, t) {
  const f = freqOf(h);
  if (!started(h, t)) {
    return `<div class="habit not-started">
      <div class="habit-top"><button type="button" class="habit-name" data-edit="${h.id}"><div class="title">${esc(h.name)}</div><div class="sub">${esc(freqText(h))}</div></button>
        <button type="button" class="tick" disabled aria-label="Not started yet">✓</button></div>
      <div class="starts">Starts on ${esc(niceDate(h.date))}</div></div>`;
  }
  const st = stats(h, t);
  const done = doneDays(h);
  let strip = '';
  for (let i = 6; i >= 0; i--) {
    const d = addDays(t, -i), before = d < h.date, on = done.has(d);
    strip += `<button type="button" class="wday${on ? ' on' : ''}${before ? ' before' : ''}${d === t ? ' today' : ''}" data-h="${h.id}" data-d="${d}" ${before ? 'disabled' : ''}
      aria-label="${esc(niceDate(d))}: ${before ? 'before the start date' : on ? 'done' : 'not done'}"><span>${DOW[(dayDate(d).getDay() + 6) % 7]}</span><span class="dot">${on ? '✓' : dayDate(d).getDate()}</span></button>`;
  }
  const todayOn = done.has(t);
  return `<div class="habit">
    <div class="habit-top"><button type="button" class="habit-name" data-edit="${h.id}"><div class="title">${esc(h.name)}</div><div class="sub">${esc(freqText(h))}</div></button>
      <button type="button" class="tick${todayOn ? ' on' : ''}" data-h="${h.id}" data-d="${t}" aria-pressed="${todayOn}" aria-label="${todayOn ? 'Done today (tap to undo)' : 'Tick as done today'}">✓</button></div>
    ${progressLine(h, st, t)}
    <div class="week-strip">${strip}</div>
    <div class="stats"><span>🔥 Streak <strong>${plural(st.streak, f.unit, f.units)}</strong></span><span>Best <strong>${st.best}</strong></span>
      <span>Done <strong>${st.pct == null ? '–' : st.pct + '%'}</strong>${st.counted ? ` (${st.met} of ${plural(st.counted, f.unit, f.units)})` : ''}</span></div>
  </div>`;
}
function render() {
  const t = today();
  $('#todayLabel').textContent = dayDate(t).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const el = $('#habits');
  if (!state.habits.length) {
    el.innerHTML = '<div class="empty">No habits yet.<br>Tap <strong>+</strong> to add one.</div>';
    return;
  }
  // Habits that have started first, then those starting later (soonest first).
  const list = state.habits.filter((h) => started(h, t)).concat(state.habits.filter((h) => !started(h, t)).sort((a, b) => a.date.localeCompare(b.date)));
  el.innerHTML = list.map((h) => habitCard(h, t)).join('');
  $$('[data-h]', el).forEach((b) => b.addEventListener('click', () => { const h = state.habits.find((x) => x.id === b.dataset.h); if (h) toggle(h, b.dataset.d); }));
  $$('[data-edit]', el).forEach((b) => b.addEventListener('click', () => habitForm(b.dataset.edit)));
}

/* ---------- Add / edit a habit ---------- */
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
$('#fab').addEventListener('click', () => habitForm(null));

function habitForm(id) {
  const ex = id ? state.habits.find((h) => h.id === id) : null;
  let freq = ex ? ex.freq : 'daily';
  openSheet(ex ? 'Edit habit' : 'New habit', `
    <form id="hForm" class="form" autocomplete="off">
      <label>Name<input id="hName" required maxlength="60" placeholder="e.g. Read 10 pages" value="${esc(ex ? ex.name : '')}"></label>
      <div class="label-t">How often</div>
      <div class="seg" id="hFreq">${Object.entries(FREQS).map(([k, v]) => `<button type="button" data-f="${k}" class="${k === freq ? 'on' : ''}">${v.label}</button>`).join('')}</div>
      <div id="hTimes" class="times"><input id="hTarget" type="number" inputmode="numeric" min="1" step="1" value="${ex && ex.freq !== 'daily' ? targetOf(ex) : 3}"><span id="hTimesWord"></span></div>
      <label>Start date<input id="hStart" type="date" required value="${esc(ex ? ex.date : today())}">
        <span class="hint">Today, or pick a past or future date. Days before it are greyed out and don't count against your streak or completion.</span></label>
      <button class="btn" type="submit">${ex ? 'Save' : 'Add habit'}</button>
      ${ex ? '<button class="btn danger" type="button" id="hDel">Delete habit</button>' : ''}
    </form>`);
  const showFreq = () => {
    $$('#hFreq button').forEach((b) => b.classList.toggle('on', b.dataset.f === freq));
    $('#hTimes').classList.toggle('hidden', freq === 'daily');
    $('#hTarget').max = freq === 'weekly' ? 7 : 31;
    $('#hTimesWord').textContent = freq === 'weekly' ? 'times per week' : 'times per month';
    if (freq === 'monthly' && !ex && !showFreq.touched) $('#hTarget').value = 1;
    if (freq === 'weekly' && !ex && !showFreq.touched) $('#hTarget').value = 3;
  };
  $('#hTarget').addEventListener('input', () => { showFreq.touched = true; });
  $$('#hFreq button').forEach((b) => b.addEventListener('click', () => { freq = b.dataset.f; showFreq(); }));
  showFreq();
  if (!ex) setTimeout(() => $('#hName').focus(), 50);

  $('#hForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#hName').value.trim();
    const date = $('#hStart').value;
    const target = freq === 'daily' ? 1 : Math.round(+$('#hTarget').value);
    if (!name) return toast('Give the habit a name');
    if (!isISO(date)) return toast('Pick a start date');
    if (freq !== 'daily' && !(target >= 1 && target <= (freq === 'weekly' ? 7 : 31))) return toast(freq === 'weekly' ? 'Times per week: 1 to 7' : 'Times per month: 1 to 31');
    if (ex) Object.assign(ex, { name, freq, target, date });
    else state.habits.push({ id: uid(), name, kind: 'manual', freq, target, date });
    await save();
    closeSheet();
    render();
    toast(ex ? 'Saved' : date > today() ? `Added — starts on ${niceDate(date)}` : 'Habit added');
  });
  if (ex) $('#hDel').addEventListener('click', async () => {
    if (!confirm(`Delete “${ex.name}” and every day ticked for it?`)) return;
    state.habits = state.habits.filter((h) => h.id !== ex.id);
    state.checks = state.checks.filter((c) => c.habitId !== ex.id);
    await save();
    closeSheet();
    render();
    toast('Habit deleted');
  });
}

/* ---------- Start ---------- */
async function init() {
  try {
    await load();
  } catch (err) {
    console.error(err);
    $('#habits').innerHTML = '<div class="empty">Could not open storage on this browser.</div>';
    return;
  }
  render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('../sw.js').catch(() => {});
}
init();
// Coming back to the app on a new day (or from another screen) shows today.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && $('#sheet').classList.contains('hidden')) render(); });
