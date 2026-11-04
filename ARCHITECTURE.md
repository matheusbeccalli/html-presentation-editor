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
| `shortcuts.js` | The one key → command registry; ignores keys while typing; Ctrl+C / X / V are `clipboardEvent`: left to the browser, whose copy / cut / paste event carries the system clipboard (elements.js) | commands |
| `history.js` | Undo/redo by HTML snapshots of a slide (or the whole deck); dirty tracking; `mergeKey` joins quick repeats (held arrow key) into one step; `meta` travels with a step (text: the cursor); a pending step (typing) is committed before any other change | deck (via `getDoc`) |
| `charts.js` | Chart JSON → SVG. **Phase 1: placeholder only** | importer |
| `template.js` | The blank deck for File > New | fileio |
| `text.js` | The only door to text (SPEC 3.7), in text boxes and table cells ("containers": `containersIn`, `containerKey` = data-id or "tableId/row/cell" so undo finds a cell again, `findContainer`, `fitBox` = autofit or the table's rows, `normalizeCell`, `lineTexts`, `writeLines`; Tab / Shift+Tab in a cell → `tables.nextCell`, in the last cell `tables.appendRow`; leaving a cell whose text changed → `tables.alignNumbers`, inside the typing step): the flat-paragraph model (`<p data-list data-level>`), `normalize` (messy HTML → allowed set, idempotent), `getModel`, the bullet/number stylesheet (`deckTextCss`) and list theme variables; `fromRendered` converts rendered text (import, format-1 decks) keeping its look; edit mode (`enterEdit`/`exitEdit`), typing as undo steps, the cursor as line + character (`getCaret`/`setCaret`), new text boxes that grow with their text; bullet keys and AutoFormat (`keyAction`, `autoFormatAction`); list buttons (`listAction`, `toggleList`, `setLevel`, `setNumbering`); paragraph formatting (`paragraphAction`, `applyParagraph`: alignment, line spacing, space before/after on each selected `<p>`); find & replace (`findMatches` → `{p, start, end}` per match, `matchRange`, `replaceAction`/`replaceText`/`replaceAll`: a replacement takes the formatting of the first character it replaces; `selectMatch`); autofit (`fitText`: resize → `fitHeight`, shrink → `--autofit-scale` for the CSS `zoom` rule in the deck's text stylesheet; `autofitAction`); format painter (`pickLook`, `lookAction`, `startPainter`/`stopPainter`/`paintBox`); copy/cut (`copyContent`, `cutAction`); paste (`pasteAction`: Ctrl+V in the destination's look, the editor's own copies as they were, Ctrl+Shift+V plain); character formatting (`styleAction`, `applyStyle`: text read as runs, changed, written back; bold/italic shared by all the text moves onto the box) | normalize, importer, history, selection, commands |
| `numbers.js` | Numbers written as text (Phase 4 tables; Phase 6 chart labels): `parse` ("2.450", "(1,2x)", "-3,5%", "R$ 1.234 mn" → sign, parentheses, currency, digits as text, thousands separator shown, unit; one separator before three digits is read the locale's way), `format` (pt-BR 1.234,5 / en-US 1,234.5), `withDecimals` (half up), `toPercent`/`fromPercent` (the point moves, no digit lost), `isBlank` (–, n.a., n.m.), `localeFor(lang)`, `localeShown` (the locale the clear numbers among some texts are written in: "19,5%" pt-BR, "1,234.5" en-US; "2.450" tells nothing) | — |
| `images.js` | Pictures (Phase 5): `compress` (a file → data: URI: longest side 1920 px; transparent → PNG; else the smaller of PNG, JPEG 0.85 and the file itself; SVG kept), `fitSize`, `placeRect` (centred at its size, smaller to fit inside 64 px margins), `createImage` (`<img class="el" data-type="image">`), `insertFiles` (one undo step, stepped 10 px aside), Insert > Pictures (`choose`: the hidden `#picture-input`) | elements, history, selection, deck, ui |
| `tables.js` | Tables (Phase 4): new tables (`newTableRect`: centred, 960 px wide, 40 px rows; `createTable`: header row and banded rows on), `fitTable` (after an edit the box takes the rows' drawn height; after a resize the columns and rows scale to the box first; a row's height is a minimum, text can make it taller), rows and cells (`appendRow` like the last row, `nextCell`, `cellAt`, `firstCell`), the Layout operations on the grid of slots (`cellBoxes`, `blockAround`/`blockOf` = a block of cells grown around merged ones, `insertRows`, `insertColumns`, `deleteRows`, `deleteColumns`, `mergeCells`, `splitCell`), the cell look (`cellsIn`, `wholeBlock`, `setFill`, `setBorders`: a kind of borders of a block, each line written on both cells it runs between, as borders collapse; `setCellBox`: padding / vertical alignment on cells, or once on the table as its `--cell-…` variable), column borders (`colWidths`/`setColumnWidths`, `resizeColumn`: the left column gives or takes from the right one, 24 px minimum; `columnBorderAt`: the inner border under a point, not across merged cells), numbers in cells (`alignNumbers`: the cells of a column holding only numbers under its first row, blanks and n.a. aside, are marked `data-numeric` and the stylesheet right-aligns them, header included; an alignment set on the cell or its lines wins; `numberLocaleOf` (the table's clear numbers), `numbersIn`, `formatNumbers`: read in one locale, rewritten in another through text.js, keeping its look); the table model (deck format 3: `<td>` only in one `<tbody>`, `<colgroup>` px widths, style options as `data-…` attributes on `<table>`), the deck's table stylesheet (`deckTableCss`, theme variables and the `--cell-…` defaults), the grid of merged cells (`gridOf`), and `fromRendered`: a laid-out table → model table keeping its look (shared look lifted onto the `<table>`). The text inside cells belongs to text.js (`normalizeCell`) | text, normalize, importer, serialize |
| `importer.js` | Parse, sanitize (scripts, handlers), find blocked/missing refs, detect slides, run the import; tidies every text box and table cell and installs the current table and text stylesheets | normalize, charts, text, tables |
| `normalize.js` | Measures the deck in a hidden iframe and rebuilds it in the contract format; converts text to the text model and tables to the table model while it can still measure them (text.js, tables.js), also in older contract decks (format 1: text, formats 1–2: tables); icons inside headings become their own elements | importer, text, tables |
| `serialize.js` | Clean copy of the deck + player script/CSS → the saved file's text | fileio |
| `icons.js` | Inline SVG icons | ribbon, ui, dialogs |
| `dialogs.js` | `<dialog>`-based alert/confirm and the import report | commands |
| `deck.js` | Loads the deck into the canvas iframe; current slide; editor-only view CSS (also the find highlight colours); `withSlideShown` shows another slide for a moment to measure it | shortcuts, fileio |
| `canvas.js` | Zoom of the 1280×720 stage: fit mode (follows the window) or manual 50–400% (Ctrl+wheel around the mouse, status-bar slider, −/+, Fit); scrolls when zoomed | deck, selection (via `zoom-changed`) |
| `transform.js` | Pure maths: move/resize a `{left, top, width, height}` box (`keepsAspect`: Shift, or a picture's corner), hit-test, stacking order | — |
| `selection.js` | The overlay catches mouse actions: click selects, drag moves, handles resize; draws the selection box; double-click edits text; a press in a table's cells goes to `tableControls.pressCells` (a table moves by its 8 px edge, as in PowerPoint); insert mode (next click/drag places a new box) | transform, history, deck, canvas |
| `formatpane.js` | Format pane: "Size & position" X/Y/W/H fields for the selection, one undo step per applied value (autofit refits after a new size); "Text box" > Autofit for text boxes | selection, transform, history, text |
| `contextmenu.js` | Right-click menu (and Shift+F10): element actions, or only Paste on empty slide; items name commands | commands, selection, shortcuts |
| `elements.js` | Actions on the selected element: nudge (merged undo), delete, cut/copy/paste/duplicate (own clipboard, fresh ids), stacking order; insert a text box or a table (on top of the slide: `freshId`, `addOnTop`); the copy / cut / paste events of the editor page and the deck (`init`): a copy also puts a mark on the system clipboard, so Ctrl+V pastes our element only while the newest copy is ours, else a table from Excel (tablepaste.js) | selection, transform, history, deck, tablepaste, commands |
| `thumbnails.js` | Slide rail; one small sandboxed iframe per slide, drawn lazily, refreshed debounced | deck, history events |
| `fileio.js` | Open (picker / input / drag-drop), Save, Save As, download fallback, close warning | importer, deck, serialize, history |
| `autosave.js` | AutoSave to the file (SPEC 6.1): the title-bar switch, the save-first banner until it is on, a scheduler (5 s after the last change, max 30 s, never during a drag/IME, never two writes), the changed-on-disk question | fileio, history, dialogs |
| `storage.js` | The editor's IndexedDB (drafts, draft HTML, recent files); never throws: blocked storage gives false/null/[] | — |
| `settings.js` | Privacy settings (keep drafts, retention 1–30 days, recent files) and the number locale (pt-BR / en-US, null = the deck's language) in localStorage, and the File > Settings dialog | storage, drafts, dialogs |
| `drafts.js` | Crash-recovery drafts (SPEC 6.2): a draft 30 s after unsaved changes (last 5 per deck), deleted on save/clean state/discard/after 1 day; Recover / Compare / Discard dialogs | storage, autosave (scheduler), fileio, importer, deck, thumbnails |
| `recent.js` | Recent files (off by default): remembers file handles on open/save, last 10; welcome list and File > Open recent… open the picker in the file's folder | storage, settings, fileio |
| `commands.js` | Every user action by name; one place that reports errors; toggle commands (`isChecked`) and commands that keep text editing (`keepsEdit`) | fileio, history, deck, text |
| `clipboard.js` | Clipboard HTML in: Word/Outlook `mso-list` paragraphs, PowerPoint glyph paragraphs (levels from indents), web/Copilot lists, the editor's own marked HTML → normalized flat paragraphs in an inert document (`toParagraphs`); out: copied lines → marked nested `<ul>/<ol>` (`fromLines`) | text |
| `textcontrols.js` | Home > Font's font list, size box and colour split buttons, Home > Paragraph's line spacing list, and the paste options button (PowerPoint's 1.0 … 3.0 stored as line-height × 1.2, space before/after in pt): show the selection's font and size (blank when mixed), theme fonts and colours first (stored as `var(--…)`); choosing runs `setFontFamily` / `setFontSize` / `setFontColor` / `setHighlight` / `setLineSpacing` / `setSpaceBefore` / `setSpaceAfter`. Shares `colorSplit` (a colour split button from a spec) and `openMenu` with tabledesign.js; the paste options button serves the last paste into text and the table just pasted (`tablePaste.pasteOptions`) | commands, text, deck |
| `tabledesign.js` | The look of tables: the Table Design tab (Table Style Options checkboxes, Shading, Borders with the pen weight and colour, Number: the locale button (`numberLocale`: the setting, else the deck's language) and Thousands Separator, Increase / Decrease Decimal, Percent Style, Negatives in Parentheses, which rewrite the numbers (typing in the cell stops for it and goes on after)) and the Layout tab's Alignment group (vertical alignment, Cell Margins); they work on the selected cells, the cell typed in, or all cells of the selected table; one undo step each (`tableControls.keepCells` keeps the selected cells); its commands are defined by commands.js from `tableDesign.commands()` | tables, numbers, settings, tablecontrols, textcontrols, commands, ribbon, history |
| `tablepaste.js` | Paste from Excel: `readCells` (the clipboard's `<table>` laid out in a hidden iframe without scripts and loading nothing, read as the text each cell shows, bold, italic, merged cells, `<col>` widths; else tab-separated text with Excel's quotes; null for one cell), `buildTable` ('destination': the deck's table style, the text with bold/italic, Excel's column proportions as wide as in Excel at 14 pt, a bold last row = Total Row; 'source': `tables.fromRendered`, Excel's fills, lines, fonts, widths), `fillCells` (from a slot on, rows / columns added), `paste` (selected cells, else a new centred table), `pasteIntoCell` (text.js, typing in a cell), `pasteOptions` / `repaste` (Use destination theme / Keep source formatting) | tables, text, elements, tablecontrols, history, selection |
| `tablecontrols.js` | Table controls: Insert > Table's 10 × 10 grid picker (mouse or arrow keys + Enter) → `insertTable`; selected cells (a press in a table's cells: `pressCells` keeps the mouse on the overlay, a drag into another cell selects a block, a release types in the cell; Shift+click while typing; drawn as `.cell-block` on the overlay, nothing in the deck; Esc / Delete empties them; kept across undo); column borders (`borderAt`, `dragBorder`: from the overlay, or from the deck while typing, where an editor-only `<style data-editor-only="col-resize">` in the deck head shows the border cursor); the cells the Layout / Table Design buttons work on (`cellTarget`), `keepCells`, `selectCells`, `widthFromColumns`; the Layout tab's actions (`canLayout`, `layout`: one undo step, typing goes on in the same cell or the one now in its place) | tables, text, selection, commands, ribbon, history |
| `findreplace.js` | Home > Editing: Find / Replace panel (Ctrl+F / Ctrl+H) over the slide; walks every slide and text box in order (hidden slides too), selects the match in its box, Replace (one step) and Replace All (one deck-wide step, autofit measured with `deck.withSlideShown`); paints every match with the CSS Highlight API (`::highlight(editor-find)`, nothing written into the deck) | text, deck, history, selection |
| `ribbon.js` | File menu and tabs (contextual tabs such as Layout show only while they apply); buttons only name commands; toggle buttons show `aria-pressed`; `keepsEdit` buttons do not take the focus out of the text | commands |
| `ui.js` | Title bar, status bar (save state per SPEC 6.4 + last message + the deck size, `sizeText`: KB / MB, amber above 20 MB, measured a second after a change), notes, welcome screen, busy/drop overlays, "use Edge or Chrome" banner | events, fileio, autosave, drafts |

**`text.js` is the only door to text (SPEC 3.7)**, table cells included: `tables.js` builds rows, columns and merged
cells, and asks text.js (`normalizeCell`) for the lines inside them. Every text action (ribbon, shortcuts, paste, import, save) goes
through `enterEdit`, `exitEdit`, `applyStyle`, `setLevel`, `toggleList`, `normalize`, `getModel` (the editing ones arrive
in later Phase 3 steps). Text is flat paragraphs, `<p data-list data-level>`; bullets and numbers are CSS counters in the
deck's `<style data-deck-text>`; each line's `--marker-size/-color` lets its bullet follow the first character. Nothing
else reads or writes the HTML inside a text element (a build test fails if another module uses `execCommand`, `data-list`
or `data-level`). If the `contenteditable` internals stay buggy, they can be swapped
for ProseMirror/Tiptap (ask first) without touching other modules.

`src/player/player.js` + `player.css` are **not run by the editor**. They are copied into every saved deck
so it presents (arrow keys, F = full screen, hidden slides skipped) and prints one slide per page on its own.

## How a user action flows

**Opening a deck** (Ctrl+O, the welcome button, or a dropped file)

```text
keydown → shortcuts.js → commands.run('open') → fileio.open → showOpenFilePicker (keeps the handle)
  → importer.importDeck(text)
      sanitize → findExternalRefs → detectSlides → normalize.run (hidden iframe: measure, rebuild; text → text.fromRendered,
        tables → tables.fromRendered, each cell's text → text.fromRendered)
      → charts.renderMissing → tables finished (normalizeCell on every cell, <style data-deck-table>)
      → text model finished (normalize every text box, list variables + <style data-deck-text>, format 3)
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
Bold / Italic … (button or Ctrl+B) → commands → text.applyStyle → text.styleAction on the selection (or the word around the
  cursor, or every line of a selected box) → one undo step; a cursor elsewhere keeps it as "pending" → the next typed
  character → beforeinput → insertStyled types it with that formatting, and the browser types on inside it
Ctrl+V / Ctrl+Shift+V while typing → the browser's 'paste' event → text.js onPaste (cancels it) → clipboard.toParagraphs(html)
  → text.pasteAction: lines inserted as runs at the cursor → one undo step "Paste"
  → 'text-pasted' → textcontrols shows the paste options button at the cursor while text.pasteOptions() allows
  → a choice → text.repaste(mode): history.undo() of the paste, pasteAction again the other way
Format painter → text.startPainter: pickLook at the cursor (or the selected box) → then a mouse-up in the text being
  edited → lookAction on the selection / the word (runInEditor), or a click on a text box (selection.js / onDeckPointerDown)
  → text.paintBox → lookAction on the whole box; one use unless started by a double-click; Esc stops
Ctrl+F / Ctrl+H (or Home > Editing) → findreplace.js opens its panel ([data-keep-edit]: typing in it does not end editing)
  → the search changes → every text box: text.findMatches → text.matchRange → CSS.highlights in the deck window (yellow)
  → Enter / Find Next → next match after the cursor (slide, box, line, character) → deck.goTo → text.selectMatch (edits the
  box, selects the match, orange) → the focus goes back to the panel · Replace → text.replaceText (runInEditor, one step)
  → Find Next · Replace All → exitEdit → history.change('Replace All', 'deck') → text.replaceAll per box + fitText
cursor moves → iframe 'selectionchange' → 'text-selection-changed' (once per frame) → ribbon shows Bullets/Numbering on/off
Esc / click outside → text.exitEdit → normalize → box selected   ·   Save → text.commitTyping, serialize normalizes the copy
```

**Typing in a table** (Phase 4)

```text
click on a table (no drag) / double-click / Enter → selection.js → tables.cellAt → text.enterEdit(cell): the <td> is
  contenteditable, the table stays selected, editing.id = "e9/1/0" → typing, keys, formatting, paste as in a text box
  → after each change text.fitBox → tables.fitTable (the box takes the rows' height; a row grows with its text)
click on another cell while typing → text.js onDeckPointerDown → enterEdit(that cell)
Tab / Shift+Tab → text.js onKeyDown → tables.nextCell → enterEdit(next, all selected) · in the last cell →
  history.change('Insert row', tables.appendRow) → enterEdit(its first cell)
undo → slide rebuilt → text.findContainer(slide, "e9/1/0") finds the cell again, cursor put back
```

**Table cells and the Layout tab** (Phase 4)

```text
pointerdown in a table's cells (not its edge) → selection.js → tableControls.pressCells (overlay keeps the mouse)
  → moves into another cell → block of cells (tables.blockAround) → .cell-block drawn on the overlay
  → released in the same cell → text.enterEdit(cell)
Shift+click while typing in a cell → tablecontrols.js deck pointerdown (before text.js's) → block from that cell
pointerdown on an inner column border → selection.js (overlay), or tablecontrols.js deck pointerdown while typing
  (preventDefault: the cursor stays) → tableControls.dragBorder: history.begin('Resize column') → per move
  tables.resizeColumn + setColumnWidths + fitTable → history.commit; typing goes on in the same cell
Table Design / Alignment button (keepsEdit) → commands (tableDesign.commands) → the selected cells, the cell typed in,
  or all cells → tableControls.keepCells(history.change(label): tables.setFill / setBorders(pen) / setCellBox,
  tables.fitTable) → typing and the selected cells go on
Layout button (keepsEdit) → commands → tableControls.layout(action): exitEdit → history.change(label):
  tables.insertRows / insertColumns / deleteRows / deleteColumns / mergeCells / splitCell → width from the columns,
  tables.alignNumbers, tables.fitTable → enterEdit(the same cell, or the one in its place)
Number button → commands (tableDesign.commands) → exitEdit if typing → history.change(label): tables.numbersIn
  (read as tables.numberLocaleOf shows, else the deck's language) → numbers.withDecimals / toPercent / … →
  numbers.format (in tableDesign.numberLocale: the setting, else the deck's language) → text.replaceAll (the
  first character's look) → tables.alignNumbers → enterEdit(the same cell)
leaving a cell whose text changed (Tab, click, Esc) → text.exitEdit → tables.alignNumbers (before the typing step
  closes, so undo takes it back with the typing) → td[data-numeric] { text-align: right } in the table stylesheet
```

**Inserting and resizing a table** (Phase 4)

```text
Insert > Table → tablecontrols.js grid (hover / arrow keys) → click / Enter → commands.run('insertTable', { rows, cols })
  → elements.insertTable → history.change('Insert table'): tables.createTable + tables.fitTable (measures the rows) → selected
resize handle drag / Format pane W or H → transform.writeRect → tables.fitTable(resized): columns and rows scaled to
  the box (a row's height is its minimum: text can make it taller), box height = the rows' drawn height → selection box
```

**Paste from Excel** (Phase 4)

```text
Ctrl+V, not typing → shortcuts leave it to the browser → 'paste' event (editor page or deck) → elements.js onPasteEvent
  → the clipboard holds our newest copy's mark → elements.paste (our element)
  → else tablePaste.paste: readCells (hidden iframe, no scripts, nothing loads) → cells selected? fillCells from the
    first one (history 'Paste', cells selected after) : buildTable('destination') centred on the slide (history
    'Paste table', selected) → 'table-pasted' → paste options button at its corner → Keep source formatting →
    tablePaste.repaste: history.undo, buildTable('source')
Ctrl+V typing in a cell → text.js onPaste → tablePaste.pasteIntoCell (two cells or more) → fillCells from that cell;
  one cell or plain text → text.pasteAction as in a text box
Ctrl+C / Ctrl+X on a selected element → 'copy' / 'cut' event → elements copy (own clipboard) + a mark with a new
  number on the system clipboard (the ribbon's Copy writes it with navigator.clipboard, best effort)
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
