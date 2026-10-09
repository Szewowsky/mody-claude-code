import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 100, scroll: { offset: 0, bodyRows: 6 }, view: {} },
}
const USAGE = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }

// A fake repo: answers each git call and records the ones that change things.
const fakeGit = (on: On, status: string, pushError = '') => {
  const calls: string[][] = []
  on('process.run', ($, e) => {
    // A git call without literal pathspecs fails here, so every test also checks the flag.
    const args = e.argv.slice(2)
    calls.push([...args])
    const ok = (stdout = '') => ({
      value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    })
    const no = () => ({
      value: { exitCode: 1, stdout: '', stderr: 'nope', isStdoutTruncated: false, isStderrTruncated: false },
    })
    if (e.argv[1] !== '--literal-pathspecs') return no()
    if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return ok('/repo')
    if (args[0] === 'rev-parse' && args[1] === '--git-path') return ok(`.git/${args[2]}`)
    if (args[0] === 'rev-parse' && args.includes('@{u}')) return ok('origin/main')
    if (args[0] === 'symbolic-ref') return ok('main')
    if (args[0] === 'status') return ok(status)
    if (args[0] === 'rev-list') return ok('1')
    if (args[0] === 'log') return ok('content(x): coś tam')
    if (args[0] === 'diff') return ok('a.md | 2 +-')
    if (args[0] === 'push' && pushError) return { value: { ...ok().value, exitCode: 1, stderr: pushError } }
    if (args[0] === 'add' || args[0] === 'commit' || args[0] === 'push') return ok()
    return no()
  })
  on('fs.stat', ($, e) =>
    e.path.includes('/.git/') ? { deny: 'missing' } : { value: { kind: 'file', size: 10, mtimeMs: 0, isLink: false } },
  )
  on('model.complete', () => ({
    value: { isAnswered: true, text: 'content(opis): poprawki opisu filmu', usage: USAGE },
  }))
  // Another mod's band beneath this one, as usage-band draws.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>usage-band</Text>
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.notify', () => ({ value: { isSent: true, channel: 'terminal_bell' } }))
  return calls
}

const changing = (calls: string[][]) => calls.filter(c => ['add', 'commit', 'push'].includes(c[0] ?? ''))

test('auto: Teraz commits everything but .env and pushes', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const calls = fakeGit(on, ' M a.md\0?? .env\0?? b.md\0')
  const ui = await $.ui.mount({ plugin: 'autocommit', surface: 'terminal', ...BAND })
  await ui.press({ key: 'now' })
  expect(changing(calls)).toEqual([
    ['add', '-A', '--', 'a.md', 'b.md'],
    ['commit', '-m', 'content(opis): poprawki opisu filmu', '--', 'a.md', 'b.md'],
    ['push'],
  ])
  expect(await ui.find({ type: 'Text', text: /✓ content\(opis\)/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /usage-band/ })).toBeDefined()
  await ui.unmount()
})

test('propose: nothing changes until the proposal is accepted', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const calls = fakeGit(on, ' M a.md\0')
  for (const surface of ['terminal', 'desktop'] as const) {
    calls.length = 0
    const ui = await $.ui.mount({ plugin: 'autocommit', surface, ...BAND })
    await ui.select({ key: 'mode', value: 'propose' })
    await ui.press({ key: 'now' })
    expect(changing(calls)).toEqual([])
    expect(await ui.find({ type: 'Text', text: /Propozycja \(1 plików\)/ })).toBeDefined()
    await ui.input({ key: 'edit', text: 'fix: moja wiadomość' })
    expect(changing(calls)).toEqual([['add', '-A', '--', 'a.md'], ['commit', '-m', 'fix: moja wiadomość', '--', 'a.md'], ['push']])
    expect(await ui.find({ key: 'accept' })).toBeUndefined()
    await ui.select({ key: 'mode', value: 'auto' })
    await ui.unmount()
  }
})

test('Start runs a round every interval, Stop ends it', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const calls = fakeGit(on, ' M a.md\0')
  const ui = await $.ui.mount({ plugin: 'autocommit', surface: 'terminal', ...BAND })
  await ui.select({ key: 'interval', value: '5' })
  await ui.press({ key: 'start' })
  expect(changing(calls)).toEqual([])
  await clock.advance(5 * 60 * 1000)
  expect(changing(calls).filter(c => c[0] === 'commit').length).toBe(1)
  await ui.press({ key: 'stop' })
  await clock.advance(15 * 60 * 1000)
  expect(changing(calls).filter(c => c[0] === 'commit').length).toBe(1)
  await ui.unmount()
})

test('a failed push stops the timer and says so', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  fakeGit(on, ' M a.md\0', 'rejected (fetch first)')
  const ui = await $.ui.mount({ plugin: 'autocommit', surface: 'terminal', ...BAND })
  await ui.press({ key: 'start' })
  await clock.advance(15 * 60 * 1000)
  expect(await ui.find({ type: 'Text', text: /push nieudany.*zatrzymano/ })).toBeDefined()
  expect(await ui.find({ key: 'start' })).toBeDefined()
  await ui.unmount()
})
