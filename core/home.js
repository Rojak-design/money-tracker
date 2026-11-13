/* Rojak — home screen: a summary card for each module, shortcut buttons, recent activity and backup. */
'use strict';

function timeAgo(iso) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 864e5);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 60) return `${days} days ago`;
  return `${Math.floor(days / 30)} months ago`;
}

function renderHome() {
  const el = $('#homeBody');
  if (!el) return;
  let html = `<p class="muted small home-date">${new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>`;
  const actions = [];   // click handlers, matched up by index after the HTML is in place
  const act = (fn) => { actions.push(fn); return actions.length - 1; };

  for (const mod of Rojak.modules) {
    const sum = mod.summary ? mod.summary() : {};
    html += `<section class="home-module">
      <div class="home-head"><h2>${mod.icon} ${esc(mod.name)}</h2>
        <button class="link-btn" data-act="${act(() => show(mod.view))}">Open ›</button></div>`;
    if (sum.empty) {
      html += `<div class="card muted small">${esc(sum.empty)}</div>`;
    } else {
      html += `<div class="tiles">` + (sum.cards || []).map((c) => `
        <button class="tile home-tile${c.wide ? ' wide' : ''}" data-act="${act(() => { if (c.plan) planTab = c.plan; show(c.view || mod.view); })}">
          <div class="label">${esc(c.label)}</div>
          <div class="value ${c.neg ? 'neg' : c.pos ? 'pos' : ''}">${esc(c.value)}</div>
          ${c.sub ? `<div class="label">${esc(c.sub)}</div>` : ''}
        </button>`).join('') + `</div>`;
    }
    const shortcuts = mod.shortcuts ? mod.shortcuts() : [];
    if (shortcuts.length) {
      html += `<div class="shortcuts">` + shortcuts.map((s) => `
        <button class="shortcut" data-act="${act(s.run)}"><span>${s.icon}</span>${esc(s.label)}</button>`).join('') + `</div>`;
    }
    html += `</section>`;
  }

  // Latest changes in any module, from the shared store.
  const recent = Rojak.entries().filter((e) => e.updatedAt)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5);
  if (recent.length) {
    const icon = (id) => (Rojak.modules.find((m) => m.id === id) || {}).icon || '';
    html += `<h2 class="section-title">Recently saved</h2><div class="card">` + recent.map((e) => `
      <div class="kv"><span class="k">${icon(e.module)} ${esc(e.label || e.collection)} · ${shortDate(e.date)}</span>
        <span class="v ${e.amount > 0 && e.collection === 'transactions' ? 'pos' : ''}">${e.amount != null ? money(e.amount, e.collection === 'transactions') : ''}</span></div>`).join('') + `</div>`;
  }

  const last = Rojak.lastBackupAt();
  html += `<div class="card form home-backup">
      <h2>💾 Backup</h2>
      <p class="muted small">${last ? `Last backup ${timeAgo(last)} (${new Date(last).toLocaleDateString()}).` : 'No backup made on this phone yet.'}
        Everything in Rojak is saved only on this phone — keep a backup file somewhere safe.</p>
      <button class="btn full" data-act="${act(exportBackup)}">Export backup</button>
      <button class="link-btn" data-act="${act(() => show('backup'))}">Import a backup or change settings ›</button>
    </div>`;

  el.innerHTML = html;
  el.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => actions[+b.dataset.act]()));
}
