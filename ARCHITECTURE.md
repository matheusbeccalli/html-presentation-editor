# ARCHITECTURE — how the editor fits together

One-page map of the code (SPEC 8.1). Updated whenever a module is added or its role changes.

## The big picture

```text
src/index.html + src/css/*.css + src/js/*.js + src/player/*  ──build.py──►  dist/editor.html  (the only deliverable)
```

- **No ES modules** (Chromium blocks them on `file://`), so every JS file adds its part to one global
  object, `window.App` (`App.history`, `App.deck` …). The load order is listed once, in `src/index.html`.
- Each file wraps its private helpers in `(function () { … })();` so their names don't leak into other files.
- **The deck lives in an iframe** (`#deck-frame`, `sandbox="allow-same-origin"`, no `allow-scripts`).
  The editor's code reads and edits that iframe's DOM; nothing inside the deck can run. That DOM is the
  single source of truth: thumbnails, saving and undo all read from it.
- **Everything the editor adds to the deck is marked** so `serialize.js` can strip it on save:
  `data-editor-only` elements, `data-editor-*` attributes, `editor-*` classes, `contenteditable`.

## Modules (src/js, in load order)

| File | Role | Talks to |
| --- | --- | --- |
| `app.js` | Creates `App`, `App.start()` wires the modules together | all |
| `util.js` | Pure helpers: px↔inch, scaling px values, escaping, ids, debounce, `el()` | — |
| `events.js` | Tiny publish/subscribe bus (`App.events.on/emit`) | — |
| `shortcuts.js` | The one key → command registry; ignores keys while typing | commands |
| `history.js` | Undo/redo by HTML snapshots of a slide (or the whole deck); dirty tracking | deck (via `getDoc`) |
| `charts.js` | Chart JSON → SVG. **Phase 1: placeholder only** | importer |
| `template.js` | The blank deck for File > New | fileio |
| `importer.js` | Parse, sanitize (scripts, handlers), find blocked/missing refs, detect slides, run the import | normalize, charts |
| `normalize.js` | Measures the deck in a hidden iframe and rebuilds it in the contract format | importer |
| `serialize.js` | Clean copy of the deck + player script/CSS → the saved file's text | fileio |
| `icons.js` | Inline SVG icons | ribbon, ui, dialogs |
| `dialogs.js` | `<dialog>`-based alert/confirm and the import report | commands |
| `deck.js` | Loads the deck into the canvas iframe; current slide; editor-only view CSS | shortcuts, fileio |
| `canvas.js` | Fit-to-window zoom of the 1280×720 stage; overlay layer for handles (Phase 2) | deck |
| `thumbnails.js` | Slide rail; one small sandboxed iframe per slide, drawn lazily, refreshed debounced | deck, history events |
| `fileio.js` | Open (picker / input / drag-drop), Save, Save As, download fallback, close warning | importer, deck, serialize, history |
| `commands.js` | Every user action by name; one place that reports errors | fileio, history, deck |
| `ribbon.js` | File menu and tabs; buttons only name commands | commands |
| `ui.js` | Title bar, status bar, notes, welcome screen, busy/drop overlays, "use Edge or Chrome" banner | events |

`src/player/player.js` + `player.css` are **not run by the editor**. They are copied into every saved deck
so it presents (arrow keys, F = full screen, hidden slides skipped) and prints one slide per page on its own.

## How a user action flows

**Opening a deck** (Ctrl+O, the welcome button, or a dropped file)

```text
keydown → shortcuts.js → commands.run('open') → fileio.open → showOpenFilePicker (keeps the handle)
  → importer.importDeck(text)
      sanitize → findExternalRefs → detectSlides → normalize.run (hidden iframe: measure, rebuild) → charts.renderMissing
  → deck.load(html) → iframe srcdoc → 'deck-loaded' event → thumbnails rebuild, title/status update
  → history.reset (+ markDirty if the import changed anything) → dialogs.showImportReport
```

**Changing the deck** (Phase 1: "Remove blocked references"; later every edit)

```text
button → commands.run(name) → history.change(label, scope, fn)
  snapshot of the slide/deck → fn() edits the iframe DOM → 'history-changed' event
  → thumbnails redraw the affected slide (debounced) · title shows ● · ribbon enables Undo
Ctrl+Z → commands.run('undo') → history.undo() puts the snapshot back → same event chain
```

**Saving** (Ctrl+S)

```text
commands.run('save') → fileio.save → serialize.toHtml(deck document, player)
  → handle.createWritable() → write → close (atomic) → history.markSaved → ● disappears
```

## Build, test, run

| Task | Command |
| --- | --- |
| Build `dist/editor.html` (+ offline check) | `python build.py` |
| Unit tests in the browser (works on the company machine) | double-click `tests/run-tests.html` |
| All tests from the command line (needs Playwright) | `python tests/run_tests.py` |
| Generate the 50-slide performance deck | `python samples/make_heavy_deck.py` |
| Use the editor | double-click `dist/editor.html` (Edge or Chrome) |
