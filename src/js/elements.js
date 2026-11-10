/*
 * elements.js - actions on the selected element(s) (SPEC 4, Phase 2; several
 * at once since Phase 7's multi-select): nudge with the arrow keys, delete,
 * cut / copy / paste / duplicate (also across slides), and the stacking order
 * (bring forward, send to back ...).
 *
 * Every action is one undoable step on the current slide (history.js).
 * The pure helpers at the top are tested in tests/unit/elements.test.js.
 *
 * The clipboard is the editor's own (a string of HTML in memory), so copy and
 * paste work between slides and decks in this tab. Ctrl+C / Ctrl+X / Ctrl+V go
 * through the browser's copy / cut / paste events (they carry the system
 * clipboard): a copy also puts a mark on the system clipboard, so Ctrl+V knows
 * whether the newest copy is ours or another program's. A table from Excel
 * becomes a table (tablepaste.js); screenshots arrive in Phase 5.
 *
 * Insert > Text box and Insert > Table add new elements on top of the slide.
 *
 * Talks to: selection.js (what is selected), transform.js (positions, order),
 *           history.js, deck.js, text.js and tables.js (new elements),
 *           tablepaste.js (Ctrl+V of a table), commands.js.
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
        return App.elements.restackMany(order, [id], action);
    };

    /*
     * The same for several ids (multi-select): 'front' / 'back' move them all to
     * the end / start in their own order; 'forward' / 'backward' move each one
     * place, so a block of selected ids moves together past one other element.
     */
    App.elements.restackMany = function restackMany(order, ids, action) {
        const chosen = new Set(ids);
        const others = order.filter((id) => !chosen.has(id));
        const picked = order.filter((id) => chosen.has(id));
        if (action === 'front') {
            return others.concat(picked);
        }
        if (action === 'back') {
            return picked.concat(others);
        }
        const result = order.slice();
        const swap = (i, j) => { [result[i], result[j]] = [result[j], result[i]]; };
        if (action === 'forward') {
            for (let i = result.length - 2; i >= 0; i--) {
                if (chosen.has(result[i]) && !chosen.has(result[i + 1])) {
                    swap(i, i + 1);
                }
            }
        } else if (action === 'backward') {
            for (let i = 1; i < result.length; i++) {
                if (chosen.has(result[i]) && !chosen.has(result[i - 1])) {
                    swap(i, i - 1);
                }
            }
        }
        return result;
    };

    const NEW_TEXT_WIDTH = 360;   // px, a click-placed text box (a drag sets the width)

    /*
     * Insert > Text box at spot { left, top, width|null } (slide px): one undo
     * step, then the box is selected and in edit mode (text.js removes it again
     * if it is left empty).
     */
    App.elements.insertTextBox = function insertTextBox(spot) {
        const slide = App.deck.getCurrentSlide();
        if (!slide) {
            return;
        }
        const doc = slide.ownerDocument;
        const left = Math.max(0, Math.min(1240, spot.left));
        const width = Math.max(40, Math.min(1280 - left, spot.width && spot.width >= 20 ? spot.width : NEW_TEXT_WIDTH));
        let element = null;
        App.history.change('Insert text box', { slideId: slide.getAttribute('data-slide-id') }, () => {
            element = App.text.createTextElement(doc, { left: left, top: Math.max(0, Math.min(700, spot.top)), width: width },
                App.elements.freshId(doc));
            App.elements.addOnTop(slide, element);
        });
        App.selection.select(element);
        App.text.enterEdit(element, { caret: 'start', isNew: true });
        App.text.fitText(element);
        App.selection.refresh();
    };

    /*
     * Insert > Shapes: a shape of `kind` drawn by `gesture` (selection.armInsert):
     * as dragged, or its default size at a plain click (or a drag of under 2 px).
     * One undo step; the shape is selected.
     */
    App.elements.insertShape = function insertShape(kind, gesture) {
        const slide = App.deck.getCurrentSlide();
        if (!slide) {
            return null;
        }
        const drawn = gesture.dragged ? App.shapes.drawnShape(kind, gesture.start, gesture.end, gesture.shiftKey) : null;
        const placed = drawn && (drawn.rect.width >= 2 || drawn.rect.height >= 2) ? drawn : App.shapes.clickedShape(kind, gesture.start);
        const doc = slide.ownerDocument;
        let element = null;
        App.history.change('Insert shape', { slideId: slide.getAttribute('data-slide-id') }, () => {
            element = App.shapes.createShape(doc, kind, placed.rect, App.elements.freshId(doc), placed.flip);
            App.elements.addOnTop(slide, element);
        });
        App.selection.select(element);
        return element;
    };

    /*
     * Insert > Table: a rows x cols table centred on the slide (one undo step),
     * then selected. Its rows are measured once it is on the slide (fitTable).
     */
    App.elements.insertTable = function insertTable(rows, cols) {
        const slide = App.deck.getCurrentSlide();
        if (!slide) {
            return;
        }
        let element = null;
        App.history.change('Insert table', { slideId: slide.getAttribute('data-slide-id') }, () => {
            element = App.tables.createTable(slide.ownerDocument, rows, cols, App.tables.newTableRect(rows, cols),
                App.elements.freshId(slide.ownerDocument));
            App.elements.addOnTop(slide, element);
            App.tables.fitTable(element);
        });
        App.selection.select(element);
    };

    /* An element id not used in the deck yet. */
    App.elements.freshId = function freshId(doc) {
        const used = new Set(Array.from(doc.querySelectorAll('[data-id]'), (node) => node.getAttribute('data-id')));
        return App.util.uniqueId('e', used);
    };

    /* A new element goes in front of everything on the slide (before the speaker notes in the HTML). */
    App.elements.addOnTop = function addOnTop(slide, element) {
        const top = App.transform.topLevelElements(slide).reduce((max, other) => Math.max(max, App.transform.zIndexOf(other)), 0);
        element.style.zIndex = String(top + 1);
        slide.insertBefore(element, slide.querySelector(':scope > aside.notes'));
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

    let clipboardHtml = null;   // the copied elements' HTML, back to front (an array: several can be copied)

    function currentSlideScope() {
        return { slideId: App.deck.getCurrentSlide().getAttribute('data-slide-id') };
    }

    App.elements.hasSelection = function hasSelection() {
        return App.selection.count() > 0;
    };

    /* The selected elements, back to front (their stacking order on the slide), so copies stack the same way. */
    function selectedBackToFront() {
        const chosen = App.selection.getElements();
        const slide = App.deck.getCurrentSlide();
        return slide ? App.transform.topLevelElements(slide).filter((element) => chosen.includes(element)) : [];
    }

    App.elements.canPaste = function canPaste() {
        return clipboardHtml !== null && !!App.deck.getCurrentSlide();
    };

    /* Move the selected elements by (dx, dy) px; a held key is one undo step. */
    App.elements.nudge = function nudge(dx, dy) {
        const elements = App.selection.getElements();
        if (!elements.length) {
            return;
        }
        App.history.change('Move', currentSlideScope(), () => {
            elements.forEach((element) => {
                App.transform.writeRect(element, App.transform.moveRect(App.transform.readRect(element), dx, dy));
            });
        }, { mergeKey: 'nudge:' + App.selection.selectedIds().join(',') });
    };

    App.elements.remove = function remove(label) {
        const elements = App.selection.getElements();
        if (!elements.length) {
            return;
        }
        App.history.change(label || 'Delete', currentSlideScope(), () => elements.forEach((element) => element.remove()));
        App.selection.clear();
    };

    App.elements.copy = function copy() {
        const elements = selectedBackToFront();
        if (elements.length) {
            clipboardHtml = elements.map((element) => element.outerHTML);
            copyMark = 'deck-editor-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
            App.events.emit('clipboard-changed');   // Paste buttons become enabled
            if (!inClipboardEvent) {
                writeMark(elements);   // the ribbon's Copy: no copy event to write it in
            }
        }
    };

    App.elements.cut = function cut() {
        App.elements.copy();
        App.elements.remove('Cut');
    };

    /*
     * Put copies of `htmlList` (elements' HTML, back to front) on the current
     * slide, on top of the others in that order, with fresh ids; select them.
     * They all move by the same step (pastePosition of the first), so several
     * keep their arrangement. Returns the new elements.
     */
    function insertCopy(htmlList, label) {
        const doc = App.deck.getDocument();
        const slide = App.deck.getCurrentSlide();
        const elements = htmlList.map((html) => {
            const template = doc.createElement('template');
            template.innerHTML = html.trim();
            return template.content.firstElementChild;
        }).filter(Boolean);
        if (!elements.length) {
            return [];
        }
        App.history.change(label, currentSlideScope(), () => {
            const usedIds = new Set(Array.from(doc.querySelectorAll('[data-id]'), (node) => node.getAttribute('data-id')));
            const others = App.transform.topLevelElements(slide);
            const taken = others.map((other) => App.transform.readRect(other));
            const first = App.transform.readRect(elements[0]);
            const spot = App.elements.pastePosition(first, taken);
            const topZ = others.reduce((max, other) => Math.max(max, App.transform.zIndexOf(other)), 0);
            elements.forEach((element, index) => {
                App.elements.giveFreshIds(element, usedIds);
                App.transform.writeRect(element, App.transform.moveRect(App.transform.readRect(element),
                    spot.left - first.left, spot.top - first.top));
                element.style.zIndex = String(topZ + 1 + index);
                // Speaker notes stay the last thing in the slide.
                slide.insertBefore(element, slide.querySelector(':scope > aside.notes'));
            });
        });
        App.selection.selectMany(elements);
        return elements;
    }

    // ---- The system clipboard (Ctrl+C / Ctrl+X / Ctrl+V) ----

    let copyMark = null;            // the mark our newest copy put on the system clipboard
    let inClipboardEvent = false;   // a copy / cut event is writing the clipboard itself

    /* The mark as clipboard HTML, with the element's text (for a paste into another program). */
    function markData(text) {
        const holder = document.createElement('div');
        holder.setAttribute('data-deck-editor', 'element');
        holder.setAttribute('data-copy', copyMark);
        holder.textContent = text;
        return { html: holder.outerHTML, text: text };
    }

    function textOf(element) {
        return (element.innerText || element.textContent || '').trim();
    }

    function textOfAll(elements) {
        return elements.map(textOf).filter(Boolean).join('\n');
    }

    /* Best effort: if the browser refuses, a table copied earlier in Excel could win over this copy at Ctrl+V. */
    function writeMark(elements) {
        const data = markData(textOfAll(elements));
        if (navigator.clipboard && window.ClipboardItem) {
            navigator.clipboard.write([new ClipboardItem({
                'text/html': new Blob([data.html], { type: 'text/html' }),
                'text/plain': new Blob([data.text], { type: 'text/plain' }),
            })]).catch(() => {});
        }
    }

    /* A clipboard event the slide handles: not typing (text.js has those), not in a field or a dialog. */
    function forTheSlide(event) {
        const target = event.target;
        return !event.defaultPrevented && !App.text.isEditing() && !App.shortcuts.isTypingTarget(target) &&
            !(target && target.closest && target.closest('dialog')) && !!App.deck.getCurrentSlide();
    }

    /* Ctrl+C / Ctrl+X with elements selected: our copy, and its mark on the system clipboard. */
    function onCopyEvent(event) {
        const elements = selectedBackToFront();
        if (!forTheSlide(event) || !elements.length) {
            return;
        }
        event.preventDefault();
        const text = textOfAll(elements);
        inClipboardEvent = true;
        try {
            App.commands.run(event.type);   // 'copy' or 'cut'
        } finally {
            inClipboardEvent = false;
        }
        const data = markData(text);
        event.clipboardData.setData('text/html', data.html);
        event.clipboardData.setData('text/plain', data.text);
    }

    /*
     * Ctrl+V: cells from another program (Excel) into a selected chart's data,
     * else a table, else a picture (a screenshot, an Excel chart), else our own copy. Excel puts a picture of
     * copied cells on the clipboard too, so the table is looked for first.
     */
    function onPasteEvent(event) {
        if (!forTheSlide(event)) {
            return;
        }
        const clipboard = { html: event.clipboardData.getData('text/html'), text: event.clipboardData.getData('text/plain') };
        const ours = copyMark !== null && clipboard.html.indexOf(copyMark) !== -1;
        const pictures = App.images.picturesIn(event.clipboardData);
        if (!ours && App.chartData.pasteOnChart(clipboard)) {
            event.preventDefault();   // cells pasted on a selected chart become its data, not a new table
        } else if (!ours && App.tablePaste.paste(clipboard)) {
            event.preventDefault();
        } else if (!ours && pictures.length > 0) {
            event.preventDefault();
            App.images.insertFiles(pictures, 'Paste');
        } else if (App.elements.canPaste()) {
            event.preventDefault();
            App.elements.paste();
        }
    }

    /* Wiring, called once from App.start(): the editor's page and every deck loaded. */
    App.elements.init = function init() {
        const wired = new WeakSet();
        const listen = (doc) => {
            if (doc && !wired.has(doc)) {
                wired.add(doc);
                doc.addEventListener('copy', onCopyEvent);
                doc.addEventListener('cut', onCopyEvent);
                doc.addEventListener('paste', onPasteEvent);
            }
        };
        listen(document);
        App.events.on('deck-loaded', () => listen(App.deck.getDocument()));
    };

    App.elements.paste = function paste() {
        if (App.elements.canPaste()) {
            insertCopy(clipboardHtml, 'Paste');
        }
    };

    App.elements.duplicate = function duplicate() {
        const elements = selectedBackToFront();
        if (elements.length) {
            insertCopy(elements.map((element) => element.outerHTML), 'Duplicate');
        }
    };

    const ARRANGE_LABELS = {
        front: 'Bring to front', forward: 'Bring forward', backward: 'Send backward', back: 'Send to back',
    };

    /* The slide's elements back to front after `action` on the selected ones (several move as a block). */
    function arranged(action) {
        const order = App.transform.topLevelElements(App.deck.getCurrentSlide());
        return { order: order, newOrder: App.elements.restackMany(order, App.selection.getElements(), action) };
    }

    /* Can the selected elements move in this direction? (false at the top/bottom of the stack) */
    App.elements.canArrange = function canArrange(action) {
        if (!App.selection.count() || !App.deck.getCurrentSlide()) {
            return false;
        }
        const { order, newOrder } = arranged(action);
        return newOrder.some((element, index) => element !== order[index]);
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
        const newOrder = arranged(action).newOrder;
        App.history.change(ARRANGE_LABELS[action], currentSlideScope(), () => {
            newOrder.forEach((item, index) => {
                item.style.zIndex = String(index + 1);
            });
        });
    };
})();
