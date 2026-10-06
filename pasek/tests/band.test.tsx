import { expect, test } from 'claude-code/testing'

const USAGE = {
  startedAt: 0,
  context: { tokens: 331000, window: 1000000, percent: 33 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 22, resetsAt: '2030-01-01T00:00:00Z' },
    { kind: 'seven_day', percentUsed: 17 },
  ],
  cost: { usd: 4.1 },
}

test('desktop: full band with ctx; terminal and IDE: one slim row with cache and command hints, no ctx/cost or buttons', async ($, on) => {
  on('session.usage', () => ({ value: USAGE }) as never)
  on('session.cwd', () => ({ value: '/x/thumbforge' }) as never)
  on('process.run', () => ({ value: { exitCode: 0, stdout: 'main', stderr: '' } }) as never)
  on('clock.now', () => ({ value: 3600000 }) as never)
  on('ui.render', ($, e) => { const { Box } = $.ui.resolve(e as never) as never as { Box: unknown }; return h(Box as never, {}) as never })
  for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({
      plugin: 'pasek',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120 },
    } as never)
    const ctx = await ui.find({ type: 'Text', text: /ctx/ } as never)
    if (surface === 'desktop') expect(ctx).toBeDefined()
    else expect(ctx).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^cache -$/ } as never)).toBeDefined()
    // terminal/IDE buttons need ctrl+x tab first, so there they are command hints instead
    if (surface === 'desktop') expect(await ui.find({ key: 'rec' } as never)).toBeDefined()
    else {
      expect(await ui.find({ key: 'rec' } as never)).toBeUndefined()
      expect(await ui.find({ type: 'Text', text: /\/record/ } as never)).toBeDefined()
    }
    await ui.unmount()
  }
})

test('REC on: red mark everywhere, masked cost and REC button on desktop, /record off hint in terminal', async ($, on) => {
  on('session.usage', () => ({ value: USAGE }) as never)
  on('session.cwd', () => ({ value: '/x/thumbforge' }) as never)
  on('process.run', () => ({ value: { exitCode: 0, stdout: 'main', stderr: '' } }) as never)
  on('clock.now', () => ({ value: 3600000 }) as never)
  on('state.get', { plugin: 'record-mode', key: 'isOn' } as never, () => ({ value: { value: true, version: 1 } }) as never)
  const runs: string[] = []
  on('command.run', ($, e) => {
    const c = e as never as { command: string; args?: string }
    runs.push(`${c.command}:${c.args ?? ''}`)
    return { value: { text: '' } } as never
  })
  on('ui.render', ($, e) => { const { Box } = $.ui.resolve(e as never) as never as { Box: unknown }; return h(Box as never, {}) as never })
  for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({
      plugin: 'pasek',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120 },
    } as never)
    expect(await ui.find({ type: 'Text', text: /● REC/ } as never)).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\$4\.10/ } as never)).toBeUndefined()
    // the cost lives only in the desktop band; terminal/IDE show none at all
    if (surface === 'desktop') {
      expect(await ui.find({ type: 'Text', text: /\[kwota\]/ } as never)).toBeDefined()
      await ui.press({ key: 'rec' } as never)
    } else expect(await ui.find({ type: 'Text', text: /\/record off/ } as never)).toBeDefined()
    await ui.unmount()
  }
  expect(runs).toEqual(['record:'])
})

test('Wytłumacz button sits next to REC only with wytlumacz-mi loaded and runs /wytlumacz', async ($, on) => {
  on('session.usage', () => ({ value: USAGE }) as never)
  on('session.cwd', () => ({ value: '/x/thumbforge' }) as never)
  on('process.run', () => ({ value: { exitCode: 0, stdout: 'main', stderr: '' } }) as never)
  on('clock.now', () => ({ value: 3600000 }) as never)
  let loaded = false
  on('command.list', () => ({ value: loaded ? [{ name: 'wytlumacz', description: '', source: 'plugin' }] : [] }) as never)
  const runs: string[] = []
  on('command.run', ($, e) => {
    runs.push((e as never as { command: string }).command)
    return { value: { text: '' } } as never
  })
  on('ui.render', ($, e) => { const { Box } = $.ui.resolve(e as never) as never as { Box: unknown }; return h(Box as never, {}) as never })
  for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
    const mount = () => $.ui.mount({
      plugin: 'pasek',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120 },
    } as never)
    loaded = false
    let ui = await mount()
    expect(await ui.find({ key: 'explain' } as never)).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /\/wytlumacz/ } as never)).toBeUndefined()
    await ui.unmount()
    loaded = true
    ui = await mount()
    if (surface === 'desktop') {
      expect(await ui.find({ key: 'explain' } as never)).toBeDefined()
      await ui.press({ key: 'explain' } as never)
    } else expect(await ui.find({ type: 'Text', text: /\/wytlumacz/ } as never)).toBeDefined()
    await ui.unmount()
  }
  expect(runs).toEqual(['wytlumacz'])
})
