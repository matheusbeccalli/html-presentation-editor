"""
Phase 7 hand checks (second set) replayed literally in Edge: real clicks, drags and keys, one assertion per step.
Each test follows its FEATURES.md hand check from start to end (quoted in the docstring).
"""

import shutil

import e2e_test as e2e
from e2e_test import Editor, check, drag, element_rect, slide_to_screen, wait_until

# Contract deck, slide 1: e1 logo (64,56 120x40), e2 title (64,230 1100x120), e3 bar (64,350 140x8),
# e4 subtitle (64,378 1100x70). Slides s1 (title) ... s6; s5 hidden.
TITLE_SLIDE_TITLE = {"left": 64, "top": 230, "width": 1100, "height": 120}    # s1's title (e2)
CONTENT_TITLE = {"left": 64, "top": 48, "width": 1152, "height": 60}          # the content slides' titles (e5 ...)


def _centre(page, selector):
    box = page.locator(selector).bounding_box()
    return [box["x"] + box["width"] / 2, box["y"] + box["height"] / 2]


def _handle(name):
    return f"#overlay .selection-handle[data-handle='{name}']"


def _click(page, x, y, shift=False, button="left"):
    if shift:
        page.keyboard.down("Shift")
    page.mouse.click(*slide_to_screen(page, x, y), button=button)
    if shift:
        page.keyboard.up("Shift")


def _go_to_slide(page, index):
    page.click(f".thumb[data-index='{index}']")
    wait_until(page, f"App.deck.getCurrentIndex() === {index}")


def _ids(page):
    return page.evaluate("App.selection.selectedIds()")


def _on_slide(page, data_id):
    """Where an element really is on the slide (slide px), grouped or not."""
    return page.evaluate("""id => {
        const r = App.deck.getDocument().querySelector('[data-id="' + id + '"]').getBoundingClientRect();
        return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; }""", data_id)


def _is_red(color):
    rgb = [int(float(v)) for v in color[color.index("(") + 1:color.index(")")].split(",")[:3]]
    return rgb[0] >= 200 and rgb[1] <= 110 and rgb[2] <= 110


# ----------------------------------------------------------------------
# 1. Slides: Home > New Slide
# ----------------------------------------------------------------------

SLIDE_STATE = """() => { const s = App.deck.getCurrentSlide(); const t = App.slides.titleOf(s);
    return { count: App.deck.getSlides().length, index: App.deck.getCurrentIndex(), id: s.getAttribute('data-slide-id'),
             layout: s.getAttribute('data-layout'), order: App.deck.getSlides().map((x) => x.getAttribute('data-slide-id')),
             texts: Array.from(s.querySelectorAll(':scope > .el'), (e) => e.textContent.trim()),
             thumbs: document.querySelectorAll('#thumbnail-rail .thumb').length,
             currentThumb: Array.from(document.querySelectorAll('#thumbnail-rail .thumb.thumb-current'), (c) => Number(c.getAttribute('data-index'))).join(','),
             title: t ? App.transform.readRect(t) : null,
             titleLook: t ? [getComputedStyle(t).fontSize, getComputedStyle(t).fontFamily, getComputedStyle(t).color] : null }; }"""

LOOK_OF = """id => { const e = App.deck.getDocument().querySelector('[data-id="' + id + '"]');
    return [getComputedStyle(e).fontSize, getComputedStyle(e).fontFamily, getComputedStyle(e).color]; }"""

DECK_SLIDES = """() => App.deck.getSlides().map((s) => [s.getAttribute('data-slide-id'), s.getAttribute('data-layout'),
    Array.from(s.querySelectorAll(':scope > .el'), (e) => e.textContent.trim()).join('|')])"""


