import { expect, mock, test } from 'claude-code/testing'

// 5h at 32% resetting in 4h 2m, 7d at 9% resetting in 6d 19h (from now = 1h)
const NOW = 3_600_000
const USAGE = {
  startedAt: 0,
  context: { tokens: 331000, window: 1000000, percent: 33 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 32, resetsAt: new Date(NOW + (4 * 60 + 2) * 60_000).toISOString() },
    { kind: 'seven_day', percentUsed: 9, resetsAt: new Date(NOW + (6 * 24 + 19) * 3_600_000).toISOString() },
  ],
  cost: { usd: 4.1 },
}
const props = { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120 }

type SvgNode = { props: { alt: string; source: string; isInteractive?: boolean; width?: number } }

// the engine beneath: an empty Box everywhere, or (footer) for SessionMode its dim mode labels joined by ' & '
function base(on: never, usage: unknown = USAGE, footer = false) {
  const o = on as (...a: unknown[]) => void
  o('session.usage', () => ({ value: usage }) as never)
  o('session.cwd', () => ({ value: '/x/thumbforge' }) as never)
  o('process.run', () => ({ value: { exitCode: 0, stdout: 'main', stderr: '' } }) as never)
  o('ui.toast', () => ({ value: undefined }) as never)
  o('ui.render', ($: { ui: { resolve: (e: unknown) => { Box: unknown; Text: unknown } } }, e: { component: string; props: { modes?: string[] } }) =>
    footer && e.component === 'SessionMode'
      ? (h($.ui.resolve(e).Text as never, { dimColor: true }, (e.props.modes ?? []).join(' & ')) as never)
      : (h($.ui.resolve(e).Box as never, {}) as never),
  )
}

test('desktop: ctx/5h/7d rings with percent in alt, Clawd on the beach, no cache text in the band', async ($, on) => {
  mock.clock(on, { now: NOW })
  base(on as never)
  const ui = await $.ui.mount({ plugin: 'pasek', surface: 'desktop', component: 'AbovePrompt', props } as never)
  const svgs = (await ui.findAll({ type: 'Svg' } as never)) as never as SvgNode[]
  const rings = svgs.filter(s => /^limit /.test(s.props.alt))
  expect(rings.length).toBe(2)
  expect(rings[0]!.props.alt).toMatch(/32%/)
  expect(rings[1]!.props.alt).toMatch(/9%/)
  expect(rings[0]!.props.source).toMatch(/stroke-dashoffset/)
  const crab = svgs.find(s => /Clawd/.test(s.props.alt))
  expect(crab).toBeDefined()
  expect(crab!.props.isInteractive).toBe(true)
  expect(crab!.props.source).toMatch(/<animate attributeName="opacity"/)
  expect(crab!.props.source).toMatch(/shape-rendering="crispEdges"/)
  expect(crab!.props.source.length < 30_000).toBe(true)
  expect(await ui.find({ type: 'Text', text: /5h · reset za 4h 2m/ } as never)).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /7d · reset za 6d 19h/ } as never)).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^32%$/ } as never)).toBeDefined()
  // the cache countdown is not in the band: it lives in the prompt footer (SessionMode)
  expect(await ui.find({ type: 'Text', text: /cache/ } as never)).toBeUndefined()
  // ctx is a ring too (chip), with "ctx · 331k/1M" beside it and no █░ bar
  const ctx = svgs.find(s => /^kontekst: /.test(s.props.alt))
  expect(ctx!.props.alt).toMatch(/^kontekst: 33% · 331k\/1M$/)
  expect(await ui.find({ type: 'Text', text: /ctx · 331k\/1M/ } as never)).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^[█░]+$/ } as never)).toBeUndefined()
  expect(svgs.length).toBe(4)
  await ui.unmount()
})

