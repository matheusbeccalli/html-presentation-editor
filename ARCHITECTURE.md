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
| `history.js` | Undo/redo by HTML snapshots of a slide (or the whole deck); dirty tracking; `mergeKey` joins quick repeats (held arrow key) into one step; `meta` travels with a step (text: the cursor); a pending step (typing) is committed before any other change | deck (via `getDoc`) |
| `charts.js` | Chart JSON → SVG. **Phase 1: placeholder only** | importer |
| `template.js` | The blank deck for File > New | fileio |
| `text.js` | The only door to text (SPEC 3.7): the flat-paragraph model (`<p data-list data-level>`), `normalize` (messy HTML → allowed set, idempotent), `getModel`, the bullet/number stylesheet (`deckTextCss`) and list theme variables; `fromRendered` converts rendered text (import, format-1 decks) keeping its look; edit mode (`enterEdit`/`exitEdit`), typing as undo steps, the cursor as line + character (`getCaret`/`setCaret`), new text boxes that grow with their text; bullet keys and AutoFormat (`keyAction`, `autoFormatAction`); list buttons (`listAction`, `toggleList`, `setLevel`, `setNumbering`) | normalize, importer, history, selection, commands |
| `importer.js` | Parse, sanitize (scripts, handlers), find blocked/missing refs, detect slides, run the import | normalize, charts |
| `normalize.js` | Measures the deck in a hidden iframe and rebuilds it in the contract format; converts text to the text model while it can still measure it (text.js); icons inside headings become their own elements | importer, text |
| `serialize.js` | Clean copy of the deck + player script/CSS → the saved file's text | fileio |
| `icons.js` | Inline SVG icons | ribbon, ui, dialogs |
| `dialogs.js` | `<dialog>`-based alert/confirm and the import report | commands |
| `deck.js` | Loads the deck into the canvas iframe; current slide; editor-only view CSS | shortcuts, fileio |
| `canvas.js` | Zoom of the 1280×720 stage: fit mode (follows the window) or manual 50–400% (Ctrl+wheel around the mouse, status-bar slider, −/+, Fit); scrolls when zoomed | deck, selection (via `zoom-changed`) |
| `transform.js` | Pure maths: move/resize a `{left, top, width, height}` box, hit-test, stacking order | — |
| `selection.js` | The overlay catches mouse actions: click selects, drag moves, handles resize; draws the selection box; double-click edits text; insert mode (next click/drag places a new box) | transform, history, deck, canvas |
| `formatpane.js` | Format pane: "Size & position" X/Y/W/H fields for the selection, one undo step per applied value | selection, transform, history |
| `contextmenu.js` | Right-click menu (and Shift+F10): element actions, or only Paste on empty slide; items name commands | commands, selection, shortcuts |
| `elements.js` | Actions on the selected element: nudge (merged undo), delete, cut/copy/paste/duplicate (own clipboard, fresh ids), stacking order; insert a text box | selection, transform, history, deck |
| `thumbnails.js` | Slide rail; one small sandboxed iframe per slide, drawn lazily, refreshed debounced | deck, history events |
| `fileio.js` | Open (picker / input / drag-drop), Save, Save As, download fallback, close warning | importer, deck, serialize, history |
| `autosave.js` | AutoSave to the file (SPEC 6.1): the title-bar switch, the save-first banner until it is on, a scheduler (5 s after the last change, max 30 s, never during a drag/IME, never two writes), the changed-on-disk question | fileio, history, dialogs |
| `storage.js` | The editor's IndexedDB (drafts, draft HTML, recent files); never throws: blocked storage gives false/null/[] | — |
| `settings.js` | Privacy settings (keep drafts, retention 1–30 days, recent files) in localStorage, and the File > Settings dialog | storage, drafts, dialogs |
| `drafts.js` | Crash-recovery drafts (SPEC 6.2): a draft 30 s after unsaved changes (last 5 per deck), deleted on save/clean state/discard/after 1 day; Recover / Compare / Discard dialogs | storage, autosave (scheduler), fileio, importer, deck, thumbnails |
| `recent.js` | Recent files (off by default): remembers file handles on open/save, last 10; welcome list and File > Open recent… open the picker in the file's folder | storage, settings, fileio |
| `commands.js` | Every user action by name; one place that reports errors; toggle commands (`isChecked`) and commands that keep text editing (`keepsEdit`) | fileio, history, deck, text |
| `ribbon.js` | File menu and tabs; buttons only name commands; toggle buttons show `aria-pressed`; `keepsEdit` buttons do not take the focus out of the text | commands |
| `ui.js` | Title bar, status bar (save state per SPEC 6.4 + last message), notes, welcome screen, busy/drop overlays, "use Edge or Chrome" banner | events, fileio, autosave, drafts |

