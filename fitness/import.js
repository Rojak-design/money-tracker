/* Fitness — filling in a workout or a day's recovery from screenshots (Garmin Connect, Whoop, WodUp).

   Everything happens on this phone: the screenshots are read with the same bundled reader as the money tracker
   (Tesseract.js in ../money/ocr, loaded the first time it's needed) and are never saved. Several screenshots can be
   picked at once (e.g. a Garmin activity that needs scrolling); what they show is put together. The numbers then
   open in the usual form with the screenshots above it, to check and fix before saving.

   What is read:
     Garmin Connect  activity Intervals / Laps tab   reps (time, distance, pace), rests, warm-up / cool-down, totals
                     Strength Training exercises       sets: movement, reps, kg ("Body" = no weight)
                     At a Glance and other day pages   resting heart rate, HRV, Body Battery, sleep score
                     activity Overview / Stats         distance, time, average pace, average heart rate, calories
     Whoop           recovery, strain and sleep pages  recovery %, HRV, resting heart rate, sleep performance,
                                                       strain, hours of sleep; a workout's average heart rate, calories
     Written workouts WodUp, Instagram posts, competition sheets…: movements with reps / sets / kg (weights you
                     can add), and the text as notes
   Stats can come from a different app than the workout (e.g. a WodUp workout + Garmin's average heart rate and
   calories): picked together, or added later with "Add numbers from screenshots" in the workout's form. */
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
const sentenceCase = (s) => s.charAt(0).toUpperCase() + s.slice(1);
// A movement name as you call it: renamed before (see importAliases), or one you already have (also matching
// "Back Squats" with "Back squat"), or as read.
function ownMoveName(read, t) {
  const aliases = state.importAliases || {};
  if (aliases[read.toLowerCase()]) return aliases[read.toLowerCase()];
  const single = read.replace(/s$/i, '');
  const known = ((t && t.movements) || []).concat(allMoveNames());
  return known.find((n) => sameName(n, read)) || known.find((n) => sameName(n, single)) || read;
}
// The workout type for an activity found in a screenshot, as you've set them up.
function findType(key) {
  const names = { run: ['Run', 'Running'], cycle: ['Cycle', 'Cycling', 'Ride', 'Bike'], swim: ['Swim', 'Swimming'], walk: ['Walk', 'Walking'],
    hike: ['Hike', 'Hiking'], strength: ['Strength', 'Strength Training'], crossfit: ['CrossFit'] }[key] || [key];
  const ts = state.workoutTypes;
  return ts.find((t) => t.id === key) || ts.find((t) => names.some((n) => sameName(n, t.name))) ||
    ts.find((t) => t.kind === (key === 'strength' || key === 'crossfit' ? 'strength' : 'cardio')) || ts[0];
}
function activityKey(text) {
  const head = text.split('\n').slice(0, 8).join(' ');
  if (/strength\s*training/i.test(head)) return 'strength';
  if (/crossfit/i.test(text)) return 'crossfit';
  if (/\b(running|run|treadmill|trail)\b/i.test(head)) return 'run';
  if (/\b(cycling|biking|ride|bike|spin)\b/i.test(head)) return 'cycle';
  if (/\b(swim|swimming|pool)\b/i.test(head)) return 'swim';
  if (/\b(walking|walk)\b/i.test(head)) return 'walk';
  if (/\b(hiking|hike)\b/i.test(head)) return 'hike';
  return null;
}
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

