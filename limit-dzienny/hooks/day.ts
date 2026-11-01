import type { Day } from '../types'

export const DAY_MS = 24 * 3_600_000
export const WEEK_MS = 7 * DAY_MS
// one day's slice of the weekly limit, in percent of the week (100/7 ≈ 14.3)
export const SLICE = 100 / 7

// The week is cut into 7 equal days counted from the weekly reset (reset Wed 14:00 = every day runs 14:00-14:00).
// Pace with carry-over: by the end of day k (0-6) you may have used (k+1)/7 of the week, so what you leave
// unused rolls into the next days. Computed from the weekly percent and the time alone, no saved state:
// usage on claude.ai or another device counts too, because the API percent already holds it.
// null when the reading is from a week that has already reset (resetsAt in the past) or has no reset time
export function dayOf(percentUsed: number, resetsAt: number | undefined, now: number): Day | null {
  if (resetsAt === undefined || !Number.isFinite(resetsAt) || resetsAt <= now) return null
  const start = resetsAt - WEEK_MS
  const index = Math.min(6, Math.max(0, Math.floor((now - start) / DAY_MS)))
  const before = index * SLICE
  const allowed = before + SLICE
  const used = Math.max(0, percentUsed)
  return {
    day: index + 1,
    used,
    allowed,
    todayPct: Math.max(0, ((used - before) / SLICE) * 100),
    spare: Math.max(0, before - used),
    left: allowed - used,
    nextDayAt: Math.min(resetsAt, start + (index + 1) * DAY_MS),
    resetsAt,
  }
}

// the warning thresholds in percent of today's slice, highest first
export const WARN_AT = [100, 80] as const

// the highest threshold crossed, or 0 under all of them
export function level(d: Day): number {
  return WARN_AT.find(t => d.todayPct >= t) ?? 0
}
