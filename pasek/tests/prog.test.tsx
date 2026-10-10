import { expect, mock, test } from 'claude-code/testing'

const usage = (percent: number) => ({
  startedAt: 0,
  context: { tokens: percent * 10000, window: 1000000, percent },
  rateLimits: [],
})
const HANDOFF = [{ name: 'pasek:handoff', description: '', source: 'plugin' }]

function base(on: never, pct: () => number, cmds: () => unknown[], runs: { command: string; args: string }[]) {
  const clock = mock.clock(on as never, { now: 3600000 })
  const o = on as (...a: unknown[]) => void
  o('session.usage', () => ({ value: usage(pct()) }) as never)
  o('session.cwd', () => ({ value: '/x/thumbforge' }) as never)
  o('process.run', () => ({ value: { exitCode: 0, stdout: 'main', stderr: '' } }) as never)
  o('command.list', () => ({ value: cmds() }) as never)
  o('command.run', ($: unknown, e: { command: string; args: string }) => {
    runs.push({ command: e.command, args: e.args })
    return { value: { text: '' } } as never
  })
  o('ui.toast', () => ({ value: undefined }) as never)
  o('ui.render', ($: { ui: { resolve: (e: unknown) => { Box: unknown } } }, e: unknown) => h($.ui.resolve(e).Box as never, {}) as never)
  return clock
}
const props = { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120 }

test('from the default 40% Handoff shows and runs the handoff skill asking for a resume prompt', async ($, on) => {
  let pct = 39
  const runs: { command: string; args: string }[] = []
  const clock = base(on as never, () => pct, () => HANDOFF, runs)
  for (const surface of ['terminal', 'desktop'] as const) {
    pct = 39
    let ui = await $.ui.mount({ plugin: 'pasek', surface, component: 'AbovePrompt', props } as never)
    expect(await ui.find({ key: 'handoff' } as never)).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /granica/ } as never)).toBeUndefined()
    await ui.unmount()
    pct = 41
    ui = await $.ui.mount({ plugin: 'pasek', surface, component: 'AbovePrompt', props } as never)
    expect(await ui.find({ type: 'Text', text: /granica/ } as never)).toBeDefined()
    if (surface === 'desktop') await ui.press({ key: 'handoff' } as never)
    else expect(await ui.find({ type: 'Text', text: /\/pasek handoff/ } as never)).toBeDefined()
    await ui.unmount()
  }
  // terminal: the hint points at /pasek handoff, which runs the same skill with the same args
  expect((await $.command.run({ command: 'pasek', args: 'handoff' } as never)).text).toMatch(/\/x\/thumbforge\/\.claude\//)
  await clock.advance(100)
  expect(runs.map(r => r.command)).toEqual(['pasek:handoff', 'pasek:handoff'])
  expect(runs[1]!.args).toBe(runs[0]!.args)
  expect(runs[0]!.args).toMatch(/prompt/)
  expect(runs[0]!.args).toMatch(/NIE w katalogu tymczasowym/)
  expect(runs[0]!.args).toMatch(/\/x\/thumbforge\/\.claude\/handoff-\d{4}-\d{2}-\d{2}_/)
})

test('no handoff skill in the session: granica shows, but no button', async ($, on) => {
  const runs: { command: string; args: string }[] = []
  base(on as never, () => 55, () => [], runs)
  const ui = await $.ui.mount({ plugin: 'pasek', surface: 'desktop', component: 'AbovePrompt', props } as never)
  expect(await ui.find({ type: 'Text', text: /granica/ } as never)).toBeDefined()
  expect(await ui.find({ key: 'handoff' } as never)).toBeUndefined()
  await ui.unmount()
})

test('/pasek prog moves the threshold for the session, off hides it, junk explains usage', async ($, on) => {
  const runs: { command: string; args: string }[] = []
  base(on as never, () => 41, () => HANDOFF, runs)
  const mount = () => $.ui.mount({ plugin: 'pasek', surface: 'desktop', component: 'AbovePrompt', props } as never)
  expect((await $.command.run({ command: 'pasek', args: 'prog 50' } as never)).text).toMatch(/50%/)
  let ui = await mount()
  expect(await ui.find({ key: 'handoff' } as never)).toBeUndefined()
  await ui.unmount()
  expect((await $.command.run({ command: 'pasek', args: 'prog 5' } as never)).text).toMatch(/5%/)
  ui = await mount()
  expect(await ui.find({ key: 'handoff' } as never)).toBeDefined()
  await ui.unmount()
  expect((await $.command.run({ command: 'pasek', args: 'prog' } as never)).text).toMatch(/Próg kontekstu: 5%/)
  expect((await $.command.run({ command: 'pasek', args: 'prog off' } as never)).text).toMatch(/wyłączony/)
  ui = await mount()
  expect(await ui.find({ type: 'Text', text: /granica/ } as never)).toBeUndefined()
  await ui.unmount()
  expect((await $.command.run({ command: 'pasek', args: 'prog abc' } as never)).text).toMatch(/Użycie/)
})

test('ctx colour follows the threshold: blue <35, yellow 35-45 (Handoff from 40), red >45', async ($, on) => {
  let pct = 0
  const runs: { command: string; args: string }[] = []
  base(on as never, () => pct, () => HANDOFF, runs)
  const cases: [number, string, boolean][] = [[34, 'blue', false], [35, 'yellow', false], [40, 'yellow', true], [45, 'yellow', true], [46, 'red', true]]
  // on desktop ctx is a ring: its colour is the stroke in the SVG source (hex of the tone)
  const HEX: Record<string, string> = { blue: '#4a8fe7', yellow: '#e0a400', red: '#e5484d' }
  type SvgNode = { props: { alt: string; source: string } }
  for (const [p, color, button] of cases) {
    pct = p
    const ui = await $.ui.mount({ plugin: 'pasek', surface: 'desktop', component: 'AbovePrompt', props } as never)
    const svgs = (await ui.findAll({ type: 'Svg' } as never)) as never as SvgNode[]
    const ctx = svgs.find(s => /^kontekst: /.test(s.props.alt))!
    expect(ctx.props.alt).toMatch(new RegExp(`^kontekst: ${p}%`))
    expect(ctx.props.source).toMatch(new RegExp(`stroke="${HEX[color]}"`))
    for (const other of Object.values(HEX).filter(h => h !== HEX[color])) expect(ctx.props.source.includes(other)).toBe(false)
    expect((await ui.find({ type: 'Text', text: /^[█░]+$/ } as never))).toBeUndefined()
    expect((await ui.find({ key: 'handoff' } as never)) !== undefined).toBe(button)
    await ui.unmount()
  }
})
