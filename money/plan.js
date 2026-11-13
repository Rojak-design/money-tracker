/* Money Tracker — Plan tab: recurring payments, savings projects and the 12-month forecast.
   Uses the helpers and `state` from app.js. */
'use strict';

/*
  state.recurring: {id, name, type: 'expense'|'income', amount, category, accountId, freq,
                    start: 'YYYY-MM-DD', endMode: 'never'|'count'|'date', count, end, note}
  state.projects:  {id, name, items: [{name, amount}], savedMode: 'manual'|'account', saved, accountId,
                    monthly, targetDate, createdAt}
*/

/* ---------- Date helpers ---------- */
const FREQS = {
  weekly: { label: 'Every week', short: 'week' },
  fortnightly: { label: 'Every 2 weeks', short: '2 weeks' },
  monthly: { label: 'Every month', short: 'month' },
  quarterly: { label: 'Every 3 months', short: '3 months' },
  yearly: { label: 'Every year', short: 'year' }
};
const pad2 = (n) => String(n).padStart(2, '0');
const isoOf = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`; // m is 1-12
const daysInMonth = (y, m) => new Date(y, m, 0).getDate();
function parseISO(iso) { const [y, m, d] = iso.split('-').map(Number); return { y, m, d }; }
function addMonthsISO(iso, n) {
  const { y, m, d } = parseISO(iso);
  const total = m - 1 + n;
  const ny = y + Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12 + 1;
  return isoOf(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}
function addDaysISO(iso, n) {
  const { y, m, d } = parseISO(iso);
  const dt = new Date(y, m - 1, d + n);
  return isoOf(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}
const monthKey = (iso) => iso.slice(0, 7);
function addMonthsKey(key, n) { return addMonthsISO(key + '-01', n).slice(0, 7); }
function monthLabel(key, long = false) {
  const { y, m } = parseISO(key + '-01');
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, long ? { month: 'long', year: 'numeric' } : { month: 'short', year: 'numeric' });
}
function monthsBetween(fromKey, toKey) {
  const a = parseISO(fromKey + '-01'); const b = parseISO(toKey + '-01');
  return (b.y - a.y) * 12 + (b.m - a.m);
}

/* ---------- Recurring payments ---------- */
// The date of the i-th payment (0 = first).
function nthDate(r, i) {
  switch (r.freq) {
    case 'weekly': return addDaysISO(r.start, 7 * i);
    case 'fortnightly': return addDaysISO(r.start, 14 * i);
    case 'quarterly': return addMonthsISO(r.start, 3 * i);
    case 'yearly': return addMonthsISO(r.start, 12 * i);
    default: return addMonthsISO(r.start, i);
  }
}
/* Loans: a recurring payment with endMode 'loan' runs until a balance is paid off.
   loanBalance (cents) is what was left to pay on loanAsOf, before the payment on r.start.
   loanInterest: 'included' (the balance already includes interest, or there is none — e.g. car loans,
   instalment plans) or 'reducing' (interest of loanRate % a year is charged on what's left — e.g. mortgages). */
const PER_YEAR = { weekly: 52, fortnightly: 26, monthly: 12, quarterly: 4, yearly: 1 };
const loanCache = new Map();
function loanSchedule(r) {
  const key = [r.loanBalance, r.loanInterest, r.loanRate, r.amount, r.freq].join('|');
  if (loanCache.has(key)) return loanCache.get(key);
  const rate = r.loanInterest === 'reducing' ? (r.loanRate || 0) / 100 / (PER_YEAR[r.freq] || 12) : 0;
  let bal = r.loanBalance || 0, interest = 0, last = r.amount, ok = true;
  const after = []; // balance left after each payment
  while (bal > 0 && after.length < 1200) {
    const int = bal * rate;
    if (int >= r.amount) { ok = false; break; } // payment doesn't even cover the interest
    interest += int; bal += int;
    last = Math.min(r.amount, Math.round(bal));
    bal = Math.max(0, bal - last);
    after.push(Math.round(bal));
  }
  if (bal > 0) ok = false;
  const res = { ok, count: after.length, last, interest: Math.round(interest), after };
  loanCache.set(key, res);
  return res;
}
// Number of payments in total, or null if it has no fixed number.
function paymentCount(r) {
  if (r.endMode === 'count') return r.count;
  if (r.endMode === 'loan') return loanSchedule(r).count;
  return null;
}
// Amount of the i-th payment (a loan's last payment can be smaller).
function nthAmount(r, i) {
  if (r.endMode === 'loan') { const s = loanSchedule(r); if (i === s.count - 1) return s.last; }
  return r.amount;
}
// Payments between from and to (inclusive, ISO strings) as {d: date, i: index}.
function occurrencesIdx(r, from, to) {
  const out = [];
  const cnt = paymentCount(r);
  for (let i = 0; i < 5000; i++) {
    if (cnt != null && i >= cnt) break;
    const d = nthDate(r, i);
    if (d > to) break;
    if (r.endMode === 'date' && r.end && d > r.end) break;
    if (d >= from) out.push({ d, i });
  }
  return out;
}
const occurrences = (r, from, to) => occurrencesIdx(r, from, to).map((o) => o.d);
const amountBetween = (r, from, to) => occurrencesIdx(r, from, to).reduce((s, o) => s + nthAmount(r, o.i), 0);
function lastPaymentDate(r) {
  const cnt = paymentCount(r);
  if (cnt != null) return cnt ? nthDate(r, cnt - 1) : null;
  if (r.endMode === 'date' && r.end) {
    const all = occurrences(r, r.start, r.end);
    return all[all.length - 1] || null;
  }
  return null;
}
function recurringSummary(r) {
  const t = today();
  const made = occurrences(r, r.start, t).length;
  const last = lastPaymentDate(r);
  const cnt = paymentCount(r);
  const total = cnt != null ? cnt : (last ? occurrences(r, r.start, last).length : null);
  const left = total == null ? null : Math.max(0, total - made);
  const next = occurrences(r, addDaysISO(t, 1), last || addMonthsISO(t, 13))[0] || null;
  let remainingAmt = null;
  if (left != null) { remainingAmt = 0; for (let i = made; i < total; i++) remainingAmt += nthAmount(r, i); }
  const res = { made, total, left, last, next, remainingAmt, finished: left === 0 };
  if (r.endMode === 'loan') {
    const sch = loanSchedule(r);
    res.outstanding = made ? (sch.after[made - 1] || 0) : r.loanBalance; // still owed on the loan today
    res.interestLeft = Math.max(0, remainingAmt - res.outstanding);
  }
  return res;
}
const activeLoans = () => state.recurring.filter((r) => r.endMode === 'loan' && !recurringSummary(r).finished);

let planTab = 'forecast';
document.querySelectorAll('#planTabs button').forEach((b) => b.addEventListener('click', () => {
  planTab = b.dataset.plan;
  renderPlan();
  updateFab();
}));

function renderPlan() {
  document.querySelectorAll('#planTabs button').forEach((b) => b.classList.toggle('on', b.dataset.plan === planTab));
  ['forecast', 'recurring', 'projects', 'trips'].forEach((k) => $('#plan-' + k).classList.toggle('hidden', k !== planTab));
  if (currentView !== 'plan') return;
  if (planTab === 'forecast') renderForecast();
  else if (planTab === 'recurring') renderRecurring();
  else if (planTab === 'trips') renderTrips();
  else renderProjects();
}

function planFab() {
  if (planTab === 'projects') projectSheet();
  else if (planTab === 'trips') tripSheet();
  else recurringSheet();
}

function renderRecurring() {
  const el = $('#plan-recurring');
  if (!state.recurring.length) {
    el.innerHTML = `<div class="empty">No recurring payments yet.<br>Tap + to add instalments, loan repayments, subscriptions, rent, salary…</div>`;
    return;
  }
  const t = today();
  const soon = [];
  for (const r of state.recurring) {
    for (const o of occurrencesIdx(r, t, addDaysISO(t, 30))) soon.push({ r, d: o.d, amt: nthAmount(r, o.i) });
  }
  soon.sort((a, b) => a.d.localeCompare(b.d));

  const active = state.recurring.filter((r) => !recurringSummary(r).finished);
  const done = state.recurring.filter((r) => recurringSummary(r).finished);
  const perMonth = (type) => active.filter((r) => r.type === type).reduce((s, r) => s + monthlyEquivalent(r), 0);
  // How a recurring amount is shown: + for income, − for spending, ⇄ for a transfer between your accounts.
  const shownAmt = (r, amt) => (r.type === 'transfer' ? `⇄ ${money(amt)}` : money(r.type === 'income' ? amt : -amt, true));

  let html = `<div class="tiles">
    <div class="tile"><div class="label">Recurring spending</div><div class="value">${money(perMonth('expense'))}</div><div class="label">per month (approx.)</div></div>
    <div class="tile"><div class="label">Recurring income</div><div class="value">${money(perMonth('income'))}</div><div class="label">per month (approx.)</div></div>
  </div>`;
  const xfers = active.filter((r) => r.type === 'transfer');
  if (xfers.length) html += `<p class="muted small" style="margin:-4px 0 12px">⇄ Plus ${money(perMonth('transfer'))} a month moved between your own accounts (not counted as spending).</p>`;
  if (soon.length) {
    html += `<h2 class="section-title">Due in the next 30 days</h2><div class="card">` +
      soon.map(({ r, d, amt }) => `<div class="kv"><span class="k">${niceDate(d)} · ${esc(r.name)}</span>
        <span class="v ${r.type === 'income' ? 'pos' : ''}">${shownAmt(r, amt)}</span></div>`).join('') +
      `</div>`;
  }
  const item = (r) => {
    const s = recurringSummary(r);
    const bits = [];
    if (s.finished) bits.push(`finished ${niceDate(s.last)}`);
    else if (r.endMode === 'loan') bits.push(`${money(s.outstanding)} left · paid off ${monthLabel(monthKey(s.last))}`);
    else if (s.left != null) bits.push(`${s.left} of ${s.total} left · ends ${monthLabel(monthKey(s.last))}`);
    else bits.push(`${FREQS[r.freq].label.toLowerCase()} · ongoing`);
    return `<button class="item" data-recur="${r.id}">
      <div class="left"><div class="title">${esc(r.name)}</div><div class="sub">${bits.join(' · ')} · ${r.type === 'transfer'
        ? `${esc(accountName(r.accountId))} → ${esc(accountName(r.toAccountId))}` : esc(r.category)}</div></div>
      <div class="amt ${r.type === 'income' ? 'pos' : ''}">${shownAmt(r, r.amount)}</div></button>`;
  };
  html += `<h2 class="section-title">Active</h2><div class="list">${active.map(item).join('') || '<div class="empty">Nothing active.</div>'}</div>`;
  if (done.length) html += `<h2 class="section-title">Finished</h2><div class="list">${done.map(item).join('')}</div>`;
  el.innerHTML = html;
  el.querySelectorAll('[data-recur]').forEach((b) => b.addEventListener('click', () => recurringSheet(b.dataset.recur)));
}

function monthlyEquivalent(r) {
  const perYear = { weekly: 52, fortnightly: 26, monthly: 12, quarterly: 4, yearly: 1 }[r.freq] || 12;
  return Math.round(r.amount * perYear / 12);
}

function recurringSheet(id) {
  const r = state.recurring.find((x) => x.id === id);
  let type = r ? r.type : 'expense';
  let endMode = r ? r.endMode : 'count';
  // For a loan, the form shows today's figures: what's still owed and the next unpaid payment.
  const loanNow = r && r.endMode === 'loan' ? recurringSummary(r) : null;
  openSheet(r ? 'Recurring payment' : 'New recurring payment', `
    <form class="form" id="recurForm">
      <div class="segmented tx-types">
        <button type="button" data-type="expense" class="expense">Spending</button>
        <button type="button" data-type="income" class="income">Income</button>
        <button type="button" data-type="transfer" class="refund">Transfer</button>
      </div>
      <label>Name
        <input id="rcName" required maxlength="40" placeholder="e.g. Car loan, iPhone instalment, Netflix" value="${esc(r ? r.name : '')}">
      </label>
      <label>Amount each time
        <input id="rcAmount" type="number" inputmode="decimal" step="0.01" min="0.01" required placeholder="0.00" value="${r ? (r.amount / 100).toFixed(2) : ''}">
      </label>
      <label>How often
        <select id="rcFreq">${Object.entries(FREQS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select>
      </label>
      <label><span id="rcStartLabel">First payment date</span>
        <input id="rcStart" type="date" required value="${r ? r.start : today()}">
      </label>
      <label>When does it end?
        <select id="rcEndMode">
          <option value="loan">When a loan is paid off</option>
          <option value="count">After a number of payments</option>
          <option value="date">On a date</option>
          <option value="never">Never (subscriptions, rent, salary)</option>
        </select>
      </label>
      <label id="rcCountWrap">Total number of payments
        <input id="rcCount" type="number" inputmode="numeric" min="1" step="1" placeholder="e.g. 24" value="${r && r.count ? r.count : ''}">
      </label>
      <label id="rcEndWrap">Last payment on or before
        <input id="rcEnd" type="date" value="${r && r.end ? r.end : ''}">
      </label>
      <div id="rcLoanWrap" class="form">
        <label>Still owed on the loan today
          <input id="rcLoanBal" type="number" inputmode="decimal" step="0.01" min="0.01" placeholder="from your loan statement or bank app"
            value="${loanNow ? (loanNow.outstanding / 100).toFixed(2) : ''}">
        </label>
        <label>Interest
          <select id="rcLoanInt">
            <option value="included">Included in what's owed / none</option>
            <option value="reducing">Charged on what's left</option>
          </select>
        </label>
        <p class="muted small" style="margin:-6px 0 0">Car loans and instalment plans usually quote what's owed with interest included. Mortgages and most personal loans charge interest on what's left.</p>
        <label id="rcLoanRateWrap">Interest rate (% a year)
          <input id="rcLoanRate" type="number" inputmode="decimal" step="0.01" min="0" placeholder="e.g. 3.5" value="${r && r.loanRate ? r.loanRate : ''}">
        </label>
      </div>
      <div id="rcCatWrap" class="form">${catPickerHtml('rc')}</div>
      <label><span id="rcAccLabel">Paid from / into account or card (optional)</span>
        <select id="rcAccount"><option value="">—</option>${accountOptions()}</select>
      </label>
      <label id="rcToWrap">To
        <select id="rcTo">${accountOptions()}</select>
      </label>
      <p id="rcXferHint" class="muted small" style="margin:-6px 0 0">Moving money between your own accounts, e.g. part of your salary into savings each payday. Not counted as spending or income.</p>
      <label>Note (optional)
        <input id="rcNote" maxlength="100" value="${esc(r ? r.note : '')}">
      </label>
      <div id="rcPreview" class="card-inset small"></div>
      <button class="btn full" type="submit">Save</button>
      ${r ? `<button type="button" class="btn secondary full" id="rcLog">${r.type === 'transfer' ? 'Log this transfer now' : 'Log a payment now'}</button>
        <button type="button" class="btn danger full" id="rcDel">Delete</button>` : ''}
    </form>`);
  $('#rcFreq').value = r ? r.freq : 'monthly';
  if (loanNow && loanNow.next) $('#rcStart').value = loanNow.next;
  $('#rcLoanInt').value = r && r.loanInterest ? r.loanInterest : 'included';
  $('#rcEndMode').value = endMode;
  $('#rcAccount').value = r && r.accountId ? r.accountId : '';
  if (r && r.toAccountId) $('#rcTo').value = r.toAccountId;

  function readForm() {
    return {
      type, name: $('#rcName').value.trim(), amount: toCents($('#rcAmount').value),
      freq: $('#rcFreq').value, start: $('#rcStart').value || today(),
      endMode, count: parseInt($('#rcCount').value, 10) || 0, end: $('#rcEnd').value || '',
      accountId: $('#rcAccount').value, note: $('#rcNote').value.trim(),
      toAccountId: type === 'transfer' ? $('#rcTo').value : undefined,
      loanBalance: toCents($('#rcLoanBal').value), loanAsOf: today(),
      loanInterest: $('#rcLoanInt').value, loanRate: parseFloat($('#rcLoanRate').value) || 0
    };
  }
  function preview() {
    $('#rcCountWrap').classList.toggle('hidden', endMode !== 'count');
    $('#rcEndWrap').classList.toggle('hidden', endMode !== 'date');
    $('#rcLoanWrap').classList.toggle('hidden', endMode !== 'loan');
    $('#rcLoanRateWrap').classList.toggle('hidden', $('#rcLoanInt').value !== 'reducing');
    $('#rcStartLabel').textContent = endMode === 'loan' ? 'Next payment date' : 'First payment date';
    const f = readForm();
    const box = $('#rcPreview');
    if (!(f.amount > 0)) { box.textContent = 'Fill in the amount to see a summary.'; return; }
    if (endMode === 'loan') {
      if (!(f.loanBalance > 0)) { box.textContent = 'Fill in what is still owed on the loan.'; return; }
      if (f.loanInterest === 'reducing' && !f.loanRate) { box.textContent = 'Fill in the interest rate.'; return; }
      const sch = loanSchedule(f);
      if (!sch.ok) { box.innerHTML = '<span class="status bad">⚠️ This payment never pays off the loan — it doesn\'t cover the interest. Check the amount and rate.</span>'; return; }
      const total = sch.after.length ? (sch.count - 1) * f.amount + sch.last : 0;
      box.innerHTML = [
        `Paid off by <strong>${niceDate(nthDate(f, sch.count - 1))}</strong> — <strong>${sch.count}</strong> more payment${sch.count > 1 ? 's' : ''}${sch.last !== f.amount ? ` (the last one ${money(sch.last)})` : ''}.`,
        `You'll pay <strong>${money(total)}</strong> in total${f.loanInterest === 'reducing' ? `, of which <strong>${money(sch.interest)}</strong> is interest` : ''}.`,
        `About <strong>${money(monthlyEquivalent(f))}</strong> a month until then.`
      ].join('<br>');
      return;
    }
    if (endMode === 'count' && !(f.count > 0)) { box.textContent = 'Fill in the number of payments.'; return; }
    if (endMode === 'date' && !f.end) { box.textContent = 'Pick the end date.'; return; }
    const s = recurringSummary(f);
    const lines = [`About <strong>${money(monthlyEquivalent(f))}</strong> a month.`];
    if (s.last) lines.push(`Last payment: <strong>${niceDate(s.last)}</strong> · ${s.total} payments, <strong>${money(s.total * f.amount)}</strong> in total.`);
    if (s.left != null && s.made) lines.push(`${s.made} paid so far, ${s.left} left (${money(s.remainingAmt)}).`);
    if (s.next) lines.push(`Next payment: ${niceDate(s.next)}.`);
    box.innerHTML = lines.join('<br>');
  }
  function setType(newType, keepCat) {
    type = newType;
    const xfer = type === 'transfer';
    document.querySelectorAll('#recurForm .segmented button').forEach((b) => b.classList.toggle('on', b.dataset.type === type));
    if (!xfer) setupCatPicker('rc', type, keepCat || (type === 'expense' ? 'Instalment' : 'Salary'));
    $('#rcCatWrap').classList.toggle('hidden', xfer);
    $('#rcToWrap').classList.toggle('hidden', !xfer);
    $('#rcXferHint').classList.toggle('hidden', !xfer);
    $('#rcAccLabel').textContent = xfer ? 'From' : 'Paid from / into account or card (optional)';
    $('#rcName').placeholder = xfer ? 'e.g. Salary to savings' : 'e.g. Car loan, iPhone instalment, Netflix';
    // A loan ending only makes sense for spending.
    $('#rcEndMode').querySelector('option[value="loan"]').hidden = xfer || type === 'income';
    if (xfer) {
      if (!$('#rcAccount').value) { const b = bankAccounts()[0]; if (b) $('#rcAccount').value = b.id; }
      if ($('#rcTo').value === $('#rcAccount').value) { const o = state.accounts.find((a) => a.id !== $('#rcAccount').value); if (o) $('#rcTo').value = o.id; }
      if (endMode === 'loan' || (endMode === 'count' && !$('#rcCount').value)) { endMode = 'never'; $('#rcEndMode').value = 'never'; }
    }
    preview();
  }
  document.querySelectorAll('#recurForm .segmented button').forEach((b) => b.addEventListener('click', () => setType(b.dataset.type)));
  setType(type, r && r.category);
  $('#rcEndMode').addEventListener('change', (e) => {
    endMode = e.target.value;
    if (endMode === 'loan' && type === 'expense' && $('#rcCat').value === 'Instalment') setupCatPicker('rc', type, 'Loan repayment');
    preview();
  });
  $('#rcLoanInt').addEventListener('change', preview);
  $('#recurForm').addEventListener('input', preview);
  preview();

  $('#recurForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = readForm();
    if (!f.name) return toast('Give it a name');
    if (!(f.amount > 0)) return toast('Enter an amount above 0');
    if (endMode === 'count' && !(f.count > 0)) return toast('Enter the number of payments');
    if (endMode === 'date' && !f.end) return toast('Pick the end date');
    if (endMode === 'date' && f.end < f.start) return toast('The end date is before the first payment');
    if (endMode === 'loan') {
      if (!(f.loanBalance > 0)) return toast('Enter what is still owed on the loan');
      if (f.loanInterest === 'reducing' && !f.loanRate) return toast('Enter the interest rate');
      if (f.start < today()) return toast('Pick the next payment that is still to come');
      if (!loanSchedule(f).ok) return toast("The payment doesn't cover the interest — check the amount and rate");
    }
    if (type === 'transfer') {
      if (state.accounts.length < 2) return toast('Add a second account to transfer between');
      if (!f.accountId || !f.toAccountId || f.accountId === f.toAccountId) return toast('Pick two different accounts');
      f.category = 'Transfer';
    } else {
      f.category = readCatPicker('rc', type);
      if (!f.category) return toast('Type a name for the new category');
      delete f.toAccountId;
      if (r) delete r.toAccountId;
    }
    if (endMode !== 'count') f.count = 0;
    if (endMode !== 'date') f.end = '';
    if (endMode !== 'loan') { delete f.loanBalance; delete f.loanAsOf; delete f.loanInterest; delete f.loanRate; }
    if (r && endMode !== 'loan') { delete r.loanBalance; delete r.loanAsOf; delete r.loanInterest; delete r.loanRate; }
    if (r) Object.assign(r, f);
    else state.recurring.push({ id: uid(), ...f });
    await save();
    closeSheet(); render();
    toast(type === 'transfer' ? 'Recurring transfer saved' : 'Recurring payment saved');
  });
  if (r) {
    $('#rcLog').addEventListener('click', () => {
      if (!state.accounts.length) return toast('Create an account first');
      const s = recurringSummary(r);
      const nextIdx = Math.min(s.made, (s.total || 1) - 1);
      if (r.type === 'transfer') return transferSheet({ fromId: r.accountId, toId: r.toAccountId, amount: nthAmount(r, Math.max(0, nextIdx)), note: r.name });
      txSheet(null, { type: r.type, amount: nthAmount(r, Math.max(0, nextIdx)), category: r.category, accountId: r.accountId, recurringId: r.id, note: r.name });
    });
    $('#rcDel').addEventListener('click', async () => {
      if (!confirm(`Delete “${r.name}”? Transactions you already logged for it are kept.`)) return;
      state.recurring = state.recurring.filter((x) => x.id !== r.id);
      for (const t of state.transactions) if (t.recurringId === r.id) delete t.recurringId;
      await save();
      closeSheet(); render();
      toast('Deleted');
    });
  }
}

