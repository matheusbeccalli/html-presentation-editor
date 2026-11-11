"""
Phase 3 hand checks replayed literally in Edge: real clicks, drags and keys, one assertion per step.
Each test follows its FEATURES.md hand check from start to end (quoted in the docstring).
"""

import base64

import e2e_test as e2e
from e2e_test import Editor, check, drag, editing_id, element_rect, slide_to_screen, wait_until, word_on_screen

STYLES_OF = """id => Array.from(App.deck.getDocument().querySelector('[data-id="' + id + '"]').children).map(p => p.style.cssText)"""


def _go_to_slide(page, index):
    page.click(f".thumb[data-index='{index}']")
    wait_until(page, f"App.deck.getCurrentIndex() === {index}")


def _centre(page, selector):
    box = page.locator(selector).bounding_box()
    return [box["x"] + box["width"] / 2, box["y"] + box["height"] / 2]


def _main_colour(page, rect):
    """The commonest colour (r, g, b) in that part of the window (screen px), from a real screenshot."""
    clip = {"x": rect["left"], "y": rect["top"], "width": max(1, rect["right"] - rect["left"]),
            "height": max(1, rect["bottom"] - rect["top"])}
    png = base64.b64encode(page.screenshot(clip=clip)).decode()
    return page.evaluate("""(png) => new Promise((resolve) => {
        const image = new Image();
        image.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = image.width; canvas.height = image.height;
            const context = canvas.getContext('2d');
            context.drawImage(image, 0, 0);
            const data = context.getImageData(0, 0, image.width, image.height).data;
            const counts = {};
            for (let i = 0; i < data.length; i += 4) { const k = data[i] + ',' + data[i + 1] + ',' + data[i + 2]; counts[k] = (counts[k] || 0) + 1; }
            resolve(Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0].split(',').map(Number));
        };
        image.src = 'data:image/png;base64,' + png;
    })""", png)


def _hue(rgb):
    r, g, b = rgb
    high, low = max(rgb), min(rgb)
    if high == low:
        return None
    if high == r:
        return (60 * (g - b) / (high - low)) % 360
    if high == g:
        return 60 * (b - r) / (high - low) + 120
    return 60 * (r - g) / (high - low) + 240


# ----------------------------------------------------------------------
# Home > Paragraph
# ----------------------------------------------------------------------