def test_gap_p7b_new_slide(browser):
    """Slides: Home > New Slide ▾ > Title and Content (and the other three): the new slide comes after the one
    shown, its title where your titles are. Ctrl+M adds one too. Right-click a thumbnail > Duplicate Slide; click a
    thumbnail and press Delete: gone, the next one shown. Ctrl+Z after each: undone, and the slide it was about is
    shown. Save, reopen: the slides are there."""
    editor = Editor(browser)
    editor.open(e2e.CONTRACT)
    page = editor.page
    now = lambda: page.evaluate(SLIDE_STATE)  # noqa: E731
    title_look = page.evaluate(LOOK_OF, "e2")      # the deck's title-slide title
    content_look = page.evaluate(LOOK_OF, "e5")    # the deck's slide titles

    def undo_redo(before, made_id, made_index, what):
        """Ctrl+Z: undone, the slide it was about (the one shown before) shown; Ctrl+Y: back, shown."""
        page.keyboard.press("Control+z")
        undone = now()
        check(undone["order"] == before["order"] and undone["id"] == before["id"] and undone["thumbs"] == before["count"],
              f"Ctrl+Z after {what}: undone, slide {before['id']} shown: {undone}")
        page.keyboard.press("Control+y")
        redone = now()
        check(made_id in redone["order"] and redone["id"] == made_id and redone["index"] == made_index,
              f"Ctrl+Y after {what}: back, shown: {redone}")

    page.click(".ribbon-tab[data-tab='home']")
    _go_to_slide(page, 1)

    # Home > New Slide ▾ > each of the four layouts: after the slide shown, the title where the deck's titles are.
    for layout, label in [("title-content", "Title and Content"), ("title", "Title Slide"),
                          ("two-columns", "Two Content"), ("blank", "Blank")]:
        before = now()
        page.click(".ribbon-button.new-slide-button")
        items = page.locator(".slide-layout-gallery .slide-layout-item")
        check(items.count() == 4 and page.is_visible(".slide-layout-gallery"), f"the gallery with four layouts: {items.count()}")
        page.click(f".slide-layout-gallery .slide-layout-item:has-text('{label}')")
        check(page.locator(".slide-layout-gallery").count() == 0, "the gallery closes")
        after = now()
        check(after["count"] == before["count"] + 1 and after["index"] == before["index"] + 1
              and after["order"][before["index"]] == before["id"] and after["layout"] == layout
              and after["thumbs"] == after["count"] and after["currentThumb"] == str(after["index"]),
              f"{label}: a new slide right after the one shown, shown: {before['index']} -> {after}")
        if layout == "title":
            check(after["title"] == TITLE_SLIDE_TITLE and after["titleLook"] == title_look,
                  f"{label}: its title where (and as) the deck's title slide's: {after['title']} {after['titleLook']}")
        elif layout == "blank":
            check(after["texts"] == [] and after["title"] is None, f"{label}: nothing on it (no title): {after['texts']}")
        else:
            check(after["title"] == CONTENT_TITLE and after["titleLook"] == content_look,
                  f"{label}: its title where (and as) the deck's slide titles: {after['title']} {after['titleLook']}")
        undo_redo(before, after["id"], after["index"], f"New Slide > {label}")
    page.screenshot(path=str(e2e.OUTPUT / "gap-p7b-new-slides.png"))

    # Ctrl+M adds one too (after the slide shown). Ctrl+Z / Ctrl+Y.
    _go_to_slide(page, 2)
    page.mouse.click(*slide_to_screen(page, 1250, 700))   # on the slide, so the key goes to the editor
    before = now()
    page.keyboard.press("Control+m")
    after = now()
    check(after["count"] == before["count"] + 1 and after["index"] == before["index"] + 1
          and after["order"][before["index"]] == before["id"] and after["title"] == CONTENT_TITLE,
          f"Ctrl+M: a new slide after the one shown: {after}")
    undo_redo(before, after["id"], after["index"], "Ctrl+M")

    # Right-click a thumbnail > Duplicate Slide: its copy right after it, shown. Ctrl+Z / Ctrl+Y.
    page.click("#thumbnail-rail .thumb[data-index='0']")
    page.click("#thumbnail-rail .thumb[data-index='1']", button="right")
    check(now()["index"] == 1, "right-click shows that slide")
    before = now()
    page.click(".context-menu .menu-label:text-is('Duplicate Slide')")
    after = now()
    check(after["count"] == before["count"] + 1 and after["index"] == 2 and after["order"][1] == before["id"]
          and after["id"] != before["id"] and after["texts"] == before["texts"],
          f"Duplicate Slide: the copy after it, shown: {after}")
    undo_redo(before, after["id"], after["index"], "Duplicate Slide")

    # Click a thumbnail and press Delete: gone, the next one shown. Ctrl+Z: back, shown; Ctrl+Y: gone again.
    page.click("#thumbnail-rail .thumb[data-index='3']")
    before = now()
    following = before["order"][4]
    page.keyboard.press("Delete")
    after = now()
    check(after["count"] == before["count"] - 1 and before["id"] not in after["order"] and after["id"] == following
          and after["index"] == 3, f"Delete: gone, the next one shown: {after}")
    page.keyboard.press("Control+z")
    undone = now()
    check(undone["order"] == before["order"] and undone["id"] == before["id"],
          f"Ctrl+Z after Delete: back, the deleted slide shown: {undone}")
    page.keyboard.press("Control+y")
    redone = now()
    check(before["id"] not in redone["order"] and redone["id"] == following, f"Ctrl+Y: deleted again: {redone}")

    # Save, reopen: the slides are there (order, layouts, texts).
    slides = page.evaluate(DECK_SLIDES)
    saved = editor.save_as_download("gap-p7b-slides.html")
    editor.open(saved)
    check(page.evaluate(DECK_SLIDES) == slides and editor.slide_count() == len(slides) == 11,
          f"after reopening: the slides are there: {page.evaluate(DECK_SLIDES)}")
    check(page.locator("#thumbnail-rail .thumb").count() == 11, "and their thumbnails")
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


# ----------------------------------------------------------------------
# 2. Multi-select
# ----------------------------------------------------------------------

OUTLINES = """() => { const o = document.getElementById('overlay').getBoundingClientRect(); const z = App.canvas.getZoom();
    return Array.from(document.querySelectorAll('#overlay .selection-outline')).filter((e) => e.offsetParent !== null)
        .map((e) => { const r = e.getBoundingClientRect();
            return [Math.round((r.left - o.left) / z), Math.round((r.top - o.top) / z),
                    Math.round(r.width / z), Math.round(r.height / z)]; }); }"""


def test_gap_p7b_multi_select(browser):
    """Multi-select: click the title, Shift+click the subtitle: both outlined; drag one of them: both move; Ctrl+Z.
    Drag a rectangle from an empty corner over several boxes: those wholly inside are selected. Ctrl+A, then
    Delete: all gone; Ctrl+Z. Select two, Ctrl+C, go to another slide, Ctrl+V: both pasted where they were."""
    editor = Editor(browser)
    editor.open(e2e.CONTRACT)
    page = editor.page
    rects = lambda names: [element_rect(page, n) for n in names]  # noqa: E731
    count = lambda: page.evaluate("App.deck.getCurrentSlide().querySelectorAll(':scope > .el').length")  # noqa: E731
    original = rects(["e1", "e2", "e3", "e4"])

    # Click the title, Shift+click the subtitle: both outlined.
    _click(page, 600, 280)
    check(_ids(page) == ["e2"], f"the title selected: {_ids(page)}")
    _click(page, 600, 410, shift=True)
    check(sorted(_ids(page)) == ["e2", "e4"], f"both selected: {_ids(page)}")
    outlines = sorted(page.evaluate(OUTLINES))
    check(outlines == [[64, 230, 1100, 120], [64, 378, 1100, 70]], f"an outline round each of the two: {outlines}")

    # Drag one of them (the title): both move by the same amount; the others stay. Ctrl+Z: both back.
    drag(page, slide_to_screen(page, 600, 280), slide_to_screen(page, 640, 310), steps=10)
    moved = rects(["e1", "e2", "e3", "e4"])
    dx, dy = moved[1]["left"] - original[1]["left"], moved[1]["top"] - original[1]["top"]
    check(abs(dx - 40) <= 6 and abs(dy - 30) <= 6, f"the dragged title followed the mouse: {dx} {dy}")
    check(moved[3]["left"] - original[3]["left"] == dx and moved[3]["top"] - original[3]["top"] == dy,
          f"the subtitle moved with it: {moved[3]}")
    check(moved[0] == original[0] and moved[2] == original[2], "the logo and bar stayed")
    page.keyboard.press("Control+z")
    check(rects(["e1", "e2", "e3", "e4"]) == original, f"Ctrl+Z: both back: {rects(['e2', 'e4'])}")

    # A rectangle from the empty top-left corner over the logo and the bar (the title only partly): logo and bar.
    page.keyboard.press("Escape")
    page.mouse.move(*slide_to_screen(page, 10, 10))
    page.mouse.down()
    page.mouse.move(*slide_to_screen(page, 700, 370), steps=10)
    check(page.is_visible(".rubber-band"), "the rectangle shows while dragging")
    page.screenshot(path=str(e2e.OUTPUT / "gap-p7b-rubber-band.png"))
    page.mouse.up()
    check(sorted(_ids(page)) == ["e1", "e3"], f"only those wholly inside (not the title, partly in): {_ids(page)}")
    check(rects(["e1", "e2", "e3", "e4"]) == original, "the band moved nothing")

    # Ctrl+A, then the Delete key: all gone. Ctrl+Z: all back.
    page.keyboard.press("Control+a")
    check(sorted(_ids(page)) == ["e1", "e2", "e3", "e4"], f"Ctrl+A: all: {_ids(page)}")
    page.keyboard.press("Delete")
    check(count() == 0, f"Delete: all gone: {count()}")
    page.keyboard.press("Control+z")
    check(count() == 4 and rects(["e1", "e2", "e3", "e4"]) == original, "Ctrl+Z: all back, in place")

    # Select two (title, Shift+click the logo), Ctrl+C, go to slide 2, Ctrl+V: both pasted where they were.
    page.keyboard.press("Escape")
    _click(page, 600, 280)
    _click(page, 110, 75, shift=True)
    check(sorted(_ids(page)) == ["e1", "e2"], f"two selected: {_ids(page)}")
    page.keyboard.press("Control+c")
    _go_to_slide(page, 1)
    before = count()
    page.keyboard.press("Control+v")
    pasted = _ids(page)
    check(page.evaluate("App.deck.getCurrentIndex()") == 1 and count() == before + 2 and len(pasted) == 2,
          f"Ctrl+V on slide 2: both pasted: {pasted} {count()}")
    on_slide2 = page.evaluate("ids => ids.map((id) => !!App.deck.getCurrentSlide().querySelector(':scope > [data-id=\"' + id + '\"]'))", pasted)
    check(on_slide2 == [True, True], "the copies are on slide 2")
    check(sorted(map(str, rects(pasted))) == sorted(map(str, [original[0], original[1]])),
          f"where they were: {rects(pasted)}")
    texts = page.evaluate("ids => ids.map((id) => App.deck.getDocument().querySelector('[data-id=\"' + id + '\"]').textContent.trim())", pasted)
    check(page.evaluate(TEXT_OF, "e2") in texts, f"the title's copy: {texts}")
    page.screenshot(path=str(e2e.OUTPUT / "gap-p7b-pasted.png"))
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


