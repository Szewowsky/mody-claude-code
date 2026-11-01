import { expect, mock, test } from 'claude-code/testing'

const DAY = 24 * 3_600_000
const RESET = Date.UTC(2026, 10, 4, 14)
const START = RESET - 7 * DAY
const SLICE = 100 / 7

const usage = (pct: number | null) => ({
  startedAt: 0,
  context: { tokens: 0, window: 1000000, percent: 0 },
  rateLimits: pct === null ? [] : [{ kind: 'seven_day', percentUsed: pct, resetsAt: new Date(RESET).toISOString() }],
})

function base(on: never, pct: () => number | null, toasts: string[], now = START + DAY + 3_600_000) {
  const clock = mock.clock(on as never, { now })
  const o = on as (...a: unknown[]) => void
  o('session.usage', () => ({ value: usage(pct()) }) as never)
  o('ui.toast', ($: unknown, e: { text?: string; message?: string }) => {
    toasts.push(String(e.text ?? e.message ?? JSON.stringify(e)))
    return { value: undefined } as never
  })
  return clock
}
const limit = ($: { command: { run: (e: never) => Promise<{ text: string }> } }) => $.command.run({ command: 'limit', args: '' } as never)

test('toast once at 80% and once at 100% of the day, not again on the same level', async ($, on) => {
  const toasts: string[] = []
  // day 2: the day's slice runs from 1/7 to 2/7 of the week
  let pct: number | null = SLICE + 0.5 * SLICE
  base(on as never, () => pct, toasts)
  mock.store(on as never)
  await limit($ as never)
  expect(toasts.length).toBe(0)
  pct = SLICE + 0.85 * SLICE
  await limit($ as never)
  await limit($ as never)
  expect(toasts.length).toBe(1)
  expect(toasts[0]).toMatch(/85% limitu dnia/)
  pct = 2 * SLICE + 1
  await limit($ as never)
  await limit($ as never)
  expect(toasts.length).toBe(2)
  expect(toasts[1]).toMatch(/Limit dnia wyczerpany/)
})

test('a new day re-arms the toasts', async ($, on) => {
  const toasts: string[] = []
  let pct = SLICE + 0.9 * SLICE
  const clock = base(on as never, () => pct, toasts)
  mock.store(on as never)
  await limit($ as never)
  expect(toasts.length).toBe(1)
  await clock.advance(DAY) // day 3: slice 2/7-3/7
  pct = 2 * SLICE + 0.9 * SLICE
  await limit($ as never)
  expect(toasts.length).toBe(2)
})

test('a toast already shown today (in the store) is not repeated by a new session', async ($, on) => {
  const toasts: string[] = []
  base(on as never, () => SLICE + 0.9 * SLICE, toasts)
  mock.store(on as never, { warned: { key: `${RESET}:2`, level: 80 } })
  await limit($ as never)
  expect(toasts.length).toBe(0)
})

test('/limit explains the day, the spare and when the next day starts', async ($, on) => {
  const toasts: string[] = []
  // day 3 (2 days + 1h in), only 20% used: a spare of ~8.6%
  base(on as never, () => 20, toasts, START + 2 * DAY + 3_600_000)
  mock.store(on as never)
  const t = (await limit($ as never)).text
  expect(t).toMatch(/Dzień 3\/7/)
  expect(t).toMatch(/Dziś zjedzone: 0% limitu dnia/)
  expect(t).toMatch(/Zapas z poprzednich dni: 8,6%/)
  expect(t).toMatch(/Nowy dzień za 23h 0m/)
  expect(toasts.length).toBe(0)
})

test('no weekly reading: /limit says so, no toast', async ($, on) => {
  const toasts: string[] = []
  base(on as never, () => null, toasts)
  mock.store(on as never)
  expect((await limit($ as never)).text).toMatch(/Brak odczytu/)
  expect(toasts.length).toBe(0)
})
