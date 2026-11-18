/*
 * present.js - the slideshow (Phase 8, SPEC 7.1).
 *
 * F5 presents from the first slide, Shift+F5 from the current one. The show is a
 * black layer over the whole editor, made full screen, holding a frame with a
 * clean copy of the deck (what Save would write: the slide master's copies in
 * place, no editor marks) and the saved deck's own player styles, so a slide
 * looks exactly as it does in the saved file: one slide, scaled to fit, black bars
 * around it. The frame runs no scripts; this file moves from slide to slide.
 *
 * Keys (as in PowerPoint): → ↓ Space Enter N Page Down or a click = next,
 * ← ↑ Backspace P Page Up = previous, Home / End, a number then Enter = that slide,
 * B or . = black screen, Esc = end. Hidden slides are skipped (unless asked for by
 * number). After the last slide comes a black "End of slide show" screen.
 *
 * The rules are the pure `startIndex` and `reduce` (tested in present.test.js);
 * the rest only draws the state they return.
 *
 * Alt+F5 also opens the presenter view in a second window (presenter.js), driven by
 * the same state: what this file draws, it draws there too.
 *
 * Talks to: deck.js (the slides, the slide to show afterwards), serialize.js (the
 * clean copy), presenter.js, commands.js (slideShowFromStart / slideShowFromCurrent /
 * presenterView), dialogs.js.
 */

