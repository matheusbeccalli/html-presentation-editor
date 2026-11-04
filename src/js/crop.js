/*
 * crop.js - Picture Format > Crop (SPEC Phase 5).
 *
 * Crop mode shows the whole picture with black crop handles on the edges of
 * the part that stays; the part that goes is dimmed. Dragging a handle moves
 * that edge (a corner moves two), never past the picture's own edge. Nothing
 * changes in the deck until the crop is applied: by Enter, Esc, Crop again,
 * a press anywhere else on the slide, or another selection or slide.
 *
 * The crop is true (decided in the Phase 5 Q&A): the kept part is drawn on a
 * canvas at the picture's own pixels and stored as the new picture, so the
 * cut-away pixels are gone from the file. Ctrl+Z brings them back; nothing
 * else does. One undo step "Crop".
 *
 * Everything of crop mode is drawn in the overlay (like the selection box),
 * never in the slide, so none of it can reach the saved file.
 *
 * Events: emits 'crop-changed' (crop mode on or off). Listens to
 * selection-changed, slide-changed, deck-loaded, history-changed.
 *
 * Talks to: images.js (encode), selection.js, transform.js, history.js, deck.js.
 */

(function () {
    'use strict';

    App.crop = {};

    const MIN_SIZE = 10;   // slide px: the smallest crop
    const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

    let overlay = null;
    let layer = null;      // the crop mode drawing in the overlay
    let frame = null;      // the kept part, with the handles
    let masks = [];        // the dimmed parts: above, below, left, right of the kept part
    let state = null;      // in crop mode: { id, full (the picture's box), crop (the kept part), stateId }

    // ---------------------------------------------------------------
    // Maths (pure)
    // ---------------------------------------------------------------

    /* The crop `start` with the edge(s) of `handle` moved by dx, dy (slide px), inside the picture's box `full`. */
    App.crop.moveEdge = function moveEdge(start, full, handle, dx, dy) {
        const clamp = (value, low, high) => Math.min(Math.max(value, low), high);
        let left = start.left;
        let top = start.top;
        let right = start.left + start.width;
        let bottom = start.top + start.height;
        if (handle.indexOf('w') !== -1) {
            left = clamp(left + dx, full.left, right - MIN_SIZE);
        }
        if (handle.indexOf('e') !== -1) {
            right = clamp(right + dx, left + MIN_SIZE, full.left + full.width);
        }
        if (handle.indexOf('n') !== -1) {
            top = clamp(top + dy, full.top, bottom - MIN_SIZE);
        }
        if (handle.indexOf('s') !== -1) {
            bottom = clamp(bottom + dy, top + MIN_SIZE, full.top + full.height);
        }
        const round2 = App.util.round2;
        return { left: round2(left), top: round2(top), width: round2(right - left), height: round2(bottom - top) };
    };

    /* The crop (slide px) as a rectangle of the picture's own pixels (natural: its pixel size), whole pixels. */
    App.crop.sourceRect = function sourceRect(full, crop, natural) {
        const scaleX = natural.width / full.width;
        const scaleY = natural.height / full.height;
        const x = Math.round((crop.left - full.left) * scaleX);
        const y = Math.round((crop.top - full.top) * scaleY);
        return {
            x: x, y: y,
            width: Math.max(1, Math.min(natural.width - x, Math.round(crop.width * scaleX))),
            height: Math.max(1, Math.min(natural.height - y, Math.round(crop.height * scaleY))),
        };
    };

    /*
     * The kept part of a loaded picture (an <img> shown at `full`) as a new
     * picture: { src, type, width, height }. A raster picture keeps its own
     * pixels; an SVG is drawn at twice its size on the slide, so it stays sharp.
     */
    App.crop.cropImage = function cropImage(image, full, crop) {
        const natural = { width: image.naturalWidth, height: image.naturalHeight };
        const source = App.crop.sourceRect(full, crop, natural);
        const isSvg = /^data:image\/svg/.test(image.getAttribute('src') || '');
        const size = isSvg ? App.images.fitSize(Math.round(crop.width * 2), Math.round(crop.height * 2), App.images.MAX_SIDE)
            : { width: source.width, height: source.height };
        const canvas = document.createElement('canvas');
        canvas.width = size.width;
        canvas.height = size.height;
        canvas.getContext('2d').drawImage(image, source.x, source.y, source.width, source.height, 0, 0, size.width, size.height);
        return Object.assign(App.images.encode(canvas), size);
    };

    // ---------------------------------------------------------------
    // Crop mode
    // ---------------------------------------------------------------

    App.crop.isCropping = function isCropping() {
        return state !== null;
    };

    /* Picture Format > Crop: crop mode on for the selected picture, or (already on) apply it. */
    App.crop.toggle = function toggle() {
        if (state) {
            App.crop.finish();
        } else {
            App.crop.start();
        }
    };

    App.crop.start = function start() {
        const element = App.selection.getElement();
        if (state || !App.images.isPictureSelected() || !element.naturalWidth) {
            return;
        }
        const full = App.transform.readRect(element);
        state = { id: element.getAttribute('data-id'), full: full, crop: Object.assign({}, full), stateId: App.history.stateId() };
        overlay.classList.add('cropping');
        draw();
        keyWindows().forEach((target) => target.addEventListener('keydown', onKey, true));
        App.events.emit('crop-changed');
    };

    /* Crop mode off, nothing applied. */
    function end() {
        state = null;
        layer.hidden = true;
        overlay.classList.remove('cropping');
        keyWindows().forEach((target) => target.removeEventListener('keydown', onKey, true));
        App.events.emit('crop-changed');
    }

    /* Crop mode off, the crop applied (if any edge moved): one undo step. */
    App.crop.finish = function finish() {
        if (!state) {
            return;
        }
        const { id, full, crop } = state;
        end();
        const doc = App.deck.getDocument();
        const element = doc && doc.querySelector('[data-id="' + CSS.escape(id) + '"]');
        const unchanged = ['left', 'top', 'width', 'height'].every((side) => crop[side] === full[side]);
        if (!element || unchanged || !element.naturalWidth) {
            return;
        }
        const picture = App.crop.cropImage(element, full, crop);
        App.history.change('Crop', { slideId: element.closest('section.slide').getAttribute('data-slide-id') }, () => {
            App.transform.writeRect(element, crop);
            element.setAttribute('src', picture.src);
        });
    };

    function draw() {
        const { full, crop } = state;
        const right = crop.left + crop.width;
        const bottom = crop.top + crop.height;
        const fullRight = full.left + full.width;
        const fullBottom = full.top + full.height;
        [
            { left: full.left, top: full.top, width: full.width, height: crop.top - full.top },
            { left: full.left, top: bottom, width: full.width, height: fullBottom - bottom },
            { left: full.left, top: crop.top, width: crop.left - full.left, height: crop.height },
            { left: right, top: crop.top, width: fullRight - right, height: crop.height },
        ].forEach((rect, index) => App.transform.writeRect(masks[index], rect));
        App.transform.writeRect(frame, crop);
        layer.hidden = false;
    }

    // ---------------------------------------------------------------
    // Mouse and keys
    // ---------------------------------------------------------------

    /* A press in crop mode: on a crop handle it drags that edge; anywhere else it applies the crop first. */
    function onPointerDown(event) {
        if (!state) {
            return;
        }
        const handle = event.target.getAttribute && event.target.getAttribute('data-crop-handle');
        if (!handle || event.button !== 0) {
            App.crop.finish();   // then the press does what it always does (selection.js)
            return;
        }
        event.stopPropagation();   // not a selection press
        event.preventDefault();
        const start = App.selection.slidePoint(event);
        const startCrop = Object.assign({}, state.crop);
        overlay.setPointerCapture(event.pointerId);

        function onMove(moveEvent) {
            if (!state) {
                return;
            }
            const point = App.selection.slidePoint(moveEvent);
            state.crop = App.crop.moveEdge(startCrop, state.full, handle, point.x - start.x, point.y - start.y);
            draw();
        }
        function onUp() {
            overlay.removeEventListener('pointermove', onMove);
            overlay.removeEventListener('pointerup', onUp);
            overlay.removeEventListener('pointercancel', onUp);
        }
        overlay.addEventListener('pointermove', onMove);
        overlay.addEventListener('pointerup', onUp);
        overlay.addEventListener('pointercancel', onUp);
    }

    /* The editor's window and the deck's: the keyboard focus can be in either. */
    function keyWindows() {
        const doc = App.deck.getDocument();
        return doc && doc.defaultView ? [window, doc.defaultView] : [window];
    }

    /* Enter or Esc applies the crop (as in PowerPoint); the picture stays selected. */
    function onKey(event) {
        if (event.key === 'Enter' || event.key === 'Escape') {
            event.stopPropagation();
            event.preventDefault();
            App.crop.finish();
        }
    }

    /* Wiring, called once from App.start(). */
    App.crop.init = function init() {
        overlay = document.getElementById('overlay');
        masks = [0, 1, 2, 3].map(() => App.util.el('div', { class: 'crop-mask' }));
        frame = App.util.el('div', { class: 'crop-frame' },
            HANDLES.map((handle) => App.util.el('div', { class: 'crop-handle', 'data-crop-handle': handle })));
        layer = App.util.el('div', { class: 'crop-layer', hidden: true }, masks.concat([frame]));
        overlay.appendChild(layer);
        overlay.addEventListener('pointerdown', onPointerDown, true);   // capture: before selection.js

        App.events.on('selection-changed', () => App.crop.finish());
        App.events.on('slide-changed', () => App.crop.finish());
        App.events.on('deck-loaded', () => state && end());
        // Undo / redo while cropping: the picture may be another one now, so crop mode just ends.
        App.events.on('history-changed', () => {
            if (state && App.history.stateId() !== state.stateId) {
                end();
            }
        });
    };
})();
