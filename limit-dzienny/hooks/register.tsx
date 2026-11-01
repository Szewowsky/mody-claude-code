import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Day } from '../types'
import { SLICE, dayOf, level } from './day'

// the pasek mod reads this atom and draws a "dziś" ring in place of the 5h one
const day = atom({ plugin: 'limit-dzienny', key: 'day' } as const, null)
// kept in $.store too, so a new session the same day does not repeat a toast the last one already showed
const warned = atom({ plugin: 'limit-dzienny', key: 'warned' } as const, null)
const WARNED_KEY = 'warned'

// a day can roll over while the session idles: recompute every 5 min (restarted every turn, see pasek's restartTimer)
const EVERY = 5 * 60_000

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

// a write redraws every reader even when the value is the same, so unchanged values are not written
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

const dayKey = (d: Day) => `${d.resetsAt}:${d.day}`

function toastText(d: Day, lvl: number, now: number) {
  const nextIn = span(d.nextDayAt - now)
  if (lvl >= 100)
    return `Limit dnia wyczerpany (${Math.round(d.todayPct)}% dzisiejszej 1/7). Dalej jedziesz na jutrzejszym - nowy dzień za ${nextIn}.`
  return `${Math.round(d.todayPct)}% limitu dnia - zostało ${pl(d.left)}% tygodnia na dziś, nowy dzień za ${nextIn}.`
}

async function refresh($: EngineInterface) {
  const [u, now] = await Promise.all([$.session.usage().catch(() => null), $.clock.now()])
  // no usage reading at all: keep what we had (a failed call is not "no limit")
  if (!u) return
  const week = u.rateLimits.find(l => l.kind === 'seven_day')
  const next = week ? dayOf(week.percentUsed, week.resetsAt ? Date.parse(week.resetsAt) : undefined, now) : null
  if (!same(await read($, day), next)) await update($, day, () => next)
  if (!next) return

  const key = dayKey(next)
  const lvl = level(next)
  const stored = (await $.store.get(WARNED_KEY).catch(() => undefined)) as { key: string; level: number } | undefined
  const had = (await read($, warned)) ?? stored ?? null
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

let timer: Timer | null = null
function restartTimer($: EngineInterface) {
  timer?.cancel()
  timer = $.clock.every(EVERY, () => refresh($))
}

function details(d: Day | null, now: number) {
  if (!d)
    return 'Brak odczytu limitu tygodniowego (API go jeszcze nie zwróciło albo tydzień właśnie się zresetował). Wyślij prompt i spróbuj ponownie.'
  const lines = [
    `Dzień ${d.day}/7 tygodniowego limitu · dzisiejsza 1/7 = ${pl(SLICE)}% tygodnia.`,
    `Dziś zjedzone: ${Math.round(d.todayPct)}% limitu dnia.`,
    `Tydzień: ${pl(d.used)}% zużyte, do końca dnia wolno ${pl(d.allowed)}% (zostało dziś ${pl(d.left)}%).`,
  ]
  if (d.spare > 0) lines.push(`Zapas z poprzednich dni: ${pl(d.spare)}% tygodnia - schodzi przed dzisiejszą 1/7.`)
  lines.push(`Nowy dzień za ${span(d.nextDayAt - now)}, reset tygodnia za ${span(d.resetsAt - now)}.`)
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
    return out
  })

  on('session.measure', async ($, e, next) => {
    await refresh($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      restartTimer($)
      await refresh($)
    }
    return next(e)
  })

  on('command.run', { command: 'limit' }, async $ => {
    await refresh($)
    const [d, now] = await Promise.all([read($, day), $.clock.now()])
    return { text: details(d, now) }
  })
}
