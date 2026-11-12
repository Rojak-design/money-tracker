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
// All payment dates between from and to (inclusive, ISO strings).
function occurrences(r, from, to) {
  const out = [];
  for (let i = 0; i < 5000; i++) {
    if (r.endMode === 'count' && i >= r.count) break;
    const d = nthDate(r, i);
    if (d > to) break;
    if (r.endMode === 'date' && r.end && d > r.end) break;
    if (d >= from) out.push(d);
  }
  return out;
}
function lastPaymentDate(r) {
  if (r.endMode === 'count') return nthDate(r, r.count - 1);
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
  const total = r.endMode === 'count' ? r.count : (last ? occurrences(r, r.start, last).length : null);
  const left = total == null ? null : Math.max(0, total - made);
  const next = occurrences(r, addDaysISO(t, 1), last || addMonthsISO(t, 13))[0] || null;
  return { made, total, left, last, next, remainingAmt: left == null ? null : left * r.amount, finished: left === 0 };
}

let planTab = 'forecast';
document.querySelectorAll('#planTabs button').forEach((b) => b.addEventListener('click', () => {
  planTab = b.dataset.plan;
  renderPlan();
  updateFab();
}));

function renderPlan() {
  document.querySelectorAll('#planTabs button').forEach((b) => b.classList.toggle('on', b.dataset.plan === planTab));
  ['forecast', 'recurring', 'projects'].forEach((k) => $('#plan-' + k).classList.toggle('hidden', k !== planTab));
  if (currentView !== 'plan') return;
  if (planTab === 'forecast') renderForecast();
  else if (planTab === 'recurring') renderRecurring();
  else renderProjects();
}

