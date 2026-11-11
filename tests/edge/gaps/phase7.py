"""
Phase 7 hand checks replayed literally in Edge: real clicks, drags and keys, one assertion per step.
Each test follows its FEATURES.md hand check from start to end (quoted in the docstring).
"""

import e2e_test as e2e
from e2e_test import Editor, check, drag, element_rect, slide_to_screen

LOGO = {"left": 64, "top": 56, "width": 120, "height": 40}   # contract deck, slide 1, e1 (centre 124,76)


def _centre(page, selector):
    box = page.locator(selector).bounding_box()
    return [box["x"] + box["width"] / 2, box["y"] + box["height"] / 2]


def _handle(name):
    return f"#overlay .selection-handle[data-handle='{name}']"


def _shown(page, data_id):
    """Where an element shows on its slide (turned or not): its on-screen box in slide pixels."""
    return page.evaluate("""id => {
        const r = App.deck.getDocument().querySelector('[data-id="' + id + '"]').getBoundingClientRect();
        return { width: r.width, height: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; }""", data_id)


def _go_to_slide(page, index):
    page.click(f".thumb[data-index='{index}']")
    e2e.wait_until(page, f"App.deck.getCurrentIndex() === {index}")


def test_gap_rotate(browser):
    """Rotate: click the logo, drag the round handle above it to the right with Shift held: it turns a quarter
    (Format pane Rotation: 90); type 45 in Rotation, Enter: it leans; Arrange > Rotate Right 90°. Drag its
    handles: it grows along its own sides. Ctrl+Z after each. A table shows no round handle. Save, reopen:
    still turned."""
    editor = Editor(browser)
    editor.open(e2e.CONTRACT)
    page = editor.page
    angle = lambda: page.evaluate("App.transform.rotationOf(App.deck.getDocument().querySelector('[data-id=\"e1\"]'))")  # noqa: E731
    rect = lambda: element_rect(page, "e1")  # noqa: E731

    # Round handle + Shift: a quarter turn, the pane says 90. Ctrl+Z: upright; Ctrl+Y: turned again.
    page.mouse.click(*slide_to_screen(page, 124, 76))
    check(page.is_visible(_handle("rotate")), "a round handle above the logo")
    page.keyboard.down("Shift")
    drag(page, _centre(page, _handle("rotate")), slide_to_screen(page, 324, 80), steps=10)
    page.keyboard.up("Shift")
    check(angle() == 90, f"a quarter turn: {angle()}")
    check(page.input_value("#format-rotation") == "90", "the Format pane's Rotation says 90")
    page.keyboard.press("Control+z")
    check(angle() == 0 and rect() == LOGO, f"Ctrl+Z after the handle: upright again: {angle()} {rect()}")
    page.keyboard.press("Control+y")
    check(angle() == 90, f"Ctrl+Y: turned again: {angle()}")

    # Rotation 45 + Enter: it leans (same size). Ctrl+Z: 90; Ctrl+Y: 45.
    page.fill("#format-rotation", "45")
    page.press("#format-rotation", "Enter")
    check(angle() == 45 and rect() == LOGO, f"typed 45: it leans: {angle()} {rect()}")
    shown = _shown(page, "e1")   # where it shows: a 120 x 40 box turned 45 degrees is about 113 x 113, same centre
    check(abs(shown["width"] - 113.1) <= 1.5 and abs(shown["height"] - 113.1) <= 1.5
          and abs(shown["cx"] - 124) <= 1 and abs(shown["cy"] - 76) <= 1, f"it shows leaning: {shown}")
    page.keyboard.press("Escape")
    page.mouse.click(*slide_to_screen(page, 124, 76))
    page.keyboard.press("Control+z")
    check(angle() == 90, f"Ctrl+Z after typing 45: {angle()}")
    page.keyboard.press("Control+y")
    check(angle() == 45, f"Ctrl+Y: {angle()}")

    # Arrange > Rotate Right 90°: 135. Ctrl+Z: 45; Ctrl+Y: 135.
    page.click(".ribbon-tab[data-tab='arrange']")
    page.mouse.click(*slide_to_screen(page, 124, 76))
    page.click("button[data-command='rotateRight90']")
    check(angle() == 135, f"Rotate Right 90: {angle()}")
    page.keyboard.press("Control+z")
    check(angle() == 45, f"Ctrl+Z after Rotate Right: {angle()}")
    page.keyboard.press("Control+y")
    check(angle() == 135, f"Ctrl+Y: {angle()}")
    page.screenshot(path=str(e2e.OUTPUT / "gap-rotate-135.png"))

    # Drag its handles: it grows along its own sides, the opposite side stays put. Ctrl+Z after each.
    zoom = page.evaluate("App.canvas.getZoom()")
    for handle, opposite, grows, other in [("e", "w", "width", "height"), ("s", "n", "height", "width")]:
        page.mouse.click(*slide_to_screen(page, 124, 76))
        start, anchor = _centre(page, _handle(handle)), _centre(page, _handle(opposite))
        out = [start[0] - anchor[0], start[1] - anchor[1]]          # from the opposite handle outwards
        length = (out[0] ** 2 + out[1] ** 2) ** 0.5
        end = [start[0] + out[0] / length * 30 * zoom, start[1] + out[1] / length * 30 * zoom]
        page.keyboard.down("Alt")   # no snapping, so the size is exactly what was dragged
        drag(page, start, end, steps=10)
        page.keyboard.up("Alt")
        after = rect()
        check(abs(after[grows] - (LOGO[grows] + 30)) <= 1.5 and after[other] == LOGO[other] and angle() == 135,
              f"handle {handle}: {grows} grew along its own side: {after} {angle()}")
        moved = _centre(page, _handle(opposite))
        check(abs(moved[0] - anchor[0]) <= 2 and abs(moved[1] - anchor[1]) <= 2,
              f"handle {handle}: the opposite side stayed: {anchor} -> {moved}")
        page.keyboard.press("Control+z")
        check(rect() == LOGO and angle() == 135, f"Ctrl+Z after the {handle} handle: {rect()}")

    # A table shows no round handle (typing in a cell, nor with the whole table selected).
    _go_to_slide(page, 2)
    page.mouse.click(*slide_to_screen(page, 200, 196))
    for _ in range(2):
        if page.evaluate("App.selection.selectedIds()") != ["e9"] or page.evaluate("App.text.isEditing()"):
            page.keyboard.press("Escape")
    check(page.evaluate("App.selection.selectedIds()") == ["e9"], f"the table selected: {page.evaluate('App.selection.selectedIds()')}")
    check(page.is_visible("#overlay .selection-box") and page.is_visible(_handle("se")),
          "the table's selection box and its handles show")
    check(page.is_hidden(_handle("rotate")), "but no round handle on the table")

    # Save, reopen: still turned.
    _go_to_slide(page, 0)
    saved = editor.save_as_download("gap-rotated.html")
    editor.open(saved)
    check(angle() == 135 and rect() == LOGO, f"still turned after reopening: {angle()} {rect()}")
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


