import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { mask, maskDeep } from './mask'

const isOn = atom({ plugin: 'record-mode', key: 'isOn' } as const, false)

// kept in $.store too, so an app restart mid-recording comes back masked, not bare
async function set($: EngineInterface, on: boolean) {
  await update($, isOn, () => on)
  await $.store.set('isOn', on)
  $.ui.status(on ? '● REC' : undefined)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const out = await next(e)
    await $.command.register({ name: 'record', description: 'Recording mode: /record on | off (masks secrets on screen)' })
    await set($, (await $.store.get('isOn')) === true)
    return out
  })

  on('command.run', { command: 'record' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const want = arg === 'on' ? true : arg === 'off' ? false : !(await read($, isOn))
    await set($, want)
    return { text: want ? 'Recording mode ON - maile, klucze, kwoty i ~ zamaskowane na ekranie.' : 'Recording mode OFF.' }
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) =>
    (await read($, isOn)) ? next({ ...e, props: { ...e.props, text: mask(e.props.text) } }) : next(e),
  )
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) =>
    (await read($, isOn)) ? next({ ...e, props: { ...e.props, text: mask(e.props.text) } }) : next(e),
  )
  on('ui.render', { component: 'CommandOutput' }, async ($, e, next) =>
    (await read($, isOn)) ? next({ ...e, props: { ...e.props, text: mask(e.props.text) } }) : next(e),
  )

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) =>
    (await read($, isOn))
      ? next({ ...e, props: { ...e.props, input: maskDeep(e.props.input), output: maskDeep(e.props.output) } })
      : next(e),
  )

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) =>
    (await read($, isOn)) ? next({ ...e, props: { ...e.props, output: maskDeep(e.props.output) } }) : next(e),
  )
}
