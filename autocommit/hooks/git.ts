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
Opis po polsku, konkretny (co się zmieniło i po co), najwyżej ok. 90 znaków, bez kropki na końcu.
Opis bierzesz z diffu, z treści nowych plików i z kontekstu sesji, jeśli jest.
Przykładowe commity z repo pokazują TYLKO format: nigdy nie przepisuj ich opisu.`

export type NewFile = { path: string; head?: string }
export type SessionContext = { touched: string[]; context: string }

const HEAD_LINES = 40
const HEAD_CHARS = 2000

// The opening of a new text file, so the model sees what it holds; a binary gives none.
export const fileHead = (text: string): string | undefined => {
  if (text.includes('\0')) return undefined
  return text.split('\n').slice(0, HEAD_LINES).join('\n').slice(0, HEAD_CHARS)
}

const WRITE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']
const firstSentence = (text: string): string => (text.trim().split(/(?<=[.!?:])\s|\n/)[0] ?? '').slice(0, 200)
// Drops what the harness wraps around a prompt (<system-reminder>…, <command-name>…).
const plain = (text: string): string => text.replace(/<([a-z][\w-]*)>[\s\S]*?<\/\1>/g, '').trim()

type Message = { role: 'user' | 'assistant'; text: string; toolUses: { tool: string; input: Record<string, unknown> }[] }

// Why the files changed, from the session that wrote them: its last asks and the first
// sentence of its last answers. Only for files the session wrote itself (Write/Edit):
// a CSV a timer appended to, or a hand edit, gets no story it did not take part in.
export const sessionContext = (messages: Message[], root: string, files: string[]): SessionContext => {
  const written = new Set<string>()
  for (const m of messages)
    for (const u of m.toolUses ?? [])
      if (WRITE_TOOLS.includes(u.tool)) {
        const path = u.input.file_path ?? u.input.notebook_path
        if (typeof path === 'string') written.add(path)
      }
  const touched = files.filter(f => written.has(`${root}/${f}`))
  if (!touched.length) return { touched, context: '' }
  const asks = messages
    .filter(m => m.role === 'user')
    .map(m => plain(m.text))
    .filter(Boolean)
    .slice(-3)
    .map(t => `- ${t.slice(0, 300)}`)
  const answers = messages
    .filter(m => m.role === 'assistant')
    .map(m => firstSentence(plain(m.text)))
    .filter(Boolean)
    .slice(-3)
    .map(t => `- ${t}`)
  return { touched, context: ['Prośby użytkownika:', ...asks, 'Odpowiedzi asystenta (pierwsze zdania):', ...answers].join('\n') }
}

export const buildPrompt = (args: {
  recent: string
  stat: string
  diff: string
  untracked: NewFile[]
  session?: SessionContext
}): string =>
  [
    args.session?.context
      ? `Po co (z sesji, która zapisała pliki: ${args.session.touched.join(', ')}):\n${args.session.context}\n`
      : '',
    'Zmienione pliki (git diff --stat):',
    args.stat || '(brak zmian w śledzonych plikach)',
    ...args.untracked.map(f => `\nNowy plik: ${f.path}${f.head ? `\n${f.head}` : ''}`),
    '',
    'Diff (może być ucięty):',
    args.diff || '(brak)',
    '',
    'Przykładowe commity z repo - tylko format, nie kopiuj opisu:',
    args.recent || '(brak)',
    '',
    'Napisz wiadomość commita dla tych zmian.',
  ].join('\n')
