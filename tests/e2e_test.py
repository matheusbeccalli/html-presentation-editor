"""
e2e_test.py - end-to-end tests of dist/editor.html in a real (headless) Chromium.

Optional, at home only (SPEC 8.3): needs Playwright for Python
(pip install playwright && playwright install chromium).

What it checks, mirroring the Phase 1 "done when" test:
  - every sample deck opens from file:// and shows all its slides
  - saving produces a file that presents on its own (player, keys, hidden slides skipped)
  - re-opening and re-saving a saved deck gives the identical file ("saves back unchanged")
  - a contract deck keeps every element exactly (ids, positions, content)
  - undo/redo, the unsaved-changes dot and the close-tab warning work
  - keyboard shortcuts work even when the focus is inside the slide iframe
  - drag and drop opens a deck
  - no network request is ever made (every http(s) request is recorded and aborted)

Screenshots and saved decks go to tests/output/ (ignored by Git) for manual review.

Usage:  python build.py && python tests/e2e_test.py
"""

import json
import re
import shutil
import sys
import time
import traceback
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
EDITOR = ROOT / "dist" / "editor.html"
SAMPLES = ROOT / "samples"
OUTPUT = ROOT / "tests" / "output"

CONTRACT = SAMPLES / "contract-deck.html"
CONTRACT_FORMAT1 = SAMPLES / "contract-deck-format1.html"   # the same deck before the text model
MESSY = SAMPLES / "copilot-messy-deck.html"
APPENDIX_A = SAMPLES / "copilot-appendix-a-deck.html"
WIDE = SAMPLES / "deck-1920x1080.html"
HEAVY = SAMPLES / "heavy-deck.html"

PLAYWRIGHT = None   # set in main(); one test also launches Firefox through it


def firefox_installed():
    try:
        return Path(PLAYWRIGHT.firefox.executable_path).exists()
    except Exception:  # noqa: BLE001 - any failure means "not available"
        return False


# ----------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------

def wait_until(page, expression, arg=None, timeout=30000):
    """
    Poll a JavaScript expression until it is truthy.
    Playwright's wait_for_function polls with eval(), which the editor's CSP
    rightly forbids, so we poll from Python with evaluate() instead.
    """
    deadline = time.time() + timeout / 1000
    while True:
        value = page.evaluate(expression, arg) if arg is not None else page.evaluate(expression)
        if value:
            return value
        if time.time() > deadline:
            raise AssertionError(f"timed out waiting for: {expression}")
        time.sleep(0.05)


class Editor:
    """One browser tab with the editor open, plus everything it logged."""

    def __init__(self, browser, context=None):
        # context: pass a persistent context to keep the browser's storage between launches.
        self.context = context or browser.new_context(viewport={"width": 1440, "height": 900}, accept_downloads=True)
        self.remote_requests = []
        # Any http(s) request is recorded and aborted. The CSP should stop them
        # before they get here, so this list must stay empty.
        self.context.route(re.compile(r"^https?://"), self._block)
        self.page = self.context.new_page()
        self.errors = []
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))
        self.page.on("console", lambda msg: msg.type == "error" and not _is_expected_console_error(msg.text)
                     and self.errors.append(msg.text))
        self.page.goto(EDITOR.as_uri())
        wait_until(self.page, "window.App && App.state && document.getElementById('welcome').hidden === false")

    def _block(self, route):
        self.remote_requests.append(route.request.url)
        route.abort()

    def open(self, path, timeout=60000):
        """Open a deck through the fallback <input type=file> and wait until it is shown."""
        self.page.evaluate("document.getElementById('status-message').textContent = ''")
        self.page.set_input_files("#file-input", str(path))
        wait_until(self.page, 
            "name => document.getElementById('status-message').textContent === 'Opened ' + name",
            arg=path.name, timeout=timeout)

    def report_dialog_text(self):
        dialog = self.page.query_selector("dialog[open]")
        return dialog.inner_text() if dialog else None

    def click_dialog_button(self, label):
        self.page.click(f"dialog[open] button:has-text('{label}')")
        wait_until(self.page, "!document.querySelector('dialog[open]')")

    def close_dialog_if_open(self):
        if self.page.query_selector("dialog[open]"):
            self.click_dialog_button("OK")

    def save_as_download(self, file_name):
        """Save As with the File System Access API switched off, so it falls back to a download."""
        self.page.evaluate("window.showSaveFilePicker = undefined")
        with self.page.expect_download() as download_info:
            self.page.keyboard.press("Control+Shift+S")
        target = OUTPUT / file_name
        download_info.value.save_as(target)
        return target

    def slide_count(self):
        return self.page.evaluate("App.deck.getSlides().length")

    def title(self):
        return self.page.title()

    def close(self):
        self.context.close()


def _is_expected_console_error(text):
    # The deck's own blocked requests are reported by Chromium as CSP console errors.
    # "Blocked script execution" is NOT expected: the editor never puts a script or an
    # inline handler into a sandboxed frame, so that message would be a real bug
    # (in Edge it can come from a browser extension, which tests do not have).
    return "Content Security Policy" in text


def check(condition, message):
    if not condition:
        raise AssertionError(message)


def play_saved_deck(browser, path):
    """Open a saved deck on its own (no editor) and return a page for it."""
    context = browser.new_context(viewport={"width": 1280, "height": 720})
    context.route(re.compile(r"^https?://"), lambda route: route.abort())
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(path.as_uri())
    page.wait_for_selector(".deck-player-counter")
    return page, errors


def visible_slide_ids(page):
    return page.evaluate("""() => Array.from(document.querySelectorAll('section.slide'))
        .filter(s => getComputedStyle(s).display !== 'none').map(s => s.getAttribute('data-slide-id'))""")


def slide_to_screen(page, x, y):
    """Screen position of slide pixel (x, y), whatever the zoom."""
    return page.evaluate("""([x, y]) => {
        const r = document.getElementById('overlay').getBoundingClientRect();
        const zoom = App.canvas.getZoom();
        return [r.left + x * zoom, r.top + y * zoom];
    }""", [x, y])


def element_rect(page, data_id):
    return page.evaluate("""id => App.transform.readRect(
        App.deck.getDocument().querySelector('[data-id="' + id + '"]'))""", data_id)


def drag(page, start, end, steps=8):
    page.mouse.move(*start)
    page.mouse.down()
    page.mouse.move(*end, steps=steps)
    page.mouse.up()


# ----------------------------------------------------------------------
# Tests
# ----------------------------------------------------------------------

def test_editor_starts_offline_with_csp(browser):
    editor = Editor(browser)
    csp = editor.page.evaluate("document.querySelector('meta[http-equiv=\"Content-Security-Policy\"]').content")
    check("default-src 'none'" in csp and "connect-src 'none'" in csp, "CSP meta tag present")
    check(editor.title() == "Deck Editor", "initial title, got " + editor.title())
    editor.page.screenshot(path=str(OUTPUT / "01-welcome.png"))
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


def test_browser_banner_only_outside_chromium(browser):
    editor = Editor(browser)
    check(editor.page.is_hidden("#browser-banner"), "no banner in Chromium")
    editor.close()
    if not firefox_installed():
        print("    (Firefox part skipped: run `playwright install firefox` to include it)")
        return
    firefox = PLAYWRIGHT.firefox.launch()
    try:
        editor = Editor(firefox)
        check(editor.page.is_visible("#browser-banner"), "Firefox shows the banner")
        check("Edge" in editor.page.inner_text("#browser-banner"), "banner names Edge")
        editor.page.click("#welcome-new")
        wait_until(editor.page, "App.state.hasDeck")
        check(editor.page.is_hidden("#save-banner"), "no save-first banner where AutoSave cannot exist")
        editor.page.screenshot(path=str(OUTPUT / "01b-firefox-banner.png"))
        editor.page.click("#browser-banner-close")
        check(editor.page.is_hidden("#browser-banner"), "the banner can be closed")
        editor.close()
    finally:
        firefox.close()


def test_new_blank_deck(browser):
    editor = Editor(browser)
    editor.page.click("#welcome-new")
    wait_until(editor.page, "App.state.hasDeck")
    check(editor.slide_count() == 2, "template has 2 slides")
    check(editor.title() == "Untitled deck.html — Deck Editor", "title, got " + editor.title())
    wait_until(editor.page, "document.querySelectorAll('.thumb[data-drawn]').length === 2")
    check(editor.page.is_visible("#save-banner"), "a new deck shows the save-first banner")
    check("not saved yet" in editor.page.inner_text("#save-banner"), "new-deck wording")
    editor.page.screenshot(path=str(OUTPUT / "02-new-deck.png"))
    editor.page.click("#save-banner-close")
    check(editor.page.is_hidden("#save-banner"), "the banner can be closed")
    editor.page.click(".ribbon-file-button")
    editor.page.click(".file-menu button[data-command='newDeck']")
    wait_until(editor.page, "!document.getElementById('save-banner').hidden")
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


def test_contract_deck_round_trip_is_exact(browser):
    editor = Editor(browser)
    editor.open(CONTRACT)
    check(editor.report_dialog_text() is None, "no import report for a clean contract deck")
    check(editor.slide_count() == 6, "6 slides")
    check(not editor.title().startswith("●"), "contract deck is not dirty after opening")
    wait_until(editor.page, "document.querySelector('.thumb[data-index=\"0\"][data-drawn]')")
    editor.page.screenshot(path=str(OUTPUT / "03-contract-deck.png"))

    saved = editor.save_as_download("contract-saved.html")
    original_text = CONTRACT.read_text(encoding="utf-8")
    saved_text = saved.read_text(encoding="utf-8")
    differences = editor.page.evaluate("""([a, b]) => {
        const parse = (t) => new DOMParser().parseFromString(t, 'text/html');
        const A = parse(a), B = parse(b);
        const problems = [];
        const els = (d) => Array.from(d.querySelectorAll('.el'));
        if (els(A).length !== els(B).length) problems.push('element count differs');
        els(A).forEach((el) => {
            const other = B.querySelector('[data-id="' + el.getAttribute('data-id') + '"]');
            if (!other) { problems.push('missing ' + el.getAttribute('data-id')); return; }
            if (other.getAttribute('style') !== el.getAttribute('style')) problems.push('style of ' + el.getAttribute('data-id'));
            if (other.innerHTML !== el.innerHTML) problems.push('content of ' + el.getAttribute('data-id'));
        });
        const slideAttrs = (d) => Array.from(d.querySelectorAll('section.slide')).map((s) =>
            [s.getAttribute('data-slide-id'), s.getAttribute('data-hidden'), s.getAttribute('data-layout'),
             (s.querySelector('aside.notes') || {}).textContent].join('|'));
        if (JSON.stringify(slideAttrs(A)) !== JSON.stringify(slideAttrs(B))) problems.push('slide attributes or notes differ');
        if (A.querySelector('style').textContent !== B.querySelector('style').textContent) problems.push('deck CSS differs');
        return problems;
    }""", [original_text, saved_text])
    check(differences == [], f"contract deck saved unchanged: {differences}")
    check(not editor.title().startswith("●"), "clean after save")
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


def test_format1_deck_text_is_converted(browser):
    """A deck saved before the text model (deck-format 1) is converted on open, keeping its layout."""
    editor = Editor(browser)
    editor.open(CONTRACT_FORMAT1)
    report = editor.report_dialog_text() or ""
    check("converted to the editor's text format" in report, "the import report says the text was converted")
    editor.close_dialog_if_open()
    check(editor.title().startswith("● "), "the converted deck is marked unsaved")
    page = editor.page
    model = page.evaluate("""() => Array.from(App.deck.getDocument().querySelectorAll('.el[data-type="text"]'))
        .map((el) => Array.from(el.children).every((c) => c.matches('p[data-list][data-level]')))""")
    check(model and all(model), f"every text element is in the text model: {model}")
    check(page.evaluate("App.deck.getDocument().querySelectorAll('.el ul, .el ol, .el li, .el h1, .el h2').length") == 0,
          "no lists or headings left inside text elements")
    check(page.evaluate("App.text.getModel(App.deck.getDocument().querySelector('[data-id=\"e7\"]')).filter(p => p.list === 'bullet').length") == 4,
          "the 4 bullets of slide 2 are bullet paragraphs")

    saved = editor.save_as_download("format1-converted.html")
    positions = page.evaluate("""([a, b]) => {
        const parse = (t) => new DOMParser().parseFromString(t, 'text/html');
        const box = (d) => Array.from(d.querySelectorAll('.el')).map((el) =>
            [el.getAttribute('data-id'), el.style.left, el.style.top, el.style.width, el.style.height, el.style.zIndex].join(' '));
        return [box(parse(a)), box(parse(b))];
    }""", [CONTRACT_FORMAT1.read_text(encoding="utf-8"), saved.read_text(encoding="utf-8")])
    check(positions[0] == positions[1], "every element kept its id, position, size and stacking order")
    check('<meta name="deck-format" content="2">' in saved.read_text(encoding="utf-8"), "saved as format 2")

    # Reopened, it is a format-2 deck: nothing to convert, and saving again changes nothing.
    editor.open(saved)
    check(editor.report_dialog_text() is None, "the converted deck reopens without a report")
    resaved = editor.save_as_download("format1-resaved.html")
    check(resaved.read_text(encoding="utf-8") == saved.read_text(encoding="utf-8"), "second save is byte-identical")
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


TEXT_OF = """id => App.text.getModel(App.deck.getDocument().querySelector('[data-id="' + id + '"]')).map(p => p.text)"""