def test_gap_p3_paragraph(browser):
    """Home > Paragraph, alignment and spacing: in a text, Ctrl+E centres the line (the Center button lights up);
    select two lines, Align right; Line spacing list: 1.5 spreads them out and shows as ticked when reopened;
    type 12 in Space before + Enter: space above both lines, and the cursor is back in the text; Esc, then
    Ctrl+L aligns the whole box left; Ctrl+Z undoes each step. With nothing selected, Ctrl+R still reloads the
    page (it asks first if there are unsaved changes)."""
    editor = Editor(browser)
    editor.open(e2e.CONTRACT)
    page = editor.page
    styles = lambda: page.evaluate(STYLES_OF, "e7")  # noqa: E731
    tops = lambda: page.evaluate(  # noqa: E731
        "() => Array.from(App.deck.getDocument().querySelector('[data-id=\"e7\"]').children).map(p => p.getBoundingClientRect().top)")
    pressed = lambda command: page.get_attribute(f'#ribbon-panel [data-command="{command}"]', "aria-pressed")  # noqa: E731
    editing = lambda: page.evaluate("App.text.isEditing() && App.text.editingElement().getAttribute('data-id')")  # noqa: E731
    _go_to_slide(page, 1)
    start = styles()

    def undo_redo(before, after, step):
        page.keyboard.press("Control+z")
        check(styles() == before, f"Ctrl+Z after {step}: {styles()}")
        page.keyboard.press("Control+y")
        check(styles() == after, f"Ctrl+Y after {step}: {styles()}")

    # In a text (double-click into the last line), Ctrl+E centres that line; the Center button lights up.
    page.mouse.dblclick(*word_on_screen(page, "e7", 3, "Sudeste"))
    check(editing() == "e7", f"typing in the bullets box: {editing()}")
    page.keyboard.press("End")
    page.keyboard.press("Control+e")
    centred = styles()
    check("text-align: center" in centred[3] and all("text-align" not in s for s in centred[:3]),
          f"Ctrl+E centres the line (only that one): {centred}")
    wait_until(page, "() => document.querySelector('#ribbon-panel [data-command=\"alignCenter\"]').ariaPressed === 'true'",
               timeout=3000)
    look = page.evaluate("""() => ['alignCenter', 'alignLeft'].map(c => getComputedStyle(
        document.querySelector('#ribbon-panel [data-command="' + c + '"]')).backgroundColor)""")
    check(pressed("alignCenter") == "true" and pressed("alignLeft") != "true" and look[0] != look[1],
          f"the Center button lights up (its background differs from Align left's): {look}")
    undo_redo(start, centred, "Ctrl+E")
    check(editing() == "e7", "still typing in the box after Ctrl+Z / Ctrl+Y")

    # Select two lines, Align right.
    page.keyboard.press("End")
    page.keyboard.press("Shift+ArrowUp")
    picked = page.evaluate("""() => { const doc = App.deck.getDocument(); const s = doc.getSelection();
        const lines = Array.from(doc.querySelector('[data-id="e7"]').children);
        const line = (node) => lines.findIndex(p => p.contains(node));
        return [line(s.anchorNode), line(s.focusNode)].sort(); }""")
    check(picked == [2, 3], f"the last two lines selected: {picked}")
    page.click('#ribbon-panel [data-command="alignRight"]')
    right = styles()
    check(all("text-align: right" in s for s in right[2:]) and all("text-align" not in s for s in right[:2]),
          f"Align right on the two selected lines: {right}")
    check(pressed("alignRight") == "true", "the Align right button lights up")
    check(editing() == "e7", "still typing")
    undo_redo(centred, right, "Align right")

    # Line spacing list: 1.5 spreads them out.
    before_tops = tops()
    page.click("#ribbon-panel .line-spacing-button")
    page.locator(".line-spacing-menu .menu-item", has_text="1.5").click()
    spaced = styles()
    check(all("line-height: 1.8" in s for s in spaced[2:]) and all("line-height: 1.45" in s for s in spaced[:2]),
          f"line spacing 1.5 on the two lines: {spaced}")
    after_tops = tops()
    check(after_tops[3] - after_tops[2] > before_tops[3] - before_tops[2] + 2,
          f"the two lines spread out on screen: {before_tops} -> {after_tops}")
    undo_redo(right, spaced, "line spacing")
    page.click("#ribbon-panel .line-spacing-button")
    checked = page.locator('.line-spacing-menu [aria-checked="true"]')
    check(checked.count() == 1 and checked.inner_text().strip() == "1.5", "reopened, the list shows 1.5 ticked")

    # Type 12 in Space before + Enter: space above both lines, the cursor back in the text.
    before_tops = tops()
    page.click(".line-spacing-menu .space-before-input")
    page.keyboard.press("Control+a")
    page.keyboard.type("12")
    page.keyboard.press("Enter")
    spaced_before = styles()
    check(all("margin-top: 12pt" in s for s in spaced_before[2:]) and all("margin-top" not in s for s in spaced_before[:2]),
          f"space before 12 pt on both lines: {spaced_before}")
    after_tops = tops()
    check(after_tops[2] - before_tops[2] >= 15 and after_tops[3] - before_tops[3] >= 31,
          f"space shows above both lines (16 px each): {before_tops} -> {after_tops}")
    back = page.evaluate("""() => { const doc = App.deck.getDocument(); const s = doc.getSelection();
        const box = doc.querySelector('[data-id="e7"]');
        return { frame: document.activeElement.id, focus: doc.hasFocus(), editing: App.text.isEditing(),
                 inBox: s.rangeCount > 0 && box.contains(s.anchorNode) && box.contains(s.focusNode),
                 menu: !!document.querySelector('.line-spacing-menu') }; }""")
    check(back["frame"] == "deck-frame" and back["focus"] and back["editing"] and back["inBox"],
          f"the cursor is back in the text: {back}")
    undo_redo(spaced, spaced_before, "space before")

    # Esc, then Ctrl+L aligns the whole box left.
    page.keyboard.press("Escape")
    check(not page.evaluate("App.text.isEditing()") and page.evaluate("App.selection.selectedIds()") == ["e7"],
          "Esc: the box selected, not typing")
    page.keyboard.press("Control+l")
    left = styles()
    check(all("text-align: left" in s for s in left), f"Ctrl+L aligns every line left: {left}")
    undo_redo(spaced_before, left, "Ctrl+L")

    # Ctrl+Z undoes each step, one by one, back to the start.
    for state, step in [(spaced_before, "Ctrl+L"), (spaced, "space before"), (right, "line spacing"),
                        (centred, "Align right"), (start, "Ctrl+E")]:
        page.keyboard.press("Control+z")
        check(styles() == state, f"Ctrl+Z undoes {step}: {styles()}")
    page.screenshot(path=str(e2e.OUTPUT / "gap-p3-paragraph.png"))

    # With nothing selected, Ctrl+R still reloads the page; with unsaved changes it asks first.
    # Synthesised keys never reach Edge's own Ctrl+R (reload) here, so this is checked in two halves:
    # the real Ctrl+R key is left to the browser (not prevented by the editor), and a browser-side reload
    # (CDP Page.reload, what Edge does with that key) asks first when there are unsaved changes.  [PROXY]
    keys_seen = """() => { if (!window.__gapKeys) { window.__gapKeys = [];
        const note = (event) => { if (event.ctrlKey && event.key.toLowerCase() === 'r') window.__gapKeys.push(event.defaultPrevented); };
        window.addEventListener('keydown', note);
        App.deck.getDocument().defaultView.addEventListener('keydown', note); }
        return window.__gapKeys; }"""
    check(page.evaluate(keys_seen) == [], "listening for Ctrl+R")
    page.mouse.click(*slide_to_screen(page, 300, 300))   # the bullets box selected: Ctrl+R is Align right
    page.keyboard.press("Control+r")
    check(page.evaluate(keys_seen) == [True] and all("text-align: right" in s for s in styles()),
          f"with a box selected the editor takes Ctrl+R (aligns right): {page.evaluate(keys_seen)} {styles()}")
    page.keyboard.press("Control+z")
    check(styles() == start, f"Ctrl+Z after that Ctrl+R: {styles()}")
    page.keyboard.press("Control+y")   # an unsaved change again (Ctrl+R's align right)
    check(page.evaluate("App.history.isDirty()"), "unsaved changes")
    changed = styles()
    page.mouse.click(*slide_to_screen(page, 640, 690))   # empty slide space
    check(page.evaluate("App.selection.selectedIds()") == [] and not page.evaluate("App.text.isEditing()"),
          "nothing selected")
    page.keyboard.press("Control+r")
    check(page.evaluate(keys_seen) == [True, False], f"nothing selected: Ctrl+R is left to Edge (reload): {page.evaluate(keys_seen)}")
    check(styles() == changed, "and the editor did nothing with it")

    dialogs = []
    answer = {"accept": False}

    def on_dialog(dialog):
        dialogs.append(dialog.type)
        dialog.accept() if answer["accept"] else dialog.dismiss()

    page.on("dialog", on_dialog)
    cdp = page.context.new_cdp_session(page)
    page.evaluate("window.__gapMarker = 1")
    cdp.send("Page.reload")
    page.wait_for_timeout(1000)
    check(dialogs == ["beforeunload"], f"a reload with unsaved changes asks first: {dialogs}")
    check(page.evaluate("window.__gapMarker === 1 && App.state.hasDeck && App.history.isDirty()") and styles() == changed,
          "answered Stay: no reload, the deck and its change are still there")
    answer["accept"] = True
    with page.expect_navigation():
        cdp.send("Page.reload")
    wait_until(page, "window.App && App.state && document.getElementById('welcome').hidden === false")
    check(dialogs == ["beforeunload", "beforeunload"], f"asked again: {dialogs}")
    check(page.evaluate("window.__gapMarker === undefined && !App.state.hasDeck"), "answered Leave: the page reloaded")

    # No unsaved changes: the reload does not ask.
    editor.open(e2e.CONTRACT)
    check(not page.evaluate("App.history.isDirty()"), "a freshly opened deck: nothing unsaved")
    page.mouse.click(*slide_to_screen(page, 640, 690))
    check(page.evaluate("App.selection.selectedIds()") == [], "nothing selected")
    page.evaluate("window.__gapMarker = 2")
    cdp = page.context.new_cdp_session(page)
    with page.expect_navigation():
        cdp.send("Page.reload")
    wait_until(page, "window.App && App.state && document.getElementById('welcome').hidden === false")
    check(dialogs == ["beforeunload", "beforeunload"] and page.evaluate("window.__gapMarker === undefined"),
          f"nothing unsaved: reloaded without asking: {dialogs}")
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()



