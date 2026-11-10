/*
 * transform.js - the maths of moving and resizing elements (SPEC 4, Phase 2).
 *
 * A "rect" is a plain object { left, top, width, height } in slide pixels,
 * the same four values every element carries in its inline style (SPEC 3.3).
 * The functions here only calculate; selection.js decides when to call them
 * and history.js makes the result undoable. Tested in tests/unit/transform.test.js.
 *
 * Talks to: nothing (selection.js and elements.js call it).
 */

(function () {
    'use strict';

    App.transform = {};

    // The 8 resize handles, named by compass direction: n = top edge, se = bottom-right corner ...
    App.transform.HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

    // Smallest width/height a resize can make, so a box never disappears or flips inside out.
    App.transform.MIN_SIZE = 4;

    const round = Math.round;

    App.transform.moveRect = function moveRect(rect, dx, dy) {
        return { left: round(rect.left + dx), top: round(rect.top + dy), width: rect.width, height: rect.height };
    };

    /*
     * Resize `rect` by dragging `handle` by (dx, dy) slide pixels.
     * keepAspect (Shift held): the width/height ratio stays the same. On a
     * corner the opposite corner stays put; on a side the box grows evenly
     * on the other axis, like PowerPoint.
     */
    /* Whether a resize keeps the width/height ratio: with Shift, or a picture by a corner (as in PowerPoint). */
    App.transform.keepsAspect = function keepsAspect(type, handle, shiftKey) {
        return !!shiftKey || (type === 'image' && handle.length === 2);
    };

    App.transform.resizeRect = function resizeRect(rect, handle, dx, dy, keepAspect) {
        const min = App.transform.MIN_SIZE;
        const movesLeft = handle.indexOf('w') !== -1;
        const movesRight = handle.indexOf('e') !== -1;
        const movesTop = handle.indexOf('n') !== -1;
        const movesBottom = handle.indexOf('s') !== -1;

        // New width/height from the dragged edges, never below the minimum.
        let width = rect.width;
        let height = rect.height;
        if (movesRight) { width = rect.width + dx; }
        if (movesLeft) { width = rect.width - dx; }
        if (movesBottom) { height = rect.height + dy; }
        if (movesTop) { height = rect.height - dy; }
        width = Math.max(min, width);
        height = Math.max(min, height);

        if (keepAspect && rect.width > 0 && rect.height > 0) {
            const ratio = rect.width / rect.height;
            const isCorner = handle.length === 2;
            if (isCorner) {
                // Follow whichever side the mouse changed more.
                const scaleX = width / rect.width;
                const scaleY = height / rect.height;
                const scale = Math.abs(scaleX - 1) >= Math.abs(scaleY - 1) ? scaleX : scaleY;
                width = rect.width * scale;
                height = rect.height * scale;
            } else if (movesLeft || movesRight) {
                height = width / ratio;
            } else {
                width = height * ratio;
            }
        }

        // Place the box: the edges that were not dragged stay where they were.
        let left = rect.left;
        let top = rect.top;
        if (movesLeft) {
            left = rect.left + rect.width - width;
        } else if (!movesRight) {
            left = rect.left + (rect.width - width) / 2;   // side handle + Shift: grow evenly
        }
        if (movesTop) {
            top = rect.top + rect.height - height;
        } else if (!movesBottom) {
            top = rect.top + (rect.height - height) / 2;
        }
        return { left: round(left), top: round(top), width: round(width), height: round(height) };
    };

    const HIT_MIN = 10;   // slide px

    /*
     * items: [{ id, rect, z }] in slide order. Returns the id of the element
     * drawn on top at point (x, y), or null. Higher z-index wins; with equal
     * z-index the later element wins, because the browser draws it last.
     */
    App.transform.hitTest = function hitTest(items, x, y) {
        let best = null;
        items.forEach((item, index) => {
            const r = item.rect;
            // A line can be 0 px thin: anything thinner than HIT_MIN can still be clicked a few px either side.
            const padX = Math.max(0, (HIT_MIN - r.width) / 2);
            const padY = Math.max(0, (HIT_MIN - r.height) / 2);
            const inside = x >= r.left - padX && x <= r.left + r.width + padX && y >= r.top - padY && y <= r.top + r.height + padY;
            if (inside && (!best || item.z > best.z || (item.z === best.z && index > best.index))) {
                best = { id: item.id, z: item.z, index: index };
            }
        });
        return best ? best.id : null;
    };

    // ---- Several elements (Phase 7: multi-select) ----

    /* The rubber band's rect from the point where the drag began to where the pointer is now. */
    App.transform.bandRect = function bandRect(start, end) {
        return { left: Math.min(start.x, end.x), top: Math.min(start.y, end.y),
            width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
    };

    /* Is `rect` wholly inside `outer`? (A rubber band catches only elements it covers completely, as in PowerPoint.) */
    App.transform.containsRect = function containsRect(outer, rect) {
        return rect.left >= outer.left && rect.top >= outer.top &&
            rect.left + rect.width <= outer.left + outer.width && rect.top + rect.height <= outer.top + outer.height;
    };

    /* The smallest rect around all `rects` (null for none). */
    App.transform.boundsOf = function boundsOf(rects) {
        if (!rects.length) {
            return null;
        }
        const left = Math.min(...rects.map((r) => r.left));
        const top = Math.min(...rects.map((r) => r.top));
        const right = Math.max(...rects.map((r) => r.left + r.width));
        const bottom = Math.max(...rects.map((r) => r.top + r.height));
        return { left: left, top: top, width: right - left, height: bottom - top };
    };

    // ---- Align and distribute (Phase 7) ----

    const hundredths = (value) => Math.round(value * 100) / 100;   // 1/100 px is plenty

    /*
     * New rects with each of `rects` lined up on `area` (the slide, or the
     * bounds of the selection): 'left' / 'center' / 'right' move them
     * sideways only, 'top' / 'middle' / 'bottom' up or down only. Sizes stay.
     */
    App.transform.alignRects = function alignRects(rects, how, area) {
        return rects.map((rect) => {
            const out = Object.assign({}, rect);
            if (how === 'left') {
                out.left = area.left;
            } else if (how === 'center') {
                out.left = hundredths(area.left + (area.width - rect.width) / 2);
            } else if (how === 'right') {
                out.left = area.left + area.width - rect.width;
            } else if (how === 'top') {
                out.top = area.top;
            } else if (how === 'middle') {
                out.top = hundredths(area.top + (area.height - rect.height) / 2);
            } else if (how === 'bottom') {
                out.top = area.top + area.height - rect.height;
            }
            return out;
        });
    };

    /*
     * New rects spread over `area` with equal gaps between them, as
     * PowerPoint's Distribute: 'horizontal' orders them by their left edge
     * (ties keep their order), the first starts at the area's left, the last
     * ends at its right. Pass the selection's bounds to keep the outer two
     * where they are, or the slide to spread them over it. One rect is centred.
     */
    App.transform.distributeRects = function distributeRects(rects, axis, area) {
        const start = axis === 'horizontal' ? 'left' : 'top';
        const size = axis === 'horizontal' ? 'width' : 'height';
        const out = rects.map((rect) => Object.assign({}, rect));
        if (out.length === 1) {
            out[0][start] = hundredths(area[start] + (area[size] - out[0][size]) / 2);
            return out;
        }
        const order = out.map((rect, index) => index).sort((a, b) => (out[a][start] - out[b][start]) || (a - b));
        const used = out.reduce((total, rect) => total + rect[size], 0);
        const gap = (area[size] - used) / (out.length - 1);
        let position = area[start];
        order.forEach((index) => {
            out[index][start] = hundredths(position);
            position += out[index][size] + gap;
        });
        return out;
    };

    // ---- Reading and writing elements (DOM, but no page state) ----

    App.transform.readRect = function readRect(element) {
        const style = element.style;
        const value = (text, fallback) => {
            const number = parseFloat(text);
            return Number.isFinite(number) ? number : fallback;
        };
        return {
            left: value(style.left, element.offsetLeft || 0),
            top: value(style.top, element.offsetTop || 0),
            width: value(style.width, element.offsetWidth || 0),
            height: value(style.height, element.offsetHeight || 0),
        };
    };

    App.transform.writeRect = function writeRect(element, rect) {
        element.style.left = rect.left + 'px';
        element.style.top = rect.top + 'px';
        element.style.width = rect.width + 'px';
        element.style.height = rect.height + 'px';
    };

    App.transform.zIndexOf = function zIndexOf(element) {
        const z = parseInt(element.style.zIndex, 10);
        return Number.isFinite(z) ? z : 0;
    };

    /*
     * The elements that can be selected on a slide: its direct .el children
     * (elements inside a group belong to the group; groups arrive in Phase 7),
     * sorted back to front: by z-index, then by their order in the slide.
     */
    App.transform.topLevelElements = function topLevelElements(slide) {
        const elements = Array.from(slide.children).filter((child) => child.classList.contains('el'));
        return elements
            .map((element, index) => ({ element: element, index: index, z: App.transform.zIndexOf(element) }))
            .sort((a, b) => (a.z - b.z) || (a.index - b.index))
            .map((entry) => entry.element);
    };
})();
