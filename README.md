# HTML Presentation Editor

A PowerPoint-like editor for HTML slide decks that ships as **one HTML file**. Double-click `dist/editor.html`, and it runs offline in Microsoft Edge or Google Chrome: no installation, no server, no account, and nothing ever leaves your computer.

![The editor with a sample deck open: ribbon on top, slide thumbnails on the left, the slide in the middle and the Format pane on the right](docs/images/editor.png)

## Why it exists

AI assistants such as Microsoft Copilot are better at writing a presentation as HTML than as a PowerPoint file. But an HTML deck is hard to touch up afterwards: moving a box or fixing a chart means editing code.

This project fills that gap, for people who work on a locked-down company computer:

- **Nothing to install.** The whole editor is a single file you open in the browser you already have.
- **Safe for confidential decks.** The editor has no network code, and a Content-Security-Policy makes the browser itself block every connection. Your files stay on your disk.
- **Familiar.** The interface follows PowerPoint: ribbon tabs, thumbnails, a Format pane, speaker notes and the same keyboard shortcuts.
- **The deck is a plain HTML file.** A saved deck opens and presents on its own in any browser, without the editor.

## Quick start

1. Download `editor.html` from the [latest release](https://github.com/matheusbeccalli/html-presentation-editor/releases/latest) (or clone the repository and use [`dist/editor.html`](dist/editor.html)).
2. Double-click it. It opens in Edge or Chrome.
3. Choose **New blank deck**, or **Open a deck…** to pick an `.html` deck. To try it out, open [`samples/contract-deck.html`](samples/contract-deck.html).
4. Edit as you would in PowerPoint. Ctrl+S saves back into the same file; press `?` for the list of shortcuts.

To have an AI assistant write a deck the editor opens cleanly, see [Asking an AI to write a deck](#asking-an-ai-to-write-a-deck).

**Just want a look?** Try the [live demo](https://matheusbeccalli.github.io/html-presentation-editor/dist/editor.html). It is the very same file served from GitHub Pages, and it still uploads nothing: your decks stay in your browser. For confidential work, download the file and run it from your own disk anyway, so you do not depend on a website.

## Browser support

The editor is built and tested for **desktop Microsoft Edge and Google Chrome**. Other Chromium browsers should behave the same.

**Firefox** opens the editor, and editing works, but it is not tested there and some things are missing because Firefox lacks the browser features behind them:

| In Firefox | What happens instead |
| --- | --- |
| Save (Ctrl+S) cannot write back into the file you opened | Save and Save As download a new copy to your Downloads folder each time. A banner under the ribbon says so. |
| AutoSave to the file | Not available (the switch is hidden). |
| Recent files | Not available, because the browser cannot keep a link to a file. |
| Eyedropper in the colour menus | Not available. |
| Everything else | Expected to work, but only Edge and Chrome are checked by the tests, so small differences in text layout or the clipboard are possible. |

Safari has the same limits as Firefox. Phones and tablets are not supported: the editor needs a mouse and a keyboard.

Decks *saved* by the editor are plain HTML and present correctly in any modern browser.

## Main features

| Area | What you can do |
| --- | --- |
| **Files** | Open, Save (overwrites the file), Save As, drag-and-drop a deck onto the window, AutoSave to the file, crash-recovery drafts, optional recent files |
| **Import** | Opens decks written by Copilot or by hand: finds the slides, removes their scripts and remote resources, converts flow layout into positioned boxes, and shows a report of what changed |
| **Editing** | Select, move, resize, rotate, flip, nudge with the arrow keys, copy / paste (also between slides and browser tabs), undo / redo (100 steps), right-click menu, zoom |
| **Text** | Fonts, sizes in points, colours, highlight, alignment, line and paragraph spacing, five levels of bullets and numbering that behave like PowerPoint's, autofit, format painter, change case, hyperlinks, find and replace |
| **Paste** | Text from Word, Outlook, PowerPoint and web pages keeps its bullets and levels; a range copied from Excel becomes an editable table |
| **Tables** | Insert, add and delete rows and columns, merge and split cells, resize columns, fills and borders, header / banded / total row styles, number formats (pt-BR and en-US) |
| **Pictures** | Insert from a file, by drag-and-drop or from the clipboard (screenshots); crop, replace, automatic compression |
| **Shapes** | Rectangles, ellipses, triangles, lines and arrows, chevrons, callouts, braces and brackets, with fill, outline, shadow, transparency and text inside |
| **Charts** | Column, stacked column, bar, line, combo with a second axis, waterfall, donut / pie, 100% stacked, scatter / bubble, area. Data is edited in a grid (paste from Excel), with data labels, estimate years, CAGR arrows and a source line |
| **Arrange** | Multi-select, align, distribute, smart guides and snapping, rulers and gridlines, group, lock, bring forward / send backward, Selection Pane |
| **Slides** | Add from four layouts, duplicate, delete, reorder, hide, copy and paste, reuse slides from another deck, per-slide background colour |
| **Design** | Theme editor (colours and fonts change the whole deck), copy the theme from another deck, slide master (logo, footer, confidentiality label, slide numbers) |
| **Review** | Comments attached to a slide or an element, speaker notes, deck language |
| **Present** | Slide show (F5), presenter view in a second window with notes, timer and next slide |
| **Export** | PDF (through the browser's print dialog), PNG of one slide or all slides (ZIP), copy a slide as a picture, PowerPoint `.pptx` with editable text, tables and charts, "Save a Clean Copy" without comments and hidden content |

The full list, feature by feature, is in [FEATURES.md](FEATURES.md).

## Compared with PowerPoint

The goal is the 90% of PowerPoint used to build business slides, not a complete clone.

**What it has that PowerPoint does not**

- It is one file that runs anywhere Edge or Chrome runs, with nothing installed.
- Decks are readable HTML, so an AI assistant, a script or a text editor can create and change them.
- A saved deck presents and prints by itself in any browser.
- Estimate years ("2025E") and automatic CAGR arrows are built into the chart editor.
- The browser guarantees the tool is offline.

**What works the same way**

The ribbon layout, the Format pane, bullets and indent levels (Tab / Shift+Tab), the common shortcuts (Ctrl+D, Ctrl+G, Ctrl+K, Ctrl+M, F5, Shift+F5, Alt+F10 …), paste options, AutoSave, slide master, theme colours, Selection Pane, presenter view and speaker notes.

**What it does not have**

| Missing | Notes |
| --- | --- |
| Opening `.pptx` files | The editor opens HTML decks only. It can *export* to `.pptx`. |
| Animations and slide transitions | Animations in an imported deck are switched off. |
| Video and audio | |
| SmartArt, WordArt, equations, 3D | A process diagram is built from chevrons and other shapes. |
| Gradient and picture fills | The editor offers solid colours only. A shape imported with a gradient or picture fill exports to PowerPoint as a picture. |
| Connectors glued to shapes | Lines and elbow lines stay where you put them. |
| Custom slide layouts, several masters | Four built-in layouts and one slide master per deck. |
| Other slide sizes | Slides are always 16:9 (1280 × 720 px); other sizes are scaled on import. |
| Co-authoring, version history, cloud storage | It is an offline, single-user tool by design. |
| Embedded fonts | Decks use the fonts installed on Windows (Calibri, Arial, Segoe UI …). |
| A spelling checker of its own | Spelling comes from the browser, in the languages set in the browser's settings. |
| Firefox, Safari, phones and tablets | Built and tested for desktop Edge and Chrome. |

The PowerPoint export is not pixel-perfect. Text, tables, shapes and most charts become native, editable PowerPoint objects; anything PowerPoint cannot express is inserted as a picture, and a report after the export lists those items.

## Similar projects

This is not the only tool of its kind. If it does not fit what you need, one of these may:

| Project | What it is | How this editor differs |
| --- | --- | --- |
| [Bento](https://github.com/nyblnet/bento) | A complete presentation editor in a single HTML file, with charts, animations, presenter mode and optional live collaboration. The best known project in this space. | Bento stores a deck in its own format inside the file and has optional network features (update checks, collaboration) with an offline switch. This editor has no network code at all, works on plain HTML decks written by other tools, and exports editable PowerPoint files. |
| [NextPPT](https://github.com/Trade-Offf/NextPPT) | A browser editor for AI-written HTML decks: click to edit text, drag and resize, export to PDF and PowerPoint. | NextPPT needs Node.js and a local server, and its PowerPoint export is made of pictures. This editor is one file with nothing to install, and its export keeps text, tables and charts editable. |
| [PPTist](https://github.com/pipipi-pikachu/PPTist) | A mature PowerPoint-like web application with animations and PowerPoint export. | PPTist is a web application with its own deck format. This editor is a single offline file whose decks are ordinary HTML. |
| [reveal.js](https://revealjs.com/), [Marp](https://marp.app/), [Slidev](https://sli.dev/) | Popular frameworks for writing slides as HTML or Markdown. | They are written as code or Markdown. This editor is for people who want to point, click and drag. |

The descriptions come from each project's own documentation in November 2026 and may be out of date; check the projects themselves.

What this editor concentrates on:

- **Offline by construction.** There is nothing to switch on: the file contains no network code, and its Content-Security-Policy makes the browser refuse any connection.
- **Other people's HTML.** It opens decks written by an AI assistant or by hand and converts them, instead of expecting its own format.
- **A real PowerPoint export.** Text, tables, shapes and charts arrive in PowerPoint as editable objects.
- **Business slides.** Paste from Excel into tables and charts, waterfall charts, number formats, a slide master and theme colours.
- **Locked-down computers.** One file, no installation, no account, no server.

## Deck format

A deck is one self-contained HTML file: each slide is a `<section>` of 1280 × 720 px, and each object on it is an absolutely positioned element.

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="deck-format" content="5">
  <style>
    :root { --font-heading: Calibri, Arial, sans-serif; --font-body: Calibri, Arial, sans-serif;
            --color-primary: #CC092F; --color-accent: #1F2A44; --color-text: #222; --color-bg: #fff; }
    .slide { position: relative; width: 1280px; height: 720px; overflow: hidden; }
    .el    { position: absolute; }
  </style>
</head>
<body>
  <section class="slide" data-slide-id="s1">
    <div class="el" data-type="text" data-id="e1" style="left:64px; top:48px; width:1152px; height:80px; z-index:1">
      <p data-list="none" data-level="1"><span style="font-size:32pt"><b>Executive summary</b></span></p>
    </div>
    <div class="el" data-type="text" data-id="e2" style="left:64px; top:150px; width:1152px; height:400px; z-index:2">
      <p data-list="bullet" data-level="1">Revenue of 480 mn in 2025</p>
      <p data-list="bullet" data-level="2">Growth of 12% a year</p>
    </div>
    <figure class="el" data-type="chart" data-id="e3" style="left:64px; top:300px; width:600px; height:340px; z-index:3">
      <script type="application/json" class="chart-data">{ "version": 1, "type": "column", … }</script>
      <svg>…drawn by the editor…</svg>
    </figure>
    <aside class="notes">Speaker notes</aside>
  </section>
</body>
</html>
```

The rules in short:

- **Slides:** `<section class="slide" data-slide-id="…">`, always 1280 × 720 px.
- **Elements:** direct children of the slide with class `el`, a `data-type` (`text`, `image`, `table`, `shape`, `chart`, `group`), a unique `data-id`, and `left` / `top` / `width` / `height` in px plus a `z-index`.
- **Theme:** colours and fonts are CSS variables in `:root`, so changing one restyles the whole deck.
- **Text:** one `<p>` per line. Bullets and levels are attributes (`data-list="bullet|number|none"`, `data-level="1"` to `"5"`), not `<ul>` / `<li>`, which mirrors how PowerPoint stores paragraphs.
- **Tables:** real `<table>` elements with column widths in a `<colgroup>`.
- **Charts:** the data is JSON inside the element; the editor draws a static SVG next to it, so the saved deck needs no chart library.
- **Pictures:** embedded as base64 `data:` URIs. Nothing is loaded from the internet.
- **Notes and comments:** `<aside class="notes">` and `<aside class="comments">` inside each slide.

Decks that do not follow these rules still open. The importer looks for the slides, measures every visible block and rewrites it into this format, then tells you what it converted, removed or blocked. The complete definition is in [SPEC.md, section 3.3](SPEC.md#3-architecture).

## Asking an AI to write a deck

Any assistant that can write HTML (Microsoft Copilot, Claude, ChatGPT, Gemini …) can produce a deck in this format. Paste the instructions below into the chat, followed by what the presentation should say.

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

Then add your own request, for example: *"8 slides for an investment committee about Project Atlas: an executive summary, a comparable-companies table, a revenue and margin chart, next steps. Brand colours: #CC092F and #1F2A44."*

Tips that help:

- **Save the answer as a `.html` file** (copy the code into a text editor, or use the assistant's download button) and open it in the editor.
- **Give the numbers for charts and tables in the request.** The assistant only writes the chart's data; the editor draws the chart when it opens the deck, and you can edit the data afterwards.
- **Say which language the deck is in**, and name your colours and fonts if you have a house style.
- **Do not worry about small mistakes.** If the assistant ignores a rule (uses `<ul>` lists, adds a script, links a web font), the editor converts or removes it on open and lists what it did in the import report.
- **Attach a deck you already like** (for example [`samples/contract-deck.html`](samples/contract-deck.html)) and ask for "the same structure", if the assistant accepts files.

The same prompt is kept as Appendix A at the end of [SPEC.md](SPEC.md).

## Privacy

- The editor makes no network requests: no analytics, no fonts or scripts from a CDN, no update check. Its Content-Security-Policy (`default-src 'none'`, `connect-src 'none'`) makes the browser enforce this, and the build fails if a remote reference slips in.
- Crash-recovery drafts are kept in the browser's own storage (IndexedDB) on your computer and are deleted after a save or after one day. Chromium shares that storage between all HTML files opened from disk, so **File > Settings** lets you turn drafts off or delete them at any time.
- The only third-party code is [PptxGenJS](https://github.com/gitbrent/PptxGenJS) (MIT), copied into `vendor/` with its licence and a checked SHA-256 hash. See [vendor/README.md](vendor/README.md) or **Help > About** in the editor.

## Building and testing

Using the editor needs only a browser. Changing it needs Python 3 (standard library only).

| Task | Command |
| --- | --- |
| Build `dist/editor.html` from `src/` and run the offline check | `python build.py` |
| Run the unit tests in a browser | double-click `tests/run-tests.html` |
| Run every test from the command line (needs [Playwright for Python](https://playwright.dev/python/)) | `python tests/run_tests.py` |

The source is plain JavaScript, HTML and CSS with no framework and no npm packages: one small file per area in `src/js/`, merged into the single output file by `build.py`.

| Document | What it holds |
| --- | --- |
| [SPEC.md](SPEC.md) | The requirements the editor was built from, phase by phase |
| [FEATURES.md](FEATURES.md) | The checklist of every feature and its manual test |
| [ARCHITECTURE.md](ARCHITECTURE.md) | A map of the modules and how a user action flows through them |

### Project status

Every feature in `SPEC.md` is built and covered by the automated tests (about 680 unit tests and 110 end-to-end tests, all passing).

In `FEATURES.md` you will still find nine unticked **"Done when"** boxes, one per phase from Phase 3 on. They are not missing features. Each is the phase's final acceptance test, done by hand by the author in real Microsoft Edge on real work (for example "a comps table copied from Excel becomes an editable, formatted table in under a minute"). An automated version of each one already passes; the box is ticked only after the hands-on check. The other unticked lines (about 30) are single manual checks of the same kind.

The editor was written with [Claude Code](https://claude.com/claude-code), working through `SPEC.md` one phase at a time.

## License

[MIT](LICENSE). The bundled PptxGenJS (with JSZip) keeps its own MIT licence, in [`vendor/pptxgenjs/LICENSE`](vendor/pptxgenjs/LICENSE).