TEXT_OF = "id => App.deck.getDocument().querySelector('[data-id=\"' + id + '\"]').textContent.trim()"


# ----------------------------------------------------------------------
# 3. Align and distribute
# ----------------------------------------------------------------------

def test_gap_p7b_align(browser):
    """Align and distribute: click the logo, Arrange > Align center: it moves to the middle of the slide. Select
    three boxes (Shift+click), Align left: their left edges line up; Distribute vertically: equal gaps, the top and
    bottom ones stay. Turn on Align to slide, Align middle: all three on the slide's middle line. Ctrl+Z after
    each."""
    editor = Editor(browser)
    editor.open(e2e.CONTRACT)
    page = editor.page
    rect = lambda name: element_rect(page, name)  # noqa: E731
    three = lambda: [rect(n) for n in ["e1", "e3", "e4"]]  # noqa: E731
    button = lambda name: "button[data-command='" + name + "']"  # noqa: E731
    selected3 = lambda: sorted(_ids(page)) == ["e1", "e3", "e4"]  # noqa: E731

    # Click the logo, Arrange > Align center: the middle of the slide. Ctrl+Z: back; Ctrl+Y: centred again.
    page.click(".ribbon-tab[data-tab='arrange']")
    _click(page, 120, 76)
    check(_ids(page) == ["e1"], f"the logo selected: {_ids(page)}")
    page.click(button("alignObjectsCenter"))
    check(rect("e1") == {"left": 580, "top": 56, "width": 120, "height": 40}, f"in the middle of the slide: {rect('e1')}")
    page.keyboard.press("Control+z")
    check(rect("e1")["left"] == 64, f"Ctrl+Z after Align center: back: {rect('e1')}")
    page.keyboard.press("Control+y")
    check(rect("e1")["left"] == 580, f"Ctrl+Y: centred again: {rect('e1')}")

    # Three boxes with Shift+click: the (centred) logo, the bar, the subtitle; Align left: left edges line up.
    _click(page, 640, 76)
    _click(page, 100, 354, shift=True)
    _click(page, 600, 410, shift=True)
    check(selected3(), f"three selected: {_ids(page)}")
    check(page.get_attribute(button("alignToSlide"), "aria-pressed") == "false", "several: aligned on each other")
    before = three()
    page.click(button("alignObjectsLeft"))
    lefts = [r["left"] for r in three()]
    check(lefts == [64, 64, 64] and before[0]["left"] == 580, f"Align left: left edges line up: {lefts}")
    check([r["top"] for r in three()] == [r["top"] for r in before], "only sideways")
    page.keyboard.press("Control+z")
    check(three() == before and selected3(), f"Ctrl+Z after Align left: back, still selected: {three()}")
    page.keyboard.press("Control+y")
    check([r["left"] for r in three()] == [64, 64, 64] and selected3(), "Ctrl+Y: lined up again")

    # Distribute vertically: equal gaps, the top (logo) and bottom (subtitle) stay.
    before = three()
    page.click(button("distributeVertically"))
    after = three()
    gap1 = after[1]["top"] - (after[0]["top"] + after[0]["height"])
    gap2 = after[2]["top"] - (after[1]["top"] + after[1]["height"])
    check(abs(gap1 - gap2) <= 0.02 and after[1]["top"] != before[1]["top"], f"equal gaps: {gap1} {gap2} ({after[1]})")
    check(after[0] == before[0] and after[2] == before[2], f"the top and bottom ones stay: {after[0]} {after[2]}")
    page.screenshot(path=str(e2e.OUTPUT / "gap-p7b-distributed.png"))
    page.keyboard.press("Control+z")
    check(three() == before and selected3(), f"Ctrl+Z after Distribute: back: {three()}")
    page.keyboard.press("Control+y")
    check(three() == after, "Ctrl+Y: distributed again")

    # Align to slide on, Align middle: all three on the slide's middle line (y 360).
    before = three()
    page.click(button("alignToSlide"))
    check(page.get_attribute(button("alignToSlide"), "aria-pressed") == "true", "Align to slide is on")
    page.click(button("alignObjectsMiddle"))
    middles = [r["top"] + r["height"] / 2 for r in three()]
    check(all(abs(m - 360) <= 0.01 for m in middles), f"all three on the slide's middle line: {middles}")
    check([r["left"] for r in three()] == [64, 64, 64], "only up and down")
    page.screenshot(path=str(e2e.OUTPUT / "gap-p7b-middle.png"))
    page.keyboard.press("Control+z")
    check(three() == before and selected3(), f"Ctrl+Z after Align middle: back: {three()}")
    page.keyboard.press("Control+y")
    check(all(abs(r["top"] + r["height"] / 2 - 360) <= 0.01 for r in three()), "Ctrl+Y: on the middle line again")
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


