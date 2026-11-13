/* Money Tracker — all data is stored on this device (IndexedDB). */
'use strict';

/* ---------- Storage ----------
   Saving and loading go through the shared Rojak store (../core/store.js), which provides dbGet, dbSet, dbDel,
   dbClear and dbKeys. The data stays in the same place as before, so everything saved earlier still loads. */

/* ---------- State ---------- */
// Amounts are stored as whole cents (integers) to avoid rounding errors.
const emptyState = () => ({
  accounts: [],        // {id, name, start, createdAt}
  transactions: [],    // {id, accountId, type: 'expense'|'income', amount, category, date, note, recurringId?}
  reconciliations: [], // {id, accountId, date, bank, app, hasImage, note, adjusted, adjustTxId?}
  categories: null,    // {expense: [names], income: [names]} — set up on first load
  recurring: [],       // see plan.js
  projects: [],        // see plan.js
  trips: [],           // {id, country, name, start, end, budget (cents, 0 = use estimate), note}; expenses link with tripId
  settings: { currency: 'S$', fcLookback: 6, fcMethod: 'trend', paydays: [] }
});
let state = emptyState();

// Fill in anything added in newer versions of the app.
function migrate() {
  const base = emptyState();
  // Each account's starting balance is as of a date; entries before it are history only (already in that balance).
  for (const a of state.accounts) {
    if (a.startDate === undefined) {
      const d = a.createdAt > 1e12 ? new Date(a.createdAt) : null;
      a.startDate = d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '';
    }
  }
  state.settings = Object.assign(base.settings, state.settings);
  if (!state.settings.currency) state.settings.currency = 'S$';
  // Older versions stored a single payday; turn it into a payday history.
  if (!Array.isArray(state.settings.paydays) || ('payday' in state.settings)) {
    if (!Array.isArray(state.settings.paydays)) state.settings.paydays = [];
    if (state.settings.payday && !state.settings.paydays.length) {
      state.settings.paydays.push({ from: '', payday: state.settings.payday, payWeekend: !!state.settings.payWeekend });
    }
    delete state.settings.payday; delete state.settings.payWeekend;
  }
  if (!Array.isArray(state.recurring)) state.recurring = [];
  if (!Array.isArray(state.projects)) state.projects = [];
  if (!Array.isArray(state.trips)) state.trips = [];
  // Project costs get ids (so purchases can be linked to them) and a list of options (vendors / links).
  for (const p of state.projects) for (const i of p.items || []) { if (!i.id) i.id = uid(); if (!Array.isArray(i.options)) i.options = []; }
  if (!state.categories) {
    state.categories = {};
    for (const type of ['expense', 'income']) {
      const used = state.transactions.filter((t) => t.type === type && t.category).map((t) => t.category);
      state.categories[type] = [...new Set([...DEFAULT_CATS[type], ...used])];
    }
  }
}

async function load() {
  const saved = await Rojak.load('money');
  if (saved) state = Object.assign(emptyState(), saved);
  migrate();
  if (saved) await save(); // gives entries saved earlier their dates (savedAt / updatedAt); nothing else changes
}
// The shared store also dates every entry: savedAt (first saved) and updatedAt (last changed).
function save() {
  return Rojak.save('money', state).catch((err) => {
    console.error(err);
    toast('Could not save! Storage may be full.');
  });
}

/* ---------- Helpers ---------- */
const $ = (sel) => document.querySelector(sel);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toCents = (v) => Math.round(parseFloat(String(v).replace(',', '.')) * 100);
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
function money(cents, signed = false) {
  const n = (cents || 0) / 100;
  const txt = Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sign = n < 0 ? '−' : signed && n > 0 ? '+' : '';
  return `${sign}${state.settings.currency || ''}${txt}`;
}
function niceDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (iso === today()) return 'Today';
  return dt.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}
const accountName = (id) => (state.accounts.find((a) => a.id === id) || {}).name || '(deleted account)';
const accountById = (id) => state.accounts.find((a) => a.id === id);
const isCard = (id) => (accountById(id) || {}).type === 'credit';
const bankAccounts = () => state.accounts.filter((a) => a.type !== 'credit');
const cardAccounts = () => state.accounts.filter((a) => a.type === 'credit');
// <option>s for an account picker; cards are marked with 💳.
const accountOptions = (list = state.accounts) =>
  list.map((a) => `<option value="${a.id}">${a.type === 'credit' ? '💳 ' : ''}${esc(a.name)}</option>`).join('');
// What you owe on a card (positive number). A card's balance is negative when you owe money.
const owed = (id, upTo) => -balance(id, upTo);
// The next date (today or later) that a card bill is due, or null if no due day is set.
// (Statement-cycle helpers live in plan.js.)
function nextDueDate(a) {
  if (!a.dueDay) return null;
  const cur = cardStatementWindow(a, today());
  const last = cardStatementWindow(a, addDaysISO(cur.from, -1));
  return last.due >= today() ? last.due : cur.due;
}

// Balance as of a date (default: today). Entries dated in the future are planned and don't count yet.
function balance(accountId, upToDate) {
  const acc = state.accounts.find((a) => a.id === accountId);
  if (!acc) return 0;
  const until = upToDate || today();
  let total = acc.start;
  for (const t of state.transactions) {
    if (t.accountId !== accountId) continue;
    if (t.date > until) continue;
    if (acc.startDate && t.date < acc.startDate) continue; // already included in the starting balance
    total += t.type === 'income' ? t.amount : -t.amount;
  }
  return total;
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2600);
}

/* ---------- Navigation ---------- */
const TITLES = { accounts: 'Accounts', tx: 'History', recon: 'Reconcile', plan: 'Plan', backup: 'Backup' };
let currentView = 'accounts';
function show(view) {
  currentView = view;
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + view));
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $('#viewTitle').textContent = TITLES[view];
  updateFab();
  render();
  window.scrollTo(0, 0);
}
document.querySelectorAll('.tabbar button').forEach((b) => b.addEventListener('click', () => show(b.dataset.view)));

function updateFab() {
  const hide = currentView === 'backup' || currentView === 'recon' || (currentView === 'plan' && planTab === 'forecast');
  $('#fab').classList.toggle('hidden', hide);
}

/* ---------- Bottom sheet ---------- */
function openSheet(title, html) {
  $('#sheetTitle').textContent = title;
  $('#sheetBody').innerHTML = html;
  $('#sheet').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}
function closeSheet() {
  $('#sheet').classList.add('hidden');
  $('#sheetBody').innerHTML = '';
  document.body.style.overflow = '';
}
document.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', closeSheet));

/* ---------- Rendering ---------- */
function render() {
  renderAccounts();
  renderTx();
  renderRecon();
  if (typeof renderPlan === 'function') renderPlan();
  $('#currencyInput').value = state.settings.currency || '';
  renderPaySettings();
}

function renderAccounts() {
  const list = $('#accountList');
  let total = 0;
  const dueNow = {}; // card id -> bills due this month / pay cycle
  if (!state.accounts.length) {
    list.innerHTML = `<div class="empty">No accounts yet.<br>Tap “New account” to add a bank account (e.g. Savings) or a credit card.</div>`;
  } else {
    const row = (a) => {
      const b = balance(a.id);
      total += b;
      const last = state.reconciliations.filter((r) => r.accountId === a.id).sort((x, y) => (y.date + y.id).localeCompare(x.date + x.id))[0];
      const checked = last ? `Checked ${niceDate(last.date)}` : 'Not reconciled yet';
      if (a.type === 'credit') {
        // A card shows the bills due in this month / pay cycle (what leaves the bank for it now), not all it owes.
        const d = cardDueIn(a);
        total += -b - d.amount; // undo the full balance added above; count only what's due now
        dueNow[a.id] = d.amount;
        const due = d.bills.length ? d.bills.map((x) => x.due).filter((x) => x >= today())[0] || d.bills[d.bills.length - 1].due : nextDueDate(a);
        const sub = [due ? `${d.bills.length && d.amount ? 'Due' : 'Next bill'} ${niceDate(due)}` : '', -b > 0 ? `${money(-b)} owed in total` : '',
          checked].filter(Boolean).join(' · ');
        return `<button class="item" data-acc="${a.id}">
          <div class="left"><div class="title">💳 ${esc(a.name)}</div><div class="sub">${sub}</div></div>
          <div class="amt-col"><div class="amt ${d.amount > 0 ? 'neg' : ''}">${money(d.amount)}</div><div class="sub">due this ${periodWord()}</div></div></button>`;
      }
      return `<button class="item" data-acc="${a.id}">
        <div class="left"><div class="title">${esc(a.name)}</div><div class="sub">${checked}</div></div>
        <div class="amt ${b < 0 ? 'neg' : ''}">${money(b)}</div></button>`;
    };
    const banks = bankAccounts(), cards = cardAccounts();
    list.innerHTML = banks.map(row).join('') +
      (cards.length ? `<h2 class="section-title" style="margin:12px 0 2px">Credit cards</h2>` + cards.map(row).join('') : '');
  }
  // Loans (set up under Plan → Recurring) are listed separately and not included in the total above.
  const loans = activeLoans();
  const loanTotal = loans.reduce((s, r) => s + recurringSummary(r).outstanding, 0);
  $('#loanList').innerHTML = loans.length ? `<h2 class="section-title" style="margin:4px 0 8px">Loans · ${money(loanTotal)} owed</h2><div class="list">` +
    loans.map((r) => {
      const s = recurringSummary(r);
      return `<button class="item" data-loan="${r.id}">
        <div class="left"><div class="title">🏠 ${esc(r.name)}</div><div class="sub">${s.left} left · paid off ${monthLabel(monthKey(s.last))}</div></div>
        <div class="amt-col"><div class="amt neg">${money(s.outstanding)}</div><div class="sub">owed</div></div></button>`;
    }).join('') + `</div><p class="muted small" style="margin-top:-6px">Loans aren't included in the total at the top. Tap one to update it.</p>` : '';
  $('#loanList').querySelectorAll('[data-loan]').forEach((el) => el.addEventListener('click', () => recurringSheet(el.dataset.loan)));
  const cardOwed = cardAccounts().reduce((s, a) => s + Math.max(0, owed(a.id)), 0);
  const cardDue = Object.values(dueNow).reduce((s, v) => s + v, 0);
  const bankTotal = bankAccounts().reduce((s, a) => s + balance(a.id), 0);
  $('#totalLabel').textContent = cardAccounts().length ? `Net total (bank accounts − card bills due this ${periodWord()})` : 'Total of all accounts';
  $('#totalBalance').textContent = money(total);
  $('#totalSplit').innerHTML = cardAccounts().length
    ? `In the bank ${money(bankTotal)} · Card bills due this ${periodWord()} ${money(cardDue)}<br>Owed on cards in total ${money(cardOwed)}` : '';
  // The home screen shows the same net total; it can't work out statements itself, so keep it the card
  // amounts due until the end of this month / pay cycle (after that it falls back to the full amount owed).
  const p = periodContaining(today());
  const summary = { until: p.end, byCard: dueNow };
  if (cardAccounts().length && JSON.stringify(state.cardsDue) !== JSON.stringify(summary)) { state.cardsDue = summary; save(); }
  list.querySelectorAll('[data-acc]').forEach((el) => el.addEventListener('click', () => accountSheet(el.dataset.acc)));
}

