import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Day } from '../types'
import { SLICE, dayOf, level } from './day'
import { CHILD_ENV, USAGE_ARGV, parseUsage } from './usage'
import type { CliReading } from './usage'

// the pasek mod reads this atom and draws a "dziś" ring in place of the 5h one
const day = atom({ plugin: 'limit-dzienny', key: 'day' } as const, null)
// kept in $.store too, so a new session the same day does not repeat a toast the last one already showed
const warned = atom({ plugin: 'limit-dzienny', key: 'warned' } as const, null)
const WARNED_KEY = 'warned'
// the last `claude -p /usage` reading, shared by every session through $.store: one of them reads, the rest reuse it
const CLI_KEY = 'cli'
// when a session started a read, so others running at the same moment do not start their own
const LOCK_KEY = 'cliLock'
type StoredCli = CliReading & { at: number }

// a day can roll over while the session idles: recompute every 5 min (restarted every turn, see pasek's restartTimer)
const EVERY = 5 * 60_000
// how old the shared /usage reading may get before a session reads again
const CLI_EVERY = 5 * 60_000
// a read in flight longer than this is taken as dead and another session may try
const LOCK_FOR = 90_000

// Polish number: one decimal, comma, no ",0"
const pl = (n: number) => (Math.round(n * 10) / 10).toFixed(1).replace('.', ',').replace(/,0$/, '')