**`text.js` is the only door to text (SPEC 3.7).** Every text action (ribbon, shortcuts, paste, import, save) goes
through `enterEdit`, `exitEdit`, `applyStyle`, `setLevel`, `toggleList`, `normalize`, `getModel` (the editing ones arrive
in later Phase 3 steps). Text is flat paragraphs, `<p data-list data-level>`; bullets and numbers are CSS counters in the
deck's `<style data-deck-text>`; each line's `--marker-size/-color` lets its bullet follow the first character. Nothing
else reads or writes the HTML inside a text element. If the `contenteditable` internals stay buggy, they can be swapped
for ProseMirror/Tiptap (ask first) without touching other modules.

`src/player/player.js` + `player.css` are **not run by the editor**. They are copied into every saved deck
so it presents (arrow keys, F = full screen, hidden slides skipped) and prints one slide per page on its own.

## How a user action flows

**Opening a deck** (Ctrl+O, the welcome button, or a dropped file)

```text
keydown → shortcuts.js → commands.run('open') → fileio.open → showOpenFilePicker (keeps the handle)
  → importer.importDeck(text)
      sanitize → findExternalRefs → detectSlides → normalize.run (hidden iframe: measure, rebuild; text → text.fromRendered)
      → charts.renderMissing → text model finished (normalize every text box, list variables + <style data-deck-text>, format 2)
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

**Selecting and dragging** (Phase 2)

```text
pointerdown on #overlay → selection.js hit-tests the slide's elements (transform.hitTest) → selects by data-id
  → mouse moved 3 px → history.begin('Move' | 'Resize', slide) → every move: transform.moveRect/resizeRect → element style
  → pointerup → history.commit()  (one undo step)   ·   Escape → history.cancel()
'history-changed' → selection.refresh() finds the element again by data-id (undo rebuilt the slide)
```

**Editing text** (Phase 3)

```text
dblclick on #overlay (or Enter/F2) → selection.js → text.enterEdit: the .el becomes contenteditable in the deck iframe,
  #overlay.editing lets the mouse through, keys in the iframe reach the text (shortcuts skip typing targets)
first keystroke → beforeinput → history.begin('Typing', slide, { meta: cursor before }) … 1 s pause / Enter → history.commit (cursor after)
Ctrl+Z while typing → text.js keydown (capture) → commands 'undo' → history.undo (commits the typing first) → slide rebuilt
  → 'history-changed' {meta} → text.js finds the box again by data-id, makes it editable, puts the cursor back
Tab / Enter / Backspace / Alt+Shift+arrows → text.js keydown (capture) → text.keyAction decides (or leaves the key to the browser)
  → runInEditor: history.change(label, slide, runAction, { meta: cursor }) → lines changed, normalize, cursor put back
typed space → 'input' → text.autoFormatAction ("- ", "* ", "1. ") → its own undo step after the typing step
Home > Paragraph button (Bullets, Numbering, indent, Restart/Continue) → mousedown is cancelled, so the cursor stays in the
  text, and the click does not end editing (data-keep-edit) → commands → text.toggleList / setLevel / setNumbering
  → text.listAction on the selected lines (every line of a selected box when not editing) → one undo step
cursor moves → iframe 'selectionchange' → 'text-selection-changed' (once per frame) → ribbon shows Bullets/Numbering on/off
Esc / click outside → text.exitEdit → normalize → box selected   ·   Save → text.commitTyping, serialize normalizes the copy
```

**AutoSave** (Phase 2)

```text
first manual Save into a file → 'saved' {toHandle} → autosave.js switches On
every change → 'history-changed' → scheduler.notifyChange()  (5 s after the last change, at most every 30 s)
  → fileio.autoSave(): file date changed on disk? → ask Reload / Save as copy / Overwrite
                       else → serialize → createWritable → write → close → history.markSaved(stateId)
```

**Crash-recovery drafts** (Phase 2)

```text
every change while unsaved → 'history-changed' → drafts scheduler (30 s, same engine as AutoSave)
  → storage.addDraft({deckId, session, fileName, savedAt}, serialized deck) → keep the last 5 → "Draft saved 14:32"
saved / undo back to saved / tab closed clean / Discard → drafts of that deck deleted
editor start → storage.open (blocked → "Recovery unavailable") → purge older than 1 day → drafts left? → Recover / Compare… / Discard
file opened → 'file-opened' {lastModified} → drafts of this deck (by deck id, or by file name if the file has no id yet)
  newer than the file? → Recover (history.change + deck.replaceContent, undoable) / Compare (changed slides, miniatures) / Discard
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