let txFilter = 'all';
let txCatFilter = 'all';
let txAllDates = false; // true = list every date, not just the month / pay cycle shown in the chart
function renderTx() {
  const sel = $('#txFilter');
  sel.innerHTML = `<option value="all">All accounts</option>` +
    accountOptions();
  if (txFilter !== 'all' && !state.accounts.some((a) => a.id === txFilter)) txFilter = 'all';
  sel.value = txFilter;

  const catSel = $('#txCatFilter');
  const cats = [...new Set([...state.categories.expense, ...state.categories.income,
    ...state.transactions.map((t) => t.category).filter(Boolean)])].sort((a, b) => a.localeCompare(b));
  catSel.innerHTML = `<option value="all">All categories</option>` +
    cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  if (txCatFilter !== 'all' && !cats.includes(txCatFilter)) txCatFilter = 'all';
  catSel.value = txCatFilter;

  const matching = state.transactions
    .filter((t) => txFilter === 'all' || t.accountId === txFilter)
    .filter((t) => txCatFilter === 'all' || t.category === txCatFilter)
    .sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id));
  // The list shows the same month / pay cycle as the chart above it (unless "Show all dates" is on).
  const p = shownPeriod();
  const txs = txAllDates ? matching : matching.filter((t) => t.date >= p.start && t.date <= p.end);
  renderSpendPie();
  const list = $('#txList');
  const totalEl = $('#txTotal');
  const word = periodWord();
  const toggle = matching.length && (txAllDates || txs.length < matching.length)
    ? `<button type="button" class="link-btn" id="txAllDates" style="display:block;margin:12px auto 4px">${txAllDates
      ? `Show only this ${word} (${shortDate(p.start)} – ${shortDate(p.end)})`
      : `Show all dates (${matching.length - txs.length} more outside this ${word})`}</button>` : '';
  if (txCatFilter !== 'all' && matching.length) {
    const net = matching.reduce((s, t) => s + (t.type === 'income' ? t.amount : -t.amount), 0);
    const inP = matching.filter((t) => t.date >= p.start && t.date <= p.end).reduce((s, t) => s + (t.type === 'income' ? t.amount : -t.amount), 0);
    totalEl.innerHTML = `<span class="muted small">${esc(txCatFilter)}, ${shortDate(p.start)} – ${shortDate(p.end)}</span><strong>${money(inP, true)}</strong>
      <span class="muted small">All time: ${money(net, true)}</span>`;
    totalEl.classList.remove('hidden');
  } else totalEl.classList.add('hidden');
  if (!txs.length) {
    list.innerHTML = (matching.length ? `<div class="empty">Nothing in this ${word}.<br>Use ‹ › above to see other ${word}s.</div>`
      : `<div class="empty">No transactions yet.<br>Tap the + button to add one.</div>`) + toggle;
    bindAllDates();
    return;
  }
  let html = '';
  let lastDate = '';
  for (const t of txs) {
    if (t.date !== lastDate) { html += `<div class="date-head">${niceDate(t.date)}</div>`; lastDate = t.date; }
    const signed = t.type === 'income' ? t.amount : -t.amount;
    const acc = accountById(t.accountId);
    const refundTag = (t.refund ? '<span class="tag">money back</span>' : '') + (t.date > today() ? '<span class="tag planned">planned</span>' : '')
      + (acc && acc.startDate && t.date < acc.startDate ? '<span class="tag planned">history only</span>' : '');
    let title = t.category || (t.type === 'income' ? 'Income' : 'Expense');
    let sub = [txFilter === 'all' ? accountName(t.accountId) : '', t.note].filter(Boolean).map(esc).join(' · ');
    if (t.transferId) {
      // Show transfers as "From → To", with the note (or "Card payment") underneath.
      const pair = state.transactions.filter((x) => x.transferId === t.transferId);
      const out = pair.find((x) => x.type === 'expense'), inn = pair.find((x) => x.type === 'income');
      if (out && inn) {
        title = `${accountName(out.accountId)} → ${accountName(inn.accountId)}`;
        sub = [txFilter === 'all' ? `${t.type === 'income' ? 'Into' : 'Out of'} ${accountName(t.accountId)}` : '',
          t.userNote || (isCard(inn.accountId) ? 'Card payment' : 'Transfer')].filter(Boolean).map(esc).join(' · ');
      }
    }
    html += `<button class="item" data-tx="${t.id}">
      <div class="left"><div class="title">${esc(title)}${refundTag}</div>
      ${sub ? `<div class="sub">${t.recurringId ? '🔁 ' : ''}${tripTag(t)}${projectTag(t)}${sub}</div>` : t.recurringId ? '<div class="sub">🔁 Recurring</div>' : tripTag(t) ? `<div class="sub">${tripTag(t)}</div>` : ''}</div>
      <div class="amt ${signed < 0 ? 'neg' : 'pos'}">${money(signed, true)}</div></button>`;
  }
  list.innerHTML = html + toggle;
  list.querySelectorAll('[data-tx]').forEach((el) => el.addEventListener('click', () => txSheet(el.dataset.tx)));
  bindAllDates();
}
function bindAllDates() {
  const b = $('#txAllDates');
  if (b) b.addEventListener('click', () => { txAllDates = !txAllDates; renderTx(); });
}
$('#txFilter').addEventListener('change', (e) => { txFilter = e.target.value; renderTx(); });
$('#txCatFilter').addEventListener('change', (e) => { txCatFilter = e.target.value; renderTx(); });

/* ---------- Spending by category (pie chart in History) ---------- */
let piePeriodStart = null; // start date of the period shown; null = the current month / pay cycle
const PIE_MAX = 5;         // biggest categories shown; the rest go into "Other"

const shownPeriod = () => periodContaining(piePeriodStart || today());

function renderSpendPie() {
  const el = $('#spendPie');
  const current = periodContaining(today());
  const p = shownPeriod();
  const isCurrent = p.start === current.start;
  // Later periods can be opened when something is logged in them (e.g. planned instalments).
  const hasLater = state.transactions.some((t) => t.date > p.end);
  // Spending = expenses, not counting card payments or transfers. Follows the account filter.
  // Spending = expenses minus money back in the same category (so it shows what you spent yourself).
  const by = {};
  let backTotal = 0;
  for (const t of state.transactions) {
    if (t.transferId || t.category === 'Transfer') continue;
    if (t.type !== 'expense' && !t.refund) continue;
    if (t.date < p.start || t.date > p.end) continue;
    if (txFilter !== 'all' && t.accountId !== txFilter) continue;
    const c = t.category || 'Other';
    by[c] = (by[c] || 0) + (t.refund ? -t.amount : t.amount);
    if (t.refund) backTotal += t.amount;
  }
  const all = Object.entries(by).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const total = all.reduce((s, [, v]) => s + v, 0);
  let parts = all.slice(0, PIE_MAX).map(([cat, v], i) => ({ cat, v, color: `var(--series-${i + 1})` }));
  const rest = all.slice(PIE_MAX);
  if (rest.length) parts.push({ cat: 'Other', v: rest.reduce((s, [, v]) => s + v, 0), color: 'var(--muted)', others: rest.map(([c]) => c) });

  const later = p.start > current.start;
  const title = cycleMode() ? (isCurrent ? 'This pay cycle' : later ? 'Upcoming pay cycle' : 'Pay cycle') : (isCurrent ? 'This month' : later ? 'Upcoming month' : 'Month');
  const range = cycleMode() ? `${shortDate(p.start)} – ${shortDate(p.end)}` : monthLabel(p.start.slice(0, 7), true);
  let body;
  if (txCatFilter !== 'all') {
    body = ''; // a single category is shown as a total below instead of the chart
  } else if (!total) {
    body = `<div class="empty" style="padding:18px 10px">No spending logged ${isCurrent ? 'yet in this ' + periodWord() : 'in this ' + periodWord()}.</div>`;
  } else {
    // Donut: one arc per part, with a small gap between slices.
    const R = 72, r = 48, C = 90;
    const pt = (rad, a) => [C + rad * Math.sin(a), C - rad * Math.cos(a)];
    let a0 = 0;
    const gap = parts.length > 1 ? 0.025 : 0;
    const arcs = parts.map((part, i) => {
      const sweep = (part.v / total) * Math.PI * 2;
      const a1 = a0 + sweep;
      let d;
      if (parts.length === 1) {
        d = `M${C} ${C - R}A${R} ${R} 0 1 1 ${C - 0.01} ${C - R}Z M${C} ${C - r}A${r} ${r} 0 1 0 ${C + 0.01} ${C - r}Z`;
      } else {
        const s0 = a0 + gap / 2, s1 = Math.max(s0 + 0.001, a1 - gap / 2);
        const large = s1 - s0 > Math.PI ? 1 : 0;
        const [x0, y0] = pt(R, s0), [x1, y1] = pt(R, s1), [x2, y2] = pt(r, s1), [x3, y3] = pt(r, s0);
        d = `M${x0} ${y0}A${R} ${R} 0 ${large} 1 ${x1} ${y1}L${x2} ${y2}A${r} ${r} 0 ${large} 0 ${x3} ${y3}Z`;
      }
      a0 = a1;
      return `<path d="${d}" fill="${part.color}" data-pi="${i}" fill-rule="evenodd"><title>${esc(part.cat)}: ${money(part.v)} (${Math.round(part.v / total * 100)}%)</title></path>`;
    }).join('');
    body = `<div class="pie-wrap">
      <svg viewBox="0 0 180 180" class="pie" role="img" aria-label="Spending by category: ${parts.map((x) => `${esc(x.cat)} ${Math.round(x.v / total * 100)}%`).join(', ')}">
        ${arcs}
        <text x="90" y="86" text-anchor="middle" class="pie-total" style="font-size:${Math.min(15, 76 / (money(total).length * 0.58)).toFixed(1)}px">${money(total)}</text>
        <text x="90" y="104" text-anchor="middle" class="pie-sub">spent</text>
      </svg>
      <div class="pie-legend">${parts.map((x, i) => `<button class="pie-row" data-pi="${i}" ${x.others ? '' : `data-cat="${esc(x.cat)}"`}>
          <i style="background:${x.color}"></i><span class="pc">${esc(x.cat)}${x.others ? ` <span class="muted small">(${x.others.length})</span>` : ''}</span>
          <span class="pv">${money(x.v)}</span><span class="pp">${Math.round(x.v / total * 100)}%</span></button>`).join('')}
      </div></div>
      ${rest.length ? `<p class="muted small" style="margin:8px 0 0">Other: ${rest.map(([c, v]) => `${esc(c)} ${money(v)}`).join(' · ')}</p>` : ''}
      ${backTotal ? `<p class="muted small" style="margin:8px 0 0">↩ ${money(backTotal)} of money back has been taken off the categories it was for.</p>` : ''}
      <p class="muted small" style="margin:8px 0 0">Tap a category to see its transactions. Card payments and transfers aren't counted.</p>`;
  }
  el.innerHTML = `<div class="pie-head">
      <button class="icon-btn" id="pieprev" aria-label="Previous ${periodWord()}">‹</button>
      <div><div class="title">${title}</div><div class="muted small">${range}${txFilter !== 'all' ? ' · ' + esc(accountName(txFilter)) : ''}</div></div>
      <button class="icon-btn" id="pienext" aria-label="Next ${periodWord()}" ${isCurrent && !hasLater ? 'disabled' : ''}>›</button>
    </div>${body}`;
  // ‹ › move the chart and the list below it together.
  $('#pieprev').addEventListener('click', () => { piePeriodStart = prevPeriod(p).start; renderTx(); });
  $('#pienext').addEventListener('click', () => {
    const n = nextPeriod(p);
    piePeriodStart = n.start === current.start ? null : n.start;
    renderTx();
  });
  // Highlight a slice and its row together; tapping a row filters History to that category.
  const highlight = (i) => el.querySelectorAll('[data-pi]').forEach((x) => x.classList.toggle('dim', i != null && x.dataset.pi !== String(i)));
  el.querySelectorAll('path[data-pi]').forEach((x) => {
    x.addEventListener('mouseenter', () => highlight(x.dataset.pi));
    x.addEventListener('mouseleave', () => highlight(null));
    x.addEventListener('click', () => { const row = el.querySelector(`.pie-row[data-pi="${x.dataset.pi}"]`); if (row) row.click(); });
  });
  el.querySelectorAll('.pie-row').forEach((x) => {
    x.addEventListener('mouseenter', () => highlight(x.dataset.pi));
    x.addEventListener('mouseleave', () => highlight(null));
    x.addEventListener('click', () => {
      if (!x.dataset.cat) return toast('“Other” groups the smaller categories listed below the chart');
      txCatFilter = x.dataset.cat; renderTx(); window.scrollTo(0, 0);
    });
  });
}

