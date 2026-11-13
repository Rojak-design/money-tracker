/* Rojak home screen. It only reads the money tracker's data (to show the summary); it never changes it. */
'use strict';

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => isoDay(new Date());

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2600);
}

/* ----- Money summary: worked out the same way as in the money tracker ----- */
function moneyFormat(cents, currency) {
  const n = (cents || 0) / 100;
  const txt = Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n < 0 ? '−' : ''}${currency}${txt}`;
}
// An account's balance today, as on the Accounts screen: the starting balance plus entries from its start date
// up to today (entries dated later are planned and don't count yet).
function accountBalance(s, acc, until) {
  let startDate = acc.startDate;
  if (startDate === undefined) startDate = acc.createdAt > 1e12 ? isoDay(new Date(acc.createdAt)) : ''; // as in the tracker
  let total = acc.start || 0;
  for (const t of s.transactions || []) {
    if (t.accountId !== acc.id || t.date > until) continue;
    if (startDate && t.date < startDate) continue;
    total += t.type === 'income' ? t.amount : -t.amount;
  }
  return total;
}
// Spent today, as in History: expenses minus money back; transfers and card payments don't count.
function spentOn(s, day) {
  let total = 0;
  for (const t of s.transactions || []) {
    if (t.date !== day || t.transferId || t.category === 'Transfer') continue;
    if (t.type === 'expense') total += t.amount;
    else if (t.refund) total -= t.amount;
  }
  return total;
}

function renderMoney(s) {
  const el = $('#moneySummary');
  if (!s || !(s.accounts || []).length) {
    el.innerHTML = `<div class="muted small" style="grid-column:1/-1">No accounts yet. Tap to open the money tracker and add one.</div>`;
    return;
  }
  const cur = (s.settings && s.settings.currency) || 'S$';
  const t = today();
  const total = s.accounts.reduce((sum, a) => sum + accountBalance(s, a, t), 0);
  const hasCards = s.accounts.some((a) => a.type === 'credit');
  const spent = spentOn(s, t);
  const count = (s.transactions || []).filter((x) => x.date === t && x.type === 'expense' && !x.transferId && x.category !== 'Transfer').length;
  el.innerHTML = `
    <div class="stat"><div class="label">Spent today</div><div class="value">${esc(moneyFormat(spent, cur))}</div>
      <div class="sub">${count ? `${count} expense${count > 1 ? 's' : ''}` : 'Nothing yet'}</div></div>
    <div class="stat"><div class="label">${hasCards ? 'Net total' : 'Total balance'}</div><div class="value ${total < 0 ? 'neg' : ''}">${esc(moneyFormat(total, cur))}</div>
      <div class="sub">${hasCards ? 'bank accounts − card bills' : `${s.accounts.length} account${s.accounts.length > 1 ? 's' : ''}`}</div></div>`;
}

async function renderBackupInfo() {
  const last = await Rojak.lastBackupAt();
  if (!last) return;
  const days = Math.floor((Date.now() - new Date(last).getTime()) / 864e5);
  const ago = days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
  $('#backupInfo').textContent = `Last backup ${ago} (${new Date(last).toLocaleDateString()}). Everything in Rojak is saved only on this phone. Keep a backup file somewhere safe.`;
}

$('#exportBtn').addEventListener('click', async () => {
  try {
    const how = await Rojak.exportBackup();
    if (how === 'downloaded') toast('Backup downloaded');
    if (how !== 'cancelled') renderBackupInfo();
  } catch (err) {
    console.error(err);
    toast('Could not make the backup');
  }
});

async function init() {
  const hair = hairForMonth();
  $('#avatar').innerHTML = avatarSVG(hair);
  setAvatarFavicon();
  $('#today').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  $('#hairNote').textContent = `This month's hair: ${hair.name}. It changes every month.`;
  try {
    renderMoney(await Rojak.load('money'));
    await renderBackupInfo();
  } catch (err) {
    console.error(err);
    $('#moneySummary').innerHTML = `<div class="muted small">Could not open storage on this browser.</div>`;
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}
init();
// Coming back to the home screen (e.g. from the money tracker) shows fresh numbers.
window.addEventListener('pageshow', (e) => { if (e.persisted) init(); });
