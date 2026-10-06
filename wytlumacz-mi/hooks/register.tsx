// Wytłumacz mi: tłumaczy po polsku, co Claude właśnie zrobił - krótko, od
// konkretu, z jednym "dlaczego" i 2-4 słówkami do nauki (styl "Na temat + nauka").
// Na bazie Explain It (Ruth-Ann Bravo, MIT - patrz LICENSE).
// - Przycisk [Wytłumacz] siedzi na pasku zużycia (mod pasek).
// - Podsumuj streszcza rozmowę z TEJ sesji ("/wytlumacz ostatnio" albo wiersz
//   nad promptem, gdy wracasz do rozmowy, która już ma historię).
// - Każde wyjaśnienie i podsumowanie jest zapisywane per projekt: "/wytlumacz historia",
//   czyszczenie: "/wytlumacz wyczysc [wyjasnienia|podsumowania|wszystko]".
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Saved, Status } from '../types'

const PANE = 'wytlumacz-mi'
const COMMAND = 'wytlumacz'

// W $.state, nie w zmiennych, żeby przeładowanie w środku tury ich nie zgubiło.
const status = atom({ plugin: 'wytlumacz-mi', key: 'status' } as const, { kind: 'idle', message: '' })
const saved = atom({ plugin: 'wytlumacz-mi', key: 'saved' } as const, [])
const viewing = atom({ plugin: 'wytlumacz-mi', key: 'viewing' } as const, 0)
const hasRecap = atom({ plugin: 'wytlumacz-mi', key: 'hasRecap' } as const, false)
// upanel przy Podsumuj miał nagłówek i komunikat Wytłumacz mi - teraz każdy tryb ma swój
const mode = atom({ plugin: 'wytlumacz-mi', key: 'mode' } as const, 'now')
// pytanie "co wyczyścić?" w panelu, zanim cokolwiek zniknie
const confirmClear = atom({ plugin: 'wytlumacz-mi', key: 'confirmClear' } as const, false)
const learnedCount = atom({ plugin: 'wytlumacz-mi', key: 'learnedCount' } as const, 0)

// W $.store, między sesjami.
const LEARNED_KEY = 'poznane-slowka'
const SAVED_KEY = 'zapisane-wyjasnienia'

const FORMAT = `Użyj dokładnie tych nagłówków, każdy w osobnej linii, w tej kolejności:

W SKRÓCIE - jedno zdanie: co się zmieniło. Zacznij od konkretu, bez zapowiedzi.
CO SIĘ STAŁO - ponumerowane kroki (1., 2., 3.), jeden krok = jedna czynność, najwyżej 5 kroków, jedno krótkie zdanie na krok.
DLACZEGO - 1-3 zdania o mechanizmie: dlaczego zrobione właśnie tak. Nie tłumacz oczywistości.
SŁÓWKA - 2-4 prawdziwe pojęcia techniczne z tej pracy, które warto znać. Każde w osobnej linii, w formacie: pojęcie - co znaczy prostymi słowami - jak zostało tu użyte. Wybieraj najbardziej przydatne, nie najbardziej egzotyczne.
TERAZ ZRÓB - jedna rzecz do zrobienia teraz (do 2 minut) albo "Nic - wszystko gotowe."

Zasady: pisz po polsku, z polskimi znakami. Tylko krótki myślnik "-", nigdy długi. Bez wstępów, bez podsumowań na końcu, bez uprzejmości. Gdy w treści musi paść słowo techniczne, wyjaśnij je w nawiasie przy pierwszym użyciu, porównaniem z codziennego życia. Opisuj tylko to, co naprawdę się stało. Bez emoji. Najwyżej 250 słów.`

const NOW_PROMPT = `Nie jestem programistą. Wytłumacz mi, co właśnie zrobiłeś w swojej ostatniej pracy w tej rozmowie. ${FORMAT}`

