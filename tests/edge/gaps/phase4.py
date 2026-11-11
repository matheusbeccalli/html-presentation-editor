"""
Phase 4 hand checks (tables) replayed literally in Edge: real clicks, drags and keys, one assertion per step.
Each test follows its FEATURES.md hand check from start to end (quoted in the docstring).

A drag that starts inside a table cell while a cell is being typed in is sent with _cell_drag (raw mouse input
through the DevTools protocol, the same events Playwright sends): Playwright's own mouse.move was observed to
stall there (headless Chromium, cause not established). The editor gets the same real mouse events.
"""

import re

import e2e_test as e2e
from e2e_test import Editor, check, drag, slide_to_screen

DESIGN_TAB = ".ribbon-tab[data-tab='table-design']"
LAYOUT_TAB = ".ribbon-tab[data-tab='table-layout']"
DARK = "rgb(31, 42, 68)"        # the deck's accent: the header fill
BAND = "rgb(242, 242, 242)"     # the table style's grey band
NONE = "rgba(0, 0, 0, 0)"

EDITING_KEY = "App.text.isEditing() ? App.text.containerKey(App.text.editingElement()) : null"

TABLE_SHAPE = e2e.TABLE_SHAPE
DRAWN_ROWS = e2e.DRAWN_ROWS

# The text of a table's cells, one string per row ("a|b|c").
GRID = """id => { const table = App.deck.getDocument().querySelector('[data-id="' + id + '"] > table');
    return table ? Array.from(table.rows, (row) => Array.from(row.cells, (cell) =>
        App.text.getModel(cell).map((line) => line.text).join('/')).join('|')) : null; }"""

# The look of every cell of a table: computed fill, colour, weight, alignment, padding, the four borders, plus row heights.
LOOK = """id => { const doc = App.deck.getDocument(); const view = doc.defaultView;
    const table = doc.querySelector('[data-id="' + id + '"] > table');
    const side = (s, n) => [s['border' + n + 'Width'], s['border' + n + 'Style'], s['border' + n + 'Color']].join(' ');
    return { rows: Array.from(table.rows, (row) => Math.round(row.getBoundingClientRect().height * 10) / 10),
             cells: Array.from(table.rows, (row) => Array.from(row.cells, (cell) => { const s = view.getComputedStyle(cell);
                 const line = cell.firstElementChild ? view.getComputedStyle(cell.firstElementChild) : s;
                 return { fill: s.backgroundColor, color: line.color, weight: line.fontWeight, valign: s.verticalAlign,
                          padding: s.padding, align: line.textAlign,
                          top: side(s, 'Top'), right: side(s, 'Right'), bottom: side(s, 'Bottom'), left: side(s, 'Left') }; })) }; }"""

# Centre of a cell (or of the letters in it) in slide pixels.
CELL_POINT = """([id, r, c, onText]) => { const doc = App.deck.getDocument();
    const cell = doc.querySelector('[data-id="' + id + '"] > table').rows[r].cells[c];
    let rect = cell.getBoundingClientRect();
    if (onText && cell.textContent.trim()) { const range = doc.createRange(); range.selectNodeContents(cell.firstElementChild);
        rect = range.getBoundingClientRect(); }
    return [rect.left + rect.width / 2, rect.top + rect.height / 2]; }"""

# The mouse cursor shown at a screen point: the top page's element there, or (over the slide frame) the slide's element there.
CURSOR_AT = """([x, y, sx, sy]) => { const top = document.elementFromPoint(x, y);
    if (top && top.tagName === 'IFRAME') { const doc = App.deck.getDocument();
        return 'frame:' + doc.defaultView.getComputedStyle(doc.elementFromPoint(sx, sy)).cursor; }
    return getComputedStyle(top).cursor; }"""

# Where the text cursor is inside the cell being typed in: its offset in the cell's text.
CARET = """() => { const doc = App.deck.getDocument(); const sel = doc.getSelection(); const cell = App.text.editingElement();
    if (!cell || !sel.rangeCount || !sel.isCollapsed) { return null; }
    const range = doc.createRange(); range.selectNodeContents(cell); range.setEnd(sel.anchorNode, sel.anchorOffset);
    return range.toString().length; }"""

# How many lines the text of a cell takes (distinct line tops of its letters).
LINES = """([id, r, c]) => { const doc = App.deck.getDocument();
    const cell = doc.querySelector('[data-id="' + id + '"] > table').rows[r].cells[c];
    const range = doc.createRange(); range.selectNodeContents(cell.firstElementChild);
    return new Set(Array.from(range.getClientRects(), (rect) => Math.round(rect.top))).size; }"""

LINE_ALIGN = """([id, r, c]) => { const doc = App.deck.getDocument();
    const line = doc.querySelector('[data-id="' + id + '"] > table').rows[r].cells[c].firstElementChild;
    return doc.defaultView.getComputedStyle(line).textAlign; }"""


def _go_to_slide(page, index):
    page.click(f".thumb[data-index='{index}']")
    e2e.wait_until(page, f"App.deck.getCurrentIndex() === {index}")


def _handle(name):
    return f"#overlay .selection-handle[data-handle='{name}']"


def _centre(page, selector):
    box = page.locator(selector).bounding_box()
    return [box["x"] + box["width"] / 2, box["y"] + box["height"] / 2]


def _cell(page, table_id, r, c, on_text=True):
    """Screen point of a cell (on its letters when it has some)."""
    return slide_to_screen(page, *page.evaluate(CELL_POINT, [table_id, r, c, on_text]))


def _cell_drag(page, start, end, steps=8):
    """A real left-button drag, sent as raw mouse input (see the module docstring)."""
    cdp = page.context.new_cdp_session(page)
    try:
        def send(kind, x, y, buttons):
            cdp.send("Input.dispatchMouseEvent", {"type": kind, "x": x, "y": y, "button": "left" if kind != "mouseMoved" or buttons else "none",
                                                  "buttons": buttons, "clickCount": 1 if kind != "mouseMoved" else 0})
        send("mouseMoved", start[0], start[1], 0)
        send("mousePressed", start[0], start[1], 1)
        for i in range(1, steps + 1):
            send("mouseMoved", start[0] + (end[0] - start[0]) * i / steps, start[1] + (end[1] - start[1]) * i / steps, 1)
        send("mouseReleased", end[0], end[1], 0)
    finally:
        cdp.detach()


def _cells_selected(page):
    target = page.evaluate("(() => { const t = App.tableControls.cellTarget(); return t && !t.cell ? t.cells : null; })()")
    return target if page.is_visible(".cell-block") else None


def _rgb(text):
    return [int(float(v)) for v in text[text.index("(") + 1:text.index(")")].split(",")[:3]]


# ----------------------------------------------------------------------
# 1. A deck saved before Phase 4
# ----------------------------------------------------------------------

# The comps table of the format-1 sample as a browser draws it on its own: the honest "before".
BEFORE = """() => { const table = document.querySelector('[data-id="e9"] table');
    const side = (s, n) => [s['border' + n + 'Width'], s['border' + n + 'Style'], s['border' + n + 'Color']].join(' ');
    return Array.from(table.rows, (row) => Array.from(row.cells, (cell) => { const s = getComputedStyle(cell);
        const range = document.createRange(); range.selectNodeContents(cell); const t = range.getBoundingClientRect(), c = cell.getBoundingClientRect();
        return { fill: s.backgroundColor, color: s.color, weight: s.fontWeight, align: s.textAlign, top: side(s, 'Top'),
                 gapLeft: t.left - c.left, gapRight: c.right - t.right }; })); }"""
