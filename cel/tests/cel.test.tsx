import { expect, mock, test } from 'claude-code/testing'

const COMPOSE = { model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['desktop'], tools: ['Bash'], outputStyle: null, traits: [] }
const props = { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120 }

function base(on: never) {
  const clock = mock.clock(on as never, { now: 600_000 })
  const o = on as (...a: unknown[]) => void
  o('session.start', () => ({ cwd: '/x' }) as never)
  o('command.register', () => ({ value: undefined }) as never)
  o('prompt.submit', ($: unknown, e: { text: string }) => ({ text: e.text }) as never)
  o('prompt.compose', () => ({ sections: [{ id: 'base', scope: 'session', text: 'x' }] }) as never)
  o('ui.render', ($: { ui: { resolve: (e: unknown) => { Box: unknown } } }, e: unknown) => h($.ui.resolve(e).Box as never, {}) as never)
  return clock
}

test('/cel ustawia, pokazuje i zdejmuje cel; prompty się liczą', async ($, on) => {
  const clock = base(on as never)
  await $.session.start({ cwd: '/x', surface: 'desktop', isInteractive: true } as never)
  expect((await $.command.run({ command: 'cel', args: '' } as never)).text).toMatch(/Brak celu/)
  expect((await $.command.run({ command: 'cel', args: 'wypuścić paczkę modów' } as never)).text).toMatch(/Cel ustawiony: wypuścić paczkę modów/)
  await $.prompt.submit({ text: 'a' } as never)
  await $.prompt.submit({ text: 'b' } as never)
  await clock.advance(5 * 60_000)
  expect((await $.command.run({ command: 'cel', args: '' } as never)).text).toMatch(/wypuścić paczkę modów \(od 5 min, 2 promptów\)/)
  expect((await $.command.run({ command: 'cel', args: 'ok' } as never)).text).toMatch(/Zrobione: wypuścić paczkę modów/)
  expect((await $.command.run({ command: 'cel', args: '' } as never)).text).toMatch(/Brak celu/)
})

test('cel rysuje się nad promptem na obu powierzchniach; w aplikacji przycisk Zrobione go zdejmuje', async ($, on) => {
  base(on as never)
  await $.session.start({ cwd: '/x', surface: 'desktop', isInteractive: true } as never)
  for (const surface of ['terminal', 'desktop'] as const) {
    let ui = await $.ui.mount({ plugin: 'cel', surface, component: 'AbovePrompt', props } as never)
    expect(await ui.find({ type: 'Text', text: /Cel:/ } as never)).toBeUndefined()
    await ui.unmount()
    await $.command.run({ command: 'cel', args: 'nagrać film' } as never)
    ui = await $.ui.mount({ plugin: 'cel', surface, component: 'AbovePrompt', props } as never)
    expect(await ui.find({ type: 'Text', text: /^nagrać film$/ } as never)).toBeDefined()
    if (surface === 'desktop') {
      await ui.press({ key: 'done' } as never)
      expect(await ui.find({ type: 'Text', text: /^nagrać film$/ } as never)).toBeUndefined()
    } else {
      expect(await ui.find({ type: 'Text', text: /\/cel ok/ } as never)).toBeDefined()
      await $.command.run({ command: 'cel', args: 'ok' } as never)
    }
    await ui.unmount()
  }
})

test('Claude dostaje cel jako sekcję systemowego promptu, tylko gdy cel jest', async ($, on) => {
  base(on as never)
  await $.session.start({ cwd: '/x', surface: 'desktop', isInteractive: true } as never)
  let r = (await $.prompt.compose(COMPOSE as never)) as { sections: { id: string; text: string }[] }
  expect(r.sections.map(s => s.id)).toEqual(['base'])
  await $.command.run({ command: 'cel', args: 'opisać film' } as never)
  r = (await $.prompt.compose(COMPOSE as never)) as { sections: { id: string; text: string }[] }
  expect(r.sections.map(s => s.id)).toEqual(['base', 'cel'])
  expect(r.sections[1]!.text).toMatch(/opisać film/)
})

test('/goal ustawia cel sam, zadania Claude\'a liczą się do postępu, /goal clear zdejmuje', async ($, on) => {
  base(on as never)
  const o = on as (...a: unknown[]) => void
  let nextId = 1
  o('command.run', () => ({ value: { text: '' } }) as never)
  o('tool.call', ($: unknown, e: { tool: string; condition?: string }) => {
    if (e.tool === 'TaskCreate') return { result: { task: { id: String(nextId++), subject: 'x' } }, text: 'ok' } as never
    if (e.tool === 'TaskUpdate') return { result: { success: true }, text: 'ok' } as never
    if (e.tool === 'ProposeGoal') return { result: { condition: e.condition, askUser: true }, text: 'ok' } as never
    return { result: 'ok', text: 'ok' } as never
  })
  await $.session.start({ cwd: '/x', surface: 'desktop', isInteractive: true } as never)

  await $.command.run({ command: 'goal', args: 'testy przechodzą (bun test exit 0)' } as never)
  expect((await $.command.run({ command: 'cel', args: '' } as never)).text).toMatch(/testy przechodzą/)
  await $.tool.call({ tool: 'TaskCreate', subject: 'Napisać test', description: '' } as never)
  await $.tool.call({ tool: 'TaskCreate', subject: 'Naprawić kod', description: '' } as never)
  await $.tool.call({ tool: 'TaskUpdate', task_id: '1', status: 'completed' } as never)
  expect((await $.command.run({ command: 'cel', args: 'lista' } as never)).text).toBe('Cel: testy przechodzą (bun test exit 0)\n[x] Napisać test\n[ ] Naprawić kod')

  const ui = await $.ui.mount({ plugin: 'cel', surface: 'desktop', component: 'AbovePrompt', props } as never)
  expect(await ui.find({ type: 'Text', text: /Goal:/ } as never)).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /1\/2/ } as never)).toBeDefined()
  await ui.unmount()

  // cel z /goal nie dubluje sekcji w prompcie: silnik sam go pilnuje
  const r = (await $.prompt.compose(COMPOSE as never)) as { sections: { id: string }[] }
  expect(r.sections.map(s => s.id)).toEqual(['base'])

  await $.command.run({ command: 'goal', args: 'clear' } as never)
  expect((await $.command.run({ command: 'cel', args: '' } as never)).text).toMatch(/Brak celu/)

  await $.tool.call({ tool: 'ProposeGoal', condition: 'README gotowe' } as never)
  expect((await $.command.run({ command: 'cel', args: '' } as never)).text).toMatch(/README gotowe/)
})
