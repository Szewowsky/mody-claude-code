import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Goal, Task } from '../types'

// cel żyje w $.state (sesja), nie w zmiennej modułu: hot reload kasuje zmienne, stan zostaje
const goal = atom({ plugin: 'cel', key: 'goal' } as const, null)

const DONE = new Set(['ok', 'done', 'zrobione', 'gotowe', 'koniec', 'off', 'clear'])
const BAR = 6

function minutes(since: number, now: number) {
  return Math.max(0, Math.round((now - since) / 60_000))
}

function progress(tasks: Task[]) {
  const done = tasks.filter(t => t.status === 'completed').length
  const full = tasks.length ? Math.round((done / tasks.length) * BAR) : 0
  return { done, total: tasks.length, bar: '▰'.repeat(full) + '▱'.repeat(BAR - full) }
}

async function setGoal($: EngineInterface, text: string, source: Goal['source']) {
  const now = await $.clock.now()
  const next: Goal = { text, since: now, prompts: 0, source, tasks: [] }
  await update($, goal, () => next)
}

function summary(g: Goal, now: number) {
  const p = progress(g.tasks)
  const tasks = p.total ? `, zadania ${p.done}/${p.total}` : ''
  return `${g.text} (od ${minutes(g.since, now)} min, ${g.prompts} promptów${tasks})`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'cel',
      description: 'Cel tej sesji nad promptem: /cel <tekst> ustawia, /cel pokazuje, /cel lista wypisuje zadania, /cel ok zdejmuje. /goal ustawia go sam',
      argumentHint: '<tekst celu> | lista | ok',
    })
    return next(e)
  })

  on('command.run', { command: 'cel' }, async ($, e) => {
    const arg = e.args.trim()
    const now = await $.clock.now()
    const current = await read($, goal)
    if (arg === '') return { text: current ? `Cel: ${summary(current, now)}` : 'Brak celu. Ustaw: /cel <tekst> albo /goal <warunek>' }
    if (arg === 'lista') {
      if (!current) return { text: 'Brak celu.' }
      if (!current.tasks.length) return { text: `Cel: ${current.text}. Claude nie założył jeszcze zadań.` }
      const mark = { pending: '[ ]', in_progress: '[~]', completed: '[x]' }
      return { text: [`Cel: ${current.text}`, ...current.tasks.map(t => `${mark[t.status]} ${t.subject}`)].join('\n') }
    }
    if (DONE.has(arg.toLowerCase())) {
      if (!current) return { text: 'Nie było celu do zdjęcia.' }
      await update($, goal, () => null)
      return { text: `Zrobione: ${summary(current, now)}.` }
    }
    await setGoal($, arg, 'cel')
    return { text: `Cel ustawiony: ${arg}` }
  })

  // wbudowane /goal <warunek> ustawia cel samo; /goal clear go zdejmuje
  on('command.run', { command: 'goal' }, async ($, e, next) => {
    const arg = e.args.trim()
    if (arg === 'clear') await update($, goal, () => null)
    else if (arg !== '') await setGoal($, arg, 'goal')
    return next(e)
  })

  // Claude sam proponuje cel (ProposeGoal); gdy przeszedł, trafia na pasek
  on('tool.call', { tool: 'ProposeGoal' }, async ($, e, next) => {
    const r = await next(e)
    if (r.deny === undefined && r.isError !== true) await setGoal($, e.condition, 'goal')
    return r
  })

  // zadania, które Claude zakłada w trakcie celu, liczą się do postępu na pasku
  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const r = await next(e)
    const id = r.deny === undefined && r.result && typeof r.result === 'object' && 'task' in r.result ? String((r.result as { task: { id: string } }).task.id) : null
    if (id) await update($, goal, g => (g ? { ...g, tasks: [...g.tasks, { id, subject: e.subject, status: 'pending' as const }] } : g))
    return r
  })

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const r = await next(e)
    if (r.deny === undefined && e.status) {
      const status = e.status
      await update($, goal, g =>
        g
          ? { ...g, tasks: status === 'deleted' ? g.tasks.filter(t => t.id !== e.task_id) : g.tasks.map(t => (t.id === e.task_id ? { ...t, status } : t)) }
          : g,
      )
    }
    return r
  })

  // każdy prompt to +1, żeby na pasku było widać, ile już poszło w ten cel
  on('prompt.submit', async ($, e, next) => {
    await update($, goal, g => (g ? { ...g, prompts: g.prompts + 1 } : g))
    return next(e)
  })

  // Claude też zna cel: jedna sekcja na końcu systemowego promptu, tylko na tę sesję
  // (cel z /goal silnik już sam pilnuje, więc sekcja idzie tylko dla celu z /cel)
  on('prompt.compose', async ($, e, next) => {
    const out = await next(e)
    const g = await read($, goal)
    if (!g || g.source === 'goal') return out
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
    const p = progress(g.tasks)
    return (
      <Box flexDirection="column">
        <Box gap={1}>
          <Text color="cyan" bold>🎯 {g.source === 'goal' ? 'Goal:' : 'Cel:'}</Text>
          <Text wrap="truncate-end">{g.text}</Text>
          <Text dimColor>{minutes(g.since, now)} min · {g.prompts} prompt.</Text>
          {p.total > 0 && (
            <Text color={p.done === p.total ? 'green' : 'yellow'}>{p.bar} {p.done}/{p.total}</Text>
          )}
          {e.surface === 'desktop' ? (
            <Button key="done" label="Zrobione" hotkey="z" onPress={() => update($, goal, () => null)} />
          ) : (
            <Text dimColor>/cel ok</Text>
          )}
        </Box>
        {below}
      </Box>
    )
  })
}
