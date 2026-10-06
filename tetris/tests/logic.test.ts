import { expect, test } from 'claude-code/testing'

import { H, W, fits, hardDrop, lock, move, newGame, spawn, turn } from '../hooks/logic'

test('piece falls, locks and a full row clears for 100 points', () => {
  const g = newGame()
  // fill the bottom row except the 4 cells an I piece will land on
  g.board[H - 1] = Array.from({ length: W }, (_, x) => (x >= 3 && x <= 6 ? null : 'red'))
  const i = { ...spawn(0), x: 3 }
  const done = hardDrop({ ...g, piece: i })
  expect(done.lines).toBe(1)
  expect(done.board[H - 1]!.every(c => c === null)).toBe(true)
  expect(done.score).toBeGreaterThanOrEqual(100)
})

test('walls block moves and rotation kicks off the wall', () => {
  let g = newGame()
  for (let n = 0; n < 12; n++) g = move(g, -1, 0)
  expect(g.piece.x).toBe(0)
  expect(fits(g.board, turn(g).piece)).toBe(true)
})

test('a full stack ends the game', () => {
  const g = newGame()
  g.board = g.board.map(() => Array.from({ length: W }, (_, x) => (x === 0 ? null : 'red')))
  expect(lock(g).isOver).toBe(true)
})