def editing_id(page):
    return page.evaluate("App.text.isEditing() ? App.text.editingElement().getAttribute('data-id') : null")


def test_text_editing(browser):
    editor = Editor(browser)
    editor.open(CONTRACT)
    page = editor.page
    page.evaluate("App.deck.goTo(1)")   # slide 2: title e5, bullets e7
    before = page.evaluate(TEXT_OF, "e7")

    # Double-click a bullet: edit mode with the cursor where the click was; spell check in Portuguese.
    page.mouse.dblclick(*slide_to_screen(page, 70 + 24 + 2, 165))   # just before "Alfa"
    check(editing_id(page) == "e7", "double-click starts editing")
    check(page.evaluate("App.text.editingElement().isContentEditable && App.text.editingElement().spellcheck"),
          "editable, with spell check")
    check(page.evaluate("App.deck.getDocument().documentElement.lang") == "pt-BR", "the deck says it is Portuguese")
    page.keyboard.type("Nova ")
    check(page.evaluate(TEXT_OF, "e7")[0] == "Nova " + before[0], "typed at the click position")

    # Keys act on the text while editing: arrows move the cursor, not the box; Delete deletes a character.
    rect = element_rect(page, "e7")
    page.keyboard.press("ArrowLeft")
    page.keyboard.press("Delete")
    check(element_rect(page, "e7") == rect, "arrow keys did not move the box")
    check(page.evaluate(TEXT_OF, "e7")[0] == "Nova" + before[0], "Delete removed the space")

    # Escape leaves edit mode; the box stays selected; the text is in the model.
    page.keyboard.press("Escape")
    check(editing_id(page) is None, "Escape leaves edit mode")
    check(page.evaluate("App.selection.selectedId()") == "e7", "the text box stays selected")
    check(page.evaluate("App.deck.getDocument().querySelectorAll('[contenteditable], [spellcheck]').length") == 0,
          "no editing attributes left in the deck")
    check(editor.title().startswith("● "), "typing made the deck dirty")

    # One undo stack: Ctrl+Z after leaving edit mode undoes the typing as one step.
    page.keyboard.press("Control+z")
    check(page.evaluate(TEXT_OF, "e7") == before, "Ctrl+Z undoes the typing")
    page.keyboard.press("Control+y")
    check(page.evaluate(TEXT_OF, "e7")[0] == "Nova" + before[0], "Ctrl+Y redoes it")

    # Enter starts editing the selected box (cursor at the end); typing pauses split undo steps;
    # Ctrl+Z inside the text undoes the last group and puts the cursor back.
    page.keyboard.press("Enter")
    check(editing_id(page) == "e7", "Enter edits the selected text box")
    page.keyboard.type(" abc")
    page.wait_for_timeout(1300)
    page.keyboard.type(" def")
    last = page.evaluate(TEXT_OF, "e7")[-1]
    check(last.endswith(" abc def"), f"typed at the end: {last!r}")
    page.keyboard.press("Control+z")
    check(editing_id(page) == "e7", "still editing after Ctrl+Z")
    check(page.evaluate(TEXT_OF, "e7")[-1].endswith(" abc"), "Ctrl+Z undid only the last group of typing")
    caret = page.evaluate("App.text.getCaret(App.text.editingElement())")
    check(caret["focus"] == {"p": 3, "o": len(before[3]) + 4}, f"the cursor is back after ' abc': {caret}")
    page.keyboard.type("!")
    check(page.evaluate(TEXT_OF, "e7")[-1].endswith(" abc!"), "typing continues at the restored cursor")

    # Clicking another element leaves edit mode and selects that element.
    page.mouse.click(*slide_to_screen(page, 100, 70))   # the title
    check(editing_id(page) is None, "a click outside leaves edit mode")
    check(page.evaluate("App.selection.selectedId()") == "e5", "and selects what was clicked")
    page.keyboard.press("F2")
    check(editing_id(page) == "e5", "F2 edits the selected text box")
    page.keyboard.press("Escape")

    # Insert > Text box, PowerPoint style: click places a box (it grows as you type), drag sets its width.
    page.click(".ribbon-tab[data-tab='insert']")
    page.click("button[data-command='insertTextBox']")
    page.mouse.click(*slide_to_screen(page, 200, 560))
    new_id = editing_id(page)
    check(new_id is not None, "the new text box is in edit mode")
    new_rect = element_rect(page, new_id)
    check((new_rect["left"], new_rect["top"]) == (200, 560), f"placed at the click: {new_rect}")
    page.keyboard.type("Primeira linha")
    page.keyboard.press("Shift+Enter")
    page.keyboard.type("segunda linha")
    check(element_rect(page, new_id)["height"] > new_rect["height"], "the box grew with its text")
    page.keyboard.press("Escape")
    check(page.evaluate(TEXT_OF, new_id) == ["Primeira linha\nsegunda linha"], "the text is in the new box")
    check(page.evaluate("id => App.deck.getDocument().querySelector('[data-id=\"' + id + '\"]').getAttribute('data-autofit')",
                        new_id) == "resize", "new boxes grow with their text")

    page.click("button[data-command='insertTextBox']")
    drag(page, slide_to_screen(page, 700, 520), slide_to_screen(page, 1000, 540))
    dragged = editing_id(page)
    check(element_rect(page, dragged)["width"] == 300, f"dragging set the width: {element_rect(page, dragged)}")
    exists = lambda box_id: page.evaluate(  # noqa: E731
        "id => !!App.deck.getDocument().querySelector('[data-id=\"' + id + '\"]')", box_id)
    page.keyboard.press("Escape")
    check(exists(dragged) and page.evaluate("App.selection.selectedId()") == dragged,
          "Esc on an empty new box: it stays, selected (as in PowerPoint)")
    page.keyboard.press("Escape")   # deselect
    check(not exists(dragged), "an empty new text box is removed once it is deselected")

    # The ribbon while a new box is still empty: the box stays.
    page.click("button[data-command='insertTextBox']")
    page.mouse.click(*slide_to_screen(page, 700, 600))
    fresh = editing_id(page)
    page.click(".ribbon-tab[data-tab='home']")
    check(editing_id(page) == fresh, "switching ribbon tabs keeps typing in the new box")
    page.click("button[data-command='bullets']")
    check(exists(fresh) and page.evaluate(LINES_OF, fresh) == ["b1:"], "Bullets on the empty new box")
    page.keyboard.type("Item")
    check(page.evaluate(LINES_OF, fresh) == ["b1:Item"], "typing goes on in it")
    page.evaluate("App.history.undo(); App.history.undo(); App.history.undo()")   # typing, bullets, the box
    check(not exists(fresh), "undone")
    page.click(".ribbon-tab[data-tab='insert']")
    page.click("button[data-command='insertTextBox']")
    page.mouse.click(*slide_to_screen(page, 700, 600))
    fresh = editing_id(page)
    page.click(".ribbon-tab[data-tab='arrange']")
    page.click("button[data-command='sendBackward']")   # a command that ends typing
    check(exists(fresh) and page.evaluate("App.selection.selectedId()") == fresh,
          "a command that ends typing leaves the empty new box selected")
    page.mouse.click(*slide_to_screen(page, 640, 690))   # empty slide: deselects
    check(not exists(fresh), "deselected: the empty new box goes")
    page.click(".ribbon-tab[data-tab='insert']")

    page.click("button[data-command='insertTextBox']")
    page.keyboard.press("Escape")
    page.mouse.click(*slide_to_screen(page, 640, 690))
    check(editing_id(page) is None, "Escape cancelled the insert")

    # Saving while editing: the file has the typed text and no editing marks.
    page.evaluate("App.selection.select(App.deck.getDocument().querySelector('[data-id=\"e7\"]'))")
    page.keyboard.press("Enter")
    page.keyboard.type(" salvo")
    saved = editor.save_as_download("text-editing-saved.html").read_text(encoding="utf-8")
    check("abc! salvo" in saved, "the typed text is saved")
    check("contenteditable" not in saved and "spellcheck" not in saved and "editor-" not in saved,
          "no editing marks in the saved file")
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


LINES_OF = """id => App.text.getModel(App.deck.getDocument().querySelector('[data-id="' + id + '"]'))
    .map(p => ({ bullet: 'b', number: 'n', none: 'p' })[p.list] + p.level + ':' + p.text.replace(/ /g, ' '))"""


def test_bullet_keys(browser):
    """The bullet table with real key presses in the browser (the full table runs in the unit tests)."""
    editor = Editor(browser)
    editor.open(CONTRACT)
    page = editor.page
    page.evaluate("App.deck.goTo(1)")
    page.evaluate("App.selection.select(App.deck.getDocument().querySelector('[data-id=\"e7\"]'))")
    start = page.evaluate(LINES_OF, "e7")
    page.keyboard.press("Enter")   # edit, cursor at the end of the last bullet
    lines = lambda: page.evaluate(LINES_OF, "e7")  # noqa: E731

    page.keyboard.press("Enter")
    page.keyboard.press("Tab")
    page.keyboard.type("Sub um")
    page.keyboard.press("Enter")
    page.keyboard.type("Sub dois")
    check(lines()[-3:] == [start[-1], "b2:Sub um", "b2:Sub dois"], f"Enter keeps the level, Tab demotes: {lines()[-3:]}")

    page.keyboard.press("Alt+Shift+ArrowRight")
    check(lines()[-1] == "b3:Sub dois", "Alt+Shift+Right demotes from the end of the line")
    page.keyboard.press("Control+z")
    check(lines()[-1] == "b2:Sub dois", "Ctrl+Z undoes the indent only")
    check(page.evaluate("App.text.isEditing()"), "still editing")

    page.keyboard.press("Enter")
    page.keyboard.press("Enter")   # empty level-2 bullet -> level 1
    check(lines()[-1] == "b1:", f"Enter in an empty level-2 bullet promotes it: {lines()[-1]}")
    page.keyboard.press("Enter")   # empty level-1 bullet -> plain text
    check(lines()[-1] == "p1:", "Enter in an empty level-1 bullet ends the list")
    page.keyboard.type("- ")
    check(lines()[-1] == "b1:", f"typing '- ' starts a bullet: {lines()[-1]}")
    page.keyboard.press("Control+z")
    check(lines()[-1] == "p1:- ", f"Ctrl+Z right after undoes only the AutoFormat: {lines()[-1]}")
    page.keyboard.press("Backspace")
    page.keyboard.press("Backspace")
    page.keyboard.type("1. Passo")
    check(lines()[-1] == "n1:Passo", f"'1. ' starts numbering: {lines()[-1]}")

    page.keyboard.press("Home")
    page.keyboard.press("Backspace")
    check(lines()[-1] == "p1:Passo", "Backspace at the start removes the number")
    page.keyboard.press("Backspace")
    check(lines()[-1] == "b2:Sub doisPasso", f"Backspace at the start of a plain line merges it with the line above: {lines()[-2:]}")
    check(page.evaluate("App.text.getCaret(App.text.editingElement()).focus.o") == len("Sub dois"), "cursor at the join")

    # Shift+Tab with several lines selected promotes all of them; Tab in mid-text inserts nothing.
    page.keyboard.press("ArrowUp")
    page.keyboard.press("End")
    page.keyboard.press("Shift+ArrowUp")
    page.keyboard.press("Shift+Tab")
    check(lines()[-3:] == [start[-1], "b1:Sub um", "b2:Sub doisPasso"], f"Shift+Tab promoted the selected lines: {lines()[-3:]}")
    before_tab = lines()
    page.keyboard.press("ArrowLeft")
    page.keyboard.press("ArrowLeft")
    page.keyboard.press("Tab")
    check(lines() == before_tab, "Tab in the middle of text changes nothing")
    check(page.evaluate("App.text.isEditing()"), "Tab did not move the focus out of the text")

    page.keyboard.press("Escape")
    check(all(":" in line for line in lines()), "the text is still in the model")

    # setLevel on a selected (not edited) text box changes every line, as one undo step.
    levels = lambda: [int(line[1]) for line in lines()]  # noqa: E731
    selected = levels()
    page.evaluate("App.text.setLevel(1)")
    check(levels() == [min(5, level + 1) for level in selected], f"every line one level deeper: {levels()}")
    page.keyboard.press("Control+z")
    check(levels() == selected, "Ctrl+Z undoes it")
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