function span(ms: number) {
  const m = Math.max(0, Math.round(ms / 60000))
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m % 60}m`
  return `${m}m`
}

// local HH:MM
const clock = (ms: number) => {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// a write redraws every reader even when the value is the same, so unchanged values are not written
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

// the reset to the hour: the API header and /usage print it a few seconds or a minute apart
const dayKey = (d: Day) => `${Math.round(d.resetsAt / 3_600_000) * 3_600_000}:${d.day}`

function toastText(d: Day, lvl: number, now: number) {
  const nextIn = span(d.nextDayAt - now)
  if (lvl >= 100)
    return `Limit dnia wyczerpany (${Math.round(d.todayPct)}% dzisiejszej 1/7). Dalej jedziesz na jutrzejszym - nowy dzień za ${nextIn}.`
  return `${Math.round(d.todayPct)}% limitu dnia - zostało ${pl(d.left)}% tygodnia na dziś, nowy dzień za ${nextIn}.`
}

type Reading = { percentUsed: number; resetsAt: number; at: number; source: 'api' | 'usage' }

// The API header (this session's last response) against /usage (the account, read in the background).
// Within one week usage only grows, so the higher percent is the fresher one; a later reset means
// a new week has begun and that reading wins whatever its percent
function pick(api: Reading | null, cli: Reading | null): Reading | null {
  if (!api || !cli) return api ?? cli
  if (Math.abs(api.resetsAt - cli.resetsAt) > 3_600_000) return api.resetsAt > cli.resetsAt ? api : cli
  if (cli.percentUsed > api.percentUsed) return { ...cli, resetsAt: api.resetsAt }
  return api
}

// when this session last got an API response; the module's own, so a reload starts it over
let apiAt: number | undefined

// fresh: an API response just came (turn end, session.measure), so the header reading's time moves to now;
// the timer and /limit only recount what is known against the clock
async function refresh($: EngineInterface, fresh = false) {
  const [u, now, prev, stored] = await Promise.all([
    $.session.usage().catch(() => null),
    $.clock.now(),
    read($, day),
    $.store.get(CLI_KEY).catch(() => undefined) as Promise<StoredCli | undefined>,
  ])
  if (fresh || apiAt === undefined) apiAt = now
  const week = u?.rateLimits.find(l => l.kind === 'seven_day')
  const weekReset = week?.resetsAt ? Date.parse(week.resetsAt) : undefined
  const api: Reading | null =
    week && weekReset !== undefined ? { percentUsed: week.percentUsed, resetsAt: weekReset, at: apiAt, source: 'api' } : null
  const cliReset = stored?.resetsAt ?? weekReset
  const cli: Reading | null =
    stored && cliReset !== undefined && cliReset > now ? { percentUsed: stored.percentUsed, resetsAt: cliReset, at: stored.at, source: 'usage' } : null
  // no reading of any kind (a failed usage call, no /usage yet): keep what we had
  if (!u && !cli) return
  const r = pick(api, cli)
  const counted = r ? dayOf(r.percentUsed, r.resetsAt, now) : null
  const next = counted && { ...counted, readAt: r!.at, source: r!.source }
  if (!same(prev, next)) await update($, day, () => next)
  if (!next) return

  const key = dayKey(next)
  const lvl = level(next)
  const storedWarn = (await $.store.get(WARNED_KEY).catch(() => undefined)) as { key: string; level: number } | undefined
  const had = (await read($, warned)) ?? storedWarn ?? null
  const done = had?.key === key ? had.level : 0
  // the desktop Code tab may lack some ui calls (see notify in autocommit): a toast that throws must not stop the refresh
  if (lvl > done) {
    try {
      $.ui.toast(toastText(next, lvl, now), { timeoutMs: 20_000 })
    } catch {}
  }
  // a new day re-arms the toasts; within one day the level only goes up
  const keep = { key, level: Math.max(lvl, done) }
  if (!same(had, keep)) {
    await update($, warned, () => keep)
    await $.store.set(WARNED_KEY, keep).catch(() => undefined)
  }
}

// `claude -p /usage` in the background: no model call, no token of ours (the CLI signs in itself), ~3 s.
// --setting-sources project keeps the user's plugins (this mod among them) out of the child, and the
// child env is a second guard. Skipped when another session read it lately or is reading now; force for /limit
async function readCli($: EngineInterface, force = false) {
  // the engine lists the variables a mod reads, so the name is a literal here (CHILD_ENV in usage.ts)
  if ((await $.env.get('LIMIT_DZIENNY_CHILD').catch(() => undefined)) === '1') return
  const now = await $.clock.now()
  const [last, lock] = await Promise.all([
    $.store.get(CLI_KEY).catch(() => undefined) as Promise<StoredCli | undefined>,
    $.store.get(LOCK_KEY).catch(() => undefined) as Promise<number | undefined>,
  ])
  if (!force && last && now - last.at < CLI_EVERY) return
  if (lock && now - lock < LOCK_FOR) return
  await $.store.set(LOCK_KEY, now).catch(() => undefined)
  try {
    // a temp folder, not the project: --setting-sources project there finds no settings, so no plugins and no
    // project hooks load in the child (TEMP on Windows; never HOME, whose .claude is the user's own settings)
    const [tmp, temp, home] = await Promise.all([
      $.env.get('TMPDIR').catch(() => undefined),
      $.env.get('TEMP').catch(() => undefined),
      // the desktop app's PATH may miss ~/.local/bin, where the installer puts claude
      $.env.get('HOME').catch(() => undefined),
    ])
    const init = { cwd: tmp || temp || '/tmp', env: { [CHILD_ENV]: '1' }, timeoutMs: 60_000 }
    const r =
      (await $.process.run([...USAGE_ARGV], init).catch(() => null)) ??
      (home ? await $.process.run([`${home}/.local/bin/claude`, ...USAGE_ARGV.slice(1)], init).catch(() => null) : null)
    const reading = r && r.exitCode === 0 ? parseUsage(r.stdout, now) : null
    if (reading) await $.store.set(CLI_KEY, { ...reading, at: await $.clock.now() }).catch(() => undefined)
  } finally {
    await $.store.delete(LOCK_KEY).catch(() => undefined)
  }
  await refresh($)
}

let timer: Timer | null = null
function restartTimer($: EngineInterface) {
  timer?.cancel()
  timer = $.clock.every(EVERY, async () => {
    await refresh($)
    void readCli($).catch(() => undefined)
  })
}

function details(d: Day | null, now: number) {
  if (!d)
    return 'Brak odczytu limitu tygodniowego (ani API, ani `claude /usage` go nie zwróciły albo tydzień właśnie się zresetował). Wyślij prompt i spróbuj ponownie.'
  const lines = [
    `Dzień ${d.day}/7 tygodniowego limitu · dzisiejsza 1/7 = ${pl(SLICE)}% tygodnia.`,
    `Dziś zjedzone: ${Math.round(d.todayPct)}% limitu dnia.`,
    `Tydzień: ${pl(d.used)}% zużyte, do końca dnia wolno ${pl(d.allowed)}% (zostało dziś ${pl(d.left)}%).`,
  ]
  if (d.spare > 0) lines.push(`Zapas z poprzednich dni: ${pl(d.spare)}% tygodnia - schodzi przed dzisiejszą 1/7.`)
  lines.push(`Nowy dzień za ${span(d.nextDayAt - now)}, reset tygodnia za ${span(d.resetsAt - now)}.`)
  if (d.readAt !== undefined)
    lines.push(
      d.source === 'usage'
        ? `Odczyt: ${clock(d.readAt)} z \`claude /usage\` (całe konto, odświeżane w tle co 5 min).`
        : `Odczyt: ${clock(d.readAt)} z odpowiedzi API tej sesji (\`claude /usage\` co 5 min dociąga resztę konta).`,
    )
  lines.push('Ostrzegam przy 80% i 100% limitu dnia, raz na próg.')
  return lines.join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const out = await next(e)
    restartTimer($)
    await refresh($)
    await $.command.register({
      name: 'limit',
      description: 'Limit dzienny: dzień tygodnia limitu, ile z dzisiejszej 1/7 zjedzone, zapas i kiedy nowy dzień',
    })
    // not awaited: ~3 s of a child process must not hold up the session's start
    void readCli($).catch(() => undefined)
    return out
  })

  on('session.measure', async ($, e, next) => {
    await refresh($, true)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      restartTimer($)
      await refresh($, true)
    }
    return next(e)
  })

  on('command.run', { command: 'limit' }, async $ => {
    await readCli($, true).catch(() => undefined)
    await refresh($)
    const [d, now] = await Promise.all([read($, day), $.clock.now()])
    return { text: details(d, now) }
  })
}
