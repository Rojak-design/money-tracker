/* Rojak — weather in the top-right corner of the home screen: an icon, the temperature and where you are.

   Location: the phone's location (asked once), rounded to about 1 km (2 decimal places) before it's used. It is
   never saved or backed up; only the last forecast and place name are kept on this phone (localStorage) so the
   corner still shows something for a while when you're offline.

   Sources (free, no sign-up; only the rounded location is sent):
     NEA 2-hour forecast (data.gov.sg)  in Singapore: about 47 named areas (Punggol, Sengkang…), updated every
                                        30 minutes; the area nearest to you gives the icon and the place name
     Open-Meteo hourly forecast         anywhere: the temperature, and the next 12 hours (icon, temperature,
                                        chance of rain); outside Singapore it also gives the corner icon
     BigDataCloud place lookup          outside Singapore only: the district or town name (only the last one is
                                        kept on the phone, so there's no history of places)
   Tap the corner for the next 12 hours. */
'use strict';

const Weather = (() => {
  const CACHE = 'rojak-weather';
  const FRESH = 30 * 60 * 1000;      // refresh after 30 minutes
  const SHOW_FOR = 3 * 3600 * 1000;  // an old forecast is still shown for up to 3 hours (marked as old after 1)
  let last = null, busy = false;
  const el = () => document.querySelector('#weather');
  const escW = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- Icons (drawn to match her and the cat: soft colours, no outlines) ---------- */
  const SUN = '#f7b733', SUN_RAYS = '#f9c95c', CLOUD = '#e9eef3', CLOUD_SHADE = '#c9d3dc', DARK_CLOUD = '#aab6c2', RAIN = '#4fa7e8', MOON = '#f3d98b', BOLT = '#f5c331', HAZE = '#c8c2b4';
  const cloudPath = (dx = 0, dy = 0, s = 1) => `<path transform="translate(${dx} ${dy}) scale(${s})" d="M9 27H29Q35 27 35 21.5Q35 16 29.5 16Q28 10 21.5 10Q15 10 13.6 16.2Q8 16.4 8 21.6Q8 27 13 27Z"/>`;
  const sun = (cx = 20, cy = 20, r = 7) => `<g fill="${SUN_RAYS}">${[0, 45, 90, 135, 180, 225, 270, 315].map((a) => `<rect x="${cx - 1.4}" y="${cy - r - 6}" width="2.8" height="4.4" rx="1.4" transform="rotate(${a} ${cx} ${cy})"/>`).join('')}</g><circle cx="${cx}" cy="${cy}" r="${r}" fill="${SUN}"/>`;
  const moon = (cx = 20, cy = 19, r = 8) => `<path d="M${cx + 3} ${cy - r}A${r} ${r} 0 1 0 ${cx + r} ${cy + 3}A${r * 0.8} ${r * 0.8} 0 0 1 ${cx + 3} ${cy - r}Z" fill="${MOON}"/>`;
  const drops = (n, colour = RAIN) => [12, 19, 26].slice(0, n).map((x, i) => `<path d="M${x + 1.5} ${30 + (i % 2) * 2}L${x - 0.5} ${35 + (i % 2) * 2}" stroke="${colour}" stroke-width="2.4" stroke-linecap="round"/>`).join('');
  function iconSVG(kind, night) {
    let art;
    switch (kind) {
      case 'clear': art = night ? moon() : sun(); break;
      case 'partly': art = (night ? moon(15, 14, 7) : sun(15, 15, 6)) + `<g fill="${CLOUD_SHADE}">${cloudPath(3, 6, 0.95)}</g><g fill="${CLOUD}">${cloudPath(2, 5, 0.95)}</g>`; break;
      case 'cloudy': art = `<g fill="${CLOUD_SHADE}">${cloudPath(-3, -2, 0.85)}</g><g fill="${CLOUD}">${cloudPath(1, 3)}</g>`; break;
      case 'showers': art = (night ? moon(14, 11, 6) : sun(14, 12, 5)) + `<g fill="${CLOUD}">${cloudPath(2, 1)}</g>` + drops(2); break;
      case 'rain': art = `<g fill="${DARK_CLOUD}">${cloudPath(0, 1)}</g>` + drops(3); break;
      case 'thunder': art = `<g fill="${DARK_CLOUD}">${cloudPath(0, 0)}</g><path d="M21 25L16 33H20.5L18 40L25.5 30.5H21L23.5 25Z" fill="${BOLT}"/>` + drops(1).replace('12', '10'); break;
      case 'fog': art = `<g fill="${CLOUD}">${cloudPath(0, -2)}</g><path d="M8 30H32M11 35H29" stroke="${HAZE}" stroke-width="2.6" stroke-linecap="round"/>`; break;
      case 'wind': art = `<path d="M6 16H24Q29 16 29 12Q29 9 26 9M6 23H31Q35 23 35 27Q35 30 32 30M6 30H18" fill="none" stroke="${CLOUD_SHADE}" stroke-width="3" stroke-linecap="round"/>`; break;
      case 'snow': art = `<g fill="${CLOUD}">${cloudPath(0, 0)}</g>` + [13, 20, 27].map((x) => `<circle cx="${x}" cy="33" r="1.8" fill="#bcd7f0"/>`).join(''); break;
      default: art = `<g fill="${CLOUD}">${cloudPath(0, 2)}</g>`;
    }
    return `<svg viewBox="0 0 40 40" aria-hidden="true">${art}</svg>`;
  }

  /* ---------- What each source's forecast means ---------- */
  // Open-Meteo weather codes (WMO).
  function kindOfCode(code) {
    if (code === 0 || code === 1) return 'clear';
    if (code === 2) return 'partly';
    if (code === 3) return 'cloudy';
    if (code === 45 || code === 48) return 'fog';
    if (code >= 51 && code <= 67) return code >= 61 ? 'rain' : 'showers';
    if (code >= 71 && code <= 77) return 'snow';
    if (code >= 80 && code <= 82) return 'showers';
    if (code === 85 || code === 86) return 'snow';
    if (code >= 95) return 'thunder';
    return 'cloudy';
  }
  const CODE_TEXT = { clear: 'Clear', partly: 'Partly cloudy', cloudy: 'Cloudy', fog: 'Foggy', rain: 'Rain', showers: 'Showers', snow: 'Snow', thunder: 'Thunderstorms', wind: 'Windy' };
  // NEA's forecast words, e.g. "Partly Cloudy (Night)", "Thundery Showers", "Light Rain", "Hazy".
  function kindOfText(t) {
    const s = String(t || '').toLowerCase();
    if (s.includes('thunder')) return 'thunder';
    if (s.includes('shower')) return 'showers';
    if (s.includes('rain') || s.includes('drizzle')) return 'rain';
    if (s.includes('haz') || s.includes('mist') || s.includes('fog')) return 'fog';
    if (s.includes('wind')) return 'wind';
    if (s.includes('partly')) return 'partly';
    if (s.includes('cloud') || s.includes('overcast')) return 'cloudy';
    if (s.includes('fair') || s.includes('sunny') || s.includes('clear')) return 'clear';
    return 'cloudy';
  }
  const tidyText = (t) => { const s = String(t || '').replace(/\s*\((day|night)\)\s*/i, '').trim().toLowerCase(); return s.charAt(0).toUpperCase() + s.slice(1); };

  /* ---------- Fetching ---------- */
  const inSingapore = (lat, lon) => lat > 1.15 && lat < 1.48 && lon > 103.59 && lon < 104.1;
  async function getJSON(url) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 12000);
    try {
      const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } finally { clearTimeout(timer); }
  }
  async function openMeteo(lat, lon) {
    const q = `latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,is_day` +
      '&hourly=temperature_2m,weather_code,precipitation_probability,is_day&forecast_hours=13&timezone=auto';
    const j = await getJSON(`https://api.open-meteo.com/v1/forecast?${q}`);
    const h = j.hourly || {};
    const hours = (h.time || []).map((time, i) => ({ time, temp: h.temperature_2m[i], code: h.weather_code[i], rain: h.precipitation_probability ? h.precipitation_probability[i] : null, night: h.is_day ? !h.is_day[i] : false }));
    const cur = j.current || {};
    return { temp: cur.temperature_2m, code: cur.weather_code, night: cur.is_day === 0, hours };
  }
  // NEA's 2-hour forecast: the named area nearest to you. Tries the current API, then the older one.
  async function nea(lat, lon) {
    let j;
    try { j = await getJSON('https://api-open.data.gov.sg/v2/real-time/api/two-hr-forecast'); j = j && j.data ? j.data : j; }
    catch { j = await getJSON('https://api.data.gov.sg/v1/environment/2-hour-weather-forecast'); }
    const areas = (j.area_metadata || j.areaMetadata || []).map((a) => ({ name: a.name, lat: +(a.label_location || a.labelLocation).latitude, lon: +(a.label_location || a.labelLocation).longitude }));
    const item = (j.items || [])[0];
    if (!areas.length || !item) throw new Error('no NEA forecast');
    let best = null, bestD = Infinity;
    for (const a of areas) { const d = (a.lat - lat) ** 2 + ((a.lon - lon) * Math.cos(lat * Math.PI / 180)) ** 2; if (d < bestD) { bestD = d; best = a; } }
    const f = (item.forecasts || []).find((x) => x.area === best.name);
    const text = f && (typeof f.forecast === 'string' ? f.forecast : f.forecast && (f.forecast.text || f.forecast.code));
    if (!text) throw new Error('no forecast for ' + best.name);
    const vp = item.valid_period || item.validPeriod || {};
    return { area: best.name, text, night: /\(night\)/i.test(text), until: vp.end || null, updated: item.update_timestamp || item.updateTimestamp || item.timestamp || null };
  }
  // Outside Singapore: the name of where you are (district or town, e.g. "Shibuya, Tokyo") from BigDataCloud's free
  // lookup, sent only the rounded location. Only the last one is kept on the phone (no history of places), so
  // it isn't looked up again while you stay in the same spot.
  const PLACE = 'rojak-place';
  async function placeName(lat, lon) {
    const key = `${lat},${lon}`;
    try { const p = JSON.parse(localStorage.getItem(PLACE) || 'null'); if (p && p.key === key) return p; } catch { /* look it up */ }
    const j = await getJSON(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`);
    const short = j.locality || j.city || j.principalSubdivision || j.countryName;
    if (!short) throw new Error('no place name');
    const wider = [j.city, j.principalSubdivision, j.countryName].find((x) => x && x !== short) || '';
    const place = { key, short, full: wider ? `${short}, ${wider}` : short };
    try { localStorage.setItem(PLACE, JSON.stringify(place)); } catch { /* fine */ }
    return place;
  }
  function locate() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(Object.assign(new Error('no location on this browser'), { code: 2 }));
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: Math.round(p.coords.latitude * 100) / 100, lon: Math.round(p.coords.longitude * 100) / 100 }),
        reject, { enableHighAccuracy: false, timeout: 15000, maximumAge: 10 * 60 * 1000 });
    });
  }

  /* ---------- Showing it ---------- */
  function readCache() { try { return JSON.parse(localStorage.getItem(CACHE) || 'null'); } catch { return null; } }
  function writeCache(w) { try { localStorage.setItem(CACHE, JSON.stringify(w)); } catch { /* private mode: fine */ } }
  const roundT = (t) => (t == null || isNaN(t) ? '' : `${Math.round(t)}°`);

  function show(w, note) {
    const box = el();
    if (!box) return;
    if (!w) {
      box.innerHTML = note === 'denied' || note === 'nolocation'
        ? `<span class="wx-ask">📍 Weather</span>` : '';
      box.classList.toggle('empty', !box.innerHTML);
      box.setAttribute('aria-label', note === 'denied' ? 'Weather: allow location to show it' : 'Weather');
      return;
    }
    const old = Date.now() - w.at > 3600 * 1000;
    box.classList.remove('empty');
    box.classList.toggle('old', old);
    box.innerHTML = `<span class="wx-icon">${iconSVG(w.kind, w.night)}</span><span class="wx-temp">${roundT(w.temp)}</span>
      <span class="wx-place">${escW(w.place)}</span>`;
    box.setAttribute('aria-label', `Weather in ${w.place}: ${w.text}, ${roundT(w.temp)}${old ? ' (not updated recently)' : ''}. Tap for the next hours.`);
  }

  async function refresh(force) {
    if (busy) return;
    const cached = readCache();
    if (!last && cached && Date.now() - cached.at < SHOW_FOR) { last = cached; show(last); }
    if (!force && last && Date.now() - last.at < FRESH) return;
    busy = true;
    try {
      const { lat, lon } = await locate();
      const sg = inSingapore(lat, lon);
      const [om, nn, pn] = await Promise.allSettled([openMeteo(lat, lon), sg ? nea(lat, lon) : Promise.reject(new Error('outside SG')),
        sg ? Promise.reject(new Error('in SG')) : placeName(lat, lon)]);
      const where = pn.status === 'fulfilled' ? pn.value : null;
      if (om.status !== 'fulfilled' && nn.status !== 'fulfilled') throw om.reason || nn.reason;
      const o = om.status === 'fulfilled' ? om.value : null, n = nn.status === 'fulfilled' ? nn.value : null;
      last = {
        at: Date.now(),
        place: n ? n.area : where ? where.short : 'Near you',
        placeFull: n ? n.area : where ? where.full : 'Near you',
        kind: n ? kindOfText(n.text) : kindOfCode(o.code),
        night: n ? (n.night || (o ? o.night : false)) : o.night,
        text: n ? tidyText(n.text) : CODE_TEXT[kindOfCode(o.code)],
        until: n ? n.until : null,
        temp: o ? o.temp : null,
        hours: o ? o.hours.map((x) => ({ time: x.time, temp: x.temp, kind: kindOfCode(x.code), night: x.night, rain: x.rain })) : [],
        sources: [n ? 'NEA (data.gov.sg)' : '', o ? 'Open-Meteo' : '', where ? 'place name: BigDataCloud' : ''].filter(Boolean)
      };
      writeCache(last);
      show(last);
    } catch (err) {
      console.warn('Weather:', err && err.message);
      const denied = err && err.code === 1, noloc = err && (err.code === 2 || err.code === 3);
      if (!last) show(null, denied ? 'denied' : noloc ? 'nolocation' : '');
      else show(last);
      refresh.why = denied ? 'denied' : noloc ? 'nolocation' : 'offline';
    } finally { busy = false; }
  }

  // The panel: the area's 2-hour forecast and the next 12 hours.
  const hourLabel = (iso, i) => (i === 0 ? 'Now' : new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric' }).replace(':00', '').replace(/\s/g, '').toLowerCase());
  const timeLabel = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  function panel() {
    if (!last) {
      const why = refresh.why;
      openSheet(`<p class="muted" style="margin-top:0">${why === 'denied'
        ? 'Rojak needs your location to show the weather where you are. Allow location for this app in your phone\'s browser or app settings, then tap Try again.'
        : why === 'nolocation' ? 'Your location couldn\'t be found just now (is location turned on?).' : 'The weather couldn\'t be loaded (no internet?).'}</p>
        <button class="btn" id="wxRetry">Try again</button><button class="btn secondary" data-close>Close</button>`, 'Weather');
      document.querySelector('#wxRetry').addEventListener('click', async () => { closeSheet(); await refresh(true); if (last) panel(); });
      return;
    }
    const w = last;
    const hours = w.hours.slice(0, 13).map((x, i) => `<div class="wx-hour"><span class="h">${escW(hourLabel(x.time, i))}</span>
      <span class="i">${iconSVG(x.kind, x.night)}</span><strong>${roundT(x.temp)}</strong><span class="r">${x.rain == null ? '' : `💧${x.rain}%`}</span></div>`).join('');
    openSheet(`
      <div class="wx-now"><span class="wx-big">${iconSVG(w.kind, w.night)}</span>
        <div><div class="wx-temp-big">${roundT(w.temp)}</div><div><strong>${escW(w.text)}</strong>${w.until ? ` <span class="muted small">until ${escW(timeLabel(w.until))}</span>` : ''}</div></div></div>
      ${hours ? `<div class="label-t">Next 12 hours</div><div class="wx-hours">${hours}</div>` : ''}
      <p class="muted small">Updated ${escW(timeLabel(new Date(w.at).toISOString()))}${Date.now() - w.at > 3600 * 1000 ? ' (not updated recently — no internet?)' : ''} · ${escW(w.sources.join(' and '))}.
        Your location is rounded to about 1 km; only the last forecast and place name are kept on this phone.</p>
      <button class="btn secondary" data-close>Close</button>`, `Weather · ${w.placeFull || w.place}`);
  }

  function start() {
    const box = el();
    if (!box) return;
    box.addEventListener('click', panel);
    refresh();
    setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 5 * 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
  }

  return { start, refresh, iconSVG };
})();
