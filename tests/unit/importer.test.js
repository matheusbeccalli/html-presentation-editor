/* Tests for src/js/importer.js (cleaning) and src/js/normalize.js (layout conversion) */

// ---------- sanitize: scripts and other active content ----------

test('importer: sanitize removes inline and external scripts and lists them', () => {
    const doc = parseDoc(
        '<html><head><script src="https://cdn.example.com/chart.js"></script></head>' +
        '<body><script>let current = 0; function next() {}</script></body></html>'
    );
    const result = App.importer.sanitize(doc);
    assertEqual(doc.querySelectorAll('script').length, 0);
    assertEqual(result.scripts.length, 2);
    assertIncludes(result.scripts[0].label, 'https://cdn.example.com/chart.js');
    assertIncludes(result.scripts[1].label, 'let current');
});

test('importer: sanitize keeps chart JSON data scripts', () => {
    const doc = parseDoc(
        '<body><figure class="el" data-type="chart"><script type="application/json" class="chart-data">{"version":1}</script></figure></body>'
    );
    const result = App.importer.sanitize(doc);
    assertEqual(result.scripts.length, 0);
    assertEqual(doc.querySelectorAll('script.chart-data').length, 1);
});

test('importer: sanitize silently drops our own player (it is re-added on save)', () => {
    const doc = parseDoc('<head><style data-deck-player>.x{}</style></head><body><script data-deck-player>(function(){})()</script></body>');
    const result = App.importer.sanitize(doc);
    assertEqual(result.scripts.length, 0);
    assertEqual(doc.querySelectorAll('[data-deck-player]').length, 0);
});

test('importer: sanitize removes what the player adds while it runs (counter, classes, scale)', () => {
    const doc = parseDoc(
        '<html class="deck-player-on" style="--deck-player-scale: 0.5"><body>' +
        '<section class="slide deck-player-current" data-slide-id="s1"></section>' +
        '<div class="deck-player-counter">1 / 1</div></body></html>'
    );
    App.importer.sanitize(doc);
    assertEqual(doc.documentElement.getAttribute('class'), null);
    assertEqual(doc.documentElement.getAttribute('style'), null);
    assertEqual(doc.querySelector('.slide').getAttribute('class'), 'slide');
    assertEqual(doc.querySelectorAll('.deck-player-counter').length, 0);
});

test('importer: sanitize strips inline event handlers and javascript: links', () => {
    const doc = parseDoc('<body><button onclick="next()">Next</button><a href="javascript:go()">Go</a><div onmouseover="x()"></div></body>');
    const result = App.importer.sanitize(doc);
    assertEqual(result.handlers, 3);
    assertEqual(doc.querySelector('button').getAttribute('onclick'), null);
    assertEqual(doc.querySelector('a').getAttribute('href'), null);
});

test('importer: sanitize removes iframes, objects, embeds, base and meta refresh/CSP', () => {
    const doc = parseDoc(
        '<head><base href="https://x.com/"><meta http-equiv="refresh" content="5">' +
        '<meta http-equiv="Content-Security-Policy" content="default-src *"></head>' +
        '<body><iframe src="https://x.com"></iframe><object data="x.swf"></object><embed src="y"></body>'
    );
    const result = App.importer.sanitize(doc);
    assertEqual(result.other.length, 6);
    assertEqual(doc.querySelectorAll('iframe, object, embed, base, meta[http-equiv]').length, 0);
});

// ---------- external references (blocked by the CSP) ----------

test('importer: findExternalRefs lists remote fonts, stylesheets, images and css urls', () => {
    const doc = parseDoc(
        '<head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">' +
        '<style>@import url("https://example.com/theme.css");' +
        '@font-face { font-family: X; src: url(https://example.com/x.woff2); }' +
        '.hero { background: url(//cdn.example.com/bg.jpg); }</style></head>' +
        '<body><img src="https://example.com/logo.png"><div style="background-image:url(\'http://e.com/a.png\')"></div></body>'
    );
    const refs = App.importer.findExternalRefs(doc);
    assertEqual(refs.remote.map((r) => r.kind), ['stylesheet', 'import', 'font', 'css-url', 'image', 'css-url']);
    assertIncludes(refs.remote[0].url, 'fonts.googleapis.com');
});