# ----------------------------------------------------------------------
# 4. Smart guides, gridlines, rulers
# ----------------------------------------------------------------------

GUIDES = """() => Array.from(document.querySelectorAll('.smart-guide')).filter((g) => g.offsetParent !== null)
    .map((g) => ({ vertical: g.classList.contains('vertical'), left: parseFloat(g.style.left), top: parseFloat(g.style.top),
                   width: parseFloat(g.style.width), height: parseFloat(g.style.height),
                   color: getComputedStyle(g).backgroundColor, shown: g.getBoundingClientRect().width > 0 && g.getBoundingClientRect().height > 0 }))"""

RULER_SHADE = """which => { const r = document.querySelector('.ruler-' + which + ' .ruler-range');
    if (!r) { return null; }
    return { x: Number(r.getAttribute('x')), y: Number(r.getAttribute('y')), width: Number(r.getAttribute('width')),
             height: Number(r.getAttribute('height')), fill: getComputedStyle(r).fill }; }"""


def test_gap_p7b_smart_guides(browser):
    """Smart guides: drag the logo slowly towards the middle of the slide: a red line appears and the logo jumps
    onto the centre; keep dragging with Alt held: it moves freely, no line. Drag a box so its left edge comes near
    another box's left edge: it snaps, a red line joins them. Drag a box's right handle near another's right edge:
    it snaps. View > Ruler and Gridlines: rulers and a grid appear, the selected box shaded on the rulers; Shift+F9
    hides the grid; close and reopen the editor: the ruler is still on."""
    profile = e2e.OUTPUT / "gap-p7b-profile-rulers"
    shutil.rmtree(profile, ignore_errors=True)
    editor = Editor(browser, e2e.launch_profile(profile))   # a real browser profile: closed and opened again below
    editor.open(e2e.CONTRACT)
    page = editor.page
    rect = lambda name: element_rect(page, name)  # noqa: E731
    guides = lambda: page.evaluate(GUIDES)  # noqa: E731
    zoom = page.evaluate("App.canvas.getZoom()")

    # Drag the logo slowly towards the middle: its centre comes 2 px from the centre line: a red line, it jumps on.
    page.mouse.move(*slide_to_screen(page, 120, 76))
    page.mouse.down()
    page.mouse.move(*slide_to_screen(page, 120 + 518, 76), steps=40)
    lines = guides()
    check(rect("e1")["left"] == 580, f"the logo jumped onto the centre (left 580, not 582): {rect('e1')}")
    check(len(lines) == 1 and lines[0]["vertical"] and lines[0]["left"] == 640 and lines[0]["shown"],
          f"a line on the slide's centre: {lines}")
    check(_is_red(lines[0]["color"]), f"the line is red: {lines[0]['color']}")
    page.screenshot(path=str(e2e.OUTPUT / "gap-p7b-guide-centre.png"))
    # Keep dragging with Alt held: it follows the mouse freely (not pulled back to 580), no line.
    page.keyboard.down("Alt")
    page.mouse.move(*slide_to_screen(page, 120 + 520, 78), steps=4)
    check(abs(rect("e1")["left"] - 584) <= 1 and abs(rect("e1")["top"] - 58) <= 1, f"Alt: moves freely: {rect('e1')}")
    check(guides() == [], f"Alt: no line: {guides()}")
    page.mouse.up()
    page.keyboard.up("Alt")
    check(abs(rect("e1")["left"] - 584) <= 1 and guides() == [], f"dropped where the mouse put it: {rect('e1')}")
    page.keyboard.press("Control+z")
    check(rect("e1")["left"] == 64, "Ctrl+Z: the logo back")

    # Drag the bar so its left edge comes 3 px right of the other boxes' left edge (64): it snaps, a red line joins them.
    page.mouse.move(*slide_to_screen(page, 100, 354))
    page.mouse.down()
    page.mouse.move(*slide_to_screen(page, 103, 164), steps=12)
    check(rect("e3")["left"] == 64 and rect("e3")["top"] == 160, f"the bar's left edge snapped onto 64: {rect('e3')}")
    lines = [g for g in guides() if g["vertical"] and g["left"] == 64]
    check(len(lines) == 1 and lines[0]["shown"] and _is_red(lines[0]["color"]), f"a red line at x 64: {guides()}")
    span = (lines[0]["top"], lines[0]["top"] + lines[0]["height"])
    joined = [n for n in ["e1", "e2", "e4"] if span[0] <= rect(n)["top"] and rect(n)["top"] + rect(n)["height"] <= span[1]]
    check(span[0] <= 160 and span[1] >= 168 and joined, f"the line joins the bar and another box ({joined}): {span}")
    page.screenshot(path=str(e2e.OUTPUT / "gap-p7b-guide-edge.png"))
    page.mouse.up()
    check(rect("e3")["left"] == 64 and guides() == [], f"dropped snapped, the line goes: {rect('e3')}")
    page.keyboard.press("Control+z")
    check(rect("e3") == {"left": 64, "top": 350, "width": 140, "height": 8}, "Ctrl+Z: the bar back")

    # Drag the bar's right handle to 3 px short of the title's right edge (1164): it snaps onto it.
    _click(page, 100, 354)
    check(_ids(page) == ["e3"], f"the bar selected: {_ids(page)}")
    start = _centre(page, _handle("e"))
    page.mouse.move(*start)
    page.mouse.down()
    page.mouse.move(start[0] + (1161 - 204) * zoom, start[1], steps=12)
    check(rect("e3")["left"] == 64 and rect("e3")["width"] == 1100, f"the right edge snapped onto 1164: {rect('e3')}")
    page.mouse.up()
    check(rect("e3")["width"] == 1100, f"dropped snapped: {rect('e3')}")
    page.keyboard.press("Control+z")

    # View > Ruler and Gridlines: rulers and a grid appear; the selected box shaded on both rulers.
    page.click(".ribbon-tab[data-tab='view']")
    check(page.is_hidden(".gridlines") and page.is_hidden(".ruler-top") and page.is_hidden(".ruler-left"), "both off at first")
    page.click("button[data-command='toggleRulers']")
    page.click("button[data-command='toggleGridlines']")
    check(page.is_visible(".ruler-top") and page.is_visible(".ruler-left"), "rulers appear")
    check(page.is_visible(".gridlines") and "linear-gradient" in page.evaluate(
        "getComputedStyle(document.querySelector('.gridlines')).backgroundImage"), "a grid appears")
    _click(page, 120, 76)
    check(_ids(page) == ["e1"], "the logo selected")
    top, left = page.evaluate(RULER_SHADE, "top"), page.evaluate(RULER_SHADE, "left")
    check(top is not None and abs(top["x"] - 64 * zoom) < 1 and abs(top["width"] - 120 * zoom) < 1,
          f"the logo shaded on the top ruler (64..184): {top}")
    check(left is not None and abs(left["y"] - 56 * zoom) < 1 and abs(left["height"] - 40 * zoom) < 1,
          f"and on the left ruler (56..96): {left}")
    check(top["fill"] not in ("none", "rgba(0, 0, 0, 0)", "transparent"), f"shaded: {top['fill']}")
    page.screenshot(path=str(e2e.OUTPUT / "gap-p7b-rulers.png"))

    # Shift+F9 hides the grid (the rulers stay).
    page.keyboard.press("Shift+F9")
    check(page.is_hidden(".gridlines") and page.is_visible(".ruler-top"), "Shift+F9: the grid hidden, the rulers stay")
    check(editor.errors == [], f"no errors: {editor.errors}")

    # Close the editor (the whole browser) and open it again: the ruler is still on (and the grid still off).
    editor.close()
    editor = Editor(browser, e2e.launch_profile(profile))
    page = editor.page
    editor.open(e2e.CONTRACT)
    check(page.is_visible(".ruler-top") and page.is_visible(".ruler-left"), "after reopening: the ruler is still on")
    page.click(".ribbon-tab[data-tab='view']")
    check(page.get_attribute("button[data-command='toggleRulers']", "aria-pressed") == "true", "View > Ruler is lit")
    check(page.is_hidden(".gridlines"), "and the grid still off")
    page.screenshot(path=str(e2e.OUTPUT / "gap-p7b-rulers-reopened.png"))
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


