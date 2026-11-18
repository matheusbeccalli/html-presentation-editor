# SPEC — Self-Contained HTML Presentation Editor

Oct 27, 2026 · @Matheus

## 1. Purpose and how to use this spec

Build a PowerPoint-like editor for HTML presentations that ships as **one HTML file**, runs offline in Microsoft Edge or Google Chrome, and never sends data anywhere.

**Context.** The user works in private equity at a company where most software is blocked. Available tools: VS Code, Python, a modern Chromium browser (Edge), and Microsoft Copilot. Copilot generates presentations as HTML better than as PowerPoint. This tool lets the user edit those HTML decks visually, the way they would in PowerPoint, without uploading confidential files to any website.

**Who maintains it.** The code must be readable, well commented, and explained as it is built (see section 8).

**How to use this spec with Claude Code.**

1. Save this document as `SPEC.md` in the root of the project folder.
2. Claude Code creates `FEATURES.md`: a checklist of every feature below, grouped by phase, with `- [ ]` boxes.
3. Each session, Claude Code reads `SPEC.md` and `FEATURES.md`, picks the next unchecked items in phase order, builds them, tests them, ticks them, and summarizes what changed.
4. Never start a new phase until the previous one works end to end.

If anything in this spec conflicts with the constraints in section 2, **section 2 wins**.

## 2. Non-negotiable constraints

The finished tool is a single file, `dist/editor.html`, that works by double-clicking it, with no internet, no installation and no server.

**2.1 Self-contained output**

- All HTML, CSS and JavaScript live inside `editor.html`. No `<script src="https://…">`, no CDN links, no `<link>` to external stylesheets, no web fonts (Google Fonts etc.).
- Use only fonts installed on Windows (Calibri, Arial, Segoe UI, Cambria, Consolas, Georgia, Times New Roman, Verdana), each with a generic fallback (`sans-serif`, `serif`).
- Icons are inline SVG written in the file, not icon fonts or remote images.
- Images are always stored as base64 `data:` URIs inside the HTML.

**2.2 Open-source code is copied in, never linked**

- Any library used (for example PptxGenJS, html2canvas) is downloaded once during development into `vendor/<library>/`, with its exact version, its `LICENSE` file and the URL it came from.
- `vendor/README.md` lists each library: name, version, license, source URL, and the SHA-256 hash of the file, so the code can be audited.
- Only permissive licenses: MIT, BSD, Apache-2.0, ISC. No GPL/AGPL.
- The build step (section 3) pastes the library code into `editor.html` inside `<script>` tags, with its license header kept as a comment. An "About / Licenses" dialog in the editor lists the bundled libraries.
- Prefer writing small features ourselves over adding a library. Add a library only when it saves substantial work (PPTX export, PNG export).

**2.3 Offline, enforced by the browser**

- No `fetch`, `XMLHttpRequest`, WebSocket, analytics or telemetry of any kind.
- `editor.html` declares a Content-Security-Policy meta tag that blocks all network access, so the browser itself guarantees nothing leaves the machine:

```html
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'self' blob:; child-src 'self' blob:">
```

- A loaded deck that references remote fonts or images will have them blocked. The editor shows a warning listing the blocked references and offers to remove them.

**2.4 Must run from `file://`**

- The user opens the file directly from disk. Therefore: no ES module imports between files (Chromium blocks them on `file://`), no service workers, no dev server required to run.
- Target browsers: current Microsoft Edge and Google Chrome (Chromium). Firefox and Safari are not required.

**2.5 Saved decks are self-contained too**

- A deck saved by the editor opens and presents correctly in any browser without the editor: inline CSS, base64 images, charts as static SVG, and a tiny inline player script for slide navigation (section 3.4).

**2.6 No runtime dependencies**

- Running the tool needs only the browser. Python (standard library only) is allowed for the build script. Node/npm may be used at home during development to download libraries or run tests, but the output must never depend on them.

## 3. Architecture

Develop in many small, readable source files; a Python build script merges them into the single `dist/editor.html`.

**3.1 Project structure**

```text
html-deck-editor/
├── SPEC.md                 ← this document
├── FEATURES.md             ← phase checklist, ticked as features land
├── build.py                ← merges src/ + vendor/ into dist/editor.html (stdlib only)
├── src/
│   ├── index.html          ← page skeleton with INLINE markers
│   ├── css/                ← editor.css, toolbar.css, panels.css …
│   └── js/                 ← one file per area: app.js, history.js, selection.js,
│                             text.js, tables.js, images.js, charts.js, autosave.js …
├── vendor/
│   ├── README.md           ← name, version, license, source URL, SHA-256 per library
│   ├── pptxgenjs/          ← library file + LICENSE
│   └── (html2canvas/: not needed, see 7.3)
├── samples/                ← test decks with fake data only (never real deal files)
├── tests/                  ← automated tests (section 8)
└── dist/
    └── editor.html         ← THE deliverable
```

**3.2 Build script (`build.py`)**

- Python standard library only, so it also runs on the company machine.
- `src/index.html` contains markers such as `<!-- INLINE-CSS: css/editor.css -->` and `<!-- INLINE-JS: js/app.js -->`; the script replaces each marker with the file's contents.
- Vendor libraries are inlined first, each preceded by its license comment.
- Prints the output size and fails loudly if `dist/editor.html` contains `http://` or `https://` inside any `src=`, `href=` or `url(` (the offline guarantee).
- Because there are no ES modules (section 2.4), JS files share one global object, `window.App`, and each file adds its part (`App.history = {…}`). Load order is listed once in `index.html`.

**3.3 Deck format (the "contract")**

