// Grafika paska na desktopie: pierścienie (ctx, 5h, 7d) i pixel-art Clawd w dwóch scenach.
// Same czyste funkcje zwracające markup SVG (string) - element Svg rysuje go jako obraz,
// a z isInteractive w piaskownicy bez skryptów, gdzie działa animacja SMIL.

import type { Scene } from '../types'

// hex odpowiedniki kolorów z tone()/ctxTone() w register.tsx; gray = brak odczytu
export const TONE_HEX: Record<string, string> = {
  blue: '#4a8fe7',
  yellow: '#e0a400',
  red: '#e5484d',
  green: '#3fb950',
  gray: '#8a8a8a',
}

const ICONS = {
  // zegar: tarcza + wskazówki
  clock: '<circle cx="15" cy="15" r="5.5"/><path d="M15 12.2V15l2 1.4"/>',
  // kalendarz: kartka + grzbiet + dwa kółka spinacza
  calendar: '<rect x="10" y="11" width="10" height="9" rx="1.5"/><path d="M10 14.2h10M12.6 9.6v2.8M17.4 9.6v2.8"/>',
  // chip: kwadrat z nóżkami po bokach (kontekst modelu)
  chip: '<rect x="11.5" y="11.5" width="7" height="7" rx="1"/><path d="M13.5 9.5v2M16.5 9.5v2M13.5 18.5v2M16.5 18.5v2M9.5 13.5h2M9.5 16.5h2M18.5 13.5h2M18.5 16.5h2"/>',
} as const

export type RingIcon = keyof typeof ICONS

// okrąg tła + łuk postępu (stroke-dasharray/dashoffset), w środku ikona; viewBox 30x30
export function ring(pct: number, color: string, icon: RingIcon) {
  const r = 12
  const c = 2 * Math.PI * r
  const p = Math.max(0, Math.min(100, pct))
  const arc =
    p > 0
      ? `<circle cx="15" cy="15" r="${r}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" ` +
        `stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - p / 100)).toFixed(2)}" transform="rotate(-90 15 15)"/>`
      : ''
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 30 30">' +
    `<circle cx="15" cy="15" r="${r}" fill="none" stroke="#8a8a8a" stroke-opacity="0.3" stroke-width="3"/>` +
    arc +
    `<g fill="none" stroke="${color}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${ICONS[icon]}</g>` +
    '</svg>'
  )
}

// --- Clawd: siatka 48x12 "pikseli", 4 klatki co 0.3 s ---

const W = 48
const H = 12
const FRAMES = 4

// kolor piksela: '#rrggbb' albo '#rrggbb|0.4' (z przezroczystością)
type Grid = (string | undefined)[][]

const blank = (): Grid => Array.from({ length: H }, () => Array<string | undefined>(W).fill(undefined))

function stamp(g: Grid, rows: string[], x: number, y: number, pal: Record<string, string>) {
  rows.forEach((row, dy) =>
    [...row].forEach((ch, dx) => {
      const color = pal[ch]
      const r = g[y + dy]
      if (color && r && x + dx >= 0 && x + dx < W) r[x + dx] = color
    }),
  )
}

const put = (g: Grid, x: number, y: number, color: string) => {
  const r = g[y]
  if (r && x >= 0 && x < W) r[x] = color
}

const CLAWD = {
  o: '#e8793a',
  od: '#d4622a',
  k: '#141414',
  white: '#ffffff',
}
// Clawd: pomarańczowy, w czarnych okularach (dwa rzędy: oprawka + szkła)
const CRAB = [
  ' oooooooo ',
  ' kkkkkkkk ',
  ' okkookko ',
  'dooooooood',
  ' oooooooo ',
]
const CRAB_PAL = { o: CLAWD.o, k: CLAWD.k, d: CLAWD.od }
const LEGS = [' d d  d d ', 'd d    d d']

function crab(g: Grid, x: number, y: number, f: number) {
  stamp(g, CRAB, x, y, CRAB_PAL)
  stamp(g, [LEGS[f % 2]!], x, y + CRAB.length, { d: CLAWD.od })
}

function mask(rows: string[], x: number, y: number) {
  const g = blank()
  stamp(g, rows, x, y, { o: '1', k: '1', d: '1' })
  return g
}

// a frame is layers drawn in order (a translucent helmet over Clawd needs its own layer)
type SceneArt = { base: Grid; frame: (f: number) => Grid[]; alt: string }

