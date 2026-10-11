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

// --- wspólne pomocniki nowych scen ---

// mieszanie dwóch kolorów hex (t = 0..1), do gradientów tła
function mix(a: string, b: string, t: number) {
  const pa = parseInt(a.slice(1), 16)
  const pb = parseInt(b.slice(1), 16)
  const ch = (s: number) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t)
  return '#' + ((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')
}

// prostokąt pikseli, oba rogi włącznie
function fill(g: Grid, x0: number, y0: number, x1: number, y1: number, color: string) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(g, x, y, color)
}

// --- scena 3: nurek pod wodą ---

function diver(): SceneArt {
  const C = {
    top: '#1b6fb8',
    deep: '#0e3a6e',
    ray: '#bfe6ff|0.2',
    sand: '#d8b878',
    sand2: '#b8955a',
    pink: '#ff6f91',
    orange: '#ffb347',
    orange2: '#e08a2a',
    green: '#7ed957',
    weed: '#2f9e44',
    glass: '#bfe6ff|0.4',
    // nad czarnymi szkłami okularów szybka ledwo widoczna, żeby okulary zostały czarne
    tint: '#bfe6ff|0.1',
    rim: '#e8f4ff',
    tube: '#ffd166',
    tip: '#ff6f3c',
    bubble: '#e8f6ff',
    fish: '#ffd166',
    fin: '#ff9f1c',
  }
  const X = 16
  const Y = 4
  const SNORKEL = X + 10
  const crabMask = mask(CRAB, X, Y)
  // koralowce: różowy rozgałęziony (lewo), zielony (środek), pomarańczowy mózgowy (prawo)
  const PINK = ['p  p', 'p pp', 'ppp ', ' p  ']
  const GREEN = ['g g', 'ggg', ' g ']
  const BRAIN = [' oo ', 'oqoo', 'oooq']
  // rybka płynie w lewo: głowa z okiem z lewej, ogon z prawej
  const FISH = [' ff f', 'kfffn', ' ff f']

  const base = blank()
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      put(base, x, y, y < 10 ? mix(C.top, C.deep, y / 9) : (x * 5 + y * 3) % 7 === 0 ? C.sand2 : C.sand)
  stamp(base, PINK, 2, 6, { p: C.pink })
  stamp(base, GREEN, 34, 7, { g: C.green })
  stamp(base, BRAIN, 41, 7, { o: C.orange, q: C.orange2 })
  // fajka: rurka po prawej stronie głowy, ustnik przy pyszczku, czerwony koniec na górze
  for (let y = Y - 2; y <= Y + 2; y++) put(base, SNORKEL, y, C.tube)
  put(base, SNORKEL, Y - 2, C.tip)
  put(base, X + 9, Y + 2, C.tube)
  stamp(base, CRAB, X, Y, CRAB_PAL)

  const isWater = (x: number, y: number) => y < 10 && !crabMask[y]![x] && x !== SNORKEL
  const frame = (f: number) => {
    const g = blank()
    // promienie światła z góry: ukośne jaśniejsze pasy, dwa zestawy na przemian
    for (const x0 of f % 2 === 0 ? [8, 22, 38] : [15, 30, 45])
      for (let y = 0; y < 8; y++)
        for (const dx of [0, 1]) {
          const x = x0 - (y >> 1) + dx
          if (isWater(x, y)) put(g, x, y, C.ray)
        }
    // wodorosty falują: co drugi wiersz przesunięty o piksel, faza zmienia się co klatkę
    for (const wx of [9, 29, 46])
      for (let y = 5; y < 10; y++) put(g, wx + ((y + f) % 2), y, C.weed)
    // nogi Clawda młócą wodę
    stamp(g, [LEGS[f % 2]!], X, Y + CRAB.length, { d: CLAWD.od })
    // 3 bąbelki z fajki, każdy w innej fazie, 1 px w górę na klatkę (okres 4 wiersze)
    ;[0, 1, 2].forEach(i => put(g, SNORKEL + 1 + (i % 2), 3 - ((f + i) % 4), C.bubble))
    // rybka z prawej na lewo, 2 px na klatkę
    stamp(g, FISH, 40 - 2 * f, 1, { f: C.fish, n: C.fin, k: CLAWD.k })
    // maska: półprzezroczysta szybka na okularach (czarne zostają widoczne) i jasna obwódka
    const m = blank()
    for (let y = Y + 1; y <= Y + 2; y++)
      for (let x = X + 1; x <= X + 8; x++) put(m, x, y, CRAB[y - Y]![x - X] === 'k' ? C.tint : C.glass)
    put(m, X, Y + 1, C.rim)
    put(m, X, Y + 2, C.rim)
    put(m, X + 9, Y + 1, C.rim)
    put(m, X + 2, Y + 1, CLAWD.white)
    if (f === 2) put(m, X + 6, Y + 1, CLAWD.white)
    return [g, m]
  }
  return { base, frame, alt: 'Clawd nurek w masce z fajką pod wodą, bąbelki, rybka i koralowce' }
}

