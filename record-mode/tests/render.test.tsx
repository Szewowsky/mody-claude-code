import { expect, test } from 'claude-code/testing'

test('/record on masks an assistant message on every drawing surface', async ($, on) => {
  on('store.set', () => ({ value: undefined }) as never)
  on('ui.status', () => ({ value: undefined }) as never)
  on('command.run', () => ({ value: { text: '' } }) as never)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e as never) as never as { Text: unknown }
    return h(Text as never, { key: 'body' }, (e as { props: { text: string } }).props.text) as never
  })
  await $.command.run({ command: 'record', args: 'on' } as never)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'record-mode',
      surface,
      component: 'AssistantMessage',
      props: { text: 'klucz sk-proj-abcdefghijklmnop1234 dla a@b.pl', isFirstOfReply: true },
    } as never)
    const body = await ui.find({ type: 'Text' } as never)
    console.log(surface, JSON.stringify(body))
    expect(JSON.stringify(body)).toContain('[key]')
    expect(JSON.stringify(body)).not.toContain('sk-proj')
    await ui.unmount()
  }
})
