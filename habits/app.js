/* Habits — daily, weekly and monthly habits with streaks and completion %, stored on this device in the shared
   Rojak store.

   Saved under 'mod:habits' (see ../core/store.js). Every entry has a date (YYYY-MM-DD), and the store adds
   `savedAt` / `updatedAt`:
     habits:  { id, name, kind: 'manual' | 'linked', freq: 'daily' | 'weekly' | 'monthly', target, date (the start
                date), rule (linked habits only): { id (see rules.js), …the rule's choices, e.g. cats or accounts } }
              target: times per week / month for manual habits (1 for daily); for linked habits the number to reach
              in the rule's unit (runs, S$ saved…)
     checks:  { id, habitId, date }   one per day a manual habit was ticked as done
   Linked habits are checked automatically from another module's data (read only; see rules.js). Daily linked
   habits (Water: bottles a day) are done on a day when that day's value reaches the target.

   Periods are days, weeks (Monday to Sunday) or calendar months (Money habits: pay cycles when a payday is set).
   Days, weeks and months before a habit's start date don't count. The first week or month, when the start date
   falls part-way through it, counts if the target was met but isn't held against you if it wasn't. The current
   day / week / month isn't counted as missed until it's over. */
'use strict';

/* ---------- State ---------- */
const emptyState = () => ({ habits: [], checks: [], settings: {} });
let state = emptyState();
// Other modules' data, read for linked habits (never saved from here): { money, fitness, … }.
const src = {};

async function load() {
  const saved = await Rojak.load('habits');
  state = Object.assign(emptyState(), saved || {});
  for (const k of ['habits', 'checks']) if (!Array.isArray(state[k])) state[k] = [];
  if (!state.settings || typeof state.settings !== 'object') state.settings = {};
  HabitsEngine.use(state, src);
  // The store treats entries in a list it dates for the first time as saved before Rojak (dated by their own
  // `date`). Saving the empty lists first means the first habit gets the real time it was saved.
  if (!saved) await save();
  await loadSources();
}
async function loadSources() {
  for (const id of new Set(HABIT_RULES.map((r) => r.module))) {
    try { src[id] = (await Rojak.load(id)) || null; } catch (err) { console.error(err); src[id] = null; }
  }
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
const shortDate = (iso) => dayDate(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2600);
}

/* ---------- Periods, progress and streaks: shared with the home screen (engine.js) ---------- */
const { FREQS, freqOf, isLinked, ruleOf, ruleReady, kindOf, targetOf, started, atMost, periodWord, usesCycles, spanOf, firstDay, measure, doneDays, periods, stats, plural, freqText, progressText } = HabitsEngine;

/* ---------- Ticking ---------- */
const isDone = (h, iso) => state.checks.some((c) => c.habitId === h.id && c.date === iso);
async function toggle(h, iso) {
  if (isLinked(h) || iso < h.date || iso > today()) return;
  const i = state.checks.findIndex((c) => c.habitId === h.id && c.date === iso);
  if (i >= 0) state.checks.splice(i, 1);
  else state.checks.push({ id: uid(), habitId: h.id, date: iso });
  await save();
  render();
}

/* ---------- Habit list ---------- */
const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const monthName = (ym, style = 'short') => dayDate(ym + '-01').toLocaleDateString(undefined, { month: style, year: 'numeric' });
// The month (YYYY-MM) or year shown for each habit; this month / this year unless you've moved it.
const shownMonth = {}, shownYear = {};

