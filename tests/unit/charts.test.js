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
        '<script type="application/json" class="chart-data">{"type":"radar"}</script><svg id="hand-drawn"></svg></figure>');
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

// ---------------------------------------------------------------------------
// Lines, combo, donut and pie (Phase 6 step 2)
// ---------------------------------------------------------------------------

/* The points of the first chart line: [[x, y], ...]. */
function linePoints(svg, series) {
    const path = svg.querySelector('.chart-series[data-series="' + (series || 0) + '"] path.chart-line');
    return path.getAttribute('d').split(/[ML]/).filter(Boolean).map((pair) => pair.trim().split(' ').map(Number));
}

test('charts: a line chart: one point per category, at the middle of its category, higher for more', () => {
    const svg = drawn(Object.assign({}, COLUMNS, { type: 'line' }));
    const points = linePoints(svg);
    assertEqual(points.length, 3);
    const names = Array.from(svg.querySelectorAll('.chart-category-label'), (label) => Number(label.getAttribute('x')));
    assert(points.every(([x], i) => near(x, names[i])), 'under each category name: ' + JSON.stringify(points));
    assert(points[0][1] > points[1][1] && points[1][1] > points[2][1], 'rising');
    assertEqual(svg.querySelectorAll('.chart-marker').length, 3);
    assertEqual(bars(svg).length, 0, 'no bars');
});

test('charts: a line into an estimate year is dashed, its marker hollow', () => {
    const svg = drawn(Object.assign({}, COLUMNS, { type: 'line', estimates: [false, false, true] }));
    const dashed = svg.querySelector('path.chart-line-estimate');
    assert(dashed && /stroke-dasharray/.test(dashed.getAttribute('style')), 'a dashed piece');
    assertEqual(linePoints(svg).length, 2, 'the solid line stops at the last actual year');
    const markers = svg.querySelectorAll('.chart-marker');
    assertIncludes(markers[2].getAttribute('style'), 'fill: #FFFFFF');
});

const SPEC_COMBO = {
    version: 1, type: 'combo', categories: ['2022', '2023', '2024', '2025E'], estimates: [false, false, false, true],
    series: [
        { name: 'Receita (R$ mn)', type: 'column', axis: 'primary', values: [410, 498, 587, 702] },
        { name: 'Margem EBITDA', type: 'line', axis: 'secondary', values: [0.18, 0.20, 0.21, 0.23], format: 'percent' },
    ],
    options: { title: 'Receita e margem', legend: 'bottom', dataLabels: true, locale: 'pt-BR' },
};

test('charts: combo: revenue columns and the margin as a line on a second axis in %', () => {
    const svg = drawn(SPEC_COMBO, 760, 420);
    assertEqual(bars(svg).length, 4, 'four columns');
    assertEqual(linePoints(svg, 1).length, 3, 'the margin line (the 2025E piece dashed)');
    const right = texts(svg, '.chart-value-label-secondary');
    assert(right.length >= 2 && right.every((label) => /%$/.test(label)), 'the right axis in %: ' + right.join(' '));
    assert(texts(svg, '.chart-data-label').indexOf('23%') !== -1, 'the margin labels in %');
    const revenue = Array.from(svg.querySelectorAll('.chart-data-label')).find((label) => label.textContent === '587');
    assertEqual(revenue.getAttribute('fill'), '#FFFFFF', 'a combo\'s column numbers inside the columns, clear of the line\'s');
    const columns = bars(svg);
    const points = linePoints(svg, 1);
    assert(points.every(([x], i) => near(x, columns[i].x + columns[i].width / 2)), 'each point above its column');
});

test('charts: combo as Copilot writes it (no types, no axis): first series columns, a margin series on a % axis', () => {
    const svg = drawn({
        version: 1, type: 'combo', categories: ['2023', '2024', '2025E', '2026E'],
        series: [{ name: 'Receita (R$ mn)', values: [520, 610, 730, 880] }, { name: 'Margem EBITDA', values: [0.38, 0.39, 0.41, 0.42] }],
        options: { title: 'Receita e margem EBITDA' },
    }, 760, 420);
    assertEqual(bars(svg).length, 4);
    assert(svg.querySelector('.chart-series[data-series="1"] path.chart-line'), 'the margin as a line');
    assert(texts(svg, '.chart-value-label-secondary').some((label) => label === '40%'), texts(svg, '.chart-value-label-secondary').join(' '));
});

