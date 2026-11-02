// dzień tygodniowego limitu: tydzień od resetu pocięty na 7 równych dni, tempo z przenoszeniem
export type Day = {
  // 1-7, który dzień tygodnia limitu
  day: number
  // % tygodnia zużyte (z API)
  used: number
  // % tygodnia, które wolno zużyć do końca dzisiejszego dnia ((day)/7)
  allowed: number
  // ile z dzisiejszej 1/7 już zjedzone (0 przy zapasie, >100 ponad limit dnia)
  todayPct: number
  // zapas z poprzednich dni, w % tygodnia (0, gdy go nie ma)
  spare: number
  // ile % tygodnia jeszcze wolno dziś (ujemne ponad limit dnia)
  left: number
  // kiedy zaczyna się następny dzień (ms), ostatniego dnia = reset tygodnia
  nextDayAt: number
  resetsAt: number
  // kiedy przyszła ostatnia odpowiedź API z % tygodnia (koniec tury albo przesunięcie limitu o punkt), ms;
  // claude.ai liczy na bieżąco, sesja widzi zmianę dopiero w nagłówku swojej kolejnej odpowiedzi
  readAt?: number
}

declare module 'claude-code' {
  interface PluginState {
    'limit-dzienny': {
      // stan dnia do narysowania (pasek go czyta), null = brak odczytu tygodnia
      day: Day | null
      // klucz dnia (reset tygodnia + numer dnia) i najwyższy próg, o którym już był toast
      warned: { key: string; level: number } | null
    }
  }
}