// deterministic pseudo-random per pixel, so the stars scatter instead of lining up
function hash(x: number, y: number, seed: number) {
  let h = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263) ^ Math.imul(seed, 2246822519)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return (h ^ (h >>> 16)) >>> 0
}

// --- scena 1: plaża o zachodzie słońca ---

function beach(): SceneArt {
  const C = {
    sea: '#2a6fd6',
    foam: '#a9d0ff',
    glow: '#f4c27a',
    sand: '#e9c46a',
    sand2: '#d6a94f',
    sun: '#ffd166',
    sun2: '#fff1a8',
  }
  // pasy nieba od góry: fiolet -> czerwień -> pomarańcz -> żółć przy horyzoncie
  const SKY = ['#5b3a8a', '#5b3a8a', '#d9534f', '#d9534f', '#f4a261', '#f6e27a']
  const SEA_ROWS = [6, 7]
  const X = 8
  const Y = 5
  const NOTE = [' ww', ' w ', 'ww ']
  const crabMask = mask(CRAB, X, Y)

  const base = blank()
  for (let y = 0; y < H; y++) {
    const r = base[y]!
    for (let x = 0; x < W; x++) {
      if (y < SKY.length) r[x] = SKY[y]
      else if (SEA_ROWS.includes(y)) r[x] = C.sea
      else r[x] = (x * 7 + y * 3) % 11 === 0 ? C.sand2 : C.sand
    }
  }
  // słońce siedzi na horyzoncie, dolną połowę chowa morze
  for (let y = 2; y < SKY.length; y++)
    for (let x = 31; x <= 41; x++) {
      const d = (x - 36) ** 2 + ((y - 6) * 1.3) ** 2
      if (d <= 6) put(base, x, y, C.sun2)
      else if (d <= 16) put(base, x, y, C.sun)
    }
  // odblask słońca na wodzie
  for (let x = 33; x <= 39; x++) put(base, x, 6, C.glow)
  for (let x = 35; x <= 37; x++) put(base, x, 7, C.glow)
  stamp(base, CRAB, X, Y, CRAB_PAL)

  const frame = (f: number) => {
    const g = blank()
    // fale: grzbiety piany przesuwają się w prawo (górny rząd) i w lewo (dolny)
    for (let x = 0; x < W; x++) {
      if ((x + 8 - 2 * f) % 8 === 0 && !crabMask[6]![x]) put(g, x, 6, C.foam)
      if ((x + 2 * f + 4) % 8 === 0 && !crabMask[7]![x]) put(g, x, 7, C.foam)
    }
    // nogi Clawda na przemian
    stamp(g, [LEGS[f % 2]!], X, Y + CRAB.length, { d: CLAWD.od })
    // błysk na okularach w klatce 2
    if (f === 2) {
      put(g, X + 3, Y + 1, CLAWD.white)
      put(g, X + 7, Y + 1, CLAWD.white)
    }
    // słońce drga: w klatkach 1 i 3 wychyla się o piksel wyżej
    if (f % 2 === 1) for (let x = 35; x <= 37; x++) put(g, x, 1, C.sun)
    // nutka podskakuje
    stamp(g, NOTE, 2, f < 2 ? 1 : 0, { w: CLAWD.white })
    return [g]
  }
  return { base, frame, alt: 'Clawd w okularach na plaży o zachodzie słońca' }
}

// --- scena 2: kosmos ---

