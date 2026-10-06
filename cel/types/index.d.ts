export type Task = { id: string; subject: string; status: 'pending' | 'in_progress' | 'completed' }
export type Goal = { text: string; since: number; prompts: number; source: 'cel' | 'goal'; tasks: Task[] }

declare module 'claude-code' {
  interface PluginState {
    cel: { goal: Goal | null }
  }
}
