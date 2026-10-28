/* Tests for src/js/charts.js (Phase 1: placeholder rendering only) and src/js/template.js */

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
    assertEqual(doc.querySelector('meta[name="deck-format"]').getAttribute('content'), '1');
    assertEqual(doc.documentElement.getAttribute('lang'), 'pt-BR');
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
});
