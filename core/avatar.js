/* Rojak — the app's avatar icon: a cartoon girl with a blunt-fringe bob, whose hair colour changes every month.
   Used on the home screen and as the browser tab icon. (The installed home-screen icon is a fixed PNG; phones
   don't let a web app change it after installing.) */
'use strict';

// Hair colour for each month: [light top, deeper ends].
const HAIR_COLOURS = [
  { name: 'Bubblegum pink', top: '#ffb3dc', end: '#e84393' }, // January
  { name: 'Lilac', top: '#dcc2ff', end: '#8a5cf0' },          // February
  { name: 'Mint green', top: '#bff7cf', end: '#25b46a' },     // March
  { name: 'Peach', top: '#ffd6b3', end: '#f4824f' },          // April
  { name: 'Lemon', top: '#fff3a6', end: '#e8b923' },          // May
  { name: 'Coral', top: '#ffbfb3', end: '#ef4f5a' },          // June
  { name: 'Ocean blue', top: '#a8dcff', end: '#2b74e4' },     // July
  { name: 'Sunset orange', top: '#ffd08a', end: '#f0662f' },  // August
  { name: 'Plum', top: '#ebb3e3', end: '#9a3a9a' },           // September
  { name: 'Copper', top: '#f7bd8a', end: '#bd5a24' },         // October
  { name: 'Teal', top: '#8ff0dc', end: '#1aa3d9' },           // November
  { name: 'Ruby red', top: '#ffa3ab', end: '#d1203a' }        // December
];
const hairForMonth = (date = new Date()) => HAIR_COLOURS[date.getMonth()];

let avatarCount = 0;
// The avatar as SVG markup (used for the browser tab and the phone icons). bg: background colour ('none' for transparent). full: fill the square edge to edge
// (for Android's "maskable" icon, which crops the corners).
function avatarSVG(hair = hairForMonth(), { bg = '#dff3e6', full = false } = {}) {
  const id = 'rj' + (++avatarCount);
  const skin = '#f8d9c6', shade = '#ecc0a8';
  const art = `
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${hair.top}"/><stop offset="1" stop-color="${hair.end}"/></linearGradient></defs>
    <path d="M22 46C22 25 34 14 50 14S78 25 78 46L79.5 76Q79.5 79 76.5 79H23.5Q20.5 79 20.5 76Z" fill="url(#${id})"/>
    <path d="M17 101C19 86 33 80 50 80S81 86 83 101Z" fill="${skin}"/>
    <path d="M44 62H56V82Q50 86 44 82Z" fill="${shade}"/>
    <path d="M25 101C28 93 39 91 50 91S72 93 75 101Z" fill="#fbf7ee"/>
    <path d="M33.5 84.5L30.5 101M66.5 84.5L69.5 101" stroke="#fbf7ee" stroke-width="2.6" stroke-linecap="round"/>
    <path d="M43.5 81Q50 89 56.5 81" stroke="#d9ad3c" stroke-width=".9" fill="none"/>
    <circle cx="50" cy="86.2" r="1.7" fill="none" stroke="#c9ccd3" stroke-width="1"/>
    <ellipse cx="50" cy="50" rx="20" ry="22.5" fill="${skin}"/>
    <path d="M27 42Q25.5 60 26.5 77H33.5Q31 60 32.5 44Z" fill="url(#${id})"/>
    <path d="M73 42Q74.5 60 73.5 77H66.5Q69 60 67.5 44Z" fill="url(#${id})"/>
    <path d="M27.5 46C26.5 27 37 18.5 50 18.5S73.5 27 72.5 46Z" fill="url(#${id})"/>
    <path d="M36 25Q50 19 64 25M40 30V45M48 28V45M56 28V45" stroke="#fff" stroke-opacity=".2" stroke-width="1.2" fill="none" stroke-linecap="round"/>
    <g class="eyes-open"><ellipse cx="42" cy="55" rx="3.1" ry="3.7" fill="#2b2f3a"/><ellipse cx="58" cy="55" rx="3.1" ry="3.7" fill="#2b2f3a"/>
    <circle cx="43.2" cy="53.6" r="1.15" fill="#fff"/><circle cx="59.2" cy="53.6" r="1.15" fill="#fff"/></g>
    <path class="eyes-shut" display="none" d="M39 55.5Q42 57.5 45 55.5M55 55.5Q58 57.5 61 55.5" stroke="#2b2f3a" stroke-width="1.6" fill="none" stroke-linecap="round"/>
    <ellipse cx="36.5" cy="62" rx="3.6" ry="2.1" fill="#f59aa0" opacity=".55"/><ellipse cx="63.5" cy="62" rx="3.6" ry="2.1" fill="#f59aa0" opacity=".55"/>
    <path d="M49.3 58.5Q48.6 60.4 50.2 60.8" stroke="${shade}" stroke-width="1.1" fill="none" stroke-linecap="round"/>
    <path d="M46 65Q50 68.3 54 65" stroke="#c4646b" stroke-width="1.7" fill="none" stroke-linecap="round"/>`;
  const back = bg === 'none' ? '' : full ? `<rect width="100" height="100" fill="${bg}"/>` : `<rect width="100" height="100" rx="22" fill="${bg}"/>`;
  // The maskable icon keeps the drawing inside the middle 80% so nothing important is cropped.
  const body = full ? `<g transform="translate(10 10) scale(.8)">${art}</g>` : `<g clip-path="url(#${id}c)">${art}</g>`;
  const clip = full ? '' : `<clipPath id="${id}c"><rect width="100" height="100" rx="22"/></clipPath>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs>${clip}</defs>${back}${body}</svg>`;
}

// Her as a cut-out figure for the home screen: no background or square, cut off exactly at y = 100, which sits on
// the top edge of the Money card. Includes her waving hand, hidden below the edge until she waves.
function avatarFigure(hair = hairForMonth()) {
  const skin = '#f8d9c6', line = '#ecc0a8';
  const id = 'rf' + (++avatarCount);
  const art = avatarSVG(hair, { bg: 'none' }).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')
    .replace(/<defs><clipPath[^]*?<\/clipPath><\/defs>/, '').replace(/ clip-path="[^"]*"/, '');
  const hand = `<g class="arm-lift" transform="translate(0 45)"><g class="arm-wave">
      <path d="M90 95Q91.5 84 92 75" stroke="${skin}" stroke-width="8" stroke-linecap="round" fill="none"/>
      <rect x="86.6" y="64" width="10.8" height="11.5" rx="5" fill="${skin}"/>
      <path d="M88.6 66V61.6M91.2 65.4V60.2M93.8 65.4V60.6M96.3 66.5V62.6" stroke="${skin}" stroke-width="2.3" stroke-linecap="round"/>
      <path d="M87 71.5Q84.3 69.5 84.6 67" stroke="${skin}" stroke-width="2.4" stroke-linecap="round" fill="none"/>
      <path d="M89 72.5Q92 73.8 95 72.5" stroke="${line}" stroke-width=".8" fill="none" stroke-linecap="round"/></g></g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" overflow="visible">
    <defs><clipPath id="${id}"><rect x="-20" y="-20" width="140" height="120"/></clipPath></defs>
    <g clip-path="url(#${id})">${art}${hand}</g></svg>`;
}

// Puts this month's avatar in the browser tab.
function setAvatarFavicon() {
  let link = document.querySelector('link[rel="icon"]');
  if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
  link.type = 'image/svg+xml';
  link.href = 'data:image/svg+xml,' + encodeURIComponent(avatarSVG());
}
