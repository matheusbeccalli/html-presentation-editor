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

import base64
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
    check("1 table was converted to the editor's table format" in report, "and the table")
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
    check('<meta name="deck-format" content="3">' in saved.read_text(encoding="utf-8"), "saved as format 3")
    cells = page.evaluate("""() => Array.from(App.deck.getDocument().querySelectorAll('[data-id="e9"] td'))
        .map((cell) => App.text.getModel(cell).map((line) => line.text).join('/'))""")
    check(len(cells) == 24 and cells[:4] == ["Empresa", "EV (R$ mn)", "EV/EBITDA 2025E", "Margem EBITDA"],
          f"the comps table is in the table model, its text in the text model: {cells[:5]}")

    # Reopened, it is a format-3 deck: nothing to convert, and saving again changes nothing.
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
    # A new paragraph also ends a typing step: Enter, then type at once; Ctrl+Z takes only the new line's text.
    page.keyboard.press("Enter")
    page.keyboard.type("xyz")
    page.keyboard.press("Control+z")
    check(page.evaluate(TEXT_OF, "e7")[-2:] == [before[3] + " abc!", ""], f"only 'xyz' undone: {page.evaluate(TEXT_OF, 'e7')}")
    page.keyboard.press("Control+z")
    check(page.evaluate(TEXT_OF, "e7")[-1] == before[3] + " abc!", "then the new paragraph, its own step")

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
    check(fixture["keptDigits"] is False, "digits faked by default")

    # Tables: "Keep digits" leaves the numbers of a fake sheet, letters are still faked.
    page.check("#keep-digits")
    check("Aaaaaaa Aaa Aaaaa 2025" in page.inner_text("#formats"), "the preview keeps the digits")
    with page.expect_download() as download_info:
        page.click("#save")
    content = Path(download_info.value.path()).read_text(encoding="utf-8")
    fixture = json.loads(content[content.index("CLIPBOARD_FIXTURES.push(") + len("CLIPBOARD_FIXTURES.push("):content.rindex(")")])
    check(fixture["types"]["text/plain"] == "Aaaaaaa Aaa Aaaaa 2025", f"digits kept: {fixture['types']['text/plain']}")
    check(fixture["keptDigits"] is True, "the fixture says its digits are kept")
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


def put_text_on_clipboard(page, text):
    """Only plain text on the system clipboard, as a text editor copies (tab-separated cells, say)."""
    page.evaluate("text => navigator.clipboard.writeText(text)", text)


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


def test_autofit(browser):
    """Format pane > Text box > Autofit: off / shrink text on overflow / resize shape to fit text."""
    editor = Editor(browser)
    editor.open(CONTRACT)
    page = editor.page
    page.evaluate("App.deck.goTo(1)")
    page.evaluate("App.selection.select(App.deck.getDocument().querySelector('[data-id=\"e7\"]'))")
    box = """() => { const el = App.deck.getDocument().querySelector('[data-id="e7"]');
        return { mode: el.getAttribute('data-autofit'), scale: el.style.getPropertyValue('--autofit-scale'),
                 height: el.style.height, fits: el.scrollHeight <= el.clientHeight + 1 }; }"""
    radio = lambda mode: page.locator(f'#format-autofit input[value="{mode}"]')  # noqa: E731
    check(radio("off").is_checked(), "an imported box: Do not autofit")

    page.keyboard.press("Enter")   # edit, cursor at the end
    for i in range(14):   # the box is 480 px tall: 14 more lines overflow it
        page.keyboard.press("Enter")
        page.keyboard.type(f"Mais uma linha {i}")
    page.keyboard.press("Escape")
    check(not page.evaluate(box)["fits"], "the text now overflows the box (autofit off)")

    radio("shrink").check()
    shrunk = page.evaluate(box)
    check(shrunk["mode"] == "shrink" and 0 < float(shrunk["scale"]) < 1 and shrunk["fits"], f"shrunk to fit: {shrunk}")
    hint = page.inner_text("#format-autofit-hint")
    check(hint == f"Text shrunk to {round(float(shrunk['scale']) * 100)}%", f"the pane says how much: {hint!r}")

    page.keyboard.press("Enter")   # type more: it shrinks further, live
    page.keyboard.press("Enter")
    page.keyboard.type("Ainda mais")
    page.keyboard.press("Escape")
    smaller = page.evaluate(box)
    check(float(smaller["scale"]) < float(shrunk["scale"]) and smaller["fits"], f"typing shrinks it further: {smaller}")

    height = page.locator("#format-h")
    height.fill("560")
    height.press("Enter")
    taller = page.evaluate(box)
    check(float(taller["scale"] or 1) > float(smaller["scale"]) and taller["fits"], f"a taller box: bigger text: {taller}")

    radio("resize").check()
    resized = page.evaluate(box)
    check(resized["mode"] == "resize" and resized["scale"] == "" and resized["fits"] and float(resized["height"][:-2]) > 560,
          f"resize: the box grows instead: {resized}")
    check(page.inner_text("#format-autofit-hint") == "", "no shrink hint")

    for _ in range(8):
        if page.evaluate(box)["mode"] is None and page.evaluate(box)["fits"] is False:
            break
        page.keyboard.press("Control+z")
    check(page.evaluate(box)["mode"] is None, f"undone, step by step: {page.evaluate(box)}")
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


FIND_STATE = """() => {
    const doc = App.deck.getDocument();
    const highlights = doc.defaultView.CSS.highlights;
    const size = (name) => (highlights.get(name) ? highlights.get(name).size : 0);
    const editing = App.text.editingElement();
    return { open: !document.getElementById('find-panel').hidden, slide: App.deck.getCurrentIndex(),
             editing: editing ? editing.getAttribute('data-id') : null, selected: doc.getSelection().toString(),
             highlighted: size('editor-find') + size('editor-find-current'), current: size('editor-find-current'),
             status: document.getElementById('find-status').textContent,
             focus: document.activeElement ? document.activeElement.id : null };
}"""

COUNT_IN_DECK = """(word) => Array.from(App.deck.getDocument().querySelectorAll('.el[data-type="text"], .el[data-type="table"]'))
    .reduce((sum, el) => sum + (el.textContent.match(new RegExp(word, 'gi')) || []).length, 0)"""