def test_gap_lock(browser):
    """Lock: click the logo, Arrange > Lock: a grey box with a padlock, no handles. Drag it, press the arrow
    keys, Delete: it stays. Ctrl+A and drag the title: the title moves, the logo stays (Ctrl+Z). Right-click
    the logo: Lock is ticked; click it: unlocked, it moves again. Save, reopen: still locked."""
    editor = Editor(browser)
    editor.open(e2e.CONTRACT)
    page = editor.page
    rect = lambda name: element_rect(page, name)  # noqa: E731
    locked = lambda: page.evaluate("App.deck.getDocument().querySelector('[data-id=\"e1\"]').getAttribute('data-locked') === 'true'")  # noqa: E731
    exists = lambda: page.evaluate("!!App.deck.getDocument().querySelector('[data-id=\"e1\"]')")  # noqa: E731
    title_top = rect("e2")["top"]

    # Arrange > Lock: a grey box with a padlock, no handles.
    page.click(".ribbon-tab[data-tab='arrange']")
    page.mouse.click(*slide_to_screen(page, 124, 76))
    page.click("button[data-command='lock']")
    check(locked(), "locked")
    look = page.evaluate("""() => {
        const box = document.querySelector('#overlay .selection-box.locked');
        if (!box) { return null; }
        const after = getComputedStyle(box, '::after');
        return { outline: getComputedStyle(box).outlineColor, padlock: after.backgroundImage, content: after.content,
                 padlockWidth: parseFloat(after.width), handles: box.querySelectorAll('.selection-handle').length,
                 visibleHandles: [...box.querySelectorAll('.selection-handle')].filter(h => h.offsetParent !== null).length };
    }""")
    check(look is not None and page.is_visible("#overlay .selection-box.locked"), "a locked selection box, on screen")
    rgb = [int(v) for v in look["outline"][look["outline"].index("(") + 1:look["outline"].index(")")].split(",")[:3]]
    check(max(rgb) - min(rgb) <= 10 and 60 <= rgb[0] <= 180, f"the box is grey: {look['outline']}")
    check("svg" in look["padlock"] and look["padlockWidth"] > 0 and look["content"] not in ("none", "normal"), f"a padlock in its corner: {look['padlock'][:60]}")
    check(look["visibleHandles"] == 0, f"no handles: {look}")
    page.screenshot(path=str(e2e.OUTPUT / "gap-locked.png"))

    # Drag it, the arrow keys, Delete: it stays.
    drag(page, slide_to_screen(page, 124, 76), slide_to_screen(page, 424, 176), steps=8)
    check(rect("e1") == LOGO, f"a drag does not move it: {rect('e1')}")
    selected = lambda: page.evaluate("App.selection.selectedIds()") == ["e1"]  # noqa: E731
    check(selected(), "still selected after the drag, so the keys go to it")
    for key in ["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown", "Shift+ArrowRight"]:
        page.keyboard.press(key)
        check(rect("e1") == LOGO and selected(), f"{key} does not move it: {rect('e1')}")
    page.keyboard.press("Delete")
    check(exists() and rect("e1") == LOGO and selected(), "Delete leaves it")

    # Ctrl+A and drag the title: the title moves, the logo stays; Ctrl+Z: the title back.
    page.keyboard.press("Control+a")
    drag(page, slide_to_screen(page, 600, 290), slide_to_screen(page, 600, 340), steps=8)
    check(rect("e2")["top"] == title_top + 50 and rect("e1") == LOGO, f"title moved, logo stayed: {rect('e2')} {rect('e1')}")
    page.keyboard.press("Control+z")
    check(rect("e2")["top"] == title_top and rect("e1") == LOGO, f"Ctrl+Z: the title back: {rect('e2')}")

    # Right-click the logo: Lock is ticked; click it: unlocked, it moves again (drag and arrow key).
    page.click("#overlay", position={"x": 5, "y": 5})
    page.mouse.click(*slide_to_screen(page, 124, 76), button="right")
    check(page.get_attribute(".context-menu [data-command='lock']", "aria-checked") == "true", "Lock ticked in the menu")
    page.click(".context-menu [data-command='lock']")
    check(not locked(), "unlocked")
    page.keyboard.press("ArrowRight")
    check(rect("e1")["left"] == LOGO["left"] + 1, f"an arrow key moves it again: {rect('e1')}")
    page.keyboard.press("Control+z")
    drag(page, slide_to_screen(page, 124, 76), slide_to_screen(page, 224, 76), steps=8)
    check(rect("e1")["left"] != LOGO["left"], f"a drag moves it again: {rect('e1')}")
    page.keyboard.press("Control+z")
    check(rect("e1") == LOGO, f"Ctrl+Z: back: {rect('e1')}")

    # Lock it again (Arrange > Lock), save, reopen: still locked, still the grey box.
    page.mouse.click(*slide_to_screen(page, 124, 76))
    page.click(".ribbon-tab[data-tab='arrange']")
    page.click("button[data-command='lock']")
    check(locked(), "locked again")
    saved = editor.save_as_download("gap-locked.html")
    editor.open(saved)
    check(locked(), "still locked after reopening")
    page.mouse.click(*slide_to_screen(page, 124, 76))
    check(page.is_visible("#overlay .selection-box.locked"), "the grey box when clicked after reopening")
    drag(page, slide_to_screen(page, 124, 76), slide_to_screen(page, 424, 176), steps=8)
    check(rect("e1") == LOGO, "still does not move after reopening")
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


TESTS = [test_gap_rotate, test_gap_lock]
