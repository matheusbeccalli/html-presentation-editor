/*
 * Tests for src/js/charts.js (the SVG renderer, Phase 6; a placeholder for types
 * not drawn yet) and src/js/template.js. Fake numbers only.
 */

const SAMPLE_CHART = {
    version: 1, type: 'combo', categories: ['2022', '2023'],
    series: [{ name: 'Receita', values: [1, 2] }],
    options: { title: 'Receita & <margem>' },
};

test('charts: render returns an SVG of the requested size', () => {
    const svg = App.charts.render(SAMPLE_CHART, 600, 300);
    assert(svg.startsWith('<svg'), 'starts with <svg');
    assertIncludes(svg, 'width="600"');
    assertIncludes(svg, 'height="300"');
    assertIncludes(svg, 'viewBox="0 0 600 300"');
});

test('charts: render is deterministic', () => {
    assertEqual(App.charts.render(SAMPLE_CHART, 400, 200), App.charts.render(SAMPLE_CHART, 400, 200));
});

test('charts: render escapes the title', () => {
    const svg = App.charts.render(SAMPLE_CHART, 400, 200);
    assertIncludes(svg, 'Receita &amp; &lt;margem&gt;');
    assertNotIncludes(svg, '<margem>');
});

test('charts: render copes with missing or broken data', () => {
    assert(App.charts.render(null, 300, 150).startsWith('<svg'), 'null data');
    assert(App.charts.render({}, 300, 150).startsWith('<svg'), 'empty object');
});

test('charts: parseChartData returns null for invalid JSON', () => {
    assertEqual(App.charts.parseChartData('{not json'), null);
    assertEqual(App.charts.parseChartData('{"version":1}').version, 1);
});

test('charts: renderMissing adds an SVG only where it is missing', () => {
    const doc = parseDoc(
        '<body>' +
        '<figure class="el" data-type="chart" style="left:0px; top:0px; width:500px; height:250px">' +
        '<script type="application/json" class="chart-data">{"version":1,"type":"column"}</script></figure>' +
        '<figure class="el" data-type="chart" style="width:500px; height:250px">' +
        '<script type="application/json" class="chart-data">{}</script><svg id="existing"></svg></figure>' +
        '</body>'
    );
    const count = App.charts.renderMissing(doc);
    assertEqual(count, 1);
    const svgs = doc.querySelectorAll('figure svg');
    assertEqual(svgs.length, 2);
    assertEqual(svgs[0].getAttribute('width'), '500');
    assertEqual(svgs[1].id, 'existing');
});

test('template: the blank deck follows the contract', () => {
    const doc = parseDoc(App.template.newDeckHtml());
    assertEqual(doc.querySelector('meta[name="deck-format"]').getAttribute('content'), '3');
    assertEqual(doc.documentElement.getAttribute('lang'), 'pt-BR');
    doc.querySelectorAll('.el[data-type="text"]').forEach((el) => {
        assert(el.children.length > 0 && Array.from(el.children).every((c) => c.matches('p[data-list][data-level]')),
            'text uses the flat paragraph model: ' + el.innerHTML);
    });
    assert(doc.querySelector('.el p[data-list="bullet"]'), 'the content slide has bullets');
    const slides = doc.querySelectorAll('section.slide');
    assert(slides.length >= 1, 'has slides');
    slides.forEach((s) => assert(s.getAttribute('data-slide-id'), 'slide id'));
    const ids = [...doc.querySelectorAll('.el')].map((e) => e.getAttribute('data-id'));
    assertEqual(new Set(ids).size, ids.length, 'element ids are unique');
    assertIncludes(doc.querySelector('style').textContent, '--color-primary');
});

test('template: the blank deck imports as a contract deck with no fixes', async () => {
    const result = await App.importer.importDeck(App.template.newDeckHtml());
    assert(result.report.isContract, 'contract');
    assertEqual(result.report.fixes, []);
    assertEqual(result.report.textConverted, 0, 'already in the text model');
    assert(!App.importer.reportHasChanges(result.report), 'a new deck opens clean');
});

// ---------------------------------------------------------------------------
// The renderer (Phase 6)
// ---------------------------------------------------------------------------

