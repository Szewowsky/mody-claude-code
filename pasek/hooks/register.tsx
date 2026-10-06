import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { LastTurn, Usage } from '../types'

const usage = atom({ plugin: 'pasek', key: 'usage' } as const, null)
const branch = atom({ plugin: 'pasek', key: 'branch' } as const, '')
const prompts = atom({ plugin: 'pasek', key: 'prompts' } as const, 0)
const last = atom({ plugin: 'pasek', key: 'last' } as const, null)
const cacheAt = atom({ plugin: 'pasek', key: 'cacheAt' } as const, null)
const tick = atom({ plugin: 'pasek', key: 'tick' } as const, 0)
// owned by the recording-mode mod; the band only reads it, so /record redraws the REC mark
const recOn = atom({ plugin: 'record-mode', key: 'isOn' } as const, false)
// context threshold for the handoff; /pasek prog sets it for this session only (0 = off)
const prog = atom({ plugin: 'pasek', key: 'prog' } as const, 40)
const warnedProg = atom({ plugin: 'pasek', key: 'warnedProg' } as const, false)

// Claude Code on a subscription caches prompts for 1h; an API-key session gets 5 min, make it a userConfig if that ever matters
const CACHE_TTL = 60 * 60_000
const WARN_AT = 5 * 60_000

const BAR = 8

const DEFAULT_PROG = 40
// the mod's own skill already saves per project; the args repeat it so a foreign /handoff behaves the same
// (.claude/handoff-YYYY-MM-DD_slug.md), plus a ready prompt to resume with
function handoffArgs(cwd: string, now: number) {
  const d = new Date(now)
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return (
    'Kontynuacja tej samej pracy w nowej sesji. WAŻNE: zapisz ten dokument handoffu w projekcie, NIE w katalogu ' +
    `tymczasowym: ${cwd}/.claude/handoff-${day}_<krótki-slug-tematu>.md (utwórz katalog .claude, jeśli go nie ma). ` +
    'Na samym końcu wypisz w osobnym bloku kodu gotowy prompt po polsku do wklejenia w nowej sesji Claude Code: ' +
    'ma podać pełną ścieżkę do tego pliku, kazać go przeczytać w całości i kontynuować pracę od następnego kroku.'
  )
}

// the mod's own skill (pasek:handoff) first, then any other /handoff the session has
function handoffCommand(cmds: { name: string }[]) {
  const names = cmds.map(c => c.name)
  return names.find(n => n === 'pasek:handoff') ?? names.find(n => n === 'handoff' || n.endsWith(':handoff'))
}

function parseProg(args: string): number | 'off' | 'show' | null {
  const a = args.trim().replace(/^prog\b/, '').trim().replace(/%$/, '')
  if (a === '') return 'show'
  if (a === 'off') return 'off'
  if (a === 'reset') return DEFAULT_PROG
  const n = Number(a)
  return Number.isInteger(n) && n >= 1 && n <= 99 ? n : null
}

function bar(pct: number) {
  const full = Math.round((Math.min(pct, 100) / 100) * BAR)
  return '█'.repeat(full) + '░'.repeat(BAR - full)
}

function tone(pct: number) {
  return pct >= 85 ? 'red' : pct >= 60 ? 'yellow' : 'blue'
}

// ctx follows the handoff threshold - yellow from 5 points below it,
// Handoff from the threshold itself, red past 5 points above (40% → 35-45 yellow, >45 red)
const CTX_BAND = 5
function ctxTone(pct: number, threshold: number) {
  if (threshold <= 0) return tone(pct)
  return pct > threshold + CTX_BAND ? 'red' : pct >= threshold - CTX_BAND ? 'yellow' : 'blue'
}