def common_colour(page, rect):
    """The commonest colour [r, g, b] in that part of the window (screen px), counted from a real screenshot."""
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
            for (let i = 0; i < data.length; i += 4) {
                const key = data[i] + ',' + data[i + 1] + ',' + data[i + 2];
                counts[key] = (counts[key] || 0) + 1;
            }
            resolve(Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0].split(',').map(Number));
        };
        image.src = 'data:image/png;base64,' + png;
    })""", png)


# Where the deck's selected text shows on screen (window px): { left, top, right, bottom }.
SELECTION_ON_SCREEN = """() => {
    const frame = document.getElementById('deck-frame');
    const box = frame.getBoundingClientRect();
    const zoom = box.width / frame.offsetWidth;
    const r = App.deck.getDocument().getSelection().getRangeAt(0).getBoundingClientRect();
    return { left: box.left + r.left * zoom + 1, top: box.top + r.top * zoom + 1,
             right: box.left + r.right * zoom - 1, bottom: box.top + r.bottom * zoom - 1 };
}"""


def test_find_and_replace(browser):
    """Home > Editing: Find (Ctrl+F) and Replace (Ctrl+H) across all slides, every match highlighted."""
    editor = Editor(browser)
    editor.open(CONTRACT)
    page = editor.page
    state = lambda: page.evaluate(FIND_STATE)  # noqa: E731
    check(page.locator('#ribbon-panel [data-command="find"]').is_visible() and
          page.locator('#ribbon-panel [data-command="replace"]').is_visible(), "Home > Editing has Find and Replace")

    page.keyboard.press("Control+f")
    found = state()
    check(found["open"] and found["focus"] == "find-text" and not page.locator("#find-replacement").is_visible(),
          f"Ctrl+F opens Find with the cursor in it: {found}")
    page.keyboard.type("margem")
    total = page.evaluate(COUNT_IN_DECK, "margem")
    check(total >= 3, f"the sample deck has 'margem' on several slides: {total}")
    wait_until(page, f"() => ({FIND_STATE})().highlighted === {total}")
    check(state()["status"] == f"{total} matches", f"the count: {state()}")

    page.keyboard.press("Enter")
    found = state()
    check(found["slide"] == 1 and found["editing"] == "e7" and found["selected"] == "margem" and found["current"] == 1,
          f"Enter goes to the first match (slide 2), selected in its box: {found}")
    check(found["status"] == f"1 of {total}" and found["focus"] == "find-text", f"the panel keeps the keyboard: {found}")
    # The selected match shows orange (#ff9632), not covered by the browser's grey for a selection it is not typing in.
    shown = common_colour(page, page.evaluate(SELECTION_ON_SCREEN))
    check(abs(shown[0] - 255) <= 12 and abs(shown[1] - 150) <= 12 and abs(shown[2] - 50) <= 12,
          f"the selected match shows orange on screen: {shown}")
    page.screenshot(path=str(OUTPUT / "find-current-orange.png"))
    page.keyboard.press("Enter")
    check(state()["status"] == f"2 of {total}", f"Enter again: the next match: {state()}")
    page.keyboard.press("Shift+Enter")
    check(state()["status"] == f"1 of {total}" and state()["slide"] == 1, f"Shift+Enter goes back: {state()}")

    page.check("#find-match-case")
    wait_until(page, f"() => ({FIND_STATE})().highlighted === {page.evaluate(COUNT_IN_DECK.replace("'gi'", "'g'"), 'margem')}")
    page.uncheck("#find-match-case")

    page.fill("#find-text", "2024")   # at the end of a long line, under the panel where it opened
    page.keyboard.press("Enter")
    covered = page.evaluate("""() => {
        const frame = document.getElementById('deck-frame').getBoundingClientRect();
        const zoom = frame.width / 1280;
        const r = App.deck.getDocument().getSelection().getRangeAt(0).getBoundingClientRect();
        const p = document.getElementById('find-panel').getBoundingClientRect();
        const m = { left: frame.left + r.left * zoom, right: frame.left + r.right * zoom,
                    top: frame.top + r.top * zoom, bottom: frame.top + r.bottom * zoom };
        return !(m.right < p.left || m.left > p.right || m.bottom < p.top || m.top > p.bottom);
    }""")
    check(state()["selected"] == "2024" and not covered, f"the panel moves off the match it selected: {state()}")

    page.fill("#find-text", "oculto")
    page.keyboard.press("Enter")
    found = state()
    check(found["slide"] == 4 and found["editing"] == "e15" and found["selected"] == "oculto",
          f"hidden slides are searched too: {found}")

    page.keyboard.press("Control+h")
    check(page.locator("#find-replacement").is_visible() and state()["focus"] == "find-text",
          f"Ctrl+H shows Replace: {state()}")
    page.fill("#find-text", "Alfa")
    page.fill("#find-replacement", "Beta")
    page.click("#find-next")
    found = state()
    check(found["slide"] == 0 and found["editing"] == "e4" and found["selected"] == "Alfa" and "first slide" in found["status"],
          f"past the last slide it goes on from the first: {found}")
    alfas = page.evaluate(COUNT_IN_DECK, "alfa")
    page.click("#find-replace")
    box = lambda data_id: page.evaluate(f"App.deck.getDocument().querySelector('[data-id=\"{data_id}\"]').textContent")  # noqa: E731
    found = state()
    check("Beta Alimentos" in box("e4") and found["selected"] == "Alfa" and found["editing"] == "e7",
          f"Replace changes this match and selects the next: {found}")
    page.click('#ribbon-panel [data-command="undo"]')
    check("Alfa Alimentos" in box("e4"), "one Ctrl+Z undoes that replace")

    page.click("#find-replace-all")
    found = state()
    check(found["status"] == f"Replaced {alfas}" and page.evaluate(COUNT_IN_DECK, "alfa") == 0 and
          "Beta Alimentos" in box("e4") and "Beta Alimentos" in box("e7"), f"Replace All, on every slide: {found}")
    page.click('#ribbon-panel [data-command="undo"]')
    check(page.evaluate(COUNT_IN_DECK, "alfa") == alfas, "one undo brings all of them back")

    page.click("#find-text")
    page.keyboard.press("Escape")
    found = state()
    check(not found["open"] and found["highlighted"] == 0, f"Esc closes the panel and its highlights: {found}")
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


def clipboard_fixture(name):
    """A captured clipboard fixture (tests/fixtures/clipboard/<name>.js) as {type: data}."""
    source = (ROOT / "tests" / "fixtures" / "clipboard" / f"{name}.js").read_text(encoding="utf-8")
    start = source.index("CLIPBOARD_FIXTURES.push(") + len("CLIPBOARD_FIXTURES.push(")
    return json.loads(source[start:source.rindex(")")])["types"]


# Every visible line of the shown slides, measured relative to its slide in slide pixels, with what its bullet or
# number looks like (content, size, colour, position). The same on screen and in print = "prints as on screen".
PRINT_LAYOUT = """() => {
    const out = {};
    document.querySelectorAll('section.slide').forEach((slide) => {
        if (getComputedStyle(slide).display === 'none') return;
        const box = slide.getBoundingClientRect();
        const scale = box.width / slide.offsetWidth;
        out[slide.getAttribute('data-slide-id')] = Array.from(slide.querySelectorAll('.el p')).map((p) => {
            const r = p.getBoundingClientRect();
            const style = getComputedStyle(p);
            const marker = getComputedStyle(p, '::before');
            const round = (v) => Math.round(v / scale * 10) / 10;
            return [p.textContent.slice(0, 30), round(r.left - box.left), round(r.top - box.top), round(r.width),
                    round(r.height), style.paddingLeft, style.fontSize, style.textAlign,
                    marker.content, marker.fontSize, marker.color, marker.left, marker.marginLeft, marker.width].join('|');
        });
    });
    return out;
}"""


def test_phase3_done_when(browser):
    """
    Phase 3 "done when", automated: a 3-level list imported from a Copilot deck and a 3-level list pasted from
    Word (the real capture) become editable flat paragraphs; a slide title and a bulleted paragraph are reformatted
    with the ribbon only; the saved deck prints bullets, numbers and indents exactly as on screen.
    (The bullet key table runs in the unit tests.)
    """
    context = browser.new_context(viewport={"width": 1440, "height": 900}, accept_downloads=True)
    context.grant_permissions(["clipboard-read", "clipboard-write"])
    editor = Editor(browser, context)
    editor.open(MESSY)
    editor.close_dialog_if_open()
    page = editor.page
    ids = page.evaluate("""() => {
        const boxes = Array.from(App.deck.getDocument().querySelectorAll('.el[data-type="text"]'));
        const list = boxes.find((el) => el.textContent.includes('Custo de combustível'));
        const slide = list.closest('section.slide');
        const title = Array.from(slide.querySelectorAll('.el[data-type="text"]'))
            .find((el) => el.textContent.trim() === 'Riscos e mitigantes');
        return { list: list.getAttribute('data-id'), title: title.getAttribute('data-id'),
                 slide: App.deck.getSlides().indexOf(slide) };
    }""")
    page.evaluate("i => App.deck.goTo(i)", ids["slide"])
    lines = lambda: page.evaluate(LINES_OF, ids["list"])  # noqa: E731
    check(lines() == ["b1:Concentração em 3 clientes", "b1:Custo de combustível", "b2:Diesel: 38% do custo",
                      "b3:Sem hedge acima de 12 meses", "b1:Execução da expansão"],
          f"the Copilot deck's 3-level list is flat paragraphs with levels: {lines()}")

    # Editable, and Word's 3-level list (real capture, fake text) pastes in with its levels.
    page.evaluate("id => App.selection.select(App.deck.getDocument().querySelector('[data-id=\"' + id + '\"]'))", ids["list"])
    page.keyboard.press("Enter")   # edit, cursor at the end
    page.keyboard.type(" (FX)")
    page.keyboard.press("Enter")
    word = clipboard_fixture("3-level-bullet-word")
    put_on_clipboard(page, word["text/html"], word["text/plain"])
    page.keyboard.press("Control+v")
    check(lines()[4:] == ["b1:Execução da expansão (FX)", "b1:Aaaaaaaaaaa", "b2:Aaaa", "b3:Aaa"],
          f"typed into, and Word's list pasted with its 3 levels: {lines()}")
    page.keyboard.press("Escape")

    # The slide title, reformatted with the ribbon only (the box selected: all its text).
    page.evaluate("id => App.selection.select(App.deck.getDocument().querySelector('[data-id=\"' + id + '\"]'))", ids["title"])
    page.locator("#ribbon-panel .font-family-button").click()
    page.locator(".font-family-menu .menu-item", has_text="Georgia").click()
    size_box = page.locator("#ribbon-panel .font-size-input")
    size_box.fill("40")
    size_box.press("Enter")
    page.locator('#ribbon-panel [data-command="italic"]').click()
    page.locator("#ribbon-panel .font-color-menu-button").click()
    page.locator('.color-menu [title="Dark Red"]').click()
    page.locator('#ribbon-panel [data-command="alignCenter"]').click()
    look = """id => { const p = App.deck.getDocument().querySelector('[data-id="' + id + '"] p:nth-of-type(LINE)');
        const s = getComputedStyle(p); const b = getComputedStyle(p, '::before');
        return [s.fontFamily.split(',')[0], s.fontSize, s.fontStyle, s.color, s.textAlign, b.content]; }"""
    title = page.evaluate(look.replace("LINE", "1"), ids["title"])
    check(title[0] == "Georgia" and abs(float(title[1][:-2]) - 40 * 4 / 3) < 0.1 and   # 40 pt = 53.3 px
          title[2:5] == ["italic", "rgb(192, 0, 0)", "center"], f"title: Georgia 40 pt, italic, dark red, centred: {title}")

    # A bulleted paragraph ("Custo de combustível", line 2), reformatted with the ribbon only.
    page.evaluate("id => App.selection.select(App.deck.getDocument().querySelector('[data-id=\"' + id + '\"]'))", ids["list"])
    page.evaluate("App.commands.run('editText')")   # as Enter / F2 (the keyboard is still in the size box)
    page.evaluate("id => App.text.setCaret(App.text.editingElement(), { anchor: { p: 1, o: 0 }, focus: { p: 1, o: 20 } })",
                  ids["list"])
    page.locator('#ribbon-panel [data-command="numbering"]').click()
    page.locator('#ribbon-panel [data-command="bold"]').click()
    size_box.fill("24")
    size_box.press("Enter")
    page.locator('#ribbon-panel [data-command="alignRight"]').click()
    page.keyboard.press("Escape")
    check(lines()[1] == "n1:Custo de combustível", f"the paragraph is numbered now: {lines()}")
    line = page.evaluate(look.replace("LINE", "2"), ids["list"])
    check(line[1] == "32px" and line[4] == "right" and line[5].startswith("counter(list-1)"),
          f"the paragraph: 24 pt, right-aligned, numbered (the '1.' itself is checked in the print below): {line}")
    bold = page.evaluate("id => App.deck.getDocument().querySelector('[data-id=\"' + id + '\"] p:nth-of-type(2) b') !== null",
                         ids["list"])
    check(bold, "and bold")

    # Save, open the saved file on its own: what prints is what the screen shows.
    saved = editor.save_as_download("phase3-done-when.html")
    player, errors = play_saved_deck(browser, saved)
    screen = {}
    slides = player.evaluate("document.querySelectorAll('section.slide:not([data-hidden=\"true\"])').length")
    for _ in range(slides):
        screen.update(player.evaluate(PRINT_LAYOUT))
        player.keyboard.press("ArrowRight")
    player.emulate_media(media="print")
    printed = player.evaluate(PRINT_LAYOUT)
    check(sorted(printed) == sorted(screen) and len(printed) == slides, f"every visible slide prints: {sorted(printed)}")
    for slide_id, rows in printed.items():
        check(rows == screen[slide_id], f"slide {slide_id} prints as on screen:\n{rows}\n{screen[slide_id]}")
    risks = player.evaluate("i => document.querySelectorAll('section.slide')[i].getAttribute('data-slide-id')", ids["slide"])
    drawn = rendered_text(player, f'section.slide[data-slide-id="{risks}"]')
    for expected in ["•Concentração", "1.Custo de combustível", "–Diesel", "▪Sem hedge", "•Aaaaaaaaaaa", "–Aaaa", "▪Aaa"]:
        check(expected in drawn, f"the print draws {expected!r}: {drawn[:300]!r}")
    pdf = OUTPUT / "phase3-done-when.pdf"
    player.pdf(path=str(pdf), prefer_css_page_size=True, print_background=True)
    pages = len(re.findall(rb"/Type\s*/Page[^s]", pdf.read_bytes()))
    check(pages == slides, f"one PDF page per visible slide: {pages} pages, {slides} slides")
    check(errors == [] and editor.errors == [], f"no errors: {errors} {editor.errors}")
    player.context.close()
    editor.close()


TABLE_SHAPE = """id => {
    const table = App.deck.getDocument().querySelector('[data-id="' + id + '"] > table');
    return { rows: table.rows.length, cols: table.querySelectorAll('col').length,
             widths: Array.from(table.querySelectorAll('col'), (col) => parseFloat(col.style.width)),
             heights: Array.from(table.rows, (row) => parseFloat(row.style.height)),
             header: table.hasAttribute('data-header-row'), banded: table.hasAttribute('data-banded-rows') };
}"""


DRAWN_ROWS = """id => Array.from(App.deck.getDocument().querySelector('[data-id="' + id + '"] > table').rows,
    (row) => row.getBoundingClientRect().height)"""


def test_insert_and_resize_table(browser):
    """Insert > Table: the 10 x 10 grid picker (mouse and keys); resizing scales the columns and rows."""
    editor = Editor(browser)
    editor.open(CONTRACT)
    page = editor.page
    page.evaluate("App.deck.goTo(5)")   # slide 6: a title and bullets
    ribbon_height = page.evaluate("document.getElementById('ribbon').offsetHeight")
    page.click(".ribbon-tab[data-tab='insert']")
    check(page.evaluate("document.getElementById('ribbon').offsetHeight") == ribbon_height, "the Insert tab keeps the ribbon height")
    page.click(".table-button")
    check(page.is_visible(".table-grid-menu"), "the grid opens")
    check(page.locator(".table-grid-cell").count() == 100, "10 x 10")
    page.hover(".table-grid-cell[data-row='3'][data-col='4']")
    check(page.inner_text(".table-grid-label") == "4 × 3 table", f"label: {page.inner_text('.table-grid-label')}")
    check(page.locator(".table-grid-cell.picked").count() == 12, "12 cells picked")
    page.screenshot(path=str(OUTPUT / "40-table-grid.png"))
    page.click(".table-grid-cell[data-row='3'][data-col='4']")
    check(page.is_hidden(".table-grid-menu"), "the grid closes")

    table_id = page.evaluate("App.selection.selectedId()")
    check(page.evaluate("id => App.deck.getDocument().querySelector('[data-id=\"' + id + '\"]').getAttribute('data-type')",
                        table_id) == "table", f"the new table is selected: {table_id}")
    shape = page.evaluate(TABLE_SHAPE, table_id)
    check(shape["rows"] == 3 and shape["cols"] == 4 and shape["header"] and shape["banded"], f"3 rows, 4 columns: {shape}")
    check(element_rect(page, table_id) == {"left": 160, "top": 300, "width": 960, "height": 120}, "centred, 960 x 120")
    check(page.evaluate("App.history.undoLabel()") == "Insert table", "one undo step")
    page.screenshot(path=str(OUTPUT / "41-table-inserted.png"))
    page.keyboard.press("Control+Z")
    check(page.evaluate("id => !App.deck.getDocument().querySelector('[data-id=\"' + id + '\"]')", table_id), "undo removes it")
    page.keyboard.press("Control+Y")
    check(page.evaluate(TABLE_SHAPE, table_id)["rows"] == 3, "redo brings it back")

    # Narrower by the right handle: the four columns stay equal; shorter than its text: the rows stop at the text.
    page.mouse.click(*slide_to_screen(page, 300, 320))
    check(page.evaluate("App.selection.selectedId()") == table_id, "a click selects the table (and types in a cell)")
    page.keyboard.press("Escape")
    drag(page, slide_to_screen(page, 1120, 360), slide_to_screen(page, 880, 360))
    shape = page.evaluate(TABLE_SHAPE, table_id)
    width = element_rect(page, table_id)["width"]
    check(abs(width - 720) <= 2, f"720 px wide: {width}")
    check(abs(sum(shape["widths"]) - width) < 0.05 and max(shape["widths"]) - min(shape["widths"]) < 0.05,
          f"equal columns that fill the box: {shape['widths']}")
    check(page.evaluate("App.history.undoLabel()") == "Resize", "a resize step")
    drag(page, slide_to_screen(page, 520, 420), slide_to_screen(page, 520, 310))
    shape = page.evaluate(TABLE_SHAPE, table_id)
    rect = element_rect(page, table_id)
    drawn = page.evaluate(DRAWN_ROWS, table_id)
    check(all(height > 20 for height in drawn), f"rows keep a line of text: {drawn}")
    check(abs(rect["height"] - sum(drawn)) < 0.05, f"the box is as tall as the rows: {rect}")
    box = page.evaluate("App.transform.readRect(document.querySelector('#overlay .selection-box'))")
    check(abs(box["height"] - rect["height"]) <= 1, f"the selection box follows: {box}")

    # Keys: the first arrow picks 1 x 1, then each arrow grows or shrinks it; Enter inserts; Esc closes.
    page.click(".table-button")
    for key in ["ArrowDown", "ArrowRight", "ArrowDown"]:
        page.keyboard.press(key)
    check(page.inner_text(".table-grid-label") == "2 × 2 table", f"label: {page.inner_text('.table-grid-label')}")
    page.keyboard.press("Enter")
    small_id = page.evaluate("App.selection.selectedId()")
    check(small_id != table_id and page.evaluate(TABLE_SHAPE, small_id)["cols"] == 2, "a 2 x 2 table")
    page.click(".table-button")
    page.keyboard.press("Escape")
    check(page.is_hidden(".table-grid-menu"), "Esc closes the grid")
    page.click(".table-button")
    page.mouse.click(*slide_to_screen(page, 40, 700))
    check(page.is_hidden(".table-grid-menu"), "a click elsewhere closes it")

    saved = editor.save_as_download("table-inserted.html")
    editor.open(saved)
    check(editor.report_dialog_text() is None, "the saved deck reopens without a report")
    page.evaluate("App.deck.goTo(5)")
    check(page.evaluate(TABLE_SHAPE, table_id) == shape, "the table is saved as it was")
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


CELL_TEXT = """([r, c]) => App.text.getModel(App.deck.getDocument().querySelector('[data-id="e9"] > table').rows[r].cells[c])
    .map((line) => line.text).join('/')"""
EDITING_KEY = "App.text.isEditing() ? App.text.containerKey(App.text.editingElement()) : null"


def test_table_cell_editing(browser):
    """Typing in table cells: click into a cell, Tab / Shift+Tab, Tab in the last cell adds a row, rows grow with text."""
    editor = Editor(browser)
    editor.open(CONTRACT)
    page = editor.page
    page.evaluate("App.deck.goTo(2)")   # slide 3: the comps table e9 (rows about 37 px, the header from y = 140)
    text = lambda r, c: page.evaluate(CELL_TEXT, [r, c])  # noqa: E731
    key = lambda: page.evaluate(EDITING_KEY)  # noqa: E731
    rows = lambda: page.evaluate("App.deck.getDocument().querySelector('[data-id=\"e9\"] > table').rows.length")  # noqa: E731
    # The rows as drawn (the sample's box is taller than its table; the first edit fits the box to the rows).
    height = lambda: sum(page.evaluate(DRAWN_ROWS, "e9"))  # noqa: E731
    start_height = height()

    # A click puts the cursor in the cell under the mouse; the table is the selected element.
    page.mouse.click(*slide_to_screen(page, 300, 196))
    check(key() == "e9/1/0" and page.evaluate("App.selection.selectedId()") == "e9", f"editing Beta Foods: {key()}")
    page.keyboard.press("End")
    page.keyboard.type(" S.A.")
    check(text(1, 0) == "Beta Foods S.A.", f"typed: {text(1, 0)}")
    page.keyboard.press("Tab")
    check(key() == "e9/1/1" and page.evaluate("App.deck.getDocument().getSelection().toString()") == "2.450",
          f"Tab: the next cell, its text selected: {key()}")
    page.keyboard.type("2.500")
    check(text(1, 1) == "2.500", f"typing replaces it: {text(1, 1)}")
    page.keyboard.press("Shift+Tab")
    check(key() == "e9/1/0" and page.evaluate("App.deck.getDocument().getSelection().toString()") == "Beta Foods S.A.",
          f"Shift+Tab goes back: {key()}")
    page.keyboard.press("Control+Z")
    check(text(1, 1) == "2.450" and key() == "e9/1/0", f"undo takes back the other cell's typing, typing goes on here: {key()}")
    page.keyboard.press("Control+Z")
    check(text(1, 0) == "Beta Foods", f"and then this cell's: {text(1, 0)}")

    # A second line makes the row (and the table) taller; undo shrinks it back.
    page.keyboard.press("End")
    page.keyboard.press("Enter")
    page.keyboard.type("Segunda linha")
    check(text(1, 0) == "Beta Foods/Segunda linha", f"two lines: {text(1, 0)}")
    check(height() > start_height + 15, f"the table grew: {height()} vs {start_height}")
    box = page.evaluate("App.transform.readRect(document.querySelector('#overlay .selection-box'))")
    check(abs(box["height"] - height()) <= 1 and abs(element_rect(page, "e9")["height"] - height()) < 0.05,
          f"the box and the selection box follow the rows: {box}")
    page.keyboard.press("Control+Z")   # the typing
    page.keyboard.press("Control+Z")   # the Enter (its own step, as in a text box)
    check(text(1, 0) == "Beta Foods" and abs(height() - start_height) < 0.5, f"undo: one line, old height: {text(1, 0)!r} {height()}")

    # Formatting works in a cell as in a text box.
    page.keyboard.press("Control+A")
    page.keyboard.press("Control+B")
    weight = page.evaluate("getComputedStyle(App.text.editingElement().querySelector('p')).fontWeight")
    check(weight == "700", f"Ctrl+B in a cell: {weight}")
    page.keyboard.press("Control+Z")

    # Clicking another cell while typing moves there; a double-click does too.
    page.mouse.click(*slide_to_screen(page, 450, 232))
    check(key() == "e9/2/1", f"click on 1.120: {key()}")
    page.mouse.dblclick(*slide_to_screen(page, 700, 270))
    check(key() == "e9/3/2", f"double-click on 10,4x: {key()}")

    # Esc: the table stays selected; Enter types in its first cell.
    page.keyboard.press("Escape")
    check(key() is None and page.evaluate("App.selection.selectedId()") == "e9", "Esc: table selected")
    page.keyboard.press("Enter")
    check(key() == "e9/0/0", f"Enter: the first cell: {key()}")
    page.keyboard.press("Escape")

    # Tab in the last cell adds a row like the last one and goes to its first cell.
    page.mouse.click(*slide_to_screen(page, 1100, 345))
    check(key() == "e9/5/3", f"the last cell: {key()}")
    page.keyboard.press("Tab")
    check(rows() == 7 and key() == "e9/6/0", f"a new row: {rows()} rows, {key()}")
    check(page.evaluate("App.history.undoLabel()") == "Insert row", "one undo step")
    check(height() > start_height + 30, f"the table grew by a row: {height()}")
    page.keyboard.type("Nova")
    check(text(6, 0) == "Nova", f"typing in it: {text(6, 0)}")
    page.screenshot(path=str(OUTPUT / "42-table-new-row.png"))
    page.keyboard.press("Escape")
    page.keyboard.press("Control+Z")
    page.keyboard.press("Control+Z")
    check(rows() == 6 and abs(height() - start_height) < 0.5, f"undo removes the typing, then the row: {rows()}")

    # Find & replace searches cells too.
    page.keyboard.press("Control+f")
    page.keyboard.type("Gama")
    page.keyboard.press("Enter")
    check(key() == "e9/2/0" and page.evaluate("App.deck.getDocument().getSelection().toString()") == "Gama",
          f"Find goes into the cell: {key()}")
    page.keyboard.press("Control+h")
    page.fill("#find-replacement", "Zeta")
    page.click("#find-replace-all")
    check(text(2, 0) == "Zeta Nutrição", f"Replace All in a cell: {text(2, 0)}")
    page.keyboard.press("Escape")

    saved = editor.save_as_download("table-cells.html")
    editor.open(saved)
    page.evaluate("App.deck.goTo(2)")
    check(text(2, 0) == "Zeta Nutrição" and rows() == 6, "saved with the edits")
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


E9_GRID = """() => {
    const table = App.deck.getDocument().querySelector('[data-id="e9"] > table');
    return App.tables.gridOf(table).cells.map((row) => row.map((cell) =>
        App.text.getModel(cell).map((line) => line.text).join('/') || '_').join('|'));
}"""


def test_table_column_borders(browser):
    """Dragging a column border: the column left of it gives or takes width from the one right of it; one undo step."""
    editor = Editor(browser)
    editor.open(CONTRACT)
    page = editor.page
    page.evaluate("App.deck.goTo(2)")   # the comps table e9: column borders at x = 375 / 592 / 915, Beta Foods' row about y = 196
    shape = lambda: page.evaluate(TABLE_SHAPE, "e9")  # noqa: E731
    key = lambda: page.evaluate(EDITING_KEY)  # noqa: E731
    start = shape()["widths"]
    box = element_rect(page, "e9")

    # Nothing being typed: the overlay shows the border cursor and does the drag.
    page.mouse.move(*slide_to_screen(page, 375, 196))
    check(page.evaluate("document.getElementById('overlay').style.cursor") == "col-resize", "the border cursor over a column border")
    page.mouse.move(*slide_to_screen(page, 300, 196))
    check(page.evaluate("document.getElementById('overlay').style.cursor") == "text", "an I-beam inside a cell")
    drag(page, slide_to_screen(page, 375, 196), slide_to_screen(page, 415, 196))
    widths = shape()["widths"]
    check(abs(widths[0] - start[0] - 40) < 1 and abs(widths[1] - start[1] + 40) < 1 and
          all(abs(a - b) < 0.05 for a, b in zip(widths[2:], start[2:])),
          f"the first column 40 px wider, the second 40 px narrower: {start} -> {widths}")
    check(abs(element_rect(page, "e9")["width"] - box["width"]) < 0.05, "the table keeps its width")
    check(page.evaluate("App.selection.selectedId()") == "e9" and key() is None and page.is_hidden(".cell-block"),
          "the table selected, no typing, no cells selected")
    check(page.evaluate("App.history.undoLabel()") == "Resize column", "one undo step")
    page.keyboard.press("Control+Z")
    check(shape()["widths"] == start, "undo")

    # Typing in a cell: the border still drags, and typing goes on in that cell.
    page.mouse.click(*slide_to_screen(page, 200, 196))   # Beta Foods
    check(key() == "e9/1/0", f"typing in Beta Foods: {key()}")
    page.mouse.move(*slide_to_screen(page, 592, 196))
    cursor = page.evaluate("""() => { const doc = App.deck.getDocument();
        return doc.defaultView.getComputedStyle(doc.querySelector('[data-id="e9"] > table').rows[1].cells[1]).cursor; }""")
    check(cursor == "col-resize", f"the border cursor while typing: {cursor}")
    drag(page, slide_to_screen(page, 592, 196), slide_to_screen(page, 552, 196))
    widths = shape()["widths"]
    check(abs(widths[1] - start[1] + 40) < 1 and abs(widths[2] - start[2] - 40) < 1, f"the border moved 40 px left: {widths}")
    check(key() == "e9/1/0", f"typing goes on in Beta Foods: {key()}")
    page.keyboard.type("!")
    check(page.evaluate(CELL_TEXT, [1, 0]) == "Beta Foods!", "the cursor stayed where it was")

    # A column never gets narrower than 24 px; its text wraps and the table grows taller.
    page.keyboard.press("Escape")
    height = element_rect(page, "e9")["height"]
    drag(page, slide_to_screen(page, 375, 196), slide_to_screen(page, 10, 196))
    check(abs(shape()["widths"][0] - 24) < 0.01, f"the first column stops at 24 px: {shape()['widths']}")
    check(element_rect(page, "e9")["height"] > height + 50, f"the table grew with the wrapped names: {height} -> {element_rect(page, 'e9')}")
    page.screenshot(path=str(OUTPUT / "44-table-column-border.png"))
    for _ in range(3):
        page.keyboard.press("Control+Z")
    check(shape()["widths"] == start and abs(element_rect(page, "e9")["height"] - box["height"]) < 0.05,
          f"undo, undo (typing), undo: as it was: {shape()['widths']}")
    check(editor.errors == [], f"no errors: {editor.errors}")


# The comps table's <table> (its look, rows and cells; not its box or column widths, which a first change
# fits to the rows) without the marks of a cell being typed in.
E9_HTML = """(() => { const copy = App.deck.getDocument().querySelector('[data-id="e9"] > table').cloneNode(true);
    copy.querySelector('colgroup').remove();
    copy.querySelectorAll('[contenteditable]').forEach((cell) => {
        ['contenteditable', 'spellcheck'].forEach((name) => cell.removeAttribute(name));
        cell.classList.remove('editor-editing');
        if (!cell.getAttribute('class')) { cell.removeAttribute('class'); }
    });
    return copy.outerHTML; })()"""
CELL_STYLE = """([r, c, property]) => { const doc = App.deck.getDocument();
    const cell = doc.querySelector('[data-id="e9"] > table').rows[r].cells[c];
    return doc.defaultView.getComputedStyle(cell)[property]; }"""


def test_table_design(browser):
    """Table Design: style options, shading, borders with the pen; Layout > Alignment: vertical alignment, cell margins."""
    editor = Editor(browser)
    editor.open(CONTRACT)
    page = editor.page
    page.evaluate("App.deck.goTo(2)")   # the comps table e9 (Beta Foods' row about y = 196; its numbers from x = 375)
    design_tab = ".ribbon-tab[data-tab='table-design']"
    key = lambda: page.evaluate(EDITING_KEY)  # noqa: E731
    style = lambda r, c, prop: page.evaluate(CELL_STYLE, [r, c, prop])  # noqa: E731
    attribute = lambda name: page.evaluate(f"App.deck.getDocument().querySelector('[data-id=\"e9\"] > table').hasAttribute('{name}')")  # noqa: E731
    start = page.evaluate(E9_HTML)
    check(page.is_hidden(design_tab), "no Table Design tab without a table")

    # Style options: the checkboxes show the table's; a click turns one on or off, typing goes on.
    page.mouse.click(*slide_to_screen(page, 200, 196))   # Beta Foods
    page.click(design_tab)
    page.screenshot(path=str(OUTPUT / "45-table-design-tab.png"))
    banded = attribute("data-banded-rows")
    check(page.is_checked("input[data-command='tableBandedRows']") == banded and
          page.is_checked("input[data-command='tableHeaderRow']") == attribute("data-header-row"), "the checkboxes show the table's options")
    page.click("label:has(input[data-command='tableBandedRows'])")
    check(attribute("data-banded-rows") != banded and page.is_checked("input[data-command='tableBandedRows']") != banded,
          "Banded Rows switched")
    check(key() == "e9/1/0", f"typing goes on: {key()}")
    page.click("label:has(input[data-command='tableTotalRow'])")
    check(style(5, 0, "borderTopWidth") == "2px" and style(5, 0, "fontWeight") == "700", "Total Row: the last row bold, a 2 px line above")
    page.keyboard.press("Control+Z")
    page.keyboard.press("Control+Z")
    check(page.evaluate(E9_HTML) == start, "two undos")

    # Shading: the cell typed in; "Table style fill" gives it back.
    page.click(".cell-fill-menu-button")
    page.click(".cell-fill-menu .color-swatch[title='Red']")
    check(style(1, 0, "backgroundColor") == "rgb(255, 0, 0)" and style(1, 1, "backgroundColor") != "rgb(255, 0, 0)", "Beta Foods red")
    check(page.evaluate("App.history.undoLabel()") == "Shading" and key() == "e9/1/0", "one undo step, typing goes on")
    page.click(".cell-fill-menu-button")
    page.click(".cell-fill-menu .menu-item[title='Table style fill']")
    check(page.evaluate(E9_HTML) == start, "the table style fill again: as it was")

    # Borders with the pen on selected cells: outside only, the cells stay selected.
    page.keyboard.press("Escape")
    drag(page, slide_to_screen(page, 480, 196), slide_to_screen(page, 750, 232))   # 2.450 … 8,9x
    page.click(design_tab)
    page.click(".pen-weight")
    page.click(".pen-weight-menu .menu-item:has-text('3 px')")
    page.click(".borders-menu-button")
    page.click(".borders-menu .menu-item:has-text('Outside Borders')")
    check(style(1, 1, "borderTopWidth") == "3px" and style(1, 1, "borderLeftWidth") == "3px" and style(2, 2, "borderRightWidth") == "3px"
          and style(2, 2, "borderBottomWidth") == "3px", "the four cells' outline is 3 px")
    check(style(1, 1, "borderRightWidth") != "3px" and style(1, 1, "borderBottomWidth") != "3px", "no line inside")
    check(page.is_visible(".cell-block") and page.evaluate("App.history.undoLabel()") == "Outside Borders", "still selected; one undo step")
    check(page.get_attribute(".borders-main", "title") == "Borders: Outside Borders", "the Borders button draws that kind next")

    # Layout > Alignment: the selected cells to the bottom (the table centres its cells); Cell Margins Wide for the whole table.
    page.click(".ribbon-tab[data-tab='table-layout']")
    check(page.get_attribute(".ribbon-button[data-command='cellAlignMiddle']", "aria-pressed") == "true", "the button shows the centring")
    page.click(".ribbon-button[data-command='cellAlignBottom']")
    check(style(1, 1, "verticalAlign") == "bottom" and style(2, 2, "verticalAlign") == "bottom" and style(1, 0, "verticalAlign") == "middle",
          "the selected cells at the bottom")
    check(page.get_attribute(".ribbon-button[data-command='cellAlignBottom']", "aria-pressed") == "true", "the button shows it")
    page.keyboard.press("Escape")
    check(page.is_hidden(".cell-block") and key() is None, "the whole table selected")
    height = element_rect(page, "e9")["height"]
    page.click(".cell-margins")
    page.click(".cell-margins-menu .menu-item:has-text('Wide')")
    check(style(0, 0, "paddingLeft") == "14px" and style(4, 3, "paddingTop") == "14px", "every cell has wide margins")
    check(page.evaluate("App.deck.getDocument().querySelector('[data-id=\"e9\"] > table').style.getPropertyValue('--cell-padding')") == "14px",
          "written once, on the table")
    check(element_rect(page, "e9")["height"] > height + 50, "the rows got taller")
    page.screenshot(path=str(OUTPUT / "46-table-layout-alignment.png"))
    for _ in range(3):
        page.keyboard.press("Control+Z")
    check(page.evaluate(E9_HTML) == start, "three undos: as it was")

    # A new table has Header Row and Banded Rows on; unticking Header Row takes the dark header away.
    page.evaluate("App.commands.run('insertTable', { rows: 4, cols: 4 })")
    new_id = page.evaluate("App.selection.selectedId()")
    first_fill = lambda: page.evaluate("""id => { const doc = App.deck.getDocument();  // noqa: E731
        return doc.defaultView.getComputedStyle(doc.querySelector('[data-id="' + id + '"] td')).backgroundColor; }""", new_id)
    page.click(design_tab)
    check(page.is_checked("input[data-command='tableHeaderRow']") and page.is_checked("input[data-command='tableBandedRows']"),
          "a new table: Header Row and Banded Rows ticked")
    dark = first_fill()
    page.click("label:has(input[data-command='tableHeaderRow'])")
    check(dark == "rgb(31, 42, 68)" and first_fill() == "rgb(242, 242, 242)",
          f"the dark header goes; the bands now start at the first row: {dark} -> {first_fill()}")
    check(editor.errors == [], f"no errors: {editor.errors}")


CELL_CENTER = """([id, r, c]) => { const cell = App.deck.getDocument().querySelector('[data-id="' + id + '"] > table').rows[r].cells[c];
    const rect = cell.getBoundingClientRect(); return [rect.left + rect.width / 2, rect.top + rect.height / 2]; }"""
LINE_ALIGN = """([id, r, c]) => { const doc = App.deck.getDocument();
    const line = doc.querySelector('[data-id="' + id + '"] > table').rows[r].cells[c].firstElementChild;
    return doc.defaultView.getComputedStyle(line).textAlign; }"""


def test_table_numbers(browser):
    """Number buttons (pt-BR / en-US, decimals, percent, negatives in parentheses); a column of numbers lines up on the right."""
    editor = Editor(browser)
    editor.open(CONTRACT)
    page = editor.page
    page.evaluate("App.deck.goTo(2)")   # the comps table e9 (rows about 37 px from y = 178; Margem EBITDA from x = 915)
    design_tab = ".ribbon-tab[data-tab='table-design']"
    button = lambda name: f".ribbon-button[data-command='{name}']"  # noqa: E731
    pressed = lambda name: page.get_attribute(button(name), "aria-pressed") == "true"  # noqa: E731
    grid = lambda: page.evaluate(E9_GRID)  # noqa: E731
    margins = lambda: [row.split("|")[3] for row in grid()[1:5]]  # noqa: E731
    key = lambda: page.evaluate(EDITING_KEY)  # noqa: E731

    # A cell of words: the number buttons are off. A cell with a number: they work on it, typing goes on.
    page.mouse.click(*slide_to_screen(page, 200, 196))   # Beta Foods
    page.click(design_tab)
    check(page.is_disabled(button("increaseDecimals")), "no number in Beta Foods")
    check(page.text_content(".number-locale").strip() == "1.234,5 ▾", "a pt-BR deck: numbers written 1.234,5")
    page.mouse.click(*slide_to_screen(page, 480, 196))   # 2.450
    check(pressed("numberThousands"), "2.450 has a thousands separator")
    page.click(button("increaseDecimals"))
    check(grid()[1] == "Beta Foods|2.450,0|9,8x|19,5%" and key() == "e9/1/1", f"one more decimal, typing goes on: {grid()[1]} {key()}")
    check(page.evaluate("App.history.undoLabel()") == "Increase Decimal", "one undo step")

    # Selected cells: negatives in parentheses, percent off (0,195: no digit lost), undo.
    page.keyboard.press("Escape")
    drag(page, slide_to_screen(page, 1000, 196), slide_to_screen(page, 1000, 306))   # Margem EBITDA, Beta … Épsilon
    page.click(design_tab)
    check(pressed("numberPercent") and not pressed("negativeParens"), "percentages; -3,5% has a minus")
    page.click(button("negativeParens"))
    check(margins() == ["19,5%", "17,2%", "21,0%", "(3,5%)"], f"negatives in parentheses: {margins()}")
    page.click(button("numberPercent"))
    check(margins() == ["0,195", "0,172", "0,210", "(0,035)"] and page.is_visible(".cell-block"), f"percent off: {margins()}")
    page.keyboard.press("Control+Z")
    check(margins() == ["19,5%", "17,2%", "21,0%", "(3,5%)"], f"undone: {margins()}")

    # en-US, remembered in the settings: the numbers are written 1,234.5 from then on.
    page.click(".number-locale")
    page.click(".number-locale-menu .menu-item:has-text('en-US')")
    check(page.text_content(".number-locale").strip() == "1,234.5 ▾", "the button shows en-US")
    check(page.evaluate("JSON.parse(localStorage.getItem('deck-editor-settings')).numberLocale") == "en-US", "remembered")
    page.click(button("increaseDecimals"))
    check(margins() == ["19.50%", "17.20%", "21.00%", "(3.50%)"], f"written the en-US way: {margins()}")
    # en-US chosen, but this table and deck are pt-BR: 1.120 is read as 1120, not 1.12.
    page.keyboard.press("Escape")
    page.mouse.click(*slide_to_screen(page, 480, 232))   # 1.120
    page.click(button("increaseDecimals"))
    check(grid()[2].split("|")[1] == "1,120.0", f"1.120 read the pt-BR way, written the en-US way: {grid()[2]}")
    page.screenshot(path=str(OUTPUT / "47-table-numbers.png"))

    # A new table: a column of numbers lines up on the right once its cell is left, header too; undo takes it back.
    page.evaluate("App.deck.goTo(4)")
    page.evaluate("App.commands.run('insertTable', { rows: 3, cols: 2 })")
    new_id = page.evaluate("App.selection.selectedId()")
    align = lambda r, c: page.evaluate(LINE_ALIGN, [new_id, r, c])  # noqa: E731
    page.mouse.click(*slide_to_screen(page, *page.evaluate(CELL_CENTER, [new_id, 0, 1])))
    for text in ["Valor", "Tab", "Alfa", "Tab", "1.234"]:
        page.keyboard.press(text) if text == "Tab" else page.keyboard.type(text)
    check(align(1, 1) == "left", "not while typing")
    page.keyboard.press("Tab")
    page.keyboard.type("Beta")
    check([align(0, 1), align(1, 1), align(1, 0)] == ["right", "right", "left"], "the number column on the right, its header too")
    page.keyboard.press("Tab")
    page.keyboard.type("n.a.")
    page.keyboard.press("Escape")
    check(align(2, 1) == "right", "n.a. keeps it a number column")
    for _ in range(3):
        page.keyboard.press("Control+Z")
    check(align(1, 1) == "left" and align(0, 1) == "left", "undo before 1.234: left again")
    check(editor.errors == [], f"no errors: {editor.errors}")


TABLE_TEXTS = """id => { const table = App.deck.getDocument().querySelector('[data-id="' + id + '"] > table');
    return table ? Array.from(table.rows, (row) => Array.from(row.cells, (cell) => cell.textContent).join('|')) : null; }"""


def test_paste_from_excel(browser):
    """Ctrl+V of a table copied in Excel (real capture, fake text): a new table in the deck's look, paste options,
    pasting into a table from a cell, and our own copies still winning over an older Excel copy."""
    context = browser.new_context(viewport={"width": 1440, "height": 900}, accept_downloads=True)
    context.grant_permissions(["clipboard-read", "clipboard-write"])
    editor = Editor(browser, context)
    editor.open(CONTRACT)
    page = editor.page
    selected = "App.selection.selectedId()"
    comps = clipboard_fixture("excel-comps")
    page.evaluate("App.deck.goTo(4)")   # slide 5: room for a table
    page.mouse.click(*slide_to_screen(page, 640, 500))   # empty slide space
    put_on_clipboard(page, comps["text/html"], comps["text/plain"])
    started = time.time()
    page.keyboard.press("Control+v")
    new_id = page.evaluate(selected)
    texts = page.evaluate(TABLE_TEXTS, new_id)
    check(time.time() - started < 10, "pasted at once")
    check(texts and texts[1] == "Aaaa Aaaaa|2.450|9,8x|19,50%" and len(texts) == 6, f"a new table with Excel's text: {texts}")
    options = page.evaluate("""id => { const table = App.deck.getDocument().querySelector('[data-id="' + id + '"] > table');
        return ['data-header-row', 'data-total-row'].map((name) => table.hasAttribute(name)); }""", new_id)
    check(options == [True, True], "the deck's style: header row, and Mediana (bold in Excel) as the total row")
    check(page.evaluate(LINE_ALIGN, [new_id, 1, 1]) == "right" and page.evaluate(LINE_ALIGN, [new_id, 1, 0]) == "left",
          "numbers on the right")
    check(page.evaluate("App.history.undoLabel()") == "Paste table", "one undo step")
    page.screenshot(path=str(OUTPUT / "48-table-pasted.png"))

    # Paste options: Keep source formatting puts Excel's look on it, still one step.
    check(page.is_visible("#paste-options"), "the paste options button")
    page.click("#paste-options")
    page.click(".paste-options-menu .menu-item:has-text('Keep source formatting')")
    source_id = page.evaluate(selected)
    fill = page.evaluate("""id => { const doc = App.deck.getDocument();
        return doc.defaultView.getComputedStyle(doc.querySelector('[data-id="' + id + '"] td')).backgroundColor; }""", source_id)
    check(fill == "rgb(14, 40, 65)", f"Excel's dark header: {fill}")
    page.keyboard.press("Control+z")
    check(page.evaluate(TABLE_TEXTS, source_id) is None and page.evaluate(TABLE_TEXTS, new_id) is None, "one Ctrl+Z: no table")

    # Our own newer copy wins over the Excel table copied before it.
    page.evaluate("App.deck.goTo(0)")
    page.mouse.click(*slide_to_screen(page, 300, 290))   # "Projeto Atlas"
    page.keyboard.press("Control+c")
    page.keyboard.press("Control+v")
    pasted = page.evaluate(selected)
    check(pasted not in (None, "e2") and page.evaluate(
        "id => App.deck.getDocument().querySelector('[data-id=\"' + id + '\"]').getAttribute('data-type')", pasted) == "text",
        f"our copy pasted, not Excel's table: {pasted}")

    # Typing in a cell, Ctrl+V of several cells: they fill the table from there, adding rows; the cells are selected.
    page.evaluate("App.deck.goTo(2)")   # the comps table e9 (rows about 37 px from y = 178)
    sheet = clipboard_fixture("excel-table")   # 5 rows x 3 columns of 1,1 … 5,5
    put_on_clipboard(page, sheet["text/html"], sheet["text/plain"])
    page.mouse.click(*slide_to_screen(page, 200, 307))   # Épsilon Orgânicos
    page.keyboard.press("Control+v")
    texts = page.evaluate(TABLE_TEXTS, "e9")
    check(len(texts) == 9 and texts[4] == "1,1|1,1|1,1|-3,5%" and texts[8] == "5,5|5,5|5,5|",
          f"from Épsilon on, three rows added: {texts}")
    check(page.is_visible(".cell-block") and page.evaluate("App.history.undoLabel()") == "Paste", "the pasted cells selected; one step")
    page.keyboard.press("Control+z")
    check(len(page.evaluate(TABLE_TEXTS, "e9")) == 6, "undone")

    # Selected cells, Ctrl+V: from their first cell on (here it fits, nothing added).
    page.keyboard.press("Escape")
    drag(page, slide_to_screen(page, 480, 196), slide_to_screen(page, 750, 232))   # 2.450 … 8,9x
    page.keyboard.press("Control+v")
    texts = page.evaluate(TABLE_TEXTS, "e9")
    check(texts[1] == "Beta Foods|1,1|1,1|1,1" and texts[5] == "Mediana|5,5|5,5|5,5" and len(texts) == 6, f"from 2.450 on: {texts}")
    check(editor.errors == [], f"no errors: {editor.errors}")


def test_phase4_done_when(browser):
    """
    Phase 4 "done when", automated: a comps table copied from Excel (the real capture, fake text) becomes an
    editable, formatted table on a slide in under a minute: pasted, typed in, numbers reformatted from the ribbon,
    saved, reopened (still a table, still editable) and shown by the saved file on its own.
    """
    context = browser.new_context(viewport={"width": 1440, "height": 900}, accept_downloads=True)
    context.grant_permissions(["clipboard-read", "clipboard-write"])
    editor = Editor(browser, context)
    page = editor.page
    page.evaluate("App.commands.run('newDeck')")   # File > New deck
    wait_until(page, "App.deck.getSlides().length === 2")
    comps = clipboard_fixture("excel-comps")
    put_on_clipboard(page, comps["text/html"], comps["text/plain"])
    started = time.time()

    # Slide 2 ("Título do slide"): the body text box goes, the table from Excel takes its place.
    page.evaluate("App.deck.goTo(1)")
    page.mouse.click(*slide_to_screen(page, 600, 200))   # the bulleted body box
    check(page.evaluate("App.selection.selectedId()") == "e6", "the body box selected")
    page.keyboard.press("Delete")
    page.mouse.click(*slide_to_screen(page, 640, 400))   # now empty slide space
    page.keyboard.press("Control+v")
    table_id = page.evaluate("App.selection.selectedId()")
    texts = lambda: page.evaluate(TABLE_TEXTS, table_id)  # noqa: E731
    check(texts() and texts()[1] == "Aaaa Aaaaa|2.450|9,8x|19,50%", f"Excel's table on the slide: {texts()}")

    # Edit: type in a cell, Tab into the next one (its text selected) and replace it.
    page.mouse.click(*slide_to_screen(page, *page.evaluate(CELL_CENTER, [table_id, 1, 0])))
    page.keyboard.press("End")
    page.keyboard.type(" S.A.")
    page.keyboard.press("Tab")
    page.keyboard.type("2.500")
    page.keyboard.press("Escape")
    check(texts()[1] == "Aaaa Aaaaa S.A.|2.500|9,8x|19,50%", f"typed in: {texts()[1]}")

    # Format from the ribbon only: the percentages to one decimal, negatives in parentheses.
    drag(page, slide_to_screen(page, *page.evaluate(CELL_CENTER, [table_id, 1, 3])),
         slide_to_screen(page, *page.evaluate(CELL_CENTER, [table_id, 5, 3])))
    page.click(".ribbon-tab[data-tab='table-design']")
    page.click(".ribbon-button[data-command='decreaseDecimals']")
    page.click(".ribbon-button[data-command='negativeParens']")
    percents = [row.split("|")[3] for row in texts()[1:]]
    check(percents == ["19,5%", "17,2%", "21,0%", "(3,5%)", "18,4%"], f"one decimal, (3,5%): {percents}")
    elapsed = time.time() - started
    check(elapsed < 60, f"pasted, edited and formatted in under a minute: {elapsed:.1f} s")
    page.keyboard.press("Escape")
    wait_until(page, """() => { const thumb = document.querySelector('.thumb[data-index="1"] iframe').contentDocument;
        return !!thumb.querySelector('table') && thumb.body.textContent.includes('(3,5%)'); }""")   # redrawn after a short pause
    page.screenshot(path=str(OUTPUT / "49-phase4-done-when.png"))

    # Saved and reopened: the same table, its style and numbers on the right, and it can still be typed in.
    saved = editor.save_as_download("phase4-done-when.html")
    before = texts()
    editor.open(saved)
    check(editor.report_dialog_text() is None, "a deck the editor saved opens without an import report")
    page.evaluate("App.deck.goTo(1)")
    check(texts() == before, f"the table came back as saved: {texts()}")
    style = page.evaluate("""id => { const table = App.deck.getDocument().querySelector('[data-id="' + id + '"] > table');
        return ['data-header-row', 'data-banded-rows', 'data-total-row'].map((name) => table.hasAttribute(name)); }""", table_id)
    check(style == [True, True, True], f"header, bands and the Mediana total row: {style}")
    check(page.evaluate(LINE_ALIGN, [table_id, 2, 1]) == "right", "numbers on the right")
    page.mouse.click(*slide_to_screen(page, *page.evaluate(CELL_CENTER, [table_id, 2, 2])))
    page.keyboard.press("End")
    page.keyboard.type("!")
    check(texts()[2].split("|")[2] == "8,9x!", f"still editable: {texts()[2]}")

    # The saved file on its own shows the table.
    player, errors = play_saved_deck(browser, saved)
    player.keyboard.press("ArrowRight")
    drawn = rendered_text(player, 'section.slide[data-slide-id="s2"]')
    for expected in ["Aaaa Aaaaa S.A.", "2.500", "(3,5%)", "18,4%"]:
        check(expected in drawn, f"the saved deck shows {expected!r}: {drawn[:300]!r}")
    check(errors == [] and editor.errors == [], f"no errors: {errors} {editor.errors}")
    player.context.close()
    editor.close()


# Test pictures drawn on a canvas in the page (fake data): a photo-like noise and a flat logo with text, as PNG bytes.
DRAW_PICTURE = """([kind, width, height]) => {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    if (kind === 'noise') {
        for (let y = 0; y < height; y += 4) for (let x = 0; x < width; x += 4) {
            context.fillStyle = 'rgb(' + [0, 1, 2].map(() => Math.floor(Math.random() * 256)).join(',') + ')';
            context.fillRect(x, y, 4, 4);
        }
    } else {
        context.fillStyle = '#ffffff'; context.fillRect(0, 0, width, height);
        context.fillStyle = '#1F2A44'; context.fillRect(10, 10, 80, 80);
        context.font = 'bold 40px sans-serif'; context.fillText('ACME', 110, 65);
    }
    return canvas.toDataURL('image/png').split(',')[1];
}"""


def picture_file(page, name, kind, width, height):
    path = OUTPUT / name
    path.write_bytes(base64.b64decode(page.evaluate(DRAW_PICTURE, [kind, width, height])))
    return path


PICTURE_INFO = """id => { const img = App.deck.getDocument().querySelector('[data-id="' + id + '"]');
    return { type: img.getAttribute('data-type'), src: img.src.slice(0, 22), natural: [img.naturalWidth, img.naturalHeight],
             rect: App.transform.readRect(img) }; }"""


def test_insert_picture(browser):
    """Insert > Pictures: made smaller on the way in (1920 px, the smaller of PNG and JPEG), centred, one undo step;
    a picture's corner keeps its proportions; the deck size in the status bar follows."""
    editor = Editor(browser)
    editor.open(CONTRACT)
    page = editor.page
    photo = picture_file(page, "test-photo.png", "noise", 3000, 2000)
    logo = picture_file(page, "test-logo.png", "logo", 300, 100)
    size_text = lambda: page.text_content("#status-size")  # noqa: E731
    check(re.fullmatch(r"Deck \d+ KB", size_text() or ""), f"the deck size in the status bar: {size_text()}")
    before = size_text()
    page.evaluate("App.deck.goTo(5)")
    page.click(".ribbon-tab[data-tab='insert']")
    with page.expect_file_chooser() as chooser:
        page.click(".ribbon-button[data-command='insertPicture']")
    chooser.value.set_files([str(photo)])
    wait_until(page, "App.history.undoLabel() === 'Insert picture'")
    photo_id = page.evaluate("App.selection.selectedId()")
    info = page.evaluate(PICTURE_INFO, photo_id)
    check(info["type"] == "image" and info["src"] == "data:image/jpeg;base64" and info["natural"] == [1920, 1280],
          f"the 3000 x 2000 photo stored as a 1920 x 1280 JPEG: {info}")
    check(info["rect"] == {"left": 196, "top": 64, "width": 888, "height": 592}, f"centred, fitting the slide: {info['rect']}")

    # A picture's corner keeps its proportions.
    corner = page.locator("#overlay .selection-handle[data-handle='se']").bounding_box()
    drag(page, (corner["x"] + 4, corner["y"] + 4), (corner["x"] - 200, corner["y"] - 20))
    rect = element_rect(page, photo_id)
    check(abs(rect["width"] / rect["height"] - 1.5) < 0.01 and rect["width"] < 800, f"still 3:2, smaller: {rect}")

    # Two files at once: one undo step; the flat logo stays PNG at its own size.
    page.keyboard.press("Control+z")
    page.keyboard.press("Control+z")
    check(page.evaluate("id => !App.deck.getDocument().querySelector('[data-id=\"' + id + '\"]')", photo_id), "undone")
    with page.expect_file_chooser() as chooser:
        page.click(".ribbon-button[data-command='insertPicture']")
    chooser.value.set_files([str(photo), str(logo)])
    wait_until(page, "App.history.undoLabel() === 'Insert pictures'")
    logo_info = page.evaluate(PICTURE_INFO, page.evaluate("App.selection.selectedId()"))
    check(logo_info["src"] == "data:image/png;base64," and logo_info["natural"] == [300, 100] and
          logo_info["rect"]["width"] == 300, f"the logo: PNG, 300 x 100: {logo_info}")
    page.screenshot(path=str(OUTPUT / "50-pictures.png"))

    # The deck size follows (a moment after the change), close to the saved file's size.
    wait_until(page, "t => document.getElementById('status-size').textContent !== t", arg=before)
    shown = float(re.search(r"([\d.]+) (KB|MB)", size_text()).group(1)) * (1024 if "KB" in size_text() else 1024 * 1024)
    saved = editor.save_as_download("pictures-saved.html")
    check(abs(shown - saved.stat().st_size) / saved.stat().st_size < 0.05, f"{size_text()} vs {saved.stat().st_size} bytes saved")
    check(editor.errors == [], f"no errors: {editor.errors}")