// This week's or month's progress, e.g. "2 of 3 this week · 2 days left".
function progressLine(h, st, t) {
  const p = st.current;
  if (!p) return '';
  if (h.freq === 'daily' && isLinked(h)) {
    // Daily linked habits (e.g. water): today's amount against the target.
    const pct = p.target > 0 ? Math.max(0, Math.min(100, Math.round((p.value / p.target) * 100))) : 0;
    return `<div class="progress-line"><strong>${esc(progressText(h, p.value, p.target))}</strong> today${p.status === 'met' ? ' · target met ✓' : ''}</div>
      <div class="bar"><div style="width:${pct}%"></div></div>`;
  }
  if (h.freq === 'daily') return `<div class="progress-line">${p.status === 'met' ? '<strong>Done today ✓</strong>' : 'Not done yet today'}</div>`;
  const left = daysBetween(t, p.end);
  const word = `this ${periodWord(h)}${usesCycles(h) ? ` (${shortDate(p.start)} – ${shortDate(p.end)})` : ''}`;
  const r = ruleOf(h), extra = r && r.extra && ruleReady(r) ? r.extra(src, h.rule, t) : '';
  if (p.nodata) {
    return `<div class="progress-line muted">Not tracked ${esc(word)}: ${esc(r.noDataWhy ? r.noDataWhy(src, h.rule, p) : 'there\'s no data from its start')}. Tracking starts with the next ${periodWord(h)} (from ${esc(shortDate(addDays(p.end, 1)))}).</div>${extra ? `<div class="extra-line">${esc(extra)}</div>` : ''}`;
  }
  const limit = atMost(h), over = limit && p.value > p.target;
  // Judged when the period ends (savings): what's saved so far and how much can still be spent, or how far short.
  const atEnd = r && r.judgeAtEnd && p.status === 'open', short = atEnd && p.value < p.target;
  const until = left > 0 ? ` · ${plural(left, 'day', 'days')} left` : ' · last day';
  const tail = over ? ' · over the limit' : atEnd ? (usesCycles(h) ? until : ` until ${shortDate(p.end)}${until}`) : p.status === 'met' ? ' · target met ✓' : until;
  const pct = p.target > 0 ? Math.max(0, Math.min(100, Math.round((p.value / p.target) * 100))) : p.status === 'met' ? 100 : 0;
  const text = atEnd && r.soFar ? r.soFar(p.value, p.target, src, h.rule) : progressText(h, p.value, p.target);
  return `<div class="progress-line${over || short ? ' over' : ''}"><strong>${esc(text)}</strong> ${esc(word)}${tail}${p.start < firstDay(h) && !(r && r.wholePeriod) ? ` <span class="muted">(started part-way through the ${periodWord(h)})</span>` : ''}</div>
    <div class="bar${limit ? ' limit' : ''}${over || short ? ' over' : ''}"><div style="width:${pct}%"></div></div>${extra ? `<div class="extra-line">${esc(extra)}</div>` : ''}`;
}
function statsHtml(h, st) {
  const u = periodWord(h), us = u === 'pay cycle' ? 'pay cycles' : u + 's';
  return `<div class="stats"><span>🔥 Streak <strong>${plural(st.streak, u, us)}</strong></span><span>Best <strong>${st.best}</strong></span>
    <span>Done <strong>${st.pct == null ? '–' : st.pct + '%'}</strong>${st.counted ? ` (${st.met} of ${plural(st.counted, u, us)})` : ''}</span></div>`;
}

