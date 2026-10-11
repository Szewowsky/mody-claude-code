import { expect, mock, test } from 'claude-code/testing'

// 7 scen Clawda, /pasek scena (lista, aliasy, losowa) i stabilność Svg między przerysowaniami pasma
const NOW = 3_600_000
const USAGE = {
  startedAt: 0,
  context: { tokens: 331000, window: 1000000, percent: 33 },
  rateLimits: [{ kind: 'seven_day', percentUsed: 9 }],
  cost: { usd: 4.1 },
}
const props = { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120 }
const SCENES = [
  ['plaza', 'plaża'],
  ['kosmos', 'kosmos'],
  ['nurek', 'nurek'],
  ['dzungla', 'dżungla'],
  ['biuro', 'biuro'],
  ['gory', 'góry'],
  ['neon', 'neon'],
] as const

type SvgNode = { key: string | undefined; props: { alt: string; source: string; isInteractive?: boolean } }
type Found = { key: string | undefined; type: string; children: unknown[] }

// the engine beneath; draws counts the band's draws (each one asks for the cwd once)
function base(on: never) {
  const o = on as (...a: unknown[]) => void
  const count = { draws: 0 }
  o('session.usage', () => ({ value: USAGE }) as never)
  o('session.cwd', () => (count.draws++, { value: '/x/thumbforge' }) as never)
  o('process.run', () => ({ value: { exitCode: 0, stdout: 'main', stderr: '' } }) as never)
  o('ui.toast', () => ({ value: undefined }) as never)
  o('ui.status', () => ({ value: undefined }) as never)
  o('ui.log', () => ({ value: undefined }) as never)
  o('command.register', () => ({ value: undefined }) as never)
  o('session.start', () => ({ cwd: '/x/thumbforge' }) as never)
  o('ui.render', ($: { ui: { resolve: (e: unknown) => { Box: unknown } } }, e: unknown) => h($.ui.resolve(e).Box as never, {}) as never)
  return count
}

// Clawd's Svg and the key of the Box it sits in alone (the engine drops a key on an Svg: SvgProps has none)
async function clawdOf(ui: { findAll: (q: never) => Promise<unknown> }) {
  const svg = ((await ui.findAll({ type: 'Svg' } as never)) as SvgNode[]).find(s => /Clawd/.test(s.props.alt))
  const boxes = ((await ui.findAll({ type: 'Box' } as never)) as Found[]).filter(b => /^clawd-/.test(b.key ?? ''))
  if (!svg || boxes.length !== 1 || boxes[0]!.children.length !== 1) return undefined
  return { ...svg, key: boxes[0]!.key }
}

test('each of the 7 scenes: Polish name in alt, animated, under 25k characters, Svg alone in a Box keyed by the scene', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  base(on as never)
  for (const [id, pl] of SCENES) {
    expect((await $.command.run({ command: 'pasek', args: `scena ${id}` } as never)).text).toMatch(`Scena Clawda: ${pl}`)
    const ui = await $.ui.mount({ plugin: 'pasek', surface: 'desktop', component: 'AbovePrompt', props } as never)
    const c = (await clawdOf(ui as never))!
    expect(c.props.alt).toMatch(`scena: ${pl}`)
    expect(c.props.alt).toMatch(/okular|Clawd/)
    expect(c.props.source).toMatch(/<animate attributeName="opacity"/)
    expect(c.props.source).toMatch(/shape-rendering="crispEdges"/)
    expect(c.props.source.length < 25_000).toBe(true)
    expect(c.props.isInteractive).toBe(true)
    expect(c.key).toBe(`clawd-${id}`)
    await ui.unmount()
  }
})

test('Polish letters and English aliases pick the same scenes, bare names work without "scena"', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  base(on as never)
  const cases: [string, string][] = [
    ['scena dżungla', 'dżungla'],
    ['scena góry', 'góry'],
    ['scena plaża', 'plaża'],
    ['beach', 'plaża'],
    ['space', 'kosmos'],
    ['scena diver', 'nurek'],
    ['jungle', 'dżungla'],
    ['office', 'biuro'],
    ['scena mountains', 'góry'],
    ['cyberpunk', 'neon'],
    ['Dżungla', 'dżungla'],
    ['gory', 'góry'],
  ]
  for (const [args, pl] of cases) expect((await $.command.run({ command: 'pasek', args } as never)).text).toBe(`Scena Clawda: ${pl} (zapamiętana na kolejne sesje).`)
})

test('/pasek scena alone: the current scene and all 7 with a one-line description, plus losowa', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on, { scene: 'nurek' })
  base(on as never)
  const text = (await $.command.run({ command: 'pasek', args: 'scena' } as never)).text as string
  expect(text).toMatch(/^Scena Clawda: nurek/)
  for (const [id] of SCENES) expect(text).toMatch(new RegExp(`^- ${id}( \\(.+\\))?: .+\\.$`, 'm'))
  expect(text).toMatch(/^- dzungla \(dżungla\): /m)
  expect(text).toMatch(/^- losowa: /m)
  expect(text.split('\n').filter(l => l.startsWith('- ')).length).toBe(8)
  // an unknown name shows the same list and how to use it
  const junk = (await $.command.run({ command: 'pasek', args: 'scena mars' } as never)).text as string
  expect(junk).toMatch(/Nie znam tej sceny/)
  expect(junk).toMatch(/^- losowa: /m)
})

