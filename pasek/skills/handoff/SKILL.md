---
name: handoff
description: Zapisuje dokument przekazania (handoff) tej rozmowy w projekcie, żeby nowa sesja Claude Code mogła podjąć pracę od następnego kroku. Odpalany przyciskiem [Handoff] na pasku albo komendą /pasek handoff.
argument-hint: "Nad czym ma pracować nowa sesja?"
disable-model-invocation: true
---

Napisz po polsku dokument przekazania tej rozmowy, tak żeby świeża sesja mogła kontynuować pracę bez czytania historii.

Zapisz go w projekcie, nie w katalogu tymczasowym: `<cwd>/.claude/handoff-YYYY-MM-DD_<krótki-slug-tematu>.md` (utwórz katalog `.claude`, jeśli go nie ma). Datę weź z dzisiejszej daty.

Dokument ma sekcje:
1. **Cel** - co próbujemy osiągnąć, jednym akapitem.
2. **Zrobione** - lista z dowodami (ścieżki plików, komendy, wyniki testów).
3. **Następny krok** - jedna konkretna czynność do wykonania jako pierwsza.
4. **Blokery i decyzje** - co czeka na użytkownika, jakie decyzje już zapadły (żeby ich nie wałkować od nowa).
5. **Pliki i skille** - ścieżki, które trzeba przeczytać, i skille, które warto wywołać.

Nie powtarzaj treści, które są już w innych artefaktach (plany, specyfikacje, commity, diffy) - wskaż je ścieżką lub linkiem.

Usuń dane wrażliwe: klucze API, hasła, adresy e-mail, dane osobowe.

Jeśli użytkownik podał argumenty, potraktuj je jako opis tego, na czym ma się skupić nowa sesja, i dopasuj dokument.

Na samym końcu wypisz w osobnym bloku kodu gotowy prompt po polsku do wklejenia w nowej sesji: ma podać pełną ścieżkę do tego pliku, kazać go przeczytać w całości i kontynuować od sekcji „Następny krok”.
