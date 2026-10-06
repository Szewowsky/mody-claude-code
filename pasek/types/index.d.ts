export type Limit = { kind: string; percentUsed: number; resetsAt?: string }
export type Usage = {
  tokens?: number
  window: number
  percent?: number
  limits: Limit[]
  usd?: number
}
export type LastTurn = { ms: number; model: string; cachePct: number }

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
    }
  }
}