test('importer: findExternalRefs lists relative file references separately', () => {
    const doc = parseDoc('<body><img src="images/logo.png"><img src="data:image/png;base64,AAAA"></body>');
    const refs = App.importer.findExternalRefs(doc);
    assertEqual(refs.remote.length, 0);
    assertEqual(refs.local.map((r) => r.url), ['images/logo.png']);
});

test('importer: removeRemoteRefs removes them and keeps everything else', () => {
    const doc = parseDoc(
        '<head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">' +
        '<style>@import url("https://example.com/theme.css"); .a { color: red; }' +
        '@font-face { font-family: X; src: url(https://example.com/x.woff2); }</style></head>' +
        '<body><img src="https://example.com/logo.png" style="width:10px"><p style="background:url(https://e.com/a.png) red">x</p></body>'
    );
    const removed = App.importer.removeRemoteRefs(doc);
    assertEqual(removed, 5);
    assertEqual(App.importer.findExternalRefs(doc).remote.length, 0);
    assertIncludes(doc.querySelector('style').textContent, '.a { color: red; }');
    assertIncludes(doc.querySelector('img').getAttribute('src'), 'data:image/svg+xml', 'image replaced by a placeholder');
    assertIncludes(doc.querySelector('p').getAttribute('style'), 'red');
});

// ---------- slide detection (SPEC 3.4) ----------

test('importer: detectSlides prefers section.slide', () => {
    const doc = parseDoc('<body><section class="slide"></section><section class="slide"></section><section></section></body>');
    const found = App.importer.detectSlides(doc);
    assertEqual(found.method, 'section.slide');
    assertEqual(found.slides.length, 2);
});

test('importer: detectSlides falls back to <section>, ignoring nested sections', () => {
    const doc = parseDoc('<body><section><section>inner</section></section><section></section></body>');
    const found = App.importer.detectSlides(doc);
    assertEqual(found.method, 'section');
    assertEqual(found.slides.length, 2);
});

test('importer: detectSlides by class skips wrappers (.slides) and parts (.slide-title)', () => {
    const doc = parseDoc(
        '<body><div class="slides">' +
        '<div class="slide-item"><h1 class="slide-title">A</h1></div>' +
        '<div class="slide-item"><h1 class="slide-title">B</h1></div>' +
        '<div class="slide-item"><h1 class="slide-title">C</h1></div>' +
        '</div></body>'
    );
    const found = App.importer.detectSlides(doc);
    assertEqual(found.method, 'class');
    assertEqual(found.slides.map((s) => s.className), ['slide-item', 'slide-item', 'slide-item']);
});

test('importer: detectSlides returns no slides when nothing matches (size check runs later)', () => {
    const found = App.importer.detectSlides(parseDoc('<body><div>x</div></body>'));
    assertEqual(found.slides.length, 0);
});

test('importer: detectSlides ignores the master element', () => {
    const doc = parseDoc('<body><div class="master slide-master"></div><section class="slide"></section></body>');
    assertEqual(App.importer.detectSlides(doc).slides.length, 1);
});

// ---------- full import with layout (uses a hidden measuring iframe) ----------

const CONTRACT_DECK =
    '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="deck-format" content="1">' +
    '<style>:root{--color-primary:#CC092F}.slide{position:relative;width:1280px;height:720px;overflow:hidden}.el{position:absolute}</style>' +
    '</head><body>' +
    '<section class="slide" data-slide-id="s1">' +
    '<div class="el" data-type="text" data-id="e1" style="left:64px; top:48px; width:1152px; height:80px; z-index:1"><h1>Título</h1></div>' +
    '<aside class="notes">Notas do slide</aside></section>' +
    '<section class="slide" data-slide-id="s2" data-hidden="true">' +
    '<div class="el" data-type="text" data-id="e2" style="left:10px; top:10px; width:100px; height:50px; z-index:1">Two</div></section>' +
    '</body></html>';

