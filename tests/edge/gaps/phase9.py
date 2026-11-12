"""
Phase 9 hand checks replayed literally in Edge: real clicks and keys, one assertion per step.
Each test follows its FEATURES.md hand check from start to end (quoted in the docstring).
"""

import datetime
import re

import e2e_test as e2e
from e2e_test import Editor, check, play_saved_deck, slide_to_screen, wait_until
from gaps.phase6 import _ink

MARKER_YELLOW = (242, 199, 68)        # .comment-marker background #F2C744
SUBTITLE = {"left": 64, "top": 378, "width": 1100, "height": 70}   # contract deck, slide 1, e4
TABLE_POINT = (640, 160)               # slide 3's comps table (e9)
EMPTY_POINT = (1200, 680)              # an empty part of slide 1


def _box(page, selector):
    box = page.locator(selector).first.bounding_box()
    return {"left": box["x"], "top": box["y"], "right": box["x"] + box["width"], "bottom": box["y"] + box["height"]}


def _yellow_share(page, area, tolerance=24):
    found, total = _ink(page, area, MARKER_YELLOW, tolerance)
    return found / max(1, total)


def _slide_origin(page):
    return slide_to_screen(page, 0, 0)


def _tab(page, name):
    page.click(f"[role='tab']:has-text('{name}')")


def _type_comment(page, text, initials=None):
    """With the draft open: (initials, Tab,) the text, Ctrl+Enter."""
    wait_until(page, "!!document.getElementById('comment-draft-text')")
    if initials:
        page.keyboard.type(initials)
        page.keyboard.press("Tab")
    page.keyboard.type(text)
    page.keyboard.press("Control+Enter")
    wait_until(page, "!document.getElementById('comment-draft-text')")


def _today_shown(text):
    """The card's date: today's day, month and year (in the PC's order)."""
    today = datetime.date.today()
    day, month, year = f"{today.day:02d}", f"{today.month:02d}", str(today.year)
    date = text.split(" ")[0]
    return date in (f"{day}/{month}/{year}", f"{month}/{day}/{year}", f"{year}-{month}-{day}", f"{day}.{month}.{year}")


SHOW_TEXT = """() => { const frame = document.querySelector('#slideshow iframe'); const doc = frame && frame.contentDocument;
    return doc ? { html: doc.documentElement.outerHTML, asides: doc.querySelectorAll('aside.comments').length } : null; }"""

ON_TOP = """([x, y]) => { const e = document.elementFromPoint(x, y); return !!(e && e.closest('#slideshow')); }"""


def _marker_boxes(page):
    """The screen boxes of the markers shown now (to look at those places later)."""
    return [{"left": b["x"], "top": b["y"], "right": b["x"] + b["width"], "bottom": b["y"] + b["height"]}
            for b in (m.bounding_box() for m in page.locator("#overlay .comment-marker").all())]


def _show_has_no_comments(page, words, boxes, what):
    """In the slide show: no comment in the shown document; where the editor's markers were, the show is on top and
    not a yellow pixel; hardly any marker yellow on the whole screen."""
    wait_until(page, e2e.SHOWN_IN_SHOW)
    page.wait_for_timeout(400)
    shown = page.evaluate(SHOW_TEXT)
    check(shown["asides"] == 0 and not any(w in shown["html"] for w in words),
          f"{what}: no comment in the show: asides {shown['asides']}, words {[w for w in words if w in shown['html']]}")
    check(boxes, f"{what}: there were markers to look for")
    for box in boxes:
        centre = [(box["left"] + box["right"]) / 2, (box["top"] + box["bottom"]) / 2]
        check(page.evaluate(ON_TOP, centre), f"{what}: the show is on top where a marker was: {centre}")
        found, _ = _ink(page, box, MARKER_YELLOW, 24)
        check(found <= 3, f"{what}: no marker yellow where a marker was: {found} pixels at {box}")
    view = page.viewport_size
    found, _ = _ink(page, {"left": 0, "top": 0, "right": view["width"], "bottom": view["height"]}, MARKER_YELLOW, 18)
    check(found < 40, f"{what}: no marker yellow on the screen: {found} pixels")