// A month calendar, Monday to Sunday: filled squares for days done, grey before the start date. Weekly habits get
// a ✓ at the end of each week that met its target (or "2/3" for this week so far). Tap a day to tick or untick it
// (manual habits; linked habits fill in by themselves).
function monthGrid(h, ym, t, opts = {}) {
  const first = ym + '-01', last = addDays(addMonths(first, 1), -1);
  const done = doneDays(h, first, last < t ? last : t);
  const start = firstDay(h), linked = isLinked(h);
  const weekly = h.freq === 'weekly' && !opts.big;
  const byStart = {};
  if (weekly) for (const p of periods(h, t)) byStart[p.start] = p;
  let cells = DOW.map((x) => `<span class="dow">${x}</span>`).join('') + (weekly ? '<span class="dow"></span>' : '');
  for (let ws = weekStart(first); ws <= last; ws = addDays(ws, 7)) {
    for (let i = 0; i < 7; i++) {
      const d = addDays(ws, i);
      if (d.slice(0, 7) !== ym) { cells += '<span class="sq blank"></span>'; continue; }
      const n = +d.slice(8);
      if (d < start) { cells += `<span class="sq before" aria-label="${esc(niceDate(d))}: before the start date">${opts.big ? n : ''}</span>`; continue; }
      if (d > t) { cells += `<span class="sq future">${opts.big ? n : ''}</span>`; continue; }
      const on = done.has(d), cls = `sq${on ? ' on' : ''}${d === t ? ' today' : ''}`, label = `${esc(niceDate(d))}: ${on ? 'done' : 'not done'}`;
      cells += linked ? `<span class="${cls} auto" aria-label="${label}">${opts.big || d === t ? n : ''}</span>`
        : `<button type="button" class="${cls}" data-h="${h.id}" data-d="${d}" aria-label="${label}" aria-pressed="${on}">${opts.big || d === t ? n : ''}</button>`;
    }
    if (weekly) {
      const p = byStart[ws];
      cells += p && p.status === 'met' ? '<span class="wk met" title="Target met">✓</span>'
        : p && p.status === 'missed' && atMost(h) ? '<span class="wk over" title="Over the limit">✕</span>'
        : p && p.status === 'open' && !atMost(h) && Number.isInteger(p.value) && p.target < 100 ? `<span class="wk open" title="This week so far">${p.value}/${p.target}</span>`
          : '<span class="wk"></span>';
    }
  }
  return `<div class="grid${weekly ? ' weekly' : ''}${opts.big ? ' big' : ''}">${cells}</div>`;
}
// The month calendar with ‹ › (or swipe) to look at earlier months, back to the month the habit started.
function miniMonth(h, t) {
  const min = firstDay(h).slice(0, 7), max = t.slice(0, 7);
  let ym = shownMonth[h.id] || max;
  if (ym < min) ym = min;
  if (ym > max) ym = max;
  return `<div class="mini" data-swipe="${h.id}">
    <div class="mini-head"><button type="button" class="arrow" data-mm="${h.id}" data-k="-1" ${ym <= min ? 'disabled' : ''} aria-label="Earlier month">‹</button>
      <span>${esc(monthName(ym))}</span>
      <button type="button" class="arrow" data-mm="${h.id}" data-k="1" ${ym >= max ? 'disabled' : ''} aria-label="Later month">›</button></div>
    ${monthGrid(h, ym, t)}</div>`;
}
// Monthly habits: Jan to Dec in one row, filled when the month's target was met, this month outlined. (Money habits
// with a payday: each square is the pay cycle named after that month.)
function yearRow(h, st, t) {
  const firstMonth = spanOf(h, firstDay(h)).month, nowMonth = spanOf(h, t).month;
  const min = +firstMonth.slice(0, 4), max = +nowMonth.slice(0, 4);
  let y = shownYear[h.id] || max;
  if (y < min) y = min;
  if (y > max) y = max;
  const byMonth = {};
  for (const p of st.periods) byMonth[p.month] = p;
  let cells = '';
  for (let m = 1; m <= 12; m++) {
    const key = `${y}-${pad(m)}`, p = byMonth[key];
    const label = dayDate(key + '-01').toLocaleDateString(undefined, { month: 'long' });
    let cls = 'mo', what;
    if (key < firstMonth) { cls += ' before'; what = 'before the start date'; }
    else if (key > nowMonth) { cls += ' future'; what = 'not yet'; }
    else if (p && p.nodata) { cls += ' nodata'; what = 'not tracked (no balance from before it began)'; }
    else if (p && p.status === 'met') { cls += ' on'; what = `target met (${progressText(h, p.value, p.target)})`; }
    else { what = p ? progressText(h, p.value, p.target) : ''; if (p && p.status === 'missed' && atMost(h)) cls += ' over'; }
    if (key === nowMonth) cls += ' now';
    const tap = !cls.includes('before') && !cls.includes('future');
    const inner = !isLinked(h) && p && p.value && p.status !== 'met' ? p.value : '';
    cells += `<div class="mo-cell"><${tap ? `button type="button" data-month="${h.id}" data-s="${key}"` : 'span'} class="${cls}" aria-label="${esc(label)}: ${esc(what)}">${inner}</${tap ? 'button' : 'span'}><span class="mo-l">${MONTHS[m - 1]}</span></div>`;
  }
  return `<div class="year">
    <div class="mini-head"><button type="button" class="arrow" data-yy="${h.id}" data-k="-1" ${y <= min ? 'disabled' : ''} aria-label="Earlier year">‹</button>
      <span>${y}</span>
      <button type="button" class="arrow" data-yy="${h.id}" data-k="1" ${y >= max ? 'disabled' : ''} aria-label="Later year">›</button></div>
    <div class="months">${cells}</div></div>`;
}
function habitCard(h, t) {
  const r = ruleOf(h);
  const name = `<button type="button" class="habit-name" data-edit="${h.id}"><div class="title">${esc(h.name)}</div><div class="sub">${esc(freqText(h))}</div></button>`;
  const first = firstDay(h);
  if (!started(h, t) || first > t) {
    return `<div class="habit not-started"><div class="habit-top">${name}<span class="tick" aria-hidden="true">${isLinked(h) && r ? r.icon : '✓'}</span></div>
      <div class="starts">Starts on ${esc(niceDate(first))}${first > h.date ? ` <span class="muted">(${r ? `${esc(r.moduleName)} has data from then` : ''})</span>` : ''}</div></div>`;
  }
  const st = stats(h, t);
  let badge;
  if (isLinked(h)) {
    const met = st.current && st.current.status === 'met';
    badge = `<span class="tick auto${met ? ' on' : ''}" title="Checked automatically from ${esc(r ? r.moduleName : 'another module')}">${met ? '✓' : r ? r.icon : '🔗'}</span>`;
  } else {
    const on = isDone(h, t);
    badge = `<button type="button" class="tick${on ? ' on' : ''}" data-h="${h.id}" data-d="${t}" aria-pressed="${on}" aria-label="${on ? 'Done today (tap to undo)' : 'Tick as done today'}">✓</button>`;
  }
  const warn = isLinked(h) && !ruleReady(r) ? `<div class="warn-line">${r ? `Nothing saved in ${esc(r.moduleName)} yet, so this counts as 0.` : 'This habit\'s rule isn\'t available in this version.'}</div>` : '';
  const head = `<div class="habit-top">${name}${badge}</div>${warn}`;
  if (h.freq === 'monthly') return `<div class="habit">${head}${yearRow(h, st, t)}${progressLine(h, st, t)}${statsHtml(h, st)}</div>`;
  return `<div class="habit">${head}<div class="habit-body">${miniMonth(h, t)}<div class="side">${progressLine(h, st, t)}${statsHtml(h, st)}</div></div></div>`;
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
  const now = (h) => started(h, t) && firstDay(h) <= t;
  const list = state.habits.filter(now).concat(state.habits.filter((h) => !now(h)).sort((a, b) => firstDay(a).localeCompare(firstDay(b))));
  el.innerHTML = list.map((h) => habitCard(h, t)).join('');
  const habit = (id) => state.habits.find((x) => x.id === id);
  $$('[data-h]', el).forEach((b) => b.addEventListener('click', () => { const h = habit(b.dataset.h); if (h) toggle(h, b.dataset.d); }));
  $$('[data-edit]', el).forEach((b) => b.addEventListener('click', () => habitForm(b.dataset.edit)));
  $$('[data-mm]', el).forEach((b) => b.addEventListener('click', () => moveMonth(b.dataset.mm, +b.dataset.k)));
  $$('[data-yy]', el).forEach((b) => b.addEventListener('click', () => {
    const h = habit(b.dataset.yy);
    shownYear[h.id] = (shownYear[h.id] || +spanOf(h, t).month.slice(0, 4)) + +b.dataset.k;
    render();
  }));
  $$('[data-month]', el).forEach((b) => b.addEventListener('click', () => monthSheet(b.dataset.month, b.dataset.s)));
  // Swipe a calendar left or right for the next or previous month.
  $$('[data-swipe]', el).forEach((box) => {
    let x0 = null, y0 = 0;
    box.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
    box.addEventListener('touchend', (e) => {
      if (x0 == null) return;
      const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
      x0 = null;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) moveMonth(box.dataset.swipe, dx < 0 ? 1 : -1);
    });
  });
}
function moveMonth(id, k) {
  const h = state.habits.find((x) => x.id === id), t = today();
  if (!h) return;
  const next = addMonths((shownMonth[id] || t.slice(0, 7)) + '-01', k).slice(0, 7);
  if (next < firstDay(h).slice(0, 7) || next > t.slice(0, 7)) return;
  shownMonth[id] = next;
  render();
}
// Monthly habits: tap a month to tick or untick its days (manual), or see how it went (linked).
function monthSheet(id, ym) {
  const h = state.habits.find((x) => x.id === id);
  if (!h) return;
  const t = today();
  const draw = () => {
    const p = periods(h, t).find((x) => x.month === ym);
    const r = ruleOf(h);
    if (isLinked(h)) {
      openSheet(`${h.name} · ${monthName(ym, 'long')}`, p ? `
        <p style="margin-top:0"><strong>${esc(progressText(h, p.value, p.target))}</strong>${p.status === 'met' ? ' — target met ✓' : p.status === 'open' ? ' so far' : p.status === 'partial' ? (p.nodata ? ` — not tracked: ${r && r.noDataWhy ? r.noDataWhy(src, h.rule, p) : 'no data from its start'}` : ' (first, part-way month: not counted)') : ' — missed'}</p>
        <p class="muted small">${esc(shortDate(p.start))} – ${esc(niceDate(p.end, true))}${p.word ? ` (${esc(p.word)})` : ''}. Checked automatically from ${esc(r ? r.moduleName : 'another module')}.</p>
        <button class="btn" type="button" data-close>Done</button>` : '<p class="muted">Nothing for this month.</p>');
      return;
    }
    openSheet(`${h.name} · ${monthName(ym, 'long')}`, `
      <p class="muted small" style="margin-top:0">${p ? `<strong>${p.value} of ${p.target}</strong> this month${p.status === 'met' ? ' — target met ✓' : ''}. ` : ''}Tap a day to tick or untick it.</p>
      ${monthGrid(h, ym, t, { big: true })}
      <button class="btn" type="button" data-close style="margin-top:16px">Done</button>`);
    $$('#sheetBody [data-h]').forEach((b) => b.addEventListener('click', async () => { await toggle(h, b.dataset.d); draw(); }));
  };
  draw();
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

const MODULES = [...new Map(HABIT_RULES.map((r) => [r.module, r.moduleName])).entries()];
function habitForm(id) {
  const ex = id ? state.habits.find((h) => h.id === id) : null;
  let kind = ex && isLinked(ex) ? 'linked' : 'manual';
  let freq = ex ? ex.freq : 'daily';
  // Linked: the chosen rule, its choices and its period.
  let rule = (ex && ruleOf(ex)) || HABIT_RULES[0];
  let ropts = ex && isLinked(ex) && ex.rule ? ex.rule : null;
  let period = ex && isLinked(ex) ? kindOf(ex) : rule.periods[0];
  let targetTouched = !!ex;
  openSheet(ex ? 'Edit habit' : 'New habit', `
    <form id="hForm" class="form" autocomplete="off">
      <div class="seg" id="hKind"><button type="button" data-k="manual">✋ Manual</button><button type="button" data-k="linked">🔗 Linked</button></div>
      <p class="hint" id="hKindHint" style="margin:-6px 0 0"></p>
      <label>Name<input id="hName" maxlength="60" placeholder="e.g. Read 10 pages" value="${esc(ex ? ex.name : '')}"></label>
      <div id="manualBox" class="form">
        <div class="label-t">How often</div>
        <div class="seg" id="hFreq">${Object.entries(FREQS).map(([k, v]) => `<button type="button" data-f="${k}">${v.label}</button>`).join('')}</div>
        <div id="hTimes" class="times"><input id="hTarget" type="number" inputmode="numeric" min="1" step="1" value="${ex && !isLinked(ex) && ex.freq !== 'daily' ? targetOf(ex) : 3}"><span id="hTimesWord"></span></div>
      </div>
      <div id="linkedBox" class="form">
        <label>Module<select id="lModule">${MODULES.map(([m, n]) => `<option value="${m}">${esc(n)}</option>`).join('')}</select></label>
        <label>What to measure<select id="lRule"></select></label>
        <div id="lUnavailable" class="warn-line hidden"></div>
        <div id="lOpts" class="form"></div>
        <div class="label-t">Over each</div>
        <div class="seg" id="lPeriod"></div>
        <div class="times" id="lTargetRow"><span id="lDir">At least</span><input id="lTarget" type="number" inputmode="decimal" min="0" step="any"><span id="lUnit"></span></div>
      </div>
      <label>Start date<input id="hStart" type="date" required value="${esc(ex ? ex.date : today())}">
        <span class="hint">Today, or pick a past or future date. Days before it are greyed out and don't count against your streak or completion.</span></label>
      <button class="btn" type="submit" id="hSave">${ex ? 'Save' : 'Add habit'}</button>
      ${ex ? '<button class="btn danger" type="button" id="hDel">Delete habit</button>' : ''}
    </form>`);

  const showKind = () => {
    $$('#hKind button').forEach((b) => b.classList.toggle('on', b.dataset.k === kind));
    $('#manualBox').classList.toggle('hidden', kind !== 'manual');
    $('#linkedBox').classList.toggle('hidden', kind !== 'linked');
    $('#hKindHint').textContent = kind === 'manual' ? 'You tick it off yourself.' : 'Checked automatically from another module\'s data.';
    $('#hName').placeholder = kind === 'manual' ? 'e.g. Read 10 pages' : 'Leave empty for a name like the one below';
    if (kind === 'linked') showRule();
  };
  const showFreq = () => {
    $$('#hFreq button').forEach((b) => b.classList.toggle('on', b.dataset.f === freq));
    $('#hTimes').classList.toggle('hidden', freq === 'daily');
    $('#hTarget').max = freq === 'weekly' ? 7 : 31;
    $('#hTimesWord').textContent = freq === 'weekly' ? 'times per week' : 'times per month';
    if (freq === 'monthly' && !ex && !showFreq.touched) $('#hTarget').value = 1;
    if (freq === 'weekly' && !ex && !showFreq.touched) $('#hTarget').value = 3;
  };
  // Linked: the module's rules, the rule's choices, its periods and the target's unit.
  const readOpts = () => { const o = rule.readOptions($('#lOpts'), src); return typeof o === 'string' ? null : o; };
  // 'pay cycle' / 'statement' when the rule's months are those, otherwise 'week' / 'month'.
  const wordFor = (p, o) => (p === 'month' && rule.period && src[rule.module] && rule.period(src, 'month', today(), o || readOpts() || {}).word) || p;
  const showUnit = () => {
    const o = readOpts() || ropts || {};
    $('#lUnit').textContent = rule.targetLabel(o, src);
    $('#lDir').textContent = rule.atMost ? 'At most' : 'At least';
    $('#lTargetRow').classList.toggle('hidden', !!rule.autoTarget);
    const t = +$('#lTarget').value;
    $('#hName').placeholder = readOpts() && (t > 0 || rule.autoTarget) ? `Leave empty for “${rule.defaultName(readOpts(), t, wordFor(period), src)}”` : '';
    $$('#lPeriod button').forEach((b) => { if (b.dataset.p === 'month') b.textContent = wordFor('month') === 'month' ? 'Month' : `Month (${wordFor('month')})`; });
  };
  const showPeriod = () => {
    $('#lPeriod').innerHTML = rule.periods.map((p) => `<button type="button" data-p="${p}" class="${p === period ? 'on' : ''}">${p === 'week' ? 'Week (Mon–Sun)' : p === 'day' ? 'Day' : 'Month'}</button>`).join('');
    $$('#lPeriod button').forEach((b) => b.addEventListener('click', () => { period = b.dataset.p; if (!targetTouched) $('#lTarget').value = rule.defaultTarget[period]; showPeriod(); }));
    showUnit();
  };
  const showRule = () => {
    $('#lModule').value = rule.module;
    $('#lRule').innerHTML = HABIT_RULES.filter((r) => r.module === rule.module).map((r) => `<option value="${r.id}" ${r.id === rule.id ? 'selected' : ''}>${esc(r.label)}</option>`).join('');
    const why = !src[rule.module] && !rule.alwaysReady ? `Nothing saved in ${rule.moduleName} yet.` : rule.unavailable ? rule.unavailable(src) : '';
    $('#lUnavailable').textContent = why;
    $('#lUnavailable').classList.toggle('hidden', !why);
    $('#lOpts').innerHTML = why ? '' : rule.optionsHtml(src, ropts && ropts.id === rule.id ? ropts : null);
    if (!why && rule.bind) rule.bind($('#lOpts'), src);
    if (!rule.periods.includes(period)) period = rule.periods[0];
    if (!targetTouched) $('#lTarget').value = rule.defaultTarget[period];
    else if (ex && isLinked(ex) && ex.rule && ex.rule.id === rule.id && !$('#lTarget').value) $('#lTarget').value = ex.target;
    showPeriod();
  };
  $$('#hKind button').forEach((b) => b.addEventListener('click', () => { kind = b.dataset.k; showKind(); }));
  $('#hTarget').addEventListener('input', () => { showFreq.touched = true; });
  $$('#hFreq button').forEach((b) => b.addEventListener('click', () => { freq = b.dataset.f; showFreq(); }));
  $('#lModule').addEventListener('change', () => { rule = HABIT_RULES.find((r) => r.module === $('#lModule').value); targetTouched = false; ropts = null; period = rule.periods[0]; showRule(); });
  $('#lRule').addEventListener('change', () => { rule = ruleById($('#lRule').value); targetTouched = false; ropts = null; period = rule.periods[0]; showRule(); });
  $('#lTarget').addEventListener('input', () => { targetTouched = true; showUnit(); });
  $('#lOpts').addEventListener('change', showUnit);
  if (ex && isLinked(ex)) $('#lTarget').value = ex.target;
  showFreq();
  showKind();
  if (!ex) setTimeout(() => $('#hName').focus(), 50);

  $('#hForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    let name = $('#hName').value.trim();
    const date = $('#hStart').value;
    if (!isISO(date)) return toast('Pick a start date');
    let data;
    if (kind === 'manual') {
      const target = freq === 'daily' ? 1 : Math.round(+$('#hTarget').value);
      if (!name) return toast('Give the habit a name');
      if (freq !== 'daily' && !(target >= 1 && target <= (freq === 'weekly' ? 7 : 31))) return toast(freq === 'weekly' ? 'Times per week: 1 to 7' : 'Times per month: 1 to 31');
      data = { name, kind, freq, target, date };
    } else {
      if ((!src[rule.module] && !rule.alwaysReady) || (rule.unavailable && rule.unavailable(src))) return toast($('#lUnavailable').textContent || `Nothing saved in ${rule.moduleName} yet`);
      const o = rule.readOptions($('#lOpts'), src);
      if (typeof o === 'string') return toast(o);
      const target = rule.autoTarget ? 0 : Math.round(+$('#lTarget').value * 100) / 100;
      if (!rule.autoTarget && !(target > 0)) return toast('Set a target above 0');
      if (rule.maxTarget && target > rule.maxTarget) return toast(`The target can be at most ${rule.maxTarget}`);
      const f = period === 'week' ? 'weekly' : period === 'day' ? 'daily' : 'monthly';
      if (!name) name = rule.defaultName(o, target, wordFor(period, o), src);
      data = { name, kind, freq: f, target, date, rule: Object.assign({ id: rule.id }, o) };
    }
    if (ex) { Object.assign(ex, data); if (kind === 'manual') delete ex.rule; }
    else state.habits.push(Object.assign({ id: uid() }, data));
    await save();
    closeSheet();
    render();
    toast(ex ? 'Saved' : date > today() ? `Added — starts on ${niceDate(date)}` : 'Habit added');
  });
  if (ex) $('#hDel').addEventListener('click', async () => {
    if (!confirm(`Delete “${ex.name}”${isLinked(ex) ? '' : ' and every day ticked for it'}? (Nothing in other modules is changed.)`)) return;
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
// Coming back to the app (e.g. after logging a run in Fitness, or on a new day) shows fresh numbers.
async function refresh() {
  if (!$('#sheet').classList.contains('hidden')) return;
  try { await loadSources(); } catch (err) { console.error(err); }
  render();
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
window.addEventListener('pageshow', (e) => { if (e.persisted) refresh(); });
