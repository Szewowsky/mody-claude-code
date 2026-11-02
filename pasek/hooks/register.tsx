import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { DailyLimit, LastTurn, Limit, Scene, SceneChoice, Usage } from '../types'
import { SCENE_IDS, SCENE_INFO, TONE_HEX, clawd, ring } from './art'

const usage = atom({ plugin: 'pasek', key: 'usage' } as const, null)
const branch = atom({ plugin: 'pasek', key: 'branch' } as const, '')
const prompts = atom({ plugin: 'pasek', key: 'prompts' } as const, 0)
const last = atom({ plugin: 'pasek', key: 'last' } as const, null)
const cacheAt = atom({ plugin: 'pasek', key: 'cacheAt' } as const, null)
const tick = atom({ plugin: 'pasek', key: 'tick' } as const, 0)
// every 10th tick (5 min): the desktop band reads this instead of tick, so the 30 s timer leaves it (and Clawd) alone
const slow = atom({ plugin: 'pasek', key: 'slow' } as const, 0)
// owned by the recording-mode mod; the band only reads it, so /record redraws the REC mark
const recOn = atom({ plugin: 'record-mode', key: 'isOn' } as const, false)
// owned by the limit-dzienny mod (the weekly limit cut into 7 days); read only, so its refresh redraws the "dziś" ring
const daily = atom({ plugin: 'limit-dzienny', key: 'day' } as const, null)
// context threshold for the handoff; /pasek prog sets it for this session only (0 = off)
const prog = atom({ plugin: 'pasek', key: 'prog' } as const, 40)
const warnedProg = atom({ plugin: 'pasek', key: 'warnedProg' } as const, false)
// Clawd's scene on desktop: the choice is kept across sessions in $.store (a scene or 'losowa'); this atom
// holds the scene drawn in this session (for 'losowa' the one drawn at session.start), so /pasek scena redraws the band
const scene = atom({ plugin: 'pasek', key: 'scene' } as const, null)
const SCENE_KEY = 'scene'
const DEFAULT_SCENE: Scene = 'plaza'
const RANDOM = 'losowa'

// Polish letters to plain ones, so "dżungla", "góry" and "plaża" match too
const PLAIN: Record<string, string> = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' }
const plain = (s: string) => s.toLowerCase().replace(/[ąćęłńóśźż]/g, c => PLAIN[c] ?? c)

function parseScene(args: string): SceneChoice | 'show' | null {
  const a = plain(args.trim()).replace(/^scena\b/, '').trim()
  if (a === '') return 'show'
  if (a === RANDOM || a === 'random') return RANDOM
  return SCENE_INFO.find(s => s.id === a || plain(s.pl) === a || s.aliases.includes(a))?.id ?? null
}

const isScene = (v: unknown): v is Scene => SCENE_IDS.includes(v as Scene)
const asChoice = (v: unknown): SceneChoice | null => (v === RANDOM || isScene(v) ? v : null)
const sceneName = (id: Scene) => SCENE_INFO.find(s => s.id === id)?.pl ?? id

// a different scene than the one drawn now, when there is one to avoid
function randomScene(not?: Scene | null): Scene {
  const pool = SCENE_IDS.filter(id => id !== not)
  return pool[Math.floor(Math.random() * pool.length)] ?? DEFAULT_SCENE
}

const storedChoice = async ($: EngineInterface) => asChoice(await $.store.get(SCENE_KEY).catch(() => undefined))

// the session's copy first; a fresh session (or one before /pasek scena) falls back to the store.
// 'losowa' with no copy yet (a draw before session.start wrote one): a pick fixed by the session's start,
// so every draw until then shows the same scene
async function currentScene($: EngineInterface, startedAt: number): Promise<Scene> {
  const own = await read($, scene)
  if (own) return own
  const stored = await storedChoice($)
  if (stored === RANDOM) return SCENE_IDS[Math.abs(Math.floor(startedAt / 1000)) % SCENE_IDS.length] ?? DEFAULT_SCENE
  return stored ?? DEFAULT_SCENE
}

function sceneList(current: Scene, choice: SceneChoice | null) {
  const head =
    choice === RANDOM
      ? `Scena Clawda: losowa, w tej sesji ${sceneName(current)}.`
      : `Scena Clawda: ${sceneName(current)} (zapamiętana na kolejne sesje).`
  const rows = SCENE_INFO.map(s => `- ${s.id}${plain(s.pl) !== s.pl ? ` (${s.pl})` : ''}: ${s.desc}`)
  return [
    head,
    'Do wyboru: /pasek scena <nazwa> albo krócej /pasek <nazwa>.',
    ...rows,
    `- ${RANDOM}: na każdym starcie sesji losuje jedną z ${SCENE_IDS.length} powyższych.`,
  ].join('\n')
}

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