# ----------------------------------------------------------------------
# 5. Group
# ----------------------------------------------------------------------

GROUPS = "App.deck.getDocument().querySelectorAll('[data-type=\"group\"]').length"
PARTS = "id => Array.from(App.deck.getDocument().querySelectorAll('[data-id=\"' + id + '\"] > .el'), (e) => e.getAttribute('data-id'))"


def test_gap_p7b_group(browser):
    """Group: click the title, Shift+click the subtitle, Ctrl+G: one box round both (Format pane: Group); drag it:
    both move; drag its right handle: both get narrower; double-click the subtitle and type: the text changes, Esc:
    the group is selected again. Ctrl+Shift+G: the two are separate again. Ctrl+Z after each. Group them, save,
    reopen: still one group, in place."""
    editor = Editor(browser)
    editor.open(e2e.CONTRACT)
    page = editor.page
    groups = lambda: page.evaluate(GROUPS)  # noqa: E731
    title0, sub0 = _on_slide(page, "e2"), _on_slide(page, "e4")
    text0 = page.evaluate(TEXT_OF, "e4")

    def box():
        """The selection box on screen, in slide px."""
        return page.evaluate("""() => { const b = document.querySelector('#overlay .selection-box');
            if (!b || b.offsetParent === null) { return null; }
            const o = document.getElementById('overlay').getBoundingClientRect(); const z = App.canvas.getZoom();
            const r = b.getBoundingClientRect();
            return [Math.round((r.left - o.left) / z), Math.round((r.top - o.top) / z), Math.round(r.width / z), Math.round(r.height / z)]; }""")

    def group_it():
        _click(page, 600, 280)
        _click(page, 600, 410, shift=True)
        check(sorted(_ids(page)) == ["e2", "e4"], f"title and subtitle selected: {_ids(page)}")
        page.keyboard.press("Control+g")

    # Ctrl+G: one box round both; the Format pane says Group.
    group_it()
    check(groups() == 1 and len(_ids(page)) == 1, f"one group, selected: {_ids(page)}")
    group = _ids(page)[0]
    check(sorted(page.evaluate(PARTS, group)) == ["e2", "e4"], "holding the title and the subtitle")
    check(box() == [64, 230, 1100, 218], f"one box round both: {box()}")
    check(page.locator("#overlay .selection-outline:visible").count() == 0, "not two outlines")
    check(page.is_visible("#format-type") and page.inner_text("#format-type") == "Group", f"Format pane: {page.inner_text('#format-type')}")
    check(_on_slide(page, "e2") == title0 and _on_slide(page, "e4") == sub0, "neither moved")
    page.screenshot(path=str(e2e.OUTPUT / "gap-p7b-grouped.png"))
    page.keyboard.press("Control+z")
    check(groups() == 0 and sorted(page.evaluate(
        "App.transform.topLevelElements(App.deck.getCurrentSlide()).map((e) => e.getAttribute('data-id'))")) == ["e1", "e2", "e3", "e4"],
        "Ctrl+Z after Ctrl+G: two separate boxes again")
    page.keyboard.press("Control+y")
    check(groups() == 1 and sorted(page.evaluate(PARTS, group)) == ["e2", "e4"], f"Ctrl+Y: grouped again: {page.evaluate(PARTS, group)}")

    # Drag it with the mouse: both move. Ctrl+Z.
    drag(page, slide_to_screen(page, 600, 280), slide_to_screen(page, 640, 310), steps=10)
    t, s = _on_slide(page, "e2"), _on_slide(page, "e4")
    dx, dy = t[0] - title0[0], t[1] - title0[1]
    check(abs(dx - 40) <= 6 and abs(dy - 30) <= 6 and s[0] - sub0[0] == dx and s[1] - sub0[1] == dy,
          f"both moved together: {t} {s}")
    check(_ids(page) == [group], "the group still selected")
    page.keyboard.press("Control+z")
    check(_on_slide(page, "e2") == title0 and _on_slide(page, "e4") == sub0, "Ctrl+Z after the drag: both back")

    # Drag its right handle half way in: both get narrower. Ctrl+Z.
    zoom = page.evaluate("App.canvas.getZoom()")
    start = _centre(page, _handle("e"))
    drag(page, start, [start[0] - 550 * zoom, start[1]], steps=12)
    t, s = _on_slide(page, "e2"), _on_slide(page, "e4")
    check(abs(t[2] - 550) <= 6 and abs(s[2] - 550) <= 6 and t[0] == 64 and s[0] == 64, f"both narrower: {t} {s}")
    page.keyboard.press("Control+z")
    check(_on_slide(page, "e2") == title0 and _on_slide(page, "e4") == sub0, "Ctrl+Z after the resize: both as wide as before")

    # Double-click the subtitle and type: the text changes; Esc: the group selected again. Ctrl+Z.
    page.mouse.dblclick(*slide_to_screen(page, 300, 400))
    check(page.evaluate("App.text.isEditing() && App.text.editingElement().getAttribute('data-id')") == "e4", "typing in the subtitle")
    page.keyboard.press("End")
    page.keyboard.type(" Z9")
    check(page.evaluate(TEXT_OF, "e4") == text0 + " Z9", f"the text changes: {page.evaluate(TEXT_OF, 'e4')}")
    page.keyboard.press("Escape")
    check(not page.evaluate("App.text.isEditing()") and _ids(page) == [group] and box() is not None, f"Esc: the group selected: {_ids(page)}")
    page.keyboard.press("Control+z")
    check(page.evaluate(TEXT_OF, "e4") == text0 and groups() == 1, f"Ctrl+Z after typing: the text back: {page.evaluate(TEXT_OF, 'e4')}")

    # Ctrl+Shift+G: separate again. Ctrl+Z: grouped; Ctrl+Y: separate.
    page.click("#overlay", position={"x": 5, "y": 5})
    _click(page, 600, 280)
    check(_ids(page) == [group], "a click on a part selects the group")
    page.keyboard.press("Control+Shift+g")
    check(groups() == 0 and sorted(_ids(page)) == ["e2", "e4"], f"Ctrl+Shift+G: the two separate again: {_ids(page)}")
    check(_on_slide(page, "e2") == title0 and _on_slide(page, "e4") == sub0, "in place")
    page.keyboard.press("Escape")
    _click(page, 600, 280)
    check(_ids(page) == ["e2"], f"a click on the title selects just the title: {_ids(page)}")
    page.keyboard.press("Control+z")
    check(groups() == 1 and _ids(page) == [group], f"Ctrl+Z after Ctrl+Shift+G: one group again: {_ids(page)}")
    page.keyboard.press("Control+y")
    check(groups() == 0, "Ctrl+Y: separate again")

    # Group them (click, Shift+click, Ctrl+G), save, reopen: still one group, in place.
    page.keyboard.press("Escape")
    group_it()
    check(groups() == 1, "grouped")
    saved = editor.save_as_download("gap-p7b-grouped.html")
    editor.open(saved)
    check(groups() == 1, f"after reopening: one group: {groups()}")
    regrouped = page.evaluate("App.deck.getDocument().querySelector('[data-type=\"group\"]').getAttribute('data-id')")
    check(sorted(page.evaluate(PARTS, regrouped)) == ["e2", "e4"], "of the title and the subtitle")
    check(_on_slide(page, "e2") == title0 and _on_slide(page, "e4") == sub0, f"in place: {_on_slide(page, 'e2')} {_on_slide(page, 'e4')}")
    _click(page, 600, 410)
    check(_ids(page) == [regrouped] and box() == [64, 230, 1100, 218], f"a click selects the group, one box round both: {box()}")
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


