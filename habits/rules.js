/* Linked habits: rules that read another module's saved data (read only — nothing here ever saves to another
   module) and work out how far along a habit is in a week or month.

   To add a rule for a new module, add one entry to HABIT_RULES:
     id            unique, e.g. 'books.pages'
     module        the module's id in the store (Rojak.load(module)), e.g. 'fitness'
     moduleName    shown in the form, e.g. 'Fitness'
     icon          shown on the habit
     label         "what to measure", shown in the form
     periods       which of 'week' / 'month' it can be checked over
     defaultTarget { week, month }
     targetLabel(opts, src)          the words after the target number in the form, e.g. 'runs' or 'S$ saved'
     optionsHtml(src, opts)          extra choices for the rule (or '')
     readOptions(form, src)          those choices as an object, or a message (string) if something is missing
     measure(src, opts, from, to)    { value, days: [YYYY-MM-DD, …] } for the days from..to (both included);
                                     `days` are filled in on the habit's calendar (may be empty)
     format(value, src, opts)        a value for display, e.g. '2 runs' or 'S$1,240'
     progress(value, target, src, opts)   progress for display, e.g. '2 of 3 runs' or 'S$1,240 of S$2,000 saved'
     defaultName(opts, target, period, src)   the habit's name when you leave it empty
   Optional:
     period(src, kind, iso)          { start, end, month } of the week or month a day is in, when the rule doesn't
                                     use Monday–Sunday weeks / calendar months (Money's pay cycles)
     bind(root, src)                 hook up buttons in optionsHtml (e.g. shortcuts)
     dataStart(src, opts)            the first day the rule has data for; earlier days are greyed out
     unavailable(src)                a message when the module has nothing to measure yet
   `src` holds every module's data: { money, fitness, … }. Values are plain numbers in the unit shown. */
'use strict';

const R_pad = (n) => String(n).padStart(2, '0');
const R_day = (iso) => new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const R_iso = (d) => `${d.getFullYear()}-${R_pad(d.getMonth() + 1)}-${R_pad(d.getDate())}`;
const R_addDays = (iso, n) => { const d = R_day(iso); d.setDate(d.getDate() + n); return R_iso(d); };
const R_esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- Money: pay cycles, the same way as the money tracker ---------- */
// settings.paydays is a payday history, oldest first: [{ from: 'YYYY-MM-DD' | '', payday: 1-31 | 'last', payWeekend }].
// A pay cycle runs from a payday to the day before the next one and belongs to the month its pay comes in
// (25 Nov – 24 Dec is November), even when the payday is moved back to the Friday before a weekend.
const R_daysIn = (y, m) => new Date(y, m, 0).getDate();
function R_payday(rule, y, m) {
  const d = rule.payday === 'last' ? R_daysIn(y, m) : Math.min(+rule.payday, R_daysIn(y, m));
  let iso = `${y}-${R_pad(m)}-${R_pad(d)}`;
  if (rule.payWeekend) {
    const wd = new Date(y, m - 1, d).getDay();
    if (wd === 6) iso = R_addDays(iso, -1);
    if (wd === 0) iso = R_addDays(iso, -2);
  }
  return iso;
}
// Paydays from a few months before to a few months after a day: [{ day, month }], sorted.
function R_paydaysNear(rules, iso) {
  const out = new Map();
  for (let k = -3; k <= 3; k++) {
    const d = new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1 + k, 1);
    const y = d.getFullYear(), m = d.getMonth() + 1;
    rules.forEach((r, i) => {
      const p = R_payday(r, y, m), next = rules[i + 1];
      if ((!r.from || p >= r.from) && (!next || p < next.from)) out.set(p, `${y}-${R_pad(m)}`);
    });
  }
  return [...out.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, month]) => ({ day, month }));
}
// The week (Monday to Sunday) or month (pay cycle when a payday is set, otherwise calendar month) a day is in.
function moneyPeriod(src, kind, iso) {
  if (kind === 'week') { const s = R_addDays(iso, -((R_day(iso).getDay() + 6) % 7)); return { start: s, end: R_addDays(s, 6), month: s.slice(0, 7) }; }
  const rules = (src.money && src.money.settings && src.money.settings.paydays) || [];
  if (!rules.length) {
    const s = iso.slice(0, 8) + '01';
    return { start: s, end: R_iso(new Date(+iso.slice(0, 4), +iso.slice(5, 7), 0)), month: s.slice(0, 7) };
  }
  const pays = R_paydaysNear(rules, iso);
  const i = pays.filter((p) => p.day <= iso).length - 1;
  return { start: pays[i].day, end: R_addDays(pays[i + 1].day, -1), month: pays[i].month, cycle: true };
}
const moneyFmt = (v, src) => {
  const cur = (src.money && src.money.settings && src.money.settings.currency) || 'S$';
  const n = Math.round(v);
  return `${n < 0 ? '−' : ''}${cur}${Math.abs(n).toLocaleString()}`;
};
const bankAccounts = (src) => ((src.money && src.money.accounts) || []).filter((a) => a.type !== 'credit');
// An account's balance at the end of a day, as on the money tracker's Accounts screen: the starting balance (as of
// its start date) plus every entry from the start date up to that day. Entries dated later aren't counted yet.
function balanceAt(src, acc, day) {
  let total = acc.start || 0;
  if (acc.startDate && day < acc.startDate) return total;
  for (const t of src.money.transactions || []) {
    if (t.accountId !== acc.id || t.date > day) continue;
    if (acc.startDate && t.date < acc.startDate) continue;
    total += t.type === 'income' ? t.amount : -t.amount;
  }
  return total;
}

