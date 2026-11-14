/* Habits engine: periods, progress, streaks and "at risk", without any screen code, so the Habits page and the
   Rojak home screen work them out the same way. Uses the rules in rules.js for linked habits.

   HabitsEngine.use(state, src) gives it the habits data (mod:habits) and other modules' data ({ money, fitness });
   then e.g. HabitsEngine.stats(habit) or HabitsEngine.summary(). */
'use strict';

const HabitsEngine = (() => {
  let state = { habits: [], checks: [] }, src = {};
  const use = (s, sources) => { state = s || { habits: [], checks: [] }; src = sources || {}; };

  const pad = (n) => String(n).padStart(2, '0');
  const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => isoDay(new Date());
  const dayDate = (iso) => new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  function addDays(iso, n) { const d = dayDate(iso); d.setDate(d.getDate() + n); return isoDay(d); }
  function addMonths(iso, n) { const d = dayDate(iso.slice(0, 8) + '01'); d.setMonth(d.getMonth() + n); return isoDay(d); }
  function weekStart(iso) { const d = dayDate(iso); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return isoDay(d); }
  const daysBetween = (a, b) => Math.round((dayDate(b) - dayDate(a)) / 864e5);

  /* ---------- Periods ---------- */
  // How each kind of habit splits time into periods: where the period a day is in starts, and its last day.
  const FREQS = {
    daily: { label: 'Daily', unit: 'day', units: 'days', start: (iso) => iso, end: (s) => s },
    weekly: { label: 'Weekly', unit: 'week', units: 'weeks', start: weekStart, end: (s) => addDays(s, 6) },
    monthly: { label: 'Monthly', unit: 'month', units: 'months', start: (iso) => iso.slice(0, 8) + '01', end: (s) => addDays(addMonths(s, 1), -1) }
  };
  const freqOf = (h) => FREQS[h.freq] || FREQS.daily;
  const isLinked = (h) => h.kind === 'linked';
  const ruleOf = (h) => (isLinked(h) && h.rule ? ruleById(h.rule.id) || null : null);
  // The rule can read its module's data (a linked habit whose module has nothing saved counts as 0).
  const ruleReady = (r) => !!(r && src[r.module]);
  const kindOf = (h) => (h.freq === 'weekly' ? 'week' : 'month');
  const targetOf = (h) => (isLinked(h) ? Math.max(0, +h.target || 0) : h.freq === 'daily' ? 1 : Math.max(1, +h.target || 1));
  const started = (h, t = today()) => h.date <= t;
  const atMost = (h) => { const r = ruleOf(h); return !!(r && r.atMost); };
  // What a period is called: day, week, month, or (Money) pay cycle / card statement.
  const periodWord = (h) => (h.freq === 'weekly' ? 'week' : h.freq === 'daily' ? 'day' : spanOf(h, today()).word || 'month');
  const usesCycles = (h) => periodWord(h) !== 'month' && h.freq === 'monthly';

  // The week / month a day is in: { start, end, month ('YYYY-MM' the period is named after) }.
  function spanOf(h, iso) {
    const r = ruleOf(h);
    if (ruleReady(r) && r.period) return r.period(src, kindOf(h), iso, h.rule);
    const f = freqOf(h), s = f.start(iso);
    return { start: s, end: f.end(s), month: s.slice(0, 7) };
  }
  // The first day that counts: the start date, or later when the linked module has no data before then (e.g. a
  // bank account's balance is only known from its start date).
  function firstDay(h) {
    const r = ruleOf(h);
    const ds = ruleReady(r) && r.dataStart ? r.dataStart(src, h.rule) : '';
    return ds > h.date ? ds : h.date;
  }
  // What the habit reached from..to: { value, days } — ticks for manual habits, the rule's measure for linked ones.
  function measure(h, from, to) {
    const r = ruleOf(h);
    if (isLinked(h)) return ruleReady(r) ? r.measure(src, h.rule, from, to) : { value: 0, days: [] };
    const days = [];
    for (const c of state.checks) if (c.habitId === h.id && c.date >= from && c.date <= to) days.push(c.date);
    return { value: new Set(days).size, days };
  }
  // The days to fill in on the calendar (days ticked, or days the linked module counted), from the first day on.
  function doneDays(h, from, to) {
    const f = firstDay(h);
    return new Set(measure(h, from < f ? f : from, to).days);
  }

  // Each period from the one the habit starts in up to the one today is in:
  //   { start, end, month, value, target, status }
  // status: 'met'      the target was reached (a limit: the period ended at or under it)
  //         'missed'   the period is over and the target wasn't reached (a limit: it went over, even part-way through)
  //         'open'     today is in it and it's not decided yet (not counted)
  //         'partial'  the first period began before the start date and wasn't met (not counted)
  // Some linked rules work out each period's target themselves (e.g. what's needed to pay off a loan in time).
  // Rules that compare balances (wholePeriod) always measure a whole week / month / pay cycle, from the balance at
  // the end of the day before it began; when that balance isn't known (the accounts were added part-way through),
  // the period isn't counted (nodata). They're also judged only when the period ends (judgeAtEnd): a pay cycle
  // starts high on payday and goes down as money is spent.
  function periods(h, t = today()) {
    const out = [];
    const first = firstDay(h), r = ruleOf(h), limit = atMost(h);
    if (!started(h, t) || first > t) return out;
    const whole = !!(r && r.wholePeriod && ruleReady(r));
    const known = whole && r.dataStart ? r.dataStart(src, h.rule) : '';
    for (let p = spanOf(h, first); p.start <= t; p = spanOf(h, addDays(p.end, 1))) {
      const nodata = whole && p.start < known;
      const value = nodata ? 0 : measure(h, whole || p.start >= first ? p.start : first, p.end < t ? p.end : t).value;
      const target = r && r.targetFor && ruleReady(r) ? r.targetFor(src, h.rule, p) : targetOf(h);
      let status;
      if (nodata) status = 'partial';
      else if (limit) status = value > target ? (p.start < first ? 'partial' : 'missed') : p.end >= t ? 'open' : 'met';
      else if (r && r.judgeAtEnd && p.end >= t) status = 'open';
      else if (whole) status = value >= target ? 'met' : 'missed';
      else if (value >= target) status = 'met';
      else if (p.end >= t) status = 'open';
      else if (p.start < first) status = 'partial';
      else status = 'missed';
      out.push(Object.assign({}, p, { value, target, status, nodata }));
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

  /* ---------- Words ---------- */
  function plural(n, one, many) { return `${n} ${n === 1 ? one : many}`; }
  function freqText(h) {
    const r = ruleOf(h);
    if (isLinked(h)) {
      if (!r) return '🔗 Linked rule not found';
      if (r.autoTarget) return `${r.icon} target worked out each ${periodWord(h)} · from ${r.moduleName}`;
      return `${r.icon} ${r.atMost ? 'at most ' : ''}${r.format(targetOf(h), src, h.rule)} a ${periodWord(h)} · from ${r.moduleName}`;
    }
    if (h.freq === 'weekly') return `${targetOf(h)}× a week`;
    if (h.freq === 'monthly') return targetOf(h) === 1 ? 'Once a month' : `${targetOf(h)}× a month`;
    return 'Daily';
  }
  // "2 of 3 runs", "S$1,240 of S$2,000 saved", "2 of 3".
  function progressText(h, value, target = targetOf(h)) {
    const r = ruleOf(h);
    if (r) return r.progress(value, target, src, h.rule);
    return `${value} of ${target}`;
  }

  /* ---------- Today and "at risk", for the home screen ---------- */
  const isDone = (h, iso) => state.checks.some((c) => c.habitId === h.id && c.date === iso);
  // Is a weekly / monthly habit at risk in the period today is in? { text, over } or null.
  //   counts (times, runs, days): what's still needed is about as many days as are left (or more);
  //   limits (spend at most): over it already, or spending at a pace that would go over by the end;
  //   savings (judged when the period ends): below the target now;
  //   payments due (loan): still to pay with a week or less left.
  function atRisk(h, t = today()) {
    if (h.freq === 'daily' || !started(h, t)) return null;
    const p = stats(h, t).current;
    if (!p || p.nodata || p.status === 'met') return null;
    const r = ruleOf(h), left = daysBetween(t, p.end) + 1; // days left, today included
    const days = `${plural(left, 'day', 'days')} left`;
    const said = progressText(h, p.value, p.target);
    if (atMost(h)) {
      if (p.value > p.target) return { text: said, over: true, limit: true };
      const gone = daysBetween(p.start, t) + 1, total = daysBetween(p.start, p.end) + 1;
      const pace = gone >= 3 ? (p.value / gone) * total : 0;
      return p.value >= p.target * 0.9 || pace > p.target ? { text: `${said} · ${days}` } : null;
    }
    if (p.status !== 'open') return null;
    if (r && r.judgeAtEnd) return p.value < p.target ? { text: `${r.soFar ? r.soFar(p.value, p.target, src, h.rule) : said} · ${days}` } : null;
    if (r && r.risk === 'due') return p.value < p.target && left <= 7 ? { text: `${said} · ${days}` } : null;
    const need = p.target - p.value;
    if (need <= 0 || need < left - 1) return null;
    return { text: `${said} · ${days}`, over: need > left };
  }
  // Everything the home screen shows: daily habits done today, and habits at risk this week / month.
  function summary(t = today()) {
    const live = state.habits.filter((h) => started(h, t) && firstDay(h) <= t);
    const daily = live.filter((h) => h.freq === 'daily');
    const done = daily.filter((h) => isDone(h, t));
    const risks = [];
    for (const h of live) { const x = atRisk(h, t); if (x) risks.push(Object.assign({ habit: h, icon: isLinked(h) && ruleOf(h) ? ruleOf(h).icon : '🌱', period: periodWord(h) }, x)); }
    const metNow = live.filter((h) => h.freq !== 'daily' && (stats(h, t).current || {}).status === 'met').length;
    return { count: state.habits.length, live: live.length, daily: daily.length, doneToday: done.length,
      notDone: daily.filter((h) => !isDone(h, t)), risks, metNow, others: live.length - daily.length };
  }

  return { use, today, FREQS, freqOf, isLinked, ruleOf, ruleReady, kindOf, targetOf, started, atMost, periodWord, usesCycles,
    spanOf, firstDay, measure, doneDays, periods, stats, plural, freqText, progressText, isDone, atRisk, summary };
})();
