/*
 * shapes.js - the shape model (SPEC Phase 5).
 *
 *   <div class="el" data-type="shape" data-shape="chevron" data-id="e7" style="left; top; width; height; z-index">
 *     <svg class="shape-svg" width="100%" height="100%" aria-hidden="true" style="position: absolute; …; overflow: visible;">
 *       <path class="shape-fill" style="fill: var(--color-accent, #1F2A44); stroke: none;" d="M0 0H160L200 40…Z"></path>
 *     </svg>
 *   </div>
 *
 * The drawing is inline SVG worked out from the kind and the box's size
 * (geometry), in slide px: the SVG has no viewBox, so 1 unit = 1 px and a
 * resize never stretches outlines; render() draws it again at the new size.
 * The look lives in each path's inline style (fill, stroke, stroke-width,
 * stroke-dasharray, fill-opacity) and the shadow in the svg's filter, so the
 * saved deck needs no extra CSS and a redraw only changes the "d" of the
 * paths. lookOf / setLook read and change it (Shape Format, shapecontrols.js).
 *
 * Kinds: rect, roundRect, ellipse, chevron, pentagon, callout (filled boxes);
 * line and arrow (a stroke from one corner of the box to the other: data-flip
 * "x" / "y" / "xy" says which corners). Optional data-adjust holds the
 * yellow-handle value (Phase 5 step 8); without it the PowerPoint default is used.
 *
 * Older decks have shapes that are plain coloured boxes (no data-shape):
 * they stay as they are.
 *
 * Talks to: transform.js (the box), util.js (round2).
 */