def test_list_buttons(browser):
    """Home > Paragraph buttons: they act on the selected lines and the cursor stays in the text."""
    editor = Editor(browser)
    editor.open(CONTRACT)
    page = editor.page
    page.evaluate("App.deck.goTo(1)")
    page.evaluate("App.selection.select(App.deck.getDocument().querySelector('[data-id=\"e7\"]'))")
    start = page.evaluate(LINES_OF, "e7")
    lines = lambda: page.evaluate(LINES_OF, "e7")  # noqa: E731
    button = lambda command: page.locator(f'#ribbon-panel [data-command="{command}"]')  # noqa: E731
    pressed = lambda command: button(command).get_attribute("aria-pressed") == "true"  # noqa: E731
    check(pressed("bullets") and not pressed("numbering"), "a selected bulleted box shows Bullets on")

    page.keyboard.press("Enter")   # edit, cursor at the end of the last bullet
    page.keyboard.press("Shift+ArrowUp")   # the last two lines selected
    check(button("continueNumbering").is_disabled(), "Continue numbering needs a numbered line")
    button("numbering").click()
    check(page.evaluate("App.text.isEditing()"), "clicking a list button keeps editing")
    check([line[:2] for line in lines()] == ["b1", "b1", "n1", "n1"], f"the two selected lines are numbered: {lines()}")
    check(pressed("numbering") and not pressed("bullets"), "Numbering shows on, Bullets off")

    button("increaseIndent").click()
    check([line[:2] for line in lines()] == ["b1", "b1", "n2", "n2"], f"Increase indent demotes both: {lines()}")
    page.keyboard.press("End")
    page.keyboard.type("!")   # the cursor is where the selection ended: the third line
    check(lines()[2].endswith("!"), f"the cursor stayed in the text: {lines()}")

    page.keyboard.press("ArrowUp")   # into the second line, a bullet
    wait_until(page, "() => document.querySelector('#ribbon-panel [data-command=\"bullets\"]').ariaPressed === 'true'", timeout=3000)
    check(not pressed("numbering"), "the buttons follow the cursor")
    page.keyboard.press("ArrowDown")
    page.keyboard.press("ArrowDown")
    button("restartNumbering").click()
    check(lines()[-1].startswith("n2:"), "restart keeps the line numbered")
    check(page.evaluate("""() => App.text.editingElement().lastElementChild.getAttribute('data-start')""") == "1",
          "Restart numbering writes data-start=1")
    for _ in range(4):   # restart, typing, indent, numbering
        page.keyboard.press("Control+z")
    check(lines() == start, f"each button press is one undo step: {lines()}")
    check(page.evaluate("App.text.isEditing()"), "still editing after undo")

    page.keyboard.press("Escape")
    button("bullets").click()
    check([line[:2] for line in lines()] == ["p1"] * 4, f"with the box selected, Bullets acts on every line: {lines()}")
    check(not pressed("bullets"), "Bullets shows off")
    page.keyboard.press("Control+z")
    check(lines() == start, "Ctrl+Z undoes it")
    page.evaluate("App.selection.clear()")
    check(button("bullets").is_disabled(), "no text selected: the list buttons are disabled")
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


def test_character_formatting(browser):
    """Home > Font toggles and Clear formatting, from the ribbon and the keyboard."""
    editor = Editor(browser)
    editor.open(CONTRACT)
    page = editor.page
    page.evaluate("App.deck.goTo(1)")
    page.evaluate("App.selection.select(App.deck.getDocument().querySelector('[data-id=\"e7\"]'))")
    last_line = lambda: page.evaluate(  # noqa: E731
        "() => App.deck.getDocument().querySelector('[data-id=\"e7\"]').lastElementChild.innerHTML")
    button = lambda command: page.locator(f'#ribbon-panel [data-command="{command}"]')  # noqa: E731
    pressed = lambda command: button(command).get_attribute("aria-pressed") == "true"  # noqa: E731
    start = last_line()

    page.keyboard.press("Enter")   # edit, cursor at the end
    page.keyboard.press("Control+Shift+ArrowLeft")   # select the last word
    page.keyboard.press("Control+b")
    check(last_line().endswith("<b>compras</b>"), f"Ctrl+B bolds the selected word: {last_line()}")
    wait_until(page, "() => document.querySelector('#ribbon-panel [data-command=\"bold\"]').ariaPressed === 'true'",
               timeout=3000)
    button("italic").click()
    check(last_line().endswith("<b><i>compras</i></b>"), f"the Italic button adds italic: {last_line()}")
    check(page.evaluate("App.text.isEditing()") and pressed("italic"), "still editing; Italic shows on")
    page.keyboard.press("Control+z")
    check(last_line().endswith("<b>compras</b>"), "Ctrl+Z undoes only the italic")
    page.keyboard.press("Control+u")
    check(last_line().endswith("<b><u>compras</u></b>"), f"Ctrl+U underlines: {last_line()}")
    page.keyboard.press("Control+z")

    # With just a cursor, the formatting is for what is typed next (as in PowerPoint).
    page.keyboard.press("End")
    page.keyboard.press("Control+b")
    check(pressed("bold") is False, "the cursor after a bold word: Ctrl+B turns bold off for what comes next")
    page.keyboard.type(" e mais")
    check(last_line().endswith("<b>compras</b> e mais"), f"text typed after Ctrl+B is not bold: {last_line()}")
    page.keyboard.press("Control+b")
    page.keyboard.type(" novo")
    check(last_line().endswith(" e mais<b> novo</b>"), f"text typed after Ctrl+B again is bold: {last_line()}")

    # Clear formatting on the whole line.
    page.keyboard.press("Home")
    page.keyboard.press("Shift+End")
    button("clearFormatting").click()
    check("<b>" not in last_line(), f"Clear formatting removed the bold: {last_line()}")

    page.keyboard.press("Escape")
    page.keyboard.press("Control+b")   # the box is selected: all its text
    weight = page.evaluate("() => App.deck.getDocument().querySelector('[data-id=\"e7\"]').style.fontWeight")
    check(weight == "bold", f"Ctrl+B on a selected box makes the box bold: {weight}")
    check(pressed("bold"), "Bold shows on")
    for _ in range(8):   # box bold, clear, the typing, bold
        if last_line() == start:
            break
        page.keyboard.press("Control+z")
    check(last_line() == start, f"every step undoes: {last_line()}")
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


def test_font_and_size(browser):
    """Home > Font: the font list, the size box (list and typed), Increase / Decrease and their keys."""
    editor = Editor(browser)
    editor.open(CONTRACT)
    page = editor.page
    page.evaluate("App.deck.goTo(1)")
    page.evaluate("App.selection.select(App.deck.getDocument().querySelector('[data-id=\"e7\"]'))")
    box_style = lambda: page.evaluate(  # noqa: E731
        "() => App.deck.getDocument().querySelector('[data-id=\"e7\"]').getAttribute('style')")
    last_line = lambda: page.evaluate(  # noqa: E731
        "() => App.deck.getDocument().querySelector('[data-id=\"e7\"]').lastElementChild.innerHTML")
    size_box = page.locator("#ribbon-panel .font-size-input")
    font_box = page.locator("#ribbon-panel .font-family-button")
    shows = lambda locator, text: wait_until(  # noqa: E731
        page, "([s, t]) => { const n = document.querySelector(s); return n && (n.value ?? n.textContent) === t; }",
        [locator, text], timeout=3000)
    start = last_line()
    shows("#ribbon-panel .font-size-input", "16.5")
    shows("#ribbon-panel .font-family-button .font-name", "Calibri (Body)")
    page.keyboard.press("Control+[")   # the box is selected: all its text, one size, so the box's own size
    check("font-size: 16pt" in box_style() and "<span" not in last_line(), f"Ctrl+[ on the box: {box_style()}")
    shows("#ribbon-panel .font-size-input", "16")
    page.keyboard.press("Control+z")
    check("font-size: 16.5pt" in box_style(), "Ctrl+Z")

    page.keyboard.press("Enter")   # edit, cursor at the end
    page.keyboard.press("Control+Shift+ArrowLeft")   # the last word
    page.keyboard.press("Control+]")
    check(last_line().endswith('<span style="font-size: 18pt;">compras</span>'), f"Ctrl+] grows to 18: {last_line()}")
    shows("#ribbon-panel .font-size-input", "18")
    page.keyboard.press("Control+Shift+Period")   # Ctrl+Shift+> on a US keyboard
    check('font-size: 20pt' in last_line(), f"Ctrl+Shift+> grows to 20: {last_line()}")

    size_box.click()
    size_box.fill("30")
    size_box.press("Enter")
    check('font-size: 30pt' in last_line(), f"a typed size: {last_line()}")
    check(page.evaluate("App.text.isEditing() && document.activeElement.id === 'deck-frame'"),
          "still editing, the focus is back in the text")
    check(page.evaluate("JSON.stringify(App.text.getCaret(App.text.editingElement()))") ==
          '{"anchor":{"p":3,"o":70},"focus":{"p":3,"o":63}}', "the word is still selected")

    page.locator("#ribbon-panel .font-size-menu-button").click()
    page.locator(".font-size-menu .menu-item", has_text="40").first.click()
    check('font-size: 40pt' in last_line(), f"a size from the list: {last_line()}")

    font_box.click()
    page.locator(".font-family-menu .menu-item", has_text="Georgia").click()
    check('font-family: Georgia, serif' in last_line(), f"Georgia from the font list: {last_line()}")
    shows("#ribbon-panel .font-family-button .font-name", "Georgia")
    font_box.click()
    page.locator(".font-family-menu .menu-item", has_text="(Headings)").click()
    check('font-family: var(--font-heading)' in last_line(), f"the theme heading font is a variable: {last_line()}")

    page.keyboard.press("Home")
    page.keyboard.press("Shift+End")
    shows("#ribbon-panel .font-size-input", "")   # mixed sizes: blank, as in PowerPoint

    page.keyboard.press("Escape")
    for _ in range(10):
        if last_line() == start:
            break
        page.keyboard.press("Control+z")
    check(last_line() == start and "font-size: 16.5pt" in box_style(), f"every step undoes: {last_line()}")
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


def test_text_colors(browser):
    """Home > Font: font colour and highlight, with the deck's theme colours first."""
    editor = Editor(browser)
    editor.open(CONTRACT)
    page = editor.page
    page.evaluate("App.deck.goTo(1)")
    page.evaluate("App.selection.select(App.deck.getDocument().querySelector('[data-id=\"e7\"]'))")
    last_line = lambda: page.evaluate(  # noqa: E731
        "() => App.deck.getDocument().querySelector('[data-id=\"e7\"]').lastElementChild.innerHTML")
    start = last_line()
    page.keyboard.press("Enter")
    page.keyboard.press("Control+Shift+ArrowLeft")   # the last word

    page.locator('#ribbon-panel [data-command="fontColor"]').click()   # the colour shown on the button
    check('color: var(--color-primary)' in last_line(), f"the Font color button uses the theme's primary colour: {last_line()}")
    page.locator("#ribbon-panel .font-color-menu-button").click()
    page.locator('.color-menu [title="Accent (theme)"]').click()
    check('color: var(--color-accent)' in last_line(), f"a theme colour is stored as its variable: {last_line()}")
    page.locator("#ribbon-panel .font-color-menu-button").click()
    page.locator('.color-menu [title="Dark Red"]').click()
    check('color: rgb(192, 0, 0)' in last_line(), f"a standard colour: {last_line()}")
    page.keyboard.press("Home")
    page.keyboard.press("Control+Shift+ArrowRight")   # the first word
    page.locator('#ribbon-panel [data-command="fontColor"]').click()
    check(last_line().startswith('<span style="color: rgb(192, 0, 0);">Plano'), f"the button now uses Dark Red: {last_line()}")

    page.locator('#ribbon-panel [data-command="highlight"]').click()
    check('background-color: rgb(255, 255, 0)' in last_line(), f"highlight starts yellow: {last_line()}")
    page.locator("#ribbon-panel .highlight-menu-button").click()
    page.locator('.color-menu [title="No color"]').click()
    check('background-color' not in last_line(), f"No color takes the highlight off: {last_line()}")
    check(page.evaluate("App.text.isEditing()"), "still editing")

    for _ in range(8):
        if last_line() == start:
            break
        page.keyboard.press("Control+z")
    check(last_line() == start, f"every step undoes: {last_line()}")
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


def test_paragraph_formatting(browser):
    """Home > Paragraph: alignment (buttons and Ctrl+L/E/R/J), line spacing, space before / after."""
    editor = Editor(browser)
    editor.open(CONTRACT)
    page = editor.page
    page.evaluate("App.deck.goTo(1)")
    page.evaluate("App.selection.select(App.deck.getDocument().querySelector('[data-id=\"e7\"]'))")
    styles = lambda: page.evaluate(  # noqa: E731
        "() => Array.from(App.deck.getDocument().querySelector('[data-id=\"e7\"]').children).map(p => p.style.cssText)")
    button = lambda command: page.locator(f'#ribbon-panel [data-command="{command}"]')  # noqa: E731
    start = styles()

    page.keyboard.press("Enter")   # edit, cursor at the end of the last line
    page.keyboard.press("Control+e")
    check("text-align: center" in styles()[-1] and "text-align" not in styles()[-2], f"Ctrl+E centres the line: {styles()}")
    wait_until(page, "() => document.querySelector('#ribbon-panel [data-command=\"alignCenter\"]').ariaPressed === 'true'",
               timeout=3000)
    page.keyboard.press("Shift+ArrowUp")
    button("alignRight").click()
    check(all("text-align: right" in style for style in styles()[-2:]), f"Align right on two lines: {styles()}")
    check(page.evaluate("App.text.isEditing()"), "still editing")

    page.locator("#ribbon-panel .line-spacing-button").click()
    page.locator(".line-spacing-menu .menu-item", has_text="1.5").click()
    check(all("line-height: 1.8" in style for style in styles()[-2:]), f"line spacing 1.5 (x 1.2 = 1.8): {styles()}")
    page.locator("#ribbon-panel .line-spacing-button").click()
    checked = page.locator('.line-spacing-menu [aria-checked="true"]').inner_text()
    check(checked.strip() == "1.5", f"the menu shows the current spacing: {checked!r}")
    before = page.locator(".line-spacing-menu .space-before-input")
    before.fill("12")
    before.press("Enter")
    check(all("margin-top: 12pt" in style for style in styles()[-2:]), f"space before 12 pt: {styles()}")
    check(page.evaluate("App.text.isEditing() && document.activeElement.id === 'deck-frame'"), "back in the text")

    page.keyboard.press("Escape")
    page.keyboard.press("Control+l")   # the box is selected: every line
    check(all("text-align: left" in style for style in styles()), f"Ctrl+L on the box: {styles()}")
    for _ in range(8):
        if styles() == start:
            break
        page.keyboard.press("Control+z")
    check(styles() == start, f"every step undoes: {styles()}")
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