AFTER = """() => { const doc = App.deck.getDocument(); const view = doc.defaultView;
    const table = doc.querySelector('[data-id="e9"] > table');
    const side = (s, n) => [s['border' + n + 'Width'], s['border' + n + 'Style'], s['border' + n + 'Color']].join(' ');
    return Array.from(table.rows, (row) => Array.from(row.cells, (cell) => { const s = view.getComputedStyle(cell);
        const line = view.getComputedStyle(cell.firstElementChild);
        const range = doc.createRange(); range.selectNodeContents(cell.firstElementChild); const t = range.getBoundingClientRect(), c = cell.getBoundingClientRect();
        return { fill: s.backgroundColor, color: line.color, weight: line.fontWeight, align: line.textAlign, top: side(s, 'Top'),
                 gapLeft: t.left - c.left, gapRight: c.right - t.right }; })); }"""


def _compare_look(before, after, when):
    """Header colour, right-aligned numbers, the bold Mediana row with its line above: the same as the original draws them."""
    check(len(after) == 6 and all(len(row) == 4 for row in after), f"{when}: 6 rows of 4 cells")
    for c in range(4):
        b, a = before[0][c], after[0][c]
        check(b["fill"] == DARK and a["fill"] == b["fill"] and a["color"] == b["color"] == "rgb(255, 255, 255)",
              f"{when}: header cell {c}: the same dark fill and white text: {b} / {a}")
    for r in range(6):
        for c in range(4):
            b, a = before[r][c], after[r][c]
            right = c > 0   # Empresa on the left; every number column (and its header) on the right
            side = lambda value: "left" if value == "start" else value  # noqa: E731  (a plain td's "start" is left in this deck)
            check(side(b["align"]) == ("right" if right else "left") and side(a["align"]) == side(b["align"]),
                  f"{when}: cell {r},{c} aligned {b['align']}: {a['align']}")
            # On screen: the letters sit against the same side of the cell, as far in as before (text may be a hair wider).
            gap, before_gap = (a["gapRight"], b["gapRight"]) if right else (a["gapLeft"], b["gapLeft"])
            check(abs(gap - before_gap) <= 1.5 and gap < 15, f"{when}: cell {r},{c}'s text against its {'right' if right else 'left'} side: {before_gap:.1f} -> {gap:.1f}")
    for c in range(4):
        b, a = before[5][c], after[5][c]
        check(b["weight"] == "700" and a["weight"] == "700", f"{when}: Mediana row bold: {b['weight']} / {a['weight']}")
        check(b["top"] == "2px solid rgb(34, 34, 34)" and a["top"] == b["top"], f"{when}: the line above Mediana: {b['top']} / {a['top']}")
        check(int(after[4][c]["weight"]) < 700, f"{when}: the row above Mediana is not bold: {after[4][c]['weight']}")


def test_gap_p4_format1_table(browser):
    """In Edge: open a deck saved before Phase 4 (or `samples/contract-deck-format1.html`): the import report says
    "1 table was converted to the editor's table format"; slide 3's comps table looks as before (header colour,
    right-aligned numbers, the bold Mediana row with its line above; text may be a hair wider); Save, close, reopen:
    no report."""
    # The "before": the original file drawn by the browser on its own.
    context = browser.new_context(viewport={"width": 1440, "height": 900})
    context.route(re.compile(r"^https?://"), lambda route: route.abort())
    plain = context.new_page()
    plain.goto(e2e.CONTRACT_FORMAT1.as_uri())
    before = plain.evaluate(BEFORE)
    context.close()

    editor = Editor(browser)
    editor.open(e2e.CONTRACT_FORMAT1)
    page = editor.page
    report = editor.report_dialog_text() or ""
    check("1 table was converted to the editor's table format" in report, f"the import report says so: {report}")
    editor.close_dialog_if_open()

    _go_to_slide(page, 2)
    check(page.evaluate("!!App.deck.getDocument().querySelector('[data-id=\"e9\"] > table td > p[data-list]')"),
          "slide 3's comps table is in the editor's table format")
    _compare_look(before, page.evaluate(AFTER), "converted")
    page.screenshot(path=str(e2e.OUTPUT / "gap-p4-format1-slide3.png"))

    saved = editor.save_as_download("gap-p4-format1-converted.html")
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()

    editor = Editor(browser)
    editor.open(saved)
    page = editor.page
    check(editor.report_dialog_text() is None, "reopened: no report")
    _go_to_slide(page, 2)
    _compare_look(before, page.evaluate(AFTER), "reopened")
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


# ----------------------------------------------------------------------
# 2. Column borders
# ----------------------------------------------------------------------

