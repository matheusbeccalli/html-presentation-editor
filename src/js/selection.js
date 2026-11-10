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
 * Multi-select (Phase 7): the selection is a list of ids. Shift+click (or
 * Ctrl+click) adds an element or takes it out; a drag on empty slide draws a
 * rubber band that selects what it covers wholly (with Shift: added); Ctrl+A
 * all. Several selected: each gets an outline (no handles), and a drag on one
 * of them moves them all. getElement() is the element only when exactly one
 * is selected, so everything made for one element (typing, the Format pane,
 * the contextual tabs) simply stays off; getElements() is all of them.
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
    let selectedIds = [];          // in the order they were picked
    let selectedSlideIndex = -1;
    let outlines = [];             // one .selection-outline per element while several are selected
    let band = null;               // the rubber band while it is dragged
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

    // Shapes (Phase 5): a line or arrow has a handle at each end instead of the 8; some shapes a yellow one.
    const SHAPE_HANDLES = ['start', 'end', 'adjust'];

    function buildBox() {
        const element = App.util.el('div', { class: 'selection-box', hidden: true });
        App.transform.HANDLES.concat(SHAPE_HANDLES).forEach((handle) => {
            element.appendChild(App.util.el('div', { class: 'selection-handle', 'data-handle': handle }));
        });
        return element;
    }

    function placeHandle(name, point) {
        const handle = box.querySelector('[data-handle="' + name + '"]');
        handle.hidden = !point;
        if (point) {
            handle.style.left = point.x + 'px';
            handle.style.top = point.y + 'px';
        }
    }

    /* A line's end handles (the box's own 8 hidden) and a shape's yellow handle, in box px. */
    function placeShapeHandles(element, rect) {
        const kind = element.getAttribute('data-type') === 'shape' ? element.getAttribute('data-shape') : null;
        const line = !!kind && App.shapes.isLine(kind);
        box.classList.toggle('line', line);
        const ends = line ? App.shapes.lineEnds(rect, element.getAttribute('data-flip') || '') : null;
        placeHandle('start', ends && { x: ends.start.x - rect.left, y: ends.start.y - rect.top });
        placeHandle('end', ends && { x: ends.end.x - rect.left, y: ends.end.y - rect.top });
        placeHandle('adjust', kind && !line ? App.shapes.adjustHandle(kind, rect.width, rect.height, App.shapes.adjustOf(element)) : null);
    }

    // ---------------------------------------------------------------
    // Selection state
    // ---------------------------------------------------------------

    /* Shift+click: `id` joins the selected ids, or leaves them if it was in (a new array). */
    App.selection.toggleId = function toggleId(ids, id) {
        return ids.includes(id) ? ids.filter((item) => item !== id) : ids.concat([id]);
    };

    /* The id of the one selected element, or null (none, or several). */
    App.selection.selectedId = function selectedIdFn() {
        return selectedIds.length === 1 ? selectedIds[0] : null;
    };

    /* The ids of every selected element (a copy). */
    App.selection.selectedIds = function selectedIdsFn() {
        return selectedIds.slice();
    };

    App.selection.count = function count() {
        return selectedIds.length;
    };

    App.selection.isDragging = function isDragging() {
        return dragging;
    };

    function elementWithId(slide, id) {
        return slide.querySelector('[data-id="' + CSS.escape(id) + '"]');
    }

    /* The selected element in the live deck when exactly one is selected, else null. */
    App.selection.getElement = function getElement() {
        const slide = App.deck.getCurrentSlide();
        const id = App.selection.selectedId();
        return id && slide ? elementWithId(slide, id) : null;
    };

    /* Every selected element in the live deck, in the order they were picked. */
    App.selection.getElements = function getElements() {
        const slide = App.deck.getCurrentSlide();
        return slide ? selectedIds.map((id) => elementWithId(slide, id)).filter(Boolean) : [];
    };

    App.selection.isSelected = function isSelected(element) {
        return !!element && selectedIds.includes(element.getAttribute('data-id'));
    };

    function setIds(ids) {
        const same = ids.length === selectedIds.length && ids.every((id, i) => id === selectedIds[i]);
        if (same) {
            App.selection.refresh();
            return;
        }
        selectedIds = ids.slice();
        selectedSlideIndex = App.deck.getCurrentIndex();
        App.selection.refresh();
        App.events.emit('selection-changed', { id: App.selection.selectedId(), ids: selectedIds.slice() });
    }

    App.selection.select = function select(element) {
        setIds(element ? [element.getAttribute('data-id')] : []);
    };

    /* Select all of `elements` (several pasted, Ctrl+A ...). */
    App.selection.selectMany = function selectMany(elements) {
        setIds(elements.map((element) => element.getAttribute('data-id')));
    };

    /* Shift+click: `element` joins the selection, or leaves it. */
    App.selection.toggle = function toggle(element) {
        setIds(App.selection.toggleId(selectedIds, element.getAttribute('data-id')));
    };

    /* Ctrl+A: everything on the slide. */
    App.selection.selectAll = function selectAll() {
        const slide = App.deck.getCurrentSlide();
        if (slide) {
            App.selection.selectMany(App.transform.topLevelElements(slide));
        }
    };

    App.selection.clear = function clear() {
        setIds([]);
    };

    /* Several selected: a plain outline round each (handles only for one, as resizing is one at a time). */
    function drawOutlines(elements) {
        while (outlines.length < elements.length) {
            const outline = App.util.el('div', { class: 'selection-outline' });
            overlay.appendChild(outline);
            outlines.push(outline);
        }
        outlines.forEach((outline, i) => {
            outline.hidden = i >= elements.length;
            if (i < elements.length) {
                App.transform.writeRect(outline, App.transform.readRect(elements[i]));
            }
        });
    }

    /* Redraw the box or outlines; drop selected ids whose element is gone (e.g. undo of a paste). */
    App.selection.refresh = function refresh() {
        const slide = App.deck.getCurrentSlide();
        // What the slide sees: an element that is now inside a group (undo of an ungroup) becomes that group.
        const present = slide ? selectedIds.map((id) => elementWithId(slide, id)).filter(Boolean)
            .map((element) => App.groups.topOf(element).getAttribute('data-id'))
            .filter((id, index, all) => all.indexOf(id) === index) : [];
        if (present.join(',') !== selectedIds.join(',')) {
            selectedIds = present;
            App.events.emit('selection-changed', { id: App.selection.selectedId(), ids: selectedIds.slice() });
        }
        const element = App.selection.getElement();
        box.hidden = !element;
        if (element) {
            const rect = App.transform.readRect(element);
            App.transform.writeRect(box, rect);
            placeShapeHandles(element, rect);
        }
        drawOutlines(selectedIds.length > 1 ? App.selection.getElements() : []);
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
     * Double-click on a text box or a shape: edit its text, with the cursor where
     * the click was (a table: the cell under it). On empty slide space: a new text box there, ready to type (left
     * empty, it goes once deselected, see text.js).
     */
    function onDoubleClick(event) {
        const point = toSlidePoint(event);
        const found = App.selection.elementAt(point.x, point.y);
        if (App.groups.isGroup(found)) {
            // Text in a group: type in that part; the group stays selected (groups.js).
            const part = App.groups.childAt(found, point.x, point.y);
            if (part && (part.getAttribute('data-type') === 'text' || App.shapes.canHoldText(part))) {
                App.selection.select(found);
                App.text.enterEdit(part.getAttribute('data-type') === 'text' ? part : App.shapes.textOf(part, { create: true }),
                    { point: point });
            }
            return;   // nothing else to do in a group by double-clicking
        }
        const element = found;
        if (element && element.getAttribute('data-type') === 'text') {
            App.selection.select(element);
            App.text.enterEdit(element, { point: point });
            return;
        }
        if (element && element.getAttribute('data-type') === 'table') {
            editCellAt(element, point);
            return;
        }
        if (element && element.getAttribute('data-type') === 'chart') {
            App.selection.select(element);
            App.chartData.open(element);   // its data grid, under the slide
            return;
        }
        if (App.shapes.canHoldText(element)) {
            App.selection.select(element);
            App.text.enterEdit(App.shapes.textOf(element, { create: true }), { point: point });
            return;
        }
        if (element) {
            return;   // a line, a picture …: nothing to type in
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
            startDrag(event, handle === 'adjust' ? 'adjust' : handle === 'start' || handle === 'end' ? 'line' : 'resize', handle);
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
        // Shift / Ctrl + click: add the element or take it out (on empty slide: a rubber band that adds).
        if ((event.shiftKey || event.ctrlKey || event.metaKey) && event.button === 0) {
            if (element) {
                App.selection.toggle(element);
            } else {
                startBand(event, true);
            }
            return;
        }
        // One of several selected: a drag moves them all; a right-click keeps them for the menu.
        if (element && selectedIds.length > 1 && App.selection.isSelected(element)) {
            if (event.button === 0) {
                startDrag(event, 'move', null);
            }
            return;
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
        } else if (!element && event.button === 0) {
            startBand(event, false);
        }
    }

    // ---------------------------------------------------------------
    // Rubber band: a drag from empty slide selects what it covers wholly
    // ---------------------------------------------------------------

    function startBand(downEvent, adding) {
        const slide = App.deck.getCurrentSlide();
        if (!slide) {
            return;
        }
        const start = toSlidePoint(downEvent);
        const zoom = App.canvas.getZoom();
        const kept = adding ? selectedIds.slice() : [];   // Shift: the band adds to these
        overlay.setPointerCapture(downEvent.pointerId);

        function onMove(event) {
            const point = toSlidePoint(event);
            if (!band) {
                if (Math.hypot(point.x - start.x, point.y - start.y) * zoom < DRAG_THRESHOLD) {
                    return;
                }
                band = App.util.el('div', { class: 'rubber-band' });
                overlay.appendChild(band);
            }
            const rect = App.transform.bandRect(start, point);
            App.transform.writeRect(band, rect);
            const caught = App.transform.topLevelElements(slide)
                .filter((element) => App.transform.containsRect(rect, App.transform.readRect(element)))
                .map((element) => element.getAttribute('data-id'))
                .filter((id) => !kept.includes(id));
            setIds(kept.concat(caught));
        }

        function finish() {
            overlay.removeEventListener('pointermove', onMove);
            overlay.removeEventListener('pointerup', finish);
            overlay.removeEventListener('pointercancel', finish);
            window.removeEventListener('keydown', onKey, true);
            if (band) {
                band.remove();
                band = null;
            }
        }

        function onKey(event) {
            if (event.key === 'Escape' && band) {
                event.stopPropagation();
                event.preventDefault();
                setIds(kept);
                finish();
            }
        }

        overlay.addEventListener('pointermove', onMove);
        overlay.addEventListener('pointerup', finish);
        overlay.addEventListener('pointercancel', finish);
        window.addEventListener('keydown', onKey, true);
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

    const DRAG_LABELS = { move: 'Move', resize: 'Resize', line: 'Move line end', adjust: 'Adjust shape' };

    /*
     * Follow the mouse until it is released. kind is 'move', 'resize', 'line'
     * (a line's end handle: 'start' or 'end') or 'adjust' (a shape's yellow
     * handle). Shift while resizing keeps the aspect ratio (a picture's corners
     * always do); on a line's end it snaps to 45 degrees.
     */
    function startDrag(downEvent, kind, handle) {
        // A move takes every selected element along; the other kinds work on the one selected.
        const elements = kind === 'move' ? App.selection.getElements() : [App.selection.getElement()].filter(Boolean);
        const element = elements[0];
        const slide = App.deck.getCurrentSlide();
        if (!element || !slide) {
            return;
        }
        const startRects = elements.map((item) => App.transform.readRect(item));
        const startRect = startRects[0];
        const startFlip = element.getAttribute('data-flip') || '';
        const startParts = kind === 'resize' && App.groups.isGroup(element) ? App.groups.partsOf(element) : null;
        const start = toSlidePoint(downEvent);
        const zoom = App.canvas.getZoom();
        // Smart guides (snap.js): moves and resizes snap to the slide and the other elements; Alt turns it off.
        const targets = kind === 'move' || kind === 'resize' ? App.snap.targetsFor(slide, elements) : null;
        let started = false;
        let last = null;   // the last pointer event, to snap again when Alt is pressed or let go
        overlay.setPointerCapture(downEvent.pointerId);   // keep getting moves outside the slide

        function onMove(event, altKey) {
            last = event;
            const free = altKey === undefined ? event.altKey : altKey;
            let guides = [];
            const point = toSlidePoint(event);
            const dx = point.x - start.x;
            const dy = point.y - start.y;
            if (!started) {
                if (Math.hypot(dx * zoom, dy * zoom) < DRAG_THRESHOLD) {
                    return;
                }
                started = true;
                dragging = true;
                App.history.begin(DRAG_LABELS[kind], { slideId: slide.getAttribute('data-slide-id') });
            }
            if (kind === 'line') {
                App.shapes.setLine(element, App.shapes.moveLineEnd(startRect, startFlip, handle, point, event.shiftKey));
            } else if (kind === 'adjust') {
                App.shapes.setAdjust(element, App.shapes.adjustFrom(element.getAttribute('data-shape'), startRect.width,
                    startRect.height, { x: point.x - startRect.left, y: point.y - startRect.top }));
            } else if (kind === 'move') {
                let moved = startRects.map((rect) => App.transform.moveRect(rect, dx, dy));
                if (!free) {
                    const snapped = App.snap.snapMove(App.transform.boundsOf(moved), targets, App.snap.threshold(zoom));
                    // Not moveRect: it rounds, and a centre line can be half a pixel.
                    moved = moved.map((rect) => Object.assign({}, rect, { left: rect.left + snapped.dx, top: rect.top + snapped.dy }));
                    guides = snapped.guides;
                }
                elements.forEach((item, i) => App.transform.writeRect(item, moved[i]));
            } else {
                const keepAspect = App.transform.keepsAspect(element.getAttribute('data-type'), handle, event.shiftKey);
                let rect = App.transform.resizeRect(startRect, handle, dx, dy, keepAspect);
                if (!free && !keepAspect) {
                    const snapped = App.snap.snapResize(rect, handle, targets, App.snap.threshold(zoom));
                    rect = snapped.rect;
                    guides = snapped.guides;
                }
                App.transform.writeRect(element, rect);
                if (startParts) {
                    App.groups.scaleParts(startParts, startRect, rect);   // a group's parts follow, scaled
                }
            }
            if (targets) {
                App.snap.showGuides(guides);
            }
            if (kind === 'resize') {
                App.text.fitText(element);   // autofit: the text shrinks or the box keeps its text's height, live
                App.tables.fitTable(element, { resized: true });   // a table's columns and rows follow the box
                App.shapes.render(element);   // a shape is drawn again at its new size
                App.charts.redraw(element);   // so is a chart: its text keeps its size
            }
            App.selection.refresh();
            App.events.emit('selection-dragged');   // the Format pane shows the values live
        }

        function finish(cancelled) {
            overlay.removeEventListener('pointermove', onMove);
            overlay.removeEventListener('pointerup', onUp);
            overlay.removeEventListener('pointercancel', onCancel);
            window.removeEventListener('keydown', onKey, true);
            window.removeEventListener('keyup', onKey, true);
            App.snap.hideGuides();
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
            if (event.key === 'Alt') {
                // Snap again at once (on or off), without waiting for the mouse to move; and keep the
                // browser from taking Alt for its menu.
                event.preventDefault();
                if (started && last) {
                    onMove(last, event.type === 'keydown');
                }
                return;
            }
            if (event.type === 'keydown' && event.key === 'Escape') {
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
        window.addEventListener('keyup', onKey, true);
    }
})();