test('import: a format-1 contract deck keeps its layout; its text moves to the text model (format 2 and up)', async () => {
    const result = await App.importer.importDeck(CONTRACT_DECK);
    assert(result.report.isContract, 'isContract');
    assertEqual(result.report.slideCount, 2);
    assertEqual(result.report.elementsConverted, 0);
    assertEqual(result.report.textConverted, 2);
    assert(App.importer.reportHasChanges(result.report), 'the conversion marks the deck as changed');
    const doc = parseDoc(result.html);
    const e1 = doc.querySelector('[data-id="e1"]');
    ['left', 'top', 'width', 'height', 'zIndex'].forEach((property) => {
        assertEqual(e1.style[property], { left: '64px', top: '48px', width: '1152px', height: '80px', zIndex: '1' }[property]);
    });
    assertEqual(e1.style.fontWeight, 'bold', 'the <h1> look is kept on the box');
    // The browser's default <h1> margins (0.67em of 32px) were part of the look, so they stay.
    assertEqual(e1.innerHTML, '<p data-list="none" data-level="1" style="margin-top: 21.44px; margin-bottom: 21.44px;">Título</p>');
    assertEqual(doc.querySelector('[data-id="e2"]').innerHTML, '<p data-list="none" data-level="1">Two</p>');
    assertEqual(doc.querySelector('[data-slide-id="s2"]').getAttribute('data-hidden'), 'true');
    assertEqual(doc.querySelector('aside.notes').textContent, 'Notas do slide');
    assertEqual(doc.querySelector('meta[name="deck-format"]').getAttribute('content'), '3');
});

const FORMAT_2_DECK = CONTRACT_DECK
    .replace('content="1"', 'content="2"')
    .replace('<h1>Título</h1>', '<p data-list="bullet" data-level="2">Título</p>')
    .replace('>Two</div>', '><p data-list="none" data-level="1">Two</p></div>');

test('import: a format-2 deck\'s text is left as it is (only tidied)', async () => {
    const result = await App.importer.importDeck(FORMAT_2_DECK);
    assertEqual(result.report.textConverted, 0);
    assert(!App.importer.reportHasChanges(result.report), 'nothing to report');
    const e1 = parseDoc(result.html).querySelector('[data-id="e1"]');
    assertEqual(e1.getAttribute('style'), 'left:64px; top:48px; width:1152px; height:80px; z-index:1');
    assertEqual(e1.innerHTML, '<p data-list="bullet" data-level="2">Título</p>');
});

test('import: every deck gets the list theme variables and the bullet stylesheet', async () => {
    const stale = FORMAT_2_DECK.replace('</head>', '<style data-deck-text>/* old */</style></head>');
    for (const html of [CONTRACT_DECK, stale]) {
        const doc = parseDoc((await App.importer.importDeck(html)).html);
        const styles = Array.from(doc.head.querySelectorAll('style'));
        const lists = doc.head.querySelector('style[data-deck-lists]');
        assert(lists, 'list variables added');
        assertIncludes(lists.textContent, '--list-1-bullet: "•"');
        assert(styles.indexOf(lists) < styles.findIndex((s) => !s.hasAttribute('data-deck-lists')),
            'before the deck\'s own CSS, so a template can override them');
        assertEqual(doc.head.querySelectorAll('style[data-deck-text]').length, 1);
        assertEqual(styles[styles.length - 1].getAttribute('data-deck-text'), '', 'bullet stylesheet comes last');
        assertEqual(doc.head.querySelector('style[data-deck-text]').textContent, App.text.deckTextCss(), 'always the current one');
        const groups = doc.head.querySelectorAll('style[data-deck-groups]');
        assertEqual(groups.length, 1, 'the group stylesheet (Phase 7), once');
        assertEqual(groups[0].textContent, App.groups.GROUP_CSS);
    }
});