(function () {
    'use strict';

    App.shapes = {};

    const SVG_NS = 'http://www.w3.org/2000/svg';
    const ACCENT = 'var(--color-accent, #1F2A44)';
    const SLIDE = { width: 1280, height: 720 };
    const LINE_WIDTH = 2;

    /* The gallery, in order: kind, name, size for a plain click. */
    App.shapes.KINDS = [
        { kind: 'rect', label: 'Rectangle', width: 160, height: 120 },
        { kind: 'roundRect', label: 'Rounded Rectangle', width: 160, height: 120 },
        { kind: 'ellipse', label: 'Oval', width: 160, height: 120 },
        { kind: 'line', label: 'Line', width: 200, height: 0 },
        { kind: 'arrow', label: 'Arrow', width: 200, height: 0 },
        { kind: 'chevron', label: 'Chevron', width: 200, height: 80 },
        { kind: 'pentagon', label: 'Pentagon', width: 200, height: 80 },
        { kind: 'callout', label: 'Callout', width: 160, height: 120 },
    ];

    // Adjustments as PowerPoint sets them for a new shape.
    const DEFAULT_ADJUST = {
        roundRect: 1 / 6,                 // corner radius, part of the shorter side
        chevron: 0.5,                     // depth of the point, part of the shorter side
        pentagon: 0.5,
        callout: [0.2083, 1.25],          // the tail's tip, as parts of the width and height
    };

    App.shapes.isLine = function isLine(kind) {
        return kind === 'line' || kind === 'arrow';
    };

    function kindOf(kind) {
        return App.shapes.KINDS.find((entry) => entry.kind === kind);
    }

    // ---------------------------------------------------------------
    // Drawing (pure)
    // ---------------------------------------------------------------

    /* A number for a path: at most two decimals, never "-0". */
    function n(value) {
        return String(App.util.round2(value) + 0);
    }

    function polygon(points) {
        return 'M' + points.map(([x, y], index) => (index === 0 ? '' : 'L') + n(x) + ' ' + n(y)).join('') + 'Z';
    }

    /* The box with a tail to `tip`, the tail's base on the side the tip is beyond. */
    function calloutPath(w, h, tip) {
        const [tx, ty] = [tip[0] * w, tip[1] * h];
        const below = ty - h;
        const above = -ty;
        const right = tx - w;
        const left = -tx;
        const most = Math.max(below, above, right, left);
        const a = (part) => n(part * w);
        const b = (part) => n(part * h);
        const tipText = n(tx) + ' ' + n(ty);
        if (most === above) {
            return 'M0 0H' + a(1 / 6) + 'L' + tipText + 'L' + a(1 / 3) + ' 0H' + n(w) + 'V' + n(h) + 'H0Z';
        }
        if (most === right) {
            return 'M0 0H' + n(w) + 'V' + b(1 / 6) + 'L' + tipText + 'L' + n(w) + ' ' + b(1 / 3) + 'V' + n(h) + 'H0Z';
        }
        if (most === left) {
            return 'M0 0H' + n(w) + 'V' + n(h) + 'H0V' + b(1 / 3) + 'L' + tipText + 'L0 ' + b(1 / 6) + 'Z';
        }
        return 'M0 0H' + n(w) + 'V' + n(h) + 'H' + a(1 / 3) + 'L' + tipText + 'L' + a(1 / 6) + ' ' + n(h) + 'H0Z';
    }

    /* Where a line or arrow starts and ends inside its w x h box. */
    function lineEnds(w, h, flip) {
        const flipX = (flip || '').indexOf('x') !== -1;
        const flipY = (flip || '').indexOf('y') !== -1;
        return { x1: flipX ? w : 0, y1: flipY ? h : 0, x2: flipX ? 0 : w, y2: flipY ? 0 : h };
    }

    /*
     * The paths of a kind of shape in a w x h box (slide px): [{ part, d }],
     * part 'fill' (a filled outline), 'line' (a stroke) or 'head' (an arrow's
     * point, filled with the line's colour). options: { adjust, flip, lineWidth }.
     */
    App.shapes.geometry = function geometry(kind, w, h, options) {
        const opts = options || {};
        const adjust = opts.adjust === undefined || opts.adjust === null ? DEFAULT_ADJUST[kind] : opts.adjust;
        const short = Math.min(w, h);
        switch (kind) {
            case 'rect':
                return [{ part: 'fill', d: 'M0 0H' + n(w) + 'V' + n(h) + 'H0Z' }];
            case 'roundRect': {
                const r = Math.min(adjust * short, short / 2);
                const arc = 'A' + n(r) + ' ' + n(r) + ' 0 0 1 ';
                return [{
                    part: 'fill',
                    d: 'M' + n(r) + ' 0H' + n(w - r) + arc + n(w) + ' ' + n(r) + 'V' + n(h - r) + arc + n(w - r) + ' ' + n(h) +
                        'H' + n(r) + arc + '0 ' + n(h - r) + 'V' + n(r) + arc + n(r) + ' 0Z',
                }];
            }
            case 'ellipse': {
                const arc = 'A' + n(w / 2) + ' ' + n(h / 2) + ' 0 1 1 ';
                return [{ part: 'fill', d: 'M0 ' + n(h / 2) + arc + n(w) + ' ' + n(h / 2) + arc + '0 ' + n(h / 2) + 'Z' }];
            }
            case 'chevron':
            case 'pentagon': {
                const depth = Math.min(adjust * short, w);
                const outline = 'M0 0H' + n(w - depth) + 'L' + n(w) + ' ' + n(h / 2) + 'L' + n(w - depth) + ' ' + n(h) + 'H0';
                return [{ part: 'fill', d: outline + (kind === 'chevron' ? 'L' + n(depth) + ' ' + n(h / 2) : '') + 'Z' }];
            }
            case 'callout':
                return [{ part: 'fill', d: calloutPath(w, h, adjust) }];
            case 'line':
            case 'arrow': {
                const ends = lineEnds(w, h, opts.flip);
                if (kind === 'line') {
                    return [{ part: 'line', d: 'M' + n(ends.x1) + ' ' + n(ends.y1) + 'L' + n(ends.x2) + ' ' + n(ends.y2) }];
                }
                const lineWidth = opts.lineWidth || LINE_WIDTH;
                const length = Math.hypot(ends.x2 - ends.x1, ends.y2 - ends.y1) || 1;
                const head = Math.min(3 * lineWidth + 6, length);
                const half = head * 0.45;
                const u = { x: (ends.x2 - ends.x1) / length, y: (ends.y2 - ends.y1) / length };
                const normal = { x: -u.y, y: u.x };
                const base = { x: ends.x2 - u.x * head, y: ends.y2 - u.y * head };
                // The line stops inside the head, so its square end never shows past the point.
                const stop = Math.max(head - lineWidth, 0);
                return [
                    { part: 'line', d: 'M' + n(ends.x1) + ' ' + n(ends.y1) + 'L' + n(ends.x2 - u.x * stop) + ' ' + n(ends.y2 - u.y * stop) },
                    { part: 'head', d: polygon([[ends.x2, ends.y2], [base.x + normal.x * half, base.y + normal.y * half],
                        [base.x - normal.x * half, base.y - normal.y * half]]) },
                ];
            }
            default:
                return [];
        }
    };

    // ---------------------------------------------------------------
    // Drawing a new shape with the mouse (pure)
    // ---------------------------------------------------------------

    function round2Rect(rect) {
        const round2 = App.util.round2;
        return { left: round2(rect.left), top: round2(rect.top), width: round2(rect.width), height: round2(rect.height) };
    }

    /*
     * A shape dragged from `start` to `end` (slide px): { rect, flip }. Shift:
     * boxes are square; lines snap to 0, 45 or 90 degrees (as long as the drag
     * along that direction).
     */
    App.shapes.drawnShape = function drawnShape(kind, start, end, shiftKey) {
        let dx = end.x - start.x;
        let dy = end.y - start.y;
        if (shiftKey && App.shapes.isLine(kind)) {
            const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
            const along = dx * Math.cos(angle) + dy * Math.sin(angle);
            dx = App.util.round2(along * Math.cos(angle));
            dy = App.util.round2(along * Math.sin(angle));
        } else if (shiftKey) {
            const side = Math.max(Math.abs(dx), Math.abs(dy));
            dx = dx < 0 ? -side : side;
            dy = dy < 0 ? -side : side;
        }
        const rect = round2Rect({ left: Math.min(start.x, start.x + dx), top: Math.min(start.y, start.y + dy),
            width: Math.abs(dx), height: Math.abs(dy) });
        const flip = App.shapes.isLine(kind) ? (dx < 0 ? 'x' : '') + (dy < 0 ? 'y' : '') : '';
        return { rect: rect, flip: flip };
    };

    /* A shape placed by a plain click: its default size, its corner at the click, inside the slide. */
    App.shapes.clickedShape = function clickedShape(kind, point) {
        const size = kindOf(kind);
        return {
            rect: round2Rect({
                left: Math.max(0, Math.min(point.x, SLIDE.width - size.width)),
                top: Math.max(0, Math.min(point.y, SLIDE.height - size.height)),
                width: size.width, height: size.height,
            }),
            flip: '',
        };
    };

    // ---------------------------------------------------------------
    // The shape element
    // ---------------------------------------------------------------

    const STYLES = {
        fill: 'fill: ' + ACCENT + '; stroke: none;',
        line: 'fill: none; stroke: ' + ACCENT + '; stroke-width: ' + LINE_WIDTH + 'px;',
        head: 'fill: ' + ACCENT + '; stroke: none;',
    };

    function optionsOf(element) {
        const adjustText = element.getAttribute('data-adjust');
        const line = element.querySelector('path.shape-line');
        const adjust = adjustText === null ? null
            : adjustText.indexOf(' ') !== -1 ? adjustText.split(' ').map(Number) : Number(adjustText);
        return {
            adjust: adjust, flip: element.getAttribute('data-flip') || '',
            lineWidth: line ? parseFloat(line.style.strokeWidth) || LINE_WIDTH : LINE_WIDTH,
        };
    }

    /* A new shape element (not yet on a slide) of `kind` at `rect`, with id `id`; flip for lines ('', 'x', 'y', 'xy'). */
    App.shapes.createShape = function createShape(doc, kind, rect, id, flip) {
        const element = doc.createElement('div');
        element.setAttribute('class', 'el');
        element.setAttribute('data-type', 'shape');
        element.setAttribute('data-shape', kind);
        element.setAttribute('data-id', id);
        if (flip) {
            element.setAttribute('data-flip', flip);
        }
        element.setAttribute('style', ['left', 'top', 'width', 'height'].map((side) => side + ': ' + rect[side] + 'px;').join(' '));
        const svg = doc.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('class', 'shape-svg');
        svg.setAttribute('width', '100%');
        svg.setAttribute('height', '100%');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('style', 'position: absolute; left: 0; top: 0; overflow: visible;');
        App.shapes.geometry(kind, rect.width, rect.height, { flip: flip }).forEach((part) => {
            const path = doc.createElementNS(SVG_NS, 'path');
            path.setAttribute('class', 'shape-' + part.part);
            path.setAttribute('style', STYLES[part.part]);
            path.setAttribute('d', part.d);
            svg.appendChild(path);
        });
        element.appendChild(svg);
        return element;
    };

    // ---------------------------------------------------------------
    // The look: fill, outline, dashes, transparency, shadow
    // ---------------------------------------------------------------

    const SHADOW = 'drop-shadow(3px 3px 4px rgba(0, 0, 0, 0.35))';
    // Dashes as multiples of the outline width, so a wider outline gets longer dashes (as in PowerPoint).
    const DASHES = { solid: null, dash: [4, 3], dot: [1, 1], dashDot: [4, 3, 1, 3] };

    /* A colour as stored: theme colours stay var(--…); rgb(…) as #rrggbb, as the colour lists name them. */
    function colorText(value) {
        const match = /^rgba?\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(value || '');
        if (!match) {
            return value || 'none';
        }
        return '#' + match.slice(1, 4).map((part) => Number(part).toString(16).padStart(2, '0')).join('');
    }

    function dashOf(path, width) {
        const numbers = (path.style.strokeDasharray || '').split(/[\s,]+/).filter(Boolean).map(parseFloat);
        if (numbers.length === 0 || !width) {
            return 'solid';
        }
        const ratios = numbers.map((value) => App.util.round2(value / width)).join(' ');
        return Object.keys(DASHES).find((kind) => DASHES[kind] && DASHES[kind].join(' ') === ratios) || 'solid';
    }

    /*
     * The look of a shape: { fill (null for lines), outline ('none' or a colour),
     * width (px), dash ('solid' | 'dash' | 'dot' | 'dashDot'), transparency
     * (0-100 %, of the fill; of the line for lines), shadow }.
     */
    App.shapes.lookOf = function lookOf(element) {
        const line = App.shapes.isLine(element.getAttribute('data-shape'));
        const path = element.querySelector('svg.shape-svg > path.shape-' + (line ? 'line' : 'fill'));
        const width = parseFloat(path.style.strokeWidth) || 0;
        const opacity = parseFloat(line ? path.style.strokeOpacity : path.style.fillOpacity);
        return {
            fill: line ? null : colorText(path.style.fill),
            outline: colorText(path.style.stroke),
            width: width,
            dash: dashOf(path, width),
            transparency: Number.isFinite(opacity) ? Math.round((1 - opacity) * 100) : 0,
            shadow: (element.querySelector('svg.shape-svg').style.filter || '').indexOf('drop-shadow') !== -1,
        };
    };

    /* Change some of a shape's look (fields as lookOf; a line ignores fill). An outline added to a shape without one is 2 px. */
    App.shapes.setLook = function setLook(element, changes) {
        const line = App.shapes.isLine(element.getAttribute('data-shape'));
        const look = App.shapes.lookOf(element);
        const svg = element.querySelector('svg.shape-svg');
        const path = svg.querySelector('path.shape-' + (line ? 'line' : 'fill'));
        const head = svg.querySelector('path.shape-head');
        if (!line && changes.fill !== undefined) {
            path.style.setProperty('fill', changes.fill);
        }
        if (changes.outline !== undefined) {
            path.style.setProperty('stroke', changes.outline);
            if (head) {
                head.style.setProperty('fill', changes.outline);
            }
        }
        let width = changes.width !== undefined ? changes.width : look.width;
        if (changes.outline !== undefined && changes.outline !== 'none' && !width) {
            width = LINE_WIDTH;
        }
        if (width) {
            path.style.setProperty('stroke-width', width + 'px');
        }
        const dash = DASHES[changes.dash !== undefined ? changes.dash : look.dash];
        if (dash && width) {
            path.style.setProperty('stroke-dasharray', dash.map((part) => App.util.round2(part * width)).join(' '));
        } else {
            path.style.removeProperty('stroke-dasharray');
        }
        if (changes.transparency !== undefined) {
            const opacity = changes.transparency > 0 ? String(App.util.round2(1 - changes.transparency / 100)) : null;
            [[path, line ? 'stroke-opacity' : 'fill-opacity'], [head, 'fill-opacity']].forEach(([target, property]) => {
                if (target && opacity) {
                    target.style.setProperty(property, opacity);
                } else if (target) {
                    target.style.removeProperty(property);
                }
            });
        }
        if (changes.shadow !== undefined) {
            if (changes.shadow) {
                svg.style.setProperty('filter', SHADOW);
            } else {
                svg.style.removeProperty('filter');
            }
        }
        App.shapes.render(element);   // an arrow's head follows the line's width
    };

    /* Draw a shape again for its box's size now (after a resize); its look is kept. Older shapes are left alone. */
    App.shapes.render = function render(element) {
        const kind = element.getAttribute('data-shape');
        if (!kind || element.getAttribute('data-type') !== 'shape') {
            return;
        }
        const rect = App.transform.readRect(element);
        const parts = App.shapes.geometry(kind, rect.width, rect.height, optionsOf(element));
        parts.forEach((part) => {
            const path = element.querySelector('svg.shape-svg > path.shape-' + part.part);
            if (path) {
                path.setAttribute('d', part.d);
            }
        });
    };
})();
