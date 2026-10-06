export type Status = { kind: 'idle' | 'writing' | 'failed'; message: string }
/** Jedno wyjaśnienie, trzymane między sesjami, żeby dało się je przeczytać ponownie. */
export type Saved = { at: number; project: string; kind?: 'now' | 'last'; label: string; text: string }

declare module 'claude-code' {
  interface PluginState {
    'wytlumacz-mi': {
      status: Status
      saved: Saved[]
      viewing: number
      hasRecap: boolean
      mode: 'now' | 'last'
      confirmClear: boolean
      learnedCount: number
    }
  }
}