/* ---------- Salary cycles ---------- */
// With a payday set, a "period" runs from one payday to the day before the next.
// Without one, periods are calendar months.
// state.settings.paydays is a payday history, oldest first: [{from: 'YYYY-MM-DD' | '', payday: 1-31 | 'last', payWeekend}].
// Each rule covers paydays from its `from` date up to the day before the next rule's `from`, so past cycles
// keep the payday that applied at the time.
const paydayRules = () => state.settings.paydays || [];
const cycleMode = () => paydayRules().length > 0;
const currentPayRule = () => paydayRules()[paydayRules().length - 1];

// The payday a rule gives in a month (m is 1-12), moved back to Friday if it falls on a weekend and that option is on.
function paydayByRule(rule, y, m) {
  const d = rule.payday === 'last' ? daysInMonth(y, m) : Math.min(+rule.payday, daysInMonth(y, m));
  let iso = isoOf(y, m, d);
  if (rule.payWeekend) {
    const wd = new Date(y, m - 1, d).getDay();
    if (wd === 6) iso = addDaysISO(iso, -1);
    if (wd === 0) iso = addDaysISO(iso, -2);
  }
  return iso;
}
// All paydays from a few months before to a few months after a date, sorted.
function paydaysNear(iso) {
  const rules = paydayRules();
  const { y, m } = parseISO(iso);
  const out = new Set();
  for (let k = -3; k <= 3; k++) {
    const mo = parseISO(addMonthsISO(isoOf(y, m, 1), k));
    rules.forEach((r, i) => {
      const p = paydayByRule(r, mo.y, mo.m);
      const next = rules[i + 1];
      if ((!r.from || p >= r.from) && (!next || p < next.from)) out.add(p);
    });
  }
  return [...out].sort();
}
const shortDate = (iso) => { const { y, m, d } = parseISO(iso); return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); };
function daysBetween(a, b) { const A = parseISO(a), B = parseISO(b); return Math.round((new Date(B.y, B.m - 1, B.d) - new Date(A.y, A.m - 1, A.d)) / 864e5); }

function makePeriod(start, end) {
  const mid = parseISO(addDaysISO(start, 14)); // label a cycle by the month most of it falls in
  const key = isoOf(mid.y, mid.m, 1).slice(0, 7);
  return {
    start, end, days: daysBetween(start, end) + 1,
    short: monthLabel(key).slice(0, 3),
    label: cycleMode() ? `${shortDate(start)} – ${shortDate(end)} ${parseISO(end).y}` : monthLabel(key, true)
  };
}
function periodContaining(iso) {
  const { y, m } = parseISO(iso);
  if (!cycleMode()) return makePeriod(isoOf(y, m, 1), isoOf(y, m, daysInMonth(y, m)));
  const pays = paydaysNear(iso);
  const i = pays.filter((p) => p <= iso).length - 1;
  return makePeriod(pays[i], addDaysISO(pays[i + 1], -1));
}
const nextPeriod = (p) => periodContaining(addDaysISO(p.end, 1));
const prevPeriod = (p) => periodContaining(addDaysISO(p.start, -1));
const periodWord = () => (cycleMode() ? 'pay cycle' : 'month');

/* ---------- Credit card statement cycles ---------- */
// Statement closes on statementDay (default: last day of the month); the bill is due on dueDay after that
// (default: 3 weeks after the statement).
function cardStatementIn(a, y, m) { return isoOf(y, m, Math.min(a.statementDay || 31, daysInMonth(y, m))); }
function cardDueFor(a, stmt) {
  if (!a.dueDay) return addDaysISO(stmt, 21);
  const { y, m, d } = parseISO(stmt);
  if (a.dueDay > d) return isoOf(y, m, Math.min(a.dueDay, daysInMonth(y, m)));
  const n = parseISO(addMonthsISO(isoOf(y, m, 1), 1));
  return isoOf(n.y, n.m, Math.min(a.dueDay, daysInMonth(n.y, n.m)));
}
// The statement period that a date falls in: {from, to (statement date), due}.
function cardStatementWindow(a, iso) {
  const { y, m } = parseISO(iso);
  let s = cardStatementIn(a, y, m);
  if (iso > s) { const n = parseISO(addMonthsISO(isoOf(y, m, 1), 1)); s = cardStatementIn(a, n.y, n.m); }
  const p = parseISO(addMonthsISO(s.slice(0, 8) + '01', -1));
  return { from: addDaysISO(cardStatementIn(a, p.y, p.m), 1), to: s, due: cardDueFor(a, s) };
}
// Actual spending on a card between two dates (card payments not counted, refunds subtracted).
function cardSpendBetween(id, from, to) {
  return state.transactions.filter((t) => t.accountId === id && !t.transferId && t.date >= from && t.date <= to)
    .reduce((s, t) => s + (t.type === 'expense' ? t.amount : -t.amount), 0);
}
// What a statement adds up to, in parts (all in cents):
//  opening   – the card's starting balance, when its "owed as of" date falls in this statement
//              (a balance owed on the statement day belongs to that statement's bill);
//  spent     – entries on the card dated up to today (entries before "owed as of" are history only);
//  planned   – entries dated after today (e.g. PayLater instalments logged ahead);
//  recurring – recurring payments on this card due in the statement that haven't been logged
//              (logged ones are already in spent / planned); missed lists the past-due ones not logged;
//  paid      – card payments made after the statement closed, up to the next statement day.
function cardStatement(a, w) {
  const t = today();
  const from = a.startDate && a.startDate > w.from ? a.startDate : w.from;
  const res = { ...w, opening: 0, spent: 0, planned: 0, recurring: 0, missed: [], paid: 0 };
  if (a.startDate && a.startDate >= w.from && a.startDate <= w.to) res.opening = Math.max(0, -a.start);
  if (from <= w.to) {
    for (const x of state.transactions) {
      if (x.accountId !== a.id || x.transferId || x.date < from || x.date > w.to) continue;
      const v = x.type === 'expense' ? x.amount : -x.amount;
      if (x.date > t) res.planned += v; else res.spent += v;
    }
    for (const r of state.recurring) {
      if (r.type !== 'expense' || r.accountId !== a.id) continue;
      const due = occurrencesIdx(r, from, w.to);
      if (!due.length) continue;
      const logged = state.transactions.filter((x) => x.recurringId === r.id && x.accountId === a.id && x.date >= from && x.date <= w.to);
      let loggedAmt = logged.reduce((s, x) => s + x.amount, 0);
      for (const o of due) {
        const amt = nthAmount(r, o.i);
        const covered = Math.min(amt, loggedAmt);
        loggedAmt -= covered;
        if (covered >= amt) continue;
        res.recurring += amt - covered;
        if (o.d <= t) res.missed.push({ r, d: o.d, i: o.i, amount: amt - covered });
      }
    }
  }
  const nextTo = cardStatementWindow(a, addDaysISO(w.to, 1)).to;
  res.paid = state.transactions.filter((x) => x.accountId === a.id && x.transferId && x.type === 'income' && x.date > w.to && x.date <= nextTo)
    .reduce((s, x) => s + x.amount, 0);
  res.total = res.opening + res.spent + res.planned + res.recurring;
  res.left = Math.max(0, res.total - res.paid);
  return res;
}