test('charts: donut: one slice per category, starting at the top, in shares of the total', () => {
    const svg = drawn({ version: 1, type: 'donut', categories: ['Fundo A', 'Fundadores', 'Outros'],
        series: [{ name: 'Participação', values: [50, 30, 20] }], options: { locale: 'pt-BR' } }, 500, 300);
    const slices = Array.from(svg.querySelectorAll('path.chart-slice'));
    assertEqual(slices.length, 3);
    assert(slices.every((slice) => (slice.getAttribute('d').match(/A/g) || []).length === 2), 'a donut: outer and inner arcs');
    assertEqual(texts(svg, '.chart-data-label'), ['50%', '30%', '20%']);
    assertEqual(texts(svg, '.chart-legend-label'), ['Fundo A', 'Fundadores', 'Outros']);
    const fills = slices.map((slice) => slice.getAttribute('style'));
    assertEqual(new Set(fills).size, 3, 'each slice its own colour');
    const [, x, y] = /^M([\d.]+) ([\d.]+)/.exec(slices[0].getAttribute('d')).map(Number);
    const circle = svg.querySelector('.chart-plot');
    assert(near(x, Number(circle.getAttribute('data-cx'))) && y < Number(circle.getAttribute('data-cy')), 'starts at 12 o\'clock');
});

test('charts: pie: wedges from the centre; empty and negative values are left out; one category is a full circle', () => {
    const pie = drawn({ version: 1, type: 'pie', categories: ['A', 'B', 'C', 'D'],
        series: [{ name: 'S', values: [3, 1, 0, -2] }] });
    const slices = Array.from(pie.querySelectorAll('path.chart-slice'));
    assertEqual(slices.length, 2);
    assert(slices.every((slice) => (slice.getAttribute('d').match(/A/g) || []).length === 1), 'one arc each');
    assertEqual(texts(pie, '.chart-data-label'), ['75%', '25%']);
    const whole = drawn({ version: 1, type: 'pie', categories: ['A'], series: [{ name: 'S', values: [5] }] });
    assertEqual(whole.querySelectorAll('path.chart-slice').length, 1, 'drawn even at 100%');
});

// ---------------------------------------------------------------------------
// Waterfall (Phase 6 step 3)
// ---------------------------------------------------------------------------

const BRIDGE = {
    version: 1, type: 'waterfall',
    categories: ['EBITDA 2024', 'Novos parques', 'Eficiência', 'Custos corporativos', 'EBITDA 2026E'],
    series: [{ name: 'R$ mn', values: [240, 95, 30, -25, 340] }], options: { title: 'Ponte do EBITDA (R$ mn)' },
};

test('charts: waterfall steps: without roles the first bar is the start and the last the end (as Copilot writes them)', () => {
    const steps = App.charts.waterfallSteps(App.charts.modelOf(BRIDGE));
    assertEqual(steps.map((step) => [step.role, step.from, step.to]),
        [['start', 0, 240], ['delta', 240, 335], ['delta', 335, 365], ['delta', 365, 340], ['end', 0, 340]]);
    assertEqual(steps.map((step) => step.kind), ['total', 'increase', 'increase', 'decrease', 'total']);
});

test('charts: waterfall roles: a subtotal; a total left empty is the running total', () => {
    const steps = App.charts.waterfallSteps(App.charts.modelOf({
        type: 'waterfall', categories: ['A', 'B', 'Sub', 'C', 'Fim'], roles: ['start', 'delta', 'subtotal', 'delta', 'end'],
        series: [{ name: 'x', values: [100, -30, null, 50, null] }],
    }));
    assertEqual(steps.map((step) => [step.from, step.to]), [[0, 100], [100, 70], [0, 70], [70, 120], [0, 120]]);
});

test('charts: a waterfall draws floating bars, green up, red down, totals in the accent, with connectors', () => {
    const svg = drawn(Object.assign({}, BRIDGE, { estimates: [false, false, false, false, true] }), 760, 420);
    const found = bars(svg);
    assertEqual(found.length, 5);
    assert(near(found[1].y + found[1].height, found[0].y), 'the first increase starts at the top of the start bar');
    assert(near(found[3].y, found[2].y), 'the decrease hangs from the level reached');
    const fills = Array.from(svg.querySelectorAll('rect.chart-bar'), (rect) => rect.getAttribute('style'));
    assertIncludes(fills[1], '#3C9D5D');
    assertIncludes(fills[3], '#D9534F');
    assertIncludes(fills[0], 'var(--color-accent');
    assertIncludes(fills[4], 'fill-opacity: 0.5', 'the 2026E end lighter');
    const connectors = Array.from(svg.querySelectorAll('.chart-connector'), (line) => Number(line.getAttribute('y1')));
    assertEqual(connectors.length, 4);
    assert(near(connectors[0], found[0].y) && near(connectors[2], found[2].y), 'at each level reached');
    assertEqual(texts(svg, '.chart-data-label'), ['240', '+95', '+30', '-25', '340'], 'labelled by default, changes signed');
    const parens = drawn(Object.assign({}, BRIDGE, { options: { parens: true } }));
    assert(texts(parens, '.chart-data-label').indexOf('(25)') !== -1, 'negatives in parentheses when asked');
    const colours = drawn(Object.assign({}, BRIDGE, { options: { waterfall: { increase: '#0070c0' } } }));
    assertIncludes(colours.querySelectorAll('rect.chart-bar')[1].getAttribute('style'), '#0070c0');
});

