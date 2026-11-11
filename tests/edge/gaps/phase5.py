"""
Phase 5 hand checks (shapes) replayed literally in Edge: real clicks, drags and keys, one assertion per step.
Each test follows its FEATURES.md hand check from start to end (quoted in the docstring).
"""

import re

import e2e_test as e2e
from e2e_test import Editor, check, drag, slide_to_screen

TAB = ".ribbon-tab[data-tab='shape-format']"

# A shape's kind, box, paths, flip, adjust and the computed look of its paths and svg.
SHAPE = """id => { const el = App.deck.getDocument().querySelector('[data-id="' + id + '"]');
    if (!el) { return null; }
    const svg = el.querySelector('svg.shape-svg');
    const css = (p) => { const s = getComputedStyle(p); return { fill: s.fill, stroke: s.stroke, strokeWidth: s.strokeWidth,
        dash: s.strokeDasharray, fillOpacity: s.fillOpacity, strokeOpacity: s.strokeOpacity }; };
    return { kind: el.getAttribute('data-shape'), flip: el.getAttribute('data-flip') || '', adjust: el.getAttribute('data-adjust'),
             rect: App.transform.readRect(el), paths: Array.from(el.querySelectorAll('svg path'), (p) => p.getAttribute('d')),
             css: Array.from(el.querySelectorAll('svg path'), css), filter: getComputedStyle(svg).filter }; }"""

LOOK = "id => App.shapes.lookOf(App.deck.getDocument().querySelector('[data-id=\"' + id + '\"]'))"

# Where the text of a shape sits: its line's centre against the shape's centre (from a Range over the text itself).
TEXT = """id => { const el = App.deck.getDocument().querySelector('[data-id="' + id + '"]');
    const area = el.querySelector(':scope > .shape-text');
    const doc = el.ownerDocument;
    const first = area.querySelector('p');
    const walker = doc.createTreeWalker(area, NodeFilter.SHOW_TEXT); const node = walker.nextNode();
    let last = node; for (let n = walker.nextNode(); n; n = walker.nextNode()) { last = n; }
    const range = doc.createRange();   // over the letters themselves, not the paragraph's full-width box
    if (node) { range.setStart(node, 0); range.setEnd(last, last.length); }
    const t = range.getBoundingClientRect(), s = el.getBoundingClientRect();
    const style = getComputedStyle(node ? node.parentElement : first);
    const before = getComputedStyle(first, '::before');
    return { html: area.innerHTML, text: area.textContent, color: style.color, weight: style.fontWeight,
             textWidth: t.width, shapeWidth: s.width, dx: (t.left + t.right) / 2 - (s.left + s.right) / 2, dy: (t.top + t.bottom) / 2 - (s.top + s.bottom) / 2,
             lists: Array.from(area.querySelectorAll('p'), (p) => p.getAttribute('data-list')),
             marker: before.content, markerWidth: parseFloat(before.width) || 0 }; }"""


def _go_to_slide(page, index):
    page.click(f".thumb[data-index='{index}']")
    e2e.wait_until(page, f"App.deck.getCurrentIndex() === {index}")


def _selected(page):
    return page.evaluate("App.selection.selectedId()")


def _pick(page, kind):
    page.click(".ribbon-tab[data-tab='insert']")
    page.click(".ribbon-button.shapes-button")
    page.click(f".shape-gallery-item[data-shape='{kind}']")


def _handle(name):
    return f"#overlay .selection-handle[data-handle='{name}']"


def _centre(page, selector):
    box = page.locator(selector).bounding_box()
    return [box["x"] + box["width"] / 2, box["y"] + box["height"] / 2]


def _near(a, b, tolerance=2):
    return abs(a[0] - b[0]) <= tolerance and abs(a[1] - b[1]) <= tolerance


def _count(page):
    return page.evaluate("App.deck.getCurrentSlide().querySelectorAll('.el').length")


def _rounded(rect):
    return {k: round(v, 1) for k, v in rect.items()}


def _head_tip(shape):
    """The arrow head's point (first point of its path), in slide px."""
    x, y = [float(v) for v in re.match(r"M(-?[\d.]+) (-?[\d.]+)", shape["paths"][1]).groups()]
    return [shape["rect"]["left"] + x, shape["rect"]["top"] + y]


def _rgb(text):
    return [int(v) for v in re.findall(r"\d+", text)[:3]]


# ----------------------------------------------------------------------
# Shapes: Insert > Shapes
# ----------------------------------------------------------------------

