/* Rojak — the cat that sits beside her on the home screen. Its breed changes every month, along with her hair
   colour (same month order as HAIR_COLOURS in avatar.js). Drawn softly to match her: no outlines. */
'use strict';

const CAT_BREEDS = [
  { name: 'Siamese',       base: '#f3e3cc', mask: '#5e4234', ear: '#5e4234', paw: '#5e4234', eye: '#6fb6ea' },  // January
  { name: 'Scottish Fold', base: '#b9bec7', stripes: '#8b929e', eye: '#e9a23b', fold: true },                    // February
  { name: 'Orange tabby',  base: '#f49a3c', stripes: '#d06a1c', muzzle: '#fff7ec', paw: '#fff7ec', eye: '#7cc04a' }, // March
  { name: 'Persian',       base: '#ffffff', eye: '#e8913a', fluff: true, smallEars: true },                       // April
  { name: 'Calico',        base: '#ffffff', patchL: '#f29a3b', patchR: '#2e2a2b', pawR: '#f29a3b', eye: '#2e2a2b' }, // May
  { name: 'Maine Coon',    base: '#9b6a43', stripes: '#5f3d25', muzzle: '#f1e2cf', eye: '#e2ad35', fluff: true, tufts: true }, // June
  { name: 'Russian Blue',  base: '#7f8a9b', eye: '#4cbf6b' },                                                     // July
  { name: 'Bengal',        base: '#eab267', spots: '#7a4920', muzzle: '#fbecd6', eye: '#86c35a' },               // August
  { name: 'Sphynx',        base: '#f3c4b8', eye: '#4fb8ab', bigEars: true, wrinkles: true },                     // September
  { name: 'Black cat',     base: '#2e2b30', eye: '#f5c331', dark: true },                                         // October
  { name: 'Tuxedo',        base: '#2e2b30', blaze: '#ffffff', paw: '#ffffff', eye: '#f5c331', dark: true },      // November
  { name: 'Ragdoll',       base: '#f7efe4', mask: '#b39a88', ear: '#9c8172', paw: '#ffffff', eye: '#4f8fe0', fluff: true } // December
];
const catForMonth = (date = new Date()) => CAT_BREEDS[date.getMonth()];

const mixColour = (a, b, t) => {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const A = p(a), B = p(b);
  return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
};
const lighter = (c, t) => mixColour(c, '#ffffff', t), deeper = (c, t) => mixColour(c, '#2a1e22', t);

