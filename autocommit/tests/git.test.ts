import { expect, test } from 'claude-code/testing'

import {
  buildPrompt,
  cleanMessage,
  fallbackMessage,
  fileHead,
  isExcluded,
  parsePorcelain,
  sessionContext,
  splitList,
} from '../hooks/git'

test('parses porcelain -z with renames', async () => {
  const out = ' M a.md\0?? nowy plik.md\0R  nowe.md\0stare.md\0 D usuniety.md\0'
  expect(parsePorcelain(out)).toEqual([
    { code: ' M', path: 'a.md' },
    { code: '??', path: 'nowy plik.md' },
    { code: 'R ', path: 'nowe.md', from: 'stare.md' },
    { code: ' D', path: 'usuniety.md' },
  ])
})

test('excludes secrets by name, paths by full pattern', async () => {
  const patterns = splitList('.env, .env.*, *.pem, content/tmp/*')
  expect(isExcluded('.env', patterns)).toBe(true)
  expect(isExcluded('sub/.env.local', patterns)).toBe(true)
  expect(isExcluded('keys/server.PEM', patterns)).toBe(true)
  expect(isExcluded('content/tmp/x.md', patterns)).toBe(true)
  expect(isExcluded('.claude/rules/secrets.md', patterns)).toBe(false)
  expect(isExcluded('environment.md', patterns)).toBe(false)
})

test('cleans the model reply to one commit line', async () => {
  expect(cleanMessage('```\ncontent(opis): nowy opis filmu.\n```')).toBe('content(opis): nowy opis filmu')
  expect(cleanMessage('"fix: literówka"\n\nwyjaśnienie')).toBe('fix: literówka')
  expect(fallbackMessage(['a', 'b'])).toBe('chore: auto-commit (2 plików)')
})

test('a new file goes in by its content, the repo examples last and as format only', async () => {
  const prompt = buildPrompt({
    recent: 'content(launch-monitor): odczyt godzinowy 9.10 10:05',
    stat: '',
    diff: '',
    untracked: [{ path: 'launch-monitor/case.md', head: '# Case: łapki w dół - Codex SDK' }],
  })
  const content = prompt.indexOf('# Case: łapki w dół')
  const examples = prompt.indexOf('odczyt godzinowy')
  expect(content).toBeGreaterThan(-1)
  expect(examples).toBeGreaterThan(content)
  expect(prompt).toMatch(/tylko format/i)
})

test('a file head stops at 40 lines and skips binaries', async () => {
  const long = Array.from({ length: 100 }, (_, i) => `linia ${i}`).join('\n')
  expect(fileHead(long)?.split('\n').length).toBe(40)
  expect(fileHead('PNG\0\0dane')).toBeUndefined()
})

const write = (file_path: string) => ({ tool_use_id: 't', tool: 'Write', input: { file_path, content: 'x' } })
const MESSAGES = [
  { role: 'user' as const, text: 'Możemy zająć się analizą łapek w dół filmu Codex SDK?', toolUses: [] },
  {
    role: 'assistant' as const,
    text: 'Najpewniej rozjazd obietnicy tytułu z treścią. Reszta szczegółów.',
    toolUses: [write('/repo/launch-monitor/case.md')],
  },
]

test('the session tells why, but only for the files it wrote itself', async () => {
  const ctx = sessionContext(MESSAGES, '/repo', ['launch-monitor/case.md', 'data/hourly.csv'])
  expect(ctx.touched).toEqual(['launch-monitor/case.md'])
  expect(ctx.context).toMatch(/łapek w dół filmu Codex SDK/)
  expect(ctx.context).toMatch(/rozjazd obietnicy tytułu/)
  expect(ctx.context).not.toMatch(/Reszta szczegółów/)
  const prompt = buildPrompt({ recent: '', stat: '', diff: '', untracked: [], session: ctx })
  expect(prompt).toMatch(/łapek w dół filmu Codex SDK/)
  expect(prompt).toMatch(/data\/hourly.csv|launch-monitor\/case.md/)
})

test('no session context when the session wrote none of the files', async () => {
  const ctx = sessionContext(MESSAGES, '/repo', ['data/hourly.csv'])
  expect(ctx.touched).toEqual([])
  expect(ctx.context).toBe('')
  expect(buildPrompt({ recent: '', stat: '', diff: '', untracked: [], session: ctx })).not.toMatch(/Codex SDK/)
})
