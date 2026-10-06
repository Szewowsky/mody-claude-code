import type { EngineInterface, Register } from 'claude-code'

import { RULES, classify } from './classify'

const short = (command: string) => (command.length > 70 ? `${command.slice(0, 67)}...` : command)

const RUN = 'Uruchom'
const BLOCK = 'Zablokuj'

/** Pyta użytkownika w dialogu Claude Code; każde czekanie to wywołanie `$`, więc nie zjada budżetu hooka. */
const confirm = async ($: EngineInterface, command: string, reason: string) => {
  try {
    const answer = await $.ui.ask(`Bezpiecznik: ${reason}. Uruchomić \`${short(command)}\`?`, {
      header: 'Bezpiecznik',
      options: [BLOCK, RUN],
    })
    return answer === RUN ? { isRun: true, why: 'potwierdzone' } : { isRun: false, why: 'użytkownik wybrał Zablokuj' }
  } catch {
    return { isRun: false, why: 'nikt nie potwierdził (dialog zamknięty albo sesja bez użytkownika)' }
  }
}

const deny = (command: string, reason: string, why: string) => ({
  deny:
    `bezpiecznik: zablokowałem \`${short(command)}\` (${reason}), bo ${why}. ` +
    'Nie próbuj ponownie ani nie obchodź tej blokady. Powiedz użytkownikowi, co chciałeś zrobić i po co, ' +
    'i zapytaj, jak postąpić, albo znajdź bezpieczniejszą drogę.',
})

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'bezpiecznik',
      description: 'Lista reguł bezpiecznika; test <komenda> pokazuje werdykt bez uruchamiania; demo odpala dialog na sucho',
      argumentHint: '[test <komenda> | demo]',
    })
    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const danger = classify(e.command)
    if (!danger) return next(e)
    const verdict = await confirm($, e.command, danger.reason)
    if (!verdict.isRun) {
      $.ui.toast(`Bezpiecznik zablokował: ${short(e.command)}`, { timeoutMs: 8000 })
      return deny(e.command, danger.reason, verdict.why)
    }
    return next(e)
  })
    // hook, który padł, nie może przepuścić komendy
    .catch(($, e) => {
      const danger = classify(e.command)
      return danger ? deny(e.command, danger.reason, 'sprawdzenie się nie powiodło') : { deny: 'bezpiecznik: sprawdzenie się nie powiodło; zapytaj użytkownika, zanim spróbujesz ponownie.' }
    })

  on('command.run', { command: 'bezpiecznik' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg.startsWith('test ')) {
      const danger = classify(arg.slice(5))
      return { text: danger ? `Zatrzyma się: ${danger.reason}.` : 'Przejdzie bez pytania.' }
    }
    if (arg === 'demo') {
      const command = 'rm -rf ~/Projekty/kopia-prod && git push --force origin main'
      const verdict = await confirm($, command, classify(command)!.reason)
      return { text: verdict.isRun ? 'Demo: puszczone. (Nic nie uruchomiono, to było demo.)' : `Demo: zablokowane, ${verdict.why}. Nic nie uruchomiono.` }
    }
    return { text: ['Bezpiecznik zatrzymuje i pyta przy:', ...RULES.map(r => `- ${r}`), '', 'Użycie: /bezpiecznik test <komenda> · /bezpiecznik demo'].join('\n') }
  })
}