# ----------------------------------------------------------------------
# 6. Slide master
# ----------------------------------------------------------------------

MASTER_SHOWN = """id => {   // the master on slide `id` as drawn in the editor: role -> [text, x, y, w, h, backgroundImage]
    const slide = App.deck.getDocument().querySelector('[data-slide-id="' + id + '"]');
    const layer = slide && slide.querySelector(':scope > .master-layer');
    if (!layer) { return null; }
    const s = slide.getBoundingClientRect(); const out = {};
    layer.querySelectorAll('[data-master]').forEach((item) => { const r = item.getBoundingClientRect(); const c = getComputedStyle(item);
        out[item.getAttribute('data-master')] = { text: item.textContent, x: r.left - s.left, y: r.top - s.top, w: r.width, h: r.height,
            image: c.backgroundImage.slice(0, 15), visible: c.visibility === 'visible' && c.display !== 'none' && c.opacity !== '0' }; });
    return out; }"""

THUMB_MASTER = """i => { const f = document.querySelector('#thumbnail-rail .thumb[data-index="' + i + '"] iframe');
    const d = f && f.contentDocument; if (!d) { return 'no frame'; }
    const items = d.querySelectorAll('.master-layer [data-master]');
    const out = {}; items.forEach((it) => { const r = it.getBoundingClientRect();
        out[it.getAttribute('data-master')] = r.width > 0 && r.height > 0 ? it.textContent : 'not drawn'; });
    return out; }"""


def _master_ok(m, number):
    """The four parts drawn on a slide: logo top right (a picture), footer, label, the number."""
    return (m is not None and set(m) == {"logo", "footer", "label", "number"}
            and all(p["visible"] and p["w"] > 0 and p["h"] > 0 for p in m.values())
            and m["footer"]["text"] == "Projeto Atlas" and m["label"]["text"] == "Confidencial" and m["number"]["text"] == number
            and m["logo"]["image"].startswith('url("data:image') and m["logo"]["x"] > 640 and m["logo"]["y"] < 120)


