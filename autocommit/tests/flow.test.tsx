import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 100, scroll: { offset: 0, bodyRows: 6 }, view: {} },
}
const USAGE = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }

// Every line the mod put in the status bar, newest last.
const statuses: (string | undefined)[] = []
// Every request the mod sent the model, newest last.
const asked: { prompt: string; effort?: string; maxTokens?: number }[] = []
// A surface without system notifications (the desktop Code tab), when set.
let isNotifyMissing = false

// A fake repo: answers each git call and records the ones that change things.
// Pass an object to change the working tree or the branch in the middle of a test.
type Repo = { status: string; branch: string }
const fakeGit = (on: On, start: string | Repo, pushError = '') => {
  const repo = typeof start === 'string' ? { status: start, branch: 'main' } : start
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
    if (args[0] === 'symbolic-ref') return ok(repo.branch)
    if (args[0] === 'status') return ok(repo.status)
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
  on('model.complete', ($, e) => {
    asked.push({ prompt: e.prompt, effort: e.effort, maxTokens: e.maxTokens })
    return { value: { isAnswered: true, text: 'content(opis): poprawki opisu filmu', usage: USAGE } }
  })
  // Another mod's band beneath this one, as usage-band draws.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>usage-band</Text>
  })
  on('ui.status', ($, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.notify', () => {
    if (isNotifyMissing) throw new TypeError('$.ui.notify is not a function')
    return { value: { isSent: true, channel: 'terminal_bell' } }
  })
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

test('accept commits only the proposed files, never one that appeared later', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const repo = { status: ' M a.md\0', branch: 'main' }
  const calls = fakeGit(on, repo)
  const ui = await $.ui.mount({ plugin: 'autocommit', surface: 'terminal', ...BAND })
  await ui.select({ key: 'mode', value: 'propose' })
  await ui.press({ key: 'now' })
  repo.status = ' M a.md\0?? nowy-sekret.txt\0'
  await ui.press({ key: 'accept' })
  expect(changing(calls)).toEqual([
    ['add', '-A', '--', 'a.md'],
    ['commit', '-m', 'content(opis): poprawki opisu filmu', '--', 'a.md'],
    ['push'],
  ])
  await ui.unmount()
})

test('accept passes the same gates as a round: blocked branch, switched branch', { options: { blockedBranches: 'main' } }, async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const repo = { status: ' M a.md\0', branch: 'feature' }
  const calls = fakeGit(on, repo)
  const ui = await $.ui.mount({ plugin: 'autocommit', surface: 'terminal', ...BAND })
  await ui.select({ key: 'mode', value: 'propose' })
  await ui.press({ key: 'now' })
  repo.branch = 'main'
  await ui.press({ key: 'accept' })
  expect(changing(calls)).toEqual([])
  expect(await ui.find({ type: 'Text', text: /gałąź main zablokowana/ })).toBeDefined()
  repo.branch = 'inna'
  await ui.press({ key: 'accept' })
  expect(changing(calls)).toEqual([])
  expect(await ui.find({ type: 'Text', text: /propozycja była dla feature/ })).toBeDefined()
  expect(await ui.find({ key: 'accept' })).toBeDefined()
  await ui.unmount()
})

test('the band and the status line count down to the next round', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  fakeGit(on, '')
  const ui = await $.ui.mount({ plugin: 'autocommit', surface: 'terminal', ...BAND })
  await ui.press({ key: 'start' })
  expect(await ui.find({ type: 'Text', text: /co 15 min · za 15 min/ })).toBeDefined()
  await clock.advance(6 * 60 * 1000)
  expect(await ui.find({ type: 'Text', text: /za 9 min/ })).toBeDefined()
  expect(statuses.at(-1)).toBe('autocommit: za 9 min')
  await clock.advance(9 * 60 * 1000)
  expect(await ui.find({ type: 'Text', text: /za 15 min/ })).toBeDefined()
  await ui.press({ key: 'stop' })
  expect(await ui.find({ type: 'Text', text: /za \d+ min/ })).toBeUndefined()
  await ui.unmount()
})

test('after a round the status line goes back to the countdown, not the result', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const calls = fakeGit(on, ' M a.md\0')
  const ui = await $.ui.mount({ plugin: 'autocommit', surface: 'terminal', ...BAND })
  await ui.press({ key: 'start' })
  await clock.advance(15 * 60 * 1000)
  expect(changing(calls).filter(c => c[0] === 'commit').length).toBe(1)
  expect(statuses.at(-1)).toBe('autocommit: za 15 min')
  expect(await ui.find({ type: 'Text', text: /✓ content\(opis\)/ })).toBeDefined()
  await ui.press({ key: 'stop' })
  await ui.unmount()
})

test('a round names the commit from the new file and the session that wrote it, at the set effort', { options: { effort: 'high' } }, async ($, on) => {
  mock.clock(on)
  mock.store(on)
  asked.length = 0
  on('session.messages', () => ({
    value: [
      { role: 'user', text: 'Zajmijmy się analizą łapek w dół filmu Codex SDK', toolUses: [] },
      { role: 'assistant', text: 'Rozjazd obietnicy tytułu z treścią.', toolUses: [{ tool_use_id: 't', tool: 'Write', input: { file_path: '/repo/case.md' } }] },
    ],
  }))
  on('fs.read', () => ({ value: '# Case: łapki w dół - Codex SDK\n125 w górę / 11 w dół' }))
  fakeGit(on, '?? case.md\0')
  const ui = await $.ui.mount({ plugin: 'autocommit', surface: 'terminal', ...BAND })
  await ui.press({ key: 'now' })
  expect(asked.length).toBe(1)
  expect(asked[0]?.effort).toBe('high')
  expect(asked[0]?.prompt).toMatch(/125 w górę \/ 11 w dół/)
  expect(asked[0]?.prompt).toMatch(/analizą łapek w dół filmu Codex SDK/)
  expect((asked[0]?.maxTokens ?? 0) >= 2000).toBe(true)
  await ui.unmount()
})

test('a surface whose notification fails still leaves the proposal and keeps the timer', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  isNotifyMissing = true
  fakeGit(on, ' M a.md\0')
  const ui = await $.ui.mount({ plugin: 'autocommit', surface: 'desktop', ...BAND })
  await ui.select({ key: 'mode', value: 'propose' })
  await ui.press({ key: 'now' })
  isNotifyMissing = false
  expect(await ui.find({ type: 'Text', text: /poprawki opisu filmu/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /błąd/ })).toBeUndefined()
  await ui.unmount()
})
