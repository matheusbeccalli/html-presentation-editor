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
| `history.js` | Undo/redo by HTML snapshots of a slide, of the slide order plus the slides that come or go (`{ slides: [ids] }`: add / duplicate / delete, the other slides not copied), or of the whole deck; dirty tracking; `mergeKey` joins quick repeats (held arrow key) into one step; `meta` travels with a step (text: the cursor); a pending step (typing) is committed before any other change | deck (via `getDoc`) |
| `charts.js` | Chart JSON → SVG (SPEC 5). `render(data, width, height)`: pure, exactly that size (no viewBox stretching), colours from the theme variables, `--font-body`, text widths estimated; drawn so far: column, stacked-column, bar, stacked-bar, line, combo, donut, pie (others: the Phase 1 placeholder, `data-chart-placeholder`); `drawCartesian` (one layout for bars and lines: title and legend (`frame`), a value axis per side (a series with "axis": "secondary" on the right; `guessComboAxes` puts a small line series of a combo there, in % when all its values are within ±1), category bands, bars, then lines (`drawLine`: dashed into estimate years, hollow dots), data labels with a white halo; a combo's column numbers sit inside the column base, clear of the line), `drawRound` (donut / pie: first series, one slice per category from 12 o'clock, shares in %, legend on the right); `waterfallSteps` + `drawWaterfall` (roles from `rolesOf`: start / delta / subtotal / end, default first = start, last = end; totals at their own value or the running total; colours `options.waterfall` over green / red / accent; connectors; signed labels); `modelOf` (the data made safe to draw); 100% stacked (`asShares`, labels in whole percents), areas (`drawArea`: filled to zero or stacked on the areas below, its line on top), new charts: `GALLERY`, `sampleData` (made-up numbers per type), `createChart`, `readData` / `writeData` ("<" stored as \u003c, drawn again), `labelsOn`; axis titles (`axisTitles`: options.valueAxisTitle / categoryAxisTitle / secondaryAxisTitle); labels: `labelPositionOf` (options.labelPosition, automatic: centre in stacks, inside base in combos, else outside end) + `dataLabel` (inside only when it fits; dark inside lighter estimate bars), label options labelDecimals / locale / percent (all series as %) / parens / units (`formatValue` units); readability: `fitCategoryLabels` (as they are → two lines → 12 / 11 px → turned 45° → every n-th), `categoryRow`, `twoLines`, `limitedTicks` (options.axisMin / axisMax; values beyond stop at the axis), `cagr` + `cagrOf` + `drawCagr` (options.cagr: an arrow over the columns, "CAGR 19,6%" in a pill), options.source (a grey line under everything, in `frame`); `drawScatter` (scatter / bubble: categories are points, x / y from the first two series, a bubble's area from the third, axis titles from the series' names, room past the data, names flip left at the right edge); `niceTicks` (Heckbert's 1-2-5), `formatValue` (numbers.js: locale, decimals, percent, parentheses), `decimalsOf`, `canDraw`; `redraw(figure)` after a resize (selection.js, formatpane.js; only types it can draw: a deck's own drawing is kept); `renderMissing` on open (charts with data but no drawing, and placeholders of types drawn now). A chart type not drawn here (a map, a radar …): copy it in Excel and paste it as a picture (images.js, Phase 5) | importer, numbers, util |
| `template.js` | The blank deck for File > New | fileio |
| `text.js` | The only door to text (SPEC 3.7), in text boxes, table cells and shapes' text areas ("containers": `containersIn`, `containerKey` = data-id, "tableId/row/cell" or "shapeId/text" so undo finds it again, `findContainer`, `textOf` (the text of a selected text box or shape: what the Font and Paragraph buttons change), `fitBox` = autofit or the table's rows (a shape keeps its size), `normalizeCell`, `lineTexts`, `writeLines`; Tab / Shift+Tab in a cell → `tables.nextCell`, in the last cell `tables.appendRow`; leaving a cell whose text changed → `tables.alignNumbers`, inside the typing step): the flat-paragraph model (`<p data-list data-level>`), `normalize` (messy HTML → allowed set, idempotent), `getModel`, the bullet/number stylesheet (`deckTextCss`) and list theme variables; `fromRendered` converts rendered text (import, format-1 decks) keeping its look; edit mode (`enterEdit`/`exitEdit`), typing as undo steps, the cursor as line + character (`getCaret`/`setCaret`), new text boxes that grow with their text; bullet keys and AutoFormat (`keyAction`, `autoFormatAction`); list buttons (`listAction`, `toggleList`, `setLevel`, `setNumbering`); paragraph formatting (`paragraphAction`, `applyParagraph`: alignment, line spacing, space before/after on each selected `<p>`); find & replace (`findMatches` → `{p, start, end}` per match, `matchRange`, `replaceAction`/`replaceText`/`replaceAll`: a replacement takes the formatting of the first character it replaces; `selectMatch`); autofit (`fitText`: resize → `fitHeight`, shrink → `--autofit-scale` for the CSS `zoom` rule in the deck's text stylesheet; `autofitAction`); format painter (`pickLook`, `lookAction`, `startPainter`/`stopPainter`/`paintBox`); copy/cut (`copyContent`, `cutAction`); paste (`pasteAction`: Ctrl+V in the destination's look, the editor's own copies as they were, Ctrl+Shift+V plain); character formatting (`styleAction`, `applyStyle`: text read as runs, changed, written back; bold/italic shared by all the text moves onto the box) | normalize, importer, history, selection, commands |
| `numbers.js` | Numbers written as text (Phase 4 tables; Phase 6 chart labels): `parse` ("2.450", "(1,2x)", "-3,5%", "R$ 1.234 mn" → sign, parentheses, currency, digits as text, thousands separator shown, unit; one separator before three digits is read the locale's way), `format` (pt-BR 1.234,5 / en-US 1,234.5), `withDecimals` (half up), `toPercent`/`fromPercent` (the point moves, no digit lost), `isBlank` (–, n.a., n.m.), `localeFor(lang)`, `localeShown` (the locale the clear numbers among some texts are written in: "19,5%" pt-BR, "1,234.5" en-US; "2.450" tells nothing) | — |
| `images.js` | Pictures (Phase 5): `compress` (a file → data: URI: longest side 1920 px; transparent → PNG; else the smaller of PNG, JPEG 0.85 and the file itself; SVG kept), `fitSize`, `placeRect` (centred at its size, smaller to fit inside 64 px margins), `createImage` (`<img class="el" data-type="image">`), `insertFiles` (one undo step 'Insert/Paste picture(s)', stepped 10 px aside; non-pictures named in the status bar), Insert > Pictures (`choose`: the hidden `#picture-input`), `isPictureDrop` (a drag carries pictures and no .html), `picturesIn` (the picture files of a paste or drop); Picture Format: `fitInside` + `replace` (Change Picture: fitted inside the old box, centred; same element, one undo step), `resetRect` + `resetSize` (the size it came in with, same centre, inside the slide), `isPictureSelected`, `chooseReplacement` (the same file input, one file); `encode` (a canvas → PNG, or the smaller of PNG and JPEG 0.85; compress and crop.js use it) | elements, history, selection, deck, ui |
| `shapes.js` | The shape model (Phase 5): `<div class="el" data-type="shape" data-shape="chevron">` holding an inline `<svg class="shape-svg">` with no viewBox (1 unit = 1 slide px, so outlines never stretch); `KINDS` (rect, roundRect, ellipse, line, arrow, chevron, pentagon, callout; default sizes), `geometry` (kind + size (+ data-adjust, data-flip, line width) → paths 'fill' / 'line' / 'head'), `createShape` (accent fill, no outline; lines: a 2 px accent stroke), `render` (new "d" after a resize, look kept; older plain-box shapes left alone), `drawnShape` (a drag → box + flip; Shift: square, or lines at 45°), `clickedShape` (default size at the click, inside the slide); handles: `lineEnds` / `moveLineEnd` / `setLine` (a line's end handles; Shift: 45° round the other end), `adjustHandle` / `adjustFrom` / `adjustOf` / `setAdjust` (the yellow handle: roundRect corner, chevron / pentagon point depth (parts of the shorter side), callout tail tip (parts of width and height), stored in data-adjust); the svg is at least 1 px (a browser draws nothing in a 0 px svg); the look: `lookOf` / `setLook` (fill, outline colour, width, dash as multiples of the width, transparency = fill-opacity (lines: stroke-opacity), shadow = the svg's drop-shadow filter; a line's colour goes to its arrow head too); text: `textOf` (a box shape's `<div class="shape-text">` over the drawing, centred both ways, white, 18 pt (`TEXT_STYLE`); `create` makes it for a shape drawn before), `canHoldText` (not lines, not older plain boxes), `TEXT_SELECTOR` | transform, util, text |
| `tables.js` | Tables (Phase 4): new tables (`newTableRect`: centred, 960 px wide, 40 px rows; `createTable`: header row and banded rows on), `fitTable` (after an edit the box takes the rows' drawn height; after a resize the columns and rows scale to the box first; a row's height is a minimum, text can make it taller), rows and cells (`appendRow` like the last row, `nextCell`, `cellAt`, `firstCell`), the Layout operations on the grid of slots (`cellBoxes`, `blockAround`/`blockOf` = a block of cells grown around merged ones, `insertRows`, `insertColumns`, `deleteRows`, `deleteColumns`, `mergeCells`, `splitCell`), the cell look (`cellsIn`, `wholeBlock`, `setFill`, `setBorders`: a kind of borders of a block, each line written on both cells it runs between, as borders collapse; `setCellBox`: padding / vertical alignment on cells, or once on the table as its `--cell-…` variable), column borders (`colWidths`/`setColumnWidths`, `resizeColumn`: the left column gives or takes from the right one, 24 px minimum; `columnBorderAt`: the inner border under a point, not across merged cells), numbers in cells (`alignNumbers`: the cells of a column holding only numbers under its first row, blanks and n.a. aside, are marked `data-numeric` and the stylesheet right-aligns them, header included; an alignment set on the cell or its lines wins; `numberLocaleOf` (the table's clear numbers), `numbersIn`, `formatNumbers`: read in one locale, rewritten in another through text.js, keeping its look); the table model (deck format 3: `<td>` only in one `<tbody>`, `<colgroup>` px widths, style options as `data-…` attributes on `<table>`), the deck's table stylesheet (`deckTableCss`, theme variables and the `--cell-…` defaults), the grid of merged cells (`gridOf`), and `fromRendered`: a laid-out table → model table keeping its look (shared look lifted onto the `<table>`). The text inside cells belongs to text.js (`normalizeCell`) | text, normalize, importer, serialize |
| `importer.js` | Parse, sanitize (scripts, handlers), find blocked/missing refs, detect slides, run the import; tidies every text box and table cell and installs the current table and text stylesheets | normalize, charts, text, tables |
| `normalize.js` | Measures the deck in a hidden iframe and rebuilds it in the contract format; converts text to the text model and tables to the table model while it can still measure them (text.js, tables.js), also in older contract decks (format 1: text, formats 1–2: tables); icons inside headings become their own elements | importer, text, tables |
| `serialize.js` | Clean copy of the deck + player script/CSS → the saved file's text | fileio |
| `icons.js` | Inline SVG icons | ribbon, ui, dialogs |
| `dialogs.js` | `<dialog>`-based alert/confirm and the import report | commands |
| `deck.js` | Loads the deck into the canvas iframe; current slide; editor-only view CSS (also the find highlight colours); `withSlideShown` shows another slide for a moment to measure it | shortcuts, fileio |
| `canvas.js` | Zoom of the 1280×720 stage: fit mode (follows the window) or manual 50–400% (Ctrl+wheel around the mouse, status-bar slider, −/+, Fit); scrolls when zoomed | deck, selection (via `zoom-changed`) |
| `transform.js` | Pure maths: move/resize a `{left, top, width, height}` box; `bandRect` / `containsRect` (rubber band: wholly inside) / `boundsOf` (Phase 7); `alignRects` (on an area: the slide or the selection's bounds) / `distributeRects` (ordered by the left / top edge, equal gaps, the first and last at the area's edges; 1/100 px) (`keepsAspect`: Shift, or a picture's corner), hit-test (anything thinner than 10 px, e.g. a flat line, is hit 5 px either side), stacking order | — |
| `selection.js` | The overlay catches mouse actions: click selects, drag moves, handles resize; draws the selection box; multi-select (Phase 7): the selection is a list of ids (`selectedIds`, `getElements`, `selectMany`, `toggle` / pure `toggleId`, `selectAll`, `count`, `isSelected`), `getElement` / `selectedId` only when exactly one is selected (so single-element UI stays off for several); Shift / Ctrl+click toggles, a drag from empty slide = rubber band (`.rubber-band`, wholly covered elements, Shift adds, Esc restores), several = a `.selection-outline` each and a drag on one moves all (one 'Move' step); double-click edits text; a press in a table's cells goes to `tableControls.pressCells` (a table moves by its 8 px edge, as in PowerPoint); insert mode (`armInsert`: next click/drag places a new box; with `options.preview` a drag both ways, the callback gets `gesture` {start, end, shiftKey, dragged}); a resize redraws a shape (`shapes.render`); a line shows end handles (`start` / `end`, no box), some shapes a yellow `adjust` handle: each drag one undo step ('Move line end', 'Adjust shape') | transform, history, deck, canvas |
| `crop.js` | Picture Format > Crop: crop mode in the overlay (dimmed cut-away part, 8 black handles; the deck is untouched until applied), `moveEdge` (a handle moves its edge(s), inside the picture, 10 px minimum), `sourceRect` (slide px → the picture's own pixels), `cropImage` (true crop on a canvas, images.encode; SVG drawn at 2×), `finish` (Enter / Esc / Crop again / a press elsewhere / another selection or slide: one undo step 'Crop'); undo while cropping just ends it | images, selection, transform, history, deck |
| `formatpane.js` | Format pane: "Size & position" X/Y/W/H fields for the selection (several selected: "N objects selected"), one undo step per applied value (autofit refits after a new size); "Text box" > Autofit for text boxes | selection, transform, history, text |
| `contextmenu.js` | Right-click menu (and Shift+F10): element actions (a picture adds Change Picture), or only Paste on empty slide; `openWith(commands, x, y)` for the slide rail; items name commands; a toggle command (Hide Slide) is a menuitemcheckbox with a tick | commands, selection, shortcuts |
| `elements.js` | Actions on the selected element(s): nudge (merged undo), delete, cut/copy/paste/duplicate (own clipboard = HTML list back to front, fresh ids, several moved by one `pastePosition` step and selected), stacking order (`restackMany`: several move as a block); align / distribute (`alignsToSlide`: one element, or Align to Slide on (a session toggle); else the selection's bounds; one step, none if nothing moves); insert a text box, a shape (`insertShape`: drawn or default size, 'Insert shape') or a table (on top of the slide: `freshId`, `addOnTop`); the copy / cut / paste events of the editor page and the deck (`init`): a copy also puts a mark on the system clipboard, so Ctrl+V pastes our element only while the newest copy is ours, else a table from Excel (tablepaste.js), else a picture (images.js) | selection, transform, history, deck, tablepaste, commands |
| `thumbnails.js` | Slide rail; one small sandboxed iframe per slide, drawn lazily, refreshed debounced; redrawn whole after a deck or slides step (the keyboard focus stays in the rail and follows the slide shown); keys in the rail: Enter New Slide, Delete / Backspace Delete Slide, Ctrl+D Duplicate Slide, Ctrl+Up / Ctrl+Down move the slide; right-click: `contextMenu.openWith` the slide actions (+ Hide Slide); drag a thumbnail (5 px to start, window listeners, `.thumb-drop-line` at `slides.gapAt`, auto-scroll near the edges, Esc cancels, the click after a drag is swallowed) → `slides.move`; a slide step updates the hidden mark at once (`markHidden`) | deck, history events, commands, contextmenu |
| `fileio.js` | Open (picker / input / drag-drop; dropped pictures go to images.js), Save, Save As, download fallback, close warning | importer, deck, serialize, history |
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
| `chartcontrols.js` | Insert > Chart (a gallery of `charts.GALLERY`, `insertChart`: sample data, centred 800 × 450, 'Insert chart') and Chart Design (contextual tab while a chart with data is selected; Labels ▾ position list; the pane's Numbers part: locale select, decimals, units, Show as %, parentheses): `commands()` (setChartType, setChartLegend, chartTitle (hidden title kept in options.hiddenTitle), chartDataLabels (`charts.labelsOn`), chartGridlines, chartCagr (first to last category), setWaterfallColor, setChartOption), list buttons, waterfall colour splits, the Format pane's "Chart" section (title, axis titles, axis min / max, gap width, source: Enter applies, empty = automatic); every change = `charts.writeData` in one history step | charts, commands, icons, textcontrols, elements, history, selection, tabledesign |
| `chartdata.js` | The chart data grid (a panel under the slide, in place of the notes): pure `parseCell` / `cellText` (numbers.js, the chart's locale; a % series takes 18 as 18%), `addRow` (a bridge: before its end) / `removeRow` / `moveRow` / `addSeries` / `removeSeries` / `moveSeries` (every per-category list kept in line; the CAGR's rows and series follow); the panel: `open` / `close` / `isOpen`, a header per series (⠿, name, colour split, combo type and axis, ×), a row per category (⠿, name, E, waterfall role, ×), value inputs; `edit` = one history step (mergeKey per cell) via charts.writeData; the grid is rebuilt after undo / redo and structural changes, not while typing; paste: `isWholeTable` / `fromRows` (a whole table replaces the data) / `fillRows` (a block fills from a cell), the grid's paste event, `pasteOnChart` (elements.js: Ctrl+V on a selected chart) | charts, numbers, tablepaste, history, selection, textcontrols, tabledesign |
| `notes.js` | Speaker notes (plain text): `textOf` / `write` a slide's `<aside class="notes">` (kept last in the slide), the panel's text box under the slide: typing = one history step per run (mergeKey notes:slideId), Ctrl+Z / Ctrl+Y there run the editor's undo / redo | deck, history, commands |
| `slides.js` | Slides (Phase 7): pure `freshSlideId`, `titleOf` (largest text box in the upper half), `buildSlide(doc, layout, id)` (built-in layouts title / title-content / two-columns / blank; the title copies the position and look of a title on the deck's slides of that kind, else File > New's; body text in theme variables, written by `text.writeLines` with `look.list`), `copyOf` (new slide and element ids), `nextLayout`, `gapAt` (drop gap from thumbnail middles), `moveSlide(doc, from, gap)`, `isHidden` / `setHidden` (data-hidden="true"); actions `add` / `duplicate` (after the slide shown) / `remove` (never the last slide) / `move` / `moveBy`: one history step each in the `{ slides: [id] }` scope (`[]` for a move), `toggleHidden` a step of that slide, `meta.slides` {undo, redo} = the slide shown after undo / redo; Home > New Slide ▾ layout gallery | deck, history, text, selection, commands |
| `shapecontrols.js` | Insert > Shapes: the button and its gallery of icons; a pick runs `insertShape`. Shape Format (contextual tab while a shape with data-shape is selected, and the Format pane's "Fill & line" section, `init`): `commands()` (shapeFill / setShapeFill, shapeOutline / setShapeOutline, setShapeOutlineWidth, setShapeDash, setShapeTransparency, shapeShadow: each one undo step via `setLook`; a width or dash on a shape without outline adds one), colour split buttons (textcontrols.colorSplit), list buttons, `refresh` | shapes, commands, icons, textcontrols, history, selection |
| `tablecontrols.js` | Table controls: Insert > Table's 10 × 10 grid picker (mouse or arrow keys + Enter) → `insertTable`; selected cells (a press in a table's cells: `pressCells` keeps the mouse on the overlay, a drag into another cell selects a block, a release types in the cell; Shift+click while typing; drawn as `.cell-block` on the overlay, nothing in the deck; Esc / Delete empties them; kept across undo); column borders (`borderAt`, `dragBorder`: from the overlay, or from the deck while typing, where an editor-only `<style data-editor-only="col-resize">` in the deck head shows the border cursor); the cells the Layout / Table Design buttons work on (`cellTarget`), `keepCells`, `selectCells`, `widthFromColumns`; the Layout tab's actions (`canLayout`, `layout`: one undo step, typing goes on in the same cell or the one now in its place) | tables, text, selection, commands, ribbon, history |
| `findreplace.js` | Home > Editing: Find / Replace panel (Ctrl+F / Ctrl+H) over the slide; walks every slide and text box in order (hidden slides too), selects the match in its box, Replace (one step) and Replace All (one deck-wide step, autofit measured with `deck.withSlideShown`); paints every match with the CSS Highlight API (`::highlight(editor-find)`, nothing written into the deck) | text, deck, history, selection |
| `ribbon.js` | File menu and tabs (contextual tabs show only while they apply: Table Design and Layout, Picture Format); buttons only name commands; toggle buttons show `aria-pressed`; `keepsEdit` buttons do not take the focus out of the text | commands |
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

**Pictures in** (Phase 5)

```text
Insert > Pictures → images.choose → #picture-input 'change' → images.insertFiles(files)
Files dragged over the window or the deck → fileio dragover: images.isPictureDrop(items)? → drop zone "Drop to put the
  picture on this slide" : "Drop the .html deck to open it" → drop → pictures: images.insertFiles(all files) : open the deck
Ctrl+V, not typing → elements.js onPasteEvent: our newest copy → elements.paste; else a table (Excel copies cells as a
  table AND a picture of them: the table wins) → tablePaste.paste; else images.picturesIn(clipboardData) (a screenshot,
  an Excel chart: the fallback until charts, Phase 6) → images.insertFiles(pictures, 'Paste')
Ctrl+V while typing, a picture and no text on the clipboard → text.js onPaste → exitEdit → images.insertFiles: its own picture
images.insertFiles → compress each (await: canvas, PNG vs JPEG) → one history step → centred (placeRect), selected
Picture Format > Change Picture (or right-click) → images.chooseReplacement → #picture-input (one file) → images.replace:
  compress → history 'Change picture': fitInside(old box) + new src (id, z-index, alt kept)
Picture Format > Crop → crop.start: overlay.cropping (selection box hidden), crop layer drawn → a press on a crop handle
  (capture listener, before selection.js) → moveEdge, redrawn → Enter / Esc / Crop / a press elsewhere → crop.finish →
  cropImage(img, full, crop) on a canvas → history 'Crop': rect = the kept part, src = the kept pixels only
Insert > Shapes → shapecontrols gallery → a kind → commands 'insertShape' → selection.armInsert(…, { preview: drawnShape })
  → a drag (selection box shows the shape's box) or a click → elements.insertShape → drawnShape / clickedShape → shapes.createShape
  → history 'Insert shape', selected; a resize (handles or Format pane) → shapes.render
Double-click a shape (or Enter / F2 with it selected) → shapes.textOf(…, create) → text.enterEdit(.shape-text) → typing as in a
  text box (one step per typing run); Esc → exitEdit: normalizeCell, the shape selected
Insert > Chart → gallery → commands 'insertChart' → chartControls.insertChart: charts.sampleData + createChart → history 'Insert chart'
Chart Design button / list / Format pane "Chart" field → commands → chartControls changeChart: a copy of the data changed →
  history step: charts.writeData (script JSON + redraw) → history-changed → ribbon and pane show it (pane fields refresh once the
  command's Promise resolves)
Ctrl+V of Excel cells: in the grid → chartData onGridPaste; on the slide with a chart selected → elements onPasteEvent →
  chartData.pasteOnChart (before tablePaste.paste) → readCells → whole table? fromRows : fillRows → one step 'Paste chart data'
Chart data grid: a cell typed → chartData edit (mergeKey chart-cell:id:row:col) → charts.writeData → the chart redraws at
  once; + Row / + Series / × / a ⠿ drag → pure op on a copy → one step → grid rebuilt; undo → history-changed → grid rebuilt
Shape Format button / list / Format pane field → commands 'setShapeFill' … → shapecontrols changeLook → history 'Shape fill' …
  → shapes.setLook (path styles, svg filter, render for the arrow head) → history-changed → ribbon and pane show the new look
Picture Format > Reset Size → images.resetSize: resetRect(rect, naturalWidth, naturalHeight) → history 'Reset size'
Home > New Slide ▾ → layout gallery → commands 'newSlide' (layout) (Ctrl+M / Enter in the rail: slides.nextLayout) → slides.add:
  text.exitEdit, selection.clear → buildSlide → history.change('New slide', { slides: [newId] }, insert after the slide shown)
  → history-changed → thumbnails rebuild, deck.goTo(current) → slides show(newId)
Duplicate Slide (ribbon, right-click a thumbnail, Ctrl+D in the rail) → slides.duplicate → copyOf → same as above
Delete Slide (ribbon, right-click, Delete in the rail) → slides.remove → history 'Delete slide' { slides: [id] } → the next slide shown
Shift / Ctrl+click an element → selection.toggle; a drag from empty slide → rubber band → setIds(what it covers wholly) on each
  move; Ctrl+A → commands 'selectAll'; a drag on one of several → startDrag 'move' with all of them → one history 'Move' step;
  arrows / Delete / Ctrl+C / Ctrl+D / Arrange → elements.js on selection.getElements()
Arrange > Align left … / Distribute → commands 'alignObjectsLeft' … / 'distributeVertically' → elements.align / distribute →
  transform.alignRects / distributeRects on the slide or the selection's bounds → one history step on the slide
Drag a thumbnail (or Ctrl+Up / Ctrl+Down in the rail) → slides.move(from, gap) → history 'Move slide' { slides: [] } → the moved
  slide shown (after undo / redo too)
Hide Slide (Slide Show tab, right-click a thumbnail) → commands 'hideSlide' → slides.toggleHidden → history 'Hide slide' /
  'Unhide slide' { slideId } → thumbnails markHidden; the saved deck's player skips data-hidden="true"
Undo / redo of a slides step → history restores the order (listed slides from their copies, the others are the live slides) →
  'history-changed' {meta.slides} → slides.js shows meta.slides.undo / .redo
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

In `tests/e2e_test.py`, whether something is really painted (a shape, a flat line) is checked on screenshot pixels
(`dark_pixels`): the DOM reports sizes and hits for SVG the browser never paints. Each phase's "done when" is one
test (`test_phase4_done_when`, `test_phase5_done_when`): built on a new deck, saved, reopened, played on its own.