def test_gap_p7b_slide_master(browser):
    """Slide master: View > Slide Master: choose a logo picture (corner Top right), footer "Projeto Atlas", tick
    Label (Confidencial), Slide numbers 3 / 15, Apply: every slide but the first shows them (thumbnails too). Click
    the footer on a slide: nothing is selected. Add a slide after slide 2 (Ctrl+M): the numbers move up; Ctrl+Z.
    Ctrl+Z: all gone; Ctrl+Y: back. Save, open the saved file in Edge and present: the footer and numbers are
    there; Ctrl+P: on every printed page."""
    editor = Editor(browser)
    editor.open(e2e.CONTRACT)
    page = editor.page
    shown = lambda sid: page.evaluate(MASTER_SHOWN, sid)  # noqa: E731
    order = lambda: page.evaluate("App.deck.getSlides().map((s) => s.getAttribute('data-slide-id'))")  # noqa: E731
    logo = e2e.picture_file(page, "gap-p7b-master-logo.png", "logo", 300, 100)

    # View > Slide Master: logo (Top right), footer, Label (Confidencial), numbers 3 / 15, Apply.
    page.click(".ribbon-tab[data-tab='view']")
    page.click("button[data-command='slideMaster']")
    check(page.is_visible("dialog[open] #master-footer"), "the Slide Master window")
    with page.expect_file_chooser() as chooser:
        page.click("dialog[open] button:has-text('Choose picture')")
    chooser.value.set_files(str(logo))
    wait_until(page, "document.querySelector('#master-logo-preview') && !document.querySelector('#master-logo-preview').hidden")
    page.select_option("#master-logo-corner", label="Top right")
    page.fill("#master-footer", "Projeto Atlas")
    page.check("#master-label-on")
    check(page.input_value("#master-label") == "Confidencial", f"the label: {page.input_value('#master-label')}")
    page.select_option("#master-numbers", label="3 / 15")
    check(page.input_value("#master-numbers") == "n/total", "3 / 15 picked")
    editor.click_dialog_button("Apply")

    # Every slide but the first shows them, drawn on the slide; the thumbnails too.
    ids = order()
    check(len(ids) == 6, ids)
    for index, sid in enumerate(ids):
        _go_to_slide(page, index)
        m = shown(sid)
        if index == 0:
            check(m is None, f"not on the first slide: {m}")
        else:
            check(_master_ok(m, f"{index + 1} / 6"), f"slide {index + 1} shows logo, footer, label and number: {m}")
    for index in range(6):
        expected = {} if index == 0 else {"logo": "", "footer": "Projeto Atlas", "label": "Confidencial", "number": f"{index + 1} / 6"}
        wait_until(page, f"(() => {{ const f = document.querySelector('#thumbnail-rail .thumb[data-index=\"{index}\"] iframe');"
                         f" return f && f.contentDocument && f.contentDocument.querySelectorAll('.master-layer [data-master]').length === {len(expected)}; }})()")
        thumb = page.evaluate(THUMB_MASTER, index)
        check(thumb == expected, f"thumbnail {index + 1}: {thumb}")

    # Click the footer on a slide (slide 2): nothing is selected.
    _go_to_slide(page, 1)
    m = shown("s2")
    footer_at = [m["footer"]["x"] + m["footer"]["w"] / 2, m["footer"]["y"] + m["footer"]["h"] / 2]
    _click(page, 600, 78)
    check(_ids(page) == ["e5"], f"the title selected first: {_ids(page)}")
    _click(page, *footer_at)
    check(_ids(page) == [] and page.locator("#overlay .selection-box:visible").count() == 0,
          f"a click on the footer ({footer_at}) selects nothing: {_ids(page)}")
    page.screenshot(path=str(e2e.OUTPUT / "gap-p7b-master-slide2.png"))

    # Add a slide after slide 2 (Ctrl+M): the numbers after it move up; Ctrl+Z: back.
    page.keyboard.press("Control+m")
    new_id = page.evaluate("App.deck.getCurrentSlide().getAttribute('data-slide-id')")
    check(order() == ["s1", "s2", new_id, "s3", "s4", "s5", "s6"], f"after slide 2: {order()}")
    numbers = [(shown(sid) or {}).get("number", {}).get("text") for sid in order()]
    check(numbers == [None, "2 / 7", "3 / 7", "4 / 7", "5 / 7", "6 / 7", "7 / 7"], f"the numbers move up: {numbers}")
    page.keyboard.press("Control+z")
    numbers = [(shown(sid) or {}).get("number", {}).get("text") for sid in order()]
    check(order() == ids and numbers == [None, "2 / 6", "3 / 6", "4 / 6", "5 / 6", "6 / 6"], f"Ctrl+Z: back: {numbers}")

    # Ctrl+Z: all gone; Ctrl+Y: back.
    page.keyboard.press("Control+z")
    check(page.evaluate("App.deck.getDocument().querySelectorAll('.master, .master-layer').length") == 0
          and all(shown(sid) is None for sid in ids), "Ctrl+Z: the master gone from every slide")
    page.keyboard.press("Control+y")
    for index, sid in enumerate(ids):
        _go_to_slide(page, index)
        check(shown(sid) is None if index == 0 else _master_ok(shown(sid), f"{index + 1} / 6"),
              f"Ctrl+Y: back on every slide but the first: slide {index + 1}: {shown(sid)}")

    # Save, open the saved file and present: on each slide shown, the footer and the number (and logo, label).
    saved = editor.save_as_download("gap-p7b-master.html")
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()
    player, errors = e2e.play_saved_deck(browser, saved)
    seen = []
    for step in range(6):
        if step:
            player.keyboard.press("ArrowRight")
        current = player.evaluate("""() => { const s = document.querySelector('.slide.deck-player-current');
            const out = { id: s.getAttribute('data-slide-id') }; const sr = s.getBoundingClientRect();
            s.querySelectorAll('.master-layer [data-master]').forEach((it) => { const r = it.getBoundingClientRect();
                out[it.getAttribute('data-master')] = r.width > 0 && r.height > 0 && r.left >= sr.left - 1 && r.right <= sr.right + 1
                    && r.top >= sr.top - 1 && r.bottom <= sr.bottom + 1 ? it.textContent : 'not shown'; });
            return out; }""")
        if not seen or seen[-1]["id"] != current["id"]:
            seen.append(current)
    check([s["id"] for s in seen] == ["s1", "s2", "s3", "s4", "s6"], f"presented (the hidden s5 skipped): {seen}")
    check(set(seen[0]) == {"id"}, f"the title slide without: {seen[0]}")
    for s, number in zip(seen[1:], ["2 / 6", "3 / 6", "4 / 6", "6 / 6"]):
        check(s.get("footer") == "Projeto Atlas" and s.get("number") == number and s.get("label") == "Confidencial"
              and s.get("logo") == "", f"presented {s['id']}: the footer and number there: {s}")
    player.screenshot(path=str(e2e.OUTPUT / "gap-p7b-master-presented.png"))

    # Ctrl+P (PROXY: print media emulated on the saved file): on every printed page, one slide per page.
    player.emulate_media(media="print")
    printed = player.evaluate("""() => Array.from(document.querySelectorAll('section.slide'))
        .filter((s) => getComputedStyle(s).display !== 'none').map((s) => { const sr = s.getBoundingClientRect();
            const out = { id: s.getAttribute('data-slide-id'), breakAfter: getComputedStyle(s).breakAfter };
            s.querySelectorAll('.master-layer [data-master]').forEach((it) => { const r = it.getBoundingClientRect(); const c = getComputedStyle(it);
                out[it.getAttribute('data-master')] = r.width > 0 && r.height > 0 && c.visibility === 'visible'
                    && r.left >= sr.left - 1 && r.right <= sr.right + 1 && r.top >= sr.top - 1 && r.bottom <= sr.bottom + 1
                    ? it.textContent : 'not shown'; });
            return out; })""")
    check([p["id"] for p in printed] == ["s1", "s2", "s3", "s4", "s6"], f"printed pages (hidden s5 left out): {printed}")
    check(all(p["breakAfter"] == "page" for p in printed), f"one slide per page: {[p['breakAfter'] for p in printed]}")
    check(set(printed[0]) == {"id", "breakAfter"}, f"page 1 (title slide) without, as set: {printed[0]}")
    for p, number in zip(printed[1:], ["2 / 6", "3 / 6", "4 / 6", "6 / 6"]):
        check(p.get("footer") == "Projeto Atlas" and p.get("number") == number and p.get("label") == "Confidencial"
              and p.get("logo") == "", f"printed {p['id']}: the footer and number on the page: {p}")
    check(errors == [], f"no errors in the saved deck: {errors}")
    player.context.close()


