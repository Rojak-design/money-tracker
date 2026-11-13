/* Fitness — reading screenshots (Garmin Connect, Whoop) to fill in the calendar and a day's recovery.

   Everything happens on this phone: the screenshots are read with the same bundled reader as the money tracker
   (Tesseract.js in ../money/ocr, loaded the first time it's needed) and are never saved. Several screenshots can be
   picked at once; what they show is put together and opens in a form to check before saving.

   What is read:
     Garmin Connect  All Activities list               each activity's name, date and time → the calendar
                     At a Glance and other day pages   resting heart rate, HRV, Body Battery, sleep score
     Whoop           recovery, strain and sleep pages  recovery %, HRV, resting heart rate, sleep performance,
                                                       strain, hours of sleep */
'use strict';

/* ---------- Reading the text in a screenshot ---------- */
let ocrWorker = null, ocrProgress = null;
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('Could not load ' + src));
    document.head.appendChild(s);
  });
}
async function getOcr() {
  if (ocrWorker) return ocrWorker;
  if (!window.Tesseract) await loadScript('../money/ocr/tesseract.min.js');
  ocrWorker = await Tesseract.createWorker('eng', 1 /* LSTM only */, {
    workerPath: '../money/ocr/worker.min.js', corePath: '../money/ocr/core', langPath: '../money/ocr/lang', gzip: true, workerBlobURL: false,
    logger: (m) => { if (ocrProgress && m.status === 'recognizing text') ocrProgress(m.progress); }
  });
  return ocrWorker;
}

// Greyscale; dark screens are flipped to dark text on white, and grey card backgrounds made white, which the
// reader handles much better.
async function prepImage(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  await img.decode();
  const scale = Math.min(1, 1440 / img.width);
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0, c.width, c.height);
  const d = g.getImageData(0, 0, c.width, c.height), a = d.data;
  let sum = 0;
  for (let i = 0; i < a.length; i += 4) sum += 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2];
  const dark = sum / (a.length / 4) < 110;
  for (let i = 0; i < a.length; i += 4) {
    let y = 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2];
    if (dark) y = 255 - y;
    y = y < 165 ? Math.max(0, (y - 40) * 1.6) : 255;
    a[i] = a[i + 1] = a[i + 2] = Math.min(255, y);
  }
  g.putImageData(d, 0, 0);
  return { canvas: c, url };
}

// The text of a screenshot as lines, each with its position and words.
async function readShot(canvas) {
  const W = await getOcr();
  await W.setParameters({ tessedit_pageseg_mode: '4', preserve_interword_spaces: '1', tessedit_char_whitelist: '' });
  const r = await W.recognize(canvas, {}, { text: true, blocks: true });
  const lines = [];
  const box = (b) => ({ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 });
  for (const bl of r.data.blocks || []) for (const pa of bl.paragraphs) for (const ln of pa.lines) {
    const text = ln.text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    lines.push(Object.assign({ text, words: ln.words.map((w) => Object.assign({ text: w.text.trim() }, box(w.bbox))).filter((w) => w.text) }, box(ln.bbox)));
  }
  lines.sort((p, q) => p.y0 - q.y0 || p.x0 - q.x0);
  return { canvas, lines, text: lines.map((l) => l.text).join('\n'), W: canvas.width };
}

