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
 * Drawn so far (Phase 6 step 1): column, stacked-column, bar, stacked-bar.
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

    // ---------------------------------------------------------------
    // The chart's data, made safe to draw
    // ---------------------------------------------------------------

    const DRAWN = ['column', 'stacked-column', 'bar', 'stacked-bar'];
    const PALETTE = [
        'var(--color-accent, #1F2A44)', 'var(--color-primary, #CC092F)',
        'color-mix(in srgb, var(--color-accent, #1F2A44) 55%, white)', 'color-mix(in srgb, var(--color-primary, #CC092F) 55%, white)',
        '#7F7F7F', '#BFBFBF',
    ];

    /* A chart type render() can draw (not the placeholder). */
    App.charts.canDraw = function canDraw(type) {
        return DRAWN.indexOf(type) !== -1;
    };

    function modelOf(data) {
        const categories = (Array.isArray(data.categories) ? data.categories : []).map((name) => String(name));
        const series = (Array.isArray(data.series) ? data.series : []).map((item, index) => {
            const values = Array.isArray(item && item.values) ? item.values : [];
            return {
                name: String((item && item.name) || 'Series ' + (index + 1)),
                values: categories.map((name, i) => (typeof values[i] === 'number' && isFinite(values[i]) ? values[i] : null)),
                color: (item && item.color) || PALETTE[index % PALETTE.length],
                percent: !!item && item.format === 'percent',
            };
        });
        const estimates = Array.isArray(data.estimates) ? data.estimates : [];
        return {
            type: data.type, categories: categories, series: series,
            estimates: categories.map((name, i) => !!estimates[i]),
            options: Object.assign({}, data.options),
        };
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

    function legendPosition(m) {
        const legend = m.options.legend;
        if (legend === 'none' || legend === 'hidden') {
            return 'none';
        }
        if (legend === 'top' || legend === 'right' || legend === 'bottom') {
            return legend;
        }
        return m.series.length > 1 ? 'bottom' : 'none';
    }

    /* The legend: a coloured square and the name of each series, in a row (top / bottom) or a column (right). */
    function legend(m, position, area) {
        const items = m.series.map((series) => ({ series: series, width: 10 + 4 + textWidth(series.name, LABEL_SIZE) }));
        const parts = [];
        if (position === 'right') {
            items.forEach((item, index) => {
                const y = area.top + index * (LABEL_SIZE + 8);
                parts.push('<rect x="' + n(area.left) + '" y="' + n(y) + '" width="10" height="10" style="fill: ' +
                    item.series.color + ';"/>', text('chart-legend-label', area.left + 14, y + 5 + MIDDLE, item.series.name,
                    { 'font-size': LABEL_SIZE, fill: TEXT_COLOR }));
            });
        } else {
            const total = items.reduce((sum, item) => sum + item.width, 0) + 16 * (items.length - 1);
            let x = area.left + (area.width - total) / 2;
            items.forEach((item) => {
                parts.push('<rect x="' + n(x) + '" y="' + n(area.top + 3) + '" width="10" height="10" style="fill: ' +
                    item.series.color + ';"/>', text('chart-legend-label', x + 14, area.top + 8 + MIDDLE, item.series.name,
                    { 'font-size': LABEL_SIZE, fill: TEXT_COLOR }));
                x += item.width + 16;
            });
        }
        return '<g class="chart-legend">' + parts.join('') + '</g>';
    }

    function svgOpen(width, height, title) {
        return '<svg xmlns="http://www.w3.org/2000/svg" class="chart-svg" width="' + width + '" height="' + height +
            '" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="' + App.util.escapeHtml(title || 'Chart') +
            '" style="font-family: var(--font-body, Calibri, Arial, sans-serif);">';
    }

    // ---------------------------------------------------------------
    // Columns and bars (clustered or stacked)
    // ---------------------------------------------------------------

    function drawBars(m, width, height) {
        const horizontal = m.type === 'bar' || m.type === 'stacked-bar';
        const stacked = m.type === 'stacked-column' || m.type === 'stacked-bar';
        const locale = m.options.locale || 'pt-BR';
        const percentAxis = m.series.length > 0 && m.series.every((series) => series.percent);
        const parts = [];
        const area = { left: PAD, top: PAD, right: width - PAD, bottom: height - PAD };

        if (m.options.title) {
            parts.push(text('chart-title', width / 2, area.top + TITLE_SIZE, m.options.title,
                { 'font-size': TITLE_SIZE, 'font-weight': 'bold', 'text-anchor': 'middle', fill: TEXT_COLOR }));
            area.top += TITLE_SIZE + 12;
        }
        const legendAt = legendPosition(m);
        if (legendAt === 'bottom') {
            area.bottom -= LABEL_SIZE + 10;
            parts.push(legend(m, 'bottom', { left: area.left, width: area.right - area.left, top: area.bottom + 4 }));
        } else if (legendAt === 'top') {
            parts.push(legend(m, 'top', { left: area.left, width: area.right - area.left, top: area.top }));
            area.top += LABEL_SIZE + 12;
        } else if (legendAt === 'right') {
            const widest = Math.max(...m.series.map((series) => textWidth(series.name, LABEL_SIZE))) + 14;
            area.right -= widest + 8;
            parts.push(legend(m, 'right', { left: area.right + 8, top: area.top }));
        }

        // The values' range: stacked bars add up, positives and negatives apart; 0 is always on the axis.
        let low = 0;
        let high = 0;
        m.categories.forEach((name, i) => {
            let up = 0;
            let down = 0;
            m.series.forEach((series) => {
                const value = series.values[i];
                if (value === null) {
                    return;
                }
                if (stacked) {
                    up += Math.max(value, 0);
                    down += Math.min(value, 0);
                } else {
                    up = Math.max(up, value);
                    down = Math.min(down, value);
                }
            });
            high = Math.max(high, up);
            low = Math.min(low, down);
        });
        const categoryWidth = Math.max(0, ...m.categories.map((name) => textWidth(name, LABEL_SIZE)));
        const length = horizontal ? area.right - area.left - categoryWidth : area.bottom - area.top - ROW;
        const ticks = App.charts.niceTicks(low, high, Math.max(2, Math.min(6, Math.floor(length / (horizontal ? 80 : 45)))));
        const step = ticks.length > 1 ? ticks[1] - ticks[0] : 1;
        const tickFormat = { locale: locale, percent: percentAxis, decimals: App.charts.decimalsOf([step], percentAxis) };
        const tickLabels = ticks.map((tick) => App.charts.formatValue(tick, tickFormat));

        const plot = Object.assign({}, area);
        plot.bottom -= ROW;   // the row of category names (columns) or of axis numbers (bars)
        plot.left += horizontal ? categoryWidth + 8 : Math.max(...tickLabels.map((label) => textWidth(label, LABEL_SIZE))) + 6;
        const first = ticks[0];
        const last = ticks[ticks.length - 1];
        const at = horizontal
            ? (value) => plot.left + (value - first) / (last - first) * (plot.right - plot.left)
            : (value) => plot.bottom - (value - first) / (last - first) * (plot.bottom - plot.top);

        // Gridlines and the value axis's numbers.
        const grid = [];
        ticks.forEach((tick, index) => {
            const p = at(tick);
            if (m.options.gridlines !== false) {
                grid.push(horizontal ? line('chart-gridline', p, plot.top, p, plot.bottom, GRID_COLOR)
                    : line('chart-gridline', plot.left, p, plot.right, p, GRID_COLOR));
            }
            grid.push(horizontal
                ? text('chart-value-label', p, plot.bottom + LABEL_SIZE + 2, tickLabels[index], { 'font-size': LABEL_SIZE, 'text-anchor': 'middle', fill: TEXT_COLOR })
                : text('chart-value-label', plot.left - 6, p + MIDDLE, tickLabels[index], { 'font-size': LABEL_SIZE, 'text-anchor': 'end', fill: TEXT_COLOR }));
        });
        parts.push('<g class="chart-axis">' + grid.join('') + '</g>');

        // The bars: each category gets a band; its bars fill part of it (the rest is the gap).
        const count = Math.max(m.categories.length, 1);
        const band = (horizontal ? plot.bottom - plot.top : plot.right - plot.left) / count;
        const gap = (typeof m.options.gapWidth === 'number' ? m.options.gapWidth : 100) / 100;
        const group = band / (1 + gap);
        const thick = stacked ? group : group / Math.max(m.series.length, 1);
        const up = m.categories.map(() => 0);
        const down = m.categories.map(() => 0);
        const labels = [];
        m.series.forEach((series, s) => {
            const rects = [];
            const labelFormat = { locale: locale, percent: series.percent, decimals: App.charts.decimalsOf(series.values, series.percent) };
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
                const to = from + value;
                const start = band * i + (band - group) / 2 + (stacked ? 0 : s * thick);
                const [a, b] = [at(from), at(to)];
                const box = horizontal
                    ? { x: Math.min(a, b), y: (horizontal ? plot.top : 0) + start, width: Math.abs(b - a), height: thick }
                    : { x: plot.left + start, y: Math.min(a, b), width: thick, height: Math.abs(b - a) };
                let style = 'fill: ' + series.color + ';';
                if (m.estimates[i]) {
                    style += ' fill-opacity: 0.5; stroke: ' + series.color + '; stroke-width: 1; stroke-dasharray: 3 2;';
                }
                rects.push('<rect class="chart-bar" x="' + n(box.x) + '" y="' + n(box.y) + '" width="' + n(box.width) +
                    '" height="' + n(box.height) + '" style="' + style + '"/>');
                if (m.options.dataLabels) {
                    labels.push(dataLabel(App.charts.formatValue(value, labelFormat), box, value, horizontal, stacked));
                }
            });
            parts.push('<g class="chart-series" data-series="' + s + '">' + rects.join('') + '</g>');
        });

        // The zero line, then the category names.
        const zero = at(0);
        parts.push(horizontal ? line('chart-axis-line', zero, plot.top, zero, plot.bottom, AXIS_COLOR)
            : line('chart-axis-line', plot.left, zero, plot.right, zero, AXIS_COLOR));
        const names = m.categories.map((name, i) => (horizontal
            ? text('chart-category-label', plot.left - 6, plot.top + band * (i + 0.5) + MIDDLE, name, { 'font-size': LABEL_SIZE, 'text-anchor': 'end', fill: TEXT_COLOR })
            : text('chart-category-label', plot.left + band * (i + 0.5), plot.bottom + LABEL_SIZE + 2, name, { 'font-size': LABEL_SIZE, 'text-anchor': 'middle', fill: TEXT_COLOR })));
        parts.push('<g class="chart-categories">' + names.join('') + '</g>');
        parts.push('<g class="chart-data-labels">' + labels.filter(Boolean).join('') + '</g>');
        return svgOpen(width, height, m.options.title) + parts.join('') + '</svg>';
    }

    /* A bar's value: past its end (clustered), or in its middle in white when it fits (stacked). */
    function dataLabel(content, box, value, horizontal, stacked) {
        const attrs = { 'font-size': 13, fill: TEXT_COLOR, 'text-anchor': 'middle' };
        if (stacked) {
            const fits = horizontal ? box.width > textWidth(content, 13) + 4 : box.height > 16;
            return fits ? text('chart-data-label', box.x + box.width / 2, box.y + box.height / 2 + 4, content,
                Object.assign(attrs, { fill: '#FFFFFF' })) : '';
        }
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
    // render, redraw
    // ---------------------------------------------------------------

    /* Chart JSON as an SVG string of exactly width x height px (a placeholder for types not drawn yet). */
    App.charts.render = function render(data, width, height) {
        const safe = data && typeof data === 'object' ? data : {};
        if (!App.charts.canDraw(safe.type)) {
            return placeholder(safe, width, height);
        }
        return drawBars(modelOf(safe), width, height);
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
