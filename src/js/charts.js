/*
 * charts.js - turns chart JSON into a static SVG (SPEC 5).
 *
 *   <figure class="el" data-type="chart" data-id="e4" style="left; top; width; height; z-index">
 *     <script type="application/json" class="chart-data"> holding { "type": "column", "categories": [...], ... }
 *     <svg class="chart-svg" width="760" height="420" viewBox="0 0 760 420" …>…</svg>
 *   </figure>
 *
 * render(data, width, height) is a pure function (SPEC 5.6): same input, same
 * output, no randomness, no measuring (text widths are estimated from the
 * number of characters). It draws at exactly width x height px, so after a
 * resize redraw() draws the chart again instead of stretching it: text keeps
 * its size. Colours are the theme's variables (--color-accent, --color-primary
 * and lighter mixes of them), the font --font-body, so a rebranded deck
 * recolours its charts. Numbers are written by numbers.js, in the chart's
 * locale (pt-BR 1.234,5 or en-US 1,234.5).
 *
 * Drawn so far: column, stacked-column, bar, stacked-bar (step 1); line,
 * combo (columns and lines, a second value axis on the right for series with
 * "axis": "secondary"), donut and pie (step 2); waterfall (step 3: a "roles"
 * list beside "categories": start, delta, subtotal, end); stacked-column-100,
 * stacked-bar-100, area, stacked-area, scatter and bubble (step 4: each category
 * a point, x and y from the first two series, a bubble's area from the third).
 * Other types still get the Phase 1 placeholder (a grey frame with the
 * title), marked data-chart-placeholder, which renderMissing draws properly
 * on open once the type can be drawn. A chart drawn by hand (a deck's own
 * SVG) is only redrawn when it is edited or resized, so opening and saving a
 * deck leaves it as it was.
 *
 * Talks to: importer.js (calls renderMissing during import), numbers.js, util.js.
 */

