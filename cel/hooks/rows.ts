/** Czysta analiza wierszy transkryptu (session.append): etap z wypowiedzi Claude'a, komunikaty silnika o celu. */

export type Row = { door?: string; agentId?: string; message: { type?: string; content?: unknown } }

// komunikat silnika, że cel został spełniony albo zdjęty; wzorzec do strojenia po /cel debug
export const GOAL_OVER = /\bgoal\b.*\b(met|reached|achieved|satisfied|complete[d]?|done|cleared|removed)\b|\b(met|cleared)\b.*\bgoal\b|cel\b.*\b(spełnion|osiągnięt|zdjęt)/i

export function rowText(message: Row['message']) {
  const c = message.content
  const blocks = Array.isArray(c) ? c : typeof c === 'string' ? [{ type: 'text', text: c }] : []
  return (blocks as { type?: string; text?: string }[]).filter(b => b.type === 'text').map(b => b.text ?? '').join(' ')
}

/** Pierwsze zdanie wypowiedzi Claude'a, bez markdownu, przycięte do 90 znaków. */
export function firstSentence(text: string) {
  const clean = text.replace(/```[\s\S]*?```/g, ' ').replace(/[*_`#>|]/g, '').replace(/\s+/g, ' ').trim()
  const m = /^(.*?[.!?:])(\s|$)/.exec(clean)
  const s = (m ? m[1]! : clean).trim()
  if (!s) return null
  return s.length > 90 ? s.slice(0, 89) + '…' : s
}

export type RowVerdict = { stage: string | null; notice: string | null; isGoalOver: boolean }

/** Co wiersz wnosi do paska: nowy etap, komunikat o celu do dziennika, koniec celu. */
export function observeRow(e: Row): RowVerdict {
  const none: RowVerdict = { stage: null, notice: null, isGoalOver: false }
  if (e.agentId !== undefined) return none
  const text = rowText(e.message)
  const m = e.message
  if (e.door === 'response' && m.type === 'assistant' && text.trim()) return { ...none, stage: firstSentence(text) }
  if (m.type === 'system' && (e.door === 'notice' || e.door === 'note') && /\bgoal\b|\bcel\b/i.test(text)) {
    return { stage: null, notice: text.slice(0, 200), isGoalOver: GOAL_OVER.test(text) }
  }
  return none
}