// Card bills due in a period (default: the current month / pay cycle), less what's been paid towards them.
// This is what the card costs you this month / pay cycle; bills due in the next one show up when it starts.
function cardDueIn(a, p = periodContaining(today())) {
  const bills = [];
  let w = cardStatementWindow(a, addDaysISO(p.start, -62));
  for (let guard = 0; guard < 6 && w.due <= p.end; guard++, w = cardStatementWindow(a, addDaysISO(w.to, 1))) {
    if (w.due < p.start) continue;
    const st = cardStatement(a, w);
    if (st.total) bills.push(st);
  }
  return { period: p, bills, amount: bills.reduce((s, b) => s + b.left, 0) };
}

/* ---------- Forecast ---------- */
// Day-to-day (non-recurring) history: everything except transfers and transactions linked to a recurring payment.
const isDayToDay = (t) => !t.recurringId && !t.transferId && t.category !== 'Transfer' && !t.tripId && !t.projectId;

function forecast() {
  const lookback = state.settings.fcLookback || 6;
  const method = state.settings.fcMethod || 'trend';
  const t = today();
  const current = periodContaining(t);
  const periods = [];
  for (let p = nextPeriod(current); periods.length < 12; p = nextPeriod(p)) periods.push(p);

  // History: complete periods only (not the current one), back to the first logged transaction.
  const txs = state.transactions.filter((x) => isDayToDay(x) && x.date <= t);
  // Entries logged ahead with a future date (e.g. PayLater instalments) are planned spending/income:
  // added to the period they fall in, on top of the estimate. Recurring-linked ones are covered by the recurring item.
  const planned = state.transactions.filter((x) => x.date > t && !x.transferId && x.category !== 'Transfer' && !x.recurringId && !x.tripId);
  const plannedSum = (from, to, pred = () => true) => planned.filter((x) => x.date >= from && x.date <= to && pred(x))
    .reduce((acc, x) => {
      if (x.type === 'expense') acc.exp += x.amount; else if (x.refund) acc.exp -= x.amount; else acc.inc += x.amount;
      if (isCard(x.accountId)) acc.card += x.type === 'expense' ? x.amount : x.refund ? -x.amount : 0;
      return acc;
    }, { exp: 0, inc: 0, card: 0 });
  const plannedIn = (from, to) => planned.filter((x) => x.date >= from && x.date <= to).sort((a, b) => a.date.localeCompare(b.date));
  const first = txs.length ? txs.map((x) => x.date).sort()[0] : null;
  let hist = [];
  let partial = false;
  if (first) {
    // Use a partly-logged first period only if at least half of it was logged (it gets scaled up below).
    for (let p = prevPeriod(current); hist.length < lookback && daysBetween([p.start, first].sort()[1], p.end) + 1 >= p.days / 2; p = prevPeriod(p)) hist.unshift(p);
    if (!hist.length) { hist = [current]; partial = true; }
  }
  // When only the current (unfinished) period is available, it is used (scaled up to a full period).
  // Spending is projected as a daily rate, so short, long and partly-logged periods all count fairly.
  const loggedFrom = partial ? [current.start, first].sort()[1] : null;
  const loggedDays = hist.map((p) => daysBetween([p.start, first].sort()[1], partial ? t : p.end) + 1);
  const AVG_DAYS = 30.44; // used to show "per month / per pay cycle" figures

  const n = hist.length;
  const idxOf = (date) => hist.findIndex((p) => date >= p.start && date <= p.end);
  const expSeries = {}; // category -> [cents per period]
  const cardTotals = {}; // category -> {cardId: cents}
  const incSeries = new Array(n).fill(0);
  for (const x of txs) {
    const i = idxOf(x.date);
    if (i < 0) continue;
    if (x.refund) {
      // Money back reduces that category's spending instead of counting as income.
      (expSeries[x.category] ||= new Array(n).fill(0))[i] -= x.amount;
    } else if (x.type === 'income') incSeries[i] += x.amount;
    else {
      (expSeries[x.category] ||= new Array(n).fill(0))[i] += x.amount;
      if (isCard(x.accountId)) (cardTotals[x.category] ||= {})[x.accountId] = ((cardTotals[x.category] || {})[x.accountId] || 0) + x.amount;
    }
  }
  const cards = cardAccounts();
  const hasCards = cards.length > 0;

  // Projection for one category's daily rate: average, optionally tilted by a least-squares trend line.
  // at(j) is the daily rate in future period j (0 = next period, -1 = the current one).
  function project(series) {
    const s = series.map((v, i) => v / loggedDays[i]);
    const avg = s.reduce((a, b) => a + b, 0) / n;
    if (method !== 'trend' || n < 3) return { avg, at: () => avg, slope: 0 };
    const xm = (n - 1) / 2;
    let num = 0, den = 0;
    s.forEach((v, i) => { num += (i - xm) * (v - avg); den += (i - xm) ** 2; });
    const slope = den ? num / den : 0;
    // Future period j (0 = next period) sits at x = n + 1 + j; the current period is j = -1.
    const at = (j) => Math.min(2 * avg, Math.max(0, avg + slope * (n + 1 + j - xm)));
    return { avg, at, slope };
  }
  const catProj = Object.entries(expSeries).map(([cat, series]) => {
    const total = Math.max(1, series.reduce((a, b) => a + b, 0));
    const share = {};
    for (const c of cards) share[c.id] = ((cardTotals[cat] || {})[c.id] || 0) / total;
    return { cat, ...project(series), share };
  }).filter((c) => c.avg > 0).sort((a, b) => b.avg - a.avg);
  // Income comes in lumps (e.g. salary on payday), so it is averaged per period, using only fully-logged
  // periods of a normal length (not the short or long cycle around a payday change).
  const fullIdx = hist.map((p, i) => i).filter((i) => loggedDays[i] === hist[i].days && hist[i].days >= 26 && hist[i].days <= 35);
  const incIdx = fullIdx.length ? fullIdx : hist.map((p, i) => i);
  const incAvg = incIdx.length ? incIdx.reduce((a, i) => a + incSeries[i], 0) / incIdx.length : 0;

  const rows = periods.map((p, j) => {
    const rec = [];
    for (const r of state.recurring) {
      const count = occurrences(r, p.start, p.end).length;
      if (count) rec.push({ r, amount: amountBetween(r, p.start, p.end), count });
    }
    const recExp = rec.filter((x) => x.r.type === 'expense').reduce((s, x) => s + x.amount, 0);
    const recInc = rec.filter((x) => x.r.type === 'income').reduce((s, x) => s + x.amount, 0);
    const cats = catProj.map((c) => ({ cat: c.cat, amount: Math.round(c.at(j) * p.days) }));
    const dayExp = cats.reduce((s, c) => s + c.amount, 0);
    const income = recInc + Math.round(incAvg);
    const pl = plannedSum(p.start, p.end);
    const cardSpend = rec.filter((x) => x.r.type === 'expense' && isCard(x.r.accountId)).reduce((s, x) => s + x.amount, 0) +
      Math.round(catProj.reduce((s, c, ci) => s + cats[ci].amount * Object.values(c.share).reduce((a, b) => a + b, 0), 0)) + pl.card;
    const tripList = tripsBetween(p.start, p.end);
    const tripExp = tripList.reduce((s, x) => s + x.amount, 0);
    const spend = recExp + dayExp + pl.exp + tripExp;
    return { ...p, rec, recExp, recInc, cats, dayExp, plannedList: plannedIn(p.start, p.end), plannedExp: pl.exp, tripList, tripExp,
      income: income + pl.inc, spend, net: income + pl.inc - spend, cardSpend, bills: [] };
  });

  // Card bills: each statement's spending (actual up to today, projected after), due on the card's due date.
  const tomorrow = addDaysISO(t, 1);
  let remBills = 0; // card bills due in the rest of the current period (after today)
  const nowBills = []; // all card bills due in the current period
  if (hasCards) {
    const all = [current, ...periods];
    const rowIdx = (date) => periods.findIndex((p) => date >= p.start && date <= p.end);
    for (const a of cards) {
      // Projected day-to-day card spending per day for each period.
      const rate = all.map((p, k) => catProj.reduce((s, c) => s + c.at(k - 1) * (c.share[a.id] || 0), 0));
      const projected = (from, to) => {
        let sum = 0;
        for (let k = 0; k < all.length; k++) {
          const lo = [from, all[k].start].sort()[1], hi = [to, all[k].end].sort()[0];
          if (lo <= hi) sum += rate[k] * (daysBetween(lo, hi) + 1);
        }
        return sum; // recurring payments are counted by cardStatement()
      };
      let w = cardStatementWindow(a, addDaysISO(t, -62));
      for (let guard = 0; guard < 20 && w.from <= periods[11].end; guard++, w = cardStatementWindow(a, addDaysISO(w.to, 1))) {
        const i = rowIdx(w.due);
        const inNow = w.due >= current.start && w.due <= current.end;
        if (i < 0 && !inNow) continue;
        // Logged + planned entries, the starting balance if it falls in this statement, recurring payments,
        // and projected day-to-day spending for the days still to come. Bills already paid aren't counted again.
        const st = cardStatement(a, w);
        const proj = w.to > t ? projected([w.from, addDaysISO(t, 1)].sort()[1], w.to) : 0;
        const full = Math.max(0, Math.round(st.total + proj));
        const amount = w.due > t ? Math.max(0, full - st.paid) : full;
        if (!amount) continue;
        const bill = { card: a, from: w.from, to: w.to, due: w.due, amount, estimated: w.to > t };
        if (inNow) { nowBills.push(bill); if (w.due > t) remBills += amount; }
        else rows[i].bills.push({ card: a, from: w.from, to: w.to, due: w.due, amount, estimated: w.to > t });
      }
    }
  }
  rows.forEach((r) => {
    r.cardBill = r.bills.reduce((s, b) => s + b.amount, 0);
    r.cashOut = r.spend - r.cardSpend + r.cardBill; // = spend when there are no cards
  });

  // The current period: what's been logged so far plus what's expected for the rest of it.
  const restDays = Math.max(0, daysBetween(t, current.end));
  const logged = state.transactions.filter((x) => x.date >= current.start && x.date <= t && !x.transferId && x.category !== 'Transfer');
  const recNow = [];
  let restIn = 0, restOut = remBills, cardRest = 0;
  for (const r of state.recurring) {
    const linked = logged.filter((x) => x.recurringId === r.id).reduce((s, x) => s + x.amount, 0);
    // Payments already logged plus those still to come, but never less than the schedule for the period.
    const amount = Math.max(amountBetween(r, current.start, current.end), linked + amountBetween(r, tomorrow, current.end));
    if (!amount) continue;
    if (r.type === 'transfer') continue;
    recNow.push({ r, amount, count: Math.max(1, occurrences(r, current.start, current.end).length) });
    const toCome = Math.max(0, amount - linked);
    if (r.type === 'income') restIn += toCome;
    else if (isCard(r.accountId)) cardRest += toCome;
    else restOut += toCome;
  }
  const catNow = {};
  for (const x of logged) {
    if (x.recurringId || x.tripId || (x.type === 'income' && !x.refund)) continue;
    catNow[x.category] = (catNow[x.category] || 0) + (x.refund ? -x.amount : x.amount);
  }
  for (const c of catProj) catNow[c.cat] = (catNow[c.cat] || 0) + c.at(-1) * restDays;
  const nowCats = Object.entries(catNow).map(([cat, v]) => ({ cat, amount: Math.max(0, Math.round(v)) }))
    .filter((c) => c.amount > 0).sort((a, b) => b.amount - a.amount);
  const cardShareRest = catProj.reduce((s, c) => s + c.at(-1) * Object.values(c.share).reduce((a, b) => a + b, 0), 0) * restDays;
  restOut += catProj.reduce((s, c) => s + c.at(-1), 0) * restDays - cardShareRest; // day-to-day not on cards
  // Other income: the period's pay may already be logged; otherwise expect the usual amount.
  const otherIncNow = logged.filter((x) => x.type === 'income' && !x.refund && !x.recurringId).reduce((s, x) => s + x.amount, 0);
  restIn += Math.max(0, incAvg - otherIncNow);
  const plNow = plannedSum(tomorrow, current.end);
  restIn += plNow.inc;
  restOut += plNow.exp - plNow.card; // planned card spending leaves the bank when the bill is due
  // Trips: what's been logged for them this period so far, plus their expected spending in the days left.
  const tripRest = tripsBetween(tomorrow, current.end);
  restOut += tripRest.reduce((s, x) => s + x.amount, 0);
  const tripLoggedNow = tripSpendBetween(current.start, t);
  const tripListNow = mergeTripLists(tripLoggedNow, tripRest);
  const tripExpNow = tripListNow.reduce((s, x) => s + x.amount, 0);
  const nowRecExp = recNow.filter((x) => x.r.type === 'expense').reduce((s, x) => s + x.amount, 0);
  const nowRecInc = recNow.filter((x) => x.r.type === 'income').reduce((s, x) => s + x.amount, 0);
  const nowDay = nowCats.reduce((s, c) => s + c.amount, 0);
  const nowIncome = nowRecInc + Math.max(otherIncNow, Math.round(incAvg));
  const nowCardSpend = Math.round(cards.reduce((s, a) => s + cardSpendBetween(a.id, current.start, t), 0) + cardShareRest + cardRest) + plNow.card;
  const nowSpend = nowRecExp + nowDay + plNow.exp + tripExpNow;
  const nowRow = {
    ...current, current: true, short: 'Now', rec: recNow, recExp: nowRecExp, recInc: nowRecInc, cats: nowCats,
    plannedList: plannedIn(tomorrow, current.end), plannedExp: plNow.exp, tripList: tripListNow, tripExp: tripExpNow,
    dayExp: nowDay, income: nowIncome + plNow.inc, spend: nowSpend, net: nowIncome + plNow.inc - nowSpend,
    cardSpend: nowCardSpend, bills: nowBills.sort((a, b) => a.due.localeCompare(b.due))
  };
  nowRow.cardBill = nowRow.bills.reduce((s, b) => s + b.amount, 0);
  nowRow.cashOut = nowRow.spend - nowRow.cardSpend + nowRow.cardBill;

  // Bank balance path: today's bank balances, plus the rest of the current period, then each future period's
  // income minus the cash that leaves the bank (spending not on cards + card bills due).
  const bankNow = bankAccounts().reduce((s, a) => s + balance(a.id), 0);
  let bal = bankNow + restIn - restOut;
  const startBal = Math.round(bal);
  nowRow.bankEnd = startBal;
  rows.forEach((r) => { bal += r.income - r.cashOut; r.bankEnd = Math.round(bal); });

  // rows[0] is the current period (flagged current: true); the 12 after it are the forecast proper.
  return { rows: [nowRow, ...rows], future: rows, catProj, hist, partial, loggedFrom, AVG_DAYS, incAvg, n, method, lookback, hasCards, current,
    bankNow, startBal, restIn: Math.round(restIn), restOut: Math.round(restOut) };
}