def test_gap_p5_shapes(browser):
    """Shapes: Insert > Shapes shows 8 shapes. Pick Chevron and drag on the slide: a dark-blue chevron where you
    dragged, selected; one Ctrl+Z removes it. Pick Rectangle and just click: a rectangle at the click. Pick Oval and
    drag with Shift: a circle. Pick Arrow and drag with Shift: a straight flat arrow, head at the end; click just next
    to it: it is selected. Drag a side handle of the chevron: it gets longer, its point does not stretch. Save,
    reopen: all still there"""
    editor = Editor(browser)
    editor.open(e2e.CONTRACT)
    page = editor.page
    shape = lambda id_: page.evaluate(SHAPE, id_)  # noqa: E731
    _go_to_slide(page, 4)   # slide 5: room under its text

    # Insert > Shapes shows 8 shapes.
    page.click(".ribbon-tab[data-tab='insert']")
    page.click(".ribbon-button.shapes-button")
    check(page.locator(".shape-gallery-item:visible").count() == 8, "Insert > Shapes shows 8 shapes")
    kinds = page.evaluate("Array.from(document.querySelectorAll('.shape-gallery-item'), (b) => b.getAttribute('data-shape'))")
    check({"chevron", "rect", "ellipse", "arrow"} <= set(kinds), f"Chevron, Rectangle, Oval and Arrow among them: {kinds}")
    page.screenshot(path=str(e2e.OUTPUT / "gap-p5-gallery.png"))

    # Pick Chevron and drag: a dark-blue chevron where you dragged, selected.
    before = _count(page)
    page.click(".shape-gallery-item[data-shape='chevron']")
    drag(page, slide_to_screen(page, 200, 450), slide_to_screen(page, 460, 560))   # not the click size (200 x 80)
    chevron_id = _selected(page)
    chevron = shape(chevron_id)
    check(chevron is not None and chevron["kind"] == "chevron" and _rounded(chevron["rect"]) == {"left": 200, "top": 450, "width": 260, "height": 110},
          f"a chevron where the mouse went: {chevron}")
    check(_count(page) == before + 1, "one new element on the slide")
    r, g, b = _rgb(chevron["css"][0]["fill"])
    check(chevron["css"][0]["fill"] == "rgb(31, 42, 68)" and b > r and b > g and r + g + b < 200,
          f"dark blue (computed fill of the chevron): {chevron['css'][0]['fill']}")
    check(page.is_visible("#overlay .selection-box") and page.is_visible(_handle("e")), "selected: its box and handles show")
    page.screenshot(path=str(e2e.OUTPUT / "gap-p5-chevron.png"))

    # One Ctrl+Z removes it (then Ctrl+Y brings it back for the side-handle step below).
    page.keyboard.press("Control+z")
    check(_count(page) == before and shape(chevron_id) is None, f"one Ctrl+Z removes the chevron: {_count(page)} elements")
    page.keyboard.press("Control+y")
    check(shape(chevron_id) is not None and _rounded(shape(chevron_id)["rect"]) == {"left": 200, "top": 450, "width": 260, "height": 110},
          "Ctrl+Y: the chevron back")

    # Pick Rectangle and just click: a rectangle at the click.
    _pick(page, "rect")
    page.mouse.click(*slide_to_screen(page, 600, 450))
    rect = shape(_selected(page))
    check(rect["kind"] == "rect" and rect["rect"]["left"] == 600 and rect["rect"]["top"] == 450
          and rect["rect"]["width"] > 0 and rect["rect"]["height"] > 0, f"a rectangle at the click: {rect}")

    # Pick Oval and drag with Shift: a circle.
    _pick(page, "ellipse")
    page.keyboard.down("Shift")
    drag(page, slide_to_screen(page, 820, 450), slide_to_screen(page, 920, 480))
    page.keyboard.up("Shift")
    oval = shape(_selected(page))
    arc = re.search(r"A([\d.]+) ([\d.]+)", oval["paths"][0])
    check(oval["kind"] == "ellipse" and round(oval["rect"]["width"]) == round(oval["rect"]["height"]) == 100
          and arc and arc.group(1) == arc.group(2) == "50", f"a circle: {oval}")

    # Pick Arrow and drag with Shift: a straight flat arrow, head at the end.
    _pick(page, "arrow")
    page.keyboard.down("Shift")
    drag(page, slide_to_screen(page, 400, 650), slide_to_screen(page, 600, 643))
    page.keyboard.up("Shift")
    arrow_id = _selected(page)
    arrow = shape(arrow_id)
    check(arrow["kind"] == "arrow" and arrow["rect"]["height"] == 0 and round(arrow["rect"]["width"]) == 200
          and arrow["rect"]["top"] == 650, f"a straight flat arrow: {arrow}")
    tip = _head_tip(arrow)
    check(len(arrow["paths"]) == 2 and _near(tip, [600, 650], 0.5) and not _near(tip, [400, 650], 50),
          f"the head at the end of the drag (600,650), not the start: tip {tip}")
    head_box = page.evaluate("""id => { const r = App.deck.getDocument().querySelector('[data-id="' + id + '"] path.shape-head')
        .getBoundingClientRect(); return [r.left, r.right]; }""", arrow_id)
    check(head_box[0] > 550 and head_box[1] <= 601, f"the head is drawn at the right end: {head_box}")

    # Click just next to it: it is selected.
    page.keyboard.press("Escape")
    check(_selected(page) is None, "nothing selected before the click")
    page.mouse.click(*slide_to_screen(page, 500, 652))
    check(_selected(page) == arrow_id, "clicked 2 px beside the arrow: it is selected")
    page.screenshot(path=str(e2e.OUTPUT / "gap-p5-drawn.png"))

    # Drag a side handle of the chevron: it gets longer, its point does not stretch.
    page.keyboard.press("Escape")
    page.mouse.click(*slide_to_screen(page, 300, 490))
    check(_selected(page) == chevron_id, "the chevron clicked: selected")
    depth = lambda s: s["rect"]["width"] - float(re.match(r"M0 0H([\d.]+)L", s["paths"][0]).group(1))  # noqa: E731
    point_before = depth(shape(chevron_id))
    side = _centre(page, _handle("e"))
    zoom = page.evaluate("App.canvas.getZoom()")
    drag(page, side, (side[0] + 100 * zoom, side[1]))
    longer = shape(chevron_id)
    check(round(longer["rect"]["width"]) == 360 and longer["rect"]["height"] == 110, f"longer: {longer['rect']}")
    check(point_before == 55 and depth(longer) == 55, f"its point does not stretch: {point_before} -> {depth(longer)} ({longer['paths'][0]})")

    # Save, reopen: all still there.
    kept = {chevron_id: shape(chevron_id)}
    ids = page.evaluate("Array.from(App.deck.getCurrentSlide().querySelectorAll('[data-shape]'), (el) => el.getAttribute('data-id'))")
    before = {i: shape(i) for i in ids}
    check(len(ids) == 4 and sorted(s["kind"] for s in before.values()) == ["arrow", "chevron", "ellipse", "rect"], f"four shapes: {before}")
    saved = editor.save_as_download("gap-p5-shapes.html")
    editor.open(saved)
    _go_to_slide(page, 4)
    after = {i: shape(i) for i in ids}
    check(after == before, f"all still there after reopening, drawn the same: {after}")
    check(kept[chevron_id]["paths"] == after[chevron_id]["paths"], "the longer chevron kept")
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


