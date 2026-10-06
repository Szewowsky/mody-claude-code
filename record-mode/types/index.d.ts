export type RecordingOn = boolean

declare module 'claude-code' {
  interface PluginState {
    'record-mode': { isOn: RecordingOn }
  }
}
