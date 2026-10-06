/**
 * Które komendy shella są groźne. Czysta funkcja: komenda wchodzi, powód (albo null) wychodzi.
 * Rozbiór komendy na bazie classify.ts z launch-codes (OneWave AI, MIT); reguły i komunikaty po polsku.
 */

export type Danger = { kind: string; reason: string }

type Token = { op: string } | { word: string }

/** Dzieli linię na słowa i operatory, z poszanowaniem cudzysłowów i backslashy. */
export const tokenize = (line: string): Token[] => {
  const out: Token[] = []
  let word = ''
  let hasWord = false
  const flush = () => {
    if (hasWord) out.push({ word })
    word = ''
    hasWord = false
  }
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!
    if (c === "'") {
      const end = line.indexOf("'", i + 1)
      word += line.slice(i + 1, end === -1 ? line.length : end)
      hasWord = true
      i = end === -1 ? line.length : end
    } else if (c === '"') {
      let j = i + 1
      while (j < line.length && line[j] !== '"') {
        if (line[j] === '\\' && j + 1 < line.length) j++
        word += line[j]
        j++
      }
      hasWord = true
      i = j
    } else if (c === '\\' && i + 1 < line.length) {
      word += line[i + 1]
      hasWord = true
      i++
    } else if (c === ' ' || c === '\t') {
      flush()
    } else if (c === '\n' || c === ';') {
      flush()
      out.push({ op: ';' })
    } else if (c === '&' || c === '|') {
      flush()
      const pair = line[i + 1] === c
      out.push({ op: pair ? c + c : c })
      if (pair) i++
    } else if (c === '(' || c === ')') {
      flush()
      out.push({ op: c })
    } else {
      word += c
      hasWord = true
    }
  }
  flush()
  return out
}

type Simple = { words: string[]; pipedFrom: string | null }

const WRAPPERS = new Set(['sudo', 'time', 'command', 'exec', 'nohup', 'env', 'npx', 'bunx', 'xargs', 'doas'])

/** Program, który komenda naprawdę uruchamia: za sudo, przypisaniami env i npx. */
const program = (words: string[]) => {
  let i = 0
  while (i < words.length) {
    const w = words[i]!
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w) || WRAPPERS.has(w) || (w.startsWith('-') && i > 0)) {
      i++
      continue
    }
    if ((w === 'pnpm' || w === 'yarn' || w === 'bun') && words[i + 1] === 'dlx') {
      i += 2
      continue
    }
    break
  }
  return { name: (words[i] ?? '').split('/').pop() ?? '', args: words.slice(i + 1) }
}

const simples = (tokens: Token[]): Simple[] => {
  const out: Simple[] = []
  let words: string[] = []
  let pipedFrom: string | null = null
  const end = (op: string) => {
    if (words.length) {
      const name = program(words).name
      out.push({ words, pipedFrom })
      pipedFrom = op === '|' ? name : null
    } else if (op !== '|') {
      pipedFrom = null
    }
    words = []
  }
  for (const t of tokens) {
    if ('op' in t) end(t.op)
    else words.push(t.word)
  }
  end(';')
  return out
}

// katalogi, które wolno kasować bez pytania: artefakty budowania i katalogi tymczasowe
const SAFE_RM = /(^|\/)(node_modules|\.next|dist|build|tmp|\.turbo|\.cache|coverage|__pycache__|\.pytest_cache)(\/|$)/
const SAFE_RM_ROOT = /^(\/tmp\/|\/private\/tmp\/|\$TMPDIR|\/var\/folders\/)/

const isSafeRmTarget = (path: string) => SAFE_RM.test(path) || SAFE_RM_ROOT.test(path)

const rmDanger = (args: string[]): Danger | null => {
  let recursive = false
  let force = false
  const targets: string[] = []
  let isEndOfFlags = false
  for (const a of args) {
    if (!isEndOfFlags && a === '--') {
      isEndOfFlags = true
    } else if (!isEndOfFlags && a.startsWith('--')) {
      if (a === '--recursive') recursive = true
      if (a === '--force') force = true
    } else if (!isEndOfFlags && a.startsWith('-') && a.length > 1) {
      if (/[rR]/.test(a)) recursive = true
      if (/f/.test(a)) force = true
    } else {
      targets.push(a)
    }
  }
  if (!recursive || !force || targets.length === 0) return null
  const risky = targets.filter(t => !isSafeRmTarget(t))
  if (risky.length === 0) return null
  return { kind: 'rm', reason: `rm -rf kasuje bez pytania: ${risky.slice(0, 3).join(' ')}` }
}

