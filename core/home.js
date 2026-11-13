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
  // Cards count as the bills due this month / pay cycle, as worked out by the money tracker (kept until that
  // period ends); if it's out of date, a card counts as everything owed on it.
  const due = s.cardsDue && t <= s.cardsDue.until ? s.cardsDue.byCard || {} : {};
  const total = s.accounts.reduce((sum, a) => sum + (a.type === 'credit' && due[a.id] != null ? -due[a.id] : accountBalance(s, a, t)), 0);
  const hasCards = s.accounts.some((a) => a.type === 'credit');
  const spent = spentOn(s, t);
  const count = (s.transactions || []).filter((x) => x.date === t && x.type === 'expense' && !x.transferId && x.category !== 'Transfer').length;
  el.innerHTML = `
    <div class="stat"><div class="label">Spent today</div><div class="value">${esc(moneyFormat(spent, cur))}</div>
      <div class="sub">${count ? `${count} expense${count > 1 ? 's' : ''}` : 'Nothing yet'}</div></div>
    <div class="stat"><div class="label">${hasCards ? 'Net total' : 'Total balance'}</div><div class="value ${total < 0 ? 'neg' : ''}">${esc(moneyFormat(total, cur))}</div>
      <div class="sub">${hasCards ? (s.cardsDue && t <= s.cardsDue.until ? 'bank accounts − card bills due now' : 'bank accounts − card bills') : `${s.accounts.length} account${s.accounts.length > 1 ? 's' : ''}`}</div></div>`;
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

/* ----- She waves and the cat swishes its tail ----- */
const reduceMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
const easeOut = (x) => 1 - (1 - x) * (1 - x);
const anims = {};
// Runs step(t) every frame for `ms` milliseconds (t from 0 to 1); a new run of the same name replaces the old one.
function animate(name, ms, step) {
  cancelAnimationFrame(anims[name]);
  const start = performance.now();
  const frame = (now) => {
    const t = Math.min(1, (now - start) / ms);
    step(t * ms);
    if (t < 1) anims[name] = requestAnimationFrame(frame);
  };
  anims[name] = requestAnimationFrame(frame);
}
// Hand peeks up beside her shoulder (the elbow stays below the card edge), waves twice, goes down; then she blinks.
function wave() {
  if (reduceMotion()) return;
  const svg = $('#avatar svg');
  if (!svg) return;
  const lift = svg.querySelector('.arm-lift'), rock = svg.querySelector('.arm-wave');
  const open = svg.querySelector('.eyes-open'), shut = svg.querySelector('.eyes-shut');
  animate('wave', 1800, (ms) => {
    // How far up the hand is: 0 = hidden below the edge, 1 = up beside her shoulder.
    const up = ms < 250 ? easeOut(ms / 250) : ms < 1250 ? 1 : ms < 1500 ? 1 - easeOut((ms - 1250) / 250) : 0;
    const deg = ms >= 250 && ms < 1250 ? -12 * Math.sin(((ms - 250) / 500) * 2 * Math.PI) : 0;
    lift.setAttribute('transform', `translate(0 ${13 + (1 - up) * 32})`);
    rock.setAttribute('transform', `rotate(${deg.toFixed(2)} 90 95)`);
    const blink = ms >= 1550 && ms < 1720;
    open.setAttribute('display', blink ? 'none' : 'inline');
    shut.setAttribute('display', blink ? 'inline' : 'none');
  });
}
// The cat's tail swishes three times around its base.
function swish() {
  if (reduceMotion()) return;
  const tail = $('#cat .tail');
  if (!tail) return;
  animate('swish', 1500, (ms) => {
    const deg = ms < 1500 ? -22 * Math.sin((ms / 500) * 2 * Math.PI) * (1 - ms / 1700) : 0;
    tail.setAttribute('transform', `rotate(${deg.toFixed(2)} 3 70)`);
  });
}
function hello() { wave(); swish(); }
$('#avatar').addEventListener('click', wave);
$('#cat').addEventListener('click', swish);
// Opening the app again after switching away says hello again.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') hello(); });

async function init() {
  const hair = hairForMonth(), cat = catForMonth();
  $('#avatar').innerHTML = avatarFigure(hair);
  $('#cat').innerHTML = catSVG(cat);
  setAvatarFavicon();
  $('#today').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  $('#hairNote').textContent = `This month: ${hair.name} hair and a ${cat.name} cat. They change every month.`;
  setTimeout(hello, 350);
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