let fcSelected = 0;

function renderForecast() {
  const el = $('#plan-forecast');
  const f = forecast();
  const { rows } = f;
  const word = periodWord();
  if (!f.n && !state.recurring.length) {
    el.innerHTML = `<div class="empty">Nothing to forecast yet.<br>Log some spending (History) or add recurring payments, and your 12-${word} forecast will appear here.</div>`;
    return;
  }
  const total = f.future.reduce((s, r) => s + r.spend, 0);
  const totalNet = f.future.reduce((s, r) => s + r.net, 0);
  const max = Math.max(1, ...rows.map((r) => r.spend));
  const nice = niceMax(max);
  if (fcSelected >= rows.length) fcSelected = 0;

  const basis = !f.n ? 'No day-to-day spending logged yet — forecast uses recurring payments only.'
    : f.partial ? `Based on ${daysBetween(f.loggedFrom, today()) + 1} days of this ${word} (scaled up to a full ${word}). It gets more accurate once you have a full ${word} of data.`
      : `Based on ${f.n} ${word}${f.n > 1 ? 's' : ''} of history (${shortDate(f.hist[0].start)} ${parseISO(f.hist[0].start).y} – ${shortDate(f.hist[f.n - 1].end)} ${parseISO(f.hist[f.n - 1].end).y}).`;
  const rule = currentPayRule();
  const cycleNote = cycleMode()
    ? `Each bar is one pay cycle (payday ${payRuleText(rule)} up to the day before the next payday), labelled by the month most of it falls in.${paydayRules().length > 1 ? ' Past cycles use the payday you had at the time.' : ''}`
    : 'Each bar is a calendar month. Set your payday under Backup → Settings to see pay cycles instead.';

  const view = state.settings.fcView || 'spending';
  let html = `
    <div class="controls">
      <label>History to use (${word}s)
        <select id="fcLookback">${[3, 6, 12].map((v) => `<option value="${v}">Last ${v}</option>`).join('')}</select></label>
      <label>Day-to-day spending
        <select id="fcMethod"><option value="trend">Follow the trend</option><option value="average">Use the average</option></select></label>
    </div>
    <div class="segmented view-toggle" id="fcView">
      <button type="button" data-v="spending" class="${view === 'spending' ? 'on' : ''}">Spending</button>
      <button type="button" data-v="savings" class="${view === 'savings' ? 'on' : ''}">Savings</button>
    </div>`;
  if (view === 'savings') return renderSavings(el, f, html, basis, cycleNote);
  html += `
    <div class="tiles">
      <div class="tile"><div class="label">Spending, next 12 ${word}s</div><div class="value">${money(total)}</div></div>
      <div class="tile"><div class="label">Average per ${word}</div><div class="value">${money(total / 12)}</div></div>
      <div class="tile wide"><div class="label">Left over each ${word} on average (income − spending)</div>
        <div class="value ${totalNet < 0 ? 'neg' : 'pos'}">${money(totalNet / 12, true)}</div></div>
    </div>
    <div class="card">
      <div class="legend"><span><i style="background:var(--series-1)"></i>Recurring</span><span><i style="background:var(--series-2)"></i>Day-to-day</span></div>
      <div class="chart" role="img" aria-label="Forecast spending per ${word} for the next 12 ${word}s">
        <div class="gridline" style="bottom:100%"></div><span class="gridlabel" style="bottom:100%">${shortMoney(nice)}</span>
        <div class="gridline" style="bottom:50%"></div><span class="gridlabel" style="bottom:50%">${shortMoney(nice / 2)}</span>
        <div class="gridline" style="bottom:0"></div><span class="gridlabel" style="bottom:0">0</span>
        <div class="cols">${rows.map((r, i) => `<button class="col ${i === fcSelected ? 'sel' : ''}" data-m="${i}"
            aria-label="${esc(r.label)}: ${money(r.spend)}">
          ${r.dayExp ? `<div class="seg s2" style="height:${(r.dayExp / nice) * 100}%"></div>` : ''}
          ${r.recExp ? `<div class="seg s1" style="height:${(r.recExp / nice) * 100}%"></div>` : ''}
        </button>`).join('')}</div>
      </div>
      <div class="chart-x">${rows.map((r) => `<span>${r.short}</span>`).join('')}</div>
      <p class="muted small" style="margin:10px 0 0">“Now” is the current ${word}: what you've logged so far plus an estimate for the rest of it. ${cycleNote} Tap a bar to see the details.</p>
    </div>
    <div class="card" id="fcMonth"></div>`;

  if (f.catProj.length) {
    html += `<h2 class="section-title">Day-to-day spending by category</h2><div class="card">
      <div class="kv"><span class="k small">Category (per ${word})</span><span class="v small muted">Avg so far → next ${word}</span></div>` +
      f.catProj.map((c) => {
        // Shown per average-length month / pay cycle so the arrow isn't affected by cycle length.
        const avg = c.avg * f.AVG_DAYS, next = c.at(0) * f.AVG_DAYS;
        const ch = avg ? (next - avg) / avg : 0;
        const arrow = Math.abs(ch) < 0.03 ? '<span class="muted">→ steady</span>'
          : ch > 0 ? `<span class="trend-up">↑ ${Math.round(ch * 100)}%</span>` : `<span class="trend-down">↓ ${Math.round(-ch * 100)}%</span>`;
        return `<div class="kv"><span class="k">${esc(c.cat)}</span><span class="v">${money(avg)} → ${money(next)} ${f.method === 'trend' ? arrow : ''}</span></div>`;
      }).join('') + `</div>`;
  }

  const lastDay = rows[rows.length - 1].end;
  const ending = state.recurring.filter((r) => r.type !== 'transfer').map((r) => ({ r, last: lastPaymentDate(r) }))
    .filter((x) => x.last && x.last >= today() && x.last <= lastDay)
    .sort((a, b) => a.last.localeCompare(b.last));
  if (ending.length) {
    html += `<h2 class="section-title">Ending in the next 12 ${word}s</h2><div class="card">` +
      ending.map(({ r, last }) => `<div class="kv"><span class="k">${esc(r.name)} · last payment ${monthLabel(monthKey(last))}</span>
        <span class="v">${r.type === 'expense' ? 'frees up' : 'loses'} ${money(monthlyEquivalent(r))}/mo</span></div>`).join('') + `</div>`;
  }
  if (f.hasCards) {
    const avgCard = f.future.reduce((s, r) => s + r.cardSpend, 0) / 12;
    html += `<p class="muted small">💳 About ${money(avgCard)} a ${word} of your spending goes on credit cards. It leaves your bank account when each card's bill is due, after its statement closes. Tap a bar to see which bills are due in it.</p>`;
  }
  html += `<p class="muted small">How each ${word} is worked out: 🔁 recurring payments on their dates; "(estimate)" lines are your day-to-day spending per category, from what you've logged so far (a daily rate × the days in the ${word}); 📅 lines are entries you've logged with a future date. ${basis} Card payments, transfers, and transactions linked to a recurring payment, are left out of the estimate so nothing is counted twice.</p>`;

  el.innerHTML = html;
  bindForecastControls(f);
  const showMonth = (i) => {
    fcSelected = i;
    el.querySelectorAll('.col').forEach((c) => c.classList.toggle('sel', +c.dataset.m === i));
    const r = rows[i];
    const line = (k, v, cls = '') => `<div class="kv ${cls}"><span class="k">${k}</span><span class="v">${v}</span></div>`;
    $('#fcMonth').innerHTML = `<h2>${esc(r.label)}${r.current ? ' <span class="tag">now</span>' : ''}</h2>` +
      (r.current ? `<p class="muted small" style="margin:0 0 6px">Logged so far, plus an estimate for the ${daysBetween(today(), r.end)} day(s) left.</p>` : '') +
      r.rec.filter((x) => x.r.type === 'expense').map((x) => line(`🔁 ${esc(x.r.name)}${x.count > 1 ? ` ×${x.count}` : ''}${isCard(x.r.accountId) ? ' 💳' : ''}`, money(x.amount))).join('') +
      r.cats.filter((c) => c.amount > 0).map((c) => line(`${esc(c.cat)} <span class="muted small">(estimate)</span>`, money(c.amount))).join('') +
      (r.plannedList || []).filter((x) => x.type === 'expense' || x.refund).map((x) => line(`📅 ${esc(x.category)}${x.note ? ' · ' + esc(x.note) : ''} <span class="muted small">(${shortDate(x.date)}${isCard(x.accountId) ? ', 💳' : ''})</span>`,
        money(x.refund ? -x.amount : x.amount))).join('') +
      (r.tripList || []).map((x) => line(`✈️ ${esc(tripTitle(x.trip))} trip <span class="muted small">(${shortDate(x.trip.start)} – ${shortDate(x.trip.end)})</span>`, money(x.amount))).join('') +
      line('Total spending', money(r.spend), 'total') +
      line('Expected income', money(r.income)) +
      line('Left over', `<span class="${r.net < 0 ? 'neg' : 'pos'}">${money(r.net, true)}</span>`, 'total') +
      (f.hasCards ? `<h3 class="sub-head">💳 Credit cards</h3>` +
        line(`Spent on cards in this ${word}`, money(r.cardSpend)) +
        (r.bills.length ? r.bills.map((b) => line(`${esc(b.card.name)} bill due ${shortDate(b.due)}${b.due <= today() ? ' ✓' : ''} <span class="muted small">(spending ${shortDate(b.from)} – ${shortDate(b.to)}${b.estimated ? ', estimated' : ''})</span>`, money(b.amount))).join('')
          : line('Card bills due', money(0))) +
        line('Cash out of your bank accounts', money(r.cashOut), 'total') +
        `<p class="muted small" style="margin:6px 0 0">Spending paid directly from the bank, plus the card bills due in this ${word}.</p>` : '');
  };
  el.querySelectorAll('.col').forEach((c) => c.addEventListener('click', () => showMonth(+c.dataset.m)));
  showMonth(fcSelected);
}

function bindForecastControls(f) {
  $('#fcLookback').value = String(f.lookback);
  $('#fcMethod').value = f.method;
  $('#fcLookback').addEventListener('change', async (e) => { state.settings.fcLookback = +e.target.value; await save(); renderForecast(); });
  $('#fcMethod').addEventListener('change', async (e) => { state.settings.fcMethod = e.target.value; await save(); renderForecast(); });
  document.querySelectorAll('#fcView button').forEach((b) => b.addEventListener('click', async () => {
    state.settings.fcView = b.dataset.v; await save(); renderForecast();
  }));
}

