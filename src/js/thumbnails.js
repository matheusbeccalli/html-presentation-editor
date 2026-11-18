/*
 * thumbnails.js - the rail of slide miniatures on the left (SPEC 4, Phase 1).
 *
 * Each thumbnail is a small sandboxed iframe holding a copy of one slide plus
 * the deck's <head> (its CSS). It is drawn at full size (1280x720) and shrunk
 * with a CSS transform, so it looks exactly like the slide.
 *
 * Performance (SPEC 8.4): a 50-slide deck with 20 MB of images must stay
 * responsive, so
 *   - a thumbnail is only drawn once it scrolls into view (IntersectionObserver)
 *   - after a change, only the affected slide is redrawn, after a short pause
 *     (debounced), so typing does not redraw on every key press.
 *
 * Talks to: deck.js (reads slides, goTo on click), events from history.js,
 *           selection.js (working in the rail clears the element selection),
 *           commands.js and contextmenu.js (slide actions: keys and right-click, Phase 7).
 */

(function () {
    'use strict';

    App.thumbnails = {};

    const THUMB_WIDTH = 168;
    const SCALE = THUMB_WIDTH / 1280;

    let rail = null;
    let observer = null;
    const pendingRefresh = new Set();   // slide indexes waiting to be redrawn

    App.thumbnails.init = function init() {
        rail = document.getElementById('thumbnail-rail');
        rail.style.setProperty('--thumb-scale', String(SCALE));

        observer = new IntersectionObserver(onVisibilityChange, { root: rail, rootMargin: '200px 0px' });

        App.events.on('deck-loaded', rebuild);
        App.events.on('slide-changed', highlightCurrent);
        App.events.on('slide-picks-changed', highlightCurrent);
        App.events.on('history-changed', onHistoryChanged);

        // Working in the rail means working on slides, not on an element (as in PowerPoint):
        // without this, Delete or the arrow keys here would act on the element still selected.
        rail.addEventListener('pointerdown', () => App.selection.clear());
        rail.addEventListener('focusin', (event) => {
            App.selection.clear();
            // A thumbnail reached with Tab is the slide shown, so the rail's keys act on it.
            const item = event.target.closest('.thumb');
            if (item && Number(item.getAttribute('data-index')) !== App.deck.getCurrentIndex()) {
                App.deck.goTo(Number(item.getAttribute('data-index')));
            }
        });

        rail.addEventListener('keydown', onRailKey);
        rail.addEventListener('pointerdown', onRailPointerDown);
        // The click that ends a drag must not also pick the slide under the pointer.
        rail.addEventListener('click', (event) => {
            if (justDragged) {
                event.stopPropagation();
                event.preventDefault();
            }
        }, true);

        // Right-click a slide: it is shown, and the menu has the slide actions (on the empty rail: New Slide).
        rail.addEventListener('contextmenu', (event) => {
            if (!App.state.hasDeck) {
                return;
            }
            event.preventDefault();
            const item = event.target.closest('.thumb');
            if (item) {
                const index = Number(item.getAttribute('data-index'));
                const id = App.deck.getSlides()[index].getAttribute('data-slide-id');
                if (App.slides.pickedIds().indexOf(id) === -1) {
                    App.slides.pick(index, 'single');   // a slide outside the picked ones: just that one
                } else {
                    App.deck.goTo(index);
                }
                item.focus();
            }
            App.contextMenu.openWith(item ? SLIDE_ITEMS : ['newSlide'], event.clientX, event.clientY);
        });
    };

    const SLIDE_ITEMS = ['cutSlides', 'copySlides', 'pasteSlides', '-', 'newSlide', 'duplicateSlide', 'deleteSlide', '-', 'hideSlide', '-', 'slideBackground'];

    // Keys in the rail work on slides, as in PowerPoint's slide pane (the editor's own shortcuts do not run).
    const RAIL_KEYS = {
        ArrowDown: () => App.deck.next(),
        ArrowUp: () => App.deck.previous(),
        Enter: () => App.commands.run('newSlide'),
        Delete: () => App.commands.run('deleteSlide'),
        Backspace: () => App.commands.run('deleteSlide'),
        'Ctrl+D': () => App.commands.run('duplicateSlide'),
        'Ctrl+ArrowUp': () => App.commands.run('moveSlideUp'),
        'Ctrl+ArrowDown': () => App.commands.run('moveSlideDown'),
    };

    // ---- Dragging a thumbnail to move its slide ----

    const DRAG_START = 5;     // px the pointer moves before a press becomes a drag
    const SCROLL_EDGE = 30;   // px from the rail's top / bottom where a drag scrolls it
    let drag = null;          // { from, startY, active, gap, line }
    let justDragged = false;

    function onRailPointerDown(event) {
        const item = event.target.closest('.thumb');
        if (event.button !== 0 || !item || !App.state.hasDeck) {
            return;
        }
        drag = { from: Number(item.getAttribute('data-index')), startY: event.clientY, active: false, gap: null, line: null };
        window.addEventListener('pointermove', onDragMove, true);
        window.addEventListener('pointerup', onDragEnd, true);
        window.addEventListener('keydown', onDragKey, true);
    }

    function boxesOf() {
        return Array.from(rail.querySelectorAll('.thumb .thumb-box'), (box) => box.getBoundingClientRect());
    }

    function onDragMove(event) {
        if (!drag.active) {
            if (Math.abs(event.clientY - drag.startY) < DRAG_START) {
                return;
            }
            drag.active = true;
            drag.line = App.util.el('div', { class: 'thumb-drop-line' });
            rail.appendChild(drag.line);
            rail.classList.add('dragging');
        }
        const railRect = rail.getBoundingClientRect();
        if (event.clientY < railRect.top + SCROLL_EDGE) {
            rail.scrollTop -= 10;
        } else if (event.clientY > railRect.bottom - SCROLL_EDGE) {
            rail.scrollTop += 10;
        }
        const boxes = boxesOf();
        drag.gap = App.slides.gapAt(boxes.map((box) => box.top + box.height / 2), event.clientY);
        // The line sits in the gap: half the space above the thumbnail below it (or below the last one).
        const y = drag.gap < boxes.length ? boxes[drag.gap].top - 6 : boxes[boxes.length - 1].bottom + 4;
        drag.line.style.top = (y - railRect.top + rail.scrollTop) + 'px';
        drag.line.hidden = drag.gap === drag.from || drag.gap === drag.from + 1;   // there, it would not move
    }

    function endDrag() {
        window.removeEventListener('pointermove', onDragMove, true);
        window.removeEventListener('pointerup', onDragEnd, true);
        window.removeEventListener('keydown', onDragKey, true);
        if (drag && drag.line) {
            drag.line.remove();
        }
        rail.classList.remove('dragging');
        const ended = drag;
        drag = null;
        return ended;
    }

    function onDragEnd() {
        const ended = endDrag();
        if (ended && ended.active) {
            justDragged = true;
            setTimeout(() => { justDragged = false; }, 0);
            if (ended.gap !== null) {
                App.slides.move(ended.from, ended.gap);
            }
        }
    }

    /* Esc while dragging: nothing moves. */
    function onDragKey(event) {
        if (event.key === 'Escape' && drag && drag.active) {
            event.preventDefault();
            event.stopPropagation();
            endDrag();
        }
    }

    function onRailKey(event) {
        const action = RAIL_KEYS[App.shortcuts.comboFromEvent(event)];
        if (!action || !App.state.hasDeck) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        action();
    }

    /*
     * A stand-alone miniature of `slide` (from document `sourceDoc`, whose
     * <head> brings the CSS), `width` pixels wide. Used by the recovery and
     * compare dialogs (drafts.js). slide = null gives an empty box.
     */
    App.thumbnails.miniature = function miniature(sourceDoc, slide, width) {
        const frame = App.util.el('iframe', {
            class: 'thumb-frame', sandbox: 'allow-same-origin', tabindex: '-1', 'aria-hidden': 'true',
        });
        const box = App.util.el('div', { class: 'thumb-box miniature' + (slide ? '' : ' miniature-empty') });
        box.style.setProperty('--thumb-scale', String(width / 1280));
        box.style.width = width + 'px';
        box.style.height = (width * 720 / 1280) + 'px';
        if (!slide) {
            return box;
        }
        box.appendChild(frame);
        frame.addEventListener('load', () => {
            const target = frame.contentDocument;
            target.head.innerHTML = sourceDoc.head.innerHTML;
            if (!target.head.querySelector('style[data-editor-only]')) {
                const style = target.createElement('style');
                style.textContent = App.deck.VIEW_CSS;   // shows the one slide marked data-editor-current
                target.head.appendChild(style);
            }
            const copy = target.importNode(slide, true);
            copy.setAttribute('data-editor-current', '');
            target.body.replaceChildren(copy);
            box.setAttribute('data-drawn', 'true');
        }, { once: true });
        frame.srcdoc = '<!DOCTYPE html><html><head></head><body></body></html>';
        return box;
    };

    function rebuild() {
        // Adding, deleting or undoing draws the rail again; the keyboard stays in it (Delete, Delete ...).
        const hadFocus = rail.contains(document.activeElement);
        observer.disconnect();
        rail.innerHTML = '';
        App.deck.getSlides().forEach((slide, index) => {
            const item = createItem(slide, index);
            rail.appendChild(item);
            observer.observe(item);
        });
        highlightCurrent();
        if (hadFocus && rail.querySelector('.thumb-current')) {
            rail.querySelector('.thumb-current').focus();
        }
    }

    function createItem(slide, index) {
        const frame = App.util.el('iframe', {
            class: 'thumb-frame', sandbox: 'allow-same-origin', tabindex: '-1', 'aria-hidden': 'true',
        });
        const item = App.util.el('div', {
            class: 'thumb', role: 'button', tabindex: '0',
            'data-index': String(index),
            // Shift+click: a range of slides; Ctrl+click: one more (or one fewer) (Phase 10).
            onclick: (event) => App.slides.pick(index, event.shiftKey ? 'range' : (event.ctrlKey || event.metaKey) ? 'toggle' : 'single'),
        }, [
            App.util.el('span', { class: 'thumb-number' }, [String(index + 1)]),
            App.util.el('div', { class: 'thumb-box' }, [frame]),
        ]);
        markHidden(item, slide);
        markComments(item, slide);
        return item;
    }

    /* A hidden slide's thumbnail is dimmed and carries the crossed-out eye (also right after Hide Slide). */
    function markHidden(item, slide) {
        const hidden = App.slides.isHidden(slide);
        const index = Number(item.getAttribute('data-index'));
        item.classList.toggle('thumb-hidden', hidden);
        item.title = 'Slide ' + (index + 1) + (hidden ? ' (hidden)' : '');
        const badge = item.querySelector('.thumb-hidden-badge');
        if (hidden && !badge) {
            const mark = App.util.el('span', { class: 'thumb-hidden-badge', title: 'Hidden slide' });
            mark.innerHTML = App.icons.get('hidden');
            item.appendChild(mark);
        } else if (!hidden && badge) {
            badge.remove();
        }
    }

    /* A slide with review comments carries a small yellow bubble with their number (Phase 9). */
    function markComments(item, slide) {
        const count = App.comments.listOf(slide).length;
        let badge = item.querySelector('.thumb-comments-badge');
        if (count && !badge) {
            badge = App.util.el('span', { class: 'thumb-comments-badge' });
            item.appendChild(badge);
        } else if (!count && badge) {
            badge.remove();
        }
        if (count) {
            badge.textContent = String(count);
            badge.title = count + (count === 1 ? ' comment' : ' comments');
        }
    }

    function onVisibilityChange(entries) {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                drawItem(entry.target);
            }
        });
    }

    function isVisible(item) {
        const railRect = rail.getBoundingClientRect();
        const rect = item.getBoundingClientRect();
        return rect.bottom >= railRect.top - 200 && rect.top <= railRect.bottom + 200;
    }

    /* Draw (or redraw) one thumbnail from the live slide. */
    function drawItem(item) {
        const index = Number(item.getAttribute('data-index'));
        const slide = App.deck.getSlides()[index];
        const frame = item.querySelector('iframe');
        if (!slide || !frame) {
            return;
        }
        const fill = () => {
            const thumbDoc = frame.contentDocument;
            const deckDoc = App.deck.getDocument();
            // The deck's <head> brings its CSS, including the editor view rules
            // that show the slide marked data-editor-current.
            thumbDoc.head.innerHTML = deckDoc.head.innerHTML;
            const copy = thumbDoc.importNode(slide, true);
            copy.setAttribute('data-editor-current', '');
            thumbDoc.body.replaceChildren(copy);
            item.setAttribute('data-drawn', 'true');
        };
        if (frame.getAttribute('data-ready') === 'true') {
            fill();
            return;
        }
        frame.addEventListener('load', () => {
            frame.setAttribute('data-ready', 'true');
            fill();
        }, { once: true });
        frame.srcdoc = '<!DOCTYPE html><html><head></head><body></body></html>';
    }

    const flushRefresh = App.util.debounce(() => {
        pendingRefresh.forEach((index) => {
            const item = rail.querySelector('.thumb[data-index="' + index + '"]');
            // Off-screen thumbnails are redrawn when they scroll into view.
            if (item && isVisible(item)) {
                drawItem(item);
            } else if (item) {
                item.removeAttribute('data-drawn');
                observer.unobserve(item);
                observer.observe(item);
            }
        });
        pendingRefresh.clear();
    }, 300);

    function onHistoryChanged(info) {
        if (!info || !info.scope) {
            return;
        }
        if (info.scope === 'deck' || info.scope.slides) {
            rebuild();   // slides may have been added, removed, moved or restyled
            return;
        }
        const slides = App.deck.getSlides();
        const index = slides.findIndex((slide) => slide.getAttribute('data-slide-id') === info.scope.slideId);
        if (index !== -1) {
            const item = rail.querySelector('.thumb[data-index="' + index + '"]');
            if (item) {
                markHidden(item, slides[index]);
                markComments(item, slides[index]);
            }
            pendingRefresh.add(index);
            flushRefresh();
        }
    }

    function highlightCurrent() {
        const current = App.deck.getCurrentIndex();
        const picked = App.slides.pickedIds();
        const slides = App.deck.getSlides();
        rail.querySelectorAll('.thumb').forEach((item) => {
            const slide = slides[Number(item.getAttribute('data-index'))];
            item.classList.toggle('thumb-picked', !!slide && picked.indexOf(slide.getAttribute('data-slide-id')) !== -1);
            const isCurrent = Number(item.getAttribute('data-index')) === current;
            item.classList.toggle('thumb-current', isCurrent);
            item.setAttribute('aria-current', isCurrent ? 'true' : 'false');
            if (isCurrent) {
                item.scrollIntoView({ block: 'nearest' });
                // While the keyboard is in the rail, it moves with the slide shown.
                if (rail.contains(document.activeElement) && document.activeElement !== item) {
                    item.focus();
                }
            }
        });
    }
})();