// Polish number: one decimal, comma, no ",0"
const pl = (n: number) => (Math.round(n * 10) / 10).toFixed(1).replace('.', ',').replace(/,0$/, '')

// local HH:MM
function hhmm(ms: number) {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function secs(ms: number) {
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

function tokens(n: number) {
  return n >= 1e6 ? `${(n / 1e6).toFixed(n % 1e6 ? 1 : 0)}M` : `${Math.round(n / 1e3)}k`
}

// a write redraws every reader even when the value is the same, so unchanged values are not written
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

async function refresh($: EngineInterface) {
  const u = await $.session.usage()
  // which limits the last API response reported (sometimes only seven_day): for the 5h ring diagnosis
  $.ui.log(`pasek: rateLimits kinds = [${u.rateLimits.map(l => l.kind).join(', ')}]`, { to: 'debug' })
  const next: Usage = {
    tokens: u.context.tokens,
    window: u.context.window,
    percent: u.context.percent,
    limits: u.rateLimits,
    usd: u.cost?.usd,
  }
  if (!same(await read($, usage), next)) await update($, usage, () => next)
}

async function refreshBranch($: EngineInterface) {
  // one git call per turn, a fs watch on .git/HEAD if it ever lags
  const r = await $.process.run(['git', 'branch', '--show-current']).catch(() => null)
  const name = r && r.exitCode === 0 ? r.stdout.trim() : ''
  if ((await read($, branch)) !== name) await update($, branch, () => name)
}

// desktop cache thresholds, apart from WARN_AT (toast) and the terminal cacheLine colours, which stay as they were:
// green above 30 min left, yellow 30-15 min, red under 15 min
const CACHE_YELLOW = 30 * 60_000
const CACHE_RED = 15 * 60_000

// desktop: the cache countdown as coloured text in the prompt footer (SessionMode), in whole minutes
// (the timer redraws every 30 s; MM:SS would need a redraw a second, see restartTimer)
function cacheDesktop(at: number | null, now: number): { text: string; color?: 'green' | 'yellow' | 'red' } {
  if (at === null) return { text: 'cache -' }
  const left = at + CACHE_TTL - now
  if (left <= 0) return { text: 'cache cold', color: 'red' }
  const color = left > CACHE_YELLOW ? 'green' : left >= CACHE_RED ? 'yellow' : 'red'
  return { text: `cache ${Math.ceil(left / 60_000)} min`, color }
}

// how the footer shows it: 'tree' draws our own coloured Text beside the engine's mode labels;
// 'modes' (fallback, if the desktop ever refuses the tree) adds a plain dim label through props.modes
const FOOTER = 'tree' as 'tree' | 'modes'

let warned = false
let timer: Timer | null = null
let ticks = 0
// the last session start the band saw, for a draw where $.session.usage() fails (see the AbovePrompt hook)
let lastStarted: number | undefined

// redraws the cache countdown (terminal band, desktop footer) and warns once before the cache goes cold.
// Restarted every turn: a timer started only at session.start died silently (the countdown sat
// at 1h 0m) once the hook overran its budget waiting on the other mods' session.start beneath it.
// 30 s, not 1 s: every redraw re-runs the band's dozen engine calls. The desktop band does not read tick at
// all (its cache countdown is in the footer): it reads slow, bumped every 10th tick, so Clawd's Svg is not
// re-sent every 30 s while its session time and reset times still move while idle
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
    if (++ticks % 10 === 0) await update($, slow, n => n + 1)
  })
}

