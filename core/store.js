/* Rojak — the one data store shared by the home screen and every module, kept on this device (IndexedDB).

   Layout (one database, one key/value store):
     'state'        the Money module's data — the same place the money tracker has always saved it,
                    so everything saved earlier still loads
     'mod:<id>'     each later module's data (Habits, Fitness, …)
     'img:<id>'     screenshots
     'rojak:meta'   when each entry was first saved and last changed, and when the last backup was made

   Every entry a module saves (every object with an id in one of its lists) is dated:
     savedAt    when it was first saved (ISO date-time)
     updatedAt  when it last changed
   The dates are written onto the entry and also kept in 'rojak:meta', so they survive even when a module
   replaces an entry with a new copy. They let modules be compared later. */
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
// Several writes in one go: either all are saved or none are.
const dbSetMany = (pairs) => dbDo('readwrite', (s) => { let r; for (const [k, v] of pairs) r = s.put(v, k); return r; });

const Rojak = (() => {
  // Each module: where its data is kept and which of its lists hold entries to date.
  const MODULES = {
    money: { key: 'state', collections: ['accounts', 'transactions', 'reconciliations', 'recurring', 'projects', 'trips'] }
  };
  const keyOf = (id) => (MODULES[id] && MODULES[id].key) || 'mod:' + id;
  const emptyMeta = () => ({ schema: 1, stamps: {}, lastBackupAt: null });
  let meta = null;
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
  // When an entry was first saved. Entries from before Rojak have no record of it, so the best guess is used:
  // when it was created if known, otherwise its own date.
  function firstSaved(rec, now, older) {
    if (typeof rec.savedAt === 'string') return rec.savedAt;
    if (!older) return now;
    if (typeof rec.createdAt === 'number' && rec.createdAt > 1e12) return new Date(rec.createdAt).toISOString();
    return isoFromDay(rec.date) || isoFromDay(rec.start) || isoFromDay(rec.startDate) || now;
  }
  function stamp(id, data) {
    const cols = (MODULES[id] && MODULES[id].collections) || Object.keys(data || {}).filter((k) => Array.isArray(data[k]));
    const now = new Date().toISOString();
    const all = meta.stamps[id] || (meta.stamps[id] = {});
    for (const col of cols) {
      const list = data && data[col];
      if (!Array.isArray(list)) continue;
      const older = !all[col]; // the first time a list is dated, its entries were saved before Rojak
      const old = all[col] || {};
      const next = {};
      for (const rec of list) {
        if (!rec || typeof rec !== 'object' || rec.id == null) continue;
        const h = fingerprint(rec);
        const s = old[rec.id];
        let c, u;
        if (!s) { c = firstSaved(rec, now, older); u = typeof rec.updatedAt === 'string' ? rec.updatedAt : c; }
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
    await loadMeta();
    stamp(id, data);
    return dbSetMany([[keyOf(id), data], [META_KEY, meta]]);
  }

  /* ----- Backup ----- */
  // One file with everything in Rojak. It is laid out like a Money Tracker backup (app, state, images), so the
  // money tracker's own "Import backup" button restores it; later modules' data is kept under `rojak`.
  async function exportBackup() {
    await loadMeta();
    const keys = await dbKeys();
    const images = {}, modules = {};
    for (const k of keys) {
      if (typeof k !== 'string') continue;
      if (k.startsWith('img:')) images[k.slice(4)] = await dbGet(k);
      else if (k.startsWith('mod:')) modules[k.slice(4)] = await dbGet(k);
    }
    const exportedAt = new Date().toISOString();
    const backup = { app: 'money-tracker', version: 2, exportedAt, state: (await dbGet(keyOf('money'))) || null, images,
      rojak: { version: 1, modules, meta } };
    if (!backup.state) backup.state = { accounts: [], transactions: [], reconciliations: [] };
    const name = `rojak-backup-${exportedAt.slice(0, 10)}.json`;
    const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
    const file = new File([blob], name, { type: 'application/json' });
    const done = async () => { meta.lastBackupAt = exportedAt; await dbSet(META_KEY, meta); };

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

  const lastBackupAt = async () => (await loadMeta()).lastBackupAt;

  return { load, save, exportBackup, lastBackupAt };
})();