// --- scena 4: dżungla (Indiana Jones) ---

function jungle(): SceneArt {
  const C = {
    bg: '#123b1f',
    leaf: '#1f5a30',
    leaf2: '#2d7a3f',
    vine: '#3f8f3a',
    ground: '#3b2a1a',
    ground2: '#2a1d12',
    stone: '#6b6b5a',
    stone2: '#57574a',
    door: '#141410',
    hat: '#6b4a2b',
    band: '#3a2615',
    whip: '#c08a4a',
    crack: '#fff1a8',
    rock: '#8a8a7a',
    rock2: '#4e4e44',
    red: '#e63946',
    yellow: '#ffd166',
    branch: '#5a3e2b',
  }
  const X = 17
  const Y = 4
  const FEDORA = ['  hhhhhh  ', '  bbbbbb  ', 'hhhhhhhhhh']
  const PARROT = [' rky', 'rrr ', 'yyr ', ' r  ']
  // kamienna kula: plamka obiega ją w 4 klatkach, więc wygląda, jakby się toczyła
  const SPOT = [[5, 6], [5, 8], [3, 8], [3, 6]] as const

  const base = blank()
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const h = hash(x, y, 7)
      put(base, x, y, y >= 10 ? (h % 5 === 0 ? C.ground2 : C.ground) : h % 4 === 0 ? C.leaf : h % 9 === 0 ? C.leaf2 : C.bg)
    }
  // liany z góry, lekko faliste
  for (const [vx, len] of [[15, 5], [29, 6], [33, 3]] as const)
    for (let y = 0; y < len; y++) put(base, vx + (y % 3 === 2 ? 1 : 0), y, y === len - 1 ? C.leaf2 : C.vine)
  // świątynia: trzy stopnie, szwy między blokami, ciemne wejście z nadprożem
  fill(base, 39, 3, 44, 3, C.stone)
  fill(base, 37, 4, 46, 5, C.stone)
  fill(base, 35, 6, 47, 9, C.stone)
  for (let y = 3; y <= 9; y++)
    for (let x = 35; x < W; x++) if (base[y]![x] === C.stone && (x + (y % 2) * 2) % 4 === 0) put(base, x, y, C.stone2)
  fill(base, 40, 5, 43, 5, C.stone2)
  fill(base, 40, 6, 43, 9, C.door)
  // gałąź odchodzi od liany, na niej papuga
  fill(base, 9, 4, 15, 4, C.branch)
  stamp(base, PARROT, 10, 0, { r: C.red, y: C.yellow, k: CLAWD.k })
  stamp(base, CRAB, X, Y, CRAB_PAL)
  stamp(base, FEDORA, X, Y - 3, { h: C.hat, b: C.band })
  // kamienna kula po lewej
  for (let y = 5; y <= 9; y++)
    for (let x = 1; x <= 7; x++) if ((x - 4) ** 2 + ((y - 7) * 1.2) ** 2 <= 8) put(base, x, y, C.rock)

  const frame = (f: number) => {
    const g = blank()
    const [sx, sy] = SPOT[f]!
    put(g, sx, sy, C.rock2)
    put(g, sx, sy - 1, C.rock2)
    // pył za toczącą się kulą
    if (f % 2 === 0) put(g, 8, 9, C.stone)
    else put(g, 9, 8, C.stone)
    stamp(g, [LEGS[f % 2]!], X, Y + CRAB.length, { d: CLAWD.od })
    // bicz: w klatkach 0-1 zwisa z prawej szczypiec, w 2-3 strzela w górę (w 3 trzask)
    const hand = [X + 10, Y + 3] as const
    const whip: (readonly [number, number])[] =
      f < 2
        ? [[0, 0], [1, 1], [2, 2], [3, 2], [4, 1 + f]]
        : f === 2
          ? [[0, 0], [1, -1], [2, -2], [3, -3], [4, -3]]
          : [[0, 0], [1, -1], [2, -2], [3, -3], [4, -4], [5, -5], [6, -6]]
    whip.forEach(([dx, dy]) => put(g, hand[0] + dx, hand[1] + dy, C.whip))
    if (f === 3) {
      put(g, hand[0] + 7, hand[1] - 7, C.crack)
      put(g, hand[0] + 7, hand[1] - 5, C.crack)
      put(g, hand[0] + 8, hand[1] - 6, C.crack)
    }
    // papuga mruga w klatce 3
    if (f === 3) put(g, 12, 0, C.red)
    return [g]
  }
  return { base, frame, alt: 'Clawd jak Indiana Jones w dżungli: fedora, bicz, świątynia, kamienna kula i papuga' }
}

