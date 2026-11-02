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

type Run = { argv: string[]; env?: Record<string, string>; cwd?: string }
// claude -p /usage: by default it fails (exit 1), so the header alone counts; cli() makes it answer
function base(
  on: never,
  pct: () => number | null,
  toasts: string[],
  now = START + DAY + 3_600_000,
  cli: (argv: string[]) => { exitCode: number; stdout: string } | 'missing' = () => ({ exitCode: 1, stdout: '' }),
  runs: Run[] = [],
  env: Record<string, string> = { HOME: '/Users/x' },
) {
  const clock = mock.clock(on as never, { now })
  const o = on as (...a: unknown[]) => void
  o('session.usage', () => ({ value: usage(pct()) }) as never)
  o('env.get', ($: unknown, e: { name: string }) => ({ value: env[e.name] }) as never)
  o('process.run', ($: unknown, e: { argv: string[]; init?: { env?: Record<string, string>; cwd?: string } }) => {
    runs.push({ argv: [...e.argv], env: e.init?.env, cwd: e.init?.cwd })
    const r = cli(e.argv)
    if (r === 'missing') return { deny: 'ENOENT: claude not found' } as never
    return { value: { ...r, stderr: '' } } as never
  })
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

test('the reading time: /limit alone keeps it, a turn end (fresh API response) moves it', async ($, on) => {
  const toasts: string[] = []
  const clock = base(on as never, () => 20, toasts, START + 2 * DAY + 3_600_000)
  mock.store(on as never)
  const at = (t: string) => t.match(/Odczyt: (\d{2}:\d{2}) z odpowiedzi API/)?.[1]
  const first = at((await limit($ as never)).text)
  expect(first).toBeDefined()
  await clock.advance(10 * 60_000)
  expect(at((await limit($ as never)).text)).toBe(first)
  await $.turn.complete({ durationMs: 1000 } as never).catch(() => undefined)
  const moved = at((await limit($ as never)).text)
  expect(moved !== first).toBe(true)
})

const usageOut = (pct: number) => `You are currently using your subscription\n\nCurrent week (all models): ${pct}% used · resets Nov 4 at 3pm (UTC)\n`

test('/usage ahead of the header: its percent counts, /limit names the source', async ($, on) => {
  const toasts: string[] = []
  const runs: Run[] = []
  // day 2: header 15%, /usage already 27% (other sessions, claude.ai)
  base(on as never, () => 15, toasts, START + DAY + 3_600_000, () => ({ exitCode: 0, stdout: usageOut(27) }), runs)
  mock.store(on as never)
  const t = (await limit($ as never)).text
  expect(t).toMatch(/Tydzień: 27% zużyte/)
  expect(t).toMatch(/Odczyt: \d{2}:\d{2} z `claude \/usage`/)
  expect(runs.length).toBe(1)
  expect(runs[0]!.argv).toEqual(['claude', '-p', '/usage', '--no-session-persistence', '--strict-mcp-config', '--setting-sources', 'project'])
  expect(runs[0]!.env).toEqual({ LIMIT_DZIENNY_CHILD: '1' })
  expect(runs[0]!.cwd).toBe('/tmp') // no TMPDIR/TEMP in this test's env
})

test('the header ahead of an older /usage: the header counts', async ($, on) => {
  const toasts: string[] = []
  base(on as never, () => 30, toasts, START + DAY + 3_600_000, () => ({ exitCode: 0, stdout: usageOut(27) }))
  mock.store(on as never)
  expect((await limit($ as never)).text).toMatch(/Tydzień: 30% zużyte[\s\S]*z odpowiedzi API/)
})

test('the timer reads /usage only when the shared reading is older than 5 min', async ($, on) => {
  const toasts: string[] = []
  const runs: Run[] = []
  const now = START + DAY + 3_600_000
  const clock = base(on as never, () => 15, toasts, now, () => ({ exitCode: 0, stdout: usageOut(20) }), runs)
  // another session read it a minute ago
  mock.store(on as never, { cli: { percentUsed: 18, at: now - 60_000 } })
  ;(on as (...a: unknown[]) => void)('session.start', () => ({ cwd: '/x' }) as never)
  await $.session.start({ cwd: '/x', surface: 'desktop', isInteractive: true } as never)
  await clock.advance(1000)
  expect(runs.length).toBe(0)
  await clock.advance(5 * 60_000)
  expect(runs.length).toBe(1)
})

test('in the child (LIMIT_DZIENNY_CHILD=1) or while another session reads: no /usage started', async ($, on) => {
  const toasts: string[] = []
  const runs: Run[] = []
  const now = START + DAY + 3_600_000
  base(on as never, () => 15, toasts, now, () => ({ exitCode: 0, stdout: usageOut(20) }), runs, { LIMIT_DZIENNY_CHILD: '1' })
  mock.store(on as never)
  await limit($ as never)
  expect(runs.length).toBe(0)
})

test('a read in flight elsewhere (lock under 90 s) is not doubled, even by /limit', async ($, on) => {
  const toasts: string[] = []
  const runs: Run[] = []
  const now = START + DAY + 3_600_000
  base(on as never, () => 15, toasts, now, () => ({ exitCode: 0, stdout: usageOut(20) }), runs)
  mock.store(on as never, { cliLock: now - 10_000 })
  await limit($ as never)
  expect(runs.length).toBe(0)
})

test('claude missing from PATH: the second try is ~/.local/bin/claude', async ($, on) => {
  const toasts: string[] = []
  const runs: Run[] = []
  base(on as never, () => 15, toasts, START + DAY + 3_600_000, argv => (argv[0] === 'claude' ? 'missing' : { exitCode: 0, stdout: usageOut(22) }), runs)
  mock.store(on as never)
  expect((await limit($ as never)).text).toMatch(/Tydzień: 22% zużyte/)
  expect(runs.map(r => r.argv[0])).toEqual(['claude', '/Users/x/.local/bin/claude'])
})

test('header and /usage resets a minute apart: one day key, no repeated toast', async ($, on) => {
  const toasts: string[] = []
  let out = usageOut(20)
  // day 2 at 90% of the day from the header; /usage prints the reset a minute early
  base(on as never, () => SLICE + 0.9 * SLICE, toasts, START + DAY + 3_600_000, () => ({ exitCode: 0, stdout: out }))
  mock.store(on as never)
  out = 'Current week (all models): 1% used · resets Nov 4 at 2:59pm (UTC)'
  await limit($ as never)
  expect(toasts.length).toBe(1)
  await limit($ as never)
  expect(toasts.length).toBe(1)
})

test('the child runs in TMPDIR (macOS) or TEMP (Windows) when set', async ($, on) => {
  const toasts: string[] = []
  const runs: Run[] = []
  base(on as never, () => 15, toasts, START + DAY + 3_600_000, () => ({ exitCode: 0, stdout: usageOut(20) }), runs, {
    HOME: '/Users/x',
    TMPDIR: '/var/folders/ab/T/',
  })
  mock.store(on as never)
  await limit($ as never)
  expect(runs[0]!.cwd).toBe('/var/folders/ab/T/')
})