// Letters a big bold number is sometimes read as ("44" → "4h", "Lh" or "4a" in Whoop's font).
const LOOKALIKE = { h: '4', A: '4', L: '4', a: '4', l: '1', I: '1', i: '1', '|': '1', O: '0', o: '0', S: '5', s: '5', B: '8', Z: '2', z: '2', b: '6', g: '9', q: '9' };
// Reads the number in one part of the screenshot again, enlarged (big, thin or bold numbers such as Whoop's are
// often missed when the whole screenshot is read). It's read at two sizes, as digits only and as any text with
// look-alike letters turned into digits — each works for different numbers ("111" as digits at 3×, "44" as text at
// 2×) — and the reading with the most digits is kept. Returns the first line.
async function readNumberAt(shot, x0, y0, x1, y1, allow = '0123456789.,:%') {
  const c = shot.canvas;
  x0 = Math.max(0, Math.round(x0)); y0 = Math.max(0, Math.round(y0));
  x1 = Math.min(c.width, Math.round(x1)); y1 = Math.min(c.height, Math.round(y1));
  if (x1 - x0 < 8 || y1 - y0 < 8) return '';
  const W = await getOcr();
  const digits = (t) => t.replace(/\D/g, '').length;
  let best = '';
  for (const [K, wl] of [[3, allow], [2, allow], [2, ''], [3, '']]) {
    const PAD = 40;
    const crop = document.createElement('canvas');
    crop.width = (x1 - x0) * K + PAD * 2; crop.height = (y1 - y0) * K + PAD * 2;
    const g = crop.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, crop.width, crop.height);
    g.imageSmoothingQuality = 'high';
    g.drawImage(c, x0, y0, x1 - x0, y1 - y0, PAD, PAD, (x1 - x0) * K, (y1 - y0) * K);
    await W.setParameters({ tessedit_pageseg_mode: '6', tessedit_char_whitelist: wl });
    const r = await W.recognize(crop);
    let txt = (r.data.text.split('\n').map((x) => x.trim()).find(Boolean) || '').replace(/[.,]+$/, '');
    // As any text: only the first word, with look-alike letters as digits ("4h" → "44"); kept only if it's a number.
    if (!wl) { txt = (txt.split(/\s+/)[0] || '').replace(/[hALalIi|OoSsBZzbgq]/g, (ch) => LOOKALIKE[ch]); if (!/^\d+(?:[.,:]\d+)?%?$/.test(txt)) txt = ''; }
    if (digits(txt) > digits(best)) best = txt;
  }
  return best;
}

