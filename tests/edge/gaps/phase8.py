"""
Phase 8 hand checks replayed literally in Edge: real clicks and keys, one assertion per step.
Each test follows its FEATURES.md hand check from start to end (quoted in the docstring).
"""

import base64
import re
import time

import e2e_test as e2e
from e2e_test import Editor, check, common_colour, drag, element_rect, play_saved_deck, slide_to_screen, wait_until

SHOW_SLIDE_BOX = """() => { const frame = document.querySelector('#slideshow iframe');
    const f = frame.getBoundingClientRect();
    const r = frame.contentDocument.querySelector('section.slide.deck-player-current').getBoundingClientRect();
    return { x: f.left + r.left, y: f.top + r.top, width: r.width, height: r.height }; }"""


def _shot(page, box):
    return base64.b64encode(page.screenshot(clip=box)).decode()


def _frame_box(popup, frame_id):
    b = popup.locator(f"#{frame_id}").bounding_box()
    return {"x": b["x"], "y": b["y"], "width": b["width"], "height": b["height"]}


# Two pictures both scaled down to 160 x 90 (so a small and a big picture of one slide match): the mean brightness
# difference and the share of pixels more than 48 apart.
COMPARE_SMALL = """async ({a, b}) => {
    const load = (data) => new Promise((resolve) => { const i = new Image(); i.onload = () => resolve(i); i.src = 'data:image/png;base64,' + data; });
    const pixels = (image) => { const c = document.createElement('canvas'); c.width = 160; c.height = 90;
        const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(image, 0, 0, 160, 90);
        return x.getImageData(0, 0, 160, 90).data; };
    const p = pixels(await load(a)), q = pixels(await load(b));
    let sum = 0, far = 0;
    for (let k = 0; k < p.length; k += 4) {
        // Brightness only: small text drawn with ClearType has coloured edges that a big picture does not.
        const d = Math.abs((p[k] * 0.299 + p[k + 1] * 0.587 + p[k + 2] * 0.114) - (q[k] * 0.299 + q[k + 1] * 0.587 + q[k + 2] * 0.114));
        sum += d; if (d > 48) { far++; } }
    return { mean: sum / (p.length / 4), far: far / (p.length / 4) }; }"""


def _same(page, a, b):
    return page.evaluate(COMPARE_SMALL, {"a": a, "b": b})


def _alike(compared):
    """Two big pictures of one slide (different slides of this deck differ in more than 3% of pixels)."""
    return compared["far"] < 0.012


def _closer(page, picture, right, wrong):
    """A (small) picture looks more like `right` than like `wrong`: [far to right, far to wrong]."""
    a, b = _same(page, picture, right)["far"], _same(page, picture, wrong)["far"]
    return a < 0.7 * b, [round(a, 4), round(b, 4)]


NOTES_S1 = "Abrir com o contexto da transação. Todos os números deste deck são fictícios."   # samples/contract-deck.html


def _button(popup, name):
    return popup.get_by_role("button", name=name, exact=True)