function span(ms: number) {
  const m = Math.max(0, Math.round(ms / 60000))
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m % 60}m`
  return `${m}m`
}

function secs(ms: number) {
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

function tokens(n: number) {
  return n >= 1e6 ? `${(n / 1e6).toFixed(n % 1e6 ? 1 : 0)}M` : `${Math.round(n / 1e3)}k`
}

async function refresh($: EngineInterface) {
  const u = await $.session.usage()
  const next: Usage = {
    tokens: u.context.tokens,
    window: u.context.window,
    percent: u.context.percent,
    limits: u.rateLimits,
    usd: u.cost?.usd,
  }
  await update($, usage, () => next)
}

async function refreshBranch($: EngineInterface) {
  // one git call per turn, a fs watch on .git/HEAD if it ever lags
  const r = await $.process.run(['git', 'branch', '--show-current']).catch(() => null)
  const name = r && r.exitCode === 0 ? r.stdout.trim() : ''
  await update($, branch, () => name)
}

let warned = false
let timer: Timer | null = null

// redraws the cache countdown and warns once before the cache goes cold.
// Restarted every turn: a timer started only at session.start died silently (the countdown sat
// at 1h 0m) once the hook overran its budget waiting on the other mods' session.start beneath it
function restartTimer($: EngineInterface) {
  timer?.cancel()
  timer = $.clock.every(30_000, async () => {
    const at = await read($, cacheAt)
    const left = at === null ? -1 : at + CACHE_TTL - (await $.clock.now())
    if (left > 0 && left <= WARN_AT && !warned) {
      warned = true
      $.ui.toast(`Cache stygnie za ${Math.ceil(left / 60_000)} min - wyślij coś albo zrób handoff`, { timeoutMs: 15_000 })
    }
    await update($, tick, n => n + 1)
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    restartTimer($)
    const out = await next(e)
    await Promise.all([refresh($), refreshBranch($)])
    await $.command.register({
      name: 'pasek',
      description: 'Próg kontekstu dla przycisku Handoff na pasku (tylko ta sesja)',
      argumentHint: 'prog <1-99|off|reset> | handoff',
    })
    return out
  })

  on('command.run', { command: 'pasek' }, async ($, e) => {
    // uterminal buttons need ctrl+x tab first, so there Handoff is a command
    if (e.args.trim() === 'handoff') {
      const handoff = handoffCommand(await $.command.list().catch(() => []))
      if (!handoff) return { text: 'Brak skilla handoff w tej sesji (szukam /pasek:handoff albo /handoff).' }
      const [cwd, now] = await Promise.all([$.session.cwd(), $.clock.now()])
      // a command can't run another from inside its own hook, so it goes out on a timer, after this one ends
      $.clock.after(50, () =>
        void $.command.run({ command: handoff, args: handoffArgs(cwd, now) }).catch(() =>
          $.ui.toast(`Nie udało się odpalić handoffu - wpisz /${handoff}`, { timeoutMs: 15_000 }),
        ),
      )
      return { text: `Odpalam handoff - zapisze się w ${cwd}/.claude/` }
    }
    const v = parseProg(e.args)
    const now = await read($, prog)
    if (v === 'show') return { text: now ? `Próg kontekstu: ${now}% (domyślnie ${DEFAULT_PROG}%).` : 'Próg kontekstu wyłączony.' }
    if (v === null) return { text: 'Użycie: /pasek prog 20 · /pasek prog off · /pasek prog reset' }
    const next = v === 'off' ? 0 : v
    await update($, prog, () => next)
    await update($, warnedProg, () => false)
    return { text: next ? `Próg kontekstu ustawiony na ${next}% (do końca tej sesji).` : 'Próg kontekstu wyłączony do końca tej sesji.' }
  })

  on('prompt.submit', async ($, e, next) => {
    await update($, prompts, n => n + 1)
    // the request this prompt sends refreshes the cache too, so the countdown shows from the first prompt
    const at = await $.clock.now()
    await update($, cacheAt, () => at)
    warned = false
    restartTimer($)
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await refresh($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      const at = await $.clock.now()
      await update($, cacheAt, () => at)
      warned = false
    }
    if (e.agentId === undefined && e.usage) {
      const u = e.usage
      const input = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
      const turn: LastTurn = {
        ms: e.durationMs,
        model: u.model,
        cachePct: input ? Math.round((u.cache_read_input_tokens / input) * 100) : 0,
      }
      await update($, last, () => turn)
      await refreshBranch($)
      // one toast per crossing; dropping back under (a /clear, a compact) re-arms it
      const [p, pct, done] = await Promise.all([read($, prog), $.session.usage().then(s => s.context.percent ?? 0), read($, warnedProg)])
      const over = p > 0 && pct >= p
      if (over && !done) $.ui.toast(`Kontekst ${Math.round(pct)}% - zbliżamy się do granicy. Kliknij Handoff na pasku.`, { timeoutMs: 15_000 })
      if (over !== done) await update($, warnedProg, () => over)
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // uthe band shows on every surface (terminal, desktop, IDE), in every project
    if (e.props.hasSurvey) return next(e)
    // what the mods and the engine beneath draw stays under the band instead of being replaced
    const below = await next(e)

    // drawing is pure: no state writes here (a write skips the hook and the band vanishes).
    // The usage atom is read only so session.measure redraws us; figures come fresh.
    const [, , br, n, turn, cwd, now, s, cAt, rec, cmds, p] = await Promise.all([
      read($, usage),
      read($, tick),
      read($, branch),
      read($, prompts),
      read($, last),
      $.session.cwd(),
      $.clock.now(),
      $.session.usage(),
      read($, cacheAt),
      read($, recOn),
      $.command.list().catch(() => []),
      read($, prog),
    ])
    // the "Wytłumacz" button shows only when the wytlumacz-mi mod is loaded
    const canExplain = cmds.some(c => c.name === 'wytlumacz')
    const handoff = handoffCommand(cmds)
    const started = s.startedAt
    const u: Usage = {
      tokens: s.context.tokens,
      window: s.context.window,
      percent: s.context.percent,
      limits: s.rateLimits,
      usd: s.cost?.usd,
    }
    const { Box, Text, Button } = $.ui.resolve(e)
    const repo = cwd.split('/').pop()
    const over = p > 0 && (u.percent ?? 0) >= p
    const five = u.limits.find(l => l.kind === 'five_hour')
    const week = u.limits.find(l => l.kind === 'seven_day')

    const gauge = (label: string, pct: number, tail?: string, color = tone(pct)) => (
      <Text>
        <Text dimColor>{label} </Text>
        <Text color={color}>{bar(pct)}</Text>
        <Text color={color === 'red' ? 'red' : undefined}>{` ${Math.round(pct)}%`}</Text>
        {tail && <Text dimColor>{` ${tail}`}</Text>}
      </Text>
    )
    // uthe cache countdown gets a draining bar (▰▱, apart from the █░ gauges)
    const cacheLine = (at: number | null, t: number) => {
      if (at === null) return <Text dimColor>cache -</Text>
      const left = at + CACHE_TTL - t
      if (left <= 0) return <Text color="red">cache cold</Text>
      const cells = Math.max(1, Math.round((left / CACHE_TTL) * 6))
      return (
        <Text color={left <= WARN_AT ? 'red' : left <= 15 * 60_000 ? 'yellow' : 'green'}>
          cache {'▰'.repeat(cells) + '▱'.repeat(6 - cells)} {span(left)}
        </Text>
      )
    }
    const reset = (l: typeof five) => (l?.resetsAt ? `↻${span(Date.parse(l.resetsAt) - now)}` : undefined)

    const buttons = (
      <Box flexDirection="row" columnGap={1}>
        {over && handoff && (
          <Button
            key="handoff"
            label="Handoff"
            hotkey="h"
            onPress={() => void $.command.run({ command: handoff, args: handoffArgs(cwd, now) })}
          />
        )}
        {/* no args = /record toggles, reading its own state, so two quick presses both land */}
        <Button
          key="rec"
          label={rec ? 'Stop REC' : 'REC'}
          hotkey="r"
          dimColor={!rec}
          onPress={() => void $.command.run({ command: 'record' })}
        />
        {/* the explain button lives here; wytlumacz-mi's own row below only offers the recap */}
        {canExplain && (
          <Button
            key="explain"
            label="Wytłumacz"
            hotkey="w"
            onPress={() => void $.command.run({ command: 'wytlumacz' })}
          />
        )}
      </Box>
    )

    // uterminal and IDE have their own status line (repo, cost, ctx), so there the band
    // shrinks to one row; buttons there need ctrl+x tab before a press, so commands stand in for them
    if (e.surface === 'terminal' || e.surface === 'vscode') {
      const pct = Math.round(u.percent ?? 0)
      const hints = [rec ? '/record off' : '/record', canExplain ? '/wytlumacz' : null].filter(Boolean).join(' · ')
      return (
        <Box flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between" columnGap={2} flexWrap="wrap">
            <Text>
              {rec && <Text color="red" bold>{'● REC  '}</Text>}
              {cacheLine(cAt, now)}
              {over && <Text color={ctxTone(pct, p)}>{`   ⚠ granica ctx ${pct}%`}</Text>}
              {over && handoff && <Text color={ctxTone(pct, p)} bold>{' → /pasek handoff'}</Text>}
            </Text>
            <Text dimColor>{hints}</Text>
          </Box>
          {below && <Box marginTop={1}>{below}</Box>}
        </Box>
      )
    }

    // Kris: 5 rows left half the band empty; two rows, columns side by side
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between" columnGap={3}>
          <Text>
            {rec && <Text color="red" bold>{'● REC '}</Text>}
            <Text bold>{repo}</Text>
            {br && <Text color="green">{` ⎇ ${br}`}</Text>}
            <Text dimColor>
              {` · ${span(now - started)} · ${n} prompts`}
              {/* recording mode masks amounts in the transcript; the band's cost is one too */}
              {u.usd !== undefined && (rec ? ' · [kwota]' : ` · $${u.usd.toFixed(2)}`)}
            </Text>
          </Text>
          <Text>
            {turn && (
              <Text dimColor>
                last {secs(turn.ms)} · {turn.model.replace(/^claude-/, '')} · hit {turn.cachePct}% ·{' '}
              </Text>
            )}
            {cacheLine(cAt, now)}
          </Text>
        </Box>
        <Box flexDirection="row" columnGap={3} flexWrap="wrap">
          {/* ufrom the threshold the Handoff button shows; colour per ctxTone */}
          {gauge('ctx', u.percent ?? 0, `${tokens(u.tokens ?? 0)}/${tokens(u.window)}${over ? ' ⚠ granica' : ''}`, ctxTone(u.percent ?? 0, p))}
          {five && gauge('5h', five.percentUsed, reset(five))}
          {week && gauge('week', week.percentUsed, reset(week))}
          {/* REC and Wytłumacz sit together as one pair, closer than the gauges */}
          {buttons}
        </Box>
        {/* uthe explain row (wytlumacz-mi) sits under the band, one line apart */}
        {below && <Box marginTop={1}>{below}</Box>}
      </Box>
    )
  })
}
