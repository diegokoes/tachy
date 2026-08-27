/**
 * Icon geometry from Hola SVG Icons by Mariana Beldi (MIT).
 * https://icons.holasvg.com — https://github.com/marianabeldi/holasvg-icons
 *
 * All shapes are authored on a 0 0 100 100 grid and drawn stroke-only, so they
 * take their color from `currentColor` and their weight from Icon.svelte.
 */
export const ICONS = {
  chat: '<polygon points="10,20 90,20 90,70 60,70 50,80 40,70 10,70"/>',

  library:
    '<rect x="10" y="15" width="80" height="15"/><rect x="15" y="30" width="70" height="55"/><line x1="35" y1="52" x2="65" y2="52"/>',

  admin:
    '<polyline points="25,20 5,35 25,50"/><line x1="5" y1="35" x2="70" y2="35"/><polyline points="75,50 95,65 75,80"/><line x1="30" y1="65" x2="95" y2="65"/>',

  settings:
    '<line x1="20" y1="15" x2="20" y2="85"/><line x1="50" y1="15" x2="50" y2="85"/><line x1="80" y1="15" x2="80" y2="85"/><circle cx="20" cy="70" r="4"/><circle cx="50" cy="30" r="4"/><circle cx="80" cy="50" r="4"/>',

  analyze:
    '<circle cx="50" cy="50" r="40"/><circle cx="50" cy="50" r="22"/><circle cx="50" cy="50" r="4"/>',

  consult:
    '<circle cx="60" cy="40" r="30"/><line x1="10" y1="90" x2="38" y2="62"/>',

  compact:
    '<polyline points="10,15 30,50 55,20 80,80"/><polyline points="60,70 80,80 90,60"/>',

  ticket:
    '<polygon points="15,10 15,90 85,90 85,25 70,10"/><line x1="35" y1="55" x2="65" y2="55"/><line x1="50" y1="40" x2="50" y2="70"/><polyline points="70,10 70,25 85,25"/>',

  code: '<polyline points="25,35 5,50 25,65"/><line x1="58" y1="30" x2="42" y2="70"/><polyline points="75,35 95,50 75,65"/>',

  json: '<g transform="scale(3.125)" fill="currentColor" stroke="none"><polygon points="31 11 31 21 29 21 27 15 27 21 25 21 25 11 27 11 29 17 29 11"/><path d="M21.3335 21h-2.667A1.6684 1.6684 0 0 1 17 19.3335v-6.667A1.6684 1.6684 0 0 1 18.6665 11h2.667A1.6684 1.6684 0 0 1 23 12.6665v6.667A1.6684 1.6684 0 0 1 21.3335 21ZM19 19h2v-6h-2Z"/><path d="M13.3335 21H9v-2h4v-2h-2a2.002 2.002 0 0 1-2-2v-2.3335A1.6684 1.6684 0 0 1 10.6665 11H15v2h-4v2h2a2.002 2.002 0 0 1 2 2v2.3335A1.6684 1.6684 0 0 1 13.3335 21Z"/><path d="M5.3335 21H2.6665A1.6684 1.6684 0 0 1 1 19.3335V17h2v2h2v-8h2v8.3335A1.6684 1.6684 0 0 1 5.3335 21Z"/></g>',

  attach:
    '<polygon points="15,10 15,90 85,90 85,25 70,10"/><line x1="35" y1="55" x2="65" y2="55"/><line x1="50" y1="40" x2="50" y2="70"/><polyline points="70,10 70,25 85,25"/>',

  send: '<polygon points="10,20 90,20 90,70 60,70 50,80 40,70 10,70"/><line x1="30" y1="38" x2="70" y2="38"/><line x1="30" y1="52" x2="50" y2="52"/>',

  erase:
    '<polygon points="5,50 30,20 90,20 90,80 30,80"/><line x1="70" y1="38" x2="45" y2="62"/><line x1="45" y1="38" x2="70" y2="62"/>',

  doc: '<rect x="15" y="10" width="70" height="80"/><line x1="30" y1="30" x2="50" y2="30"/><line x1="30" y1="50" x2="70" y2="50"/><line x1="30" y1="70" x2="70" y2="70"/>',

  artifactDoc:
    '<rect x="15" y="10" width="70" height="80"/><circle cx="30" cy="30" r="1"/><circle cx="30" cy="50" r="1"/><circle cx="30" cy="70" r="1"/><line x1="45" y1="30" x2="70" y2="30"/><line x1="45" y1="50" x2="70" y2="50"/><line x1="45" y1="70" x2="70" y2="70"/>',

  download:
    '<polyline points="10,75 10,90 90,90 90,75"/><line x1="50" y1="15" x2="50" y2="65"/><polyline points="30,50 50,65 70,50"/>',

  alert:
    '<polygon points="50,10 95,90 5,90"/><line x1="50" y1="42" x2="50" y2="60"/><circle cx="50" cy="75" r="1"/>',

  info: '<circle cx="50" cy="50" r="40"/><line x1="50" y1="30" x2="50" y2="52"/><circle cx="50" cy="68" r="1"/>',

  index:
    '<rect x="10" y="11" width="80" height="26"/><rect x="10" y="37" width="80" height="26"/><rect x="10" y="63" width="80" height="26"/><circle cx="30" cy="24" r="2"/><circle cx="30" cy="50" r="2"/><circle cx="30" cy="76" r="2"/>',

  archive:
    '<rect x="15" y="15" width="70" height="35"/><rect x="15" y="50" width="70" height="35"/><circle cx="70" cy="33" r="2"/><circle cx="70" cy="69" r="2"/>',

  upload:
    '<line x1="20" y1="80" x2="80" y2="80"/><line x1="50" y1="15" x2="50" y2="65"/><polyline points="30,30 50,15 70,30"/>',

  moveUp:
    '<line x1="20" y1="80" x2="80" y2="80"/><line x1="50" y1="15" x2="50" y2="65"/><polyline points="30,30 50,15 70,30"/>',

  moveDown:
    '<line x1="20" y1="20" x2="80" y2="20"/><line x1="50" y1="40" x2="50" y2="85"/><polyline points="30,70 50,85 70,70"/>',

  save: '<rect x="10" y="10" width="80" height="80"/><rect x="30" y="10" width="40" height="20"/><rect x="25" y="55" width="50" height="35"/>',

  cancel:
    '<line x1="15" y1="15" x2="85" y2="85"/><line x1="85" y1="15" x2="15" y2="85"/>',

  back: '<polyline points="90,10 50,50 90,90"/><polyline points="60,10 20,50 60,90"/>',

  next: '<polyline points="10,10 50,50 10,90"/><polyline points="40,10 80,50 40,90"/>',

  go: '<polyline points="30,10 80,50 30,90"/>',

  plus: '<line x1="20" y1="50" x2="80" y2="50"/><line x1="50" y1="20" x2="50" y2="80"/>',

  edit: '<rect x="15" y="15" width="70" height="70"/>',

  check: '<polyline points="10,60 40,85 85,15"/>',

  checkbox: '<circle cx="50" cy="50" r="25"/>',

  /** affected → fixed: an arrow travelling into the version it lands on. */
  versionArrow:
    '<line x1="80" y1="20" x2="80" y2="80"/><line x1="15" y1="50" x2="65" y2="50"/><polyline points="50,30 65,50 50,70"/>',

  test: '<polyline points="20,25 35,5 50,25"/><line x1="35" y1="5" x2="35" y2="70"/><polyline points="50,75 65,95 80,75"/><line x1="65" y1="30" x2="65" y2="95"/>',

  discover:
    '<polyline points="10,75 10,90 90,90 90,75"/><line x1="50" y1="15" x2="50" y2="65"/><polyline points="30,50 50,65 70,50"/>',
} as const;

export type IconName = keyof typeof ICONS;