def test_gap_p4_column_borders(browser):
    """Column borders: on slide 3 point at the line between "Empresa" and "EV (R$ mn)": the mouse becomes ↔; drag it
    right: Empresa gets wider, EV narrower, the table stays as wide; Ctrl+Z. Click "Beta Foods" (typing), drag the
    line between "EV/EBITDA 2025E" and "Margem EBITDA" left, type "!": it lands where the cursor was in Beta Foods.
    Drag the first line far left: the names wrap and the table gets taller; Ctrl+Z"""
    editor = Editor(browser)
    editor.open(e2e.CONTRACT)
    page = editor.page
    _go_to_slide(page, 2)
    shape = lambda: page.evaluate(TABLE_SHAPE, "e9")  # noqa: E731
    key = lambda: page.evaluate(EDITING_KEY)  # noqa: E731
    rect = lambda: e2e.element_rect(page, "e9")  # noqa: E731
    start, box = shape()["widths"], rect()
    border = lambda i: 64 + sum(start[:i])  # noqa: E731  slide x of the line right of column i-1
    row_y = page.evaluate(CELL_POINT, ["e9", 1, 0, False])[1]   # Beta Foods' row

    # Point at the line between Empresa and EV: the mouse becomes the column-border cursor.
    page.mouse.move(*slide_to_screen(page, border(1), row_y))
    cursor = page.evaluate(CURSOR_AT, [*slide_to_screen(page, border(1), row_y), border(1), row_y])
    check(cursor in ("col-resize", "frame:col-resize"), f"the mouse becomes ↔ on the line: {cursor}")
    page.mouse.move(*slide_to_screen(page, border(1) - 60, row_y))
    off = page.evaluate(CURSOR_AT, [*slide_to_screen(page, border(1) - 60, row_y), border(1) - 60, row_y])
    check("col-resize" not in off, f"but not inside the cell: {off}")

    # Drag it right: Empresa wider, EV narrower, the table as wide. Ctrl+Z.
    drag(page, slide_to_screen(page, border(1), row_y), slide_to_screen(page, border(1) + 50, row_y))
    widths = shape()["widths"]
    check(abs(widths[0] - start[0] - 50) < 1 and abs(widths[1] - start[1] + 50) < 1 and all(abs(a - b) < 0.05 for a, b in zip(widths[2:], start[2:])),
          f"Empresa 50 px wider, EV 50 px narrower: {start} -> {widths}")
    check(abs(rect()["width"] - box["width"]) < 0.05, f"the table stays as wide: {rect()}")
    page.keyboard.press("Control+z")
    check(shape()["widths"] == start, f"Ctrl+Z: as it was: {shape()['widths']}")

    # Click inside "Beta Foods" (typing), the cursor between its letters.
    page.mouse.click(*_cell(page, "e9", 1, 0))
    check(key() == "e9/1/0", f"typing in Beta Foods: {key()}")
    caret = page.evaluate(CARET)
    text = page.evaluate(GRID, "e9")[1].split("|")[0]
    check(text == "Beta Foods" and caret is not None and 0 < caret < len(text), f"the cursor inside the name: {caret} in {text!r}")

    # Drag the line between EV/EBITDA 2025E and Margem EBITDA left: still typing; "!" lands at the cursor.
    page.mouse.move(*slide_to_screen(page, border(3), row_y))
    cursor = page.evaluate(CURSOR_AT, [*slide_to_screen(page, border(3), row_y), border(3), row_y])
    check(cursor in ("col-resize", "frame:col-resize"), f"↔ on that line while typing: {cursor}")
    _cell_drag(page, slide_to_screen(page, border(3), row_y), slide_to_screen(page, border(3) - 50, row_y))
    widths = shape()["widths"]
    check(abs(widths[2] - start[2] + 50) < 1 and abs(widths[3] - start[3] - 50) < 1 and all(abs(a - b) < 0.05 for a, b in zip(widths[:2], start[:2])),
          f"EV/EBITDA 50 px narrower, Margem 50 px wider: {start} -> {widths}")
    check(abs(rect()["width"] - box["width"]) < 0.05, f"the table stays as wide: {rect()}")
    check(key() == "e9/1/0", f"typing goes on in Beta Foods: {key()}")
    page.keyboard.type("!")
    now = page.evaluate(GRID, "e9")[1].split("|")[0]
    check(now == text[:caret] + "!" + text[caret:], f"'!' lands where the cursor was: {now!r} (cursor at {caret})")
    page.screenshot(path=str(e2e.OUTPUT / "gap-p4-border-typing.png"))
    page.keyboard.press("Control+z")
    check(page.evaluate(GRID, "e9")[1].split("|")[0] == text and shape()["widths"] == widths, "Ctrl+Z: the '!' goes, the border stays")
    page.keyboard.press("Control+z")
    check(shape()["widths"] == start, f"Ctrl+Z: the border back: {shape()['widths']}")

    # Drag the first line far left: the names wrap, the table gets taller. Ctrl+Z.
    lines = [page.evaluate(LINES, ["e9", r, 0]) for r in range(1, 6)]
    check(lines == [1] * 5, f"the names on one line before: {lines}")
    _cell_drag(page, slide_to_screen(page, border(1), row_y), slide_to_screen(page, 20, row_y))
    lines = [page.evaluate(LINES, ["e9", r, 0]) for r in range(1, 6)]
    check(shape()["widths"][0] < 40 and all(n > 1 for n in lines), f"the names wrap: {shape()['widths']} {lines}")
    check(rect()["height"] > box["height"] + 50, f"the table gets taller: {box['height']} -> {rect()['height']}")
    page.screenshot(path=str(e2e.OUTPUT / "gap-p4-border-far-left.png"))
    page.keyboard.press("Control+z")
    check(shape()["widths"] == start and abs(rect()["height"] - box["height"]) < 0.05, f"Ctrl+Z: as it was: {shape()['widths']} {rect()}")
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


# ----------------------------------------------------------------------
# 3. Table Design
# ----------------------------------------------------------------------