/* ---------- What kind of screenshot is it? ---------- */
const LAP_ROW = /(\d{1,2}(?::\d{2}){1,2}(?:[.,]\d)?)\s+(\d{1,4}(?:[.,]\d{1,2})?)\s+(\d{1,2}:\d{2}(?:[.,]\d)?|\d{1,3}[.,]\d)\s*$/;
const SET_ROW = /^\D{0,3}?(\d{1,2})\s+(.+?)\s+(\d{1,2}:?\d{2})\s+(\d{1,3})\s+(\d{1,3}(?:[.,]\d)?|Body|BW)\b/i;
const STATS = /\b(?:avg|average)\.?\s*(?:hr|heart rate)\b|\bcalories\b|\bkcal\b/i;
function detect(shot) {
  const t = shot.text;
  // A Whoop workout (strain, average heart rate, calories) is workout stats, not the day's recovery.
  if (/WH\W?OO\W?P/.test(t) && STATS.test(t) && !/RECOVERY|HEART RATE VARIABILITY/.test(t) && /\b(?:avg|average)\.?\s*(?:hr|heart)/i.test(t)) return 'garminActivity';
  if (/WH\W?OO\W?P|HEART RATE VARIABILITY|SLEEP PERFORMANCE|DAY STRAIN|^\W*STRAIN\W*$/m.test(t)) return 'whoop';
  if (shot.lines.filter((l) => SET_ROW.test(l.text)).length >= 2 || (/\bReps\b/i.test(t) && /\bWeight\b/i.test(t) && shot.lines.some((l) => SET_ROW.test(l.text)))) return 'garminStrength';
  if (shot.lines.filter((l) => LAP_ROW.test(l.text)).length >= 2) return 'garminLaps';
  if (/log\s*result|leaderboard|alternating sets|\bsets? of\b|rounds? (of|for)|\bAMRAP\b|\bEMOM\b|for time|time cap/i.test(t)) return 'wod';
  if (/at a\s*glance|body battery|hrv status|\bresting\b|sleep score|training readiness|overnight hrv/i.test(t)) return 'garminDay';
  if (/avg\.?\s*(pace|speed)|distance/i.test(t) || STATS.test(t)) return 'garminActivity';
  // Anything else with lines that look like movements ("5x5 back squat", "21 thrusters") is a written workout.
  if (writtenMoves(shot.lines.map((l) => cleanLine(l.text))).length >= 2) return 'wod';
  return null;
}

/* ---------- Garmin: intervals / laps ---------- */
function parseLaps(shot, acc) {
  let lastRep = acc.maxRep || 0;
  for (const l of shot.lines) {
    const m = l.text.match(LAP_ROW);
    if (!m) continue;
    const prefix = l.text.slice(0, m.index);
    const time = clockSec(m[1]), dist = toNum(m[2]), third = m[3];
    if (time == null || dist == null) continue;
    const row = { timeSec: time, dist, third };
    if (/total/i.test(prefix) || /^\W*T\w{0,2}al\b/i.test(prefix)) { acc.total = row; continue; }
    if (/\brest\b|recover/i.test(prefix)) { acc.rows['rest' + lastRep + ':' + time] = Object.assign(row, { kind: 'rest', after: lastRep }); continue; }
    const n = prefix.match(/(?:^|\s)(\d{1,3})\s+[A-Za-z]/);
    if (n) {
      lastRep = +n[1];
      acc.maxRep = Math.max(acc.maxRep || 0, lastRep);
      acc.rows['r' + lastRep] = Object.assign(row, { kind: 'rep', n: lastRep });
    } else {
      const label = /warm/i.test(prefix) ? 'Warm-up' : /cool|cod|down/i.test(prefix) ? 'Cool-down' : 'Other';
      acc.rows['x' + label + time] = Object.assign(row, { kind: 'extra', label });
    }
  }
}
function lapsToCardio(acc, t) {
  const how = t.pace;
  const km = (d) => (how === '100m' && d >= 25 && Number.isInteger(d) ? d / 1000 : d);
  const pace = (third, d, time) => {
    if (/:/.test(third)) { const s = clockSec(third.replace(/[.,]\d$/, '')); return s ? (how === '100m' ? s * 10 : s) : null; }
    const v = toNum(third);
    if (how === 'speed' && v > 0) return 3600 / v;
    return d > 0 ? time / d : null;
  };
  const rows = Object.values(acc.rows);
  const reps = rows.filter((r) => r.kind === 'rep').sort((p, q) => p.n - q.n);
  const rests = rows.filter((r) => r.kind === 'rest');
  const intervals = reps.map((r) => {
    const d = km(r.dist);
    const rest = rests.find((x) => x.after === r.n);
    return { distanceKm: round(d, 3), timeSec: Math.round(r.timeSec), paceSecPerKm: Math.round(pace(r.third, d, r.timeSec) || r.timeSec / d), restSec: rest ? Math.round(rest.timeSec) : null };
  });
  // Totals: Garmin's Total row when it could be read, otherwise every row added up.
  let timeSec = rows.reduce((n, r) => n + r.timeSec, 0), distanceKm = rows.reduce((n, r) => n + km(r.dist), 0);
  if (acc.total && acc.total.timeSec >= timeSec * 0.9 && km(acc.total.dist) >= distanceKm * 0.9) { timeSec = acc.total.timeSec; distanceKm = km(acc.total.dist); }
  const counts = {};
  for (const r of reps) counts[r.dist] = (counts[r.dist] || 0) + 1;
  const [modeDist, modeCount] = Object.entries(counts).sort((p, q) => q[1] - p[1])[0] || [0, 0];
  const structured = rows.some((r) => r.kind !== 'rep') || (reps.length >= 3 && modeCount >= reps.length * 0.6 && km(+modeDist) <= 2);
  timeSec = Math.round(timeSec);
  return { distanceKm: round(distanceKm, 3), timeSec, paceSecPerKm: distanceKm > 0 ? Math.round(timeSec / distanceKm) : null, intervals, structured,
    parts: { reps: reps.length, rests: rests.length, extras: rows.filter((r) => r.kind === 'extra').map((r) => r.label) } };
}

