/* Money Tracker — all data is stored on this device (IndexedDB). */
'use strict';

/* ---------- Storage (IndexedDB) ---------- */
const DB_NAME = 'money-tracker';
const STORE = 'kv';
let dbPromise;

function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}
async function dbDo(mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    const req = fn(store);
    tx.oncomplete = () => resolve(req && req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
const dbGet = (key) => dbDo('readonly', (s) => s.get(key));
const dbSet = (key, val) => dbDo('readwrite', (s) => s.put(val, key));
const dbDel = (key) => dbDo('readwrite', (s) => s.delete(key));
const dbClear = () => dbDo('readwrite', (s) => s.clear());
const dbKeys = () => dbDo('readonly', (s) => s.getAllKeys());

/* ---------- State ---------- */
// Amounts are stored as whole cents (integers) to avoid rounding errors.
const emptyState = () => ({
  accounts: [],        // {id, name, start, createdAt}
  transactions: [],    // {id, accountId, type: 'expense'|'income', amount, category, date, note, recurringId?}
  reconciliations: [], // {id, accountId, date, bank, app, hasImage, note, adjusted, adjustTxId?}
  categories: null,    // {expense: [names], income: [names]} — set up on first load
  recurring: [],       // see plan.js
  projects: [],        // see plan.js
  settings: { currency: 'S$', fcLookback: 6, fcMethod: 'trend' }
});
let state = emptyState();

// Fill in anything added in newer versions of the app.
function migrate() {
  const base = emptyState();
  state.settings = Object.assign(base.settings, state.settings);
  if (!state.settings.currency) state.settings.currency = 'S$';
  if (!Array.isArray(state.recurring)) state.recurring = [];
  if (!Array.isArray(state.projects)) state.projects = [];
  if (!state.categories) {
    state.categories = {};
    for (const type of ['expense', 'income']) {
      const used = state.transactions.filter((t) => t.type === type && t.category).map((t) => t.category);
      state.categories[type] = [...new Set([...DEFAULT_CATS[type], ...used])];
    }
  }
}

async function load() {
  const saved = await dbGet('state');
  if (saved) state = Object.assign(emptyState(), saved);
  migrate();
}
function save() {
  return dbSet('state', state).catch((err) => {
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

function balance(accountId, upToDate) {
  const acc = state.accounts.find((a) => a.id === accountId);
  if (!acc) return 0;
  let total = acc.start;
  for (const t of state.transactions) {
    if (t.accountId !== accountId) continue;
    if (upToDate && t.date > upToDate) continue;
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
}

function renderAccounts() {
  const list = $('#accountList');
  let total = 0;
  if (!state.accounts.length) {
    list.innerHTML = `<div class="empty">No accounts yet.<br>Tap “New account” to create one (e.g. Savings, Spending).</div>`;
  } else {
    list.innerHTML = state.accounts.map((a) => {
      const b = balance(a.id);
      total += b;
      const last = state.reconciliations.filter((r) => r.accountId === a.id).sort((x, y) => (y.date + y.id).localeCompare(x.date + x.id))[0];
      const sub = last ? `Last checked ${niceDate(last.date)}` : 'Not reconciled yet';
      return `<button class="item" data-acc="${a.id}">
        <div class="left"><div class="title">${esc(a.name)}</div><div class="sub">${sub}</div></div>
        <div class="amt ${b < 0 ? 'neg' : ''}">${money(b)}</div></button>`;
    }).join('');
  }
  $('#totalBalance').textContent = money(total);
  list.querySelectorAll('[data-acc]').forEach((el) => el.addEventListener('click', () => accountSheet(el.dataset.acc)));
}

let txFilter = 'all';
let txCatFilter = 'all';
function renderTx() {
  const sel = $('#txFilter');
  sel.innerHTML = `<option value="all">All accounts</option>` +
    state.accounts.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('');
  if (txFilter !== 'all' && !state.accounts.some((a) => a.id === txFilter)) txFilter = 'all';
  sel.value = txFilter;

  const catSel = $('#txCatFilter');
  const cats = [...new Set([...state.categories.expense, ...state.categories.income,
    ...state.transactions.map((t) => t.category).filter(Boolean)])].sort((a, b) => a.localeCompare(b));
  catSel.innerHTML = `<option value="all">All categories</option>` +
    cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  if (txCatFilter !== 'all' && !cats.includes(txCatFilter)) txCatFilter = 'all';
  catSel.value = txCatFilter;

  const txs = state.transactions
    .filter((t) => txFilter === 'all' || t.accountId === txFilter)
    .filter((t) => txCatFilter === 'all' || t.category === txCatFilter)
    .sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id));
  const list = $('#txList');
  const totalEl = $('#txTotal');
  if (!txs.length) {
    totalEl.classList.add('hidden');
    list.innerHTML = `<div class="empty">No transactions yet.<br>Tap the + button to add one.</div>`;
    return;
  }
  if (txCatFilter !== 'all') {
    const net = txs.reduce((s, t) => s + (t.type === 'income' ? t.amount : -t.amount), 0);
    const ym = today().slice(0, 7);
    const month = txs.filter((t) => t.date.startsWith(ym)).reduce((s, t) => s + (t.type === 'income' ? t.amount : -t.amount), 0);
    totalEl.innerHTML = `<span class="muted small">${esc(txCatFilter)} this month</span><strong>${money(month, true)}</strong>
      <span class="muted small">All time: ${money(net, true)}</span>`;
    totalEl.classList.remove('hidden');
  } else totalEl.classList.add('hidden');
  let html = '';
  let lastDate = '';
  for (const t of txs) {
    if (t.date !== lastDate) { html += `<div class="date-head">${niceDate(t.date)}</div>`; lastDate = t.date; }
    const signed = t.type === 'income' ? t.amount : -t.amount;
    const sub = [txFilter === 'all' ? accountName(t.accountId) : '', t.note].filter(Boolean).map(esc).join(' · ');
    html += `<button class="item" data-tx="${t.id}">
      <div class="left"><div class="title">${esc(t.category || (t.type === 'income' ? 'Income' : 'Expense'))}</div>
      ${sub ? `<div class="sub">${t.recurringId ? '🔁 ' : ''}${sub}</div>` : t.recurringId ? '<div class="sub">🔁 Recurring</div>' : ''}</div>
      <div class="amt ${signed < 0 ? 'neg' : 'pos'}">${money(signed, true)}</div></button>`;
  }
  list.innerHTML = html;
  list.querySelectorAll('[data-tx]').forEach((el) => el.addEventListener('click', () => txSheet(el.dataset.tx)));
}
$('#txFilter').addEventListener('change', (e) => { txFilter = e.target.value; renderTx(); });
$('#txCatFilter').addEventListener('change', (e) => { txCatFilter = e.target.value; renderTx(); });

/* ---------- Accounts ---------- */
$('#addAccountBtn').addEventListener('click', () => accountSheet());

function accountSheet(id) {
  const a = state.accounts.find((x) => x.id === id);
  openSheet(a ? 'Edit account' : 'New account', `
    <form class="form" id="accForm">
      <label>Account name
        <input id="accName" required maxlength="40" placeholder="e.g. Savings" value="${esc(a ? a.name : '')}">
      </label>
      <label>Starting balance
        <input id="accStart" type="number" inputmode="decimal" step="0.01" required placeholder="0.00" value="${a ? (a.start / 100).toFixed(2) : ''}">
      </label>
      ${a ? `<p class="muted small">Current balance: <strong>${money(balance(a.id))}</strong></p>` : ''}
      <button class="btn full" type="submit">Save</button>
      ${a ? `<div class="btn-row">
        <button type="button" class="btn secondary" id="accView">See transactions</button>
        <button type="button" class="btn danger" id="accDel">Delete</button></div>` : ''}
    </form>`);
  $('#accForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#accName').value.trim();
    const start = toCents($('#accStart').value);
    if (!name || isNaN(start)) return toast('Please fill in the name and starting balance');
    if (a) { a.name = name; a.start = start; }
    else state.accounts.push({ id: uid(), name, start, createdAt: Date.now() });
    await save();
    closeSheet(); render();
    toast('Account saved');
  });
  if (a) {
    $('#accView').addEventListener('click', () => { txFilter = a.id; closeSheet(); show('tx'); });
    $('#accDel').addEventListener('click', async () => {
      const n = state.transactions.filter((t) => t.accountId === a.id).length;
      if (!confirm(`Delete “${a.name}” and its ${n} transaction(s) and reconciliations? This cannot be undone.`)) return;
      const recs = state.reconciliations.filter((r) => r.accountId === a.id);
      state.accounts = state.accounts.filter((x) => x.id !== a.id);
      state.transactions = state.transactions.filter((t) => t.accountId !== a.id);
      state.reconciliations = state.reconciliations.filter((r) => r.accountId !== a.id);
      await save();
      for (const r of recs) await dbDel('img:' + r.id);
      closeSheet(); render();
      toast('Account deleted');
    });
  }
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
  const p = t || prefill || {};
  let type = p.type || 'expense';
  const defaultAcc = p.accountId || (txFilter !== 'all' ? txFilter : state.accounts[0].id);
  openSheet(t ? 'Edit transaction' : 'Add transaction', `
    <form class="form" id="txForm">
      <div class="segmented">
        <button type="button" data-type="expense" class="expense">Expense</button>
        <button type="button" data-type="income" class="income">Income</button>
      </div>
      <label>Amount
        <input id="txAmount" type="number" inputmode="decimal" step="0.01" min="0.01" required placeholder="0.00" value="${p.amount ? (p.amount / 100).toFixed(2) : ''}">
      </label>
      <label>Account
        <select id="txAccount">${state.accounts.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select>
      </label>
      ${catPickerHtml('tx')}
      <label id="txRecWrap" class="hidden">Part of a recurring payment?
        <select id="txRec"></select>
      </label>
      <label>Date
        <input id="txDate" type="date" required value="${p.date || today()}">
      </label>
      <label>Note (optional)
        <input id="txNote" maxlength="100" placeholder="e.g. Lunch with Sam" value="${esc(p.note || '')}">
      </label>
      <button class="btn full" type="submit">Save</button>
      ${t ? `<button type="button" class="btn danger full" id="txDel">Delete</button>` : ''}
    </form>`);
  $('#txAccount').value = state.accounts.some((a) => a.id === defaultAcc) ? defaultAcc : state.accounts[0].id;

  const recSel = $('#txRec');
  function fillRecurring(selected) {
    const recs = state.recurring.filter((r) => r.type === type);
    $('#txRecWrap').classList.toggle('hidden', !recs.length);
    recSel.innerHTML = `<option value="">No — one-off</option>` +
      recs.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('');
    recSel.value = recs.some((r) => r.id === selected) ? selected : '';
  }
  recSel.addEventListener('change', () => {
    const r = state.recurring.find((x) => x.id === recSel.value);
    if (!r) return;
    setupCatPicker('tx', type, r.category);
    if (!$('#txAmount').value) $('#txAmount').value = (r.amount / 100).toFixed(2);
  });
  function setType(newType, keepCat) {
    type = newType;
    document.querySelectorAll('#txForm .segmented button').forEach((b) => b.classList.toggle('on', b.dataset.type === type));
    setupCatPicker('tx', type, keepCat);
    fillRecurring(p.recurringId);
  }
  document.querySelectorAll('#txForm .segmented button').forEach((b) => b.addEventListener('click', () => setType(b.dataset.type)));
  setType(type, p.category);
  if (!t && !p.amount) setTimeout(() => $('#txAmount').focus(), 250);

  $('#txForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const amount = toCents($('#txAmount').value);
    if (!(amount > 0)) return toast('Enter an amount above 0');
    const category = readCatPicker('tx', type);
    if (!category) return toast('Type a name for the new category');
    const data = {
      type, amount, category,
      accountId: $('#txAccount').value,
      date: $('#txDate').value || today(),
      note: $('#txNote').value.trim(),
      recurringId: recSel.value || undefined
    };
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
    ? state.accounts.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('')
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
    const status = diff === 0 ? '✅ Matches' : r.adjusted ? '🔧 Adjusted' : `⚠️ Off by ${money(diff, true)}`;
    return `<button class="item" data-rec="${r.id}">
      ${r.hasImage ? `<img class="thumb" data-img="${r.id}" alt="">` : ''}
      <div class="left" style="flex:1"><div class="title">${esc(accountName(r.accountId))}</div>
      <div class="sub">${niceDate(r.date)} · ${status}</div></div>
      <div class="amt">${money(r.bank)}</div></button>`;
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
  const app = accId ? balance(accId, date) : 0;
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
  if (!file) { reconImageData = null; preview.classList.add('hidden'); return; }
  try {
    reconImageData = await compressImage(file);
    preview.src = reconImageData;
    preview.classList.remove('hidden');
  } catch {
    reconImageData = null;
    toast('Could not read that image');
  }
});

$('#reconForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const accountId = $('#reconAccount').value;
  if (!accountId) return toast('Create an account first');
  const bank = toCents($('#reconBank').value);
  if (isNaN(bank)) return toast('Type the balance shown in your bank');
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
  reconImageData = null;
  render();
  toast(rec.bank === rec.app ? 'Saved — balances match ✅' : 'Saved — there is a difference');
  reconSheet(rec.id);
});

async function reconSheet(id) {
  const r = state.reconciliations.find((x) => x.id === id);
  if (!r) return;
  const diff = r.bank - r.app;
  const img = r.hasImage ? await dbGet('img:' + r.id) : null;
  openSheet('Reconciliation', `
    <div class="form">
      <div class="muted small">${esc(accountName(r.accountId))} · ${niceDate(r.date)}</div>
      <div class="compare">
        <div><span class="muted small">Bank said</span><strong>${money(r.bank)}</strong></div>
        <div><span class="muted small">App said</span><strong>${money(r.app)}</strong></div>
      </div>
      <div class="compare" style="grid-template-columns:1fr">
        <div><span class="muted small">Difference (bank − app)</span>
        <strong class="${diff === 0 ? 'pos' : 'neg'}">${diff === 0 ? '✅ Matches' : money(diff, true)}</strong></div>
      </div>
      ${diff !== 0 ? `<p class="muted small">${diff > 0
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

/* ---------- Manage categories ---------- */
$('#manageCatsBtn').addEventListener('click', () => categoriesSheet('expense'));

function categoriesSheet(type) {
  const count = (c) => state.transactions.filter((t) => t.type === type && t.category === c).length;
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
    for (const t of state.transactions) if (t.type === type && t.category === old) t.category = name;
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
(async function init() {
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
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