def test_gap_p4_table_design(browser):
    """Table Design: Insert > Table (4 × 4), click a cell: the Table Design tab appears next to Layout, Header Row
    and Banded Rows ticked. Untick Header Row: the dark header goes (the grey bands now start at the first row);
    untick Banded Rows: the grey bands go; tick Total Row: the last row is bold with a line above; tick First Column:
    the first column is bold; Ctrl+Z each, then Ctrl+Z the table. On slide 3 (its header and lines came from the old
    deck as cell formatting, so its boxes are unticked) click "Beta Foods": Shading ▾ > Red: Beta Foods turns red;
    Shading ▾ > Table style fill: back. Drag from "2.450" to "8,9x", pen weight 3 px, pen colour ▾ a colour,
    Borders ▾ > Outside Borders: a thick frame around the four cells, none inside; Borders ▾ > No Border: the lines
    around them go. Layout > Align Bottom: the numbers sit at the bottom of their cells. Esc (the whole table),
    Layout > Cell Margins ▾ > Wide: every row gets taller. Ctrl+Z each; Save, reopen: the look is kept"""
    editor = Editor(browser)
    editor.open(e2e.CONTRACT)
    page = editor.page
    findings = []
    key = lambda: page.evaluate(EDITING_KEY)  # noqa: E731
    ticked = lambda c: page.is_checked(f"input[data-command='{c}']")  # noqa: E731
    option = lambda c: page.click(f"label:has(input[data-command='{c}'])")  # noqa: E731

    # Insert > Table, 4 x 4 from the grid.
    check(page.is_hidden(DESIGN_TAB) and page.is_hidden(LAYOUT_TAB), "no table tabs before")
    page.click(".ribbon-tab[data-tab='insert']")
    page.click(".table-button")
    page.hover(".table-grid-cell[data-row='4'][data-col='4']")
    check(page.inner_text(".table-grid-label") == "4 × 4 table", f"label: {page.inner_text('.table-grid-label')}")
    page.click(".table-grid-cell[data-row='4'][data-col='4']")
    new_id = page.evaluate("App.selection.selectedId()")
    check(page.evaluate(TABLE_SHAPE, new_id)["rows"] == 4 and page.evaluate(TABLE_SHAPE, new_id)["cols"] == 4, "a 4 x 4 table")
    look = lambda: page.evaluate(LOOK, new_id)["cells"]  # noqa: E731

    # Click a cell: Table Design next to Layout; Header Row and Banded Rows ticked.
    page.mouse.click(*_cell(page, new_id, 1, 1))
    check(key() == f"{new_id}/1/1", f"typing in the clicked cell: {key()}")
    check(page.is_visible(DESIGN_TAB) and page.is_visible(LAYOUT_TAB), "Table Design and Layout tabs appear")
    tabs = page.eval_on_selector_all(".ribbon-tab", "ts => ts.filter(t => t.offsetParent !== null).map(t => t.dataset.tab)")
    check(tabs.index("table-layout") - tabs.index("table-design") == 1, f"Table Design right next to Layout: {tabs}")
    page.click(DESIGN_TAB)
    check(ticked("tableHeaderRow") and ticked("tableBandedRows") and not ticked("tableTotalRow") and not ticked("tableFirstColumn"),
          "Header Row and Banded Rows ticked (Total Row and First Column not)")
    fills = lambda: [row[0]["fill"] for row in look()]  # noqa: E731
    start = look()
    check(fills() == [DARK, BAND, NONE, BAND] and start[0][0]["color"] == "rgb(255, 255, 255)", f"a dark header, grey bands: {fills()}")

    # Untick Header Row: the dark header goes, the bands start at the first row.
    option("tableHeaderRow")
    check(not ticked("tableHeaderRow") and fills() == [BAND, NONE, BAND, NONE], f"no dark header; bands from the first row: {fills()}")
    # Untick Banded Rows: the bands go.
    option("tableBandedRows")
    check(not ticked("tableBandedRows") and fills() == [NONE] * 4, f"the grey bands go: {fills()}")
    # Tick Total Row: the last row bold with a line above.
    option("tableTotalRow")
    cells = look()
    check(ticked("tableTotalRow") and all(cell["weight"] == "700" and cell["top"].startswith("2px solid") for cell in cells[3])
          and all(int(cell["weight"]) < 700 for cell in cells[2]), f"the last row bold, a line above: {cells[3]}")
    # Tick First Column: the first column bold.
    option("tableFirstColumn")
    cells = look()
    check(ticked("tableFirstColumn") and all(row[0]["weight"] == "700" for row in cells) and int(cells[1][1]["weight"]) < 700,
          f"the first column bold: {[row[0]['weight'] for row in cells]} / {cells[1][1]['weight']}")
    check(key() == f"{new_id}/1/1", f"typing went on through the clicks: {key()}")

    # Ctrl+Z each, then Ctrl+Z the table.
    page.keyboard.press("Control+z")
    cells = look()
    check(not ticked("tableFirstColumn") and int(cells[1][0]["weight"]) < 700 and cells[3][0]["weight"] == "700", "Ctrl+Z: First Column off")
    page.keyboard.press("Control+z")
    cells = look()
    check(not ticked("tableTotalRow") and int(cells[3][1]["weight"]) < 700 and not cells[3][1]["top"].startswith("2px"), "Ctrl+Z: Total Row off")
    page.keyboard.press("Control+z")
    check(ticked("tableBandedRows") and fills() == [BAND, NONE, BAND, NONE], f"Ctrl+Z: the bands back: {fills()}")
    page.keyboard.press("Control+z")
    check(ticked("tableHeaderRow") and look() == start, f"Ctrl+Z: the dark header back: {fills()}")
    page.keyboard.press("Control+z")
    check(page.evaluate("id => !App.deck.getDocument().querySelector('[data-id=\"' + id + '\"]')", new_id), "Ctrl+Z: the table goes")

    # Slide 3: its boxes unticked; Shading > Red, then Table style fill.
    _go_to_slide(page, 2)
    e9 = lambda: page.evaluate(LOOK, "e9")  # noqa: E731
    cell = lambda r, c: e9()["cells"][r][c]  # noqa: E731
    original = e9()
    page.mouse.click(*_cell(page, "e9", 1, 0))
    check(key() == "e9/1/0", f"typing in Beta Foods: {key()}")
    page.click(DESIGN_TAB)
    check(not any(ticked(c) for c in ["tableHeaderRow", "tableTotalRow", "tableBandedRows", "tableFirstColumn"]),
          "slide 3's table: its style boxes unticked")
    page.click(".cell-fill-menu-button")
    page.click(".cell-fill-menu .color-swatch[title='Red']")
    check(cell(1, 0)["fill"] == "rgb(255, 0, 0)" and cell(1, 1)["fill"] != "rgb(255, 0, 0)" and cell(2, 0)["fill"] != "rgb(255, 0, 0)",
          f"Beta Foods red, only it: {cell(1, 0)['fill']}")
    page.click(".cell-fill-menu-button")
    page.click(".cell-fill-menu .menu-item[title='Table style fill']")
    check(e9() == original, f"Table style fill: back: {cell(1, 0)['fill']}")

    # Drag from 2.450 to 8,9x: four cells. Pen 3 px, a pen colour, Outside Borders: a thick frame, none inside.
    _cell_drag(page, _cell(page, "e9", 1, 1), _cell(page, "e9", 2, 2))
    check(_cells_selected(page) == {"top": 1, "left": 1, "bottom": 2, "right": 2}, f"four cells selected: {_cells_selected(page)}")
    page.click(".pen-weight")
    page.click(".pen-weight-menu .menu-item:has-text('3 px')")
    check(page.text_content(".pen-weight").strip() == "3 px ▾", f"pen weight: {page.text_content('.pen-weight')}")
    page.click(".pen-color-menu-button")
    page.click(".pen-color-menu .color-swatch[title='Green']")
    green = "rgb(0, 176, 80)"
    page.click(".borders-menu-button")
    page.click(".borders-menu .menu-item:has-text('Outside Borders')")
    frame = f"3px solid {green}"
    after = e9()["cells"]
    outer = [after[1][1]["top"], after[1][2]["top"], after[2][1]["bottom"], after[2][2]["bottom"],
             after[1][1]["left"], after[2][1]["left"], after[1][2]["right"], after[2][2]["right"]]
    check(all(side == frame for side in outer), f"a thick {green} frame around the four cells: {outer}")
    inner = [after[1][1]["right"], after[2][1]["right"], after[1][1]["bottom"], after[1][2]["bottom"],
             after[1][2]["left"], after[2][2]["left"], after[2][1]["top"], after[2][2]["top"]]
    check(not any(side.startswith("3px") for side in inner), f"none inside: {inner}")
    check(_cells_selected(page) is not None, "the four cells still selected")

    # Borders > No Border: the lines around them go (the neighbours draw none on those edges either).
    page.click(".borders-menu-button")
    page.click(".borders-menu .menu-item:has-text('No Border')")
    after = e9()["cells"]
    drawn = lambda side: not (side.startswith("0px") or " none " in side)  # noqa: E731
    sides = [after[r][c][s] for r in (1, 2) for c in (1, 2) for s in ("top", "right", "bottom", "left")]
    neighbours = [after[0][1]["bottom"], after[0][2]["bottom"], after[3][1]["top"], after[3][2]["top"],
                  after[1][0]["right"], after[2][0]["right"], after[1][3]["left"], after[2][3]["left"]]
    check(not any(drawn(s) for s in sides + neighbours), f"no lines around them: {sides} {neighbours}")

    # Layout > Align Bottom: the numbers at the bottom of their cells.
    page.click(LAYOUT_TAB)
    page.click(".ribbon-button[data-command='cellAlignBottom']")
    after = e9()["cells"]
    check(all(after[r][c]["valign"] == "bottom" for r in (1, 2) for c in (1, 2)) and original["cells"][1][1]["valign"] == "middle"
          and after[1][0]["valign"] == "middle" and after[3][1]["valign"] == "middle", "the four numbers sit at the bottom, the rest stays centred")
    page.screenshot(path=str(e2e.OUTPUT / "gap-p4-design-cells.png"))

    # Esc (the whole table): the cells are let go, the table stays selected.
    page.keyboard.press("Escape")
    check(page.evaluate("App.selection.selectedIds()") == ["e9"] and key() is None and page.is_hidden(".cell-block")
          and page.is_visible(LAYOUT_TAB), f"Esc: the whole table selected: {page.evaluate('App.selection.selectedIds()')}")

    # Layout > Cell Margins > Wide: every row taller.
    rows = e9()["rows"]
    page.click(LAYOUT_TAB)
    page.click(".cell-margins")
    page.click(".cell-margins-menu .menu-item:has-text('Wide')")
    final = e9()
    check(all(a > b + 5 for a, b in zip(final["rows"], rows)), f"every row taller: {rows} -> {final['rows']}")
    check(all(c["padding"] == "14px" for row in final["cells"] for c in row), "every cell has wide margins")
    page.screenshot(path=str(e2e.OUTPUT / "gap-p4-design-wide.png"))

    # Ctrl+Z each (margins, alignment, No Border, Outside Borders, Table style fill, Red).
    page.keyboard.press("Control+z")
    check(e9()["rows"] == rows, f"Ctrl+Z: the margins back: {e9()['rows']}")
    page.keyboard.press("Control+z")
    check(cell(1, 1)["valign"] == "middle" and cell(2, 2)["valign"] == "middle", "Ctrl+Z: centred again")
    page.keyboard.press("Control+z")
    check(cell(1, 1)["top"] == frame and cell(2, 2)["right"] == frame, f"Ctrl+Z: the frame back: {cell(1, 1)['top']}")
    page.keyboard.press("Control+z")
    check(e9()["cells"] == original["cells"], "Ctrl+Z: the frame goes, the borders as they were")
    page.keyboard.press("Control+z")
    check(cell(1, 0)["fill"] == "rgb(255, 0, 0)", f"Ctrl+Z: Beta Foods red again (Table style fill undone): {cell(1, 0)['fill']}")
    page.keyboard.press("Control+z")
    check(e9() == original, "Ctrl+Z: as it was at the start")
    undone = editor.save_as_download("gap-p4-design-undone.html")

    # Ctrl+Y them back (so the saved look has every change in it), Save, reopen: the look is kept.
    for _ in range(6):
        page.keyboard.press("Control+y")
    check(e9() == final, "Ctrl+Y six times: the final look again")
    saved = editor.save_as_download("gap-p4-design.html")
    editor.open(saved)
    _go_to_slide(page, 2)
    check(editor.report_dialog_text() is None, "reopened without a report")
    check(e9() == final, f"reopened: the look is kept: {e9()['rows']} vs {final['rows']}")
    editor.open(undone)
    _go_to_slide(page, 2)
    check(e9() == original, "the deck saved after the undos reopens as the original")
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()
    check(not findings, "FINDING: " + "; ".join(findings))


