import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Goal, Task } from '../types'
import { observeRow } from './rows'

// cel żyje w $.state (sesja), nie w zmiennej modułu: hot reload kasuje zmienne, stan zostaje
const goal = atom({ plugin: 'cel', key: 'goal' } as const, null)
// ostatnie komunikaty silnika ze słowem goal: do strojenia wykrywania końca celu (/cel debug)
const notices = atom({ plugin: 'cel', key: 'notices' } as const, [] as string[])


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
  const next: Goal = { text, since: now, prompts: 0, source, tasks: [], now: null, stage: null, isWorking: false }
  await update($, goal, () => next)
}

// krótka etykieta tego, co Claude właśnie woła: narzędzie + najważniejszy argument
function label(e: { tool: string } & Record<string, unknown>) {
  const cut = (v: unknown, n = 60) => (typeof v === 'string' ? (v.length > n ? v.slice(0, n - 1) + '…' : v) : '')
  const base = (v: unknown) => cut(typeof v === 'string' ? v.split('/').pop() : '', 40)
  switch (e.tool) {
    case 'Bash': return `Bash: ${cut(e.description ?? e.command)}`
    case 'Edit': case 'Write': case 'Read': case 'NotebookEdit': return `${e.tool}: ${base(e.file_path)}`
    case 'Grep': case 'Glob': return `${e.tool}: ${cut(e.pattern, 40)}`
    case 'Agent': return `Agent: ${cut(e.description)}`
    case 'WebFetch': return `WebFetch: ${cut(e.url, 50)}`
    case 'WebSearch': return `WebSearch: ${cut(e.query, 50)}`
    case 'TaskCreate': return `zadanie: ${cut(e.subject, 50)}`
    default: return e.tool.replace(/^mcp__[^_]+__/, 'MCP: ')
  }
}

// co pokazać w wierszu "teraz": zadanie w toku, inaczej ostatnie narzędzie, inaczej czekanie na plan
function nowLine(g: Goal) {
  const active = g.tasks.find(t => t.status === 'in_progress')
  if (active) return { text: `▶ ${active.subject}`, color: 'yellow' as const }
  if (g.isWorking && g.now) return { text: `▶ ${g.now}`, color: 'yellow' as const }
  if (g.tasks.length === 0) return { text: g.isWorking ? '… czeka na plan zadań' : '… bezczynny, bez planu zadań', color: undefined }
  const p = progress(g.tasks)
  return { text: p.done === p.total ? '✔ wszystkie zadania odhaczone' : `… bezczynny, ${p.done}/${p.total} zadań`, color: p.done === p.total ? ('green' as const) : undefined }
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
    if (arg === 'debug') {
      const n = await read($, notices)
      return { text: n.length ? ['Ostatnie komunikaty silnika o celu:', ...n.map(x => `- ${x}`)].join('\n') : 'Silnik nie pokazał jeszcze komunikatu ze słowem goal.' }
    }
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

  // każde wywołanie narzędzia w trakcie celu to "teraz" na pasku (tylko główna sesja, nie sub-agenci)
  on('tool.call', async ($, e, next) => {
    if (e.agentId === undefined) await update($, goal, g => (g ? { ...g, now: label(e as never), isWorking: true } : g))
    return next(e)
  })

  // każdy prompt to +1, żeby na pasku było widać, ile już poszło w ten cel
  on('prompt.submit', async ($, e, next) => {
    await update($, goal, g => (g ? { ...g, prompts: g.prompts + 1, isWorking: true } : g))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) await update($, goal, g => (g ? { ...g, isWorking: false, now: null } : g))
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

  // silnik ogłasza spełnienie celu notatką (wiersz systemowy) w transkrypcie: wtedy cel z /goal schodzi z paska sam
  // (render jest czysty, więc nasłuch idzie na session.append, gdzie wolno pisać do stanu)
  on('session.append', async ($, e, next) => {
    const v = observeRow(e as never)
    if (v.stage) await update($, goal, g => (g ? { ...g, stage: v.stage } : g))
    if (v.notice) await update($, notices, n => [...n.slice(-9), v.notice!])
    if (v.isGoalOver) await update($, goal, g => (g && g.source === 'goal' ? null : g))
    return next(e)
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
        {g.stage && (
          <Box paddingLeft={3}>
            <Text>Etap: {g.stage}</Text>
          </Box>
        )}
        <Box paddingLeft={3}>
          <Text color={nowLine(g).color} dimColor={nowLine(g).color === undefined}>{nowLine(g).text}</Text>
        </Box>
        {below}
      </Box>
    )
  })
}