# ----------------------------------------------------------------------
# Shape Format
# ----------------------------------------------------------------------

def test_gap_p5_shape_format(browser):
    """Shape Format: select a chevron: the Shape Format tab appears. Fill ▾ Dark Red; Outline ▾ Dark Blue (a 2 px
    outline appears); width 4 px, Dashed; Transparency 50%; Shadow. Each Ctrl+Z takes back one change. In the Format
    pane type 25 in Transparency and 6 in Width, pick Dotted: the shape follows. Draw an arrow: Fill is greyed out;
    Outline ▾ Green colours the line and its head. Save, reopen: the look is kept"""
    editor = Editor(browser)
    editor.open(e2e.CONTRACT)
    page = editor.page
    shape = lambda id_: page.evaluate(SHAPE, id_)  # noqa: E731
    look = lambda id_: page.evaluate(LOOK, id_)  # noqa: E731
    _go_to_slide(page, 4)
    _pick(page, "chevron")
    drag(page, slide_to_screen(page, 300, 450), slide_to_screen(page, 500, 530))
    chevron = _selected(page)

    # Select a chevron: the Shape Format tab appears.
    page.keyboard.press("Escape")
    check(_selected(page) is None and page.is_hidden(TAB), "nothing selected: no Shape Format tab")
    page.mouse.click(*slide_to_screen(page, 400, 490))
    check(_selected(page) == chevron and page.is_visible(TAB), "the chevron clicked: the Shape Format tab appears")
    page.click(TAB)

    # The six changes, each asserted (on the computed style too), each taken back by its own Ctrl+Z (then Ctrl+Y).
    def css(part=0):
        return shape(chevron)["css"][part]

    def step(name, action, expect, painted):
        prior = look(chevron)
        action()
        changed = look(chevron)
        check(all(changed[k] == v for k, v in expect.items()) and painted(), f"{name}: {changed} {css()} {shape(chevron)['filter']}")
        page.keyboard.press("Control+z")
        check(look(chevron) == prior, f"Ctrl+Z after {name} takes back exactly that change: {look(chevron)} vs {prior}")
        page.keyboard.press("Control+y")
        check(look(chevron) == changed, f"Ctrl+Y: {name} again: {look(chevron)}")

    def menu(button, item):
        return lambda: (page.click(button), page.click(item))

    step("Fill Dark Red", menu(".shape-fill-menu-button", ".shape-fill-menu .color-swatch[title='Dark Red']"),
         {"fill": "#c00000"}, lambda: css()["fill"] == "rgb(192, 0, 0)")
    step("Outline Dark Blue", menu(".shape-outline-menu-button", ".shape-outline-menu .color-swatch[title='Dark Blue']"),
         {"outline": "#002060", "width": 2}, lambda: css()["stroke"] == "rgb(0, 32, 96)" and css()["strokeWidth"] == "2px")
    step("width 4 px", menu(".list-button.shape-weight", ".shape-weight-menu .menu-item:has-text('4 px')"),
         {"width": 4, "dash": "solid"}, lambda: css()["strokeWidth"] == "4px" and css()["dash"] == "none")
    step("Dashed", menu(".list-button.shape-dash", ".shape-dash-menu .menu-item:has-text('Dashed')"),
         {"dash": "dash", "width": 4}, lambda: css()["dash"] not in ("none", ""))
    step("Transparency 50%", menu(".list-button.shape-transparency", ".shape-transparency-menu .menu-item:has-text('50%')"),
         {"transparency": 50}, lambda: css()["fillOpacity"] == "0.5")
    step("Shadow", lambda: page.click(".ribbon-button[data-command='shapeShadow']"),
         {"shadow": True}, lambda: "drop-shadow" in shape(chevron)["filter"])
    check(look(chevron) == {"fill": "#c00000", "outline": "#002060", "width": 4, "dash": "dash", "transparency": 50, "shadow": True},
          f"all six on: {look(chevron)}")
    page.screenshot(path=str(e2e.OUTPUT / "gap-p5-format-ribbon.png"))

    # In the Format pane type 25 in Transparency and 6 in Width, pick Dotted: the shape follows.
    check(page.is_visible("#format-shape"), "the Format pane's Fill & line shows")
    for field, value in [("#format-shape-transparency", "25"), ("#format-shape-width", "6")]:
        page.click(field)
        page.keyboard.press("Control+a")
        page.keyboard.type(value)
        page.keyboard.press("Enter")
    page.select_option("#format-shape-dash", "dot")
    check(look(chevron) == {"fill": "#c00000", "outline": "#002060", "width": 6, "dash": "dot", "transparency": 25, "shadow": True},
          f"the shape follows the pane: {look(chevron)}")
    dots = [float(v) for v in re.findall(r"[\d.]+", css()["dash"])]
    check(css()["fillOpacity"] == "0.75" and css()["strokeWidth"] == "6px" and len(dots) >= 2 and dots[0] <= dots[1],
          f"painted: 75 % fill, 6 px dotted outline: {css()}")
    page.screenshot(path=str(e2e.OUTPUT / "gap-p5-format-pane.png"))

    # Draw an arrow: Fill is greyed out; Outline > Green colours the line and its head.
    _pick(page, "arrow")
    drag(page, slide_to_screen(page, 700, 650), slide_to_screen(page, 900, 600))
    arrow = _selected(page)
    check(shape(arrow)["kind"] == "arrow", "an arrow drawn")
    page.click(TAB)
    check(page.is_disabled("#ribbon-panel .color-main[data-command='shapeFill']") and page.is_disabled(".shape-fill-menu-button"),
          "Fill is greyed out for the arrow (button and its list)")
    page.click(".shape-outline-menu-button")
    page.click(".shape-outline-menu .color-swatch[title='Green']")
    line, head = shape(arrow)["css"]
    check(line["stroke"] == "rgb(0, 176, 80)" and head["fill"] == "rgb(0, 176, 80)", f"the line and its head green: {line} {head}")
    page.screenshot(path=str(e2e.OUTPUT / "gap-p5-format-arrow.png"))

    # Save, reopen: the look is kept.
    before = {i: (look(i), shape(i)) for i in [chevron, arrow]}
    saved = editor.save_as_download("gap-p5-shape-format.html")
    editor.open(saved)
    _go_to_slide(page, 4)
    after = {i: (look(i), shape(i)) for i in [chevron, arrow]}
    check(after == before, f"the look is kept after reopening: {after}")
    check(after[chevron][1]["css"][0]["fill"] == "rgb(192, 0, 0)" and after[chevron][1]["css"][0]["fillOpacity"] == "0.75"
          and after[arrow][1]["css"][1]["fill"] == "rgb(0, 176, 80)", "dark red 75 %, the green head, after reopening")
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