def put_picture_on_clipboard(page, kind, width, height, html=None, text=None):
    """A picture on the system clipboard, as Win+Shift+S puts a screenshot there; html / text too, as Excel copies cells."""
    page.evaluate("""async ([draw, html, text]) => {
        const blob = new Blob([Uint8Array.from(atob(draw), (c) => c.charCodeAt(0))], { type: 'image/png' });
        const item = { 'image/png': blob };
        if (html !== null) item['text/html'] = new Blob([html], { type: 'text/html' });
        if (text !== null) item['text/plain'] = new Blob([text], { type: 'text/plain' });
        await navigator.clipboard.write([new ClipboardItem(item)]);
    }""", [page.evaluate(DRAW_PICTURE, [kind, width, height]), html, text])


DROP_FILES = """([files, type]) => {
    const transfer = new DataTransfer();
    files.forEach(([name, mime, base64]) => {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        transfer.items.add(new File([bytes], name, { type: mime }));
    });
    const target = App.deck.getDocument().defaultView;
    target.dispatchEvent(new DragEvent(type, { dataTransfer: transfer, cancelable: true }));
}"""


def test_paste_and_drop_pictures(browser):
    """Ctrl+V of a screenshot, a picture dropped on the slide; Excel's cells stay a table (their picture is ignored);
    a picture pasted while typing becomes its own picture; our own newer copy still wins."""
    context = browser.new_context(viewport={"width": 1440, "height": 900}, accept_downloads=True)
    context.grant_permissions(["clipboard-read", "clipboard-write"])
    editor = Editor(browser, context)
    editor.open(CONTRACT)
    page = editor.page
    selected = lambda: page.evaluate("App.selection.selectedId()")  # noqa: E731
    label = lambda: page.evaluate("App.history.undoLabel()")  # noqa: E731
    page.evaluate("App.deck.goTo(4)")
    page.mouse.click(*slide_to_screen(page, 640, 500))   # empty slide space

    # A screenshot (Win+Shift+S): Ctrl+V puts it in the middle of the slide, one undo step.
    put_picture_on_clipboard(page, "logo", 300, 100)
    page.keyboard.press("Control+v")
    wait_until(page, "App.history.undoLabel() === 'Paste picture'")
    shot = page.evaluate(PICTURE_INFO, selected())
    check(shot["type"] == "image" and shot["src"] == "data:image/png;base64," and
          shot["rect"] == {"left": 490, "top": 310, "width": 300, "height": 100}, f"the screenshot, centred: {shot}")

    # Our own copy, newer than the screenshot, wins; a screenshot taken after it wins again.
    page.keyboard.press("Control+c")
    page.keyboard.press("Control+v")
    check(label() == "Paste" and page.evaluate(PICTURE_INFO, selected())["rect"]["left"] != 490, "our copy pasted")
    put_picture_on_clipboard(page, "logo", 200, 100)
    page.keyboard.press("Control+v")
    wait_until(page, "App.history.undoLabel() === 'Paste picture'")
    check(page.evaluate(PICTURE_INFO, selected())["natural"] == [200, 100], "the newer screenshot")

    # Excel copies cells as a table and as a picture of them: the table wins.
    comps = clipboard_fixture("excel-comps")
    page.keyboard.press("Escape")
    put_picture_on_clipboard(page, "logo", 400, 150, comps["text/html"], comps["text/plain"])
    page.keyboard.press("Control+v")
    check(label() == "Paste table", f"Excel's cells pasted as a table: {label()}")
    page.keyboard.press("Control+z")

    # A picture pasted while typing becomes its own picture; the text is untouched.
    page.evaluate("App.selection.select(App.deck.getDocument().querySelector('[data-id=\"e15\"]'))")
    before = page.evaluate("App.deck.getDocument().querySelector('[data-id=\"e15\"]').innerHTML")
    page.keyboard.press("Enter")
    check(page.evaluate("App.text.isEditing()"), "typing in e15")
    pictures = "App.deck.getCurrentSlide().querySelectorAll('img').length"
    count = page.evaluate(pictures)
    put_picture_on_clipboard(page, "logo", 300, 100)
    page.keyboard.press("Control+v")
    wait_until(page, f"{pictures} === {count + 1}")
    check(not page.evaluate("App.text.isEditing()") and page.evaluate(PICTURE_INFO, selected())["type"] == "image",
          "typing ended, the picture is selected")
    check(page.evaluate("App.deck.getDocument().querySelector('[data-id=\"e15\"]').innerHTML") == before, "the text is as it was")

    # Dropped on the slide: the drop zone says so; a file that is not a picture is named.
    photo = ["photo.png", "image/png", page.evaluate(DRAW_PICTURE, ["noise", 3000, 2000])]
    notes = ["notes.pdf", "application/pdf", base64.b64encode(b"%PDF-1.4 fake").decode()]
    page.evaluate(DROP_FILES, [[photo, notes], "dragover"])
    check(page.text_content("#drop-zone") == "Drop to put the picture on this slide", page.text_content("#drop-zone"))
    page.screenshot(path=str(OUTPUT / "51-drop-picture.png"))
    page.evaluate(DROP_FILES, [[photo, notes], "drop"])
    wait_until(page, "App.history.undoLabel() === 'Insert picture'")
    dropped = page.evaluate(PICTURE_INFO, selected())
    check(dropped["src"] == "data:image/jpeg;base64" and dropped["natural"] == [1920, 1280], f"compressed: {dropped}")
    check(page.is_hidden("#drop-zone"), "the drop zone hidden again")
    check("notes.pdf" in page.text_content("#status-message"), f"the PDF named: {page.text_content('#status-message')}")
    page.screenshot(path=str(OUTPUT / "52-pictures-pasted-and-dropped.png"))

    # An .html file dragged in still opens as a deck.
    page.evaluate(DROP_FILES, [[["deck.html", "text/html", base64.b64encode(b"<p>x</p>").decode()]], "dragover"])
    check(page.text_content("#drop-zone") == "Drop the .html deck to open it", page.text_content("#drop-zone"))
    page.evaluate("window.dispatchEvent(new DragEvent('dragleave', { relatedTarget: null }))")
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


def test_picture_format(browser):
    """Picture Format tab (only with a picture selected): Reset size, Change Picture (fits inside the old box, centred,
    keeps its id and place in the stacking order), also from the right-click menu; each one undo step."""
    editor = Editor(browser)
    editor.open(CONTRACT)
    page = editor.page
    photo = picture_file(page, "test-photo.png", "noise", 3000, 2000)
    logo = picture_file(page, "test-logo.png", "logo", 300, 100)
    tab = ".ribbon-tab[data-tab='picture-format']"
    run = lambda command: page.click(f".ribbon-button[data-command='{command}']")  # noqa: E731
    page.evaluate("App.deck.goTo(5)")
    check(page.is_hidden(tab), "no Picture Format tab without a picture")
    page.click(".ribbon-tab[data-tab='insert']")
    with page.expect_file_chooser() as chooser:
        run("insertPicture")
    chooser.value.set_files([str(photo)])
    wait_until(page, "App.history.undoLabel() === 'Insert picture'")
    picture = page.evaluate("App.selection.selectedId()")
    check(page.is_visible(tab), "a picture selected: the Picture Format tab shows")
    page.click(tab)

    # Stretched by a side handle, then Reset size: the size it came in with, around the same centre.
    side = page.locator("#overlay .selection-handle[data-handle='e']").bounding_box()
    drag(page, (side["x"] + 4, side["y"] + 4), (side["x"] - 300, side["y"] + 4))
    stretched = element_rect(page, picture)
    check(stretched["width"] < 600 and stretched["height"] == 592, f"stretched: {stretched}")
    run("resetPictureSize")
    centre = (stretched["left"] + stretched["width"] / 2, stretched["top"] + stretched["height"] / 2)
    check(element_rect(page, picture) == {"left": max(0, round(centre[0] - 444, 2)), "top": 64, "width": 888, "height": 592},
          f"reset around its centre {centre}, inside the slide: {element_rect(page, picture)}")
    check(page.evaluate("App.history.undoLabel()") == "Reset size", "one undo step")

    # Change Picture: the logo fits inside the old box, centred; same id, same z-index; one Ctrl+Z gives the photo back.
    box = element_rect(page, picture)
    z = page.evaluate("id => App.deck.getDocument().querySelector('[data-id=\"' + id + '\"]').style.zIndex", picture)
    with page.expect_file_chooser() as chooser:
        run("changePicture")
    chooser.value.set_files([str(logo)])
    wait_until(page, "App.history.undoLabel() === 'Change picture'")
    info = page.evaluate(PICTURE_INFO, picture)
    check(info["natural"] == [300, 100] and info["src"] == "data:image/png;base64,", f"the logo: {info}")
    check(info["rect"] == {"left": box["left"], "top": 212, "width": 888, "height": 296}, f"inside the old box: {info['rect']}")
    check(page.evaluate("App.selection.selectedId()") == picture and
          page.evaluate("id => App.deck.getDocument().querySelector('[data-id=\"' + id + '\"]').style.zIndex", picture) == z,
          "same element, same place in the stacking order")
    page.screenshot(path=str(OUTPUT / "53-picture-format.png"))
    page.keyboard.press("Control+z")
    check(page.evaluate(PICTURE_INFO, picture)["natural"] == [1920, 1280] and element_rect(page, picture) == box,
          "one undo: the photo back")

    # The right-click menu has Change Picture; a file the browser cannot show leaves the picture as it was.
    centre_on_screen = slide_to_screen(page, box["left"] + 100, box["top"] + 100)
    page.mouse.click(*centre_on_screen, button="right")
    with page.expect_file_chooser() as chooser:
        page.click(".context-menu .menu-item:has-text('Change Picture')")
    broken = OUTPUT / "broken.png"
    broken.write_bytes(b"not a picture")
    chooser.value.set_files([str(broken)])
    wait_until(page, "document.getElementById('status-message').textContent.indexOf('broken.png') !== -1")
    check(page.evaluate(PICTURE_INFO, picture)["natural"] == [1920, 1280], "the photo kept")

    # Another kind of element: no Picture Format tab.
    page.evaluate("App.selection.select(App.deck.getDocument().querySelector('[data-id=\"e16\"]'))")
    check(page.is_hidden(tab), "a text box selected: the tab goes away")
    check(editor.errors == [], f"no errors: {editor.errors}")


def test_crop_picture(browser):
    """Picture Format > Crop: black crop handles, the cut-away part dimmed; Enter, Esc, a click elsewhere or Crop again
    applies it as a true crop (the stored picture keeps only the kept pixels); one undo step."""
    editor = Editor(browser)
    editor.open(CONTRACT)
    page = editor.page
    logo = picture_file(page, "test-logo.png", "logo", 300, 100)
    run = lambda command: page.click(f".ribbon-button[data-command='{command}']")  # noqa: E731
    page.evaluate("App.deck.goTo(5)")
    page.click(".ribbon-tab[data-tab='insert']")
    with page.expect_file_chooser() as chooser:
        run("insertPicture")
    chooser.value.set_files([str(logo)])
    wait_until(page, "App.history.undoLabel() === 'Insert picture'")
    picture = page.evaluate("App.selection.selectedId()")
    check(element_rect(page, picture) == {"left": 490, "top": 310, "width": 300, "height": 100}, "the logo, centred")
    page.click(".ribbon-tab[data-tab='picture-format']")

    # Crop mode: 8 black handles on the picture's edges, the selection handles gone.
    run("cropPicture")
    check(page.locator("#overlay .crop-handle:visible").count() == 8 and page.is_hidden("#overlay .selection-handle[data-handle='e']"),
          "crop handles instead of the selection handles")
    check(page.get_attribute(".ribbon-button[data-command='cropPicture']", "aria-pressed") == "true", "Crop shows it is on")
    handle = lambda name: page.locator(f"#overlay .crop-handle[data-crop-handle='{name}']").bounding_box()  # noqa: E731
    centre = lambda box: (box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)  # noqa: E731
    zoom = page.evaluate("App.canvas.getZoom()")
    east = centre(handle("e"))
    drag(page, east, (east[0] - 200 * zoom, east[1]))   # keep the dark square: the left 100 px
    north = centre(handle("n"))
    drag(page, north, (north[0], north[1] + 10 * zoom))
    check(page.evaluate("App.history.undoLabel()") == "Insert picture", "nothing changes before the crop is applied")
    page.screenshot(path=str(OUTPUT / "54-crop-mode.png"))
    page.keyboard.press("Enter")
    check(page.locator("#overlay .crop-handle:visible").count() == 0, "Enter: crop mode ends")
    info = page.evaluate(PICTURE_INFO, picture)
    rect = {k: round(v) for k, v in info["rect"].items()}
    check(rect == {"left": 490, "top": 320, "width": 100, "height": 90}, f"the kept part, where it was: {info['rect']}")
    wait_until(page, "id => App.deck.getDocument().querySelector('[data-id=\"' + id + '\"]').naturalWidth === 100", arg=picture)
    info = page.evaluate(PICTURE_INFO, picture)
    check(info["natural"] == [100, 90] and info["src"] == "data:image/png;base64,",
          f"a true crop: the stored picture is only 100 x 90 pixels: {info}")
    check(page.evaluate("App.history.undoLabel()") == "Crop", "one undo step")
    page.screenshot(path=str(OUTPUT / "55-cropped.png"))
    page.keyboard.press("Control+z")
    wait_until(page, "id => App.deck.getDocument().querySelector('[data-id=\"' + id + '\"]').naturalWidth === 300", arg=picture)

    # A click elsewhere applies it too; Crop with nothing moved changes nothing.
    run("cropPicture")
    west = centre(handle("w"))
    drag(page, west, (west[0] + 50 * zoom, west[1]))
    page.mouse.click(*slide_to_screen(page, 640, 650))   # empty slide space
    check(page.locator("#overlay .crop-handle:visible").count() == 0 and page.evaluate("App.history.undoLabel()") == "Crop",
          "a click on the slide applied the crop")
    check(round(element_rect(page, picture)["left"]) == 540, f"cropped from the left: {element_rect(page, picture)}")
    page.evaluate("id => App.selection.select(App.deck.getDocument().querySelector('[data-id=\"' + id + '\"]'))", picture)
    state = page.evaluate("App.history.stateId()")
    page.click(".ribbon-tab[data-tab='picture-format']")
    run("cropPicture")
    page.keyboard.press("Escape")
    check(page.locator("#overlay .crop-handle:visible").count() == 0 and page.evaluate("App.selection.selectedId()") == picture,
          "Esc ends crop mode, the picture stays selected")
    run("cropPicture")
    run("cropPicture")
    check(page.locator("#overlay .crop-handle:visible").count() == 0, "Crop again ends it")
    check(page.evaluate("App.history.stateId()") == state, "nothing moved: no undo step")
    check(editor.errors == [], f"no errors: {editor.errors}")


SHAPE_INFO = """id => { const el = App.deck.getDocument().querySelector('[data-id="' + id + '"]');
    return { kind: el.getAttribute('data-shape'), flip: el.getAttribute('data-flip') || '', rect: App.transform.readRect(el),
             paths: Array.from(el.querySelectorAll('svg path'), (p) => p.getAttribute('d')),
             fill: getComputedStyle(el.querySelector('svg path')).fill }; }"""


def test_insert_shapes(browser):
    """Insert > Shapes: a gallery of 8 kinds; drag to draw (Shift: square, or lines at 45 degrees), a plain click gives
    the default size; accent fill, no outline; one undo step each; a resize redraws the shape; saved and reopened."""
    editor = Editor(browser)
    editor.open(CONTRACT)
    page = editor.page
    selected = lambda: page.evaluate("App.selection.selectedId()")  # noqa: E731
    info = lambda: page.evaluate(SHAPE_INFO, selected())  # noqa: E731
    page.evaluate("App.deck.goTo(4)")   # slide 5: room under its text
    page.click(".ribbon-tab[data-tab='insert']")

    def pick(kind):
        page.click(".ribbon-button.shapes-button")
        page.click(f".shape-gallery-item[data-shape='{kind}']")

    page.click(".ribbon-button.shapes-button")
    check(page.locator(".shape-gallery-item").count() == 8, "8 shapes in the gallery")
    page.screenshot(path=str(OUTPUT / "56-shapes-gallery.png"))
    page.keyboard.press("Escape")
    check(page.locator(".shape-gallery").count() == 0, "Esc closes the gallery")

    # Drag to draw a chevron: where the mouse went, accent fill, one undo step, selected.
    pick("chevron")
    drag(page, slide_to_screen(page, 200, 450), slide_to_screen(page, 400, 530))
    chevron = info()
    rect = {k: round(v) for k, v in chevron["rect"].items()}
    check(chevron["kind"] == "chevron" and rect == {"left": 200, "top": 450, "width": 200, "height": 80}, f"drawn: {chevron}")
    accent = page.evaluate("getComputedStyle(App.deck.getDocument().documentElement).getPropertyValue('--color-accent').trim()")
    check(chevron["fill"] == "rgb(31, 42, 68)" and accent.lower() == "#1f2a44", f"the deck's accent: {chevron['fill']}")
    check(page.evaluate("App.history.undoLabel()") == "Insert shape", "one undo step")
    check(page.text_content("#status-message") == "", "the drawing hint is gone")
    chevron_id = selected()

    # A plain click: the default size, its corner at the click.
    pick("rect")
    page.mouse.click(*slide_to_screen(page, 600, 450))
    check(info()["rect"] == {"left": 600, "top": 450, "width": 160, "height": 120}, f"default rectangle: {info()['rect']}")

    # Shift keeps an oval round.
    pick("ellipse")
    page.keyboard.down("Shift")
    drag(page, slide_to_screen(page, 820, 450), slide_to_screen(page, 920, 480))
    page.keyboard.up("Shift")
    oval = {k: round(v) for k, v in info()["rect"].items()}
    check(oval["width"] == oval["height"] == 100, f"a circle: {oval}")

    # A line drawn up-right keeps its direction; Shift lays an arrow flat, and a 0 px tall arrow can still be clicked.
    pick("line")
    drag(page, slide_to_screen(page, 100, 650), slide_to_screen(page, 300, 600))
    line = info()
    check(line["flip"] == "y" and line["paths"][0].startswith("M0 ") and line["paths"][0].endswith(" 0"), f"up-right: {line}")
    pick("arrow")
    page.keyboard.down("Shift")
    drag(page, slide_to_screen(page, 400, 650), slide_to_screen(page, 600, 643))
    page.keyboard.up("Shift")
    arrow_id = selected()
    check(info()["rect"]["height"] == 0 and len(info()["paths"]) == 2, f"a flat arrow with its head: {info()}")
    page.keyboard.press("Escape")
    page.mouse.click(*slide_to_screen(page, 500, 652))
    check(selected() == arrow_id, "clicked 2 px beside the arrow: selected")
    page.screenshot(path=str(OUTPUT / "57-shapes-drawn.png"))

    # Esc cancels a shape picked from the gallery.
    pick("pentagon")
    page.keyboard.press("Escape")
    page.mouse.click(*slide_to_screen(page, 1000, 600))
    check(selected() is None and page.evaluate("App.deck.getCurrentSlide().querySelectorAll('[data-shape=\"pentagon\"]').length") == 0,
          "nothing drawn after Esc")

    # A resize redraws the chevron at its new size (its point stays half its height).
    page.evaluate("id => App.selection.select(App.deck.getDocument().querySelector('[data-id=\"' + id + '\"]'))", chevron_id)
    side = page.locator("#overlay .selection-handle[data-handle='e']").bounding_box()
    drag(page, (side["x"] + 4, side["y"] + 4), (side["x"] + 4 + 100 * page.evaluate("App.canvas.getZoom()"), side["y"] + 4))
    resized = info()
    width = App_round(resized["rect"]["width"])
    check(width == 300 and resized["paths"][0].startswith(f"M0 0H{App_round(resized['rect']['width'] - 40)}L"), f"redrawn: {resized}")

    # Saved and reopened: the shapes are still there, drawn the same.
    before = page.evaluate("Array.from(App.deck.getCurrentSlide().querySelectorAll('[data-shape]'), (el) => el.outerHTML)")
    saved = editor.save_as_download("shapes-saved.html")
    editor.open(saved)
    page.evaluate("App.deck.goTo(4)")
    after = page.evaluate("Array.from(App.deck.getCurrentSlide().querySelectorAll('[data-shape]'), (el) => el.outerHTML)")
    check(len(before) == 5 and after == before, f"the same shapes after reopening: {len(after)}")
    check(editor.errors == [], f"no errors: {editor.errors}")


SHAPE_LOOK = "id => App.shapes.lookOf(App.deck.getDocument().querySelector('[data-id=\"' + id + '\"]'))"