test('losowa: stored as "losowa", draws one of the 7 now and again at every session start', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  base(on as never)
  const ids = SCENES.map(s => s.at(0)) as string[]
  const reply = (await $.command.run({ command: 'pasek', args: 'scena losowa' } as never)).text as string
  expect(reply).toMatch(/^Scena Clawda: losowa, teraz (plaża|kosmos|nurek|dżungla|biuro|góry|neon)\./)
  const drawn = async () => {
    const ui = await $.ui.mount({ plugin: 'pasek', surface: 'desktop', component: 'AbovePrompt', props } as never)
    const c = (await clawdOf(ui as never))!
    await ui.unmount()
    return c
  }
  const first = await drawn()
  expect(ids).toContain(first.key!.replace(/^clawd-/, ''))
  // the alt names the scene that was drawn
  const pl = SCENES.find(s => `clawd-${s[0]}` === first.key)![1]
  expect(first.props.alt).toMatch(`scena: ${pl}`)
  expect(reply).toMatch(`teraz ${pl}`)
  // a new session start draws again (one of the 7), and the choice stays "losowa"
  const seen = new Set<string>()
  for (let i = 0; i < 12; i++) {
    await $.session.start({ cwd: '/x/thumbforge', surface: 'desktop', isInteractive: true } as never)
    const c = await drawn()
    expect(ids).toContain(c.key!.replace(/^clawd-/, ''))
    seen.add(c.key!)
  }
  expect(seen.size > 1).toBe(true)
  // the store keeps "losowa", not the scene drawn
  expect((await $.command.run({ command: 'pasek', args: 'scena' } as never)).text).toMatch(/^Scena Clawda: losowa, w tej sesji /)
})

test('losowa before session.start wrote a scene: a pick fixed by the session start, the same on every draw', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on, { scene: 'losowa' })
  base(on as never)
  on('state.get', { plugin: 'pasek', key: 'scene' } as never, () => ({ value: { value: null, version: 0 } }) as never)
  const keys: string[] = []
  for (let i = 0; i < 3; i++) {
    const ui = await $.ui.mount({ plugin: 'pasek', surface: 'desktop', component: 'AbovePrompt', props } as never)
    keys.push((await clawdOf(ui as never))!.key!)
    await ui.unmount()
  }
  expect(new Set(keys).size).toBe(1)
  expect(SCENES.map(s => `clawd-${s[0]}`)).toContain(keys[0])
})

// the path of child indexes from the root to the element keyed `key`
function pathTo(node: unknown, key: string, at: number[] = []): number[] | undefined {
  if (!node || typeof node !== 'object') return undefined
  const n = node as { key?: string; props?: { key?: string; children?: unknown }; children?: unknown }
  if (n.key === key || n.props?.key === key) return at
  const kids = n.children ?? n.props?.children
  const list = Array.isArray(kids) ? kids : kids === undefined ? [] : [kids]
  for (let i = 0; i < list.length; i++) {
    const p = pathTo(list[i], key, [...at, i])
    if (p) return p
  }
  return undefined
}

test('stable Clawd: two draws of the same scene hand the surface the same Svg (key, source, alt, place in the tree)', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on, { scene: 'neon' })
  const count = base(on as never)
  const ui = await $.ui.mount({ plugin: 'pasek', surface: 'desktop', component: 'AbovePrompt', props } as never)
  const a = (await clawdOf(ui as never))!
  const pathA = pathTo(await ui.drawn(), 'clawd-neon')
  const before = count.draws
  // a state write the band reads (the threshold) redraws it, with the handoff warning and button appearing
  await $.command.run({ command: 'pasek', args: 'prog 20' } as never)
  const b = (await clawdOf(ui as never))!
  expect(count.draws > before).toBe(true)
  expect(await ui.find({ type: 'Text', text: /granica/ } as never)).toBeDefined()
  expect(b.key).toBe('clawd-neon')
  expect(b.key).toBe(a.key)
  expect(b.props.source === a.props.source).toBe(true)
  expect(b.props.alt).toBe(a.props.alt)
  expect(pathA).toBeDefined()
  expect(pathTo(await ui.drawn(), 'clawd-neon')).toEqual(pathA)
  // the Svg sits alone in its own Box keyed by the scene (clawdOf checks it is the only child)
  expect(((await ui.find({ key: 'clawd-neon' } as never)) as never as Found).type).toBe('Box')
  await ui.unmount()
})

test('the 30 s cache timer redraws the terminal band and the footer, but not the desktop band (every 5 min only)', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  const count = base(on as never)
  await $.session.start({ cwd: '/x/thumbforge', surface: 'desktop', isInteractive: true } as never)
  const desk = await $.ui.mount({ plugin: 'pasek', surface: 'desktop', component: 'AbovePrompt', props } as never)
  const before = count.draws
  for (let i = 0; i < 3; i++) await clock.advance(30_000)
  expect(count.draws).toBe(before)
  // the 10th tick (5 min) moves the session time and reset times along
  await clock.advance(7 * 30_000)
  expect(count.draws).toBe(before + 1)
  await desk.unmount()
  // the terminal band still follows every tick (its cache countdown lives there)
  const term = await $.ui.mount({ plugin: 'pasek', surface: 'terminal', component: 'AbovePrompt', props } as never)
  const t0 = count.draws
  await clock.advance(30_000)
  expect(count.draws).toBe(t0 + 1)
  await term.unmount()
})
