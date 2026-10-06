import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { type Game, H, dropTicks, hardDrop, level, move, newGame, spawn, turn } from './logic'

const PANE = 'tetris'
const EMPTY = '#2a2a2a'
const best = atom({ plugin: 'tetris', key: 'best' } as const, 0)
const game = atom({ plugin: 'tetris', key: 'game' } as const, null)

// The board is drawn from plain Text and Buttons in the hooks module: the desktop refuses
// to load a Client surface module (CSP, "did not load within 10s"), so no Client here.
let ticks = 0
let isRecorded = false

async function act($: EngineInterface, fn: (g: Game) => Game) {
  const g = await read($, game)
  if (!g) return
  const out = fn(g)
  await update($, game, () => out)
  if (out.isOver && !isRecorded) {
    isRecorded = true
    if (out.score > (await read($, best))) {
      await update($, best, () => out.score)
      await $.store.set('best', out.score)
      $.ui.toast(`Nowy rekord Tetrisa: ${out.score}`)
    }
  }
}

const playing = (fn: (g: Game) => Game) => (g: Game) => (g.isOver || g.isPaused ? g : fn(g))

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const out = await next(e)
    await $.command.register({ name: 'tetris', description: 'Pograj w Tetrisa, kiedy Claude pracuje' })
    const stored = Number((await $.store.get('best')) ?? 0)
    await update($, best, () => stored)
    // gravity: one timer for the module's life; it writes state only when a row drops
    $.clock.every(100, async () => {
      const g = await read($, game)
      if (!g || g.isOver || g.isPaused) return
      ticks += 1
      if (ticks >= dropTicks(g)) {
        ticks = 0
        await act($, x => move(x, 0, 1))
      }
    })
    return out
  })

  on('command.run', { command: 'tetris' }, async $ => {
    const g = await read($, game)
    if (!g || g.isOver) {
      isRecorded = false
      await update($, game, () => newGame())
    }
    await $.ui.open({ id: PANE, title: 'Tetris', focus: true })
    return { text: 'Tetris otwarty: a/d ruch, w obrót, s w dół, x zrzut, p pauza, r nowa gra.' }
  })

  on('turn.complete', async ($, e, next) => {
    const g = await read($, game)
    if (e.agentId === undefined && g && !g.isOver && !g.isPaused) {
      await update($, game, () => ({ ...g, isPaused: true }))
      $.ui.toast('Claude skończył - Tetris zapauzowany (p wznawia)', { timeoutMs: 8000 })
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const g = await read($, game)
    const top = await read($, best)
    if (!g) return <Text dimColor>Wpisz /tetris, żeby zacząć.</Text>

    const grid = g.board.map(r => [...r])
    g.piece.shape.forEach((row, dy) =>
      row.forEach((v, dx) => {
        const y = g.piece.y + dy
        if (v && y >= 0 && y < H) grid[y]![g.piece.x + dx] = g.piece.color
      }),
    )
    const next = spawn(g.next)

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" columnGap={2}>
          <Box flexDirection="column" borderStyle="round">
            {grid.map(row => (
              // empty cells use the same glyph as full ones: the desktop font draws ' ·' narrower than '██'
              <Text>{row.map(c => <Text color={c ?? EMPTY}>██</Text>)}</Text>
            ))}
          </Box>
          <Box flexDirection="column">
            <Text bold>TETRIS</Text>
            <Text>score {g.score}</Text>
            <Text>lines {g.lines}</Text>
            <Text>level {level(g)}</Text>
            <Text dimColor>best {Math.max(top, g.score)}</Text>
            <Text> </Text>
            <Text dimColor>next</Text>
            {next.shape.map(r => (
              <Text>{r.map(v => <Text color={v ? next.color : 'black'}>██</Text>)}</Text>
            ))}
            <Text> </Text>
            {g.isOver && (
              <Text color="red" bold>
                GAME OVER
              </Text>
            )}
            {g.isPaused && !g.isOver && (
              <Text color="yellow" bold>
                PAUZA
              </Text>
            )}
          </Box>
        </Box>
        <Box flexDirection="row" columnGap={1} flexWrap="wrap">
          <Button key="left" label="←" hotkey="a" onPress={() => void act($, playing(x => move(x, -1, 0)))} />
          <Button key="rot" label="↻" hotkey="w" onPress={() => void act($, playing(turn))} />
          <Button key="right" label="→" hotkey="d" onPress={() => void act($, playing(x => move(x, 1, 0)))} />
          <Button key="down" label="↓" hotkey="s" onPress={() => void act($, playing(x => ({ ...move(x, 0, 1), score: x.score + 1 })))} />
          <Button key="drop" label="zrzut" hotkey="x" onPress={() => void act($, playing(hardDrop))} />
          <Button key="pause" label={g.isPaused ? 'graj' : 'pauza'} hotkey="p" onPress={() => void act($, x => (x.isOver ? x : { ...x, isPaused: !x.isPaused }))} />
          <Button
            key="new"
            label="nowa"
            hotkey="r"
            onPress={() => {
              isRecorded = false
              void update($, game, () => newGame())
            }}
          />
        </Box>
      </Box>
    )
  })
}