/* ---------- Garmin: strength sets ---------- */
function parseSets(shot, acc) {
  const lbs = /weight\s*\n?\s*lbs?\b/i.test(shot.text);
  let prev = null;
  for (const l of shot.lines) {
    const m = l.text.match(SET_ROW);
    if (m) {
      const nameWord = l.words[1] || l.words[0];
      const w = /body|bw/i.test(m[5]) ? null : toNum(m[5]);
      prev = acc.sets[+m[1]] = { n: +m[1], name: m[2].replace(/\s+/g, ' ').trim(), reps: +m[4], weightKg: w == null ? null : round(lbs ? w * 0.45359 : w, 1), x0: nameWord.x0, y1: l.y1, h: l.y1 - l.y0 };
      continue;
    }
    // A long name wraps onto the next line, starting under the name ("Barbell Reverse" / "Lunge").
    if (prev && /^[A-Za-z][A-Za-z' -]{1,30}$/.test(l.text) && l.text.split(' ').length <= 3 && Math.abs(l.x0 - prev.x0) < shot.W * 0.05 && l.y0 - prev.y1 < prev.h * 3) {
      prev.name += ' ' + l.text.trim();
      prev = null;
    }
  }
}
function setsToMovements(acc, t) {
  const order = [], byName = {};
  for (const s of Object.values(acc.sets).sort((p, q) => p.n - q.n)) {
    const key = s.name.toLowerCase();
    if (!byName[key]) { byName[key] = { importedName: s.name, name: ownMoveName(s.name, t), restSec: null, sets: [], first: s.n, last: s.n }; order.push(byName[key]); }
    byName[key].sets.push({ reps: s.reps, weightKg: s.weightKg });
    byName[key].last = s.n;
  }
  // Movements whose sets alternate (one's sets fall between the other's) were done round by round.
  let g = 0;
  for (let i = 0; i < order.length; i++) for (let j = i + 1; j < order.length; j++) {
    const a = order[i], b = order[j];
    if (b.first < a.last && a.first < b.last) { const id = a.group || b.group || 'g' + ++g; a.group = b.group = id; }
  }
  return order.map(({ first, last, ...m }) => Object.assign(m, { group: m.group || null }));
}

/* ---------- Written workouts: WodUp, Instagram posts, competition sheets… ---------- */
// Lines that are instructions or app buttons, not movements (kept out of the notes too where they're buttons).
const WOD_SKIP = /^(log\s*result|leaderboard|view warm ?up|warm ?up|show (less|more)|scoring|comments?|like|reply|view all|liked by|share|save)\b/i;
const NOT_MOVE = /^(rest|sets?|rounds?|reps?|minutes?|mins?|seconds?|secs?|for time|time cap|cap|every|then|each|with|build|scoring|score|notes?|tempo|rpe|and|or|of|at|in|on|the|a|an|total|weeks?|day|warm|cool|metcon|wod|skill|accessory|finisher|conditioning|strength|part|ascending|descending|ladder|pause|find)\b/i;
const KG = /(\d+(?:[.,]\d+)?)\s*(kgs?|lbs?|#)(?![a-z])/i;
// A movement name as written: letters (and - ' /), 2–6 words, not an instruction.
function moveName(raw, maxWords = 6) {
  const n = raw.replace(/\(.*?\)/g, '').replace(KG, '').replace(/\b\d+(?:[.,]\d+)?\s*\/\s*/g, '').replace(/@.*$/, '').replace(/[:;,.!]+$/, '').replace(/\s+/g, ' ').trim();
  if (!/^[A-Za-z][A-Za-z' /-]{1,70}[A-Za-z]$/.test(n) || n.split(' ').length > maxWords || NOT_MOVE.test(n)) return null;
  return n;
}
const kgOf = (raw) => { const m = raw.match(KG); if (!m) return null; const v = toNum(m[1]); return /lb|#/i.test(m[2]) ? round(v * 0.45359, 1) : v; };
// The movements in some lines of text: [{ read, reps, sets, kg, scheme, group }]. Movements under one "5 rounds",
// "5 alternating sets of" or "21-15-9" are done round by round (21 thrusters, 21 pull-ups, then 15 of each…): they
// get the same `group`.
function writtenMoves(lines) {
  const out = [];
  let sets = 1, scheme = null, block = 0, circuit = false;
  const push = (mv) => out.push(Object.assign({ blockAt: block }, mv, { inRounds: !!(scheme || sets > 1 || circuit) && !(mv.sets > 1 && mv.reps && !scheme && mv.sets !== sets) }));
  // A heading that names the movement ("A. Segmented Clean Pull", "B. Power Clean + Clean"), waiting for the line
  // with its sets and reps ("4 sets of 3 reps", "6 sets of @ 80%"). It may wrap onto the next line.
  let heading = null, headingOpen = false;
  for (const raw0 of lines) {
    if (!raw0 || WOD_SKIP.test(raw0) || /^[+#]/.test(raw0)) { headingOpen = false; continue; }
    let m = raw0.match(/^(\d{1,2})\s+(?:sets|rounds)\s+of\s*(?:(\d{1,3})\s*(?:reps?|x)\b)?/i);
    if (m && heading) {
      // Each part of a complex ("Power Clean + Clean") is a movement, done together in every set.
      const names = heading.split(/\s*\+\s*/).map((x) => moveName(x, 10)).filter(Boolean);
      block++;
      for (const n of names) out.push({ read: n, sets: +m[1], reps: m[2] ? +m[2] : null, kg: kgOf(raw0), blockAt: block, inRounds: names.length > 1 });
      heading = null; headingOpen = false;
      continue;
    }
    const hd = raw0.match(/^[A-Z][0-9]?[.,)]\s+([A-Za-z][^0-9]*)$/);
    if (hd && hd[1].split(/\s*\+\s*/).every((x) => moveName(x, 10))) { heading = hd[1].trim(); headingOpen = true; sets = 1; scheme = null; circuit = false; block++; continue; }
    if (heading && headingOpen && /^[A-Za-z][A-Za-z' -]+$/.test(raw0) && moveName(heading + ' ' + raw0, 10)) { heading += ' ' + raw0; headingOpen = false; continue; }
    headingOpen = false;
    if (heading && /^rest\b/i.test(raw0)) continue;
    // "5 rounds for time", "5 alternating sets of:", "3 rds"
    m = raw0.match(/(\d+)\s+(?:alternating\s+)?(?:sets|rounds|rds)\b/i);
    if (m && !/^\d+\s*x/i.test(raw0)) { sets = +m[1]; scheme = null; circuit = false; block++; continue; }
    // "AMRAP 12 min", "EMOM 10", "For time:" — the movements below are done round by round.
    if (/\b(AMRAP|EMOM|E\d+MOM)\b|^\W*for time\W*$/i.test(raw0) && !/^\d+\s+\w/.test(raw0)) { if (!scheme) { circuit = true; block++; } continue; }
    // A new part ("B.", "Part 2", "Metcon") starts again with one set.
    if (/^(?:[A-Z][.,)]|part\s+\d|metcon|strength|skill|accessory)(?:\s|$)/i.test(raw0) && !/^[A-Z][.,)]\s*\d/.test(raw0)) { sets = 1; scheme = null; circuit = false; block++; heading = null; }
    // Leave out part labels and bullets: "A1.", "B)", "1.", "-", "•". Men's/women's numbers ("12/10 calories",
    // "100/70 kg"): the second one is used, as for weights.
    const raw = raw0.replace(/^(?:[A-Z][0-9]?[.)]|\d{1,2}[.)](?!\d)|[-•*–])\s*/, '').trim()
      .replace(/\b\d+\s*\/\s*(\d+)(?=\s*(?:cal|cals|calories|kcal)\b)/i, '$1').replace(/\bcalories\b/i, 'cal');
    // "SkiErg 12/10 calories", "Row 15 cal"
    m = raw.match(/^([A-Za-z][A-Za-z' -]+?)\s+(\d{1,4})\s*(?:cal|cals|kcal)\b/i);
    if (m && moveName(m[1])) { push({ read: `${moveName(m[1])} (cal)`, reps: +m[2], sets: scheme ? 1 : sets, scheme: Array.isArray(scheme) ? scheme : null }); continue; }
    // "21-15-9 thrusters, pull-ups" / "2-4-6-8-10-..." (a ladder: reps not known)
    m = raw.match(/^(\d+(?:\s*[-–/]\s*\d+){2,})(\s*[-–]?\s*\.\.\.)?\s*(.*)$/);
    if (m) {
      scheme = m[2] ? 'ladder' : m[1].split(/\s*[-–/]\s*/).map(Number);
      block++;
      for (const part of m[3].split(/\s*(?:,|&|\band\b)\s*/)) { const n = moveName(part); if (n) push({ read: n, scheme, sets: 1 }); }
      continue;
    }
    // "5x5 Back squat @ 80kg", "3 x 10 lunges"
    m = raw.match(/^(\d{1,2})\s*[x×]\s*(\d{1,3})\s+(.+)$/i);
    if (m && moveName(m[3])) { push({ read: moveName(m[3]), sets: +m[1], reps: +m[2], kg: kgOf(m[3]) }); continue; }
    // "Back squat 5x5 @ 80kg", "Back squat: 3 x 10, 60kg"
    m = raw.match(/^(.+?)[:\s]+(\d{1,2})\s*[x×]\s*(\d{1,3})\b(.*)$/i);
    if (m && moveName(m[1])) { push({ read: moveName(m[1]), sets: +m[2], reps: +m[3], kg: kgOf(m[4]) }); continue; }
    // "8 Back Squats @ 70%", "20 cal row", "400m run"
    m = raw.match(/^(\d{1,4})\s*(m|km|cal|cals)?\s+(.+)$/i);
    if (m && moveName(m[3])) {
      const unit = m[2] && m[2].toLowerCase();
      if (unit === 'm' || unit === 'km') push({ read: `${moveName(m[3])} ${m[1]} ${unit}`, sets, kg: kgOf(m[3]) });
      else push({ read: unit ? `${moveName(m[3])} (cal)` : moveName(m[3]), reps: +m[1], sets: scheme ? 1 : sets, scheme: Array.isArray(scheme) ? scheme : null, kg: kgOf(m[3]) });
      continue;
    }
    // "Back squat x 8"
    m = raw.match(/^(.+?)\s*[x×]\s*(\d{1,3})\b(.*)$/i);
    if (m && moveName(m[1])) { push({ read: moveName(m[1]), reps: +m[2], sets, kg: kgOf(m[3]) }); continue; }
    // "Run 400m", "Row 1000 m"
    m = raw.match(/^(.+?)\s+(\d{2,5})\s*(m|km)\b/i);
    if (m && moveName(m[1])) { push({ read: `${moveName(m[1])} ${m[2]} ${m[3].toLowerCase()}`, sets }); continue; }
    // A bullet with just a movement ("- Burpee over the dumbbell"), or a movement under a rep scheme ("21-15-9" then
    // "Thrusters", "Pull-ups").
    if (((raw !== raw0 && /^[-•*–]/.test(raw0)) || Array.isArray(scheme)) && moveName(raw)) push({ read: moveName(raw), sets: scheme ? 1 : sets, scheme: Array.isArray(scheme) ? scheme : null });
  }
  // Round by round: movements pushed while rounds or a rep scheme applied, two or more under the same one.
  const n = {};
  for (const mv of out) if (mv.blockAt != null && mv.inRounds) n[mv.blockAt] = (n[mv.blockAt] || 0) + 1;
  for (const mv of out) { mv.group = mv.inRounds && n[mv.blockAt] > 1 ? 'w' + mv.blockAt : null; delete mv.block; delete mv.blockAt; delete mv.inRounds; }
  return out;
}
function parseWod(shot, acc) {
  const lines = shot.lines.map((l) => cleanLine(l.text)).filter(Boolean);
  const keep = [];
  for (const raw of lines) {
    if (/show (less|more)/i.test(raw)) break;
    if (!acc.title && /crossfit|training|wod/i.test(raw) && raw.length < 60 && !/\d+\s*(x|rounds|sets)/i.test(raw)) { acc.title = raw.replace(/^\W*\w{1,2}\s+(?=[A-Z])/, ''); continue; }
    if (/log\s*result|leaderboard/i.test(raw)) continue;
    if (/^\d{1,2}:\d{2}\b/.test(raw) && keep.length === 0) continue; // the phone's clock at the top
    keep.push(raw);
  }
  // Round-by-round groups are per screenshot.
  acc.shots = (acc.shots || 0) + 1;
  if (!acc.typeId) {
    const named = keep.slice(0, 4).join(' ');
    const t = state.workoutTypes.find((x) => x.id !== 'crossfit' && x.kind === 'strength' && new RegExp(`\\b${x.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(named));
    if (t) acc.typeId = t.id;
  }
  acc.moves.push(...writtenMoves(keep).map((mv) => Object.assign(mv, { group: mv.group ? `${mv.group}-${acc.shots}` : null })));
  // Notes: the workout's own lines (not buttons, nor bits of the phone's screen like "Il @)").
  acc.notes.push(...keep.filter((x) => !WOD_SKIP.test(x) && (/[A-Za-z]{3,}/.test(x) || /\d.*\d/.test(x))));
  if (/\b(AMRAP|EMOM|for time|rounds|WOD|metcon|crossfit)\b/i.test(shot.text)) acc.crossfit = true;
}
function wodToMovements(acc, t) {
  return acc.moves.map((mv) => {
    const read = sentenceCase(mv.read.replace(/\s+/g, ' '));
    const sets = Array.isArray(mv.scheme) ? mv.scheme.map((r) => ({ reps: r, weightKg: mv.kg || null }))
      : Array.from({ length: Math.max(1, Math.min(mv.sets || 1, 30)) }, () => ({ reps: mv.reps || null, weightKg: mv.kg || null }));
    return { importedName: read, name: ownMoveName(read, t), restSec: null, sets, group: mv.group || null };
  });
}

/* ---------- Activity summary numbers (Garmin Overview / Stats) ---------- */
// A number shown by a label: on the same line after it, or just below it.
function labelNumber(shot, re, opts = {}) {
  for (let i = 0; i < shot.lines.length; i++) {
    const l = shot.lines[i], m = l.text.match(re);
    if (!m) continue;
    const after = l.text.slice(m.index + m[0].length);
    const pick = (s) => (opts.time ? (s.match(/\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d)?/) || [])[0] : ((s.match(/\d{1,3}(?:,\d{3})+(?!\d)|\d+(?:[.,]\d+)?/) || [])[0] || '').replace(/,(?=\d{3}\b)/g, '') || null);
    let v = pick(after);
    if (!v && shot.lines[i + 1] && shot.lines[i + 1].y0 - l.y1 < (l.y1 - l.y0) * 2.5) v = pick(shot.lines[i + 1].text);
    if (v) { if (!opts.time) return toNum(v); const t = clockSec(opts.pace ? v.replace(/[.,]\d$/, '') : v); return t == null ? null : Math.round(t); }
  }
  return null;
}
function parseActivity(shot, acc) {
  const d = labelNumber(shot, /\bdistance\b/i);
  if (d != null && acc.distanceKm == null) acc.distanceKm = d;
  const tm = labelNumber(shot, /\b(?:total |moving |elapsed )?time\b(?!\s*(?:in|cap))/i, { time: true });
  if (tm != null && acc.timeSec == null) acc.timeSec = tm;
  const pace = labelNumber(shot, /\bavg\.?\s*pace\b/i, { time: true, pace: true });
  if (pace != null && acc.paceSecPerKm == null) acc.paceSecPerKm = pace;
  const hr = labelNumber(shot, /\b(?:avg|average)\.?\s*(?:hr|heart rate)\b/i);
  if (hr != null && hr >= 40 && hr <= 230 && acc.avgHr == null) acc.avgHr = Math.round(hr);
  const cal = labelNumber(shot, /\btotal calories\b/i) ?? labelNumber(shot, /\b(?:active )?calories\b|\bkcal\b/i);
  if (cal != null && cal > 0 && cal < 10000 && acc.calories == null) acc.calories = Math.round(cal);
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

const KIND_NAMES = { garminLaps: 'Garmin intervals', garminStrength: 'Garmin strength', garminActivity: 'Garmin activity', garminDay: 'Garmin day',
  whoop: 'Whoop', wod: 'written workout' };

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

// Puts together what the screenshots show and opens the forms to check it: the workout first, then recovery.
async function review(shots) {
  const thumbs = (list) => `<div class="shots">${list.map((s, i) => `<img src="${s.url}" alt="Screenshot ${i + 1}" data-shot>`).join('')}</div><div class="shot-view"></div>`;
  const workoutShots = shots.filter((s) => /^garmin(Laps|Strength|Activity)$|^wod$/.test(s.kind));
  const dayShots = shots.filter((s) => s.kind === 'whoop' || s.kind === 'garminDay');
  const steps = [];

  if (workoutShots.length) {
    const text = workoutShots.map((s) => s.text).join('\n');
    const kinds = new Set(workoutShots.map((s) => s.kind));
    const wodFirst = { moves: [], notes: [] };
    for (const s of workoutShots) if (s.kind === 'wod') parseWod(s, wodFirst);
    const key = kinds.has('garminStrength') ? 'strength' : kinds.has('wod') ? (wodFirst.crossfit ? 'crossfit' : activityKey(text) === 'crossfit' ? 'crossfit' : 'strength') : activityKey(text) || 'run';
    const t = (wodFirst.typeId && state.workoutTypes.find((x) => x.id === wodFirst.typeId)) || findType(key);
    const draft = { typeId: t.id, type: t.name, kind: t.kind, date: findDate(text), notes: '', durationMin: null, avgHr: null, calories: null };
    const tips = [];
    let laps = null;
    const laps0 = { rows: {} }, sets0 = { sets: {} }, wod0 = wodFirst, act0 = {};
    for (const s of workoutShots) {
      if (s.kind === 'garminLaps') parseLaps(s, laps0);
      if (s.kind === 'garminStrength') parseSets(s, sets0);
      if (s.kind !== 'wod') parseActivity(s, act0);
    }
    // Average heart rate and calories, from whichever app shows them.
    draft.avgHr = act0.avgHr != null ? act0.avgHr : null;
    draft.calories = act0.calories != null ? act0.calories : null;
    if (t.kind === 'cardio') {
      const c = Object.keys(laps0.rows).length ? lapsToCardio(laps0, t) : null;
      draft.cardio = { distanceKm: act0.distanceKm != null ? act0.distanceKm : c ? c.distanceKm : null,
        timeSec: act0.timeSec != null ? act0.timeSec : c ? c.timeSec : null, paceSecPerKm: act0.paceSecPerKm != null ? act0.paceSecPerKm : c ? c.paceSecPerKm : null };
      if (c && c.structured) {
        draft.cardio.intervals = c.intervals;
        tips.push(`Read ${c.parts.reps} reps${c.parts.rests ? ` and ${c.parts.rests} rest${c.parts.rests > 1 ? 's' : ''}` : ''}${c.parts.extras.length ? ` (plus ${c.parts.extras.join(' and ').toLowerCase()} in the totals)` : ''}. Check every rep was in your screenshots.`);
      } else if (c && c.intervals.length > 1) {
        laps = c.intervals;
        tips.push(`Garmin split this into ${laps.length} laps. They're in the totals; add them as intervals only if they were intervals.`);
      }
      if (c && !c.structured && !c.intervals.length) tips.push('No laps found.');
    } else if (t.kind === 'strength') {
      draft.movements = Object.keys(sets0.sets).length ? setsToMovements(sets0, t) : wodToMovements(wod0, t);
      const n = draft.movements.reduce((x, m) => x + m.sets.length, 0);
      if (kinds.has('garminStrength')) tips.push(`Read ${n} sets in ${draft.movements.length} movements. Check every set was in your screenshots. Rename a movement and it'll be called that next time.`);
      if (kinds.has('wod')) {
        draft.notes = [wod0.title, ...wod0.notes].filter(Boolean).join('\n');
        tips.push('From the written workout: check the movements, and fill in the weights you used (and reps where it says a ladder or AMRAP). The full text is in the notes.');
      }
    }
    if (draft.avgHr || draft.calories) tips.push(`Read ${[draft.avgHr ? `average heart rate ${draft.avgHr}` : '', draft.calories ? `${draft.calories} calories` : ''].filter(Boolean).join(' and ')}.`);
    else tips.push('No average heart rate or calories on these screens — add a Garmin or Whoop screenshot of this workout, now or later with "Add numbers from screenshots" in the form.');
    if (!draft.date) tips.push('These screens don\'t show the date — check it.');
    // Only offer the workout if something was actually read.
    const c = draft.cardio || {};
    const found = (draft.movements && draft.movements.some((m) => m.name)) || c.distanceKm != null || c.timeSec != null || (c.intervals && c.intervals.length) || laps;
    const sources = [...kinds].map((k) => KIND_NAMES[k]).join(' + ');
    if (found) steps.push(() => workoutSheet(null, draft, {
      source: kinds.has('wod') ? 'written workout' : 'Garmin',
      banner: `<div class="import-banner"><div>📷 <strong>Read from ${workoutShots.length} screenshot${workoutShots.length > 1 ? 's' : ''}</strong> (${esc(sources)}). Check the numbers against your screenshots — tap one to see it bigger. Nothing is saved until you tap Save.</div>
        ${tips.map((x) => `<div>• ${esc(x)}</div>`).join('')}
        ${laps ? `<button type="button" class="mini-btn" id="lapsBtn">Add the ${laps.length} laps as intervals</button>` : ''}
        ${thumbs(workoutShots)}</div>`,
      bind: ({ addRep }) => {
        const b = $('#lapsBtn');
        if (b) b.addEventListener('click', () => { for (const r of laps) addRep(r); b.remove(); });
      },
      onDone: () => { show('workouts'); next(); }
    }));
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
      <p style="margin:0">No workout or recovery numbers could be found in ${shots.length > 1 ? 'these screenshots' : 'this screenshot'}.</p>
      <p class="muted small" style="margin:0">Screens that work: Garmin Connect activity <strong>Intervals</strong> / <strong>Laps</strong>, <strong>Stats</strong> and <strong>Strength</strong> exercise lists, Garmin <strong>At a Glance</strong>, Whoop <strong>recovery</strong> and <strong>strain</strong>, and written workouts (WodUp, Instagram, competition sheets) with lines like "5x5 back squat" or "21 thrusters".</p>
      ${shots.length ? thumbs(shots) : ''}
      <button type="button" class="btn secondary" data-close>Close</button></div>`);
    return;
  }
  function next() { const step = steps.shift(); if (step) step(); }
  next();
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

/* ---------- Adding numbers to the workout in the form (e.g. Garmin's heart rate for a WodUp workout) ---------- */
const intoInput = document.createElement('input');
intoInput.type = 'file'; intoInput.accept = 'image/*'; intoInput.multiple = true; intoInput.hidden = true;
document.body.appendChild(intoInput);
document.addEventListener('click', (e) => { if (e.target.closest('#wFromShots')) { intoInput.value = ''; intoInput.click(); } });
intoInput.addEventListener('change', async () => {
  const files = [...intoInput.files];
  const info = $('#wFromShotsInfo');
  if (!files.length || !info) return;
  const shots = [];
  for (const [i, file] of files.entries()) {
    info.textContent = `Reading screenshot ${i + 1} of ${files.length}…`;
    try {
      const { canvas, url } = await prepImage(file);
      lastUrls.push(url);
      const shot = await readShot(canvas);
      shot.kind = detect(shot); shot.url = url;
      shots.push(shot);
    } catch (err) { console.error(err); }
  }
  if (!$('#wFromShotsInfo')) return; // the form was closed
  const act = {}, laps = { rows: {} };
  for (const sh of shots) { parseActivity(sh, act); if (sh.kind === 'garminLaps') parseLaps(sh, laps); }
  const filled = [];
  const fill = (sel, v, label) => {
    const el = $(sel);
    if (!el || v == null || el.value.trim() || el.closest('.hidden')) return;
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    filled.push(label);
  };
  fill('#wHr', act.avgHr, `average heart rate ${act.avgHr}`);
  fill('#wCal', act.calories, `${act.calories} calories`);
  // Distance workouts: the totals too, if they're still empty.
  const t = typeOf(($('#wTypes .on') || {}).dataset ? $('#wTypes .on').dataset.t : '');
  const c = Object.keys(laps.rows).length ? lapsToCardio(laps, t) : {};
  const dist = act.distanceKm != null ? act.distanceKm : c.distanceKm, time = act.timeSec != null ? act.timeSec : c.timeSec;
  if (dist != null) fill('#wDist', showDistFor(dist, t), `distance ${fmtDist(dist, t)}`);
  if (time != null) fill('#wTime', fmtTime(time), `time ${fmtTime(time)}`);
  info.innerHTML = (filled.length ? `📷 Filled in ${esc(filled.join(', '))} — check them against the screenshot${shots.length > 1 ? 's' : ''}.`
    : '📷 Nothing new found to fill in (only empty boxes are filled).') +
    `<div class="shots" style="margin-top:6px">${shots.map((sh, i) => `<img src="${sh.url}" alt="Screenshot ${i + 1}" data-shot>`).join('')}</div><div class="shot-view"></div>`;
});
