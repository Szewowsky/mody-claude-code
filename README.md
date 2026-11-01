# Mody do Claude Code

Osiem modów do Claude Code po polsku, od Roberta Szewczyka i społeczności [Operatorzy AI](https://swiy.co/operatorzyaiyt). Wszystkie na licencji MIT: instaluj, przerabiaj, wysyłaj swoje.

Mod to plugin Claude Code zbudowany z funkcji-hooków. Potrafi rysować pasek nad promptem, panel obok rozmowy, toast albo linię statusu. Potrafi też zatrzymać, przepisać albo zareagować na wywołanie narzędzia, dodać komendę `/slash` i zapytać model. Mody przeładowują się na żywo, gdy je edytujesz.

Film, w którym to wszystko pokazuję i buduję na żywo: [NOWOŚĆ w Claude Code: Mody i Jak Zrobić Własny](https://www.youtube.com/@szewowsky) (link do filmu po premierze).

| Mod | Kod | Komenda | Co robi |
| --- | --- | --- | --- |
| [pasek](#pasek) | [`pasek/`](pasek/) | `/pasek` | Pasek nad promptem: koszt, kontekst, limity 5h, dzienny i tygodniowy, licznik ciepłego cache, przyciski REC i Handoff |
| [limit-dzienny](#limit-dzienny) | [`limit-dzienny/`](limit-dzienny/) | `/limit` | Dzieli tygodniowy limit na 7 dni: ile z dzisiejszej 1/7 zjedzone, zapas i ostrzeżenia przy 80% i 100% dnia |
| [record-mode](#record-mode) | [`record-mode/`](record-mode/) | `/record on` | Zasłania na ekranie maile, klucze API, kwoty i ścieżki domowe; model dalej widzi prawdziwy tekst |
| [wytlumacz-mi](#wytlumacz-mi) | [`wytlumacz-mi/`](wytlumacz-mi/) | `/wytlumacz` | Tłumaczy po polsku, co Claude właśnie zrobił, i streszcza rozmowę po powrocie do sesji |
| [bezpiecznik](#bezpiecznik) | [`bezpiecznik/`](bezpiecznik/) | `/bezpiecznik` | `rm -rf`, `git push --force`, `DROP`, `curl \| sh` zatrzymują się i czekają na Twoje potwierdzenie |
| [cel](#cel) | [`cel/`](cel/) | `/cel`, `/goal` | Cel sesji nad promptem z czasem, promptami i postępem zadań; `/goal` ustawia go sam |
| [tetris](#tetris) | [`tetris/`](tetris/) | `/tetris` | Tetris w panelu obok, gdy Claude pracuje; rekord zostaje między sesjami |

## Instalacja

Wymaga Claude Code 2.1.287 lub nowszego. Działa w terminalu i w aplikacji desktopowej (zakładka Code).

Najszybciej przez marketplace pluginów. W sesji Claude Code:

```
/plugin marketplace add Szewowsky/mody-claude-code
/plugin install pasek@mody-claude-code
```

Zamień `pasek` na nazwę dowolnego modu z tabeli. Po instalacji wpisz `/reload-plugins` (albo zacznij nową sesję), żeby mod wystartował.

Chcesz zajrzeć do kodu albo coś przerobić? Sklonuj repo:

```bash
git clone https://github.com/Szewowsky/mody-claude-code.git ~/mody-claude-code
```

Jedna sesja, jeden mod, bez instalacji:

```bash
claude --plugin-dir ~/mody-claude-code/pasek
```

Każdy mod ma testy:

```bash
claude plugin validate ~/mody-claude-code/pasek
claude plugin test ~/mody-claude-code/pasek
```

`validate` wypisuje, co mod woła: pliki, procesy, sieć, model. Sprawdź to przed instalacją każdego cudzego modu, mojego też.

## Mody

### pasek

[Kod](./pasek) · [hooks/register.tsx](./pasek/hooks/register.tsx) · `claude --plugin-dir ~/mody-claude-code/pasek`

<!-- zrzut: screenshots/pasek.png (do zrobienia po nagraniu) -->

Dwa wiersze nad promptem: repo i branch, czas sesji, liczba promptów, koszt, ostatnia tura (czas, model, % trafień w cache), odliczanie ciepłego cache (zielony → żółty → czerwony), wskaźniki kontekstu oraz limitu 5h i tygodniowego z czasem do resetu.

- **Licznik cache.** Claude Code na subskrypcji trzyma cache promptu przez godzinę. Gdy wygaśnie, kolejna wiadomość płaci pełną cenę za cały kontekst. 5 minut przed wystygnięciem dostajesz toast.
- **Handoff.** Od 40% zajętego kontekstu pojawia się przycisk [Handoff] (w terminalu: `/pasek handoff`). Odpala dołączony skill, który zapisuje dokument przekazania w `.claude/handoff-YYYY-MM-DD_temat.md` w Twoim projekcie i daje gotowy prompt do wklejenia w nowej sesji. Próg zmienisz na czas sesji: `/pasek prog 60`, `/pasek prog off`, `/pasek prog reset`.
- **REC.** Przycisk włącza tryb nagrywania z modu `record-mode` (jeśli jest zainstalowany). Kwoty na pasku zmieniają się wtedy na `[kwota]`.
- **Wytłumacz.** Przycisk z modu `wytlumacz-mi` (jeśli jest zainstalowany) siedzi obok REC.

W aplikacji desktopowej pasek ma dwa wiersze i Clawda obok nich. W pierwszym są repo, branch, czas, prompty i koszt, a po prawej ostatnia tura i przyciski. W drugim kontekst oraz limity jako pierścienie z ikoną (chip, zegar, słońce, kalendarz), procentem i dopiskiem (`33%  ctx · 331k/1M`, `32%  5h · reset za 4h 2m`). Kolor kontekstu idzie za progiem Handoff, a po jego przekroczeniu dochodzi `⚠ granica`. Pierścień 5h pokazuje się tylko wtedy, gdy API go zgłasza (plan z samym limitem tygodniowym, np. Ultra, go nie ma). Z modem `limit-dzienny` dochodzi pierścień `dziś` (`62%  dziś · nowy dzień za 5h 30m`), a w terminalu `dziś 62%`. Gdy API nie zgłosiło limitu tygodniowego, jego pierścień jest szary z napisem `7d · brak odczytu`. Po prawej stronie siedzi animowany pixel-art Clawd w czarnych okularach, w jednej z siedmiu scen:

| Scena | Co widać |
| --- | --- |
| `plaza` | plaża o zachodzie słońca, fale i podskakująca nutka |
| `kosmos` | Clawd w hełmie astronauty, migające gwiazdy, planeta z pierścieniem i kometa |
| `nurek` | pod wodą w masce z fajką: bąbelki, rybka, koralowce i falujące wodorosty |
| `dzungla` | Clawd jak Indiana Jones: fedora, bicz, świątynia, tocząca się kula i papuga |
| `biuro` | biuro nocą: dwa monitory z przewijanym kodem, lampka, kubek z parą i miasto za oknem |
| `gory` | zima w górach: zorza, padający śnieg, ognisko, choinka i czapka z pomponem |
| `neon` | cyberpunkowe miasto w deszczu: migające neony, mokra ulica i latający samochód |

Scenę zmienisz komendą `/pasek scena <nazwa>` albo krócej `/pasek <nazwa>`. Działają też polskie znaki (`dżungla`, `góry`, `plaża`) i nazwy angielskie (`beach`, `space`, `diver`, `jungle`, `office`, `mountains`, `cyberpunk`). Samo `/pasek scena` pokazuje bieżącą scenę i listę wszystkich z opisami. `/pasek scena losowa` losuje scenę na każdym starcie sesji. Wybór zostaje na kolejne sesje. Animacja jest stabilna: przy każdym odświeżeniu paska (nowy prompt, koniec tury) Clawd dostaje ten sam obraz w tym samym miejscu, więc nie ma powodu mrugać ani zaczynać od nowa, a licznik cache nie przerysowuje już paska co 30 sekund (na desktopie pasek odświeża się sam co 5 minut). Licznik cache stoi w stopce pod polem promptu, obok etykiet trybu sesji (`cache 42 min`), i zmienia kolor: zielony powyżej 30 minut, żółty od 30 do 15, czerwony poniżej 15 i przy `cache cold`. W terminalu i VS Code pasek zostaje taki jak był.

Pasek działa sam. `record-mode` i `wytlumacz-mi` tylko dokładają do niego swoje przyciski, a `limit-dzienny` pierścień `dziś`.

### limit-dzienny

[Kod](./limit-dzienny) · [hooks/register.tsx](./limit-dzienny/hooks/register.tsx) · `claude --plugin-dir ~/mody-claude-code/limit-dzienny`

Na planie z samym limitem tygodniowym nie ma okna 5h, które pilnowało tempa. Ten mod tnie tydzień na 7 równych dni, liczonych od godziny resetu (reset w środę o 14:00 = każdy dzień trwa od 14:00 do 14:00). Każdy dzień dostaje 1/7 limitu, czyli około 14,3%.

- **Tempo z przenoszeniem.** Do końca dnia 3 wolno zużyć 3/7 tygodnia. Czego nie zużyjesz, przechodzi dalej jako zapas, który schodzi przed dzisiejszą 1/7.
- **Bez zapisanego stanu.** Wszystko wynika z % tygodnia z API i z zegara, więc liczy się też zużycie w claude.ai i na innych urządzeniach.
- **Ostrzeżenia.** Toast przy 80% i 100% limitu dnia, raz na próg dziennie, także między sesjami.
- **`/limit`** pokazuje dzień tygodnia limitu, ile zjedzone, zapas oraz kiedy nowy dzień i reset tygodnia.

Najlepiej działa z `pasek`, który rysuje pierścień `dziś`. Bez paska zostają toasty i `/limit`.

### record-mode

[Kod](./record-mode) · [hooks/register.tsx](./record-mode/hooks/register.tsx) · `claude --plugin-dir ~/mody-claude-code/record-mode`

<!-- zrzut: screenshots/record-mode.png (do zrobienia po nagraniu) -->

`/record on` maskuje na ekranie adresy e-mail, klucze API i tokeny, kwoty w dolarach i złotówkach oraz ścieżki `/Users/twoja-nazwa` (zamienia na `~`). Dotyczy wiadomości, wyników narzędzi i wyjścia komend. `/record off` wyłącza. Stan trzyma się między sesjami.

Uczciwie: to maska na **ekranie**, nie w danych. Model dalej widzi prawdziwy tekst, a transkrypt na dysku ma go bez zmian. Mod chroni przed wyciekiem na nagraniu albo podczas udostępniania ekranu, nie przed niczym innym.

### wytlumacz-mi

[Kod](./wytlumacz-mi) · [hooks/register.tsx](./wytlumacz-mi/hooks/register.tsx) · `claude --plugin-dir ~/mody-claude-code/wytlumacz-mi`

<!-- zrzut: screenshots/wytlumacz-mi.png (do zrobienia po nagraniu) -->

Dwa tryby, oba otwierają panel obok rozmowy:

- **Wytłumacz** (przycisk na pasku albo `/wytlumacz`): tłumaczy po polsku, co Claude właśnie zrobił. Krótko, od konkretu, z jednym „dlaczego” i słówkami do nauki. Dla osób, które wolą rozumieć, co się dzieje, zamiast klepać na ślepo.
- **Podsumuj** (wiersz pod paskiem, gdy wracasz do rozmowy z historią): streszcza rozmowę w 4 sekcjach - o czym rozmawialiśmy, co ustaliliśmy, na czym stanęliśmy, co dalej.

Historia wyjaśnień zapisuje się per projekt; `/wytlumacz wyczysc wszystko` ją kasuje.

**Uwaga na limit:** każde kliknięcie to osobne zapytanie do modelu (fork tej rozmowy). Jedno naraz, mod blokuje seryjne odpalanie, ale 20 kliknięć to 20 zapytań.

Na bazie [Explain It](https://github.com/ruthannbravo/explain-it) Ruth-Ann Bravo (MIT), przepisane po polsku i pod styl „na temat”.

### bezpiecznik

[Kod](./bezpiecznik) · [hooks/register.tsx](./bezpiecznik/hooks/register.tsx) · `claude --plugin-dir ~/mody-claude-code/bezpiecznik`

<!-- zrzut: screenshots/bezpiecznik.png (do zrobienia po nagraniu) -->

Zakłada hook na każde wywołanie Bash i klasyfikuje komendę, zanim ruszy. Trafienie otwiera dialog z dwiema opcjami: **Zablokuj** (domyślna) albo **Uruchom**. Zablokowana komenda wraca do Claude'a z wyjaśnieniem i zakazem obchodzenia blokady.

Zatrzymuje:

- `rm -rf` poza `node_modules`, `dist`, `build`, `.cache`, `coverage` i katalogami tymczasowymi
- `git push --force` / `-f` / `+branch`, `git reset --hard`, `git clean -f`, `git branch -D`
- `DROP` / `TRUNCATE` przez `psql`, `mysql`, `sqlite3` i inne klienty SQL; `supabase db reset`
- `vercel --prod`
- `chmod -R 777`
- `curl | sh`, `wget | bash`, `sh -c "$(curl ...)"`, `bash <(curl ...)`

`/bezpiecznik test <komenda>` pokazuje werdykt bez uruchamiania. `/bezpiecznik demo` odpala dialog na sucho. `/bezpiecznik` wypisuje reguły.

Rozbiór komend (cudzysłowy, `sudo`, `npx`, potoki, heredoc) wzięty z [launch-codes](https://github.com/OneWave-AI/claude-code-mods/tree/main/launch-codes) OneWave AI (MIT). Tam dostajesz syrenę i kod startowy; tu jedno pytanie po polsku.

### cel

[Kod](./cel) · [hooks/register.tsx](./cel/hooks/register.tsx) · `claude --plugin-dir ~/mody-claude-code/cel`

<!-- zrzut: screenshots/cel.png (do zrobienia po nagraniu) -->

`/cel wypuścić paczkę modów` przypina cel nad promptem razem z czasem od ustawienia i liczbą promptów. W aplikacji przycisk [Zrobione] (klawisz `z`) go zdejmuje, w terminalu `/cel ok`. Samo `/cel` pokazuje stan.

Działa też z wbudowanym `/goal`: `/goal testy przechodzą` ustawia cel sam (na pasku jako „Goal:”), `/goal clear` go zdejmuje, a cel zaproponowany przez Claude'a (narzędzie ProposeGoal) ląduje na pasku po Twojej zgodzie. Gdy Claude w trakcie celu zakłada zadania (TaskCreate), pasek pokazuje postęp `▰▰▰▱▱▱ 3/6`, a `/cel lista` wypisuje je z odhaczeniem. Kiedy odpalasz kilka `/goal` naraz i gubisz, który jak daleko zaszedł, to jest ten mod.

Claude też widzi cel z `/cel`: mod dokłada go jako sekcję systemowego promptu na czas sesji, więc gdy rozmowa odpływa od tematu, Claude ma to zaznaczyć jednym zdaniem. Cel z `/goal` silnik pilnuje sam, więc tam sekcja nie jest dokładana.

### tetris

[Kod](./tetris) · [hooks/register.tsx](./tetris/hooks/register.tsx) · `claude --plugin-dir ~/mody-claude-code/tetris`

<!-- zrzut: screenshots/tetris.png (do zrobienia po nagraniu) -->

`/tetris` otwiera panel z Tetrisem obok rozmowy. Sterowanie klawiszami `a` `d` (ruch), `w` (obrót), `s` (w dół), `x` (zrzut), `p` (pauza) albo przyciskami w panelu. Gdy Claude kończy turę, gra sama się pauzuje, żebyś wrócił do pracy. Rekord trzyma się między sesjami. Zupełnie bezużyteczne i o to chodzi.

## Mody w aplikacji desktopowej

W aplikacji nie ma flagi `--plugin-dir`, więc albo instalujesz przez marketplace (powyżej), albo wpisujesz ścieżki w `~/.claude/settings.json`, rozdzielone dwukropkiem:

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "~/mody-claude-code/pasek:~/mody-claude-code/bezpiecznik"
  }
}
```

Nie łącz obu sposobów dla tego samego modu, bo załaduje się dwa razy.

## Zbuduj własny mod i podrzuć

Każdy mod to trzy pliki: `.claude-plugin/plugin.json`, `hooks/hooks.json` i `hooks/register.tsx`. Zajrzyj do [`cel/`](cel/), to jeden z krótszych w tym repo, i zacznij od niego.

Masz swój mod? Otwórz pull request albo pochwal się w [Operatorach AI](https://swiy.co/operatorzyaiyt). Warunki przyjęcia: po polsku, `claude plugin validate` i `claude plugin test` na zielono, bez wysyłania danych poza komputer użytkownika bez wyraźnej informacji w opisie. Najlepsze trafiają do paczki i do kolejnego filmu.

## Licencja

MIT. Szczegóły w [LICENSE](LICENSE).