test('desktop without a five_hour reading: still 2 limit rings, the 5h one gray "brak odczytu"', async ($, on) => {
  mock.clock(on, { now: NOW })
  base(on as never, { ...USAGE, rateLimits: USAGE.rateLimits.filter(l => l.kind !== 'five_hour') })
  const logs: string[] = []
  on('ui.log', (_$, e) => {
    logs.push((e as never as { text: string }).text)
    return { value: undefined } as never
  })
  const ui = await $.ui.mount({ plugin: 'pasek', surface: 'desktop', component: 'AbovePrompt', props } as never)
  const svgs = (await ui.findAll({ type: 'Svg' } as never)) as never as SvgNode[]
  const rings = svgs.filter(s => /^limit /.test(s.props.alt))
  expect(rings.length).toBe(2)
  expect(rings[0]!.props.alt).toBe('limit 5h: brak odczytu')
  expect(rings[0]!.props.source).toMatch(/M15 12.2V15/) // clock icon on 5h
  expect(rings[0]!.props.source.includes('stroke-dashoffset')).toBe(false) // empty ring
  expect(rings[1]!.props.alt).toMatch(/^limit 7d: 9%/)
  expect(rings[1]!.props.source).toMatch(/<rect x="10" y="11"/) // calendar icon on 7d
  expect(await ui.find({ type: 'Text', text: /^5h · brak odczytu$/ } as never)).toBeDefined()
  await ui.unmount()
  // session.measure logs which limit kinds the API reported, to the debug log
  await $.session.measure({} as never).catch(() => undefined)
  expect(logs.some(l => l === 'pasek: rateLimits kinds = [seven_day]')).toBe(true)
})

test('/pasek scena kosmos switches Clawd to space, plaza switches back, junk explains usage', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  base(on as never)
  const clawd = async () => {
    const ui = await $.ui.mount({ plugin: 'pasek', surface: 'desktop', component: 'AbovePrompt', props } as never)
    const svgs = (await ui.findAll({ type: 'Svg' } as never)) as never as SvgNode[]
    await ui.unmount()
    return svgs.find(s => /Clawd/.test(s.props.alt))!
  }
  expect((await clawd()).props.alt).toMatch(/plaży/)
  expect((await $.command.run({ command: 'pasek', args: 'scena kosmos' } as never)).text).toMatch(/kosmos/)
  const space = await clawd()
  expect(space.props.alt).toMatch(/kosmos/)
  expect(space.props.alt).toMatch(/space/)
  expect(space.props.source).toMatch(/#0b1026/)
  expect(space.props.source).toMatch(/<animate attributeName="opacity"/)
  expect(space.props.source.length < 30_000).toBe(true)
  expect((await $.command.run({ command: 'pasek', args: 'scena' } as never)).text).toMatch(/Scena Clawda: kosmos/)
  expect((await $.command.run({ command: 'pasek', args: 'scena mars' } as never)).text).toMatch(/Użycie/)
  expect((await $.command.run({ command: 'pasek', args: 'scena plaza' } as never)).text).toMatch(/plaza/)
  expect((await clawd()).props.alt).toMatch(/plaży/)
})

test('restart: with no session copy of the scene (a reloaded module, a new session) the store keeps kosmos', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  base(on as never)
  // the session copy reads as never written, so only $.store can carry the choice
  on('state.get', { plugin: 'pasek', key: 'scene' } as never, () => ({ value: { value: null, version: 0 } }) as never)
  await $.command.run({ command: 'pasek', args: 'scena kosmos' } as never)
  const ui = await $.ui.mount({ plugin: 'pasek', surface: 'desktop', component: 'AbovePrompt', props } as never)
  const svgs = (await ui.findAll({ type: 'Svg' } as never)) as never as SvgNode[]
  expect(svgs.find(s => /Clawd/.test(s.props.alt))!.props.alt).toMatch(/kosmos/)
  await ui.unmount()
})

test('a stored scene is used from the start of a session', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on, { scene: 'kosmos' })
  base(on as never)
  const ui = await $.ui.mount({ plugin: 'pasek', surface: 'desktop', component: 'AbovePrompt', props } as never)
  const svgs = (await ui.findAll({ type: 'Svg' } as never)) as never as SvgNode[]
  expect(svgs.find(s => /Clawd/.test(s.props.alt))!.props.alt).toMatch(/kosmos/)
  await ui.unmount()
})

