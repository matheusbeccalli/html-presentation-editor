# Slide Background Colour Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give one slide its own solid background colour (Design > Background > Slide Background, and right-click), with
Reset to Theme and an Apply to All that goes through the theme's Background.

**Architecture:** A new module `src/js/background.js` (`App.background`) owns reading and writing a slide's background.
A slide's own colour is an inline `background-color` (+ `background-image: none`) on its `<section class="slide">`;
"follows the theme" means no inline background, backed by a small `<style data-deck-background>` rule only for decks
whose CSS does not already paint slides with `var(--color-bg)`. The ribbon control reuses
`App.textControls.colorSplit`; Apply to All writes `--color-bg` through `App.theme.applyValues`.

**Tech Stack:** plain ES2020 browser JS (IIFE modules on `App`), Python build (`build.py`), unit tests in
`tests/unit/*.test.js` (run in `tests/run-tests.html`), Playwright e2e in `tests/e2e_test.py`.

**Spec:** `docs/superpowers/specs/2026-11-13-slide-background-design.md`

## Global Constraints

- Solid colour only; no pictures, no gradients, no text recolouring.
- Offline, Edge only, no new libraries (SPEC 2).
- Each user action is exactly one undo step: one slide → `{ slideId }` scope; anything touching `<head>` or several
  slides → `'deck'` scope.
- A theme colour picked for one slide is stored as `var(--color-…)` (stays linked); Apply to All writes the colour's
  `#rrggbb` into `--color-bg`.
- Labels (exact): group `Background`; button `Slide Background`; menu items `Reset to Theme`, `Apply to All`;
  command for right-click `Format Background…`; undo labels `Slide background`, `Reset slide background`,
  `Background to all slides`.
- Per step routine (memory): TDD, `python3 build.py`, full `python3 tests/run_tests.py` in the background, look at
  screenshots, FEATURES.md (feature line ticked with a note, hand check `[ ]`, never tick hand checks / Done-when),
  `tests/edge/handchecks.py` entry, ARCHITECTURE.md, stage FEATURES.md with only own lines, commit + push to main.

## Review Focus

1. **Imported (Copilot) deck, Reset to Theme / Apply to All:** its slides carry inline backgrounds from normalize and its
   CSS may never use `--color-bg`; after Reset / Apply to All the slide's computed background must equal the resolved
   `--color-bg` → Task 1 e2e on `MESSY`.
2. **New slide after Apply to All on an imported deck** must match the others, not the deck's old `.slide` colour →
   Task 1 e2e (`App.slides.add()` after `applyToAll`).
3. **Slide with an imported gradient** (`background-image` inline): picking a colour must show the colour, not the
   gradient → Task 1 unit test (`background-image: none` written).
4. **Undo of Apply to All** restores every slide's own colour and the old theme value in one Ctrl+Z → Task 2 e2e.
5. **Theme-linked colour follows Edit Theme** (`var(--color-accent)` on a slide, then theme Accent changed) → Task 2 e2e.

---

### Task 1: `App.background` — read, set, reset, apply to all

**Files:**
- Create: `src/js/background.js`
- Modify: `src/js/theme.js` (export `hexOf` as `App.theme.hexOf(doc, value)`; keep the local name working)
- Modify: `src/index.html` (`<!-- INLINE-JS: js/background.js -->` right after `js/theme.js`), `tests/run-tests.html`
  (`<script src="../src/js/background.js">` and `<script src="unit/background.test.js">`, same order)
- Test: `tests/unit/background.test.js`, `tests/e2e_test.py` (`test_slide_background_imported_deck`, add to `TESTS`)