/* The rendered SVG as a document, to measure what was drawn. */
function drawn(data, width, height) {
    return new DOMParser().parseFromString(App.charts.render(data, width || 600, height || 300), 'image/svg+xml');
}

function bars(svg, series) {
    return Array.from(svg.querySelectorAll('.chart-series' + (series === undefined ? '' : '[data-series="' + series + '"]') +
        ' rect.chart-bar')).map((rect) => ['x', 'y', 'width', 'height'].reduce((box, key) => {
        box[key] = parseFloat(rect.getAttribute(key));
        return box;
    }, {}));
}

function texts(svg, selector) {
    return Array.from(svg.querySelectorAll(selector), (node) => node.textContent);
}

const near = (a, b) => Math.abs(a - b) < 0.6;

test('charts: nice axis numbers', () => {
    assertEqual(App.charts.niceTicks(0, 702, 5), [0, 200, 400, 600, 800]);
    assertEqual(App.charts.niceTicks(-35, 120, 5), [-50, 0, 50, 100, 150]);
    assertEqual(App.charts.niceTicks(0, 0.23, 5), [0, 0.1, 0.2, 0.3]);
    assertEqual(App.charts.niceTicks(0, 7, 5), [0, 2, 4, 6, 8]);
    const empty = App.charts.niceTicks(0, 0, 5);
    assertEqual([empty[0], empty[empty.length - 1]], [0, 1], 'no data: still an axis, 0 to 1');
});

test('charts: labels are written the deck\'s way (Phase 4 number code)', () => {
    assertEqual(App.charts.formatValue(2450.5, { locale: 'pt-BR', decimals: 1 }), '2.450,5');
    assertEqual(App.charts.formatValue(1234567, { locale: 'en-US', decimals: 0 }), '1,234,567');
    assertEqual(App.charts.formatValue(0.195, { locale: 'pt-BR', percent: true, decimals: 1 }), '19,5%');
    assertEqual(App.charts.formatValue(-3.5, { locale: 'pt-BR', decimals: 1, parens: true }), '(3,5)');
    assertEqual(App.charts.formatValue(0.1 + 0.2, { locale: 'en-US', decimals: 1 }), '0.3', 'no floating-point noise');
    assertEqual(App.charts.decimalsOf([410, 498.5, 587]), 1);
    assertEqual(App.charts.decimalsOf([0.18, 0.195], true), 1, 'percent: 18% and 19,5%');
    assertEqual(App.charts.decimalsOf([1.2345]), 2, 'at most two');
});

const COLUMNS = {
    version: 1, type: 'column', categories: ['2022', '2023', '2024'],
    series: [{ name: 'Receita', values: [100, 200, 300] }], options: { locale: 'pt-BR' },
};

test('charts: a column chart: one bar per category, in order, heights in proportion', () => {
    const svg = drawn(COLUMNS);
    const found = bars(svg);
    assertEqual(found.length, 3);
    assert(found[0].x < found[1].x && found[1].x < found[2].x, 'left to right');
    assert(near(found[1].height, 2 * found[0].height) && near(found[2].height, 3 * found[0].height), JSON.stringify(found));
    assert(near(found[0].y + found[0].height, found[2].y + found[2].height), 'all stand on the same axis');
    assertEqual(texts(svg, '.chart-category-label'), ['2022', '2023', '2024']);
    assertEqual(texts(svg, '.chart-value-label'), ['0', '100', '200', '300']);
    assertEqual(svg.querySelectorAll('.chart-gridline').length, 4, 'one gridline per axis number');
    assertEqual(svg.documentElement.getAttribute('width'), '600');
    assertEqual(svg.querySelectorAll('[data-chart-placeholder]').length, 0);
});