// REC's label, shared by the band (no desktop) and the desktop footer
const recLabel = (rec: boolean) => (rec ? '● Stop REC' : 'REC')

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // 1.2.0 pinned the cache countdown to the status line; a reload clears that line once, nothing sets it now
    $.ui.status(undefined)
    restartTimer($)
    // 'losowa': a new scene for every session, written before the band first draws if it can be
    if ((await storedChoice($)) === RANDOM) {
      const pick = randomScene()
      await update($, scene, () => pick)
    }
    const out = await next(e)
    await Promise.all([refresh($), refreshBranch($)])
    await $.command.register({
      name: 'pasek',
      description: 'Próg kontekstu dla Handoff (ta sesja), scena Clawda na desktopie (7 scen albo losowa), handoff',
      argumentHint: 'prog <1-99|off|reset> | scena [nazwa|losowa] | handoff',
    })
    return out
  })

  on('command.run', { command: 'pasek' }, async ($, e) => {
    // terminal buttons need ctrl+x tab first, so there Handoff is a command
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
    // a bare scene name (/pasek kosmos, /pasek losowa) needs no "scena": it can't be mistaken for prog or handoff
    const sc = parseScene(e.args)
    if (/^scena\b/.test(plain(e.args.trim())) || (sc !== 'show' && sc !== null)) {
      if (sc === 'show') {
        const started = await $.session.usage().then(u => u.startedAt, () => 0)
        return { text: sceneList(await currentScene($, started), await storedChoice($)) }
      }
      if (sc === null) return { text: `Nie znam tej sceny. ${sceneList(await currentScene($, 0), await storedChoice($))}\nUżycie: /pasek scena <nazwa>` }
      await $.store.set(SCENE_KEY, sc)
      if (sc === RANDOM) {
        const pick = randomScene(await read($, scene))
        await update($, scene, () => pick)
        return { text: `Scena Clawda: losowa, teraz ${sceneName(pick)}. Na każdym starcie sesji wylosuję nową.` }
      }
      await update($, scene, () => sc)
      return { text: `Scena Clawda: ${sceneName(sc)} (zapamiętana na kolejne sesje).` }
    }
    const v = parseProg(e.args)
    const now = await read($, prog)
    if (v === 'show') return { text: now ? `Próg kontekstu: ${now}% (domyślnie ${DEFAULT_PROG}%).` : 'Próg kontekstu wyłączony.' }
    if (v === null)
      return {
        text: 'Użycie: /pasek scena (lista scen) · /pasek kosmos · /pasek losowa · /pasek prog 20 · /pasek prog off · /pasek prog reset · /pasek handoff',
      }
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
    // the band shows on every surface (terminal, desktop, IDE), in every project
    if (e.props.hasSurvey) return next(e)
    // what the mods and the engine beneath draw stays under the band instead of being replaced
    const below = await next(e)

    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    // Svg only on the desktop table (and mobile, which never draws this band)
    const Svg = e.surface === 'desktop' && 'Svg' in els ? els.Svg : undefined

    // drawing is pure: no state writes here (a write skips the hook and the band vanishes).
    // The usage atom is read so session.measure redraws us; figures come fresh, the atom stands in if they can't.
    // A hook that throws is skipped and the band shows only what is beneath it: Clawd would vanish for that
    // draw and come back with its animation started over, so every engine call here has a fallback.
    // The desktop band reads neither tick nor cacheAt (its cache countdown is in the footer): the 30 s timer
    // and the cacheAt write of every prompt and turn leave it alone; slow keeps its times moving while idle.
    const [kept, , br, n, turn, cwd, now, s, cAt, rec, cmds, p, dz] = await Promise.all([
      read($, usage),
      Svg ? read($, slow) : read($, tick),
      read($, branch),
      read($, prompts),
      read($, last),
      $.session.cwd().catch(() => ''),
      $.clock.now(),
      $.session.usage().catch(() => null),
      Svg ? null : read($, cacheAt),
      read($, recOn),
      $.command.list().catch(() => []),
      read($, prog),
      read($, daily),
    ])
    // the "Wytłumacz" button shows only when the wytlumacz-mi mod is loaded
    const canExplain = cmds.some(c => c.name === 'wytlumacz')
    const handoff = handoffCommand(cmds)
    if (s) lastStarted = s.startedAt
    const started = s?.startedAt ?? lastStarted ?? now
    const u: Usage = s
      ? {
          tokens: s.context.tokens,
          window: s.context.window,
          percent: s.context.percent,
          limits: s.rateLimits,
          usd: s.cost?.usd,
        }
      : (kept ?? { window: 0, limits: [] })
    const sc = Svg ? await currentScene($, started) : DEFAULT_SCENE
    const repo = cwd.split('/').pop()
    const over = p > 0 && (u.percent ?? 0) >= p
    const five = u.limits.find(l => l.kind === 'five_hour')
    const header = u.limits.find(l => l.kind === 'seven_day')
    // limit-dzienny also reads `claude /usage` (the whole account), which runs ahead of this session's header:
    // the 7d ring takes the higher of the two, so it never lags the "dziś" ring beside it (usage only grows in a week)
    const week: Limit | undefined =
      dz?.used !== undefined && (!header || dz.used > header.percentUsed)
        ? { kind: 'seven_day', percentUsed: dz.used, resetsAt: header?.resetsAt ?? (dz.resetsAt ? new Date(dz.resetsAt).toISOString() : undefined) }
        : header

    const gauge = (label: string, pct: number, tail?: string, color = tone(pct)) => (
      <Text>
        <Text dimColor>{label} </Text>
        <Text color={color}>{bar(pct)}</Text>
        <Text color={color === 'red' ? 'red' : undefined}>{` ${Math.round(pct)}%`}</Text>
        {tail && <Text dimColor>{` ${tail}`}</Text>}
      </Text>
    )
    // the cache countdown gets a draining bar (▰▱, apart from the █░ gauges)
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

    // desktop: a ring per limit (clock for 5h, calendar for 7d), bold percent, dim reset beside it
    // 7d is drawn even without a reading (rateLimits holds what the last API response reported, at times
    // only seven_day): then a gray empty ring and "brak odczytu"
    const limitRing = (label: string, l: Limit | undefined, icon: 'clock' | 'calendar') => {
      if (!Svg) return null
      if (!l)
        return (
          <Box flexDirection="row" alignItems="center" columnGap={1}>
            <Svg source={ring(0, TONE_HEX.gray!, icon)} alt={`limit ${label}: brak odczytu`} width={30} height={30} />
            <Text dimColor>{`${label} · brak odczytu`}</Text>
          </Box>
        )
      const pct = Math.round(l.percentUsed)
      const tail = l.resetsAt ? ` · reset za ${span(Date.parse(l.resetsAt) - now)}` : ''
      return (
        <Box flexDirection="row" alignItems="center" columnGap={1}>
          <Svg
            source={ring(l.percentUsed, TONE_HEX[tone(l.percentUsed)] ?? TONE_HEX.blue!, icon)}
            alt={`limit ${label}: ${pct}%${tail}`}
            width={30}
            height={30}
          />
          <Text>
            <Text bold>{`${pct}%`}</Text>
            <Text dimColor>{`  ${label}${tail}`}</Text>
          </Text>
        </Box>
      )
    }

    // desktop: today's 1/7 of the weekly limit (sun icon), from the limit-dzienny mod; a spare from the days
    // before shows beside it, past 100% the percent keeps counting (red)
    const dayRing = (d: DailyLimit) => {
      if (!Svg) return null
      const pct = Math.round(d.todayPct)
      const tail =
        ` · nowy dzień za ${span(d.nextDayAt - now)}${d.spare > 0 ? ` · zapas ${pl(d.spare)}%` : ''}` +
        (d.readAt !== undefined ? ` · odczyt ${hhmm(d.readAt)}` : '')
      return (
        <Box flexDirection="row" alignItems="center" columnGap={1}>
          <Svg
            source={ring(d.todayPct, TONE_HEX[tone(d.todayPct)] ?? TONE_HEX.blue!, 'sun')}
            alt={`limit dziś: ${pct}%${tail}`}
            width={30}
            height={30}
          />
          <Text>
            <Text bold>{`${pct}%`}</Text>
            <Text dimColor>{`  dziś${tail}`}</Text>
          </Text>
        </Box>
      )
    }

    // desktop: ctx as a ring too (chip icon), colour per ctxTone, "⚠ granica" past the threshold
    const ctxRing = () => {
      if (!Svg) return null
      const raw = u.percent ?? 0
      const pct = Math.round(raw)
      const color = ctxTone(raw, p)
      const size = `${tokens(u.tokens ?? 0)}/${tokens(u.window)}`
      return (
        <Box flexDirection="row" alignItems="center" columnGap={1}>
          <Svg
            source={ring(raw, TONE_HEX[color] ?? TONE_HEX.blue!, 'chip')}
            alt={`kontekst: ${pct}% · ${size}${over ? ' · granica' : ''}`}
            width={30}
            height={30}
          />
          <Text>
            <Text bold>{`${pct}%`}</Text>
            <Text dimColor>{`  ctx · ${size}`}</Text>
            {over && <Text color={color}>{' ⚠ granica'}</Text>}
          </Text>
        </Box>
      )
    }

    // withRec: the desktop band leaves REC to the prompt footer (SessionMode below), where it takes no band width
    const buttons = (withRec: boolean) => (
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
        {withRec && (
          <Button key="rec" label={recLabel(rec)} hotkey="r" dimColor={!rec} onPress={() => void $.command.run({ command: 'record' })} />
        )}
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

    // terminal and IDE have their own status line (repo, cost, ctx), so there the band
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
              {dz && <Text color={tone(dz.todayPct)}>{`   dziś ${Math.round(dz.todayPct)}%`}</Text>}
              {over && <Text color={ctxTone(pct, p)}>{`   ⚠ granica ctx ${pct}%`}</Text>}
              {over && handoff && <Text color={ctxTone(pct, p)} bold>{' → /pasek handoff'}</Text>}
            </Text>
            <Text dimColor>{hints}</Text>
          </Box>
          {below && <Box marginTop={1}>{below}</Box>}
        </Box>
      )
    }

    // Kris: 5 rows left half the band empty; two rows, columns side by side.
    const status = (
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
    )
    const lastTurn = (sep: string) =>
      turn && (
        <Text dimColor>
          last {secs(turn.ms)} · {turn.model.replace(/^claude-/, '')} · hit {turn.cachePct}%{sep}
        </Text>
      )

    // Desktop (Svg in the table): two rows and Clawd beside them, no third row.
    // Row 1: repo/branch/time/prompts/cost | last turn, then the buttons. Row 2: ctx/5h/7d rings.
    // The cache countdown sits in the prompt footer instead (the SessionMode hook below)
    if (Svg) {
      // the cached markup of this scene: the same string object on every draw (see clawd in art.ts)
      const art = clawd(sc)
      return (
        <Box flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={3}>
            <Box flexDirection="column" flexGrow={1}>
              <Box flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={3}>
                {status}
                <Box flexDirection="row" alignItems="center" columnGap={2}>
                  {lastTurn('')}
                  {buttons(false)}
                </Box>
              </Box>
              <Box flexDirection="row" alignItems="center" columnGap={3}>
                {ctxRing()}
                {/* 5h only when the API reports it (Max 20x, now called Ultra, has a weekly limit alone) */}
                {five && limitRing('5h', five, 'clock')}
                {dz && dayRing(dz)}
                {limitRing('7d', week, 'calendar')}
              </Box>
            </Box>
            {/* isInteractive: a sandboxed frame without scripts, where the SMIL frames run. Clawd sits alone in
                a Box keyed by its scene, at a fixed place in the tree, with the same source and alt on every draw:
                a redraw of the band hands the surface an identical element. The key goes on the Box because the
                engine passes on only the props an element declares, and SvgProps has no key (a key on the Svg
                never reaches the surface) */}
            <Box key={`clawd-${sc}`}>
              <Svg source={art.source} alt={art.alt} width={200} height={50} isInteractive />
            </Box>
          </Box>
          {/* uthe explain row (wytlumacz-mi) sits under the band, one line apart */}
          {below && <Box marginTop={1}>{below}</Box>}
        </Box>
      )
    }

    // no Svg in the table (no surface draws this band so today): the text band of 1.0
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between" columnGap={3}>
          {status}
          <Text>
            {lastTurn(' · ')}
            {cacheLine(cAt, now)}
          </Text>
        </Box>
        <Box flexDirection="row" columnGap={3} flexWrap="wrap">
          {/* ufrom the threshold the Handoff button shows; colour per ctxTone */}
          {gauge('ctx', u.percent ?? 0, `${tokens(u.tokens ?? 0)}/${tokens(u.window)}${over ? ' ⚠ granica' : ''}`, ctxTone(u.percent ?? 0, p))}
          {five && gauge('5h', five.percentUsed, reset(five))}
          {dz && gauge('dziś', dz.todayPct, `↻${span(dz.nextDayAt - now)}`)}
          {week && gauge('week', week.percentUsed, reset(week))}
          {/* REC and Wytłumacz sit together as one pair, closer than the gauges */}
          {buttons(true)}
        </Box>
        {below && <Box marginTop={1}>{below}</Box>}
      </Box>
    )
  })

  // desktop: the cache countdown in the prompt footer, beside the session's mode labels (SessionMode).
  // Terminal and IDE: untouched (there the countdown stays in the band)
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (e.surface !== 'desktop') return next(e)
    // tick is read so the 30 s timer redraws the footer too (a read while drawing subscribes the instance)
    const [, at, now, rec] = await Promise.all([read($, tick), read($, cacheAt), $.clock.now(), read($, recOn)])
    const c = cacheDesktop(at, now)
    // variant B: the engine draws it as one more dim mode label, no colour
    if (FOOTER === 'modes') return next({ ...e, props: { ...e.props, modes: [...e.props.modes, c.text] } })
    // variant A: the engine's own labels (or nothing, with no modes) and the coloured countdown after them
    const below = await next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    // REC sits here on desktop, before the cache countdown: in the band it took a column of its own
    return (
      <Box flexDirection="row" alignItems="center" columnGap={1}>
        {below}
        <Button key="rec" label={recLabel(rec)} hotkey="r" dimColor={!rec} onPress={() => void $.command.run({ command: 'record' })} />
        <Text color={c.color} dimColor={!c.color}>
          {c.text}
        </Text>
      </Box>
    )
  })
}
