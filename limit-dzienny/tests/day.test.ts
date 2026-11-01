import { expect, test } from 'claude-code/testing'

import { DAY_MS, SLICE, WEEK_MS, dayOf, level } from '../hooks/day'

const RESET = Date.UTC(2026, 10, 4, 14) // Wed 14:00 UTC
const START = RESET - WEEK_MS
const close = (a: number, b: number) => expect(Math.abs(a - b) < 1e-9).toBe(true)

test('first minute of the week: day 1, nothing used, next day in 24h', () => {
  const d = dayOf(0, RESET, START + 60_000)!
  expect(d.day).toBe(1)
  close(d.allowed, SLICE)
  expect(d.todayPct).toBe(0)
  expect(d.spare).toBe(0)
  expect(d.nextDayAt).toBe(START + DAY_MS)
})

test('day 1 at 10% of the week = 70% of the day', () => {
  const d = dayOf(10, RESET, START + 5 * 3_600_000)!
  close(d.todayPct, 70)
  close(d.left, SLICE - 10)
  expect(level(d)).toBe(0)
})

test('carry-over: day 3 with 20% used has a spare of ~8.6% and 0% of today eaten', () => {
  const d = dayOf(20, RESET, START + 2 * DAY_MS + 3_600_000)!
  expect(d.day).toBe(3)
  expect(d.todayPct).toBe(0)
  close(d.spare, 2 * SLICE - 20)
  close(d.left, 3 * SLICE - 20)
})

test('thresholds: 80% and 100% of the day, over the limit stays above 100', () => {
  const at = START + DAY_MS + 60_000 // day 2
  expect(level(dayOf(SLICE + 0.8 * SLICE, RESET, at)!)).toBe(80)
  expect(level(dayOf(2 * SLICE, RESET, at)!)).toBe(100)
  const over = dayOf(40, RESET, at)!
  expect(over.todayPct > 100).toBe(true)
  expect(over.left < 0).toBe(true)
  expect(level(over)).toBe(100)
})

test('last day: allowed 100%, the next day is the weekly reset', () => {
  const d = dayOf(90, RESET, RESET - 3_600_000)!
  expect(d.day).toBe(7)
  close(d.allowed, 100)
  expect(d.nextDayAt).toBe(RESET)
})

test('no reset time or a stale week: null', () => {
  expect(dayOf(10, undefined, START)).toBeNull()
  expect(dayOf(10, RESET, RESET)).toBeNull()
  expect(dayOf(10, RESET, RESET + DAY_MS)).toBeNull()
})

test('a reset more than a week away clamps to day 1', () => {
  const d = dayOf(0, RESET, START - DAY_MS)!
  expect(d.day).toBe(1)
})