def test_clipboard_capture_page(browser):
    """tests/clipboard-capture.html saves every clipboard format, with the text replaced by fake letters."""
    page = browser.new_page(accept_downloads=True)
    page.goto((Path(__file__).parent / "clipboard-capture.html").as_uri())
    html = ("<link rel=File-List href=\"file:///C:/Users/maria.silva/AppData/Local/Temp/msohtmlclip1/01/clip_filelist.xml\">"
            "<style>p.MsoNormal{font-family:\"Calibri\"}</style><!--StartFragment-->"
            "<p class=MsoNormal style='mso-list:l0 level1 lfo1'><![if !supportLists]><span style='mso-list:Ignore'>1."
            "<span>&nbsp;</span></span><![endif]><b>Receita</b> São Paulo 2025</p>")
    page.evaluate("""([html, text]) => {
        const data = new DataTransfer();
        data.setData('text/html', html);
        data.setData('text/plain', text);
        document.getElementById('paste-area').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
    }""", [html, "Receita São Paulo 2025"])
    page.fill("#name", "word test")
    with page.expect_download() as download_info:
        page.click("#save")
    download = download_info.value
    check(download.suggested_filename == "word-test.js", f"file name: {download.suggested_filename}")
    content = Path(download.path()).read_text(encoding="utf-8")
    check(content.startswith("// Clipboard fixture") and "CLIPBOARD_FIXTURES.push(" in content, "a fixture script")
    start = content.index("CLIPBOARD_FIXTURES.push(") + len("CLIPBOARD_FIXTURES.push(")
    fixture = json.loads(content[start:content.rindex(")")])
    faked = fixture["types"]["text/html"]
    check(faked == html.replace("1.", "0.").replace("Receita", "Aaaaaaa").replace("São Paulo 2025", "Aaa Aaaaa 0000")
          .replace("Users/maria.silva/", "Users/user/"),
          f"only the text and the Windows user name are faked, the markup is untouched: {faked}")
    check(fixture["types"]["text/plain"] == "Aaaaaaa Aaa Aaaaa 0000", f"plain text faked: {fixture['types']['text/plain']}")
    check(fixture["fakeText"] is True, "the fixture says its text is fake")
    page.close()


WORD_LIST_HTML = (
    "<html><head><meta name=ProgId content=Word.Document></head><body><!--StartFragment-->"
    "<p class=MsoListParagraphCxSpFirst style='text-indent:-18.0pt;mso-list:l0 level1 lfo1'><![if !supportLists]>"
    "<span style='font-family:Symbol'><span style='mso-list:Ignore'>·<span style='font:7.0pt \"Times New Roman\"'>"
    "&nbsp;&nbsp; </span></span></span><![endif]><span style='font-size:20pt;color:red'>Um</span></p>"
    "<p class=MsoListParagraphCxSpLast style='margin-left:72.0pt;text-indent:-18.0pt;mso-list:l0 level2 lfo1'>"
    "<![if !supportLists]><span style='font-family:\"Courier New\"'><span style='mso-list:Ignore'>o"
    "<span style='font:7.0pt \"Times New Roman\"'>&nbsp; </span></span></span><![endif]><b>Dois</b></p>"
    "<!--EndFragment--></body></html>")


def put_on_clipboard(page, html, text):
    """Write HTML and plain text to the system clipboard, as a program copying them would."""
    page.evaluate("""async ([html, text]) => {
        await navigator.clipboard.write([new ClipboardItem({
            'text/html': new Blob([html], { type: 'text/html' }),
            'text/plain': new Blob([text], { type: 'text/plain' }),
        })]);
    }""", [html, text])


def test_paste_into_text(browser):
    """Ctrl+V (lists and bold kept, the deck's look), Ctrl+Shift+V (plain text), each one undo step."""
    context = browser.new_context(viewport={"width": 1440, "height": 900}, accept_downloads=True)
    context.grant_permissions(["clipboard-read", "clipboard-write"])
    editor = Editor(browser, context)
    editor.open(CONTRACT)
    page = editor.page
    page.evaluate("App.deck.goTo(1)")
    page.evaluate("App.selection.select(App.deck.getDocument().querySelector('[data-id=\"e7\"]'))")
    lines = lambda: page.evaluate(LINES_OF, "e7")  # noqa: E731
    html_of = lambda index: page.evaluate(  # noqa: E731
        "i => App.deck.getDocument().querySelector('[data-id=\"e7\"]').children[i].innerHTML", index)
    start = lines()

    page.keyboard.press("Enter")   # edit, cursor at the end
    page.keyboard.press("Enter")   # a new, empty bullet
    put_on_clipboard(page, WORD_LIST_HTML, "Um\r\nDois\r\n")
    page.keyboard.press("Control+v")
    check(lines()[-2:] == ["b1:Um", "b2:Dois"], f"Word's list pasted with its levels: {lines()}")
    check(html_of(len(lines()) - 1) == "<b>Dois</b>" and html_of(len(lines()) - 2) == "Um",
          f"bold kept, Word's size and colour dropped: {html_of(len(lines()) - 2)!r}")
    check(page.evaluate("App.text.isEditing()"), "still editing")
    page.keyboard.type("!")
    check(lines()[-1] == "b2:Dois!", f"the cursor is after the pasted text: {lines()[-1]}")
    page.keyboard.press("Control+z")   # the typing
    page.keyboard.press("Control+z")   # the paste
    check(lines() == start + ["b1:"], f"the paste is one undo step: {lines()}")

    page.keyboard.press("Control+Shift+v")
    check(lines()[-2:] == ["b1:Um", "b1:Dois"], f"Ctrl+Shift+V pastes plain text, lines as bullets here: {lines()}")
    check("<b>" not in html_of(len(lines()) - 1), "no bold in plain text")
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


def test_copy_and_cut_text(browser):
    """Ctrl+C in a text: nested lists on the clipboard for Outlook/Word; pasted back it looks the same. Ctrl+X: one step."""
    context = browser.new_context(viewport={"width": 1440, "height": 900}, accept_downloads=True)
    context.grant_permissions(["clipboard-read", "clipboard-write"])
    editor = Editor(browser, context)
    editor.open(CONTRACT)
    page = editor.page
    page.evaluate("App.deck.goTo(1)")
    page.evaluate("App.selection.select(App.deck.getDocument().querySelector('[data-id=\"e7\"]'))")
    lines = lambda: page.evaluate(LINES_OF, "e7")  # noqa: E731
    start = lines()

    page.keyboard.press("Enter")   # edit, cursor at the end of the last line
    page.keyboard.press("Home")
    page.keyboard.press("ArrowUp")   # the start of line 3
    page.keyboard.press("Shift+ArrowDown")
    page.keyboard.press("Shift+End")   # lines 3 and 4, whole
    page.keyboard.press("Control+c")
    clipboard = page.evaluate("""async () => {
        const [item] = await navigator.clipboard.read();
        return { html: await (await item.getType('text/html')).text(), text: await (await item.getType('text/plain')).text() };
    }""")
    check('data-deck-editor="text"' in clipboard["html"] and "<ul>" in clipboard["html"], f"nested lists: {clipboard['html'][:200]}")
    check(clipboard["text"].replace("\r", "") == "\n".join(line[3:] for line in start[2:4]), f"plain lines: {clipboard['text']!r}")

    page.keyboard.press("End")
    page.keyboard.press("Enter")
    page.keyboard.press("Control+v")
    check(lines() == start + start[2:4], f"pasted back: two more bullets with the same text: {lines()}")
    for _ in range(2):   # the paste, the new line
        page.keyboard.press("Control+z")
    check(lines() == start, f"undone: {lines()}")

    page.keyboard.press("Shift+ArrowUp")
    page.keyboard.press("Control+x")
    check(len(lines()) == len(start) - 1, f"Ctrl+X removed the selection: {lines()}")
    page.keyboard.press("Control+z")
    check(lines() == start, "Ctrl+Z brings it back")
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


def test_paste_options_button(browser):
    """After a paste, a button switches it between "Use destination theme" and "Keep text only"; typing hides it."""
    context = browser.new_context(viewport={"width": 1440, "height": 900}, accept_downloads=True)
    context.grant_permissions(["clipboard-read", "clipboard-write"])
    editor = Editor(browser, context)
    editor.open(CONTRACT)
    page = editor.page
    page.evaluate("App.deck.goTo(1)")
    page.evaluate("App.selection.select(App.deck.getDocument().querySelector('[data-id=\"e7\"]'))")
    lines = lambda: page.evaluate(LINES_OF, "e7")  # noqa: E731
    start = lines()
    button = page.locator("#paste-options")
    page.keyboard.press("Enter")
    page.keyboard.press("Enter")   # a new, empty bullet
    check(button.is_hidden(), "no button before a paste")
    put_on_clipboard(page, WORD_LIST_HTML, "Um\r\nDois")
    page.keyboard.press("Control+v")
    check(button.is_visible(), "the paste options button appears")
    button.click()
    options = page.locator(".paste-options-menu .menu-item")
    check(options.all_inner_texts() == ["Use destination theme", "Keep text only"], f"options: {options.all_inner_texts()}")
    check(page.locator('.paste-options-menu [aria-checked="true"]').inner_text() == "Use destination theme", "current one ticked")
    page.locator(".paste-options-menu .menu-item", has_text="Keep text only").click()
    check(lines()[-2:] == ["b1:Um", "b1:Dois"], f"switched to plain text: {lines()}")
    check(page.evaluate("App.text.isEditing()") and button.is_visible(), "still editing; the button stays")
    button.click()
    page.locator(".paste-options-menu .menu-item", has_text="Use destination theme").click()
    check(lines()[-2:] == ["b1:Um", "b2:Dois"], f"and back: {lines()}")
    page.keyboard.press("Control+z")
    check(lines() == start + ["b1:"], f"one Ctrl+Z removes the paste: {lines()}")
    check(button.is_hidden(), "the button goes with it")
    page.keyboard.press("Control+v")
    page.keyboard.type("x")
    # The ribbon and the button follow the cursor once per screen frame.
    wait_until(page, "() => document.getElementById('paste-options').hidden", timeout=2000)   # typing hides it
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


def test_double_click_empty_slide_adds_text_box(browser):
    """Double-click on empty slide space: a new text box there, ready to type; left empty, it goes when deselected."""
    editor = Editor(browser)
    editor.open(CONTRACT)
    page = editor.page
    page.evaluate("App.deck.goTo(1)")
    count = lambda: page.evaluate("App.deck.getCurrentSlide().querySelectorAll('.el').length")  # noqa: E731
    before = count()
    check(page.evaluate("App.selection.elementAt(900, 670)") is None, "the spot is empty slide space")
    page.mouse.dblclick(*slide_to_screen(page, 900, 670))
    new_id = editing_id(page)
    check(new_id is not None and count() == before + 1, "a new text box, in edit mode")
    rect = element_rect(page, new_id)
    # The mouse lands on whole screen pixels: at this zoom, one is about 1.4 slide pixels.
    check(abs(rect["left"] - 900) <= 1 and abs(rect["top"] - 670) <= 1, f"placed where the double-click was: {rect}")
    page.keyboard.type("Nota")
    check(page.evaluate(TEXT_OF, new_id) == ["Nota"], "typing goes into it")
    page.keyboard.press("Escape")
    page.keyboard.press("Control+z")   # the typing
    page.keyboard.press("Control+z")   # the box
    check(count() == before, "two undo steps: the typing, then the box")

    page.mouse.dblclick(*slide_to_screen(page, 900, 670))
    check(editing_id(page) is not None, "again")
    page.mouse.click(*slide_to_screen(page, 640, 700))   # elsewhere, without typing
    check(count() == before, "left empty and deselected: removed")

    page.mouse.dblclick(*slide_to_screen(page, 300, 300))   # on the bullets
    check(editing_id(page) == "e7" and count() == before, "on a text box, double-click still edits that box")
    page.keyboard.press("Escape")
    overlay = page.evaluate("(() => { const r = document.getElementById('overlay').getBoundingClientRect(); return [r.left, r.bottom]; })()")
    page.mouse.dblclick(overlay[0] - 20, overlay[1] + 20)   # the grey area outside the slide
    check(count() == before and editing_id(page) is None, "outside the slide: nothing")
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


def word_on_screen(page, box_id, line, word):
    """Screen position of the middle of `word` in line `line` of a text box (the deck iframe is at slide scale 1:1)."""
    point = page.evaluate("""([id, line, word]) => {
        const p = App.deck.getDocument().querySelector('[data-id="' + id + '"]').children[line];
        const walker = p.ownerDocument.createTreeWalker(p, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const at = node.data.indexOf(word);
            if (at !== -1) {
                const range = p.ownerDocument.createRange();
                range.setStart(node, at);
                range.setEnd(node, at + word.length);
                const r = range.getBoundingClientRect();
                return [r.left + r.width / 2, r.top + r.height / 2];
            }
        }
        return null;
    }""", [box_id, line, word])
    return slide_to_screen(page, *point)