# ----------------------------------------------------------------------
# 7. Slide master on a deck with its own footers (Copilot)
# ----------------------------------------------------------------------

OWN_STATE = """() => Array.from(App.deck.getDocument().querySelectorAll('section.slide')).map((s, i) => {
    const els = Array.from(s.querySelectorAll(':scope > .el[data-type="text"]'));
    const layer = s.querySelector(':scope > .master-layer');
    const masterOf = (role) => layer ? Array.from(layer.querySelectorAll('[data-master="' + role + '"]'), (e) => e.textContent) : [];
    return { own: s.querySelectorAll('[data-id^="own-"]').length,
             ownFooters: els.filter((e) => e.textContent.trim() === 'Atlas · material confidencial').length,
             ownNumbers: els.filter((e) => e.textContent.trim() === String(i + 1)).length,
             masterFooters: masterOf('footer'), masterNumbers: masterOf('number') }; })"""


def test_gap_p7b_master_own_footers(browser):
    """Slide master on a Copilot deck with its own footer and page numbers on each slide: View > Slide Master, a
    footer and slide numbers, Apply: a second window lists them ("Slide numbers on slides 2–15", the footer's text
    and its slides); Remove them: only the master's show, once; Ctrl+Z: the old boxes back, no master. Try again
    with Keep them: both show.
    PROXY: no real Copilot deck (private); no deck in samples/ has its own footer and numbers on each slide, so this
    is the contract deck with a footer and page number typed as text boxes on every slide (6 slides: "2–6")."""
    editor = Editor(browser)
    editor.open(e2e.own_footers_deck("gap-p7b-own-footers.html"))
    editor.close_dialog_if_open()
    page = editor.page
    state = lambda: page.evaluate(OWN_STATE)  # noqa: E731
    masters = lambda: page.evaluate("App.deck.getDocument().querySelectorAll('.master, .master-layer').length")  # noqa: E731
    original = state()
    check(all(s["own"] == 2 and s["ownFooters"] == 1 and s["ownNumbers"] == 1 for s in original) and masters() == 0,
          f"the deck's own footer and number on each slide: {original}")
    own_rects = page.evaluate("Array.from(App.deck.getDocument().querySelectorAll('[data-id^=\"own-\"]'), (e) => e.getAttribute('data-id') + JSON.stringify(App.transform.readRect(e)))")

    def apply_master():
        page.click("button[data-command='slideMaster']")
        check(page.is_visible("dialog[open] #master-footer"), "the Slide Master window")
        page.fill("#master-footer", "Projeto Atlas")
        page.select_option("#master-numbers", label="3")
        page.click("dialog[open] button:has-text('Apply')")
        wait_until(page, "document.querySelector('dialog[open] .master-own')")
        check(page.locator("dialog[open]").count() == 1 and page.locator("dialog[open] #master-footer").count() == 0,
              "a second window (the Slide Master one closed)")
        return page.inner_text("dialog[open] .master-own")

    # View > Slide Master, footer and numbers, Apply: a second window lists them.
    page.click(".ribbon-tab[data-tab='view']")
    listed = apply_master()
    check("Slide numbers on slides 2–6" in listed and "“Atlas · material confidencial” on slides 2–6" in listed,
          f"it lists the numbers and the footer's text and slides: {listed}")
    page.screenshot(path=str(e2e.OUTPUT / "gap-p7b-own-footers-question.png"))

    # Remove them: only the master's show, once, on slides 2-6 (the title slide keeps its own, the master skips it).
    editor.click_dialog_button("Remove them")
    after = state()
    for i, s in enumerate(after[1:], start=2):
        check(s["own"] == 0 and s["ownFooters"] == 0 and s["ownNumbers"] == 0
              and s["masterFooters"] == ["Projeto Atlas"] and s["masterNumbers"] == [str(i)],
              f"slide {i}: only the master's footer and number, once: {s}")
    check(after[0]["own"] == 2 and after[0]["masterFooters"] == [], f"the title slide as before: {after[0]}")
    _go_to_slide(page, 1)
    drawn = page.evaluate(MASTER_SHOWN, "s2")
    check(drawn["footer"]["visible"] and drawn["footer"]["w"] > 0 and drawn["number"]["text"] == "2", f"drawn on slide 2: {drawn}")
    page.screenshot(path=str(e2e.OUTPUT / "gap-p7b-own-footers-removed.png"))

    # Ctrl+Z: the old boxes back (in place), no master.
    page.keyboard.press("Control+z")
    check(state() == original and masters() == 0, f"Ctrl+Z: the old boxes back, no master: {state()}")
    check(page.evaluate("Array.from(App.deck.getDocument().querySelectorAll('[data-id^=\"own-\"]'), (e) => e.getAttribute('data-id') + JSON.stringify(App.transform.readRect(e)))") == own_rects,
          "where they were")

    # Try again with Keep them: both show.
    listed = apply_master()
    check("Slide numbers on slides 2–6" in listed, f"asked again: {listed}")
    editor.click_dialog_button("Keep them")
    kept = state()
    for i, s in enumerate(kept[1:], start=2):
        check(s["own"] == 2 and s["ownFooters"] == 1 and s["ownNumbers"] == 1
              and s["masterFooters"] == ["Projeto Atlas"] and s["masterNumbers"] == [str(i)],
              f"slide {i}: both the deck's own and the master's: {s}")
    _go_to_slide(page, 2)
    drawn = page.evaluate(MASTER_SHOWN, "s3")
    own_drawn = page.evaluate("""() => Array.from(App.deck.getCurrentSlide().querySelectorAll('[data-id^="own-"]'), (e) => {
        const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility === 'visible'; })""")
    check(drawn["footer"]["visible"] and drawn["footer"]["w"] > 0 and drawn["number"]["w"] > 0 and own_drawn == [True, True],
          f"both drawn on slide 3: {drawn} {own_drawn}")
    page.screenshot(path=str(e2e.OUTPUT / "gap-p7b-own-footers-kept.png"))
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


TESTS = [test_gap_p7b_new_slide, test_gap_p7b_multi_select, test_gap_p7b_align, test_gap_p7b_smart_guides,
         test_gap_p7b_group, test_gap_p7b_slide_master, test_gap_p7b_master_own_footers]