// --- scena 5: biuro nocą ---

function office(): SceneArt {
  const C = {
    wall: '#1c1f2b',
    floor: '#14161f',
    frame: '#2c3142',
    night: '#0b1430',
    tower: '#2e3a60',
    lit: '#ffd166',
    desk: '#5a3e2b',
    desk2: '#4a3322',
    knob: '#8a6a4a',
    screen: '#101418',
    bezel: '#2a2f38',
    green: '#7ed957',
    blue: '#bfe6ff',
    lamp: '#ffd166',
    bulb: '#fff6d0',
    mug: '#e8e8e8',
    steam: '#c8ccd8|0.7',
    chair: '#3a3f55',
    chair2: '#2a2e40',
  }
  const X = 13
  const Y = 3
  // wieżowce za oknem: [x, wiersz dachu]
  const TOWERS = [[2, 3], [3, 3], [4, 2], [5, 2], [6, 2], [7, 4], [8, 1], [9, 1], [10, 1]] as const
  const MONITORS = [26, 35]
  // linie kodu: [wcięcie, długość, kolor]; ekran pokazuje 4 z nich i co klatkę przesuwa je o wiersz w górę
  const CODE: [number, number, string][][] = [
    [[0, 3, C.green], [1, 3, C.blue], [1, 2, C.green], [0, 0, C.blue]],
    [[0, 4, C.blue], [2, 2, C.green], [0, 0, C.green], [1, 3, C.blue]],
  ]

  const base = blank()
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) put(base, x, y, y === 11 ? C.floor : C.wall)
  // okno z nocnym miastem
  fill(base, 1, 0, 11, 7, C.frame)
  fill(base, 2, 1, 10, 6, C.night)
  for (const [x, top] of TOWERS) fill(base, x, top, x, 6, C.tower)
  // fotel za Clawdem: oparcie, siedzisko, kolumna, kółka
  fill(base, X - 1, Y - 1, X + 10, Y + 4, C.chair)
  fill(base, X - 1, Y + 5, X + 10, Y + 5, C.chair2)
  fill(base, X + 4, Y + 6, X + 5, Y + 7, C.chair2)
  put(base, X + 1, 10, C.chair2)
  put(base, X + 8, 10, C.chair2)
  // biurko: blat, front z szufladą, nogi
  fill(base, 25, 8, 47, 8, C.desk)
  fill(base, 25, 9, 47, 10, C.desk2)
  fill(base, 30, 9, 31, 9, C.knob)
  fill(base, 26, 11, 26, 11, C.desk2)
  fill(base, 46, 11, 46, 11, C.desk2)
  // dwa monitory na nóżkach
  for (const mx of MONITORS) {
    fill(base, mx, 1, mx + 7, 6, C.bezel)
    fill(base, mx + 1, 2, mx + 6, 5, C.screen)
    fill(base, mx + 3, 7, mx + 4, 7, C.bezel)
  }
  // lampka: klosz (trapez), żarówka pod nim, ramię i podstawa
  fill(base, 44, 1, 46, 1, C.lamp)
  fill(base, 43, 2, 47, 2, C.lamp)
  fill(base, 44, 3, 45, 3, C.bulb)
  fill(base, 47, 3, 47, 6, C.lamp)
  fill(base, 45, 7, 47, 7, C.lamp)
  // kubek z uszkiem
  fill(base, 43, 6, 44, 7, C.mug)
  put(base, 45, 6, C.mug)
  stamp(base, CRAB, X, Y, CRAB_PAL)
  stamp(base, [LEGS[0]!], X, Y + CRAB.length, { d: CLAWD.od })
  // stożek światła lampki: jaśniejsza ściana pod kloszem
  for (let y = 3; y <= 7; y++)
    for (let x = 43 - (y - 3); x <= 46; x++) if (base[y]![x] === C.wall) put(base, x, y, mix(C.wall, C.lamp, 0.25))

  const frame = (f: number) => {
    const g = blank()
    // okna w wieżowcach zapalają się i gasną, każde w innych klatkach
    for (const [x, top] of TOWERS)
      for (let y = top + 1; y <= 6; y += 2) if (hash(x, y, f + 11) % 3 === 0) put(g, x, y, C.lit)
    // kod na ekranach przewija się o 1 px w górę na klatkę
    MONITORS.forEach((mx, i) => {
      for (let r = 0; r < 4; r++) {
        const [indent, len, color] = CODE[i]![(r + f) % 4]!
        fill(g, mx + 1 + indent, 2 + r, Math.min(mx + 6, mx + indent + len), 2 + r, color)
      }
    })
    // para z kubka wije się na przemian
    for (let y = 4; y <= 5; y++) put(g, 43 + ((y + f) % 2), y, C.steam)
    // odblask monitorów w okularach: zielony, potem niebieski
    const glint = (f < 2 ? C.green : C.blue) + '|0.55'
    put(g, X + 2, Y + 2, glint)
    put(g, X + 6, Y + 2, glint)
    return [g]
  }
  return { base, frame, alt: 'Clawd nocą w biurze przy dwóch monitorach z kodem, lampka, kubek i miasto za oknem' }
}

