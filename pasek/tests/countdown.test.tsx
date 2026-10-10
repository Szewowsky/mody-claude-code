import { expect, mock, test } from 'claude-code/testing'

const USAGE = {
  startedAt: 0,
  context: { tokens: 1000, window: 1000000, percent: 1 },
  rateLimits: [],
}

// the band's countdown lives on the terminal now; desktop has it in the status line (desktop.test.tsx)
test('cache countdown falls as the clock moves', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  on('session.usage', () => ({ value: USAGE }) as never)
  on('session.cwd', () => ({ value: '/x/thumbforge' }) as never)
  on('process.run', () => ({ value: { exitCode: 0, stdout: 'main', stderr: '' } }) as never)
  on('session.start', () => ({ cwd: '/x/thumbforge' }) as never)
  on('state.get', { plugin: 'pasek', key: 'cacheAt' } as never, () => ({ value: { value: 0, version: 1 } }) as never)
  on('ui.render', ($, e) => { const { Box } = $.ui.resolve(e as never) as never as { Box: unknown }; return h(Box as never, {}) as never })
  await $.session.start({ cwd: '/x/thumbforge', surface: 'desktop', isInteractive: true } as never)
  const ui = await $.ui.mount({
    plugin: 'pasek',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120 },
  } as never)
  expect(await ui.find({ type: 'Text', text: /cache ▰+▱* 1h 0m/ } as never)).toBeDefined()
  await clock.advance(10 * 60_000)
  expect(await ui.find({ type: 'Text', text: /cache ▰+▱* 50m/ } as never)).toBeDefined()
  await ui.unmount()
})