**Interfaces:**
- Produces:
  - `App.background.ownColor(slide) -> string|null` — the inline `background-color` exactly as written
    (`'var(--color-accent)'`, `'#ff0000'`, `'rgb(…)'`), or `null` when the slide follows the theme (no inline
    background, or inline `var(--color-bg)`).
  - `App.background.writeOwn(slide, value)` — pure DOM: sets `background-color: value; background-image: none` inline,
    removes `background-size/position/repeat` and any `background` shorthand. Other inline properties untouched.
  - `App.background.clearOwn(slide)` — pure DOM: removes all inline `background*` properties.
  - `App.background.followsThemeByCss(doc) -> boolean` — appends a probe `<section class="slide" data-editor-only>` to
    `doc.body`, compares its computed `backgroundColor` / `backgroundImage` with a probe painted `var(--color-bg)`,
    removes both. `true` when they match and image is `none`.
  - `App.background.ensureThemeRule(doc)` — if `!followsThemeByCss(doc)`, inserts
    `<style data-deck-background>html body section.slide { background-color: var(--color-bg); background-image: none; }</style>`
    at the same place `App.theme.write` puts its block (before the editor's `data-deck-*` styles). Idempotent.
  - `App.background.setColor(value)` — current slide; `history.change('Slide background', { slideId }, …)` → `writeOwn`.
  - `App.background.reset()` — current slide; scope `'deck'` if `ensureThemeRule` will add the rule, else `{ slideId }`;
    `clearOwn`, `ensureThemeRule`, and if the slide still doesn't resolve to `--color-bg`, `writeOwn(slide, 'var(--color-bg)')`.
  - `App.background.applyToAll(value)` — `history.change('Background to all slides', 'deck', …)`:
    `App.theme.applyValues(doc, { '--color-bg': App.theme.hexOf(doc, value) })`, `clearOwn` on every
    `section.slide`, `ensureThemeRule(doc)`; same per-slide `var(--color-bg)` fallback as `reset`.
  - `App.background.canEdit() -> boolean` — `App.state.hasDeck && !!App.deck.getCurrentSlide()`.
- Consumes: `App.history.change`, `App.deck.getDocument/getCurrentSlide`, `App.theme.applyValues`, `App.theme.hexOf`.

- [ ] **Step 1: Write the failing unit tests** (`tests/unit/background.test.js`, detached docs via `parseDoc`)

```js
test('background: a slide with no inline background follows the theme', () => {
    const doc = parseDoc('<section class="slide" style="left: 0px"></section>');
    assertEqual(App.background.ownColor(doc.querySelector('section')), null);
});
test('background: an own colour is written inline and replaces an imported gradient', () => {
    const doc = parseDoc('<section class="slide" style="background-image: linear-gradient(red, blue); background-size: cover"></section>');
    const slide = doc.querySelector('section');
    App.background.writeOwn(slide, 'var(--color-accent)');
    assertEqual(App.background.ownColor(slide), 'var(--color-accent)');
    assertEqual(slide.style.backgroundImage, 'none');
    assertEqual(slide.style.backgroundSize, '');
});
test('background: inline var(--color-bg) counts as following the theme', () => {
    const doc = parseDoc('<section class="slide" style="background-color: var(--color-bg)"></section>');
    assertEqual(App.background.ownColor(doc.querySelector('section')), null);
});
test('background: clearOwn removes every background property and nothing else', () => {
    const doc = parseDoc('<section class="slide" style="background: red; color: blue"></section>');
    const slide = doc.querySelector('section');
    App.background.clearOwn(slide);
    assertEqual(slide.getAttribute('style').trim(), 'color: blue;');
});
```

- [ ] **Step 2: Write the failing e2e test `test_slide_background_imported_deck`** on `MESSY` (opened through the
  import flow the other MESSY tests use). Via `page.evaluate` on `App.background`:
  - `reset()` on slide 1 → slide 1 computed `backgroundColor` == computed probe of `var(--color-bg)` (resolve with
    `App.theme.hexOf`); `undoLabel()` == `'Reset slide background'`.
  - `applyToAll('#00843D')` → every `section.slide` computed `backgroundColor == 'rgb(0, 132, 61)'`, no inline
    `background-color` except `var(--color-bg)` fallbacks; `App.slides.add()` → the new slide is `rgb(0, 132, 61)`.
  - One Ctrl+Z (after the add's own undo) → every slide back to its imported colour (compare with values read before).

- [ ] **Step 3: Run to see them fail**

Run: `python3 build.py && python3 tests/run_tests.py` (background; wait for the notification)
Expected: the 4 unit tests and `test_slide_background_imported_deck` FAIL (`App.background` undefined).

- [ ] **Step 4: Implement `background.js` and the `App.theme.hexOf` export** (header comment in the style of the other
  modules: what, approach, "Talks to:"). `ownColor` treats `var(--color-bg)` (any spacing) as `null`.

- [ ] **Step 5: Run the full suite** — same command. Expected: all green (counts in the progress note).

- [ ] **Step 6: Commit** (no FEATURES line yet; ARCHITECTURE.md row for `background.js` + flow line now)

```bash
git add src/js/background.js src/js/theme.js src/index.html tests/run-tests.html tests/unit/background.test.js tests/e2e_test.py ARCHITECTURE.md dist/editor.html
git commit -m "feat(background): per-slide background colour, reset and apply to all"
```

---

### Task 2: The control — Design tab, colour menu, right-click, docs

**Files:**
- Modify: `src/js/background.js` (`App.background.create(name)` for control `'slideBackground'`, `App.background.openMenu()`)
- Modify: `src/js/textcontrols.js` — `colorSplit` spec gains optional `themeNames(doc) -> [names]` (used instead of
  `App.text.themeColorNames(doc)` in `openColorMenu`); export `App.textControls.openColorMenuFor(menuClass)` (finds the
  registered button with that `menuClass`, opens its menu under its main part)
- Modify: `src/js/ribbon.js` — Design tab gets group `{ label: 'Background', commands: [{ control: 'slideBackground' }] }`
  after Theme; `App.background.create(name)` added to the `create` chain (line ~258); export `App.ribbon.selectTab(id)`;
  Design tab `note` gains one sentence on Slide Background
- Modify: `src/js/commands.js` — `slideBackground`: label `Format Background…`, `isEnabled: App.background.canEdit`,
  `run: App.background.openMenu`
- Modify: `src/js/contextmenu.js` — `EMPTY_SLIDE_ITEMS = ['paste', '-', 'slideBackground']`;
  `src/js/thumbnails.js` — `SLIDE_ITEMS` gets `'-', 'slideBackground'` at the end
- Modify: `src/js/icons.js` — icon `slideBackground` (a slide outline with a filled corner, 20×20 like the others)
- Test: `tests/e2e_test.py` (`test_slide_background`, add to `TESTS`); docs: `FEATURES.md`, `ARCHITECTURE.md`,
  `tests/edge/handchecks.py`

**Interfaces:**
- Consumes: everything Task 1 produces; `App.textControls.colorSplit(spec)` (spec documented at textcontrols.js:322).
- Produces: control `slideBackground`, command `slideBackground`, menu class `slide-background-menu`.
- colorSplit spec for the control: `{ label: 'Slide Background', icon: 'slideBackground', menuClass:
  'slide-background-menu', palette: 'theme', themeNames: (doc) => ['--color-bg'].concat(App.text.themeColorNames(doc))
  (`--color-bg` only when the deck declares it), extras: [['Reset to Theme', 'reset'], ['Apply to All', 'all']],
  current: () => App.background.ownColor(slide) || 'var(--color-bg)', choose: value === 'reset' → reset(),
  'all' → applyToAll(current()), else setColor(value), isEnabled: App.background.canEdit }` — no `command`, so the main
  part opens the menu too.
- `openMenu()`: `App.ribbon.selectTab('design')`, then `App.textControls.openColorMenuFor('slide-background-menu')`.

- [ ] **Step 1: Write the failing e2e test `test_slide_background`** on `CONTRACT`:
  - Design tab: `button[aria-label='Slide Background']` enabled; open menu, it lists `Reset to Theme`, `Apply to All`,
    a `Background` swatch first under Theme colors.
  - Slide 2, pick Accent swatch → slide 2 computed bg `rgb(31, 42, 68)`, slide 1 unchanged `rgb(255, 255, 255)`;
    inline `background-color` is `var(--color-accent)`; `undoLabel() == 'Slide background'`; the button's bar shows it;
    the slide 2 thumbnail repainted (thumbnail section computed bg).
  - Edit Theme: Accent `#0070C0`, Apply → slide 2 `rgb(0, 112, 192)` (Review Focus 5). Ctrl+Z ×2 → white again.
  - Pick a standard red, then `Reset to Theme` → `ownColor` null, white, label `Reset slide background`.
  - Slide 3 red, then `Apply to All` with More colors… value `#00843D` (set via `App.background.applyToAll` if the
    native picker can't be driven) → all slides `rgb(0, 132, 61)`, `--color-bg` `#00843d`, one Ctrl+Z → slide 3 red
    again and `--color-bg` `#fff` (Review Focus 4); Ctrl+Y.
  - Right-click empty slide area: context menu has `Format Background…`; click it → Design tab selected and
    `.slide-background-menu` open. Right-click a thumbnail: same item present.
  - Save to `OUTPUT / 'slide-background.html'`, reopen: the colours as before; PPTX plan of slide 2 (the same
    `readSlide` path `test_pptx_export_text` uses) has `background.hex` of the slide's colour.
  - Screenshot `OUTPUT / '9x-slide-background.png'` (next free number) with the menu open.

- [ ] **Step 2: Run to see it fail** — `python3 build.py && python3 tests/run_tests.py`. Expected: `test_slide_background`
  FAILS (no control).

- [ ] **Step 3: Implement** the textcontrols spec option + export, ribbon group + `selectTab` export, command, both
  context-menu lists, icon, `App.background.create/openMenu`.

- [ ] **Step 4: Run the full suite**; look at the new screenshot. Expected: all green.

- [ ] **Step 5: Docs.** FEATURES.md: new section at the end, `## Extras (after the SPEC phases)`, with
  `- [x] Slide background colour, per slide *(…short note…)*` and its hand check
  `  - [ ] Slide background: open samples/contract-deck.html, slide 2, Design > Slide Background ▾ > Accent: …; Reset to
  Theme; Apply to All with a red: every slide red, a new slide (Ctrl+M) red too, one Ctrl+Z; right-click a thumbnail >
  Format Background…; Save, reopen; export to PowerPoint: slide 2's background in PowerPoint`.
  `tests/edge/handchecks.py`: `{"key": "Slide background:", "tests": ["test_slide_background", "test_slide_background_imported_deck"], "auto": False, "left": "the colour as PowerPoint shows it"}`.
  ARCHITECTURE.md: flow line for the control.

- [ ] **Step 6: Commit and push** (FEATURES.md staged with only these lines, per the commit rules)

```bash
git add src/js/background.js src/js/textcontrols.js src/js/ribbon.js src/js/commands.js src/js/contextmenu.js src/js/thumbnails.js src/js/icons.js tests/e2e_test.py tests/edge/handchecks.py ARCHITECTURE.md dist/editor.html
git commit -m "feat(background): Slide Background on the Design tab and the right-click menus"
git push
```