// --- scena 6: góry zimą ---

function mountains(): SceneArt {
  const C = {
    sky: '#0f1b3d',
    star: '#3a4a7a',
    aurora1: '#4ade80|0.55',
    aurora2: '#a78bfa|0.5',
    snow: '#e8eef7',
    shade: '#9fb3c8',
    rock: '#4a5a80',
    rock2: '#34416a',
    ground2: '#c8d4e6',
    hat: '#e63946',
    hat2: '#b82d38',
    pom: '#ffffff',
    flame: '#ff6f3c',
    flame2: '#ffd166',
    log: '#6b4a2b',
    tree: '#1f6b3a',
    trunk: '#5a3e2b',
  }
  const X = 13
  const Y = 4
  // szczyty: [x, wiersz wierzchołka]
  const PEAKS = [[7, 2], [23, 5], [36, 1]] as const
  const HAT = ['    pp    ', '  hhhhhh  ', ' HHHHHHHH ']
  const TREE = ['   s   ', '  gsg  ', '  ggg  ', ' sgggs ', ' ggggg ', 'sgggggs', 'ggggggg', '   t   ']
  // płomień ma 3 kształty (r = pomarańcz, y = żółć); klatka 3 powtarza 1
  const FLAMES = [
    ['  y  ', ' yry ', 'ryyyr'],
    [' y   ', ' ry y', 'ryyrr'],
    ['   y ', 'y yr ', 'rryyr'],
  ]
  const FIRE_X = 27
  const crabMask = mask(CRAB, X, Y)

  // który szczyt tworzy grań nad kolumną x i na jakiej wysokości
  const ridge = (x: number) =>
    PEAKS.map(([cx, top]) => ({ cx, top, y: top + Math.floor(Math.abs(x - cx) * 0.75) })).reduce((a, b) => (b.y < a.y ? b : a))
  const base = blank()
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (y >= 10) {
        put(base, x, y, hash(x, y, 5) % 6 === 0 ? C.ground2 : C.snow)
        continue
      }
      const r = ridge(x)
      if (y < r.y) {
        put(base, x, y, hash(x, y, 8) % 29 === 0 ? C.star : C.sky)
        continue
      }
      // czapa śniegu na 3 górnych wierszach szczytu; prawe zbocze w cieniu
      const right = x > r.cx
      put(base, x, y, y - r.top <= 2 ? (right ? C.shade : C.snow) : right ? C.rock2 : C.rock)
    }
  // poświata ogniska na śniegu
  for (let x = FIRE_X - 3; x <= FIRE_X + 7; x++) put(base, x, 10, mix(C.snow, C.flame2, 0.35))
  fill(base, FIRE_X, 9, FIRE_X + 4, 9, C.log)
  put(base, FIRE_X + 1, 8, C.log)
  put(base, FIRE_X + 3, 8, C.log)
  stamp(base, TREE, 39, 2, { s: C.snow, g: C.tree, t: C.trunk })
  stamp(base, CRAB, X, Y, CRAB_PAL)
  stamp(base, HAT, X, Y - 3, { p: C.pom, h: C.hat, H: C.hat2 })
  const isSky = (x: number, y: number) => base[y]?.[x] === C.sky || base[y]?.[x] === C.star

  const frame = (f: number) => {
    const g = blank()
    // zorza: dwa pasy falują w poprzek nieba, przesuwając się co klatkę
    for (let x = 0; x < W; x++) {
      const y = 1 + Math.round(Math.sin((x + 3 * f) / 3.5))
      if (isSky(x, y)) put(g, x, y, C.aurora1)
      if (isSky(x, y + 1)) put(g, x, y + 1, C.aurora2)
    }
    // płomień i iskry
    stamp(g, FLAMES[f === 3 ? 1 : f]!, FIRE_X, 5, { r: C.flame, y: C.flame2 })
    put(g, FIRE_X + 1 + (f % 3), 4 - (f % 2), C.flame2)
    if (f % 2 === 1) put(g, FIRE_X + 4 - f, 2 + f, C.flame)
    stamp(g, [LEGS[f % 2]!], X, Y + CRAB.length, { d: CLAWD.od })
    // śnieg: 3 warstwy płatków, 1 px w dół na klatkę, kolumny co 4 wiersze (pętla bez skoku)
    ;['#ffffff', '#dfe7f5', '#aab8d0'].forEach((color, layer) => {
      for (let x = 0; x < W; x++) {
        if (hash(x, layer, 9) % 11 !== 0) continue
        const phase = hash(x, layer, 10) % 4
        for (let y = (phase + f) % 4; y < 10; y += 4)
          if (!crabMask[y]![x] && !(x >= FIRE_X && x <= FIRE_X + 4 && y >= 5)) put(g, x, y, color)
      }
    })
    return [g]
  }
  return { base, frame, alt: 'Clawd w czapce z pomponem zimą w górach przy ognisku, zorza, śnieg i choinka' }
}

