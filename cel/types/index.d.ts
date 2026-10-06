export type Goal = { text: string; since: number; prompts: number }

declare module 'claude-code' {
  interface PluginState {
    cel: { goal: Goal | null }
  }
}