test('import: contract deck missing ids and z-index gets them filled in', async () => {
    const html = CONTRACT_DECK
        .replace(' data-id="e2"', '')
        .replace('height:50px; z-index:1', 'height:50px')
        .replace(' data-slide-id="s2"', '');
    const result = await App.importer.importDeck(html);
    assert(result.report.isContract, 'still a contract deck');
    assert(result.report.fixes.length >= 3, 'fixes are reported: ' + JSON.stringify(result.report.fixes));
    const doc = parseDoc(result.html);
    const slides = doc.querySelectorAll('.slide');
    assert(slides[1].getAttribute('data-slide-id'), 'slide id added');
    const el = slides[1].querySelector('.el');
    assert(el.getAttribute('data-id'), 'element id added');
    assertIncludes(el.getAttribute('style'), 'z-index');
});

test('import: Appendix A chart without SVG gets a rendering', async () => {
    const html = CONTRACT_DECK.replace('<aside',
        '<figure class="el" data-type="chart" data-id="c1" style="left:100px; top:200px; width:600px; height:300px; z-index:2">' +
        '<script type="application/json" class="chart-data">{"version":1,"type":"column","categories":["2023","2024"],' +
        '"series":[{"name":"Receita","values":[1,2]}],"options":{"title":"Receita"}}</script></figure><aside');
    const result = await App.importer.importDeck(html);
    assertEqual(result.report.chartsRendered, 1);
    const figure = parseDoc(result.html).querySelector('figure');
    assert(figure.querySelector('svg'), 'svg added');
    assert(figure.querySelector('script.chart-data'), 'JSON kept');
});

test('import: a flow-layout deck is normalized to absolute elements', async () => {
    const html =
        '<html><head><style>.slide{width:1280px;height:720px;padding:40px;box-sizing:border-box}' +
        'h1{margin:0;font-size:40px;line-height:50px}p{margin:20px 0 0;font-size:20px;line-height:30px}</style></head>' +
        '<body><div class="slide"><h1>Title</h1><p>Body text</p></div></body></html>';
    const result = await App.importer.importDeck(html);
    assert(!result.report.isContract, 'not a contract deck');
    assertEqual(result.report.elementsConverted, 2);
    const doc = parseDoc(result.html);
    const els = doc.querySelectorAll('section.slide > .el');
    assertEqual(els.length, 2);
    assertEqual(els[0].getAttribute('data-type'), 'text');
    assertIncludes(els[0].getAttribute('style'), 'left: 40px');
    assertIncludes(els[0].getAttribute('style'), 'top: 40px');
    assertIncludes(els[1].getAttribute('style'), 'top: 110px');
    assertEqual(doc.querySelector('meta[name="deck-format"]').getAttribute('content'), '3');
    assertEqual(els[0].innerHTML, '<p data-list="none" data-level="1">Title</p>');
});

test('import: normalized ids are unique and slides get s1..sN', async () => {
    const html =
        '<html><head><style>section{width:1280px;height:720px}</style></head><body>' +
        '<section><p>a</p><p>b</p></section><section><p>c</p></section></body></html>';
    const doc = parseDoc((await App.importer.importDeck(html)).html);
    assertEqual([...doc.querySelectorAll('.slide')].map((s) => s.getAttribute('data-slide-id')), ['s1', 's2']);
    const ids = [...doc.querySelectorAll('.el')].map((e) => e.getAttribute('data-id'));
    assertEqual(new Set(ids).size, 3);
});

test('import: slides hidden by the deck\'s own CSS (display:none until .active) are still measured', async () => {
    const html =
        '<html><head><style>.slide{display:none;width:1280px;height:720px;box-sizing:border-box}.slide.active{display:flex;flex-direction:column;padding:100px}' +
        'p{margin:0;height:40px}</style></head><body>' +
        '<div class="slide active"><p>first</p></div><div class="slide"><p>second</p></div></body></html>';
    const doc = parseDoc((await App.importer.importDeck(html)).html);
    const second = doc.querySelectorAll('.slide')[1].querySelector('.el');
    assertIncludes(second.getAttribute('style'), 'left: 100px', 'flex padding applied on the hidden slide too');
    assertIncludes(second.getAttribute('style'), 'height: 40px');
});