// Savings view: income − spending for each period, and where your bank balance is heading.
function renderSavings(el, f, html, basis, cycleNote) {
  const { rows } = f;
  const word = periodWord();
  const total = f.future.reduce((s, r) => s + r.net, 0);
  const avg = total / 12;
  const last = rows[rows.length - 1];
  const committed = state.projects.map((p) => projectPlan(p)).filter((r) => !r.done).reduce((s, r) => s + r.monthlyNow, 0);
  const hasIncome = f.incAvg > 0 || state.recurring.some((r) => r.type === 'income' && !recurringSummary(r).finished);

  html += `
    <div class="tiles">
      <div class="tile"><div class="label">You can save about</div><div class="value ${avg < 0 ? 'neg' : 'pos'}">${money(avg, true)}</div><div class="label">per ${word} on average</div></div>
      <div class="tile"><div class="label">Saved over the next 12 ${word}s</div><div class="value ${total < 0 ? 'neg' : 'pos'}">${money(total, true)}</div></div>
      <div class="tile wide"><div class="label">Bank balance by ${shortDate(last.end)} ${parseISO(last.end).y}</div>
        <div class="value ${last.bankEnd < 0 ? 'neg' : ''}">${money(last.bankEnd)}</div>
        <div class="label">Now ${money(f.bankNow)} across your bank accounts${f.hasCards ? ', with card bills paid as they fall due' : ''}</div></div>
    </div>`;
  if (!hasIncome) {
    html += `<p class="status bad small">⚠️ No income in the forecast yet, so it can't tell what you'll save. Add your salary under Plan → Recurring, or log it as income in History.</p>`;
  }
  if (committed) {
    const leftAfter = avg - committed;
    html += `<div class="card small">🎯 Your savings projects plan <strong>${money(committed)}</strong> a month. ${leftAfter >= 0
      ? `That leaves about <strong>${money(leftAfter)}</strong> a ${word} free to save on top.`
      : `<span class="status bad">That's about ${money(-leftAfter)} a ${word} more than the forecast says you can save.</span>`}</div>`;
  }

  // Diverging bars around zero: saved above, shortfall below.
  const maxPos = Math.max(0, ...rows.map((r) => r.net));
  const maxNeg = Math.max(0, ...rows.map((r) => -r.net));
  const top = maxPos ? niceMax(maxPos) : 0, bot = maxNeg ? niceMax(maxNeg) : 0;
  const range = Math.max(1, top + bot);
  const zero = (bot / range) * 100; // baseline, % from the bottom
  html += `
    <div class="card">
      <div class="legend"><span><i style="background:var(--series-1)"></i>Saved</span>${maxNeg ? '<span><i style="background:var(--series-2)"></i>Spent more than earned</span>' : ''}</div>
      <div class="chart" role="img" aria-label="Forecast amount saved per ${word}">
        ${top ? `<div class="gridline" style="bottom:100%"></div><span class="gridlabel" style="bottom:100%">${shortMoney(top)}</span>` : ''}
        <div class="gridline zero" style="bottom:${zero}%"></div><span class="gridlabel" style="bottom:${zero}%">0</span>
        ${bot ? `<div class="gridline" style="bottom:0"></div><span class="gridlabel" style="bottom:0">−${shortMoney(bot)}</span>` : ''}
        <div class="cols">${rows.map((r, i) => {
          const h = (Math.abs(r.net) / range) * 100;
          const style = r.net >= 0 ? `bottom:${zero}%;height:${h}%` : `top:${100 - zero}%;height:${h}%`;
          return `<button class="col dv ${i === fcSelected ? 'sel' : ''}" data-m="${i}" aria-label="${esc(r.label)}: ${money(r.net, true)}">
            ${r.net ? `<div class="dv-bar ${r.net >= 0 ? 'up' : 'down'}" style="${style}"></div>` : ''}</button>`;
        }).join('')}</div>
      </div>
      <div class="chart-x">${rows.map((r) => `<span>${r.short}</span>`).join('')}</div>
      <p class="muted small" style="margin:10px 0 0">“Now” is the current ${word}. ${cycleNote} Tap a bar to see the details.</p>
    </div>
    <div class="card" id="fcMonth"></div>
    <h2 class="section-title">Each ${word}</h2>
    <div class="card">
      <div class="grid3 head"><span>${word === 'month' ? 'Month' : 'Pay cycle'}</span><span>Saved</span><span>Bank after</span></div>
      ${rows.map((r) => `<div class="grid3"><span>${esc(r.label)}${r.current ? ' <span class="tag">now</span>' : ''}</span>
        <span class="${r.net < 0 ? 'neg' : 'pos'}">${money(r.net, true)}</span><span>${money(r.bankEnd)}</span></div>`).join('')}
    </div>
    <p class="muted small">"Saved" is expected income minus all spending in that ${word}, including spending on credit cards. "Bank after" is where your bank accounts should be at the end of the ${word}: it starts from today's balance, adds the rest of this ${word} (about ${money(f.restIn)} in, ${money(f.restOut)} out), and takes card bills out when they're due. Savings projects aren't taken out — the money stays in your accounts. ${basis}</p>`;

  el.innerHTML = html;
  bindForecastControls(f);
  const showMonth = (i) => {
    fcSelected = i;
    el.querySelectorAll('.col').forEach((c) => c.classList.toggle('sel', +c.dataset.m === i));
    const r = rows[i];
    const line = (k, v, cls = '') => `<div class="kv ${cls}"><span class="k">${k}</span><span class="v">${v}</span></div>`;
    $('#fcMonth').innerHTML = `<h2>${esc(r.label)}${r.current ? ' <span class="tag">now</span>' : ''}</h2>` +
      line('Expected income', money(r.income)) +
      line('Spending', money(r.spend)) +
      line('Saved', `<span class="${r.net < 0 ? 'neg' : 'pos'}">${money(r.net, true)}</span>`, 'total') +
      (f.hasCards ? line(`Cash out of the bank (incl. card bills due)`, money(r.cashOut)) : '') +
      line(`Bank balance at the end`, money(r.bankEnd), 'total');
  };
  el.querySelectorAll('.col').forEach((c) => c.addEventListener('click', () => showMonth(+c.dataset.m)));
  showMonth(fcSelected);
}

const payRuleText = (r) => (r.payday === 'last' ? 'on the last day of the month' : `on the ${ordinal(+r.payday)}`) +
  (r.payWeekend ? ' (Friday before if on a weekend)' : '');