def test_shape_format(browser):
    """Shape Format tab (only with a shape selected) and the Format pane's Fill & line: fill, outline colour, width,
    dashes, transparency, shadow; each one undo step; a line's colour also colours its arrow head; saved and reopened."""
    editor = Editor(browser)
    editor.open(CONTRACT)
    page = editor.page
    tab = ".ribbon-tab[data-tab='shape-format']"
    look = lambda: page.evaluate(SHAPE_LOOK, shape)  # noqa: E731
    label = lambda: page.evaluate("App.history.undoLabel()")  # noqa: E731
    page.evaluate("App.deck.goTo(4)")
    check(page.is_hidden(tab), "no Shape Format tab without a shape")
    page.click(".ribbon-tab[data-tab='insert']")
    page.click(".ribbon-button.shapes-button")
    page.click(".shape-gallery-item[data-shape='chevron']")
    page.mouse.click(*slide_to_screen(page, 300, 450))
    shape = page.evaluate("App.selection.selectedId()")
    check(page.is_visible(tab) and page.is_visible("#format-shape"), "a shape selected: the tab and the pane's Fill & line")
    page.click(tab)

    # Fill and outline colours from the lists; width and dash from theirs; each one step.
    page.click(".shape-fill-menu-button")
    page.click(".shape-fill-menu .color-swatch[title='Dark Red']")
    check(look()["fill"] == "#c00000" and label() == "Shape fill", f"filled dark red: {look()}")
    page.click(".shape-outline-menu-button")
    page.click(".shape-outline-menu .color-swatch[title='Dark Blue']")
    check(look()["outline"] == "#002060" and look()["width"] == 2, f"a 2 px dark blue outline: {look()}")
    page.click(".list-button.shape-weight")
    page.click(".shape-weight-menu .menu-item:has-text('4 px')")
    page.click(".list-button.shape-dash")
    page.click(".shape-dash-menu .menu-item:has-text('Dashed')")
    check(look()["width"] == 4 and look()["dash"] == "dash" and label() == "Shape outline dash", f"4 px dashes: {look()}")
    page.click(".list-button.shape-transparency")
    page.click(".shape-transparency-menu .menu-item:has-text('50%')")
    run_shadow = ".ribbon-button[data-command='shapeShadow']"
    page.click(run_shadow)
    check(look()["transparency"] == 50 and look()["shadow"] is True and page.get_attribute(run_shadow, "aria-pressed") == "true",
          f"half transparent, with a shadow: {look()}")
    page.screenshot(path=str(OUTPUT / "58-shape-format.png"))
    for _ in range(2):
        page.keyboard.press("Control+z")
    check(look()["transparency"] == 0 and look()["shadow"] is False and look()["dash"] == "dash", f"two undos: {look()}")

    # The Format pane: transparency and width typed, dash and shadow picked; the ribbon's "No Fill".
    page.fill("#format-shape-transparency", "25")
    page.keyboard.press("Enter")
    page.fill("#format-shape-width", "6")
    page.keyboard.press("Enter")
    check(page.input_value("#format-shape-width") == "6", f"the field shows the new width: {page.input_value('#format-shape-width')!r}")
    page.select_option("#format-shape-dash", "dot")
    page.check("#format-shape-shadow")
    check(look() == {"fill": "#c00000", "outline": "#002060", "width": 6, "dash": "dot", "transparency": 25, "shadow": True},
          f"from the pane: {look()}")
    check(page.input_value("#format-shape-width") == "6" and page.input_value("#format-shape-dash") == "dot", "the pane shows it")
    page.click(".shape-fill-menu-button")
    page.click(".shape-fill-menu .menu-item:has-text('No Fill')")
    check(look()["fill"] == "none", f"no fill: {look()}")

    # An arrow: no fill; its colour goes to the head too.
    page.click(".ribbon-tab[data-tab='insert']")
    page.click(".ribbon-button.shapes-button")
    page.click(".shape-gallery-item[data-shape='arrow']")
    page.mouse.click(*slide_to_screen(page, 700, 650))
    shape = page.evaluate("App.selection.selectedId()")
    page.click(tab)
    check(page.is_disabled("#ribbon-panel .color-main[data-command='shapeFill']"), "a line has no fill")
    page.click(".shape-outline-menu-button")
    page.click(".shape-outline-menu .color-swatch[title='Green']")
    heads = page.evaluate("id => Array.from(App.deck.getDocument().querySelectorAll('[data-id=\"' + id + '\"] path'), (p) => [p.style.stroke, p.style.fill])", shape)
    check(heads == [["rgb(0, 176, 80)", "none"], ["none", "rgb(0, 176, 80)"]], f"line and head green: {heads}")

    # Saved and reopened: the look is kept.
    before = page.evaluate("Array.from(App.deck.getCurrentSlide().querySelectorAll('[data-shape]'), (el) => el.outerHTML)")
    saved = editor.save_as_download("shape-format-saved.html")
    editor.open(saved)
    page.evaluate("App.deck.goTo(4)")
    after = page.evaluate("Array.from(App.deck.getCurrentSlide().querySelectorAll('[data-shape]'), (el) => el.outerHTML)")
    check(len(before) == 2 and after == before, "the same look after reopening")
    check(editor.errors == [], f"no errors: {editor.errors}")


SHAPE_TEXT = """id => { const text = App.deck.getDocument().querySelector('[data-id="' + id + '"] > .shape-text');
    const shape = text.parentElement.getBoundingClientRect();
    const line = text.firstElementChild.getBoundingClientRect();
    const style = getComputedStyle(text.firstElementChild);
    return { html: text.innerHTML, align: style.textAlign, color: style.color, weight: style.fontWeight,
             middle: Math.abs((line.top + line.bottom) / 2 - (shape.top + shape.bottom) / 2) < 2 }; }"""


def test_shape_text(browser):
    """Text inside shapes: double-click (or Enter) to type; centred both ways, white; one undo step; the Font buttons
    change all of a selected shape's text; lines take no text; saved and reopened."""
    editor = Editor(browser)
    editor.open(CONTRACT)
    page = editor.page
    editing = lambda: page.evaluate("App.text.isEditing()")  # noqa: E731
    page.evaluate("App.deck.goTo(4)")
    page.click(".ribbon-tab[data-tab='insert']")
    page.click(".ribbon-button.shapes-button")
    page.click(".shape-gallery-item[data-shape='chevron']")
    page.mouse.click(*slide_to_screen(page, 300, 450))
    shape = page.evaluate("App.selection.selectedId()")

    # Double-click: typing in it; Esc: the shape is selected again.
    page.mouse.dblclick(*slide_to_screen(page, 400, 490))
    check(editing() and page.evaluate("App.text.editingElement().classList.contains('shape-text')"), "typing in the chevron")
    page.keyboard.type("Diligência")
    page.keyboard.press("Escape")
    text = page.evaluate(SHAPE_TEXT, shape)
    check(not editing() and page.evaluate("App.selection.selectedId()") == shape, "Esc: the shape selected")
    check(text["html"] == '<p data-list="none" data-level="1">Diligência</p>', f"the text: {text['html']}")
    check(text["align"] == "center" and text["color"] == "rgb(255, 255, 255)" and text["middle"], f"centred, white: {text}")
    page.screenshot(path=str(OUTPUT / "59-shape-text.png"))

    # The Font buttons on a selected shape change all its text; Enter types in it again.
    page.click(".ribbon-tab[data-tab='home']")
    page.keyboard.press("Control+b")
    bold = page.evaluate(SHAPE_TEXT, shape)
    check(bold["weight"] == "700" and "Diligência" in bold["html"], f"all its text bold: {bold}")
    page.keyboard.press("Enter")
    page.keyboard.press("End")
    page.keyboard.type(" 2")
    page.keyboard.press("Escape")
    check("Diligência 2" in page.evaluate(SHAPE_TEXT, shape)["html"], f"Enter: typing again: {page.evaluate(SHAPE_TEXT, shape)}")
    page.keyboard.press("Control+z")
    check(page.evaluate(SHAPE_TEXT, shape)["html"] == '<p data-list="none" data-level="1">Diligência</p>', "one undo: the typing")

    # Find reaches the shape's text.
    page.keyboard.press("Control+f")
    page.keyboard.type("Diligência")
    page.keyboard.press("Enter")
    check(page.evaluate("App.text.isEditing() && App.text.editingElement().classList.contains('shape-text')"),
          "Ctrl+F finds the word in the shape")
    page.keyboard.press("Escape")
    page.evaluate("App.text.exitEdit()")

    # A line takes no text.
    page.click(".ribbon-tab[data-tab='insert']")
    page.click(".ribbon-button.shapes-button")
    page.click(".shape-gallery-item[data-shape='line']")
    page.mouse.click(*slide_to_screen(page, 700, 650))
    page.mouse.dblclick(*slide_to_screen(page, 800, 650))
    check(not editing(), "no typing in a line")

    # Saved and reopened.
    saved = editor.save_as_download("shape-text-saved.html")
    editor.open(saved)
    page.evaluate("App.deck.goTo(4)")
    kept = page.evaluate(SHAPE_TEXT, shape)
    check(kept["html"] == '<p data-list="none" data-level="1">Diligência</p>' and kept["weight"] == "700", f"kept: {kept}")
    check(editor.errors == [], f"no errors: {editor.errors}")


def dark_pixels(page, top_left, bottom_right):
    """How many pixels in that part of the window are dark (painted), counted from a real screenshot."""
    clip = {"x": top_left[0], "y": top_left[1], "width": bottom_right[0] - top_left[0], "height": bottom_right[1] - top_left[1]}
    png = base64.b64encode(page.screenshot(clip=clip)).decode()
    return page.evaluate("""(png) => new Promise((resolve) => {
        const image = new Image();
        image.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = image.width; canvas.height = image.height;
            const context = canvas.getContext('2d');
            context.drawImage(image, 0, 0);
            const data = context.getImageData(0, 0, image.width, image.height).data;
            let dark = 0;
            for (let i = 0; i < data.length; i += 4) if (data[i] + data[i + 1] + data[i + 2] < 300) dark++;
            resolve(dark);
        };
        image.src = 'data:image/png;base64,' + png;
    })""", png)


def handle_centre(page, name):
    box = page.locator(f"#overlay .selection-handle[data-handle='{name}']").bounding_box()
    return (box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)


def test_line_and_adjust_handles(browser):
    """A line or arrow has a handle at each end (Shift: 45 degrees round the other end), the yellow handle changes a
    chevron's point or a callout's tail; each drag is one undo step."""
    editor = Editor(browser)
    editor.open(CONTRACT)
    page = editor.page
    selected = lambda: page.evaluate("App.selection.selectedId()")  # noqa: E731
    info = lambda: page.evaluate(SHAPE_INFO, selected())  # noqa: E731
    rounded = lambda rect: {k: round(v) for k, v in rect.items()}  # noqa: E731
    label = lambda: page.evaluate("App.history.undoLabel()")  # noqa: E731
    page.evaluate("App.deck.goTo(4)")
    page.click(".ribbon-tab[data-tab='insert']")

    def insert(kind, start, end=None):
        page.click(".ribbon-button.shapes-button")
        page.click(f".shape-gallery-item[data-shape='{kind}']")
        if end:
            drag(page, slide_to_screen(page, *start), slide_to_screen(page, *end))
        else:
            page.mouse.click(*slide_to_screen(page, *start))

    # A line: two end handles, not the eight box handles.
    insert("arrow", (100, 650), (300, 600))
    check(page.is_visible("#overlay .selection-handle[data-handle='start']") and
          page.is_visible("#overlay .selection-handle[data-handle='end']") and
          page.is_hidden("#overlay .selection-handle[data-handle='e']"), "end handles instead of box handles")
    near = lambda a, b: abs(a[0] - b[0]) < 2 and abs(a[1] - b[1]) < 2  # noqa: E731
    check(near(handle_centre(page, "start"), slide_to_screen(page, 100, 650)) and
          near(handle_centre(page, "end"), slide_to_screen(page, 300, 600)), "on the line's ends")

    # The end dragged left past the start: the head goes with it; one undo step.
    drag(page, handle_centre(page, "end"), slide_to_screen(page, 50, 700))
    arrow = info()
    check(rounded(arrow["rect"]) == {"left": 50, "top": 650, "width": 50, "height": 50} and arrow["flip"] == "x",
          f"the end moved: {arrow}")
    check(arrow["paths"][1].startswith("M0 50L"), f"the head at the new end (bottom left): {arrow['paths']}")
    check(label() == "Move line end", f"one undo step: {label()}")
    page.keyboard.press("Control+z")
    check(rounded(info()["rect"]) == {"left": 100, "top": 600, "width": 200, "height": 50}, "undone")

    # Shift: the start snaps flat round the end.
    page.keyboard.down("Shift")
    drag(page, handle_centre(page, "start"), slide_to_screen(page, 100, 610))
    page.keyboard.up("Shift")
    check(rounded(info()["rect"]) == {"left": 100, "top": 600, "width": 200, "height": 0}, f"flat: {info()['rect']}")
    page.keyboard.press("Escape")   # no selection drawn over it
    drawn = dark_pixels(page, slide_to_screen(page, 150, 590), slide_to_screen(page, 250, 610))
    check(drawn > 50, f"a flat arrow is still drawn (an svg 0 px tall draws nothing): {drawn} dark pixels")
    page.mouse.click(*slide_to_screen(page, 200, 601))

    # A chevron's yellow handle: a deeper point.
    insert("chevron", (300, 450))
    check(near(handle_centre(page, "adjust"), slide_to_screen(page, 460, 450)), "the yellow handle at the start of the point")
    color = page.evaluate("getComputedStyle(document.querySelector(\"#overlay .selection-handle[data-handle='adjust']\")).backgroundColor")
    check(color == "rgb(255, 214, 0)", f"yellow: {color}")
    drag(page, handle_centre(page, "adjust"), slide_to_screen(page, 420, 450))
    check(info()["paths"][0] == "M0 0H120L200 40L120 80H0L80 40Z" and label() == "Adjust shape", f"a deeper point: {info()}")
    page.keyboard.press("Control+z")
    check(info()["paths"][0] == "M0 0H160L200 40L160 80H0L40 40Z", "undone")

    # A callout's yellow handle moves its tail's tip, even above the box.
    insert("callout", (700, 300))
    drag(page, handle_centre(page, "adjust"), slide_to_screen(page, 780, 260))
    callout = page.evaluate("id => App.deck.getDocument().querySelector('[data-id=\"' + id + '\"]').getAttribute('data-adjust')", selected())
    check(callout == "0.5 -0.3333", f"the tail points up: {callout}")
    page.screenshot(path=str(OUTPUT / "60-shape-handles.png"))
    check(editor.errors == [], f"no errors: {editor.errors}")


def test_phase5_done_when(browser):
    """
    Phase 5 "done when", automated: a process diagram of chevrons and a logo screenshot are built on a slide without
    leaving the editor: shapes drawn from Insert > Shapes, text typed in them, one step coloured from Shape Format, a
    screenshot pasted with Ctrl+V and placed from the Format pane; saved, reopened and shown by the saved file on its own.
    """
    context = browser.new_context(viewport={"width": 1440, "height": 900}, accept_downloads=True)
    context.grant_permissions(["clipboard-read", "clipboard-write"])
    editor = Editor(browser, context)
    page = editor.page
    page.evaluate("App.commands.run('newDeck')")   # File > New deck
    wait_until(page, "App.deck.getSlides().length === 2")
    started = time.time()

    # Slide 2: the body text box goes; the process takes its place.
    page.evaluate("App.deck.goTo(1)")
    page.mouse.click(*slide_to_screen(page, 600, 200))
    check(page.evaluate("App.selection.selectedId()") == "e6", "the body box selected")
    page.keyboard.press("Delete")
    page.click(".ribbon-tab[data-tab='insert']")
    steps = [("pentagon", "Diligência"), ("chevron", "Negociação"), ("chevron", "Assinatura"), ("chevron", "Fechamento")]
    ids = []
    for index, (kind, name) in enumerate(steps):
        left = 64 + index * 290
        page.click(".ribbon-button.shapes-button")
        page.click(f".shape-gallery-item[data-shape='{kind}']")
        drag(page, slide_to_screen(page, left, 300), slide_to_screen(page, left + 270, 380))
        ids.append(page.evaluate("App.selection.selectedId()"))
        page.mouse.dblclick(*slide_to_screen(page, left + 135, 340))
        page.keyboard.type(name)
        page.keyboard.press("Escape")

    # The last step stands out: Dark Red from Shape Format.
    page.click(".ribbon-tab[data-tab='shape-format']")
    page.click(".shape-fill-menu-button")
    page.click(".shape-fill-menu .color-swatch[title='Dark Red']")

    # The logo: a screenshot pasted, then placed top right from the Format pane.
    put_picture_on_clipboard(page, "logo", 300, 100)
    page.mouse.click(*slide_to_screen(page, 640, 600))   # empty slide space
    page.keyboard.press("Control+v")
    wait_until(page, "App.history.undoLabel() === 'Paste picture'")
    logo = page.evaluate("App.selection.selectedId()")
    for field, value in [("x", "1016"), ("y", "36"), ("w", "200"), ("h", "66.67")]:
        page.fill(f"#format-{field}", value)
        page.keyboard.press("Enter")
    elapsed = time.time() - started
    check(elapsed < 60, f"built in under a minute: {elapsed:.1f} s")
    page.keyboard.press("Escape")

    diagram = """ids => ids.map((id) => { const el = App.deck.getDocument().querySelector('[data-id="' + id + '"]');
        return [el.getAttribute('data-shape'), el.querySelector('.shape-text').textContent, App.shapes.lookOf(el).fill]; })"""
    expected = [["pentagon", "Diligência", "var(--color-accent, #1F2A44)"], ["chevron", "Negociação", "var(--color-accent, #1F2A44)"],
                ["chevron", "Assinatura", "var(--color-accent, #1F2A44)"], ["chevron", "Fechamento", "#c00000"]]
    check(page.evaluate(diagram, ids) == expected, f"the process: {page.evaluate(diagram, ids)}")
    check(element_rect(page, logo) == {"left": 1016, "top": 36, "width": 200, "height": 66.67}, f"the logo: {element_rect(page, logo)}")
    wait_until(page, """() => { const thumb = document.querySelector('.thumb[data-index="1"] iframe').contentDocument;
        return thumb.querySelectorAll('[data-shape]').length === 4 && !!thumb.querySelector('img.el'); }""")
    page.screenshot(path=str(OUTPUT / "61-phase5-done-when.png"))

    # Saved and reopened: the same diagram and logo, and the text can still be typed in.
    saved = editor.save_as_download("phase5-done-when.html")
    editor.open(saved)
    check(editor.report_dialog_text() is None, "a deck the editor saved opens without an import report")
    page.evaluate("App.deck.goTo(1)")
    check(page.evaluate(diagram, ids) == expected, "the process came back as saved")
    check(page.evaluate(PICTURE_INFO, logo)["natural"] == [300, 100], "the logo came back")
    page.mouse.dblclick(*slide_to_screen(page, 64 + 135, 340))
    page.keyboard.press("End")
    page.keyboard.type("!")
    page.keyboard.press("Escape")
    check(page.evaluate(diagram, ids)[0][1] == "Diligência!", "still editable")

    # The saved file on its own shows the diagram (painted, not only there) and the logo.
    player, errors = play_saved_deck(browser, saved)
    player.keyboard.press("ArrowRight")
    drawn = rendered_text(player, 'section.slide[data-slide-id="s2"]')
    for name in ["Diligência", "Negociação", "Assinatura", "Fechamento"]:
        check(name in drawn, f"the saved deck shows {name!r}: {drawn[:300]!r}")
    box = player.locator('section.slide[data-slide-id="s2"] [data-shape="chevron"]').last.bounding_box()
    painted = dark_pixels(player, (box["x"], box["y"]), (box["x"] + box["width"], box["y"] + box["height"]))
    check(painted > box["width"] * box["height"] * 0.3, f"the dark red chevron is painted: {painted} dark pixels")
    shown = player.evaluate("() => document.querySelector('section.slide[data-slide-id=\"s2\"] img.el').naturalWidth")
    check(shown == 300, f"the logo is shown: {shown}")
    check(errors == [] and editor.errors == [], f"no errors: {errors} {editor.errors}")
    player.context.close()
    editor.close()


def chart_deck(name, charts):
    """The contract deck with its slide-4 chart replaced by `charts`: [(id, left, top, width, height, data)],
    as Copilot writes them (data, no drawing). Fake numbers only."""
    text = CONTRACT.read_text(encoding="utf-8")
    start = text.index('<figure class="el" data-type="chart" data-id="e12"')
    end = text.index("</figure>", start) + len("</figure>")
    figures = "".join(
        f'<figure class="el" data-type="chart" data-id="{id_}" style="left:{left}px; top:{top}px; width:{width}px; '
        f'height:{height}px; z-index:{index + 2}; margin:0"><script type="application/json" class="chart-data">'
        f'{json.dumps(data, ensure_ascii=False)}</script></figure>'
        for index, (id_, left, top, width, height, data) in enumerate(charts))
    path = OUTPUT / name
    path.write_text(text[:start] + figures + text[end:], encoding="utf-8")
    return path


CHART_BARS = """id => Array.from(App.deck.getDocument().querySelectorAll('[data-id="' + id + '"] svg rect.chart-bar'),
    (r) => [Number(r.getAttribute('width')), Number(r.getAttribute('height'))])"""


def test_chart_rendering(browser):
    """Charts drawn by the editor (Phase 6 step 1): a Copilot chart (data, no drawing) is drawn on open as columns;
    a resize draws it again at the new size (the text keeps its size, nothing stretches); undo; horizontal bars."""
    revenue = {"version": 1, "type": "column", "categories": ["2022", "2023", "2024", "2025E"],
               "estimates": [False, False, False, True],
               "series": [{"name": "Receita (R$ mn)", "values": [410, 498, 587, 702]},
                          {"name": "EBITDA (R$ mn)", "values": [74, 100, 123, 161]}],
               "options": {"title": "Receita e EBITDA", "dataLabels": True, "locale": "pt-BR"}}
    ranking = {"version": 1, "type": "bar", "categories": ["Alfa", "Beta", "Gama"],
               "series": [{"name": "EV/EBITDA", "values": [9.8, 7.5, 11.2]}], "options": {"title": "Múltiplos"}}
    deck = chart_deck("charts-deck.html", [("e12", 64, 130, 700, 440, revenue), ("e20", 800, 290, 420, 280, ranking)])
    editor = Editor(browser)
    editor.open(deck)
    report = editor.report_dialog_text() or ""
    check("2 charts had data but no drawing; the editor drew them from their data" in report, "drawn on open, reported")
    check("placeholder" not in report and "Phase 6" not in report, "no out-of-date placeholder wording")
    editor.close_dialog_if_open()
    page = editor.page
    page.evaluate("App.deck.goTo(3)")
    bars = page.evaluate(CHART_BARS, "e12")
    check(len(bars) == 8 and page.evaluate("document.querySelector('#deck-frame').contentDocument"
                                            ".querySelectorAll('[data-chart-placeholder]').length") == 0, f"8 columns, no placeholder: {bars}")
    labels = page.evaluate("Array.from(App.deck.getDocument().querySelectorAll('[data-id=\"e12\"] .chart-data-label'), (t) => t.textContent)")
    check("702" in labels and "161" in labels, f"data labels: {labels}")
    check(len(page.evaluate(CHART_BARS, "e20")) == 3, "three horizontal bars")
    page.screenshot(path=str(OUTPUT / "62-charts-drawn.png"))

    # A resize draws it again: wider bars, the same text size, the svg exactly the new size.
    font = "id => App.deck.getDocument().querySelector('[data-id=\"' + id + '\"] .chart-category-label').getAttribute('font-size')"
    page.mouse.click(*slide_to_screen(page, 300, 300))
    check(page.evaluate("App.selection.selectedId()") == "e12", "the chart selected")
    side = page.locator("#overlay .selection-handle[data-handle='e']").bounding_box()
    zoom = page.evaluate("App.canvas.getZoom()")
    drag(page, (side["x"] + 4, side["y"] + 4), (side["x"] + 4 - 200 * zoom, side["y"] + 4))
    width = element_rect(page, "e12")["width"]
    svg_width = page.evaluate("Number(App.deck.getDocument().querySelector('[data-id=\"e12\"] svg').getAttribute('width'))")
    check(round(width) == 500 and svg_width == round(width), f"drawn at the new width: {width} / svg {svg_width}")
    check(page.evaluate(font, "e12") == "14", "the text keeps its size")
    narrower = page.evaluate(CHART_BARS, "e12")
    check(narrower[0][0] < bars[0][0] and narrower[0][1] == bars[0][1], f"narrower bars, same heights: {narrower[0]} vs {bars[0]}")
    check(page.evaluate("App.deck.getDocument().querySelectorAll('[data-id=\"e12\"] svg').length") == 1, "one drawing")
    page.keyboard.press("Control+z")
    check(page.evaluate(CHART_BARS, "e12") == bars, "undo: as it was")
    check(editor.errors == [], f"no errors: {editor.errors}")


def test_chart_lines_combo_donut(browser):
    """Line, combo (a margin on a second % axis) and donut drawn in the editor; the Copilot sample's charts are drawn
    on open; a deck's own drawing is kept until the chart is resized."""
    margin = {"version": 1, "type": "line", "categories": ["2022", "2023", "2024", "2025E"],
              "estimates": [False, False, False, True],
              "series": [{"name": "Margem EBITDA", "values": [0.18, 0.2, 0.21, 0.23], "format": "percent"}],
              "options": {"title": "Margem", "dataLabels": True}}
    combo = {"version": 1, "type": "combo", "categories": ["2022", "2023", "2024", "2025E"],
             "estimates": [False, False, False, True],
             "series": [{"name": "Receita (R$ mn)", "type": "column", "axis": "primary", "values": [410, 498, 587, 702]},
                        {"name": "Margem EBITDA", "type": "line", "axis": "secondary", "values": [0.18, 0.2, 0.21, 0.23],
                         "format": "percent"}],
             "options": {"title": "Receita e margem", "legend": "bottom", "dataLabels": True, "locale": "pt-BR"}}
    owners = {"version": 1, "type": "donut", "categories": ["Fundo A", "Fundadores", "Outros"],
              "series": [{"name": "Participação", "values": [55, 30, 15]}], "options": {"title": "Acionistas"}}
    deck = chart_deck("charts-step2.html", [("e12", 40, 130, 640, 420, combo), ("e20", 700, 260, 540, 170, margin),
                                            ("e21", 700, 440, 540, 200, owners)])
    editor = Editor(browser)
    editor.open(deck)
    editor.close_dialog_if_open()
    page = editor.page
    page.evaluate("App.deck.goTo(3)")
    count = lambda id_, selector: page.evaluate(  # noqa: E731
        "([id, s]) => App.deck.getDocument().querySelectorAll('[data-id=\"' + id + '\"] ' + s).length", [id_, selector])
    check(count("e12", "rect.chart-bar") == 4 and count("e12", "path.chart-line") == 1 and
          count("e12", ".chart-value-label-secondary") >= 2, "combo: columns, a line, a % axis on the right")
    check(count("e20", "path.chart-line-estimate") == 1, "the line dashed into 2025E")
    check(count("e21", "path.chart-slice") == 3, "three slices")
    page.evaluate("document.getElementById('format-pane').scrollTop = 0")
    page.screenshot(path=str(OUTPUT / "63-line-combo-donut.png"))
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()

    # The Copilot sample: both its charts drawn on open (the waterfall from step 3).
    editor = Editor(browser)
    editor.open(APPENDIX_A)
    editor.close_dialog_if_open()
    page = editor.page
    kinds = page.evaluate("""() => Array.from(App.deck.getDocument().querySelectorAll('[data-type="chart"]'), (figure) =>
        [JSON.parse(figure.querySelector('script.chart-data').textContent).type,
         figure.querySelector('svg').hasAttribute('data-chart-placeholder')])""")
    check(sorted(kinds) == [["combo", False], ["waterfall", False]], f"both drawn, no placeholder: {kinds}")
    editor.close()

    # The sample deck's hand-drawn combo is kept on open; resized, the editor draws it.
    editor = Editor(browser)
    editor.open(CONTRACT)
    page = editor.page
    page.evaluate("App.deck.goTo(3)")
    own = "() => App.deck.getDocument().querySelector('[data-id=\"e12\"] svg').getAttribute('class')"
    check(page.evaluate(own) is None, "the deck's own drawing, kept")
    page.mouse.click(*slide_to_screen(page, 300, 300))
    side = page.locator("#overlay .selection-handle[data-handle='e']").bounding_box()
    drag(page, (side["x"] + 4, side["y"] + 4), (side["x"] - 40, side["y"] + 4))
    check(page.evaluate(own) == "chart-svg", "resized: drawn by the editor")
    check(editor.errors == [], f"no errors: {editor.errors}")


def test_chart_waterfall(browser):
    """The Copilot sample's EBITDA bridge (data, no roles): drawn on open as a waterfall, start and end in the accent,
    increases green, the decrease red, connectors between the bars, changes labelled +95 / -25."""
    editor = Editor(browser)
    editor.open(APPENDIX_A)
    editor.close_dialog_if_open()
    page = editor.page
    index = page.evaluate("""() => App.deck.getSlides().findIndex((slide) => Array.from(slide.querySelectorAll('script.chart-data'))
        .some((script) => JSON.parse(script.textContent).type === 'waterfall'))""")
    page.evaluate(f"App.deck.goTo({index})")
    bridge = page.evaluate("""() => { const svg = Array.from(App.deck.getCurrentSlide().querySelectorAll('[data-type="chart"]'))
            .find((figure) => /waterfall/.test(figure.querySelector('script.chart-data').textContent)).querySelector('svg');
        return { roles: Array.from(svg.querySelectorAll('rect.chart-bar'), (rect) => rect.getAttribute('data-role')),
                 connectors: svg.querySelectorAll('.chart-connector').length,
                 labels: Array.from(svg.querySelectorAll('.chart-data-label'), (label) => label.textContent) }; }""")
    check(bridge["roles"] == ["total", "increase", "increase", "decrease", "total"], f"start, changes, end: {bridge}")
    check(bridge["connectors"] == 4 and bridge["labels"] == ["240", "+95", "+30", "-25", "340"], f"connectors, labels: {bridge}")
    page.screenshot(path=str(OUTPUT / "64-waterfall.png"))
    check(editor.errors == [], f"no errors: {editor.errors}")


