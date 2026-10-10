export type Limit = { kind: string; percentUsed: number; resetsAt?: string }
export type Usage = {
  tokens?: number
  window: number
  percent?: number
  limits: Limit[]
  usd?: number
}
export type LastTurn = { ms: number; model: string; cachePct: number }
// scena Clawda na desktopie; /pasek scena plaza|kosmos, zapamiętana w $.store pod kluczem 'scene'
export type Scene = 'plaza' | 'kosmos'

declare module 'claude-code' {
  interface PluginState {
    'pasek': {
      usage: Usage | null
      branch: string
      prompts: number
      last: LastTurn | null
      cacheAt: number | null
      tick: number
      prog: number
      warnedProg: boolean
      // kopia sceny ze $.store na tę sesję (null = jeszcze nie wczytana), żeby zmiana przerysowała pasek
      scene: Scene | null
    }
    // record-mode's own value (same type as its contract); pasek only reads it for the REC mark
    'record-mode': { isOn: boolean }
  }
}
