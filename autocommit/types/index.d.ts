export type Mode = 'auto' | 'propose'

export type Proposal = { message: string; files: string[]; skipped: string[] }

export type LastRun = { at: number; text: string; isError: boolean }

declare module 'claude-code' {
  interface PluginState {
    autocommit: {
      isOn: boolean
      mode: Mode
      intervalMin: number
      isHidden: boolean
      isWorking: boolean
      pending: Proposal | null
      last: LastRun | null
    }
  }
}