/* ---------- Accounts ---------- */
$('#addAccountBtn').addEventListener('click', () => accountSheet());
$('#transferBtn').addEventListener('click', () => transferSheet());

function accountSheet(id) {
  const a = state.accounts.find((x) => x.id === id);
  let type = a ? a.type || 'bank' : 'bank';
  const others = bankAccounts().filter((x) => !a || x.id !== a.id);
  const curWin = a && type === 'credit' ? cardStatementWindow(a, today()) : null;
  const dueNow = curWin ? cardDueIn(a) : null;
  const curSt = curWin ? cardStatement(a, curWin) : null;
  const lastSt = curWin ? cardStatement(a, cardStatementWindow(a, addDaysISO(curWin.from, -1))) : null;
  // A statement's total, with what it's made of underneath (only the parts that apply).
  const stmtRows = (st, label, isLast) => {
    const parts = [];
    if (st.opening) parts.push(['Owed on ' + shortDate(a.startDate) + ' (amount you entered)', st.opening]);
    if (st.spent && (st.opening || st.planned || st.recurring || st.paid)) parts.push([isLast || st.to <= today() ? 'Spending' : 'Spent so far', st.spent]);
    if (st.planned) parts.push(['Planned (dated later)', st.planned]);
    for (const m of st.missed) parts.push([`🔁 ${esc(m.r.name)}, ${shortDate(m.d)} — not logged <button type="button" class="link-btn small" data-logrec="${m.r.id}|${m.d}|${m.amount}">Log it</button>`, m.amount]);
    const upcoming = st.recurring - st.missed.reduce((x, m) => x + m.amount, 0);
    if (upcoming) parts.push(['🔁 Recurring payments still to come', upcoming]);
    let html = `<div class="kv"><span class="k">${label}</span><span class="v">${money(st.total)}</span></div>`;
    if (parts.length > 1 || st.paid) html += parts.map(([k, v]) => `<div class="kv sub"><span class="k">${k}</span><span class="v">${money(v)}</span></div>`).join('');
    if (isLast && st.paid) html += `<div class="kv sub"><span class="k">Paid since</span><span class="v">−${money(st.paid)}</span></div>
      <div class="kv sub"><span class="k">Left to pay</span><span class="v">${money(st.left)}</span></div>`;
    return html;
  };
  openSheet(a ? (type === 'credit' ? 'Credit card' : 'Edit account') : 'New account', `
    <form class="form" id="accForm">
      ${a ? '' : `<div class="segmented" id="accType">
        <button type="button" data-t="bank">Bank account</button>
        <button type="button" data-t="credit">💳 Credit card</button></div>`}
      ${a && type === 'credit' ? `<div class="card-inset">
        <div class="kv total"><span class="k">Due this ${periodWord()} (${shortDate(dueNow.period.start)} – ${shortDate(dueNow.period.end)})</span><span class="v">${money(dueNow.amount)}</span></div>
        ${dueNow.bills.map((x) => `<div class="kv sub"><span class="k">Bill due ${shortDate(x.due)}${x.paid ? `, ${money(x.paid)} paid` : ''}</span><span class="v">${money(x.left)}</span></div>`).join('')}
        ${dueNow.bills.length ? '' : `<div class="kv sub"><span class="k">${lastSt.left && lastSt.due > dueNow.period.end
          ? `The bill due ${shortDate(lastSt.due)} (${money(lastSt.left)}) counts from ${shortDate(addDaysISO(dueNow.period.end, 1))}, when the next ${periodWord()} starts.`
          : `No bill due in this ${periodWord()}.`}</span></div>`}
        <div class="kv"><span class="k">Owed now (everything on the card)</span><span class="v">${money(Math.max(0, owed(a.id)))}</span></div>
        ${stmtRows(lastSt, `Last statement (${shortDate(lastSt.from)} – ${shortDate(lastSt.to)}), due ${a.dueDay ? shortDate(lastSt.due) : '—'}`, true)}
        ${stmtRows(curSt, `This statement (${shortDate(curSt.from)} – ${shortDate(curSt.to)})`, false)}
        ${nextDueDate(a) ? `<div class="kv"><span class="k">Next bill due</span><span class="v">${niceDate(nextDueDate(a))}</span></div>` : ''}
        ${a.limit ? `<div class="kv"><span class="k">Available credit</span><span class="v">${money(a.limit - Math.max(0, owed(a.id)))}</span></div>` : ''}
      </div>
      <button type="button" class="btn full" id="accPay">Pay card bill</button>` : ''}
      <label>Name
        <input id="accName" required maxlength="40" placeholder="e.g. Savings" value="${esc(a ? a.name : '')}">
      </label>
      <label><span id="accStartLabel">Starting balance</span>
        <input id="accStart" type="number" inputmode="decimal" step="0.01" required placeholder="0.00"
          value="${a ? ((type === 'credit' ? -a.start : a.start) / 100).toFixed(2) : ''}">
      </label>
      <label><span id="accDateLabel">Balance as of</span>
        <input id="accStartDate" type="date" value="${a ? a.startDate || '' : today()}">
      </label>
      <p class="muted small" style="margin:-8px 0 0">Entries dated before this day (e.g. past trips you add later) are kept for history and charts, but don't change the balance — it already includes them.</p>
      <div id="accCardFields" class="form">
        <label>Pay the bill from
          <select id="accPayFrom"><option value="">—</option>${accountOptions(others)}</select>
        </label>
        <label>Statement closes on day of the month (optional)
          <input id="accStmtDay" type="number" inputmode="numeric" min="1" max="31" step="1" placeholder="e.g. 15 — blank = end of month" value="${a && a.statementDay ? a.statementDay : ''}">
        </label>
        <label>Bill due on day of the month (optional)
          <input id="accDueDay" type="number" inputmode="numeric" min="1" max="31" step="1" placeholder="e.g. 25" value="${a && a.dueDay ? a.dueDay : ''}">
        </label>
        <label>Credit limit (optional)
          <input id="accLimit" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0.00" value="${a && a.limit ? (a.limit / 100).toFixed(2) : ''}">
        </label>
      </div>
      ${a && type !== 'credit' ? `<p class="muted small">Current balance: <strong>${money(balance(a.id))}</strong></p>` : ''}
      <button class="btn full" type="submit">Save</button>
      ${a ? `<div class="btn-row">
        <button type="button" class="btn secondary" id="accView">See transactions</button>
        <button type="button" class="btn danger" id="accDel">Delete</button></div>` : ''}
    </form>`);
  if (a && a.payFromId) $('#accPayFrom').value = a.payFromId;
  else if (others.length) $('#accPayFrom').value = others[0].id;
  function setType(t) {
    type = t;
    document.querySelectorAll('#accType button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
    $('#accCardFields').classList.toggle('hidden', t !== 'credit');
    $('#accStartLabel').textContent = t === 'credit' ? 'Amount owed on the card' : 'Starting balance';
    $('#accDateLabel').textContent = t === 'credit' ? 'Owed as of' : 'Balance as of';
    $('#accName').placeholder = t === 'credit' ? 'e.g. Citi Rewards' : 'e.g. Savings';
  }
  document.querySelectorAll('#accType button').forEach((b) => b.addEventListener('click', () => setType(b.dataset.t)));
  setType(type);

  $('#accForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#accName').value.trim();
    let start = toCents($('#accStart').value);
    if (!name || isNaN(start)) return toast(type === 'credit' ? 'Please fill in the name and amount owed' : 'Please fill in the name and starting balance');
    const data = { name, type };
    if (type === 'credit') {
      start = -start; // owing money = negative balance
      const limit = toCents($('#accLimit').value || '0');
      const due = parseInt($('#accDueDay').value, 10);
      const stmt = parseInt($('#accStmtDay').value, 10);
      Object.assign(data, { payFromId: $('#accPayFrom').value, limit: isNaN(limit) ? 0 : limit,
        dueDay: due >= 1 && due <= 31 ? due : 0, statementDay: stmt >= 1 && stmt <= 31 ? stmt : 0 });
    }
    data.start = start;
    data.startDate = $('#accStartDate').value || '';
    if (a) Object.assign(a, data);
    else state.accounts.push({ id: uid(), createdAt: Date.now(), ...data });
    await save();
    closeSheet(); render();
    toast(type === 'credit' ? 'Card saved' : 'Account saved');
  });
  if (a) {
    if ($('#accPay')) $('#accPay').addEventListener('click', () => payCardSheet(a.id));
    // Log a recurring payment that's due on this card but wasn't logged (opens Add transaction, filled in).
    document.querySelectorAll('[data-logrec]').forEach((b) => b.addEventListener('click', () => {
      const [rid, date, amount] = b.dataset.logrec.split('|');
      const r = state.recurring.find((x) => x.id === rid);
      if (r) txSheet(null, { type: 'expense', amount: Number(amount), category: r.category, accountId: a.id, recurringId: r.id, note: r.name, date });
    }));
    $('#accView').addEventListener('click', () => { txFilter = a.id; closeSheet(); show('tx'); });
    $('#accDel').addEventListener('click', async () => {
      const n = state.transactions.filter((t) => t.accountId === a.id).length;
      if (!confirm(`Delete “${a.name}” and its ${n} transaction(s) and reconciliations? This cannot be undone.`)) return;
      const recs = state.reconciliations.filter((r) => r.accountId === a.id);
      // Card payments have a matching transaction in the other account — remove those too.
      const pairIds = new Set(state.transactions.filter((t) => t.accountId === a.id && t.transferId).map((t) => t.transferId));
      state.accounts = state.accounts.filter((x) => x.id !== a.id);
      state.transactions = state.transactions.filter((t) => t.accountId !== a.id && !(t.transferId && pairIds.has(t.transferId)));
      state.reconciliations = state.reconciliations.filter((r) => r.accountId !== a.id);
      for (const x of state.accounts) if (x.payFromId === a.id) x.payFromId = '';
      await save();
      for (const r of recs) await dbDel('img:' + r.id);
      closeSheet(); render();
      toast('Account deleted');
    });
  }
}

