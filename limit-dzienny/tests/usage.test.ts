import { expect, test } from 'claude-code/testing'

import { parseUsage } from '../hooks/usage'

// the real output of `claude -p /usage` on 2026-11-02 (head)
const OUT = `You are currently using your subscription to power your Claude Code usage

Current week (all models): 27% used · resets Nov 6 at 4:59pm (Europe/Warsaw)
Current week (Fable): 4% used · resets Nov 6 at 4:59pm (Europe/Warsaw)

What's contributing to your usage?`
const NOW = new Date(2026, 10, 2, 10, 5).getTime()

test('the all-models line: percent and the reset in local time', () => {
  const r = parseUsage(OUT, NOW)!
  expect(r.percentUsed).toBe(27)
  expect(r.resetsAt).toBe(new Date(2026, 10, 6, 16, 59).getTime())
})

test('the model-scoped line alone is not the weekly limit', () => {
  expect(parseUsage('Current week (Fable): 4% used · resets Nov 6 at 4:59pm', NOW)).toBeNull()
})

test('hour without minutes, am, a decimal percent', () => {
  const r = parseUsage('Current week (all models): 3.5% used · resets Nov 9 at 9am (Europe/Warsaw)', NOW)!
  expect(r.percentUsed).toBe(3.5)
  expect(r.resetsAt).toBe(new Date(2026, 10, 9, 9, 0).getTime())
})

test('12pm is noon, 12am is midnight', () => {
  expect(parseUsage('Current week (all models): 1% used · resets Nov 5 at 12pm', NOW)!.resetsAt).toBe(new Date(2026, 10, 5, 12).getTime())
  expect(parseUsage('Current week (all models): 1% used · resets Nov 5 at 12am', NOW)!.resetsAt).toBe(new Date(2026, 10, 5, 0).getTime())
})

test('across the new year: a Jan reset seen in late December is next year', () => {
  const dec = new Date(2026, 11, 30, 12).getTime()
  expect(parseUsage('Current week (all models): 50% used · resets Jan 2 at 5pm', dec)!.resetsAt).toBe(new Date(2027, 0, 2, 17).getTime())
})

test('no reset text, or a startup notice without quota: percent only, or null', () => {
  expect(parseUsage('Current week (all models): 12% used', NOW)).toEqual({ percentUsed: 12 })
  expect(parseUsage('Claude CLI /usage is still loading usage data.', NOW)).toBeNull()
})
