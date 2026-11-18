/*
 * pptx.js - Export > PowerPoint (Phase 8, SPEC 7.4), with the vendored PptxGenJS.
 *
 * The deck becomes a .pptx of 13.333 × 7.5 in (one slide px = 1/96 in; text px
 * × 0.75 = points). Each slide is read as it shows in the editor (the browser's
 * computed styles, with the slide shown for a moment: deck.withSlideShown), its
 * elements in stacking order, and each becomes a PowerPoint object:
 *
 *   text box           → a native text box: runs (bold, italic, underline, size,
 *                         colour, font), bullets and numbering with their levels,
 *                         alignment, spacing (read through text.exportParagraphs:
 *                         text.js stays the only door to the text model)
 *   speaker notes      → PowerPoint's speaker notes
 *   hidden slide       → a hidden slide (decided in the Phase 8 Q&A)
 *   anything else      → a picture of exactly that element, drawn by the browser
 *                         (snapshot.js), listed in the report afterwards
 *
 * Pictures, shapes, tables, charts and the slide master become native objects in
 * the next steps; until then they come across as pictures, so the file always
 * looks like the deck.
 *
 * The pure parts (inches, points, colorOf, fontFace, rotationOf, textRuns) are
 * tested in pptx.test.js; a whole export is read back from its zip in e2e_test.py.
 *
 * Talks to: text.js (exportParagraphs, autofitOf), deck.js, notes.js, slides.js
 * (hidden), snapshot.js (pictures), serialize.js, fileio.js (download), dialogs.js
 * (the report), commands.js (exportPptx).
 */