# ----------------------------------------------------------------------
# Format painter
# ----------------------------------------------------------------------

WORD_LOOK = """([id, line, word]) => {
    const p = App.deck.getDocument().querySelector('[data-id="' + id + '"]').children[line];
    const walker = p.ownerDocument.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.data.indexOf(word) !== -1) {
            return { weight: parseInt(getComputedStyle(node.parentElement).fontWeight, 10), text: node.data };
        }
    }
    return null;
}"""

LOOK_OF = """id => Array.from(App.deck.getDocument().querySelectorAll('[data-id="' + id + '"] p')).map(p => {
    const c = getComputedStyle(p); return [c.fontWeight, c.fontSize, c.color, c.fontFamily]; })"""   # every line


def test_gap_p3_format_painter(browser):
    """Format painter: click a slide title, Home > Format painter, click a bulleted box: its text now looks like
    the title (one Ctrl+Z undoes it). In a text, bold a word, click inside it, Format painter, click inside
    another word: that word is bold. Double-click Format painter, click three words, Esc: the painter stops,
    typing goes on."""
    editor = Editor(browser)
    editor.open(e2e.CONTRACT)
    page = editor.page
    _go_to_slide(page, 1)
    painter = page.locator('#ribbon-panel [data-command="formatPainter"]')
    on = lambda: painter.get_attribute("aria-pressed") == "true"  # noqa: E731
    bold = lambda word: page.evaluate(WORD_LOOK, ["e7", 3, word])["weight"] >= 600  # noqa: E731
    title, start = page.evaluate(LOOK_OF, "e5"), page.evaluate(LOOK_OF, "e7")
    check(title != start, f"the title and the bullets look different to start with: {title} {start}")

    # Click the title, Home > Format painter, click the bulleted box: it looks like the title.
    page.mouse.click(*slide_to_screen(page, 300, 78))
    check(page.evaluate("App.selection.selectedIds()") == ["e5"], "the title selected")
    page.click(".ribbon-tab[data-tab='home']")
    painter.click()
    check(on(), "the painter is on")
    page.mouse.click(*slide_to_screen(page, 300, 300))
    painted = page.evaluate(LOOK_OF, "e7")
    check(len(title) == 1 and len(painted) == 4 and all(line == title[0] for line in painted),
          f"every line of the bullets now looks like the title: {painted} vs {title}")
    check(not on(), "one use: the painter is off again")
    page.keyboard.press("Control+z")
    check(page.evaluate(LOOK_OF, "e7") == start, f"one Ctrl+Z undoes it: {page.evaluate(LOOK_OF, 'e7')}")

    # In a text, bold a word (double-click it, Ctrl+B), click inside it, Format painter, click inside another word.
    page.mouse.dblclick(*word_on_screen(page, "e7", 3, "compras"))
    check(page.evaluate("App.text.isEditing()"), "typing in the bullets box")
    page.mouse.dblclick(*word_on_screen(page, "e7", 3, "compras"))
    selected = page.evaluate("App.deck.getDocument().getSelection().toString()")
    check(selected.strip() == "compras", f"the word selected: {selected!r}")
    page.keyboard.press("Control+b")
    check(bold("compras") and not bold("Plano"), "the word is bold")
    page.mouse.click(*word_on_screen(page, "e7", 3, "compras"))
    caret = page.evaluate("""() => { const s = App.deck.getDocument().getSelection();
        return { collapsed: s.isCollapsed, text: s.anchorNode && s.anchorNode.data,
                 weight: parseInt(getComputedStyle(s.anchorNode.parentElement).fontWeight, 10) }; }""")
    check(caret["collapsed"] and caret["text"] == "compras" and caret["weight"] >= 600, f"the cursor inside the bold word: {caret}")
    painter.click()
    check(on(), "the painter is on")
    page.mouse.click(*word_on_screen(page, "e7", 3, "Plano"))
    check(bold("Plano") and page.evaluate(WORD_LOOK, ["e7", 3, "Plano"])["text"] == "Plano", "that word is bold (only it)")
    check(not on() and page.evaluate("App.text.isEditing()"), "the painter off again, still typing")

    # Double-click Format painter, click three words: each turns bold, the painter stays on.
    painter.dblclick()
    check(on(), "double-click: the painter on")
    for word in ["valor", "Sudeste", "ganhos"]:
        check(not bold(word), f"{word} not bold yet")
        page.mouse.click(*word_on_screen(page, "e7", 3, word))
        check(bold(word) and on(), f"{word} painted bold, the painter still on")
    page.screenshot(path=str(e2e.OUTPUT / "gap-p3-painter-three-words.png"))

    # Esc: the painter stops (a click in a word no longer paints), typing goes on.
    page.keyboard.press("Escape")
    check(not on() and page.evaluate("App.text.isEditing()"), "Esc stops the painter, still typing")
    page.mouse.click(*word_on_screen(page, "e7", 3, "expansão"))
    check(not bold("expansão"), "a click in a word after Esc paints nothing")
    page.keyboard.type("XYZ")
    line = page.evaluate("App.deck.getDocument().querySelector('[data-id=e7]').children[3].textContent")
    check("XYZ" in line and page.evaluate("App.text.isEditing()"), f"typing goes on: {line!r}")
    check(not on(), "the painter stays off")
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()



