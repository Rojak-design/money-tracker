/* Rojak — the one data store shared by the home screen and every module, kept on this device (IndexedDB).

   Layout (one database, one key/value store):
     'state'        the Money module's data — the same place the money tracker has always saved it,
                    so everything saved earlier still loads
     'mod:<id>'     each later module's data (Habits, Fitness, …)
     'img:<id>'     screenshots
     'rojak:meta'   when each entry was first saved and last changed, when the last backup was made and when
                    data was last restored or deleted
     'rojak:undo'   a copy of everything (except screenshots) made just before the last restore or delete,
                    so it can be undone

   Every entry a module saves (every object with an id in one of its lists) is dated:
     savedAt    when it was first saved (ISO date-time)
     updatedAt  when it last changed
   The dates are written onto the entry and also kept in 'rojak:meta', so they survive even when a module
   replaces an entry with a new copy. They let modules be compared later.

   Backup and restore are done for the whole app from the home screen (one file with every module). Screenshots
   are read for their numbers and not kept, and backups never contain them. */
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
  // Each module: its name, where its data is kept and which of its lists hold entries to date.
  // Modules not listed here are kept under 'mod:<id>' and every list in them is dated.
  const MODULES = {
    money: { name: 'Money', key: 'state', collections: ['accounts', 'transactions', 'reconciliations', 'recurring', 'projects', 'trips'] },
    fitness: { name: 'Fitness' }
  };
  const keyOf = (id) => (MODULES[id] && MODULES[id].key) || 'mod:' + id;
  const nameOf = (id) => (MODULES[id] && MODULES[id].name) || id.charAt(0).toUpperCase() + id.slice(1);
  const UNDO_KEY = 'rojak:undo';
  const emptyMeta = () => ({ schema: 1, stamps: {}, lastBackupAt: null, changedAt: null });
  let meta = null;
  // Always read fresh: another screen (e.g. the home screen) may have changed it since this one opened.
  async function loadMeta() {
    meta = Object.assign(emptyMeta(), (await dbGet(META_KEY)) || {});
    return meta;
  }
  // When everything was last restored or deleted, as this screen knew it when it loaded its data.
  let seenChange;

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
    seenChange = meta.changedAt;
    return dbGet(keyOf(id));
  }
  // If everything was restored or deleted (on the home screen) after this screen loaded its data, the data on
  // this screen is old: it reloads instead of saving it over the restored data.
  function staleScreen() {
    if (seenChange === undefined || meta.changedAt === seenChange) return false;
    location.reload();
    return true;
  }
  async function save(id, data) {
    await loadMeta();
    if (staleScreen()) return;
    stamp(id, data);
    return dbSetMany([[keyOf(id), data], [META_KEY, meta]]);
  }
  // Coming back to a screen that was left open after a restore shows the restored data.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && seenChange !== undefined) loadMeta().then(staleScreen).catch(() => {});
  });
  window.addEventListener('pageshow', (e) => {
    if (e.persisted && seenChange !== undefined) loadMeta().then(staleScreen).catch(() => {});
  });

  // Every module's data in the store: { id: data }.
  async function allModules() {
    const out = {};
    for (const k of await dbKeys()) {
      if (typeof k !== 'string') continue;
      if (k === MODULES.money.key) out.money = await dbGet(k);
      else if (k.startsWith('mod:')) out[k.slice(4)] = await dbGet(k);
    }
    return out;
  }
  // How many entries a module's data holds, e.g. "4 accounts, 812 transactions".
  function describe(data) {
    if (!data || typeof data !== 'object') return 'nothing saved';
    const parts = Object.keys(data).filter((k) => Array.isArray(data[k]) && data[k].length && data[k].some((x) => x && typeof x === 'object' && x.id != null))
      .map((k) => {
        const n = data[k].length, word = k.replace(/([A-Z])/g, ' $1').toLowerCase();
        return `${n} ${n === 1 ? word.replace(/ies$/, 'y').replace(/s$/, '') : word}`;
      });
    return parts.length ? parts.join(', ') : 'nothing saved yet';
  }

  /* ----- Backup ----- */
  // One file with every module's data (no screenshots).
  async function exportBackup() {
    await loadMeta();
    const exportedAt = new Date().toISOString();
    const backup = { app: 'rojak', version: 3, exportedAt, modules: await allModules(), meta: { schema: meta.schema, stamps: meta.stamps } };
    const name = `rojak-backup-${exportedAt.slice(0, 10)}.json`;
    const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
    const file = new File([blob], name, { type: 'application/json' });
    const done = async () => { await loadMeta(); meta.lastBackupAt = exportedAt; await dbSet(META_KEY, meta); };

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

  /* ----- Restore ----- */
  // Reads a backup file's text. Understands Rojak backups and the money tracker's older backup files.
  // Returns { exportedAt, modules: { id: data }, stamps } or throws if it isn't a backup.
  function readBackup(text) {
    const data = JSON.parse(text);
    if (data && data.app === 'rojak' && data.modules && typeof data.modules === 'object') {
      return { exportedAt: data.exportedAt || null, modules: data.modules, stamps: (data.meta && data.meta.stamps) || {} };
    }
    if (data && data.app === 'money-tracker' && data.state && Array.isArray(data.state.accounts)) {
      // Older files: the money tracker's own backups, and earlier home-screen backups (other modules under `rojak`).
      const modules = Object.assign({}, (data.rojak && data.rojak.modules) || {}, { money: data.state });
      return { exportedAt: data.exportedAt || null, modules, stamps: (data.rojak && data.rojak.meta && data.rojak.meta.stamps) || {} };
    }
    throw new Error('not a Rojak backup');
  }
  // Keeps a copy of everything (except screenshots) so the next restore or delete can be undone.
  async function keepUndo(what) {
    await loadMeta();
    await dbSet(UNDO_KEY, { at: new Date().toISOString(), what, modules: await allModules(), stamps: meta.stamps });
  }
  // Screenshots saved by older versions are kept on the phone only while the entry they belong to exists.
  function dropMissingImages(id, data, haveImage) {
    if (id !== 'money' || !data || !Array.isArray(data.reconciliations)) return;
    for (const r of data.reconciliations) if (r && r.hasImage && !haveImage.has('img:' + r.id)) r.hasImage = false;
  }
  // Replaces the chosen modules with their data from the backup; the others stay as they are.
  async function restore(backup, ids) {
    await keepUndo('restore');
    const keys = new Set(await dbKeys());
    const writes = [];
    for (const id of ids) {
      const data = backup.modules[id];
      if (data == null) continue;
      dropMissingImages(id, data, keys);
      writes.push([keyOf(id), data]);
      if (backup.stamps[id]) meta.stamps[id] = backup.stamps[id]; else delete meta.stamps[id];
    }
    meta.changedAt = new Date().toISOString();
    seenChange = meta.changedAt; // this screen is up to date
    writes.push([META_KEY, meta]);
    await dbSetMany(writes);
  }
  // Puts back everything as it was just before the last restore or delete.
  async function undo() {
    const u = await dbGet(UNDO_KEY);
    if (!u) return false;
    await loadMeta();
    const keys = new Set(await dbKeys());
    const writes = [];
    // Modules added by the restore that weren't there before are removed again.
    const del = [];
    for (const k of keys) if (typeof k === 'string' && (k === MODULES.money.key || k.startsWith('mod:'))) del.push(k);
    for (const [id, data] of Object.entries(u.modules)) { dropMissingImages(id, data, keys); writes.push([keyOf(id), data]); }
    meta.stamps = u.stamps || {};
    meta.changedAt = new Date().toISOString();
    seenChange = meta.changedAt;
    writes.push([META_KEY, meta]);
    await dbDo('readwrite', (s) => { for (const k of del) s.delete(k); let r; for (const [k, v] of writes) r = s.put(v, k); s.delete(UNDO_KEY); return r; });
    return true;
  }
  const undoInfo = async () => { const u = await dbGet(UNDO_KEY); return u ? { at: u.at, what: u.what } : null; };

  /* ----- Delete ----- */
  // Deletes every module's data and every screenshot. A copy (without screenshots) is kept so it can be undone.
  async function deleteAll() {
    await keepUndo('delete');
    const lastBackupAt = meta.lastBackupAt;
    await dbDo('readwrite', (s) => {
      const r = s.getAllKeys();
      r.onsuccess = () => { for (const k of r.result) if (k !== UNDO_KEY) s.delete(k); };
      return r;
    });
    meta = Object.assign(emptyMeta(), { lastBackupAt, changedAt: new Date().toISOString() });
    seenChange = meta.changedAt;
    await dbSet(META_KEY, meta);
  }
  // Screenshots saved by older versions of the money tracker: how many there are and about how big.
  async function screenshotsInfo() {
    let count = 0, bytes = 0;
    for (const k of await dbKeys()) {
      if (typeof k !== 'string' || !k.startsWith('img:')) continue;
      const v = await dbGet(k);
      count++; bytes += typeof v === 'string' ? v.length : 0;
    }
    return { count, bytes };
  }
  async function deleteScreenshots() {
    const keys = (await dbKeys()).filter((k) => typeof k === 'string' && k.startsWith('img:'));
    await dbDo('readwrite', (s) => { let r; for (const k of keys) r = s.delete(k); return r; });
    // The reconciliations no longer have a screenshot to show.
    await loadMeta();
    const money = await dbGet(MODULES.money.key);
    if (money && Array.isArray(money.reconciliations) && money.reconciliations.some((r) => r.hasImage)) {
      for (const r of money.reconciliations) r.hasImage = false;
      stamp('money', money);
      meta.changedAt = new Date().toISOString();
      seenChange = meta.changedAt;
      await dbSetMany([[MODULES.money.key, money], [META_KEY, meta]]);
    }
    return keys.length;
  }

  const lastBackupAt = async () => (await loadMeta()).lastBackupAt;

  return { load, save, exportBackup, lastBackupAt, readBackup, restore, undo, undoInfo, deleteAll,
    screenshotsInfo, deleteScreenshots, describe, nameOf, allModules };
})();
