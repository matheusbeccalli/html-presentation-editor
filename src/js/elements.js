/*
 * elements.js - actions on the selected element(s) (SPEC 4, Phase 2; several
 * at once since Phase 7's multi-select): nudge with the arrow keys, delete,
 * cut / copy / paste / duplicate (also across slides), and the stacking order
 * (bring forward, send to back ...), align and distribute, and rotate
 * (Arrange > Rotate, the Format pane's Rotation field) and lock (Phase 7).
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
        const elements = App.selection.getElements().filter((element) => !App.elements.isLocked(element));
        if (!elements.length) {
            return;
        }
        App.history.change('Move', currentSlideScope(), () => {
            elements.forEach((element) => {
                App.transform.writeRect(element, App.transform.moveRect(App.transform.readRect(element), dx, dy));
            });
        }, { mergeKey: 'nudge:' + App.selection.selectedIds().join(',') });
    };

    /* Delete the selected elements; locked ones stay (still selected). */
    App.elements.remove = function remove(label) {
        const all = App.selection.getElements();
        const elements = all.filter((element) => !App.elements.isLocked(element));
        if (!elements.length) {
            if (all.length) {
                App.ui.setStatus('Locked: Arrange > Lock unlocks it first');
            }
            return;
        }
        App.history.change(label || 'Delete', currentSlideScope(), () => elements.forEach((element) => element.remove()));
        App.selection.selectMany(all.filter((element) => !elements.includes(element)));
    };

    /* Delete and Cut need something that is not locked. */
    App.elements.canDelete = function canDelete() {
        return App.selection.getElements().some((element) => !App.elements.isLocked(element));
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
                element.removeAttribute('data-locked');   // a copy is free to move, as in PowerPoint
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
        if (event.type === 'cut' && !App.elements.canDelete()) {
            App.ui.setStatus('Locked: Arrange > Lock unlocks it first');   // nothing cut, the clipboard left as it was
            return;
        }
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

    // ---------------------------------------------------------------
    // Align and distribute (Phase 7)
    // ---------------------------------------------------------------

    const SLIDE_AREA = { left: 0, top: 0, width: 1280, height: 720 };
    let alignToSlide = false;   // Arrange > Align to Slide, for this session (PowerPoint keeps it too)

    /* One element always lines up on the slide; several on each other unless Align to Slide is on. */
    App.elements.alignsToSlide = function alignsToSlide() {
        return alignToSlide || App.selection.count() === 1;
    };

    App.elements.toggleAlignToSlide = function toggleAlignToSlide() {
        alignToSlide = !alignToSlide;
        App.ribbon.refresh();
    };

    App.elements.canAlign = function canAlign() {
        return App.selection.count() > 0 && Boolean(App.deck.getCurrentSlide());
    };

    /* Distributing needs three to spread between the outer two, or one and more over the slide. */
    App.elements.canDistribute = function canDistribute() {
        return App.elements.canAlign() && App.selection.count() >= (App.elements.alignsToSlide() ? 1 : 3);
    };

    /*
     * Move the selected elements to the rects `place(rects, area)` gives; one undo step, none when nothing moves.
     * A turned element is placed by the upright box round what shows (as in PowerPoint), and moved as much as that box.
     */
    function placeSelected(label, place) {
        const elements = App.selection.getElements();
        const rects = elements.map(App.transform.readRect);
        const shown = elements.map((element, index) => App.transform.visualRect(rects[index], App.transform.rotationOf(element)));
        const area = App.elements.alignsToSlide() ? SLIDE_AREA : App.transform.boundsOf(shown);
        const placed = place(shown, area);
        if (placed.every((rect, index) => App.elements.isLocked(elements[index]) ||
            (rect.left === shown[index].left && rect.top === shown[index].top))) {
            return;
        }
        const round = (value) => Math.round(value * 100) / 100;
        App.history.change(label, currentSlideScope(), () => {
            elements.forEach((element, index) => {
                if (App.elements.isLocked(element)) {
                    return;   // a locked one stays, and the others line up with it
                }
                App.transform.writeRect(element, Object.assign({}, rects[index], {
                    left: round(rects[index].left + placed[index].left - shown[index].left),
                    top: round(rects[index].top + placed[index].top - shown[index].top),
                }));
            });
        });
    }

    /* how: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom' */
    App.elements.align = function align(how) {
        if (App.elements.canAlign()) {
            placeSelected('Align ' + how, (rects, area) => App.transform.alignRects(rects, how, area));
        }
    };

    /* axis: 'horizontal' | 'vertical' */
    App.elements.distribute = function distribute(axis) {
        if (App.elements.canDistribute()) {
            placeSelected('Distribute ' + axis + 'ly', (rects, area) => App.transform.distributeRects(rects, axis, area));
        }
    };

    // ---------------------------------------------------------------
    // Rotate (Phase 7)
    // ---------------------------------------------------------------

    /*
     * Can `element` be turned? Not when locked; not a table or a chart (PowerPoint does not turn
     * them either), nor a group holding one; not a line, whose two end handles
     * already point it any way (unless it is turned already: see below).
     */
    App.elements.canRotateElement = function canRotateElement(element) {
        if (!element || App.elements.isLocked(element)) {
            return false;
        }
        const type = element.getAttribute('data-type');
        if (type === 'table' || type === 'chart') {
            return false;
        }
        if (type === 'group') {
            return !element.querySelector('.el[data-type="table"], .el[data-type="chart"]');
        }
        // A line that is turned already (it came out of a turned group) can be turned back.
        return !(type === 'shape' && App.shapes.isLine(element.getAttribute('data-shape'))) || App.transform.rotationOf(element) !== 0;
    };

    function rotatableSelected() {
        return App.selection.getElements().filter(App.elements.canRotateElement);
    }

    App.elements.canRotate = function canRotate() {
        return !App.text.isEditing() && rotatableSelected().length > 0;
    };

    /* Arrange > Rotate Right 90 / Left 90: each selected element turns about its own centre; one undo step. */
    App.elements.rotateBy = function rotateBy(degrees) {
        const elements = App.elements.canRotate() ? rotatableSelected() : [];
        if (elements.length) {
            App.history.change('Rotate', currentSlideScope(), () => {
                elements.forEach((element) => App.transform.setRotation(element, App.transform.rotationOf(element) + degrees));
            });
        }
    };

    /* The Format pane's Rotation field: one undo step, none when it is already at that angle. */
    App.elements.rotateTo = function rotateTo(element, degrees) {
        if (!App.elements.canRotateElement(element) ||
            App.transform.normalizeAngle(degrees) === App.transform.rotationOf(element)) {
            return;
        }
        App.history.change('Rotate', currentSlideScope(), () => App.transform.setRotation(element, degrees));
    };

    // ---------------------------------------------------------------
    // Lock (Phase 7)
    // ---------------------------------------------------------------
    //
    // A locked element carries data-locked="true". It can still be selected
    // (to unlock it, give it a look, type in it), but not moved, resized,
    // turned or deleted: no handles, and drag, arrows, Delete, Cut, align and
    // the Format pane's size fields leave it where it is. With others
    // selected, they move and it stays. Its lock is its own: a group holding
    // a locked part is not locked.

    App.elements.isLocked = function isLocked(element) {
        return !!element && element.getAttribute('data-locked') === 'true';
    };

    App.elements.canLock = function canLock() {
        return App.selection.count() > 0 && !App.text.isEditing();
    };

    /* Ticked when every selected element is locked. */
    App.elements.allLocked = function allLocked() {
        const elements = App.selection.getElements();
        return elements.length > 0 && elements.every(App.elements.isLocked);
    };

    /* Arrange > Lock: lock the selected elements, or unlock them when all are locked; one undo step. */
    App.elements.toggleLock = function toggleLock() {
        if (!App.elements.canLock()) {
            return;
        }
        const elements = App.selection.getElements();
        const unlock = App.elements.allLocked();
        App.history.change(unlock ? 'Unlock' : 'Lock', currentSlideScope(), () => {
            elements.forEach((element) => {
                if (unlock) {
                    element.removeAttribute('data-locked');
                } else {
                    element.setAttribute('data-locked', 'true');
                }
            });
        });
    };
})();