# ----------------------------------------------------------------------
# Find & replace
# ----------------------------------------------------------------------

FIND_STATE = e2e.FIND_STATE
COUNT_IN_DECK = e2e.COUNT_IN_DECK

HIGHLIGHTS = """() => {
    const doc = App.deck.getDocument();
    const view = doc.defaultView;
    const frame = document.getElementById('deck-frame').getBoundingClientRect();
    const zoom = frame.width / document.getElementById('deck-frame').offsetWidth;
    const ranges = (name) => (view.CSS.highlights.get(name) ? Array.from(view.CSS.highlights.get(name)) : []);
    const onScreen = (range) => { const r = range.getBoundingClientRect();
        return r.width > 0 ? { left: frame.left + r.left * zoom, right: frame.left + r.right * zoom,
                               top: frame.top + r.top * zoom, bottom: frame.top + r.bottom * zoom } : null; };
    const anyBox = doc.querySelector('.el[data-type="text"]');
    const colour = (name) => getComputedStyle(anyBox, '::highlight(' + name + ')').backgroundColor;
    const selection = doc.getSelection();
    const selected = selection.rangeCount ? selection.getRangeAt(0) : null;
    const same = (a, b) => !!a && !!b && a.startContainer === b.startContainer && a.startOffset === b.startOffset &&
        a.endContainer === b.endContainer && a.endOffset === b.endOffset;
    const all = ranges('editor-find');
    const current = ranges('editor-find-current');
    return { all: all.map(r => r.toString()), current: current.map(r => r.toString()),
             currentIsSelection: current.length === 1 && same(current[0], selected),
             yellowOnScreen: all.map(onScreen).filter(Boolean), orangeOnScreen: current.map(onScreen).filter(Boolean),
             yellow: colour('editor-find'), orange: colour('editor-find-current') };
}"""