function space(): SceneArt {
  const C = {
    bg: '#0b1026',
    star0: '#4a5280',
    starA: '#ffffff',
    starB: '#ffe9a8',
    starC: '#9fd3ff',
    planet: '#c78bff',
    planet2: '#a067e0',
    ringc: '#e0d0ff',
    earth: '#2a6fd6',
    land: '#3fae5a',
    comet: '#ffffff',
    tail: '#7fd4ff',
    bubble: '#bfe6ff|0.35',
    rim: '#d8f0ff',
    collar: '#cfd8e6',
  }
  const X = 14
  const Y = 3
  // przesunięcie w pionie per klatka: Clawd unosi się o 1 px góra-dół
  const FLOAT = [0, -1, 0, 1]
  // hełm: bańka (b, półprzezroczysta) z obwódką (H) nad głową i kołnierz (c) na wysokości ramion
  const HELMET = [
    '   HHHHHH   ',
    ' HHbbbbbbHH ',
    'HbbbbbbbbbbH',
    'HbbbbbbbbbbH',
    'HbbbbbbbbbbH',
    '  cccccccc  ',
  ]

  const base = blank()
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) put(base, x, y, hash(x, y, 1) % 19 === 0 ? C.star0 : C.bg)
  // Ziemia w lewym dolnym rogu (ćwiartka koła)
  for (let y = 7; y < H; y++)
    for (let x = 0; x <= 5; x++) {
      const d = x ** 2 + (y - 12) ** 2
      if (d <= 26) put(base, x, y, (x === 1 && y === 9) || (x + y) % 4 === 0 ? C.land : C.earth)
    }
  // planeta z pierścieniem po prawej
  for (let y = 1; y <= 8; y++)
    for (let x = 36; x <= 44; x++) {
      const d = (x - 40) ** 2 + (y - 4.5) ** 2
      if (d <= 7) put(base, x, y, x + y > 46 ? C.planet2 : C.planet)
    }
  for (let x = 35; x <= 45; x++) put(base, x, x < 38 ? 6 : x > 42 ? 4 : 5, C.ringc)

  const isBg = (x: number, y: number) => {
    const c = base[y]?.[x]
    return c === C.bg || c === C.star0
  }

  const frame = (f: number) => {
    const g = blank()
    // gwiazdy migają w trzech warstwach, każda w innych klatkach
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        if (!isBg(x, y)) continue
        if (f % 2 === 0 && hash(x, y, 2) % 23 === 0) put(g, x, y, C.starA)
        if (f % 2 === 1 && hash(x, y, 3) % 23 === 0) put(g, x, y, C.starB)
        if (f === 3 && hash(x, y, 4) % 29 === 0) put(g, x, y, C.starC)
      }
    // kometa przelatuje w klatkach 1 i 2
    if (f === 1 || f === 2) {
      const hx = f === 1 ? 26 : 32
      const hy = f === 1 ? 1 : 2
      put(g, hx, hy, C.comet)
      put(g, hx - 1, hy, C.tail)
      put(g, hx - 2, hy - 1, C.tail)
      put(g, hx - 3, hy - 1, C.tail + '|0.5')
    }
    // Clawd w hełmie, unosi się
    const y = Y + FLOAT[f]!
    crab(g, X, y + 2, f)
    // hełm na osobnej warstwie: półprzezroczysta bańka leży NA Clawdzie, nie zamiast niego
    const helmet = blank()
    stamp(helmet, HELMET, X - 1, y, { H: C.rim, b: C.bubble, c: C.collar })
    // odblask na bańce
    put(helmet, X + 2, y + 1, CLAWD.white)
    // błysk okularów w klatce 2
    if (f === 2) put(helmet, X + 3, y + 3, CLAWD.white)
    return [g, helmet]
  }
  return { base, frame, alt: 'Clawd w hełmie astronauty w kosmosie (space)' }
}

// sąsiednie piksele tego samego koloru w wierszu łączą się w jeden rect
function rects(g: Grid) {
  let out = ''
  g.forEach((row, y) => {
    let x = 0
    while (x < W) {
      const color = row[x]
      let n = 1
      while (x + n < W && row[x + n] === color) n++
      if (color) {
        const [fill, alpha] = color.split('|')
        out += `<rect x="${x}" y="${y}" width="${n}" height="1" fill="${fill}"${alpha ? ` fill-opacity="${alpha}"` : ''}/>`
      }
      x += n
    }
  })
  return out
}

const SCENES: Record<Scene, () => SceneArt> = { plaza: beach, kosmos: space }
const cache = new Map<Scene, { source: string; alt: string }>()

// scena jest stała, więc markup liczy się raz na scenę i załadowanie modułu
export function clawd(scene: Scene = 'plaza') {
  const hit = cache.get(scene)
  if (hit) return hit
  const art = SCENES[scene]()
  const frames = Array.from({ length: FRAMES }, (_, f) => {
    const values = Array.from({ length: FRAMES }, (_, i) => (i === f ? 1 : 0)).join(';')
    return (
      `<g opacity="${f === 0 ? 1 : 0}">` +
      `<animate attributeName="opacity" values="${values}" dur="1.2s" calcMode="discrete" repeatCount="indefinite"/>` +
      art.frame(f).map(rects).join('') +
      '</g>'
    )
  }).join('')
  const out = {
    alt: art.alt,
    source:
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="200" height="50" ` +
      'preserveAspectRatio="none" shape-rendering="crispEdges">' +
      rects(art.base) +
      frames +
      '</svg>',
  }
  cache.set(scene, out)
  return out
}