# ----------------------------------------------------------------------
# 4. Numbers
# ----------------------------------------------------------------------

def test_gap_p4_numbers(browser):
    """Numbers: on slide 3 click "2.450", Table Design > Number: the button above reads 1.234,5 ▾ and Thousands
    Separator is lit; Increase Decimal: 2.450,0 (typing goes on), Ctrl+Z. Drag from "19,5%" down to "-3,5%":
    Negatives in Parentheses: (3,5%); Percent Style: 0,195 … (0,035); Ctrl+Z. 1.234,5 ▾ > en-US, Increase Decimal:
    19.50% … (3.50%). Esc, click "1.120", Increase Decimal: 1,120.0 (read as 1120, the deck's way). Close and reopen
    the editor: the button still says 1,234.5. Insert > Table 2 × 3, click the top right cell, type Valor, Tab, Alfa,
    Tab, 1.234: still on the left while you type; Tab: 1.234 and Valor move right; Tab, type abc, Esc: both back on
    the left; Ctrl+Z: on the right again"""
    editor = Editor(browser)
    editor.open(e2e.CONTRACT)
    page = editor.page
    button = lambda name: f".ribbon-button[data-command='{name}']"  # noqa: E731
    pressed = lambda name: page.get_attribute(button(name), "aria-pressed") == "true"  # noqa: E731
    grid = lambda: page.evaluate(GRID, "e9")  # noqa: E731
    margins = lambda: [row.split("|")[3] for row in grid()[1:5]]  # noqa: E731
    key = lambda: page.evaluate(EDITING_KEY)  # noqa: E731

    # Slide 3, click 2.450, Table Design > Number: 1.234,5 ▾, Thousands Separator lit.
    _go_to_slide(page, 2)
    page.mouse.click(*_cell(page, "e9", 1, 1))
    check(key() == "e9/1/1", f"typing in 2.450: {key()}")
    page.click(DESIGN_TAB)
    check(page.text_content(".number-locale").strip() == "1.234,5 ▾", f"the button reads 1.234,5 ▾: {page.text_content('.number-locale')}")
    check(pressed("numberThousands"), "Thousands Separator lit")

    # Increase Decimal: 2.450,0, typing goes on; Ctrl+Z.
    page.click(button("increaseDecimals"))
    check(grid()[1].split("|")[1] == "2.450,0" and key() == "e9/1/1", f"2.450,0, typing goes on: {grid()[1]} {key()}")
    page.keyboard.press("Control+z")
    check(grid()[1].split("|")[1] == "2.450", f"Ctrl+Z: 2.450 again: {grid()[1]}")
    # "Typing goes on", proven by typing: Increase Decimal again, then a key lands in the same cell, at the end.
    page.click(button("increaseDecimals"))
    page.keyboard.type("7")
    check(grid()[1].split("|")[1] == "2.450,07" and key() == "e9/1/1", f"typing goes on after Increase Decimal: {grid()[1]} {key()}")
    page.keyboard.press("Control+z")
    page.keyboard.press("Control+z")
    check(grid()[1].split("|")[1] == "2.450", f"Ctrl+Z, Ctrl+Z: 2.450 again: {grid()[1]}")

    # Drag from 19,5% down to -3,5%: Negatives in Parentheses, Percent Style, Ctrl+Z.
    _cell_drag(page, _cell(page, "e9", 1, 3), _cell(page, "e9", 4, 3))
    check(_cells_selected(page) == {"top": 1, "left": 3, "bottom": 4, "right": 3}, f"the four percentages selected: {_cells_selected(page)}")
    page.click(DESIGN_TAB)
    page.click(button("negativeParens"))
    check(margins() == ["19,5%", "17,2%", "21,0%", "(3,5%)"], f"(3,5%): {margins()}")
    page.click(button("numberPercent"))
    check(margins() == ["0,195", "0,172", "0,210", "(0,035)"], f"0,195 … (0,035): {margins()}")
    page.keyboard.press("Control+z")
    check(margins() == ["19,5%", "17,2%", "21,0%", "(3,5%)"], f"Ctrl+Z: percentages again: {margins()}")

    # 1.234,5 ▾ > en-US, Increase Decimal: 19.50% … (3.50%).
    page.click(".number-locale")
    page.click(".number-locale-menu .menu-item:has-text('en-US')")
    check(page.text_content(".number-locale").strip() == "1,234.5 ▾", f"the button shows en-US: {page.text_content('.number-locale')}")
    page.click(button("increaseDecimals"))
    check(margins() == ["19.50%", "17.20%", "21.00%", "(3.50%)"], f"19.50% … (3.50%): {margins()}")

    # Esc, click 1.120, Increase Decimal: 1,120.0.
    page.keyboard.press("Escape")
    check(_cells_selected(page) is None, "Esc lets go of the cells")
    page.mouse.click(*_cell(page, "e9", 2, 1))
    check(key() == "e9/2/1", f"typing in 1.120: {key()}")
    page.click(DESIGN_TAB)
    page.click(button("increaseDecimals"))
    check(grid()[2].split("|")[1] == "1,120.0", f"1,120.0: {grid()[2]}")
    page.screenshot(path=str(e2e.OUTPUT / "gap-p4-numbers.png"))
    check(editor.errors == [], f"no errors: {editor.errors}")

    # Close and reopen the editor (same browser, so its settings stay): the button still says 1,234.5.
    context = editor.context
    page.close()
    editor = Editor(browser, context=context)
    page = editor.page
    editor.open(e2e.CONTRACT)
    _go_to_slide(page, 2)
    page.mouse.click(*_cell(page, "e9", 1, 1))
    page.click(DESIGN_TAB)
    check(page.text_content(".number-locale").strip() == "1,234.5 ▾", f"after reopening: {page.text_content('.number-locale')}")

    # Insert > Table 2 × 3 (on slide 5).
    _go_to_slide(page, 4)
    page.click(".ribbon-tab[data-tab='insert']")
    page.click(".table-button")
    page.hover(".table-grid-cell[data-row='3'][data-col='2']")
    check(page.inner_text(".table-grid-label") == "2 × 3 table", f"label: {page.inner_text('.table-grid-label')}")
    page.click(".table-grid-cell[data-row='3'][data-col='2']")
    new_id = page.evaluate("App.selection.selectedId()")
    shape = page.evaluate(TABLE_SHAPE, new_id)
    check(shape["rows"] == 3 and shape["cols"] == 2, f"2 columns, 3 rows: {shape}")
    align = lambda r, c: page.evaluate(LINE_ALIGN, [new_id, r, c])  # noqa: E731
    text = lambda: page.evaluate(GRID, new_id)  # noqa: E731

    # Top right cell: Valor, Tab, Alfa, Tab, 1.234: still on the left while typing.
    page.mouse.click(*_cell(page, new_id, 0, 1, on_text=False))
    check(page.evaluate(EDITING_KEY) == f"{new_id}/0/1", f"typing in the top right cell: {page.evaluate(EDITING_KEY)}")
    page.keyboard.type("Valor")
    page.keyboard.press("Tab")
    page.keyboard.type("Alfa")
    page.keyboard.press("Tab")
    page.keyboard.type("1.234")
    check(text() == ["|Valor", "Alfa|1.234", "|"], f"typed: {text()}")
    check(align(1, 1) == "left" and align(0, 1) == "left", f"still on the left while typing: {align(1, 1)} {align(0, 1)}")
    # Tab: 1.234 and Valor move right.
    page.keyboard.press("Tab")
    check(page.evaluate(EDITING_KEY) == f"{new_id}/2/0", f"Tab: the next cell: {page.evaluate(EDITING_KEY)}")
    check(align(1, 1) == "right" and align(0, 1) == "right" and align(1, 0) == "left", f"1.234 and Valor on the right: {align(1, 1)} {align(0, 1)}")
    # Tab, type abc, Esc: both back on the left.
    page.keyboard.press("Tab")
    check(page.evaluate(EDITING_KEY) == f"{new_id}/2/1", f"Tab: under 1.234: {page.evaluate(EDITING_KEY)}")
    page.keyboard.type("abc")
    page.keyboard.press("Escape")
    check(text()[2] == "|abc" and page.evaluate(EDITING_KEY) is None, f"abc typed, Esc: {text()}")
    check(align(1, 1) == "left" and align(0, 1) == "left", f"both back on the left: {align(1, 1)} {align(0, 1)}")
    page.screenshot(path=str(e2e.OUTPUT / "gap-p4-numbers-new-table.png"))
    # Ctrl+Z: on the right again.
    page.keyboard.press("Control+z")
    check(text()[2] == "|" and align(1, 1) == "right" and align(0, 1) == "right", f"Ctrl+Z: abc gone, on the right again: {text()} {align(1, 1)} {align(0, 1)}")
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


