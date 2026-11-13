/* Rojak — the one data store shared by every module, kept on this device (IndexedDB).

   Layout (one database, one key/value store):
     'state'        the Money module's data. This is the key the money tracker has always used, so data saved
                    by earlier versions (and older backups) load exactly as before.
     'mod:<id>'     any other module's data
     'img:<id>'     screenshots and other images (kept apart so the main data stays small)
     'rojak:meta'   when each entry was first saved and last changed, and when the last backup was made

   Every entry a module saves (every object with an id in one of its collections) gets
     savedAt    when it was first saved (ISO date-time)
     updatedAt  when it last changed
   written onto the entry itself, and also kept in 'rojak:meta' so the dates survive even when a module replaces
   an entry with a new object. Rojak.entries() lists every module's entries with a common `date`, so modules can
   be compared later. */
'use strict';

// The database keeps its original name so existing data is found where it has always been.
const DB_NAME = 'money-tracker';
const STORE = 'kv';
const META_KEY = 'rojak:meta';
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
// Several writes in one go: either all of them are saved or none are.
const dbSetMany = (pairs) => dbDo('readwrite', (s) => { let r; for (const [k, v] of pairs) r = s.put(v, k); return r; });

const Rojak = (() => {
  const modules = [];          // registered modules, in the order they appear on the home screen
  let meta = null;             // { schema, stamps: {module: {collection: {id: {c, u, h}}}}, lastBackupAt }
  const LEGACY_KEYS = { money: 'state' };
  const keyOf = (id) => LEGACY_KEYS[id] || 'mod:' + id;
  const moduleById = (id) => modules.find((m) => m.id === id);

  const emptyMeta = () => ({ schema: 1, stamps: {}, lastBackupAt: null });
  async function loadMeta() {
    if (!meta) meta = Object.assign(emptyMeta(), (await dbGet(META_KEY)) || {});
    return meta;
  }

  /* ----- Dating every entry ----- */
  // A short fingerprint of an entry (ignoring its own dates) to notice when it changes.
  function fingerprint(rec) {
    const json = JSON.stringify(rec, function (k, v) { return this === rec && (k === 'savedAt' || k === 'updatedAt') ? undefined : v; });
    let h = 0x811c9dc5;
    for (let i = 0; i < json.length; i++) { h ^= json.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36) + json.length.toString(36);
  }
  const isoFromDay = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d || '') ? new Date(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)).toISOString() : null);
  // For entries saved before Rojak dated them: the best guess of when they were first saved.
  function firstSeen(rec, now, backfill) {
    if (typeof rec.savedAt === 'string') return rec.savedAt;
    if (!backfill) return now;
    if (typeof rec.createdAt === 'number' && rec.createdAt > 1e12) return new Date(rec.createdAt).toISOString();
    return isoFromDay(rec.date) || isoFromDay(rec.start) || isoFromDay(rec.startDate) || now;
  }
  function stamp(mod, data) {
    const now = new Date().toISOString();
    const all = meta.stamps[mod.id] || (meta.stamps[mod.id] = {});
    for (const col of mod.collections) {
      const list = data && data[col];
      if (!Array.isArray(list)) continue;
      // The first time a collection is dated, its entries were saved earlier: guess when. After that, new = now.
      const backfill = !all[col];
      const old = all[col] || {};
      const next = {};
      for (const rec of list) {
        if (!rec || typeof rec !== 'object' || rec.id == null) continue;
        const h = fingerprint(rec);
        const s = old[rec.id];
        let c, u;
        if (!s) { c = firstSeen(rec, now, backfill); u = typeof rec.updatedAt === 'string' ? rec.updatedAt : c; }
        else { c = s.c; u = s.h === h ? s.u : now; }
        rec.savedAt = c; rec.updatedAt = u;
        next[rec.id] = { c, u, h };
      }
      all[col] = next;
    }
  }

  /* ----- Loading and saving ----- */
  async function load(id) {
    await loadMeta();
    return dbGet(keyOf(id));
  }
  async function save(id, data) {
    const mod = moduleById(id);
    await loadMeta();
    if (mod) stamp(mod, data);
    return dbSetMany([[keyOf(id), data], [META_KEY, meta]]);
  }

  /* ----- Modules ----- */
  // A module tells Rojak: id, name, icon, collections (arrays of entries in its data), view (its first screen),
  // data() (its data now), entry(collection, rec) → {date, amount?, label} for comparing modules,
  // summary() → home-screen cards, shortcuts() → home-screen buttons, describe(data) → text for a backup,
  // reload(data) → take in data after an import or a wipe (null = start empty).
  function registerModule(mod) {
    if (!moduleById(mod.id)) modules.push(mod);
  }

  // Every module's entries with a common shape and date, e.g. Rojak.entries({ from: '2026-01-01' }).
  function entries({ module, from, to } = {}) {
    const out = [];
    for (const mod of modules) {
      if (module && mod.id !== module) continue;
      const data = mod.data();
      for (const col of mod.collections) {
        for (const rec of (data && data[col]) || []) {
          if (!rec || rec.id == null) continue;
          const info = (mod.entry && mod.entry(col, rec)) || {};
          const date = info.date || rec.date || (rec.savedAt || '').slice(0, 10);
          if ((from && date < from) || (to && date > to)) continue;
          out.push({ module: mod.id, collection: col, id: rec.id, date, savedAt: rec.savedAt, updatedAt: rec.updatedAt,
            amount: info.amount, label: info.label || '' });
        }
      }
    }
    return out.sort((a, b) => b.date.localeCompare(a.date) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  /* ----- Backup ----- */
  async function exportBackup() {
    await loadMeta();
    const data = {};
    for (const mod of modules) data[mod.id] = mod.data();
    const images = {};
    for (const k of await dbKeys()) {
      if (typeof k === 'string' && k.startsWith('img:')) images[k.slice(4)] = await dbGet(k);
    }
    const backup = { app: 'rojak', version: 1, exportedAt: new Date().toISOString(), modules: data, meta, images };
    const day = new Date().toISOString().slice(0, 10);
    const name = `rojak-backup-${day}.json`;
    const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
    const file = new File([blob], name, { type: 'application/json' });
    const done = async () => { meta.lastBackupAt = backup.exportedAt; await dbSet(META_KEY, meta); };

    // On phones, the share sheet lets you save to Files / Drive or send by email.
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Rojak backup' });
        await done();
        return 'shared';
      } catch (err) {
        if (err.name === 'AbortError') return 'cancelled';
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    await done();
    return 'downloaded';
  }

  // Reads a Rojak backup, or a backup made by the Money Tracker before it became part of Rojak.
  function readBackup(json) {
    if (json && json.app === 'rojak' && json.modules && typeof json.modules === 'object') {
      return { modules: json.modules, meta: json.meta || null, images: json.images || {}, exportedAt: json.exportedAt };
    }
    if (json && json.app === 'money-tracker' && json.state && Array.isArray(json.state.accounts)) {
      return { modules: { money: json.state }, meta: null, images: json.images || {}, exportedAt: json.exportedAt };
    }
    return null;
  }

  async function importFile(file) {
    let b;
    try { b = readBackup(JSON.parse(await file.text())); } catch { b = null; }
    if (!b || (b.modules.money && !Array.isArray(b.modules.money.accounts))) throw new Error('not a backup');
    const lines = modules.filter((m) => b.modules[m.id]).map((m) => `${m.icon} ${m.name}: ${m.describe ? m.describe(b.modules[m.id]) : 'data'}`);
    const when = b.exportedAt ? new Date(b.exportedAt).toLocaleString() : 'unknown date';
    if (!confirm(`Import backup from ${when}?\n\n${lines.join('\n') || 'No data'}\n\nThis REPLACES all data currently in the app.`)) return false;
    await dbClear();
    meta = Object.assign(emptyMeta(), b.meta || {}, { lastBackupAt: (b.meta && b.meta.lastBackupAt) || b.exportedAt || null });
    await dbSet(META_KEY, meta);
    for (const [id, img] of Object.entries(b.images)) await dbSet('img:' + id, img);
    for (const mod of modules) await mod.reload(b.modules[mod.id] || null);
    // Keep data of modules this version doesn't know yet, so nothing in the backup is lost.
    for (const [id, data] of Object.entries(b.modules)) if (!moduleById(id)) await dbSet(keyOf(id), data);
    return true;
  }

  // Deletes everything in every module.
  async function wipe() {
    await dbClear();
    meta = emptyMeta();
    for (const mod of modules) await mod.reload(null);
  }

  const lastBackupAt = () => (meta && meta.lastBackupAt) || null;

  return { load, save, registerModule, modules, entries, exportBackup, importFile, wipe, lastBackupAt };
})();