def test_gap_p8_presenter_view(browser):
    """Presenter view: on slide 1 press Alt+F5: the slide fills the screen and a second window opens ("Presenter
    View"): Slide 1 of 6, slide 1 big, slide 2 under Next, the slide's notes, the timer counting, the clock. In that
    window press →: both windows on slide 2; →, →: slide 4, Next shows slide 6 (5 is hidden); Next ▶: slide 6, Next
    says "End of slide show"; ◀ Previous: slide 4. Black screen: the show goes black; B: back. Pause: the timer stops;
    Pause again, Reset: 0:00:00. Esc: the show ends and the window closes"""
    editor = Editor(browser)
    editor.open(e2e.CONTRACT)
    page = editor.page
    shown = lambda: page.evaluate(e2e.SHOWN_IN_SHOW)  # noqa: E731
    check(page.evaluate("App.deck.getCurrentIndex()") == 0, "on slide 1")
    check(page.evaluate("document.fullscreenElement") is None, "not full screen before Alt+F5")

    # Alt+F5: the slide fills the screen and a second window opens.
    with editor.context.expect_page() as popup_info:
        page.keyboard.press("Alt+F5")
    popup = popup_info.value
    wait_until(page, e2e.SHOWN_IN_SHOW)
    wait_until(page, "document.fullscreenElement && document.fullscreenElement.id === 'slideshow'")
    wait_until(popup, """() => { const ready = (id) => { const d = document.getElementById(id).contentDocument;
        return !!(d && d.querySelector('section.slide.deck-player-current')); };
        return document.getElementById('presenter-count') && ready('presenter-current') && ready('presenter-next'); }""")
    time.sleep(0.5)
    check(page.evaluate("document.fullscreenElement && document.fullscreenElement.id") == "slideshow",
          "the browser put the show full screen")
    screen = page.evaluate("({ w: innerWidth, h: innerHeight })")
    layer = page.evaluate("(() => { const r = document.getElementById('slideshow').getBoundingClientRect(); "
                          "return [r.left, r.top, r.width, r.height]; })()")
    check(layer == [0, 0, screen["w"], screen["h"]], f"the show covers the whole window: {layer} {screen}")
    scale = min(screen["w"] / 1280, screen["h"] / 720)
    box = page.evaluate(SHOW_SLIDE_BOX)
    check(abs(box["width"] - 1280 * scale) < 1.5 and abs(box["x"] - (screen["w"] - 1280 * scale) / 2) < 1.5
          and abs(box["y"] - (screen["h"] - 720 * scale) / 2) < 1.5, f"the slide fills the screen (fitted, centred): {box}")
    middle = common_colour(page, {"left": screen["w"] // 2 - 200, "top": int(box["y"]) + 500,
                                  "right": screen["w"] // 2 + 200, "bottom": int(box["y"]) + 600})
    check(middle == [255, 255, 255], f"the white slide on screen: {middle}")
    top_band = common_colour(page, {"left": 0, "top": 0, "right": screen["w"], "bottom": int(box["y"]) - 2})
    check(top_band == [0, 0, 0], f"black above the slide, where the editor's ribbon was: {top_band}")
    check(shown() == "s1", f"the show is on slide 1: {shown()}")
    show_s1 = _shot(page, box)
    page.screenshot(path=str(e2e.OUTPUT / "gap-p8-presenter-show.png"))

    check(popup.title().startswith("Presenter View"), f"the second window: {popup.title()}")
    check(popup.inner_text("#presenter-count") == "Slide 1 of 6", popup.inner_text("#presenter-count"))
    for part in ("#presenter-count", "#presenter-elapsed", "#presenter-clock"):
        check(popup.is_visible(part), f"{part} shows")
    current, upcoming = _frame_box(popup, "presenter-current"), _frame_box(popup, "presenter-next")
    width = popup.evaluate("innerWidth")
    check(current["width"] > upcoming["width"] * 1.3 and current["width"] > width * 0.5,
          f"slide 1 big (the next one smaller): {current} vs {upcoming} in {width}")
    check(e2e.presenter_frame_slide(popup, "presenter-current") == "s1", "the big one is slide 1")
    compared = _same(page, _shot(popup, current), show_s1)
    check(_alike(compared), f"the big picture looks like slide 1 on the show screen: {compared}")
    next_label = popup.locator("h2", has_text=re.compile("^Next$")).bounding_box()
    check(next_label and next_label["y"] < upcoming["y"] and abs(next_label["x"] - upcoming["x"]) < 20,
          f"the small one is under Next: {next_label} {upcoming}")
    check(e2e.presenter_frame_slide(popup, "presenter-next") == "s2", "slide 2 under Next")
    next_s2 = _shot(popup, upcoming)
    notes_s1 = NOTES_S1
    check(popup.inner_text("#presenter-notes") == notes_s1 and popup.is_visible("#presenter-notes"),
          f"the slide's notes: {popup.inner_text('#presenter-notes')!r}")
    first = popup.inner_text("#presenter-elapsed")
    time.sleep(1.6)
    later = popup.inner_text("#presenter-elapsed")
    check(re.fullmatch(r"0:00:0\d", first) and re.fullmatch(r"0:00:0[1-5]", later) and later > first,
          f"the timer counting: {first} -> {later}")
    clock = popup.inner_text("#presenter-clock")
    now = [time.strftime("%H:%M"), time.strftime("%H:%M", time.localtime(time.time() - 60))]
    check(clock in now, f"the clock: {clock} vs {now}")
    popup.screenshot(path=str(e2e.OUTPUT / "gap-p8-presenter-window.png"))

    def both_on(slide_id, number, what):
        wait_until(page, f"({e2e.SHOWN_IN_SHOW})() === '{slide_id}'")
        check(e2e.presenter_frame_slide(popup, "presenter-current") == slide_id
              and popup.inner_text("#presenter-count") == f"Slide {number} of 6",
              f"{what}: the presenter window on slide {number}: {popup.inner_text('#presenter-count')}")
        time.sleep(0.3)
        on_show = _shot(page, page.evaluate(SHOW_SLIDE_BOX))
        compared = _same(page, _shot(popup, _frame_box(popup, "presenter-current")), on_show)
        check(_alike(compared), f"{what}: both windows show the same slide: {compared}")
        return on_show

    # In that window press →: both windows on slide 2 (the slide that was under Next).
    popup.keyboard.press("ArrowRight")
    show_s2 = both_on("s2", 2, "→")
    check(not _alike(_same(page, show_s1, show_s2)), "slides 1 and 2 look different (the comparison can tell them apart)")
    ok, far = _closer(page, next_s2, show_s2, show_s1)
    check(ok, f"the small picture that was under Next is slide 2 (not slide 1): {far}")

    # →, →: slide 4, Next shows slide 6 (5 is hidden).
    popup.keyboard.press("ArrowRight")
    popup.keyboard.press("ArrowRight")
    show_s4 = both_on("s4", 4, "→, →")
    check(e2e.presenter_frame_slide(popup, "presenter-next") == "s6", "Next shows slide 6 (5 is hidden)")
    next_s6 = _shot(popup, _frame_box(popup, "presenter-next"))

    # Next ▶: slide 6, Next says "End of slide show".
    _button(popup, "Next ▶").click()
    show_s6 = both_on("s6", 6, "Next ▶")
    ok, far = _closer(page, next_s6, show_s6, show_s4)
    check(ok, f"the small picture that was under Next is slide 6 (not slide 4): {far}")
    check(popup.is_visible("#presenter-next-cover") and popup.inner_text("#presenter-next-cover") == "End of slide show",
          "Next says End of slide show")

    # ◀ Previous: slide 4.
    _button(popup, "◀ Previous").click()
    both_on("s4", 4, "◀ Previous")

    # Black screen: the show goes black; B: back.
    view = page.viewport_size
    centre = {"left": view["width"] // 2 - 200, "top": view["height"] // 2 - 100,
              "right": view["width"] // 2 + 200, "bottom": view["height"] // 2 + 100}
    before_black = common_colour(page, centre)
    _button(popup, "Black screen (B)").click()
    time.sleep(0.3)
    check(common_colour(page, centre) == [0, 0, 0] and before_black != [0, 0, 0],
          f"Black screen: the show goes black: {before_black} -> {common_colour(page, centre)}")
    popup.keyboard.press("b")
    time.sleep(0.3)
    check(common_colour(page, centre) == before_black and shown() == "s4", "B: the slide back")

    # Pause: the timer stops; Pause again, Reset: 0:00:00.
    _button(popup, "Pause").click()
    frozen = popup.inner_text("#presenter-elapsed")
    time.sleep(1.4)
    check(popup.inner_text("#presenter-elapsed") == frozen, f"Pause: the timer stops at {frozen}")
    check(_button(popup, "Resume").count() == 1, "the Pause button now reads Resume")
    _button(popup, "Resume").click()   # "Pause again": the same button
    time.sleep(1.2)
    check(popup.inner_text("#presenter-elapsed") != frozen, "Pause again: it runs on")
    _button(popup, "Reset").click()
    check(popup.inner_text("#presenter-elapsed") == "0:00:00", f"Reset: {popup.inner_text('#presenter-elapsed')}")

    # Esc: the show ends and the window closes.
    try:
        popup.keyboard.press("Escape")
    except Exception as error:  # noqa: BLE001 - the window may close between the key going down and up
        check("closed" in str(error), f"only the window closing interrupts the key press: {error}")
    wait_until(page, "!document.getElementById('slideshow') && !document.fullscreenElement")
    check(popup.is_closed(), "Esc: the window closes")
    check(page.is_visible("#deck-frame"), "back in the editor")
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()



def test_gap_p8_clean_copy(browser):
    """Clean copy: open samples/contract-deck.html, move a box (unsaved), File > Save a Clean Copy…: "Remove hidden
    slides (1)" is ticked; Save…: the window suggests "contract-deck (clean copy).html". Open that file in Edge: 5
    slides, the hidden one gone. Back in the editor: the title still says contract-deck.html with the unsaved dot"""
    editor = Editor(browser)
    editor.open(e2e.CONTRACT)
    page = editor.page
    check(page.inner_text("#title-file") == "contract-deck.html" and page.is_hidden("#title-dirty"), "opened, saved")

    # Move a box (unsaved): drag the subtitle 60 px down.
    before = element_rect(page, "e4")
    drag(page, slide_to_screen(page, 600, 410), slide_to_screen(page, 600, 470))
    after = element_rect(page, "e4")
    check(after["top"] == before["top"] + 60 and after["left"] == before["left"], f"the box moved: {before} -> {after}")
    check(page.is_visible("#title-dirty"), "unsaved: the dot shows")
    tab_title = page.title()
    check(tab_title.startswith("●") and "contract-deck.html" in tab_title, f"the tab says unsaved: {tab_title!r}")

    # File > Save a Clean Copy…: "Remove hidden slides (1)" is ticked.
    page.click(".ribbon-file-button")
    item = page.locator(".file-menu button[data-command='saveCleanCopy']")
    check(item.is_visible() and "Save a Clean Copy…" in item.inner_text(), f"the menu item: {item.inner_text()!r}")
    item.click()
    wait_until(page, "!!document.querySelector('dialog[open] .clean-copy-dialog')")
    label = page.locator("dialog[open] label:has(#clean-copy-remove-hidden)")
    check(label.inner_text().strip() == "Remove hidden slides (1)" and page.is_checked("#clean-copy-remove-hidden")
          and page.is_visible("#clean-copy-remove-hidden"), f"ticked: {label.inner_text()!r}")
    page.screenshot(path=str(e2e.OUTPUT / "gap-p8-clean-copy.png"))

    # Save…: the suggested name (the test takes the download; Windows' Save window is not reachable from a test).
    page.evaluate("window.showSaveFilePicker = undefined")
    with page.expect_download() as download_info:
        page.get_by_role("button", name="Save…", exact=True).click()
    download = download_info.value
    check(download.suggested_filename == "contract-deck (clean copy).html", f"suggested: {download.suggested_filename}")
    copy = e2e.OUTPUT / "gap-p8-clean-copy.html"
    download.save_as(copy)
    wait_until(page, "!document.querySelector('dialog[open]')")

    # Open that file in Edge: 5 slides, the hidden one gone.
    player, errors = play_saved_deck(browser, copy)
    slides = player.evaluate("""() => Array.from(document.querySelectorAll('section.slide'),
        (s) => [s.getAttribute('data-slide-id'), s.hasAttribute('data-hidden'), s.innerText.trim().split('\\n')[0]])""")
    check(len(slides) == 5 and [s[0] for s in slides] == ["s1", "s2", "s3", "s4", "s6"] and not any(s[1] for s in slides),
          f"5 slides, the hidden one gone: {slides}")
    check(player.inner_text(".deck-player-counter") == "1 / 5", f"the copy counts 5: {player.inner_text('.deck-player-counter')}")
    hidden_title = page.evaluate("App.slides.titleOf(App.deck.getSlides()[4]).textContent.trim()")
    check(hidden_title and hidden_title not in player.inner_text("body"), f"the hidden slide's title is not in it: {hidden_title}")
    for _ in range(5):
        player.keyboard.press("ArrowRight")
    check(player.inner_text(".deck-player-counter") == "5 / 5", "presenting it goes through 5 slides")
    check(errors == [], f"the copy opens without errors: {errors}")
    player.context.close()

    # Back in the editor: the title still says contract-deck.html with the unsaved dot; the box still moved.
    check(page.inner_text("#title-file") == "contract-deck.html", f"the title: {page.inner_text('#title-file')}")
    check(page.is_visible("#title-dirty") and page.inner_text("#title-dirty") == "●", "the unsaved dot")
    check(page.title() == tab_title and "contract-deck.html" in tab_title, f"the browser tab's title too: {page.title()!r}")
    check(element_rect(page, "e4") == after, "the editor keeps the moved box")
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


TESTS = [test_gap_p8_presenter_view, test_gap_p8_clean_copy]
