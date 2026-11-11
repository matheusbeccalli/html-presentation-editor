/*
 * presenter.js - the presenter view (Phase 8, SPEC 7.1): a second window with the
 * current slide, the next slide, the speaker notes, a timer and the clock.
 *
 * Alt+F5 (Slide Show > Presenter View) starts the show full screen in the editor's
 * window and opens this one; move it to your own screen. The window is an empty
 * page of the editor's own (same file, so the editor may draw in it directly):
 * this file writes its contents and keeps them up to date from the show's state,
 * so both windows always show the same slide. Keys and buttons in it go back to
 * the show (present.js), as if pressed there.
 *
 * Its slides are frames holding the same clean copy of the deck as the show (no
 * scripts run in them), scaled to their boxes.
 *
 * Talks to: present.js (the show's state, `input`, the timer and clock texts),
 * deck.js and notes.js (the speaker notes of the slide shown).
 */

(function () {
    'use strict';

    App.presenter = {};

    const WINDOW_NAME = 'deck-presenter';
    const SLIDE_WIDTH = 1280;
    const SLIDE_HEIGHT = 720;

    App.presenter.BLOCKED_HELP =
        'The browser blocked the presenter window. To allow it: click the blocked pop-up icon at the right end ' +
        'of the address bar, choose "Always allow pop-ups and redirects", then press Alt+F5 again. ' +
        '(F5 presents without the presenter window.)';

    const STYLE = `
        html, body { margin: 0; height: 100%; background: #1f1f1f; color: #f3f3f3; font: 14px "Segoe UI", Arial, sans-serif; }
        body { display: grid; grid-template-rows: auto 1fr auto; }
        header, footer { display: flex; align-items: center; gap: 16px; padding: 8px 16px; background: #2b2b2b; }
        header .spacer, footer .spacer { flex: 1; }
        #presenter-elapsed { font-size: 22px; font-variant-numeric: tabular-nums; }
        #presenter-clock { font-size: 22px; font-variant-numeric: tabular-nums; }
        main { display: grid; grid-template-columns: 3fr 2fr; gap: 16px; padding: 16px; min-height: 0; }
        .column { display: flex; flex-direction: column; gap: 8px; min-height: 0; }
        h2 { margin: 0; font-size: 13px; font-weight: 600; color: #bdbdbd; text-transform: uppercase; letter-spacing: 0.05em; }
        .slide-box { position: relative; aspect-ratio: 16 / 9; width: 100%; background: #000; flex: none; }
        .slide-box iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
        .slide-box .cover { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
                            background: #000; color: #bdbdbd; }
        .slide-box .cover[hidden] { display: none; }
        #presenter-notes { flex: 1; min-height: 0; overflow: auto; white-space: pre-wrap; font-size: 18px; line-height: 1.45;
                           background: #2b2b2b; padding: 12px 14px; border-radius: 4px; }
        #presenter-notes.empty { color: #9a9a9a; font-style: italic; }
        button { font: inherit; color: inherit; background: #3a3a3a; border: 1px solid #555; border-radius: 4px; padding: 6px 12px;
                 cursor: pointer; }
        button:hover { background: #4a4a4a; }
        button[aria-pressed="true"] { background: #0f6cbd; border-color: #0f6cbd; }`;

    const BODY = `
        <header>
            <span id="presenter-count"></span><span class="spacer"></span>
            <span id="presenter-elapsed">0:00:00</span>
            <button type="button" id="presenter-pause" aria-pressed="false">Pause</button>
            <button type="button" id="presenter-reset">Reset</button>
            <span class="spacer"></span><span id="presenter-clock"></span>
        </header>
        <main>
            <div class="column">
                <h2>Current slide</h2>
                <div class="slide-box"><iframe id="presenter-current" title="Current slide" sandbox="allow-same-origin"></iframe>
                    <div class="cover" id="presenter-current-cover" hidden></div></div>
            </div>
            <div class="column">
                <h2>Next</h2>
                <div class="slide-box"><iframe id="presenter-next" title="Next slide" sandbox="allow-same-origin"></iframe>
                    <div class="cover" id="presenter-next-cover" hidden>End of slide show</div></div>
                <h2>Notes</h2>
                <div id="presenter-notes"></div>
            </div>
        </main>
        <footer>
            <button type="button" id="presenter-previous">◀ Previous</button>
            <button type="button" id="presenter-forward">Next ▶</button>
            <span class="spacer"></span>
            <button type="button" id="presenter-black" aria-pressed="false">Black screen (B)</button>
            <button type="button" id="presenter-end">End show (Esc)</button>
        </footer>`;

    let win = null;            // the presenter window while it is open
    let slideCount = 0;
    let timer = null;          // setInterval id for the timer and clock
    let startedAt = 0;         // Date.now() when the timer last started running
    let elapsedBefore = 0;     // ms counted before the last pause
    let paused = false;
    let lastState = null;

    function isOpen() {
        return !!win && !win.closed;
    }

    App.presenter.isOpen = isOpen;

    function byId(id) {
        return win.document.getElementById(id);
    }

    function elapsed() {
        return elapsedBefore + (paused ? 0 : Date.now() - startedAt);
    }

    function tick() {
        if (!isOpen()) {
            return;
        }
        byId('presenter-elapsed').textContent = App.present.elapsedText(elapsed());
        byId('presenter-clock').textContent = App.present.clockText(new Date());
    }

    function fitFrame(frame) {
        const doc = frame.contentDocument;
        if (!doc || !doc.documentElement || !frame.clientWidth) {
            return;
        }
        const scale = Math.min(frame.clientWidth / SLIDE_WIDTH, frame.clientHeight / SLIDE_HEIGHT);
        doc.documentElement.style.setProperty('--deck-player-scale', String(scale));
    }

    function showSlide(frame, index) {
        const doc = frame.contentDocument;
        if (!doc) {
            return;
        }
        doc.querySelectorAll('section.slide').forEach((slide, i) => {
            slide.classList.toggle('deck-player-current', i === index);
        });
        fitFrame(frame);
    }

    function fitAll() {
        if (isOpen()) {
            fitFrame(byId('presenter-current'));
            fitFrame(byId('presenter-next'));
        }
    }

    // Keys pressed in the presenter window drive the show, as in the show's own window.
    function onKey(event) {
        if (event.ctrlKey || event.metaKey || event.altKey) {
            return;
        }
        App.present.input({ key: event.key }, event);
    }

    function wireButtons() {
        const press = (key) => () => App.present.input({ key: key }, null);
        byId('presenter-previous').addEventListener('click', press('ArrowLeft'));
        byId('presenter-forward').addEventListener('click', press('ArrowRight'));
        byId('presenter-black').addEventListener('click', press('b'));
        byId('presenter-end').addEventListener('click', press('Escape'));
        byId('presenter-pause').addEventListener('click', () => {
            if (paused) {
                startedAt = Date.now();
            } else {
                elapsedBefore = elapsed();
            }
            paused = !paused;
            byId('presenter-pause').setAttribute('aria-pressed', String(paused));
            byId('presenter-pause').textContent = paused ? 'Resume' : 'Pause';
            tick();
        });
        byId('presenter-reset').addEventListener('click', () => {
            elapsedBefore = 0;
            startedAt = Date.now();
            tick();
        });
    }

    /*
     * Open (or reuse) the presenter window with `html` (the show's clean copy of the
     * deck). false = the browser blocked the window.
     */
    App.presenter.open = function open(html, count) {
        const opened = window.open('', WINDOW_NAME, 'popup,width=1100,height=720');
        if (!opened) {
            return false;
        }
        win = opened;
        slideCount = count;
        const doc = win.document;
        doc.head.innerHTML = '<meta charset="utf-8"><style>' + STYLE + '</style>';
        doc.title = 'Presenter View - ' + (App.state.fileName || 'deck');   // after the head: it makes the <title>
        doc.body.innerHTML = BODY;
        wireButtons();
        ['presenter-current', 'presenter-next'].forEach((id) => {
            const frame = byId(id);
            frame.addEventListener('load', () => {
                if (!frame.contentDocument.querySelector('section.slide')) {
                    return;   // the first, empty load
                }
                frame.contentWindow.addEventListener('keydown', onKey, true);
                if (id === 'presenter-current') {
                    // A click on the current slide moves on, as on the show itself.
                    frame.contentDocument.addEventListener('click', () => App.present.input({ click: true }, null));
                }
                if (lastState) {
                    App.presenter.draw(lastState);
                }
            });
            frame.srcdoc = html;
        });
        win.addEventListener('keydown', onKey, true);
        win.addEventListener('resize', fitAll);
        paused = false;
        elapsedBefore = 0;
        startedAt = Date.now();
        clearInterval(timer);
        timer = setInterval(tick, 1000);
        tick();
        win.focus();
        return true;
    };

    /* Show the show's state: the slide, the next one, the notes, black / end. */
    App.presenter.draw = function draw(state) {
        lastState = state;
        if (!isOpen()) {
            return;
        }
        const next = App.present.nextShown(state);
        byId('presenter-count').textContent = state.end ? 'End of slide show' :
            'Slide ' + (state.index + 1) + ' of ' + slideCount;
        showSlide(byId('presenter-current'), state.index);
        const cover = byId('presenter-current-cover');
        cover.hidden = !(state.black || state.end);
        cover.textContent = state.end ? 'End of slide show' : 'Black screen';
        byId('presenter-black').setAttribute('aria-pressed', String(!!state.black));
        showSlide(byId('presenter-next'), next);
        byId('presenter-next-cover').hidden = next >= 0;
        const slide = App.deck.getSlides()[state.index];
        const notes = slide ? App.notes.textOf(slide) : '';
        const box = byId('presenter-notes');
        box.textContent = state.end ? '' : (notes || 'No notes for this slide.');
        box.classList.toggle('empty', !notes || state.end);
    };

    /* The show ended: close the presenter window. */
    App.presenter.close = function close() {
        clearInterval(timer);
        timer = null;
        lastState = null;
        if (isOpen()) {
            win.close();
        }
        win = null;
    };
})();