/* ---------- Fitness ---------- */
// The run categories, for the "Runs" shortcut: the built-in ones, and any category with "run" in its name.
const RUN_IDS = ['easy', 'tempo', 'intervals', 'long', 'race'];
const runCats = (cats) => cats.filter((c) => RUN_IDS.includes(c.id) || /\brun/i.test(c.name)).map((c) => c.id);
const fitnessCats = (src) => (src.fitness && src.fitness.categories) || [];

const HABIT_RULES = [
  {
    id: 'fitness.sessions',
    module: 'fitness', moduleName: 'Fitness', icon: '💪',
    label: 'Sessions in chosen categories (e.g. runs)',
    periods: ['week', 'month'],
    defaultTarget: { week: 3, month: 12 },
    unavailable: (src) => (fitnessCats(src).length ? '' : 'Open Fitness once to set up its categories.'),
    targetLabel: (opts, src) => (opts && opts.cats && opts.cats.length && opts.cats.every((id) => runCats(fitnessCats(src)).includes(id)) ? 'runs' : 'sessions'),
    optionsHtml(src, opts) {
      const cats = fitnessCats(src), on = new Set((opts && opts.cats) || runCats(cats));
      return `<div class="label-t">Which sessions count</div>
        <div class="chips-row"><button type="button" class="mini-btn" data-preset="runs">🏃‍♀️ Runs</button><button type="button" class="mini-btn" data-preset="all">All</button><button type="button" class="mini-btn" data-preset="none">None</button></div>
        <div class="pick-grid">${cats.map((c) => `<label class="pick-chip"><input type="checkbox" name="cat" value="${R_esc(c.id)}" ${on.has(c.id) ? 'checked' : ''}><span>${R_esc(c.icon)} ${R_esc(c.name)}</span></label>`).join('')}</div>
        <span class="hint">Every session in these categories on the Fitness calendar counts.</span>`;
    },
    bind(root, src) {
      root.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
        const runs = runCats(fitnessCats(src));
        root.querySelectorAll('input[name=cat]').forEach((x) => { x.checked = b.dataset.preset === 'all' || (b.dataset.preset === 'runs' && runs.includes(x.value)); x.dispatchEvent(new Event('change', { bubbles: true })); });
      }));
    },
    readOptions(root) {
      const cats = [...root.querySelectorAll('input[name=cat]:checked')].map((x) => x.value);
      return cats.length ? { cats } : 'Pick at least one kind of session';
    },
    measure(src, opts, from, to) {
      const cats = new Set(opts.cats || []);
      const days = [];
      for (const a of (src.fitness && src.fitness.activities) || []) if (a.date >= from && a.date <= to && cats.has(a.catId)) days.push(a.date);
      return { value: days.length, days };
    },
    format(v, src, opts) { const w = this.targetLabel(opts, src); return `${v} ${v === 1 ? w.replace(/s$/, '') : w}`; },
    progress(v, target, src, opts) { return `${v} of ${target} ${this.targetLabel(opts, src)}`; },
    defaultName(opts, target, period, src) {
      const cats = fitnessCats(src).filter((c) => opts.cats.includes(c.id));
      const what = this.targetLabel(opts, src) === 'runs' ? 'Run' : cats.length === 1 ? cats[0].name : 'Train';
      return `${what} ${target}× a ${period}`;
    }
  },
  {
    id: 'money.saved',
    module: 'money', moduleName: 'Money', icon: '💰',
    label: 'Amount saved (bank balances going up)',
    periods: ['month', 'week'],
    defaultTarget: { week: 500, month: 2000 },
    unavailable: (src) => (bankAccounts(src).length ? '' : 'Add a bank account in Money first.'),
    targetLabel: (opts, src) => `${(src.money && src.money.settings && src.money.settings.currency) || 'S$'} saved`,
    optionsHtml(src, opts) {
      const accs = bankAccounts(src), on = new Set((opts && opts.accounts) || accs.map((a) => a.id));
      return `<div class="label-t">Which bank accounts</div>
        <div class="pick-grid">${accs.map((a) => `<label class="pick-chip"><input type="checkbox" name="acc" value="${R_esc(a.id)}" ${on.has(a.id) ? 'checked' : ''}><span>${R_esc(a.name)}</span></label>`).join('')}</div>
        <span class="hint">Saved = these accounts' total at the end of the week or month, minus their total at the end of the one before.
          Everything that goes in or out of them counts: card bill payments and money moved to other accounts lower it, money moved in raises it; moves between two ticked accounts cancel out.
          With a payday set in Money, a month is your pay cycle, named after the month the pay comes in (25 Nov – 24 Dec is November).</span>`;
    },
    readOptions(root) {
      const accounts = [...root.querySelectorAll('input[name=acc]:checked')].map((x) => x.value);
      return accounts.length ? { accounts } : 'Pick at least one bank account';
    },
    period: moneyPeriod,
    // The latest start date of the ticked accounts: before it the app doesn't know their balance.
    dataStart(src, opts) {
      const accs = bankAccounts(src).filter((a) => (opts.accounts || []).includes(a.id));
      return accs.reduce((m, a) => (a.startDate && a.startDate > m ? a.startDate : m), '');
    },
    measure(src, opts, from, to) {
      const accs = bankAccounts(src).filter((a) => (opts.accounts || []).includes(a.id));
      const before = R_addDays(from, -1);
      let cents = 0;
      for (const a of accs) cents += balanceAt(src, a, to) - balanceAt(src, a, before);
      return { value: cents / 100, days: [] };
    },
    format: (v, src) => moneyFmt(v, src),
    progress: (v, target, src) => `${moneyFmt(v, src)} of ${moneyFmt(target, src)} saved`,
    defaultName(opts, target, period, src) { return `Save ${moneyFmt(target, src)} a ${period === 'month' && src.money && ((src.money.settings || {}).paydays || []).length ? 'pay cycle' : period}`; }
  }
];
const ruleById = (id) => HABIT_RULES.find((r) => r.id === id);