test('charts: clustered columns side by side, stacked columns on top of each other', () => {
    const data = Object.assign({}, COLUMNS, {
        series: [{ name: 'A', values: [100, 200, 300] }, { name: 'B', values: [50, 50, 50] }],
    });
    const clustered = drawn(data);
    const [a, b] = [bars(clustered, 0), bars(clustered, 1)];
    assert(a.every((bar, i) => bar.x + bar.width <= b[i].x + 0.01 && near(bar.width, b[i].width)), 'B right of A, same width');
    const stacked = drawn(Object.assign({}, data, { type: 'stacked-column' }));
    const [sa, sb] = [bars(stacked, 0), bars(stacked, 1)];
    assert(sa.every((bar, i) => near(sb[i].y + sb[i].height, bar.y) && near(sb[i].x, bar.x)), 'B sits on A');
    assertEqual(texts(stacked, '.chart-legend text'), ['A', 'B'], 'two series: a legend');
});

test('charts: horizontal bars, first category on top; negative values go below (left of) zero', () => {
    const svg = drawn(Object.assign({}, COLUMNS, { type: 'bar' }));
    const found = bars(svg);
    assert(found[0].y < found[1].y && found[1].y < found[2].y, 'top to bottom');
    assert(near(found[2].width, 3 * found[0].width), 'lengths in proportion');
    const negative = drawn(Object.assign({}, COLUMNS, { series: [{ name: 'R', values: [100, -50, 25] }] }));
    const [up, down] = bars(negative);
    assert(near(down.y, up.y + up.height), 'the negative bar hangs from the zero line');
});

test('charts: estimate years lighter with a dashed outline; data labels; colours from the theme', () => {
    const data = Object.assign({}, COLUMNS, {
        categories: ['2022', '2023', '2024E'], estimates: [false, false, true],
        series: [{ name: 'A', values: [1234, 200, 300] }, { name: 'B', values: [1, 2, 3], color: '#00b050' }],
        options: { locale: 'pt-BR', dataLabels: true },
    });
    const svg = drawn(data);
    const rects = svg.querySelectorAll('.chart-series[data-series="0"] rect.chart-bar');
    assertIncludes(rects[2].getAttribute('style'), 'fill-opacity: 0.5');
    assertIncludes(rects[2].getAttribute('style'), 'stroke-dasharray');
    assertNotIncludes(rects[0].getAttribute('style'), 'fill-opacity');
    assertIncludes(rects[0].getAttribute('style'), 'var(--color-accent');
    assertIncludes(svg.querySelector('.chart-series[data-series="1"] rect').getAttribute('style'), '#00b050');
    assert(texts(svg, '.chart-data-label').indexOf('1.234') !== -1, texts(svg, '.chart-data-label').join(' '));
    const plain = drawn(Object.assign({}, data, { options: { legend: 'none', gridlines: false } }));
    assertEqual([plain.querySelectorAll('.chart-legend').length, plain.querySelectorAll('.chart-gridline').length], [0, 0]);
});

test('charts: redraw after a resize draws at the new size; a type not drawn yet is left as it is', () => {
    const doc = parseDoc('<figure class="el" data-type="chart" style="width: 400px; height: 200px">' +
        '<script type="application/json" class="chart-data">' + JSON.stringify(COLUMNS) + '</script><svg></svg></figure>' +
        '<figure class="el" data-type="chart" style="width: 400px; height: 200px">' +
        '<script type="application/json" class="chart-data">{"type":"combo"}</script><svg id="hand-drawn"></svg></figure>');
    const [figure, combo] = doc.querySelectorAll('figure');
    figure.style.width = '500px';
    App.charts.redraw(figure);
    assertEqual(figure.querySelectorAll('svg').length, 1);
    assertEqual(figure.querySelector('svg').getAttribute('width'), '500');
    App.charts.redraw(combo);
    assertEqual(combo.querySelector('svg').id, 'hand-drawn');
});

test('charts: on open, a placeholder of a type that can now be drawn is drawn (not counted as missing)', () => {
    const doc = parseDoc('<figure class="el" data-type="chart" style="width: 400px; height: 200px">' +
        '<script type="application/json" class="chart-data">' + JSON.stringify(COLUMNS) + '</script>' +
        '<svg data-chart-placeholder="true"></svg></figure>');
    assertEqual(App.charts.renderMissing(doc), 0);
    assertEqual(doc.querySelectorAll('svg[data-chart-placeholder]').length, 0);
    assertEqual(doc.querySelectorAll('rect.chart-bar').length, 3);
});
