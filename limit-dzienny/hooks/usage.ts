// `claude -p /usage` reads the account's weekly limit live (the same figure as claude.ai), where the API
// headers a session gets lag until its own next request. This parses its line:
//   Current week (all models): 27% used · resets Nov 6 at 4:59pm (Europe/Warsaw)

export type CliReading = { percentUsed: number; resetsAt?: number }

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const LINE = /Current week \(all models\):\s*(\d+(?:\.\d+)?)%\s*used(?:\s*·\s*resets\s+([A-Za-z]{3})[a-z]*\s+(\d{1,2})\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm))?/i

// the reset is printed in the machine's own time zone, without a year: the nearest such date ahead
// (a week back at most, for a reading taken just after the reset)
function resetTime(mon: string, day: string, hour: string, min: string | undefined, ampm: string, now: number) {
  const m = MONTHS.indexOf(mon.toLowerCase())
  if (m < 0) return undefined
  const h = (Number(hour) % 12) + (ampm.toLowerCase() === 'pm' ? 12 : 0)
  const year = new Date(now).getFullYear()
  for (const y of [year - 1, year, year + 1]) {
    const t = new Date(y, m, Number(day), h, Number(min ?? 0)).getTime()
    if (t > now - 7 * 24 * 3_600_000 && t < now + 8 * 24 * 3_600_000) return t
  }
  return undefined
}

export function parseUsage(out: string, now: number): CliReading | null {
  const hit = LINE.exec(out)
  if (!hit) return null
  const [, pct, mon, day, hour, min, ampm] = hit
  const resetsAt = mon && day && hour && ampm ? resetTime(mon, day, hour, min, ampm, now) : undefined
  return resetsAt === undefined ? { percentUsed: Number(pct) } : { percentUsed: Number(pct), resetsAt }
}

export const USAGE_ARGV = ['claude', '-p', '/usage', '--no-session-persistence', '--strict-mcp-config', '--setting-sources', 'project'] as const
// set in the child: its own copy of this mod (if any loads) must not start another /usage
export const CHILD_ENV = 'LIMIT_DZIENNY_CHILD'
