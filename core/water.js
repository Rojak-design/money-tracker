/* Rojak — water tracker on the home screen (not a module): five bottles to fill through the day.

   Saved in the shared store under 'mod:water' (Rojak.save('water', …)), one entry per day:
     days: { id (= date), date: 'YYYY-MM-DD', bottles: 0 … 5 in halves, e.g. 2.5 }
   The store adds savedAt / updatedAt. Each new day starts at 0; earlier days stay saved. Habits reads this for
   its "Water" linked habits (habits/rules.js).

   Tapping: tap where you want the water to reach — the lower half of a bottle fills it halfway, the upper half
   fills it to the top. Bottles fill left to right. Tapping the last bottle at the level it's already at empties
   it (to undo a mistap). The water is this month's hair colour. */
'use strict';

const Water = (() => {
  const MAX = 5;
  let data = { days: [] }, day = '';
  const pad2 = (n) => String(n).padStart(2, '0');
  const dayNow = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
  const half = (n) => Math.round(n * 2) / 2;
  const countOn = (d) => { const r = data.days.find((x) => x.date === d); return r ? half(+r.bottles || 0) : 0; };
  // 2.5 → "2½"
  const fmt = (n) => (n % 1 ? `${Math.floor(n) || ''}½` : String(n));
  const reduceMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const box = () => document.querySelector('#bottles');

  // The bottle: slim body, band under the lid, flip-top lid (taller on the left) with a carry loop.
  const BODY = 'M6.5 33Q6.5 29.5 10 29.5H30Q33.5 29.5 33.5 33V83Q33.5 89 27.5 89H12.5Q6.5 89 6.5 83Z';
  const TOP = 29.5, BOTTOM = 89; // the body's top and bottom (the water rises between them)
  function bottleSVG(i, hair) {
    const id = `wb${i}`;
    return `<svg viewBox="0 0 40 92" aria-hidden="true">
      <defs><clipPath id="${id}c"><path d="${BODY}"/></clipPath>
        <linearGradient id="${id}g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${hair.top}"/><stop offset="1" stop-color="${hair.end}"/></linearGradient></defs>
      <path class="wb-empty" d="${BODY}"/>
      <g clip-path="url(#${id}c)"><path class="wb-water" fill="url(#${id}g)" d=""/></g>
      <path class="wb-shine" d="M10.5 35V80"/>
      <path class="wb-line" d="${BODY}"/>
      <rect class="wb-band" x="7.5" y="23" width="25" height="7" rx="1.5"/>
      <path class="wb-lid" d="M8.5 23V8.5Q8.5 3.2 13.5 3L20.5 2.8Q23.5 2.8 25.2 4.6L31.2 11Q32.4 12.4 32.4 14.4V23Z"/>
      <path class="wb-loop-o" d="M12.5 7.2Q19 5.2 24.5 7.6Q29.6 10.2 30.6 15V19"/>
      <path class="wb-loop" d="M12.5 7.2Q19 5.2 24.5 7.6Q29.6 10.2 30.6 15V19"/>
      <rect class="wb-band" x="26" y="17.6" width="4.4" height="3.4" rx="1"/>
    </svg>`;
  }
  // The water's shape for a level (0 – 1) with a little wave on top; `phase` moves the wave while it fills.
  function waterPath(level, phase = 0) {
    if (level <= 0) return '';
    const y = BOTTOM - (BOTTOM - TOP) * Math.min(1, level), a = level >= 1 ? 0 : 1.6;
    let d = `M-2 ${y}`;
    for (let x = -2; x < 44; x += 6) d += `Q${x + 3} ${y + a * Math.sin(phase + x / 4)} ${x + 6} ${y}`;
    return `${d}V92H-2Z`;
  }
  const levelOf = (count, i) => Math.max(0, Math.min(1, count - i));

  function render() {
    const el = box();
    if (!el) return;
    if (!el.children.length) {
      const hair = hairForMonth();
      el.innerHTML = Array.from({ length: MAX }, (_, i) => `<button type="button" class="bottle" data-i="${i}">${bottleSVG(i, hair)}</button>`).join('');
      el.querySelectorAll('.bottle').forEach((b) => b.addEventListener('click', (e) => tap(+b.dataset.i, e, b)));
    }
    const n = countOn(day);
    el.querySelectorAll('.bottle').forEach((b, i) => {
      const lv = levelOf(n, i);
      b.querySelector('.wb-water').setAttribute('d', waterPath(lv));
      b.classList.toggle('filled', lv > 0);
      b.setAttribute('aria-label', `Bottle ${i + 1}: ${lv >= 1 ? 'full' : lv > 0 ? 'half full' : 'empty'}`);
    });
    showCount(n);
  }
  function showCount(n) {
    const el = document.querySelector('#waterCount');
    if (el) el.textContent = n ? `${fmt(n)} of ${MAX}${n >= MAX ? ' 🎉' : ''}` : `0 of ${MAX} · tap a bottle`;
  }

  // Tap: lower half of a bottle = half, upper half (or the lid) = full.
  function tap(i, e, btn) {
    if (dayNow() !== day) { day = dayNow(); render(); }
    const r = btn.getBoundingClientRect();
    const mid = r.top + r.height * ((TOP + BOTTOM) / 2 / 92);
    const want = e && e.detail && e.clientY > mid ? 0.5 : 1;
    const old = countOn(day);
    const last = Math.ceil(old) - 1; // the last bottle with water in it (-1: none)
    let next;
    if (i < last) return wiggle(btn);                                        // earlier bottles: fill / undo in order
    if (i === last) next = levelOf(old, i) === want ? i : i + want;          // same level again: empty it
    else next = levelOf(old, last) > 0 && levelOf(old, last) < 1 ? last + 1 : Math.floor(old) + want; // top up a half bottle first
    next = Math.max(0, Math.min(MAX, half(next)));
    if (next === old) return;
    setCount(next); // the bottle moves straight away; saving happens in the background
    animateTo(old, next);
    if (next >= MAX && old < MAX) celebrate();
  }
  // Saves one at a time, in order, so quick taps are all kept.
  let saving = Promise.resolve();
  function setCount(n) {
    let rec = data.days.find((x) => x.date === day);
    if (!rec) { rec = { id: day, date: day, bottles: 0 }; data.days.push(rec); }
    rec.bottles = n;
    saving = saving.then(() => Rojak.save('water', data)).catch((err) => { console.error(err); toast('Could not save the water bottles'); });
    return saving;
  }

  // The bottle that changed fills (or empties) with a wobbling wave over about half a second.
  let anim = 0;
  function animateTo(from, to) {
    cancelAnimationFrame(anim);
    const el = box();
    const i = Math.min(Math.floor(Math.min(from, to)), MAX - 1);
    const b = el.querySelectorAll('.bottle')[i];
    showCount(to);
    el.querySelectorAll('.bottle').forEach((x, k) => {
      const lv = levelOf(to, k);
      x.classList.toggle('filled', lv > 0);
      x.setAttribute('aria-label', `Bottle ${k + 1}: ${lv >= 1 ? 'full' : lv > 0 ? 'half full' : 'empty'}`);
      if (k !== i) x.querySelector('.wb-water').setAttribute('d', waterPath(lv));
    });
    const a = levelOf(from, i), z = levelOf(to, i), water = b.querySelector('.wb-water');
    if (reduceMotion()) { water.setAttribute('d', waterPath(z)); return; }
    const start = performance.now(), ms = 550;
    const frame = (now) => {
      const t = Math.min(1, (now - start) / ms), e = 1 - Math.pow(1 - t, 3);
      const lv = a + (z - a) * e;
      // While moving, the surface wobbles; it settles flat (full) or with a gentle wave (half).
      const y = BOTTOM - (BOTTOM - TOP) * Math.min(1, lv), amp = t < 1 ? 2.4 * (1 - t) + (lv < 1 ? 1.6 : 0) : lv < 1 ? 1.6 : 0;
      let d = '';
      if (lv > 0) {
        d = `M-2 ${y}`;
        for (let x = -2; x < 44; x += 6) d += `Q${x + 3} ${y + amp * Math.sin(t * 14 + x / 4)} ${x + 6} ${y}`;
        d += 'V92H-2Z';
      }
      water.setAttribute('d', t < 1 ? d : waterPath(z));
      if (t < 1) anim = requestAnimationFrame(frame);
    };
    anim = requestAnimationFrame(frame);
    b.classList.remove('pop'); void b.offsetWidth; if (z > a) b.classList.add('pop');
  }
  function wiggle(btn) {
    if (reduceMotion()) return;
    btn.classList.remove('wiggle'); void btn.offsetWidth; btn.classList.add('wiggle');
  }
  // All five full: the bottles bounce one after another and a few sparkles pop.
  function celebrate() {
    if (reduceMotion()) return;
    const el = box(), card = document.querySelector('#waterCard');
    el.querySelectorAll('.bottle').forEach((b, k) => {
      b.style.animationDelay = `${k * 70}ms`;
      b.classList.remove('cheer'); void b.offsetWidth; b.classList.add('cheer');
    });
    card.querySelectorAll('.sparkle').forEach((s) => s.remove());
    const spots = [[8, 18], [26, 6], [50, 14], [72, 4], [92, 20], [16, 70], [84, 66]];
    spots.forEach(([x, y], k) => {
      const s = document.createElement('span');
      s.className = 'sparkle'; s.textContent = k % 2 ? '✦' : '✧';
      s.style.left = x + '%'; s.style.top = y + '%'; s.style.animationDelay = `${120 + k * 60}ms`;
      card.appendChild(s);
      setTimeout(() => s.remove(), 1400);
    });
  }

  async function load() {
    day = dayNow();
    let saved = null;
    try { saved = await Rojak.load('water'); } catch (err) { console.error(err); }
    data = saved && Array.isArray(saved.days) ? saved : { days: [] };
    // Saving the empty list first means the first day gets the real time it was saved (see Habits).
    if (!saved) { try { await Rojak.save('water', data); } catch (err) { console.error(err); } }
    render();
    return data;
  }
  // A new day starts at 0 (checked when you come back to the app, and every minute while it's open).
  function checkDay() { if (dayNow() !== day) { day = dayNow(); render(); } }
  setInterval(checkDay, 60000);

  return { load, render, checkDay, data: () => data };
})();