The editor works on decks in this format. Copilot is asked to produce it (Appendix A), and the editor converts other decks into it (3.4).

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="deck-format" content="5">
  <style>
    :root { --font-heading: Calibri, Arial, sans-serif; --font-body: Calibri, Arial, sans-serif;
            --color-primary: #CC092F; --color-accent: #1F2A44; --color-text: #222; --color-bg: #fff;
            /* list style per level (Phase 3 text model); levels 3-5 follow the same pattern */
            --list-1-bullet: "•"; --list-1-number: decimal;     --list-1-indent: 24px; --list-1-space-before: 6pt;
            --list-2-bullet: "–"; --list-2-number: lower-alpha; --list-2-indent: 56px; --list-2-space-before: 3pt; …
            /* --list-N-bullet-color / --list-N-bullet-size: unset = the bullet follows the line's first character */ }
    .slide { position: relative; width: 1280px; height: 720px; overflow: hidden; }
    .el    { position: absolute; }
  </style>
  <style data-deck-table>/* table stylesheet written by the editor: grid, cell defaults, table style options */</style>
  <style data-deck-text>/* list stylesheet written by the editor: bullets, numbers, hanging indents */</style>
</head>
<body>
  <section class="slide" data-slide-id="s1">
    <div class="el" data-type="text"  data-id="e1" style="left:64px; top:48px; width:1152px; height:80px; z-index:1">
      <p data-list="none" data-level="1"><span style="font-size:32pt"><b>Sumário executivo</b></span></p>
    </div>
    <div class="el" data-type="text"  data-id="e5" style="left:64px; top:150px; width:1152px; height:400px; z-index:5">
      <p data-list="bullet" data-level="1">Receita de R$ 480 mi em 2025</p>
      <p data-list="bullet" data-level="2">Crescimento de 12% a.a.</p>
      <p data-list="number" data-level="1">Próximo passo</p>
    </div>
    <img class="el" data-type="image" data-id="e2" style="left:…" src="data:image/png;base64,…">
    <div class="el" data-type="table" data-id="e3" style="left:…">
      <table data-header-row data-banded-rows>
        <colgroup><col style="width:400px"><col style="width:200px"></colgroup>
        <tbody>
          <tr style="height:40px"><td><p data-list="none" data-level="1">Empresa</p></td>
                                  <td style="text-align:right"><p data-list="none" data-level="1">EV</p></td></tr>
        </tbody>
      </table>
    </div>
    <figure class="el" data-type="chart" data-id="e4" style="left:…">
      <script type="application/json" class="chart-data">{ … }</script>
      <svg>…static rendering…</svg>
    </figure>
    <aside class="notes">Speaker notes</aside>
    <aside class="comments">
      <div class="comment" data-comment-id="c1" data-target="e5" data-author="MB" data-date="2026-11-11T14:32:00.000Z">Checar a fonte</div>
    </aside>
  </section>