/* ---------- Transfers between your own accounts (incl. paying a card bill) ---------- */
// A transfer is two linked transactions sharing a transferId: money out of one account, money into another.
// Both use the category 'Transfer', so they're never counted as spending or income.
function payCardSheet(cardId) {
  const card = accountById(cardId);
  if (!bankAccounts().length) return toast('Add a bank account to pay the card from');
  const cur = cardStatementWindow(card, today());
  const last = cardStatement(card, cardStatementWindow(card, addDaysISO(cur.from, -1)));
  transferSheet({ toId: cardId, fromId: card.payFromId, amount: last.left || Math.max(0, owed(cardId)) });
}

function transferSheet(opts = {}) {
  if (state.accounts.length < 2) return toast('Add a second account to transfer between');
  const pairId = opts.pairId;
  const existing = pairId ? state.transactions.filter((t) => t.transferId === pairId) : [];
  const out = existing.find((t) => t.type === 'expense');
  const inn = existing.find((t) => t.type === 'income');
  const fromId = out ? out.accountId : opts.fromId;
  const toId = inn ? inn.accountId : opts.toId;
  const amt = out ? out.amount : opts.amount || 0;
  const userNote = out ? out.userNote || '' : opts.note || '';
  const withBal = (list) => list.map((a) => `<option value="${a.id}">${a.type === 'credit' ? '💳 ' : ''}${esc(a.name)} · ${a.type === 'credit'
    ? money(Math.max(0, owed(a.id))) + ' owed' : money(balance(a.id))}</option>`).join('');
  openSheet(out ? 'Transfer' : 'Transfer between accounts', `
    <form class="form" id="xferForm">
      <label>From
        <select id="xfFrom">${withBal(state.accounts)}</select>
      </label>
      <button type="button" class="icon-btn swap" id="xfSwap" aria-label="Swap from and to">⇅</button>
      <label>To
        <select id="xfTo">${withBal(state.accounts)}</select>
      </label>
      <p id="xfOwed" class="muted small hidden" style="margin:-4px 0 0"></p>
      <label>Amount
        <input id="xfAmt" type="number" inputmode="decimal" step="0.01" min="0.01" required placeholder="0.00" value="${amt ? (amt / 100).toFixed(2) : ''}">
      </label>
      <label>Date
        <input id="xfDate" type="date" required value="${out ? out.date : today()}">
      </label>
      <label>Note (optional)
        <input id="xfNote" maxlength="100" placeholder="e.g. Salary to savings" value="${esc(userNote)}">
      </label>
      <p class="muted small" style="margin:0" id="xfHint"></p>
      <button class="btn full" type="submit">${out ? 'Save' : 'Transfer'}</button>
      ${out ? '<button type="button" class="btn danger full" id="xfDel">Delete transfer</button>' : ''}
    </form>`);
  const banks = bankAccounts();
  $('#xfFrom').value = state.accounts.some((a) => a.id === fromId) ? fromId : (banks[0] || state.accounts[0]).id;
  const firstOther = () => state.accounts.find((a) => a.id !== $('#xfFrom').value).id;
  $('#xfTo').value = state.accounts.some((a) => a.id === toId) && toId !== $('#xfFrom').value ? toId : firstOther();
  function hint() {
    const to = accountById($('#xfTo').value);
    const from = accountById($('#xfFrom').value);
    const toCard = to && to.type === 'credit';
    $('#xfOwed').classList.toggle('hidden', !toCard);
    if (toCard) $('#xfOwed').textContent = `You owe ${money(Math.max(0, owed(to.id)))} on ${to.name}.`;
    $('#xfHint').textContent = toCard
      ? 'Paying a card bill moves money to the card. It isn\'t counted as spending — the purchases on the card already were.'
      : from && from.type === 'credit' ? 'Moving money out of a card adds to what you owe on it.'
        : 'Moving money between your own accounts isn\'t counted as spending or income.';
  }
  $('#xfFrom').addEventListener('change', () => { if ($('#xfTo').value === $('#xfFrom').value) $('#xfTo').value = firstOther(); hint(); });
  $('#xfTo').addEventListener('change', hint);
  $('#xfSwap').addEventListener('click', () => {
    const a = $('#xfFrom').value; $('#xfFrom').value = $('#xfTo').value; $('#xfTo').value = a; hint();
  });
  hint();
  $('#xferForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const amount = toCents($('#xfAmt').value);
    if (!(amount > 0)) return toast('Enter an amount above 0');
    const from = $('#xfFrom').value, to = $('#xfTo').value;
    if (from === to) return toast('Pick two different accounts');
    const date = $('#xfDate').value || today();
    const note = $('#xfNote').value.trim();
    const toCard = isCard(to);
    const label = (side) => {
      const base = toCard
        ? (side === 'out' ? `Card payment → ${accountName(to)}` : `Card payment from ${accountName(from)}`)
        : (side === 'out' ? `Transfer → ${accountName(to)}` : `Transfer from ${accountName(from)}`);
      return note ? `${base} · ${note}` : base;
    };
    const tid = pairId || uid();
    state.transactions = state.transactions.filter((t) => t.transferId !== tid);
    state.transactions.push(
      { id: uid(), transferId: tid, accountId: from, type: 'expense', amount, category: 'Transfer', date, note: label('out'), userNote: note },
      { id: uid(), transferId: tid, accountId: to, type: 'income', amount, category: 'Transfer', date, note: label('in'), userNote: note });
    await save();
    closeSheet(); render();
    toast(toCard ? 'Card payment recorded' : 'Transfer recorded');
  });
  if (out) $('#xfDel').addEventListener('click', async () => {
    if (!confirm('Delete this transfer (from both accounts)?')) return;
    state.transactions = state.transactions.filter((t) => t.transferId !== pairId);
    await save(); closeSheet(); render(); toast('Transfer deleted');
  });
}

/* ---------- Transactions ---------- */
const DEFAULT_CATS = {
  expense: ['Food', 'Groceries', 'Transport', 'Bills', 'Rent', 'Shopping', 'Health', 'Entertainment',
    'Loan repayment', 'Instalment', 'Insurance', 'Subscriptions', 'Transfer', 'Other'],
  income: ['Salary', 'Gift', 'Refund', 'Interest', 'Transfer', 'Other']
};
function categoriesFor(type) {
  return [...state.categories[type]];
}
function addCategory(type, name) {
  if (!state.categories[type].includes(name)) state.categories[type].push(name);
}

// A category <select> with a "+ New category…" option and a hidden text box for the new name.
function catPickerHtml(prefix, label = 'Category') {
  return `<label>${label}<select id="${prefix}Cat"></select></label>
    <label id="${prefix}CatNewWrap" class="hidden">New category name
      <input id="${prefix}CatNew" maxlength="30" placeholder="e.g. Pets"></label>`;
}
function setupCatPicker(prefix, type, selected, extra = []) {
  const sel = $('#' + prefix + 'Cat');
  const cats = [...extra, ...categoriesFor(type)];
  if (selected && !cats.includes(selected)) cats.push(selected);
  sel.innerHTML = cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('') + `<option value="__new">+ New category…</option>`;
  sel.value = selected && cats.includes(selected) ? selected : cats[0];
  $('#' + prefix + 'CatNewWrap').classList.add('hidden');
  sel.onchange = () => {
    const isNew = sel.value === '__new';
    $('#' + prefix + 'CatNewWrap').classList.toggle('hidden', !isNew);
    if (isNew) $('#' + prefix + 'CatNew').focus();
  };
}
// Returns the chosen category name (adding a new one if typed), or '' if a new name is missing.
function readCatPicker(prefix, type) {
  let c = $('#' + prefix + 'Cat').value;
  if (c === '__new') {
    c = $('#' + prefix + 'CatNew').value.trim();
    if (c) addCategory(type, c);
  }
  return c;
}

$('#fab').addEventListener('click', () => {
  if (currentView === 'plan') return planFab();
  if (!state.accounts.length) { toast('Create an account first'); accountSheet(); return; }
  txSheet();
});