# ----------------------------------------------------------------------
# Comments
# ----------------------------------------------------------------------

def test_gap_p9_comments(browser):
    """Comments: open samples/contract-deck.html, click the subtitle, press Ctrl+Alt+M: the Comments pane opens and asks
    for your initials; type them, Tab, type a comment, Ctrl+Enter: a card with your initials, today's date and "Text:
    Aquisição…", a yellow marker at the subtitle's top right corner, and a 1 beside slide 1's thumbnail. Click an empty
    part of the slide, Review > New Comment: no initials asked, it is on "Slide" (marker at the top left). Click a
    card's text, change it, Ctrl+Enter; Ctrl+Z puts the old text back. Delete the subtitle: its marker moves to the
    slide's corner; Ctrl+Z puts it back. Review > Next / Previous go through the comments. Save, close, open the file
    again: the comments are there; F5: no marker or comment in the show"""
    editor = Editor(browser)
    editor.open(e2e.CONTRACT)
    page = editor.page
    check(page.is_hidden("#comments-pane"), "the pane starts closed")

    # Click the subtitle, Ctrl+Alt+M: the pane opens and asks for the initials.
    page.mouse.click(*slide_to_screen(page, 600, 410))
    check(page.evaluate("App.selection.selectedId()") == "e4", "the subtitle is selected")
    page.keyboard.press("Control+Alt+m")
    wait_until(page, "!document.getElementById('comments-pane').hidden && !!document.getElementById('comment-draft-text')")
    check(page.is_visible("#comments-pane") and page.is_visible("#comment-initials")
          and page.evaluate("document.activeElement.id") == "comment-initials", "the pane opens and asks for the initials")
    _type_comment(page, "Checar a fonte", initials="MB")
    cards = page.evaluate(e2e.COMMENT_CARDS)
    check(len(cards) == 1 and cards[0]["initials"] == "MB" and cards[0]["text"] == "Checar a fonte"
          and cards[0]["on"].startswith("Text: Aquisição") and _today_shown(cards[0]["date"]),
          f"a card with the initials, today's date and 'Text: Aquisição…': {cards}")
    check(page.is_visible("#comments-list .comment-card"), "the card shows")

    # A yellow marker at the subtitle's top right corner.
    marker = _box(page, "#overlay .comment-marker[data-target='e4']")
    corner = slide_to_screen(page, SUBTITLE["left"] + SUBTITLE["width"], SUBTITLE["top"])
    check(0 <= marker["left"] - corner[0] <= 12 and abs((marker["top"] + marker["bottom"]) / 2 - corner[1]) <= 4,
          f"the marker is at the subtitle's top right corner: {marker} vs corner {corner}")
    inner = {"left": marker["left"] + 4, "top": marker["top"] + 4, "right": marker["right"] - 4, "bottom": marker["bottom"] - 4}
    check(_yellow_share(page, inner) > 0.8, f"the marker is yellow on screen: {_yellow_share(page, inner)}")

    # A 1 beside slide 1's thumbnail.
    badge = page.locator(".thumb[data-index='0'] .thumb-comments-badge")
    check(badge.count() == 1 and badge.inner_text() == "1" and badge.is_visible(), "a 1 on slide 1's thumbnail")
    check(page.locator(".thumb-comments-badge").count() == 1, "no other thumbnail has one")
    thumb = _box(page, ".thumb[data-index='0']")
    b = _box(page, ".thumb[data-index='0'] .thumb-comments-badge")
    check(thumb["left"] <= b["left"] and b["right"] <= thumb["right"] and thumb["top"] <= b["top"] <= thumb["bottom"],
          f"the badge is beside slide 1's thumbnail: {b} in {thumb}")
    check(_yellow_share(page, {"left": b["left"] + 2, "top": b["top"] + 2, "right": b["right"] - 2, "bottom": b["bottom"] - 2}) > 0.4,
          "the badge is yellow on screen")
    page.screenshot(path=str(e2e.OUTPUT / "gap-p9-comment-1.png"))

    # Click an empty part of the slide, Review > New Comment: no initials, on "Slide", marker at the top left.
    page.mouse.click(*slide_to_screen(page, *EMPTY_POINT))
    check(page.evaluate("App.selection.selectedId()") is None, "nothing selected")
    _tab(page, "Review")
    page.click("button[data-command='newComment']")
    wait_until(page, "!!document.getElementById('comment-draft-text')")
    check(page.query_selector("#comment-initials") is None, "no initials asked")
    check(page.inner_text(".comment-draft .comment-on") == "New comment on Slide", page.inner_text(".comment-draft .comment-on"))
    _type_comment(page, "Abertura ok?")
    cards = page.evaluate(e2e.COMMENT_CARDS)
    check(len(cards) == 2 and cards[1]["on"] == "Slide" and cards[1]["text"] == "Abertura ok?", f"on the slide: {cards}")
    origin = _slide_origin(page)
    slide_marker = _box(page, "#overlay .comment-marker:not([data-target])")
    check(0 <= slide_marker["left"] - origin[0] <= 14 and 0 <= slide_marker["top"] - origin[1] <= 14,
          f"the slide's marker at its top left: {slide_marker} vs {origin}")
    check(_yellow_share(page, {"left": slide_marker["left"] + 4, "top": slide_marker["top"] + 4,
                               "right": slide_marker["right"] - 4, "bottom": slide_marker["bottom"] - 4}) > 0.8,
          "the slide's marker is yellow on screen")
    check(page.locator(".thumb[data-index='0'] .thumb-comments-badge").inner_text() == "2", "the thumbnail says 2 now")

    # Click a card's text, change it, Ctrl+Enter; Ctrl+Z puts the old text back.
    page.click("#comments-list .comment-card >> nth=0 >> .comment-text")
    wait_until(page, "document.activeElement && document.activeElement.classList.contains('comment-edit')")
    page.keyboard.press("Control+a")
    page.keyboard.type("Fonte: relatório anual")
    page.keyboard.press("Control+Enter")
    wait_until(page, "!document.querySelector('.comment-edit')")
    check(page.evaluate(e2e.COMMENT_CARDS)[0]["text"] == "Fonte: relatório anual", "the card's text changed")
    page.keyboard.press("Control+z")
    wait_until(page, "document.querySelector('#comments-list .comment-text').textContent === 'Checar a fonte'")
    check(page.evaluate(e2e.DECK_COMMENTS)[0][0]["text"] == "Checar a fonte", "Ctrl+Z: the old text back, in the deck too")

    # Delete the subtitle: its marker moves to the slide's corner; Ctrl+Z puts it back.
    page.mouse.click(*slide_to_screen(page, 600, 410))
    check(page.evaluate("App.selection.selectedId()") == "e4", "the subtitle is selected again")
    page.keyboard.press("Delete")
    markers = page.evaluate(e2e.MARKERS)
    check([(m["target"], m["count"]) for m in markers] == [(None, "2")], f"one marker on the slide for both: {markers}")
    moved = _box(page, "#overlay .comment-marker")
    check(0 <= moved["left"] - origin[0] <= 14 and 0 <= moved["top"] - origin[1] <= 14, f"at the slide's corner: {moved}")
    check(_yellow_share(page, {"left": moved["left"] + 4, "top": moved["top"] + 4, "right": moved["right"] - 4,
                               "bottom": moved["bottom"] - 4}) > 0.6, "the moved marker shows there (yellow, with its 2)")
    check(_yellow_share(page, {"left": corner[0] + 2, "top": corner[1] - 8, "right": corner[0] + 28, "bottom": corner[1] + 8}) < 0.02,
          "nothing yellow left at the subtitle's corner")
    page.keyboard.press("Control+z")
    markers = page.evaluate(e2e.MARKERS)
    check([m["target"] for m in markers] == ["e4", None], f"Ctrl+Z: back on the subtitle: {markers}")
    back = _box(page, "#overlay .comment-marker[data-target='e4']")
    check(abs(back["left"] - marker["left"]) < 1.5 and abs(back["top"] - marker["top"]) < 1.5, f"at its corner again: {back}")
    check(page.evaluate("!!App.deck.getDocument().querySelector('[data-id=\"e4\"]')"), "the subtitle is back")

    # Review > Next / Previous go through the comments.
    ids = [c["id"] for c in page.evaluate(e2e.COMMENT_CARDS)]
    _tab(page, "Review")
    seen = []
    for _ in range(len(ids) + 1):
        page.click("button[data-command='nextComment']")
        active = page.evaluate("App.commentsPane.activeId()")
        card = page.locator(f".comment-card[data-comment-id='{active}']")
        check(card.count() == 1 and "active" in (card.get_attribute("class") or ""), f"Next: its card is the active one: {active}")
        seen.append(active)
    check(sorted(set(seen)) == sorted(ids) and seen[0] != seen[1] and seen[-1] == seen[0],
          f"Next goes through every comment and round again: {seen} of {ids}")
    back = []
    for _ in range(len(ids) + 1):
        page.click("button[data-command='previousComment']")
        active = page.evaluate("App.commentsPane.activeId()")
        card = page.locator(f".comment-card[data-comment-id='{active}']")
        check(card.count() == 1 and "active" in (card.get_attribute("class") or ""), f"Previous: its card is the active one: {active}")
        back.append(active)
    check(sorted(set(back)) == sorted(ids) and back[0] != back[1] and back[-1] == back[0],
          f"Previous goes through every comment and round again: {back} of {ids}")
    page.screenshot(path=str(e2e.OUTPUT / "gap-p9-comment-2.png"))

    # Save, close, open the file again: the comments are there.
    saved = editor.save_as_download("gap-p9-comments.html")
    editor.close()
    editor = Editor(browser)
    editor.open(saved)
    page = editor.page
    check(page.query_selector("dialog[open]") is None, f"it opens with no window: {editor.report_dialog_text()}")
    stored = page.evaluate(e2e.DECK_COMMENTS)
    check([[c["text"] for c in s] for s in stored][0] == ["Checar a fonte", "Abertura ok?"] and sum(len(s) for s in stored) == 2,
          f"opened again: the comments are there: {stored}")
    markers = page.evaluate(e2e.MARKERS)
    check([m["target"] for m in markers] == ["e4", None] and not any(m["hidden"] for m in markers), f"their markers: {markers}")
    check(page.locator(".thumb[data-index='0'] .thumb-comments-badge").inner_text() == "2", "the thumbnail's 2")
    page.locator("#overlay .comment-marker[data-target='e4']").click()   # a marker opens its card in the pane
    wait_until(page, "!document.getElementById('comments-pane').hidden")
    texts = page.locator("#comments-list .comment-card .comment-text").all_inner_texts()
    check(texts == ["Checar a fonte", "Abertura ok?"], f"the cards show them: {texts}")
    reopened = _box(page, "#overlay .comment-marker[data-target='e4']")
    check(_yellow_share(page, {"left": reopened["left"] + 4, "top": reopened["top"] + 4, "right": reopened["right"] - 4,
                               "bottom": reopened["bottom"] - 4}) > 0.8, "the marker shows on screen")

    # F5: no marker or comment in the show.
    boxes = _marker_boxes(page)
    check(len(boxes) == 2, f"two markers on screen before F5: {boxes}")
    page.keyboard.press("F5")
    _show_has_no_comments(page, ["Checar a fonte", "Abertura ok?"], boxes, "F5 on the reopened deck")
    page.screenshot(path=str(e2e.OUTPUT / "gap-p9-comment-show.png"))
    page.keyboard.press("Escape")
    wait_until(page, "!document.getElementById('slideshow')")
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