# ----------------------------------------------------------------------
# 5. Insert > Table
# ----------------------------------------------------------------------

def test_gap_p4_insert_table(browser):
    """Insert > Table: move the mouse over the grid (the label says "4 × 3 table"), click: a table with a dark header
    row and grey bands appears in the middle of the slide, selected; Ctrl+Z removes it. Drag its right handle left:
    the columns get narrower together; drag its bottom handle far up: the rows stop at one line of text. Insert >
    Table again, press ↓ → ↓ then Enter: a 2 × 2 table. Save, reopen: the tables are there"""
    editor = Editor(browser)
    editor.open(e2e.CONTRACT)
    page = editor.page
    _go_to_slide(page, 5)   # slide 6: a title and bullets

    # Move the mouse over the grid: the label follows; at 4 x 3 it says "4 × 3 table".
    page.click(".ribbon-tab[data-tab='insert']")
    page.click(".table-button")
    check(page.is_visible(".table-grid-menu"), "the grid opens")
    for row, col in [(1, 1), (2, 3), (3, 4)]:
        page.hover(f".table-grid-cell[data-row='{row}'][data-col='{col}']")
        check(page.inner_text(".table-grid-label") == f"{col} × {row} table", f"label at {col} x {row}: {page.inner_text('.table-grid-label')}")
    check(page.locator(".table-grid-cell.picked").count() == 12, "12 cells lit")
    page.click(".table-grid-cell[data-row='3'][data-col='4']")

    # A table with a dark header row and grey bands, in the middle of the slide, selected.
    table_id = page.evaluate("App.selection.selectedId()")
    check(page.evaluate("id => App.deck.getDocument().querySelector('[data-id=\"' + id + '\"]').getAttribute('data-type')", table_id) == "table",
          f"the new table selected: {table_id}")
    check(page.is_visible("#overlay .selection-box"), "its selection box shows")
    shape = page.evaluate(TABLE_SHAPE, table_id)
    check(shape["rows"] == 3 and shape["cols"] == 4, f"4 columns, 3 rows: {shape}")
    cells = page.evaluate(LOOK, table_id)["cells"]
    check(all(c["fill"] == DARK and c["color"] == "rgb(255, 255, 255)" for c in cells[0]), f"a dark header row: {cells[0][0]}")
    check(all(c["fill"] == BAND for c in cells[1]) and all(c["fill"] == NONE for c in cells[2]), f"grey bands: {cells[1][0]['fill']} {cells[2][0]['fill']}")
    rect = e2e.element_rect(page, table_id)
    check(abs(rect["left"] + rect["width"] / 2 - 640) <= 1 and abs(rect["top"] + rect["height"] / 2 - 360) <= 1, f"in the middle: {rect}")
    page.screenshot(path=str(e2e.OUTPUT / "gap-p4-insert-table.png"))

    # Ctrl+Z removes it (Ctrl+Y brings it back for the handles).
    page.keyboard.press("Control+z")
    check(page.evaluate("id => !App.deck.getDocument().querySelector('[data-id=\"' + id + '\"]')", table_id), "Ctrl+Z removes it")
    page.keyboard.press("Control+y")
    check(page.evaluate(TABLE_SHAPE, table_id) == shape, "Ctrl+Y: back")
    page.mouse.click(*_cell(page, table_id, 1, 1))
    page.keyboard.press("Escape")
    check(page.evaluate("App.selection.selectedIds()") == [table_id] and page.is_visible(_handle("e")), "the table selected, its handles shown")

    # Drag its right handle left: the columns narrower together.
    start = _centre(page, _handle("e"))
    zoom = page.evaluate("App.canvas.getZoom()")
    drag(page, start, [start[0] - 240 * zoom, start[1]], steps=10)
    shape = page.evaluate(TABLE_SHAPE, table_id)
    width = e2e.element_rect(page, table_id)["width"]
    check(abs(width - 720) <= 3, f"narrower: {width}")
    check(max(shape["widths"]) - min(shape["widths"]) < 0.05 and abs(shape["widths"][0] - width / 4) < 0.05, f"the columns narrower together: {shape['widths']}")

    # Drag its bottom handle far up: the rows stop at one line of text.
    start = _centre(page, _handle("s"))
    drag(page, start, [start[0], start[1] - 110 * zoom], steps=10)
    rect = e2e.element_rect(page, table_id)
    drawn = page.evaluate(DRAWN_ROWS, table_id)
    line = page.evaluate("""id => { const doc = App.deck.getDocument(); const cell = doc.querySelector('[data-id="' + id + '"] td');
        const s = doc.defaultView.getComputedStyle(cell); const p = cell.firstElementChild.getBoundingClientRect();
        return p.height + parseFloat(s.paddingTop) + parseFloat(s.paddingBottom); }""", table_id)
    check(all(abs(h - line) <= 1.5 for h in drawn) and rect["height"] > 120 - 110 + 20, f"each row one line of text tall ({line:.1f}): {drawn} {rect}")
    check(abs(rect["height"] - sum(drawn)) < 0.5, f"the box as tall as its rows: {rect} {drawn}")
    shape = page.evaluate(TABLE_SHAPE, table_id)

    # Insert > Table again, ↓ → ↓ Enter: 2 x 2.
    page.click(".table-button")
    for k in ["ArrowDown", "ArrowRight", "ArrowDown"]:
        page.keyboard.press(k)
    check(page.inner_text(".table-grid-label") == "2 × 2 table", f"label: {page.inner_text('.table-grid-label')}")
    page.keyboard.press("Enter")
    small_id = page.evaluate("App.selection.selectedId()")
    small = page.evaluate(TABLE_SHAPE, small_id)
    check(small_id != table_id and small["rows"] == 2 and small["cols"] == 2, f"a 2 x 2 table: {small}")

    # Save, reopen: both tables there.
    saved = editor.save_as_download("gap-p4-inserted-tables.html")
    editor.open(saved)
    check(editor.report_dialog_text() is None, "reopened without a report")
    _go_to_slide(page, 5)
    check(page.evaluate(TABLE_SHAPE, table_id) == shape and page.evaluate(TABLE_SHAPE, small_id) == small, "both tables there, as they were")
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