const ordinal = (n) => n + (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th');

// Compact axis label, e.g. 1500000 cents -> "15k".
function shortMoney(cents) {
  const v = cents / 100;
  if (v >= 1e6) return +(v / 1e6).toFixed(1) + 'm';
  if (v >= 1000) return +(v / 1000).toFixed(1) + 'k';
  return String(Math.round(v));
}

// Round the chart's top value up to a tidy number.
function niceMax(v) {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const s of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (s * p >= v) return s * p;
  return 10 * p;
}

/* ---------- Savings projects ---------- */
const projectTarget = (p) => p.items.reduce((s, i) => s + i.amount, 0);
// Purchases linked to a project cost: how much was paid and in how many payments.
function itemPaid(p, i) {
  const txs = state.transactions.filter((t) => t.projectId === p.id && t.projectItemId === i.id && (t.type === 'expense' || t.refund));
  return { txs, paid: txs.reduce((s, t) => s + (t.refund ? -t.amount : t.amount), 0), count: txs.filter((t) => t.type === 'expense').length };
}
// Still to pay for a cost: nothing once marked fully paid, otherwise the plan minus what's been paid.
const itemLeft = (p, i) => (i.done ? 0 : Math.max(0, (i.amount || 0) - itemPaid(p, i).paid));
function projectTag(t) {
  if (!t.projectId) return '';
  const p = state.projects.find((x) => x.id === t.projectId);
  if (!p) return '';
  const i = p.items.find((x) => x.id === t.projectItemId);
  return `🎯 ${esc(p.name)}${i ? ' · ' + esc(i.name) : ''} · `;
}
const projectSaved = (p) => (p.savedMode === 'account' && state.accounts.some((a) => a.id === p.accountId)
  ? Math.max(0, balance(p.accountId)) : p.saved || 0);

/* Each cost can say when it's needed (due: 'YYYY-MM') and be paid in instalments (instalments: number of monthly
   payments, the first in the due month). Costs without a month use the project's target date, if any. */
const itemPayments = (i) => (i.instalments > 1 ? i.instalments : 1);
function costText(i, p) {
  const due = i.due || (p && p.targetDate ? monthKey(p.targetDate) : '');
  if (i.instalments > 1) {
    const each = Math.round(i.amount / i.instalments);
    return due ? `${i.instalments} × ${money(each)} a month, ${monthLabel(due)} – ${monthLabel(addMonthsKey(due, i.instalments - 1))}`
      : `${i.instalments} × ${money(each)} a month`;
  }
  return due ? `needed ${monthLabel(due)}` : 'no date';
}
// The dated payments of a project, by month: [{month, amount, item}], plus the total of undated costs.
function projectSchedule(p) {
  const pays = [];
  let undated = 0;
  for (const i of p.items) {
    // Only what's still to pay: purchases already linked to this cost come off it.
    const left = p.id ? itemLeft(p, i) : (i.amount || 0);
    if (!(left > 0)) continue;
    const due = i.due || (p.targetDate ? monthKey(p.targetDate) : '');
    if (!due) { undated += left; continue; }
    const n = itemPayments(i);
    const done = p.id && n > 1 ? Math.min(n - 1, itemPaid(p, i).count) : 0; // instalments already paid
    const rest = n - done;
    const each = Math.floor(left / rest);
    for (let k = done; k < n; k++) {
      pays.push({ month: addMonthsKey(due, k), amount: k === n - 1 ? left - each * (rest - 1) : each, item: i, k, n });
    }
  }
  pays.sort((a, b) => a.month.localeCompare(b.month));
  return { pays, undated };
}

/* How much to save each month for a project (p.planMode):
   'due'    – save each payment in the month it's due (instalments month by month), after using what's saved;
   'spread' – the smoothest plan: the lowest steady amount that meets every payment on time, dropping after each
              big payment (e.g. S$1,833.34 a month until a S$5,000 bill, then S$500 a month for instalments);
   'fixed'  – a fixed amount you choose (p.monthly).
   Returns [{month, save, pay}] from this month to the last payment, or null if there are no dated costs. */
const planModeOf = (p) => p.planMode || (p.monthly > 0 ? 'fixed' : 'due');
function autoSavingPlan(p, saved, timeline) {
  if (!timeline || !timeline.length) return null;
  const first = monthKey(today());
  const last = timeline[timeline.length - 1].month;
  const months = [];
  for (let m = first; m <= last; m = addMonthsKey(m, 1)) months.push({ month: m, pay: 0, save: 0 });
  // Payments already overdue count as due this month.
  for (const t of timeline) months[Math.max(0, monthsBetween(first, t.month))].pay += t.pay;
  if (planModeOf(p) === 'spread') {
    const cum = []; months.reduce((acc, m, i) => (cum[i] = acc + m.pay), 0);
    let start = 0, have = saved;
    while (start < months.length) {
      let best = -Infinity, bestJ = start;
      for (let j = start; j < months.length; j++) {
        const rate = (cum[j] - have) / (j - start + 1);
        if (rate >= best - 1e-9) { best = rate; bestJ = j; }
      }
      const rate = Math.max(0, Math.ceil(best));
      for (let k = start; k <= bestJ; k++) months[k].save = rate;
      have += rate * (bestJ - start + 1);
      start = bestJ + 1;
    }
  } else {
    let covered = saved;
    for (const m of months) { const use = Math.min(covered, m.pay); covered -= use; m.save = m.pay - use; }
  }
  return months;
}
// The amount to save in a given month (default: this month).
function projectMonthly(p, r, month = monthKey(today())) {
  if (planModeOf(p) === 'fixed') return p.monthly || 0;
  const row = r && r.plan && r.plan.find((m) => m.month === month);
  return row ? row.save : 0;
}
// "S$1,833.34 a month Nov 2026 – Jan 2027, then S$500.00 a month Feb – Dec 2027"
function planSummary(plan) {
  const parts = [];
  for (const m of plan) {
    const last = parts[parts.length - 1];
    if (last && last.save === m.save) last.to = m.month; else parts.push({ save: m.save, from: m.month, to: m.month });
  }
  const range = (x) => (x.from === x.to ? `in ${monthLabel(x.from)}` : `a month, ${monthLabel(x.from)} – ${monthLabel(x.to)}`);
  return parts.map((x) => (x.save ? `<strong>${money(x.save)}</strong> ${range(x)}` : `nothing ${x.from === x.to ? 'in ' + monthLabel(x.from) : `${monthLabel(x.from)} – ${monthLabel(x.to)}`}`)).join(', then ');
}

function projectPlan(p) {
  const target = projectTarget(p);
  const saved = projectSaved(p);
  // What's been paid for the project's costs, and what's still to pay.
  const spent = p.id ? p.items.reduce((s, i) => s + itemPaid(p, i).paid, 0) : 0;
  const stillToPay = p.items.reduce((s, i) => s + (p.id ? itemLeft(p, i) : i.amount || 0), 0);
  const remaining = Math.max(0, stillToPay - saved);
  const thisMonth = monthKey(today());
  const res = { target, saved, spent, stillToPay, remaining,
    pct: spent + stillToPay ? Math.min(1, (spent + Math.min(saved, stillToPay)) / (spent + stillToPay)) : 1 };
  if (remaining === 0) res.done = true;
  if (p.monthly > 0 && remaining > 0) {
    res.months = Math.ceil(remaining / p.monthly);
    res.reachBy = addMonthsKey(thisMonth, res.months);
  }
  // Payment timeline: savings grow by the monthly amount each month from next month; each payment comes out of them.
  const { pays, undated } = projectSchedule(p);
  res.undated = undated;
  if (pays.length) {
    res.hasSchedule = true;
    const months = [];
    let cum = 0, need = 0, shortNow = false;
    for (const x of pays) {
      cum += x.amount;
      const last = months[months.length - 1];
      if (last && last.month === x.month) { last.pay += x.amount; last.parts.push(x); last.cum = cum; } else months.push({ month: x.month, pay: x.amount, parts: [x], cum });
    }
    for (const m of months) {
      const k = Math.max(0, monthsBetween(thisMonth, m.month));
      m.k = k;
      if (k === 0) { if (m.cum > saved) shortNow = true; } else need = Math.max(need, Math.ceil((m.cum - saved) / k));
      m.left = saved + (p.monthly || 0) * k - m.cum; // savings left after this month's payments
      if (m.left < 0 && !res.shortfall) res.shortfall = m;
    }
    res.timeline = months;
    if (planModeOf(p) !== 'fixed') {
      // Auto plan: savings left after each payment month follows the plan, so it never goes short.
      res.plan = autoSavingPlan(p, saved, months);
      let have = saved, paid = 0;
      for (const pm of res.plan) {
        have += pm.save; paid += pm.pay;
        const tm = months.find((m) => m.month === pm.month || (m.month < monthKey(today()) && pm.month === monthKey(today())));
        if (tm) tm.left = have - paid;
      }
      delete res.shortfall;
    }
    res.neededMonthly = Math.max(0, need);
    res.shortNow = shortNow;
    res.lastPayment = months[months.length - 1].month;
    res.nextPayment = months.find((m) => m.month >= thisMonth) || null;
    res.onTrack = !res.shortfall;
  }
  res.monthlyNow = projectMonthly(p, res);
  return res;
}

function renderProjects() {
  const el = $('#plan-projects');
  if (!state.projects.length) {
    el.innerHTML = `<div class="empty">No savings projects yet.<br>Tap + to plan for a house, wedding, car, holiday…<br>List what it will cost and see how long it takes to save up.</div>`;
    return;
  }
  const committed = state.projects.map((p) => projectPlan(p)).filter((r) => !r.done).reduce((s, r) => s + r.monthlyNow, 0);
  const spare = forecastSpare();
  let html = `<div class="tiles">
    <div class="tile"><div class="label">Saving for projects</div><div class="value">${money(committed)}</div><div class="label">this month in total</div></div>
    <div class="tile"><div class="label">Forecast left over</div><div class="value ${spare < 0 ? 'neg' : ''}">${spare == null ? '–' : money(spare)}</div><div class="label">per month on average</div></div>
  </div>`;
  if (spare != null && committed > spare) {
    html += `<p class="status bad small">⚠️ You plan to save ${money(committed)} a month, but your forecast only leaves about ${money(Math.max(0, spare))} a month.</p>`;
  }
  html += `<div class="list">` + state.projects.map((p) => {
    const r = projectPlan(p);
    let sub;
    if (r.done) sub = '🎉 Fully saved';
    else if (r.hasSchedule) {
      sub = r.nextPayment ? `Next: ${money(r.nextPayment.pay)} in ${monthLabel(r.nextPayment.month)}` : `Payments ended ${monthLabel(r.lastPayment)}`;
      if (r.plan) {
        const nextSave = r.plan.find((m) => m.save > 0);
        sub += nextSave ? ` · save ${money(nextSave.save)}${nextSave.month === monthKey(today()) ? ' this month' : ` in ${monthLabel(nextSave.month)}`}` : ' · nothing more to save';
      } else sub += !p.monthly ? ` · needs ${money(r.neededMonthly)}/mo` : r.onTrack ? ' · ✅ on track' : ` · ⚠️ ${money(-r.shortfall.left)} short by ${monthLabel(r.shortfall.month)}`;
    } else if (r.months) sub = `${r.months} month${r.months > 1 ? 's' : ''} to go · ready ${monthLabel(r.reachBy)}`;
    else sub = 'Set a monthly saving amount to see how long it takes';
    return `<button class="item block" data-proj="${p.id}">
      <div class="row"><div class="title">${esc(p.name)}</div><div class="amt">${money(r.saved)} <span class="muted small">/ ${money(r.target)}</span></div></div>
      <div class="progress"><div style="width:${r.pct * 100}%"></div></div>
      <div class="sub" style="margin-top:6px">${sub}</div></button>`;
  }).join('') + `</div>`;
  el.innerHTML = html;
  el.querySelectorAll('[data-proj]').forEach((b) => b.addEventListener('click', () => projectDetail(b.dataset.proj)));
}

// Average monthly amount left over in the forecast (null if there is nothing to forecast).
function forecastSpare() {
  if (!state.transactions.some(isDayToDay) && !state.recurring.length) return null;
  const f = forecast();
  return Math.round(f.future.reduce((s, r) => s + r.net, 0) / 12);
}

function projectDetail(id) {
  const p = state.projects.find((x) => x.id === id);
  if (!p) return;
  const r = projectPlan(p);
  const spare = forecastSpare();
  const otherMonthly = state.projects.filter((x) => x.id !== p.id).map((x) => projectPlan(x)).filter((x) => !x.done).reduce((s, x) => s + x.monthlyNow, 0);
  const line = (k, v, cls = '') => `<div class="kv ${cls}"><span class="k">${k}</span><span class="v">${v}</span></div>`;
  let timeline = '';
  if (r.done) timeline = r.stillToPay === 0 && r.spent
    ? `<p class="status good">🎉 Everything for this project is paid — ${money(r.spent)} in total${r.spent !== r.target ? ` (${money(Math.abs(r.target - r.spent))} ${r.spent < r.target ? 'under' : 'over'} the plan)` : ''}.</p>`
    : `<p class="status good">🎉 You have saved enough for this project.</p>`;
  else if (r.hasSchedule) {
    // Costs with dates and/or instalments: check every payment can be made on time.
    timeline += r.shortNow
      ? `<p class="status bad">⚠️ Some payments are due this month and you haven't saved enough for them yet.</p>` : '';
    if (r.plan) {
      timeline += `<p>💡 Save ${planSummary(r.plan)}. <span class="muted small">${planModeOf(p) === 'spread'
        ? 'Spread out ahead of each big payment.' : 'Saved as each payment comes due.'} This updates by itself when you change the costs or what you've saved.</span></p>`;
    } else {
    timeline += `<p>To make every payment on time, save at least <strong>${money(r.neededMonthly)}</strong> a month.`;
    timeline += !p.monthly ? ` <span class="muted">Add your monthly saving amount (Edit) to check your plan.</span></p>`
      : r.onTrack ? ` Saving ${money(p.monthly)} a month, <span class="status good">✅ you're on track</span>.</p>`
        : ` Saving ${money(p.monthly)} a month, <span class="status bad">⚠️ you'll be ${money(-r.shortfall.left)} short in ${monthLabel(r.shortfall.month, true)}</span>.</p>`;
    }
    if (r.plan) {
      let have = r.saved, paid = 0;
      timeline += `<div class="card-inset"><strong>Month by month</strong>
        <div class="grid4 head"><span>Month</span><span>Save</span><span>Pay</span><span>Saved after</span></div>
        ${r.plan.map((m) => { have += m.save; paid += m.pay; const parts = (r.timeline.find((t) => t.month === m.month) || { parts: [] }).parts;
          return `<div class="grid4"><span>${monthLabel(m.month)}${parts.length ? `<br><span class="muted small">${parts.map((x) => esc(x.item.name) + (x.n > 1 ? ` ${x.k + 1}/${x.n}` : '')).join(', ')}</span>` : ''}</span>
          <span>${money(m.save)}</span><span>${m.pay ? money(m.pay) : '–'}</span><span>${money(have - paid)}</span></div>`; }).join('')}
        <p class="muted small" style="margin:6px 0 0">Starts from the ${money(r.saved)} you've saved.${r.undated ? ` ${money(r.undated)} of costs have no month and aren't included.` : ''}</p></div>`;
    } else
    timeline += `<div class="card-inset"><strong>Payment timeline</strong>
      <div class="grid3 head"><span>Month</span><span>Pay</span><span>Savings left</span></div>
      ${r.timeline.map((m) => `<div class="grid3"><span>${monthLabel(m.month)}<br><span class="muted small">${m.parts.map((x) => esc(x.item.name) + (x.n > 1 ? ` ${x.k + 1}/${x.n}` : '')).join(', ')}</span></span>
        <span>${money(m.pay)}</span><span class="${m.left < 0 ? 'neg' : ''}">${p.monthly || m.k === 0 ? money(m.left) : '–'}</span></div>`).join('')}
      <p class="muted small" style="margin:6px 0 0">"Savings left" is what you've saved by then (${money(r.saved)} now + ${money(p.monthly || 0)} a month) minus the payments so far.${r.undated ? ` ${money(r.undated)} of costs have no month and aren't in this timeline.` : ''}</p></div>`;
  } else {
    timeline += r.months
      ? `<p>Saving <strong>${money(p.monthly)}</strong> a month, you'll have enough in <strong>${r.months} month${r.months > 1 ? 's' : ''}</strong> — around <strong>${monthLabel(r.reachBy, true)}</strong>.</p>`
      : `<p class="muted">Add a monthly saving amount (Edit) to see how long it will take.</p>`;
    if (p.targetDate) {
      timeline += r.monthsToTarget > 0
        ? `<p>To be ready by <strong>${monthLabel(monthKey(p.targetDate), true)}</strong> you need <strong>${money(r.needed)}</strong> a month. `
          + (r.onTrack ? `<span class="status good">✅ On track</span></p>` : `<span class="status bad">⚠️ Not on track${p.monthly ? ` — ${money(r.needed - p.monthly)} a month short` : ''}</span></p>`)
        : `<p class="status bad">⚠️ The target date has arrived and ${money(r.remaining)} is still missing.</p>`;
    }
  }
  if (!r.done) {
    if (spare != null) {
      const free = spare - otherMonthly;
      timeline += free > 0
        ? `<p class="muted small">Your forecast leaves about ${money(spare)} a month${otherMonthly ? `, ${money(otherMonthly)} of it already set aside for other projects` : ''}. If you put all ${money(free)} a month into this project, it would take ${Math.ceil(r.remaining / free)} month(s).</p>`
        : `<p class="muted small">Your forecast doesn't leave money spare each month${otherMonthly ? ' after your other projects' : ''} — you may need to cut spending to save for this.</p>`;
    }
  }
  openSheet(p.name, `
    <div class="form">
      <div class="card-inset">
        ${line('Total planned', money(r.target), 'total')}
        ${r.spent ? line('Paid so far', money(r.spent)) + line('Still to pay', money(r.stillToPay)) : ''}
        ${line(p.savedMode === 'account' ? `Saved (balance of ${esc(accountName(p.accountId))})` : 'Saved so far', money(r.saved))}
        ${line('Still to save', money(r.remaining), 'total')}
        <div class="progress"><div style="width:${r.pct * 100}%"></div></div>
      </div>
      ${timeline}
      <div class="card-inset">
        <strong>Costs</strong>
        ${p.items.map((i) => costBlock(p, i)).join('') || '<p class="muted small">No costs listed.</p>'}
      </div>
      <button class="btn full" id="pjEdit">Edit project</button>
      <button class="btn danger full" id="pjDel">Delete project</button>
    </div>`);
  $('#pjEdit').addEventListener('click', () => projectSheet(p.id));
  bindCostBlocks(p);
  $('#pjDel').addEventListener('click', async () => {
    if (!confirm(`Delete the project “${p.name}”?`)) return;
    state.projects = state.projects.filter((x) => x.id !== p.id);
    await save(); closeSheet(); render(); toast('Project deleted');
  });
}

const PROJECT_IDEAS = {
  House: ['Down payment', 'Stamp duty & legal fees', 'Renovation', 'Furniture & appliances'],
  Wedding: ['Banquet', 'Photography', 'Attire', 'Rings', 'Honeymoon'],
  Car: ['Down payment', 'Insurance', 'Road tax'],
  Holiday: ['Flights', 'Accommodation', 'Spending money']
};

function projectSheet(id) {
  const p = state.projects.find((x) => x.id === id);
  const items = p ? p.items.map((i) => ({ due: '', instalments: 0, ...i })) : [{ name: '', amount: 0, due: '', instalments: 0 }];
  openSheet(p ? 'Edit project' : 'New savings project', `
    <form class="form" id="projForm">
      <label>Project name
        <input id="pjName" required maxlength="40" placeholder="e.g. House, Wedding" value="${esc(p ? p.name : '')}">
      </label>
      ${p ? '' : `<div class="muted small">Quick start: ${Object.keys(PROJECT_IDEAS).map((k) => `<button type="button" class="btn secondary" style="padding:6px 10px;margin:4px 4px 0 0" data-idea="${k}">${k}</button>`).join('')}</div>`}
      <div class="card-inset form" style="gap:8px">
        <strong>Expected costs</strong>
        <div id="pjItems" class="form" style="gap:6px"></div>
        <button type="button" class="btn secondary" id="pjAddItem">+ Add a cost</button>
        <div class="kv total"><span class="k">Total</span><span class="v" id="pjTotal"></span></div>
      </div>
      <label>How do you track what's saved?
        <select id="pjMode">
          <option value="manual">I'll type the amount saved</option>
          ${bankAccounts().length ? '<option value="account">Use the balance of an account</option>' : ''}
        </select>
      </label>
      <label id="pjSavedWrap">Saved so far
        <input id="pjSaved" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0.00" value="${p && p.saved ? (p.saved / 100).toFixed(2) : ''}">
      </label>
      <label id="pjAccWrap">Account
        <select id="pjAcc">${bankAccounts().map((a) => `<option value="${a.id}">${esc(a.name)} (${money(balance(a.id))})</option>`).join('')}</select>
      </label>
      <label>How much to save each month
        <select id="pjPlanMode">
          <option value="due">Work it out: as payments are due</option>
          <option value="spread">Work it out: spread out evenly</option>
          <option value="fixed">A fixed amount I choose</option>
        </select>
      </label>
      <label id="pjMonthlyWrap">Amount each month
        <input id="pjMonthly" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0.00" value="${p && p.monthly ? (p.monthly / 100).toFixed(2) : ''}">
      </label>
      <div id="pjPlanPreview" class="card-inset small"></div>
      <label>Target date (optional)
        <span class="with-clear"><input id="pjTarget" type="date" value="${p && p.targetDate ? p.targetDate : ''}">
        <button type="button" class="clear-btn" data-clear="#pjTarget" aria-label="Clear the target date">Clear</button></span>
      </label>
      <p class="muted small" style="margin:-6px 0 0">Costs without their own month are needed by the target date.</p>
      <button class="btn full" type="submit">Save</button>
    </form>`);
  $('#pjMode').value = p && p.savedMode === 'account' && bankAccounts().length ? 'account' : 'manual';
  if (p && p.accountId && state.accounts.some((a) => a.id === p.accountId)) $('#pjAcc').value = p.accountId;
  const modeUI = () => {
    const acc = $('#pjMode').value === 'account';
    $('#pjSavedWrap').classList.toggle('hidden', acc);
    $('#pjAccWrap').classList.toggle('hidden', !acc);
  };
  $('#pjMode').addEventListener('change', modeUI);
  document.querySelectorAll('#projForm [data-clear]').forEach((b) => b.addEventListener('click', () => {
    const inp = $(b.dataset.clear); inp.value = '';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  }));
  modeUI();
  $('#pjPlanMode').value = p ? planModeOf(p) : 'due';
  // Live preview of the saving plan from what's in the form.
  function planPreview() {
    const mode = $('#pjPlanMode').value;
    $('#pjMonthlyWrap').classList.toggle('hidden', mode !== 'fixed');
    const box = $('#pjPlanPreview');
    box.classList.toggle('hidden', mode === 'fixed');
    if (mode === 'fixed') return;
    const draft = { items: items.filter((i) => i.amount > 0), targetDate: $('#pjTarget').value, planMode: mode, savedMode: $('#pjMode').value,
      saved: toCents($('#pjSaved').value || '0') || 0, accountId: $('#pjAcc').value };
    const r = projectPlan(draft);
    const noMonth = r.undated ? ` <span class="status bad">${money(r.undated)} of costs have no month yet, so they aren't included — set “Needed in” for them or a target date.</span>` : '';
    box.innerHTML = r.done ? 'You already have enough saved.' : r.plan ? `💡 Save ${planSummary(r.plan)}.${noMonth}`
      : 'Add the month each cost is needed (or a target date) and the amounts to save will be worked out.';
  }
  $('#projForm').addEventListener('input', planPreview);
  $('#projForm').addEventListener('change', planPreview);
  planPreview();

  function drawItems() {
    $('#pjItems').innerHTML = items.map((i, n) => `<div class="cost-item">
      <div class="cost-row">
        <input data-in="${n}" maxlength="40" placeholder="e.g. Sofa" value="${esc(i.name)}" aria-label="Cost name">
        <input data-ia="${n}" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0.00" value="${i.amount ? (i.amount / 100).toFixed(2) : ''}" aria-label="Amount">
        <button type="button" class="icon-btn" data-ix="${n}" aria-label="Remove cost">✕</button></div>
      <div class="cost-when">
        <label>${i.instalments > 1 ? 'First payment' : 'Needed in'}<span class="with-clear"><input type="month" data-idue="${n}" value="${i.due || ''}">
          <button type="button" class="clear-btn" data-clear-due="${n}" aria-label="Clear the month">✕</button></span></label>
        <label>How it's paid<select data-ipay="${n}"><option value="once">Once</option><option value="inst">Instalments</option></select></label>
      </div>
      <label class="cost-count ${i.instalments > 1 ? '' : 'hidden'}">Number of monthly payments
        <input type="number" inputmode="numeric" min="2" step="1" data-icount="${n}" value="${i.instalments > 1 ? i.instalments : ''}" placeholder="e.g. 12"></label>
      <div class="muted small" data-isum="${n}">${i.amount ? costText(i, { targetDate: $('#pjTarget').value }) : ''}</div>
    </div>`).join('');
    const sum = (n) => { const el = $(`[data-isum="${n}"]`); el.textContent = items[n].amount ? costText(items[n], { targetDate: $('#pjTarget').value }) : ''; };
    $('#pjItems').querySelectorAll('[data-in]').forEach((x) => x.addEventListener('input', () => { items[+x.dataset.in].name = x.value; }));
    $('#pjItems').querySelectorAll('[data-ia]').forEach((x) => x.addEventListener('input', () => {
      const v = toCents(x.value); items[+x.dataset.ia].amount = isNaN(v) ? 0 : v; total(); sum(+x.dataset.ia);
    }));
    $('#pjItems').querySelectorAll('[data-idue]').forEach((x) => x.addEventListener('input', () => { items[+x.dataset.idue].due = x.value; sum(+x.dataset.idue); }));
    $('#pjItems').querySelectorAll('[data-clear-due]').forEach((x) => x.addEventListener('click', () => {
      const n = +x.dataset.clearDue; items[n].due = ''; $(`[data-idue="${n}"]`).value = ''; sum(n);
      $('#projForm').dispatchEvent(new Event('input'));
    }));
    $('#pjItems').querySelectorAll('[data-ipay]').forEach((x) => {
      const n = +x.dataset.ipay;
      x.value = items[n].instalments > 1 ? 'inst' : 'once';
      x.addEventListener('change', () => { items[n].instalments = x.value === 'inst' ? (items[n].instalments > 1 ? items[n].instalments : 12) : 0; drawItems(); });
    });
    $('#pjItems').querySelectorAll('[data-icount]').forEach((x) => x.addEventListener('input', () => {
      const v = parseInt(x.value, 10); items[+x.dataset.icount].instalments = v > 1 ? v : 1; sum(+x.dataset.icount);
    }));
    $('#pjItems').querySelectorAll('[data-ix]').forEach((x) => x.addEventListener('click', () => { items.splice(+x.dataset.ix, 1); drawItems(); }));
    total();
  }
  const total = () => { $('#pjTotal').textContent = money(items.reduce((s, i) => s + (i.amount || 0), 0)); };
  drawItems();
  $('#pjAddItem').addEventListener('click', () => { items.push({ name: '', amount: 0, due: '', instalments: 0 }); drawItems(); });
  $('#pjTarget').addEventListener('input', () => items.forEach((i, n) => { const el = $(`[data-isum="${n}"]`); if (el) el.textContent = i.amount ? costText(i, { targetDate: $('#pjTarget').value }) : ''; }));
  document.querySelectorAll('[data-idea]').forEach((b) => b.addEventListener('click', () => {
    if (!$('#pjName').value) $('#pjName').value = b.dataset.idea;
    items.splice(0, items.length, ...PROJECT_IDEAS[b.dataset.idea].map((name) => ({ name, amount: 0, due: '', instalments: 0 })));
    drawItems();
  }));

  $('#projForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#pjName').value.trim();
    if (!name) return toast('Give the project a name');
    const clean = items.filter((i) => i.name.trim() || i.amount > 0).map((i) => ({
      id: i.id || uid(), options: i.options || [], done: !!i.done,
      name: i.name.trim() || 'Cost', amount: i.amount || 0, due: i.due || '', instalments: i.instalments > 1 ? i.instalments : 0 }));
    if (!clean.some((i) => i.amount > 0)) return toast('Add at least one cost with an amount');
    const badInst = items.find((i) => i.instalments === 1 && (i.name.trim() || i.amount > 0)); // instalments picked, count < 2
    if (badInst) return toast(`Enter at least 2 monthly payments for “${badInst.name.trim() || 'Cost'}”`);
    const noStart = clean.find((i) => i.instalments > 1 && !i.due && !$('#pjTarget').value);
    if (noStart) return toast(`Pick the month of the first payment for “${noStart.name}”`);
    const saved = toCents($('#pjSaved').value || '0');
    const monthly = toCents($('#pjMonthly').value || '0');
    const data = {
      name, items: clean,
      savedMode: $('#pjMode').value, saved: isNaN(saved) ? 0 : saved,
      accountId: $('#pjMode').value === 'account' ? $('#pjAcc').value : '',
      monthly: isNaN(monthly) ? 0 : monthly,
      planMode: $('#pjPlanMode').value,
      targetDate: $('#pjTarget').value || ''
    };
    let id2 = p && p.id;
    if (p) Object.assign(p, data);
    else { id2 = uid(); state.projects.push({ id: id2, createdAt: Date.now(), ...data }); }
    await save();
    render();
    projectDetail(id2);
    toast('Project saved');
  });
}

