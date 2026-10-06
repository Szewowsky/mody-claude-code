export type TetrisCell = string | null
export type TetrisPiece = { shape: number[][]; color: string; x: number; y: number }
export type TetrisGame = {
  board: TetrisCell[][]
  piece: TetrisPiece
  next: number
  score: number
  lines: number
  isOver: boolean
  isPaused: boolean
}

declare module 'claude-code' {
  interface PluginState {
    tetris: { best: number; game: TetrisGame | null }
  }
}