// --- scena 7: neonowe miasto (cyberpunk) ---

function cyber(): SceneArt {
  const C = {
    sky: '#140c2a',
    sky2: '#5a2a7a',
    house: '#0b0f1f',
    win: '#1c2440',
    street: '#10142a',
    street2: '#1a2040',
    pink: '#ff2d95',
    cyan: '#00e5ff',
    yellow: '#ffe600',
    rain: '#4a5a8a',
    jacket: '#141414',
    car: '#00e5ff',
    car2: '#0099b0',
    head: '#ffffff',
    tail: '#ff2d95',
  }
  const X = 19
  const Y = 5
  // budynki: [x0, x1, dach]
  const HOUSES = [[0, 4, 3], [5, 10, 1], [11, 15, 5], [31, 36, 2], [37, 42, 4], [43, 47, 0]] as const
  // szyldy: [x0, y0, x1, y1, kolor, klatka, w której gaśnie]
  const SIGNS = [
    [6, 3, 9, 3, C.pink, 1],
    [7, 4, 8, 5, C.pink, 1],
    [33, 3, 33, 7, C.cyan, 3],
    [32, 3, 34, 3, C.cyan, 3],
    [44, 2, 46, 3, C.yellow, 2],
    [38, 6, 41, 6, C.pink, 0],
  ] as const
  // rozpięta kurtka: czarne ramiona i poły z neonową lamówką, pomarańczowy brzuch widać pośrodku
  const JACKET = ['dKooooooKd', ' KKcoocKK ']
  const CAR = [' ccc  ', 'hccccT']
  const crabMask = mask(CRAB, X, Y)

  const base = blank()
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      put(base, x, y, y >= 10 ? ((x + y) % 5 === 0 ? C.street2 : C.street) : mix(C.sky, C.sky2, y / 9))
  for (const [x0, x1, top] of HOUSES) {
    fill(base, x0, top, x1, 9, C.house)
    for (let y = top + 1; y <= 9; y += 2)
      for (let x = x0 + 1; x < x1; x += 2) if (hash(x, y, 12) % 3 === 0) put(base, x, y, C.win)
  }
  stamp(base, CRAB, X, Y, CRAB_PAL)
  stamp(base, JACKET, X, Y + 3, { d: CLAWD.od, o: CLAWD.o, K: C.jacket, c: C.cyan })

  const frame = (f: number) => {
    const g = blank()
    // szyldy świecą, każdy gaśnie w innej klatce; odbicie w mokrej ulicy tylko gdy świeci
    for (const [x0, y0, x1, y1, color, off] of SIGNS) {
      if (f === off) continue
      fill(g, x0, y0, x1, y1, color)
      fill(g, x0, 10, x1, 10, color + '|0.45')
      fill(g, x0, 11, x1, 11, color + '|0.2')
    }
    // deszcz: ukośne krople, 1 px w lewo i 2 w dół na klatkę (okres 8 wierszy, pętla bez skoku)
    for (let c = 0; c < 2 * W + H; c += 6)
      for (let y = 0; y < 10; y++) {
        if ((c - y) % 2 !== 0 || (((y - 2 * f - c) % 8) + 8) % 8 !== 0) continue
        const x = (c - y) / 2
        for (const dy of [0, 1]) if (x >= 0 && x < W && !crabMask[y + dy]?.[x]) put(g, x, y + dy, C.rain)
      }
    // latający samochód z prawej do lewej, 3 px na klatkę, z poświatą pod spodem
    const cx = 40 - 3 * f
    stamp(g, CAR, cx, 1, { c: C.car, h: C.head, T: C.tail })
    fill(g, cx + 1, 3, cx + 4, 3, C.car2 + '|0.6')
    stamp(g, [LEGS[f % 2]!], X, Y + CRAB.length, { d: CLAWD.od })
    // neon w okularach: błysk w kolorze szyldu
    if (f === 2) put(g, X + 3, Y + 1, C.pink)
    return [g]
  }
  return { base, frame, alt: 'Clawd w czarnej kurtce z neonową lamówką w deszczowym neonowym mieście, latający samochód' }
}