(function () {
    'use strict';

    App.charts = {};

    const FONT = 'Segoe UI, Calibri, Arial, sans-serif';

    /* Parse the text of a <script class="chart-data">. Returns null instead of throwing. */
    App.charts.parseChartData = function parseChartData(text) {
        try {
            const data = JSON.parse(text);
            return data && typeof data === 'object' ? data : null;
        } catch (error) {
            return null;
        }
    };

    function describe(data) {
        const type = data.type || 'chart';
        const categories = Array.isArray(data.categories) ? data.categories.length : 0;
        const series = Array.isArray(data.series) ? data.series.length : 0;
        return 'Chart: ' + type + ' · ' + categories + ' categories · ' + series + ' series';
    }

    // A few grey bars so the placeholder reads as "a chart goes here".
    function silhouetteBars(width, height) {
        const heights = [0.35, 0.55, 0.45, 0.7, 0.6];
        const areaTop = height * 0.3;
        const areaHeight = height * 0.5;
        const barWidth = width * 0.08;
        const gap = (width * 0.6 - barWidth * heights.length) / (heights.length - 1);
        let x = width * 0.2;
        let bars = '';
        heights.forEach((h) => {
            const barHeight = areaHeight * h;
            const y = areaTop + areaHeight - barHeight;
            bars += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barWidth.toFixed(1) +
                '" height="' + barHeight.toFixed(1) + '" fill="#d5d9de"/>';
            x += barWidth + gap;
        });
        return bars;
    }

    /* The Phase 1 placeholder: a grey frame with the title, for types not drawn yet. */
    function placeholder(data, width, height) {
        const title = (data.options && data.options.title) || 'Chart';
        const escape = App.util.escapeHtml;
        const centerX = (width / 2).toFixed(1);
        return '<svg width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '"' +
            ' data-chart-placeholder="true" role="img" aria-label="' + escape(title) + '">' +
            '<rect x="0.5" y="0.5" width="' + (width - 1) + '" height="' + (height - 1) + '"' +
            ' fill="#f5f6f7" stroke="#b9bec5" stroke-dasharray="6 4"/>' +
            silhouetteBars(width, height) +
            '<text x="' + centerX + '" y="' + (height * 0.18).toFixed(1) + '" text-anchor="middle"' +
            ' font-family="' + FONT + '" font-size="18" font-weight="600" fill="#444">' + escape(title) + '</text>' +
            '<text x="' + centerX + '" y="' + (height * 0.92).toFixed(1) + '" text-anchor="middle"' +
            ' font-family="' + FONT + '" font-size="12" fill="#777">' + escape(describe(data)) +
            ' — this chart type is drawn in a later update</text>' +
            '</svg>';
    }

    // ---------------------------------------------------------------
    // Numbers (pure)
    // ---------------------------------------------------------------

    /* Round numbers for an axis from min to max, about `count` of them (always including 0 when in range). */
    App.charts.niceTicks = function niceTicks(min, max, count) {
        let low = Math.min(min, max);
        let high = Math.max(min, max);
        if (low === high) {
            high = low === 0 ? 1 : low + Math.abs(low);
            low = Math.min(low, 0);
        }
        const range = niceNumber(high - low, false);
        const step = niceNumber(range / Math.max(count - 1, 1), true);
        const places = Math.max(0, -Math.floor(Math.log10(step)) + 1);
        const ticks = [];
        for (let value = Math.floor(low / step) * step; value <= Math.ceil(high / step) * step + step / 2; value += step) {
            ticks.push(Number(value.toFixed(places)) + 0);
        }
        return ticks;
    };

    /* 1, 2, 5 or 10 times a power of ten near `value` (Heckbert's "nice numbers"). */
    function niceNumber(value, round) {
        const exponent = Math.floor(Math.log10(value));
        const fraction = value / Math.pow(10, exponent);
        let nice;
        if (round) {
            nice = fraction < 1.5 ? 1 : fraction < 3 ? 2 : fraction < 7 ? 5 : 10;
        } else {
            nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
        }
        return nice * Math.pow(10, exponent);
    }

    /*
     * A value as a label: { locale, decimals, percent (0.195 -> 19,5%), parens
     * (negatives in parentheses) }. Written by numbers.js, so a chart writes
     * numbers exactly as a table does.
     */
    App.charts.formatValue = function formatValue(value, options) {
        const opts = options || {};
        const shown = opts.percent ? value * 100 : value;
        const parts = App.numbers.parse(shown.toFixed(opts.decimals || 0), 'en-US');
        if (!parts) {
            return String(value);
        }
        parts.grouped = true;
        parts.parens = !!opts.parens && parts.negative;
        parts.suffix = opts.percent ? '%' : '';
        return App.numbers.format(parts, opts.locale || 'pt-BR');
    };

    /* How many decimals `values` need (as percentages when `percent`), at most two. */
    App.charts.decimalsOf = function decimalsOf(values, percent) {
        return values.reduce((most, value) => {
            if (typeof value !== 'number' || !isFinite(value)) {
                return most;
            }
            const text = String(Number((percent ? value * 100 : value).toFixed(6)));
            const point = text.indexOf('.');
            return Math.max(most, point === -1 ? 0 : Math.min(2, text.length - point - 1));
        }, 0);
    };

    /* Compound annual growth from `first` to `last` over `periods` (0.196 = 19,6%), or null when it has no meaning. */
    App.charts.cagr = function cagr(first, last, periods) {
        return first > 0 && last >= 0 && periods > 0 ? Math.pow(last / first, 1 / periods) - 1 : null;
    };

    /*
     * Axis numbers between `low` and `high`, from `min` and / or to `max` when
     * set (options.axisMin / axisMax; auto otherwise).
     */
    function limitedTicks(low, high, count, min, max) {
        const hasMin = typeof min === 'number' && isFinite(min);
        const hasMax = typeof max === 'number' && isFinite(max) && (!hasMin || max > min);
        let ticks = App.charts.niceTicks(hasMin ? min : low, hasMax ? max : high, count);
        const tiny = 1e-9;
        if (hasMin) {
            ticks = [min].concat(ticks.filter((tick) => tick > min + tiny));
        }
        if (hasMax) {
            ticks = ticks.filter((tick) => tick < max - tiny).concat([max]);
        }
        return ticks;
    }

    /* `name` on at most two lines no wider than `room` at `size` px (split between words), or null. */
    function twoLines(name, size, room) {
        if (textWidth(name, size) <= room) {
            return [name];
        }
        const words = name.split(/\s+/).filter(Boolean);
        for (let cut = words.length - 1; cut >= 1; cut--) {
            const lines = [words.slice(0, cut).join(' '), words.slice(cut).join(' ')];
            if (lines.every((part) => textWidth(part, size) <= room)) {
                return lines;
            }
        }
        return null;
    }

    /*
     * How the category names fit under columns `band` px apart (SPEC 5.6):
     * as they are; else on two lines; else smaller (12, then 11 px, again
     * also on two lines); else turned 45°, and if even that is too crowded
     * only every `step`-th one. { mode: 'normal' | 'wrap' | 'rotate', size,
     * lines: [[line, ...] per name], step, height (px the row takes) }.
     */
    App.charts.fitCategoryLabels = function fitCategoryLabels(names, band) {
        const room = band - 4;
        for (const size of [LABEL_SIZE, 12, 11]) {
            if (names.every((name) => textWidth(name, size) <= room)) {
                return { mode: 'normal', size: size, lines: names.map((name) => [name]), step: 1, height: size + 8 };
            }
            const wrapped = names.map((name) => twoLines(name, size, room));
            if (wrapped.every(Boolean)) {
                return { mode: 'wrap', size: size, lines: wrapped, step: 1, height: size * 2.2 + 8 };
            }
        }
        const size = 12;
        const widest = Math.max(0, ...names.map((name) => textWidth(name, size)));
        return {
            mode: 'rotate', size: size, lines: names.map((name) => [name]),
            step: Math.max(1, Math.ceil(size * 1.3 / band)), height: (widest + size) * 0.71 + 8,
        };
    };

    // ---------------------------------------------------------------
    // The chart's data, made safe to draw
    // ---------------------------------------------------------------

    const DRAWN = ['column', 'stacked-column', 'bar', 'stacked-bar', 'line', 'combo', 'donut', 'pie', 'waterfall',
        'stacked-column-100', 'stacked-bar-100', 'scatter', 'bubble', 'area', 'stacked-area'];
    const HORIZONTAL = ['bar', 'stacked-bar', 'stacked-bar-100'];
    const STACKED = ['stacked-column', 'stacked-bar', 'stacked-column-100', 'stacked-bar-100', 'stacked-area'];
    const PALETTE = [
        'var(--color-accent, #1F2A44)', 'var(--color-primary, #CC092F)',
        'color-mix(in srgb, var(--color-accent, #1F2A44) 55%, white)', 'color-mix(in srgb, var(--color-primary, #CC092F) 55%, white)',
        '#7F7F7F', '#BFBFBF',
    ];

    /* A chart type render() can draw (not the placeholder). */
    App.charts.canDraw = function canDraw(type) {
        return DRAWN.indexOf(type) !== -1;
    };

    /* Chart data made safe to draw: { type, categories, series, estimates, roles, options }. */
    App.charts.modelOf = function modelOf(data) {
        const categories = (Array.isArray(data.categories) ? data.categories : []).map((name) => String(name));
        const series = (Array.isArray(data.series) ? data.series : []).map((item, index) => {
            const values = Array.isArray(item && item.values) ? item.values : [];
            const given = item || {};
            return {
                name: String(given.name || 'Series ' + (index + 1)),
                values: categories.map((name, i) => (typeof values[i] === 'number' && isFinite(values[i]) ? values[i] : null)),
                color: given.color || PALETTE[index % PALETTE.length],
                percent: given.format === 'percent',
                format: given.format,
                // A line chart draws lines; a combo its "line" series (by default: all but the first).
                kind: data.type === 'area' || data.type === 'stacked-area' ? 'area'
                    : data.type === 'line' || (data.type === 'combo' && (given.type === 'line' || (!given.type && index > 0)))
                        ? 'line' : 'bar',
                axis: given.axis === 'secondary' ? 'secondary' : given.axis === 'primary' ? 'primary' : null,
            };
        });
        guessComboAxes(data.type, series);
        const estimates = Array.isArray(data.estimates) ? data.estimates : [];
        return {
            type: data.type, categories: categories, series: series,
            estimates: categories.map((name, i) => !!estimates[i]),
            roles: rolesOf(data.roles, categories.length),
            options: Object.assign({}, data.options),
        };
    };

    /*
     * A waterfall's role per category: 'start', 'delta' (an increase or a
     * decrease, by its sign), 'subtotal' or 'end'. Without roles (as Copilot
     * writes a bridge): the first is the start, the last the end.
     */
    function rolesOf(given, count) {
        const roles = Array.isArray(given) ? given : [];
        return Array.from({ length: count }, (unused, i) => {
            const role = roles[i];
            if (role === 'start' || role === 'subtotal' || role === 'end') {
                return role;
            }
            if (role === 'delta' || role === 'increase' || role === 'decrease') {
                return 'delta';
            }
            return i === 0 ? 'start' : i === count - 1 && count > 1 ? 'end' : 'delta';
        });
    }

    /*
     * A combo whose series do not say their axis (as Copilot writes them): a
     * line far smaller than the columns (a margin next to revenue) goes on the
     * second axis, and if its values are all between -1 and 1 they are shown in %.
     */
    function guessComboAxes(type, series) {
        const biggest = (items) => Math.max(0, ...[].concat(...items.map((item) => item.values))
            .filter((value) => value !== null).map(Math.abs));
        const columns = biggest(series.filter((item) => item.kind === 'bar'));
        series.forEach((item) => {
            if (item.axis === null) {
                item.axis = type === 'combo' && item.kind === 'line' && biggest([item]) < columns / 10 ? 'secondary' : 'primary';
                if (item.axis === 'secondary' && item.format === undefined && biggest([item]) <= 1) {
                    item.percent = true;
                }
            }
        });
    }

    // ---------------------------------------------------------------
    // Drawing helpers
    // ---------------------------------------------------------------

    const PAD = 8;
    const LABEL_SIZE = 14;   // px on a 1280 px slide: about 10.5 pt
    const TITLE_SIZE = 18;
    const MIDDLE = LABEL_SIZE * 0.35;   // from a label's middle down to its baseline
    const ROW = LABEL_SIZE + 8;         // a row of labels under the plot
    const TEXT_COLOR = '#404040';
    const GRID_COLOR = '#D9D9D9';
    const AXIS_COLOR = '#A6A6A6';
    // A white halo behind dark data labels keeps them readable over bars and lines.
    const HALO = 'paint-order: stroke; stroke: #FFFFFF; stroke-width: 3px; stroke-linejoin: round;';

    function n(value) {
        return String(App.util.round2(value) + 0);
    }

    /* About how wide `content` is at `size` px (no measuring: render stays pure). */
    function textWidth(content, size) {
        return String(content).length * size * 0.55;
    }

    function text(className, x, y, content, attrs) {
        const extra = Object.keys(attrs || {}).map((key) => ' ' + key + '="' + attrs[key] + '"').join('');
        return '<text class="' + className + '" x="' + n(x) + '" y="' + n(y) + '"' + extra + '>' +
            App.util.escapeHtml(content) + '</text>';
    }

    function line(className, x1, y1, x2, y2, color) {
        return '<line class="' + className + '" x1="' + n(x1) + '" y1="' + n(y1) + '" x2="' + n(x2) + '" y2="' + n(y2) +
            '" style="stroke: ' + color + '; stroke-width: 1;"/>';
    }

    function legendPosition(m, items) {
        const legend = m.options.legend;
        if (legend === 'none' || legend === 'hidden') {
            return 'none';
        }
        if (legend === 'top' || legend === 'right' || legend === 'bottom') {
            return legend;
        }
        if (isRound(m.type)) {
            return 'right';
        }
        return items.length > 1 ? 'bottom' : 'none';
    }

    /* A legend entry's key: a square for bars and slices, a short line with a dot for lines. */
    function legendKey(item, x, middle) {
        if (item.kind === 'line') {
            return line('chart-legend-key', x, middle, x + 14, middle, item.color) +
                '<circle cx="' + n(x + 7) + '" cy="' + n(middle) + '" r="3" style="fill: ' + item.color + ';"/>';
        }
        return '<rect x="' + n(x + 2) + '" y="' + n(middle - 5) + '" width="10" height="10" style="fill: ' + item.color + ';"/>';
    }

    /* The legend: items [{ name, color, kind }] in a row (top / bottom) or a column (right). */
    function legend(items, position, area) {
        const sized = items.map((item) => ({ item: item, width: 18 + textWidth(item.name, LABEL_SIZE) }));
        const parts = [];
        if (position === 'right') {
            sized.forEach(({ item }, index) => {
                const middle = area.top + index * (LABEL_SIZE + 8) + LABEL_SIZE / 2;
                parts.push(legendKey(item, area.left, middle), text('chart-legend-label', area.left + 18, middle + MIDDLE,
                    item.name, { 'font-size': LABEL_SIZE, fill: TEXT_COLOR }));
            });
        } else {
            const total = sized.reduce((sum, entry) => sum + entry.width, 0) + 16 * (sized.length - 1);
            let x = area.left + (area.width - total) / 2;
            sized.forEach(({ item, width }) => {
                const middle = area.top + 8;
                parts.push(legendKey(item, x, middle), text('chart-legend-label', x + 18, middle + MIDDLE, item.name,
                    { 'font-size': LABEL_SIZE, fill: TEXT_COLOR }));
                x += width + 16;
            });
        }
        return '<g class="chart-legend">' + parts.join('') + '</g>';
    }

    function svgOpen(width, height, title) {
        return '<svg xmlns="http://www.w3.org/2000/svg" class="chart-svg" width="' + width + '" height="' + height +
            '" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="' + App.util.escapeHtml(title || 'Chart') +
            '" style="font-family: var(--font-body, Calibri, Arial, sans-serif);">';
    }

    /* The title on top and the legend where it goes; returns the area left for the chart itself. */
    function frame(m, width, height, items, parts) {
        const area = { left: PAD, top: PAD, right: width - PAD, bottom: height - PAD };
        if (m.options.title) {
            parts.push(text('chart-title', width / 2, area.top + TITLE_SIZE, m.options.title,
                { 'font-size': TITLE_SIZE, 'font-weight': 'bold', 'text-anchor': 'middle', fill: TEXT_COLOR }));
            area.top += TITLE_SIZE + 12;
        }
        if (m.options.source) {
            // "Fonte: empresa", small and grey, under everything else.
            parts.push(text('chart-source', area.left, area.bottom - 2, m.options.source, { 'font-size': 12, fill: '#7F7F7F' }));
            area.bottom -= 12 + 8;
        }
        const legendAt = legendPosition(m, items);
        if (legendAt === 'bottom') {
            area.bottom -= LABEL_SIZE + 10;
            parts.push(legend(items, 'bottom', { left: area.left, width: area.right - area.left, top: area.bottom + 4 }));
        } else if (legendAt === 'top') {
            parts.push(legend(items, 'top', { left: area.left, width: area.right - area.left, top: area.top }));
            area.top += LABEL_SIZE + 12;
        } else if (legendAt === 'right') {
            const widest = Math.max(...items.map((item) => textWidth(item.name, LABEL_SIZE))) + 18;
            area.right -= widest + 8;
            parts.push(legend(items, 'right', { left: area.right + 8, top: area.top }));
        }
        return area;
    }

    /* The category names under the plot, as fitCategoryLabels decided, from `top` down; xOf(i): the middle of category i. */
    function categoryRow(fit, xOf, top) {
        const names = fit.lines.map((lines, i) => {
            if (i % fit.step !== 0) {
                return '';
            }
            const x = n(xOf(i));
            const y = top + fit.size + 2;
            const attrs = ' font-size="' + fit.size + '" fill="' + TEXT_COLOR + '"';
            if (fit.mode === 'rotate') {
                return '<text class="chart-category-label" x="' + x + '" y="' + n(y) + '" text-anchor="end"' + attrs +
                    ' transform="rotate(-45 ' + x + ' ' + n(y) + ')">' + App.util.escapeHtml(lines[0]) + '</text>';
            }
            if (lines.length === 1) {
                return '<text class="chart-category-label" x="' + x + '" y="' + n(y) + '" text-anchor="middle"' + attrs + '>' +
                    App.util.escapeHtml(lines[0]) + '</text>';
            }
            return '<text class="chart-category-label" x="' + x + '" y="' + n(y) + '" text-anchor="middle"' + attrs + '>' +
                lines.map((part, index) => '<tspan x="' + x + '" dy="' + (index === 0 ? 0 : n(fit.size * 1.15)) + '">' +
                    App.util.escapeHtml(part) + '</tspan>').join('') + '</text>';
        });
        return '<g class="chart-categories">' + names.join('') + '</g>';
    }

    // ---------------------------------------------------------------
    // Columns, bars and lines on axes (column, bar, stacked, line, combo)
    // ---------------------------------------------------------------

    /* The lowest and highest value `series` reach (bars stacked when `stacked`); 0 is always in. */
    function rangeOf(series, stacked, count) {
        let low = 0;
        let high = 0;
        for (let i = 0; i < count; i++) {
            let up = 0;
            let down = 0;
            series.forEach((item) => {
                const value = item.values[i];
                if (value === null) {
                    return;
                }
                if (stacked && item.kind !== 'line') {
                    up += Math.max(value, 0);
                    down += Math.min(value, 0);
                } else {
                    up = Math.max(up, value);
                    down = Math.min(down, value);
                }
            });
            high = Math.max(high, up);
            low = Math.min(low, down);
        }
        return [low, high];
    }

    /* An axis for `series`: its ticks and their labels (in % when every series is a percentage). */
    /* An axis for `series`: its ticks (from limits.min / to limits.max when set) and their labels. */
    function axisOf(series, stacked, count, tickCount, locale, limits) {
        const [low, high] = rangeOf(series, stacked, count);
        const ticks = limitedTicks(low, high, tickCount, limits && limits.min, limits && limits.max);
        const percent = series.length > 0 && series.every((item) => item.percent);
        const step = ticks.length > 1 ? ticks[1] - ticks[0] : 1;
        const format = { locale: locale, percent: percent, decimals: App.charts.decimalsOf([step], percent) };
        return { ticks: ticks, labels: ticks.map((tick) => App.charts.formatValue(tick, format)) };
    }

    /* 100% stacked: each value as its share of its category's total (sizes counted without their sign). */
    function asShares(series, count) {
        const totals = Array.from({ length: count }, (unused, i) =>
            series.reduce((sum, item) => sum + Math.abs(item.values[i] || 0), 0));
        return series.map((item) => Object.assign({}, item, {
            percent: true, values: item.values.map((value, i) => (value === null || !totals[i] ? null : value / totals[i])),
        }));
    }

    function drawCartesian(model, width, height) {
        const horizontal = HORIZONTAL.indexOf(model.type) !== -1;
        const stacked = STACKED.indexOf(model.type) !== -1;
        const m = /-100$/.test(model.type)
            ? Object.assign({}, model, { series: asShares(model.series, model.categories.length) }) : model;
        const locale = m.options.locale || 'pt-BR';
        const parts = [];
        const area = frame(m, width, height, m.series, parts);

        const count = Math.max(m.categories.length, 1);
        const primary = m.series.filter((series) => series.axis !== 'secondary');
        const secondary = m.series.filter((series) => series.axis === 'secondary');
        // Bars: names at the left, on two lines when longer than 30% of the width.
        const nameRoom = (area.right - area.left) * 0.3;
        const sideNames = m.categories.map((name) => (horizontal ? twoLines(name, LABEL_SIZE, nameRoom) || [name] : [name]));
        const categoryWidth = Math.max(0, ...[].concat(...sideNames).map((name) => textWidth(name, LABEL_SIZE)));
        const length = horizontal ? area.right - area.left - categoryWidth : area.bottom - area.top - ROW;
        const tickCount = Math.max(2, Math.min(6, Math.floor(length / (horizontal ? 80 : 45))));
        const limits = { min: m.options.axisMin, max: m.options.axisMax };
        const axes = {
            primary: axisOf(primary, stacked, m.categories.length, tickCount, locale, limits),
            secondary: secondary.length > 0 ? axisOf(secondary, false, m.categories.length, tickCount, locale, null) : null,
        };
        const widest = (labels) => Math.max(...labels.map((label) => textWidth(label, LABEL_SIZE)));
        const cagr = horizontal ? null : cagrOf(m);

        const plot = Object.assign({}, area);
        plot.left += horizontal ? categoryWidth + 8 : widest(axes.primary.labels) + 6;
        if (cagr) {
            plot.top += 40;   // room for the CAGR arrow over the columns
        }
        if (axes.secondary) {
            plot.right -= widest(axes.secondary.labels) + 6;
        }
        if (horizontal) {
            // The last axis number is centred on the plot's right edge: half of it must fit.
            const labels = axes.primary.labels;
            plot.right -= Math.max(0, textWidth(labels[labels.length - 1], LABEL_SIZE) / 2 - PAD);
        }
        // The row under the plot: axis numbers (bars), or the category names as they fit (columns).
        const fit = horizontal ? null
            : App.charts.fitCategoryLabels(m.categories, (plot.right - plot.left) / Math.max(m.categories.length, 1));
        plot.bottom -= horizontal ? ROW : fit.height;
        const scale = (axis) => {
            const first = axis.ticks[0];
            const last = axis.ticks[axis.ticks.length - 1];
            // Values beyond an axis minimum / maximum stop at it (a bar from 0 starts at the axis).
            const inside = (value) => Math.min(Math.max(value, first), last);
            return horizontal
                ? (value) => plot.left + (inside(value) - first) / (last - first) * (plot.right - plot.left)
                : (value) => plot.bottom - (inside(value) - first) / (last - first) * (plot.bottom - plot.top);
        };
        const at = { primary: scale(axes.primary), secondary: axes.secondary ? scale(axes.secondary) : null };

        // Gridlines and the numbers of each value axis (the second one on the right).
        const grid = [];
        axes.primary.ticks.forEach((tick, index) => {
            const p = at.primary(tick);
            if (m.options.gridlines !== false) {
                grid.push(horizontal ? line('chart-gridline', p, plot.top, p, plot.bottom, GRID_COLOR)
                    : line('chart-gridline', plot.left, p, plot.right, p, GRID_COLOR));
            }
            grid.push(horizontal
                ? text('chart-value-label', p, plot.bottom + LABEL_SIZE + 2, axes.primary.labels[index], { 'font-size': LABEL_SIZE, 'text-anchor': 'middle', fill: TEXT_COLOR })
                : text('chart-value-label', plot.left - 6, p + MIDDLE, axes.primary.labels[index], { 'font-size': LABEL_SIZE, 'text-anchor': 'end', fill: TEXT_COLOR }));
        });
        if (axes.secondary) {
            axes.secondary.ticks.forEach((tick, index) => {
                grid.push(text('chart-value-label-secondary', plot.right + 6, at.secondary(tick) + MIDDLE, axes.secondary.labels[index],
                    { 'font-size': LABEL_SIZE, 'text-anchor': 'start', fill: TEXT_COLOR }));
            });
        }
        parts.push('<g class="chart-axis">' + grid.join('') + '</g>');

        // Each category gets a band; its bars fill part of it (the rest is the gap); line points sit in its middle.
        const band = (horizontal ? plot.bottom - plot.top : plot.right - plot.left) / count;
        const gap = (typeof m.options.gapWidth === 'number' ? m.options.gapWidth : 100) / 100;
        const group = band / (1 + gap);
        const barSeries = m.series.filter((series) => series.kind === 'bar');
        const thick = stacked ? group : group / Math.max(barSeries.length, 1);
        const up = m.categories.map(() => 0);
        const down = m.categories.map(() => 0);
        const areaBase = m.categories.map(() => 0);
        const highestAt = m.categories.map(() => Infinity);   // the top of what is drawn in each category (CAGR arrow)
        const labels = [];
        const lines = [];
        m.series.forEach((series, s) => {
            const scaleOf = at[series.axis === 'secondary' && at.secondary ? 'secondary' : 'primary'];
            // Shares (100% stacked) rarely come out whole: shown as whole percents.
            const decimals = /-100$/.test(m.type) ? 0 : App.charts.decimalsOf(series.values, series.percent);
            const labelFormat = { locale: locale, percent: series.percent, decimals: decimals };
            const xOf = (i) => plot.left + band * (i + 0.5);
            if (series.kind !== 'bar') {
                series.values.forEach((value, i) => {
                    if (value !== null) {
                        highestAt[i] = Math.min(highestAt[i], scaleOf(value + (series.kind === 'area' && stacked ? areaBase[i] : 0)));
                    }
                });
            }
            if (series.kind === 'line') {
                lines.push(drawLine(series, s, m.estimates, xOf, scaleOf, labels, m.options.dataLabels ? labelFormat : null));
                return;
            }
            if (series.kind === 'area') {
                lines.push(drawArea(series, s, m.estimates, xOf, scaleOf, stacked ? areaBase : null, labels,
                    m.options.dataLabels && !stacked ? labelFormat : null));
                return;
            }
            const slot = barSeries.indexOf(series);
            const rects = [];
            series.values.forEach((value, i) => {
                if (value === null) {
                    return;
                }
                let from = 0;
                if (stacked) {
                    from = value >= 0 ? up[i] : down[i];
                    if (value >= 0) {
                        up[i] += value;
                    } else {
                        down[i] += value;
                    }
                }
                const start = band * i + (band - group) / 2 + (stacked ? 0 : slot * thick);
                const [a, b] = [scaleOf(from), scaleOf(from + value)];
                const box = horizontal
                    ? { x: Math.min(a, b), y: plot.top + start, width: Math.abs(b - a), height: thick }
                    : { x: plot.left + start, y: Math.min(a, b), width: thick, height: Math.abs(b - a) };
                let style = 'fill: ' + series.color + ';';
                if (m.estimates[i]) {
                    style += ' fill-opacity: 0.5; stroke: ' + series.color + '; stroke-width: 1; stroke-dasharray: 3 2;';
                }
                highestAt[i] = Math.min(highestAt[i], box.y);
                rects.push('<rect class="chart-bar" x="' + n(box.x) + '" y="' + n(box.y) + '" width="' + n(box.width) +
                    '" height="' + n(box.height) + '" style="' + style + '"/>');
                if (m.options.dataLabels) {
                    // In a combo the line runs near the column tops, so the columns' numbers go inside their base.
                    labels.push(dataLabel(App.charts.formatValue(value, labelFormat), box, value, horizontal, stacked,
                        m.type === 'combo'));
                }
            });
            parts.push('<g class="chart-series" data-series="' + s + '">' + rects.join('') + '</g>');
        });

        // The zero line; lines over the bars; then the category names and the data labels on top of everything.
        const zero = at.primary(0);
        parts.push(horizontal ? line('chart-axis-line', zero, plot.top, zero, plot.bottom, AXIS_COLOR)
            : line('chart-axis-line', plot.left, zero, plot.right, zero, AXIS_COLOR));
        parts.push(...lines);
        if (horizontal) {
            parts.push('<g class="chart-categories">' + sideNames.map((lines, i) => {
                const x = n(plot.left - 6);
                const y = plot.top + band * (i + 0.5) + MIDDLE - (lines.length - 1) * LABEL_SIZE * 0.575;
                return '<text class="chart-category-label" x="' + x + '" y="' + n(y) + '" text-anchor="end" font-size="' +
                    LABEL_SIZE + '" fill="' + TEXT_COLOR + '">' + (lines.length === 1 ? App.util.escapeHtml(lines[0])
                    : lines.map((part, index) => '<tspan x="' + x + '" dy="' + (index === 0 ? 0 : n(LABEL_SIZE * 1.15)) + '">' +
                        App.util.escapeHtml(part) + '</tspan>').join('')) + '</text>';
            }).join('') + '</g>');
        } else {
            parts.push(categoryRow(fit, (i) => plot.left + band * (i + 0.5), plot.bottom));
        }
        parts.push('<g class="chart-data-labels">' + labels.filter(Boolean).join('') + '</g>');
        if (cagr) {
            parts.push(drawCagr(cagr, (i) => plot.left + band * (i + 0.5), highestAt, !!m.options.dataLabels, locale));
        }
        return svgOpen(width, height, m.options.title) + parts.join('') + '</svg>';
    }

    /* options.cagr { series, from, to } (category indexes) worked out: { from, to, rate }, or null. */
    function cagrOf(m) {
        const wanted = m.options.cagr;
        if (!wanted || typeof wanted !== 'object') {
            return null;
        }
        const series = m.series[Number(wanted.series) || 0];
        const [from, to] = [Number(wanted.from), Number(wanted.to)];
        if (!series || !(from >= 0) || !(to > from) || to >= m.categories.length) {
            return null;
        }
        const rate = App.charts.cagr(series.values[from], series.values[to], to - from);
        return rate === null ? null : { from: from, to: to, rate: rate };
    }

    /*
     * The CAGR arrow: up from above the first column, across over everything
     * between, down onto the last one, with "CAGR 19,6%" in a pill on top.
     */
    function drawCagr(cagr, xOf, highestAt, withLabels, locale) {
        const clear = withLabels ? 22 : 8;   // keep clear of the columns' own numbers
        const [x1, x2] = [xOf(cagr.from), xOf(cagr.to)];
        const start = highestAt[cagr.from] - clear;
        const end = highestAt[cagr.to] - clear;
        const level = Math.min(...highestAt.slice(cagr.from, cagr.to + 1)) - clear - 16;
        const content = 'CAGR ' + App.charts.formatValue(cagr.rate, { locale: locale, percent: true, decimals: 1 });
        const pill = textWidth(content, 13) + 14;
        const middle = (x1 + x2) / 2;
        return '<g class="chart-annotation">' +
            '<path class="chart-cagr" d="M' + n(x1) + ' ' + n(start) + 'L' + n(x1) + ' ' + n(level) + 'L' + n(x2) + ' ' + n(level) +
            'L' + n(x2) + ' ' + n(end - 6) + '" style="fill: none; stroke: ' + TEXT_COLOR + '; stroke-width: 1.2;"/>' +
            '<path class="chart-cagr-head" d="M' + n(x2) + ' ' + n(end) + 'L' + n(x2 - 4) + ' ' + n(end - 7) + 'L' + n(x2 + 4) + ' ' +
            n(end - 7) + 'Z" style="fill: ' + TEXT_COLOR + ';"/>' +
            '<rect x="' + n(middle - pill / 2) + '" y="' + n(level - 11) + '" width="' + n(pill) + '" height="22" rx="11" ' +
            'style="fill: #FFFFFF; stroke: ' + TEXT_COLOR + '; stroke-width: 1.2;"/>' +
            text('chart-cagr-label', middle, level + 4.5, content, { 'font-size': 13, 'font-weight': 'bold', 'text-anchor': 'middle', fill: TEXT_COLOR }) +
            '</g>';
    }

    /*
     * A series as an area: filled from its line down to zero, or (stacked) down
     * to the areas below it, whose top `base` it then raises. Its line on top.
     */
    function drawArea(series, s, estimates, xOf, yOf, base, labels, labelFormat) {
        const bottoms = series.values.map((value, i) => (base ? base[i] : 0));
        const tops = series.values.map((value, i) => bottoms[i] + (value === null ? 0 : value));
        const xy = (i, value) => n(xOf(i)) + ' ' + n(yOf(value));
        const outline = tops.map((top, i) => xy(i, top)).concat(bottoms.map((bottom, i) => xy(i, bottom)).reverse());
        const fill = '<path class="chart-area" d="M' + outline.join('L') + 'Z" style="fill: ' + series.color +
            '; fill-opacity: ' + (base ? 0.85 : 0.35) + '; stroke: none;"/>';
        if (base) {
            tops.forEach((top, i) => { base[i] = top; });
        }
        return drawLine(Object.assign({}, series, { values: tops }), s, estimates, xOf, yOf, labels, labelFormat,
            { before: fill, markers: false });
    }

    /*
     * A series as a line: solid between actual years, dashed into an estimate
     * year, a dot at each value (hollow for estimates). Its data labels go to
     * `labels`. options: { before (drawn under the line), markers (default true) }.
     */
    function drawLine(series, s, estimates, xOf, yOf, labels, labelFormat, options) {
        const opts = Object.assign({ before: '', markers: true }, options);
        const points = series.values.map((value, i) => (value === null ? null : { x: xOf(i), y: yOf(value), value: value }));
        const xy = (point) => n(point.x) + ' ' + n(point.y);
        let solid = '';
        let dashed = '';
        let solidEnd = -1;
        for (let i = 1; i < points.length; i++) {
            if (!points[i - 1] || !points[i]) {
                continue;
            }
            if (estimates[i]) {
                dashed += 'M' + xy(points[i - 1]) + 'L' + xy(points[i]);
            } else {
                solid += (solidEnd === i - 1 ? '' : 'M' + xy(points[i - 1])) + 'L' + xy(points[i]);
                solidEnd = i;
            }
        }
        const stroke = 'fill: none; stroke: ' + series.color + '; stroke-width: 2.5; stroke-linejoin: round;';
        const out = [opts.before];
        if (solid) {
            out.push('<path class="chart-line" d="' + solid + '" style="' + stroke + '"/>');
        }
        if (dashed) {
            out.push('<path class="chart-line-estimate" d="' + dashed + '" style="' + stroke + ' stroke-dasharray: 6 4;"/>');
        }
        points.forEach((point, i) => {
            if (!point) {
                return;
            }
            if (opts.markers) {
                out.push('<circle class="chart-marker" cx="' + n(point.x) + '" cy="' + n(point.y) + '" r="4" style="fill: ' +
                    (estimates[i] ? '#FFFFFF' : series.color) + '; stroke: ' + series.color + '; stroke-width: 2;"/>');
            }
            if (labelFormat) {
                labels.push(text('chart-data-label', point.x, point.y - 10, App.charts.formatValue(point.value, labelFormat),
                    { 'font-size': 13, fill: TEXT_COLOR, 'text-anchor': 'middle', style: HALO }));
            }
        });
        return '<g class="chart-series" data-series="' + s + '">' + out.join('') + '</g>';
    }

    // ---------------------------------------------------------------
    // Donut and pie
    // ---------------------------------------------------------------

    function isRound(type) {
        return type === 'donut' || type === 'pie';
    }

    /* The first series as slices of a circle, one per category, from 12 o'clock clockwise. */
    function drawRound(m, width, height) {
        const values = m.series.length > 0 ? m.series[0].values : [];
        const slices = m.categories.map((name, i) => ({
            name: name, color: m.series[0] && m.series[0].colors ? m.series[0].colors[i] : PALETTE[i % PALETTE.length],
            value: values[i] !== null && values[i] > 0 ? values[i] : 0, kind: 'bar',
        })).filter((slice) => slice.value > 0);
        const parts = [];
        const area = frame(m, width, height, slices, parts);
        const total = slices.reduce((sum, slice) => sum + slice.value, 0) || 1;
        const cx = (area.left + area.right) / 2;
        const cy = (area.top + area.bottom) / 2;
        const outer = Math.max(Math.min(area.right - area.left, area.bottom - area.top) / 2 - 2, 1);
        const inner = m.type === 'donut' ? outer * 0.55 : 0;
        const point = (angle, radius) => n(cx + radius * Math.sin(angle)) + ' ' + n(cy - radius * Math.cos(angle));
        const arc = (radius, to, large, sweep) => 'A' + n(radius) + ' ' + n(radius) + ' 0 ' + large + ' ' + sweep + ' ' + point(to, radius);
        const shares = slices.map((slice) => slice.value / total);
        const format = { locale: m.options.locale || 'pt-BR', percent: true, decimals: Math.min(1, App.charts.decimalsOf(shares, true)) };
        const paths = [];
        const labels = [];
        let angle = 0;
        slices.forEach((slice, i) => {
            const end = angle + shares[i] * 2 * Math.PI;
            const large = end - angle > Math.PI ? 1 : 0;
            let d;
            if (shares[i] > 0.9999) {
                // A whole circle: two half arcs (one arc cannot start and end at the same point).
                d = 'M' + point(0, outer) + arc(outer, Math.PI, 1, 1) + arc(outer, 0, 1, 1) + 'Z' +
                    (inner ? 'M' + point(0, inner) + arc(inner, Math.PI, 1, 0) + arc(inner, 0, 1, 0) + 'Z' : '');
            } else if (inner) {
                d = 'M' + point(angle, outer) + arc(outer, end, large, 1) + 'L' + point(end, inner) + arc(inner, angle, large, 0) + 'Z';
            } else {
                d = 'M' + n(cx) + ' ' + n(cy) + 'L' + point(angle, outer) + arc(outer, end, large, 1) + 'Z';
            }
            paths.push('<path class="chart-slice" d="' + d + '" style="fill: ' + slice.color + '; stroke: #FFFFFF; stroke-width: 1.5;' +
                (shares[i] > 0.9999 ? ' fill-rule: evenodd;' : '') + '"/>');
            if (m.options.dataLabels !== false && shares[i] >= 0.05) {
                const middle = (angle + end) / 2;
                const radius = inner ? (outer + inner) / 2 : outer * 0.62;
                labels.push(text('chart-data-label', cx + radius * Math.sin(middle), cy - radius * Math.cos(middle) + MIDDLE,
                    App.charts.formatValue(shares[i], format), { 'font-size': 13, fill: '#FFFFFF', 'text-anchor': 'middle' }));
            }
            angle = end;
        });
        parts.push('<g class="chart-plot" data-cx="' + n(cx) + '" data-cy="' + n(cy) + '">' + paths.join('') + '</g>');
        parts.push('<g class="chart-data-labels">' + labels.join('') + '</g>');
        return svgOpen(width, height, m.options.title) + parts.join('') + '</svg>';
    }

    /*
     * A bar's value: past its end (clustered), in its middle in white when it
     * fits (stacked), or inside its base in white (`inside`, a combo's columns,
     * clear of the line; past the end when the column is too short).
     */
    function dataLabel(content, box, value, horizontal, stacked, inside) {
        const white = { 'font-size': 13, fill: '#FFFFFF', 'text-anchor': 'middle' };
        if (inside && !horizontal && !stacked && box.height > 22) {
            const y = value >= 0 ? box.y + box.height - 7 : box.y + 17;
            return text('chart-data-label', box.x + box.width / 2, y, content, white);
        }
        if (stacked) {
            const fits = horizontal ? box.width > textWidth(content, 13) + 4 : box.height > 16;
            return fits ? text('chart-data-label', box.x + box.width / 2, box.y + box.height / 2 + 4, content, white) : '';
        }
        const attrs = { 'font-size': 13, fill: TEXT_COLOR, 'text-anchor': 'middle', style: HALO };
        if (horizontal) {
            return value >= 0
                ? text('chart-data-label', box.x + box.width + 4, box.y + box.height / 2 + 4, content, Object.assign(attrs, { 'text-anchor': 'start' }))
                : text('chart-data-label', box.x - 4, box.y + box.height / 2 + 4, content, Object.assign(attrs, { 'text-anchor': 'end' }));
        }
        return value >= 0
            ? text('chart-data-label', box.x + box.width / 2, box.y - 4, content, attrs)
            : text('chart-data-label', box.x + box.width / 2, box.y + box.height + 14, content, attrs);
    }

    // ---------------------------------------------------------------
    // Scatter and bubble (comps: one point per company)
    // ---------------------------------------------------------------

    /*
     * Each category is a point named after it: x from the first series, y from
     * the second, and (bubble) its area from the third. The series' names are
     * the axis titles.
     */
    function drawScatter(m, width, height) {
        const locale = m.options.locale || 'pt-BR';
        const [xSeries, ySeries, sizeSeries] = [m.series[0], m.series[1], m.series[2]];
        const valueAt = (series, i) => (series ? series.values[i] : null);
        const found = m.categories.map((name, i) => ({ name: name, x: valueAt(xSeries, i), y: valueAt(ySeries, i),
            size: valueAt(sizeSeries, i) })).filter((point) => point.x !== null && point.y !== null);
        const parts = [];
        const area = frame(m, width, height, [], parts);
        const axis = (series, values, length, spacing) => {
            // A little room past the data, so no point sits on the frame.
            const [low, high] = [Math.min(0, ...values), Math.max(0, ...values)];
            const room = (high - low) * 0.08;
            const ticks = App.charts.niceTicks(low < 0 ? low - room : low, high > 0 ? high + room : high,
                Math.max(2, Math.min(6, Math.floor(length / spacing))));
            const percent = !!series && series.percent;
            const step = ticks.length > 1 ? ticks[1] - ticks[0] : 1;
            const format = { locale: locale, percent: percent, decimals: App.charts.decimalsOf([step], percent) };
            return { ticks: ticks, labels: ticks.map((tick) => App.charts.formatValue(tick, format)) };
        };
        const xAxis = axis(xSeries, found.map((point) => point.x), area.right - area.left, 80);
        const yAxis = axis(ySeries, found.map((point) => point.y), area.bottom - area.top, 45);

        const plot = Object.assign({}, area);
        plot.bottom -= ROW * 2;   // the x numbers, then the x title
        plot.left += LABEL_SIZE + 6 + Math.max(...yAxis.labels.map((label) => textWidth(label, LABEL_SIZE))) + 6;
        plot.right -= Math.max(12, textWidth(xAxis.labels[xAxis.labels.length - 1], LABEL_SIZE) / 2);
        const span = (ticks) => [ticks[0], ticks[ticks.length - 1]];
        const [x0, x1] = span(xAxis.ticks);
        const [y0, y1] = span(yAxis.ticks);
        const xAt = (value) => plot.left + (value - x0) / (x1 - x0) * (plot.right - plot.left);
        const yAt = (value) => plot.bottom - (value - y0) / (y1 - y0) * (plot.bottom - plot.top);

        const grid = [];
        xAxis.ticks.forEach((tick, index) => {
            if (m.options.gridlines !== false) {
                grid.push(line('chart-gridline', xAt(tick), plot.top, xAt(tick), plot.bottom, GRID_COLOR));
            }
            grid.push(text('chart-value-label-x', xAt(tick), plot.bottom + LABEL_SIZE + 2, xAxis.labels[index],
                { 'font-size': LABEL_SIZE, 'text-anchor': 'middle', fill: TEXT_COLOR }));
        });
        yAxis.ticks.forEach((tick, index) => {
            if (m.options.gridlines !== false) {
                grid.push(line('chart-gridline', plot.left, yAt(tick), plot.right, yAt(tick), GRID_COLOR));
            }
            grid.push(text('chart-value-label', plot.left - 6, yAt(tick) + MIDDLE, yAxis.labels[index],
                { 'font-size': LABEL_SIZE, 'text-anchor': 'end', fill: TEXT_COLOR }));
        });
        grid.push(line('chart-axis-line', plot.left, plot.bottom, plot.right, plot.bottom, AXIS_COLOR),
            line('chart-axis-line', plot.left, plot.top, plot.left, plot.bottom, AXIS_COLOR));
        parts.push('<g class="chart-axis">' + grid.join('') + '</g>');

        const titleY = (plot.top + plot.bottom) / 2;
        parts.push(text('chart-axis-title', (plot.left + plot.right) / 2, area.bottom - 4, xSeries ? xSeries.name : '',
            { 'font-size': LABEL_SIZE, 'text-anchor': 'middle', fill: TEXT_COLOR }),
        text('chart-axis-title', area.left + LABEL_SIZE, titleY, ySeries ? ySeries.name : '',
            { 'font-size': LABEL_SIZE, 'text-anchor': 'middle', fill: TEXT_COLOR,
                transform: 'rotate(-90 ' + n(area.left + LABEL_SIZE) + ' ' + n(titleY) + ')' }));

        // Bubbles: the area of each in proportion to its size (so the radius to its square root).
        const bubble = m.type === 'bubble';
        const biggest = Math.max(0, ...found.map((point) => point.size || 0)) || 1;
        const largest = Math.max(8, Math.min(plot.right - plot.left, plot.bottom - plot.top) * 0.14);
        const color = xSeries ? xSeries.color : PALETTE[0];
        const circles = [];
        const labels = [];
        found.forEach((point) => {
            const r = bubble ? 4 + (largest - 4) * Math.sqrt(Math.max(point.size || 0, 0) / biggest) : 6;
            const [cx, cy] = [xAt(point.x), yAt(point.y)];
            circles.push('<circle class="chart-point" cx="' + n(cx) + '" cy="' + n(cy) + '" r="' + n(r) + '" style="fill: ' + color +
                '; fill-opacity: ' + (bubble ? 0.7 : 1) + '; stroke: #FFFFFF; stroke-width: 1;"/>');
            if (m.options.dataLabels !== false) {
                // The name right of the point, or left of it when it would run past the plot.
                const left = cx + r + 4 + textWidth(point.name, 13) > plot.right;
                labels.push(text('chart-data-label', left ? cx - r - 4 : cx + r + 4, cy + MIDDLE, point.name,
                    { 'font-size': 13, fill: TEXT_COLOR, 'text-anchor': left ? 'end' : 'start', style: HALO }));
            }
        });
        parts.push('<g class="chart-series" data-series="0">' + circles.join('') + '</g>');
        parts.push('<g class="chart-data-labels">' + labels.join('') + '</g>');
        return svgOpen(width, height, m.options.title) + parts.join('') + '</svg>';
    }

    // ---------------------------------------------------------------
    // Waterfall (a bridge)
    // ---------------------------------------------------------------

    // Decided in the Phase 6 Q&A: totals in the accent, increases green, decreases red (options.waterfall changes them).
    const WATERFALL_COLORS = { total: PALETTE[0], increase: '#3C9D5D', decrease: '#D9534F' };

    /*
     * Each bar of a waterfall: { role, kind ('total' | 'increase' | 'decrease'),
     * from, to, value }. A change floats from the level reached so far; a
     * start, subtotal or end stands on zero at its own value (as Excel does),
     * or at the level reached when its value is empty, and the next bars go on from it.
     */
    App.charts.waterfallSteps = function waterfallSteps(m) {
        const values = m.series.length > 0 ? m.series[0].values : [];
        let level = 0;
        return m.categories.map((name, i) => {
            const role = m.roles[i];
            const value = values[i];
            if (role !== 'delta') {
                level = value === null || value === undefined ? level : value;
                return { role: role, kind: 'total', from: 0, to: level, value: level };
            }
            const change = value === null || value === undefined ? 0 : value;
            const from = level;
            level += change;
            return { role: role, kind: change >= 0 ? 'increase' : 'decrease', from: from, to: level, value: change };
        });
    };

    function drawWaterfall(m, width, height) {
        const locale = m.options.locale || 'pt-BR';
        const colors = Object.assign({}, WATERFALL_COLORS, m.options.waterfall);
        const steps = App.charts.waterfallSteps(m);
        const parts = [];
        const area = frame(m, width, height, [], parts);
        const length = area.bottom - area.top - ROW;
        const low = Math.min(0, ...steps.map((step) => Math.min(step.from, step.to)));
        const high = Math.max(0, ...steps.map((step) => Math.max(step.from, step.to)));
        const ticks = limitedTicks(low, high, Math.max(2, Math.min(6, Math.floor(length / 45))), m.options.axisMin, m.options.axisMax);
        const step = ticks.length > 1 ? ticks[1] - ticks[0] : 1;
        const tickLabels = ticks.map((tick) => App.charts.formatValue(tick, { locale: locale, decimals: App.charts.decimalsOf([step]) }));

        const plot = Object.assign({}, area);
        plot.left += Math.max(...tickLabels.map((label) => textWidth(label, LABEL_SIZE))) + 6;
        const fit = App.charts.fitCategoryLabels(m.categories, (plot.right - plot.left) / Math.max(steps.length, 1));
        plot.bottom -= fit.height;
        const first = ticks[0];
        const last = ticks[ticks.length - 1];
        const at = (value) => plot.bottom - (Math.min(Math.max(value, first), last) - first) / (last - first) * (plot.bottom - plot.top);

        const grid = [];
        ticks.forEach((tick, index) => {
            if (m.options.gridlines !== false) {
                grid.push(line('chart-gridline', plot.left, at(tick), plot.right, at(tick), GRID_COLOR));
            }
            grid.push(text('chart-value-label', plot.left - 6, at(tick) + MIDDLE, tickLabels[index],
                { 'font-size': LABEL_SIZE, 'text-anchor': 'end', fill: TEXT_COLOR }));
        });
        parts.push('<g class="chart-axis">' + grid.join('') + '</g>');

        const count = Math.max(steps.length, 1);
        const band = (plot.right - plot.left) / count;
        const gap = (typeof m.options.gapWidth === 'number' ? m.options.gapWidth : 60) / 100;
        const thick = band / (1 + gap);
        const values = m.series.length > 0 ? m.series[0].values : [];
        const format = { locale: locale, parens: !!m.options.parens, decimals: App.charts.decimalsOf(values) };
        const rects = [];
        const connectors = [];
        const labels = [];
        steps.forEach((bar, i) => {
            const color = colors[bar.kind];
            const box = { x: plot.left + band * i + (band - thick) / 2, y: at(Math.max(bar.from, bar.to)),
                width: thick, height: Math.abs(at(bar.from) - at(bar.to)) };
            let style = 'fill: ' + color + ';';
            if (m.estimates[i]) {
                style += ' fill-opacity: 0.5; stroke: ' + color + '; stroke-width: 1; stroke-dasharray: 3 2;';
            }
            rects.push('<rect class="chart-bar" data-role="' + bar.kind + '" x="' + n(box.x) + '" y="' + n(box.y) +
                '" width="' + n(box.width) + '" height="' + n(box.height) + '" style="' + style + '"/>');
            if (i < steps.length - 1) {
                // From this bar's level to the next bar, at the level the next one starts from.
                const level = at(bar.to);
                connectors.push(line('chart-connector', box.x + thick, level, box.x + band, level, AXIS_COLOR));
            }
            if (m.options.dataLabels !== false) {
                let content = App.charts.formatValue(bar.value, format);
                if (bar.kind === 'increase') {
                    content = '+' + content;
                }
                const below = bar.kind === 'decrease' || (bar.kind === 'total' && bar.value < 0);
                labels.push(text('chart-data-label', box.x + thick / 2, below ? box.y + box.height + 14 : box.y - 4, content,
                    { 'font-size': 13, fill: TEXT_COLOR, 'text-anchor': 'middle', style: HALO }));
            }
        });
        parts.push('<g class="chart-series" data-series="0">' + rects.join('') + '</g>');
        parts.push('<g class="chart-connectors">' + connectors.join('') + '</g>');
        parts.push(line('chart-axis-line', plot.left, at(0), plot.right, at(0), AXIS_COLOR));
        parts.push(categoryRow(fit, (i) => plot.left + band * (i + 0.5), plot.bottom));
        parts.push('<g class="chart-data-labels">' + labels.join('') + '</g>');
        return svgOpen(width, height, m.options.title) + parts.join('') + '</svg>';
    }

    // ---------------------------------------------------------------
    // render, redraw
    // ---------------------------------------------------------------

    /* Chart JSON as an SVG string of exactly width x height px (a placeholder for types not drawn yet). */
    App.charts.render = function render(data, width, height) {
        const safe = data && typeof data === 'object' ? data : {};
        if (!App.charts.canDraw(safe.type)) {
            return placeholder(safe, width, height);
        }
        const model = App.charts.modelOf(safe);
        if (model.type === 'waterfall') {
            return drawWaterfall(model, width, height);
        }
        if (model.type === 'scatter' || model.type === 'bubble') {
            return drawScatter(model, width, height);
        }
        return isRound(model.type) ? drawRound(model, width, height) : drawCartesian(model, width, height);
    };

    /*
     * Draw a chart element again at its size now (after a resize or an edit).
     * Only types render() can draw: a deck's own drawing of another type is
     * left as it is. Returns true when it was drawn.
     */
    App.charts.redraw = function redraw(figure) {
        if (figure.getAttribute('data-type') !== 'chart') {
            return false;
        }
        const script = figure.querySelector('script.chart-data');
        const data = script && App.charts.parseChartData(script.textContent);
        if (!data || !App.charts.canDraw(data.type)) {
            return false;
        }
        const width = Math.round(parseFloat(figure.style.width)) || 600;
        const height = Math.round(parseFloat(figure.style.height)) || 300;
        figure.querySelectorAll(':scope > svg').forEach((svg) => svg.remove());
        figure.insertAdjacentHTML('beforeend', App.charts.render(data, width, height));
        return true;
    };

    /*
     * Find chart elements that have JSON data but no <svg> yet and draw one.
     * The size comes from the element's inline width/height (contract format).
     * A placeholder of a type that can be drawn now is drawn too (not counted).
     * Returns how many charts were rendered (shown in the import report).
     */
    App.charts.renderMissing = function renderMissing(doc) {
        let count = 0;
        doc.querySelectorAll('[data-type="chart"]').forEach((figure) => {
            const dataScript = figure.querySelector('script.chart-data');
            const svg = figure.querySelector('svg');
            if (svg && svg.hasAttribute('data-chart-placeholder')) {
                App.charts.redraw(figure);
                return;
            }
            if (!dataScript || svg) {
                return;
            }
            const width = Math.round(parseFloat(figure.style.width)) || 600;
            const height = Math.round(parseFloat(figure.style.height)) || 300;
            const data = App.charts.parseChartData(dataScript.textContent);
            figure.insertAdjacentHTML('beforeend', App.charts.render(data, width, height));
            count += 1;
        });
        return count;
    };
})();