(function () {
    'use strict';

    App.pptx = {};

    const SLIDE_WIDTH = 1280;
    const SLIDE_HEIGHT = 720;
    const PICTURE_SCALE = 2;   // pictures of elements at 2×, as PNG export

    /* ---------- Pure conversions ---------- */

    function round(value, places) {
        const factor = Math.pow(10, places);
        return Math.round(value * factor) / factor;
    }

    /* Slide px → inches (96 px = 1 in). */
    App.pptx.inches = function inches(px) {
        return round(px / 96, 6);   // 6 places: 1280 px is exactly the 12 192 000 EMU PowerPoint writes
    };

    /* CSS px → points (1 px = 0.75 pt). */
    App.pptx.points = function points(px) {
        return round(px * 0.75, 2);
    };

    function hex2(value) {
        return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0').toUpperCase();
    }

    /*
     * A computed CSS colour → { hex: 'CC092F', transparency: 0-100 } as PptxGenJS wants it,
     * or null when nothing shows (transparent). Reads rgb(), rgba(), #hex and the
     * color(srgb r g b / a) that colour mixes compute to.
     */
    App.pptx.colorOf = function colorOf(css) {
        const text = String(css || '').trim().toLowerCase();
        let rgb = null;
        let alpha = 1;
        let match = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(text);
        if (match) {
            rgb = [match[1], match[2], match[3]].map(Number);
            alpha = match[4] === undefined ? 1 : parseFloat(match[4]) / (match[4].endsWith('%') ? 100 : 1);
        } else if ((match = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)$/.exec(text))) {
            rgb = [match[1], match[2], match[3]].map((part) => Number(part) * 255);
            alpha = match[4] === undefined ? 1 : parseFloat(match[4]);
        } else if ((match = /^#([0-9a-f]{6})$/.exec(text))) {
            rgb = [0, 2, 4].map((i) => parseInt(match[1].slice(i, i + 2), 16));
        } else if ((match = /^#([0-9a-f]{3})$/.exec(text))) {
            rgb = [0, 1, 2].map((i) => parseInt(match[1][i] + match[1][i], 16));
        }
        if (!rgb || alpha <= 0) {
            return null;
        }
        return { hex: rgb.map(hex2).join(''), transparency: Math.round((1 - alpha) * 100) };
    };

    /* The first font of a CSS font list, without quotes: '"Segoe UI", Arial' → 'Segoe UI'. */
    App.pptx.fontFace = function fontFace(cssFamily) {
        const first = String(cssFamily || '').split(',')[0].trim();
        return first.replace(/^["']|["']$/g, '') || 'Calibri';
    };

    /* The turn in an element's transform ('rotate(-90deg)'), as PowerPoint writes it: 0-359°. */
    App.pptx.rotationOf = function rotationOf(transform) {
        const match = /rotate\(\s*(-?[\d.]+)deg\s*\)/.exec(String(transform || ''));
        if (!match) {
            return 0;
        }
        return ((Math.round(parseFloat(match[1])) % 360) + 360) % 360;
    };

    // The deck's list numbering (CSS list-style names) → PowerPoint's auto-number schemes.
    const NUMBER_SCHEMES = {
        decimal: 'arabicPeriod', 'lower-alpha': 'alphaLcPeriod', 'upper-alpha': 'alphaUcPeriod',
        'lower-latin': 'alphaLcPeriod', 'upper-latin': 'alphaUcPeriod',
        'lower-roman': 'romanLcPeriod', 'upper-roman': 'romanUcPeriod',
    };
    const DEFAULT_SCHEMES = { 1: 'arabicPeriod', 2: 'alphaLcPeriod', 3: 'romanLcPeriod', 4: 'arabicPeriod', 5: 'alphaLcPeriod' };

    App.pptx.numberScheme = function numberScheme(cssName) {
        return NUMBER_SCHEMES[String(cssName || '').trim()] || null;
    };

    function runOptions(look) {
        const options = {
            fontFace: App.pptx.fontFace(look.fontFamily),
            fontSize: App.pptx.points(look.fontSize),
            bold: !!look.bold,
            italic: !!look.italic,
        };
        const color = App.pptx.colorOf(look.color);
        if (color) {
            options.color = color.hex;
            if (color.transparency) {
                options.transparency = color.transparency;
            }
        }
        if (look.underline) {
            options.underline = { style: 'sng' };
        }
        if (look.strike) {
            options.strike = 'sngStrike';
        }
        if (look.superscript) {
            options.superscript = true;
        }
        if (look.subscript) {
            options.subscript = true;
        }
        const highlight = App.pptx.colorOf(look.highlight);
        if (highlight) {
            options.highlight = highlight.hex;
        }
        if (look.letterSpacing) {
            options.charSpacing = App.pptx.points(look.letterSpacing);
        }
        return options;
    }

    function paragraphOptions(paragraph, schemes) {
        const options = { align: ['left', 'center', 'right', 'justify'].includes(paragraph.align) ? paragraph.align : 'left' };
        options.indentLevel = Math.max(0, paragraph.level - 1);
        if (paragraph.spaceBefore) {
            options.paraSpaceBefore = App.pptx.points(paragraph.spaceBefore);
        }
        if (paragraph.spaceAfter) {
            options.paraSpaceAfter = App.pptx.points(paragraph.spaceAfter);
        }
        if (paragraph.lineHeight && paragraph.fontSize) {
            // PowerPoint's "single" spacing is 1.2 × the font size.
            options.lineSpacingMultiple = round(paragraph.lineHeight / (paragraph.fontSize * 1.2), 2);
        }
        // PptxGenJS puts a level-N line's text at N × the bullet's indent: share the deck's indent that way.
        const indent = paragraph.indent ? App.pptx.points(paragraph.indent / paragraph.level) : undefined;
        if (paragraph.list === 'bullet') {
            const code = (paragraph.marker || '•').codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
            options.bullet = indent ? { code: code, indent: indent } : { code: code };
        } else if (paragraph.list === 'number') {
            options.bullet = {
                type: 'number',
                style: schemes[paragraph.level] || DEFAULT_SCHEMES[paragraph.level] || 'arabicPeriod',
                // Each numbered line starts at the number it shows, so PowerPoint numbers it the same.
                startAt: paragraph.number || 1,
            };
            if (indent) {
                options.bullet.indent = indent;
            }
        } else {
            options.bullet = false;
        }
        return options;
    }

    /*
     * Paragraphs (text.exportParagraphs) → PptxGenJS text runs [{ text, options }].
     * Every run of a paragraph carries the paragraph's options; the last run of each
     * paragraph but the last ends it (breakLine); a <br> is a soft break.
     * schemes: { level: PowerPoint numbering scheme } as the deck sets them.
     */
    App.pptx.textRuns = function textRuns(paragraphs, schemes) {
        const runs = [];
        paragraphs.forEach((paragraph, index) => {
            const shared = paragraphOptions(paragraph, schemes || {});
            const pieces = paragraph.runs.length > 0 ? paragraph.runs :
                [{ text: '', breakBefore: false, look: paragraph.emptyLook || {} }];
            pieces.forEach((piece, i) => {
                const options = Object.assign(runOptions(piece.look), shared);
                if (piece.breakBefore) {
                    options.softBreakBefore = true;
                }
                if (i === pieces.length - 1 && index < paragraphs.length - 1) {
                    options.breakLine = true;
                }
                runs.push({ text: piece.look && piece.look.uppercase ? piece.text.toUpperCase() : piece.text, options: options });
            });
        });
        return runs;
    };

    /* The box a turned element covers (its corners after turning), for a picture of it. */
    App.pptx.outerBox = function outerBox(box, degrees) {
        if (!degrees) {
            return box;
        }
        const radians = degrees * Math.PI / 180;
        const cos = Math.abs(Math.cos(radians));
        const sin = Math.abs(Math.sin(radians));
        const width = box.width * cos + box.height * sin;
        const height = box.width * sin + box.height * cos;
        return {
            left: box.left + box.width / 2 - width / 2, top: box.top + box.height / 2 - height / 2,
            width: width, height: height,
        };
    };

    /* ---------- Reading a slide ---------- */

    // What each kind of element is called in the report.
    const KIND_NAMES = {
        image: 'a picture', table: 'a table', chart: 'a chart', shape: 'a shape', group: 'a group',
        text: 'a text box', master: 'the slide master', element: 'an element',
    };

    // The editor's shapes → PowerPoint's preset shapes.
    const SHAPES = {
        rect: 'rect', roundRect: 'roundRect', ellipse: 'ellipse', chevron: 'chevron', pentagon: 'homePlate',
        callout: 'wedgeRectCallout', line: 'line', arrow: 'line',
    };
    const DASH_TYPES = { solid: 'solid', dash: 'dash', dot: 'sysDot', dashDot: 'dashDot' };

    function boxOf(element, offset) {
        const style = element.style;
        return {
            left: (parseFloat(style.left) || 0) + (offset ? offset.left : 0),
            top: (parseFloat(style.top) || 0) + (offset ? offset.top : 0),
            width: parseFloat(style.width) || element.offsetWidth || 0,
            height: parseFloat(style.height) || element.offsetHeight || 0,
        };
    }

    function position(box, rotation, keepFlat) {
        const place = {
            x: App.pptx.inches(box.left), y: App.pptx.inches(box.top),
            w: App.pptx.inches(Math.max(keepFlat ? 0 : 1, box.width)), h: App.pptx.inches(Math.max(keepFlat ? 0 : 1, box.height)),
        };
        if (rotation) {
            place.rotate = rotation;
        }
        return place;
    }

    // An element's (or the slide's) own parts in stacking order (z-index, then their order).
    function partsOf(parent, view) {
        const parts = Array.from(parent.children).filter((child) =>
            !child.hasAttribute('data-editor-only') &&
            (child.classList.contains('el') || child.classList.contains('master-layer')));
        return parts
            .map((part, order) => ({ part: part, order: order, z: parseInt(view.getComputedStyle(part).zIndex, 10) || 0 }))
            .sort((a, b) => a.z - b.z || a.order - b.order)
            .map((entry) => entry.part);
    }

    function schemesOf(view, doc) {
        const root = view.getComputedStyle(doc.documentElement);
        const schemes = {};
        for (let level = 1; level <= 5; level++) {
            const scheme = App.pptx.numberScheme(root.getPropertyValue('--list-' + level + '-number'));
            if (scheme) {
                schemes[level] = scheme;
            }
        }
        return schemes;
    }

    function fillOf(css) {
        const color = App.pptx.colorOf(css);
        return color ? { color: color.hex, transparency: color.transparency } : null;
    }

    function textBoxItem(element, offset, ctx) {
        const style = ctx.view.getComputedStyle(element);
        const options = Object.assign(position(boxOf(element, offset), App.pptx.rotationOf(element.style.transform)), {
            margin: ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'].map((side) =>
                App.pptx.points(parseFloat(style[side]) || 0)),
            valign: 'top',
            wrap: true,
            fit: App.text.autofitOf(element) === 'shrink' ? 'shrink' : 'none',
            isTextBox: true,
        });
        const fill = fillOf(style.backgroundColor);
        if (fill) {
            options.fill = fill;
        }
        const borderWidth = parseFloat(style.borderTopWidth) || 0;
        const border = borderWidth && style.borderTopStyle !== 'none' ? App.pptx.colorOf(style.borderTopColor) : null;
        if (border) {
            options.line = { color: border.hex, width: App.pptx.points(borderWidth) };
        }
        return { kind: 'text', runs: App.pptx.textRuns(App.text.exportParagraphs(element), ctx.schemes), options: options };
    }

    // A picture: native when PowerPoint reads its format (PNG, JPEG, GIF); else a picture of how it shows.
    function imageItem(element, offset, ctx) {
        const source = element.getAttribute('src') || '';
        const match = /^data:(image\/(?:png|jpeg|jpg|gif));base64,/i.exec(source);
        if (!match) {
            return pictureItem(element, offset, ctx, 'a picture (SVG or another format) came across as a PNG');
        }
        const options = Object.assign({ data: source.slice(5) }, position(boxOf(element, offset), App.pptx.rotationOf(element.style.transform)));
        const flip = element.getAttribute('data-flip') || '';   // Flip (Phase 10): PowerPoint's own flip
        if (flip.indexOf('x') !== -1) {
            options.flipH = true;
        }
        if (flip.indexOf('y') !== -1) {
            options.flipV = true;
        }
        const opacity = parseFloat(ctx.view.getComputedStyle(element).opacity);
        if (opacity < 1) {
            options.transparency = Math.round((1 - opacity) * 100);
        }
        return { kind: 'image', options: options };
    }

    // A shape drawn by the editor (data-shape), with its text if it has any; an older plain box as a rectangle.
    function shapeItem(element, offset, ctx) {
        const view = ctx.view;
        const kind = element.getAttribute('data-shape');
        const box = boxOf(element, offset);
        const rotation = App.pptx.rotationOf(element.style.transform);
        if (!kind) {
            const style = view.getComputedStyle(element);
            if (style.backgroundImage && style.backgroundImage !== 'none') {
                return pictureItem(element, offset, ctx, 'a shape with a gradient or picture fill came across as a picture');
            }
            const options = Object.assign(position(box, rotation), { fill: fillOf(style.backgroundColor) || { type: 'none' } });
            const width = parseFloat(style.borderTopWidth) || 0;
            const border = width && style.borderTopStyle !== 'none' ? App.pptx.colorOf(style.borderTopColor) : null;
            if (border) {
                options.line = { color: border.hex, width: App.pptx.points(width) };
            }
            const radius = parseFloat(style.borderTopLeftRadius) || 0;
            if (radius) {
                options.rectRadius = App.pptx.inches(radius);
            }
            return { kind: 'shape', shape: radius ? 'roundRect' : 'rect', options: options };
        }
        if (!SHAPES[kind]) {
            return pictureItem(element, offset, ctx);
        }
        const look = App.shapes.lookOf(element);
        const line = App.shapes.isLine(kind);
        const path = element.querySelector('svg.shape-svg > path.shape-' + (line ? 'line' : 'fill'));
        const pathStyle = view.getComputedStyle(path);
        const options = position(box, rotation, line);
        if (!line) {
            const fill = fillOf(pathStyle.fill);
            options.fill = fill ? { color: fill.color, transparency: look.transparency } : { type: 'none' };
        }
        const stroke = App.pptx.colorOf(pathStyle.stroke);
        if (stroke && look.width) {
            options.line = { color: stroke.hex, width: App.pptx.points(look.width), dashType: DASH_TYPES[look.dash] || 'solid' };
            if (line && look.transparency) {
                options.line.transparency = look.transparency;
            }
            if (kind === 'arrow') {
                options.line.endArrowType = 'triangle';
            }
        }
        const flip = element.getAttribute('data-flip') || '';
        if (flip.indexOf('x') !== -1) {
            options.flipH = true;
        }
        if (flip.indexOf('y') !== -1) {
            options.flipV = true;
        }
        if (look.shadow) {
            options.shadow = { type: 'outer', blur: 3, offset: 3.2, angle: 45, color: '000000', opacity: 0.35 };
        }
        const adjust = App.shapes.adjustOf(element);
        if (kind === 'roundRect' && typeof adjust === 'number') {
            options.rectRadius = App.pptx.inches(adjust * Math.min(box.width, box.height));
        } else if (kind === 'callout') {
            // PptxGenJS cannot place the tail; PowerPoint's own default tip sits a little differently.
            ctx.report.push("a callout's tail points where PowerPoint puts it by default (drag its yellow handle there)");
        } else if (element.hasAttribute('data-adjust')) {
            ctx.report.push('a ' + kind + "'s point came across as PowerPoint's default (drag its yellow handle there)");
        }
        const area = App.shapes.textOf(element);
        const paragraphs = area ? App.text.exportParagraphs(area) : [];
        const hasText = paragraphs.some((paragraph) => paragraph.runs.some((run) => run.text.trim()));
        if (!hasText) {
            return { kind: 'shape', shape: SHAPES[kind], options: options };
        }
        if (options.flipV) {
            // PowerPoint turns a shape's text over with the shape; the editor keeps it upright.
            ctx.report.push('a shape flipped upside down shows its text upside down in PowerPoint');
        }
        const areaStyle = view.getComputedStyle(area);
        const valign = { center: 'middle', 'flex-end': 'bottom', end: 'bottom' }[areaStyle.justifyContent] || 'top';
        Object.assign(options, {
            shape: SHAPES[kind], valign: valign, wrap: true,
            margin: ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'].map((side) =>
                App.pptx.points(parseFloat(areaStyle[side]) || 0)),
        });
        return { kind: 'text', runs: App.pptx.textRuns(paragraphs, ctx.schemes), options: options };
    }

    // A cell border side as PptxGenJS wants it ({ type, pt, color }); 'none' when nothing shows.
    function borderOf(style, side) {
        const width = parseFloat(style['border' + side + 'Width']) || 0;
        const kind = style['border' + side + 'Style'];
        const color = App.pptx.colorOf(style['border' + side + 'Color']);
        if (!width || !color || kind === 'none' || kind === 'hidden') {
            return { type: 'none' };
        }
        return { type: kind === 'dashed' || kind === 'dotted' ? 'dash' : 'solid', pt: App.pptx.points(width), color: color.hex };
    }

    /*
     * A table → PowerPoint's own table: the column widths and row heights it shows, each
     * cell's fill, borders, padding, alignment and rich text (through text.exportParagraphs),
     * merged cells as merged cells.
     */
    function tableItem(element, offset, ctx) {
        const view = ctx.view;
        const table = element.querySelector(':scope > table');
        if (!table || App.pptx.rotationOf(element.style.transform)) {
            return pictureItem(element, offset, ctx, table ? 'a turned table came across as a picture' : null);
        }
        const box = boxOf(element, offset);
        const rows = Array.from(table.querySelectorAll(':scope > tbody > tr'));
        const columns = Array.from(table.querySelectorAll(':scope > colgroup > col'));
        const widths = columns.length ? columns.map((col) => parseFloat(view.getComputedStyle(col).width) || 0) : [];
        const tableWidth = widths.reduce((sum, width) => sum + width, 0);
        const scale = tableWidth > 0 ? box.width / tableWidth : 1;   // the colgroup in the box's width
        const data = rows.map((row) => Array.from(row.children).filter((cell) => cell.tagName.toLowerCase() === 'td').map((cell) => {
            const style = view.getComputedStyle(cell);
            const options = {
                valign: { middle: 'middle', bottom: 'bottom' }[style.verticalAlign] || 'top',
                margin: ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'].map((side) =>
                    App.pptx.points(parseFloat(style[side]) || 0)),
                border: ['Top', 'Right', 'Bottom', 'Left'].map((side) => borderOf(style, side)),
            };
            const fill = fillOf(style.backgroundColor);
            options.fill = fill || { type: 'none' };
            const colspan = parseInt(cell.getAttribute('colspan'), 10) || 1;
            const rowspan = parseInt(cell.getAttribute('rowspan'), 10) || 1;
            if (colspan > 1) {
                options.colspan = colspan;
            }
            if (rowspan > 1) {
                options.rowspan = rowspan;
            }
            return { text: App.pptx.textRuns(App.text.exportParagraphs(cell), ctx.schemes), options: options };
        }));
        const options = Object.assign(position(box, 0), {
            rowH: rows.map((row) => App.pptx.inches(row.offsetHeight)),   // as laid out (zoom never changes it)
            autoPage: false,
        });
        if (widths.length && tableWidth > 0) {
            options.colW = widths.map((width) => App.pptx.inches(width * scale));
        }
        return { kind: 'table', rows: data, options: options };
    }

    /* ---------- Charts ---------- */

    /*
     * An Excel number format for a chart's numbers (PowerPoint shows its separators the
     * way Windows is set up, so 1.234,5 on a Brazilian PC): decimals, %, (negatives in
     * parentheses), units such as " mn".
     */
    App.pptx.numberFormat = function numberFormat(options) {
        const decimals = Math.max(0, Math.min(6, options.decimals || 0));
        let format = '#,##0' + (decimals ? '.' + '0'.repeat(decimals) : '') + (options.percent ? '%' : '');
        if (options.units && !options.percent) {
            format += '"' + String(options.units).replace(/"/g, '') + '"';
        }
        return options.parens ? format + ';(' + format + ')' : format;
    };

    /*
     * A waterfall as PowerPoint can keep it editable (SPEC 7.4): stacked columns, the first
     * series an invisible base under each floating bar, then totals, increases and decreases
     * (each category has a value in one of them). null when the bridge goes below zero: a
     * stacked base cannot float a bar there, so that chart goes as a picture instead.
     */
    App.pptx.waterfallSeries = function waterfallSeries(steps) {
        if (steps.some((step) => step.from < 0 || step.to < 0)) {
            return null;
        }
        const pick = (kind, value) => steps.map((step) => (step.kind === kind ? value(step) : null));
        return {
            base: steps.map((step) => (step.kind === 'total' ? null : Math.min(step.from, step.to))),
            total: pick('total', (step) => step.to),
            increase: pick('increase', (step) => step.to - step.from),
            decrease: pick('decrease', (step) => step.from - step.to),
        };
    };

    const BAR_TYPES = {
        column: ['col', 'clustered'], 'stacked-column': ['col', 'stacked'], 'stacked-column-100': ['col', 'percentStacked'],
        bar: ['bar', 'clustered'], 'stacked-bar': ['bar', 'stacked'], 'stacked-bar-100': ['bar', 'percentStacked'],
    };
    const LEGEND_PLACES = { bottom: 'b', top: 't', right: 'r', left: 'l' };
    const WATERFALL_DEFAULTS = { total: null, increase: '#3C9D5D', decrease: '#D9534F' };

    // A colour the deck writes as CSS (var(--color-accent), a colour mix …) → 'RRGGBB', computed in the deck.
    function resolvedColor(doc, css, fallback) {
        const probe = doc.createElement('span');
        probe.setAttribute('data-editor-only', '');
        probe.style.color = css;
        doc.body.appendChild(probe);
        const color = App.pptx.colorOf(doc.defaultView.getComputedStyle(probe).color);
        probe.remove();
        return color ? color.hex : fallback;
    }

    function seriesData(series, categories) {
        return { name: series.name, labels: categories, values: series.values };
    }

    /*
     * A chart → PowerPoint's own chart, built from the chart's JSON (SPEC 7.4): its data
     * stays editable in PowerPoint (Edit Data). Colours, title, legend, labels and their
     * number format, axis limits and gridlines follow the deck; what PowerPoint cannot show
     * the same way is reported.
     */
    function chartItem(element, offset, ctx) {
        const script = element.querySelector(':scope > script.chart-data');
        const data = script ? App.charts.parseChartData(script.textContent) : null;
        if (!data || !App.charts.canDraw(data.type) || App.pptx.rotationOf(element.style.transform)) {
            return pictureItem(element, offset, ctx);
        }
        const doc = element.ownerDocument;
        const m = App.charts.modelOf(data);
        const o = m.options;
        const box = boxOf(element, offset);
        const text = resolvedColor(doc, 'var(--color-text, #222222)', '222222');
        const colors = m.series.map((series) => resolvedColor(doc, series.color, '1F2A44'));
        const decimalsOf = (series) => (typeof o.labelDecimals === 'number' ? o.labelDecimals
            : /-100$/.test(m.type) ? 0 : App.charts.decimalsOf(series.values, series.percent));
        const formatOf = (series) => App.pptx.numberFormat({ decimals: decimalsOf(series), percent: series.percent,
            parens: !!o.parens, units: o.units });
        const legend = o.legend === 'none' ? null : LEGEND_PLACES[o.legend] || 'b';
        const options = Object.assign(position(box, 0), {
            fontFace: ctx.bodyFont, showTitle: !!o.title, title: o.title || '', titleFontSize: 13, titleColor: text,
            titleFontFace: ctx.bodyFont, showLegend: !!legend && m.series.length > 1, legendPos: legend || 'b',
            legendFontSize: 9, legendColor: text, legendFontFace: ctx.bodyFont,
            catAxisLabelFontSize: 9, valAxisLabelFontSize: 9, catAxisLabelColor: text, valAxisLabelColor: text,
            catAxisLabelFontFace: ctx.bodyFont, valAxisLabelFontFace: ctx.bodyFont,
            valGridLine: o.gridlines === false ? { style: 'none' } : { color: 'D9D9D9', size: 0.75 },
            catGridLine: { style: 'none' }, valAxisLineShow: false,
            dataLabelFontSize: 9, dataLabelColor: text, dataLabelFontFace: ctx.bodyFont,
        });
        if (typeof o.axisMin === 'number') {
            options.valAxisMinVal = o.axisMin;
        }
        if (typeof o.axisMax === 'number') {
            options.valAxisMaxVal = o.axisMax;
        }
        if (o.valueAxisTitle) {
            Object.assign(options, { showValAxisTitle: true, valAxisTitle: o.valueAxisTitle, valAxisTitleFontSize: 9 });
        }
        if (o.categoryAxisTitle) {
            Object.assign(options, { showCatAxisTitle: true, catAxisTitle: o.categoryAxisTitle, catAxisTitleFontSize: 9 });
        }
        if (o.source) {
            // The source line under the chart: a small text box, as the slide shows it.
            options.h = App.pptx.inches(Math.max(1, box.height - 22));
            ctx.extra.push({ kind: 'text', runs: [{ text: o.source, options: { fontSize: 8, color: '7F7F7F', fontFace: ctx.bodyFont } }],
                options: Object.assign(position({ left: box.left, top: box.top + box.height - 20, width: box.width, height: 20 }, 0),
                    { margin: 0, valign: 'bottom', isTextBox: true }) });
        }
        const first = m.series[0] || { values: [], percent: false };
        if (o.dataLabels) {
            Object.assign(options, { showValue: true, dataLabelFormatCode: formatOf(first) });
        }
        options.valAxisLabelFormatCode = App.pptx.numberFormat({ decimals: 0, percent: first.percent || /-100$/.test(m.type),
            parens: !!o.parens, units: o.units });
        if (m.estimates.some(Boolean)) {
            ctx.report.push("a chart's estimate columns are not shaded lighter (PowerPoint: Format Data Point)");
        }
        if (o.cagr) {
            ctx.report.push("a chart's CAGR arrow is not drawn (add it in PowerPoint)");
        }

        const type = m.type;
        if (BAR_TYPES[type]) {
            Object.assign(options, { barDir: BAR_TYPES[type][0], barGrouping: BAR_TYPES[type][1], chartColors: colors,
                barGapWidthPct: typeof o.gapWidth === 'number' ? o.gapWidth : 100 });
            if (BAR_TYPES[type][1] !== 'clustered') {
                options.barOverlapPct = 100;
            }
            return { kind: 'chart', type: 'bar', data: m.series.map((s) => seriesData(s, m.categories)), options: options };
        }
        if (type === 'line' || type === 'area' || type === 'stacked-area') {
            Object.assign(options, { chartColors: colors, lineSize: 2, lineDataSymbol: type === 'line' ? 'circle' : 'none',
                lineDataSymbolSize: 6, barGrouping: type === 'stacked-area' ? 'stacked' : 'standard' });
            return { kind: 'chart', type: type === 'line' ? 'line' : 'area', data: m.series.map((s) => seriesData(s, m.categories)),
                options: options };
        }
        if (type === 'pie' || type === 'donut') {
            const given = data.series && data.series[0] && Array.isArray(data.series[0].colors) ? data.series[0].colors : [];
            const slices = m.categories.map((name, i) => resolvedColor(doc, given[i] || App.charts.defaultColor(i), '1F2A44'));
            Object.assign(options, { chartColors: slices, showLegend: !!legend, holeSize: 55, showValue: false,
                showPercent: !!o.dataLabels, dataLabelColor: 'FFFFFF' });
            delete options.dataLabelFormatCode;
            return { kind: 'chart', type: type === 'pie' ? 'pie' : 'doughnut', data: [seriesData(first, m.categories)], options: options };
        }
        if (type === 'scatter' || type === 'bubble') {
            if (m.series.length < 2) {
                return pictureItem(element, offset, ctx);
            }
            const points = [{ name: m.series[0].name, values: m.series[0].values },
                Object.assign({ name: m.series[1].name, values: m.series[1].values },
                    type === 'bubble' && m.series[2] ? { sizes: m.series[2].values } : {})];
            Object.assign(options, { chartColors: [colors[1] || colors[0]], lineSize: 0, lineDataSymbol: 'circle', lineDataSymbolSize: 9,
                showLegend: false, showValue: false });
            return { kind: 'chart', type: type, data: points, options: options };
        }
        if (type === 'combo') {
            const secondary = m.series.some((s) => s.axis === 'secondary');
            const group = (kind) => m.series.map((s, i) => ({ s: s, color: colors[i] })).filter((entry) => entry.s.kind === kind);
            const bars = group('bar');
            const lines = group('line');
            const lineFormat = lines[0] ? formatOf(lines[0].s) : null;
            const charts = [];
            if (bars.length) {
                charts.push({ type: 'bar', data: bars.map((e) => seriesData(e.s, m.categories)), options: {
                    barDir: 'col', barGrouping: 'clustered', chartColors: bars.map((e) => e.color),
                    barGapWidthPct: typeof o.gapWidth === 'number' ? o.gapWidth : 100,
                    showValue: !!o.dataLabels, dataLabelFormatCode: formatOf(bars[0].s) } });
            }
            if (lines.length) {
                charts.push({ type: 'line', data: lines.map((e) => seriesData(e.s, m.categories)), options: Object.assign({
                    chartColors: lines.map((e) => e.color), lineSize: 2, lineDataSymbol: 'circle', lineDataSymbolSize: 6,
                    showValue: !!o.dataLabels, dataLabelFormatCode: lineFormat, dataLabelPosition: 't' },
                secondary ? { secondaryValAxis: true, secondaryCatAxis: true } : {}) });
            }
            if (secondary) {
                options.valAxes = [
                    { showValAxisTitle: !!o.valueAxisTitle, valAxisTitle: o.valueAxisTitle || '', valGridLine: options.valGridLine,
                        valAxisLabelFormatCode: options.valAxisLabelFormatCode, valAxisLineShow: false },
                    { showValAxisTitle: !!o.secondaryAxisTitle, valAxisTitle: o.secondaryAxisTitle || '', valGridLine: { style: 'none' },
                        valAxisLabelFormatCode: lineFormat || options.valAxisLabelFormatCode, valAxisLineShow: false },
                ];
                options.catAxes = [{ catAxisTitle: o.categoryAxisTitle || '', showCatAxisTitle: !!o.categoryAxisTitle }, { catAxisHidden: true }];
            }
            delete options.showValue;
            delete options.dataLabelFormatCode;
            return { kind: 'chart', combo: charts, options: options };
        }
        if (type === 'waterfall') {
            const bars = App.pptx.waterfallSeries(App.charts.waterfallSteps(m));
            if (!bars) {
                return pictureItem(element, offset, ctx, 'a waterfall that goes below zero came across as a picture');
            }
            const look = Object.assign({}, WATERFALL_DEFAULTS, o.waterfall);
            const names = { base: 'Base', total: 'Total', increase: 'Increase', decrease: 'Decrease' };
            Object.assign(options, {
                barDir: 'col', barGrouping: 'stacked', barOverlapPct: 100, barGapWidthPct: typeof o.gapWidth === 'number' ? o.gapWidth : 60,
                showLegend: false, showValue: false,
                chartColors: ['transparent', resolvedColor(doc, look.total || App.charts.defaultColor(0), '1F2A44'),
                    resolvedColor(doc, look.increase, '3C9D5D'), resolvedColor(doc, look.decrease, 'D9534F')],
            });
            delete options.dataLabelFormatCode;
            if (o.dataLabels) {
                ctx.report.push("a waterfall's data labels are left off (PowerPoint would label its invisible base too)");
            }
            return { kind: 'chart', type: 'bar', data: ['base', 'total', 'increase', 'decrease'].map((key) =>
                ({ name: names[key], labels: m.categories, values: bars[key] })), options: options };
        }
        return pictureItem(element, offset, ctx);
    }

    // A part PowerPoint gets as a picture: where it is, and what to tell the user.
    function pictureItem(part, offset, ctx, reason) {
        const isMaster = part.classList.contains('master-layer');
        const box = isMaster ? { left: 0, top: 0, width: SLIDE_WIDTH, height: SLIDE_HEIGHT } : boxOf(part, offset);
        const turned = isMaster ? 0 : App.pptx.rotationOf(part.style.transform);
        const kind = isMaster ? 'master' : part.getAttribute('data-type') || 'element';
        return {
            kind: 'picture',
            selector: isMaster ? '.master-layer' : '[data-id="' + part.getAttribute('data-id') + '"]',
            box: App.pptx.outerBox(box, turned),
            report: reason || ((KIND_NAMES[kind] || 'an element') + ' came across as a picture'),
        };
    }

    /* One part of a slide (or of a group) → items appended to `items`. */
    function readPart(part, offset, ctx, items) {
        if (part.classList.contains('master-layer')) {
            if (!ctx.masterNative) {
                items.push(pictureItem(part, offset, ctx));
            } else if (ctx.numberAsText) {
                const number = part.querySelector('.master-item[data-master="number"]');
                if (number && number.textContent.trim()) {
                    items.push(masterTextItem(number, ctx.view, number.textContent.trim()));
                }
            }
            return;
        }
        const type = part.getAttribute('data-type');
        if (type === 'text') {
            items.push(textBoxItem(part, offset, ctx));
        } else if (type === 'image' && part.tagName.toLowerCase() === 'img') {
            items.push(imageItem(part, offset, ctx));
        } else if (type === 'shape') {
            items.push(shapeItem(part, offset, ctx));
        } else if (type === 'table') {
            items.push(tableItem(part, offset, ctx));
        } else if (type === 'chart') {
            items.push(chartItem(part, offset, ctx));
            ctx.extra.splice(0).forEach((extra) => items.push(extra));   // its source line, on top of it
        } else if (type === 'group' && !App.pptx.rotationOf(part.style.transform)) {
            // PowerPoint groups cannot be written: the parts come one by one, where they show.
            const box = boxOf(part, offset);
            partsOf(part, ctx.view).forEach((child) => readPart(child, { left: box.left, top: box.top }, ctx, items));
            ctx.report.push('a group came across as its separate parts (select them in PowerPoint and Group them again)');
        } else if (type === 'group') {
            items.push(pictureItem(part, offset, ctx, 'a turned group came across as a picture'));
        } else {
            items.push(pictureItem(part, offset, ctx));
        }
    }

    /*
     * Everything PowerPoint needs from slide `slide` (shown at the moment):
     * { hidden, notes, background, withMaster, items: [back to front], report: [texts] }.
     */
    function readSlide(slide, view, schemes, master) {
        const style = view.getComputedStyle(slide);
        const ctx = { view: view, schemes: schemes, report: [], masterNative: !!master, numberAsText: !!(master && master.numberAsText),
            bodyFont: App.pptx.fontFace(view.getComputedStyle(slide.ownerDocument.documentElement).getPropertyValue('--font-body') || 'Calibri'),
            extra: [] };
        const items = [];
        partsOf(slide, view).forEach((part) => readPart(part, null, ctx, items));
        return {
            hidden: App.slides.isHidden(slide),
            notes: App.notes.textOf(slide),
            background: App.pptx.colorOf(style.backgroundColor),
            backgroundPicture: style.backgroundImage && style.backgroundImage !== 'none',
            withMaster: !!master && !!slide.querySelector(':scope > .master-layer'),
            items: items,
            report: ctx.report,
        };
    }

    /* ---------- The slide master ---------- */

    // A master item's text as a PowerPoint text box, in the look the slide shows it.
    function masterTextItem(item, view, text) {
        const style = view.getComputedStyle(item);
        const color = App.pptx.colorOf(style.color);
        const options = Object.assign(position(boxOf(item), 0), {
            fontFace: App.pptx.fontFace(style.fontFamily), fontSize: App.pptx.points(parseFloat(style.fontSize)),
            align: ['center', 'right'].includes(style.textAlign) ? style.textAlign : 'left',
            valign: 'middle', margin: 0, bold: (parseInt(style.fontWeight, 10) || 400) >= 600,
        });
        if (color) {
            options.color = color.hex;
        }
        return { kind: 'text', runs: [{ text: text, options: {} }], options: options };
    }

    /*
     * The deck's slide master as PowerPoint's (decided in the Phase 8 Q&A): logo, footer and
     * label once on a master, slide numbers as PowerPoint's own number field ('3 / 15' cannot
     * be: then each slide gets its number as text). null when the deck has no master or none
     * of its slides shows it. Read from a slide that shows it, so the look is the deck's.
     */
    function readMaster(doc, view, slides) {
        const settings = App.master.read(doc);
        const shown = slides.find((slide) => slide.querySelector(':scope > .master-layer .master-item'));
        if (!shown) {
            return null;
        }
        return App.deck.withSlideShown(shown, () => {
            const layer = shown.querySelector(':scope > .master-layer');
            const objects = [];
            let slideNumber = null;
            layer.querySelectorAll('.master-item[data-master]').forEach((item) => {
                const role = item.getAttribute('data-master');
                if (role === 'logo') {
                    const match = /url\("?data:([^")]+)"?\)/.exec(view.getComputedStyle(item).backgroundImage);
                    if (match) {
                        objects.push({ image: Object.assign({ data: match[1] }, position(boxOf(item), 0)) });
                    }
                } else if (role === 'number') {
                    if (settings.numbers === 'n') {
                        const look = masterTextItem(item, view, '').options;
                        slideNumber = { x: look.x, y: look.y, w: look.w, h: look.h, fontFace: look.fontFace,
                            fontSize: look.fontSize, color: look.color, align: look.align, valign: 'middle', margin: 0 };
                    }
                } else if (item.textContent.trim()) {
                    const text = masterTextItem(item, view, item.textContent.trim());
                    objects.push({ text: { text: item.textContent.trim(), options: text.options } });
                }
            });
            return { objects: objects, slideNumber: slideNumber, numberAsText: settings.numbers === 'n/total' };
        });
    }

    /* ---------- Building the file ---------- */

    function deckName() {
        return (App.state.fileName || 'Presentation').replace(/\.html?$/i, '');
    }

    /*
     * Build the presentation of the deck shown. Resolves { pptx, report } where
     * report = [{ slide: number, text }] lists what came across as a picture or simplified.
     */
    App.pptx.build = async function build(onProgress) {
        const doc = App.deck.getDocument();
        const view = doc.defaultView;
        const slides = App.deck.getSlides();
        const schemes = schemesOf(view, doc);
        const master = readMaster(doc, view, slides);
        const plans = slides.map((slide) => App.deck.withSlideShown(slide, () => readSlide(slide, view, schemes, master)));

        const pptx = new PptxGenJS();
        pptx.defineLayout({ name: 'DECK', width: App.pptx.inches(SLIDE_WIDTH), height: App.pptx.inches(SLIDE_HEIGHT) });
        pptx.layout = 'DECK';
        pptx.title = deckName();
        const rootStyle = view.getComputedStyle(doc.documentElement);
        pptx.theme = {
            headFontFace: App.pptx.fontFace(rootStyle.getPropertyValue('--font-heading') || 'Calibri'),
            bodyFontFace: App.pptx.fontFace(rootStyle.getPropertyValue('--font-body') || 'Calibri'),
        };
        const report = [];
        if (master) {
            const definition = { title: 'DECK_MASTER', objects: master.objects };
            if (master.slideNumber) {
                definition.slideNumber = master.slideNumber;
            }
            pptx.defineSlideMaster(definition);
            if (master.numberAsText) {
                report.push({ slide: null, text: 'slide numbers like "3 / 15" are typed on each slide (PowerPoint cannot show the total itself)' });
            }
        }

        // A PowerPoint chart keeps its numbers and a format; the separators come from the PC's Windows region
        // settings, never from the file (a format code cannot fix them), so say it once when there are charts.
        if (plans.some((plan) => plan.items.some((item) => item.kind === 'chart'))) {
            report.push({ slide: null, text: "chart numbers use this PC's Windows number format (Brazil: 1.234,5; " +
                'United States: 1,234.5), not the deck\'s: check one chart on the PC that will show it' });
        }
        const root = App.serialize.cleanCopy(doc);   // what the pictures are drawn from
        for (let index = 0; index < plans.length; index++) {
            if (onProgress) {
                onProgress(index + 1, plans.length);
            }
            const plan = plans[index];
            const slide = plan.withMaster ? pptx.addSlide({ masterName: 'DECK_MASTER' }) : pptx.addSlide();
            if (plan.hidden) {
                slide.hidden = true;
            }
            if (plan.backgroundPicture) {
                const picture = await App.snapshot.partPng(root, index, null,
                    { left: 0, top: 0, width: SLIDE_WIDTH, height: SLIDE_HEIGHT }, PICTURE_SCALE);
                slide.background = { data: picture.data };
                report.push({ slide: index + 1, text: 'the slide background came across as a picture' });
            } else if (plan.background) {
                slide.background = { color: plan.background.hex, transparency: plan.background.transparency };
            }
            for (const item of plan.items) {
                if (item.kind === 'text') {
                    slide.addText(item.runs, item.options);
                } else if (item.kind === 'image') {
                    slide.addImage(item.options);
                } else if (item.kind === 'shape') {
                    slide.addShape(item.shape, item.options);
                } else if (item.kind === 'chart' && item.combo) {
                    slide.addChart(item.combo, item.options);
                } else if (item.kind === 'chart') {
                    slide.addChart(item.type, item.data, item.options);
                } else if (item.kind === 'table') {
                    slide.addTable(item.rows, item.options);
                } else if (item.kind === 'picture') {
                    const picture = await App.snapshot.partPng(root, index, item.selector, item.box, PICTURE_SCALE);
                    slide.addImage(Object.assign({ data: picture.data }, position(picture.box, 0)));
                    report.push({ slide: index + 1, text: item.report });
                }
            }
            plan.report.forEach((text) => report.push({ slide: index + 1, text: text }));
            if (plan.notes) {
                slide.addNotes(plan.notes);
            }
        }
        return { pptx: pptx, report: report };
    };

    /* The report after an export: what to check in PowerPoint. */
    App.pptx.reportText = function reportText(report) {
        if (report.length === 0) {
            return 'Everything came across as editable PowerPoint objects.';
        }
        // The same remark on one slide once, with how many times ("2 ×").
        const lines = [];
        const counts = new Map();
        report.forEach((entry) => {
            const line = (entry.slide ? 'Slide ' + entry.slide + ': ' : '') + entry.text;
            if (!counts.has(line)) {
                lines.push(line);
            }
            counts.set(line, (counts.get(line) || 0) + 1);
        });
        return 'Everything else came across as editable PowerPoint objects. Check these in PowerPoint:\n' +
            lines.map((line) => {
                const count = counts.get(line);
                return '• ' + (count > 1 ? line.replace(/: (an? |the )?/, ': ' + count + ' × ') : line);
            }).join('\n');
    };

    /* Export > PowerPoint: build, download deck.pptx, show the report. */
    App.pptx.export = async function exportPptx() {
        let name = null;
        let report = null;
        try {
            const built = await App.pptx.build((done, total) => App.ui.setBusy('PowerPoint: slide ' + done + ' of ' + total + '…'));
            App.ui.setBusy('Writing the PowerPoint file…');
            const blob = await built.pptx.write({ outputType: 'blob' });
            name = deckName() + '.pptx';
            App.fileio.downloadBlob(name, blob);
            report = built.report;
            App.ui.setStatus('Saved ' + name + ' to your Downloads folder');
        } finally {
            App.ui.setBusy(null);
        }
        await App.dialogs.show({
            title: 'Exported ' + name,
            body: App.util.el('div', { class: 'pptx-report' }, [App.pptx.reportText(report)]),
        });
    };
})();
