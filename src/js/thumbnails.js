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
 * Talks to: deck.js (reads slides, goTo on click), events from history.js.
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
        App.events.on('history-changed', onHistoryChanged);

        rail.addEventListener('keydown', (event) => {
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                App.deck.next();
            } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                App.deck.previous();
            }
        });
    };

    function rebuild() {
        observer.disconnect();
        rail.innerHTML = '';
        App.deck.getSlides().forEach((slide, index) => {
            const item = createItem(slide, index);
            rail.appendChild(item);
            observer.observe(item);
        });
        highlightCurrent();
    }

    function createItem(slide, index) {
        const frame = App.util.el('iframe', {
            class: 'thumb-frame', sandbox: 'allow-same-origin', tabindex: '-1', 'aria-hidden': 'true',
        });
        const hidden = slide.getAttribute('data-hidden') === 'true';
        const item = App.util.el('div', {
            class: 'thumb' + (hidden ? ' thumb-hidden' : ''),
            role: 'button', tabindex: '0',
            'data-index': String(index),
            title: 'Slide ' + (index + 1) + (hidden ? ' (hidden)' : ''),
            onclick: () => App.deck.goTo(index),
        }, [
            App.util.el('span', { class: 'thumb-number' }, [String(index + 1)]),
            App.util.el('div', { class: 'thumb-box' }, [frame]),
        ]);
        if (hidden) {
            const badge = App.util.el('span', { class: 'thumb-hidden-badge', title: 'Hidden slide' });
            badge.innerHTML = App.icons.get('hidden');
            item.appendChild(badge);
        }
        return item;
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
        if (info.scope === 'deck') {
            rebuild();   // slides may have been added, removed or restyled
            return;
        }
        const index = App.deck.getSlides().findIndex((slide) => slide.getAttribute('data-slide-id') === info.scope.slideId);
        if (index !== -1) {
            pendingRefresh.add(index);
            flushRefresh();
        }
    }

    function highlightCurrent() {
        const current = App.deck.getCurrentIndex();
        rail.querySelectorAll('.thumb').forEach((item) => {
            const isCurrent = Number(item.getAttribute('data-index')) === current;
            item.classList.toggle('thumb-current', isCurrent);
            item.setAttribute('aria-current', isCurrent ? 'true' : 'false');
            if (isCurrent) {
                item.scrollIntoView({ block: 'nearest' });
            }
        });
    }
})();
