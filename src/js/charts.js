/*
 * charts.js - turns chart JSON into a static SVG (SPEC 5).
 *
 * PHASE 1 STATUS: only a placeholder is drawn. It is a light grey frame with
 * the chart's title and type, so a Copilot deck whose charts carry JSON but no
 * SVG (Appendix A) still shows where each chart is. The real renderer
 * (columns, lines, waterfalls ...) replaces render() in Phase 6, keeping
 * the same signature, and placeholders are marked data-chart-placeholder so
 * Phase 6 can re-render them automatically.
 *
 * render() is a pure function: same input, same output, no randomness (SPEC 5.6).
 *
 * Talks to: importer.js (calls renderMissing during import), util.js.
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

    /*
     * Render chart JSON as an SVG string of exactly width x height pixels.
     * Phase 1: placeholder only (see the file header).
     */
    App.charts.render = function render(data, width, height) {
        const safe = data && typeof data === 'object' ? data : {};
        const title = (safe.options && safe.options.title) || 'Chart';
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
            ' font-family="' + FONT + '" font-size="12" fill="#777">' + escape(describe(safe)) +
            ' — full rendering arrives in Phase 6</text>' +
            '</svg>';
    };

    /*
     * Find chart elements that have JSON data but no <svg> yet and draw one.
     * The size comes from the element's inline width/height (contract format).
     * Returns how many charts were rendered (shown in the import report).
     */
    App.charts.renderMissing = function renderMissing(doc) {
        let count = 0;
        doc.querySelectorAll('[data-type="chart"]').forEach((figure) => {
            const dataScript = figure.querySelector('script.chart-data');
            if (!dataScript || figure.querySelector('svg')) {
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