def test_format_painter(browser):
    """Home > Format painter: pick up a look, paint a whole box, a word; double-click keeps it on; Esc stops."""
    editor = Editor(browser)
    editor.open(CONTRACT)
    page = editor.page
    page.evaluate("App.deck.goTo(1)")
    style_of = lambda box_id: page.evaluate(  # noqa: E731
        "id => App.deck.getDocument().querySelector('[data-id=\"' + id + '\"]').getAttribute('style')", box_id)
    line_html = lambda box_id, index: page.evaluate(  # noqa: E731
        "([id, i]) => App.deck.getDocument().querySelector('[data-id=\"' + id + '\"]').children[i].innerHTML", [box_id, index])
    painter = page.locator('#ribbon-panel [data-command="formatPainter"]')
    start_e7 = style_of("e7")

    # The title's look onto the bullets box: a click on the box paints all of it.
    page.mouse.click(*slide_to_screen(page, 300, 90))   # the title
    check(page.evaluate("App.selection.selectedId()") == "e5", "title selected")
    painter.click()
    check(painter.get_attribute("aria-pressed") == "true", "the painter is on")
    page.mouse.click(*slide_to_screen(page, 300, 300))   # the bullets box
    title = page.evaluate("""() => { const c = getComputedStyle(App.deck.getDocument().querySelector('[data-id="e5"] p'));
        return [c.fontWeight, c.fontSize, c.color]; }""")
    painted = page.evaluate("""() => { const c = getComputedStyle(App.deck.getDocument().querySelector('[data-id="e7"] p'));
        return [c.fontWeight, c.fontSize, c.color]; }""")
    check(painted == title, f"the bullets now look like the title: {painted} vs {title}")
    check(painter.get_attribute("aria-pressed") == "false", "one use: the painter is off again")
    check(page.evaluate("App.selection.selectedId()") == "e7", "the painted box is selected")
    page.keyboard.press("Control+z")
    check(style_of("e7") == start_e7, "Ctrl+Z undoes the painting")

    # Inside a text: bold one word, pick it up, click inside another word.
    page.keyboard.press("Enter")   # edit e7, cursor at the end
    page.keyboard.press("Control+Shift+ArrowLeft")
    page.keyboard.press("Control+b")   # "compras" bold
    page.keyboard.press("ArrowLeft")
    page.keyboard.press("ArrowRight")   # cursor inside the bold word
    painter.click()
    page.mouse.click(*word_on_screen(page, "e7", 3, "Plano"))
    check(line_html("e7", 3).startswith("<b>Plano</b>"), f"a click inside a word paints the word: {line_html('e7', 3)}")
    check(page.evaluate("App.text.isEditing()"), "still editing")

    # Double-click: stays on for several words, until Esc.
    painter.dblclick()
    check(painter.get_attribute("aria-pressed") == "true", "double-click: on")
    page.mouse.click(*word_on_screen(page, "e7", 3, "valor"))
    page.mouse.click(*word_on_screen(page, "e7", 3, "Sudeste"))
    check("<b>valor</b>" in line_html("e7", 3) and "<b>Sudeste</b>" in line_html("e7", 3),
          f"two words painted: {line_html('e7', 3)}")
    page.keyboard.press("Escape")
    check(painter.get_attribute("aria-pressed") == "false" and page.evaluate("App.text.isEditing()"),
          "Esc stops the painter (and only that: still editing)")
    page.keyboard.press("Escape")

    # A click on empty slide space with the painter on: it stops, nothing changes.
    page.mouse.click(*slide_to_screen(page, 300, 90))
    painter.click()
    before = page.evaluate("App.deck.getCurrentSlide().innerHTML")
    page.mouse.click(*slide_to_screen(page, 640, 690))
    check(painter.get_attribute("aria-pressed") == "false", "a click on empty space stops the painter")
    check(page.evaluate("App.deck.getCurrentSlide().innerHTML") == before, "and changes nothing")
    check(page.evaluate("App.deck.getDocument().querySelectorAll('style[data-editor-only=\"painter\"]').length") == 0,
          "the painter's cursor rule is gone")
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


def test_saved_deck_presents_on_its_own(browser):
    saved = OUTPUT / "contract-saved.html"
    check(saved.exists(), "run after the contract round-trip test")
    page, errors = play_saved_deck(browser, saved)
    counter = lambda: page.inner_text(".deck-player-counter")  # noqa: E731
    check(counter() == "1 / 5", "5 visible slides (1 hidden), got " + counter())
    check(visible_slide_ids(page) == ["s1"], "only slide 1 visible")
    page.screenshot(path=str(OUTPUT / "04-player-slide1.png"))
    page.keyboard.press("ArrowRight")
    check(visible_slide_ids(page) == ["s2"], "ArrowRight -> s2")
    page.keyboard.press("Space")
    page.keyboard.press("PageDown")
    check(visible_slide_ids(page) == ["s4"], "Space, PageDown -> s4")
    page.keyboard.press("ArrowRight")
    check(visible_slide_ids(page) == ["s6"], "hidden slide s5 is skipped")
    page.keyboard.press("Home")
    check(visible_slide_ids(page) == ["s1"], "Home -> first")
    page.keyboard.press("End")
    check(counter() == "5 / 5", "End -> last")
    page.keyboard.press("PageUp")
    check(visible_slide_ids(page) == ["s4"], "PageUp -> previous (skips hidden)")
    page.screenshot(path=str(OUTPUT / "05-player-chart-slide.png"))
    # Print layout: one slide per page, hidden slide excluded.
    page.emulate_media(media="print")
    printed = page.evaluate("""() => Array.from(document.querySelectorAll('section.slide'))
        .filter(s => getComputedStyle(s).display !== 'none').length""")
    check(printed == 5, f"print shows 5 slides, got {printed}")
    page.pdf(path=str(OUTPUT / "contract-saved.pdf"), prefer_css_page_size=True, print_background=True)
    # Bullets and indents print as on screen (Phase 3 done-when): read what the print layout draws.
    printed_text = rendered_text(page, 'section.slide[data-slide-id="s2"]')
    check("•Alfa Alimentos" in printed_text, f"the printed slide has its bullets: {printed_text[:120]!r}")
    check(errors == [], f"player has no errors: {errors}")
    page.context.close()


def test_messy_copilot_deck(browser):
    editor = Editor(browser)
    editor.open(MESSY)
    report = editor.report_dialog_text()
    check(report is not None, "import report shown")
    for expected in ["5 slides found", "converted into movable elements", "chart.js", "Inline script",
                     "inline event handler", "fonts.googleapis.com", "logo-boreal.png", "Canvas",
                     "outside the slides"]:
        check(expected.lower() in report.lower(), f"report mentions {expected!r}")
    editor.page.screenshot(path=str(OUTPUT / "06-messy-import-report.png"))
    check(editor.title().startswith("● "), "normalized deck is marked unsaved, got " + editor.title())

    # Remove the blocked references from the report, then undo / redo it.
    remote_count = "App.importer.findExternalRefs(App.deck.getDocument()).remote.length"
    check(editor.page.evaluate(remote_count) > 0, "remote refs present before removal")
    editor.click_dialog_button("Remove blocked references")
    wait_until(editor.page, "document.getElementById('status-message').textContent.startsWith('Removed')")
    check(editor.page.evaluate(remote_count) == 0, "remote refs removed")
    editor.page.keyboard.press("Control+Z")
    check(editor.page.evaluate(remote_count) > 0, "undo brings them back")
    editor.page.keyboard.press("Control+Y")
    check(editor.page.evaluate(remote_count) == 0, "redo removes them again")

    check(editor.slide_count() == 5, "5 slides")
    for index in range(5):
        editor.page.evaluate(f"App.deck.goTo({index})")
        editor.page.screenshot(path=str(OUTPUT / f"07-messy-slide{index + 1}.png"))

    saved = editor.save_as_download("messy-saved.html")
    check(not editor.title().startswith("●"), "clean after save")
    saved_text = saved.read_text(encoding="utf-8")
    check("cdn.jsdelivr" not in saved_text and "fonts.googleapis" not in saved_text, "no remote refs in saved file")
    check(saved_text.count("<script") == 1, "only the player script remains")

    # Reopen the saved deck: now a contract deck, and saving it again changes nothing.
    editor.open(saved)
    check(editor.report_dialog_text() is None, "saved deck re-opens as a clean contract deck")
    resaved = editor.save_as_download("messy-resaved.html")
    check(resaved.read_text(encoding="utf-8") == saved_text, "second save is byte-identical")
    check(editor.remote_requests == [], f"no network requests: {editor.remote_requests}")
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()

    page, errors = play_saved_deck(browser, saved)
    check(page.inner_text(".deck-player-counter") == "1 / 5", "messy deck presents with 5 slides")
    page.keyboard.press("ArrowRight")
    page.screenshot(path=str(OUTPUT / "08-messy-player-slide2.png"))
    check(errors == [], f"player errors: {errors}")
    page.context.close()


def test_appendix_a_deck_gets_charts_and_fixes(browser):
    editor = Editor(browser)
    editor.open(APPENDIX_A)
    report = editor.report_dialog_text() or ""
    check("already uses the editor's format" in report, "recognised as contract deck")
    check("2 charts had data but no drawing" in report, "2 chart placeholders rendered")
    check("z-index" in report, "z-index fix reported")
    editor.close_dialog_if_open()
    editor.page.evaluate("App.deck.goTo(1)")
    editor.page.screenshot(path=str(OUTPUT / "09-appendix-a-chart.png"))
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


def test_1920_deck_is_scaled(browser):
    editor = Editor(browser)
    editor.open(WIDE)
    report = editor.report_dialog_text() or ""
    check("scaled from 1920×1080" in report, "scaling reported")
    editor.close_dialog_if_open()
    sizes = editor.page.evaluate("""() => App.deck.getSlides().map((s, i) => {
        App.deck.goTo(i);
        return [s.offsetWidth, s.offsetHeight];
    })""")
    check(all(size == [1280, 720] for size in sizes), f"slides are 1280x720: {sizes}")
    editor.page.screenshot(path=str(OUTPUT / "10-wide-deck.png"))
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


def test_shortcuts_dirty_dot_and_close_warning(browser):
    editor = Editor(browser)
    editor.open(MESSY)
    editor.close_dialog_if_open()
    page = editor.page
    # Keys pressed while the focus is inside the slide iframe must still work.
    page.click("#canvas-stage", position={"x": 50, "y": 50})
    page.keyboard.press("PageDown")
    check(page.inner_text("#status-slide").startswith("Slide 2 of 5"), "PageDown with focus in the slide")
    page.keyboard.press("End")
    check(page.inner_text("#status-slide").startswith("Slide 5 of 5"), "End")
    page.click(".thumb[data-index='2']")
    check(page.inner_text("#status-slide").startswith("Slide 3 of 5"), "click on thumbnail")
    check(page.inner_text("#title-file") == MESSY.name, "file name in title bar")
    check(page.is_visible("#title-dirty"), "unsaved dot visible")

    dialogs = []
    page.on("dialog", lambda dialog: (dialogs.append(dialog.type), dialog.dismiss()))
    page.close(run_before_unload=True)
    page.wait_for_timeout(1000)   # keeps Playwright's event loop running (time.sleep would not)
    check(dialogs == ["beforeunload"], f"warning before closing with unsaved changes: {dialogs}")
    editor.close()


def test_select_move_resize(browser):
    editor = Editor(browser)
    editor.open(CONTRACT)
    editor.close_dialog_if_open()
    page = editor.page
    zoom = page.evaluate("App.canvas.getZoom()")
    selected = "App.selection.selectedId()"

    # Click selects; the box with 8 handles sits exactly on the element.
    page.mouse.click(*slide_to_screen(page, 300, 290))
    check(page.evaluate(selected) == "e2", "click selects the text box e2")
    check(page.locator("#overlay .selection-handle").count() == 8, "8 resize handles")
    check(page.is_visible("#overlay .selection-box"), "selection box visible")
    box = page.evaluate("App.transform.readRect(document.querySelector('#overlay .selection-box'))")
    check(box == element_rect(page, "e2"), f"box matches the element: {box}")
    check(page.evaluate("App.history.canUndo()") is False, "a plain click records no undo step")

    # Drag moves; the whole drag is one undo step.
    start = slide_to_screen(page, 300, 290)
    drag(page, start, (start[0] + 100, start[1] + 50))
    rect = element_rect(page, "e2")
    check(abs(rect["left"] - (64 + 100 / zoom)) <= 1 and abs(rect["top"] - (230 + 50 / zoom)) <= 1, f"moved: {rect}")
    check(page.evaluate("App.history.undoLabel()") == "Move", "undo label")
    check(page.is_visible("#title-dirty"), "a move makes the deck dirty")
    page.keyboard.press("Control+Z")
    check(element_rect(page, "e2") == {"left": 64, "top": 230, "width": 1100, "height": 120}, "undo puts it back")
    check(page.evaluate(selected) == "e2", "still selected after undo (the slide was rebuilt)")
    check(page.evaluate("App.history.canUndo()") is False, "the drag was a single step")

    # Shift + corner handle keeps the 3:1 logo ratio, anchored top-left.
    page.mouse.click(*slide_to_screen(page, 100, 70))
    check(page.evaluate(selected) == "e1", "click selects the logo")
    handle = slide_to_screen(page, 64 + 120, 56 + 40)
    page.keyboard.down("Shift")
    drag(page, handle, (handle[0] + 60, handle[1] + 5))
    page.keyboard.up("Shift")
    rect = element_rect(page, "e1")
    check(rect["left"] == 64 and rect["top"] == 56, f"top-left corner stays: {rect}")
    check(rect["width"] > 150 and abs(rect["width"] / rect["height"] - 3) < 0.1, f"ratio kept: {rect}")
    check(page.evaluate("App.history.undoLabel()") == "Resize", "resize undo label")
    page.screenshot(path=str(OUTPUT / "12-selection.png"))

    # Escape, a click on empty slide, and changing slides all deselect.
    page.keyboard.press("Escape")
    check(page.evaluate(selected) is None, "Escape deselects")
    page.mouse.click(*slide_to_screen(page, 300, 290))
    page.mouse.click(*slide_to_screen(page, 1250, 700))
    check(page.evaluate(selected) is None, "click on empty slide deselects")
    page.mouse.click(*slide_to_screen(page, 300, 290))
    page.keyboard.press("PageDown")
    check(page.evaluate(selected) is None and page.is_hidden("#overlay .selection-box"), "slide change deselects")

    # Nothing of the selection ends up in the saved file.
    html = page.evaluate("App.fileio.currentHtml()")
    check("selection" not in html, "no selection traces in the saved HTML")
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


