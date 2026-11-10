/*
 * rulers.js - optional gridlines and rulers (SPEC Phase 7), switched on and
 * off on the View tab (Shift+F9: gridlines, as in PowerPoint). The choice is
 * remembered in the settings (settings.js), like PowerPoint does.
 *
 * Gridlines: thin lines every 40 slide px (32 across, 18 down) drawn in the
 * overlay, above the slide but under the selection; they are only a guide
 * for the eye: nothing snaps to them.
 * Rulers: one above and one left of the slide, in slide pixels from the top
 * left corner (the same numbers as the Format pane's X and Y), with the
 * selected element(s) shaded on them.
 *
 * Neither is ever part of the deck: they live in the editor page.
 *
 * Talks to: settings.js, canvas.js (zoom), selection.js (what is selected).
 */

(function () {
    'use strict';

    App.rulers = {};

    App.rulers.GRID = 40;          // slide px between gridlines
    const STEP = 10;               // slide px between ruler marks
    const MIN_GAP = 5;             // screen px: closer marks are left out
    const RULER = 18;              // screen px: the ruler's thickness
    const SIZES = { big: 8, half: 5, small: 3 };

    // ---------------------------------------------------------------
    // Pure helper (tests/unit/rulers.test.js)
    // ---------------------------------------------------------------

    /* The marks along a ruler `length` slide px long at `zoom`: { at, size: 'big' | 'half' | 'small', label }. */
    App.rulers.marks = function marks(length, zoom) {
        const out = [];
        const small = STEP * zoom >= MIN_GAP;
        for (let at = 0; at <= length; at += STEP) {
            const size = at % 100 === 0 ? 'big' : at % 50 === 0 ? 'half' : 'small';
            if (size === 'small' && !small) {
                continue;
            }
            out.push({ at: at, size: size, label: size === 'big' ? String(at) : null });
        }
        return out;
    };

    // ---------------------------------------------------------------
    // On the page
    // ---------------------------------------------------------------

    let grid = null;
    let top = null;
    let left = null;

    App.rulers.init = function init() {
        const el = App.util.el;
        grid = el('div', { class: 'gridlines', hidden: '' });
        const overlay = document.getElementById('overlay');
        overlay.insertBefore(grid, overlay.firstChild);   // under the selection
        top = el('div', { class: 'ruler ruler-top', hidden: '', 'aria-hidden': 'true' });
        left = el('div', { class: 'ruler ruler-left', hidden: '', 'aria-hidden': 'true' });
        const box = document.getElementById('canvas-stage-box');
        box.appendChild(top);
        box.appendChild(left);
        ['deck-loaded', 'settings-changed', 'zoom-changed', 'selection-changed', 'selection-dragged', 'history-changed']
            .forEach((name) => App.events.on(name, App.rulers.refresh));
        App.rulers.refresh();
    };

    App.rulers.toggle = function toggle(name) {
        const patch = {};
        patch[name] = !App.settings.get()[name];
        App.settings.update(patch);   // settings-changed redraws
        App.ribbon.refresh();
    };

    /* One ruler as SVG: marks and numbers along `length` slide px; `range` (slide px) shaded. */
    function drawRuler(target, length, zoom, horizontal, range) {
        const size = Math.floor(length * zoom);
        const parts = [];
        if (range) {
            const from = range[0] * zoom;
            const span = (range[1] - range[0]) * zoom;
            parts.push(horizontal
                ? '<rect class="ruler-range" x="' + from + '" y="0" width="' + span + '" height="' + RULER + '"/>'
                : '<rect class="ruler-range" x="0" y="' + from + '" width="' + RULER + '" height="' + span + '"/>');
        }
        App.rulers.marks(length, zoom).forEach((mark) => {
            const at = Math.round(mark.at * zoom) + 0.5;
            const tick = SIZES[mark.size];
            parts.push(horizontal
                ? '<line x1="' + at + '" y1="' + (RULER - tick) + '" x2="' + at + '" y2="' + RULER + '"/>'
                : '<line x1="' + (RULER - tick) + '" y1="' + at + '" x2="' + RULER + '" y2="' + at + '"/>');
            if (mark.label !== null && mark.at < length) {
                parts.push(horizontal
                    ? '<text x="' + (at + 2) + '" y="9">' + mark.label + '</text>'
                    : '<text x="9" y="' + (at + 2) + '" transform="rotate(-90 9 ' + (at + 2) + ')" text-anchor="end">' + mark.label + '</text>');
            }
        });
        const width = horizontal ? size : RULER;
        const height = horizontal ? RULER : size;
        target.innerHTML = '<svg width="' + width + '" height="' + height + '">' + parts.join('') + '</svg>';
    }

    App.rulers.refresh = function refresh() {
        if (!grid) {
            return;
        }
        const settings = App.settings.get();
        const shown = App.state.hasDeck;
        grid.hidden = !(shown && settings.showGridlines);
        top.hidden = left.hidden = !(shown && settings.showRulers);
        if (top.hidden) {
            return;
        }
        const zoom = App.canvas.getZoom();
        const elements = App.selection.getElements();
        const bounds = elements.length ? App.transform.boundsOf(elements.map(App.transform.readRect)) : null;
        drawRuler(top, 1280, zoom, true, bounds && [bounds.left, bounds.left + bounds.width]);
        drawRuler(left, 720, zoom, false, bounds && [bounds.top, bounds.top + bounds.height]);
    };
})();
