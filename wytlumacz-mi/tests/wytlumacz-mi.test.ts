import { expect, test } from "claude-code/testing";

const ANSWER = [
  "**W SKRÓCIE** - Dodałem ciemny motyw do strony.",
  "CO SIĘ STAŁO",
  "1. Otworzyłem plik ze stylami.",
  "2. Dopisałem kolory dla trybu ciemnego.",
  "DLACZEGO - Przeglądarka sama wybiera kolory według ustawień systemu.",
  "SŁÓWKA",
  "- Przełącznik - guzik włącz/wyłącz - użyty do ciemnego motywu",
  "- CSS - instrukcja wyglądu strony - tu zmieniłem kolory",
  "TERAZ ZRÓB - Nic - wszystko gotowe.",
].join("\n");

const RECAP = [
  "O CZYM ROZMAWIALIŚMY - O ciemnym motywie strony.",
  "CO USTALILIŚMY",
  "1. Motyw włącza się sam według systemu.",
  "NA CZYM STANĘLIŚMY - Kolory gotowe, brak przełącznika.",
  "CO DALEJ - Dodaj przełącznik w nagłówku.",
].join("\n");

const props = { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120 };

function harness(on: any, store: Map<string, unknown>, opts: { turns?: number } = {}) {
  on("store.get", ($: any, e: any) => ({ value: store.get(e.key) }));
  on("store.set", ($: any, e: any) => { store.set(e.key, e.value); return { value: undefined }; });
  on("prompt.submit", ($: any, e: any) => ({ text: e.text }));
  on("session.start", ($: any, e: any) => ({ cwd: e.cwd }));
  on("session.cwd", () => ({ value: "/Users/me/Projekty/strona" }));
  on("session.turns", () => ({ value: opts.turns ?? 0 }));
  on("command.register", ($: any, e: any) => ({ value: { command: e.name } }));
  on("ui.open", () => ({ value: { isPlaced: true } }));
  on("ui.render", ($: any, e: any) => h($.ui.resolve(e).Box, {}));
}

test("Wytłumacz tłumaczy bieżącą pracę po polsku i zapamiętuje słówka", {}, async ($, on) => {
  let asked = "";
  const store = new Map<string, unknown>();
  harness(on, store);
  on("model.fork", ($, e: any) => { asked = e.prompt; return { value: { isAnswered: true, text: ANSWER, usage: {} } }; });

  await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" } as any);
  await $.command.run({ command: "wytlumacz", args: "" } as any);
  await new Promise(r => setTimeout(r, 50));

  expect(asked).toContain("Nie jestem programistą");
  expect(asked).toContain("TERAZ ZRÓB");
  const last = (store.get("zapisane-wyjasnienia") as any[]).at(-1);
  expect(last.label).toBe("Ta sesja");
  expect(last.kind).toBe("now");
  expect(store.get("poznane-slowka")).toEqual(["Przełącznik", "CSS"]);
});

test("Podsumuj streszcza TĘ rozmowę (fork), bez lekcji i bez słówek", {}, async ($, on) => {
  let asked = "";
  const store = new Map<string, unknown>();
  harness(on, store);
  on("model.fork", ($, e: any) => { asked = e.prompt; return { value: { isAnswered: true, text: RECAP, usage: {} } }; });

  await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" } as any);
  await $.command.run({ command: "wytlumacz", args: "ostatnio" } as any);
  await new Promise(r => setTimeout(r, 50));

  expect(asked).toContain("w tej sesji");
  expect(asked).toContain("O CZYM ROZMAWIALIŚMY");
  expect(asked).not.toContain("SŁÓWKA");
  const last = (store.get("zapisane-wyjasnienia") as any[]).at(-1);
  expect(last).toMatchObject({ project: "strona", kind: "last", label: "Podsumowanie rozmowy" });
  expect(store.get("poznane-slowka")).toBeUndefined();
});

test("wiersz Podsumuj pokazuje się tylko w rozmowie, która ma historię", {}, async ($, on) => {
  const store = new Map<string, unknown>();
  let turns = 0;
  harness(on, store, { get turns() { return turns; } } as any);
  for (const surface of ["terminal", "desktop"] as const) {
    turns = 0;
    await $.session.start({ surface, isInteractive: true, cwd: "/work" } as any);
    let ui = await $.ui.mount({ plugin: "wytlumacz-mi", surface, component: "AbovePrompt", props } as any);
    expect(await ui.find({ key: "recap" } as any)).toBeUndefined();
    await ui.unmount();
    turns = 4;
    await $.session.start({ surface, isInteractive: true, cwd: "/work" } as any);
    ui = await $.ui.mount({ plugin: "wytlumacz-mi", surface, component: "AbovePrompt", props } as any);
    expect(await ui.find({ key: "recap" } as any)).toBeDefined();
    await ui.unmount();
  }
});

test("/wytlumacz wyczysc kasuje wybrane wpisy tylko z tego projektu", {}, async ($, on) => {
  const store = new Map<string, unknown>();
  store.set("zapisane-wyjasnienia", [
    { at: 1, project: "moj-projekt", label: "Podsumowanie: pon.", text: "x" },
    { at: 2, project: "strona", label: "Ta sesja", text: "w1" },
    { at: 3, project: "strona", label: "Podsumowanie: wt.", text: "p-stary" },
    { at: 4, project: "strona", kind: "last", label: "Podsumowanie rozmowy", text: "p-nowy" },
  ]);
  store.set("poznane-slowka", ["CSS"]);
  harness(on, store);
  await $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" } as any);

  expect((await $.command.run({ command: "wytlumacz", args: "wyczysc" } as any)).text).toContain("Co wyczyścić?");
  expect((await $.command.run({ command: "wytlumacz", args: "wyczysc podsumowania" } as any)).text).toContain("Usunąłem 2");
  expect((store.get("zapisane-wyjasnienia") as any[]).map(x => x.text)).toEqual(["x", "w1"]);
  expect((await $.command.run({ command: "wytlumacz", args: "wyczyść wszystko" } as any)).text).toContain("Usunąłem 1");
  expect((store.get("zapisane-wyjasnienia") as any[]).map(x => x.text)).toEqual(["x"]);
  expect(store.get("poznane-slowka")).toEqual(["CSS"]);
});