function txSheet(id, prefill) {
  const t = state.transactions.find((x) => x.id === id);
  if (t && t.transferId) {
    const both = state.transactions.filter((x) => x.transferId === t.transferId);
    if (both.length === 2 && both.every((x) => accountById(x.accountId))) return transferSheet({ pairId: t.transferId });
  }
  const p = t || prefill || {};
  // In the form, 'refund' (Money back) is its own type; it is saved as income with refund: true.
  let type = p.refund ? 'refund' : p.type || 'expense';
  const catType = () => (type === 'income' ? 'income' : 'expense'); // money back uses spending categories
  const defaultAcc = p.accountId || (txFilter !== 'all' ? txFilter : state.accounts[0].id);
  openSheet(t ? 'Edit transaction' : 'Add transaction', `
    <form class="form" id="txForm">
      <div class="segmented tx-types">
        <button type="button" data-type="expense" class="expense">Expense</button>
        <button type="button" data-type="income" class="income">Income</button>
        <button type="button" data-type="refund" class="refund">Money back</button>
      </div>
      ${t ? '' : `<button type="button" class="link-btn" id="txToTransfer">⇄ Moving money between your own accounts? Use Transfer</button>
      <label class="btn secondary full file-btn">📷 Fill from a screenshot (receipt, payment, ride…)
        <input type="file" id="txShot" accept="image/*"></label>
      <div id="txOcr" class="ocr-box small hidden" aria-live="polite"></div>`}
      <p id="txRefundHint" class="muted small hidden" style="margin:-4px 0 0">For refunds, or a friend paying you back for something you paid for. It's added to the account and taken off that category's spending, so the category shows what you spent yourself.</p>
      <label>Amount
        <input id="txAmount" type="number" inputmode="decimal" step="0.01" min="0.01" required placeholder="0.00" value="${p.amount ? (p.amount / 100).toFixed(2) : ''}">
      </label>
      <label>Account
        <select id="txAccount">${accountOptions()}</select>
      </label>
      ${catPickerHtml('tx')}
      <label id="txRecWrap" class="hidden">Part of a recurring payment?
        <select id="txRec"></select>
      </label>
      <label>Date
        <input id="txDate" type="date" required value="${p.date || today()}">
      </label>
      <label id="txProjWrap" class="hidden">For a savings project (optional)
        <select id="txProj"></select>
      </label>
      <label id="txTripWrap" class="hidden">Trip (optional)
        <select id="txTrip"></select>
      </label>
      <p id="txTripHint" class="muted small hidden" style="margin:-8px 0 0"></p>
      <label>Note (optional)
        <input id="txNote" maxlength="100" placeholder="e.g. Lunch with Sam" value="${esc(p.note || '')}">
      </label>
      <button class="btn full" type="submit">Save</button>
      ${t ? `<button type="button" class="btn danger full" id="txDel">Delete</button>` : ''}
    </form>`);
  $('#txAccount').value = state.accounts.some((a) => a.id === defaultAcc) ? defaultAcc : state.accounts[0].id;

  // Trip: spending can be linked to a trip. New entries dated during a trip are linked to it automatically.
  const tripSel = $('#txTrip');
  let tripTouched = !!(t || p.tripId);
  function fillTrips() {
    const trips = [...(state.trips || [])].sort((a, b) => b.start.localeCompare(a.start));
    $('#txTripWrap').classList.toggle('hidden', !trips.length || type === 'income');
    const cur = tripSel.value || p.tripId || '';
    tripSel.innerHTML = `<option value="">Not part of a trip</option>` +
      trips.map((x) => `<option value="${x.id}">✈️ ${esc(tripTitle(x))} · ${shortDate(x.start)} – ${shortDate(x.end)}</option>`).join('');
    tripSel.value = trips.some((x) => x.id === cur) ? cur : '';
    if (!tripTouched) {
      const d = $('#txDate').value;
      const during = trips.find((x) => d >= x.start && d <= x.end);
      tripSel.value = during ? during.id : '';
      // Money back usually comes after the trip: suggest a trip that ended in the 60 days before.
      const recent = !during && type === 'refund'
        && trips.find((x) => x.end < d && daysBetween(x.end, d) <= 60);
      const hint = $('#txTripHint');
      if (during) hint.textContent = `Linked to your ${tripTitle(during)} trip because of the date — change it if this isn't travel.`;
      else if (recent) hint.innerHTML = `Money back for your ${esc(tripTitle(recent))} trip (ended ${shortDate(recent.end)})? <button type="button" class="link-btn small" id="txTripSuggest">Link it</button>`;
      hint.classList.toggle('hidden', !during && !recent);
      const sug = $('#txTripSuggest');
      if (sug) sug.addEventListener('click', () => {
        tripSel.value = recent.id; tripTouched = true;
        hint.textContent = `Linked to your ${tripTitle(recent)} trip — it'll be taken off the trip's spending.`;
      });
    }
  }
  tripSel.addEventListener('change', () => { tripTouched = true; $('#txTripHint').classList.add('hidden'); });

  // Savings project: a purchase can be linked to one of a project's costs, so the project shows what was actually paid.
  const projSel = $('#txProj');
  function fillProjects() {
    const projs = state.projects.filter((x) => (x.items || []).length);
    $('#txProjWrap').classList.toggle('hidden', !projs.length || type === 'income');
    const cur = projSel.value || (p.projectId ? `${p.projectId}:${p.projectItemId || ''}` : '');
    projSel.innerHTML = `<option value="">Not for a project</option>` + projs.map((x) => `<optgroup label="🎯 ${esc(x.name)}">` +
      x.items.map((i) => `<option value="${x.id}:${i.id}">${esc(x.name)} · ${esc(i.name)}</option>`).join('') + '</optgroup>').join('');
    projSel.value = [...projSel.options].some((o) => o.value === cur) ? cur : '';
  }
  $('#txDate').addEventListener('input', fillTrips);

  const recSel = $('#txRec');
  function fillRecurring(selected) {
    const recs = type === 'refund' ? [] : state.recurring.filter((r) => r.type === type);
    $('#txRecWrap').classList.toggle('hidden', !recs.length);
    recSel.innerHTML = `<option value="">No — one-off</option>` +
      recs.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('');
    recSel.value = recs.some((r) => r.id === selected) ? selected : '';
  }
  recSel.addEventListener('change', () => {
    const r = state.recurring.find((x) => x.id === recSel.value);
    if (!r) return;
    setupCatPicker('tx', catType(), r.category);
    if (!$('#txAmount').value) $('#txAmount').value = (r.amount / 100).toFixed(2);
  });
  function setType(newType, keepCat) {
    type = newType;
    document.querySelectorAll('#txForm .segmented button').forEach((b) => b.classList.toggle('on', b.dataset.type === type));
    // Keep the chosen category when switching between Expense and Money back (both use spending categories).
    const cur = $('#txCat').value;
    setupCatPicker('tx', catType(), keepCat || (type !== 'income' && cur && cur !== '__new' && categoriesFor('expense').includes(cur) ? cur : undefined));
    $('#txRefundHint').classList.toggle('hidden', type !== 'refund');
    fillTrips();
    fillProjects();
    $('#txNote').placeholder = type === 'refund' ? 'e.g. Joyce paid me back for Chagee' : 'e.g. Lunch with Sam';
    fillRecurring(p.recurringId);
  }
  document.querySelectorAll('#txForm .segmented button').forEach((b) => b.addEventListener('click', () => setType(b.dataset.type)));
  setType(type, p.category);
  if (!t && !p.amount) setTimeout(() => { const el = $('#txAmount'); if (el) el.focus(); }, 250);
  if ($('#txShot')) {
    let catTouched = false;
    $('#txCat').addEventListener('change', () => { catTouched = true; });
    $('#txShot').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) fillTxFromScreenshot(file, { catTouched: () => catTouched, catType });
    });
  }
  if ($('#txToTransfer')) $('#txToTransfer').addEventListener('click', () => {
    if (state.accounts.length < 2) return toast('Add a second account to transfer between');
    transferSheet({ fromId: $('#txAccount').value, amount: toCents($('#txAmount').value) || 0 });
  });

  $('#txForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const amount = toCents($('#txAmount').value);
    if (!(amount > 0)) return toast('Enter an amount above 0');
    const category = readCatPicker('tx', catType());
    if (!category) return toast('Type a name for the new category');
    const data = {
      type: type === 'refund' ? 'income' : type, refund: type === 'refund' || undefined, amount, category,
      accountId: $('#txAccount').value,
      date: $('#txDate').value || today(),
      note: $('#txNote').value.trim(),
      recurringId: recSel.value || undefined,
      tripId: (type !== 'income' && tripSel.value) || undefined,
      projectId: (type !== 'income' && projSel.value && projSel.value.split(':')[0]) || undefined,
      projectItemId: (type !== 'income' && projSel.value && projSel.value.split(':')[1]) || undefined
    };
    // A purchase paid from money set aside for a project: offer to take it off the project's typed-in savings.
    const proj = data.projectId && state.projects.find((x) => x.id === data.projectId);
    const newlyLinked = data.projectId && (!t || t.projectId !== data.projectId || t.amount !== amount);
    if (proj && newlyLinked && type === 'expense' && proj.savedMode !== 'account' && proj.saved > 0
      && confirm(`Was this paid from the money saved for “${proj.name}”? Tap OK to take ${money(Math.min(amount, proj.saved))} off its saved amount.`)) {
      proj.saved = Math.max(0, proj.saved - amount);
    }
    if (t) Object.assign(t, data);
    else state.transactions.push({ id: uid(), ...data });
    await save();
    closeSheet(); render();
    toast(t ? 'Transaction updated' : 'Transaction added');
  });
  if (t) {
    $('#txDel').addEventListener('click', async () => {
      if (!confirm('Delete this transaction?')) return;
      state.transactions = state.transactions.filter((x) => x.id !== t.id);
      await save();
      closeSheet(); render();
      toast('Transaction deleted');
    });
  }
}

/* ---------- Reconciliation ---------- */
let reconImageData = null; // compressed data URL of the chosen screenshot

function renderRecon() {
  const sel = $('#reconAccount');
  const prev = sel.value;
  sel.innerHTML = state.accounts.length
    ? accountOptions()
    : `<option value="">Create an account first</option>`;
  if (state.accounts.some((a) => a.id === prev)) sel.value = prev;
  if (!$('#reconDate').value) $('#reconDate').value = today();
  updateReconCompare();

  const list = $('#reconList');
  const recs = [...state.reconciliations].sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id));
  if (!recs.length) {
    list.innerHTML = `<div class="empty">No reconciliations yet.</div>`;
    return;
  }
  list.innerHTML = recs.map((r) => {
    const diff = r.bank - r.app;
    const status = diff === 0 ? '✅ Matches' : r.adjusted ? '🔧 Adjusted' : `⚠️ Off by ${money(isCard(r.accountId) ? -diff : diff, true)}`;
    return `<button class="item" data-rec="${r.id}">
      ${r.hasImage ? `<img class="thumb" data-img="${r.id}" alt="">` : ''}
      <div class="left" style="flex:1"><div class="title">${esc(accountName(r.accountId))}</div>
      <div class="sub">${niceDate(r.date)} · ${status}</div></div>
      <div class="amt">${money(isCard(r.accountId) ? -r.bank : r.bank)}</div></button>`;
  }).join('');
  list.querySelectorAll('[data-rec]').forEach((el) => el.addEventListener('click', () => reconSheet(el.dataset.rec)));
  list.querySelectorAll('img[data-img]').forEach(async (img) => {
    const src = await dbGet('img:' + img.dataset.img);
    if (src) img.src = src;
  });
}