</body>
</html>
```

Text inside text elements, shapes and table cells follows the **flat-paragraph text model** (Phase 3, "Text model"): one `<p>` per line, list type and indent level as attributes, no `<ul>/<ol>/<li>` and no headings. Format 2 introduced this model; opening a format-1 deck migrates it.

Tables follow the **table model** (Phase 4, deck format 3): one `<tbody>` of `<td>` only (no `<thead>`/`<th>`: the header row is a style option), merged cells as `colspan`/`rowspan`, column widths in px in a `<colgroup>` (`table-layout: fixed`), row heights in px on each `<tr>`. The table style options are attributes on `<table>` (`data-header-row`, `data-banded-rows`, `data-total-row`, `data-first-column`), drawn by `<style data-deck-table>` from the theme variables (optional `--table-header-fill`, `--table-band-fill` … in `:root`). Look shared by most cells sits once on the `<table>`: its text look inline (cells inherit it) and its cell box as `--cell-padding`, `--cell-vertical-align`, `--cell-border-top|right|bottom|left`; a cell's own fill, borders, padding or text look is inline on its `<td>` and wins. Opening a format-2 (or older) deck converts its tables, keeping their look, and says so in the import report.

Element types: `text`, `image`, `table`, `shape`, `chart`, `group`. Every element has a unique `data-id`, absolute `left/top/width/height` in px, and a `z-index`. Theme colors and fonts come from the CSS variables in `:root`, so changing a variable restyles the whole deck. Slides may carry `data-hidden="true"` and `data-layout="title|title-content|two-columns|blank"`. A deck-level `<div class="master">` holds elements repeated on every slide (logo, footer, "Confidencial", slide number).

Review comments (Phase 9, deck format 4) live in each slide's hidden `<aside class="comments">`: one `<div class="comment">` per comment, plain text, with its id (`data-comment-id`, unique in the deck), the element it points at (`data-target` = that element's `data-id`; none = the slide), the author's initials and the date (ISO). They are saved with the deck but never shown, presented, printed or exported, and Save a Clean Copy leaves them out. Format 4 only added them, so opening a format-3 deck changes nothing but the number.

Format 5 (Phase 10) only adds attributes, so opening a format-4 deck likewise changes nothing but the number. Flip: `data-flip="x" | "y" | "xy"` on a picture (mirrored by its transform after its turn: `transform: rotate(30deg) scale(-1, 1)`) or a box shape (mirrored in its drawing: an SVG `transform` on each path, so its text is not); on a line it already said which corners the line joins. New shape kinds (`data-shape`): `triangle`, `rtTriangle`, `leftBrace`, `rightBrace`, `leftBracket`, `rightBracket` (outlines: a `path.shape-line`, no fill), `elbow` and `doubleArrow` (lines). A line's arrowheads: `data-heads="none" | "start" | "end" | "both"`, written only when they differ from its kind's own (an `arrow` has `end`, a `doubleArrow` `both`), drawn as one `path.shape-head`.

**3.4 Importing decks that do not follow the contract**

- Detect slides: `section.slide`, then `section`, then elements whose class contains "slide", then large 16:9 blocks.
- Remove the deck's own `<script>` tags (Copilot decks often include navigation code). Warn the user and list what was removed.
- "Normalize" converts flow-layout content to absolute positioning: measure each visible block with `getBoundingClientRect()` and write its position in px.
- Decks at another size (e.g. 1920×1080) are scaled proportionally to 1280×720.
- Text is converted to the flat-paragraph text model (Phase 3): nested `<ul>/<ol>/<li>` become `<p data-list data-level>`, headings become `<p>`, and the look is kept before tags and classes are removed: what is the same for the whole text box (font, size, weight, color, alignment, letter spacing, upper case) goes on the text element's own style (`.el`), and only what differs inside it becomes allowed inline formatting. Text boxes whose layout the flat model cannot express (side-by-side flex/grid content, columns) are flattened anyway and listed in the import report as boxes to check. Fonts and colors equal to the deck's theme variables are written as `var(--font-heading)`, `var(--color-accent)` …, so the theme still restyles them. A deck's own list indent and spacing, where they differ from the theme, are kept on that text box as `--list-N-indent` / `--list-N-space-before`, so its text stays where it was. Pictures inside a text block (an icon next to a heading) become their own elements, and the text box starts where the text starts.
- Show a short import report: slides found, elements converted, items removed or blocked. Charts that carry JSON data but no SVG (as Copilot produces them, Appendix A) are rendered during import.

**3.5 Editor and deck isolation**

- The deck is rendered inside an `<iframe sandbox="allow-same-origin">` (no `allow-scripts`), loaded with `srcdoc`. The editor's own code manipulates the deck's DOM; the deck's code never runs inside the editor.
- The deck DOM is the single source of truth. The editor UI (toolbars, panels, thumbnails, selection handles) lives outside it, and handles are drawn in an overlay layer, not inside the slide.

**3.6 Clean saved output**

- On save, strip everything editor-only: `contenteditable`, selection classes, temporary ids, overlay elements.
- Inject the small player script: arrow keys / PageUp / PageDown / Space to navigate, F for fullscreen, Home/End, slide counter, hidden slides skipped. The player is inert while the editor has the deck open (sandbox), and runs only when the saved file is opened on its own.
- Include print CSS so the saved file prints one slide per landscape page (section 7).

**3.7 Text editing behind one interface (escape hatch)**

- All text editing lives in `text.js`, behind one interface: `enterEdit`, `exitEdit`, `applyStyle`, `setLevel`, `toggleList`, `normalize`, `getModel`. No other module touches the HTML inside a text element; the ribbon, shortcuts, paste, import and save all go through this interface.
- Why: `contenteditable` with `document.execCommand` is the cheapest start, but browsers produce messy HTML. Behind one interface, the internals can be replaced without touching the rest of the editor.
- If bullets or selection behavior remain buggy after Phase 3, propose replacing the internals with ProseMirror or Tiptap (both MIT). Ask the user before adding either library (2.2).

## 4. Features by phase

Nine phases, built in order (a tenth, PowerPoint gaps, was added after them); the tool is usable day to day after Phase 5, and every phase ends with a "done when" test the user can run.

The interface follows PowerPoint: a ribbon with tabs (Home, Insert, Arrange, Slide Show, Export), a thumbnail rail on the left, the slide canvas in the center, a Format pane on the right that shows options for the selected object, and a notes area below the slide. Text in the UI is in English; decks may be in Portuguese.

**Phase 1: Foundation**

- Open a deck with the File System Access API (`showOpenFilePicker`), keeping the file handle so Save can overwrite it; fallback to `<input type="file">`.
- Import pipeline and import report (3.4). Open by drag-and-drop of an `.html` file onto the window.
- Thumbnail rail (live miniature of each slide), main canvas with "fit to window" zoom.
- Save (Ctrl+S, overwrite via handle), Save As (`showSaveFilePicker`; fallback: download). Unsaved-changes dot in the title, and a warning before closing the tab with unsaved changes.
- Undo/redo infrastructure (Ctrl+Z / Ctrl+Y), built now so every later feature records its changes. Approach: snapshot the affected slide's HTML before each change; keep up to 100 steps.
- Central keyboard-shortcut registry (one place that maps keys to actions; shortcuts are ignored while typing in a text field unless they are formatting shortcuts or Save / Save As / Open).
- New blank deck from a built-in template.
- **Done when:** a Copilot deck opens, shows all slides, saves back unchanged (except normalization), and the saved file presents on its own.

**Phase 2: Select, move, resize, autosave**

- Click to select; selection box with 8 resize handles drawn in the overlay layer. Drag to move; Shift while resizing keeps the aspect ratio. (Snapping, and Alt to turn it off, is Phase 7.)
- Arrow keys nudge 1 px, Shift+arrow 10 px. Delete removes. Ctrl+C / Ctrl+X / Ctrl+V / Ctrl+D (duplicate), also across slides.
- Bring forward / send backward / to front / to back.
- Format pane "Size & position": X, Y, W, H in px, editable.
- Right-click context menu with the common actions. Canvas zoom (Ctrl+mouse wheel, zoom slider, 50–400%).
- Autosave and crash recovery (section 6).
- **Done when:** any element can be moved and resized precisely, every action undoes, and killing the browser mid-edit loses at most 30 seconds of work.

**Phase 3: Text**

Nested bullets are on almost every slide the user makes, so they are the top priority of this phase.

- Double-click a text element to edit (`contenteditable`); Enter or F2 edits the selected text box; Esc or a click outside stops editing (the box stays selected). Insert text box, PowerPoint style: click the button, then click on the slide (a 360 px wide box that grows in height as you type) or drag to set its width; a new box left empty is removed.
- Toolbar: bold, italic, underline, strikethrough, superscript, subscript, font family (Windows fonts from 2.1), font size (see "Font sizes"), color, highlight, clear formatting, align left/center/right/justify. The font list starts with "Heading font (theme)" and "Body font (theme)", and the color pickers start with a row of theme colors; these are stored as `var(--font-heading)`, `var(--color-primary)` …, so changing the theme (Phase 7) restyles the text.
- Bullets and numbering with five indent levels (see "Text model" and "Bullet behavior"), line spacing and paragraph spacing.
- Format painter (copy the style of one text, apply to another).
- Autofit, stored as `data-autofit="shrink|resize|off"` on the text element: shrink scales the text down with CSS to fit the box; resize grows the box's height to fit the text. New text boxes start with `resize`; imported boxes with `off`, so they keep their look.
- Spell check in Portuguese (`spellcheck="true"`, `lang="pt-BR"`).
- Find & replace across all slides.
- All of it behind the `text.js` interface (3.7).

*Text model: flat paragraphs with levels.*

- Inside a text element, every line of body text is a `<p>`. List membership and nesting are attributes, not nested HTML: `<p data-list="bullet|number|none" data-level="1..5">…</p>`. Optional `data-start="N"` on a numbered paragraph restarts its numbering at N.
- No `<ul>/<ol>/<li>` and no headings inside text elements. This mirrors PowerPoint, where each paragraph has an indent level, and maps directly to PptxGenJS `indentLevel` and `bullet` options on export (section 7).
- Bullets and numbers are drawn with CSS (`::before` and CSS counters) from the `<style data-deck-text>` stylesheet that the editor writes into the deck (it is part of the deck and is saved with it). The paragraph gets a left padding and the bullet hangs in it, so wrapped lines align with the text, not with the bullet.
- Per-level list style is part of the deck theme (3.3), so a corporate template can define it: CSS variables `--list-N-bullet`, `--list-N-number`, `--list-N-bullet-color`, `--list-N-bullet-size` (relative to the text), `--list-N-indent` and `--list-N-space-before` for N = 1..5. Defaults: bullets level 1 "•", level 2 "–", level 3 "▪", levels 4–5 "·"; numbering 1. / a. / i. by level (then 1. / a. again at levels 4–5); bullet color and size follow the text (the two variables are left unset; a template may set a fixed color or a size relative to the text).
- Numbering: a numbered paragraph at level N counts on counter `list-N` and resets the deeper counters, so numbers count per level and reset when a higher level appears (1, 2, a, b, 3 …). A bulleted or plain paragraph at the same or a higher level ends the numbered run; the next numbered paragraph starts again at 1 unless "Continue numbering" (which writes `data-start`) is used. `data-start` is mirrored by the normalizer into an inline `counter-set` on the paragraph, because CSS cannot read a number from an attribute in every browser and saved decks must render anywhere (2.5).
- Import (3.4) and paste: nested `<ul>/<ol>/<li>` (Copilot decks, web pages), Word/Outlook list paragraphs (`mso-list: … levelN`, with their bullet glyph spans removed) and PowerPoint text become flat paragraphs with the right list type and level. Headings become `<p>`; before tags and classes are removed, the computed style (size, weight, italic, color, font, alignment, spacing) is kept: what is the same for the whole box goes on the text element's own style (`.el`), the rest becomes allowed inline formatting, so titles keep their look.
- Copying text out of the editor (Ctrl+C inside a text element) also puts nested `<ul>/<ol>` HTML on the clipboard, so bullets survive a paste into Outlook or Word, which do not understand `data-list`.
- Deck format: this model is `deck-format` 2 (8.2). Opening a format-1 deck migrates its text with the import conversion, adds the list variables and `<style data-deck-text>`, and says so in the import report.

*Bullet behavior (matches PowerPoint).* Tab, Shift+Tab, Alt+Shift+arrows and the toolbar act on every selected line at once, including mixed selections (bulleted, numbered and plain lines together). Nothing here acts during IME composition.

| Key / action | Where | Result |
| --- | --- | --- |
| Tab | at the start of a line, or several lines selected | Demote one level (max 5) |
| Tab | in the middle of text | Nothing (no tab character is inserted) |
| Shift+Tab | at the start of a line, or several lines selected | Promote one level (min 1) |
| Alt+Shift+Right / Alt+Shift+Left | anywhere in the line | Demote / promote one level |
| Enter | in a non-empty list line | New line, same level and list type |
| Enter | in an empty list line | Promote one level; at level 1 the line becomes plain text |
| Shift+Enter | anywhere | Line break inside the same paragraph (no new bullet) |
| Backspace | at the start of a list line, level > 1 | Promote one level |
| Backspace | at the start of a list line, level 1 | Remove the bullet/number (the line becomes plain text) |
| Backspace | at the start of a plain line | Merge with the line above |
| Type "- " or "* " | at the start of a plain line | Start a bullet (the typed characters are removed) |
| Type "1. " | at the start of a plain line | Start numbering (another number, e.g. "3. ", starts at that number) |
| Ctrl+Z | right after an autoformat | Undo only the autoformat (the typed "- " stays as text) |
| Toolbar | Bullets / Numbering | Toggle the list type on every selected line |
| Toolbar | Increase / Decrease indent | Demote / promote every selected line |
| Toolbar | Restart numbering / Continue numbering | Restart writes `data-start="1"`; Continue writes `data-start` = the next number of the previous numbered run at that level |

*Font sizes.*

- Sizes in points, like PowerPoint: a dropdown with 8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 54, 60, 66, 72, 80, 88, 96, and a field for typed values. Increase / decrease buttons step through that list; shortcuts Ctrl+Shift+> / Ctrl+Shift+<, plus Ctrl+] / Ctrl+[ (same keys on every keyboard layout).
- Stored as `font-size` in pt on a `<span>` (1 pt = 96/72 px, consistent with the 1280×720 slide and with PPTX export). Never `document.execCommand('fontSize')`, which only knows 7 sizes. Sizes imported in px are shown in pt (px × 0.75, rounded to 0.5).
- When the selection mixes sizes, the size field is blank, as in PowerPoint.

*Normalizer: the defense against messy browser HTML.*

- One function, `App.text.normalize(element)`, rewrites the HTML inside a text element into an allowed set:
  - `<p>` with `data-list`, `data-level`, `data-start`, and a style limited to `text-align`, `line-height`, `margin-top`, `margin-bottom`, plus values the normalizer derives itself: the `counter-set` from `data-start` (CSS applies `counter-set` after `counter-increment`, so it is the start number itself); `--marker-size` and `--marker-color` copied from the paragraph's first character, read only by the bullet or number, so bullets follow the text as in PowerPoint without changing the rest of the line; `font-size` when every character of the line has the same size, so the line is exactly as tall as its text; and, on an empty line, `font-size` and `color`, so it keeps its height and what is typed into it starts with that look (the normalizer gives them, as a span, to any text that has no size or color of its own);
  - `<b>`, `<i>`, `<u>`, `<s>`, `<sup>`, `<sub>`, `<br>`, `<a href>`;
  - `<span>` with a style limited to `font-family`, `font-size`, `color`, `background-color`; a value may be a theme variable (`var(--font-heading)`, `var(--font-body)`, `var(--color-…)`).
- Conversions: `<strong>`→`<b>`, `<em>`→`<i>`, `<font>`→`<span>`, `<div>`→`<p>`, nested lists→flat paragraphs, text directly inside the element→wrapped in `<p>`. Unknown tags are unwrapped (their text is kept). `class`, `id` and every other attribute or style property are removed. Empty spans are removed and adjacent spans with identical styles are merged. `<a href>` keeps only `http:`, `https:` and `mailto:` links (no `javascript:`).
- The text element's own style (`.el`: default font, size, color, padding) is not touched; the normalizer only rewrites what is inside it.
- When it runs: on leaving text-edit mode, after every toolbar command, after paste, after import, and before save. Not on every keystroke, so the cursor never jumps while typing. When it runs during editing, it preserves the user's selection.
- Running it twice gives the same result as running it once (idempotent); this is tested.

*Paste into text.*

- Ctrl+V keeps structure and basic formatting (bold, italic, underline, bullets and levels, links) through the normalizer, but drops fonts, sizes and colors so the pasted text matches the deck's theme (PowerPoint's "Use Destination Theme"). Text copied inside the editor (marked in the copied HTML) keeps all its formatting.
- Ctrl+Shift+V pastes plain text only. A small paste-options button appears after a paste and switches between the two, like PowerPoint.
- Must handle paste from Word, Outlook, PowerPoint, Copilot's chat window and web pages. Test fixtures are real clipboard captures (fake text) made with `tests/clipboard-capture.html`.

*Undo for text.*

- The browser's own text undo is intercepted (`beforeinput` with `historyUndo` / `historyRedo`) and routed to `history.js`, so there is only one undo stack.
- Typing is grouped into undo steps: a new step after a 1-second pause or a new paragraph. Every formatting or list command is its own step.
- Each text step also stores the cursor position, so undo and redo while editing put the cursor back where it was.

- **Done when:** a 3-level bulleted slide imported from a Copilot deck and a 3-level list pasted from Word both become editable flat paragraphs; every behavior in the bullet table works; a slide title and a bulleted paragraph can be fully reformatted without touching code; and the saved deck prints to PDF (Ctrl+P on the saved file) with bullets, numbers and indents as on screen.

**Phase 4: Tables**

- Insert a table from a grid picker (up to 10×10). Click into cells to edit; Tab / Shift+Tab move between cells; Tab in the last cell adds a row.
- Add/delete rows and columns, merge and split cells (`colspan` / `rowspan`), drag column borders to resize.
- Cell fill, borders, padding, vertical alignment. Table styles: header row, banded rows, total row (bold top border), first-column emphasis.
- Numbers: right-align numeric columns, format buttons for thousands separator and decimals in pt-BR (1.234,5) or en-US (1,234.5), percent, and negatives in parentheses.
- **Paste from Excel:** read the clipboard's `text/html` (Excel puts a table there) and create a native editable table; fallback to tab-separated `text/plain`. Pasting into an existing table fills cells from the cursor.
- **Done when:** a comps table copied from Excel becomes an editable, formatted table on the slide in under a minute.

**Phase 5: Images and shapes**

- Insert image from file, by drag-and-drop, or paste from clipboard (screenshots via Win+Shift+S then Ctrl+V).
- Replace image (keeps position and size), crop (handles; stored as a true crop via `<canvas>`), reset size.
- Compress on insert: longest side max 1920 px, JPEG quality 0.85 unless the image has transparency (keep PNG). Show deck file size in the status bar.
- Shapes: rectangle, rounded rectangle, ellipse, line, arrow, chevron, pentagon (process steps), callout. Built with CSS or inline SVG.
- Fill, border (color, width, dash), shadow, transparency; text inside shapes.
- **Done when:** a process diagram of chevrons and a logo screenshot can be built on a slide without leaving the editor.

**Phase 6: Charts**

- Full requirements in section 5.

**Phase 7: Arrange and slides**

- Multi-select (Shift+click, or drag a rectangle on empty canvas). Align left/center/right/top/middle/bottom; distribute horizontally/vertically.
- Smart guides and snapping to slide edges, center lines and other elements (5 px threshold); Alt while dragging disables snapping. Optional gridlines and rulers.
- Group / ungroup (Ctrl+G / Ctrl+Shift+G), rotate (handle and degrees field), lock element.
- Slides: add (with layout picker), duplicate, delete, reorder by dragging thumbnails, hide slide.
- Slide master: logo, footer text, "Confidencial" label, automatic slide numbers; shown on every slide, editable in one place.
- Theme editor: edit the `:root` CSS variables (colors, fonts) with a live preview.
- Speaker notes panel under the canvas.
- **Done when:** a 15-slide deck can be restructured, aligned and rebranded in minutes.

**Phase 8: Present and export**

- Full requirements in section 7.

**Phase 9: Polish**

- Review comments: sticky notes attached to a slide or element, with author initials and date; never shown when presenting, printing or exporting; "Delete all comments" before sending.
- Keyboard shortcut cheat sheet (press `?`), About / Licenses dialog (2.2).
- Status bar: slide X of Y, zoom, file size, autosave state.

**Phase 10: PowerPoint gaps** (added 2026-11-15, after the nine phases above, from a comparison with PowerPoint's ribbons)

- Deck format 5 (one bump for the whole phase): element names and hidden state, flips, slide links, the new shapes and arrowheads. Format-4 decks are upgraded on open (only the version number changes).
- Flip Horizontal / Flip Vertical for shapes and pictures (Arrange > Rotate), together with rotation; PowerPoint export uses its own flip.
- Text boxes: Align Text top / middle / bottom, inner margins (Format pane), Change Case (Shift+F3 cycles; Aa menu: Sentence case, lowercase, UPPERCASE, Capitalize Each Word, tOGGLE cASE; the letters themselves change). All three go into the PowerPoint export.
- Eyedropper (the browser's own `EyeDropper`, no library) in every colour list: text, highlight, fill, outline, table cell, chart series, theme.
- Shapes: triangle, right triangle, left / right brace, left / right bracket, elbow line, double arrow; arrowheads at the start and / or end of lines. Exported as PowerPoint's own shapes. The elbow line is not glued to the boxes it joins.
- Selection Pane (Alt+F10): the slide's elements front to back; click selects (Ctrl+click adds), double-click renames, the eye hides (saved, as in PowerPoint: a hidden element is left out of the slide show, print / PDF, pictures and PowerPoint export, and the export report lists it), dragging changes the order. Tab / Shift+Tab step through the slide's elements.
- Hyperlinks (Ctrl+K) on text: a web address, an e-mail address or another slide of the deck; edit and remove. Ctrl+click follows a link in the editor, a click in the slide show and the saved deck; kept in the PowerPoint export and (web links) in the PDF.
- Slides: select several thumbnails (Shift+click a range, Ctrl+click one more); Copy / Cut / Paste (Ctrl+C / X / V) slides in the rail, pasted after the current slide (Ctrl+V on the slide with nothing selected pastes slides too); Delete, Duplicate, Hide and drag act on every selected slide. A copy keeps its notes, comments and hidden state and gets new ids.
- Reuse Slides (Home > New Slide ▾ > Reuse Slides…): pick another deck's `.html`, see its slides, tick the ones to insert after the current slide (notes, pictures, charts and comments come along; they follow this deck's theme; the other deck's slide master is not brought in). Elements and slides copied in one editor tab paste whole into another.
- Language of the deck (Review > Language: Portuguese or English): written to `<html lang>` and to the PowerPoint export's text, so PowerPoint checks spelling in that language. Edge checks spelling in the languages turned on in its own settings (it ignores the page's language), so the editor explains where to set them.

## 5. Charts

Charts are native and editable: data lives as JSON inside the chart element, and our own SVG renderer draws a static SVG next to it, so saved decks show charts without any library.

**5.1 Why our own renderer, not a charting library**

- A library such as Chart.js draws at runtime, so every saved deck would need the library inside it. Static SVG needs nothing.
- SVG is vector: crisp when zoomed, printed or exported to PDF.
- The same JSON can later feed PptxGenJS to create native, editable PowerPoint charts (section 7).
- Business charts (columns, bars, lines, waterfalls) are simple geometry; writing them ourselves is manageable and fully controllable.

**5.2 Chart types**

| Priority | Type | Typical PE use |
| --- | --- | --- |
| 1 | Clustered column | Revenue by year, by segment |
| 1 | Stacked column | Revenue mix by business line |
| 1 | Horizontal bar | Ranking of competitors, comps |
| 1 | Line | Margins, multiples over time |
| 1 | Combo: columns + line on secondary axis | Revenue (R$) with EBITDA margin (%) |
| 1 | Waterfall | EBITDA bridge, value-creation bridge, sources & uses |
| 1 | Donut / pie | Shareholder structure, revenue split |
| 2 | 100% stacked column / stacked bar | Mix comparison across years or peers |
| 2 | Scatter / bubble | Comps: EV/EBITDA vs growth, bubble = size |
| 2 | Area | Cumulative metrics |

**5.3 Data editor**

- Double-click a chart to open the data grid (a spreadsheet-like table in the Format pane): rows = categories (e.g. 2022, 2023, 2024, 2025E), columns = series.
- Paste from Excel into the grid (same clipboard logic as tables, Phase 4). Add/remove rows and series; reorder by dragging.
- Per series: name, color, chart type and axis (primary/secondary) for combo charts.
- Per category: mark as **estimate/projection**, drawn with a lighter fill or hatching and an "E" suffix option.
- Waterfall rows have a role: start, increase/decrease, subtotal, end. Positive and negative bars are colored automatically (configurable), with connector lines between bars.
- The preview updates live; every edit is undoable.

**5.4 Formatting options**

- Title, axis titles, legend (top/bottom/right/hidden), gridlines on/off, axis min/max (auto by default), gap width between bars.
- Data labels on/off, position (inside end, outside end, center), number format: decimals, thousands separator in pt-BR or en-US, percent, negatives in parentheses, units text (e.g. "R$ mn").
- Colors default to the theme variables (`--color-primary`, `--color-accent`, plus a derived palette), fonts from `--font-body`.
- Annotations: CAGR arrow between two columns (e.g. "CAGR 18%", computed automatically), and a source/footnote line under the chart ("Fonte: empresa").

**5.5 Storage format (example)**

```json
{
  "version": 1,
  "type": "combo",
  "categories": ["2022", "2023", "2024", "2025E"],
  "estimates": [false, false, false, true],
  "series": [
    { "name": "Receita (R$ mn)", "type": "column", "axis": "primary",   "values": [410, 498, 587, 702] },
    { "name": "Margem EBITDA",   "type": "line",   "axis": "secondary", "values": [0.18, 0.20, 0.21, 0.23], "format": "percent" }
  ],
  "options": { "title": "Receita e margem", "legend": "bottom", "dataLabels": true, "locale": "pt-BR",
               "cagr": { "series": 0, "from": 0, "to": 3 }, "source": "Fonte: empresa" }
}
```

**5.6 Renderer requirements**

- One pure function: `App.charts.render(json, width, height)` returns an SVG string. Same input, same output; no randomness, no timing.
- Resizing a chart re-renders it at the new size (never stretches the SVG), so text stays the same size.
- "Nice" axis ticks (round numbers such as 0, 200, 400), simple label collision handling (shrink, rotate or skip category labels).
- Unit tests for the renderer with fixed inputs (section 8).
- Fallback: a chart can also be pasted from Excel as an image (Phase 5), for chart types not supported here.

**Done when:** an EBITDA bridge and a revenue-plus-margin combo chart can be built from data pasted from Excel, edited, saved, reopened, and printed to PDF with sharp lines.

## 6. Autosave

Autosave has two independent layers: writing changes back to the deck file itself, and crash-recovery drafts kept in the browser. Either one alone must protect the user's work.

**6.1 Layer 1: autosave to the file (like PowerPoint's AutoSave)**

- Available when the deck was opened through the File System Access API with write permission (Chromium asks the user once per session).
- An **AutoSave on/off toggle** sits in the title bar. It turns on automatically after the user's first manual save in the session, so the original file is never overwritten without the user having chosen to save at least once.
- Timing: save 5 seconds after the last change, and at most every 30 seconds during continuous editing. Never save in the middle of a drag, a resize, or while an IME/text composition is in progress.
- Writes are safe by design: `createWritable()` writes to a temporary file and only replaces the original when closed, so a crash mid-write cannot corrupt the deck.
- Before each write, compare the file's `lastModified` with the value at open/last save. If someone else changed the file on disk, pause autosave and ask: overwrite, save as a copy, or reload.
- "Revert to version opened": the deck as it was when opened is kept for the session, so the user can always go back even after autosave overwrote the file.

**6.2 Layer 2: crash-recovery drafts in the browser**

- Stored in **IndexedDB** (not `localStorage`, whose \~5 MB limit is too small for decks with base64 images).
- Every 30 seconds while there are unsaved changes, store a snapshot of the full deck HTML with a timestamp. Keep the last 5 snapshots per deck.
- Each deck gets a stable id (`<meta name="deck-id">`) so drafts match the right file even if it is renamed. The id is given in memory as soon as the deck opens (not counted as a change) and is written into the file with the next save. A file that has no id yet (never saved by the editor) is matched to its drafts by file name.
- On startup, or when opening a deck that has drafts newer than the file, show a dialog: "Unsaved changes from 27/10 14:32 were found", with a thumbnail of slide 1 and buttons Recover / Compare / Discard.
- Drafts exist only while there are unsaved changes: a deck's drafts are deleted after a successful save to file, and when the tab is closed with no unsaved changes. All drafts are purged automatically after 1 day (setting: 1–30 days).
- Optional, off by default: a "Recent files" list, which stores file handles (and so file names) in IndexedDB. Pages opened from disk cannot ask for permission again, so choosing a recent file opens the Open window in that file's folder.

**6.3 Privacy controls (decks are confidential)**

- Chromium gives every page opened from disk (`file://`) one shared storage area (verified 2026-10-28). Any other HTML file the user opens from disk in the same browser profile, such as an email attachment or a deck previewed on its own, can read the editor's drafts. Encryption cannot fix this, because the key would sit in the same shared storage. Hence the minimal exposure above: drafts only while there are unsaved changes, short retention, Recent files off by default.
- Settings: "Keep recovery drafts in this browser" on/off (on by default), retention days (default 1), "Remember recent files" on/off (off by default; turning drafts off turns it off too), and a **"Delete all drafts now"** button that empties the editor's whole IndexedDB, Recent files included.
- The settings themselves are kept in `localStorage` (they contain no deck content), so "Delete all drafts now" does not reset them. Settings are under File > Settings….
- A short note in Settings explains, in plain words, that drafts stay only in this browser profile on this computer, are not uploaded or synced, are deleted on save or after the retention period, and can be read by other HTML files opened from disk in this browser.
- If IndexedDB is unavailable (for example blocked by company policy for `file://` pages), detect it at startup, show "Crash recovery unavailable" in the status bar, and rely on Layer 1. The editor must never fail because storage is blocked; wrap every storage call in `try/catch`.