/* ---------- Trips ----------
   state.trips: {id, country, name, start, end, budget, note}. Expenses link to a trip with tripId (set in the
   transaction form; entries dated during a trip are linked automatically). Past trips give a per-day spend and
   an amount booked ahead (flights, hotels: linked spending dated before the trip), per country. Those are the
   baseline for estimating future trips, which the forecast then includes on the trip's days. */
const tripTitle = (x) => (x.name ? `${x.name} (${x.country})` : x.country);
function tripTag(t) {
  if (!t.tripId) return '';
  const x = (state.trips || []).find((y) => y.id === t.tripId);
  return x ? `✈️ ${esc(x.country)} · ` : '';
}
const tripDays = (x) => daysBetween(x.start, x.end) + 1;
const signedSpend = (t) => (t.type === 'expense' ? t.amount : t.refund ? -t.amount : 0);
const tripTxs = (x) => state.transactions.filter((t) => t.tripId === x.id && (t.type === 'expense' || t.refund));

// What a trip cost: during it (per day), and booked before or settled after it.
function tripActuals(x) {
  let paidDuring = 0, ahead = 0, back = 0;
  const cats = {};
  for (const t of tripTxs(x)) {
    if (t.refund) back += t.amount;
    else if (t.date >= x.start && t.date <= x.end) paidDuring += t.amount;
    else ahead += t.amount;
    cats[t.category] = (cats[t.category] || 0) + signedSpend(t);
  }
  // Your share during the trip = what you paid during it − money back from others (never below zero).
  const during = Math.max(0, paidDuring - back);
  const backLeft = Math.max(0, back - paidDuring); // more back than spent during: take the rest off what was booked ahead
  const aheadNet = Math.max(0, ahead - backLeft);
  return { paid: paidDuring + ahead, back, paidDuring, during, ahead: aheadNet, total: during + aheadNet, perDay: during / tripDays(x), cats };
}
const tripStatus = (x) => (x.end < today() ? 'past' : x.start > today() ? 'upcoming' : 'now');
const pastTrips = () => (state.trips || []).filter((x) => tripStatus(x) === 'past' && tripActuals(x).total > 0);

// Baseline from past trips: same country if you've been before, otherwise all past trips.
function tripBaseline(country) {
  const all = pastTrips();
  const same = all.filter((x) => x.country.trim().toLowerCase() === (country || '').trim().toLowerCase());
  const use = same.length ? same : all;
  if (!use.length) return null;
  const days = use.reduce((s, x) => s + tripDays(x), 0);
  const during = use.reduce((s, x) => s + tripActuals(x).during, 0);
  const ahead = use.reduce((s, x) => s + tripActuals(x).ahead, 0) / use.length;
  return { perDay: during / days, ahead, count: use.length, sameCountry: !!same.length };
}
function tripEstimate(x) {
  const b = tripBaseline(x.country);
  return b ? Math.round(b.ahead + b.perDay * tripDays(x)) : 0;
}
const tripBudget = (x) => x.budget || tripEstimate(x);

// Linked spending between two dates, per trip: [{trip, amount}].
function tripSpendBetween(from, to) {
  const out = [];
  for (const x of state.trips || []) {
    const amount = tripTxs(x).filter((t) => t.date >= from && t.date <= to).reduce((s, t) => s + signedSpend(t), 0);
    if (amount) out.push({ trip: x, amount });
  }
  return out;
}
// Expected trip spending between two future dates: planned (future-dated) linked entries, plus whatever is left of
// the budget spread evenly over the trip's remaining days.
function tripsBetween(from, to) {
  const t = today();
  const out = [];
  for (const x of state.trips || []) {
    if (x.end <= t) continue;
    const linked = tripTxs(x).reduce((s, y) => s + signedSpend(y), 0);
    let amount = tripTxs(x).filter((y) => y.date > t && y.date >= from && y.date <= to).reduce((s, y) => s + signedSpend(y), 0);
    const left = Math.max(0, tripBudget(x) - linked);
    const spreadFrom = [x.start, addDaysISO(t, 1)].sort()[1];
    const lo = [from, spreadFrom].sort()[1], hi = [to, x.end].sort()[0];
    if (left && lo <= hi) amount += left * (daysBetween(lo, hi) + 1) / (daysBetween(spreadFrom, x.end) + 1);
    if (amount) out.push({ trip: x, amount: Math.round(amount) });
  }
  return out;
}
function mergeTripLists(a, b) {
  const m = new Map();
  for (const x of [...a, ...b]) m.set(x.trip.id, { trip: x.trip, amount: (m.get(x.trip.id) || { amount: 0 }).amount + x.amount });
  return [...m.values()];
}

function renderTrips() {
  const el = $('#plan-trips');
  const trips = [...(state.trips || [])];
  if (!trips.length) {
    el.innerHTML = `<div class="empty">No trips yet.<br>Tap + to add a trip — past ones (to see what they cost) or future plans (to budget for them).<br>Spending you log during a trip is linked to it automatically.</div>`;
    return;
  }
  const upcoming = trips.filter((x) => tripStatus(x) !== 'past').sort((a, b) => a.start.localeCompare(b.start));
  const past = trips.filter((x) => tripStatus(x) === 'past').sort((a, b) => b.start.localeCompare(a.start));
  const yearAhead = addMonthsISO(today(), 12);
  const upcomingBudget = upcoming.filter((x) => x.start <= yearAhead).reduce((s, x) => s + tripBudget(x), 0);
  const all = tripBaseline('');
  let html = `<div class="tiles">
    <div class="tile"><div class="label">Upcoming trips, next 12 months</div><div class="value">${money(upcomingBudget)}</div><div class="label">budgeted / estimated</div></div>
    <div class="tile"><div class="label">Past trips cost</div><div class="value">${all ? money(all.perDay) : '–'}</div><div class="label">a day on average${all ? ` + ${money(all.ahead)} booked ahead` : ''}</div></div>
  </div>`;
  const row = (x) => {
    const a = tripActuals(x);
    const st = tripStatus(x);
    let sub;
    if (st === 'past') sub = a.total ? `your share ${money(a.total)} · ${money(a.perDay)}/day${a.back ? ` (after ${money(a.back)} back)` : ''}` : 'no spending linked yet';
    else {
      const b = tripBudget(x);
      sub = `${st === 'now' ? '🟢 on now · ' : ''}${x.budget ? 'budget' : b ? 'estimate' : 'no estimate yet'}${b ? ' ' + money(b) : ''}${a.total ? ` · ${money(a.total)} spent so far` : ''}`;
    }
    return `<button class="item" data-trip="${x.id}">
      <div class="left"><div class="title">✈️ ${esc(tripTitle(x))}</div>
      <div class="sub">${shortDate(x.start)} – ${shortDate(x.end)} ${parseISO(x.end).y} · ${tripDays(x)} day${tripDays(x) > 1 ? 's' : ''} · ${sub}</div></div></button>`;
  };
  if (upcoming.length) html += `<h2 class="section-title">Upcoming</h2><div class="list">${upcoming.map(row).join('')}</div>`;
  if (past.length) html += `<h2 class="section-title">Past</h2><div class="list">${past.map(row).join('')}</div>`;

  // Travel budgets by country, from past trips.
  const byCountry = {};
  for (const x of pastTrips()) (byCountry[x.country.trim()] ||= []).push(x);
  const countries = Object.keys(byCountry).sort();
  if (countries.length) {
    html += `<h2 class="section-title">Travel budgets from past trips</h2><div class="card">
      <div class="grid3 head"><span>Country</span><span>Per day</span><span>Booked ahead</span></div>
      ${countries.map((c) => { const b = tripBaseline(c); return `<div class="grid3"><span>${esc(c)}<br><span class="muted small">${b.count} trip${b.count > 1 ? 's' : ''}</span></span><span>${money(b.perDay)}</span><span>${money(b.ahead)}</span></div>`; }).join('')}
      <p class="muted small" style="margin:6px 0 0">"Per day" is spending dated during the trip, divided by its days. "Booked ahead" is spending linked to the trip but dated before or after it (flights, hotels), averaged per trip. New trips to the same country are estimated from these; other countries use the average of all trips.</p>
    </div>`;
  }
  el.innerHTML = html;
  el.querySelectorAll('[data-trip]').forEach((b) => b.addEventListener('click', () => tripDetail(b.dataset.trip)));
}