# ----------------------------------------------------------------------
# Delete all
# ----------------------------------------------------------------------

WORDS = ["Revisar o subtítulo", "Abertura confirmada", "Conferir os múltiplos"]


def test_gap_p9_delete_all(browser):
    """Delete all: in a deck with comments on two slides the status bar says "N comments"; click it: the Comments pane
    opens. File > Save a Clean Copy…: the window says the N review comments are left out; open the copy in Edge and
    press Ctrl+U (page source), then Ctrl+F: no `class="comments"` and none of your comments' words in it. Back in the
    editor, Review > Delete All Comments: a question with the number; Delete All: every marker, card, thumbnail number
    and the status bar count go; one Ctrl+Z brings them all back. F5 and Ctrl+P: no comments anywhere"""
    editor = Editor(browser)
    editor.open(e2e.CONTRACT)
    page = editor.page

    # A deck with comments on two slides, typed: the subtitle and slide 1 itself, then slide 3's table.
    page.mouse.click(*slide_to_screen(page, 600, 410))
    page.keyboard.press("Control+Alt+m")
    _type_comment(page, WORDS[0], initials="MB")
    page.mouse.click(*slide_to_screen(page, *EMPTY_POINT))
    page.keyboard.press("Control+Alt+m")
    _type_comment(page, WORDS[1])
    page.click(".thumb[data-index='2']")
    wait_until(page, "App.deck.getCurrentIndex() === 2")
    page.mouse.click(*slide_to_screen(page, *TABLE_POINT))
    check(page.evaluate("App.selection.selectedId()") == "e9", "the comps table is selected")
    page.keyboard.press("Control+Alt+m")
    _type_comment(page, WORDS[2])
    check([len(s) for s in page.evaluate(e2e.DECK_COMMENTS)] == [2, 0, 1, 0, 0, 0], "comments on two slides")

    # The status bar says "3 comments"; click it: the pane opens.
    page.click("#comments-close")
    check(page.is_hidden("#comments-pane"), "the pane closed (to see the count open it)")
    check(page.is_visible("#status-comments") and page.inner_text("#status-comments") == "3 comments",
          f"the status bar: {page.inner_text('#status-comments')}")
    page.click("#status-comments")
    check(page.is_visible("#comments-pane"), "a click on the count opens the Comments pane")
    check(page.locator("#comments-list .comment-card").count() == 1, "slide 3's comment card shows")

    # File > Save a Clean Copy…: the window says the 3 review comments are left out; Save…
    page.click(".ribbon-file-button")
    page.click(".file-menu button[data-command='saveCleanCopy']")
    wait_until(page, "!!document.querySelector('dialog[open] .clean-copy-dialog')")
    note = page.inner_text("dialog[open] .clean-copy-note")
    check("3 review comments" in note and "left out" in note, f"the window says so: {note}")
    page.evaluate("window.showSaveFilePicker = undefined")   # the Save window falls back to a download
    with page.expect_download() as download_info:
        page.click("dialog[open] button:has-text('Save')")
    clean = e2e.OUTPUT / "gap-p9-clean-copy.html"
    download_info.value.save_as(clean)

    # Open the copy in Edge; its page source (the file's text): no class="comments", none of the words.
    player, errors = play_saved_deck(browser, clean)
    check(errors == [] and not any(w in player.inner_text("body") for w in WORDS), "the copy opens in Edge, no comment shown")
    # Ctrl+U: Edge's page source of the copy (view-source:); Ctrl+F there: nothing found.
    player.goto("view-source:" + clean.as_uri())
    source = player.inner_text("body")
    check("<!DOCTYPE html>" in source and 'class="slide"' in source, f"the page source shows: {source[:120]!r}")
    check('class="comments"' not in source and not any(w in source for w in WORDS),
          f"page source: no class=\"comments\", no words: {[w for w in WORDS if w in source]}")
    player.context.close()

    # Back in the editor: Review > Delete All Comments: a question with the number.
    _tab(page, "Review")
    page.click("button[data-command='deleteAllComments']")
    wait_until(page, "!!document.querySelector('dialog[open]')")
    question = editor.report_dialog_text()
    check("Delete all 3 comments" in question, f"a question with the number: {question}")
    marker = _box(page, "#overlay .comment-marker")
    page.click("dialog[open] button:has-text('Delete All')")
    wait_until(page, "!document.querySelector('dialog[open]')")

    def gone():
        return {"markers": len(page.evaluate(e2e.MARKERS)), "cards": page.locator("#comments-list .comment-card").count(),
                "badges": page.locator(".thumb-comments-badge").count(), "count": page.is_visible("#status-comments"),
                "deck": page.evaluate("App.comments.countIn(App.deck.getDocument())")}
    check(gone() == {"markers": 0, "cards": 0, "badges": 0, "count": False, "deck": 0}, f"every comment gone: {gone()}")
    check(_yellow_share(page, marker) < 0.02, "the marker is gone from the screen")
    # Slide 1 too: no marker, no card, not a marker-yellow pixel on the slide.
    page.click(".thumb[data-index='0']")
    wait_until(page, "App.deck.getCurrentIndex() === 0")
    check(gone() == {"markers": 0, "cards": 0, "badges": 0, "count": False, "deck": 0}, f"slide 1: every comment gone: {gone()}")
    top_left, bottom_right = slide_to_screen(page, 0, 0), slide_to_screen(page, 1280, 720)
    found, _ = _ink(page, {"left": top_left[0], "top": top_left[1], "right": bottom_right[0], "bottom": bottom_right[1]},
                    MARKER_YELLOW, 24)
    check(found <= 3, f"slide 1: no marker yellow on the slide: {found}")
    page.screenshot(path=str(e2e.OUTPUT / "gap-p9-deleted-all.png"))

    # One Ctrl+Z brings them all back.
    page.keyboard.press("Control+z")
    wait_until(page, "App.comments.countIn(App.deck.getDocument()) === 3")
    badges = page.evaluate("""() => Array.from(document.querySelectorAll('#thumbnail-rail .thumb')).map((t) => {
        const b = t.querySelector('.thumb-comments-badge'); return b ? b.textContent : ''; })""")
    check(badges == ["2", "", "1", "", "", ""] and page.is_visible("#status-comments")
          and page.inner_text("#status-comments") == "3 comments", f"one Ctrl+Z: badges and the count back: {badges}")
    # Each of the two slides: its markers and cards back, the markers painted.
    first = page.evaluate("App.deck.getCurrentIndex()")
    marker_places = {}
    for index in ([first] + [i for i in (0, 2) if i != first]):
        if index != page.evaluate("App.deck.getCurrentIndex()"):
            page.click(f".thumb[data-index='{index}']")
            wait_until(page, f"App.deck.getCurrentIndex() === {index}")
        want = 2 if index == 0 else 1
        back = gone()
        check(back["markers"] == want and back["cards"] == want, f"slide {index + 1}: {want} markers and cards back: {back}")
        marker_places[index] = _marker_boxes(page)
        for n in range(want):
            again = _box(page, f"#overlay .comment-marker >> nth={n}")
            check(_yellow_share(page, {"left": again["left"] + 4, "top": again["top"] + 4, "right": again["right"] - 4,
                                       "bottom": again["bottom"] - 4}) > 0.8, f"slide {index + 1}: marker {n} back on screen")

    # F5 (on every slide) and Ctrl+P: no comments anywhere.
    page.click(".thumb[data-index='0']")
    wait_until(page, "App.deck.getCurrentIndex() === 0")
    page.keyboard.press("F5")
    for index, slide_id in enumerate(["s1", "s2", "s3", "s4", "s6"]):
        wait_until(page, f"({e2e.SHOWN_IN_SHOW})() === '{slide_id}'")
        _show_has_no_comments(page, WORDS, marker_places[0] + marker_places[2], f"F5, slide {slide_id}")
        page.keyboard.press("ArrowRight")
    page.keyboard.press("Escape")
    wait_until(page, "!document.getElementById('slideshow')")

    page.keyboard.press("Control+p")
    wait_until(page, "!!document.querySelector('dialog[open] .pdf-dialog')")
    page.click("dialog[open] button:has-text('Print')")
    wait_until(page, """() => { const f = document.querySelector('iframe.pdf-print-frame');
        return f && f.contentDocument && f.contentDocument.querySelectorAll('section.slide').length > 0; }""")
    printed = page.evaluate("""() => { const d = document.querySelector('iframe.pdf-print-frame').contentDocument;
        return { html: d.documentElement.outerHTML, text: d.body.innerText, slides: d.querySelectorAll('section.slide').length }; }""")
    check(printed["slides"] == 5 and 'class="comments"' not in printed["html"] and not any(w in printed["html"] for w in WORDS),
          f"Ctrl+P: the printed document has no comments: {printed['slides']} slides, "
          f"{[w for w in WORDS if w in printed['html']]}")
    check(page.evaluate("App.comments.countIn(App.deck.getDocument())") == 3, "the deck keeps its comments")
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