**6.4 Status indicator**

The status bar always shows one of: Saved · Saving… · Unsaved changes · AutoSave off · Draft saved 14:32 · Recovery unavailable.

In practice it shows the file's state first (Saved, Saving…, Unsaved changes, or AutoSave off when AutoSave was on and was switched off or paused), followed by "Draft saved 14:32" while a draft protects the unsaved changes and by "Recovery unavailable" when storage is blocked, for example "Unsaved changes · Draft saved 14:32". A new deck that is in no file yet shows "Not saved yet".

**6.5 Out of scope**

Undo history is not persisted across sessions; reopening a deck starts a fresh history.

**Done when:** (1) with AutoSave on, closing the tab after an edit and reopening the file shows the edit; (2) with AutoSave off, killing the browser process mid-edit and reopening the editor offers to recover changes no older than 30 seconds; (3) "Delete all drafts now" leaves nothing in IndexedDB (verified in DevTools > Application).

## 7. Present and export (Phase 8)

PDF export comes first because it is how IC materials usually circulate; PPTX export comes last because it is the hardest and will never be pixel-perfect.

**7.1 Slideshow and presenter view**

- F5 from the first slide, Shift+F5 from the current one. Fullscreen API, slide scaled to fit with black letterboxing.
- Arrows / Space / PageUp / PageDown / click to navigate; type a number + Enter to jump; B for black screen; Esc to exit. Hidden slides skipped; comments never shown.
- Presenter view: a second window (`window.open`) with the current slide, next slide, speaker notes, elapsed timer and clock, kept in sync with the main window via `postMessage`. If the browser blocks the pop-up, explain how to allow it.

