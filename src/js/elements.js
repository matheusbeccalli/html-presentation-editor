/*
 * elements.js - actions on the selected element (SPEC 4, Phase 2):
 * nudge with the arrow keys, delete, cut / copy / paste / duplicate (also
 * across slides), and the stacking order (bring forward, send to back ...).
 *
 * Every action is one undoable step on the current slide (history.js).
 * The pure helpers at the top are tested in tests/unit/elements.test.js.
 *
 * The clipboard is the editor's own (a string of HTML in memory), so copy and
 * paste work between slides and decks in this tab. Pasting from other programs
 * (tables from Excel, screenshots) arrives in Phases 4 and 5.
 *
 * Talks to: selection.js (what is selected), transform.js (positions, order),
 *           history.js, deck.js.
 */

(function () {
    'use strict';

    App.elements = {};

    const PASTE_OFFSET = 10;   // px down and right when the spot is taken, like PowerPoint

    // ---------------------------------------------------------------
    // Pure helpers
    // ---------------------------------------------------------------

    /*
     * order: ids from back to front. Returns a new array with `id` moved:
     * 'front' / 'back' to the end / start, 'forward' / 'backward' one place.
     */
    App.elements.restack = function restack(order, id, action) {
        const result = order.filter((item) => item !== id);
        const index = order.indexOf(id);
        let target = index;
        if (action === 'front') {
            target = result.length;
        } else if (action === 'back') {
            target = 0;
        } else if (action === 'forward') {
            target = Math.min(result.length, index + 1);
        } else if (action === 'backward') {
            target = Math.max(0, index - 1);
        }
        result.splice(target, 0, id);
        return result;
    };

    /* Give `element` and every element inside it that has a data-id a new, unused id. */
    App.elements.giveFreshIds = function giveFreshIds(element, usedIds) {
        [element].concat(Array.from(element.querySelectorAll('[data-id]'))).forEach((node) => {
            node.setAttribute('data-id', App.util.uniqueId('e', usedIds));
        });
    };

    /*
     * Where a pasted element goes: its own position if no element on the
     * slide starts there, otherwise 10 px further down-right until free.
     * So paste on another slide keeps the position; paste on the same slide
     * (or a second paste) does not hide exactly behind the original.
     */
    App.elements.pastePosition = function pastePosition(rect, takenRects) {
        const isTaken = (left, top) => takenRects.some((r) => r.left === left && r.top === top);
        let left = rect.left;
        let top = rect.top;
        while (isTaken(left, top)) {
            left += PASTE_OFFSET;
            top += PASTE_OFFSET;
        }
        return { left: left, top: top, width: rect.width, height: rect.height };
    };

    // ---------------------------------------------------------------
    // Actions on the live deck
    // ---------------------------------------------------------------

    let clipboardHtml = null;

    function currentSlideScope() {
        return { slideId: App.deck.getCurrentSlide().getAttribute('data-slide-id') };
    }

    App.elements.hasSelection = function hasSelection() {
        return !!App.selection.getElement();
    };

    App.elements.canPaste = function canPaste() {
        return clipboardHtml !== null && !!App.deck.getCurrentSlide();
    };

    /* Move the selected element by (dx, dy) px; a held key is one undo step. */
    App.elements.nudge = function nudge(dx, dy) {
        const element = App.selection.getElement();
        if (!element) {
            return;
        }
        App.history.change('Move', currentSlideScope(), () => {
            App.transform.writeRect(element, App.transform.moveRect(App.transform.readRect(element), dx, dy));
        }, { mergeKey: 'nudge:' + element.getAttribute('data-id') });
    };

    App.elements.remove = function remove(label) {
        const element = App.selection.getElement();
        if (!element) {
            return;
        }
        App.history.change(label || 'Delete', currentSlideScope(), () => element.remove());
        App.selection.clear();
    };

    App.elements.copy = function copy() {
        const element = App.selection.getElement();
        if (element) {
            clipboardHtml = element.outerHTML;
            App.events.emit('clipboard-changed');   // Paste buttons become enabled
        }
    };

    App.elements.cut = function cut() {
        App.elements.copy();
        App.elements.remove('Cut');
    };

    /*
     * Put a copy of `html` (one element) on the current slide, on top of the
     * others, with fresh ids; select it. Returns the new element.
     */
    function insertCopy(html, label) {
        const doc = App.deck.getDocument();
        const slide = App.deck.getCurrentSlide();
        const template = doc.createElement('template');
        template.innerHTML = html.trim();
        const element = template.content.firstElementChild;
        if (!element) {
            return null;
        }
        App.history.change(label, currentSlideScope(), () => {
            const usedIds = new Set(Array.from(doc.querySelectorAll('[data-id]'), (node) => node.getAttribute('data-id')));
            App.elements.giveFreshIds(element, usedIds);

            const others = App.transform.topLevelElements(slide);
            const taken = others.map((other) => App.transform.readRect(other));
            App.transform.writeRect(element, App.elements.pastePosition(App.transform.readRect(element), taken));
            const topZ = others.reduce((max, other) => Math.max(max, App.transform.zIndexOf(other)), 0);
            element.style.zIndex = String(topZ + 1);

            // Speaker notes stay the last thing in the slide.
            slide.insertBefore(element, slide.querySelector(':scope > aside.notes'));
        });
        App.selection.select(element);
        return element;
    }

    App.elements.paste = function paste() {
        if (App.elements.canPaste()) {
            insertCopy(clipboardHtml, 'Paste');
        }
    };

    App.elements.duplicate = function duplicate() {
        const element = App.selection.getElement();
        if (element) {
            insertCopy(element.outerHTML, 'Duplicate');
        }
    };

    const ARRANGE_LABELS = {
        front: 'Bring to front', forward: 'Bring forward', backward: 'Send backward', back: 'Send to back',
    };

    /* Can the selected element move in this direction? (false at the top/bottom of the stack) */
    App.elements.canArrange = function canArrange(action) {
        const element = App.selection.getElement();
        if (!element) {
            return false;
        }
        const order = App.transform.topLevelElements(App.deck.getCurrentSlide());
        const index = order.indexOf(element);
        return (action === 'front' || action === 'forward') ? index < order.length - 1 : index > 0;
    };

    /*
     * Change the stacking order. All elements of the slide get z-index 1, 2,
     * 3 ... in the new order, so ties and gaps in the old numbers cannot
     * make an element jump unexpectedly.
     */
    App.elements.arrange = function arrange(action) {
        if (!App.elements.canArrange(action)) {
            return;
        }
        const element = App.selection.getElement();
        const order = App.transform.topLevelElements(App.deck.getCurrentSlide());
        const newOrder = App.elements.restack(order, element, action);
        App.history.change(ARRANGE_LABELS[action], currentSlideScope(), () => {
            newOrder.forEach((item, index) => {
                item.style.zIndex = String(index + 1);
            });
        });
    };
})();
