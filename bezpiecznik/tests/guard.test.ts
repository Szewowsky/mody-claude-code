import { expect, test } from 'claude-code/testing'

type World = { answer: string | null; ran: string[]; toasts: string[] }

function base(on: never, w: World) {
  const o = on as (...a: unknown[]) => void
  o('ui.toast', ($: unknown, e: { text: string }) => {
    w.toasts.push(e.text)
    return { value: undefined } as never
  })
  // $.ui.ask to tool.call na AskUserQuestion; odpowiedź wraca w result.answers pod treścią pytania
  o('tool.call', ($: unknown, e: { tool: string; command?: string; questions?: { question: string }[] }) => {
    if (e.tool === 'AskUserQuestion') {
      if (w.answer === null) throw new Error('dialog zamknięty')
      return { result: { answers: { [e.questions![0]!.question]: w.answer } }, text: w.answer } as never
    }
    w.ran.push(e.command!)
    return { result: 'ok', text: 'ok' } as never
  })
  o('session.start', () => ({ cwd: '/x' }) as never)
  o('command.register', () => ({ value: undefined }) as never)
}

const DANGER = 'git push --force origin main'
const SAFE = 'git status'

test('Uruchom puszcza komendę, Zablokuj i zamknięty dialog ją odrzucają', async ($, on) => {
  const w: World = { answer: 'Uruchom', ran: [], toasts: [] }
  base(on as never, w)
  await $.tool.call({ tool: 'Bash', command: DANGER } as never)
  expect(w.ran).toEqual([DANGER])

  for (const answer of ['Zablokuj', null]) {
    w.answer = answer
    w.ran = []
    w.toasts = []
    const r = (await $.tool.call({ tool: 'Bash', command: DANGER } as never)) as { deny?: string; text?: string }
    expect(w.ran).toEqual([])
    expect(r.deny ?? r.text).toMatch(/bezpiecznik: zablokowałem/)
    expect(r.deny ?? r.text).toMatch(/Nie próbuj ponownie/)
    expect(w.toasts.length).toBe(1)
  }
})

test('zwykła komenda przechodzi bez dialogu', async ($, on) => {
  const w: World = { answer: null, ran: [], toasts: [] }
  base(on as never, w)
  await $.tool.call({ tool: 'Bash', command: SAFE } as never)
  expect(w.ran).toEqual([SAFE])
  expect(w.toasts).toEqual([])
})

test('/bezpiecznik test i lista reguł', async ($, on) => {
  const w: World = { answer: null, ran: [], toasts: [] }
  base(on as never, w)
  await $.session.start({ cwd: '/x', surface: 'desktop', isInteractive: true } as never)
  expect((await $.command.run({ command: 'bezpiecznik', args: 'test rm -rf ~/Projekty' } as never)).text).toMatch(/Zatrzyma się: rm -rf/)
  expect((await $.command.run({ command: 'bezpiecznik', args: 'test ls -la' } as never)).text).toMatch(/Przejdzie bez pytania/)
  expect((await $.command.run({ command: 'bezpiecznik', args: '' } as never)).text).toMatch(/git push --force/)
  expect((await $.command.run({ command: 'bezpiecznik', args: 'demo' } as never)).text).toMatch(/Demo: zablokowane/)
  expect(w.ran).toEqual([])
})