// ---------------------------------------------------------------------------
// 100% stacked, scatter / bubble, area (Phase 6 step 4)
// ---------------------------------------------------------------------------

const MIX = {
    version: 1, type: 'stacked-column-100', categories: ['2023', '2024'],
    series: [{ name: 'Varejo', values: [1, 3] }, { name: 'Atacado', values: [3, 1] }],
    options: { locale: 'pt-BR', dataLabels: true },
};

test('charts: 100% stacked columns: each stack fills the axis up to 100%, labelled as shares', () => {
    const svg = drawn(MIX);
    const [a, b] = [bars(svg, 0), bars(svg, 1)];
    assert(near(a[0].height + b[0].height, a[1].height + b[1].height), 'both stacks the same height');
    assert(near(a[0].height * 3, b[0].height), '25% and 75%');
    const axis = texts(svg, '.chart-value-label');
    assertEqual([axis[0], axis[axis.length - 1]], ['0%', '100%']);
    assertEqual(texts(svg, '.chart-data-label').sort(), ['25%', '25%', '75%', '75%']);
});

test('charts: 100% stacked bars: horizontal, each bar the full width', () => {
    const svg = drawn(Object.assign({}, MIX, { type: 'stacked-bar-100' }));
    const [a, b] = [bars(svg, 0), bars(svg, 1)];
    assert(near(a[0].width + b[0].width, a[1].width + b[1].width) && a[0].y < a[1].y, JSON.stringify([a, b]));
});

const COMPS = {
    version: 1, type: 'scatter', categories: ['Alfa', 'Beta', 'Gama'],
    series: [{ name: 'Crescimento', values: [0.05, 0.10, 0.15], format: 'percent' }, { name: 'EV/EBITDA', values: [8, 10, 12] }],
    options: { locale: 'pt-BR' },
};

function points(svg) {
    return Array.from(svg.querySelectorAll('circle.chart-point'), (c) => ['cx', 'cy', 'r'].map((key) => Number(c.getAttribute(key))));
}

test('charts: scatter: one point per company at (first series, second series), named; the series name the axes', () => {
    const svg = drawn(COMPS);
    const found = points(svg);
    assertEqual(found.length, 3);
    assert(found[0][0] < found[1][0] && found[1][0] < found[2][0], 'more growth: further right');
    assert(found[0][1] > found[1][1] && found[1][1] > found[2][1], 'higher multiple: higher up');
    assertEqual(texts(svg, '.chart-data-label'), ['Alfa', 'Beta', 'Gama']);
    assertEqual(texts(svg, '.chart-axis-title'), ['Crescimento', 'EV/EBITDA']);
    assert(texts(svg, '.chart-value-label-x').some((label) => /%$/.test(label)), 'growth in %');
});

test('charts: bubble: the third series sets each bubble\'s area', () => {
    const svg = drawn(Object.assign({}, COMPS, { type: 'bubble',
        series: COMPS.series.concat([{ name: 'Receita', values: [100, 400, 900] }]) }));
    const radii = points(svg).map((point) => point[2]);
    assert(radii[0] < radii[1] && radii[1] < radii[2], 'bigger company, bigger bubble: ' + radii);
    assert(near((radii[2] - 4) / (radii[0] - 4), 3), 'areas in proportion (radius ~ square root): ' + radii);
});

test('charts: area: filled down to zero under its line; stacked areas sit on each other', () => {
    const data = Object.assign({}, COLUMNS, { type: 'area' });
    const svg = drawn(data);
    const area = svg.querySelector('path.chart-area');
    assert(area && /fill-opacity/.test(area.getAttribute('style')), 'a filled area');
    assertEqual(linePoints(svg).length, 3, 'its top line');
    const two = Object.assign({}, COLUMNS, { series: [{ name: 'A', values: [100, 200, 300] }, { name: 'B', values: [50, 50, 50] }] });
    const stackedArea = drawn(Object.assign({}, two, { type: 'stacked-area' }));
    const stackedColumns = drawn(Object.assign({}, two, { type: 'stacked-column' }));
    const top = linePoints(stackedArea, 1)[0][1];
    assert(near(top, bars(stackedColumns, 1)[0].y), 'B\'s line at A + B (as the stacked column\'s top)');
});