function updateReconCompare() {
  const accId = $('#reconAccount').value;
  const date = $('#reconDate').value || today();
  const card = isCard(accId);
  // For cards everything is shown as the amount owed (a positive number).
  const app = accId ? (card ? owed(accId, date) : balance(accId, date)) : 0;
  $('#reconBankLabel').textContent = card ? 'Amount owed shown by your bank' : 'Balance shown in your bank';
  $('#reconAppLabel').textContent = card ? 'Owed in the app' : 'App balance';
  $('#reconApp').textContent = money(app);
  const bankRaw = $('#reconBank').value;
  const diffEl = $('#reconDiff');
  diffEl.className = '';
  if (bankRaw === '' || isNaN(toCents(bankRaw))) { diffEl.textContent = '–'; return; }
  const diff = toCents(bankRaw) - app;
  diffEl.textContent = diff === 0 ? '✅ 0.00' : money(diff, true);
  diffEl.className = diff === 0 ? 'pos' : 'neg';
}
['#reconAccount', '#reconDate', '#reconBank'].forEach((s) => $(s).addEventListener('input', updateReconCompare));
$('#reconAccount').addEventListener('change', updateReconCompare);

// Shrink screenshots so they don't fill up the phone's storage.
function compressImage(file, maxSide = 1400, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read image')); };
    img.src = url;
  });
}
$('#reconImage').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  const preview = $('#reconPreview');
  if (!file) { reconImageData = null; preview.classList.add('hidden'); $('#reconOcr').classList.add('hidden'); return; }
  try {
    reconImageData = await compressImage(file);
    preview.src = reconImageData;
    preview.classList.remove('hidden');
  } catch {
    reconImageData = null;
    toast('Could not read that image');
    return;
  }
  readBalanceFromScreenshot(file);
});

/* ---------- Reading the balance from a screenshot (on this phone, no upload) ----------
   Uses Tesseract.js (bundled in /ocr, loaded the first time it's needed) to read the text in the screenshot,
   then picks the amount most likely to be the balance. You can always change it. */
let ocrWorker = null;
let ocrRun = 0; // ignores results from an older screenshot if a new one was picked
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('Could not load ' + src));
    document.head.appendChild(s);
  });
}
let ocrProgress = null;
async function getOcrWorker(onProgress) {
  ocrProgress = onProgress || null;
  if (ocrWorker) return ocrWorker;
  if (!window.Tesseract) await loadScript('ocr/tesseract.min.js');
  ocrWorker = await Tesseract.createWorker('eng', 1 /* LSTM only */, {
    workerPath: 'ocr/worker.min.js', corePath: 'ocr/core', langPath: 'ocr/lang', gzip: true, workerBlobURL: false,
    logger: (m) => { if (ocrProgress && m.status === 'recognizing text') ocrProgress(m.progress); }
  });
  return ocrWorker;
}

// Amounts in OCR text, best guess first: [{cents, label}]. Card screens: prefer the outstanding / current balance.
function findBalanceCandidates(text, forCard) {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const re = /(S\$|SGD|\$)?\s*(\d{1,3}(?:[,\s]\d{3})+|\d+)[.,](\d{2})(?![\d%])/g;
  const found = new Map();
  lines.forEach((line, i) => {
    for (const m of line.matchAll(re)) {
      const cents = parseInt(m[2].replace(/[,\s]/g, ''), 10) * 100 + parseInt(m[3], 10);
      if (!(cents > 0)) continue;
      // The label is usually on the same line or the line above the amount.
      const ctx = `${lines[i - 1] || ''} ${line}`.toLowerCase();
      let score = m[1] ? 1 : 0;
      if (/available\s*bal/.test(ctx)) score += forCard ? 1 : 6;
      if (/(current|ledger|account|total)\s*bal/.test(ctx)) score += 5;
      if (/outstanding|statement\s*bal|amount\s*due|total\s*due/.test(ctx)) score += forCard ? 6 : 2;
      if (/balance/.test(ctx)) score += 3;
      if (/available\s*(credit|limit)|credit\s*limit|\blimit\b|min(imum)?\.?\s*(payment|amount|due)|interest|reward|points|cashback|rebate|pending|spent|transaction/.test(ctx)) score -= 5;
      const label = (/[a-z]{3,}/i.test(line.replace(m[0], '')) ? line.replace(m[0], '') : lines[i - 1] || '').replace(/[^\w\s&()'-]/g, ' ').replace(/\s+/g, ' ').replace(/^[\s-]+|[\s-]+$/g, '').slice(0, 40);
      const prev = found.get(cents);
      if (!prev || score > prev.score) found.set(cents, { cents, score, label });
    }
  });
  return [...found.values()].sort((a, b) => b.score - a.score || b.cents - a.cents);
}

async function readBalanceFromScreenshot(file) {
  const run = ++ocrRun;
  const box = $('#reconOcr');
  const show = (html) => { if (run === ocrRun) { box.innerHTML = html; box.classList.remove('hidden'); } };
  show('🔎 Reading the balance from your screenshot…');
  let text = '';
  try {
    const worker = await getOcrWorker((p) => show(`🔎 Reading the balance from your screenshot… ${Math.round(p * 100)}%`));
    ({ data: { text } } = await worker.recognize(file));
  } catch (err) {
    console.warn(err);
    show('Couldn\'t read the screenshot on this phone — type the balance below.');
    return;
  }
  if (run !== ocrRun) return;
  // If exactly one of your account names appears in the screenshot, pick that account.
  let accNote = '';
  const named = state.accounts.filter((a) => a.name.trim().length >= 3 && text.toLowerCase().includes(a.name.trim().toLowerCase()));
  if (named.length === 1 && $('#reconAccount').value !== named[0].id) {
    $('#reconAccount').value = named[0].id;
    accNote = ` Account set to <strong>${esc(named[0].name)}</strong> (its name is in the screenshot).`;
  }
  const cands = findBalanceCandidates(text, isCard($('#reconAccount').value));
  if (!cands.length) {
    show('Couldn\'t find an amount in the screenshot — type the balance below.' + accNote);
    updateReconCompare();
    return;
  }
  const pick = (c) => {
    $('#reconBank').value = (c.cents / 100).toFixed(2);
    updateReconCompare();
    box.querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', +x.dataset.c === c.cents));
  };
  const best = cands[0];
  show(`<div>✅ Found <strong>${money(best.cents)}</strong>${best.label ? ` next to “${esc(best.label)}”` : ''} and filled it in below. Please check it matches your screenshot.${accNote}</div>
    ${cands.length > 1 ? `<div class="muted small" style="margin-top:6px">Not the right one? Tap another amount from the screenshot, or type it in:</div>
    <div class="chips">${cands.slice(0, 6).map((c) => `<button type="button" class="chip" data-c="${c.cents}">${money(c.cents)}${c.label ? `<span>${esc(c.label)}</span>` : ''}</button>`).join('')}</div>` : ''}`);
  box.querySelectorAll('.chip').forEach((x) => x.addEventListener('click', () => pick(cands.find((c) => c.cents === +x.dataset.c))));
  pick(best);
}

$('#reconForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const accountId = $('#reconAccount').value;
  if (!accountId) return toast('Create an account first');
  let bank = toCents($('#reconBank').value);
  if (isNaN(bank)) return toast('Type the balance shown in your bank');
  if (isCard(accountId)) bank = -bank; // stored as a balance: owing money is negative
  const date = $('#reconDate').value || today();
  const rec = {
    id: uid(), accountId, date, bank,
    app: balance(accountId, date),
    hasImage: !!reconImageData,
    note: $('#reconNote').value.trim(),
    adjusted: false
  };
  if (reconImageData) await dbSet('img:' + rec.id, reconImageData);
  state.reconciliations.push(rec);
  await save();
  // reset form (keep account + date)
  $('#reconBank').value = '';
  $('#reconNote').value = '';
  $('#reconImage').value = '';
  $('#reconPreview').classList.add('hidden');
  $('#reconOcr').classList.add('hidden');
  ocrRun++;
  reconImageData = null;
  render();
  toast(rec.bank === rec.app ? 'Saved — balances match ✅' : 'Saved — there is a difference');
  reconSheet(rec.id);
});

async function reconSheet(id) {
  const r = state.reconciliations.find((x) => x.id === id);
  if (!r) return;
  const diff = r.bank - r.app;
  const card = isCard(r.accountId);
  const shown = (v) => money(card ? -v : v); // cards: show the amount owed
  const img = r.hasImage ? await dbGet('img:' + r.id) : null;
  openSheet('Reconciliation', `
    <div class="form">
      <div class="muted small">${esc(accountName(r.accountId))} · ${niceDate(r.date)}</div>
      <div class="compare">
        <div><span class="muted small">Bank said${card ? ' (owed)' : ''}</span><strong>${shown(r.bank)}</strong></div>
        <div><span class="muted small">App said${card ? ' (owed)' : ''}</span><strong>${shown(r.app)}</strong></div>
      </div>
      <div class="compare" style="grid-template-columns:1fr">
        <div><span class="muted small">Difference (bank − app)</span>
        <strong class="${diff === 0 ? 'pos' : 'neg'}">${diff === 0 ? '✅ Matches' : money(diff, true)}</strong></div>
      </div>
      ${diff !== 0 ? `<p class="muted small">${card
        ? (diff < 0 ? 'You owe more on the card than the app shows. Maybe you forgot to log a purchase on it.'
          : 'You owe less on the card than the app shows. Maybe a refund or payment is missing, or a purchase was logged twice.')
        : diff > 0
          ? 'Your bank has more than the app. Maybe you forgot to log some income, or logged an expense twice.'
          : 'Your bank has less than the app. Maybe you forgot to log an expense.'}</p>` : ''}
      ${r.note ? `<p><strong>Note:</strong> ${esc(r.note)}</p>` : ''}
      ${img ? `<img class="full-img" src="${img}" alt="Bank screenshot">` : ''}
      ${diff !== 0 && !r.adjusted && state.accounts.some((a) => a.id === r.accountId)
        ? `<div class="card-inset form">
            <strong>Fix it with an adjustment</strong>
            <p class="muted small" style="margin:0">Adds ${diff > 0 ? 'income' : 'an expense'} of ${money(Math.abs(diff))} so the app matches your bank. Pick what it was most likely for.</p>
            ${catPickerHtml('adj', 'Category for the adjustment')}
            <button class="btn full" id="recFix">Add ${money(diff, true)} adjustment</button>
          </div>` : ''}
      ${r.adjusted ? (() => {
        const at = state.transactions.find((x) => x.id === r.adjustTxId);
        return at ? `<button class="btn secondary full" id="recAdjTx">Adjustment: ${esc(at.category)} ${money(at.type === 'income' ? at.amount : -at.amount, true)} — change category</button>` : '';
      })() : ''}
      <button class="btn danger full" id="recDel">Delete this record</button>
    </div>`);
  const fix = $('#recFix');
  const adjType = diff > 0 ? 'income' : 'expense';
  if (fix) {
    setupCatPicker('adj', adjType, 'Adjustment (unknown)', ['Adjustment (unknown)']);
    fix.addEventListener('click', async () => {
    const category = readCatPicker('adj', adjType);
    if (!category) return toast('Type a name for the new category');
    const tx = {
      id: uid(), accountId: r.accountId, date: r.date,
      type: adjType, amount: Math.abs(diff),
      category, note: 'Reconciliation adjustment'
    };
    state.transactions.push(tx);
    r.adjusted = true;
    r.adjustTxId = tx.id;
    await save();
    closeSheet(); render();
    toast('Adjustment added — balances now match');
  });
  }
  const adjBtn = $('#recAdjTx');
  if (adjBtn) adjBtn.addEventListener('click', () => txSheet(r.adjustTxId));
  $('#recDel').addEventListener('click', async () => {
    if (!confirm('Delete this reconciliation record?')) return;
    state.reconciliations = state.reconciliations.filter((x) => x.id !== r.id);
    await save();
    await dbDel('img:' + r.id);
    closeSheet(); render();
  });
}

/* ---------- Backup: export / import ---------- */
$('#exportBtn').addEventListener('click', async () => {
  const images = {};
  for (const r of state.reconciliations) {
    if (r.hasImage) { const d = await dbGet('img:' + r.id); if (d) images[r.id] = d; }
  }
  const backup = { app: 'money-tracker', version: 2, exportedAt: new Date().toISOString(), state, images };
  const name = `money-backup-${today()}.json`;
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
  const file = new File([blob], name, { type: 'application/json' });

  // On phones, the share sheet lets you save to Files / Drive or send by email.
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Money Tracker backup' });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast('Backup downloaded');
});

$('#importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'money-tracker' || !data.state || !Array.isArray(data.state.accounts)) throw new Error('bad file');
    const s = data.state;
    const summary = `${s.accounts.length} account(s), ${(s.transactions || []).length} transaction(s)`;
    if (!confirm(`Import backup from ${data.exportedAt ? new Date(data.exportedAt).toLocaleString() : 'unknown date'}?\n\n${summary}\n\nThis REPLACES all data currently in the app.`)) return;
    await dbClear();
    state = Object.assign(emptyState(), s);
    migrate();
    await save();
    for (const [id, img] of Object.entries(data.images || {})) await dbSet('img:' + id, img);
    txFilter = 'all'; txCatFilter = 'all';
    render();
    toast('Backup imported');
  } catch (err) {
    console.error(err);
    toast('That file is not a valid Money Tracker backup');
  }
});