// sąsiednie piksele tego samego koloru w wierszu łączą się w jeden odcinek, a wszystkie odcinki
// jednego koloru idą w jedną ścieżkę (M x y h n v1 h-n z): ten sam obraz co rect na piksel,
// a markup kilka razy krótszy, więc 7 scen mieści się w limicie i każde przerysowanie wysyła mniej
function rects(g: Grid) {
  const byColor = new Map<string, string>()
  g.forEach((row, y) => {
    let x = 0
    while (x < W) {
      const color = row[x]
      let n = 1
      while (x + n < W && row[x + n] === color) n++
      if (color) byColor.set(color, (byColor.get(color) ?? '') + `M${x} ${y}h${n}v1h-${n}z`)
      x += n
    }
  })
  let out = ''
  for (const [color, d] of byColor) {
    const [fill, alpha] = color.split('|')
    out += `<path fill="${fill}"${alpha ? ` fill-opacity="${alpha}"` : ''} d="${d}"/>`
  }
  return out
}

const SCENES: Record<Scene, () => SceneArt> = {
  plaza: beach,
  kosmos: space,
  nurek: diver,
  dzungla: jungle,
  biuro: office,
  gory: mountains,
  neon: cyber,
}

// lista scen dla /pasek scena: polska nazwa (do alt i listy), aliasy (bez polskich znaków, EN) i opis w jednym zdaniu
export const SCENE_INFO: readonly { id: Scene; pl: string; aliases: readonly string[]; desc: string }[] = [
  { id: 'plaza', pl: 'plaża', aliases: ['beach'], desc: 'plaża o zachodzie słońca, fale i podskakująca nutka.' },
  { id: 'kosmos', pl: 'kosmos', aliases: ['space'], desc: 'Clawd w hełmie astronauty, migające gwiazdy, planeta z pierścieniem i kometa.' },
  { id: 'nurek', pl: 'nurek', aliases: ['diver'], desc: 'pod wodą w masce z fajką: bąbelki, rybka, koralowce i falujące wodorosty.' },
  { id: 'dzungla', pl: 'dżungla', aliases: ['jungle'], desc: 'Clawd jak Indiana Jones: fedora, bicz, świątynia, tocząca się kula i papuga.' },
  { id: 'biuro', pl: 'biuro', aliases: ['office'], desc: 'biuro nocą: dwa monitory z przewijanym kodem, lampka, kubek z parą i miasto za oknem.' },
  { id: 'gory', pl: 'góry', aliases: ['mountains'], desc: 'zima w górach: zorza, padający śnieg, ognisko, choinka i czapka z pomponem.' },
  { id: 'neon', pl: 'neon', aliases: ['cyberpunk'], desc: 'cyberpunkowe miasto w deszczu: migające neony, mokra ulica i latający samochód.' },
]
export const SCENE_IDS: readonly Scene[] = SCENE_INFO.map(s => s.id)

const cache = new Map<Scene, { source: string; alt: string }>()

// scena jest stała, więc markup liczy się raz na scenę i załadowanie modułu: każde rysowanie paska
// dostaje ten sam obiekt (ten sam string source), więc Svg nie ma powodu, by ładować się od nowa
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
  const pl = SCENE_INFO.find(s => s.id === scene)?.pl ?? scene
  const out = {
    alt: `${art.alt} (scena: ${pl})`,
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