test('import: styles from ancestor rules are kept as the text box look', async () => {
    const html =
        '<html><head><style>section{width:1280px;height:720px}.card p{color:rgb(255, 0, 0);font-size:31px}</style></head>' +
        '<body><section><div class="card"><p>Red text</p></div></section></body></html>';
    const el = parseDoc((await App.importer.importDeck(html)).html).querySelector('.el');
    assertEqual(el.style.color, 'rgb(255, 0, 0)');
    assertEqual(el.style.fontSize, '23.5pt');
    assertEqual(el.innerHTML, '<p data-list="none" data-level="1">Red text</p>');
});

test('import: a slide\'s own background replaces one inherited from a shared .slide rule', async () => {
    const html =
        '<html><head><style>.slide{width:1280px;height:720px;background:linear-gradient(red, blue)}' +
        '.slide.light{background:rgb(250, 250, 250)}</style></head>' +
        '<body><div class="slide"><p>dark</p></div><div class="slide light"><p>light</p></div></body></html>';
    const doc = parseDoc((await App.importer.importDeck(html)).html);
    const light = doc.querySelectorAll('section.slide')[1];
    assertIncludes(light.getAttribute('style'), 'background-color: rgb(250, 250, 250)');
    assertIncludes(light.getAttribute('style'), 'background-image: none');
});

test('import: an icon inside a heading becomes its own element, and the text box starts after it', async () => {
    const html =
        '<html><head><style>body{margin:0}section{width:1280px;height:720px}' +
        '.col{position:absolute;left:100px;top:100px;width:400px}.col h3{margin:0;display:flex;align-items:center;gap:10px}</style></head>' +
        '<body><section><div class="col"><h3><svg width="20" height="20"><circle cx="10" cy="10" r="8"/></svg>Riscos</h3></div></section></body></html>';
    const doc = parseDoc((await App.importer.importDeck(html)).html);
    const els = [...doc.querySelectorAll('.slide > .el')];
    assertEqual(els.map((e) => e.getAttribute('data-type')).sort(), ['shape', 'text']);
    const icon = els.find((e) => e.getAttribute('data-type') === 'shape');
    const text = els.find((e) => e.getAttribute('data-type') === 'text');
    assertEqual(icon.tagName.toLowerCase(), 'svg');
    assertEqual(icon.style.left, '100px');
    assertEqual(text.style.left, '130px', 'after the 20px icon and the 10px gap');
    assertEqual(text.innerHTML, '<p data-list="none" data-level="1">Riscos</p>');
});

test('import: a box with a background becomes a shape behind its text', async () => {
    const html =
        '<html><head><style>section{width:1280px;height:720px}' +
        '.card{position:absolute;left:100px;top:100px;width:300px;height:200px;background:rgb(0, 0, 255);border-radius:8px}' +
        'p{margin:0}</style></head><body><section><div class="card"><p>Inside</p></div></section></body></html>';
    const doc = parseDoc((await App.importer.importDeck(html)).html);
    const els = [...doc.querySelectorAll('.slide > .el')];
    assertEqual(els.map((e) => e.getAttribute('data-type')), ['shape', 'text']);
    assertIncludes(els[0].getAttribute('style'), 'background-color: rgb(0, 0, 255)');
    assertIncludes(els[0].getAttribute('style'), 'width: 300px');
    const z = els.map((e) => parseInt(e.style.zIndex, 10));
    assert(z[0] < z[1], 'shape is behind the text');
});

