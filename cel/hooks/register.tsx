import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Goal } from '../types'

// cel żyje w $.state (sesja), nie w zmiennej modułu: hot reload kasuje zmienne, stan zostaje
const goal = atom({ plugin: 'cel', key: 'goal' } as const, null)

const DONE = new Set(['ok', 'done', 'zrobione', 'gotowe', 'koniec', 'off'])

function minutes(since: number, now: number) {
  return Math.max(0, Math.round((now - since) / 60_000))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'cel',
      description: 'Cel tej sesji nad promptem: /cel <tekst> ustawia, /cel pokazuje, /cel ok zdejmuje',
      argumentHint: '<tekst celu> | ok',
    })
    return next(e)
  })

  on('command.run', { command: 'cel' }, async ($, e) => {
    const arg = e.args.trim()
    const now = await $.clock.now()
    const current = await read($, goal)
    if (arg === '') {
      return { text: current ? `Cel: ${current.text} (od ${minutes(current.since, now)} min, ${current.prompts} promptów)` : 'Brak celu. Ustaw: /cel <tekst>' }
    }
    if (DONE.has(arg.toLowerCase())) {
      if (!current) return { text: 'Nie było celu do zdjęcia.' }
      await update($, goal, () => null)
      return { text: `Zrobione: ${current.text} (${minutes(current.since, now)} min, ${current.prompts} promptów).` }
    }
    const next: Goal = { text: arg, since: now, prompts: 0 }
    await update($, goal, () => next)
    return { text: `Cel ustawiony: ${arg}` }
  })

  // każdy prompt to +1, żeby na pasku było widać, ile już poszło w ten cel
  on('prompt.submit', async ($, e, next) => {
    await update($, goal, g => (g ? { ...g, prompts: g.prompts + 1 } : g))
    return next(e)
  })

  // Claude też zna cel: jedna sekcja na końcu systemowego promptu, tylko na tę sesję
  on('prompt.compose', async ($, e, next) => {
    const out = await next(e)
    const g = await read($, goal)
    if (!g) return out
    return {
      ...out,
      sections: [
        ...out.sections,
        {
          id: 'cel',
          scope: 'session' as const,
          text: `Cel tej sesji (ustawiony przez użytkownika komendą /cel): ${g.text}. Gdy proponujesz kolejny krok, trzymaj się tego celu; gdy prośba od niego odchodzi, zaznacz to jednym zdaniem.`,
        },
      ],
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const g = await read($, goal)
    if (!g || e.props.hasSurvey) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const now = await $.clock.now()
    const below = await next(e)
    return (
      <Box flexDirection="column">
        <Box gap={1}>
          <Text color="cyan" bold>🎯 Cel:</Text>
          <Text wrap="truncate-end">{g.text}</Text>
          <Text dimColor>{minutes(g.since, now)} min · {g.prompts} prompt.</Text>
          {e.surface === 'desktop' ? (
            <Button key="done" label="Zrobione" onPress={() => update($, goal, () => null)} />
          ) : (
            <Text dimColor>/cel ok</Text>
          )}
        </Box>
        {below}
      </Box>
    )
  })
}
