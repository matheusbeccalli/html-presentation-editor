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

import re
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

    def __init__(self, browser):
        self.context = browser.new_context(viewport={"width": 1440, "height": 900}, accept_downloads=True)
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
    return "Content Security Policy" in text or "Blocked script execution" in text


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
    editor.page.screenshot(path=str(OUTPUT / "02-new-deck.png"))
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


TESTS = [
    test_editor_starts_offline_with_csp,
    test_browser_banner_only_outside_chromium,
    test_new_blank_deck,
    test_contract_deck_round_trip_is_exact,
    test_saved_deck_presents_on_its_own,
    test_messy_copilot_deck,
    test_appendix_a_deck_gets_charts_and_fixes,
    test_1920_deck_is_scaled,
    test_shortcuts_dirty_dot_and_close_warning,
    test_drag_and_drop_opens_a_deck,
    test_heavy_deck_stays_responsive,
    test_select_move_resize,
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