def test_chart_types_priority_2(browser):
    """The second-priority types drawn in the editor: 100% stacked column and bar, area, bubble (comps: growth vs
    EV/EBITDA, bubble = revenue, each company named)."""
    years = ["2022", "2023", "2024", "2025E"]
    mix = {"version": 1, "type": "stacked-column-100", "categories": years, "estimates": [False, False, False, True],
           "series": [{"name": "Varejo", "values": [120, 150, 170, 200]}, {"name": "Atacado", "values": [80, 70, 75, 70]}],
           "options": {"title": "Mix de receita", "dataLabels": True}}
    cumulative = {"version": 1, "type": "stacked-area", "categories": years,
                  "series": [{"name": "Brasil", "values": [100, 140, 190, 250]}, {"name": "Exterior", "values": [20, 35, 60, 90]}],
                  "options": {"title": "Receita acumulada"}}
    comps = {"version": 1, "type": "bubble", "categories": ["Alfa", "Beta", "Gama", "Delta"],
             "series": [{"name": "Crescimento", "values": [0.04, 0.09, 0.15, 0.12], "format": "percent"},
                        {"name": "EV/EBITDA", "values": [7.5, 9.8, 12.4, 8.9]},
                        {"name": "Receita", "values": [900, 400, 250, 600]}],
             "options": {"title": "Comparáveis"}}
    peers = {"version": 1, "type": "stacked-bar-100", "categories": ["Alfa", "Beta", "Gama"],
             "series": [{"name": "Dívida", "values": [30, 55, 20]}, {"name": "Equity", "values": [70, 45, 80]}],
             "options": {"title": "Estrutura de capital", "dataLabels": True}}
    deck = chart_deck("charts-step4.html", [("e12", 40, 120, 600, 290, mix), ("e20", 40, 420, 600, 280, cumulative),
                                            ("e21", 660, 260, 580, 230, comps), ("e22", 660, 500, 580, 200, peers)])
    editor = Editor(browser)
    editor.open(deck)
    editor.close_dialog_if_open()
    page = editor.page
    page.evaluate("App.deck.goTo(3)")
    count = lambda id_, selector: page.evaluate(  # noqa: E731
        "([id, s]) => App.deck.getDocument().querySelectorAll('[data-id=\"' + id + '\"] ' + s).length", [id_, selector])
    check(count("e12", "rect.chart-bar") == 8 and count("e20", "path.chart-area") == 2, "100% columns, two stacked areas")
    check(count("e21", "circle.chart-point") == 4 and count("e21", ".chart-axis-title") == 2, "four named bubbles, axis titles")
    check(count("e22", "rect.chart-bar") == 6, "100% bars")
    check(page.evaluate("App.deck.getDocument().querySelectorAll('[data-chart-placeholder]').length") == 0, "no placeholder left")
    page.screenshot(path=str(OUTPUT / "65-charts-priority-2.png"))
    check(editor.errors == [], f"no errors: {editor.errors}")


def test_chart_readability(browser):
    """Readability: a long category name wraps, crowded ones turn 45 degrees, long bar names wrap at the left; the CAGR
    arrow over a combo ("CAGR 19,6%") and a source line under it."""
    combo = {"version": 1, "type": "combo", "categories": ["2022", "2023", "2024", "2025E"],
             "estimates": [False, False, False, True],
             "series": [{"name": "Receita (R$ mn)", "type": "column", "values": [410, 498, 587, 702]},
                        {"name": "Margem EBITDA", "type": "line", "axis": "secondary", "values": [0.18, 0.2, 0.21, 0.23],
                         "format": "percent"}],
             "options": {"title": "Receita e margem", "dataLabels": True, "cagr": {"series": 0, "from": 0, "to": 3},
                         "source": "Fonte: empresa"}}
    bridge = {"version": 1, "type": "waterfall",
              "categories": ["EBITDA 2024", "Novos parques", "Eficiência", "Custos corporativos", "EBITDA 2026E"],
              "series": [{"name": "R$ mn", "values": [240, 95, 30, -25, 340]}], "options": {"title": "Ponte"}}
    months = {"version": 1, "type": "column", "categories": [f"{i}/2024" for i in range(1, 25)],
              "series": [{"name": "Vendas", "values": [10 + i for i in range(24)]}], "options": {"title": "Vendas mensais"}}
    peers = {"version": 1, "type": "bar", "categories": ["Companhia Alfa de Energia", "Beta", "Gama Participações S.A."],
             "series": [{"name": "EV/EBITDA", "values": [9.8, 7.5, 11.2]}], "options": {"title": "Múltiplos"}}
    deck = chart_deck("charts-step5.html", [("e12", 40, 120, 600, 340, combo), ("e20", 660, 260, 580, 220, bridge),
                                            ("e21", 40, 470, 600, 230, months), ("e22", 660, 490, 580, 210, peers)])
    editor = Editor(browser)
    editor.open(deck)
    editor.close_dialog_if_open()
    page = editor.page
    page.evaluate("App.deck.goTo(3)")
    read = lambda id_, script: page.evaluate(  # noqa: E731
        "([id, script]) => { const svg = App.deck.getDocument().querySelector('[data-id=\"' + id + '\"] svg'); return eval(script); }",
        [id_, script])
    check(read("e12", "svg.querySelector('.chart-cagr-label').textContent") == "CAGR 19,6%", "the CAGR arrow")
    check(read("e12", "svg.querySelector('.chart-source').textContent") == "Fonte: empresa", "the source line")
    check(read("e20", "Array.from(svg.querySelectorAll('.chart-category-label tspan'), (t) => t.textContent).join('|')") ==
          "Custos|corporativos", "the long bridge name on two lines")
    check(read("e21", "/rotate\\(-45/.test(svg.querySelector('.chart-category-label').getAttribute('transform'))"), "months turned")
    check(read("e22", "svg.querySelectorAll('.chart-category-label tspan').length") == 4, "two long company names on two lines")
    page.screenshot(path=str(OUTPUT / "66-chart-readability.png"))
    check(editor.errors == [], f"no errors: {editor.errors}")


CHART_DATA = "id => JSON.parse(App.deck.getDocument().querySelector('[data-id=\"' + id + '\"] script.chart-data').textContent)"
CHART_COUNT = "([id, s]) => App.deck.getDocument().querySelectorAll('[data-id=\"' + id + '\"] svg ' + s).length"


def test_insert_chart_and_design(browser):
    """Insert > Chart (15 types, made-up numbers, centred, one undo step) and Chart Design: type, data labels,
    gridlines, legend, CAGR; the Format pane's title, source and axis maximum; a waterfall's colours; saved, reopened."""
    editor = Editor(browser)
    editor.open(CONTRACT)
    page = editor.page
    tab = ".ribbon-tab[data-tab='chart-design']"
    label = lambda: page.evaluate("App.history.undoLabel()")  # noqa: E731
    page.evaluate("App.deck.goTo(4)")
    check(page.is_hidden(tab), "no Chart Design tab without a chart")
    page.click(".ribbon-tab[data-tab='insert']")
    page.click(".ribbon-button.chart-button")
    check(page.locator(".chart-gallery-item").count() == 15, "15 chart types")
    page.screenshot(path=str(OUTPUT / "67-chart-gallery.png"))
    page.click(".chart-gallery-item[data-chart-type='combo']")
    chart = page.evaluate("App.selection.selectedId()")
    data = lambda: page.evaluate(CHART_DATA, chart)  # noqa: E731
    count = lambda selector: page.evaluate(CHART_COUNT, [chart, selector])  # noqa: E731
    check(data()["type"] == "combo" and label() == "Insert chart" and count("rect.chart-bar") == 4 and count("path.chart-line") == 1,
          f"a combo with sample numbers: {data()}")
    check(element_rect(page, chart) == {"left": 240, "top": 150, "width": 800, "height": 450}, "centred")
    check(page.is_visible(tab) and page.is_visible("#format-chart"), "Chart Design and the pane's Chart section")
    page.click(tab)

    # The type: columns now; one Ctrl+Z gives the combo back.
    page.click(".list-button.chart-type")
    page.click(".chart-type-menu .menu-label:text-is('Clustered Column')")
    check(data()["type"] == "column" and count("path.chart-line") == 0 and label() == "Chart type", "now columns")
    page.keyboard.press("Control+z")
    check(data()["type"] == "combo", "undo: the combo again")

    # Chart elements.
    run = lambda command: page.click(f".ribbon-button[data-command='{command}']")  # noqa: E731
    run("chartDataLabels")
    check(count(".chart-data-label") > 0, "data labels on")
    run("chartGridlines")
    check(count(".chart-gridline") == 0, "gridlines off")
    page.click(".list-button.chart-legend")
    page.click(".chart-legend-menu .menu-label:text-is('Right')")
    check(data()["options"]["legend"] == "right", "legend at the right")
    run("chartCagr")
    check(page.evaluate("id => App.deck.getDocument().querySelector('[data-id=\"' + id + '\"] .chart-cagr-label').textContent", chart)
          == "CAGR 14,5%", "CAGR from 2022 to 2025E: (150 / 100) ^ (1/3) - 1")
    check(page.get_attribute(".ribbon-button[data-command='chartCagr']", "aria-pressed") == "true", "CAGR shows it is on")

    # The Format pane: typed options, one step each.
    for field, value in [("#format-chart-title", "Receita e margem"), ("#format-chart-source", "Fonte: empresa"),
                         ("#format-chart-max", "200")]:
        page.fill(field, value)
        page.keyboard.press("Enter")
    options = data()["options"]
    check(options["title"] == "Receita e margem" and options["source"] == "Fonte: empresa" and options["axisMax"] == 200,
          f"from the pane: {options}")
    values = page.evaluate("id => Array.from(App.deck.getDocument().querySelectorAll('[data-id=\"' + id + '\"] .chart-value-label'), (t) => t.textContent)", chart)
    check(values[-1] == "200", f"the axis up to 200: {values}")
    page.fill("#format-chart-max", "")
    page.keyboard.press("Enter")
    check("axisMax" not in data()["options"], "empty: automatic again")
    check(page.input_value("#format-chart-max") == "", f"the field shows it: {page.input_value('#format-chart-max')!r}")
    page.screenshot(path=str(OUTPUT / "68-chart-design.png"))

    # A waterfall: its increase colour.
    page.keyboard.press("Escape")
    page.click(".ribbon-tab[data-tab='insert']")
    page.click(".ribbon-button.chart-button")
    page.click(".chart-gallery-item[data-chart-type='waterfall']")
    bridge = page.evaluate("App.selection.selectedId()")
    page.click(tab)
    page.click(".waterfall-increase-menu-button")
    page.click(".waterfall-increase-menu .color-swatch[title='Blue']")
    style = page.evaluate("id => App.deck.getDocument().querySelector('[data-id=\"' + id + '\"] rect[data-role=\"increase\"]').getAttribute('style')", bridge)
    check("#0070c0" in style, f"increases blue: {style}")

    # Saved and reopened: the same data.
    before = {chart: data(), bridge: page.evaluate(CHART_DATA, bridge)}
    saved = editor.save_as_download("charts-design-saved.html")
    editor.open(saved)
    page.evaluate("App.deck.goTo(4)")
    check(page.evaluate(CHART_DATA, chart) == before[chart] and page.evaluate(CHART_DATA, bridge) == before[bridge], "kept")
    check(editor.errors == [], f"no errors: {editor.errors}")


def test_chart_grid_undo_in_cell(browser):
    """Ctrl+Z / Ctrl+Y in a grid cell are the editor's undo and redo: the whole typing in the cell goes back at once
    (not the text box's own undo, one digit at a time), and keys after the grid is closed raise no error."""
    revenue = {"version": 1, "type": "column", "categories": ["2022", "2023"],
               "series": [{"name": "Receita", "values": [410, 498]}],
               "options": {"title": "Receita", "dataLabels": True, "locale": "pt-BR"}}
    deck = chart_deck("chart-grid-undo-deck.html", [("e12", 64, 130, 700, 440, revenue)])
    editor = Editor(browser)
    editor.open(deck)
    editor.close_dialog_if_open()
    page = editor.page
    page.evaluate("App.deck.goTo(3)")
    cell = "#chart-data-grid input.cell[data-row='0'][data-col='0']"
    labels = lambda: page.evaluate(  # noqa: E731
        "[...App.deck.getDocument().querySelectorAll('[data-id=\"e12\"] .chart-data-label')].map((n) => n.textContent)")
    page.mouse.dblclick(*slide_to_screen(page, 300, 300))
    page.click(cell)
    page.keyboard.type("1234")
    check(labels() == ["1.234", "498"] and page.input_value(cell) == "1234", f"typed 1234: {labels()}")
    page.keyboard.press("Control+z")
    check(labels() == ["410", "498"] and page.input_value(cell) == "410", f"Ctrl+Z in the cell: all of 1234 back to 410: {labels()} / {page.input_value(cell)}")
    check(not page.evaluate("App.history.canUndo()"), "nothing left to undo")
    page.keyboard.press("Control+y")
    check(labels() == ["1.234", "498"] and page.input_value(cell) == "1234", f"Ctrl+Y in the cell: 1234 again: {labels()}")
    name = "#chart-data-grid input.series-name[data-col='0']"
    page.click(name)
    page.keyboard.type("Lucro")
    legend = lambda: page.evaluate(  # noqa: E731
        "App.charts.readData(App.deck.getDocument().querySelector('[data-id=\"e12\"]')).series[0].name")
    check(legend() == "Lucro", f"series renamed: {legend()}")
    page.keyboard.press("Control+z")
    check(legend() == "Receita" and page.input_value(name) == "Receita", f"Ctrl+Z in the series name: the whole name back: {legend()}")
    page.keyboard.press("Control+z")
    page.click("#chart-data-close")
    page.keyboard.press("Control+z")
    page.keyboard.press("Control+y")
    check(labels() == ["1.234", "498"], f"after closing, Ctrl+Y redoes the chart: {labels()}")
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


def test_chart_data_grid(browser):
    """The data grid under the slide: opens with a new chart and on a double-click; typing in a cell redraws the chart
    at once (one undo step per cell); rows and series added, removed, renamed, dragged; estimates, waterfall roles,
    a combo series' type and axis, a series colour."""
    editor = Editor(browser)
    editor.open(CONTRACT)
    page = editor.page
    grid = "#chart-data-grid"
    cell = lambda row, col: f"{grid} input.cell[data-row='{row}'][data-col='{col}']"  # noqa: E731

    def insert(kind):
        page.click(".ribbon-tab[data-tab='insert']")
        page.click(".ribbon-button.chart-button")
        page.click(f".chart-gallery-item[data-chart-type='{kind}']")
        return page.evaluate("App.selection.selectedId()")

    page.evaluate("App.deck.goTo(4)")
    chart = insert("column")
    data = lambda: page.evaluate(CHART_DATA, chart)  # noqa: E731
    check(page.is_visible("#chart-data-panel") and page.is_hidden("#notes-panel"), "a new chart opens its grid (under the slide)")
    check(page.locator(f"{grid} tbody tr").count() == 4 and page.input_value(cell(0, 0)) == "100", "4 rows, the sample numbers")

    # Typing redraws at once; the whole cell is one undo step.
    heights = lambda: [bar[1] for bar in page.evaluate(CHART_BARS, chart)]  # noqa: E731
    check(heights()[0] < heights()[1], "the sample: 100 shorter than 120")
    page.fill(cell(0, 0), "")
    page.click(cell(0, 0))
    page.keyboard.type("200")
    check(data()["series"][0]["values"][0] == 200 and heights()[0] > heights()[1], "the chart follows the typing: 200 now taller")
    page.keyboard.press("Enter")
    check(page.evaluate("document.activeElement.getAttribute('data-row')") == "1", "Enter: the next row")
    page.keyboard.type("1.234,5")
    page.keyboard.press("Tab")
    check(data()["series"][0]["values"][1] == 1234.5, "1.234,5 read the deck's way")
    page.click("#chart-data-close")
    check(page.is_hidden("#chart-data-panel") and page.is_visible("#notes-panel"), "closed: the notes are back")
    page.keyboard.press("Control+z")
    check(data()["series"][0]["values"][1] == 120, f"one undo: that cell back: {data()['series'][0]['values']}")
    page.keyboard.press("Control+z")
    check(data()["series"][0]["values"][0] == 100, "one more: the first cell back")

    # A double-click opens it again; a row and a series added, named; an estimate ticked.
    page.mouse.dblclick(*slide_to_screen(page, 640, 375))
    check(page.is_visible("#chart-data-panel"), "double-click: the grid")
    page.click("#chart-data-add-row")
    page.fill(f"{grid} input.category[data-row='4']", "2026E")
    page.keyboard.press("Enter")
    page.check(f"{grid} input.estimate[data-row='4']")
    page.click("#chart-data-add-series")
    page.fill(f"{grid} input.series-name[data-col='1']", "EBITDA")
    page.keyboard.press("Enter")
    page.fill(cell(4, 1), "40")
    page.keyboard.press("Enter")
    check(data()["categories"][-1] == "2026E" and data()["estimates"][-1] is True and data()["series"][1]["name"] == "EBITDA"
          and data()["series"][1]["values"][4] == 40, f"row, estimate, series: {data()}")
    check(len(page.evaluate(CHART_BARS, chart)) == 5, "five columns: four revenues, one EBITDA (empty cells draw nothing)")
    page.fill(f"{grid} input.category[data-row='4']", "2026")
    page.check("#format-chart-esuffix")
    names = page.evaluate("id => Array.from(App.deck.getDocument().querySelectorAll('[data-id=\"' + id + '\"] .chart-category-label'), (t) => t.textContent)", chart)
    check(names[-1] == "2026E" and data()["categories"][-1] == "2026", f"E added on the chart only: {names}")

    # A row dragged by its handle to the top; a row removed.
    handle = page.locator(f"{grid} .row-handle[data-row='4']").bounding_box()
    target = page.locator(f"{grid} tbody tr").first.bounding_box()
    drag(page, (handle["x"] + 4, handle["y"] + 4), (handle["x"] + 4, target["y"] + 3))
    check(data()["categories"][0] == "2026" and data()["series"][1]["values"][0] == 40, f"moved with its numbers: {data()['categories']}")
    page.click(f"{grid} .row-remove[data-row='0']")
    check(data()["categories"] == ["2022", "2023", "2024", "2025E"], "removed")

    # A series' colour.
    page.click(f"{grid} .series-color-menu-button >> nth=1")
    page.click(".series-color-menu .color-swatch[title='Green']")
    check(data()["series"][1].get("color") == "#00b050", f"EBITDA green: {data()['series'][1]}")
    page.screenshot(path=str(OUTPUT / "69-chart-data-grid.png"))

    # A combo: a series' type and axis; a waterfall: the roles.
    page.keyboard.press("Escape")
    combo = insert("combo")
    page.select_option(f"{grid} select.series-type[data-col='1']", "column")
    check(page.evaluate(CHART_DATA, combo)["series"][1]["type"] == "column", "the margin as columns now")
    page.select_option(f"{grid} select.series-axis[data-col='1']", "primary")
    check(page.evaluate(CHART_DATA, combo)["series"][1]["axis"] == "primary", "on the main axis")
    bridge = insert("waterfall")
    page.select_option(f"{grid} select.role[data-row='2']", "subtotal")
    check(page.evaluate(CHART_DATA, bridge)["roles"] == ["start", "delta", "subtotal", "end"], "a subtotal")
    check(page.evaluate(CHART_COUNT, [bridge, "rect[data-role='total']"]) == 3, "drawn as a total")

    # Selecting something else closes the grid.
    page.keyboard.press("Escape")
    page.evaluate("App.selection.select(App.deck.getDocument().querySelector('[data-id=\"e14\"]'))")
    check(page.is_hidden("#chart-data-panel"), "a text box selected: the grid closes")
    check(editor.errors == [], f"no errors: {editor.errors}")


def test_chart_paste_from_excel(browser):
    """Paste from Excel into a chart: on the selected chart, Excel's comps table (the real capture, fake text) becomes
    its data (names, series, %), one undo step; into the grid, a column of numbers fills from the cell (adding a row),
    names and numbers from the category column; a single value pastes as typing."""
    context = browser.new_context(viewport={"width": 1440, "height": 900}, accept_downloads=True)
    context.grant_permissions(["clipboard-read", "clipboard-write"])
    editor = Editor(browser, context)
    editor.open(CONTRACT)
    page = editor.page
    grid = "#chart-data-grid"
    cell = lambda row, col: f"{grid} input.cell[data-row='{row}'][data-col='{col}']"  # noqa: E731
    page.evaluate("App.deck.goTo(4)")
    page.click(".ribbon-tab[data-tab='insert']")
    page.click(".ribbon-button.chart-button")
    page.click(".chart-gallery-item[data-chart-type='column']")
    chart = page.evaluate("App.selection.selectedId()")
    data = lambda: page.evaluate(CHART_DATA, chart)  # noqa: E731

    # A column of numbers pasted into the grid from 2023's cell: it fills down, a fifth row is added.
    page.click(cell(1, 0))
    put_text_on_clipboard(page, "300\r\n400\r\n500\r\n600\r\n")
    page.keyboard.press("Control+v")
    check(data()["series"][0]["values"] == [100, 300, 400, 500, 600] and len(data()["categories"]) == 5, f"filled down: {data()}")
    check(page.input_value(cell(4, 0)) == "600" and page.evaluate("App.history.undoLabel()") == "Paste chart data", "the grid shows it, one step")

    # Names and numbers from the category column.
    page.click(f"{grid} input.category[data-row='0']")
    put_text_on_clipboard(page, "Alfa\t10\r\nBeta\t20\r\n")
    page.keyboard.press("Control+v")
    check(data()["categories"][:2] == ["Alfa", "Beta"] and data()["series"][0]["values"][:2] == [10, 20], f"names and numbers: {data()}")

    # One value pastes as typing does.
    page.click(cell(2, 0))
    put_text_on_clipboard(page, "777")
    page.keyboard.press("Control+v")
    check(data()["series"][0]["values"][2] == 777, f"one value: {data()['series'][0]['values']}")

    # Excel's comps table pasted on the selected chart (the grid closed): it becomes the chart's data.
    page.click("#chart-data-close")
    comps = clipboard_fixture("excel-comps")
    put_on_clipboard(page, comps["text/html"], comps["text/plain"])
    page.keyboard.press("Control+v")
    pasted = data()
    check(pasted["categories"] == ["Aaaa Aaaaa", "Aaaa Aaaaaaaa", "Aaaaa Aaaaaa", "Aaaaaaa Aaaaaaaaa", "Aaaaaaa"],
          f"the companies: {pasted['categories']}")
    check([series["values"] for series in pasted["series"]] == [[2450, 1120, 780, 530, 950], [9.8, 8.9, 10.4, -1.2, 9.4],
                                                                [0.195, 0.172, 0.21, -0.035, 0.184]], f"the numbers: {pasted['series']}")
    check(pasted["series"][2].get("format") == "percent", "the margin in %")
    check(page.is_visible("#chart-data-panel") and page.evaluate("App.deck.getCurrentSlide().querySelectorAll('table').length") == 0,
          "the grid shows it; no new table on the slide")
    page.screenshot(path=str(OUTPUT / "70-chart-pasted.png"))
    page.click("#chart-data-close")
    page.keyboard.press("Control+z")
    check(data()["series"][0]["values"][2] == 777, "one undo: the data before the paste")
    check(editor.errors == [], f"no errors: {editor.errors}")


def test_chart_label_numbers(browser):
    """Data label numbers and positions from the ribbon and the Format pane: Inside End, decimals, units,
    1,234.5 writing, negatives in parentheses; each one undo step."""
    editor = Editor(browser)
    editor.open(CONTRACT)
    page = editor.page
    page.evaluate("App.deck.goTo(4)")
    page.click(".ribbon-tab[data-tab='insert']")
    page.click(".ribbon-button.chart-button")
    page.click(".chart-gallery-item[data-chart-type='column']")
    chart = page.evaluate("App.selection.selectedId()")
    page.click("#chart-data-close")
    page.click(".ribbon-tab[data-tab='chart-design']")
    page.click(".ribbon-button[data-command='chartDataLabels']")
    labels = lambda: page.evaluate("id => Array.from(App.deck.getDocument().querySelectorAll('[data-id=\"' + id + '\"] .chart-data-label'), (t) => [t.textContent, t.getAttribute('fill')])", chart)  # noqa: E731
    check([text for text, fill in labels()] == ["100", "120", "135", "150"] and labels()[0][1] != "#FFFFFF", f"outside, dark: {labels()}")

    page.click(".list-button.chart-label-position")
    page.click(".chart-label-position-menu .menu-label:text-is('Inside End')")
    check([fill for text, fill in labels()] == ["#FFFFFF", "#FFFFFF", "#FFFFFF", "#404040"],
          f"inside the columns, white; dark in the lighter 2025E: {labels()}")
    check(page.text_content(".list-button.chart-label-position").startswith("Labels: Inside End"), "the button says so")

    for field, value in [("#format-chart-decimals", "1"), ("#format-chart-units", "R$ mn")]:
        page.fill(field, value)
        page.keyboard.press("Enter")
    check(labels()[0][0] == "100,0 R$ mn", f"decimals and units: {labels()[0]}")
    page.select_option("#format-chart-locale", "en-US")
    check(labels()[0][0] == "100.0 R$ mn", f"written 1,234.5: {labels()[0]}")
    page.check("#format-chart-parens")
    check(page.evaluate(CHART_DATA, chart)["options"].get("parens") is True, "negatives in parentheses on")
    page.screenshot(path=str(OUTPUT / "71-chart-label-numbers.png"))
    page.keyboard.press("Control+z")
    page.keyboard.press("Control+z")
    check(labels()[0][0] == "100,0 R$ mn", f"two undos: parentheses and the locale back: {labels()[0]}")
    check(editor.errors == [], f"no errors: {editor.errors}")


def excel_cells(rows):
    """Cells as Excel puts them on the clipboard: an HTML table and tab-separated text (fake numbers)."""
    html = "<table>" + "".join("<tr>" + "".join(f"<td>{cell}</td>" for cell in row) + "</tr>" for row in rows) + "</table>"
    return html, "".join("\t".join(row) + "\r\n" for row in rows)


def pdf_drawing(path):
    """What a PDF draws: (raster pictures, path-drawing operators) counted in its decompressed content streams."""
    import zlib
    data = path.read_bytes()
    pictures = len(re.findall(rb"/Subtype\s*/Image", data))
    operators = 0
    for match in re.finditer(rb"stream\r?\n(.*?)\r?\nendstream", data, re.S):
        try:
            content = zlib.decompress(match.group(1))
        except zlib.error:
            continue
        operators += len(re.findall(rb"(?:^|\s)(?:re|l|c|m)(?=\s)", content))
    return pictures, operators