const paydayOptions = (withNone) => (withNone ? `<option value="0">Not set — use calendar months</option>` : '') +
  Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}">${ordinal(i + 1)} of the month</option>`).join('') +
  `<option value="last">Last day of the month</option>`;
const readPayday = (v) => (v === 'last' ? 'last' : +v);

function renderPaySettings() {
  const sel = $('#paydayInput');
  if (!sel.options.length) sel.innerHTML = paydayOptions(true);
  const rules = paydayRules();
  const cur = currentPayRule();
  sel.value = cur ? String(cur.payday) : '0';
  $('#payWeekendInput').checked = !!(cur && cur.payWeekend);
  $('#payWeekendWrap').classList.toggle('hidden', !cur);
  $('#payChangeBtn').classList.toggle('hidden', !cur);
  $('#payHistory').innerHTML = rules.length > 1 ? `<div class="card-inset">
      <strong class="small">Payday history</strong>
      ${rules.map((r, i) => {
        const until = rules[i + 1] ? addDaysISO(rules[i + 1].from, -1) : null;
        const when = !r.from ? (until ? `Until ${shortDate(until)} ${parseISO(until).y}` : '')
          : until ? `${shortDate(r.from)} ${parseISO(r.from).y} – ${shortDate(until)} ${parseISO(until).y}` : `From ${shortDate(r.from)} ${parseISO(r.from).y}`;
        return `<div class="pay-row"><div><div class="muted small">${when}</div>
          <div>${payRuleText(r).replace(/^on the /, '')}</div></div>
          ${i === rules.length - 1 ? `<button type="button" class="icon-btn" id="payUndo" aria-label="Remove this payday change">🗑️</button>` : ''}</div>`;
      }).join('')}
    </div>` : '';
  const undo = $('#payUndo');
  if (undo) undo.addEventListener('click', async () => {
    if (!confirm('Remove the latest payday change? The payday before it will apply from then on.')) return;
    state.settings.paydays.pop();
    await save(); render(); toast('Payday change removed');
  });
}
// Changing the select edits the current payday (it doesn't start a new one — use "I changed jobs" for that).
$('#paydayInput').addEventListener('change', async (e) => {
  const v = readPayday(e.target.value);
  const rules = state.settings.paydays;
  if (!v) {
    if (rules.length > 1 && !confirm('Stop using pay cycles? This also clears your payday history.')) { renderPaySettings(); return; }
    state.settings.paydays = [];
  } else if (!rules.length) rules.push({ from: '', payday: v, payWeekend: false });
  else rules[rules.length - 1].payday = v;
  await save(); render();
  toast(v ? 'Payday saved — charts now use pay cycles' : 'Using calendar months');
});
$('#payWeekendInput').addEventListener('change', async (e) => {
  const cur = currentPayRule();
  if (!cur) return;
  cur.payWeekend = e.target.checked;
  await save(); render();
});
$('#payChangeBtn').addEventListener('click', () => payChangeSheet());

// A new payday that starts on a date (e.g. after changing jobs). Earlier cycles keep the old payday.
function payChangeSheet() {
  const cur = currentPayRule();
  openSheet('New payday', `
    <form class="form" id="payChangeForm">
      <p class="muted small" style="margin:0">Your payday is currently ${payRuleText(cur)}. Pay cycles before the new first payday keep the old payday, so your history stays as it was.</p>
      <label>First payday on the new schedule
        <input type="date" id="pcFrom" required>
      </label>
      <label>New payday
        <select id="pcDay">${paydayOptions(false)}</select>
      </label>
      <label class="check"><input type="checkbox" id="pcWeekend"> If payday falls on a weekend, I'm paid on the Friday before</label>
      <p class="muted small" style="margin:0">The cycle around the change will be shorter or longer than usual. If your salary is set up under Plan → Recurring, end the old one and add the new one there too.</p>
      <button class="btn full" type="submit">Save new payday</button>
    </form>`);
  $('#pcDay').value = String(cur.payday);
  $('#pcWeekend').checked = !!cur.payWeekend;
  $('#payChangeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const from = $('#pcFrom').value;
    const rules = state.settings.paydays;
    const prevFrom = rules[rules.length - 1].from;
    if (!from) return toast('Pick the first payday on the new schedule');
    if (prevFrom && from <= prevFrom) return toast(`It must be after your last payday change (${shortDate(prevFrom)})`);
    rules.push({ from, payday: readPayday($('#pcDay').value), payWeekend: $('#pcWeekend').checked });
    await save(); closeSheet(); render();
    toast('New payday saved');
  });
}

$('#currencyInput').addEventListener('change', async (e) => {
  state.settings.currency = e.target.value.trim();
  await save();
  render();
  toast('Currency saved');
});

$('#wipeBtn').addEventListener('click', async () => {
  if (!confirm('Delete ALL accounts, transactions and screenshots from this phone?')) return;
  if (!confirm('Are you really sure? Export a backup first if you might need it.')) return;
  await dbClear();
  state = emptyState();
  migrate();
  await save();
  render();
  toast('All data deleted');
});

/* ---------- Filling a transaction from a screenshot (receipt, payment confirmation, ride…) ----------
   Reads the screenshot on the phone (same bundled reader as Reconcile), then suggests the amount paid and a note
   for what it was, plus a category for well-known merchants. Everything stays editable. */