# ----------------------------------------------------------------------
# Text in shapes
# ----------------------------------------------------------------------

def test_gap_p5_text_in_shapes(browser):
    """Text in shapes: double-click a chevron and type "Diligência": white, centred both ways. Esc: the chevron is
    selected; Ctrl+B makes all of it bold. Enter: typing again; Ctrl+Z takes back the typing. Bullets and font colour
    work as in a text box. Double-click a line: nothing to type. Ctrl+F finds the word in the shape. Save, reopen: the
    text is kept"""
    editor = Editor(browser)
    editor.open(e2e.CONTRACT)
    page = editor.page
    editing = lambda: page.evaluate("App.text.isEditing()")  # noqa: E731
    text = lambda: page.evaluate(TEXT, chevron)  # noqa: E731
    _go_to_slide(page, 4)
    _pick(page, "chevron")
    drag(page, slide_to_screen(page, 300, 450), slide_to_screen(page, 500, 530))
    chevron = _selected(page)

    # Double-click a chevron and type "Diligência": white, centred both ways.
    page.keyboard.press("Escape")
    page.mouse.dblclick(*slide_to_screen(page, 400, 490))
    check(editing() and page.evaluate("App.text.editingElement().parentElement.getAttribute('data-id')") == chevron,
          "double-click: typing in the chevron")
    page.keyboard.type("Diligência")
    typed = text()
    check(typed["text"] == "Diligência", f"the word typed: {typed}")
    check(typed["color"] == "rgb(255, 255, 255)", f"white: {typed['color']}")
    check(0 < typed["textWidth"] < typed["shapeWidth"] * 0.8, f"the letters are narrower than the shape: {typed}")
    check(abs(typed["dx"]) <= 2 and abs(typed["dy"]) <= 2, f"centred both ways (letters' centre vs shape centre): {typed}")
    page.screenshot(path=str(e2e.OUTPUT / "gap-p5-text-typed.png"))

    # Esc: the chevron is selected; Ctrl+B makes all of it bold.
    page.keyboard.press("Escape")
    check(not editing() and _selected(page) == chevron and page.is_visible("#overlay .selection-box"), "Esc: the chevron selected")
    check(typed["weight"] != "700", f"not bold yet: {typed['weight']}")
    page.keyboard.press("Control+b")
    check(text()["weight"] == "700" and text()["text"] == "Diligência", f"Ctrl+B: all of it bold: {text()}")

    # Enter: typing again; Ctrl+Z takes back the typing.
    page.keyboard.press("Enter")
    check(editing(), "Enter: typing again")
    page.keyboard.press("End")
    page.keyboard.type(" 2")
    check(text()["text"] == "Diligência 2", f"typed again: {text()}")
    page.keyboard.press("Control+z")
    check(text()["text"] == "Diligência" and text()["weight"] == "700", f"Ctrl+Z takes back the typing (still bold): {text()}")
    page.keyboard.press("Escape")
    check(not editing() and _selected(page) == chevron, "Esc: the chevron selected again")

    # Bullets and font colour work as in a text box: with the shape selected they change all its text ...
    page.click(".ribbon-tab[data-tab='home']")
    page.click('#ribbon-panel [data-command="bullets"]')
    listed = text()
    check(abs(listed["dx"]) > 5, f"(the letters' measure moves with the bullet's indent: {listed['dx']})")
    check(listed["lists"] == ["bullet"] and listed["marker"] not in ("none", "normal", "") and listed["markerWidth"] > 0,
          f"Bullets: the line is a bullet, its marker drawn: {listed}")
    page.keyboard.press("Control+z")
    check(text()["lists"] == ["none"], f"Ctrl+Z: no bullet: {text()}")
    page.click("#ribbon-panel .font-color-menu-button")
    page.click('.color-menu [title="Dark Red"]')
    check(text()["color"] == "rgb(192, 0, 0)", f"font colour Dark Red on all its text: {text()}")
    page.keyboard.press("Control+z")
    check(text()["color"] == "rgb(255, 255, 255)", f"Ctrl+Z: white again: {text()}")

    # ... and while typing, on the selected word.
    page.keyboard.press("Enter")
    page.keyboard.press("End")
    page.keyboard.press("Control+Shift+ArrowLeft")
    check(page.evaluate("App.deck.getDocument().getSelection().toString()") == "Diligência", "the word selected while typing")
    page.click('#ribbon-panel [data-command="bullets"]')
    check(editing() and text()["lists"] == ["bullet"], f"Bullets while typing: {text()}")
    page.keyboard.press("End")
    for _ in range(3):
        page.keyboard.press("Shift+ArrowLeft")   # only the last three letters selected: "cia"
    check(page.evaluate("App.deck.getDocument().getSelection().toString()") == "cia", "the last three letters selected")
    page.click("#ribbon-panel .font-color-menu-button")
    page.click('.color-menu [title="Dark Red"]')
    colours = page.evaluate("""id => { const area = App.deck.getDocument().querySelector('[data-id="' + id + '"] > .shape-text');
        const walker = area.ownerDocument.createTreeWalker(area, NodeFilter.SHOW_TEXT); const out = [];
        for (let n = walker.nextNode(); n; n = walker.nextNode()) { out.push([n.textContent, getComputedStyle(n.parentElement).color]); }
        return out; }""", chevron)
    check(editing() and colours == [["Dilig\u00eancia"[:-3], "rgb(255, 255, 255)"], ["cia", "rgb(192, 0, 0)"]],
          f"font colour while typing: only the selected letters dark red: {colours}")
    page.screenshot(path=str(e2e.OUTPUT / "gap-p5-text-bullet-colour.png"))
    page.keyboard.press("Control+z")
    page.keyboard.press("Control+z")
    check(text()["lists"] == ["none"] and text()["color"] == "rgb(255, 255, 255)", f"two Ctrl+Z: back to plain: {text()}")
    page.keyboard.press("Escape")

    # Double-click a line: nothing to type.
    _pick(page, "line")
    drag(page, slide_to_screen(page, 700, 650), slide_to_screen(page, 900, 650))
    line = _selected(page)
    page.keyboard.press("Escape")
    page.mouse.dblclick(*slide_to_screen(page, 800, 650))
    check(_selected(page) == line and not editing(), f"double-click on the line: selected, nothing to type ({_selected(page)})")
    page.keyboard.press("Escape")

    # Ctrl+F finds the word in the shape.
    count = page.evaluate("Array.from(App.deck.getDocument().querySelectorAll('.el')).filter((el) => el.textContent.includes('Diligência')).length")
    check(count == 1, f"the word is only in the chevron: {count}")
    page.keyboard.press("Control+f")
    check(page.is_visible("#find-panel"), "Ctrl+F opens Find")
    page.keyboard.type("Diligência")
    page.keyboard.press("Enter")
    found = page.evaluate("""() => { const e = App.text.editingElement();
        return { id: e && e.parentElement.getAttribute('data-id'), shape: !!e && e.classList.contains('shape-text'),
                 selected: App.deck.getDocument().getSelection().toString(), status: document.getElementById('find-status').textContent }; }""")
    check(found["id"] == chevron and found["shape"] and found["selected"] == "Diligência", f"Ctrl+F finds the word in the shape: {found}")
    page.screenshot(path=str(e2e.OUTPUT / "gap-p5-text-found.png"))
    page.keyboard.press("Escape")
    page.keyboard.press("Escape")

    # Save, reopen: the text is kept.
    saved = editor.save_as_download("gap-p5-text-in-shapes.html")
    editor.open(saved)
    _go_to_slide(page, 4)
    kept = text()
    check(kept["text"] == "Diligência" and kept["weight"] == "700" and kept["color"] == "rgb(255, 255, 255)"
          and abs(kept["dx"]) <= 2 and abs(kept["dy"]) <= 2, f"the text kept after reopening: {kept}")
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