def test_nudge_delete_clipboard_and_order(browser):
    editor = Editor(browser)
    editor.open(CONTRACT)
    editor.close_dialog_if_open()
    page = editor.page
    selected = "App.selection.selectedId()"
    undo_steps = """() => { let n = 0; while (App.history.canUndo()) { App.history.undo(); n++; } return n; }"""

    # Arrow keys nudge 1 px, Shift+arrow 10 px; a burst of nudges is one undo step.
    page.mouse.click(*slide_to_screen(page, 300, 290))
    for _ in range(5):
        page.keyboard.press("ArrowRight")
    page.keyboard.press("Shift+ArrowDown")
    rect = element_rect(page, "e2")
    check((rect["left"], rect["top"]) == (69, 240), f"nudged: {rect}")
    page.keyboard.press("Control+z")
    rect = element_rect(page, "e2")
    check((rect["left"], rect["top"]) == (64, 230), f"one undo reverts the whole burst: {rect}")
    check(not page.evaluate("App.history.canUndo()"), "the burst was a single step")

    # Delete removes; undo brings it back.
    page.mouse.click(*slide_to_screen(page, 300, 290))
    page.keyboard.press("Delete")
    check(page.evaluate("!App.deck.getDocument().querySelector('[data-id=\"e2\"]')"), "Delete removed e2")
    check(page.evaluate(selected) is None, "nothing selected after delete")
    page.keyboard.press("Control+z")
    check(element_rect(page, "e2")["left"] == 64, "undo restores e2")

    # Copy on slide 1, paste on slide 2: same position, fresh id, on top, selected.
    page.mouse.click(*slide_to_screen(page, 300, 290))
    page.keyboard.press("Control+c")
    page.keyboard.press("PageDown")
    page.keyboard.press("Control+v")
    new_id = page.evaluate(selected)
    check(new_id not in (None, "e2"), f"pasted element selected with a fresh id: {new_id}")
    ids = page.evaluate("Array.from(App.deck.getDocument().querySelectorAll('[data-id]'), n => n.getAttribute('data-id'))")
    check(len(ids) == len(set(ids)), "all data-id values stay unique")
    pasted = page.evaluate("""id => {
        const el = App.deck.getDocument().querySelector('[data-id="' + id + '"]');
        const slide = el.closest('section.slide');
        const zs = App.transform.topLevelElements(slide).map(App.transform.zIndexOf);
        return { slide: slide.getAttribute('data-slide-id'), text: el.textContent.trim(),
                 rect: App.transform.readRect(el), z: App.transform.zIndexOf(el), maxZ: Math.max(...zs) };
    }""", new_id)
    check(pasted["slide"] != "s1" and pasted["text"] == "Projeto Atlas", f"pasted on slide 2: {pasted}")
    check(pasted["rect"]["left"] == 64 and pasted["rect"]["top"] == 230, "keeps its position on another slide")
    check(pasted["z"] == pasted["maxZ"], "pasted on top")
    page.keyboard.press("Control+v")
    check(element_rect(page, page.evaluate(selected))["left"] == 74, "a second paste steps 10 px aside")

    # Duplicate on the same slide steps aside; cut + paste puts it back in the same spot.
    page.keyboard.press("PageUp")
    page.mouse.click(*slide_to_screen(page, 100, 70))
    page.keyboard.press("Control+d")
    dup = page.evaluate(selected)
    check(dup != "e1" and element_rect(page, dup)["left"] == 74, "duplicate 10 px down-right")
    page.keyboard.press("Control+x")
    check(page.evaluate("id => !App.deck.getDocument().querySelector('[data-id=\"' + id + '\"]')", dup), "cut removes")
    page.keyboard.press("Control+v")
    check(element_rect(page, page.evaluate(selected))["left"] == 74, "cut then paste: same spot")

    # Stacking order from the Arrange tab: the logo (z 1, at the back) to the front and back again.
    page.keyboard.press("Escape")   # no selection handles in the way, whatever the zoom
    page.mouse.click(*slide_to_screen(page, 68, 60))   # the corner the pasted copy (at 74, 66) does not cover
    check(page.evaluate(selected) == "e1", "logo selected")
    page.click(".ribbon-tab[data-tab='arrange']")
    page.click("button[data-command='bringToFront']")
    order = page.evaluate("App.transform.topLevelElements(App.deck.getCurrentSlide()).map(e => e.getAttribute('data-id'))")
    check(order[-1] == "e1", f"logo in front: {order}")
    check(page.is_disabled("button[data-command='bringForward']"), "Bring forward disabled at the top")
    page.click("button[data-command='sendToBack']")
    order = page.evaluate("App.transform.topLevelElements(App.deck.getCurrentSlide()).map(e => e.getAttribute('data-id'))")
    check(order[0] == "e1", f"logo at the back: {order}")
    page.screenshot(path=str(OUTPUT / "13-arrange.png"))

    # Working in the slide rail clears the element selection, so Delete there never removes an element.
    page.click(".thumb[data-index='0']")
    check(page.evaluate(selected) is None, "clicking a thumbnail deselects the element")
    page.keyboard.press("Delete")
    check(page.evaluate("!!App.deck.getDocument().querySelector('[data-id=\"e1\"]')"), "Delete in the rail kept e1")

    check(page.evaluate(undo_steps) >= 6, "every action was an undo step")
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


def test_format_pane_and_context_menu(browser):
    editor = Editor(browser)
    editor.open(CONTRACT)
    editor.close_dialog_if_open()
    page = editor.page
    selected = "App.selection.selectedId()"

    def fields():
        return page.evaluate("['x', 'y', 'w', 'h'].map(f => document.getElementById('format-' + f).value)")

    # Nothing selected: only the hint. Selecting fills X / Y / W / H.
    check(page.is_visible("#format-hint") and page.is_hidden("#format-size"), "hint when nothing is selected")
    page.mouse.click(*slide_to_screen(page, 300, 290))
    check(page.is_visible("#format-size"), "Size & position shown")
    check(fields() == ["64", "230", "1100", "120"], f"fields show the element: {fields()}")
    check(page.inner_text("#format-type") == "Text box", "element type shown")

    # Typing a value + Enter moves the element: one undo step, box follows.
    page.fill("#format-x", "100")
    page.press("#format-x", "Enter")
    check(element_rect(page, "e2")["left"] == 100, "X = 100 moved the element")
    check(page.evaluate("App.history.undoLabel()") == "Move", "undo label Move")
    box = page.evaluate("App.transform.readRect(document.querySelector('#overlay .selection-box'))")
    check(box["left"] == 100, "selection box follows")

    # A decimal comma works; leaving the field (Tab) applies it.
    page.fill("#format-w", "500,5")
    page.press("#format-w", "Tab")
    check(element_rect(page, "e2")["width"] == 500.5, f"W = 500,5: {element_rect(page, 'e2')}")

    # Nonsense is refused and the old value comes back; Escape throws away what was typed.
    page.fill("#format-h", "abc")
    page.press("#format-h", "Enter")
    check(page.input_value("#format-h") == "120" and element_rect(page, "e2")["height"] == 120, "invalid input reverted")
    page.fill("#format-y", "999")
    page.press("#format-y", "Escape")
    check(page.input_value("#format-y") == "230" and element_rect(page, "e2")["top"] == 230, "Escape reverts")
    check(page.evaluate(selected) == "e2", "Escape in a field does not deselect")

    # Arrow keys in a field step the value (Shift: 10); Delete in a field never deletes the element.
    page.press("#format-x", "ArrowUp")
    page.press("#format-x", "Shift+ArrowUp")
    check(element_rect(page, "e2")["left"] == 111, f"ArrowUp +1, Shift+ArrowUp +10: {element_rect(page, 'e2')}")
    page.press("#format-x", "Delete")
    check(page.evaluate("!!App.deck.getDocument().querySelector('[data-id=\"e2\"]')"), "Delete in a field kept e2")

    # Dragging updates the fields live.
    start = slide_to_screen(page, 300, 290)
    page.mouse.move(*start)
    page.mouse.down()
    page.mouse.move(start[0] + 40, start[1], steps=5)
    during = fields()[0]
    page.mouse.up()
    check(during != "111", f"X changes while dragging: {during}")
    page.evaluate("while (App.history.canUndo()) App.history.undo()")
    check(fields() == ["64", "230", "1100", "120"], f"fields follow undo: {fields()}")

    # Right-click an element: it gets selected and the menu shows the element actions.
    page.mouse.click(*slide_to_screen(page, 100, 70), button="right")
    check(page.evaluate(selected) == "e1", "right-click selects")
    check(page.is_visible(".context-menu"), "context menu open")
    labels = page.locator(".context-menu .menu-label").all_inner_texts()
    check(labels[:5] == ["Cut", "Copy", "Paste", "Duplicate", "Delete"] and "Bring to front" in labels, f"items: {labels}")
    check(page.is_disabled(".context-menu button[data-command='paste']"), "Paste disabled with an empty clipboard")
    check("Ctrl+X" in page.inner_text(".context-menu"), "shortcuts shown")
    page.screenshot(path=str(OUTPUT / "14-context-menu.png"))
    page.click(".context-menu button[data-command='bringToFront']")
    check(page.is_hidden(".context-menu"), "menu closes after a choice")
    order = page.evaluate("App.transform.topLevelElements(App.deck.getCurrentSlide()).map(e => e.getAttribute('data-id'))")
    check(order[-1] == "e1", f"Bring to front from the menu: {order}")

    # Right-click on empty slide: only Paste. Escape closes the menu but keeps nothing selected.
    page.mouse.click(*slide_to_screen(page, 1250, 700), button="right")
    labels = page.locator(".context-menu .menu-label").all_inner_texts()
    check(labels == ["Paste"], f"empty-slide menu: {labels}")
    page.keyboard.press("Escape")
    check(page.is_hidden(".context-menu"), "Escape closes the menu")

    # Keyboard: Shift+F10 opens the menu for the selection; arrows + Enter choose.
    page.mouse.click(*slide_to_screen(page, 300, 290))
    page.keyboard.press("Shift+F10")
    check(page.is_visible(".context-menu"), "Shift+F10 opens the menu")
    page.keyboard.press("ArrowDown")
    page.keyboard.press("Enter")
    check(page.is_hidden(".context-menu") and page.evaluate("App.elements.canPaste()"), "ArrowDown + Enter ran Copy")
    page.mouse.click(*slide_to_screen(page, 300, 290), button="right")
    page.mouse.click(10, 10)
    check(page.is_hidden(".context-menu"), "a click elsewhere closes the menu")

    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


def test_zoom(browser):
    editor = Editor(browser)
    editor.open(CONTRACT)
    editor.close_dialog_if_open()
    page = editor.page
    zoom = lambda: page.evaluate("App.canvas.getZoom()")  # noqa: E731 - tiny local helper
    fit = zoom()
    check(page.evaluate("App.canvas.isFit()"), "starts in fit mode")
    check(page.inner_text("#zoom-percent") == f"{round(fit * 100)}%", "percent shown")

    def slide_point_under(x, y):
        return page.evaluate("""([x, y]) => {
            const r = document.getElementById('overlay').getBoundingClientRect();
            const z = App.canvas.getZoom();
            return [(x - r.left) / z, (y - r.top) / z];
        }""", [x, y])

    def ctrl_wheel(notches):
        page.keyboard.down("Control")
        for _ in range(abs(notches)):
            page.mouse.wheel(0, -100 if notches > 0 else 100)
        page.keyboard.up("Control")

    # Ctrl+wheel zooms in and leaves fit mode.
    page.mouse.move(*slide_to_screen(page, 640, 360))
    ctrl_wheel(2)
    check(zoom() > fit * 1.15, f"zoomed in: {fit} -> {zoom()}")
    check(not page.evaluate("App.canvas.isFit()"), "manual zoom after the wheel")

    # Once the slide is larger than the window, Ctrl+wheel zooms around the mouse:
    # the slide point under it stays put. (While the slide still fits in one
    # direction, it stays centred in that direction, as in PowerPoint.)
    page.evaluate("App.canvas.setZoom(1.5)")
    mouse = slide_to_screen(page, 700, 400)
    page.mouse.move(*mouse)
    before = slide_point_under(*mouse)
    ctrl_wheel(3)
    check(zoom() == 2, f"three notches from 150%: {zoom()}")
    after = slide_point_under(*mouse)
    check(abs(after[0] - before[0]) < 3 and abs(after[1] - before[1]) < 3, f"anchored: {before} -> {after}")
    check(page.evaluate("document.getElementById('canvas-area').scrollWidth > document.getElementById('canvas-area').clientWidth"),
          "the zoomed slide scrolls")

    # A plain wheel scrolls instead of zooming.
    z = zoom()
    page.mouse.wheel(0, 100)
    check(zoom() == z, "wheel without Ctrl does not zoom")

    # The slider sets an exact zoom; selection and handles work at any zoom.
    page.evaluate("""() => { const s = document.getElementById('zoom-slider'); s.value = '200';
        s.dispatchEvent(new Event('input', { bubbles: true })); }""")
    check(zoom() == 2 and page.inner_text("#zoom-percent") == "200%", f"slider 200%: {zoom()}")
    page.evaluate("App.canvas.scrollIntoView({ left: 64, top: 230, width: 1100, height: 120 })")
    page.mouse.click(*slide_to_screen(page, 614, 290))   # the centre of e2, now in the middle of the view
    check(page.evaluate("App.selection.selectedId()") == "e2", "click selects at 200%")
    size = page.evaluate("document.querySelector('.selection-handle').getBoundingClientRect().width")
    check(8 <= size <= 10, f"handles keep their size on screen: {size}")
    page.screenshot(path=str(OUTPUT / "15-zoom-200.png"))

    # Limits and buttons: never above 400% or below 50%; Fit goes back to fit mode.
    for _ in range(30):
        page.click("#zoom-in")
    check(zoom() == 4, f"max 400%: {zoom()}")
    for _ in range(40):
        page.click("#zoom-out")
    check(zoom() == 0.5, f"min 50%: {zoom()}")
    page.click("#zoom-fit")
    check(page.evaluate("App.canvas.isFit()") and abs(zoom() - fit) < 0.01, "Fit restores the fitted zoom")

    # Fit mode follows the window size; manual zoom does not.
    page.set_viewport_size({"width": 1100, "height": 700})
    wait_until(page, f"App.canvas.getZoom() < {fit}")
    page.evaluate("App.canvas.setZoom(1.5)")
    page.set_viewport_size({"width": 1440, "height": 900})
    page.wait_for_timeout(200)
    check(zoom() == 1.5, "manual zoom survives a window resize")
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