# ----------------------------------------------------------------------
# Shortcuts
# ----------------------------------------------------------------------

SECTION_ORDER = ["File", "Edit", "Move and arrange", "Text", "Tables", "Slides", "Slide show", "Review", "View", "Mouse", "Help"]


def test_gap_p9_shortcuts(browser):
    """Shortcuts: with a deck open press ?: the Keyboard shortcuts window, the filter box ready for typing; scroll: File,
    Edit, Move and arrange, Text, Tables, Slides, Slide show, Review, View, Mouse, Help. Type bold: only the Bold row
    (Ctrl+B) is left. Esc closes it. Help > Keyboard Shortcuts opens it again; Esc. Double-click a text box, type ?: a ?
    appears in the text, no window"""
    editor = Editor(browser)
    editor.open(e2e.CONTRACT)
    page = editor.page

    page.keyboard.press("?")
    wait_until(page, "!!document.querySelector('dialog[open] .shortcut-sheet')")
    check("Keyboard shortcuts" in page.inner_text("dialog[open]"), "the Keyboard shortcuts window")
    check(page.evaluate("document.activeElement.id") == "shortcut-filter" and page.is_visible("#shortcut-filter"),
          "the filter box has the cursor")

    # Scroll: the sections, in this order; the last one comes into view by scrolling.
    titles = page.evaluate("Array.from(document.querySelectorAll('dialog[open] .shortcut-section h3')).map((h) => h.textContent)")
    check(titles == SECTION_ORDER, f"the sections: {titles}")
    help_title = page.locator("dialog[open] .shortcut-section h3", has_text=re.compile("^Help$"))

    def in_view(locator):
        return page.evaluate("""(el) => { let box = el.getBoundingClientRect(); let p = el.parentElement;
            while (p) { const s = getComputedStyle(p); if (/(auto|scroll)/.test(s.overflowY)) { const r = p.getBoundingClientRect();
                if (box.bottom <= r.top || box.top >= r.bottom) { return false; } } p = p.parentElement; }
            return box.top >= 0 && box.bottom <= innerHeight; }""", locator.element_handle())
    check(not in_view(help_title), "Help is below, out of view, before scrolling")
    headings = page.locator("dialog[open] .shortcut-section h3").all()
    seen = []

    def look():
        for heading in headings:
            name = heading.inner_text().strip()
            if name.lower() not in [x.lower() for x in seen] and heading.is_visible() and in_view(heading):
                seen.append(heading.evaluate("(h) => h.textContent"))
    look()
    list_box = _box(page, "dialog[open] .shortcut-list")
    page.mouse.move((list_box["left"] + list_box["right"]) / 2, (list_box["top"] + list_box["bottom"]) / 2)
    for _ in range(60):
        page.mouse.wheel(0, 150)
        page.wait_for_timeout(40)
        look()
        if in_view(help_title):
            break
    check(in_view(help_title), "scrolling brings Help into view")
    check(seen == SECTION_ORDER, f"scrolling shows every section, in this order: {seen}")

    # Type bold: only the Bold row (Ctrl+B) is left.
    page.keyboard.type("bold")
    rows = page.evaluate("""() => Array.from(document.querySelectorAll('dialog[open] .shortcut-table tr'))
        .filter((tr) => tr.checkVisibility()).map((tr) => tr.innerText.replace(/\\s+/g, ' ').trim())""")
    check(len(rows) == 1 and "Bold" in rows[0] and "Ctrl+B" in rows[0], f"only the Bold row: {rows}")
    page.screenshot(path=str(e2e.OUTPUT / "gap-p9-shortcuts-bold.png"))

    # Esc closes it.
    page.keyboard.press("Escape")
    wait_until(page, "!document.querySelector('dialog[open]')")
    check(page.locator(".shortcut-sheet").count() == 0 or not page.is_visible(".shortcut-sheet"), "the window is closed")

    # Help > Keyboard Shortcuts opens it again.
    _tab(page, "Help")
    page.click("button[data-command='shortcuts']")
    wait_until(page, "!!document.querySelector('dialog[open] .shortcut-sheet')")
    check(page.is_visible("dialog[open] .shortcut-sheet")
          and page.evaluate("document.querySelectorAll('dialog[open] .shortcut-section').length") == len(SECTION_ORDER),
          "Help > Keyboard Shortcuts: the window again, all sections")
    page.keyboard.press("Escape")
    wait_until(page, "!document.querySelector('dialog[open]')")

    # Double-click a text box, type ?: a ? in the text, no window.
    page.mouse.dblclick(*slide_to_screen(page, 600, 410))
    wait_until(page, "!!App.text.editingElement()")
    before = page.evaluate("App.text.editingElement().textContent")
    page.keyboard.type("?")
    page.wait_for_timeout(200)
    after = page.evaluate("App.text.editingElement().textContent")
    check(page.query_selector("dialog[open]") is None, "no window while typing")
    check(after.count("?") == before.count("?") + 1 and len(after) == len(before) + 1, f"a ? appears in the text: {after!r}")
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