def test_gap_p3_find_replace(browser):
    """Find & replace: Ctrl+F, type "margem": every "margem" in the deck turns yellow and the panel counts them;
    Enter goes to the first one (slide 2, selected, orange, "1 of N"), Enter again to the next, Shift+Enter
    back; type "oculto": Enter reaches the hidden slide 5. Ctrl+H, find "Alfa", replace with "Beta": Replace
    changes one and jumps to the next (Home > Undo undoes it; Ctrl+Z inside the panel's boxes undoes your typing
    there); Replace All changes every slide ("Replaced N"), one Undo brings them all back; Esc closes the panel
    and the yellow goes away; Ctrl+H never opens Edge's History."""
    editor = Editor(browser)
    editor.open(e2e.CONTRACT)
    page = editor.page
    state = lambda: page.evaluate(FIND_STATE)  # noqa: E731
    marks = lambda: page.evaluate(HIGHLIGHTS)  # noqa: E731
    box = lambda data_id: page.evaluate(f"App.deck.getDocument().querySelector('[data-id=\"{data_id}\"]').textContent")  # noqa: E731
    per_slide = lambda word: page.evaluate("""word => App.deck.getSlides().map(slide => Array.from(
        slide.querySelectorAll('.el[data-type="text"], .el[data-type="table"]'))
        .reduce((sum, el) => sum + (el.textContent.match(new RegExp(word, 'gi')) || []).length, 0))""", word)  # noqa: E731
    url = page.url
    # Every Ctrl+H keydown, in the editor and in the deck, and whether the editor stopped the browser's own action.
    keys_seen = """() => { if (!window.__gapKeys) { window.__gapKeys = [];
        const note = (event) => { if (event.ctrlKey && event.key.toLowerCase() === 'h') window.__gapKeys.push(event.defaultPrevented); };
        window.addEventListener('keydown', note);
        App.deck.getDocument().defaultView.addEventListener('keydown', note); }
        return window.__gapKeys; }"""
    check(page.evaluate(keys_seen) == [], "listening for Ctrl+H")

    def no_history(times):
        """Ctrl+H never opens Edge's History [PROXY: the editor stops the browser's action on every Ctrl+H;
        no other tab or window opened, the page did not navigate]."""
        seen = page.evaluate(keys_seen)
        check(seen == [True] * times, f"every Ctrl+H stopped from reaching Edge: {seen}")
        check(len(page.context.pages) == 1 and page.url == url, f"no History tab: {[p.url for p in page.context.pages]}")

    def move_panel_away():
        """Drag the panel by its title to the bottom left of the slide, off the matches."""
        drag(page, _centre(page, "#find-panel .find-title"), slide_to_screen(page, 120, 640), steps=6)

    # Ctrl+H with nothing selected and while typing in a text box: the Replace panel, not Edge's History.
    page.keyboard.press("Control+h")
    no_history(1)
    check(state()["open"] and page.is_visible("#find-replacement"), "Ctrl+H (nothing selected) opens Replace")
    page.keyboard.press("Escape")
    check(not state()["open"], "Esc closes it")
    page.mouse.dblclick(*word_on_screen(page, "e2", 0, "Atlas"))
    check(editing_id(page) == "e2", f"typing in the title: {editing_id(page)}")
    page.keyboard.press("Control+h")
    no_history(2)
    check(state()["open"] and page.is_visible("#find-replacement"), "Ctrl+H while typing opens Replace")
    page.keyboard.press("Escape")
    check(not state()["open"], "Esc closes it")
    page.keyboard.press("Escape")
    page.mouse.click(*slide_to_screen(page, 640, 650))   # empty slide space: nothing selected

    # Ctrl+F, type "margem": every "margem" in the deck turns yellow, the panel counts them.
    page.keyboard.press("Control+f")
    found = state()
    check(found["open"] and found["focus"] == "find-text" and not page.is_visible("#find-replacement"),
          f"Ctrl+F opens Find with the cursor in it: {found}")
    page.keyboard.press("Control+a")
    page.keyboard.type("margem")
    total = page.evaluate(COUNT_IN_DECK, "margem")
    check(total >= 3, f"the sample deck has 'margem' on several slides: {total}")
    wait_until(page, f"() => {{ const m = ({HIGHLIGHTS})(); return m.all.length === {total} && "
                     "m.all.every(t => t.toLowerCase() === 'margem'); }")
    m = marks()
    check(m["yellow"] == "rgb(255, 225, 77)" and m["current"] == [], f"every match painted yellow: {m['yellow']} {m['all']}")
    check(state()["status"] == f"{total} matches", f"the panel counts them: {state()['status']}")

    # Enter: the first one (slide 2), selected, orange, "1 of N".
    page.keyboard.press("Enter")
    found, m = state(), marks()
    check(found["slide"] == 1 and found["editing"] == "e7" and found["selected"] == "margem",
          f"Enter goes to the first match, on slide 2, selected in its box: {found}")
    check(found["status"] == f"1 of {total}" and found["focus"] == "find-text", f"'1 of N', the panel keeps the keyboard: {found}")
    check(m["current"] == ["margem"] and m["currentIsSelection"] and len(m["all"]) == total - 1 and m["orange"] == "rgb(255, 150, 50)",
          f"the selected match is the orange one: {m}")
    check(len(m["orangeOnScreen"]) == 1, f"the orange match is on screen: {m['orangeOnScreen']}")
    shown = _main_colour(page, m["orangeOnScreen"][0])
    hue = _hue(shown)
    check(hue is not None and 15 <= hue <= 40 and shown[0] - shown[2] >= 60, f"it shows orange on screen: {shown} hue {hue}")
    page.screenshot(path=str(e2e.OUTPUT / "gap-p3-find-orange.png"))

    # Enter again: the next; Shift+Enter: back.
    page.keyboard.press("Enter")
    found = state()
    check(found["status"] == f"2 of {total}" and found["slide"] >= 1 and found["selected"].lower() == "margem",
          f"Enter again: the next match: {found}")
    page.keyboard.press("Shift+Enter")
    found = state()
    check(found["status"] == f"1 of {total}" and found["slide"] == 1 and found["editing"] == "e7", f"Shift+Enter goes back: {found}")

    # A yellow match on screen shows yellow (Enter on to a slide with two matches, the panel dragged off them).
    for _ in range(total):
        page.keyboard.press("Enter")
        if marks()["yellowOnScreen"]:
            break
    move_panel_away()
    m = marks()
    check(m["yellowOnScreen"], f"a yellow match on this slide: {m}")
    shown = _main_colour(page, m["yellowOnScreen"][0])
    hue = _hue(shown)
    check(hue is not None and 45 <= hue <= 60 and min(shown) < 150 and shown[0] > 230, f"it shows yellow on screen: {shown} hue {hue}")
    yellow_at = (state()["slide"], m["yellowOnScreen"][0])
    page.screenshot(path=str(e2e.OUTPUT / "gap-p3-find-yellow.png"))

    # Type "oculto": Enter reaches the hidden slide 5.
    page.click("#find-text")
    page.keyboard.press("Control+a")
    page.keyboard.type("oculto")
    page.keyboard.press("Enter")
    found = state()
    hidden = page.evaluate("App.deck.getSlides()[4].getAttribute('data-hidden')")
    check(found["slide"] == 4 and hidden == "true" and found["editing"] == "e15" and found["selected"] == "oculto",
          f"Enter reaches the hidden slide 5: {found} hidden={hidden}")

    # Ctrl+H (in the panel): Replace; find "Alfa", replace with "Beta".
    page.keyboard.press("Control+h")
    no_history(3)
    check(page.is_visible("#find-replacement") and state()["focus"] == "find-text", f"Ctrl+H shows Replace: {state()}")
    page.keyboard.press("Control+a")
    page.keyboard.type("Alfa")
    page.click("#find-replacement")
    page.keyboard.type("Beta")
    check(page.input_value("#find-text") == "Alfa" and page.input_value("#find-replacement") == "Beta", "typed Alfa / Beta")
    alfas, alfas_per_slide = page.evaluate(COUNT_IN_DECK, "alfa"), per_slide("alfa")
    check(alfas >= 2 and sum(1 for n in alfas_per_slide if n) >= 2, f"'Alfa' on several slides: {alfas_per_slide}")
    # Replace: the first click finds the first Alfa (as in PowerPoint), the next changes it and jumps on.
    page.click("#find-replace")
    found = state()
    check(found["slide"] == 0 and found["editing"] == "e4" and found["selected"] == "Alfa" and
          page.evaluate(COUNT_IN_DECK, "alfa") == alfas, f"Replace, first click: the first Alfa selected, nothing changed yet: {found}")
    page.click("#find-replace")
    found = state()
    check("Beta Alimentos" in box("e4") and page.evaluate(COUNT_IN_DECK, "alfa") == alfas - 1,
          f"Replace changed one: {box('e4')!r}")
    check(found["selected"] == "Alfa" and found["editing"] == "e7" and found["slide"] == 1, f"and jumped to the next: {found}")

    # Ctrl+Z inside the panel's boxes undoes the typing there (and not the Replace in the deck).
    for field, typed, kept in [("#find-replacement", "Gama", "Beta"), ("#find-text", "Delta", "Alfa")]:
        page.click(field)
        page.keyboard.press("End")
        page.keyboard.type(typed)
        check(page.input_value(field) == kept + typed, f"typed in {field}: {page.input_value(field)!r}")
        values = []
        for _ in range(len(typed)):   # Edge may undo the typing in one step or letter by letter
            page.keyboard.press("Control+z")
            values.append(page.input_value(field))
            if len(values[-1]) <= len(kept):
                break
        check(all((kept + typed).startswith(v) for v in values) and
              all(len(a) > len(b) for a, b in zip([kept + typed] + values, values)) and len(values[-1]) <= len(kept),
              f"Ctrl+Z in {field} undid the typing there: {values}")
        check("Beta Alimentos" in box("e4") and page.evaluate(COUNT_IN_DECK, "alfa") == alfas - 1,
              f"and left the deck alone: {box('e4')!r}")
        if values[-1] != kept:
            page.keyboard.press("Control+a")
            page.keyboard.type(kept)
        check(page.input_value(field) == kept, f"{field} says {kept} again")

    # Home > Undo undoes the Replace.
    page.click('#ribbon-panel [data-command="undo"]')
    check("Alfa Alimentos" in box("e4") and page.evaluate(COUNT_IN_DECK, "alfa") == alfas, f"Home > Undo: {box('e4')!r}")

    # Replace All: every slide ("Replaced N"); one Undo brings them all back.
    betas = per_slide("beta")
    page.click("#find-replace-all")
    after_alfa, after_beta = per_slide("alfa"), per_slide("beta")
    check(state()["status"] == f"Replaced {alfas}", f"the panel says: {state()['status']!r}")
    check(after_alfa == [0] * len(after_alfa) and all(after_beta[i] == betas[i] + alfas_per_slide[i] for i in range(len(betas))),
          f"Replace All changed every slide: alfa {after_alfa}, beta {betas} -> {after_beta}")
    page.click('#ribbon-panel [data-command="undo"]')
    check(per_slide("alfa") == alfas_per_slide and per_slide("beta") == betas, f"one Undo brings them all back: {per_slide('alfa')}")

    # Esc closes the panel and the yellow goes away.
    page.click("#find-text")
    page.keyboard.press("Control+a")
    page.keyboard.type("margem")
    _go_to_slide(page, yellow_at[0])
    page.click("#find-text")
    wait_until(page, f"() => ({HIGHLIGHTS})().yellowOnScreen.length > 0")
    m = marks()
    check(yellow_at[1] in m["yellowOnScreen"], f"the same yellow match on screen: {m['yellowOnScreen']} {yellow_at}")
    before = _main_colour(page, yellow_at[1])
    check(45 <= (_hue(before) or 0) <= 60, f"yellow before Esc: {before}")
    page.keyboard.press("Escape")
    found, m = state(), marks()
    check(not found["open"] and not page.is_visible("#find-panel"), f"Esc closes the panel: {found}")
    check(found["highlighted"] == 0 and m["all"] == [] and m["current"] == [], f"no highlights left: {m}")
    after = _main_colour(page, yellow_at[1])
    check(min(after) >= 240, f"the yellow went away (white behind the word): {before} -> {after}")
    page.screenshot(path=str(e2e.OUTPUT / "gap-p3-find-closed.png"))
    no_history(3)
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