**7.2 PDF (via the browser's print dialog)**

- `window.print()` with print CSS: `@page { size: 13.333in 7.5in; margin: 0 }`, one slide per page, `print-color-adjust: exact` so backgrounds and fills print.
- Options before printing: all slides, current slide, or a range; include/exclude hidden slides. Comments and editor UI never print.
- The user picks "Save as PDF" in the print dialog; show a one-line hint the first time.
- Charts and shapes are SVG/CSS, so they stay vector and sharp in the PDF.

**7.3 Images**

- Export the current slide or all slides as PNG at 2× resolution, drawn by the browser itself (the slide wrapped in an SVG `<foreignObject>` and drawn into a canvas; decided in the Phase 8 Q&A, 2026-11-11, instead of the vendored html2canvas: no library, and the picture matches the screen).
- "Copy slide as image" to the clipboard, for pasting into Outlook or Teams (`navigator.clipboard.write`; if blocked, fall back to downloading the PNG).
- All slides at once: download as a ZIP using **JSZip** (MIT). Reuse the copy bundled inside PptxGenJS's bundle build if present; otherwise vendor JSZip separately.

**7.4 PowerPoint (.pptx)**

- Use the vendored **PptxGenJS** (MIT). Slide size 13.333 × 7.5 in; convert positions with `inches = px / 96`.
- Mapping:

| Deck element | In PowerPoint |
| --- | --- |
| Text | Native text box with runs (bold, italic, underline, size, color, font), bullets and indent levels, alignment |
| Image | Native image (with crop applied) |
| Table | Native table: merged cells, fills, borders, alignment |
| Shape | Native shape (rectangle, rounded rectangle, ellipse, line, arrow, chevron, pentagon) with fill and border |
| Chart (column, bar, line, combo, donut, pie, area, scatter, bubble) | Native editable chart built from the chart JSON |
| Waterfall chart | Stacked column with an invisible base series (editable), or image if that fails |
| Speaker notes | PowerPoint speaker notes |
| Anything unsupported | Rasterized by the browser (as for PNG export, 7.3) and inserted as an image |

- After export, show a report listing anything that was rasterized or simplified, so the user knows what to check in PowerPoint.

**7.5 Clean copy for sending**

- "Save a clean copy": Save As with review comments removed, hidden slides optionally removed, and drafts left untouched.

**Done when:** a 10-slide deck with text, a table, an image, a combo chart and a waterfall exports to a PDF that matches the screen, and to a PPTX where text, tables and the combo chart are editable in PowerPoint.

## 8. Working agreements for Claude Code

The code must stay readable, every feature is tested before it is ticked, and no real deal data ever enters the project.

**8.1 Code style**

- Plain modern JavaScript, HTML and CSS. No TypeScript, no React/Vue, no npm packages in the output.
- Small functions with descriptive names; comments explain *why*, not just *what*. Each file starts with a header comment: what it does and which other files it talks to.
- Prefer clear code over clever code. No long chains of one-liners.
- Maintain `ARCHITECTURE.md`: a one-page map of the modules and how a user action flows through them (e.g. click → selection.js → history.js → deck DOM → thumbnails).

**8.2 Explaining to the user**

- After each feature, give a short summary: files changed, the key idea in plain words, and how to test it by hand.
- When a JavaScript concept appears for the first time, compare it to Python: `const`/`let` vs variables, arrays vs lists, objects vs dicts, `addEventListener` callbacks vs passing a function as an argument, `async/await` vs Python's `asyncio`, `try/catch` vs `try/except`.
- Ask before adding any library (section 2.2) or changing the deck format (3.3). If the format changes, bump `deck-format` and write a migration that upgrades older decks on open.

**8.3 Testing**

- `samples/` holds fake decks only: one that follows the contract, one messy Copilot-style deck (flow layout, its own scripts, remote font links), one at 1920×1080, and one heavy deck (40+ slides, many images) for performance.
- `tests/run-tests.html`: a self-contained test page that runs unit tests for the pure functions (chart renderer, number formatting, import normalization, px↔inch conversion) and shows pass/fail. It needs nothing but the browser, so tests also run on the company machine.
- Text (Phase 3): unit tests with HTML fixtures of fake text: messy `execCommand` output, Word paste HTML with `mso-list` levels, a Copilot deck with a 3-level nested `<ul>`, and mixed numbered/bulleted lists. The normalizer is tested for idempotence (running it twice equals running it once).
- Text (Phase 3): a key-sequence test table for the bullet behavior (starting paragraphs + keys → expected paragraphs, list types and levels), run automatically.
- Optional, at home only: end-to-end tests with Playwright for Python (open deck, edit, save, reopen, compare).
- Each phase also gets a short manual checklist in `FEATURES.md` based on its "done when" test.
- Run `build.py` and its offline check (3.2) before declaring any task done.

**8.4 Performance**

- A 50-slide deck with 20 MB of images must stay responsive: thumbnails re-render lazily (debounced, only visible ones), and autosave never blocks typing.

**8.5 Version control**

- Use Git. Commit after each working feature with a clear message (e.g. `Phase 4: paste tables from Excel`).
- Never commit real deal files, client names or financials. Keep any real decks used for testing only in a `private/` folder that `.gitignore` excludes.

**Appendix A: prompt for Copilot when generating a deck**

```text
Create the presentation as ONE self-contained HTML file following these rules exactly:
- Each slide is <section class="slide" data-slide-id="sN"> of exactly 1280x720 px.
- Every text box, image, table, shape and chart inside a slide is a direct child with class "el",
  a data-type attribute (text, image, table, shape, chart), a unique data-id,
  and position:absolute with left, top, width and height in px.
- Put colors and fonts in CSS variables in :root: --font-heading, --font-body, --color-primary,
  --color-accent, --color-text, --color-bg. Use only Windows fonts (Calibri, Arial, Segoe UI)
  with a sans-serif fallback.
- No external resources: no CDN, no Google Fonts, no remote images, no <script> tags for logic.
  Use a placeholder box with the text "[image]" where an image should go.
- Text: every line of text is a <p>. Bullets and numbering are attributes, not lists:
  <p data-list="bullet" data-level="1">, data-list="number" for numbered lines,
  data-list="none" for plain text, data-level 1 to 5 for the indent level.
  Do not use <ul>, <ol>, <li> or <h1>-<h6>; make titles larger and bold with style on the text box.
- Tables are real <table> elements, with numbers right-aligned.
- Charts: <figure class="el" data-type="chart"> containing only
  <script type="application/json" class="chart-data"> with this structure:
  {"version":1,"type":"column|stacked-column|bar|line|combo|waterfall|donut",
   "categories":[...],"series":[{"name":"...","values":[...]}],"options":{"title":"..."}}
  Do not draw the chart; the editor renders it.
- Speaker notes go in <aside class="notes"> inside each slide.
```

The editor draws these charts itself during import (section 3.4), so Copilot only has to supply the numbers.