test('terminal and IDE: no Svg at all, cache stays on the band', async ($, on) => {
  mock.clock(on, { now: NOW })
  base(on as never)
  for (const surface of ['terminal', 'vscode'] as const) {
    const ui = await $.ui.mount({ plugin: 'pasek', surface, component: 'AbovePrompt', props } as never)
    expect(await ui.find({ type: 'Svg' } as never)).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /cache/ } as never)).toBeDefined()
    await ui.unmount()
  }
})

const FOOTER = { modes: ['focus'] }
type TextNode = { text: string; props: { color?: string; dimColor?: boolean } }

test('desktop SessionMode footer: engine mode labels kept, coloured cache after them (green >30 min, yellow 30-15, red <15, cold), redrawn by the timer', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  base(on as never, USAGE, true)
  const statuses: (string | undefined)[] = []
  on('ui.status', (_$, e) => {
    statuses.push((e as never as { text: string | undefined }).text)
    return { value: undefined } as never
  })
  on('session.start', () => ({ cwd: '/x/thumbforge' }) as never)
  let cached: number | null = 0
  on('state.get', { plugin: 'pasek', key: 'cacheAt' } as never, () => ({ value: { value: cached, version: 1 } }) as never)
  await $.session.start({ cwd: '/x/thumbforge', surface: 'desktop', isInteractive: true } as never)
  const mount = () => $.ui.mount({ plugin: 'pasek', surface: 'desktop', component: 'SessionMode', props: FOOTER } as never)
  const cacheOf = async (ui: Awaited<ReturnType<typeof mount>>) =>
    (await ui.find({ type: 'Text', text: /^cache / } as never)) as never as TextNode | undefined

  // left: 40 min -> green, 20 -> yellow, 10 -> red, past the hour -> cold (red); each a fresh draw
  const cases: [number, string, string][] = [[20, 'cache 40 min', 'green'], [40, 'cache 20 min', 'yellow'], [50, 'cache 10 min', 'red'], [61, 'cache cold', 'red']]
  let at = 0
  for (const [minute, text, color] of cases) {
    await clock.advance(minute * 60_000 - at)
    at = minute * 60_000
    const ui = await mount()
    // what the engine drew (its mode labels, untouched) stays, the cache follows it
    expect(await ui.find({ type: 'Text', text: /^focus$/ } as never)).toBeDefined()
    const node = await cacheOf(ui)
    expect(node?.text).toBe(text)
    expect(node?.props.color).toBe(color)
    await ui.unmount()
  }
  cached = null
  let ui = await mount()
  const none = await cacheOf(ui)
  expect(none?.text).toBe('cache -')
  expect(none?.props.dimColor).toBe(true)
  await ui.unmount()

  // a mounted footer follows the timer: 60 min left, then 40 min later the 30 s tick redraws it yellow
  cached = 61 * 60_000
  ui = await mount()
  expect((await cacheOf(ui))?.text).toBe('cache 60 min')
  await clock.advance(40 * 60_000)
  const later = await cacheOf(ui)
  expect(later?.text).toBe('cache 20 min')
  expect(later?.props.color).toBe('yellow')
  await ui.unmount()
  // the status line is never used for it (only the one-off clear at session.start)
  expect(statuses.every(s => s === undefined)).toBe(true)
})

test('terminal and IDE SessionMode: untouched, no cache added', async ($, on) => {
  mock.clock(on, { now: NOW })
  base(on as never, USAGE, true)
  for (const surface of ['terminal', 'vscode'] as const) {
    const ui = await $.ui.mount({ plugin: 'pasek', surface, component: 'SessionMode', props: FOOTER } as never)
    expect(await ui.find({ type: 'Text', text: /^focus$/ } as never)).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /cache/ } as never)).toBeUndefined()
    expect((await ui.findAll({ type: 'Text' } as never)).length).toBe(1)
    await ui.unmount()
  }
})