let catCount = 0;
// The cat peeking over a ledge: its straight base is at y = 70, which sits on the top edge of the Money card.
// Its tail (class "tail") curls up on its left and is swished by the home screen.
function catSVG(b = catForMonth()) {
  const id = 'kc' + (++catCount);
  const head = 'M13 70V54C13 37 29 27 50 27S87 37 87 54V70Z';
  const flip = (d) => d.replace(/(-?\d+(?:\.\d+)?)([ ,])(-?\d+(?:\.\d+)?)/g, (m, x, s, y) => `${100 - +x}${s}${y}`);
  const ear = b.bigEars ? 'M17 46L14 9Q15 6 18 8L45 30Z' : b.smallEars ? 'M20 42L21 20Q22 17 25 19L41 31Z' : 'M18 44L19 13Q20 10 23 12L44 30Z';
  const earIn = b.bigEars ? 'M21 40L19 16L38 31Z' : b.smallEars ? 'M24 37L24.5 24L35 31Z' : 'M22 39L22.5 19L38 31Z';
  const fold = 'M24 36Q22 28 30 26Q38 25 41 31Q33 31 24 36Z';
  const earFill = b.ear || b.base;
  // "rim": a faint light edge, shown only in dark mode so dark cats don't vanish into the background.
  const ears = b.fold
    ? `<path class="rim" d="${fold}" fill="${deeper(b.base, .08)}"/><path class="rim" d="${flip(fold)}" fill="${deeper(b.base, .08)}"/>`
    : `<path class="rim" d="${ear}" fill="${b.patchL || earFill}" stroke="${b.patchL || earFill}" stroke-width="2" stroke-linejoin="round"/>
       <path class="rim" d="${flip(ear)}" fill="${b.patchR || earFill}" stroke="${b.patchR || earFill}" stroke-width="2" stroke-linejoin="round"/>
       <path d="${earIn}" fill="#f6b1b8"/><path d="${flip(earIn)}" fill="#f6b1b8"/>`;
  const tufts = b.tufts ? `<path d="M20 12L18 4M80 12L82 4" stroke="${deeper(b.base, .3)}" stroke-width="2" stroke-linecap="round"/>` : '';
  const fluff = b.fluff ? `<path d="M15 50L7 54L13 57L6 62L14 64L9 69H16M85 50L93 54L87 57L94 62L86 64L91 69H84" fill="${b.base}" stroke="${b.base}" stroke-width="1.5" stroke-linejoin="round"/>` : '';
  let pat = '';
  if (b.patchL) pat += `<path d="M10 25H44Q40 40 26 46Q16 48 10 44Z" fill="${b.patchL}"/>`;
  if (b.patchR) pat += `<path d="M60 25H92V60Q78 58 70 46Q64 36 60 25Z" fill="${b.patchR}"/>`;
  if (b.stripes) pat += `<path d="M50 28V36M43 29.5L44.5 36.5M57 29.5L55.5 36.5M13 50H21M13 56H20M87 50H79M87 56H80" stroke="${b.stripes}" stroke-width="2.6" stroke-linecap="round"/>`;
  if (b.spots) pat += [[30, 36], [70, 36], [22, 52], [78, 52], [40, 32], [60, 32]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.6" fill="none" stroke="${b.spots}" stroke-width="1.7"/>`).join('');
  if (b.mask) pat += `<ellipse cx="50" cy="60" rx="24" ry="17" fill="${b.mask}"/>`;
  if (b.muzzle) pat += `<path d="M34 70C34 62 41 57 50 57S66 62 66 70Z" fill="${b.muzzle}"/>`;
  if (b.blaze) pat += `<path d="M46 34Q50 31 54 34L58 52Q66 58 66 70H34Q34 58 42 52Z" fill="${b.blaze}"/>`;
  if (b.wrinkles) pat += `<path d="M42 35Q50 32 58 35M44 39Q50 37 56 39" stroke="${deeper(b.base, .18)}" stroke-width="1.3" fill="none" stroke-linecap="round"/>`;
  const eyes = [36, 64].map((x) => `<ellipse cx="${x}" cy="49" rx="6.4" ry="6.8" fill="${b.eye}"/>
    <ellipse cx="${x}" cy="49.4" rx="3.2" ry="5" fill="#26232b"/><circle cx="${x + 2}" cy="46.6" r="1.9" fill="#fff"/><circle cx="${x - 1.8}" cy="52" r=".8" fill="#fff"/>`).join('');
  const mouth = b.dark && !b.blaze ? '#d9cdd6' : deeper(b.muzzle || b.blaze || b.mask || b.base, .45);
  const pawFill = (f) => (f === b.base ? lighter(b.base, .12) : f);
  const paw = (x, fill) => `<path d="M${x} 70V64.5Q${x} 59 ${x + 5.5} 59H${x + 11.5}Q${x + 17} 59 ${x + 17} 64.5V70Z" fill="${pawFill(fill)}"/>
    <path d="M${x + 6} 65V68.5M${x + 11} 65V68.5" stroke="${deeper(pawFill(fill), .22)}" stroke-width="1.3" stroke-linecap="round"/>`;
  const tailColour = b.patchR || (b.name === 'Siamese' ? b.mask : b.base);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-14 0 116 70" overflow="visible" class="${b.dark ? 'dark-cat' : ''}">
    <defs><clipPath id="${id}"><path d="${head}"/></clipPath><clipPath id="${id}e"><rect x="-40" y="-30" width="180" height="100"/></clipPath>
      <linearGradient id="${id}g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".18"/><stop offset=".6" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".08"/></linearGradient></defs>
    <g clip-path="url(#${id}e)">
      <g class="tail"><path d="M3 70C-8 62 -12 50 -6 41C-3 37 1 38 0.5 42.5" fill="none" stroke="${tailColour}" stroke-width="6.5" stroke-linecap="round"/></g>
      ${tufts}${ears}${fluff}
      <path class="rim" d="${head}" fill="${b.base}"/>
      <g clip-path="url(#${id})">${pat}<rect x="0" y="20" width="100" height="50" fill="url(#${id}g)"/></g>
      ${eyes}
      <ellipse cx="27" cy="59" rx="4.2" ry="2.4" fill="#f59aa0" opacity=".5"/><ellipse cx="73" cy="59" rx="4.2" ry="2.4" fill="#f59aa0" opacity=".5"/>
      <path d="M47.5 57.5H52.5Q50 61 47.5 57.5Z" fill="#ef8f9b"/>
      <path d="M45 62Q47.5 64.6 50 62Q52.5 64.6 55 62" stroke="${mouth}" stroke-width="1.4" fill="none" stroke-linecap="round"/>
      <path class="whiskers" d="M13 56L1 54M13 60L0 60M14 64L2 66M87 56L99 54M87 60L100 60M86 64L98 66" stroke-width="1" stroke-linecap="round"/>
      ${paw(22, b.paw || b.base)}${paw(61, b.pawR || b.paw || b.base)}
    </g></svg>`;
}