// Podsumuj streszcza rozmowę (temat, ustalenia, stan), Wytłumacz tłumaczy, co się działo i dlaczego.
const RECAP_FORMAT = `Użyj dokładnie tych nagłówków, każdy w osobnej linii, w tej kolejności:

O CZYM ROZMAWIALIŚMY - 1-2 zdania: temat i cel rozmowy. Zacznij od konkretu, bez zapowiedzi.
CO USTALILIŚMY - ponumerowane punkty (1., 2., 3.), najwyżej 5: decyzje i rzeczy zrobione, jedno krótkie zdanie na punkt.
NA CZYM STANĘLIŚMY - 1-2 zdania: ostatni stan pracy i co zostało otwarte.
CO DALEJ - jedna rzecz do zrobienia teraz (do 2 minut) albo "Nic - temat zamknięty."

Zasady: pisz po polsku, z polskimi znakami. Tylko krótki myślnik "-", nigdy długi. Bez wstępów, bez podsumowań na końcu, bez uprzejmości. Nie tłumacz mechanizmów ani pojęć - to jest streszczenie rozmowy, nie lekcja. Opisuj tylko to, co naprawdę padło w rozmowie. Bez emoji. Najwyżej 200 słów.`

// streszcza rozmowę z sesji, w której kliknięto - fork widzi całą tę rozmowę
// (wcześniej składał "poprzednią sesję w projekcie" z dziennika i przy dwóch równoległych
// sesjach w jednym projekcie streszczał tę drugą)
const RECAP_PROMPT = `Podsumuj mi naszą dotychczasową rozmowę w tej sesji, żebym wiedział, gdzie jesteśmy. ${RECAP_FORMAT}`

// Nagłówki sekcji: kolejność, wygląd i rozpoznawanie w odpowiedzi modelu.
const STYLE = [
  { title: 'W SKRÓCIE', match: /^W SKR[ÓO]CIE/i, emoji: '📌', color: 'cyan' },
  { title: 'CO SIĘ STAŁO', match: /^CO SI[ĘE] STA[ŁL]O/i, emoji: '👣', color: 'yellow' },
  { title: 'DLACZEGO', match: /^DLACZEGO/i, emoji: '💡', color: 'green' },
  { title: 'SŁÓWKA', match: /^S[ŁL][ÓO]WKA/i, emoji: '📚', color: 'blue' },
  { title: 'TERAZ ZRÓB', match: /^TERAZ ZR[ÓO]B/i, emoji: '✅', color: 'magenta' },
  { title: 'O CZYM ROZMAWIALIŚMY', match: /^O CZYM ROZMAWIALI[ŚS]MY/i, emoji: '🗣️', color: 'cyan' },
  { title: 'CO USTALILIŚMY', match: /^CO USTALILI[ŚS]MY/i, emoji: '🤝', color: 'yellow' },
  { title: 'NA CZYM STANĘLIŚMY', match: /^NA CZYM STAN[ĘE]LI[ŚS]MY/i, emoji: '📍', color: 'green' },
  { title: 'CO DALEJ', match: /^CO DALEJ/i, emoji: '➡️', color: 'magenta' },
]
const FALLBACK = { title: 'Co się stało', emoji: '📝', color: 'white' }

// Dzieli wyjaśnienie na sekcje z nagłówkami.
export function sections(text: string) {
  const out: { title: string; body: string }[] = []
  for (const line of text.split('\n')) {
    const clean = line.replace(/[*#]/g, '').trim()
    const look = STYLE.find(s => s.match.test(clean))
    if (look) {
      const rest = clean.replace(look.match, '').replace(/^\s*[—–:-]?\s*/, '')
      out.push({ title: look.title, body: rest })
    } else if (out.length && clean) {
      const last = out[out.length - 1]
      last.body = last.body ? `${last.body}\n${clean}` : clean
    }
  }
  return out.length ? out : [{ title: FALLBACK.title, body: text }]
}

// Wyciąga pojęcia z sekcji SŁÓWKA.
export function newTerms(text: string) {
  const words = sections(text).find(s => s.title === 'SŁÓWKA')
  if (!words) return []
  return words.body
    .split('\n')
    .map(l => l.replace(/^[-•\d.)\s]+/, '').split(/\s[—–-]\s/)[0].trim())
    .filter(t => t.length > 0 && t.length < 40)
}

function listOf<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : []
}