def test_phase6_done_when(browser):
    """
    Phase 6 "done when", automated: an EBITDA bridge and a revenue-plus-margin combo are built from data pasted
    from Excel (cells as Excel puts them on the clipboard, fake numbers), edited, saved, reopened (still editable),
    and the saved deck printed to PDF with its charts drawn as lines (no pictures), so they stay sharp.
    """
    context = browser.new_context(viewport={"width": 1440, "height": 900}, accept_downloads=True)
    context.grant_permissions(["clipboard-read", "clipboard-write"])
    editor = Editor(browser, context)
    page = editor.page
    page.evaluate("App.commands.run('newDeck')")
    wait_until(page, "App.deck.getSlides().length === 2")
    started = time.time()
    grid = "#chart-data-grid"

    def chart_from_excel(kind, rows, rect):
        page.click(".ribbon-tab[data-tab='insert']")
        page.click(".ribbon-button.chart-button")
        page.click(f".chart-gallery-item[data-chart-type='{kind}']")
        chart_id = page.evaluate("App.selection.selectedId()")
        page.click("#chart-data-close")
        put_on_clipboard(page, *excel_cells(rows))
        page.keyboard.press("Control+v")   # on the selected chart: its data
        for field, value in zip(["x", "y", "w", "h"], rect):
            page.fill(f"#format-{field}", str(value))
            page.keyboard.press("Enter")
        return chart_id

    # Slide 2: the body text goes; a bridge and a combo take its place.
    page.evaluate("App.deck.goTo(1)")
    page.mouse.click(*slide_to_screen(page, 600, 200))
    page.keyboard.press("Delete")
    bridge = chart_from_excel("waterfall", [["", "R$ mn"], ["EBITDA 2024", "240"], ["Novos parques", "95"], ["Eficiência", "30"],
                                            ["Custos corporativos", "-25"], ["EBITDA 2026E", "340"]], (40, 140, 580, 440))
    combo = chart_from_excel("combo", [["", "Receita (R$ mn)", "Margem EBITDA"], ["2022", "410", "18,0%"], ["2023", "498", "20,0%"],
                                       ["2024", "587", "21,0%"], ["2025E", "702", "23,0%"]], (660, 140, 580, 440))
    data = lambda id_: page.evaluate(CHART_DATA, id_)  # noqa: E731
    labels = lambda id_: page.evaluate("id => Array.from(App.deck.getDocument().querySelectorAll('[data-id=\"' + id + '\"] .chart-data-label'), (t) => t.textContent)", id_)  # noqa: E731
    check(data(bridge)["categories"][-1] == "EBITDA 2026E" and data(bridge)["estimates"][-1] is True, "the bridge from Excel")
    check(data(combo)["series"][1].get("format") == "percent" and data(combo)["series"][1]["values"][-1] == 0.23, "the combo from Excel")

    # Edit the bridge: Eficiência 30 -> 35, the end left empty (the running total); a title.
    page.mouse.dblclick(*slide_to_screen(page, 330, 360))
    page.fill(f"{grid} input.cell[data-row='2'][data-col='0']", "35")
    page.fill(f"{grid} input.cell[data-row='4'][data-col='0']", "")
    page.click("#chart-data-close")
    page.fill("#format-chart-title", "Ponte do EBITDA (R$ mn)")
    page.keyboard.press("Enter")
    check(labels(bridge) == ["240", "+95", "+35", "-25", "345"], f"the bridge edited: {labels(bridge)}")

    # Edit the combo: data labels and the CAGR from the ribbon.
    page.mouse.click(*slide_to_screen(page, 950, 360))
    page.click(".ribbon-tab[data-tab='chart-design']")
    page.click(".ribbon-button[data-command='chartDataLabels']")
    page.click(".ribbon-button[data-command='chartCagr']")
    cagr = page.evaluate("id => App.deck.getDocument().querySelector('[data-id=\"' + id + '\"] .chart-cagr-label').textContent", combo)
    check(cagr == "CAGR 19,6%" and "23%" in labels(combo), f"CAGR and the margin labels: {cagr} {labels(combo)}")
    elapsed = time.time() - started
    check(elapsed < 60, f"built and edited in under a minute: {elapsed:.1f} s")
    page.keyboard.press("Escape")
    check(page.text_content("#status-message").startswith("Pasted into the chart"), page.text_content("#status-message"))
    wait_until(page, """() => document.querySelector('.thumb[data-index="1"] iframe').contentDocument
        .querySelectorAll('svg.chart-svg').length === 2""")   # thumbnails redraw a moment after a change
    page.screenshot(path=str(OUTPUT / "72-phase6-done-when.png"))

    # Saved and reopened: the same data, still editable.
    before = (data(bridge), data(combo))
    saved = editor.save_as_download("phase6-done-when.html")
    editor.open(saved)
    check(editor.report_dialog_text() is None, "a deck the editor saved opens without an import report")
    page.evaluate("App.deck.goTo(1)")
    check((data(bridge), data(combo)) == before, "both charts came back as saved")
    page.mouse.dblclick(*slide_to_screen(page, 330, 360))
    page.fill(f"{grid} input.cell[data-row='1'][data-col='0']", "100")
    check(labels(bridge)[1] == "+100", f"still editable: {labels(bridge)}")

    # The saved file on its own shows both, and prints them as lines (no pictures).
    player, errors = play_saved_deck(browser, saved)
    player.keyboard.press("ArrowRight")
    shown = player.evaluate("""() => Array.from(document.querySelectorAll('section.slide[data-slide-id="s2"] svg.chart-svg'),
        (svg) => svg.querySelectorAll('rect.chart-bar').length)""")
    check(shown == [5, 4], f"the saved deck shows the bridge and the combo: {shown}")
    pictures_in_deck = player.evaluate("document.querySelectorAll('img').length")
    player.emulate_media(media="print")
    pdf = OUTPUT / "phase6-done-when.pdf"
    player.pdf(path=str(pdf), prefer_css_page_size=True, print_background=True)
    pages = len(re.findall(rb"/Type\s*/Page[^s]", pdf.read_bytes()))
    pictures, operators = pdf_drawing(pdf)
    check(pages == 2, f"one page per slide: {pages}")
    check(pictures == pictures_in_deck and operators > 100,
          f"charts printed as lines and shapes, not pictures: {pictures} pictures ({pictures_in_deck} in the deck), {operators} drawing operators")
    check(errors == [] and editor.errors == [], f"no errors: {errors} {editor.errors}")
    player.context.close()
    editor.close()


def test_speaker_notes(browser):
    """Speaker notes typed in the panel under the slide: plain text with line breaks, stored in the slide's
    <aside class="notes">; one undo step per typing run (Ctrl+Z works in the panel); each slide its own; saved."""
    editor = Editor(browser)
    editor.open(CONTRACT)
    page = editor.page
    notes = "#notes-text"
    aside = lambda: page.evaluate("App.deck.getCurrentSlide().querySelector('aside.notes').textContent")  # noqa: E731
    page.evaluate("App.deck.goTo(1)")
    check(page.input_value(notes) == "Reforçar o múltiplo de entrada abaixo da média dos comparáveis.", page.input_value(notes))

    # Typing goes into the slide's notes; Enter makes a new line; one undo step.
    page.click(notes)
    page.keyboard.press("End")
    page.keyboard.press("Enter")
    page.keyboard.type("Citar Beta e Gama.")
    check(aside() == "Reforçar o múltiplo de entrada abaixo da média dos comparáveis.\nCitar Beta e Gama.", repr(aside()))
    check(page.evaluate("App.history.undoLabel()") == "Speaker notes", "an undo step")
    page.keyboard.press("Control+z")
    check(aside() == "Reforçar o múltiplo de entrada abaixo da média dos comparáveis." and
          page.input_value(notes) == aside(), f"Ctrl+Z in the panel undoes the typing: {aside()!r}")
    page.keyboard.press("Control+y")
    check(aside().endswith("Citar Beta e Gama."), "Ctrl+Y: again")

    # Each slide its own; a slide without notes starts empty (placeholder) and gets them.
    page.evaluate("App.deck.goTo(4)")
    check(page.input_value(notes) == "" and page.get_attribute(notes, "placeholder") == "Click to add speaker notes",
          "slide 5 has none")
    page.click(notes)
    page.keyboard.type("Só para perguntas.")
    page.evaluate("App.deck.goTo(1)")
    check(page.input_value(notes).endswith("Citar Beta e Gama."), "slide 2's notes again")
    page.screenshot(path=str(OUTPUT / "73-speaker-notes.png"))

    # Saved and reopened: the notes are kept, line break and all.
    saved = editor.save_as_download("notes-saved.html")
    editor.open(saved)
    page.evaluate("App.deck.goTo(4)")
    check(page.input_value(notes) == "Só para perguntas.", page.input_value(notes))
    page.evaluate("App.deck.goTo(1)")
    check(page.input_value(notes).count("\n") == 1, "the line break kept")
    check(editor.errors == [], f"no errors: {editor.errors}")


def test_add_duplicate_delete_slides(browser):
    """Phase 7: New Slide from the layout gallery (title placed like the deck's titles), Ctrl+M, Duplicate Slide
    (right-click, Ctrl+D in the rail), Delete Slide (Delete in the rail); each one undo step that shows its slide;
    thumbnails follow; never the last slide; saved and reopened."""
    editor = Editor(browser)
    editor.open(CONTRACT)
    page = editor.page
    state = """() => { const s = App.deck.getCurrentSlide(); return { count: App.deck.getSlides().length,
        index: App.deck.getCurrentIndex(), id: s.getAttribute('data-slide-id'), layout: s.getAttribute('data-layout'),
        texts: Array.from(s.querySelectorAll(':scope > .el'), (e) => e.textContent),
        notes: App.notes.textOf(s), thumbs: document.querySelectorAll('#thumbnail-rail .thumb').length,
        label: App.history.undoLabel() }; }"""
    now = lambda: page.evaluate(state)  # noqa: E731
    unique_ids = """() => { const ids = Array.from(App.deck.getDocument().querySelectorAll('[data-id]'), (n) => n.getAttribute('data-id'));
        return ids.length === new Set(ids).size; }"""
    title_rect = """() => App.transform.readRect(App.slides.titleOf(App.deck.getCurrentSlide()))"""

    # Home > New Slide ▾ > Two Content, from slide 2: a new slide 3, its title where the deck's titles are.
    page.evaluate("App.deck.goTo(1)")
    page.click(".ribbon-button.new-slide-button")
    check(page.locator(".slide-layout-item").count() == 4, "four layouts")
    page.screenshot(path=str(OUTPUT / "74-new-slide-layouts.png"))
    page.click(".slide-layout-item[data-layout='two-columns']")
    after = now()
    check(after["count"] == 7 and after["index"] == 2 and after["layout"] == "two-columns" and after["thumbs"] == 7 and
          after["label"] == "New slide", f"a new slide after slide 2: {after}")
    check(after["texts"] == ["Título do slide", "Primeiro ponto", "Primeiro ponto"], after["texts"])
    check(page.evaluate(title_rect) == {"left": 64, "top": 48, "width": 1152, "height": 60}, page.evaluate(title_rect))
    check(page.evaluate(unique_ids), "element ids stay unique")
    page.screenshot(path=str(OUTPUT / "75-new-slide.png"))
    new_id = after["id"]

    # One undo step: Ctrl+Z takes it away and shows slide 2 again; Ctrl+Y brings it back, shown.
    page.keyboard.press("Control+z")
    check(now()["count"] == 6 and now()["index"] == 1 and now()["thumbs"] == 6, f"undone: {now()}")
    page.keyboard.press("Control+y")
    check(now()["count"] == 7 and now()["id"] == new_id and now()["thumbs"] == 7, f"redone: {now()}")

    # Ctrl+M on the title slide: Title and Content (not another title slide), after it.
    page.evaluate("App.deck.goTo(0)")
    page.keyboard.press("Control+m")
    check(now()["index"] == 1 and now()["layout"] == "title-content" and now()["count"] == 8, f"Ctrl+M: {now()}")

    # Right-click slide 3 (Sumário executivo) in the rail > Duplicate Slide: the copy right after it, notes and all.
    page.click("#thumbnail-rail .thumb[data-index='2']", button="right")
    check(now()["index"] == 2, "right-click shows the slide")
    page.click(".context-menu .menu-label:text-is('Duplicate Slide')")
    copy = now()
    check(copy["index"] == 3 and copy["texts"][0] == "Sumário executivo" and copy["label"] == "Duplicate slide" and
          copy["notes"].startswith("Reforçar"), f"the copy: {copy}")
    check(page.evaluate(unique_ids), "the copy's elements have new ids")

    # Ctrl+D in the rail duplicates too; Delete in the rail deletes the slide shown, the next one is shown.
    page.focus("#thumbnail-rail .thumb[data-index='3']")
    page.keyboard.press("Control+d")
    check(now()["count"] == 10 and now()["index"] == 4, f"Ctrl+D in the rail: {now()}")
    page.focus("#thumbnail-rail .thumb[data-index='4']")
    page.keyboard.press("Delete")
    check(now()["count"] == 9 and now()["index"] == 4 and now()["label"] == "Delete slide", f"deleted: {now()}")
    shown_after_delete = now()["id"]
    page.keyboard.press("Control+z")
    check(now()["count"] == 10 and now()["index"] == 4 and now()["texts"][0] == "Sumário executivo", f"undo: back, shown: {now()}")
    page.keyboard.press("Control+y")
    check(now()["count"] == 9 and now()["id"] == shown_after_delete, f"redo: deleted again: {now()}")

    # Delete twice in a row in the rail: the focus stays on the slide shown.
    page.keyboard.press("Delete")
    page.keyboard.press("Delete")
    check(now()["count"] == 7, f"two deletes: {now()}")
    page.keyboard.press("Control+z")
    page.keyboard.press("Control+z")
    check(now()["count"] == 9, f"both undone: {now()}")

    # The ribbon's Delete Slide, on the Ctrl+M slide: the next one (Sumário executivo) is shown.
    page.evaluate("App.deck.goTo(1)")
    page.click(".ribbon-button[data-command='deleteSlide']")
    check(now()["count"] == 8 and now()["index"] == 1 and now()["texts"][0] == "Sumário executivo",
          f"ribbon delete, the next one shown: {now()}")
    page.screenshot(path=str(OUTPUT / "76-slides-after-delete.png"))

    # Saved and reopened: the new slides and their layouts are there.
    saved = editor.save_as_download("slides-saved.html")
    editor.open(saved)
    layouts = page.evaluate("App.deck.getSlides().map((s) => s.getAttribute('data-layout'))")
    check(layouts == ["title", "title-content", "title-content", "two-columns", "title-content", "title-content",
                      "title-content", "two-columns"], f"saved: {layouts}")
    check(page.evaluate(unique_ids), "unique ids after reopening")

    # Never the last slide: Delete Slide greys out with one left.
    page.evaluate("() => { while (App.slides.canRemove()) App.slides.remove(); }")
    check(editor.slide_count() == 1 and page.is_disabled(".ribbon-button[data-command='deleteSlide']"), "one slide kept")
    check(editor.errors == [], f"no errors: {editor.errors}")


def test_reorder_and_hide_slides(browser):
    """Phase 7: drag a thumbnail to move its slide (a line shows where; Esc cancels), Ctrl+Up / Ctrl+Down in the rail,
    Hide Slide (right-click a thumbnail, Slide Show tab): dimmed thumbnail with the hidden mark; each one undo step;
    saved and reopened."""
    editor = Editor(browser)
    editor.open(CONTRACT)
    page = editor.page
    order = lambda: page.evaluate("App.deck.getSlides().map((s) => s.getAttribute('data-slide-id')).join(',')")  # noqa: E731
    shown = lambda: page.evaluate("App.deck.getCurrentSlide().getAttribute('data-slide-id')")  # noqa: E731
    label = lambda: page.evaluate("App.history.undoLabel()")  # noqa: E731
    box = lambda index: page.locator(f"#thumbnail-rail .thumb[data-index='{index}'] .thumb-box").bounding_box()  # noqa: E731
    check(order() == "s1,s2,s3,s4,s5,s6", order())

    # Drag slide 1's thumbnail down between slides 3 and 4: a line shows the place; it lands there, shown.
    start = box(0)
    page.mouse.move(start["x"] + 80, start["y"] + 40)
    page.mouse.down()
    gap_y = (box(2)["y"] + box(2)["height"] + box(3)["y"]) / 2
    page.mouse.move(start["x"] + 80, gap_y, steps=10)
    check(page.is_visible(".thumb-drop-line"), "the drop line shows")
    check(page.evaluate("String(getSelection())") == "", "dragging selects no text in the rail")
    page.screenshot(path=str(OUTPUT / "77-drag-thumbnail.png"))
    page.mouse.up()
    check(order() == "s2,s3,s1,s4,s5,s6" and shown() == "s1" and label() == "Move slide", f"moved: {order()} {shown()}")
    check(page.locator(".thumb-drop-line").count() == 0, "the line goes")
    check(page.get_attribute("#thumbnail-rail .thumb[data-index='2']", "class").count("thumb-current") == 1,
          "its thumbnail is the current one")
    page.keyboard.press("Control+z")
    check(order() == "s1,s2,s3,s4,s5,s6" and shown() == "s1", f"undo: back on top, shown: {order()} {shown()}")
    page.keyboard.press("Control+y")
    check(order() == "s2,s3,s1,s4,s5,s6", f"redo: {order()}")
    page.keyboard.press("Control+z")

    # Esc during a drag: nothing moves.
    page.mouse.move(start["x"] + 80, start["y"] + 40)
    page.mouse.down()
    page.mouse.move(start["x"] + 80, box(4)["y"] + 70, steps=10)
    page.keyboard.press("Escape")
    page.mouse.up()
    check(order() == "s1,s2,s3,s4,s5,s6" and page.locator(".thumb-drop-line").count() == 0, f"Esc cancels: {order()}")

    # A plain click on a thumbnail still just shows that slide.
    page.click("#thumbnail-rail .thumb[data-index='3']")
    check(shown() == "s4" and order() == "s1,s2,s3,s4,s5,s6", "click shows slide 4")

    # Ctrl+Up / Ctrl+Down in the rail move the slide shown.
    page.keyboard.press("Control+ArrowUp")
    check(order() == "s1,s2,s4,s3,s5,s6" and shown() == "s4", f"Ctrl+Up: {order()}")
    page.keyboard.press("Control+ArrowDown")
    page.keyboard.press("Control+ArrowDown")
    check(order() == "s1,s2,s3,s5,s4,s6" and shown() == "s4", f"Ctrl+Down twice: {order()}")

    # Hide Slide from a thumbnail's right-click menu: dimmed, the crossed-out eye; the menu shows the tick next time.
    hidden = lambda index: page.evaluate(  # noqa: E731
        "i => [App.deck.getSlides()[i].getAttribute('data-hidden'), "
        "document.querySelector('#thumbnail-rail .thumb[data-index=\"' + i + '\"]').classList.contains('thumb-hidden'), "
        "!!document.querySelector('#thumbnail-rail .thumb[data-index=\"' + i + '\"] .thumb-hidden-badge')]", index)
    page.click("#thumbnail-rail .thumb[data-index='0']", button="right")
    page.click(".context-menu .menu-label:text-is('Hide Slide')")
    check(hidden(0) == ["true", True, True] and label() == "Hide slide", f"hidden: {hidden(0)}")
    page.click("#thumbnail-rail .thumb[data-index='0']", button="right")
    check(page.get_attribute(".context-menu .menu-item[data-command='hideSlide']", "aria-checked") == "true", "ticked")
    page.screenshot(path=str(OUTPUT / "78-hide-slide.png"))
    page.keyboard.press("Escape")

    # The Slide Show tab's Hide Slide button: lit for a hidden slide; clicking it shows the slide again.
    page.click(".ribbon-tab[data-tab='slideshow']")
    button = ".ribbon-button[data-command='hideSlide']"
    check(page.get_attribute(button, "aria-pressed") == "true", "lit")
    page.click(button)
    check(hidden(0) == [None, False, False] and label() == "Unhide slide" and page.get_attribute(button, "aria-pressed") == "false",
          f"unhidden: {hidden(0)}")
    page.keyboard.press("Control+z")
    check(hidden(0) == ["true", True, True], f"undo: hidden again: {hidden(0)}")

    # Saved and reopened: the order and the hidden slides are kept.
    saved = editor.save_as_download("reorder-saved.html")
    editor.open(saved)
    check(order() == "s1,s2,s3,s5,s4,s6", order())
    check(page.evaluate("App.deck.getSlides().map((s) => s.getAttribute('data-hidden') === 'true')") ==
          [True, False, False, True, False, False], "s1 and s5 hidden")
    check(editor.errors == [], f"no errors: {editor.errors}")


def test_multi_select(browser):
    """Phase 7: several elements selected (Shift/Ctrl+click toggles, a rubber band on empty slide catches what it covers
    wholly, Ctrl+A all); they move, nudge, duplicate, copy / paste, restack and delete together, each one undo step."""
    editor = Editor(browser)
    editor.open(CONTRACT)
    page = editor.page
    ids = lambda: page.evaluate("App.selection.selectedIds()")  # noqa: E731
    label = lambda: page.evaluate("App.history.undoLabel()")  # noqa: E731
    rects = lambda names: [element_rect(page, name) for name in names]  # noqa: E731

    def click(x, y, modifiers=(), button="left"):
        for key in modifiers:
            page.keyboard.down(key)
        page.mouse.click(*slide_to_screen(page, x, y), button=button)
        for key in modifiers:
            page.keyboard.up(key)
    outlines = lambda: page.locator(".selection-outline:visible").count()  # noqa: E731
    # Slide 1: e1 logo (64,56 120x40), e2 title (64,230 1100x120), e3 bar (64,350 140x8), e4 subtitle (64,378 1100x70).

    # Shift+click adds, Shift+click again takes out; Ctrl+click too.
    click(600, 280)
    click(600, 410, modifiers=["Shift"])
    check(ids() == ["e2", "e4"], f"two selected: {ids()}")
    check(outlines() == 2 and page.locator(".selection-box:visible").count() == 0, "an outline each, no handles")
    check(page.inner_text("#format-hint") == "2 objects selected", page.inner_text("#format-hint"))
    click(600, 280, modifiers=["Control"])
    check(ids() == ["e4"], f"Ctrl+click took e2 out: {ids()}")
    page.keyboard.press("Escape")
    check(ids() == [], "Esc: none")

    # A rubber band from empty slide: what it covers wholly (not the logo, partly outside it).
    start = slide_to_screen(page, 30, 200)
    end = slide_to_screen(page, 1220, 470)
    page.mouse.move(*start)
    page.mouse.down()
    page.mouse.move(end[0], end[1], steps=8)
    check(page.is_visible(".rubber-band"), "the band shows")
    page.screenshot(path=str(OUTPUT / "79-rubber-band.png"))
    page.mouse.up()
    check(sorted(ids()) == ["e2", "e3", "e4"] and page.locator(".rubber-band").count() == 0, f"band: {ids()}")
    page.screenshot(path=str(OUTPUT / "80-multi-selected.png"))

    # Dragging one of them moves all three: one undo step.
    before = rects(["e2", "e3", "e4"])
    page.keyboard.down("Alt")   # placed freely: no snapping (Phase 7)
    drag(page, slide_to_screen(page, 600, 410), slide_to_screen(page, 640, 430))
    page.keyboard.up("Alt")
    moved = rects(["e2", "e3", "e4"])
    check(all(m["left"] == b["left"] + 40 and m["top"] == b["top"] + 20 for m, b in zip(moved, before)), f"all moved: {moved}")
    check(label() == "Move" and sorted(ids()) == ["e2", "e3", "e4"], "still all selected")
    page.keyboard.press("Control+z")
    check(rects(["e2", "e3", "e4"]) == before, "undo: all back")
    check(sorted(ids()) == ["e2", "e3", "e4"], f"the selection survives undo: {ids()}")

    # Arrow keys nudge them all.
    page.keyboard.press("ArrowRight")
    check([r["left"] for r in rects(["e2", "e3", "e4"])] == [b["left"] + 1 for b in before], "nudged")
    page.keyboard.press("Control+z")

    # Send to Back / Bring to Front move the three as a block, in their own order (already in front: greyed out).
    stack = lambda: page.evaluate(  # noqa: E731
        "App.transform.topLevelElements(App.deck.getCurrentSlide()).map((e) => e.getAttribute('data-id'))")
    page.click(".ribbon-tab[data-tab='arrange']")
    check(page.is_disabled("button[data-command='bringToFront']"), "already in front")
    page.click("button[data-command='sendToBack']")
    check(stack() == ["e2", "e3", "e4", "e1"] and label() == "Send to back", f"back: {stack()}")
    page.click("button[data-command='bringForward']")
    check(stack() == ["e1", "e2", "e3", "e4"], f"forward past the logo: {stack()}")
    page.keyboard.press("Control+z")
    page.keyboard.press("Control+z")
    check(stack() == ["e1", "e2", "e3", "e4"], "undone")

    # Ctrl+D duplicates all three, 10 px down-right, the copies selected.
    page.keyboard.press("Control+d")
    copies = ids()
    check(len(copies) == 3 and not set(copies) & {"e2", "e3", "e4"} and label() == "Duplicate", f"copies: {copies}")
    check(sorted(r["left"] for r in rects(copies)) == sorted(b["left"] + 10 for b in before), "10 px right")
    page.keyboard.press("Control+z")
    check(ids() == [], f"undo: the copies and their selection go: {ids()}")

    # Ctrl+A selects everything on the slide; right-click one keeps them all and offers Delete; Delete: one step.
    page.click("#overlay", position={"x": 5, "y": 5})
    page.keyboard.press("Control+a")
    check(sorted(ids()) == ["e1", "e2", "e3", "e4"], f"Ctrl+A: {ids()}")
    click(600, 280, button="right")
    check(sorted(ids()) == ["e1", "e2", "e3", "e4"] and page.is_enabled(".context-menu .menu-item[data-command='delete']"),
          "right-click keeps the selection")
    page.click(".context-menu .menu-label:text-is('Delete')")
    check(page.evaluate("App.deck.getCurrentSlide().querySelectorAll(':scope > .el').length") == 0 and label() == "Delete",
          "all deleted")
    page.keyboard.press("Control+z")
    check(page.evaluate("App.deck.getCurrentSlide().querySelectorAll(':scope > .el').length") == 4, "undo: all back")

    # Copy two, paste on slide 2: both, where they were, selected.
    page.keyboard.press("Escape")
    click(600, 280)
    click(110, 75, modifiers=["Shift"])
    check(sorted(ids()) == ["e1", "e2"], f"{ids()}")
    page.keyboard.press("Control+c")
    page.evaluate("App.deck.goTo(1)")
    page.keyboard.press("Control+v")
    pasted = ids()
    check(len(pasted) == 2 and label() == "Paste", f"pasted: {pasted}")
    check(sorted((r["left"], r["top"]) for r in rects(pasted)) == [(64, 56), (64, 230)], f"same spots: {rects(pasted)}")

    # Shift + rubber band adds to the selection.
    page.keyboard.press("Escape")
    click(600, 80)
    page.keyboard.down("Shift")
    drag(page, slide_to_screen(page, 30, 140), slide_to_screen(page, 1250, 700))
    page.keyboard.up("Shift")
    # Slide 2: e5 title (64,48), e7 body (64,150 1152x480), and the pasted title copy (64,230) are covered; the title stays.
    check(ids()[0] == "e5" and "e7" in ids() and len(ids()) == 3, f"added: {ids()}")
    check(editor.errors == [], f"no errors: {editor.errors}")


def test_align_and_distribute(browser):
    """Phase 7: Arrange > Align lines the selected elements up (one: on the slide; several: on each other, or on the
    slide with Align to Slide) and Distribute spreads three or more with equal gaps; each one undo step."""
    editor = Editor(browser)
    editor.open(CONTRACT)
    page = editor.page
    label = lambda: page.evaluate("App.history.undoLabel()")  # noqa: E731
    rect = lambda name: element_rect(page, name)  # noqa: E731
    button = lambda name: "button[data-command='" + name + "']"  # noqa: E731

    def click(x, y, shift=False):
        if shift:
            page.keyboard.down("Shift")
        page.mouse.click(*slide_to_screen(page, x, y))
        if shift:
            page.keyboard.up("Shift")
    # Slide 1: e1 logo (64,56 120x40), e2 title (64,230 1100x120), e3 bar (64,350 140x8), e4 subtitle (64,378 1100x70).
    page.click(".ribbon-tab[data-tab='arrange']")
    for name in ["alignObjectsLeft", "alignObjectsCenter", "distributeHorizontally"]:
        check(page.is_disabled(button(name)), f"{name}: nothing selected, greyed out")

    # One element: aligned on the slide.
    click(120, 76)
    check(page.evaluate("App.selection.selectedIds()") == ["e1"], "the logo selected")
    check(page.get_attribute(button("alignToSlide"), "aria-pressed") == "true", "one element: Align to Slide is on")
    page.click(button("alignObjectsCenter"))
    check(rect("e1")["left"] == 580 and rect("e1")["top"] == 56 and label() == "Align center", f"centred: {rect('e1')}")
    page.click(button("alignObjectsBottom"))
    check(rect("e1")["top"] == 680, f"at the bottom of the slide: {rect('e1')}")
    page.keyboard.press("Control+z")
    page.keyboard.press("Control+z")
    check(rect("e1")["left"] == 64 and rect("e1")["top"] == 56, "two undos: back")

    # Two elements: aligned on each other (the box around both).
    click(100, 354, shift=True)
    check(page.evaluate("App.selection.selectedIds()") == ["e1", "e3"], "logo and bar")
    check(page.get_attribute(button("alignToSlide"), "aria-pressed") == "false", "several: on each other")
    page.click(button("alignObjectsRight"))
    check(rect("e1")["left"] == 84 and rect("e3")["left"] == 64 and label() == "Align right", "right edges at 204")
    page.click(button("alignObjectsMiddle"))
    check(rect("e1")["top"] + 20 == 207 and rect("e3")["top"] + 4 == 207, f"middles at 207: {rect('e1')} {rect('e3')}")
    page.screenshot(path=str(OUTPUT / "81-aligned.png"))
    page.keyboard.press("Control+z")
    page.keyboard.press("Control+z")
    check(page.is_disabled(button("distributeVertically")), "two: nothing to distribute between")

    # Align to Slide: the two go to the slide's edges.
    page.click(button("alignToSlide"))
    check(page.get_attribute(button("alignToSlide"), "aria-pressed") == "true", "on")
    page.click(button("distributeVertically"))
    check(rect("e1")["top"] == 0 and rect("e3")["top"] == 712 and label() == "Distribute vertically",
          f"spread over the slide: {rect('e1')} {rect('e3')}")
    page.keyboard.press("Control+z")
    page.click(button("alignToSlide"))

    # All four: equal gaps between them, the top and bottom ones stay.
    page.keyboard.press("Control+a")
    page.click(button("distributeVertically"))
    tops = [rect(name)["top"] for name in ["e1", "e2", "e3", "e4"]]
    check(tops == [56, 147.33, 318.67, 378], f"gaps of 51.33: {tops}")
    page.screenshot(path=str(OUTPUT / "82-distributed.png"))
    page.keyboard.press("Control+z")
    check([rect(name)["top"] for name in ["e1", "e2", "e3", "e4"]] == [56, 230, 350, 378], "one undo: all back")

    # Already lined up: nothing to undo.
    page.click(button("alignObjectsLeft"))
    check(label() != "Align left", f"no step for no change: {label()}")


