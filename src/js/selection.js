/*
 * selection.js - click to select, drag to move, handles to resize (SPEC 4, Phase 2).
 *
 * The overlay layer (#overlay, see canvas.js) lies on top of the deck iframe
 * and catches every mouse action on the slide. It works out which element is
 * under the mouse from the elements' left/top/width/height (transform.js), so
 * the deck itself never needs to receive clicks. The selection box and its 8
 * handles are drawn in the overlay too, never inside the slide (SPEC 3.5),
 * so nothing of the selection can end up in the saved file.
 *
 * The selection is remembered by the element's data-id, not as a reference to
 * the element: undo rebuilds the whole slide from a snapshot (history.js), so
 * the old element object no longer exists afterwards.
 *
 * A drag is one undo step: history.begin() when the mouse has moved a few
 * pixels, history.commit() when it is released, history.cancel() on Escape.
 *
 * Double-click on a text box starts editing it (text.js). A press inside a
 * table types in the cell under the mouse, and a drag from there selects cells
 * (tablecontrols.js); a table moves by its edge, as in PowerPoint. Insert mode
 * (armInsert): the next click or drag on the slide gives a spot to a callback,
 * e.g. Insert > Text box.
 *
 * Events: emits 'selection-changed' and, during a drag, 'selection-dragged'.
 * Listens to deck-loaded, slide-changed,
 * history-changed and zoom-changed.
 *
 * Talks to: transform.js (maths), history.js, deck.js, canvas.js (zoom), text.js (edit mode).
 */

