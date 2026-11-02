export type Limit = { kind: string; percentUsed: number; resetsAt?: string }
export type Usage = {
  tokens?: number
  window: number
  percent?: number
  limits: Limit[]
  usd?: number
}
export type LastTurn = { ms: number; model: string; cachePct: number }
// scena Clawda na desktopie; /pasek scena <nazwa>, zapamiętana w $.store pod kluczem 'scene'
export type Scene = 'plaza' | 'kosmos' | 'nurek' | 'dzungla' | 'biuro' | 'gory' | 'neon'
// co trzyma $.store: konkretna scena albo 'losowa' (na każdym starcie sesji losuje jedną z Scene)
export type SceneChoice = Scene | 'losowa'

// co pasek czyta z moda limit-dzienny (tylko pola, które rysuje; pełny typ w limit-dzienny/types)
// readAt: godzina ostatniej odpowiedzi API z % tygodnia (od limit-dzienny 0.2.0, starsze go nie mają)
// used/resetsAt: % tygodnia i reset, z którego limit-dzienny liczy (świeższy z nagłówka API i `claude /usage`)
export type DailyLimit = { day: number; todayPct: number; spare: number; nextDayAt: number; readAt?: number; used?: number; resetsAt?: number }

declare module 'claude-code' {
  interface PluginState {
    'pasek': {
      usage: Usage | null
      branch: string
      prompts: number
      last: LastTurn | null
      cacheAt: number | null
      tick: number
      // co 10. tick (5 min): desktopowy pasek czyta to zamiast tick, więc timer 30 s nie przerysowuje Clawda
      slow: number
      prog: number
      warnedProg: boolean
      // scena rysowana w tej sesji (null = jeszcze nie ustalona, wtedy liczy się $.store); przy 'losowa'
      // ta wylosowana na session.start; zmiana przez /pasek scena przerysowuje pasek
      scene: Scene | null
    }
    // record-mode's own value (same type as its contract); pasek only reads it for the REC mark
    'record-mode': { isOn: boolean }
    // limit-dzienny's own value; pasek only reads it for the "dziś" ring (null = mod off or no weekly reading)
    'limit-dzienny': { day: DailyLimit | null }
  }
}