// Well-known merchants: [pattern, note, category]
const MERCHANTS = [
  [/\b(any)?tada\b/i, 'TADA ride', 'Transport'], [/\bgrab\s*(car|taxi|ride|share)|\bjustgrab\b|\bgrabcar\b/i, 'Grab ride', 'Transport'],
  [/\bgrab\s*food\b|\bgrabfood\b/i, 'GrabFood', 'Food'], [/\bgrabmart\b/i, 'GrabMart', 'Groceries'], [/\bgojek\b/i, 'Gojek ride', 'Transport'],
  [/\bcomfort\s*delgro\b|\bcdg\s*zig\b|\bzig\b/i, 'Taxi (ComfortDelGro)', 'Transport'], [/\bryde\b/i, 'Ryde ride', 'Transport'],
  [/\bsimplygo\b|\btransitlink\b|\bmrt\b/i, 'Public transport', 'Transport'], [/\bfoodpanda\b/i, 'foodpanda', 'Food'], [/\bdeliveroo\b/i, 'Deliveroo', 'Food'],
  [/\bshopee\b/i, 'Shopee', 'Shopping'], [/\blazada\b/i, 'Lazada', 'Shopping'], [/\bamazon\b/i, 'Amazon', 'Shopping'], [/\btaobao\b/i, 'Taobao', 'Shopping'],
  [/\bfair\s*price\b|\bntuc\b/i, 'NTUC FairPrice', 'Groceries'], [/\bcold\s*storage\b/i, 'Cold Storage', 'Groceries'], [/\bsheng\s*siong\b/i, 'Sheng Siong', 'Groceries'],
  [/\bgiant\b/i, 'Giant', 'Groceries'], [/\bdon\s*don\s*donki\b|\bdonki\b/i, 'Don Don Donki', 'Groceries'],
  [/\bstarbucks\b/i, 'Starbucks', 'Food'], [/\bmcdonald'?s\b/i, "McDonald's", 'Food'], [/\bkfc\b/i, 'KFC', 'Food'], [/\bchagee\b/i, 'Chagee', 'Food'],
  [/\bkoi\b/i, 'KOI', 'Food'], [/\bliho\b/i, 'LiHO', 'Food'], [/\bya\s*kun\b/i, 'Ya Kun', 'Food'], [/\btoast\s*box\b/i, 'Toast Box', 'Food'],
  [/\bguardian\b/i, 'Guardian', 'Health'], [/\bwatsons\b/i, 'Watsons', 'Health'], [/\buniqlo\b/i, 'Uniqlo', 'Shopping'], [/\bikea\b/i, 'IKEA', 'Shopping'],
  [/\bnetflix\b/i, 'Netflix', 'Subscriptions'], [/\bspotify\b/i, 'Spotify', 'Subscriptions'], [/\bdisney\+?/i, 'Disney+', 'Subscriptions'],
  [/\bklook\b/i, 'Klook', 'Entertainment'], [/\bagoda\b/i, 'Agoda', 'Transport'], [/\bbooking\.com\b/i, 'Booking.com', 'Transport'],
  [/\bsingapore\s*airlines\b|\bscoot\b|\bjetstar\b|\bairasia\b/i, 'Flight', 'Transport'],
  [/\bsp\s*(group|services)\b/i, 'SP utilities', 'Bills'], [/\bsingtel\b|\bstarhub\b|\bm1\b|\bcircles\.?life\b|\bgomo\b/i, 'Mobile / internet bill', 'Bills']
];

// Amounts on a receipt or payment screen, best guess first: [{cents, label}].
// Prefers amounts labelled total / paid / fare, with a currency, in large text; skips promos (cashback, up to, vouchers…).
function findSpendCandidates(lines) {
  const re = /(S\$|SGD|US\$|RM|\$)?\s*(\d{1,3}(?:[,\s]\d{3})+|\d+)[.,](\d{2})(?![\d%])\s*(SGD|S\$)?/g;
  const heights = lines.map((l) => l.h).filter(Boolean).sort((a, b) => a - b);
  const medianH = heights.length ? heights[Math.floor(heights.length / 2)] : 0;
  const found = new Map();
  lines.forEach((l, i) => {
    for (const m of l.text.matchAll(re)) {
      const cents = parseInt(m[2].replace(/[,\s]/g, ''), 10) * 100 + parseInt(m[3], 10);
      if (!(cents > 0) || cents > 10000000) continue;
      // Labels count from the same line, or the line above if that line has no amount of its own.
      const prevText = (lines[i - 1] || {}).text || '';
      const same = l.text.toLowerCase();
      const ctx = `${/\d[.,]\d{2}/.test(prevText) ? '' : prevText.toLowerCase()} ${same}`;
      let score = (m[1] || m[4]) ? 3 : 0;
      if (/\b(grand\s*)?total\b|\bamount\b|you\s*paid|\bpaid\b|\bpayment\b|charged|\bfare\b|to\s*pay|\bprice\b/.test(ctx)) score += 4;
      if (/sub-?\s*total/.test(same)) score -= 5;
      if (/cashback|up\s*to|discount|voucher|promo|\bsave\b|points|rebate|reward|balance|limit|min(imum)?\b|\bgst\b|\btax\b|change|\btip\b/.test(same)) score -= 6;
      if (medianH && l.h >= medianH * 1.3) score += 2;
      const label = l.text.replace(m[0], '').replace(/[^\w\s&()'.-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
      const prev = found.get(cents);
      if (!prev || score > prev.score) found.set(cents, { cents, score, label, order: i });
    }
  });
  return [...found.values()].sort((a, b) => b.score - a.score || a.order - b.order);
}

// Possible notes: a known merchant first, then short lines of text from the screenshot (names, places).
function noteCandidates(text, lines) {
  const out = [];
  let merchant = null;
  for (const [re, note, cat] of MERCHANTS) if (re.test(text)) { merchant = { note, cat }; out.push(note); break; }
  const paidTo = text.match(/(?:paid|pay|sent|transfer(?:red)?)\s+(?:S?\$?[\d,.]+\s+)?to\s+([A-Za-z][A-Za-z0-9&'., -]{2,38})/i);
  if (paidTo) out.push(paidTo[1].trim());
  const skip = /successful|you\s*paid|transfer|\bref\b|reference|cashback|shopback|google\s*pay|apple\s*pay|paylah|call|chat|share|known\s*for|service|driving|vehicle|on\s*your\s*way|missing\s*out|account|payment\s*method|receipt|thank|download|rate|tip/i;
  for (const l of lines) {
    const s = l.text.replace(/[^\w\s&()'.,/-]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^to\s+/i, '');
    if (s.length < 4 || s.length > 40 || /\d[.,]\d{2}/.test(s) || skip.test(s)) continue;
    if ((s.match(/[a-z]/gi) || []).length < s.length * 0.6) continue; // mostly letters
    if (!out.includes(s)) out.push(s);
    if (out.length >= 5) break;
  }
  return { notes: out, merchant };
}

let txOcrRun = 0;
async function fillTxFromScreenshot(file, opts) {
  const run = ++txOcrRun;
  const box = $('#txOcr');
  const show = (html) => { if (run === txOcrRun && box) { box.innerHTML = html; box.classList.remove('hidden'); } };
  show('🔎 Reading your screenshot…');
  let data;
  try {
    const worker = await getOcrWorker((p) => show(`🔎 Reading your screenshot… ${Math.round(p * 100)}%`));
    ({ data } = await worker.recognize(file));
  } catch (err) {
    console.warn(err);
    show('Couldn\'t read the screenshot on this phone — type the details below.');
    return;
  }
  if (run !== txOcrRun || !$('#txForm')) return;
  const lines = (data.lines && data.lines.length ? data.lines.map((l) => ({ text: l.text.trim(), h: l.bbox ? l.bbox.y1 - l.bbox.y0 : 0 }))
    : data.text.split(/\n+/).map((t) => ({ text: t.trim(), h: 0 }))).filter((l) => l.text);
  const amounts = findSpendCandidates(lines);
  const { notes, merchant } = noteCandidates(data.text, lines);
  if (!amounts.length && !notes.length) { show('Couldn\'t find an amount in the screenshot — type the details below.'); return; }
  const setAmount = (c) => {
    $('#txAmount').value = (c / 100).toFixed(2);
    box.querySelectorAll('[data-amt]').forEach((x) => x.classList.toggle('on', +x.dataset.amt === c));
  };
  const setNote = (n) => {
    $('#txNote').value = n;
    box.querySelectorAll('[data-note]').forEach((x) => x.classList.toggle('on', x.dataset.note === n));
  };
  let catMsg = '';
  if (merchant && !opts.catTouched() && opts.catType() === 'expense' && categoriesFor('expense').includes(merchant.cat)) {
    $('#txCat').value = merchant.cat;
    $('#txCat').dispatchEvent(new Event('change'));
    catMsg = ` Category set to <strong>${esc(merchant.cat)}</strong>.`;
  }
  show(`<div>✅ Filled in${amounts.length ? ` <strong>${money(amounts[0].cents)}</strong>` : ''}${notes.length ? ` and the note “${esc(notes[0])}”` : ''}.${catMsg} Check it matches — you can change anything.</div>
    ${amounts.length > 1 ? `<div class="muted small" style="margin-top:6px">Other amounts in the screenshot:</div>
      <div class="chips">${amounts.slice(0, 5).map((c) => `<button type="button" class="chip" data-amt="${c.cents}">${money(c.cents)}${c.label ? `<span>${esc(c.label)}</span>` : ''}</button>`).join('')}</div>` : ''}
    ${notes.length > 1 ? `<div class="muted small" style="margin-top:6px">Other notes:</div>
      <div class="chips">${notes.map((n) => `<button type="button" class="chip" data-note="${esc(n)}">${esc(n)}</button>`).join('')}</div>` : ''}`);
  box.querySelectorAll('[data-amt]').forEach((x) => x.addEventListener('click', () => setAmount(+x.dataset.amt)));
  box.querySelectorAll('[data-note]').forEach((x) => x.addEventListener('click', () => setNote(x.dataset.note)));
  if (amounts.length) setAmount(amounts[0].cents);
  if (notes.length) setNote(notes[0]);
}

/* ---------- Manage categories ---------- */
$('#manageCatsBtn').addEventListener('click', () => categoriesSheet('expense'));

function categoriesSheet(type) {
  const isOfType = (t) => (type === 'expense' ? t.type === 'expense' || t.refund : t.type === 'income' && !t.refund);
  const count = (c) => state.transactions.filter((t) => isOfType(t) && t.category === c).length;
  openSheet('Categories', `
    <div class="form">
      <div class="segmented">
        <button type="button" data-ct="expense" class="expense ${type === 'expense' ? 'on' : ''}">Spending</button>
        <button type="button" data-ct="income" class="income ${type === 'income' ? 'on' : ''}">Income</button>
      </div>
      <form class="row gap" id="catAddForm" style="margin:0">
        <input id="catAddName" maxlength="30" placeholder="New category name">
        <button class="btn" type="submit">Add</button>
      </form>
      <div class="list" style="margin:0">
        ${state.categories[type].map((c, i) => `<div class="item static">
          <div class="left"><div class="title">${esc(c)}</div><div class="sub">${count(c)} transaction(s)</div></div>
          <div class="row" style="gap:4px">
            <button class="icon-btn" data-ren="${i}" aria-label="Rename ${esc(c)}">✏️</button>
            <button class="icon-btn" data-del="${i}" aria-label="Remove ${esc(c)}">🗑️</button>
          </div></div>`).join('')}
      </div>
      <p class="muted small">Removing a category only takes it off the list — past transactions keep it. Renaming also renames past transactions and recurring payments.</p>
    </div>`);
  document.querySelectorAll('[data-ct]').forEach((b) => b.addEventListener('click', () => categoriesSheet(b.dataset.ct)));
  $('#catAddForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#catAddName').value.trim();
    if (!name) return;
    if (state.categories[type].includes(name)) return toast('That category already exists');
    addCategory(type, name);
    await save(); render(); categoriesSheet(type);
  });
  document.querySelectorAll('[data-ren]').forEach((b) => b.addEventListener('click', async () => {
    const old = state.categories[type][+b.dataset.ren];
    const name = (prompt(`Rename “${old}” to:`, old) || '').trim();
    if (!name || name === old) return;
    if (state.categories[type].includes(name)) return toast('That category already exists');
    state.categories[type][+b.dataset.ren] = name;
    for (const t of state.transactions) if (isOfType(t) && t.category === old) t.category = name;
    for (const r of state.recurring) if (r.type === type && r.category === old) r.category = name;
    await save(); render(); categoriesSheet(type);
  }));
  document.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    const c = state.categories[type][+b.dataset.del];
    if (state.categories[type].length <= 1) return toast('Keep at least one category');
    if (!confirm(`Remove “${c}” from the list?`)) return;
    state.categories[type].splice(+b.dataset.del, 1);
    await save(); render(); categoriesSheet(type);
  }));
}

async function showStorageInfo() {
  const el = $('#storageInfo');
  if (!navigator.storage || !navigator.storage.estimate) return;
  try {
    const { usage } = await navigator.storage.estimate();
    const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
    el.textContent = `Using about ${(usage / 1024 / 1024).toFixed(1)} MB on this phone.` +
      (persisted ? ' Storage is protected from automatic clean-up.' : '');
  } catch { /* ignore */ }
}

/* ---------- Start ---------- */
// Start once every script (app.js and plan.js) has loaded — render() uses functions from both.
async function init() {
  try {
    await load();
  } catch (err) {
    console.error(err);
    toast('Could not open storage on this browser');
  }
  render();
  showStorageInfo();
  // Ask the browser not to auto-delete our data.
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('../sw.js').catch(() => {});
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