function tripDetail(id) {
  const x = state.trips.find((y) => y.id === id);
  if (!x) return;
  const a = tripActuals(x);
  const st = tripStatus(x);
  const b = tripBaseline(x.country);
  const est = tripEstimate(x);
  const line = (k, v, cls = '') => `<div class="kv ${cls}"><span class="k">${k}</span><span class="v">${v}</span></div>`;
  const txs = tripTxs(x).sort((p, q) => p.date.localeCompare(q.date));
  let plan = '';
  if (st !== 'past') {
    plan = `<div class="card-inset">
      ${x.budget ? line('Your budget', money(x.budget), 'total') : ''}
      ${est ? line(`Estimate from ${b.sameCountry ? `${b.count} past trip${b.count > 1 ? 's' : ''} to ${esc(x.country)}` : `your ${b.count} past trip${b.count > 1 ? 's' : ''} (no trips to ${esc(x.country)} yet)`}`, money(est), x.budget ? '' : 'total') : ''}
      ${est ? `<p class="muted small" style="margin:4px 0 0">${money(b.ahead)} booked ahead + ${money(b.perDay)} a day × ${tripDays(x)} days.</p>` : '<p class="muted small" style="margin:0">No past trips with spending yet — set a budget (Edit) so the forecast can include this trip.</p>'}
      ${a.total ? line('Spent so far', money(a.total)) + line('Left of the ' + (x.budget ? 'budget' : 'estimate'), money(Math.max(0, tripBudget(x) - a.total))) : ''}
      <p class="muted small" style="margin:6px 0 0">The forecast includes what's left, spread over the trip's days.</p>
    </div>`;
  }
  openSheet(`✈️ ${tripTitle(x)}`, `
    <div class="form">
      <div class="muted small">${niceDate(x.start)} – ${niceDate(x.end)} · ${tripDays(x)} day${tripDays(x) > 1 ? 's' : ''}${x.note ? ' · ' + esc(x.note) : ''}</div>
      ${plan}
      ${a.total ? `<div class="card-inset">
        ${a.back ? line('You paid', money(a.paid)) + line('Money back from others', `<span class="pos">−${money(a.back)}</span>`) : ''}
        ${line(a.back ? 'Your share' : 'Spent', money(a.total), 'total')}
        ${line('During the trip', `${money(a.during)} <span class="muted small">(${money(a.perDay)}/day)</span>`)}
        ${line('Booked ahead', money(a.ahead))}
        ${a.back ? '<p class="muted small" style="margin:4px 0 0">Money back is taken off the spending during the trip, so the per-day figure (used to estimate future trips) is your own share.</p>' : ''}
        <strong class="small" style="display:block;margin-top:8px">By category${a.back ? ' (after money back)' : ''}</strong>
        ${Object.entries(a.cats).sort((p, q) => q[1] - p[1]).map(([c, v]) => line(esc(c), money(v))).join('')}
      </div>` : ''}
      <div class="btn-row">
        <button class="btn" id="trAdd">+ Spending</button>
        <button class="btn secondary" id="trBack">+ Money back</button>
      </div>
      ${txs.length ? `<div class="list" style="margin:0">${txs.map((t) => `<button class="item" data-ttx="${t.id}">
        <div class="left"><div class="title">${esc(t.category)}${t.refund ? '<span class="tag">money back</span>' : ''}</div>
        <div class="sub">${niceDate(t.date)}${t.note ? ' · ' + esc(t.note) : ''}</div></div>
        <div class="amt ${t.refund ? 'pos' : 'neg'}">${money(-signedSpend(t), true)}</div></button>`).join('')}</div>` : '<p class="muted small">No spending linked yet. Entries you log with a date during the trip are linked automatically; flights and hotels booked earlier can be linked by picking the trip in the transaction form.</p>'}
      <button class="btn secondary full" id="trEdit">Edit trip</button>
      <button class="btn danger full" id="trDel">Delete trip</button>
    </div>`);
  $('#trBack').addEventListener('click', () => {
    if (!state.accounts.length) return toast('Create an account first');
    txSheet(null, { type: 'income', refund: true, tripId: x.id, date: today(), category: 'Food', note: `Money back for ${tripTitle(x)} trip` });
  });
  $('#trAdd').addEventListener('click', () => {
    if (!state.accounts.length) return toast('Create an account first');
    txSheet(null, { type: 'expense', tripId: x.id, date: st === 'upcoming' ? today() : [today(), x.end].sort()[0] });
  });
  document.querySelectorAll('[data-ttx]').forEach((el2) => el2.addEventListener('click', () => txSheet(el2.dataset.ttx)));
  $('#trEdit').addEventListener('click', () => tripSheet(x.id));
  $('#trDel').addEventListener('click', async () => {
    if (!confirm(`Delete the ${tripTitle(x)} trip? Its spending stays in History, just not linked to a trip.`)) return;
    state.trips = state.trips.filter((y) => y.id !== x.id);
    for (const t of state.transactions) if (t.tripId === x.id) delete t.tripId;
    await save(); closeSheet(); render(); toast('Trip deleted');
  });
}

function tripSheet(id) {
  const x = (state.trips || []).find((y) => y.id === id);
  const countries = [...new Set((state.trips || []).map((y) => y.country.trim()))].sort();
  openSheet(x ? 'Edit trip' : 'New trip', `
    <form class="form" id="tripForm">
      <label>Where (country)
        <input id="trCountry" required maxlength="40" list="trCountries" placeholder="e.g. Japan" value="${esc(x ? x.country : '')}">
        <datalist id="trCountries">${countries.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
      </label>
      <label>Name (optional)
        <input id="trName" maxlength="40" placeholder="e.g. Tokyo with friends" value="${esc(x ? x.name || '' : '')}">
      </label>
      <div class="controls" style="margin:0">
        <label>From<input id="trStart" type="date" required value="${x ? x.start : ''}"></label>
        <label>To<input id="trEnd" type="date" required value="${x ? x.end : ''}"></label>
      </div>
      <label>Budget (optional)
        <input id="trBudget" type="number" inputmode="decimal" step="0.01" min="0" placeholder="Leave empty to use the estimate" value="${x && x.budget ? (x.budget / 100).toFixed(2) : ''}">
      </label>
      <div id="trEst" class="card-inset small"></div>
      <label>Note (optional)
        <input id="trNote" maxlength="100" value="${esc(x ? x.note || '' : '')}">
      </label>
      <button class="btn full" type="submit">Save</button>
    </form>`);
  function est() {
    const f = { country: $('#trCountry').value, start: $('#trStart').value, end: $('#trEnd').value };
    const box = $('#trEst');
    if (!f.start || !f.end || f.end < f.start) { box.textContent = 'Pick the dates to see an estimate from your past trips.'; return; }
    const b = tripBaseline(f.country);
    if (!b) { box.textContent = `${tripDays(f)} days. No past trips with spending yet, so there's no estimate — add a budget, or log past trips to build one.`; return; }
    box.innerHTML = `${tripDays(f)} days · estimate <strong>${money(tripEstimate(f))}</strong>: ${money(b.ahead)} booked ahead + ${money(b.perDay)} a day, from ${b.sameCountry
      ? `${b.count} past trip${b.count > 1 ? 's' : ''} to ${esc(f.country)}` : `all ${b.count} past trip${b.count > 1 ? 's' : ''}`}.`;
  }
  $('#tripForm').addEventListener('input', est);
  est();
  $('#tripForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const country = $('#trCountry').value.trim();
    const start = $('#trStart').value, end = $('#trEnd').value;
    if (!country) return toast('Where are you going?');
    if (!start || !end) return toast('Pick the dates');
    if (end < start) return toast('The trip ends before it starts');
    const budget = toCents($('#trBudget').value || '0');
    const data = { country, name: $('#trName').value.trim(), start, end, budget: isNaN(budget) ? 0 : budget, note: $('#trNote').value.trim() };
    let tid = x && x.id;
    if (x) Object.assign(x, data);
    else {
      tid = uid();
      state.trips.push({ id: tid, ...data });
      // Link spending already logged during these dates (not recurring payments or transfers).
      const during = state.transactions.filter((t) => !t.tripId && !t.recurringId && !t.transferId && t.category !== 'Transfer'
        && (t.type === 'expense' || t.refund) && t.date >= start && t.date <= end);
      if (during.length && confirm(`Link the ${during.length} expense(s) you've already logged between these dates to this trip?`)) {
        for (const t of during) t.tripId = tid;
      }
    }
    await save(); render();
    tripDetail(tid);
    toast('Trip saved');
  });
}

/* ---------- Project costs: what's been paid, and options (vendors / brands / links) ---------- */
// Only http(s) links are kept; "example.com/x" becomes "https://example.com/x".
function cleanUrl(u) {
  u = (u || '').trim();
  if (!u) return '';
  if (!/^[a-z]+:\/\//i.test(u)) u = 'https://' + u;
  try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch { return ''; }
}
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

function costBlock(p, i) {
  const pd = itemPaid(p, i);
  const n = itemPayments(i);
  const left = itemLeft(p, i);
  const status = i.done ? `<span class="status good">✅ Paid${pd.paid ? ` ${money(pd.paid)}` : ''}${pd.paid && pd.paid !== i.amount
      ? ` — ${money(Math.abs(i.amount - pd.paid))} ${pd.paid < i.amount ? 'under' : 'over'} plan` : ''}</span>`
    : pd.paid ? `Paid ${money(pd.paid)}${n > 1 ? ` (${Math.min(pd.count, n)} of ${n})` : ''} · ${money(left)} to go${pd.paid > i.amount ? ` · <span class="status bad">${money(pd.paid - i.amount)} over plan</span>` : ''}`
      : 'Not paid yet';
  const opts = i.options || [];
  return `<div class="cost-block">
    <div class="kv"><span class="k"><strong>${esc(i.name)}</strong><br><span class="muted small">${costText(i, p)}</span></span><span class="v">${money(i.amount)}</span></div>
    <div class="small" style="margin:2px 0 6px">${status}</div>
    ${opts.length ? `<div class="opts">${opts.map((o, k) => `<div class="opt">
        <button type="button" class="opt-main" data-opt="${i.id}:${k}"><strong>${esc(o.vendor || hostOf(o.url) || 'Option')}</strong>${o.price ? ` · ${money(o.price)}` : ''}
          ${o.note ? `<br><span class="muted small">${esc(o.note)}</span>` : ''}</button>
        ${o.url ? `<a class="open-link" href="${esc(o.url)}" target="_blank" rel="noopener noreferrer">Open ↗</a>` : ''}
      </div>`).join('')}</div>` : ''}
    <div class="cost-actions">
      <button type="button" class="mini-btn" data-addopt="${i.id}">+ Option / link</button>
      ${i.done ? `<button type="button" class="mini-btn" data-undone="${i.id}">Not fully paid</button>`
        : `<button type="button" class="mini-btn" data-pay="${i.id}">Log a payment</button>
           ${pd.paid ? `<button type="button" class="mini-btn" data-done="${i.id}">Mark fully paid</button>` : ''}`}
    </div>
    ${pd.txs.length ? `<div class="muted small">${pd.txs.sort((a, b) => a.date.localeCompare(b.date)).map((t) => `<button type="button" class="link-btn small" data-ptx="${t.id}">${shortDate(t.date)} ${money(t.refund ? -t.amount : t.amount)}</button>`).join(' · ')}</div>` : ''}
  </div>`;
}

function bindCostBlocks(p) {
  const item = (id) => p.items.find((i) => i.id === id);
  const redraw = async () => { await save(); render(); projectDetail(p.id); };
  document.querySelectorAll('[data-addopt]').forEach((b) => b.addEventListener('click', () => optionSheet(p, item(b.dataset.addopt))));
  document.querySelectorAll('[data-opt]').forEach((b) => b.addEventListener('click', () => {
    const [iid, k] = b.dataset.opt.split(':'); optionSheet(p, item(iid), +k);
  }));
  document.querySelectorAll('[data-pay]').forEach((b) => b.addEventListener('click', () => {
    if (!state.accounts.length) return toast('Create an account first');
    const i = item(b.dataset.pay);
    const n = itemPayments(i), pd = itemPaid(p, i);
    const amount = n > 1 ? Math.round(itemLeft(p, i) / Math.max(1, n - pd.count)) : itemLeft(p, i);
    txSheet(null, { type: 'expense', amount, projectId: p.id, projectItemId: i.id, note: `${p.name}: ${i.name}`, category: 'Shopping' });
  }));
  document.querySelectorAll('[data-done]').forEach((b) => b.addEventListener('click', async () => { item(b.dataset.done).done = true; await redraw(); }));
  document.querySelectorAll('[data-undone]').forEach((b) => b.addEventListener('click', async () => { item(b.dataset.undone).done = false; await redraw(); }));
  document.querySelectorAll('[data-ptx]').forEach((b) => b.addEventListener('click', () => txSheet(b.dataset.ptx)));
}

// Add or edit an option for a cost: vendor / brand, link, price, note.
function optionSheet(p, i, k) {
  const o = k != null ? i.options[k] : null;
  openSheet(o ? 'Option' : `Option for ${i.name}`, `
    <form class="form" id="optForm">
      <label>Vendor / brand
        <input id="opVendor" maxlength="60" placeholder="e.g. IKEA, Castlery" value="${esc(o ? o.vendor : '')}">
      </label>
      <label>Link to the product (optional)
        <input id="opUrl" type="text" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Paste the link, e.g. castlery.com/…" value="${esc(o ? o.url : '')}">
      </label>
      <label>Price (optional)
        <input id="opPrice" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0.00" value="${o && o.price ? (o.price / 100).toFixed(2) : ''}">
      </label>
      <label>Note (optional)
        <input id="opNote" maxlength="100" placeholder="e.g. 3-seater, grey, 12-month instalments" value="${esc(o ? o.note || '' : '')}">
      </label>
      <button class="btn full" type="submit">Save</button>
      ${o && o.url ? `<a class="btn secondary full" href="${esc(o.url)}" target="_blank" rel="noopener noreferrer">Open the link ↗</a>` : ''}
      ${o && o.price ? `<button type="button" class="btn secondary full" id="opUse">Use this price for ${esc(i.name)} (${money(o.price)})</button>` : ''}
      ${o ? '<button type="button" class="btn danger full" id="opDel">Delete option</button>' : ''}
      <button type="button" class="btn secondary full" id="opBack">Back to ${esc(p.name)}</button>
    </form>`);
  const back = () => projectDetail(p.id);
  $('#opBack').addEventListener('click', back);
  $('#optForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const rawUrl = $('#opUrl').value.trim();
    const url = cleanUrl(rawUrl);
    if (rawUrl && !url) return toast('That link doesn\'t look right — it should start with https://');
    const vendor = $('#opVendor').value.trim();
    if (!vendor && !url) return toast('Add a vendor / brand or a link');
    const price = toCents($('#opPrice').value || '0');
    const data = { vendor, url, price: isNaN(price) ? 0 : price, note: $('#opNote').value.trim() };
    if (!Array.isArray(i.options)) i.options = [];
    if (o) Object.assign(o, data); else i.options.push(data);
    await save(); render(); back(); toast('Option saved');
  });
  if (o && $('#opUse')) $('#opUse').addEventListener('click', async () => {
    i.amount = o.price; await save(); render(); back(); toast(`${i.name} now planned at ${money(o.price)}`);
  });
  if (o) $('#opDel').addEventListener('click', async () => {
    if (!confirm('Delete this option?')) return;
    i.options.splice(k, 1); await save(); render(); back();
  });
}
