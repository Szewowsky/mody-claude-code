import { expect, test } from 'claude-code/testing'

import { hardDrop, newGame, rotate, spawn } from '../hooks/logic'

const cells = (s: number[][]) => s.flat().filter(Boolean).length

test('every piece, white L included, has 4 cells in all 4 rotations', () => {
  for (let i = 0; i < 7; i++) {
    let s = spawn(i).shape
    for (let r = 0; r < 4; r++) {
      expect(cells(s)).toBe(4)
      s = rotate(s)
    }
  }
})

test('a dropped white piece leaves exactly 4 white cells on the board', () => {
  const white = spawn(4)
  expect(white.color).toBe('white')
  const g = hardDrop({ ...newGame(), piece: white })
  expect(g.board.flat().filter(c => c === 'white').length).toBe(4)
})