def test_gap_p4_typing_new_row_undo(browser):
    """Typing in cells (the part the e2e test leaves out): "Click the last cell (18,4%), Tab: a new row, type in it;
    Esc, Ctrl+Z takes your typing back and a second Ctrl+Z removes the row". The rest of that hand check is
    covered by tests/e2e_test.py test_table_cell_editing."""
    editor = Editor(browser)
    editor.open(e2e.CONTRACT)
    page = editor.page
    page.click(".thumb[data-index='2']")
    e2e.wait_until(page, "App.deck.getCurrentIndex() === 2")
    text = lambda r, c: page.evaluate(e2e.CELL_TEXT, [r, c])  # noqa: E731
    key = lambda: page.evaluate(e2e.EDITING_KEY)  # noqa: E731
    rows = lambda: page.evaluate("App.deck.getDocument().querySelector('[data-id=\"e9\"] > table').rows.length")  # noqa: E731
    height = lambda: sum(page.evaluate(e2e.DRAWN_ROWS, "e9"))  # noqa: E731

    page.mouse.click(*slide_to_screen(page, 1100, 345))
    check(key() == "e9/5/3" and text(5, 3) == "18,4%", f"the last cell (18,4%): {key()} {text(5, 3)!r}")
    start_rows, start_height = rows(), height()
    page.keyboard.press("Tab")
    check(rows() == start_rows + 1 and key() == "e9/6/0" and height() > start_height + 30, f"Tab: a new row: {rows()} {key()}")
    page.keyboard.type("Nova")
    check(text(6, 0) == "Nova", f"typing in it: {text(6, 0)!r}")
    page.keyboard.press("Escape")
    check(key() is None and page.evaluate("App.selection.selectedId()") == "e9", "Esc: the table selected")
    page.keyboard.press("Control+z")
    check(rows() == start_rows + 1 and text(6, 0) == "", f"first Ctrl+Z: the typing goes, the row stays: {rows()} {text(6, 0)!r}")
    page.keyboard.press("Control+z")
    check(rows() == start_rows and abs(height() - start_height) < 0.5, f"second Ctrl+Z: the row goes: {rows()} {height()}")
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


# ----------------------------------------------------------------------
# Layout tab
# ----------------------------------------------------------------------

# Where a cell's text is: [row, column] of the first cell reading `text`.
FIND_CELL = """([id, text]) => { const table = App.deck.getDocument().querySelector('[data-id="' + id + '"] > table');
    for (const row of table.rows) { for (const cell of row.cells) {
        if (cell.textContent.trim() === text) { return [row.rowIndex, cell.cellIndex]; } } }
    return null; }"""

# The block two cells span, in slide px, as this browser lays them out.
SPAN = """([id, a, b]) => { const table = App.deck.getDocument().querySelector('[data-id="' + id + '"] > table');
    const s = App.deck.getCurrentSlide().getBoundingClientRect();
    const p = table.rows[a[0]].cells[a[1]].getBoundingClientRect(), q = table.rows[b[0]].cells[b[1]].getBoundingClientRect();
    return { left: p.left - s.left, top: p.top - s.top, width: q.right - p.left, height: q.bottom - p.top }; }"""

BLOCK = """() => { const b = document.querySelector('.cell-block'); const r = App.transform.readRect(b);
    r.fill = getComputedStyle(b).backgroundColor; return r; }"""


