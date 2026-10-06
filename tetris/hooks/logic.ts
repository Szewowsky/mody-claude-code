export const W = 10
export const H = 20

import type { TetrisCell as Cell, TetrisGame as Game, TetrisPiece as Piece } from '../types'

export type { Cell, Game, Piece }

const SHAPES: [number[][], string][] = [
  [[[1, 1, 1, 1]], 'cyan'],
  [[[1, 1], [1, 1]], 'yellow'],
  [[[0, 1, 0], [1, 1, 1]], 'magenta'],
  [[[1, 0, 0], [1, 1, 1]], 'blue'],
  [[[0, 0, 1], [1, 1, 1]], 'white'],
  [[[0, 1, 1], [1, 1, 0]], 'green'],
  [[[1, 1, 0], [0, 1, 1]], 'red'],
].map(([s, c]) => [s as number[][], c as string])

// Math.random bag-less picks; a 7-bag if streaks of one piece annoy
export const rand = () => Math.floor(Math.random() * SHAPES.length)

export function spawn(i: number): Piece {
  const [shape, color] = SHAPES[i]!
  return { shape, color, x: Math.floor((W - shape[0]!.length) / 2), y: 0 }
}

export function fits(board: Cell[][], p: Piece): boolean {
  return p.shape.every((row, dy) =>
    row.every((v, dx) => {
      if (!v) return true
      const x = p.x + dx
      const y = p.y + dy
      return x >= 0 && x < W && y < H && (y < 0 || board[y]![x] === null)
    }),
  )
}

export const rotate = (s: number[][]) => s[0]!.map((_, i) => s.map(r => r[i]!).reverse())

export function newGame(): Game {
  return {
    board: Array.from({ length: H }, () => Array<Cell>(W).fill(null)),
    piece: spawn(rand()),
    next: rand(),
    score: 0,
    lines: 0,
    isOver: false,
    isPaused: false,
  }
}

export const level = (g: Game) => 1 + Math.floor(g.lines / 10)
// 100 ms timer ticks per row: 800 ms at level 1, never under 100 ms
export const dropTicks = (g: Game) => Math.max(1, 8 - (level(g) - 1))

const POINTS = [0, 100, 300, 500, 800]

// Locks the piece, clears full rows, spawns the next one.
export function lock(g: Game): Game {
  const board = g.board.map(r => [...r])
  g.piece.shape.forEach((row, dy) =>
    row.forEach((v, dx) => {
      if (v && g.piece.y + dy >= 0) board[g.piece.y + dy]![g.piece.x + dx] = g.piece.color
    }),
  )
  const kept = board.filter(r => r.some(c => c === null))
  const cleared = H - kept.length
  const full = [...Array.from({ length: cleared }, () => Array<Cell>(W).fill(null)), ...kept]
  const piece = spawn(g.next)
  return {
    ...g,
    board: full,
    piece,
    next: rand(),
    lines: g.lines + cleared,
    score: g.score + POINTS[cleared]! * level(g),
    isOver: !fits(full, piece),
  }
}

export function move(g: Game, dx: number, dy: number): Game {
  const p = { ...g.piece, x: g.piece.x + dx, y: g.piece.y + dy }
  if (fits(g.board, p)) return { ...g, piece: p }
  return dy > 0 ? lock(g) : g
}

export function turn(g: Game): Game {
  const shape = rotate(g.piece.shape)
  for (const kick of [0, -1, 1, -2, 2]) {
    const p = { ...g.piece, shape, x: g.piece.x + kick }
    if (fits(g.board, p)) return { ...g, piece: p }
  }
  return g
}

export function hardDrop(g: Game): Game {
  let p = g.piece
  while (fits(g.board, { ...p, y: p.y + 1 })) p = { ...p, y: p.y + 1 }
  return lock({ ...g, piece: p, score: g.score + 2 * (p.y - g.piece.y) })
}