(function () {
    'use strict';

    App.selection = {};

    // A press must move this many screen pixels before it counts as a drag,
    // so a slightly shaky click does not move the element.
    const DRAG_THRESHOLD = 3;

    let overlay = null;
    let box = null;
    let selectedId = null;
    let selectedSlideIndex = -1;
    let dragging = false;
    let insertCallback = null;   // set by armInsert: the next click/drag places something
    let insertPreview = null;    // armInsert's options.preview: a drag in both directions (shapes)

    App.selection.init = function init() {
        overlay = document.getElementById('overlay');
        box = buildBox();
        overlay.appendChild(box);

        overlay.addEventListener('pointerdown', onPointerDown);
        overlay.addEventListener('pointermove', updateHoverCursor);
        overlay.addEventListener('dblclick', onDoubleClick);

        App.events.on('deck-loaded', () => App.selection.clear());
        App.events.on('slide-changed', (info) => {
            if (info.index !== selectedSlideIndex) {
                App.selection.clear();
            }
        });
        // After undo/redo the element may have been rebuilt, moved or removed.
        App.events.on('history-changed', () => App.selection.refresh());
        App.events.on('zoom-changed', (info) => {
            // Handles keep the same size on screen at every zoom (see .selection-box in panels.css).
            overlay.style.setProperty('--inverse-zoom', String(1 / info.zoom));
        });
    };

    function buildBox() {
        const element = App.util.el('div', { class: 'selection-box', hidden: true });
        App.transform.HANDLES.forEach((handle) => {
            element.appendChild(App.util.el('div', { class: 'selection-handle', 'data-handle': handle }));
        });
        return element;
    }

    // ---------------------------------------------------------------
    // Selection state
    // ---------------------------------------------------------------

    App.selection.selectedId = function selectedIdFn() {
        return selectedId;
    };

    App.selection.isDragging = function isDragging() {
        return dragging;
    };

    /* The selected element in the live deck, or null. */
    App.selection.getElement = function getElement() {
        const slide = App.deck.getCurrentSlide();
        if (!selectedId || !slide) {
            return null;
        }
        return slide.querySelector('[data-id="' + CSS.escape(selectedId) + '"]');
    };

    App.selection.select = function select(element) {
        const id = element ? element.getAttribute('data-id') : null;
        if (id === selectedId) {
            App.selection.refresh();
            return;
        }
        selectedId = id;
        selectedSlideIndex = App.deck.getCurrentIndex();
        App.selection.refresh();
        App.events.emit('selection-changed', { id: selectedId });
    };

    App.selection.clear = function clear() {
        App.selection.select(null);
    };

    /* Redraw the box; drop the selection if its element is gone (e.g. undo of a paste). */
    App.selection.refresh = function refresh() {
        const element = App.selection.getElement();
        if (selectedId && !element) {
            selectedId = null;
            App.events.emit('selection-changed', { id: null });
        }
        box.hidden = !element;
        if (element) {
            App.transform.writeRect(box, App.transform.readRect(element));
        }
    };

    // ---------------------------------------------------------------
    // Mouse
    // ---------------------------------------------------------------

    /* Mouse position in slide pixels (the overlay is scaled with the slide). */
    function toSlidePoint(event) {
        const rect = overlay.getBoundingClientRect();
        const zoom = App.canvas.getZoom();
        return { x: (event.clientX - rect.left) / zoom, y: (event.clientY - rect.top) / zoom };
    }

    App.selection.slidePoint = toSlidePoint;

    // A table is moved by its edge (this many screen px); a press further in is in its cells, as in PowerPoint.
    const TABLE_EDGE = 8;

    function inTableCells(element, point) {
        if (!element || element.getAttribute('data-type') !== 'table') {
            return false;
        }
        const rect = App.transform.readRect(element);
        const edge = TABLE_EDGE / App.canvas.getZoom();
        return point.x > rect.left + edge && point.x < rect.left + rect.width - edge &&
            point.y > rect.top + edge && point.y < rect.top + rect.height - edge;
    }

    /* The element under slide point (x, y), or null. */
    App.selection.elementAt = function elementAt(x, y) {
        const slide = App.deck.getCurrentSlide();
        if (!slide) {
            return null;
        }
        const elements = App.transform.topLevelElements(slide);
        const items = elements.map((element, index) => ({
            id: index, rect: App.transform.readRect(element), z: App.transform.zIndexOf(element),
        }));
        const hit = App.transform.hitTest(items, x, y);
        return hit === null ? null : elements[hit];
    };

    /*
     * Double-click on a text box: edit its text, with the cursor where the click
     * was. On empty slide space: a new text box there, ready to type (left
     * empty, it goes once deselected, see text.js).
     */
    function onDoubleClick(event) {
        const point = toSlidePoint(event);
        const element = App.selection.elementAt(point.x, point.y);
        if (element && element.getAttribute('data-type') === 'text') {
            App.selection.select(element);
            App.text.enterEdit(element, { point: point });
            return;
        }
        if (element && element.getAttribute('data-type') === 'table') {
            editCellAt(element, point);
            return;
        }
        const slide = App.deck.getCurrentSlide();
        if (!element && slide && point.x >= 0 && point.y >= 0 && point.x < slide.offsetWidth && point.y < slide.offsetHeight) {
            App.elements.insertTextBox({ left: Math.round(point.x), top: Math.round(point.y), width: null });
        }
    }

    /* Type in the table cell under `point` (a double-click into a table). */
    function editCellAt(element, point) {
        const cell = App.tables.cellAt(element, point.x, point.y);
        if (cell) {
            App.selection.select(element);
            App.text.enterEdit(cell, { point: point });
        }
    }

    function updateHoverCursor(event) {
        if (dragging || insertCallback || App.tableControls.isDraggingBorder()) {
            return;
        }
        const point = toSlidePoint(event);
        const element = App.selection.elementAt(point.x, point.y);
        const cells = inTableCells(element, point);
        overlay.style.cursor = cells && App.tableControls.borderAt(element, point) >= 0 ? 'col-resize'
            : cells ? 'text' : element ? 'move' : '';
    }

    function onPointerDown(event) {
        if (!App.state.hasDeck || (event.button !== 0 && event.button !== 2)) {
            return;
        }
        // A field in the Format pane still being edited gets its change applied first.
        if (document.activeElement && document.activeElement !== document.body) {
            document.activeElement.blur();
        }
        if (insertCallback) {
            if (event.button === 0) {
                startInsertGesture(event);
            }
            return;
        }
        const handle = event.target.getAttribute && event.target.getAttribute('data-handle');
        if (handle && event.button === 0) {
            startDrag(event, 'resize', handle);
            return;
        }
        const point = toSlidePoint(event);
        const element = App.selection.elementAt(point.x, point.y);
        // The format painter on: a text box gets the look; anything else stops the painter.
        if (App.text.isPainting() && event.button === 0) {
            if (App.text.paintBox(element)) {
                return;
            }
            App.text.stopPainter();
        }
        // In a table: a column border drags; in its cells a click types in the cell, a drag selects cells (tablecontrols.js).
        const border = event.button === 0 && inTableCells(element, point) ? App.tableControls.borderAt(element, point) : -1;
        if (border >= 0) {
            App.selection.select(element);
            App.tableControls.dragBorder(element, border, event, overlay, toSlidePoint);
            return;
        }
        const cell = event.button === 0 && inTableCells(element, point) ? App.tables.cellAt(element, point.x, point.y) : null;
        if (cell) {
            App.selection.select(element);
            App.tableControls.pressCells(element, cell, event, point);
            return;
        }
        App.selection.select(element);
        if (element && event.button === 0) {
            startDrag(event, 'move', null);
        }
    }

    // ---------------------------------------------------------------
    // Insert mode
    // ---------------------------------------------------------------

    /*
     * The next press on the slide places something: a click gives
     * callback({ left, top, width: null }), a drag gives the dragged left/top/width
     * (slide px). Escape cancels. With options.preview(gesture) (a shape) the
     * drag goes both ways: the selection box shows preview's rect while
     * dragging, and the callback also gets `gesture`: { start, end, shiftKey, dragged }.
     */
    App.selection.armInsert = function armInsert(callback, options) {
        insertCallback = callback;
        insertPreview = (options && options.preview) || null;
        overlay.classList.add('inserting');
        overlay.style.cursor = '';
        window.addEventListener('keydown', onInsertKey, true);
    };

    App.selection.isInserting = function isInserting() {
        return insertCallback !== null;
    };

    function disarmInsert() {
        insertCallback = null;
        insertPreview = null;
        overlay.classList.remove('inserting');
        window.removeEventListener('keydown', onInsertKey, true);
    }

    function onInsertKey(event) {
        if (event.key === 'Escape') {
            event.stopPropagation();
            event.preventDefault();
            disarmInsert();
            App.selection.refresh();
            App.ui.setStatus('Insert cancelled');
        }
    }

    function startInsertGesture(downEvent) {
        const callback = insertCallback;
        const preview = insertPreview;
        const start = toSlidePoint(downEvent);
        const zoom = App.canvas.getZoom();
        let spot = { left: start.x, top: start.y, width: null };
        let gesture = { start: start, end: start, shiftKey: downEvent.shiftKey, dragged: false };
        overlay.setPointerCapture(downEvent.pointerId);

        function onMove(event) {
            const point = toSlidePoint(event);
            const moved = Math.hypot(point.x - start.x, point.y - start.y) * zoom >= DRAG_THRESHOLD;
            gesture = { start: start, end: point, shiftKey: event.shiftKey, dragged: gesture.dragged || moved };
            if (preview) {
                if (gesture.dragged) {
                    App.transform.writeRect(box, preview(gesture));
                    box.hidden = false;
                }
                return;
            }
            if (Math.abs(point.x - start.x) * zoom < DRAG_THRESHOLD) {
                return;
            }
            spot = { left: Math.min(start.x, point.x), top: start.y, width: Math.abs(point.x - start.x) };
            // The selection box shows where the new box will go.
            App.transform.writeRect(box, { left: spot.left, top: spot.top, width: spot.width, height: 40 });
            box.hidden = false;
        }

        function onUp(event) {
            overlay.removeEventListener('pointermove', onMove);
            overlay.removeEventListener('pointerup', onUp);
            disarmInsert();
            gesture.shiftKey = event.shiftKey;
            callback({ left: Math.round(spot.left), top: Math.round(spot.top), width: spot.width === null ? null : Math.round(spot.width),
                gesture: gesture });
        }

        overlay.addEventListener('pointermove', onMove);
        overlay.addEventListener('pointerup', onUp);
    }

    /*
     * Follow the mouse until it is released. kind is 'move' or 'resize';
     * Shift while resizing keeps the aspect ratio (a picture's corners always do).
     */
    function startDrag(downEvent, kind, handle) {
        const element = App.selection.getElement();
        const slide = App.deck.getCurrentSlide();
        if (!element || !slide) {
            return;
        }
        const startRect = App.transform.readRect(element);
        const start = toSlidePoint(downEvent);
        const zoom = App.canvas.getZoom();
        let started = false;
        overlay.setPointerCapture(downEvent.pointerId);   // keep getting moves outside the slide

        function onMove(event) {
            const point = toSlidePoint(event);
            const dx = point.x - start.x;
            const dy = point.y - start.y;
            if (!started) {
                if (Math.hypot(dx * zoom, dy * zoom) < DRAG_THRESHOLD) {
                    return;
                }
                started = true;
                dragging = true;
                App.history.begin(kind === 'move' ? 'Move' : 'Resize', { slideId: slide.getAttribute('data-slide-id') });
            }
            const rect = kind === 'move'
                ? App.transform.moveRect(startRect, dx, dy)
                : App.transform.resizeRect(startRect, handle, dx, dy,
                    App.transform.keepsAspect(element.getAttribute('data-type'), handle, event.shiftKey));
            App.transform.writeRect(element, rect);
            if (kind === 'resize') {
                App.text.fitText(element);   // autofit: the text shrinks or the box keeps its text's height, live
                App.tables.fitTable(element, { resized: true });   // a table's columns and rows follow the box
                App.shapes.render(element);   // a shape is drawn again at its new size
            }
            App.selection.refresh();
            App.events.emit('selection-dragged');   // the Format pane shows the values live
        }

        function finish(cancelled) {
            overlay.removeEventListener('pointermove', onMove);
            overlay.removeEventListener('pointerup', onUp);
            overlay.removeEventListener('pointercancel', onCancel);
            window.removeEventListener('keydown', onKey, true);
            if (!started) {
                return;
            }
            dragging = false;
            if (cancelled) {
                App.history.cancel();   // puts the slide back exactly as before the drag
                App.selection.refresh();
            } else {
                App.history.commit();
            }
        }

        const onUp = () => finish(false);
        const onCancel = () => finish(true);
        function onKey(event) {
            if (event.key === 'Escape') {
                // Capture phase + stopPropagation: Escape ends the drag only, it does not also deselect.
                event.stopPropagation();
                event.preventDefault();
                finish(true);
            }
        }

        overlay.addEventListener('pointermove', onMove);
        overlay.addEventListener('pointerup', onUp);
        overlay.addEventListener('pointercancel', onCancel);
        window.addEventListener('keydown', onKey, true);
    }
})();
