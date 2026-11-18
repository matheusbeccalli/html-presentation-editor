/*
 * snap.js - smart guides and snapping while dragging (SPEC Phase 7).
 *
 * While an element is moved or resized, its edges and centre are pulled onto
 * the slide's edges and centre lines and onto the edges and centres of the
 * other elements on the slide when they come within 5 screen pixels. A red
 * line (a "smart guide") shows every line the element then sits on. Holding
 * Alt while dragging turns snapping (and the guides) off. Resizing with the
 * aspect ratio kept (Shift, a picture's corner) does not snap.
 *
 * The maths at the top is pure (tests/unit/snap.test.js); the guides are
 * drawn in the overlay (#overlay), so they are never part of the deck.
 *
 * A target line: { at, from, to }: x = at (or y = at) from `from` to `to`
 * on the other axis (where the guide is drawn).
 *
 * Talks to: transform.js (the slide's elements), selection.js (calls it during a drag).
 */

(function () {
    'use strict';

    App.snap = {};

    const SCREEN_THRESHOLD = 5;   // screen pixels, as the spec says; more slide pixels when zoomed out
    const SAME = 0.5;             // a box "sits on" a line closer than this

    // ---------------------------------------------------------------
    // Pure helpers
    // ---------------------------------------------------------------

    App.snap.threshold = function threshold(zoom) {
        return SCREEN_THRESHOLD / zoom;
    };

    /* The lines a box can snap to: the slide's edges and centre lines, then each of `rects`' edges and centre. */
    App.snap.targetsOf = function targetsOf(rects, slide) {
        const x = [0, slide.width / 2, slide.width].map((at) => ({ at: at, from: 0, to: slide.height }));
        const y = [0, slide.height / 2, slide.height].map((at) => ({ at: at, from: 0, to: slide.width }));
        rects.forEach((r) => {
            [r.left, r.left + r.width / 2, r.left + r.width].forEach((at) => x.push({ at: at, from: r.top, to: r.top + r.height }));
            [r.top, r.top + r.height / 2, r.top + r.height].forEach((at) => y.push({ at: at, from: r.left, to: r.left + r.width }));
        });
        return { x: x, y: y };
    };

    /* The smallest shift (within `limit`) that puts one of `values` on one of `lines`; 0 if none is near. */
    function nearestShift(values, lines, limit) {
        let best = null;
        values.forEach((value) => {
            lines.forEach((line) => {
                const shift = line.at - value;
                if (Math.abs(shift) <= limit && (best === null || Math.abs(shift) < Math.abs(best))) {
                    best = shift;
                }
            });
        });
        return best === null ? 0 : best;
    }

    /* A guide for each line one of `values` sits on, long enough to reach the box (from..to on the other axis). */
    function guidesOn(axis, values, lines, from, to) {
        const byPlace = new Map();
        lines.forEach((line) => {
            if (!values.some((value) => Math.abs(value - line.at) < SAME)) {
                return;
            }
            const guide = byPlace.get(line.at) || { axis: axis, at: line.at, from: from, to: to };
            guide.from = Math.min(guide.from, line.from);
            guide.to = Math.max(guide.to, line.to);
            byPlace.set(line.at, guide);
        });
        return Array.from(byPlace.values());
    }

    const xsOf = (r) => [r.left, r.left + r.width / 2, r.left + r.width];
    const ysOf = (r) => [r.top, r.top + r.height / 2, r.top + r.height];

    /*
     * A box being moved (the bounds of everything moved): how far to shift it
     * so its nearest edge or centre lands on a line, and the guides to draw.
     */
    App.snap.snapMove = function snapMove(rect, targets, limit) {
        const dx = nearestShift(xsOf(rect), targets.x, limit);
        const dy = nearestShift(ysOf(rect), targets.y, limit);
        const moved = { left: rect.left + dx, top: rect.top + dy, width: rect.width, height: rect.height };
        const guides = guidesOn('x', xsOf(moved), targets.x, moved.top, moved.top + moved.height)
            .concat(guidesOn('y', ysOf(moved), targets.y, moved.left, moved.left + moved.width));
        return { dx: dx, dy: dy, guides: guides };
    };

    /* A box being resized by `handle` ('n', 'se' ...): only the dragged edges snap; the others stay. */
    App.snap.snapResize = function snapResize(rect, handle, targets, limit) {
        let left = rect.left;
        let top = rect.top;
        let right = rect.left + rect.width;
        let bottom = rect.top + rect.height;
        const moving = { x: [], y: [] };
        if (handle.indexOf('w') !== -1) {
            left += nearestShift([left], targets.x, limit);
            moving.x.push(left);
        }
        if (handle.indexOf('e') !== -1) {
            right += nearestShift([right], targets.x, limit);
            moving.x.push(right);
        }
        if (handle.indexOf('n') !== -1) {
            top += nearestShift([top], targets.y, limit);
            moving.y.push(top);
        }
        if (handle.indexOf('s') !== -1) {
            bottom += nearestShift([bottom], targets.y, limit);
            moving.y.push(bottom);
        }
        if (right - left < App.transform.MIN_SIZE || bottom - top < App.transform.MIN_SIZE) {
            return { rect: rect, guides: [] };   // snapping would make it too small: leave it
        }
        const out = { left: left, top: top, width: right - left, height: bottom - top };
        const guides = guidesOn('x', moving.x, targets.x, top, bottom).concat(guidesOn('y', moving.y, targets.y, left, right));
        return { rect: out, guides: guides };
    };

    // ---------------------------------------------------------------
    // On the page
    // ---------------------------------------------------------------

    /* The targets on `slide` for a drag of `moving` (the elements being dragged do not attract themselves). */
    App.snap.targetsFor = function targetsFor(slide, moving) {
        const others = App.elements.pickableElements(slide).filter((element) => moving.indexOf(element) === -1);   // not hidden ones
        // A turned element is lined up by the upright box round what shows.
        const shown = others.map((element) => App.transform.visualRect(App.transform.readRect(element), App.transform.rotationOf(element)));
        return App.snap.targetsOf(shown, { width: 1280, height: 720 });
    };

    let layer = null;

    /* Draw `guides` in the overlay (none: hide them). */
    App.snap.showGuides = function showGuides(guides) {
        const overlay = document.getElementById('overlay');
        if (!layer || !layer.isConnected) {
            layer = App.util.el('div', { class: 'smart-guides' });
            overlay.appendChild(layer);
        }
        layer.innerHTML = '';
        guides.forEach((guide) => {
            const line = App.util.el('div', { class: 'smart-guide ' + (guide.axis === 'x' ? 'vertical' : 'horizontal') });
            if (guide.axis === 'x') {
                Object.assign(line.style, { left: guide.at + 'px', top: guide.from + 'px', height: (guide.to - guide.from) + 'px' });
            } else {
                Object.assign(line.style, { top: guide.at + 'px', left: guide.from + 'px', width: (guide.to - guide.from) + 'px' });
            }
            layer.appendChild(line);
        });
    };

    App.snap.hideGuides = function hideGuides() {
        if (layer) {
            layer.innerHTML = '';
        }
    };
})();