# ----------------------------------------------------------------------
# Shape handles
# ----------------------------------------------------------------------

def test_gap_p5_shape_handles(browser):
    """Shape handles: draw a flat arrow (Shift): you can see it. Select it: a round handle at each end, no box. Drag
    the head's end around: the head follows; with Shift it snaps to 45°. One Ctrl+Z undoes one drag. Select a
    chevron: a yellow handle at the start of its point; drag it left: a deeper point. A callout's yellow handle moves
    the tip of its tail anywhere, even above the box. A rounded rectangle's yellow handle changes the corners"""
    editor = Editor(browser)
    editor.open(e2e.CONTRACT)
    page = editor.page
    shape = lambda id_: page.evaluate(SHAPE, id_)  # noqa: E731
    label = lambda: page.evaluate("App.history.undoLabel()")  # noqa: E731
    _go_to_slide(page, 4)

    # Draw a flat arrow (Shift): you can see it.
    region = (slide_to_screen(page, 150, 590), slide_to_screen(page, 250, 610))
    blank = e2e.dark_pixels(page, *region)
    _pick(page, "arrow")
    page.keyboard.down("Shift")
    drag(page, slide_to_screen(page, 100, 600), slide_to_screen(page, 300, 607))
    page.keyboard.up("Shift")
    arrow = _selected(page)
    flat = shape(arrow)
    check(flat["kind"] == "arrow" and flat["rect"]["height"] == 0 and round(flat["rect"]["width"]) == 200, f"a flat arrow: {flat}")
    page.keyboard.press("Escape")
    check(_selected(page) is None, "nothing selected over it")
    seen = e2e.dark_pixels(page, *region)
    check(seen - blank > 50, f"you can see it: {blank} -> {seen} dark pixels")

    # Select it: a round handle at each end, no box.
    page.mouse.click(*slide_to_screen(page, 200, 601))
    check(_selected(page) == arrow, "clicked: the arrow selected")
    handles = page.evaluate("""() => Array.from(document.querySelectorAll('#overlay .selection-box .selection-handle'))
        .filter((h) => h.offsetParent !== null && getComputedStyle(h).display !== 'none')
        .map((h) => { const r = h.getBoundingClientRect(), s = getComputedStyle(h);
            return { name: h.getAttribute('data-handle'), radius: s.borderTopLeftRadius, w: r.width, h: r.height }; })""")
    check(sorted(h["name"] for h in handles) == ["end", "start"], f"exactly two handles show, start and end: {handles}")
    check(all(h["radius"] == "50%" and abs(h["w"] - h["h"]) < 0.5 and h["w"] > 0 for h in handles), f"both round: {handles}")
    check(_near(_centre(page, _handle("start")), slide_to_screen(page, 100, 600))
          and _near(_centre(page, _handle("end")), slide_to_screen(page, 300, 600)), "one at each end of the arrow")
    box = page.evaluate("""() => { const b = document.querySelector('#overlay .selection-box');
        return { line: b.classList.contains('line'), outline: getComputedStyle(b).outlineStyle, shown: !b.hidden }; }""")
    check(box == {"line": True, "outline": "none", "shown": True}, f"no box drawn round it: {box}")
    page.screenshot(path=str(e2e.OUTPUT / "gap-p5-handles-line.png"))

    # Drag the head's end around: the head follows (two places).
    states = [(shape(arrow)["rect"], shape(arrow)["flip"])]
    for target in [(250, 700), (50, 500)]:
        drag(page, _centre(page, _handle("end")), slide_to_screen(page, *target))
        moved = shape(arrow)
        check(_near(_head_tip(moved), target, 0.5), f"the head followed to {target}: tip {_head_tip(moved)} {moved['rect']} {moved['flip']}")
        check(_near(_centre(page, _handle("start")), slide_to_screen(page, 100, 600)), "the other end stayed")
        check(label() == "Move line end", f"one undo step: {label()}")
        states.append((moved["rect"], moved["flip"]))

    # With Shift it snaps to 45 degrees (dropped at about 39 degrees from the other end).
    page.keyboard.down("Shift")
    drag(page, _centre(page, _handle("end")), slide_to_screen(page, 250, 720))
    page.keyboard.up("Shift")
    snapped = shape(arrow)
    tip = _head_tip(snapped)
    check(snapped["rect"]["width"] > 0 and abs(snapped["rect"]["width"] - snapped["rect"]["height"]) <= 0.02
          and _near(tip, [100 + snapped["rect"]["width"], 600 + snapped["rect"]["height"]], 0.5),
          f"Shift: snapped to 45 degrees (not where it was dropped, 150 x 120): {snapped['rect']} tip {tip}")
    states.append((snapped["rect"], snapped["flip"]))

    # One Ctrl+Z undoes one drag.
    for previous in reversed(states[:-1]):
        page.keyboard.press("Control+z")
        now = shape(arrow)
        check((now["rect"], now["flip"]) == previous, f"one Ctrl+Z undoes one drag: {now['rect']} {now['flip']} vs {previous}")
    page.keyboard.press("Escape")

    # Select a chevron: a yellow handle at the start of its point; drag it left: a deeper point.
    _pick(page, "chevron")
    drag(page, slide_to_screen(page, 300, 450), slide_to_screen(page, 500, 530))
    chevron = _selected(page)
    page.keyboard.press("Escape")
    page.mouse.click(*slide_to_screen(page, 400, 490))
    check(_selected(page) == chevron, "the chevron clicked: selected")
    check(page.is_visible(_handle("adjust")) and _near(_centre(page, _handle("adjust")), slide_to_screen(page, 460, 450)),
          "a handle at the start of its point (460, 450)")
    color = page.evaluate("getComputedStyle(document.querySelector(\"#overlay .selection-handle[data-handle='adjust']\")).backgroundColor")
    check(color == "rgb(255, 214, 0)", f"yellow: {color}")
    check(shape(chevron)["paths"][0] == "M0 0H160L200 40L160 80H0L40 40Z", f"the point 40 deep: {shape(chevron)['paths']}")
    drag(page, _centre(page, _handle("adjust")), slide_to_screen(page, 420, 450))
    check(shape(chevron)["paths"][0] == "M0 0H120L200 40L120 80H0L80 40Z", f"dragged left: a deeper point (80): {shape(chevron)['paths']}")
    page.keyboard.press("Escape")

    # A callout's yellow handle moves the tip of its tail anywhere, even above the box.
    tail_region = (slide_to_screen(page, 745, 265), slide_to_screen(page, 765, 290))
    tail_blank = e2e.dark_pixels(page, *tail_region)
    _pick(page, "callout")
    page.mouse.click(*slide_to_screen(page, 700, 300))
    callout = _selected(page)
    box_rect = shape(callout)["rect"]
    tail_tip = lambda: page.evaluate(  # noqa: E731
        """id => { const el = App.deck.getDocument().querySelector('[data-id="' + id + '"]');
            const a = App.shapes.adjustOf(el), r = App.transform.readRect(el); return [r.left + a[0] * r.width, r.top + a[1] * r.height]; }""", callout)
    painted = lambda: page.evaluate("""id => { const el = App.deck.getDocument().querySelector('[data-id="' + id + '"]');
        const p = el.querySelector('path.shape-fill').getBoundingClientRect(), r = el.getBoundingClientRect();
        return { top: p.top - r.top, bottom: p.bottom - r.bottom, left: p.left - r.left, right: p.right - r.right }; }""", callout)  # noqa: E731
    for target, where, side, beyond in [((940, 360), "right", "right", 60), ((620, 470), "below left", "left", -60),
                                        ((780, 230), "above", "top", -60)]:
        drag(page, _centre(page, _handle("adjust")), slide_to_screen(page, *target))
        check(_near(tail_tip(), target, 1), f"the tail's tip moved {where}, to {target}: {tail_tip()}")
        check(shape(callout)["rect"] == box_rect, "the box itself stays")
        drawn = painted()[side]
        check(drawn > beyond if beyond > 0 else drawn < beyond, f"the tail is drawn out past the box's {side}: {painted()}")
    above = painted()
    check(above["top"] < -60, f"the tail is drawn above the box: {above}")
    page.keyboard.press("Escape")
    above_pixels = e2e.dark_pixels(page, *tail_region)
    check(above_pixels - tail_blank > 20, f"painted above the box: {tail_blank} -> {above_pixels} dark pixels")
    page.screenshot(path=str(e2e.OUTPUT / "gap-p5-handles-callout.png"))

    # A rounded rectangle's yellow handle changes the corners.
    _pick(page, "roundRect")
    page.mouse.click(*slide_to_screen(page, 900, 450))
    rounded = _selected(page)
    radius = lambda: float(re.search(r"A([\d.]+) ", shape(rounded)["paths"][0]).group(1))  # noqa: E731
    size = shape(rounded)["rect"]
    corner = radius()
    check(page.is_visible(_handle("adjust")) and _near(_centre(page, _handle("adjust")), slide_to_screen(page, 900 + corner, 450)),
          f"a yellow handle at the corner's end ({corner}): {_centre(page, _handle('adjust'))}")
    rr_color = page.evaluate("getComputedStyle(document.querySelector(\"#overlay .selection-handle[data-handle='adjust']\")).backgroundColor")
    check(rr_color == "rgb(255, 214, 0)", f"yellow: {rr_color}")
    drag(page, _centre(page, _handle("adjust")), slide_to_screen(page, 950, 450))
    check(radius() == 50 and corner != 50 and shape(rounded)["rect"] == size, f"the corners changed: {corner} -> {radius()}")
    page.screenshot(path=str(e2e.OUTPUT / "gap-p5-handles-rounded.png"))
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


TESTS = [test_gap_p5_shapes, test_gap_p5_shape_format, test_gap_p5_text_in_shapes, test_gap_p5_shape_handles]
