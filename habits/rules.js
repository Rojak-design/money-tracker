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
     atMost        true when the target is a limit (spend at most S$800): a period is met when it ends at or under
                   the target, and missed as soon as it goes over
     autoTarget    true when the rule works out each period's target itself (targetFor); no target is asked for
     targetFor(src, opts, period)    that period's target ({ start, end, month })
     wholePeriod   true for rules that compare balances: each period is measured whole, from the balance at the end
                   of the day before it began; a period that began before dataStart isn't counted
     judgeAtEnd    true when the current period is only decided when it ends (savings go down as money is spent)
     soFar(value, target, src, opts)  progress for the current period of a judgeAtEnd rule
     noDataWhy(src, opts, period)    why a period before dataStart isn't counted
     risk          'due' when the period's target is a payment that comes due (loan): the home screen only calls
                   it at risk in the last week of the month
     extra(src, opts, today)         one more line under the progress, e.g. 'S$12,400 left · paid off by Dec 2027'
     bind(root, src)                 hook up buttons in optionsHtml (e.g. shortcuts)
     period(src, kind, iso, opts)    { start, end, month, word } of the week or month a day is in, when the rule
                                     doesn't use Monday–Sunday weeks / calendar months (pay cycles, card statements);
                                     `word` names it ('pay cycle', 'statement')
     dataStart(src, opts)            the first day the rule has data for; earlier days are greyed out
     unavailable(src)                a message when the module has nothing to measure yet
   `src` holds every module's data: { money, fitness, … }. Values are plain numbers in the unit shown (dollars,
   not cents). */
'use strict';

