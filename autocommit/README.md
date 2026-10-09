# autocommit - mod Claude Code

Pasek nad promptem: co X minut sprawdza zmiany w repo, prosi model o wiadomość commita (`type(scope): opis`, po polsku, w stylu ostatnich commitów) i commituje + pushuje.

```
● Auto-commit co 15 min · za 7 min   [⏹ Stop] [Teraz]  tryb: auto ▾  co: 15 min ▾
14:05 ✓ content(codex-sdk): poprawki opisu filmu
```

## Tryby

- **auto** (domyślny) - commit + push bez pytania. Wypycha też lokalne commity, które czekają na push.
- **propozycja** - pokazuje wiadomość i przyciski `✓ Commit & push` / `Pomiń` / pole `edytuj:` (Enter = commit z poprawioną wiadomością). Plus systemowe powiadomienie. Kolejne rundy czekają, aż zdecydujesz.

Pasek i linia statusu na dole odliczają minuty do następnej rundy. Po `/reload-plugins` włączony timer leci dalej; nowa sesja zaczyna z wyłączonym.

Przełączasz w pasku (`tryb`) albo komendą. Tryb i interwał są pamiętane między sesjami. Sam timer **nigdy nie startuje sam** - zawsze `▶ Start`, żeby nie zaczął pushować w innym projekcie.

## Komenda

`/autocommit start | stop | teraz | auto | propozycja | <minuty> | ukryj | pokaż`

## Zabezpieczenia

- Nigdy nie commituje `.env`, `.env.*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_rsa*`, `id_ed25519*`, `credentials.json`, `token.json` (lista w `/config` → autocommit).
- Pomija pliki większe niż 25 MB (konfigurowalne).
- Commituje tylko konkretne pliki ze `git status` (`git commit -- <pliki>`): to, co ktoś wcześniej zastage'ował ręcznie, zostaje poza commitem. Ścieżki są dosłowne (`--literal-pathspecs`), więc nazwa pliku nie poszerzy zakresu. `.gitignore` działa normalnie.
- Nie rusza repo w trakcie merge/rebase/cherry-pick ani na odłączonym HEAD.
- Zatwierdzona propozycja commituje tylko pliki, które na niej były: plik dodany później czeka do następnej rundy. Kliknięcie przechodzi te same blokady co runda, a po zmianie gałęzi propozycja czeka.
- Gdy Claude akurat pracuje (tura w toku), runda czeka do końca tury - nie łapie połowicznych zmian.
- Błąd (np. push odrzucony, bo zdalne repo jest do przodu) = timer się zatrzymuje + powiadomienie. Commit zostaje lokalnie.
- Opcjonalnie: gałęzie zablokowane (`blockedBranches`, np. `main`).
- Pasek przepuszcza paski innych modów (usage-band, wytlumacz-mi) - rysują się pod nim.

## Instalacja

W sesji Claude Code:

```
/plugin marketplace add Szewowsky/mody-claude-code
/plugin install autocommit@mody-claude-code
/reload-plugins
```

Instalacja w zasięgu użytkownika daje przycisk w każdym projekcie, ale timer w żadnym nie rusza bez `▶ Start`.

Model do wiadomości: domyślnie `haiku` z effortem `medium` (tanio, szybko) - zmiana w `/plugin configure autocommit@mody-claude-code`.

Skąd model wie, co napisać:
- **diff** zmienionych plików i **początek treści nowych plików** (pierwsze 40 linii) - to „co”,
- **kontekst sesji** - ostatnie prośby i pierwsze zdania odpowiedzi - to „po co”. Tylko dla plików, które ta sesja sama zapisała (Write/Edit); plik dopisany przez skrypt albo ręcznie dostaje opis z samego diffu,
- ostatnie commity z repo służą wyłącznie jako wzór formatu.

## Rozwój

```bash
claude plugin validate autocommit
claude plugin test autocommit   # 16 testów
```
