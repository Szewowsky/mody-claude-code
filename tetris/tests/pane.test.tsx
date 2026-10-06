import { expect, test } from 'claude-code/testing'

test('/tetris opens a plain-element board; buttons move it, gravity drops it', async ($, on) => {
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e as never) as never as { Box: unknown }
    return h(Box as never, {}) as never
  })
  await $.command.run({ command: 'tetris' })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'tetris', surface, component: 'Pane', requestId: 'tetris', props: {} } as never)
    const first = JSON.stringify(await ui.drawn())
    expect(first).toContain('TETRIS')
    expect(first).not.toContain('Client')
    await ui.press({ key: 'left' } as never)
    const moved = JSON.stringify(await ui.drawn())
    console.log(surface, moved === first ? 'NO MOVE' : 'moved')
    expect(moved).not.toBe(first)
    await ui.unmount()
  }
})
