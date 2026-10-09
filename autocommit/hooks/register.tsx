import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { LastRun, Mode, Proposal } from '../types'
import {
  SYSTEM,
  buildPrompt,
  cleanMessage,
  fallbackMessage,
  isExcluded,
  parsePorcelain,
  splitList,
} from './git'

type $ = EngineInterface

const isOn = atom({ plugin: 'autocommit', key: 'isOn' } as const, false)
const mode = atom({ plugin: 'autocommit', key: 'mode' } as const, 'auto')
const intervalMin = atom({ plugin: 'autocommit', key: 'intervalMin' } as const, 15)
const isHidden = atom({ plugin: 'autocommit', key: 'isHidden' } as const, false)
const isWorking = atom({ plugin: 'autocommit', key: 'isWorking' } as const, false)
const pending = atom({ plugin: 'autocommit', key: 'pending' } as const, null)
const last = atom({ plugin: 'autocommit', key: 'last' } as const, null)

const INTERVALS = [5, 10, 15, 30, 60]
const DIFF_LIMIT = 12000
// A turn that never reported its end does not hold the timer back for longer.
const TURN_GRACE_MS = 30 * 60 * 1000

const clock = (ms: number): string => {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

let model = 'haiku'
let excluded: string[] = []
let maxBytes = 25 * 1024 * 1024
let blocked: string[] = []
let timer: Timer | undefined
let turnStartedAt = 0
let isDeferred = false

async function git($: $, root: string, args: string[], timeoutMs = 30000) {
  // Literal pathspecs: a file named like ":(exclude)x" or ":/" must not widen the set.
  const r = await $.process.run(['git', '--literal-pathspecs', ...args], { cwd: root, timeoutMs })
  return { ok: r.exitCode === 0, out: r.stdout.trim(), raw: r.stdout, err: r.stderr.trim() }
}

async function report($: $, text: string, isError = false) {
  const run: LastRun = { at: await $.clock.now(), text, isError }
  await update($, last, () => run)
  $.ui.status(`autocommit: ${text}`)
  if (isError) $.ui.toast(`autocommit: ${text}`)
}

// Stops the timer after a failure so nothing piles up until it is looked at.
async function fail($: $, text: string) {
  await stop($)
  await report($, `${text} (zatrzymano)`, true)
  void $.ui.notify(text, { title: 'Auto-commit zatrzymany' })
}

async function repoRoot($: $) {
  const r = await $.process.run(['git', '--literal-pathspecs', 'rev-parse', '--show-toplevel'])
  return r.exitCode === 0 ? r.stdout.trim() : undefined
}

async function isMidOperation($: $, root: string) {
  for (const marker of ['MERGE_HEAD', 'rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD']) {
    const p = await git($, root, ['rev-parse', '--git-path', marker])
    const path = p.out.startsWith('/') ? p.out : `${root}/${p.out}`
    const found = await $.fs.stat(path).catch(() => undefined)
    if (found) return true
  }
  return false
}

// What may be committed now: every change but the excluded and oversized.
async function collect($: $, root: string) {
  const status = await git($, root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  const files: string[] = []
  const untracked: string[] = []
  const skipped: string[] = []
  for (const c of parsePorcelain(status.raw)) {
    const paths = c.from ? [c.path, c.from] : [c.path]
    if (paths.some(p => isExcluded(p, excluded))) {
      skipped.push(c.path)
      continue
    }
    const stat = await $.fs.stat(`${root}/${c.path}`).catch(() => undefined)
    if (stat && stat.kind === 'file' && stat.size > maxBytes) {
      skipped.push(c.path)
      continue
    }
    files.push(...paths)
    if (c.code === '??') untracked.push(c.path)
  }
  return { files, untracked, skipped }
}

async function propose($: $, root: string, files: string[], untracked: string[]) {
  const tracked = files.filter(f => !untracked.includes(f))
  const recent = await git($, root, ['log', '--format=%s', '-12'])
  const stat = tracked.length ? await git($, root, ['diff', 'HEAD', '--stat', '--', ...tracked]) : undefined
  const diff = tracked.length ? await git($, root, ['diff', 'HEAD', '--', ...tracked]) : undefined
  const r = await $.model.complete({
    model,
    system: SYSTEM,
    prompt: buildPrompt({
      recent: recent.out,
      stat: stat?.out ?? '',
      diff: (diff?.out ?? '').slice(0, DIFF_LIMIT),
      untracked,
    }),
    maxTokens: 200,
    timeoutMs: 60000,
  })
  const message = r.isAnswered ? cleanMessage(r.text) : ''
  return message || fallbackMessage(files)
}

async function push($: $, root: string, branch: string) {
  const upstream = await git($, root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
  if (upstream.ok) {
    const ahead = await git($, root, ['rev-list', '--count', '@{u}..HEAD'])
    if (ahead.out === '0') return { ok: true, out: '', raw: '', err: '' }
    return git($, root, ['push'], 120000)
  }
  return git($, root, ['push', '-u', 'origin', branch], 120000)
}

async function commitAndPush($: $, root: string, branch: string, message: string, files: string[]) {
  if (files.length) {
    const add = await git($, root, ['add', '-A', '--', ...files])
    if (!add.ok) return fail($, `git add: ${add.err}`)
    // Paths after -- commit only these files: anything else already in the index
    // (a .env someone staged by hand) stays out of the commit.
    const commit = await git($, root, ['commit', '-m', message, '--', ...files])
    if (!commit.ok) return fail($, `git commit: ${commit.err || commit.out}`)
  }
  const pushed = await push($, root, branch)
  if (!pushed.ok) return fail($, `push nieudany (commit został lokalnie): ${pushed.err.split('\n')[0]}`)
  await report($, files.length ? `✓ ${message}` : '✓ wypchnięto lokalne commity')
}

// One round: look at the repo and commit (auto) or leave a proposal.
async function tick($: $, isManual = false) {
  if (await read($, isWorking)) return
  const now = await $.clock.now()
  if (!isManual && turnStartedAt && now - turnStartedAt < TURN_GRACE_MS) {
    // Claude is mid-turn: half-made changes wait for the turn to end.
    isDeferred = true
    return
  }
  if (!isManual && (await read($, pending))) return
  await update($, isWorking, () => true)
  try {
    const root = await repoRoot($)
    if (!root) return await report($, 'to nie jest repozytorium git', true)
    const head = await git($, root, ['symbolic-ref', '-q', '--short', 'HEAD'])
    if (!head.ok) return await report($, 'odłączony HEAD - pomijam', true)
    const branch = head.out
    if (blocked.includes(branch)) return await report($, `gałąź ${branch} zablokowana - pomijam`)
    if (await isMidOperation($, root)) return await report($, 'trwa merge/rebase - pomijam')

    const { files, untracked, skipped } = await collect($, root)
    const note = skipped.length ? ` (pominięto: ${skipped.slice(0, 3).join(', ')}${skipped.length > 3 ? '…' : ''})` : ''
    const currentMode: Mode = await read($, mode)

    if (!files.length) {
      if (currentMode === 'auto') {
        const pushed = await push($, root, branch)
        if (!pushed.ok) return await fail($, `push nieudany: ${pushed.err.split('\n')[0]}`)
      }
      return await report($, `brak zmian${note}`)
    }

    const message = await propose($, root, files, untracked)
    if (currentMode === 'auto') {
      await commitAndPush($, root, branch, message, files)
      if (note) $.ui.toast(`autocommit${note}`)
      return
    }
    const proposal: Proposal = { message, files, skipped }
    await update($, pending, () => proposal)
    await report($, `propozycja czeka (${files.length} plików)${note}`)
    void $.ui.notify(message, { title: 'Propozycja commita' })
  } catch (err) {
    await fail($, `błąd: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    await update($, isWorking, () => false)
  }
}

async function accept($: $, message: string) {
  const proposal = await read($, pending)
  if (!proposal || (await read($, isWorking))) return
  await update($, isWorking, () => true)
  try {
    const root = await repoRoot($)
    const head = root ? await git($, root, ['symbolic-ref', '-q', '--short', 'HEAD']) : undefined
    if (!root || !head?.ok) return await fail($, 'brak repo albo odłączony HEAD')
    // The tree may have moved on since the proposal: commit what is there now.
    const { files } = await collect($, root)
    await update($, pending, () => null)
    await commitAndPush($, root, head.out, message.trim() || proposal.message, files)
  } finally {
    await update($, isWorking, () => false)
  }
}

async function start($: $) {
  timer?.cancel()
  const minutes = await read($, intervalMin)
  timer = $.clock.every(minutes * 60 * 1000, () => void tick($))
  await update($, isOn, () => true)
  $.ui.status(`autocommit: co ${minutes} min`)
}

async function stop($: $) {
  timer?.cancel()
  timer = undefined
  await update($, isOn, () => false)
}

async function setMode($: $, value: Mode) {
  await update($, mode, () => value)
  await $.store.set('mode', value)
  if (value === 'auto') await update($, pending, () => null)
}

async function setIntervalMin($: $, minutes: number) {
  await update($, intervalMin, () => minutes)
  await $.store.set('intervalMin', minutes)
  if (await read($, isOn)) await start($)
}

export const register: Register = (on, options) => {
  model = String(options.model || 'haiku')
  excluded = splitList(options.excludePatterns)
  maxBytes = Number(options.maxFileMB || 25) * 1024 * 1024
  blocked = splitList(options.blockedBranches)

  on('session.start', async ($, e, next) => {
    // Mode and interval outlive the session; the timer never starts by itself,
    // so opening another repo does not begin pushing there.
    const savedMode = await $.store.get('mode')
    if (savedMode === 'auto' || savedMode === 'propose') await update($, mode, () => savedMode)
    const savedInterval = Number(await $.store.get('intervalMin'))
    if (INTERVALS.includes(savedInterval)) await update($, intervalMin, () => savedInterval)
    if ((await $.store.get('isHidden')) === true) await update($, isHidden, () => true)

    await $.command.register({
      name: 'autocommit',
      description: 'Auto-commit + push co X minut',
      argumentHint: 'start | stop | teraz | auto | propozycja | <minuty> | ukryj | pokaż',
    })
    return next(e)
  })

  on('command.run', { command: 'autocommit' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const minutes = Number(arg)
    if (arg === 'start') await start($)
    else if (arg === 'stop') await stop($)
    else if (arg === 'teraz' || arg === 'now') void tick($, true)
    else if (arg === 'auto') await setMode($, 'auto')
    else if (arg === 'propozycja' || arg === 'propose') await setMode($, 'propose')
    else if (arg === 'ukryj' || arg === 'hide') {
      await update($, isHidden, () => true)
      await $.store.set('isHidden', true)
    } else if (arg === 'pokaż' || arg === 'pokaz' || arg === 'show') {
      await update($, isHidden, () => false)
      await $.store.set('isHidden', false)
    } else if (minutes >= 1 && minutes <= 240) await setIntervalMin($, Math.round(minutes))
    else if (arg) return { text: `Nie znam "${arg}". Użyj: start | stop | teraz | auto | propozycja | <minuty> | ukryj | pokaż` }

    const state = (await read($, isOn)) ? `włączony, co ${await read($, intervalMin)} min` : 'wyłączony'
    return { text: `Auto-commit ${state}, tryb: ${(await read($, mode)) === 'auto' ? 'auto' : 'propozycja'}.` }
  })

  on('prompt.submit', async ($, e, next) => {
    turnStartedAt = await $.clock.now()
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    turnStartedAt = 0
    if (isDeferred) {
      isDeferred = false
      if (await read($, isOn)) void tick($)
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, isHidden))) return next(e)
    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui
    // The mobile app draws no fields: there the band keeps its buttons alone.
    const Input = 'Input' in ui ? ui.Input : undefined
    const Select = 'Select' in ui ? ui.Select : undefined
    const running = await read($, isOn)
    const working = await read($, isWorking)
    const currentMode = await read($, mode)
    const minutes = await read($, intervalMin)
    const proposal = await read($, pending)
    const lastRun = await read($, last)
    const hasFields = Input !== undefined && Select !== undefined
    // Other mods' bands (usage-band, wytlumacz-mi) draw beneath this one.
    const below = await next(e)

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Text color={running ? 'success' : 'inactive'}>
            {running ? '●' : '○'} Auto-commit{running ? ` co ${minutes} min` : ''}
            {working ? ' · pracuję…' : ''}
          </Text>
          {running ? (
            <Button key="stop" label="⏹ Stop" onPress={() => void stop($)} />
          ) : (
            <Button key="start" label="▶ Start" onPress={() => void start($)} />
          )}
          <Button key="now" label="Teraz" dimColor onPress={() => void tick($, true)} />
          {hasFields && (
            <Select
              key="mode"
              label="tryb"
              value={currentMode}
              options={[
                { value: 'auto', label: 'auto' },
                { value: 'propose', label: 'propozycja' },
              ]}
              onSelect={(value: string) => void setMode($, value as Mode)}
            />
          )}
          {hasFields && (
            <Select
              key="interval"
              label="co"
              value={String(minutes)}
              options={INTERVALS.map(m => ({ value: String(m), label: `${m} min` }))}
              onSelect={(value: string) => void setIntervalMin($, Number(value))}
            />
          )}
        </Box>
        {lastRun && (
          <Text color={lastRun.isError ? 'error' : undefined} dimColor={!lastRun.isError} wrap="truncate-end">
            {clock(lastRun.at)} {lastRun.text}
          </Text>
        )}
        {proposal && (
          <Box flexDirection="column">
            <Text>
              Propozycja ({proposal.files.length} plików): <Text bold>{proposal.message}</Text>
            </Text>
            <Box flexDirection="row" gap={1}>
              <Button key="accept" label="✓ Commit & push" onPress={() => void accept($, proposal.message)} />
              <Button key="skip" label="Pomiń" dimColor onPress={() => void update($, pending, () => null)} />
              {Input !== undefined && (
                <Input
                  key="edit"
                  label="edytuj:"
                  value={proposal.message}
                  submitLabel="commit & push"
                  onSubmit={(value: string) => void accept($, value)}
                />
              )}
            </Box>
          </Box>
        )}
        {below}
      </Box>
    )
  })
}