def test_gap_p4_layout_tab(browser):
    """Layout tab: click "Beta Foods": the Layout tab appears (it goes when nothing is selected). Insert rows below,
    Insert rows above, Insert columns right: an empty row / column each, typing goes on in Beta Foods; Delete rows;
    Ctrl+Z each. Drag from "2.450" to "8,9x": four cells shaded; Merge cells (one cell with the four numbers), Split
    cells; Ctrl+Z. Click "Delta Snacks", Shift+click "530": four cells; Delete empties them, Ctrl+Z, Esc. Drag the
    table by its left edge: it moves. Delete table, Ctrl+Z"""
    editor = Editor(browser)
    editor.open(e2e.CONTRACT)
    page = editor.page
    grid = lambda: page.evaluate(GRID, "e9")  # noqa: E731
    key = lambda: page.evaluate(EDITING_KEY)  # noqa: E731
    run = lambda command: page.click(f".ribbon-button[data-command='{command}']")  # noqa: E731
    at = lambda text: page.evaluate(FIND_CELL, ["e9", text])  # noqa: E731
    _go_to_slide(page, 2)
    start = grid()
    check(page.is_hidden(LAYOUT_TAB), "no Layout tab before a table is clicked")

    # Click "Beta Foods": the Layout tab appears; it goes when nothing is selected.
    beta = at("Beta Foods")
    page.mouse.click(*_cell(page, "e9", *beta))
    check(page.is_visible(LAYOUT_TAB) and key() == "e9/%d/%d" % tuple(beta), f"the Layout tab appears, typing in Beta Foods: {key()}")
    page.mouse.click(*slide_to_screen(page, 1250, 700))
    check(page.evaluate("App.selection.selectedIds()") == [] and page.is_hidden(LAYOUT_TAB), "nothing selected: the Layout tab goes")
    page.mouse.click(*_cell(page, "e9", *beta))
    page.click(LAYOUT_TAB)
    check(key() == "e9/%d/%d" % tuple(beta), f"the tab keeps the typing: {key()}")

    def typing_goes_on(where):
        """A key typed now lands in Beta Foods (wherever it is now); Ctrl+Z takes it back."""
        r, c = at("Beta Foods")
        page.keyboard.type("7")
        typed = grid()[r].split("|")[c]
        check(key() == f"e9/{r}/{c}" and "7" in typed and typed.replace("7", "") == "Beta Foods",
              f"{where}: typing goes on in Beta Foods: {typed!r} {key()}")
        page.keyboard.press("Control+z")
        check(at("Beta Foods") == [r, c] and key() == f"e9/{r}/{c}", f"{where}: Ctrl+Z takes the key back: {grid()} {key()}")

    # Insert rows below, Insert rows above, Insert columns right, one after the other: an empty row / column each,
    # typing goes on in Beta Foods (a key typed, then taken back, so the undo steps stay the line's); Delete rows;
    # then Ctrl+Z each, one step per press, newest first.
    rows, cols = len(start), len(start[0].split("|"))
    after = [start]
    for command, where in [("insertRowBelow", "below"), ("insertRowAbove", "above"), ("insertColumnRight", "right")]:
        before = grid()
        run(command)
        now = grid()
        r, c = at("Beta Foods")
        if where == "right":
            check(len(now) == len(before) and all(len(row.split("|")) == cols + 1 and row.split("|")[c + 1] == "" for row in now),
                  f"Insert columns right: an empty column right of it: {now}")
        else:
            empty = r + 1 if where == "below" else r - 1
            check(len(now) == len(before) + 1 and now[empty] == "|" * (cols - 1), f"Insert rows {where}: an empty row {where}: {now}")
        typing_goes_on(f"Insert {where}")
        check(grid() == now, f"Insert {where}: that Ctrl+Z took only the key; the insert is still there: {grid()}")
        after.append(now)
    run("deleteRows")
    deleted = grid()
    check(len(deleted) == len(after[-1]) - 1 and at("Beta Foods") is None, f"Delete rows: Beta's row gone: {deleted}")
    for n, (undone, expected) in enumerate(zip(["Delete rows", "Insert columns right", "Insert rows above", "Insert rows below"],
                                               reversed(after)), start=1):
        page.keyboard.press("Control+z")
        check(grid() == expected, f"Ctrl+Z {n}: {undone} undone, nothing more: {grid()}")
    check(grid() == start and key() == "e9/%d/%d" % tuple(beta), f"all four undone, typing back in Beta Foods: {key()}")

    # Drag from 2.450 to 8,9x (still typing in Beta Foods, as the line goes): four cells shaded (the block over exactly them).
    check(key() == "e9/%d/%d" % tuple(beta), f"still typing in Beta Foods before the drag: {key()}")
    a, b = at("2.450"), at("8,9x")
    check(a is not None and b is not None and b[0] == a[0] + 1 and b[1] == a[1] + 1, f"2.450 and 8,9x two by two apart: {a} {b}")
    _cell_drag(page, _cell(page, "e9", *a), _cell(page, "e9", *b))
    block, span = page.evaluate(BLOCK), page.evaluate(SPAN, ["e9", a, b])
    check(page.is_visible(".cell-block") and key() is None and _rgb(block["fill"]) != [0, 0, 0] and not block["fill"].endswith(", 0)")
          and all(abs(block[k] - span[k]) < 1.5 for k in ("left", "top", "width", "height")),
          f"four cells shaded: {block} / {span}")
    four = [grid()[a[0]].split("|")[a[1]], grid()[a[0]].split("|")[b[1]], grid()[b[0]].split("|")[a[1]], grid()[b[0]].split("|")[b[1]]]

    # Merge cells: one cell with the four numbers; Split cells; Ctrl+Z.
    page.click(LAYOUT_TAB)
    run("mergeCells")
    merged = page.evaluate("""([r, c]) => { const cell = App.deck.getDocument().querySelector('[data-id="e9"] > table').rows[r].cells[c];
        return [cell.rowSpan, cell.colSpan, App.text.getModel(cell).map((line) => line.text)]; }""", a)
    check(merged == [2, 2, four], f"Merge cells: one cell (2 x 2) with the four numbers {four}: {merged}")
    place = page.evaluate(SPAN, ["e9", a, a])
    check(all(abs(place[k] - span[k]) < 1.5 for k in ("left", "top", "width")) and place["height"] >= span["height"] - 1.5,
          f"the merged cell takes the four cells' place (taller: four lines in it): {place} / {span}")
    run("splitCells")
    split = page.evaluate("""([r, c]) => { const t = App.deck.getDocument().querySelector('[data-id="e9"] > table');
        return [t.rows[r].cells.length, t.rows[r + 1].cells.length, t.rows[r].cells[c].rowSpan, t.rows[r].cells[c].colSpan]; }""", a)
    check(split == [cols, cols, 1, 1], f"Split cells: four cells again: {split}")
    page.keyboard.press("Control+z")
    check(page.evaluate("""([r, c]) => { const cell = App.deck.getDocument().querySelector('[data-id="e9"] > table').rows[r].cells[c];
        return [cell.rowSpan, cell.colSpan]; }""", a) == [2, 2], "Ctrl+Z: merged again")
    page.keyboard.press("Control+z")
    check(grid() == start, f"Ctrl+Z: the four cells as they were: {grid()}")

    # Click Delta Snacks, Shift+click 530: four cells; Delete empties them, Ctrl+Z, Esc.
    # (still typing in the 2.450 cell after that Ctrl+Z, as the line goes)
    d, n = at("Delta Snacks"), at("530")
    check(d is not None and n is not None and n[0] == d[0] + 1 and n[1] == d[1] + 1, f"Delta Snacks and 530 two by two apart: {d} {n}")
    page.mouse.click(*_cell(page, "e9", *d))
    check(key() == "e9/%d/%d" % tuple(d), f"click Delta Snacks: typing in it: {key()}")
    page.keyboard.down("Shift")
    page.mouse.click(*_cell(page, "e9", *n))
    page.keyboard.up("Shift")
    block, span = page.evaluate(BLOCK), page.evaluate(SPAN, ["e9", d, n])
    check(page.is_visible(".cell-block") and key() is None and all(abs(block[k] - span[k]) < 1.5 for k in ("left", "top", "width", "height"))
          and _rgb(block["fill"]) != [0, 0, 0] and not block["fill"].endswith(", 0)"),
          f"Shift+click: the four cells shaded: {block} / {span}")
    page.keyboard.press("Delete")
    after = grid()
    check(all(after[r].split("|")[c] == "" for r in (d[0], n[0]) for c in (d[1], n[1]))
          and sum(row.count("|") for row in after) == sum(row.count("|") for row in start)
          and [after[r] for r in range(len(after)) if r not in (d[0], n[0])] == [start[r] for r in range(len(start)) if r not in (d[0], n[0])],
          f"Delete empties the four cells, nothing else: {after}")
    page.keyboard.press("Control+z")
    check(grid() == start, f"Ctrl+Z: their text back: {grid()}")
    page.keyboard.press("Escape")
    check(page.is_hidden(".cell-block") and page.evaluate("App.selection.selectedId()") == "e9", "Esc: the cells let go, the table selected")

    # Drag the table by its left edge: it moves.
    box = e2e.element_rect(page, "e9")
    drag(page, slide_to_screen(page, box["left"] + 2, box["top"] + 110), slide_to_screen(page, box["left"] + 52, box["top"] + 110))
    moved = e2e.element_rect(page, "e9")
    check(abs(moved["left"] - (box["left"] + 50)) <= 1 and abs(moved["top"] - box["top"]) <= 1 and grid() == start,
          f"dragged by its left edge: it moves: {box} -> {moved}")

    # Delete table, Ctrl+Z (the table is selected after the drag; its Layout tab is there).
    check(page.evaluate("App.selection.selectedId()") == "e9" and page.is_visible(LAYOUT_TAB), "the table selected, the Layout tab shown")
    page.click(LAYOUT_TAB)
    run("deleteTable")
    check(page.evaluate("!App.deck.getDocument().querySelector('[data-id=\"e9\"]')") and page.is_hidden(LAYOUT_TAB),
          "Delete table: gone, and the Layout tab with it")
    page.keyboard.press("Control+z")
    check(grid() == start and e2e.element_rect(page, "e9") == moved, f"Ctrl+Z: the table back where it was: {grid()}")
    page.screenshot(path=str(e2e.OUTPUT / "gap-p4-layout-tab.png"))
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


TESTS = [test_gap_p4_layout_tab, test_gap_p4_typing_new_row_undo, test_gap_p4_format1_table, test_gap_p4_column_borders, test_gap_p4_table_design, test_gap_p4_numbers, test_gap_p4_insert_table]