/* ---------- Small helpers ---------- */
const NUM = /^[+-]?\d+(?:[.,]\d+)?%?$/;
const toNum = (s) => (s == null ? null : parseFloat(String(s).replace(',', '.')));
// "28:32.8" → 1712.8 s, "1:41:15.1" → 6075.1 s (rounded only once everything is added up).
function clockSec(s) {
  const m = String(s).replace(',', '.').match(/^(\d{1,3}):(\d{2})(?::(\d{2}))?(?:\.(\d))?$/);
  if (!m) return null;
  const t = m[3] != null ? +m[1] * 3600 + +m[2] * 60 + +m[3] : +m[1] * 60 + +m[2];
  return t + (m[4] ? +m[4] / 10 : 0);
}
// The first number in a piece of text (e.g. "111 ▲" → 111, "65%" → 65, "7:12" → as hours when asked).
function firstNumber(s, asHours) {
  const t = String(s || '');
  if (asHours) {
    let m = t.match(/(\d{1,2})\s*[:h]\s*(\d{1,2})/);
    if (m) return +m[1] + +m[2] / 60;
  }
  const m = t.match(/\d+(?:[.,]\d+)?/);
  return m ? toNum(m[0]) : null;
}
// A line without the icons read as letters before it ("»~7 Warm Up" → "Warm Up"), and common misreadings fixed
// ("Al." → "A1.", "IRM" → "1RM").
// An icon read as a digit touches it ("»~7 Warm Up"); a real number has a space before it ("® 4 sets of 3 reps").
const cleanLine = (s) => s.replace(/^[^A-Za-z0-9\s]+\s+(?=[A-Z][0-9]?[.,)]\s)/, '').replace(/^[^A-Za-z0-9\s(+@-]+\d?\s*(?=[A-Za-z]|\d+\s+(?:alternating|sets|rounds))/, '').replace(/^[^A-Za-z0-9(+@-]+/, '')
  .replace(/^([A-Z])[lI|]([.)])/, '$11$2').replace(/\bIRM\b/g, '1RM').replace(/\s+[@®©]$/, '').replace(/\s+/g, ' ').trim();
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
// A date written in a workout screenshot ("Thu, Nov 13", "13 Nov 2026", "November 13, 2026", "Yesterday").
function findDate(text) {
  if (/\byesterday\b/i.test(text)) { const d = new Date(); d.setDate(d.getDate() - 1); return isoDay(d); }
  if (/\btoday\b/i.test(text)) return today();
  const mon = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';
  let m = text.match(new RegExp(`\\b(\\d{1,2})\\s+${mon}(?:\\s+(\\d{4}))?(?!\\s*[—–-])`, 'i'));
  let day, month, year;
  if (m) { day = +m[1]; month = MONTHS.indexOf(m[2].toLowerCase()); year = m[3] ? +m[3] : null; }
  else if ((m = text.match(new RegExp(`\\b${mon}\\s+(\\d{1,2})(?:,?\\s+(\\d{4}))?\\b`, 'i')))) { month = MONTHS.indexOf(m[1].toLowerCase()); day = +m[2]; year = m[3] ? +m[3] : null; }
  else return null;
  if (!(day >= 1 && day <= 31) || month < 0) return null;
  const now = new Date();
  if (!year) { year = now.getFullYear(); if (new Date(year, month, day) > now) year--; }
  return isoDay(new Date(year, month, day));
}

/* ---------- Garmin Connect: All Activities list ---------- */
// The line under an activity's name: "11 Nov @ 19:19", "9 Nov 2025 @ 18:40", "Today @ 07:05" (the @ is sometimes
// read as ® or ©).
const WHEN = /^(?:(\d{1,2})\s+([A-Za-z]{3,5})\.?(?:\s+(\d{4}))?|(today|yesterday))\s*[@®©Q]?\s*(\d{1,2})[:.](\d{2})\b/i;
// Each activity: { date, time, name }. The name is the line above its date. Only the words lined up with the date
// are kept: the activity's icon to their left is often read as letters ("ES Weightlifting"), and the duration or
// distance is at the right ("44:34", "8.00 km").
function parseActivityList(shot) {
  const out = [];
  const L = shot.lines;
  for (let i = 1; i < L.length; i++) {
    const ws = L[i].words;
    let k = 0, m = null;
    for (; k < Math.min(3, ws.length); k++) if ((m = ws.slice(k).map((w) => w.text).join(' ').match(WHEN))) break;
    if (!m) continue;
    const date = m[4] ? findDate(m[4]) : findDate(`${m[1]} ${m[2]}${m[3] ? ' ' + m[3] : ''}`);
    if (!date) continue;
    const colX = ws[k].x0, h = L[i].y1 - L[i].y0;
    // The nearest line above with words in the date's column.
    let name = '';
    for (let j = i - 1; j >= 0 && L[i].y0 - L[j].y1 < h * 4; j--) {
      const words = L[j].words.filter((w) => w.x0 >= colX - h && w.x0 < shot.W * 0.72).map((w) => w.text);
      name = cleanLine(words.join(' ')).replace(/\s+[\d:.,]+\s*(km|mi|m|kcal)?\s*$/i, '').trim();
      if (/[A-Za-z]{2,}/.test(name)) break;
    }
    if (!/[A-Za-z]{2,}/.test(name) || WHEN.test(name) || /\bactivities\b|^search$/i.test(name)) continue;
    out.push({ date, time: `${pad(+m[5])}:${m[6]}`, name });
  }
  return out;
}

/* ---------- What kind of screenshot is it? ---------- */
function detect(shot) {
  const t = shot.text;
  if (/WH\W?OO\W?P|HEART RATE VARIABILITY|SLEEP PERFORMANCE|DAY STRAIN|^\W*STRAIN\W*$/m.test(t)) return 'whoop';
  shot.acts = parseActivityList(shot);
  if (shot.acts.length) return 'garminList';
  if (/at a\s*glance|body battery|hrv status|\bresting\b|sleep score|training readiness|overnight hrv/i.test(t)) return 'garminDay';
  return null;
}

/* ---------- Recovery: Whoop ---------- */
async function parseWhoop(shot, rec) {
  const L = shot.lines;
  // Recovery %: the big number just above "RECOVERY".
  const ri = L.findIndex((l) => /^\W*RECOVERY\W*$/.test(l.text));
  if (ri > 0) {
    const above = L.slice(Math.max(0, ri - 2), ri).reverse().find((l) => /\d{1,3}\s*%/.test(l.text));
    const v = above ? firstNumber(above.text) : null;
    if (v != null && v <= 100) put(rec, 'recoveryScore', v, 'Whoop', 'Whoop recovery');
  }
  const si = L.findIndex((l) => /^\W*STRAIN\W*$/.test(l.text));
  if (si > 0) {
    const above = L.slice(Math.max(0, si - 2), si).reverse().find((l) => /^\W*\d{1,2}[.,]\d\W*$/.test(l.text));
    if (above) put(rec, 'strain', firstNumber(above.text), 'Whoop', 'Whoop strain');
  }
  const rows = [
    [/HEART RATE VARIABILITY|\bHRV\b/, 'hrvMs', 'Whoop HRV'],
    [/RESTING HEART RATE/, 'restingHr', 'Whoop resting heart rate'],
    [/SLEEP PERFORMANCE/, 'sleepScore', 'Whoop sleep performance'],
    [/DAY STRAIN/, 'strain', 'Whoop strain'],
    [/HOURS OF SLEEP|TIME ASLEEP/, 'sleepHours', 'Whoop hours of sleep']
  ];
  for (const [re, key, note] of rows) {
    const l = L.find((x) => re.test(x.text));
    if (!l) continue;
    // The value is at the right end of the label's row: read that part again, enlarged.
    const lastLabelWord = [...l.words].reverse().find((w) => /^[A-Z]{3,}$/.test(w.text)) || l.words[l.words.length - 1];
    const h = l.y1 - l.y0;
    // Letters only for a sleep time ("7h 12m"); otherwise a 4 can come back as an h.
    const txt = await readNumberAt(shot, lastLabelWord.x1 + 8, l.y0 - h * 0.6, shot.W, l.y1 + h * 0.6, key === 'sleepHours' ? '0123456789:hm ' : undefined);
    // The value on the label's own line, with look-alike letters as digits ("4a" → "44").
    const onLine = (l.text.slice(l.text.search(re)).replace(re, '').trim().split(/\s+/)[0] || '').replace(/[hALalIi|OoSsBZzbgq]/g, (ch) => LOOKALIKE[ch]);
    const v = [firstNumber(txt, key === 'sleepHours'), firstNumber(onLine, key === 'sleepHours')].find((x) => fits(key, x));
    if (v != null) put(rec, key, v, 'Whoop', note);
  }
}

/* ---------- Recovery: Garmin day pages (At a Glance, HRV status, sleep…) ---------- */
// The number nearest a label in the same card: above or below it.
function nearNumber(shot, labelWord, dir, maxDist, test = () => true) {
  const cardL = labelWord.x0 - shot.W * 0.05, cardR = labelWord.x0 + shot.W * 0.45;
  let best = null;
  for (const l of shot.lines) for (const w of l.words) {
    if (!NUM.test(w.text) || /^[+-]/.test(w.text) || !test(w, l)) continue;
    const cx = (w.x0 + w.x1) / 2;
    if (cx < cardL || cx > cardR) continue;
    const dist = dir === 'above' ? labelWord.y0 - w.y1 : w.y0 - labelWord.y1;
    if (dist < -2 || dist > maxDist) continue;
    if (!best || dist < best.dist) best = { w, l, dist };
  }
  return best;
}
const findWord = (shot, re) => { for (const l of shot.lines) for (const w of l.words) if (re.test(w.text)) return Object.assign({ line: l }, w); return null; };
function parseGarminDay(shot, rec) {
  const W = shot.W;
  // Resting heart rate: "48 bpm" above "Resting".
  const rest = findWord(shot, /^Resting$/i);
  if (rest) { const n = nearNumber(shot, rest, 'above', W * 0.15, (w, l) => /bpm/i.test(l.text)); if (n) put(rec, 'restingHr', toNum(n.w.text), 'Garmin', 'Garmin resting heart rate'); }
  const rhrLine = shot.lines.find((l) => /resting heart rate/i.test(l.text) && /\d+\s*bpm/i.test(l.text));
  if (rhrLine && rec.values.restingHr == null) put(rec, 'restingHr', firstNumber(rhrLine.text.match(/(\d+)\s*bpm/i)[1]), 'Garmin', 'Garmin resting heart rate');
  // HRV: "83 ms" in the HRV Status card (Garmin shows the 7-day average there).
  const hrvLabel = findWord(shot, /^HRV$/i);
  if (hrvLabel) {
    const n = nearNumber(shot, hrvLabel, 'below', W * 0.4, (w, l) => /\bms\b/i.test(l.text));
    if (n) {
      const avg7 = /7\s*d|7-day|avg/i.test(shot.lines.slice(shot.lines.indexOf(n.l), shot.lines.indexOf(n.l) + 2).map((x) => x.text).join(' '));
      put(rec, 'hrvMs', toNum(n.w.text), 'Garmin', avg7 ? 'Garmin HRV — the 7-day average; for last night\'s, screenshot the HRV Status page' : 'Garmin HRV', avg7);
    }
  }
  const night = shot.lines.find((l) => /(last night|overnight).{0,12}(avg|hrv)/i.test(l.text) && /\d+\s*ms/i.test(l.text));
  if (night) put(rec, 'hrvMs', toNum(night.text.match(/(\d+)\s*ms/i)[1]), 'Garmin', 'Garmin HRV (last night)');
  // Body Battery: the number in its ring, below the label.
  const bb = findWord(shot, /^Battery$/i);
  if (bb) { const n = nearNumber(shot, bb, 'below', W * 0.3, (w) => !/%/.test(w.text)); if (n && toNum(n.w.text) <= 100) put(rec, 'bodyBattery', toNum(n.w.text), 'Garmin', 'Garmin Body Battery'); }
  // Sleep score (unless Garmin says no sleep was detected).
  const sl = shot.lines.find((l) => /sleep score/i.test(l.text));
  if (sl && !/no sleep/i.test(shot.text)) {
    const same = sl.text.match(/sleep score\D{0,4}(\d{1,3})\b/i);
    const w = sl.words.find((x) => /^score$/i.test(x.text)) || sl.words[0];
    const n = same ? null : nearNumber(shot, w, 'below', W * 0.3);
    const v = same ? +same[1] : n ? toNum(n.w.text) : null;
    if (v != null && v <= 100) put(rec, 'sleepScore', v, 'Garmin', 'Garmin sleep score');
  }
  const dur = shot.lines.find((l) => /(sleep duration|total sleep|time asleep)/i.test(l.text) && /\d+\s*h/i.test(l.text));
  if (dur) { const m = dur.text.match(/(\d{1,2})\s*h\s*(\d{1,2})?/i); put(rec, 'sleepHours', +m[1] + (+m[2] || 0) / 60, 'Garmin', 'Garmin sleep'); }
}
// A number that makes sense for a recovery field.
function fits(key, v) {
  const f = RECOVERY_FIELDS.find((x) => x.key === key);
  return v != null && !isNaN(v) && (!f || (v >= f.min && v <= f.max)) && !(key === 'restingHr' && v < 30) && !(key === 'hrvMs' && v < 5);
}
// Keeps a number read for a field. A `weak` one (e.g. Garmin's 7-day average HRV) doesn't replace one already read
// from another screenshot (e.g. Whoop's last night HRV).
// The worse of two numbers for a field: lower recovery, HRV, sleep and Body Battery; higher resting heart rate and strain.
const HIGHER_IS_WORSE = ['restingHr', 'strain'];
const worse = (key, a, b) => (HIGHER_IS_WORSE.includes(key) ? Math.max(a, b) : Math.min(a, b));
// When Whoop and Garmin give different numbers for the same thing, the worse one is used and both are shown.
// Garmin's 7-day average HRV (`weak`) isn't last night's, so it's only used when no last-night HRV was read.
function put(rec, key, v, source, note, weak) {
  if (!fits(key, v)) return;
  if (weak && rec.values[key] != null && !rec.weak[key]) return;
  if (!weak && rec.values[key] != null && !rec.weak[key]) {
    if (rec.values[key] === v || rec.source[key] === source) return;
    const w = worse(key, rec.values[key], v);
    rec.notes[key] = `${rec.source[key]} ${rec.values[key]} · ${source} ${v} — the worse is used`;
    if (w === v) rec.source[key] = source;
    rec.values[key] = w;
    return;
  }
  const f = RECOVERY_FIELDS.find((x) => x.key === key);
  rec.values[key] = round(v, f ? f.dp : 1); rec.source[key] = source; rec.notes[key] = note;
  rec.weak[key] = !!weak;
}

/* ---------- Picking screenshots and reading them ---------- */
let lastUrls = [];
const fileInput = document.createElement('input');
fileInput.type = 'file'; fileInput.accept = 'image/*'; fileInput.multiple = true; fileInput.hidden = true;
document.body.appendChild(fileInput);
$$('[data-import]').forEach((b) => b.addEventListener('click', () => { fileInput.value = ''; fileInput.click(); }));
fileInput.addEventListener('change', () => { if (fileInput.files.length) importShots([...fileInput.files]); });

const KIND_NAMES = { garminList: 'Garmin activities', garminDay: 'Garmin day', whoop: 'Whoop' };

async function importShots(files) {
  for (const u of lastUrls) URL.revokeObjectURL(u);
  lastUrls = [];
  openSheet('Reading screenshots', `<div class="form">
      <p class="muted small" style="margin:0">Reading on this phone — nothing is uploaded, and the screenshots aren't kept.</p>
      <div class="progress"><div id="ocrBar"></div></div>
      <div id="ocrList" class="pick-list small"></div></div>`);
  const shots = [];
  for (const [i, file] of files.entries()) {
    const row = document.createElement('div');
    row.textContent = `Screenshot ${i + 1} of ${files.length}…`;
    $('#ocrList') && $('#ocrList').appendChild(row);
    ocrProgress = (p) => { const bar = $('#ocrBar'); if (bar) bar.style.width = `${((i + p) / files.length) * 100}%`; };
    try {
      const { canvas, url } = await prepImage(file);
      lastUrls.push(url);
      const shot = await readShot(canvas);
      shot.kind = detect(shot);
      shot.url = url;
      shots.push(shot);
      row.textContent = `Screenshot ${i + 1}: ${shot.kind ? KIND_NAMES[shot.kind] : 'nothing recognised'}`;
    } catch (err) {
      console.error(err);
      row.textContent = `Screenshot ${i + 1}: could not be read`;
    }
  }
  ocrProgress = null;
  if (!$('#ocrList')) return; // closed while reading
  await review(shots);
}

// Puts together what the screenshots show and opens the forms to check it: activities first, then recovery.
async function review(shots) {
  const listShots = shots.filter((s) => s.kind === 'garminList');
  const dayShots = shots.filter((s) => s.kind === 'whoop' || s.kind === 'garminDay');
  const steps = [];

  if (listShots.length) {
    // Overlapping screenshots of the list: each activity once.
    const seen = new Set(), rows = [];
    for (const s of listShots) for (const r of s.acts) {
      const k = `${r.date} ${r.time} ${r.name.toLowerCase()}`;
      if (!seen.has(k)) { seen.add(k); rows.push(r); }
    }
    rows.sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
    steps.push(() => activitiesSheet(rows, listShots, next));
  }

  if (dayShots.length) {
    const rec = { values: {}, source: {}, notes: {}, weak: {} };
    for (const s of dayShots) {
      if (s.kind === 'whoop') await parseWhoop(s, rec);
      else parseGarminDay(s, rec);
    }
    const text = dayShots.map((s) => s.text).join('\n');
    const date = /\byesterday\b/i.test(text) ? findDate('yesterday') : today();
    // Against what's already saved for the day from the other app (e.g. Whoop this morning, Garmin now): the worse.
    const saved = state.recoveryDays.find((r) => r.date === date);
    if (saved && saved.sources) for (const key of Object.keys(rec.values)) {
      const was = saved[key], from = saved.sources[key];
      if (was == null || !from || from === rec.source[key] || was === rec.values[key]) continue;
      // Garmin's 7-day average HRV doesn't replace a last-night HRV already saved from Whoop.
      if (rec.weak[key]) { delete rec.values[key]; delete rec.source[key]; delete rec.notes[key]; continue; }
      const w = worse(key, was, rec.values[key]);
      rec.notes[key] = `${from} ${was} · ${rec.source[key]} ${rec.values[key]} — the worse is used`;
      if (w === was) rec.source[key] = from;
      rec.values[key] = w;
    }
    if (Object.keys(rec.values).length) {
      const had = state.recoveryDays.some((r) => r.date === date);
      steps.push(() => recoverySheet(null, Object.assign(rec, { date,
        banner: `<div class="import-banner"><div>📷 <strong>Read from ${dayShots.length} screenshot${dayShots.length > 1 ? 's' : ''}</strong> (${esc([...new Set(dayShots.map((s) => KIND_NAMES[s.kind]))].join(' + '))}). The numbers read are marked 📷 — check them against your screenshots. Nothing is saved until you tap Save.</div>
          ${had ? '<div>• You already have recovery for this day: the numbers read replace those numbers, the rest stay.</div>' : ''}
          <div>• Recovery screens show today's numbers — change the date if these are from another day.</div>
          ${thumbs(dayShots)}</div>`,
        onDone: () => { show('recovery'); next(); } })));
    }
  }

  if (!steps.length) {
    openSheet('Nothing found', `<div class="form">
      <p style="margin:0">Nothing could be read from ${shots.length > 1 ? 'these screenshots' : 'this screenshot'}.</p>
      <p class="muted small" style="margin:0">Screens that work: Garmin Connect <strong>All Activities</strong> (for the calendar), Garmin <strong>At a Glance</strong>, and Whoop <strong>recovery</strong>, <strong>sleep</strong> and <strong>strain</strong>.</p>
      ${shots.length ? thumbs(shots) : ''}
      <button type="button" class="btn secondary" data-close>Close</button></div>`);
    return;
  }
  function next() { const step = steps.shift(); if (step) step(); }
  next();
}
const thumbs = (list) => `<div class="shots">${list.map((s, i) => `<img src="${s.url}" alt="Screenshot ${i + 1}" data-shot>`).join('')}</div><div class="shot-view"></div>`;

// The activities read, each with its category to check. Ones already on the calendar are unticked.
function activitiesSheet(rows, shots, next) {
  reopen = () => activitiesSheet(rows, shots, next);
  const dup = (r) => state.activities.find((a) => a.date === r.date && (a.time ? a.time === r.time : sameName(a.name, r.name)));
  openSheet('Check imported activities', `<form class="form" id="iForm" novalidate>
      <div class="import-banner"><div>📷 <strong>Read ${rows.length} activit${rows.length > 1 ? 'ies' : 'y'}</strong> from ${shots.length} screenshot${shots.length > 1 ? 's' : ''}. Check each category — it's what shows on the calendar. Change the category for a name and that name gets it next time too. Nothing is saved until you tap Save.</div>
        <button type="button" class="link-btn" data-cats>Edit categories and icons ›</button>
        ${thumbs(shots)}</div>
      <div class="imp-list">${rows.map((r, i) => { const d = dup(r); return `<div class="imp-row${d ? ' dup' : ''}" data-i="${i}">
        <label class="check"><input type="checkbox" class="ion" ${d ? '' : 'checked'}>
          <span><strong>${esc(r.name)}</strong><br><span class="muted small">${esc(niceDate(r.date))} · ${esc(r.time)}${d ? ' · already on the calendar' : ''}</span></span></label>
        <select class="icat" aria-label="Category for ${esc(r.name)}">${catOptions(d ? d.catId : guessCat(r.name))}</select></div>`; }).join('')}</div>
      <button class="btn" type="submit">Save</button>
    </form>`);
  // Changing the category ticks the row (e.g. to fix one already on the calendar).
  $$('.imp-row').forEach((el) => $('.icat', el).addEventListener('change', () => { $('.ion', el).checked = true; }));
  $('#iForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    let added = 0, changed = 0, latest = null;
    for (const el of $$('.imp-row')) {
      if (!$('.ion', el).checked) continue;
      const r = rows[+el.dataset.i], catId = $('.icat', el).value, d = dup(r);
      if (catId !== guessCat(r.name)) state.nameCats[r.name.toLowerCase()] = catId;
      if (d) { d.catId = catId; d.name = r.name; d.time = r.time; changed++; }
      else { state.activities.push({ id: uid(), date: r.date, time: r.time, name: r.name, catId, source: 'Garmin' }); added++; }
      if (!latest || r.date > latest) latest = r.date;
    }
    await save();
    closeSheet();
    if (latest) calMonth = latest.slice(0, 7);
    show('calendar');
    toast(added || changed ? [added ? `Added ${added}` : '', changed ? `updated ${changed}` : ''].filter(Boolean).join(', ') : 'Nothing added');
    next();
  });
}

// Tap a screenshot to see it bigger (tap again to close).
document.addEventListener('click', (e) => {
  const img = e.target.closest('[data-shot]');
  const big = e.target.closest('.shot-big');
  if (big) { big.remove(); return; }
  if (!img) return;
  const view = img.closest('.shots').nextElementSibling;
  view.innerHTML = `<img class="shot-big" src="${img.src}" alt="${esc(img.alt)}">`;
});