function planFab() {
  if (planTab === 'projects') projectSheet();
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
    for (const d of occurrences(r, t, addDaysISO(t, 30))) soon.push({ r, d });
  }
  soon.sort((a, b) => a.d.localeCompare(b.d));

  const active = state.recurring.filter((r) => !recurringSummary(r).finished);
  const done = state.recurring.filter((r) => recurringSummary(r).finished);
  const perMonth = (type) => active.filter((r) => r.type === type).reduce((s, r) => s + monthlyEquivalent(r), 0);

  let html = `<div class="tiles">
    <div class="tile"><div class="label">Recurring spending</div><div class="value">${money(perMonth('expense'))}</div><div class="label">per month (approx.)</div></div>
    <div class="tile"><div class="label">Recurring income</div><div class="value">${money(perMonth('income'))}</div><div class="label">per month (approx.)</div></div>
  </div>`;
  if (soon.length) {
    html += `<h2 class="section-title">Due in the next 30 days</h2><div class="card">` +
      soon.map(({ r, d }) => `<div class="kv"><span class="k">${niceDate(d)} · ${esc(r.name)}</span>
        <span class="v ${r.type === 'income' ? 'pos' : ''}">${money(r.type === 'income' ? r.amount : -r.amount, true)}</span></div>`).join('') +
      `</div>`;
  }
  const item = (r) => {
    const s = recurringSummary(r);
    const bits = [];
    if (s.finished) bits.push(`finished ${niceDate(s.last)}`);
    else if (s.left != null) bits.push(`${s.left} of ${s.total} left · ends ${monthLabel(monthKey(s.last))}`);
    else bits.push(`${FREQS[r.freq].label.toLowerCase()} · ongoing`);
    return `<button class="item" data-recur="${r.id}">
      <div class="left"><div class="title">${esc(r.name)}</div><div class="sub">${bits.join(' · ')} · ${esc(r.category)}</div></div>
      <div class="amt ${r.type === 'income' ? 'pos' : ''}">${money(r.type === 'income' ? r.amount : -r.amount, true)}</div></button>`;
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
  openSheet(r ? 'Recurring payment' : 'New recurring payment', `
    <form class="form" id="recurForm">
      <div class="segmented">
        <button type="button" data-type="expense" class="expense">Spending</button>
        <button type="button" data-type="income" class="income">Income</button>
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
      <label>First payment date
        <input id="rcStart" type="date" required value="${r ? r.start : today()}">
      </label>
      <label>When does it end?
        <select id="rcEndMode">
          <option value="count">After a number of payments (instalments, loans)</option>
          <option value="date">On a date</option>
          <option value="never">No end date (subscriptions, rent, salary)</option>
        </select>
      </label>
      <label id="rcCountWrap">Total number of payments
        <input id="rcCount" type="number" inputmode="numeric" min="1" step="1" placeholder="e.g. 24" value="${r && r.count ? r.count : ''}">
      </label>
      <label id="rcEndWrap">Last payment on or before
        <input id="rcEnd" type="date" value="${r && r.end ? r.end : ''}">
      </label>
      ${catPickerHtml('rc')}
      <label>Paid from / into account or card (optional)
        <select id="rcAccount"><option value="">—</option>${accountOptions()}</select>
      </label>
      <label>Note (optional)
        <input id="rcNote" maxlength="100" value="${esc(r ? r.note : '')}">
      </label>
      <div id="rcPreview" class="card-inset small"></div>
      <button class="btn full" type="submit">Save</button>
      ${r ? `<button type="button" class="btn secondary full" id="rcLog">Log a payment now</button>
        <button type="button" class="btn danger full" id="rcDel">Delete</button>` : ''}
    </form>`);
  $('#rcFreq').value = r ? r.freq : 'monthly';
  $('#rcEndMode').value = endMode;
  $('#rcAccount').value = r && r.accountId ? r.accountId : '';

  function readForm() {
    return {
      type, name: $('#rcName').value.trim(), amount: toCents($('#rcAmount').value),
      freq: $('#rcFreq').value, start: $('#rcStart').value || today(),
      endMode, count: parseInt($('#rcCount').value, 10) || 0, end: $('#rcEnd').value || '',
      accountId: $('#rcAccount').value, note: $('#rcNote').value.trim()
    };
  }
  function preview() {
    $('#rcCountWrap').classList.toggle('hidden', endMode !== 'count');
    $('#rcEndWrap').classList.toggle('hidden', endMode !== 'date');
    const f = readForm();
    const box = $('#rcPreview');
    if (!(f.amount > 0)) { box.textContent = 'Fill in the amount to see a summary.'; return; }
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
    document.querySelectorAll('#recurForm .segmented button').forEach((b) => b.classList.toggle('on', b.dataset.type === type));
    setupCatPicker('rc', type, keepCat || (type === 'expense' ? 'Instalment' : 'Salary'));
  }
  document.querySelectorAll('#recurForm .segmented button').forEach((b) => b.addEventListener('click', () => setType(b.dataset.type)));
  setType(type, r && r.category);
  $('#rcEndMode').addEventListener('change', (e) => { endMode = e.target.value; preview(); });
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
    f.category = readCatPicker('rc', type);
    if (!f.category) return toast('Type a name for the new category');
    if (endMode !== 'count') f.count = 0;
    if (endMode !== 'date') f.end = '';
    if (r) Object.assign(r, f);
    else state.recurring.push({ id: uid(), ...f });
    await save();
    closeSheet(); render();
    toast('Recurring payment saved');
  });
  if (r) {
    $('#rcLog').addEventListener('click', () => {
      if (!state.accounts.length) return toast('Create an account first');
      txSheet(null, { type: r.type, amount: r.amount, category: r.category, accountId: r.accountId, recurringId: r.id, note: r.name });
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

/* ---------- Forecast ---------- */
// Day-to-day (non-recurring) history: everything except transfers and transactions linked to a recurring payment.
const isDayToDay = (t) => !t.recurringId && !t.transferId && t.category !== 'Transfer';

function forecast() {
  const lookback = state.settings.fcLookback || 6;
  const method = state.settings.fcMethod || 'trend';
  const t = today();
  const thisMonth = monthKey(t);
  const months = Array.from({ length: 12 }, (_, i) => addMonthsKey(thisMonth, i + 1));

  // History window: complete months only (not the current one).
  const txs = state.transactions.filter(isDayToDay);
  const firstMonth = txs.length ? txs.map((x) => monthKey(x.date)).sort()[0] : null;
  let histMonths = [];
  let partial = false;
  if (firstMonth) {
    const from = [addMonthsKey(thisMonth, -lookback), firstMonth].sort()[1];
    for (let k = from; k < thisMonth; k = addMonthsKey(k, 1)) histMonths.push(k);
    if (!histMonths.length) { histMonths = [thisMonth]; partial = true; }
  }
  // When only the current (unfinished) month is available, scale it up to a full month.
  const { y, m, d } = parseISO(t);
  const scale = partial ? daysInMonth(y, m) / d : 1;

  const n = histMonths.length;
  const idx = Object.fromEntries(histMonths.map((k, i) => [k, i]));
  const expSeries = {}; // category -> [cents per month]
  const cardTotals = {}; // category -> cents spent on credit cards in the window
  const incSeries = new Array(n).fill(0);
  for (const x of txs) {
    const i = idx[monthKey(x.date)];
    if (i === undefined) continue;
    if (x.type === 'income') incSeries[i] += x.amount;
    else {
      (expSeries[x.category] ||= new Array(n).fill(0))[i] += x.amount;
      if (isCard(x.accountId)) cardTotals[x.category] = (cardTotals[x.category] || 0) + x.amount;
    }
  }
  const hasCards = cardAccounts().length > 0;

  // Projection for one category: average, optionally tilted by a least-squares trend line.
  function project(series) {
    const s = series.map((v) => v * scale);
    const avg = s.reduce((a, b) => a + b, 0) / n;
    if (method !== 'trend' || n < 3) return { avg, at: () => avg, slope: 0 };
    const xm = (n - 1) / 2;
    let num = 0, den = 0;
    s.forEach((v, i) => { num += (i - xm) * (v - avg); den += (i - xm) ** 2; });
    const slope = den ? num / den : 0;
    // Future month j (0 = next month) sits at x = n + 1 + j (x = n is the current month).
    const at = (j) => Math.min(2 * avg, Math.max(0, avg + slope * (n + 1 + j - xm)));
    return { avg, at, slope };
  }
  const catProj = Object.entries(expSeries).map(([cat, series]) => ({
    cat, ...project(series),
    cardShare: (cardTotals[cat] || 0) / Math.max(1, series.reduce((a, b) => a + b, 0)) }))
    .filter((c) => c.avg > 0).sort((a, b) => b.avg - a.avg);
  const incAvg = n ? incSeries.reduce((a, b) => a + b, 0) * scale / n : 0;

  const rows = months.map((key, j) => {
    const from = key + '-01';
    const to = key + '-' + pad2(daysInMonth(...Object.values(parseISO(from)).slice(0, 2)));
    const rec = [];
    for (const r of state.recurring) {
      const count = occurrences(r, from, to).length;
      if (count) rec.push({ r, amount: r.amount * count, count });
    }
    const recExp = rec.filter((x) => x.r.type === 'expense').reduce((s, x) => s + x.amount, 0);
    const recInc = rec.filter((x) => x.r.type === 'income').reduce((s, x) => s + x.amount, 0);
    const cats = catProj.map((c) => ({ cat: c.cat, amount: Math.round(c.at(j)) }));
    const dayExp = cats.reduce((s, c) => s + c.amount, 0);
    const income = recInc + Math.round(incAvg);
    // Spending put on credit cards this month — paid from the bank next month.
    const cardSpend = rec.filter((x) => x.r.type === 'expense' && isCard(x.r.accountId)).reduce((s, x) => s + x.amount, 0) +
      Math.round(catProj.reduce((s, c, ci) => s + cats[ci].amount * c.cardShare, 0));
    return { key, rec, recExp, recInc, cats, dayExp, income, spend: recExp + dayExp, net: income - recExp - dayExp, cardSpend };
  });
  // Cash leaving the bank accounts: non-card spending this month + last month's card bill.
  // The first bill is what's owed on the cards today.
  const owedNow = cardAccounts().reduce((s, a) => s + Math.max(0, owed(a.id)), 0);
  rows.forEach((r, j) => {
    r.cardBill = j === 0 ? owedNow : rows[j - 1].cardSpend;
    r.cashOut = r.spend - r.cardSpend + r.cardBill;
  });
  return { rows, catProj, histMonths, partial, incAvg, n, method, lookback, hasCards, owedNow };
}

let fcSelected = 0;

function renderForecast() {
  const el = $('#plan-forecast');
  const f = forecast();
  const { rows } = f;
  if (!f.n && !state.recurring.length) {
    el.innerHTML = `<div class="empty">Nothing to forecast yet.<br>Log some spending (History) or add recurring payments, and your 12-month forecast will appear here.</div>`;
    return;
  }
  const total = rows.reduce((s, r) => s + r.spend, 0);
  const totalNet = rows.reduce((s, r) => s + r.net, 0);
  const max = Math.max(1, ...rows.map((r) => r.spend));
  const nice = niceMax(max);
  if (fcSelected >= rows.length) fcSelected = 0;

  const basis = !f.n ? 'No day-to-day spending logged yet — forecast uses recurring payments only.'
    : f.partial ? `Based on ${today().slice(8)} days of this month (scaled to a full month). It gets more accurate once you have a full month of data.`
      : `Based on ${f.n} month${f.n > 1 ? 's' : ''} of history (${monthLabel(f.histMonths[0])} – ${monthLabel(f.histMonths[f.n - 1])}).`;

  let html = `
    <div class="controls">
      <label>History to use
        <select id="fcLookback">${[3, 6, 12].map((v) => `<option value="${v}">Last ${v} months</option>`).join('')}</select></label>
      <label>Day-to-day spending
        <select id="fcMethod"><option value="trend">Follow the trend</option><option value="average">Use the average</option></select></label>
    </div>
    <div class="tiles">
      <div class="tile"><div class="label">Spending, next 12 months</div><div class="value">${money(total)}</div></div>
      <div class="tile"><div class="label">Average per month</div><div class="value">${money(total / 12)}</div></div>
      <div class="tile wide"><div class="label">Left over each month on average (income − spending)</div>
        <div class="value ${totalNet < 0 ? 'neg' : 'pos'}">${money(totalNet / 12, true)}</div></div>
    </div>
    <div class="card">
      <div class="legend"><span><i style="background:var(--series-1)"></i>Recurring</span><span><i style="background:var(--series-2)"></i>Day-to-day</span></div>
      <div class="chart" role="img" aria-label="Forecast spending per month for the next 12 months">
        <div class="gridline" style="bottom:100%"></div><span class="gridlabel" style="bottom:100%">${shortMoney(nice)}</span>
        <div class="gridline" style="bottom:50%"></div><span class="gridlabel" style="bottom:50%">${shortMoney(nice / 2)}</span>
        <div class="gridline" style="bottom:0"></div><span class="gridlabel" style="bottom:0">0</span>
        <div class="cols">${rows.map((r, i) => `<button class="col ${i === fcSelected ? 'sel' : ''}" data-m="${i}"
            aria-label="${monthLabel(r.key, true)}: ${money(r.spend)}">
          ${r.dayExp ? `<div class="seg s2" style="height:${(r.dayExp / nice) * 100}%"></div>` : ''}
          ${r.recExp ? `<div class="seg s1" style="height:${(r.recExp / nice) * 100}%"></div>` : ''}
        </button>`).join('')}</div>
      </div>
      <div class="chart-x">${rows.map((r) => `<span>${monthLabel(r.key).slice(0, 3)}</span>`).join('')}</div>
      <p class="muted small" style="margin:10px 0 0">Tap a month to see the details.</p>
    </div>
    <div class="card" id="fcMonth"></div>`;

  if (f.catProj.length) {
    html += `<h2 class="section-title">Day-to-day spending by category</h2><div class="card">
      <div class="kv"><span class="k small">Category</span><span class="v small muted">Avg so far → next month</span></div>` +
      f.catProj.map((c) => {
        const next = c.at(0);
        const ch = c.avg ? (next - c.avg) / c.avg : 0;
        const arrow = Math.abs(ch) < 0.03 ? '<span class="muted">→ steady</span>'
          : ch > 0 ? `<span class="trend-up">↑ ${Math.round(ch * 100)}%</span>` : `<span class="trend-down">↓ ${Math.round(-ch * 100)}%</span>`;
        return `<div class="kv"><span class="k">${esc(c.cat)}</span><span class="v">${money(c.avg)} → ${money(next)} ${f.method === 'trend' ? arrow : ''}</span></div>`;
      }).join('') + `</div>`;
  }

  const lastKey = rows[rows.length - 1].key;
  const ending = state.recurring.map((r) => ({ r, last: lastPaymentDate(r) }))
    .filter((x) => x.last && x.last >= today() && monthKey(x.last) <= lastKey)
    .sort((a, b) => a.last.localeCompare(b.last));
  if (ending.length) {
    html += `<h2 class="section-title">Ending in the next 12 months</h2><div class="card">` +
      ending.map(({ r, last }) => `<div class="kv"><span class="k">${esc(r.name)} · last payment ${monthLabel(monthKey(last))}</span>
        <span class="v">${r.type === 'expense' ? 'frees up' : 'loses'} ${money(monthlyEquivalent(r))}/mo</span></div>`).join('') + `</div>`;
  }
  if (f.hasCards) {
    const avgCard = rows.reduce((s, r) => s + r.cardSpend, 0) / 12;
    html += `<p class="muted small">💳 About ${money(avgCard)} a month of your spending goes on credit cards, so it leaves your bank account the month after. Tap a month to see its card bill.</p>`;
  }
  html += `<p class="muted small">${basis} Card payments, transfers, and transactions linked to a recurring payment, are left out of day-to-day spending so nothing is counted twice — when you log an instalment or loan payment, link it to its recurring payment.</p>`;

  el.innerHTML = html;
  $('#fcLookback').value = String(f.lookback);
  $('#fcMethod').value = f.method;
  $('#fcLookback').addEventListener('change', async (e) => { state.settings.fcLookback = +e.target.value; await save(); renderForecast(); });
  $('#fcMethod').addEventListener('change', async (e) => { state.settings.fcMethod = e.target.value; await save(); renderForecast(); });
  const showMonth = (i) => {
    fcSelected = i;
    el.querySelectorAll('.col').forEach((c) => c.classList.toggle('sel', +c.dataset.m === i));
    const r = rows[i];
    const line = (k, v, cls = '') => `<div class="kv ${cls}"><span class="k">${k}</span><span class="v">${v}</span></div>`;
    $('#fcMonth').innerHTML = `<h2>${monthLabel(r.key, true)}</h2>` +
      r.rec.filter((x) => x.r.type === 'expense').map((x) => line(`🔁 ${esc(x.r.name)}${x.count > 1 ? ` ×${x.count}` : ''}`, money(x.amount))).join('') +
      r.cats.filter((c) => c.amount > 0).map((c) => line(esc(c.cat), money(c.amount))).join('') +
      line('Total spending', money(r.spend), 'total') +
      line('Expected income', money(r.income)) +
      line('Left over', `<span class="${r.net < 0 ? 'neg' : 'pos'}">${money(r.net, true)}</span>`, 'total') +
      (f.hasCards ? `<h3 class="sub-head">💳 Credit cards</h3>` +
        line(`Spent on cards this month (billed in ${monthLabel(addMonthsKey(r.key, 1)).slice(0, 3)})`, money(r.cardSpend)) +
        line(i === 0 ? 'Card bill to pay (what you owe now)' : `Card bill to pay (${monthLabel(rows[i - 1].key).slice(0, 3)} spending)`, money(r.cardBill)) +
        line('Cash out of your bank accounts', money(r.cashOut), 'total') +
        `<p class="muted small" style="margin:6px 0 0">Spending paid directly from the bank, plus the card bill.</p>` : '');
  };
  el.querySelectorAll('.col').forEach((c) => c.addEventListener('click', () => showMonth(+c.dataset.m)));
  showMonth(fcSelected);
}

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
const projectSaved = (p) => (p.savedMode === 'account' && state.accounts.some((a) => a.id === p.accountId)
  ? Math.max(0, balance(p.accountId)) : p.saved || 0);

function projectPlan(p) {
  const target = projectTarget(p);
  const saved = projectSaved(p);
  const remaining = Math.max(0, target - saved);
  const thisMonth = monthKey(today());
  const res = { target, saved, remaining, pct: target ? Math.min(1, saved / target) : 0 };
  if (remaining === 0) res.done = true;
  if (p.monthly > 0 && remaining > 0) {
    res.months = Math.ceil(remaining / p.monthly);
    res.reachBy = addMonthsKey(thisMonth, res.months);
  }
  if (p.targetDate) {
    res.monthsToTarget = Math.max(0, monthsBetween(thisMonth, monthKey(p.targetDate)));
    res.needed = res.monthsToTarget > 0 ? Math.ceil(remaining / res.monthsToTarget) : remaining;
    res.onTrack = remaining === 0 || (p.monthly > 0 && p.monthly >= res.needed);
  }
  return res;
}

function renderProjects() {
  const el = $('#plan-projects');
  if (!state.projects.length) {
    el.innerHTML = `<div class="empty">No savings projects yet.<br>Tap + to plan for a house, wedding, car, holiday…<br>List what it will cost and see how long it takes to save up.</div>`;
    return;
  }
  const committed = state.projects.filter((p) => !projectPlan(p).done).reduce((s, p) => s + (p.monthly || 0), 0);
  const spare = forecastSpare();
  let html = `<div class="tiles">
    <div class="tile"><div class="label">Saving for projects</div><div class="value">${money(committed)}</div><div class="label">per month in total</div></div>
    <div class="tile"><div class="label">Forecast left over</div><div class="value ${spare < 0 ? 'neg' : ''}">${spare == null ? '–' : money(spare)}</div><div class="label">per month on average</div></div>
  </div>`;
  if (spare != null && committed > spare) {
    html += `<p class="status bad small">⚠️ You plan to save ${money(committed)} a month, but your forecast only leaves about ${money(Math.max(0, spare))} a month.</p>`;
  }
  html += `<div class="list">` + state.projects.map((p) => {
    const r = projectPlan(p);
    let sub;
    if (r.done) sub = '🎉 Fully saved';
    else if (r.months) sub = `${r.months} month${r.months > 1 ? 's' : ''} to go · ready ${monthLabel(r.reachBy)}`;
    else sub = 'Set a monthly saving amount to see how long it takes';
    if (p.targetDate && !r.done) sub += r.onTrack ? ' · ✅ on track' : ' · ⚠️ behind target';
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
  return Math.round(f.rows.reduce((s, r) => s + r.net, 0) / 12);
}

function projectDetail(id) {
  const p = state.projects.find((x) => x.id === id);
  if (!p) return;
  const r = projectPlan(p);
  const spare = forecastSpare();
  const otherMonthly = state.projects.filter((x) => x.id !== p.id && !projectPlan(x).done).reduce((s, x) => s + (x.monthly || 0), 0);
  const line = (k, v, cls = '') => `<div class="kv ${cls}"><span class="k">${k}</span><span class="v">${v}</span></div>`;
  let timeline = '';
  if (r.done) timeline = `<p class="status good">🎉 You have saved enough for this project.</p>`;
  else {
    timeline += r.months
      ? `<p>Saving <strong>${money(p.monthly)}</strong> a month, you'll have enough in <strong>${r.months} month${r.months > 1 ? 's' : ''}</strong> — around <strong>${monthLabel(r.reachBy, true)}</strong>.</p>`
      : `<p class="muted">Add a monthly saving amount (Edit) to see how long it will take.</p>`;
    if (p.targetDate) {
      timeline += r.monthsToTarget > 0
        ? `<p>To be ready by <strong>${monthLabel(monthKey(p.targetDate), true)}</strong> you need <strong>${money(r.needed)}</strong> a month. `
          + (r.onTrack ? `<span class="status good">✅ On track</span></p>` : `<span class="status bad">⚠️ Not on track${p.monthly ? ` — ${money(r.needed - p.monthly)} a month short` : ''}</span></p>`)
        : `<p class="status bad">⚠️ The target date has arrived and ${money(r.remaining)} is still missing.</p>`;
    }
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
        ${line('Total cost', money(r.target), 'total')}
        ${line(p.savedMode === 'account' ? `Saved (balance of ${esc(accountName(p.accountId))})` : 'Saved so far', money(r.saved))}
        ${line('Still to save', money(r.remaining), 'total')}
        <div class="progress"><div style="width:${r.pct * 100}%"></div></div>
      </div>
      ${timeline}
      <div class="card-inset">
        <strong>Expected costs</strong>
        ${p.items.map((i) => line(esc(i.name), money(i.amount))).join('') || '<p class="muted small">No costs listed.</p>'}
      </div>
      <button class="btn full" id="pjEdit">Edit project</button>
      <button class="btn danger full" id="pjDel">Delete project</button>
    </div>`);
  $('#pjEdit').addEventListener('click', () => projectSheet(p.id));
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
  const items = p ? p.items.map((i) => ({ ...i })) : [{ name: '', amount: 0 }];
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
      <label>How much you'll save each month
        <input id="pjMonthly" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0.00" value="${p && p.monthly ? (p.monthly / 100).toFixed(2) : ''}">
      </label>
      <label>Target date (optional)
        <input id="pjTarget" type="date" value="${p && p.targetDate ? p.targetDate : ''}">
      </label>
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
  modeUI();

  function drawItems() {
    $('#pjItems').innerHTML = items.map((i, n) => `<div class="cost-row">
      <input data-in="${n}" maxlength="40" placeholder="e.g. Down payment" value="${esc(i.name)}" aria-label="Cost name">
      <input data-ia="${n}" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0.00" value="${i.amount ? (i.amount / 100).toFixed(2) : ''}" aria-label="Amount">
      <button type="button" class="icon-btn" data-ix="${n}" aria-label="Remove cost">✕</button></div>`).join('');
    $('#pjItems').querySelectorAll('[data-in]').forEach((x) => x.addEventListener('input', () => { items[+x.dataset.in].name = x.value; }));
    $('#pjItems').querySelectorAll('[data-ia]').forEach((x) => x.addEventListener('input', () => {
      const v = toCents(x.value); items[+x.dataset.ia].amount = isNaN(v) ? 0 : v; total();
    }));
    $('#pjItems').querySelectorAll('[data-ix]').forEach((x) => x.addEventListener('click', () => { items.splice(+x.dataset.ix, 1); drawItems(); }));
    total();
  }
  const total = () => { $('#pjTotal').textContent = money(items.reduce((s, i) => s + (i.amount || 0), 0)); };
  drawItems();
  $('#pjAddItem').addEventListener('click', () => { items.push({ name: '', amount: 0 }); drawItems(); });
  document.querySelectorAll('[data-idea]').forEach((b) => b.addEventListener('click', () => {
    if (!$('#pjName').value) $('#pjName').value = b.dataset.idea;
    items.splice(0, items.length, ...PROJECT_IDEAS[b.dataset.idea].map((name) => ({ name, amount: 0 })));
    drawItems();
  }));

  $('#projForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#pjName').value.trim();
    if (!name) return toast('Give the project a name');
    const clean = items.filter((i) => i.name.trim() || i.amount > 0).map((i) => ({ name: i.name.trim() || 'Cost', amount: i.amount || 0 }));
    if (!clean.some((i) => i.amount > 0)) return toast('Add at least one cost with an amount');
    const saved = toCents($('#pjSaved').value || '0');
    const monthly = toCents($('#pjMonthly').value || '0');
    const data = {
      name, items: clean,
      savedMode: $('#pjMode').value, saved: isNaN(saved) ? 0 : saved,
      accountId: $('#pjMode').value === 'account' ? $('#pjAcc').value : '',
      monthly: isNaN(monthly) ? 0 : monthly,
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