(function () {
    'use strict';

    App.present = {};

    const SLIDE_WIDTH = 1280;
    const SLIDE_HEIGHT = 720;
    const NEXT_KEYS = ['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n', 'N'];
    const PREVIOUS_KEYS = ['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p', 'P'];
    const BLACK_KEYS = ['b', 'B', '.'];
    const MAX_TYPED_DIGITS = 4;

    /* ---------- The rules (pure) ---------- */

    function firstShown(hidden, from, step) {
        for (let i = from; i >= 0 && i < hidden.length; i += step) {
            if (!hidden[i]) {
                return i;
            }
        }
        return -1;
    }

    /*
     * Where a show starts. hidden = one true/false per slide. From the start: the
     * first slide not hidden; from the current one: it, or (if hidden) the next
     * shown slide, else the one before. -1 = every slide is hidden.
     */
    App.present.startIndex = function startIndex(hidden, current, fromCurrent) {
        if (!fromCurrent) {
            return firstShown(hidden, 0, 1);
        }
        const after = firstShown(hidden, current, 1);
        return after >= 0 ? after : firstShown(hidden, current, -1);
    };

    /*
     * One key press or click during the show.
     * state = { index, hidden, typed, black, end }; input = { key } or { click: true }.
     * Returns the new state, with `handled` (the key meant something: the browser's own
     * action is stopped) and `exit` (the show ends).
     */
    App.present.reduce = function reduce(state, input) {
        const next = Object.assign({}, state, { handled: true, exit: false });
        // A slide link clicked (Phase 10): that slide, if it is there and not hidden.
        if (input.slide !== undefined) {
            if (input.slide >= 0 && input.slide < state.hidden.length && !state.hidden[input.slide]) {
                Object.assign(next, { index: input.slide, end: false, black: false, typed: '' });
            }
            return next;
        }
        const key = input.click ? 'click' : input.key;

        if (key === 'Escape') {
            next.exit = true;
            return next;
        }
        // A number, then Enter: jump to that slide.
        if (/^[0-9]$/.test(key)) {
            next.typed = (state.typed + key).slice(-MAX_TYPED_DIGITS);
            return next;
        }
        if (key === 'Backspace' && state.typed) {
            next.typed = state.typed.slice(0, -1);
            return next;
        }
        if (key === 'Enter' && state.typed) {
            const number = parseInt(state.typed, 10);
            next.typed = '';
            if (number >= 1 && number <= state.hidden.length) {
                Object.assign(next, { index: number - 1, end: false, black: false });
            }
            return next;
        }
        next.typed = '';

        if (BLACK_KEYS.includes(key)) {
            next.black = !state.black;
            return next;
        }
        const forward = key === 'click' || NEXT_KEYS.includes(key);
        const back = PREVIOUS_KEYS.includes(key);
        const jump = key === 'Home' || key === 'End';
        if (!forward && !back && !jump) {
            next.handled = false;
            return next;
        }
        // On a black screen a move key only brings the slide back.
        if (state.black) {
            next.black = false;
            return next;
        }
        if (key === 'Home' || key === 'End') {
            const last = state.hidden.length - 1;
            const found = key === 'Home' ? firstShown(state.hidden, 0, 1) : firstShown(state.hidden, last, -1);
            Object.assign(next, { index: found >= 0 ? found : state.index, end: false });
        } else if (forward) {
            if (state.end) {
                next.exit = true;
            } else {
                const found = firstShown(state.hidden, state.index + 1, 1);
                if (found >= 0) {
                    next.index = found;
                } else {
                    next.end = true;
                }
            }
        } else if (state.end) {
            next.end = false;   // back from the end screen: the last slide again
        } else {
            const found = firstShown(state.hidden, state.index - 1, -1);
            next.index = found >= 0 ? found : state.index;
        }
        return next;
    };

    /* The presenter view's "Next" slide: the next shown one, or -1 when the end of the show comes next. */
    App.present.nextShown = function nextShown(state) {
        return state.end ? -1 : firstShown(state.hidden, state.index + 1, 1);
    };

    function twoDigits(number) {
        return String(number).padStart(2, '0');
    }

    /* The presenter view's timer: 65 000 ms → '0:01:05'. */
    App.present.elapsedText = function elapsedText(milliseconds) {
        const seconds = Math.floor(milliseconds / 1000);
        return Math.floor(seconds / 3600) + ':' + twoDigits(Math.floor(seconds / 60) % 60) + ':' + twoDigits(seconds % 60);
    };

    /* The presenter view's clock: '09:05'. */
    App.present.clockText = function clockText(date) {
        return twoDigits(date.getHours()) + ':' + twoDigits(date.getMinutes());
    };

    /* ---------- The show on screen ---------- */

    let show = null;   // while presenting: { layer, frame, curtain, state, ... }
    // The last show's way out of full screen, still finishing: a new show waits for it, or that late
    // exit would take the new show out of full screen too (and so end it).
    let leavingFullscreen = Promise.resolve();

    App.present.isActive = function isActive() {
        return !!show;
    };

    /* The show's current state (for the presenter view and the tests), or null. */
    App.present.state = function state() {
        return show ? Object.assign({}, show.state) : null;
    };

    /* The text of the deck to present: the clean copy with the player's styles. */
    function showHtml(deckDoc) {
        const root = App.serialize.cleanCopy(deckDoc);
        const style = deckDoc.createElement('style');
        style.textContent = document.getElementById('deck-player-css').textContent;
        root.querySelector('head').appendChild(style);
        root.classList.add('deck-player-on');
        return '<!DOCTYPE html>\n' + root.outerHTML;
    }

    function fit() {
        const doc = show.frame.contentDocument;
        if (!doc || !doc.documentElement) {
            return;
        }
        const scale = Math.min(show.layer.clientWidth / SLIDE_WIDTH, show.layer.clientHeight / SLIDE_HEIGHT);
        doc.documentElement.style.setProperty('--deck-player-scale', String(scale));
    }

    function draw() {
        const doc = show.frame.contentDocument;
        if (!doc) {
            return;
        }
        doc.querySelectorAll('section.slide').forEach((slide, i) => {
            slide.classList.toggle('deck-player-current', i === show.state.index);
        });
        show.curtain.hidden = !(show.state.black || show.state.end);
        show.endNote.hidden = !show.state.end;
        App.presenter.draw(show.state);
        App.events.emit('slideshow-changed', App.present.state());
    }

    function apply(input, event) {
        if (!show) {
            return;
        }
        const next = App.present.reduce(show.state, input);
        if (next.handled && event) {
            event.preventDefault();
        }
        if (next.exit) {
            App.present.stop();
            return;
        }
        delete next.handled;
        delete next.exit;
        show.state = next;
        draw();
    }

    /* A key or click from the presenter window (presenter.js). */
    App.present.input = function input(what, event) {
        apply(what, event);
    };

    /*
     * Keys while presenting. Listened to in the capture phase on the editor window
     * (and on the show frame), so the editor's own shortcuts never see them.
     */
    function onKey(event) {
        if (!show || event.ctrlKey || event.metaKey || event.altKey) {
            return;
        }
        event.stopPropagation();
        apply({ key: event.key }, event);
    }

    function onClick(event) {
        if (event.button !== 0) {
            return;
        }
        // A link (Phase 10): a slide link jumps there; a web page or e-mail opens outside the show.
        const link = event.target && event.target.closest && event.target.closest('a[href]');
        if (link) {
            event.preventDefault();
            const href = link.getAttribute('href');
            const kind = App.text.linkKind(href);
            if (kind === 'slide') {
                const index = App.deck.getSlides().findIndex((slide) => slide.getAttribute('data-slide-id') === App.text.slideIdOf(href));
                apply({ slide: index }, event);
            } else if (kind) {
                window.open(href, '_blank', 'noopener');
            }
            return;
        }
        apply({ click: true }, event);
    }

    // The browser itself ends full screen on Esc (the page never sees that key): end the show too.
    function onFullscreenChange() {
        if (!show) {
            return;
        }
        if (document.fullscreenElement === show.layer) {
            show.wasFullscreen = true;
        } else if (show.wasFullscreen) {
            App.present.stop();
        }
    }

    function onFrameLoad() {
        const frameWindow = show && show.frame.contentWindow;
        if (!frameWindow || !frameWindow.document.querySelector('section.slide')) {
            return;
        }
        frameWindow.addEventListener('keydown', onKey, true);
        frameWindow.document.addEventListener('click', onClick);
        fit();
        draw();
        frameWindow.focus();
    }

    function buildLayer() {
        const layer = App.util.el('div', { id: 'slideshow', class: 'slideshow', tabindex: '-1', 'aria-label': 'Slide show' });
        const frame = App.util.el('iframe', { class: 'slideshow-frame', title: 'Slide show', sandbox: 'allow-same-origin' });
        const curtain = App.util.el('div', { class: 'slideshow-curtain' });
        const endNote = App.util.el('p', { class: 'slideshow-end' }, ['End of slide show. Click or press any arrow key to exit.']);
        curtain.hidden = true;
        endNote.hidden = true;
        curtain.appendChild(endNote);
        layer.append(frame, curtain);
        return { layer: layer, frame: frame, curtain: curtain, endNote: endNote };
    }

    /*
     * Start presenting. fromCurrent: Shift+F5 (from the slide shown in the editor).
     * options.presenter: also open the presenter view (Alt+F5) in a second window.
     * Must run inside the key press or click that asked for it: the browser only
     * allows full screen and new windows during a user action.
     */
    App.present.start = function start(fromCurrent, options) {
        const deckDoc = App.deck.getDocument();
        if (show || !deckDoc) {
            return;
        }
        const hidden = App.deck.getSlides().map((slide) => App.slides.isHidden(slide));
        const index = App.present.startIndex(hidden, App.deck.getCurrentIndex(), !!fromCurrent);
        if (index < 0) {
            App.dialogs.alert('Slide show', 'Every slide is hidden, so there is nothing to show. ' +
                'Unhide a slide with Slide Show > Hide Slide.');
            return;
        }
        show = buildLayer();
        show.state = { index: index, hidden: hidden, typed: '', black: false, end: false };
        show.wasFullscreen = false;

        // The deck's text goes in before the frame is in the page, so its first load is the deck
        // (a frame added empty first loads about:blank).
        const html = showHtml(deckDoc);
        show.frame.srcdoc = html;
        show.frame.addEventListener('load', onFrameLoad);
        document.body.appendChild(show.layer);
        show.layer.addEventListener('click', onClick);
        window.addEventListener('keydown', onKey, true);
        window.addEventListener('resize', fit);
        document.addEventListener('fullscreenchange', onFullscreenChange);

        if (document.activeElement && document.activeElement.blur) {
            document.activeElement.blur();   // Space must not press the ribbon button again
        }
        show.layer.focus();
        const layer = show.layer;
        // Refused (e.g. not from a key press or click): the show still fills the window. The browser
        // still counts the key press as the user's for a few seconds, so waiting here is fine.
        const presenter = !!(options && options.presenter);
        leavingFullscreen.then(() => {
            if (!show || show.layer !== layer) {
                return;
            }
            // Full screen first: opening a window uses up the key press, so asking after it would be refused.
            if (layer.requestFullscreen) {
                layer.requestFullscreen().catch(() => {});
            }
            if (presenter && !App.presenter.open(html, App.deck.getSlides().length)) {
                App.present.stop();
                App.dialogs.alert('Presenter View', App.presenter.BLOCKED_HELP);
                return;
            }
            App.presenter.draw(show.state);
        });
    };

    /* End the show; the editor shows the slide the show ended on. */
    App.present.stop = function stop() {
        if (!show) {
            return;
        }
        const ended = show;
        show = null;
        window.removeEventListener('keydown', onKey, true);
        window.removeEventListener('resize', fit);
        document.removeEventListener('fullscreenchange', onFullscreenChange);
        if (document.fullscreenElement === ended.layer) {
            leavingFullscreen = document.exitFullscreen().catch(() => {});
        }
        // The keyboard focus may be in the show's frame (after a click): bring it to the editor's page
        // before the frame goes, or the editor's shortcuts would not hear the next key.
        ended.layer.focus();
        ended.layer.remove();
        window.focus();
        App.presenter.close();
        App.deck.goTo(ended.state.index);
        App.events.emit('slideshow-changed', null);
    };
})();