def test_smart_guides_gridlines_and_rulers(browser):
    """Phase 7: a dragged element snaps to the slide's centre and edges and to other elements within 5 screen px, with a
    red guide while it does; Alt (also pressed during the drag) places it freely; a resized edge snaps too. View tab:
    gridlines (Shift+F9) and rulers that shade the selection, remembered in the settings."""
    editor = Editor(browser)
    editor.open(CONTRACT)
    page = editor.page
    rect = lambda name: element_rect(page, name)  # noqa: E731
    guides = lambda: page.locator(".smart-guide:visible").count()  # noqa: E731
    # Slide 1: e1 logo (64,56 120x40), e2 title (64,230 1100x120), e3 bar (64,350 140x8), e4 subtitle (64,378 1100x70).

    # Drag the logo so its centre ends 2 px right of the slide's centre line (642): it snaps onto it (left 580).
    page.mouse.move(*slide_to_screen(page, 120, 76))
    page.mouse.down()
    page.mouse.move(*slide_to_screen(page, 120 + 518, 76), steps=10)
    check(rect("e1")["left"] == 580, f"snapped onto the centre line: {rect('e1')}")
    check(guides() == 1, f"one guide, on the centre line: {guides()}")
    guide = page.evaluate("(() => { const g = document.querySelector('.smart-guide'); return [g.style.left, g.style.top, g.style.height]; })()")
    check(guide == ["640px", "0px", "720px"], f"the slide's centre line, top to bottom: {guide}")
    page.screenshot(path=str(OUTPUT / "83-smart-guide.png"))
    # Alt pressed during the drag: free at once; let go: snapped again.
    page.keyboard.down("Alt")
    check(rect("e1")["left"] != 580 and guides() == 0, f"Alt: free, no guide: {rect('e1')}")
    page.keyboard.up("Alt")
    check(rect("e1")["left"] == 580 and guides() == 1, "Alt let go: snapped again")
    page.mouse.up()
    check(guides() == 0 and page.evaluate("App.history.undoLabel()") == "Move", "dropped: the guide goes, one Move step")
    page.keyboard.press("Control+z")

    # The same drag with Alt held from the start: no snapping.
    page.keyboard.down("Alt")
    drag(page, slide_to_screen(page, 120, 76), slide_to_screen(page, 120 + 518, 76), steps=10)
    page.keyboard.up("Alt")
    check(abs(rect("e1")["left"] - 582) <= 1, f"Alt: where the mouse put it: {rect('e1')}")
    page.keyboard.press("Control+z")

    # Snapping to another element: the bar dragged so its left edge is 3 px right of the title's (64): back on it.
    page.mouse.click(*slide_to_screen(page, 100, 354))
    drag(page, slide_to_screen(page, 100, 354), slide_to_screen(page, 103, 164), steps=6)
    check(rect("e3")["left"] == 64 and rect("e3")["top"] == 160, f"left edge on the title's (top near no line): {rect('e3')}")
    page.keyboard.press("Control+z")

    # Resizing: the bar's right edge dragged 3 px short of the title's right edge (1164) snaps onto it.
    side = page.locator("#overlay .selection-handle[data-handle='e']").bounding_box()
    start = [side["x"] + side["width"] / 2, side["y"] + side["height"] / 2]
    zoom = page.evaluate("App.canvas.getZoom()")
    drag(page, start, [start[0] + (1161 - 204) * zoom, start[1]], steps=10)
    check(rect("e3")["left"] == 64 and rect("e3")["width"] == 1100, f"right edge on the title's: {rect('e3')}")
    page.keyboard.press("Control+z")

    # View tab: gridlines and rulers, off at first.
    page.click(".ribbon-tab[data-tab='view']")
    check(page.is_hidden(".gridlines") and page.is_hidden(".ruler-top"), "both off at first")
    page.click("button[data-command='toggleGridlines']")
    check(page.is_visible(".gridlines") and page.get_attribute("button[data-command='toggleGridlines']", "aria-pressed") == "true",
          "gridlines on")
    page.click("button[data-command='toggleRulers']")
    check(page.is_visible(".ruler-top") and page.is_visible(".ruler-left"), "rulers on")
    page.mouse.click(*slide_to_screen(page, 120, 76))
    shade = page.evaluate("(() => { const r = document.querySelector('.ruler-top .ruler-range'); "
                          "return [Number(r.getAttribute('x')), Number(r.getAttribute('width'))]; })()")
    check(abs(shade[0] - 64 * zoom) < 1 and abs(shade[1] - 120 * zoom) < 1, f"the logo shaded on the top ruler: {shade}")
    page.screenshot(path=str(OUTPUT / "84-gridlines-rulers.png"))
    check(page.evaluate("App.settings.get().showGridlines && App.settings.get().showRulers"), "remembered in the settings")
    page.keyboard.press("Escape")
    page.keyboard.press("Shift+F9")
    check(page.is_hidden(".gridlines"), "Shift+F9: gridlines off")
    page.click("button[data-command='toggleRulers']")
    check(page.is_hidden(".ruler-top"), "rulers off")
    check(page.evaluate("App.deck.getDocument().querySelectorAll('.gridlines, .ruler, .smart-guide').length") == 0,
          "nothing of it in the deck")


def test_group_and_ungroup(browser):
    """Phase 7: Ctrl+G groups the selected elements into one (it moves, resizes with its parts scaled, copies as one;
    double-click types in a part), Ctrl+Shift+G ungroups; each one undo step; saved and reopened, it stays a group."""
    editor = Editor(browser)
    editor.open(CONTRACT)
    page = editor.page
    ids = lambda: page.evaluate("App.selection.selectedIds()")  # noqa: E731
    label = lambda: page.evaluate("App.history.undoLabel()")  # noqa: E731
    rect = lambda name: element_rect(page, name)  # noqa: E731
    on_slide = lambda name: page.evaluate("""id => {  // where the part really is on the slide (slide px)
        const r = App.deck.getDocument().querySelector('[data-id="' + id + '"]').getBoundingClientRect();
        return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; }""", name)  # noqa: E731
    button = lambda name: "button[data-command='" + name + "']"  # noqa: E731
    # Slide 1: e1 logo (64,56 120x40), e2 title (64,230 1100x120), e3 bar (64,350 140x8), e4 subtitle (64,378 1100x70).

    page.click(".ribbon-tab[data-tab='arrange']")
    page.mouse.click(*slide_to_screen(page, 600, 280))
    check(page.is_disabled(button("group")) and page.is_disabled(button("ungroup")), "one element: nothing to group")
    page.keyboard.down("Shift")
    page.mouse.click(*slide_to_screen(page, 600, 410))
    page.keyboard.up("Shift")
    page.keyboard.press("Control+g")
    group = ids()
    check(len(group) == 1 and group[0] not in ("e2", "e4") and label() == "Group", f"one group selected: {group}")
    group = group[0]
    check(page.evaluate("id => App.deck.getDocument().querySelector('[data-id=\"' + id + '\"]').getAttribute('data-type')", group)
          == "group", "a group element")
    check(rect(group) == {"left": 64, "top": 230, "width": 1100, "height": 218}, f"around both: {rect(group)}")
    check(on_slide("e4") == [64, 378, 1100, 70], f"the subtitle has not moved on the slide: {on_slide('e4')}")
    check(page.is_enabled(button("ungroup")) and page.is_disabled(button("group")), "a group: Ungroup")
    page.screenshot(path=str(OUTPUT / "85-grouped.png"))

    # Moves as one.
    page.keyboard.press("Shift+ArrowRight")
    check(on_slide("e2")[0] == 74 and on_slide("e4")[0] == 74, f"both 10 px right: {on_slide('e2')} {on_slide('e4')}")
    page.keyboard.press("Control+z")

    # Resizing the group scales its parts: the right handle to half the width.
    side = page.locator("#overlay .selection-handle[data-handle='e']").bounding_box()
    start = [side["x"] + side["width"] / 2, side["y"] + side["height"] / 2]
    zoom = page.evaluate("App.canvas.getZoom()")
    page.keyboard.down("Alt")
    drag(page, start, [start[0] - 550 * zoom, start[1]], steps=10)
    page.keyboard.up("Alt")
    check(abs(rect(group)["width"] - 550) <= 1, f"the group is half as wide: {rect(group)}")
    check(abs(on_slide("e2")[2] - 550) <= 1 and abs(on_slide("e4")[2] - 550) <= 1, f"so are its parts: {on_slide('e2')}")
    check(label() == "Resize", label())
    page.keyboard.press("Control+z")
    check(on_slide("e2") == [64, 230, 1100, 120], f"undo: back: {on_slide('e2')}")

    # Double-click the subtitle: typing in that part; Esc: the group is selected again.
    page.mouse.dblclick(*slide_to_screen(page, 300, 400))
    check(page.evaluate("App.text.isEditing() && App.text.editingElement().getAttribute('data-id')") == "e4", "typing in the subtitle")
    page.keyboard.press("End")
    page.keyboard.type(" X")
    page.keyboard.press("Escape")
    check(ids() == [group], f"Esc: the group selected: {ids()}")
    check(page.evaluate("App.deck.getDocument().querySelector('[data-id=\"e4\"]').textContent").endswith(" X"), "typed")

    # Ctrl+D copies the group with new ids inside too.
    page.keyboard.press("Control+d")
    copy = ids()[0]
    inner = page.evaluate("id => Array.from(App.deck.getDocument().querySelectorAll('[data-id=\"' + id + '\"] .el'), "
                          "(e) => e.getAttribute('data-id'))", copy)
    check(len(inner) == 2 and not set(inner) & {"e2", "e4"}, f"fresh ids inside the copy: {inner}")
    page.keyboard.press("Control+z")

    # Ctrl+Shift+G ungroups: the parts selected, on the slide again, in place.
    page.click("#overlay", position={"x": 5, "y": 5})
    page.mouse.click(*slide_to_screen(page, 600, 280))
    check(ids() == [group], "a click on a part selects the whole group")
    page.keyboard.press("Control+Shift+g")
    check(sorted(ids()) == ["e2", "e4"] and label() == "Ungroup", f"ungrouped: {ids()}")
    check(rect("e2") == {"left": 64, "top": 230, "width": 1100, "height": 120} and rect("e4")["top"] == 378, "slide px again")
    stack = page.evaluate("App.transform.topLevelElements(App.deck.getCurrentSlide()).map((e) => e.getAttribute('data-id'))")
    # The group took the subtitle's place (the topmost part), so the bar is now under both, as in PowerPoint.
    check(stack == ["e1", "e3", "e2", "e4"], f"in the group's place in the stack: {stack}")
    page.keyboard.press("Control+z")
    check(ids() == [group], f"undo: grouped again, the group selected: {ids()}")

    # Saved and reopened: still a group, its parts where they were.
    saved = editor.save_as_download("grouped.html")
    check('data-deck-groups' in saved.read_text(encoding="utf-8"), "the deck carries the group stylesheet")
    editor.open(saved)
    check(page.evaluate("App.deck.getDocument().querySelectorAll('[data-type=\"group\"]').length") == 1, "one group")
    check(on_slide("e4") == [64, 378, 1100, 70], f"the part in place after reopening: {on_slide('e4')}")


def test_rotate(browser):
    """Phase 7: the round handle above the selection turns it (Shift: 15 degree steps), so does the Format pane's
    Rotation field and Arrange > Rotate; a turned element is clicked and resized where it shows; tables and charts
    do not turn; each one undo step; saved and reopened, it stays turned."""
    editor = Editor(browser)
    editor.open(CONTRACT)
    page = editor.page
    label = lambda: page.evaluate("App.history.undoLabel()")  # noqa: E731
    angle = lambda: page.evaluate("App.transform.rotationOf(App.deck.getDocument().querySelector('[data-id=\"e1\"]'))")  # noqa: E731
    shows = lambda: page.evaluate("""() => {  // where the logo shows on the slide (slide px)
        const r = App.deck.getDocument().querySelector('[data-id="e1"]').getBoundingClientRect();
        return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; }""")  # noqa: E731
    button = lambda name: "button[data-command='" + name + "']"  # noqa: E731
    rotate_handle = "#overlay .selection-handle[data-handle='rotate']"
    # Slide 1: e1 logo (64,56 120x40, centre 124,76).

    page.mouse.click(*slide_to_screen(page, 124, 76))
    check(page.is_visible(rotate_handle), "a round rotate handle above the selection")
    handle = page.locator(rotate_handle).bounding_box()
    start = [handle["x"] + handle["width"] / 2, handle["y"] + handle["height"] / 2]
    check(start[1] < slide_to_screen(page, 124, 56)[1], "above the top edge")
    page.keyboard.down("Shift")
    drag(page, start, slide_to_screen(page, 324, 80), steps=10)   # to the right of the centre, Shift: 90 exactly
    page.keyboard.up("Shift")
    check(angle() == 90 and label() == "Rotate", f"turned a quarter: {angle()} {label()}")
    check(page.evaluate("App.deck.getDocument().querySelector('[data-id=\"e1\"]').style.transform") == "rotate(90deg)", "stored")
    check(shows() == [104, 16, 40, 120], f"turned about its centre: {shows()}")
    check(page.input_value("#format-rotation") == "90", "the Format pane shows 90")
    page.screenshot(path=str(OUTPUT / "86-rotated.png"))

    # A click where it shows now (but where it was not) selects it.
    page.click("#overlay", position={"x": 5, "y": 5})
    page.mouse.click(*slide_to_screen(page, 124, 125))
    check(page.evaluate("App.selection.selectedIds()") == ["e1"], "selected where it shows")

    # The Rotation field: 45, Enter; Ctrl+Z: 90 again.
    page.fill("#format-rotation", "45")
    page.press("#format-rotation", "Enter")
    check(angle() == 45 and label() == "Rotate", f"typed 45: {angle()}")
    page.keyboard.press("Escape")
    page.mouse.click(*slide_to_screen(page, 124, 76))
    page.keyboard.press("Control+z")
    check(angle() == 90, f"undo: {angle()}")

    # Resizing the turned logo: its right handle now points down; dragging it down 40 px makes it 40 px wider,
    # and its other end (at the top) stays where it is.
    side = page.locator("#overlay .selection-handle[data-handle='e']").bounding_box()
    start = [side["x"] + side["width"] / 2, side["y"] + side["height"] / 2]
    zoom = page.evaluate("App.canvas.getZoom()")
    drag(page, start, [start[0], start[1] + 40 * zoom], steps=8)
    check(element_rect(page, "e1") == {"left": 44, "top": 76, "width": 160, "height": 40}, f"wider: {element_rect(page, 'e1')}")
    check(shows() == [104, 16, 40, 160], f"its top end stayed: {shows()}")
    page.keyboard.press("Control+z")

    # Snapping goes by what shows: the turned logo (40 px wide on screen, from x 104) dragged 100 px left
    # snaps its shown left edge onto the slide's edge.
    drag(page, slide_to_screen(page, 124, 100), slide_to_screen(page, 24, 100), steps=10)
    check(shows()[0] == 0 and element_rect(page, "e1")["left"] == -40, f"snapped by what shows: {shows()} {element_rect(page, 'e1')}")
    page.keyboard.press("Control+z")

    # Arrange > Rotate Right 90 / Rotate Left 90.
    page.click(".ribbon-tab[data-tab='arrange']")
    page.click(button("rotateRight90"))
    check(angle() == 180 and label() == "Rotate", f"right 90: {angle()}")
    page.click(button("rotateLeft90"))
    page.click(button("rotateLeft90"))
    check(angle() == 0 and page.evaluate("App.deck.getDocument().querySelector('[data-id=\"e1\"]').style.transform") == "",
          "left 90 twice: upright, no transform left")
    for _ in range(3):
        page.keyboard.press("Control+z")
    check(angle() == 90, f"undo three times: {angle()}")
    page.click(button("alignObjectsLeft"))
    check(shows()[0] == 0 and element_rect(page, "e1")["left"] == -40, f"aligned by what shows: {shows()}")
    page.keyboard.press("Control+z")

    # A turned picture is not cropped (the crop frame is upright): Crop is off until it is upright again.
    page.mouse.click(*slide_to_screen(page, 124, 76))
    check(page.evaluate("App.selection.selectedIds()") == ["e1"] and angle() == 90, "the turned logo selected")
    check(not page.evaluate("App.commands.isEnabled('cropPicture')"), "no crop while turned")

    # A table does not turn (nor does a chart), as in PowerPoint.
    page.evaluate("App.deck.goTo(2)")
    page.evaluate("App.selection.select(App.deck.getDocument().querySelector('[data-id=\"e9\"]'))")
    check(page.is_hidden(rotate_handle) and page.is_disabled("#format-rotation") and page.is_disabled(button("rotateRight90")),
          "no rotation for a table")
    page.evaluate("App.deck.goTo(0)")

    # Saved and reopened: still turned.
    saved = editor.save_as_download("rotated.html")
    editor.open(saved)
    check(angle() == 90 and shows() == [104, 16, 40, 120], f"turned after reopening: {angle()} {shows()}")


def test_lock(browser):
    """Phase 7: Arrange > Lock (and the right-click menu): a locked element stays selectable (to unlock it, format it,
    type in it) but cannot be moved, resized, turned or deleted: no handles; drag, arrows, Delete, Ctrl+X, align and
    the Format pane leave it; with others selected they move, it stays. One undo step; kept when saved; copies are not locked."""
    context = browser.new_context(viewport={"width": 1440, "height": 900}, accept_downloads=True)
    context.grant_permissions(["clipboard-read", "clipboard-write"])
    editor = Editor(browser, context)
    editor.open(CONTRACT)
    page = editor.page
    label = lambda: page.evaluate("App.history.undoLabel()")  # noqa: E731
    rect = lambda name: element_rect(page, name)  # noqa: E731
    exists = lambda name: page.evaluate("id => !!App.deck.getDocument().querySelector('[data-id=\"' + id + '\"]')", name)  # noqa: E731
    button = lambda name: "button[data-command='" + name + "']"  # noqa: E731
    logo = {"left": 64, "top": 56, "width": 120, "height": 40}
    # Slide 1: e1 logo (64,56 120x40), e2 title (64,230 1100x120).

    page.click(".ribbon-tab[data-tab='arrange']")
    page.mouse.click(*slide_to_screen(page, 124, 76))
    check(page.get_attribute(button("lock"), "aria-pressed") == "false", "not locked yet")
    page.click(button("lock"))
    check(label() == "Lock" and page.get_attribute(button("lock"), "aria-pressed") == "true", f"locked: {label()}")
    check(page.evaluate("App.deck.getDocument().querySelector('[data-id=\"e1\"]').getAttribute('data-locked')") == "true", "stored")
    check(page.evaluate("App.selection.selectedIds()") == ["e1"], "still selected")
    check(page.locator("#overlay .selection-handle:visible").count() == 0, "no handles")
    check(page.is_visible("#overlay .selection-box.locked"), "the box shows it is locked")
    page.screenshot(path=str(OUTPUT / "87-locked.png"))

    # Nothing moves it.
    drag(page, slide_to_screen(page, 124, 76), slide_to_screen(page, 424, 176), steps=8)
    page.keyboard.press("ArrowRight")
    page.keyboard.press("Delete")
    page.keyboard.press("Control+x")
    page.click(button("alignObjectsCenter"))
    check(rect("e1") == logo and exists("e1"), f"not moved, not deleted: {rect('e1')}")
    check(label() == "Lock", f"no undo steps: {label()}")
    check(page.is_disabled("#format-x") and page.is_disabled("#format-w") and page.is_disabled("#format-rotation"),
          "the Format pane's size and position are off")
    check(page.is_disabled(button("rotateRight90")), "no turning")
    check(not page.evaluate("App.commands.isEnabled('changePicture') || App.commands.isEnabled('resetPictureSize')"),
          "Change Picture and Reset Size are off (they would resize it)")
    put_text_on_clipboard(page, "kept")
    page.keyboard.press("Control+x")
    check(page.evaluate("navigator.clipboard.readText()") == "kept", "Ctrl+X on a locked element leaves the clipboard alone")

    # With others selected: they move, it stays.
    page.keyboard.press("Control+a")
    drag(page, slide_to_screen(page, 600, 290), slide_to_screen(page, 600, 340), steps=8)
    check(rect("e2")["top"] == 280 and rect("e1") == logo, f"the title moved, the logo did not: {rect('e2')} {rect('e1')}")
    page.keyboard.press("Control+z")
    page.keyboard.press("Delete")
    check(exists("e1") and not exists("e2"), "Delete takes the others, the locked one stays")
    page.keyboard.press("Control+z")

    # A copy is not locked.
    page.click("#overlay", position={"x": 5, "y": 5})
    page.mouse.click(*slide_to_screen(page, 124, 76))
    page.keyboard.press("Control+d")
    copy = page.evaluate("App.selection.selectedIds()")[0]
    check(copy != "e1" and page.evaluate("id => App.deck.getDocument().querySelector('[data-id=\"' + id + '\"]').hasAttribute('data-locked')",
                                         copy) is False, "the copy is not locked")
    page.keyboard.press("Control+z")

    # Right-click > Lock is ticked; clicking it unlocks; then the logo moves again.
    page.mouse.click(*slide_to_screen(page, 124, 76), button="right")
    check(page.get_attribute(".context-menu [data-command='lock']", "aria-checked") == "true", "ticked in the menu")
    page.click(".context-menu [data-command='lock']")
    check(label() == "Unlock" and not page.evaluate("App.deck.getDocument().querySelector('[data-id=\"e1\"]').hasAttribute('data-locked')"),
          "unlocked")
    page.keyboard.press("ArrowRight")
    check(rect("e1")["left"] == 65, f"moves again: {rect('e1')}")
    page.keyboard.press("Control+z")
    page.keyboard.press("Control+z")
    check(page.evaluate("App.deck.getDocument().querySelector('[data-id=\"e1\"]').getAttribute('data-locked')") == "true", "undo: locked")

    # A locked table keeps its rows and columns: Table > Layout cannot add, delete or remove it.
    page.evaluate("App.deck.goTo(2)")
    page.evaluate("App.selection.select(App.deck.getDocument().querySelector('[data-id=\"e9\"]')); App.elements.toggleLock()")
    page.mouse.click(*slide_to_screen(page, 200, 196))   # types in Beta Foods' cell
    check(page.evaluate("App.text.isEditing()"), "typing in a locked table's cell")
    check(not page.evaluate("['insertRowBelow', 'insertColumnLeft', 'deleteRows', 'deleteColumns', 'deleteTable']"
                            ".some((name) => App.commands.isEnabled(name))"), "no rows or columns added or deleted")
    page.keyboard.press("Escape")
    page.evaluate("App.deck.goTo(0)")

    # Saved and reopened: still locked.
    saved = editor.save_as_download("locked.html")
    editor.open(saved)
    check(page.evaluate("App.deck.getDocument().querySelector('[data-id=\"e1\"]').getAttribute('data-locked')") == "true",
          "locked after reopening")


MASTER_ON = """id => {   // what the slide master shows on slide `id`: { role: text } ('' for the logo), or null
    const layer = App.deck.getDocument().querySelector('[data-slide-id="' + id + '"] > .master-layer');
    if (!layer) { return null; }
    const out = {};
    layer.querySelectorAll('[data-master]').forEach((item) => { out[item.getAttribute('data-master')] = item.textContent; });
    return out; }"""


def test_slide_master(browser):
    """Phase 7: View > Slide Master: a fill-in dialog for a logo (picture and corner), a footer text, the Confidencial
    label and slide numbers (3 / 15), not on the title slide; on every slide, renumbered as slides come, go and move;
    nothing to select on the slide; one undo step; saved, reopened and presented as it was, the file unchanged."""
    editor = Editor(browser)
    editor.open(CONTRACT)
    page = editor.page
    on = lambda name: page.evaluate(MASTER_ON, name)  # noqa: E731
    label = lambda: page.evaluate("App.history.undoLabel()")  # noqa: E731
    logo = picture_file(page, "master-logo.png", "logo", 300, 100)
    # Slides s1 (title) … s6; s5 is hidden.

    page.click(".ribbon-tab[data-tab='view']")
    page.click("button[data-command='slideMaster']")
    check(page.is_visible("dialog[open] #master-footer"), "the Slide Master dialog")
    check(page.is_checked("#master-skip-title") and page.input_value("#master-numbers") == "none", "defaults")
    page.fill("#master-footer", "Projeto Atlas · Comitê de Investimentos")
    page.check("#master-label-on")
    check(page.input_value("#master-label") == "Confidencial", "the label's text")
    page.select_option("#master-numbers", "n/total")
    page.set_input_files("#master-logo-file", str(logo))
    wait_until(page, "document.querySelector('#master-logo-preview') && !document.querySelector('#master-logo-preview').hidden")
    page.select_option("#master-logo-corner", "top-right")
    page.screenshot(path=str(OUTPUT / "88-slide-master-dialog.png"))
    editor.click_dialog_button("Apply")
    check(label() == "Slide master", f"one undo step: {label()}")

    check(on("s1") is None, "not on the title slide")
    check(on("s2") == {"logo": "", "footer": "Projeto Atlas · Comitê de Investimentos", "label": "Confidencial", "number": "2 / 6"},
          f"on slide 2: {on('s2')}")
    check(on("s5")["number"] == "5 / 6", "the hidden slide counts")
    src_count = page.evaluate("""() => { const doc = App.deck.getDocument();
        return doc.documentElement.outerHTML.split(App.master.read(doc).logo.src).length - 1; }""")
    check(src_count == 1, f"the logo picture is in the deck once: {src_count}")
    page.evaluate("App.deck.goTo(1)")
    page.screenshot(path=str(OUTPUT / "89-slide-master-on-slide.png"))

    # Nothing of it to select: a click on the footer selects nothing, Ctrl+A only the slide's own elements.
    page.mouse.click(*slide_to_screen(page, 300, 694))
    check(page.evaluate("App.selection.selectedIds()") == [], "a click on the footer selects nothing")
    page.keyboard.press("Control+a")
    check(sorted(page.evaluate("App.selection.selectedIds()")) == ["e5", "e6", "e7"], f"Ctrl+A: the slide's own elements: {page.evaluate('App.selection.selectedIds()')}")
    page.keyboard.press("Escape")

    # Numbers follow the slides: a new slide after slide 2 is 3 / 7, the old slide 3 now 4 / 7 (its thumbnail too).
    page.keyboard.press("Control+m")
    new_id = page.evaluate("App.deck.getCurrentSlide().getAttribute('data-slide-id')")
    check(on(new_id)["number"] == "3 / 7" and on("s3")["number"] == "4 / 7", f"renumbered: {on(new_id)} {on('s3')}")
    wait_until(page, """Array.from(document.querySelectorAll('.thumb-frame'))[3] &&
        Array.from(document.querySelectorAll('.thumb-frame'))[3].contentDocument.body.textContent.includes('4 / 7')""")
    page.keyboard.press("Control+z")
    check(on("s3")["number"] == "3 / 6", f"undo: back to 3 / 6: {on('s3')}")

    # Undo of the dialog: gone from every slide; redo: back.
    check(label() == "Slide master", label())
    page.keyboard.press("Control+z")
    check(page.evaluate("App.deck.getDocument().querySelectorAll('.master, .master-layer').length") == 0, "undo: no master at all")
    page.keyboard.press("Control+y")
    check(on("s2")["number"] == "2 / 6", "redo: back")

    # The dialog shows what is set.
    page.click("button[data-command='slideMaster']")
    check(page.input_value("#master-footer") == "Projeto Atlas · Comitê de Investimentos" and
          page.input_value("#master-numbers") == "n/total" and page.input_value("#master-logo-corner") == "top-right", "shown again")
    editor.click_dialog_button("Cancel")

    # Saved, reopened: no import report, nothing to save; saved again: the same file.
    saved = editor.save_as_download("master.html")
    first = saved.read_text(encoding="utf-8")
    editor.open(saved)
    check(not page.query_selector("dialog[open]"), "no import report")
    check(page.inner_text("#status-save") == "Saved", f"nothing changed by opening: {page.inner_text('#status-save')}")
    check(on("s2")["footer"].startswith("Projeto Atlas"), "on the slides again")
    again = editor.save_as_download("master-again.html")
    check(again.read_text(encoding="utf-8") == first, "saved again: the same file")

    # Presented on its own: slide 2 shows the footer and its number; the master itself never shows.
    player, errors = play_saved_deck(browser, saved)
    player.keyboard.press("ArrowRight")
    shown = player.evaluate("""() => { const item = document.querySelector('.deck-player-current .master-layer [data-master="number"]');
        return [item && item.textContent, item && item.getBoundingClientRect().width > 0,
                getComputedStyle(document.querySelector('.master')).display]; }""")
    check(shown == ["2 / 6", True, "none"] and not errors, f"presented: {shown} {errors}")
    player.context.close()


