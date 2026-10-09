// Pure helpers: no `$`, so the tests reach them directly.

export type Change = { code: string; path: string; from?: string }

// `git status --porcelain=v1 -z`: "XY path\0", a rename or copy "XY new\0old\0".
export const parsePorcelain = (out: string): Change[] => {
  const parts = out.split('\0')
  const changes: Change[] = []
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i] ?? ''
    if (entry.length < 4) continue
    const code = entry.slice(0, 2)
    const path = entry.slice(3)
    if (code[0] === 'R' || code[0] === 'C') {
      changes.push({ code, path, from: parts[i + 1] })
      i++
    } else {
      changes.push({ code, path })
    }
  }
  return changes
}

const globToRegex = (glob: string): RegExp =>
  new RegExp(
    '^' +
      glob
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.') +
      '$',
    'i',
  )

export const splitList = (value: unknown): string[] =>
  String(value ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)

// A pattern with a slash is matched against the whole path, one without
// against the file's name alone.
export const isExcluded = (path: string, patterns: string[]): boolean => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return patterns.some(p => globToRegex(p).test(p.includes('/') ? path : name))
}

// The first line the model wrote, without fences, quotes or a full stop.
export const cleanMessage = (text: string): string => {
  const line =
    text
      .split('\n')
      .map(l => l.trim())
      .find(l => l && !l.startsWith('```')) ?? ''
  return line
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\.$/, '')
    .slice(0, 120)
    .trim()
}

export const fallbackMessage = (files: string[]): string =>
  `chore: auto-commit (${files.length} ${files.length === 1 ? 'plik' : 'plików'})`

export const SYSTEM = `Piszesz wiadomości commitów git. Odpowiadasz WYŁĄCZNIE jedną linią wiadomości, bez komentarza.
Format: "type(scope): opis" albo "type: opis". type to jedno z: feat, update, fix, docs, content, chore.
scope opcjonalny, krótki (np. slug filmu albo nazwa skilla), wzięty ze ścieżek plików.
Opis po polsku, konkretny (co się zmieniło), najwyżej ok. 90 znaków, bez kropki na końcu.
Trzymaj się stylu przykładowych commitów z repo.`

export const buildPrompt = (args: {
  recent: string
  stat: string
  diff: string
  untracked: string[]
}): string =>
  [
    'Ostatnie commity w repo (styl do naśladowania):',
    args.recent || '(brak)',
    '',
    'Zmienione pliki (git diff --stat):',
    args.stat || '(brak zmian w śledzonych plikach)',
    args.untracked.length ? `\nNowe pliki:\n${args.untracked.join('\n')}` : '',
    '',
    'Diff (może być ucięty):',
    args.diff || '(brak)',
    '',
    'Napisz wiadomość commita dla tych zmian.',
  ].join('\n')