FAKE_FILE_JS = """name => {
    // A stand-in for a FileSystemFileHandle (Playwright cannot use real file pickers).
    // window.__disk is "the file on disk": its text, its date and how often it was written.
    window.__disk = { text: null, lastModified: 1000, writes: 0 };
    App.state.fileHandle = {
        kind: 'file', name: name,
        queryPermission: async () => 'granted',
        requestPermission: async () => 'granted',
        createWritable: async () => {
            let data = '';
            return {
                write: async (text) => { data = text; },
                close: async () => { __disk.text = data; __disk.writes += 1; __disk.lastModified += 1000; },
                abort: async () => {},
            };
        },
        getFile: async () => ({ name: name, lastModified: __disk.lastModified, text: async () => __disk.text }),
    };
    App.state.diskLastModified = __disk.lastModified;
}"""


def test_autosave_to_file(browser):
    editor = Editor(browser)
    editor.open(CONTRACT)
    editor.close_dialog_if_open()
    page = editor.page
    page.evaluate(FAKE_FILE_JS, CONTRACT.name)
    page.evaluate("App.autosave.setTiming(400, 2000)")   # instead of 5 s / 30 s
    writes = lambda: page.evaluate("__disk.writes")  # noqa: E731
    # e2's left position in the file on disk, read the way a browser reads the saved file.
    disk_left = lambda: page.evaluate("""() => new DOMParser().parseFromString(__disk.text, 'text/html')
        .querySelector('[data-id="e2"]').style.left""")  # noqa: E731
    switch = "#autosave-toggle"

    # Off until the first manual save; the first save switches it on.
    check(page.is_visible(switch) and page.get_attribute(switch, "aria-checked") == "false", "AutoSave Off at first")
    check(page.is_visible("#save-banner"), "the banner asks for a first save")
    check("Save As" in page.inner_text("#save-banner"), "the banner offers Save As for an opened file")
    page.mouse.click(*slide_to_screen(page, 300, 290))
    page.keyboard.press("ArrowRight")
    page.wait_for_timeout(800)
    check(writes() == 0, "nothing is written before the first manual save")
    page.keyboard.press("Control+s")
    wait_until(page, "__disk.writes === 1")
    check(page.get_attribute(switch, "aria-checked") == "true", "AutoSave On after the first save")
    check(page.is_hidden("#save-banner"), "the banner goes away once AutoSave is on")
    page.screenshot(path=str(OUTPUT / "16-autosave-on.png"), clip={"x": 0, "y": 0, "width": 1440, "height": 40})

    # A change is written shortly after, and the unsaved dot goes away.
    page.keyboard.press("ArrowRight")
    wait_until(page, "__disk.writes === 2")
    check(disk_left() == "66px", "the nudge reached the file")
    check(page.is_hidden("#title-dirty"), "no unsaved dot after AutoSave")

    # Never in the middle of a drag: the write waits for the mouse button to come up.
    start = slide_to_screen(page, 300, 290)
    page.mouse.move(*start)
    page.mouse.down()
    page.mouse.move(start[0] + 30, start[1], steps=4)
    page.wait_for_timeout(1000)
    check(writes() == 2, "no write during the drag")
    page.mouse.up()
    wait_until(page, "__disk.writes === 3")

    # Revert to the version opened (File menu): one undo step, and AutoSave writes it.
    page.click(".ribbon-file-button")
    page.click(".file-menu button[data-command='revertToOpened']")
    editor.click_dialog_button("Revert")
    check(element_rect(page, "e2")["left"] == 64, "reverted to the opened position")
    wait_until(page, "__disk.writes === 4")
    check(disk_left() == "64px", "the reverted deck was written")
    page.keyboard.press("Control+z")
    check(element_rect(page, "e2")["left"] != 64, "Ctrl+Z undoes the revert")
    wait_until(page, "__disk.writes === 5")

    # Someone changes the file elsewhere: AutoSave asks before writing. Overwrite writes anyway.
    page.evaluate("__disk.lastModified += 5000")
    page.mouse.click(*slide_to_screen(page, 614, 290))
    page.keyboard.press("ArrowDown")
    page.wait_for_selector("dialog[open]")
    check("changed on disk" in editor.report_dialog_text(), "conflict dialog")
    check(writes() == 5, "nothing written before the answer")
    editor.click_dialog_button("Overwrite")
    wait_until(page, "__disk.writes === 6")

    # ... Reload instead: the editor shows the file as it is on disk now.
    page.evaluate("__disk.text = __disk.text.replaceAll('Projeto Atlas', 'Projeto Externo'); __disk.lastModified += 5000")
    page.keyboard.press("ArrowDown")
    page.wait_for_selector("dialog[open]")
    editor.click_dialog_button("Reload")
    wait_until(page, "App.deck.getDocument().body.textContent.includes('Projeto Externo')")
    editor.close_dialog_if_open()
    check(page.get_attribute(switch, "aria-checked") == "false", "a reloaded deck starts with AutoSave off")

    # Switched off by the user: nothing is written. Switched on: unsaved changes are written at once.
    page.keyboard.press("Control+s")
    wait_until(page, "document.getElementById('autosave-toggle').getAttribute('aria-checked') === 'true'")
    page.click(switch)
    check(page.get_attribute(switch, "aria-checked") == "false", "switched off")
    count = writes()
    page.mouse.click(*slide_to_screen(page, 614, 290))
    page.keyboard.press("ArrowLeft")
    page.wait_for_timeout(1000)
    check(writes() == count, "no AutoSave while off")
    page.click(switch)
    wait_until(page, f"__disk.writes === {count + 1}")

    # Closing the tab starts the write at once instead of waiting for the timer.
    page.evaluate("App.autosave.setTiming(60000, 60000)")
    page.mouse.click(*slide_to_screen(page, 614, 290))
    page.keyboard.press("ArrowLeft")
    page.wait_for_timeout(300)
    check(writes() == count + 1, "long timer: not written yet")
    page.evaluate("window.dispatchEvent(new Event('beforeunload'))")
    wait_until(page, f"__disk.writes === {count + 2}")

    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


def launch_profile(profile):
    """A browser with a real profile folder, so IndexedDB survives a restart (like Edge after a crash)."""
    return PLAYWRIGHT.chromium.launch_persistent_context(
        str(profile), viewport={"width": 1440, "height": 900}, accept_downloads=True)


DRAFTS_JS = "App.storage.listDrafts()"


def test_crash_recovery_drafts(browser):
    profile = OUTPUT / "profile-drafts"
    shutil.rmtree(profile, ignore_errors=True)

    # 1. Edit without saving; a draft is stored shortly after (30 s in real use).
    editor = Editor(browser, launch_profile(profile))
    page = editor.page
    wait_until(page, "App.drafts.ready.then(() => App.drafts.isAvailable())")
    page.evaluate("App.drafts.setInterval(300)")
    editor.open(CONTRACT)
    editor.close_dialog_if_open()
    check(page.evaluate("App.deck.getDeckId()"), "the deck got an id as soon as it opened")
    check(page.is_hidden("#title-dirty"), "giving the deck an id is not a change")
    page.mouse.click(*slide_to_screen(page, 300, 290))
    for _ in range(10):
        page.keyboard.press("ArrowRight")
    moved_left = element_rect(page, "e2")["left"]
    wait_until(page, f"{DRAFTS_JS}.then(d => d.length === 1)")
    status = page.inner_text("#status-save")
    check(re.fullmatch(r"Unsaved changes · Draft saved \d\d:\d\d", status), f"status shows the draft time: {status}")

    # Undo back to the saved state: nothing left to protect, the draft goes.
    for _ in range(10):
        page.keyboard.press("Control+z")
    wait_until(page, f"{DRAFTS_JS}.then(d => d.length === 0)")
    for _ in range(10):
        page.keyboard.press("Control+y")
    wait_until(page, f"{DRAFTS_JS}.then(d => d.length === 1)")

    # 2. "Crash": the browser goes away with unsaved changes (no save, no clean close).
    editor.close()

    # 3. Restart: the editor offers the changes at once.
    editor = Editor(browser, launch_profile(profile))
    page = editor.page
    page.wait_for_selector("dialog[open]")
    text = editor.report_dialog_text()
    check("Unsaved changes to \"contract-deck.html\"" in text, f"recovery dialog: {text}")
    wait_until(page, "document.querySelector('dialog[open] .miniature[data-drawn]')")
    page.screenshot(path=str(OUTPUT / "17-recovery-dialog.png"))
    editor.click_dialog_button("Decide later")
    check(len(page.evaluate(DRAFTS_JS)) == 1, "deciding later keeps the draft")

    # 4. Opening the file offers the newer draft; Compare lists only the changed slide.
    page.evaluate("App.drafts.setInterval(300)")
    editor.open(CONTRACT)
    page.wait_for_selector("dialog[open]")
    if page.query_selector("dialog[open] .report"):
        editor.click_dialog_button("OK")   # the import report comes first
    page.wait_for_selector("dialog[open] .recovery")
    editor.click_dialog_button("Compare")
    page.wait_for_selector("dialog[open] .compare")
    rows = page.eval_on_selector_all("dialog[open] .compare-row", "rows => rows.map(r => r.dataset.status)")
    check(rows == ["changed"], f"one changed slide, got {rows}")
    wait_until(page, "document.querySelectorAll('dialog[open] .miniature[data-drawn]').length === 2")
    page.screenshot(path=str(OUTPUT / "18-compare-dialog.png"))
    editor.click_dialog_button("Recover")
    check(element_rect(page, "e2")["left"] == moved_left, "the recovered deck has the edit")
    check(page.is_visible("#title-dirty"), "recovered changes are unsaved")
    page.keyboard.press("Control+z")
    check(element_rect(page, "e2")["left"] == 64, "Ctrl+Z undoes the recovery")
    page.keyboard.press("Control+y")
    # The old draft is replaced by a fresh one from this tab.
    wait_until(page, f"{DRAFTS_JS}.then(d => d.length >= 1)")

    # 5. Saving deletes the drafts.
    editor.save_as_download("recovered-deck.html")
    wait_until(page, f"{DRAFTS_JS}.then(d => d.length === 0)")
    saved = (OUTPUT / "recovered-deck.html").read_text(encoding="utf-8")
    check('<meta name="deck-id"' in saved, "the deck id is written into the file")

    # 6. Another unsaved edit, then restart: Recover straight from the start-up question.
    page.mouse.click(*slide_to_screen(page, 300, 290))
    page.keyboard.press("ArrowDown")
    wait_until(page, f"{DRAFTS_JS}.then(d => d.length === 1)")
    top = element_rect(page, "e2")["top"]
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()

    editor = Editor(browser, launch_profile(profile))
    page = editor.page
    page.wait_for_selector("dialog[open] .recovery")
    editor.click_dialog_button("Recover")
    wait_until(page, "App.state.hasDeck")
    check(element_rect(page, "e2")["top"] == top, "recovered at start-up")
    check(page.is_visible("#title-dirty"), "a recovered deck is unsaved")
    check(page.evaluate("App.state.fileName") == CONTRACT.name, "keeps the file name for Save As")
    wait_until(page, f"{DRAFTS_JS}.then(d => d.length === 1)")   # a fresh draft replaces the old one

    # 7. Discard: the drafts are deleted.
    editor.close()
    editor = Editor(browser, launch_profile(profile))
    page = editor.page
    page.wait_for_selector("dialog[open] .recovery")
    editor.click_dialog_button("Discard")
    wait_until(page, f"{DRAFTS_JS}.then(d => d.length === 0)")
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()
    shutil.rmtree(profile, ignore_errors=True)