def own_footers_deck(name):
    """The contract deck with its own footer and page number typed as text boxes on every slide, as Copilot does."""
    text = CONTRACT.read_text(encoding="utf-8")
    parts = text.split("</section>")
    for k in range(len(parts) - 1):
        boxes = (f'<div class="el" data-type="text" data-id="own-f{k + 1}" style="left:48px; top:684px; width:400px; height:24px; '
                 f'z-index:20"><p data-list="none" data-level="1">Atlas · material confidencial</p></div>'
                 f'<div class="el" data-type="text" data-id="own-n{k + 1}" style="left:1150px; top:684px; width:80px; height:24px; '
                 f'z-index:21"><p data-list="none" data-level="1">{k + 1}</p></div>')
        at = parts[k].rfind('<aside class="notes"')
        parts[k] = parts[k][:at] + boxes + parts[k][at:] if at != -1 else parts[k] + boxes
    path = OUTPUT / name
    path.write_text("</section>".join(parts), encoding="utf-8")
    return path


def test_slide_master_own_footers(browser):
    """Phase 7: a deck that has its own footer and page numbers as text boxes: Apply in Slide Master lists them and
    offers to remove them (one undo step with the master), to keep them, or to go back; the title slide's own stay."""
    editor = Editor(browser)
    editor.open(own_footers_deck("own-footers.html"))
    editor.close_dialog_if_open()
    page = editor.page
    own = lambda: page.evaluate("App.deck.getDocument().querySelectorAll('[data-id^=\"own-\"]').length")  # noqa: E731
    masters = lambda: page.evaluate("App.deck.getDocument().querySelectorAll('.master').length")  # noqa: E731

    def fill_master():
        page.click("button[data-command='slideMaster']")
        page.fill("#master-footer", "Projeto Atlas")
        page.select_option("#master-numbers", "n")
        page.click("dialog[open] button:has-text('Apply')")
        wait_until(page, "document.querySelector('dialog[open] .master-own')")

    page.click(".ribbon-tab[data-tab='view']")
    check(own() == 12, f"the deck's own boxes: {own()}")
    fill_master()
    listed = page.inner_text("dialog[open] .master-own")
    check("Slide numbers on slides 2–6" in listed and "“Atlas · material confidencial” on slides 2–6" in listed, f"listed: {listed}")
    page.screenshot(path=str(OUTPUT / "90-slide-master-own-footers.png"))
    editor.click_dialog_button("Remove them")
    check(own() == 2 and masters() == 1, f"removed (the title slide's stay), the master on: {own()} {masters()}")
    check(page.evaluate(MASTER_ON, "s2")["number"] == "2", "the master's number instead")
    check(page.evaluate("App.history.undoLabel()") == "Slide master", "one undo step")
    page.keyboard.press("Control+z")
    check(own() == 12 and masters() == 0, f"undo: both back as before: {own()} {masters()}")

    # Keep them: the master goes on, the boxes stay.
    fill_master()
    editor.click_dialog_button("Keep them")
    check(own() == 12 and masters() == 1, f"kept: {own()} {masters()}")
    page.keyboard.press("Control+z")

    # Cancel: nothing happens.
    fill_master()
    editor.click_dialog_button("Cancel")
    check(own() == 12 and masters() == 0, f"cancelled: {own()} {masters()}")


def test_theme_editor(browser):
    """Phase 7: Design > Edit Theme: the deck's colours and fonts beside the slide, shown at once (never saved while
    previewing); Cancel leaves it as it was; Apply is one undo step; Copy Theme from Deck… takes another deck's colours,
    fonts and slide master (only safe values); saved and reopened as it was, the file unchanged."""
    editor = Editor(browser)
    editor.open(CONTRACT)
    page = editor.page
    root = lambda name: page.evaluate("n => getComputedStyle(App.deck.getDocument().documentElement).getPropertyValue(n).trim()", name)  # noqa: E731
    title = lambda prop: page.evaluate("p => getComputedStyle(App.deck.getDocument().querySelector('[data-id=\"e2\"]'))[p]", prop)  # noqa: E731
    label = lambda: page.evaluate("App.history.undoLabel()")  # noqa: E731
    saved_text = lambda: page.evaluate("App.serialize.toHtml(App.deck.getDocument(), { playerJs: '', playerCss: '' })")  # noqa: E731
    # Slide 1: the title e2 is in the accent colour (#1F2A44) and the heading font.

    page.click(".ribbon-tab[data-tab='design']")
    page.click("button[data-command='editTheme']")
    check(page.is_visible("dialog.dialog-side #theme-color-accent-hex"), "the theme panel beside the slide")
    check(page.input_value("#theme-color-accent-hex") == "#1F2A44" and page.input_value("#theme-font-heading") == "Calibri, Arial, sans-serif",
          f"the deck's values: {page.input_value('#theme-color-accent-hex')} {page.input_value('#theme-font-heading')}")
    page.fill("#theme-color-accent-hex", "#0070C0")
    page.press("#theme-color-accent-hex", "Enter")
    page.select_option("#theme-font-heading", label="Georgia")
    check(title("color") == "rgb(0, 112, 192)" and "Georgia" in title("fontFamily"), f"shown at once: {title('color')} {title('fontFamily')}")
    check("#0070C0" not in saved_text() and "Georgia" not in saved_text(), "the preview is never saved")
    page.screenshot(path=str(OUTPUT / "91-theme-editor.png"))
    editor.click_dialog_button("Cancel")
    check(title("color") == "rgb(31, 42, 68)" and "Georgia" not in title("fontFamily") and label() is None, "Cancel: as it was, no step")

    # Apply: one undo step; Ctrl+Z / Ctrl+Y.
    page.click("button[data-command='editTheme']")
    page.fill("#theme-color-accent-hex", "#0070C0")
    page.press("#theme-color-accent-hex", "Enter")
    page.select_option("#theme-font-heading", label="Georgia")
    editor.click_dialog_button("Apply")
    check(label() == "Theme" and root("--color-accent") == "#0070C0" and root("--font-heading") == "Georgia, serif",
          f"applied: {label()} {root('--color-accent')} {root('--font-heading')}")
    check(page.evaluate("App.deck.getDocument().querySelectorAll('style[data-deck-theme]').length") == 0 and
          "--color-accent: #0070C0;" in page.evaluate("App.deck.getDocument().head.querySelector('style:not([data-deck-lists])').textContent"),
          "written where the deck declares it, no block of its own")
    page.keyboard.press("Control+z")
    check(root("--color-accent") == "#1F2A44" and title("color") == "rgb(31, 42, 68)", "undo: the old theme")
    page.keyboard.press("Control+y")
    check(title("color") == "rgb(0, 112, 192)", "redo")
    state = page.evaluate("App.history.stateId()")
    page.click("button[data-command='editTheme']")
    editor.click_dialog_button("Apply")
    check(page.evaluate("App.history.stateId()") == state, "Apply with no change: no new step")

    # Copy Theme from Deck…: another deck's colours, fonts and slide master; its unsafe values are left out.
    other = OUTPUT / "other-theme.html"
    other.write_text('<!DOCTYPE html><html><head><meta charset="utf-8"><style>:root { --color-primary: #00843D; '
                     '--color-accent: #123456; --font-heading: Georgia, serif; --font-body: "Segoe UI", Arial, sans-serif; '
                     '--color-text: red; } body { --color-bg: url(http://evil/x.png); }</style></head><body>'
                     '<section class="slide"></section><div class="master" data-numbers="n" data-skip-title="true">'
                     '<div class="master-item" data-master="footer" style="left: 48px; top: 684px; width: 560px; height: 20px;">'
                     'Empresa · Uso interno</div><div class="master-item" data-master="number" style="left: 1132px; top: 684px; '
                     'width: 100px; height: 20px;"></div></div></body></html>', encoding="utf-8")
    page.click("button[data-command='editTheme']")
    page.set_input_files("#theme-copy-file", str(other))
    wait_until(page, "document.querySelector('.theme-copy-note') && document.querySelector('.theme-copy-note').textContent !== ''")
    check("slide master" in page.inner_text(".theme-copy-note"), page.inner_text(".theme-copy-note"))
    check(page.input_value("#theme-color-accent-hex") == "#123456", "the other deck's accent")
    editor.click_dialog_button("Apply")
    check(root("--color-accent") == "#123456" and root("--font-body") == '"Segoe UI", Arial, sans-serif' and root("--color-text") == "red",
          f"copied: {root('--color-accent')} {root('--font-body')}")
    check(page.evaluate(MASTER_ON, "s2") == {"footer": "Empresa · Uso interno", "number": "2"}, f"its master too: {page.evaluate(MASTER_ON, 's2')}")
    check("evil" not in saved_text(), "nothing unsafe came along")
    page.keyboard.press("Control+z")
    check(root("--color-accent") == "#0070C0" and page.evaluate(MASTER_ON, "s2") is None, "one undo step takes both back")
    page.keyboard.press("Control+y")

    # Saved, reopened: the same theme; saved again: the same file.
    saved = editor.save_as_download("themed.html")
    first = saved.read_text(encoding="utf-8")
    editor.open(saved)
    check(page.inner_text("#status-save") == "Saved" and root("--color-accent") == "#123456", "reopened as it was")
    again = editor.save_as_download("themed-again.html")
    check(again.read_text(encoding="utf-8") == first, "saved again: the same file")

    # Edited by hand afterwards (VS Code, Copilot): the hand-edited colour shows.
    check(first.count("--color-accent: #123456;") == 1, "the accent is in the file once, where the deck declares it")
    by_hand = OUTPUT / "themed-by-hand.html"
    by_hand.write_text(first.replace("--color-accent: #123456;", "--color-accent: #FF0000;"), encoding="utf-8")
    editor.open(by_hand)
    check(root("--color-accent") == "#FF0000", f"the hand edit shows: {root('--color-accent')}")

    # A deck saved by the earlier theme editor (a block of its own) is folded into its own :root on open.
    older = OUTPUT / "themed-older.html"
    older.write_text(first.replace("<style data-deck-table", "<style data-deck-theme>:root { --color-accent: #0070C0; }</style>"
                                   "<style data-deck-table", 1), encoding="utf-8")
    editor.open(older)
    editor.close_dialog_if_open()
    check(root("--color-accent") == "#0070C0" and
          page.evaluate("App.deck.getDocument().querySelectorAll('style[data-deck-theme]').length") == 0, "folded in on open")


def fifteen_slide_deck(name):
    """A 15-slide deck as Copilot writes it (fake content): the contract deck's theme, a title slide, then sections
    with a title and points, its own footer and page number typed on every slide; slide 6 has three cards out of line."""
    text = CONTRACT.read_text(encoding="utf-8")
    head = text[:text.index("<body>") + len("<body>")]
    box = lambda id_, rect, inner, look="": (  # noqa: E731
        f'<div class="el" data-type="text" data-id="{id_}" style="left: {rect[0]}px; top: {rect[1]}px; width: {rect[2]}px; '
        f'height: {rect[3]}px; z-index: {rect[4]};{look}"><p data-list="none" data-level="1">{inner}</p></div>')
    heading = " font-family: var(--font-heading); color: var(--color-accent); font-size: 25.5pt; font-weight: bold;"
    slides = []
    for k in range(1, 16):
        own = box(f"own-f{k}", (48, 684, 400, 24, 20), "Projeto Atlas · Confidencial")
        if k == 1:
            body = box("t1", (64, 230, 1100, 120, 1), "Projeto Atlas", heading.replace("25.5pt", "39pt")) + own
            slides.append(f'<section class="slide" data-slide-id="s1" data-layout="title">{body}</section>')
            continue
        own += box(f"own-n{k}", (1150, 684, 80, 24, 21), str(k))
        if k == 6:
            content = (box("card-a", (64, 200, 300, 200, 2), "Mercado") + box("card-b", (470, 214, 300, 200, 3), "Tese") +
                       box("card-c", (900, 190, 316, 200, 4), "Riscos"))
        else:
            content = box(f"b{k}", (64, 150, 1152, 300, 2), f"Ponto principal da seção {k}")
        slides.append(f'<section class="slide" data-slide-id="s{k}" data-layout="title-content">'
                      f'{box(f"t{k}", (64, 48, 1152, 60, 1), f"Seção {k}", heading)}{content}{own}'
                      f'<aside class="notes">Notas {k}</aside></section>')
    path = OUTPUT / name
    path.write_text(head + "\n" + "\n".join(slides) + "\n</body>\n</html>\n", encoding="utf-8")
    return path


def test_phase7_done_when(browser):
    """
    Phase 7 "done when", automated: a 15-slide deck (as Copilot writes it, with its own footer and page numbers on every
    slide) is restructured (a slide moved, one deleted, one duplicated, one hidden, one added), a row of cards aligned,
    spread and grouped, and rebranded from another deck (colours, fonts, slide master with logo, footer and numbers; the
    deck's own footers and stale numbers removed), in well under a minute; saved, reopened, presented and printed.
    """
    editor = Editor(browser)
    editor.open(fifteen_slide_deck("fifteen-slides.html"))
    editor.close_dialog_if_open()
    page = editor.page
    started = time.time()
    ids = lambda: page.evaluate("App.deck.getSlides().map((s) => s.getAttribute('data-slide-id'))")  # noqa: E731
    root = lambda n: page.evaluate("n => getComputedStyle(App.deck.getDocument().documentElement).getPropertyValue(n).trim()", n)  # noqa: E731
    check(len(ids()) == 15, f"15 slides: {ids()}")

    # Restructure: the last slide moves up to second place, slide 7 goes, slide 2 is duplicated, slide 14 hidden, one added.
    page.focus("#thumbnail-rail .thumb[data-index='14']")
    for _ in range(13):
        page.keyboard.press("Control+ArrowUp")
    check(ids()[:3] == ["s1", "s15", "s2"], f"moved up: {ids()[:3]}")
    page.focus(f"#thumbnail-rail .thumb[data-index='{ids().index('s7')}']")
    page.keyboard.press("Delete")
    page.focus(f"#thumbnail-rail .thumb[data-index='{ids().index('s2')}']")
    page.keyboard.press("Control+d")
    page.evaluate(f"App.deck.goTo({ids().index('s14')})")
    page.click(".ribbon-tab[data-tab='slideshow']")
    page.click("button[data-command='hideSlide']")
    page.evaluate(f"App.deck.goTo({len(ids()) - 1})")
    page.keyboard.press("Control+m")
    order = ids()
    titles = page.evaluate("""() => App.deck.getSlides().map((s) => { const t = s.querySelector(':scope > .el[data-type="text"]');
        return t ? t.textContent : null; })""")
    check(len(order) == 16 and "Seção 7" not in titles and titles[:4] == ["Projeto Atlas", "Seção 15", "Seção 2", "Seção 2"],
          f"restructured: {titles}")

    # Align: the three cards of slide 6, caught with a rubber band, lined up at the top, spread evenly, grouped.
    page.evaluate(f"App.deck.goTo({order.index('s6')})")
    drag(page, slide_to_screen(page, 30, 170), slide_to_screen(page, 1250, 430), steps=8)
    check(sorted(page.evaluate("App.selection.selectedIds()")) == ["card-a", "card-b", "card-c"], "the three cards")
    page.click(".ribbon-tab[data-tab='arrange']")
    page.click("button[data-command='alignObjectsTop']")
    page.click("button[data-command='distributeHorizontally']")
    cards = [element_rect(page, name) for name in ["card-a", "card-b", "card-c"]]
    gaps = [cards[1]["left"] - cards[0]["left"] - cards[0]["width"], cards[2]["left"] - cards[1]["left"] - cards[1]["width"]]
    check(len({card["top"] for card in cards}) == 1 and abs(gaps[0] - gaps[1]) < 0.02, f"lined up and spread: {cards} {gaps}")
    page.keyboard.press("Control+g")
    check(page.evaluate("App.selection.count()") == 1, "grouped")

    # Rebrand from the company's own deck: colours, fonts and its slide master; the deck's own footers and numbers go.
    logo = base64.b64decode(page.evaluate(DRAW_PICTURE, ["logo", 240, 80])).hex()
    brand = OUTPUT / "brand-deck.html"
    brand.write_text(
        '<!DOCTYPE html><html><head><meta charset="utf-8"><style>:root { --color-primary: #00843D; --color-accent: #0B3D2E; '
        '--font-heading: "Segoe UI", Arial, sans-serif; --font-body: "Segoe UI", Arial, sans-serif; }</style>'
        '<style data-deck-master>.master-item[data-master="logo"] { background-image: url("data:image/png;base64,'
        + base64.b64encode(bytes.fromhex(logo)).decode() + '"); }</style></head><body><section class="slide"></section>'
        '<div class="master" data-numbers="n/total" data-skip-title="true">'
        '<div class="master-item" data-master="logo" data-corner="top-right" style="left: 1112px; top: 24px; width: 120px; height: 40px;"></div>'
        '<div class="master-item" data-master="footer" style="left: 48px; top: 684px; width: 560px; height: 20px;">Empresa Exemplo · Uso interno</div>'
        '<div class="master-item" data-master="number" style="left: 1132px; top: 684px; width: 100px; height: 20px;"></div>'
        '</div></body></html>', encoding="utf-8")
    page.click(".ribbon-tab[data-tab='design']")
    with page.expect_file_chooser() as chooser:
        page.click("button[data-command='copyTheme']")
    chooser.value.set_files([str(brand)])
    wait_until(page, "document.querySelector('.theme-copy-note') && document.querySelector('.theme-copy-note').textContent !== ''")
    page.click("dialog[open] button:has-text('Apply')")
    wait_until(page, "document.querySelector('dialog[open] .master-own')")
    listed = page.inner_text("dialog[open] .master-own")
    check("Slide numbers on slides 2–15" in listed and "“Projeto Atlas · Confidencial” on slides 2–15" in listed, f"listed: {listed}")
    editor.click_dialog_button("Remove them")
    elapsed = time.time() - started

    own_left = page.evaluate("""() => Array.from(App.deck.getDocument().querySelectorAll('section.slide > .el[data-type="text"]'))
        .filter((e) => /^(Projeto Atlas · Confidencial|\\d+)$/.test(e.textContent.trim())).length""")
    check(own_left == 1, f"only the title slide keeps its own footer (the master skips it): {own_left}")
    check(root("--color-accent") == "#0B3D2E" and root("--font-heading") == '"Segoe UI", Arial, sans-serif', "the company's theme")
    shown = page.evaluate(MASTER_ON, ids()[1])
    check(shown == {"logo": "", "footer": "Empresa Exemplo · Uso interno", "number": "2 / 16"}, f"the company's master: {shown}")
    check(page.evaluate(MASTER_ON, "s1") is None, "not on the title slide")
    check(elapsed < 60, f"restructured, aligned and rebranded in {elapsed:.1f} s")
    page.evaluate("App.deck.goTo(1)")
    page.screenshot(path=str(OUTPUT / "92-phase7-done-when.png"))

    # Saved and reopened: as it was. Presented: the hidden slide skipped. Printed: one page per shown slide.
    saved = editor.save_as_download("phase7-done-when.html")
    final = ids()
    editor.open(saved)
    check(page.inner_text("#status-save") == "Saved" and ids() == final and root("--color-accent") == "#0B3D2E", "reopened as it was")
    player, errors = play_saved_deck(browser, saved)
    check(player.evaluate("document.querySelectorAll('section.slide:not([data-hidden=\"true\"])').length") == 15, "15 slides shown")
    player.keyboard.press("ArrowRight")
    footer = player.evaluate("""() => { const f = document.querySelector('.deck-player-current .master-layer [data-master="footer"]');
        return f && f.textContent; }""")
    check(footer == "Empresa Exemplo · Uso interno", f"presented with the company's footer: {footer}")
    player.emulate_media(media="print")
    pdf = OUTPUT / "phase7-done-when.pdf"
    player.pdf(path=str(pdf), prefer_css_page_size=True, print_background=True)
    pages = len(re.findall(rb"/Type\s*/Page[^s]", pdf.read_bytes()))
    check(pages == 15, f"one page per shown slide: {pages}")
    check(errors == [] and editor.errors == [], f"no errors: {errors} {editor.errors}")
    player.context.close()
    editor.close()


def App_round(value):
    """Round as the editor writes numbers: at most two decimals, no trailing zeros."""
    rounded = round(value, 2)
    return int(rounded) if rounded == int(rounded) else rounded


def test_table_layout(browser):
    """Table > Layout: select cells by dragging or Shift+click; insert / delete rows and columns, merge, split, delete."""
    editor = Editor(browser)
    editor.open(CONTRACT)
    page = editor.page
    page.evaluate("App.deck.goTo(2)")   # the comps table e9: rows from y = 140 (about 37 px), columns at x = 64 / 375 / 592 / 915
    grid = lambda: page.evaluate(E9_GRID)  # noqa: E731
    layout_tab = ".ribbon-tab[data-tab='table-layout']"
    run = lambda command: page.click(f".ribbon-button[data-command='{command}']")  # noqa: E731
    key = lambda: page.evaluate(EDITING_KEY)  # noqa: E731
    start = grid()
    check(page.is_hidden(layout_tab), "no Layout tab without a table")

    # Typing in a cell shows the Layout tab; it works on that cell.
    page.mouse.click(*slide_to_screen(page, 200, 196))   # Beta Foods
    check(page.is_visible(layout_tab), "a table selected: the Layout tab shows")
    page.click(layout_tab)
    check(key() == "e9/1/0", f"the tab does not end typing: {key()}")
    page.screenshot(path=str(OUTPUT / "43-table-layout-tab.png"))
    run("insertRowBelow")
    check(len(grid()) == 7 and grid()[2] == "_|_|_|_" and key() == "e9/1/0", f"a row under Beta Foods, typing goes on: {grid()}")
    run("insertRowAbove")
    check(len(grid()) == 8 and grid()[1] == "_|_|_|_" and grid()[2].startswith("Beta Foods"), f"a row above: {grid()}")
    width = element_rect(page, "e9")["width"]
    run("insertColumnRight")
    check(grid()[0] == "Empresa|_|EV (R$ mn)|EV/EBITDA 2025E|Margem EBITDA", f"a column right of it: {grid()[0]}")
    check(element_rect(page, "e9")["width"] > width + 300, f"the table got wider by that column: {element_rect(page, 'e9')}")
    page.keyboard.press("Tab")   # into the new column
    run("deleteColumns")
    check(abs(element_rect(page, "e9")["width"] - width) < 0.05, "the column deleted: back to its width")
    check(key() == "e9/2/1", f"typing goes on in the cell now in its place (Beta's 2.450): {key()}")
    run("deleteRows")
    check(len(grid()) == 7 and not any(row.startswith("Beta Foods") for row in grid()), f"Beta's row deleted: {grid()}")
    for _ in range(5):
        page.keyboard.press("Control+Z")
    check(grid() == start, f"five undos: as it was: {grid()}")

    # A drag across cells selects them; Merge makes one cell of them, Split gives them back.
    page.keyboard.press("Escape")
    drag(page, slide_to_screen(page, 480, 196), slide_to_screen(page, 750, 232))
    check(key() is None and page.is_visible(".cell-block"), "a drag across cells selects cells, not text")
    block = page.evaluate("App.transform.readRect(document.querySelector('.cell-block'))")
    check(abs(block["left"] - 375) < 2 and abs(block["top"] - 178) < 2 and abs(block["width"] - 540) < 3 and abs(block["height"] - 73.5) < 2,
          f"the shaded block covers the four cells: {block}")
    page.click(layout_tab)
    run("mergeCells")
    check(grid()[1] == "Beta Foods|2.450/9,8x/1.120/8,9x|2.450/9,8x/1.120/8,9x|19,5%", f"merged, the text kept: {grid()[1:3]}")
    check(key() == "e9/1/1" and page.evaluate("App.history.undoLabel()") == "Merge cells", f"typing in the merged cell: {key()}")
    run("splitCells")
    check(grid()[1] == "Beta Foods|2.450/9,8x/1.120/8,9x|_|19,5%" and grid()[2] == "Gama Nutrição|_|_|17,2%", f"split: {grid()[1:3]}")
    page.keyboard.press("Control+Z")
    page.keyboard.press("Control+Z")
    check(grid() == start, "undo split, undo merge")

    # Shift+click selects from the cell being typed in; Delete empties the cells (they stay selected).
    page.keyboard.press("Escape")
    page.mouse.click(*slide_to_screen(page, 200, 270))   # Delta Snacks
    page.keyboard.down("Shift")
    page.mouse.click(*slide_to_screen(page, 480, 306))   # 530
    page.keyboard.up("Shift")
    check(page.is_visible(".cell-block") and key() is None, "Shift+click selects cells")
    page.keyboard.press("Delete")
    check(grid()[3].startswith("_|_|") and grid()[4].startswith("_|_|") and page.evaluate("App.deck.getDocument().querySelector('[data-id=\"e9\"]') !== null"),
          f"Delete empties the cells, the table stays: {grid()[3:5]}")
    check(page.is_visible(".cell-block"), "still selected")
    page.keyboard.press("Control+Z")
    check(grid() == start, "undo")
    page.keyboard.press("Escape")
    check(page.is_hidden(".cell-block") and page.evaluate("App.selection.selectedId()") == "e9", "Esc lets go of the cells, the table stays selected")

    # The edge moves the table; Delete table; the tab goes with the selection.
    drag(page, slide_to_screen(page, 66, 250), slide_to_screen(page, 116, 250))
    check(abs(element_rect(page, "e9")["left"] - 114) <= 1, f"dragged by its edge: {element_rect(page, 'e9')}")
    page.mouse.click(*slide_to_screen(page, 200, 196))
    page.click(layout_tab)
    run("deleteTable")
    check(page.evaluate("!App.deck.getDocument().querySelector('[data-id=\"e9\"]')"), "Delete table")
    check(page.is_hidden(layout_tab) and page.is_visible(".ribbon-tab.selected[data-tab='home']"), "the Layout tab goes, Home opens")
    page.keyboard.press("Control+Z")
    check(grid() == start, "undo brings the table back")
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
    check("2 charts had data but no drawing; the editor drew them from their data" in report, "2 charts drawn")
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
    check(page.locator("#overlay .selection-handle:visible:not([data-handle='rotate'])").count() == 8, "8 resize handles")
    check(page.is_visible("#overlay .selection-handle[data-handle='rotate']"), "and the rotate handle (Phase 7)")
    check(page.is_visible("#overlay .selection-box"), "selection box visible")
    box = page.evaluate("App.transform.readRect(document.querySelector('#overlay .selection-box'))")
    check(box == element_rect(page, "e2"), f"box matches the element: {box}")
    check(page.evaluate("App.history.canUndo()") is False, "a plain click records no undo step")

    # Drag moves; the whole drag is one undo step.
    start = slide_to_screen(page, 300, 290)
    page.keyboard.down("Alt")   # placed freely: no snapping (Phase 7) to the bar's right edge 1 px away
    drag(page, start, (start[0] + 100, start[1] + 50))
    page.keyboard.up("Alt")
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

    # Working in the slide rail clears the element selection: Delete there deletes the slide (Phase 7), not the element.
    page.click(".thumb[data-index='0']")
    check(page.evaluate(selected) is None, "clicking a thumbnail deselects the element")
    slides = editor.slide_count()
    page.keyboard.press("Delete")
    check(editor.slide_count() == slides - 1 and page.evaluate("App.history.undoLabel()") == "Delete slide",
          "Delete in the rail deletes the slide")
    page.keyboard.press("Control+z")
    check(page.evaluate("!!App.deck.getDocument().querySelector('[data-id=\"e1\"]')"), "undo: the slide and e1 back")

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
    check(saved == {"keepDrafts": True, "retentionDays": 30, "rememberRecent": True, "numberLocale": None,
                     "showGridlines": False, "showRulers": False}, f"saved settings: {saved}")

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
    test_autofit,
    test_find_and_replace,
    test_phase3_done_when,
    test_insert_and_resize_table,
    test_table_cell_editing,
    test_table_layout,
    test_table_column_borders,
    test_table_design,
    test_table_numbers,
    test_paste_from_excel,
    test_phase4_done_when,
    test_insert_picture,
    test_paste_and_drop_pictures,
    test_picture_format,
    test_crop_picture,
    test_insert_shapes,
    test_shape_format,
    test_shape_text,
    test_line_and_adjust_handles,
    test_phase5_done_when,
    test_chart_rendering,
    test_chart_lines_combo_donut,
    test_chart_waterfall,
    test_chart_types_priority_2,
    test_chart_readability,
    test_insert_chart_and_design,
    test_chart_data_grid,
    test_chart_grid_undo_in_cell,
    test_chart_paste_from_excel,
    test_chart_label_numbers,
    test_phase6_done_when,
    test_speaker_notes,
    test_add_duplicate_delete_slides,
    test_reorder_and_hide_slides,
    test_multi_select,
    test_align_and_distribute,
    test_smart_guides_gridlines_and_rulers,
    test_group_and_ungroup,
    test_rotate,
    test_lock,
    test_slide_master,
    test_slide_master_own_footers,
    test_theme_editor,
    test_phase7_done_when,
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