// Only HABIT_RULES and ruleById are shared; the helpers stay inside (the home screen loads this file too).
const { HABIT_RULES, ruleById } = (() => {
const R_pad = (n) => String(n).padStart(2, '0');
const R_day = (iso) => new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const R_iso = (d) => `${d.getFullYear()}-${R_pad(d.getMonth() + 1)}-${R_pad(d.getDate())}`;
const R_addDays = (iso, n) => { const d = R_day(iso); d.setDate(d.getDate() + n); return R_iso(d); };
const R_today = () => R_iso(new Date());
const R_esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const R_daysIn = (y, m) => new Date(y, m, 0).getDate();
const R_monthsBetween = (a, b) => (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7)); // 'YYYY-MM'
const R_addMonthsKey = (key, n) => { const d = new Date(+key.slice(0, 4), +key.slice(5, 7) - 1 + n, 1); return `${d.getFullYear()}-${R_pad(d.getMonth() + 1)}`; };
const R_monthLabel = (key) => new Date(+key.slice(0, 4), +key.slice(5, 7) - 1, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
const R_calMonth = (iso) => { const s = iso.slice(0, 8) + '01'; return { start: s, end: `${iso.slice(0, 8)}${R_pad(R_daysIn(+iso.slice(0, 4), +iso.slice(5, 7)))}`, month: s.slice(0, 7) }; };
const R_week = (iso) => { const s = R_addDays(iso, -((R_day(iso).getDay() + 6) % 7)); return { start: s, end: R_addDays(s, 6), month: s.slice(0, 7) }; };
const R_checks = (root, name) => [...root.querySelectorAll(`input[name=${name}]:checked`)].map((x) => x.value);
const R_chips = (name, items, on) => `<div class="pick-grid">${items.map((x) => `<label class="pick-chip"><input type="checkbox" name="${name}" value="${R_esc(x.id)}" ${on.has(x.id) ? 'checked' : ''}><span>${R_esc(x.label)}</span></label>`).join('')}</div>`;

/* ---------- Money ---------- */
const M = (src) => src.money || {};
const M_txs = (src) => M(src).transactions || [];
const M_cur = (src) => (M(src).settings && M(src).settings.currency) || 'S$';
const moneyFmt = (v, src) => {
  const n = Math.round(v);
  return `${n < 0 ? '−' : ''}${M_cur(src)}${Math.abs(n).toLocaleString()}`;
};
const bankAccounts = (src) => (M(src).accounts || []).filter((a) => a.type !== 'credit');
const cardAccounts = (src) => (M(src).accounts || []).filter((a) => a.type === 'credit');
const accountName = (src, id) => ((M(src).accounts || []).find((a) => a.id === id) || {}).name || 'account';

// Pay cycles, the same way as the money tracker. settings.paydays is a payday history, oldest first:
// [{ from: 'YYYY-MM-DD' | '', payday: 1-31 | 'last', payWeekend }]. A pay cycle runs from a payday to the day
// before the next one and belongs to the month its pay comes in (25 Nov – 24 Dec is November), even when the
// payday is moved back to the Friday before a weekend.
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
const hasPayday = (src) => !!((M(src).settings || {}).paydays || []).length;
// The week (Monday to Sunday) or month (pay cycle when a payday is set, otherwise calendar month) a day is in.
function moneyPeriod(src, kind, iso) {
  if (kind === 'week') return R_week(iso);
  if (!hasPayday(src)) return R_calMonth(iso);
  const pays = R_paydaysNear(M(src).settings.paydays, iso);
  const i = pays.filter((p) => p.day <= iso).length - 1;
  return { start: pays[i].day, end: R_addDays(pays[i + 1].day, -1), month: pays[i].month, word: 'pay cycle' };
}
const monthWord = (src) => (hasPayday(src) ? 'pay cycle' : 'month');

// An account's balance at the end of a day, as on the money tracker's Accounts screen: the starting balance (as of
// its start date) plus every entry from the start date up to that day. Entries dated later aren't counted yet.
function balanceAt(src, acc, day) {
  let total = acc.start || 0;
  if (acc.startDate && day < acc.startDate) return total;
  for (const t of M_txs(src)) {
    if (t.accountId !== acc.id || t.date > day) continue;
    if (acc.startDate && t.date < acc.startDate) continue;
    total += t.type === 'income' ? t.amount : -t.amount;
  }
  return total;
}
const changeIn = (src, accs, from, to) => accs.reduce((s, a) => s + balanceAt(src, a, to) - balanceAt(src, a, R_addDays(from, -1)), 0) / 100;
const latestStart = (accs) => accs.reduce((m, a) => (a.startDate && a.startDate > m ? a.startDate : m), '');

// Spending: expenses, less money back, in cents. Transfers between your own accounts (and card bill payments,
// which are transfers to the card) never count; an expense you gave the "Transfer" category does.
function spentIn(src, from, to, keep) {
  let c = 0;
  for (const t of M_txs(src)) {
    if (t.date < from || t.date > to || t.transferId || !keep(t)) continue;
    if (t.type === 'expense') c += t.amount;
    else if (t.refund) c -= t.amount;
  }
  return c / 100;
}

// A card's statement period a day is in: from the day after the last statement to the statement date (statement
// day: the card's statementDay, or the last day of the month), named after the statement's month.
function statementPeriod(card, iso) {
  const sd = card.statementDay || 31;
  const stmtIn = (y, m) => `${y}-${R_pad(m)}-${R_pad(Math.min(sd, R_daysIn(y, m)))}`;
  const y = +iso.slice(0, 4), m = +iso.slice(5, 7);
  let end = stmtIn(y, m);
  if (iso > end) { const n = new Date(y, m, 1); end = stmtIn(n.getFullYear(), n.getMonth() + 1); }
  const p = new Date(+end.slice(0, 4), +end.slice(5, 7) - 2, 1);
  const start = R_addDays(stmtIn(p.getFullYear(), p.getMonth() + 1), 1);
  return { start, end, month: end.slice(0, 7), word: 'statement' };
}

// Loans: recurring payments in Money that end "when a loan is paid off". loanBalance (cents) was owed on loanAsOf,
// before the payment on `start`; loanInterest 'reducing' charges loanRate % a year on what's left.
const loans = (src) => (M(src).recurring || []).filter((r) => r.endMode === 'loan');
const loanOf = (src, opts) => loans(src).find((r) => r.id === opts.loanId);
const loanFrom = (l) => (l.loanAsOf && l.loanAsOf < l.start ? l.loanAsOf : l.start) || '';
const loanRate = (l) => (l.loanInterest === 'reducing' ? (l.loanRate || 0) / 100 / 12 : 0); // a month
const loanPayments = (src, l) => M_txs(src).filter((t) => t.recurringId === l.id && t.type === 'expense' && (!loanFrom(l) || t.date >= loanFrom(l)))
  .sort((a, b) => a.date.localeCompare(b.date));
// Still owed (cents) before any payment dated on or after `day`: the balance you entered, plus interest each month
// (reducing-balance loans), less the payments logged against the loan.
function owedBefore(src, l, day) {
  let bal = l.loanBalance || 0;
  const rate = loanRate(l);
  for (const t of loanPayments(src, l)) {
    if (t.date >= day) break;
    bal = Math.max(0, bal + bal * rate - t.amount);
  }
  return bal;
}
// What to pay each month to clear `owed` (cents) in n months.
function monthlyToClear(owed, rate, n) {
  if (owed <= 0) return 0;
  if (n <= 1) return owed * (1 + rate);
  return rate ? (owed * rate) / (1 - (1 + rate) ** -n) : owed / n;
}
// Months it takes to pay off `owed` at `amount` a month (null if it never does).
function monthsToClear(owed, amount, rate) {
  let n = 0;
  while (owed > 0 && n < 1200) { const int = owed * rate; if (int >= amount) return null; owed = owed + int - amount; n++; }
  return n;
}

// Savings projects (savedMode 'account': what's saved is an account's balance).
const projects = (src) => (M(src).projects || []).filter((p) => p.savedMode === 'account' && (M(src).accounts || []).some((a) => a.id === p.accountId));
const projectOf = (src, opts) => projects(src).find((p) => p.id === opts.projectId);
function itemLeft(src, p, i, before) {
  if (i.done) return 0;
  let paid = 0;
  for (const t of M_txs(src)) if (t.projectId === p.id && t.projectItemId === i.id && t.date < before && (t.type === 'expense' || t.refund)) paid += t.refund ? -t.amount : t.amount;
  return Math.max(0, (i.amount || 0) - paid);
}
// The last month a project's costs are due (instalments included), or its target date's month.
function projectLastMonth(p) {
  let last = p.targetDate ? p.targetDate.slice(0, 7) : '';
  for (const i of p.items || []) {
    const due = i.due || (p.targetDate ? p.targetDate.slice(0, 7) : '');
    if (!due) continue;
    const end = R_addMonthsKey(due, (i.instalments > 1 ? i.instalments : 1) - 1);
    if (end > last) last = end;
  }
  return last;
}

/* ---------- Fitness ---------- */
// The run categories, for the "Runs" shortcut: the built-in ones, and any category with "run" in its name.
const RUN_IDS = ['easy', 'tempo', 'intervals', 'long', 'race'];
const runCats = (cats) => cats.filter((c) => RUN_IDS.includes(c.id) || /\brun/i.test(c.name)).map((c) => c.id);
const fitnessCats = (src) => (src.fitness && src.fitness.categories) || [];

// Days with a matching entry, counted once each.
const dayCount = (days) => { const s = [...new Set(days)]; return { value: s.length, days: s }; };

const HABIT_RULES = [
  /* ----- Fitness ----- */
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
        ${R_chips('cat', cats.map((c) => ({ id: c.id, label: `${c.icon} ${c.name}` })), on)}
        <span class="hint">Every session in these categories on the Fitness calendar counts.</span>`;
    },
    bind(root, src) {
      root.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
        const runs = runCats(fitnessCats(src));
        root.querySelectorAll('input[name=cat]').forEach((x) => { x.checked = b.dataset.preset === 'all' || (b.dataset.preset === 'runs' && runs.includes(x.value)); });
        root.dispatchEvent(new Event('change', { bubbles: true }));
      }));
    },
    readOptions(root) {
      const cats = R_checks(root, 'cat');
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

  /* ----- Money: amount saved ----- */
  {
    id: 'money.saved',
    module: 'money', moduleName: 'Money', icon: '💰',
    label: 'Amount saved (bank balances going up)',
    periods: ['month', 'week'],
    defaultTarget: { week: 500, month: 2000 },
    unavailable: (src) => (bankAccounts(src).length ? '' : 'Add a bank account in Money first.'),
    targetLabel: (opts, src) => `${M_cur(src)} saved`,
    optionsHtml(src, opts) {
      const accs = bankAccounts(src), on = new Set((opts && opts.accounts) || accs.map((a) => a.id));
      return `<div class="label-t">Which bank accounts</div>
        ${R_chips('acc', accs.map((a) => ({ id: a.id, label: a.name })), on)}
        <span class="hint">Saved = these accounts' total at the end of the week or month, minus their total at the end of the one before (balances as on Money's Accounts screen).
          Everything that goes in or out of them counts: card bill payments and money moved to other accounts lower it, money moved in raises it; moves between two ticked accounts cancel out.
          With a payday set in Money, a month is your pay cycle, named after the month the pay comes in (25 Nov – 24 Dec is November).
          Each week or month is judged when it ends; until then you see what's saved so far and how much you can still spend.
          A week or month that began before an account was added to Money isn't counted (its balance before then isn't known).</span>`;
    },
    readOptions(root) {
      const accounts = R_checks(root, 'acc');
      return accounts.length ? { accounts } : 'Pick at least one bank account';
    },
    period: moneyPeriod,
    wholePeriod: true,
    judgeAtEnd: true,
    // The latest start date of the ticked accounts: before it the app doesn't know their balance.
    dataStart: (src, opts) => latestStart(bankAccounts(src).filter((a) => (opts.accounts || []).includes(a.id))),
    noDataWhy(src, opts, p) {
      const late = bankAccounts(src).filter((a) => (opts.accounts || []).includes(a.id) && a.startDate && a.startDate > p.start);
      return `${late.map((a) => a.name).join(', ')} ${late.length > 1 ? 'were' : 'was'} added to Money part-way through, so the balance before it began isn't known`;
    },
    measure: (src, opts, from, to) => ({ value: changeIn(src, bankAccounts(src).filter((a) => (opts.accounts || []).includes(a.id)), from, to), days: [] }),
    format: (v, src) => moneyFmt(v, src),
    progress: (v, target, src) => `${moneyFmt(v, src)} of ${moneyFmt(target, src)} saved`,
    soFar: (v, target, src) => (v >= target ? `${moneyFmt(v, src)} saved so far · ${moneyFmt(v - target, src)} left to spend`
      : `${moneyFmt(v, src)} saved so far · ${moneyFmt(target - v, src)} short of ${moneyFmt(target, src)}`),
    defaultName: (opts, target, period, src) => `Save ${moneyFmt(target, src)} a ${period}`
  },

  /* ----- Money: credit card spending ----- */
  {
    id: 'money.cardSpend',
    module: 'money', moduleName: 'Money', icon: '💳',
    label: 'Credit card spending (at most)',
    atMost: true,
    periods: ['month', 'week'],
    defaultTarget: { week: 200, month: 800 },
    unavailable: (src) => (cardAccounts(src).length ? '' : 'Add a credit card in Money first.'),
    targetLabel: (opts, src) => `${M_cur(src)} on the card${opts && opts.cards && opts.cards.length > 1 ? 's' : ''}`,
    optionsHtml(src, opts) {
      const cards = cardAccounts(src), on = new Set((opts && opts.cards) || cards.map((a) => a.id));
      const byStmt = !!(opts && opts.byStatement);
      return `<div class="label-t">Which cards</div>
        ${R_chips('card', cards.map((a) => ({ id: a.id, label: '💳 ' + a.name })), on)}
        <label class="check"><input type="checkbox" name="byStatement" ${byStmt ? 'checked' : ''}><span>For a month, use the card's <strong>statement</strong> period (one card only)</span></label>
        <span class="hint">Purchases on these cards, less money back on them. Paying the card bill doesn't count. Otherwise a month is your ${monthWord(src)}.
          A week or month is met when it ends at or under the limit, and missed as soon as it goes over.</span>`;
    },
    readOptions(root) {
      const cards = R_checks(root, 'card');
      if (!cards.length) return 'Pick at least one card';
      const byStatement = root.querySelector('input[name=byStatement]').checked;
      if (byStatement && cards.length > 1) return 'Statement periods work with one card at a time';
      return { cards, byStatement };
    },
    period(src, kind, iso, opts) {
      if (kind === 'month' && opts && opts.byStatement) {
        const card = cardAccounts(src).find((a) => a.id === opts.cards[0]);
        if (card) return statementPeriod(card, iso);
      }
      return moneyPeriod(src, kind, iso);
    },
    measure(src, opts, from, to) {
      const cards = new Set(opts.cards || []);
      return { value: spentIn(src, from, to, (t) => cards.has(t.accountId)), days: [] };
    },
    format: (v, src) => moneyFmt(v, src),
    progress: (v, target, src) => (v > target ? `${moneyFmt(v, src)} spent — ${moneyFmt(v - target, src)} over ${moneyFmt(target, src)}` : `${moneyFmt(v, src)} of ${moneyFmt(target, src)} used · ${moneyFmt(target - v, src)} left`),
    defaultName: (opts, target, period, src) => `Card spending under ${moneyFmt(target, src)} a ${opts.byStatement && period !== 'week' ? 'statement' : period}`
  },

  /* ----- Money: spending in categories ----- */
  {
    id: 'money.categorySpend',
    module: 'money', moduleName: 'Money', icon: '🧾',
    label: 'Spending in chosen categories (at most)',
    atMost: true,
    periods: ['month', 'week'],
    defaultTarget: { week: 150, month: 600 },
    cats: (src) => {
      const set = new Set(((M(src).categories || {}).expense || []).filter((c) => c !== 'Transfer'));
      for (const t of M_txs(src)) if (t.type === 'expense' && !t.transferId && t.category && t.category !== 'Transfer') set.add(t.category);
      return [...set];
    },
    unavailable(src) { return this.cats(src).length ? '' : 'Log some spending in Money first.'; },
    targetLabel: (opts, src) => `${M_cur(src)} spent`,
    optionsHtml(src, opts) {
      const on = new Set((opts && opts.cats) || []);
      return `<div class="label-t">Which categories</div>
        ${R_chips('mcat', this.cats(src).map((c) => ({ id: c, label: c })), on)}
        <span class="hint">Spending in these categories from every account and card, less money back — the same as History's pie chart. Transfers between your own accounts don't count. A month is your ${monthWord(src)}.</span>`;
    },
    readOptions(root) {
      const cats = R_checks(root, 'mcat');
      return cats.length ? { cats } : 'Pick at least one category';
    },
    period: moneyPeriod,
    measure(src, opts, from, to) {
      const cats = new Set(opts.cats || []);
      return { value: spentIn(src, from, to, (t) => cats.has(t.category)), days: [] };
    },
    format: (v, src) => moneyFmt(v, src),
    progress: (v, target, src) => (v > target ? `${moneyFmt(v, src)} spent — ${moneyFmt(v - target, src)} over ${moneyFmt(target, src)}` : `${moneyFmt(v, src)} of ${moneyFmt(target, src)} spent · ${moneyFmt(target - v, src)} left`),
    defaultName: (opts, target, period, src) => `${opts.cats.length === 1 ? opts.cats[0] : 'Spending'} under ${moneyFmt(target, src)} a ${period}`
  },

  /* ----- Money: pay off a loan by a date ----- */
  {
    id: 'money.loan',
    module: 'money', moduleName: 'Money', icon: '🏦',
    label: 'Pay off a loan by a target date',
    autoTarget: true,
    risk: 'due',
    periods: ['month'],
    defaultTarget: { month: 0 },
    unavailable: (src) => (loans(src).length ? '' : 'Add the loan in Money first: Plan → Recurring, ending "when a loan is paid off".'),
    targetLabel: (opts, src) => `${M_cur(src)} repaid`,
    optionsHtml(src, opts) {
      const ls = loans(src);
      const sel = (opts && opts.loanId) || (ls[0] && ls[0].id);
      return `<label>Which loan<select name="loan">${ls.map((l) => `<option value="${R_esc(l.id)}" ${l.id === sel ? 'selected' : ''}>${R_esc(l.name)}</option>`).join('')}</select></label>
        <label>Paid off by<input type="month" name="by" required value="${R_esc((opts && opts.by) || '')}"></label>
        <span class="hint">Each month's target is what's left on the loan ÷ the months to go (with its interest rate, if it has one), so it goes down when you pay extra.
          Payments count when they're logged against the loan in Money (Log a payment, or a transaction linked to it). Months are calendar months.</span>`;
    },
    readOptions(root) {
      const loanId = root.querySelector('select[name=loan]').value, by = root.querySelector('input[name=by]').value;
      if (!loanId) return 'Pick a loan';
      if (!/^\d{4}-\d{2}$/.test(by)) return 'Pick the month to pay it off by';
      return { loanId, by };
    },
    dataStart: (src, opts) => { const l = loanOf(src, opts); return l ? loanFrom(l) : ''; },
    targetFor(src, opts, p) {
      const l = loanOf(src, opts);
      if (!l) return 0;
      const n = Math.max(1, R_monthsBetween(p.month, opts.by) + 1);
      return Math.ceil(monthlyToClear(owedBefore(src, l, p.start), loanRate(l), n) / 100);
    },
    measure(src, opts, from, to) {
      const l = loanOf(src, opts);
      if (!l) return { value: 0, days: [] };
      const ps = loanPayments(src, l).filter((t) => t.date >= from && t.date <= to);
      return { value: ps.reduce((s, t) => s + t.amount, 0) / 100, days: ps.map((t) => t.date) };
    },
    extra(src, opts, t) {
      const l = loanOf(src, opts);
      if (!l) return 'This loan isn\'t in Money any more.';
      const owed = owedBefore(src, l, R_addDays(t, 1));
      if (owed <= 0) return '🎉 Paid off';
      const n = monthsToClear(owed, l.amount || 0, loanRate(l));
      const finish = n == null ? null : R_addMonthsKey(t.slice(0, 7), n - 1);
      return `${moneyFmt(owed / 100, src)} left · target ${R_monthLabel(opts.by)}` + (finish == null ? ' · the repayment doesn\'t cover the interest'
        : ` · at ${moneyFmt((l.amount || 0) / 100, src)} a month you'd finish ${R_monthLabel(finish)} ${finish <= opts.by ? '✓' : '⚠️'}`);
    },
    format: (v, src) => moneyFmt(v, src),
    progress: (v, target, src) => (target <= 0 ? `${moneyFmt(v, src)} repaid · nothing left to pay` : `${moneyFmt(v, src)} of ${moneyFmt(target, src)} repaid`),
    defaultName(opts, target, period, src) { const l = loanOf(src, opts); return `Pay off ${l ? l.name : 'loan'} by ${R_monthLabel(opts.by)}`; }
  },

  /* ----- Money: save for a project ----- */
  {
    id: 'money.project',
    module: 'money', moduleName: 'Money', icon: '🎯',
    label: 'Save for a savings project',
    autoTarget: true,
    periods: ['month'],
    defaultTarget: { month: 0 },
    unavailable: (src) => (projects(src).length ? '' : 'Needs a savings project in Money (Plan → Projects) whose savings are an account\'s balance.'),
    targetLabel: (opts, src) => `${M_cur(src)} saved`,
    optionsHtml(src, opts) {
      const ps = projects(src), sel = (opts && opts.projectId) || (ps[0] && ps[0].id);
      return `<label>Which project<select name="project">${ps.map((p) => `<option value="${R_esc(p.id)}" ${p.id === sel ? 'selected' : ''}>${R_esc(p.name)}</option>`).join('')}</select></label>
        <span class="hint">Saved = how much the project's account went up that month. The target is the project's monthly amount when you've set a fixed one;
          otherwise what's still to pay, less what's saved, spread evenly over the months until its costs are due. Months are calendar months, as in Projects.
          Only projects whose savings are an account's balance can be tracked.</span>`;
    },
    readOptions(root) { const projectId = root.querySelector('select[name=project]').value; return projectId ? { projectId } : 'Pick a project'; },
    wholePeriod: true,
    judgeAtEnd: true,
    dataStart: (src, opts) => { const p = projectOf(src, opts); const a = p && (M(src).accounts || []).find((x) => x.id === p.accountId); return (a && a.startDate) || ''; },
    noDataWhy(src, opts) { const p = projectOf(src, opts); return `${p ? accountName(src, p.accountId) : 'The account'} was added to Money part-way through, so the balance before it began isn't known`; },
    soFar: (v, target, src) => (target <= 0 ? `${moneyFmt(v, src)} saved so far · nothing more needed` : v >= target ? `${moneyFmt(v, src)} saved so far · target reached`
      : `${moneyFmt(v, src)} saved so far · ${moneyFmt(target - v, src)} to go`),
    targetFor(src, opts, per) {
      const p = projectOf(src, opts);
      if (!p) return 0;
      if ((p.planMode === 'fixed' || (!p.planMode && p.monthly > 0)) && p.monthly > 0) return p.monthly / 100;
      const acc = (M(src).accounts || []).find((a) => a.id === p.accountId);
      const left = (p.items || []).reduce((s, i) => s + itemLeft(src, p, i, per.start), 0) - Math.max(0, balanceAt(src, acc, R_addDays(per.start, -1)));
      const last = projectLastMonth(p);
      if (left <= 0 || !last) return 0;
      return Math.ceil(left / Math.max(1, R_monthsBetween(per.month, last) + 1) / 100);
    },
    measure(src, opts, from, to) {
      const p = projectOf(src, opts);
      const acc = p && (M(src).accounts || []).find((a) => a.id === p.accountId);
      return { value: acc ? changeIn(src, [acc], from, to) : 0, days: [] };
    },
    extra(src, opts, t) {
      const p = projectOf(src, opts);
      if (!p) return 'This project isn\'t in Money any more.';
      const acc = (M(src).accounts || []).find((a) => a.id === p.accountId);
      const left = (p.items || []).reduce((s, i) => s + itemLeft(src, p, i, R_addDays(t, 1)), 0);
      const last = projectLastMonth(p);
      return `${moneyFmt(Math.max(0, balanceAt(src, acc, t)) / 100, src)} saved in ${accountName(src, p.accountId)} · ${moneyFmt(left / 100, src)} still to pay${last ? ` by ${R_monthLabel(last)}` : ''}`;
    },
    format: (v, src) => moneyFmt(v, src),
    progress: (v, target, src) => (target <= 0 ? `${moneyFmt(v, src)} saved · nothing more needed` : `${moneyFmt(v, src)} of ${moneyFmt(target, src)} saved`),
    defaultName(opts, target, period, src) { const p = projectOf(src, opts); return `Save for ${p ? p.name : 'project'}`; }
  },

  /* ----- Money: no-spend days ----- */
  {
    id: 'money.noSpend',
    module: 'money', moduleName: 'Money', icon: '🚫',
    label: 'No-spend days',
    periods: ['month', 'week'],
    defaultTarget: { week: 2, month: 8 },
    unavailable: (src) => (M_txs(src).length ? '' : 'Log some spending in Money first.'),
    targetLabel: () => 'no-spend days',
    optionsHtml: (src) => `<span class="hint">A day with no day-to-day spending on any account or card. Bills and other payments set up under Plan → Recurring, card bill payments and transfers between your own accounts don't count against you. A day counts once it's over. A month is your ${monthWord(src)}.</span>`,
    readOptions: () => ({}),
    period: moneyPeriod,
    // From the first day anything was logged in Money.
    dataStart: (src) => M_txs(src).reduce((m, t) => (!m || t.date < m ? t.date : m), ''),
    measure(src, opts, from, to) {
      const spent = new Set();
      for (const t of M_txs(src)) if (t.type === 'expense' && !t.transferId && !t.recurringId && t.date >= from && t.date <= to) spent.add(t.date);
      const days = [], t0 = R_today();
      for (let d = from; d <= to && d < t0; d = R_addDays(d, 1)) if (!spent.has(d)) days.push(d);
      return { value: days.length, days };
    },
    format: (v) => `${v} no-spend day${v === 1 ? '' : 's'}`,
    progress: (v, target) => `${v} of ${target} no-spend days`,
    defaultName: (opts, target, period) => `${target} no-spend days a ${period}`
  },

  /* ----- Money: logging and reconciling ----- */
  {
    id: 'money.upkeep',
    module: 'money', moduleName: 'Money', icon: '📝',
    label: 'Days you logged entries or reconciled',
    periods: ['week', 'month'],
    defaultTarget: { week: 5, month: 4 },
    targetLabel: (opts) => (opts && opts.what === 'reconcile' ? 'days reconciled' : 'days logged'),
    optionsHtml(src, opts) {
      const what = (opts && opts.what) || 'log';
      return `<label>Count days you…<select name="what"><option value="log" ${what === 'log' ? 'selected' : ''}>logged at least one entry (by the entry's date)</option>
        <option value="reconcile" ${what === 'reconcile' ? 'selected' : ''}>reconciled an account</option></select></label>
        <span class="hint">e.g. log your spending on at least 5 days a week, or reconcile at least once a week.</span>`;
    },
    readOptions: (root) => ({ what: root.querySelector('select[name=what]').value }),
    measure(src, opts, from, to) {
      const list = opts.what === 'reconcile' ? M(src).reconciliations || [] : M_txs(src).filter((t) => !t.transferId);
      return dayCount(list.filter((x) => x.date >= from && x.date <= to).map((x) => x.date));
    },
    format(v, src, opts) { return `${v} ${v === 1 ? this.targetLabel(opts).replace('days', 'day') : this.targetLabel(opts)}`; },
    progress(v, target, src, opts) { return `${v} of ${target} ${target === 1 ? this.targetLabel(opts).replace('days', 'day') : this.targetLabel(opts)}`; },
    defaultName: (opts, target, period) => (opts.what === 'reconcile' ? `Reconcile ${target}× a ${period}` : `Log spending ${target} days a ${period}`)
  }
];
  const ruleById = (id) => HABIT_RULES.find((r) => r.id === id);
  return { HABIT_RULES, ruleById };
})();
