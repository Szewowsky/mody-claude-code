import { expect, test } from 'claude-code/testing'

import { cleanMessage, fallbackMessage, isExcluded, parsePorcelain, splitList } from '../hooks/git'

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