# ----------------------------------------------------------------------
# Autofit
# ----------------------------------------------------------------------

BOX_E7 = """() => { const doc = window.App && App.deck ? App.deck.getDocument() : document;   // the editor's deck, or the player
    const el = doc.querySelector('[data-id="e7"]');
    const scale = el.ownerDocument.querySelector('section.slide[data-slide-id="s2"]').getBoundingClientRect().width / 1280;
    const box = el.getBoundingClientRect();
    const lines = Array.from(el.children).map(p => { const r = p.getBoundingClientRect();
        return { top: (r.top - box.top) / scale, height: r.height / scale, bottom: (r.bottom - box.top) / scale }; });
    const first = el.ownerDocument.createRange();
    first.selectNodeContents(el.children[0].firstChild);
    return { mode: el.getAttribute('data-autofit'), scale: el.style.getPropertyValue('--autofit-scale'),
             zoom: getComputedStyle(el.children[0]).zoom, height: box.height / scale, lines: lines,
             wordHeight: first.getClientRects()[0].height / scale, slideScale: scale,
             fits: el.scrollHeight <= el.clientHeight + 1, spills: lines[lines.length - 1].bottom > box.height / scale + 1 }; }"""


def test_gap_p3_autofit(browser):
    """Autofit: select a bulleted box, Format pane > Text box: "Do not autofit"; type many lines until they spill
    out of the box; choose "Shrink text on overflow": the text gets smaller to fit (the pane says "Text shrunk to
    N%"); drag the box taller: the text grows back; choose "Resize shape to fit text": the box grows instead;
    save, open the saved file on its own: the shrunk text looks the same."""
    editor = Editor(browser)
    editor.open(e2e.CONTRACT)
    page = editor.page
    box = lambda: page.evaluate(BOX_E7)  # noqa: E731
    radio = lambda mode: page.locator(f'#format-autofit input[value="{mode}"]')  # noqa: E731
    hint = lambda: page.inner_text("#format-autofit-hint")  # noqa: E731
    _go_to_slide(page, 1)

    # Select the bulleted box: Format pane > Text box says "Do not autofit".
    page.mouse.click(*slide_to_screen(page, 300, 300))
    check(page.evaluate("App.selection.selectedIds()") == ["e7"], "the bulleted box selected")
    check(page.is_visible("#format-autofit") and radio("off").is_checked() and not radio("shrink").is_checked(),
          "Format pane > Text box: Do not autofit")
    start = box()
    check(start["fits"] and not start["spills"], f"its text fits to start with: {start}")

    # Type many lines until they spill out of the box.
    page.mouse.dblclick(*word_on_screen(page, "e7", 3, "compras"))
    check(editing_id(page) == "e7", "typing in the box")
    page.keyboard.press("Control+End")
    for i in range(14):
        page.keyboard.press("Enter")
        page.keyboard.type(f"Mais uma linha {i}")
    page.keyboard.press("Escape")
    full = box()
    check(len(full["lines"]) == 18 and full["spills"] and not full["fits"] and full["mode"] is None,
          f"the lines spill out of the box (autofit off): {full['height']} {full['lines'][-1]}")
    check(page.evaluate("App.selection.selectedIds()") == ["e7"] and radio("off").is_checked(), "still selected, still off")
    page.screenshot(path=str(e2e.OUTPUT / "gap-p3-autofit-spills.png"))

    # Shrink text on overflow: the text gets smaller to fit, the pane says how much.
    radio("shrink").click()
    shrunk = box()
    scale = float(shrunk["scale"] or 1)
    check(shrunk["mode"] == "shrink" and 0 < scale < 1 and shrunk["fits"] and not shrunk["spills"],
          f"shrunk to fit: {shrunk['scale']} fits={shrunk['fits']}")
    check(shrunk["wordHeight"] < full["wordHeight"] - 1 and shrunk["height"] == full["height"],
          f"the text got smaller, the box did not change: {full['wordHeight']} -> {shrunk['wordHeight']}")
    check(hint() == f"Text shrunk to {round(scale * 100)}%", f"the pane says: {hint()!r}")
    page.screenshot(path=str(e2e.OUTPUT / "gap-p3-autofit-shrunk.png"))

    # Drag the box taller (its bottom handle, with the mouse): the text grows back.
    zoom = page.evaluate("App.canvas.getZoom()")
    start_handle = _centre(page, "#overlay .selection-handle[data-handle='s']")
    page.keyboard.down("Alt")   # no snapping: exactly what was dragged
    drag(page, start_handle, [start_handle[0], start_handle[1] + 60 * zoom], steps=10)
    page.keyboard.up("Alt")
    taller = box()
    taller_scale = float(taller["scale"] or 1)
    check(abs(element_rect(page, "e7")["height"] - 540) <= 1.5, f"the box is 60 px taller: {element_rect(page, 'e7')}")
    check(taller_scale > scale and taller["wordHeight"] > shrunk["wordHeight"] + 0.5 and taller["fits"],
          f"the text grew back: {scale} -> {taller['scale']}, {shrunk['wordHeight']} -> {taller['wordHeight']}")
    check(hint() == (f"Text shrunk to {round(taller_scale * 100)}%" if taller_scale < 1 else ""), f"the pane follows: {hint()!r}")

    # Resize shape to fit text: the box grows instead.
    radio("resize").click()
    resized = box()
    check(resized["mode"] == "resize" and resized["scale"] == "" and resized["fits"] and resized["height"] > 540 + 20,
          f"the box grows instead: {resized['height']} {resized['scale']!r}")
    check(abs(resized["wordHeight"] - full["wordHeight"]) <= 0.5, f"the text at its full size: {resized['wordHeight']}")
    check(hint() == "", "no shrink note")

    # Back to the shrunk text (Ctrl+Z), save, open the saved file on its own: the shrunk text looks the same.
    page.keyboard.press("Control+z")
    again = box()
    check(again["mode"] == "shrink" and again["scale"] == taller["scale"] and radio("shrink").is_checked(),
          f"Ctrl+Z: shrunk again: {again['mode']} {again['scale']}")
    check(0 < float(again["scale"]) < 1, f"the text is shrunk when saved: {again['scale']}")
    saved = editor.save_as_download("gap-p3-autofit.html")
    player, errors = e2e.play_saved_deck(browser, saved)
    player.keyboard.press("ArrowRight")
    check(e2e.visible_slide_ids(player) == ["s2"], f"the saved deck on its own, slide 2: {e2e.visible_slide_ids(player)}")
    shown = player.evaluate(BOX_E7)
    check(shown["mode"] == "shrink" and shown["scale"] == again["scale"] and float(shown["zoom"]) == float(again["scale"]),
          f"saved with its scale, and drawn at it: {shown['scale']} zoom {shown['zoom']}")
    check(shown["wordHeight"] > 0 and abs(shown["wordHeight"] - again["wordHeight"]) <= 0.5,
          f"the same text size as in the editor (slide px): {again['wordHeight']} vs {shown['wordHeight']}")
    check(len(shown["lines"]) == len(again["lines"]) and all(
          abs(a["top"] - b["top"]) <= 1 and abs(a["height"] - b["height"]) <= 1 for a, b in zip(again["lines"], shown["lines"])),
          "every line in the same place, the same height as in the editor")
    check(shown["fits"] and not shown["spills"], "and it still fits its box")
    player.screenshot(path=str(e2e.OUTPUT / "gap-p3-autofit-player.png"))
    check(errors == [], f"the saved deck has no errors: {errors}")
    player.context.close()
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


TESTS = [test_gap_p3_paragraph, test_gap_p3_format_painter, test_gap_p3_find_replace, test_gap_p3_autofit]
