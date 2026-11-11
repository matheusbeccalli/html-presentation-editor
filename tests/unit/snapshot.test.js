/*
 * snapshot.test.js - a slide as a picture (Phase 8, SPEC 7.3): the file names and the
 * SVG that wraps one slide for the browser to draw. Drawing it is checked in
 * e2e_test.py, against the screen.
 */

test('snapshot: PNG file names carry the slide number, padded to the deck\'s size', () => {
    assertEqual(App.snapshot.fileName('contract-deck', 3, 6), 'contract-deck-slide-03.png');
    assertEqual(App.snapshot.fileName('big', 7, 120), 'big-slide-007.png');
});

test('snapshot: the SVG holds that slide alone (no notes), the deck\'s styles, in XHTML', () => {
    const doc = document.implementation.createHTMLDocument('deck');
    doc.documentElement.setAttribute('lang', 'pt-BR');
    doc.head.innerHTML = '<style>.el { color: red; }</style>';
    doc.body.innerHTML =
        '<section class="slide" data-slide-id="s1"><div class="el">Um<br></div><aside class="notes">fala</aside></section>' +
        '<section class="slide" data-slide-id="s2"><div class="el">Dois</div>' +
        '<svg class="chart" width="10" height="10"><rect width="5" height="5"></rect></svg></section>';
    const svg = App.snapshot.slideSvg(doc.documentElement, 1);
    const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
    assertEqual(parsed.querySelector('parsererror'), null, 'well-formed XML');
    assertEqual(parsed.documentElement.getAttribute('width'), '1280');
    const html = parsed.querySelector('foreignObject').firstElementChild;
    assertEqual([html.localName, html.namespaceURI, html.getAttribute('lang')], ['html', 'http://www.w3.org/1999/xhtml', 'pt-BR']);
    const ids = Array.from(parsed.getElementsByTagNameNS('http://www.w3.org/1999/xhtml', 'section')).map((s) => s.getAttribute('data-slide-id'));
    assertEqual(ids, ['s2']);
    assertEqual(svg.indexOf('.el { color: red; }') > 0, true, 'the deck\'s styles');
    assertEqual(parsed.getElementsByTagNameNS('http://www.w3.org/2000/svg', 'rect').length, 1, 'the chart stays SVG');
    assertEqual(App.snapshot.slideSvg(doc.documentElement, 0).indexOf('fala'), -1, 'speaker notes are left out');
});

test('snapshot: the vendored PptxGenJS bundle is loaded, with the JSZip it carries', () => {
    assertEqual(typeof PptxGenJS, 'function');
    assertEqual(typeof JSZip, 'function', 'JSZip for the ZIP of slide pictures');
    assertEqual(new JSZip().file('a.txt', 'x').files['a.txt'].name, 'a.txt');
});