test('import: images and tables get their own element types', async () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const html =
        '<html><head><style>section{width:1280px;height:720px}</style></head><body><section>' +
        '<img src="' + png + '" style="width:50px;height:50px;display:block">' +
        '<table><tr><td>EV/EBITDA</td><td>8,5x</td></tr></table></section></body></html>';
    const doc = parseDoc((await App.importer.importDeck(html)).html);
    const img = doc.querySelector('img.el');
    assertEqual(img.getAttribute('data-type'), 'image');
    assertIncludes(img.getAttribute('style'), 'width: 50px');
    const table = doc.querySelector('.el[data-type="table"]');
    assert(table && table.querySelector('table'), 'table element wraps the <table>');
});

test('import: a 1920x1080 deck is scaled to 1280x720', async () => {
    const html =
        '<html><head><style>.slide{width:1920px;height:1080px;position:relative}' +
        'h1{position:absolute;left:192px;top:96px;width:960px;margin:0;font-size:60px;line-height:90px}</style></head>' +
        '<body><div class="slide"><h1>Big</h1></div></body></html>';
    const result = await App.importer.importDeck(html);
    assertEqual(result.report.scaledFrom, '1920×1080');
    const el = parseDoc(result.html).querySelector('.el');
    const style = el.getAttribute('style');
    assertIncludes(style, 'left: 128px');
    assertIncludes(style, 'top: 64px');
    assertIncludes(style, 'width: 640px');
    assertEqual(el.style.fontSize, '30pt', '60px scaled by 2/3 = 40px = 30pt');
});

test('import: speaker notes are kept in aside.notes', async () => {
    const html =
        '<html><head><style>section{width:1280px;height:720px}.notes{display:none}</style></head>' +
        '<body><section><p>x</p><div class="notes">Falar sobre a margem</div></section></body></html>';
    const doc = parseDoc((await App.importer.importDeck(html)).html);
    assertEqual(doc.querySelector('.slide aside.notes').textContent, 'Falar sobre a margem');
});

test('import: canvas elements drawn by scripts are reported as removed', async () => {
    const html =
        '<html><head><style>section{width:1280px;height:720px}canvas{width:400px;height:200px;display:block}</style></head>' +
        '<body><section><canvas id="chart"></canvas></section></body></html>';
    const result = await App.importer.importDeck(html);
    assertEqual(result.report.otherRemoved.length, 1);
    assertIncludes(result.report.otherRemoved[0], 'canvas');
    assertEqual(parseDoc(result.html).querySelectorAll('canvas').length, 0);
});

test('import: large 16:9 blocks are slides when no other rule matches', async () => {
    const html =
        '<html><head><style>.page{width:1280px;height:720px}</style></head>' +
        '<body><div class="page"><p>a</p></div><div class="page"><p>b</p></div></body></html>';
    const result = await App.importer.importDeck(html);
    assertEqual(result.report.method, 'size');
    assertEqual(result.report.slideCount, 2);
});

test('import: the report counts removed scripts and remote references', async () => {
    const html =
        '<html><head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">' +
        '<style>section{width:1280px;height:720px}</style></head>' +
        '<body><section><p>x</p></section><script>document.title="x"</script></body></html>';
    const result = await App.importer.importDeck(html);
    assertEqual(result.report.scriptsRemoved.length, 1);
    assertEqual(result.report.remoteRefs.length, 1);
});

test('import: visible content outside the slides (e.g. navigation buttons) is reported as left out', async () => {
    const html =
        '<html><head><style>.slide{width:1280px;height:720px}.nav{position:fixed;bottom:10px;right:10px}</style></head>' +
        '<body><div class="slide"><p>a</p></div><div class="slide"><p>b</p></div>' +
        '<div class="nav"><button>‹</button><button>›</button></div></body></html>';
    const result = await App.importer.importDeck(html);
    assertEqual(result.report.warnings.length, 1);
    assertIncludes(result.report.warnings[0], 'outside the slides');
    assertIncludes(result.report.warnings[0], '<div class="nav">');
});

test('import: a document with no slides at all becomes one slide', async () => {
    const result = await App.importer.importDeck('<html><body><p>Just a paragraph</p></body></html>');
    assertEqual(result.report.slideCount, 1);
    assert(result.report.warnings.length > 0, 'warns that no slides were found');
});