# ----------------------------------------------------------------------
# About
# ----------------------------------------------------------------------

def test_gap_p9_about(browser):
    """About: Help > About / Licenses (or File > About / Licenses): PptxGenJS 4.0.1 · MIT, the line Includes: JSZip
    3.10.1 … readable-stream, a source and a SHA-256; click License text: the MIT license appears. Close; Esc also
    closes it"""
    editor = Editor(browser)
    page = editor.page

    def opened(how):
        wait_until(page, "!!document.querySelector('dialog[open] .about')")
        text = page.inner_text("dialog[open] .about")
        check("PptxGenJS 4.0.1 · MIT" in text, f"{how}: PptxGenJS 4.0.1 · MIT: {text[:300]}")
        bundled = page.inner_text("dialog[open] .about-bundled")
        check(re.match(r"^Includes: JSZip 3\.10\.1\b.*readable-stream", bundled, re.S) is not None,
              f"{how}: the line Includes: JSZip 3.10.1 … readable-stream: {bundled}")
        sources = page.locator("dialog[open] .about-source").all_inner_texts()
        check(any(re.match(r"^Source: \S+", s) for s in sources), f"{how}: a source: {sources}")
        check(any(re.match(r"^SHA-256: [0-9a-f]{64}$", s.strip()) for s in sources), f"{how}: a SHA-256: {sources}")
        return text

    # Help > About / Licenses.
    _tab(page, "Help")
    page.click("button[data-command='about']")
    opened("Help > About")
    check(not page.is_visible("dialog[open] .about-license pre"), "the license text starts folded")
    page.click("dialog[open] .about-license summary:has-text('License text')")
    license_text = page.inner_text("dialog[open] .about-license pre")
    check(page.is_visible("dialog[open] .about-license pre") and "MIT" in license_text
          and "Permission is hereby granted" in license_text, f"the MIT license appears: {license_text[:120]}")
    page.screenshot(path=str(e2e.OUTPUT / "gap-p9-about.png"))
    page.click("dialog[open] button:has-text('Close')")
    wait_until(page, "!document.querySelector('dialog[open]')")

    # File > About / Licenses; Esc also closes it.
    page.click(".ribbon-file-button")
    page.click(".file-menu button[data-command='about']")
    opened("File > About")
    page.keyboard.press("Escape")
    wait_until(page, "!document.querySelector('dialog[open]')")
    check(editor.errors == [], f"no errors: {editor.errors}")
    editor.close()


TESTS = [test_gap_p9_comments, test_gap_p9_delete_all, test_gap_p9_shortcuts, test_gap_p9_about]