function projectName(cwd: string) {
  return cwd.split('/').filter(Boolean).pop() ?? cwd
}

function when(at: number) {
  return new Date(at).toLocaleString('pl-PL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

// Już poznane słówka: używane swobodnie, bez ponownego tłumaczenia, żeby
// każde wyjaśnienie uczyło czegoś nowego.
async function learnedTerms($: EngineInterface): Promise<string[]> {
  return listOf<unknown>(await $.store.get(LEARNED_KEY)).filter((t): t is string => typeof t === 'string')
}

function withLearned(base: string, learned: string[]) {
  if (learned.length === 0) return base
  return `${base}

Pojęcia, które już znam (używaj ich swobodnie, bez tłumaczenia, i nie wybieraj ich do SŁÓWEK): ${learned.join(', ')}.`
}

// Starsze wpisy nie mają `kind`; podsumowania poznać po etykiecie.
const isRecap = (x: Saved) => (x.kind ?? (x.label.startsWith('Podsumowanie') ? 'last' : 'now')) === 'last'

// Panel i historia pokazują tylko wpisy z bieżącego projektu; $.store trzyma wszystkie.
async function savedHere($: EngineInterface, all: Saved[]) {
  const here = projectName(await $.session.cwd())
  return all.filter(x => x.project === here)
}

type ClearWhat = 'wyjasnienia' | 'podsumowania' | 'wszystko'

// Kasuje wybrane wpisy z bieżącego projektu; inne projekty i poznane słówka zostają.
async function clearHistory($: EngineInterface, what: ClearWhat) {
  const here = projectName(await $.session.cwd())
  const drop = (x: Saved) =>
    x.project === here && (what === 'wszystko' || (what === 'podsumowania') === isRecap(x))
  const stored = listOf<Saved>(await $.store.get(SAVED_KEY))
  const kept = stored.filter(x => !drop(x))
  await $.store.set(SAVED_KEY, kept)
  const all = await savedHere($, kept)
  await update($, saved, () => all)
  await update($, viewing, () => Math.max(0, all.length - 1))
  await update($, confirmClear, () => false)
  await update($, status, () => ({ kind: 'idle', message: '' }) as Status)
  return stored.length - kept.length
}

// Pisze wyjaśnienie, zapisuje je i pokazuje w panelu.
async function explain($: EngineInterface, kind: 'now' | 'last') {
  await update($, hasRecap, () => false)
  await update($, confirmClear, () => false)
  await update($, status, () => ({ kind: 'writing', message: '' }) as Status)
  await update($, mode, () => kind)
  const opened = $.ui.open({ id: PANE, title: kind === 'last' ? 'Podsumowanie' : 'Wytłumacz mi' })

  const learned = await learnedTerms($)
  const project = projectName(await $.session.cwd())
  // Fork idzie na modelu sesji i korzysta z jej cache; widzi całą tę rozmowę.
  const r = await $.model.fork({ prompt: kind === 'last' ? RECAP_PROMPT : withLearned(NOW_PROMPT, learned) })
  if (!(await opened).isPlaced) $.ui.toast('Wyjaśnienie gotowe - poszerz okno albo wpisz /wytlumacz historia')

  if (!r.isAnswered) {
    await update($, status, () => ({
      kind: 'failed',
      message: `Nie udało się wytłumaczyć (${r.reason}). Spróbuj jeszcze raz.`,
    }) as Status)
    return
  }

  const entry: Saved = { at: Date.now(), project, kind, label: kind === 'last' ? 'Podsumowanie rozmowy' : 'Ta sesja', text: r.text }
  const stored = [...listOf<Saved>(await $.store.get(SAVED_KEY)), entry].slice(-200)
  await $.store.set(SAVED_KEY, stored)
  const all = await savedHere($, stored)
  await update($, saved, () => all)
  await update($, viewing, () => all.length - 1)
  await update($, status, () => ({ kind: 'idle', message: '' }) as Status)

  if (kind === 'last') return
  const known = new Set(learned.map(t => t.toLowerCase()))
  const added = newTerms(r.text).filter(t => !known.has(t.toLowerCase()))
  if (added.length) {
    const terms = [...learned, ...added].slice(-300)
    await $.store.set(LEARNED_KEY, terms)
    await update($, learnedCount, () => terms.length)
  }
}

async function start($: EngineInterface, mode: 'now' | 'last') {
  // ~45 wywołań z rzędu = 45 zapytań do Opusa. Jedno tłumaczenie naraz.
  if ((await read($, status)).kind === 'writing') {
    $.ui.toast('Już tłumaczę - wynik pojawi się w panelu obok')
    return
  }
  explain($, mode).catch(err =>
    update($, status, () => ({ kind: 'failed', message: `Nie udało się wytłumaczyć (${String(err)}). Spróbuj jeszcze raz.` }) as Status),
  )
}

async function showHistory($: EngineInterface) {
  const all = await read($, saved)
  await update($, viewing, () => Math.max(0, all.length - 1))
  await update($, confirmClear, () => false)
  await update($, status, () => ({ kind: 'idle', message: '' }) as Status)
  await $.ui.open({ id: PANE, title: 'Wytłumacz mi' })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    const learned = await learnedTerms($)
    await update($, learnedCount, () => learned.length)
    const all = await savedHere($, listOf<Saved>(await $.store.get(SAVED_KEY)))
    await update($, saved, () => all)
    // propozycja podsumowania tylko w rozmowie, która już ma historię (np. wznowionej)
    const turns = await $.session.turns().catch(() => 0)
    await update($, hasRecap, () => turns > 0)
    await $.command.register({
      name: COMMAND,
      description: 'Wytłumacz po polsku, co Claude właśnie zrobił. "ostatnio" = podsumuj tę rozmowę, "historia" = zapisane, "wyczysc" = wyczyść historię',
      argumentHint: '[ostatnio|historia|wyczysc wyjasnienia|podsumowania|wszystko]',
    })
    return result
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const arg = (e.args ?? '').trim().toLowerCase()
    if (arg === 'historia') {
      await showHistory($)
      return { text: 'Otworzyłem zapisane wyjaśnienia.' }
    }
    if (/^wyczy[sś][cć]/.test(arg)) {
      const what = arg.split(/\s+/)[1]?.replace('ś', 's').replace('ń', 'n')
      if (what !== 'wyjasnienia' && what !== 'podsumowania' && what !== 'wszystko') {
        return { text: 'Co wyczyścić? /wytlumacz wyczysc wyjasnienia · podsumowania · wszystko (tylko ten projekt)' }
      }
      const n = await clearHistory($, what)
      return { text: `Usunąłem ${n} ${what === 'wszystko' ? 'wpisów' : what} z tego projektu.` }
    }
    const kind = arg === 'ostatnio' ? 'last' : 'now'
    if ((await read($, status)).kind === 'writing') return { text: 'Już tłumaczę - wynik pojawi się w panelu obok.' }
    void start($, kind)
    return { text: kind === 'last' ? 'Podsumowuję tę rozmowę w panelu obok.' : 'Tłumaczę w panelu obok.' }
  })

  // pierwsza wiadomość w rozmowie chowa propozycję podsumowania
  on('prompt.submit', async ($, e, next) => {
    await update($, hasRecap, () => false)
    return next(e)
  })

  // Mała propozycja nad promptem: podsumuj tę rozmowę.
  // Wiersz dokładany NAD tym, co rysują mody poniżej (np. pasek zużycia), zamiast go zastępować.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    let row = null
    // "Wytłumacz" żyje jako przycisk na pasku zużycia (mod pasek); tu zostaje tylko propozycja podsumowania
    if (await read($, hasRecap)) {
      row = (
        <Box key="wytlumacz-row" flexDirection="row" columnGap={1}>
          <Text color="green">📝 Wracasz do rozmowy? Podsumować, na czym stanęliśmy?</Text>
          <Button key="recap" label="Podsumuj" hotkey="p" onPress={() => void start($, 'last')} />
          <Button key="dismiss" label="Nie, dzięki" onPress={() => update($, hasRecap, () => false)} />
        </Box>
      )
    }
    const below = await next(e)
    if (!row) return below
    return (
      <Box flexDirection="column">
        {row}
        {below}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const s = await read($, status)
    const all = await read($, saved)
    const i = Math.min(await read($, viewing), all.length - 1)
    const shown = all[i]
    // Cienka linia między sekcjami, tak szeroka, jak pozwala panel.
    // Terminal rysuje ─ na szerokość jednej litery, desktop szerzej,
    // więc tam ta sama linia potrzebuje ich mniej, żeby zmieścić się w wierszu.
    const width = (e.viewport?.columns ?? 40) - 6
    const rule = '─'.repeat(Math.max(10, Math.min(e.surface === 'terminal' ? 40 : 22, width)))
    const clearRow = (await read($, confirmClear)) ? (
      <Box flexDirection="column" marginTop={1}>
        <Text color="red">Co wyczyścić z tego projektu? Tego nie da się cofnąć.</Text>
        <Box flexDirection="row" columnGap={1}>
          <Button key="clear-now" label="Wyjaśnienia" onPress={() => void clearHistory($, 'wyjasnienia')} />
          <Button key="clear-last" label="Podsumowania" onPress={() => void clearHistory($, 'podsumowania')} />
          <Button key="clear-all" label="Wszystko" onPress={() => void clearHistory($, 'wszystko')} />
          <Button key="clear-cancel" label="Anuluj" onPress={() => update($, confirmClear, () => false)} />
        </Box>
      </Box>
    ) : null
    const clearButton = <Button key="clear" label="🗑️ Wyczyść" dimColor onPress={() => update($, confirmClear, () => true)} />

    if (s.kind !== 'idle' || !shown) {
      const recap = (await read($, mode)) === 'last'
      return (
        <Box flexDirection="column" padding={1}>
          <Text bold color={recap ? 'green' : 'cyan'}>{recap ? '📝 Podsumowanie rozmowy' : '🧩 Wytłumacz mi'}</Text>
          <Text dimColor>
            {s.kind === 'writing'
              ? recap
                ? '🗂️ Streszczam tę rozmowę…'
                : '✨ Tłumaczę na ludzki…'
              : s.kind === 'failed'
                ? s.message
                : 'Jeszcze nic tu nie ma. Kliknij Wytłumacz na pasku albo wpisz /wytlumacz ostatnio, żeby podsumować tę rozmowę.'}
          </Text>
          {all.length > 0 && (
            <Box flexDirection="row" columnGap={1}>
              <Button key="history" label="📖 Zapisane" onPress={() => void showHistory($)} />
              {clearButton}
            </Box>
          )}
          {clearRow}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" paddingX={1}>
        <Text bold color={isRecap(shown) ? 'green' : 'cyan'}>
          {isRecap(shown) ? '📝' : '🧩'} {shown.label}
        </Text>
        <Box marginBottom={1}><Text dimColor>
          {shown.project} · {when(shown.at)} · {i + 1} z {all.length}
        </Text></Box>
        {sections(shown.text).map(({ title, body }, n) => {
          const look = STYLE.find(st => st.title === title) ?? FALLBACK
          return (
            <Box key={`s${n}`} flexDirection="column">
              {n > 0 && <Text dimColor>{rule}</Text>}
              <Text bold color={look.color}>{look.emoji} {title}</Text>
              <Box marginBottom={1}><Text>{body}</Text></Box>
            </Box>
          )
        })}
        <Text dimColor>📚 Poznane słówka: {await read($, learnedCount)}</Text>
        <Box>
          {i > 0 && <Button key="older" label="◀ Starsze" onPress={() => update($, viewing, v => Math.max(0, v - 1))} />}
          {i < all.length - 1 && (
            <Button key="newer" label="Nowsze ▶" onPress={() => update($, viewing, v => Math.min(all.length - 1, v + 1))} />
          )}
          <Button key="again" label="🔄 Wytłumacz ostatnie" onPress={() => void start($, 'now')} />
          {clearButton}
        </Box>
        {clearRow}
      </Box>
    )
  })
}