def test_recovery_unavailable_when_storage_is_blocked(browser):
    context = browser.new_context(viewport={"width": 1440, "height": 900})
    # Like a company policy that blocks storage for pages opened from disk.
    context.add_init_script("""Object.defineProperty(window, 'indexedDB', {
        get() { throw new DOMException('blocked', 'SecurityError'); } });""")
    editor = Editor(browser, context)
    page = editor.page
    wait_until(page, "document.getElementById('status-save').textContent === 'Recovery unavailable'")
    editor.open(CONTRACT)
    editor.close_dialog_if_open()
    page.mouse.click(*slide_to_screen(page, 300, 290))
    page.keyboard.press("ArrowRight")
    check(element_rect(page, "e2")["left"] == 65, "editing still works")
    check(page.inner_text("#status-save") == "Unsaved changes · Recovery unavailable", "status bar")
    page.click(".ribbon-file-button")
    page.click(".file-menu button[data-command='settings']")
    check(page.is_disabled("#settings-keep-drafts") and page.is_disabled("#settings-delete-all"), "settings disabled")
    check("Recovery is unavailable" in editor.report_dialog_text(), "the dialog says why")
    editor.click_dialog_button("Cancel")
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


COUNT_DB_JS = """async () => {
    // Every record in every store of the editor's IndexedDB, as DevTools > Application would show them.
    const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('deck-editor');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    const counts = {};
    for (const name of Array.from(db.objectStoreNames)) {
        counts[name] = await new Promise((resolve) => {
            const request = db.transaction(name).objectStore(name).count();
            request.onsuccess = () => resolve(request.result);
        });
    }
    db.close();
    return counts;
}"""

# A remembered file handle (plain, so IndexedDB can store it) and an Open window that
# records where it was asked to start, then "picks" the contract deck.
FAKE_PICKER_JS = """text => {
    window.__picker = { calls: [] };
    window.showOpenFilePicker = async (options) => {
        __picker.calls.push(options.startIn ? options.startIn.name : null);
        return [{ kind: 'file', name: 'contract-deck.html',
                  getFile: async () => new File([text], 'contract-deck.html', { lastModified: 1000 }) }];
    };
}"""


def test_settings_recent_files_and_status(browser):
    editor = Editor(browser)
    page = editor.page
    wait_until(page, "App.drafts.ready.then(() => App.drafts.isAvailable())")
    page.evaluate("App.drafts.setInterval(300)")
    status = lambda: page.inner_text("#status-save")  # noqa: E731

    # Status bar: Saved after opening, Unsaved changes after an edit, then the draft time.
    editor.open(CONTRACT)
    editor.close_dialog_if_open()
    check(status() == "Saved", f"opened: {status()}")
    page.mouse.click(*slide_to_screen(page, 300, 290))
    page.keyboard.press("ArrowRight")
    check(status() == "Unsaved changes", f"after an edit: {status()}")
    wait_until(page, "document.getElementById('status-save').textContent.includes('Draft saved')")

    # Settings: the defaults (SPEC 6.3), and the honest note.
    page.click(".ribbon-file-button")
    page.click(".file-menu button[data-command='settings']")
    check(page.is_checked("#settings-keep-drafts"), "drafts on by default")
    check(page.input_value("#settings-retention") == "1", "1 day by default")
    check(not page.is_checked("#settings-recent"), "recent files off by default")
    check("can read them" in editor.report_dialog_text(), "the note about other HTML files")
    page.screenshot(path=str(OUTPUT / "19-settings.png"))
    # Turning drafts off also turns recent files off and disables it.
    page.check("#settings-recent")
    page.uncheck("#settings-keep-drafts")
    check(not page.is_checked("#settings-recent") and page.is_disabled("#settings-recent"), "no drafts, no recent")
    page.check("#settings-keep-drafts")
    page.check("#settings-recent")
    page.fill("#settings-retention", "45")
    editor.click_dialog_button("OK")
    saved = page.evaluate("JSON.parse(localStorage.getItem('deck-editor-settings'))")
    check(saved == {"keepDrafts": True, "retentionDays": 30, "rememberRecent": True}, f"saved settings: {saved}")

    # Recent files: an opened file is remembered; choosing it opens the Open window in its folder.
    page.evaluate("""() => App.events.emit('file-opened',
        { fileName: 'contract-deck.html', lastModified: 0, handle: { kind: 'file', name: 'contract-deck.html' } })""")
    wait_until(page, "App.recent.hasEntries()")
    page.evaluate(FAKE_PICKER_JS, CONTRACT.read_text(encoding="utf-8"))
    page.keyboard.press("Control+z")   # back to the saved state, so opening asks nothing
    page.click(".ribbon-file-button")
    page.click(".file-menu button[data-command='openRecent']")
    check("contract-deck.html" in editor.report_dialog_text(), "the recent list")
    page.click("dialog[open] .recent-item")
    wait_until(page, "__picker.calls.length === 1")
    check(page.evaluate("__picker.calls[0]") == "contract-deck.html", "the Open window starts at the remembered file")
    wait_until(page, "document.getElementById('status-message').textContent === 'Opened contract-deck.html'")
    editor.close_dialog_if_open()

    # Delete all drafts now: nothing left in IndexedDB (drafts, their HTML, recent files).
    page.mouse.click(*slide_to_screen(page, 300, 290))
    page.keyboard.press("ArrowRight")
    wait_until(page, "App.storage.listDrafts().then(d => d.length === 1)")
    page.click(".ribbon-file-button")
    page.click(".file-menu button[data-command='settings']")
    page.click("#settings-delete-all")
    wait_until(page, "document.querySelector('.settings-result').textContent.startsWith('All drafts')")
    counts = page.evaluate(COUNT_DB_JS)
    check(counts == {"draftHtml": 0, "drafts": 0, "recent": 0}, f"IndexedDB empty: {counts}")
    check("Draft saved" not in status(), "no draft time after deleting")

    # Drafts off: no draft is written any more.
    page.uncheck("#settings-keep-drafts")
    editor.click_dialog_button("OK")
    page.keyboard.press("ArrowRight")
    page.wait_for_timeout(1000)
    check(page.evaluate(COUNT_DB_JS) == {"draftHtml": 0, "drafts": 0, "recent": 0}, "nothing stored with drafts off")
    check(status() == "Unsaved changes", f"no draft time: {status()}")

    # AutoSave off after it was on: the status says so.
    page.evaluate(FAKE_FILE_JS, CONTRACT.name)
    page.keyboard.press("Control+s")
    wait_until(page, "document.getElementById('status-save').textContent === 'Saved'")
    page.click("#autosave-toggle")
    page.keyboard.press("ArrowRight")
    check(status() == "AutoSave off", f"AutoSave switched off: {status()}")
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


def test_drag_and_drop_opens_a_deck(browser):
    editor = Editor(browser)
    text = CONTRACT.read_text(encoding="utf-8")
    editor.page.evaluate("""(text) => {
        const transfer = new DataTransfer();
        transfer.items.add(new File([text], 'dropped.html', { type: 'text/html' }));
        window.dispatchEvent(new DragEvent('dragover', { dataTransfer: transfer, cancelable: true }));
        window.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, cancelable: true }));
    }""", text)
    wait_until(editor.page, "document.getElementById('status-message').textContent === 'Opened dropped.html'")
    check(editor.slide_count() == 6, "dropped deck opened")
    check(editor.page.is_hidden("#drop-zone"), "drop zone hidden again")
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


def test_heavy_deck_stays_responsive(browser):
    if not HEAVY.exists():
        print("    (skipped: run python samples/make_heavy_deck.py first)")
        return
    editor = Editor(browser)
    started = time.time()
    editor.open(HEAVY, timeout=120000)
    seconds = time.time() - started
    # The generated deck is format 1 on purpose: opening it also converts the text of 50 slides.
    check("converted to the editor's text format" in (editor.report_dialog_text() or ""), "text conversion reported")
    editor.close_dialog_if_open()
    check(editor.slide_count() == 50, "50 slides")
    drawn = editor.page.evaluate("document.querySelectorAll('.thumb[data-drawn]').length")
    check(drawn < 50, f"thumbnails are drawn lazily (drawn {drawn} of 50)")
    started = time.time()
    editor.page.keyboard.press("End")
    wait_until(editor.page, "document.getElementById('status-slide').textContent.startsWith('Slide 50')")
    switch_ms = (time.time() - started) * 1000
    print(f"    heavy deck: opened in {seconds:.1f} s, {drawn} thumbnails drawn at first, jump to last slide {switch_ms:.0f} ms")
    check(seconds < 30, "opens in under 30 s")
    check(switch_ms < 1000, "slide switch under 1 s")
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


def rendered_text(page, selector):
    """
    The text Chromium actually laid out inside `selector`, including CSS-generated
    bullets and counter numbers (which no DOM API exposes), via a DevTools snapshot.
    """
    page.evaluate("s => document.querySelector(s).setAttribute('data-snapshot-root', '')", selector)
    cdp = page.context.new_cdp_session(page)
    snap = cdp.send("DOMSnapshot.captureSnapshot", {"computedStyles": []})
    strings, doc = snap["strings"], snap["documents"][0]
    nodes, layout = doc["nodes"], doc["layout"]
    parents = nodes["parentIndex"]
    # Index of the root element, then every layout piece whose node sits under it.
    root = next(i for i, attrs in enumerate(nodes["attributes"])
                if any(strings[a] == "data-snapshot-root" for a in attrs[0::2]))

    def under_root(index):
        while index != -1:
            if index == root:
                return True
            index = parents[index]
        return False

    pieces = [strings[t] for n, t in zip(layout["nodeIndex"], layout["text"]) if t >= 0 and under_root(n)]
    return "".join(pieces)


def test_text_lists_render_bullets_and_numbers(browser):
    editor = Editor(browser)
    page = editor.page
    css = page.evaluate("App.text.deckTextCss()")
    # Normalized by the real normalizer, so data-start becomes its counter-set.
    paragraphs = page.evaluate("""() => {
        const box = document.createElement('div');
        box.innerHTML =
            '<p data-list="number" data-level="1">Um</p><p data-list="number" data-level="1">Dois</p>' +
            '<p data-list="number" data-level="2">sub a</p><p data-list="number" data-level="2">sub b</p>' +
            '<p data-list="number" data-level="1">Três, uma linha longa o bastante para quebrar e mostrar que a ' +
            'segunda linha alinha com o texto e não com o número</p>' +
            '<p data-list="bullet" data-level="1">Marcador</p><p data-list="number" data-level="1">De novo um</p>' +
            '<p data-list="number" data-level="1" data-start="7">Sete</p>' +
            '<p data-list="bullet" data-level="2">Nível dois</p><p data-list="number" data-level="3">romano</p>' +
            '<p data-list="none" data-level="2">Texto simples no nível dois</p>' +
            '<p data-list="bullet" data-level="1"><span style="font-size: 28pt; color: rgb(204, 9, 47)">Grande</span> e normal</p>';
        App.text.normalize(box);
        return box.innerHTML;
    }""")
    page.set_content('<!DOCTYPE html><html><head><style data-deck-text>' + css + '</style></head><body>' +
                     '<div class="el" data-type="text" style="position:relative; width:700px; font: 18pt Calibri, Arial, sans-serif">' +
                     paragraphs + '</div></body></html>')
    text = rendered_text(page, ".el")
    for expected in ["1.Um", "2.Dois", "a.sub a", "b.sub b", "3.Três", "•Marcador", "1.De novo um", "7.Sete",
                     "–Nível dois", "i.romano", "•Grande"]:
        check(expected in text, f"rendered {expected!r} in {text!r}")
    check("Texto simples" in text and "·Texto" not in text, "a plain line has no bullet")
    page.screenshot(path=str(OUTPUT / "30-text-lists.png"), clip={"x": 0, "y": 0, "width": 760, "height": 520})
    editor.close()


TESTS = [
    test_editor_starts_offline_with_csp,
    test_browser_banner_only_outside_chromium,
    test_new_blank_deck,
    test_contract_deck_round_trip_is_exact,
    test_format1_deck_text_is_converted,
    test_saved_deck_presents_on_its_own,
    test_messy_copilot_deck,
    test_appendix_a_deck_gets_charts_and_fixes,
    test_1920_deck_is_scaled,
    test_shortcuts_dirty_dot_and_close_warning,
    test_drag_and_drop_opens_a_deck,
    test_heavy_deck_stays_responsive,
    test_select_move_resize,
    test_nudge_delete_clipboard_and_order,
    test_format_pane_and_context_menu,
    test_zoom,
    test_autosave_to_file,
    test_crash_recovery_drafts,
    test_recovery_unavailable_when_storage_is_blocked,
    test_settings_recent_files_and_status,
    test_text_lists_render_bullets_and_numbers,
    test_text_editing,
    test_bullet_keys,
    test_list_buttons,
    test_character_formatting,
    test_font_and_size,
    test_text_colors,
    test_paragraph_formatting,
    test_clipboard_capture_page,
    test_paste_into_text,
    test_copy_and_cut_text,
    test_paste_options_button,
    test_double_click_empty_slide_adds_text_box,
    test_format_painter,
]


def main():
    if not EDITOR.exists():
        print("dist/editor.html is missing: run python build.py first")
        return 1
    OUTPUT.mkdir(exist_ok=True)
    failed = 0
    global PLAYWRIGHT
    with sync_playwright() as p:
        PLAYWRIGHT = p
        browser = p.chromium.launch()
        for test in TESTS:
            try:
                test(browser)
                print(f"  PASS {test.__name__}")
            except Exception as error:  # noqa: BLE001 - report every kind of failure
                failed += 1
                print(f"  FAIL {test.__name__}: {error}")
                if not isinstance(error, AssertionError):
                    traceback.print_exc()
        browser.close()
    print(f"  {len(TESTS) - failed} passed, {failed} failed  (screenshots in tests/output/)")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