const SQL_CLIENTS = new Set(['psql', 'mysql', 'mariadb', 'sqlite3', 'sqlcmd', 'duckdb', 'clickhouse-client', 'pgcli', 'mycli'])
const SQL_DROP = /\b(drop\s+(table|database|schema)|truncate\s+(table\s+)?["`\w])/i
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'fish'])
const FETCHERS = new Set(['curl', 'wget'])

/** Pierwsza groźna rzecz, którą robi `command`, albo null, gdy można puścić bez pytania. */
export const classify = (command: string): Danger | null => {
  const tokens = tokenize(command)
  const list = simples(tokens)
  for (const s of list) {
    const { name, args } = program(s.words)
    const joined = args.join(' ')

    if (name === 'rm') {
      const d = rmDanger(args)
      if (d) return d
    }

    if (name === 'git') {
      // opcje gita stoją przed podkomendą; -C i -c biorą wartość
      let at = 0
      while (at < args.length && args[at]!.startsWith('-')) at += ['-C', '-c', '--git-dir', '--work-tree'].includes(args[at]!) ? 2 : 1
      const sub = args[at]
      if (sub === 'push') {
        const rest = args.slice(at + 1)
        const isForce = rest.some(a => a === '--force' || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(a) || /^\+\S/.test(a))
        if (isForce) return { kind: 'git-push-force', reason: 'git push --force nadpisuje historię na zdalnym repo' }
      }
      if (sub === 'reset' && args.includes('--hard')) {
        return { kind: 'git-reset-hard', reason: 'git reset --hard wyrzuca niezacommitowane zmiany' }
      }
      if (sub === 'clean' && args.slice(at + 1).some(a => /^-[a-zA-Z]*f/.test(a) || a === '--force')) {
        return { kind: 'git-clean', reason: 'git clean -f kasuje nieśledzone pliki' }
      }
      if (sub === 'branch' && args.includes('-D')) {
        return { kind: 'git-branch-D', reason: 'git branch -D kasuje gałąź bez sprawdzenia, czy jest zmergowana' }
      }
    }

    // treść heredoca ląduje w osobnych "komendach", więc wtedy liczy się cała linia
    const sql = args.some(a => a.startsWith('<<')) ? command : joined
    if (SQL_CLIENTS.has(name) && SQL_DROP.test(sql)) {
      return { kind: 'sql-drop', reason: 'DROP / TRUNCATE na żywej bazie danych' }
    }

    if (name === 'supabase') {
      if (args[0] === 'db' && args[1] === 'reset') {
        return { kind: 'supabase-reset', reason: 'supabase db reset czyści bazę' }
      }
      if (SQL_DROP.test(joined)) return { kind: 'sql-drop', reason: 'DROP / TRUNCATE przez supabase' }
    }

    if (name === 'vercel' && args.some(a => a === '--prod' || a === '--production')) {
      return { kind: 'vercel-prod', reason: 'vercel --prod wdraża na produkcję' }
    }

    if (name === 'chmod' && args.some(a => /^-[a-zA-Z]*R/.test(a) || a === '--recursive') && args.some(a => /^0?777$/.test(a) || a === 'a+rwx')) {
      return { kind: 'chmod-777', reason: 'chmod -R 777 otwiera każdy plik dla wszystkich' }
    }

    if (SHELLS.has(name) && s.pipedFrom && FETCHERS.has(s.pipedFrom)) {
      return { kind: 'curl-sh', reason: `${s.pipedFrom} wprost do ${name}: uruchamia skrypt z sieci bez czytania` }
    }
    if (SHELLS.has(name) && args.some(a => /\$\(\s*(curl|wget)\b/.test(a))) {
      return { kind: 'curl-sh', reason: `${name} uruchamia skrypt pobrany z sieci` }
    }
  }
  // bash <(curl ...): tokenizer odcina nawiasy, więc patrzymy na surową linię
  if (/\b(sh|bash|zsh)\s+<\(\s*(curl|wget)\b/.test(command)) {
    return { kind: 'curl-sh', reason: 'shell uruchamia skrypt pobrany z sieci' }
  }
  return null
}

/** Lista reguł do /bezpiecznik, jedna linia na regułę. */
export const RULES = [
  'rm -rf poza node_modules, dist, build, .cache, coverage i katalogami tymczasowymi',
  'git push --force / -f / +branch',
  'git reset --hard, git clean -f, git branch -D',
  'DROP / TRUNCATE przez psql, mysql, sqlite3 i inne klienty SQL; supabase db reset',
  'vercel --prod',
  'chmod -R 777',
  'curl | sh, wget | bash, sh -c "$(curl ...)", bash <(curl ...)',
]
