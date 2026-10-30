/*
 * Tests for src/js/text.js, step 1: the flat-paragraph text model (SPEC Phase 3),
 * the normalizer and the bullet/number stylesheet. All text is fake.
 */

// A text element holding `inner`, in its own inert document (like a parsed deck).
function textElement(inner) {
    const doc = parseDoc('<!DOCTYPE html><html><head></head><body>' +
        '<div class="el" data-type="text" data-id="e1" style="left:10px; top:20px; width:300px; height:100px; font-size:18pt">' +
        inner + '</div></body></html>');
    return doc.querySelector('.el');
}

function normalized(inner) {
    const element = textElement(inner);
    App.text.normalize(element);
    return element.innerHTML;
}

// [list, level, text] per paragraph: the short form used by most tests.
function shape(inner) {
    const element = textElement(inner);
    App.text.normalize(element);
    return App.text.getModel(element).map((p) => [p.list, p.level, p.text]);
}

// ---------------------------------------------------------------
// The model itself
// ---------------------------------------------------------------

test('text: a clean model is left exactly as it is', () => {
    const clean = '<p data-list="bullet" data-level="2">Receita de <b>R$ 480 mi</b></p>' +
        '<p data-list="none" data-level="1">Fonte: empresa</p>';
    assertEqual(normalized(clean), clean);
});

test('text: getModel gives list, level, start and text per paragraph (<br> as a line break)', () => {
    const element = textElement('<p data-list="number" data-level="1" data-start="3">Um<br>dois</p>' +
        '<p data-list="bullet" data-level="2">Três</p>');
    App.text.normalize(element);
    assertEqual(App.text.getModel(element), [
        { list: 'number', level: 1, start: 3, text: 'Um\ndois' },
        { list: 'bullet', level: 2, start: null, text: 'Três' },
    ]);
});

test('text: text directly inside the element is wrapped in a plain paragraph', () => {
    assertEqual(normalized('Projeto <b>Atlas</b>'), '<p data-list="none" data-level="1">Projeto <b>Atlas</b></p>');
});

test('text: invalid list types, levels and starts are repaired', () => {
    assertEqual(shape('<p data-list="star" data-level="9">a</p><p data-list="bullet" data-level="0">b</p>' +
        '<p data-level="x">c</p>'), [['none', 5, 'a'], ['bullet', 1, 'b'], ['none', 1, 'c']]);
    const element = textElement('<p data-list="bullet" data-level="1" data-start="4">x</p>' +
        '<p data-list="number" data-level="1" data-start="-2">y</p>');
    App.text.normalize(element);
    assertEqual(App.text.getModel(element).map((p) => p.start), [null, null], 'data-start only on numbered lines, positive');
});

// ---------------------------------------------------------------
// Nested lists become flat paragraphs
// ---------------------------------------------------------------

const COPILOT_THREE_LEVELS =
    '<ul>\n' +
    '  <li>Receita de R$ 480 mi em 2025\n' +
    '    <ul>\n' +
    '      <li>Crescimento de 12% a.a.\n' +
    '        <ul><li>Puxado pelo Sudeste</li><li>Margem estável</li></ul>\n' +
    '      </li>\n' +
    '      <li>EBITDA de R$ 96 mi</li>\n' +
    '    </ul>\n' +
    '  </li>\n' +
    '  <li>Proposta: aquisição de 70%</li>\n' +
    '</ul>';

test('text: a Copilot 3-level nested <ul> becomes flat bulleted paragraphs with levels', () => {
    assertEqual(shape(COPILOT_THREE_LEVELS), [
        ['bullet', 1, 'Receita de R$ 480 mi em 2025'],
        ['bullet', 2, 'Crescimento de 12% a.a.'],
        ['bullet', 3, 'Puxado pelo Sudeste'],
        ['bullet', 3, 'Margem estável'],
        ['bullet', 2, 'EBITDA de R$ 96 mi'],
        ['bullet', 1, 'Proposta: aquisição de 70%'],
    ]);
});

test('text: mixed <ol>/<ul> nesting keeps number or bullet per level', () => {
    assertEqual(shape('<ol><li>Passo um<ul><li>Detalhe</li></ul></li><li>Passo dois<ol><li>Sub</li></ol></li></ol>'), [
        ['number', 1, 'Passo um'],
        ['bullet', 2, 'Detalhe'],
        ['number', 1, 'Passo dois'],
        ['number', 2, 'Sub'],
    ]);
});

test('text: lists nested deeper than 5 levels stay at level 5', () => {
    const deep = '<ul><li>1<ul><li>2<ul><li>3<ul><li>4<ul><li>5<ul><li>6</li></ul></li></ul></li></ul></li></ul></li></ul></li></ul>';
    assertEqual(shape(deep).map((p) => p[1]), [1, 2, 3, 4, 5, 5]);
});

test('text: <ol start> and <li value> become data-start', () => {
    const element = textElement('<ol start="4"><li>quatro</li><li>cinco</li></ol><ol><li value="9">nove</li></ol>');
    App.text.normalize(element);
    assertEqual(App.text.getModel(element).map((p) => p.start), [4, null, 9]);
});

test('text: a second <ol> right after another restarts at 1, as the browser showed it', () => {
    const element = textElement('<ol><li>a</li></ol><ol><li>b</li></ol>');
    App.text.normalize(element);
    assertEqual(App.text.getModel(element).map((p) => p.start), [null, 1]);
});

test('text: an empty <li> stays as an empty bulleted line; an <li> holding only a list does not', () => {
    assertEqual(shape('<ul><li></li><li><ul><li>x</li></ul></li></ul>'), [['bullet', 1, ''], ['bullet', 2, 'x']]);
});

// ---------------------------------------------------------------
// Messy HTML is rewritten into the allowed set
// ---------------------------------------------------------------

test('text: headings and divs become paragraphs; strong/em/font become b/i/span', () => {
    assertEqual(normalized('<h2>Sumário</h2><div><strong>forte</strong> e <em>itálico</em> ' +
        '<font face="Arial" color="#ff0000">fonte</font></div>'),
        '<p data-list="none" data-level="1">Sumário</p>' +
        '<p data-list="none" data-level="1"><b>forte</b> e <i>itálico</i> ' +
        '<span style="font-family: Arial; color: rgb(255, 0, 0);">fonte</span></p>');
});

test('text: messy execCommand output is cleaned', () => {
    const messy = '<div class="x" id="y">Receita <span style="font-weight: bold; line-height: 2;" class="a">alta</span>' +
        '<span style="font-style: italic;"> e <span style="text-decoration: underline;">crescente</span></span></div>' +
        '<div><br></div><div><span style="font-size: 32px; color: rgb(204, 9, 47);">Título</span></div>';
    assertEqual(normalized(messy),
        '<p data-list="none" data-level="1">Receita <b>alta</b><i> e <u>crescente</u></i></p>' +
        '<p data-list="none" data-level="1"><br></p>' +
        '<p data-list="none" data-level="1" style="font-size: 24pt; --marker-size: 24pt; --marker-color: rgb(204, 9, 47);">' +
        '<span style="font-size: 24pt; color: rgb(204, 9, 47);">Título</span></p>');
});

test('text: strike, superscript and subscript from tags or styles', () => {
    assertEqual(normalized('<p>a<strike>b</strike><del>c</del><span style="vertical-align: super">d</span>' +
        '<span style="vertical-align: sub">e</span><span style="text-decoration-line: line-through">f</span></p>'),
        '<p data-list="none" data-level="1">a<s>bc</s><sup>d</sup><sub>e</sub><s>f</s></p>');
});

test('text: unknown tags are unwrapped, scripts/styles/comments removed, attributes stripped', () => {
    assertEqual(normalized('<p class="c" onclick="x()" title="t"><custom-tag>texto</custom-tag><!-- nota -->' +
        '<script>alert(1)</script><style>p{}</style><img src="data:image/png;base64,AA"> fim</p>'),
        '<p data-list="none" data-level="1">texto fim</p>');
});

test('text: empty spans are removed, identical neighbours merged, style-less spans unwrapped', () => {
    assertEqual(normalized('<p><span style="color: red"></span><span style="color: red">a</span>' +
        '<span style="color: red">b</span><span class="k">c</span><b>d</b><b>e</b><i></i></p>'),
        '<p data-list="none" data-level="1" style="--marker-color: red;"><span style="color: red;">ab</span>c<b>de</b></p>');
});

test('text: nested identical formatting collapses', () => {
    assertEqual(normalized('<p><b>a<b>b</b></b><span style="color: blue"><span style="color: blue">c</span></span></p>'),
        '<p data-list="none" data-level="1"><b>ab</b><span style="color: blue;">c</span></p>');
});

test('text: links keep only http, https and mailto', () => {
    assertEqual(normalized('<p><a href="https://example.com" target="_blank" class="l">site</a> ' +
        '<a href="mailto:ana@example.com">mail</a> <a href="javascript:alert(1)">mau</a> <a href="file:///c:/x">arquivo</a></p>'),
        '<p data-list="none" data-level="1"><a href="https://example.com">site</a> ' +
        '<a href="mailto:ana@example.com">mail</a> mau arquivo</p>');
});

test('text: span styles are limited to font, size, color and highlight; px sizes become pt', () => {
    assertEqual(normalized('<p><span style="font-family: Calibri, sans-serif; font-size: 15px; letter-spacing: 2px; ' +
        'background-color: yellow; padding: 4px">a</span><span style="font-size: 1.5em">b</span></p>'),
        '<p data-list="none" data-level="1" style="--marker-size: 11.5pt;">' +
        '<span style="font-family: Calibri, sans-serif; font-size: 11.5pt; background-color: yellow;">a</span>b</p>');
});

test('text: theme variables are allowed values, other var() are not', () => {
    assertEqual(normalized('<p><span style="font-family: var(--font-heading); color: var(--color-primary)">a</span>' +
        '<span style="color: var(--evil)">b</span></p>'),
        '<p data-list="none" data-level="1" style="--marker-color: var(--color-primary);">' +
        '<span style="font-family: var(--font-heading); color: var(--color-primary);">a</span>b</p>');
});

test('text: paragraph styles are limited to alignment, line height and spacing', () => {
    assertEqual(normalized('<p data-list="bullet" data-level="1" style="text-align: center; line-height: 1.2; ' +
        'margin: 6pt 0 3pt; padding: 9px; text-indent: 10px">a</p>'),
        '<p data-list="bullet" data-level="1" style="text-align: center; line-height: 1.2; margin-top: 6pt; margin-bottom: 3pt;">a</p>');
});

test('text: the look of a foreign block is kept as inline formatting', () => {
    assertEqual(normalized('<h3 style="font-weight: bold; color: rgb(31, 42, 68); font-size: 20pt; text-align: right">Título</h3>'),
        '<p data-list="none" data-level="1" style="text-align: right; font-size: 20pt; --marker-size: 20pt; --marker-color: rgb(31, 42, 68);">' +
        '<span style="font-size: 20pt; color: rgb(31, 42, 68);"><b>Título</b></span></p>');
});

test('text: formatting around several blocks reaches every paragraph', () => {
    assertEqual(shape('<b><p>um</p><p>dois</p></b>').length, 2);
    assertEqual(normalized('<i><p>um</p><p>dois</p></i>'),
        '<p data-list="none" data-level="1"><i>um</i></p><p data-list="none" data-level="1"><i>dois</i></p>');
});

test('text: pretty-printed whitespace collapses; <br> and non-breaking spaces stay', () => {
    assertEqual(normalized('\n  <p>\n    Receita   de\n    R$ 480\u00a0mi<br>linha 2\n  </p>\n'),
        '<p data-list="none" data-level="1">Receita de R$ 480&nbsp;mi<br>linha 2</p>');
});

test('text: the text element itself is not touched', () => {
    const element = textElement('<h1 class="t">x</h1>');
    App.text.normalize(element);
    assertEqual(element.getAttribute('style'), 'left:10px; top:20px; width:300px; height:100px; font-size:18pt');
    assertEqual(element.getAttribute('class'), 'el');
    assertEqual(element.getAttribute('data-id'), 'e1');
});

// ---------------------------------------------------------------
// Values the normalizer derives itself
// ---------------------------------------------------------------

test('text: data-start is mirrored into counter-set (with deeper levels reset)', () => {
    assertEqual(normalized('<p data-list="number" data-level="2" data-start="4">x</p>'),
        '<p data-list="number" data-level="2" data-start="4" style="counter-set: list-2 4 list-3 0 list-4 0 list-5 0;">x</p>');
});

test('text: a line all in one size also gets that size itself (its height matches its text)', () => {
    assertEqual(normalized('<p data-list="bullet" data-level="1"><span style="font-size: 9pt">a</span> <span style="font-size: 9pt">b</span></p>'),
        '<p data-list="bullet" data-level="1" style="font-size: 9pt; --marker-size: 9pt;"><span style="font-size: 9pt;">a b</span></p>');
});

test('text: each line passes the size and color of its first character to its bullet only', () => {
    // --marker-* are read by the bullet/number alone; "resto" keeps the box's default look.
    assertEqual(normalized('<p data-list="bullet" data-level="1" style="--marker-size: 10pt; --marker-color: blue">' +
        '<span style="font-size: 28pt"><span style="color: red">Grande</span></span> resto</p>'),
        '<p data-list="bullet" data-level="1" style="--marker-size: 28pt; --marker-color: red;">' +
        '<span style="font-size: 28pt;"><span style="color: red;">Grande</span></span> resto</p>');
    assertEqual(normalized('<p data-list="bullet" data-level="1" style="--marker-size: 10pt">plain</p>'),
        '<p data-list="bullet" data-level="1">plain</p>', 'nothing to derive: the box default applies');
});

test('text: text typed into an empty line that had a size and color keeps them', () => {
    assertEqual(normalized('<p data-list="bullet" data-level="1" style="font-size: 28pt; color: red">novo</p>'),
        '<p data-list="bullet" data-level="1" style="font-size: 28pt; --marker-size: 28pt; --marker-color: red;">' +
        '<span style="font-size: 28pt; color: red;">novo</span></p>');
});

test('text: an empty line keeps its size and color', () => {
    assertEqual(normalized('<p data-list="bullet" data-level="1" style="font-size: 28pt; color: red"><br></p>'),
        '<p data-list="bullet" data-level="1" style="font-size: 28pt; color: red;"><br></p>');
});

// ---------------------------------------------------------------
// Idempotence: normalize twice == normalize once (SPEC 8.3)
// ---------------------------------------------------------------

test('text: normalizing twice gives the same result as once, for every fixture', () => {
    const fixtures = [
        COPILOT_THREE_LEVELS,
        '<ol start="4"><li>quatro</li></ol><ol><li>a<ul><li>b</li></ul></li></ol>',
        '<div class="x">Receita <span style="font-weight: bold;">alta</span></div><div><br></div>',
        '<h3 style="font-weight: bold; color: red; font-size: 20pt">T</h3><b><p>um</p><p>dois</p></b>',
        '<p><span style="color: red"></span><span style="color: red">a</span><span style="color: red">b</span></p>',
        '<p data-list="number" data-level="2" data-start="4"><span style="font-size: 28pt; color: red">x</span> y</p>',
        'solto <i>texto</i><p>e</p> mais',
        '<p data-list="bullet" data-level="1"><span style="font-size: 9pt">a</span> <span style="font-size: 9pt">b</span></p>',
        '<p data-list="bullet" data-level="1" style="font-size: 28pt; color: red">novo <b>texto</b></p>',
    ];
    fixtures.forEach((fixture, index) => {
        const element = textElement(fixture);
        App.text.normalize(element);
        const once = element.innerHTML;
        App.text.normalize(element);
        assertEqual(element.innerHTML, once, 'fixture ' + index);
    });
});

// ---------------------------------------------------------------
// The list stylesheet and theme variables
// ---------------------------------------------------------------

test('text: theme defaults for the five list levels', () => {
    const levels = App.text.LIST_DEFAULTS;
    assertEqual(levels.map((l) => l.bullet), ['•', '–', '▪', '·', '·']);
    assertEqual(levels.map((l) => l.number), ['decimal', 'lower-alpha', 'lower-roman', 'decimal', 'lower-alpha']);
    const css = App.text.themeVariablesCss();
    assertIncludes(css, '--list-1-bullet: "•";');
    assertIncludes(css, '--list-2-number: lower-alpha;');
    assertIncludes(css, '--list-5-indent:');
    assertIncludes(css, '--list-1-space-before:');
    // Unset by default = the bullet follows the line's first character; a template may set them.
    assertNotIncludes(css, '--list-3-bullet-color');
    assertNotIncludes(css, '--list-4-bullet-size');
});

// Lays the stylesheet + paragraphs out in a real (hidden) iframe and returns computed styles.
async function renderedLists(paragraphs, rootVariables) {
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed; left:-5000px; width:800px; height:400px';
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    doc.open();
    doc.write('<!DOCTYPE html><html><head><style>' + (rootVariables || '') + '</style><style data-deck-text>' +
        App.text.deckTextCss() + '</style></head><body><div class="el" data-type="text" style="font-size: 24px">' +
        paragraphs + '</div></body></html>');
    doc.close();
    const view = frame.contentWindow;
    const result = Array.from(doc.querySelectorAll('p')).map((p) => ({
        paddingLeft: view.getComputedStyle(p).paddingLeft,
        marginTop: view.getComputedStyle(p).marginTop,
        before: view.getComputedStyle(p, '::before').content,
        beforeColor: view.getComputedStyle(p, '::before').color,
        beforeSize: view.getComputedStyle(p, '::before').fontSize,
        color: view.getComputedStyle(p).color,
        fontSize: view.getComputedStyle(p).fontSize,
    }));
    frame.remove();
    return result;
}

test('text: the stylesheet draws bullets and numbers with a hanging indent per level', async () => {
    const styles = await renderedLists(
        '<p data-list="bullet" data-level="1">a</p><p data-list="bullet" data-level="2">b</p>' +
        '<p data-list="number" data-level="1">c</p><p data-list="none" data-level="1">d</p>' +
        '<p data-list="none" data-level="2">e</p>');
    assertEqual(styles[0].before, '"•"');
    assertEqual(styles[1].before, '"–"');
    assertIncludes(styles[2].before, 'counter(list-1');
    assertEqual(styles[3].before, 'none');
    assertEqual(styles[0].paddingLeft, '24px');
    assertEqual(styles[1].paddingLeft, '56px');
    assertEqual(styles[3].paddingLeft, '0px');
    assertEqual(styles[4].paddingLeft, '56px', 'a plain line at level 2 lines up with level-2 text');
});

test('text: the stylesheet follows the deck theme variables', async () => {
    const styles = await renderedLists('<p data-list="bullet" data-level="1">a</p>',
        ':root { --list-1-bullet: "➤"; --list-1-indent: 40px; --list-1-bullet-color: rgb(204, 9, 47); }');
    assertEqual(styles[0].before, '"➤"');
    assertEqual(styles[0].paddingLeft, '40px');
    assertEqual(styles[0].beforeColor, 'rgb(204, 9, 47)');
});

test('text: the bullet takes the size and color of the first character, the rest of the line does not', async () => {
    const styles = await renderedLists('<p data-list="bullet" data-level="1" ' +
        'style="--marker-size: 30pt; --marker-color: rgb(204, 9, 47)"><span style="font-size: 30pt">G</span> resto</p>');
    assertEqual(styles[0].beforeSize, '40px');
    assertEqual(styles[0].beforeColor, 'rgb(204, 9, 47)');
    assertEqual(styles[0].fontSize, '24px', 'the paragraph keeps the box size');
    assertEqual(styles[0].color, 'rgb(0, 0, 0)', 'the paragraph keeps the box color');
});

// ---------------------------------------------------------------
// Converting rendered text (import and format-1 migration, SPEC 3.4)
// ---------------------------------------------------------------

// Renders `css` + a 1280x720 slide with one text element holding `inner`; returns the live frame.
async function renderedBox(css, inner, elStyle) {
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed; left:-5000px; top:0; width:1280px; height:720px';
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    doc.open();
    doc.write('<!DOCTYPE html><html><head><style>body{margin:0;font-family:Arial,sans-serif}' +
        '.slide{position:relative;width:1280px;height:720px}.el{position:absolute;box-sizing:border-box}' + css +
        '</style></head><body><section class="slide"><div class="el" data-type="text" data-id="e1" ' +
        'style="left:64px; top:48px; width:900px; height:400px;' + (elStyle || '') + '">' + inner +
        '</div></section></body></html>');
    doc.close();
    return frame;
}

// Converts the frame's text element into a fresh copy of it (as the importer does) and returns that copy.
function convertBox(frame, options) {
    const source = frame.contentDocument.querySelector('.el');
    const out = parseDoc('<!DOCTYPE html><html><head></head><body></body></html>');
    const target = out.importNode(source, false);
    out.body.appendChild(target);
    const result = App.text.fromRendered(source, target, Object.assign({ scale: 1 }, options || {}));
    return { target: target, result: result };
}

// What every piece of text looks like on screen: [text, size, color, weight, style, transform].
function runLooks(element) {
    const view = element.ownerDocument.defaultView;
    const looks = [];
    const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.textContent.trim() === '') {
            continue;
        }
        const c = view.getComputedStyle(node.parentElement);
        const weight = parseInt(c.fontWeight, 10) >= 600 ? 'bold' : 'normal';
        const text = c.textTransform === 'uppercase' ? node.textContent.trim().toUpperCase() : node.textContent.trim();
        const range = element.ownerDocument.createRange();
        range.selectNodeContents(node);
        const rect = range.getBoundingClientRect();
        // Where the text sits, to the pixel (the bullet glyph itself may move; the text must not).
        looks.push([text, c.fontSize, c.color, weight, c.fontStyle, c.fontFamily, Math.round(rect.left), Math.round(rect.top)]);
    }
    return looks;
}

// Renders the converted element again, with the same deck CSS plus the deck-text stylesheet.
async function rerendered(css, target) {
    const frame = await renderedBox(css + App.text.deckTextCss(), '');
    const doc = frame.contentDocument;
    const el = doc.querySelector('.el');
    el.replaceWith(doc.importNode(target, true));
    return frame;
}

test('text import: the look shared by the whole box goes on the text element itself', async () => {
    const css = '.el h2{font-family:Georgia,serif;font-size:32px;font-weight:700;color:rgb(31, 42, 68);' +
        'letter-spacing:1px;text-transform:uppercase;text-align:center;line-height:1.2;margin:0}';
    const frame = await renderedBox(css, '<h2>Sumário executivo</h2>');
    const { target } = convertBox(frame);
    frame.remove();
    const style = target.style;
    assertEqual(style.fontFamily, 'Georgia, serif');
    assertEqual(style.fontSize, '24pt');
    assertEqual(style.fontWeight, 'bold');
    assertEqual(style.color, 'rgb(31, 42, 68)');
    assertEqual(style.letterSpacing, '1px');
    assertEqual(style.textTransform, 'uppercase');
    assertEqual(style.textAlign, 'center');
    assertEqual(style.lineHeight, '1.2');
    assertEqual(style.left, '64px', 'position untouched');
    assertEqual(target.innerHTML, '<p data-list="none" data-level="1">Sumário executivo</p>');
});

test('text import: what differs inside the box becomes inline formatting', async () => {
    const css = '.el p{margin:0;font-size:22px;color:rgb(34, 34, 34)}.el strong{color:rgb(204, 9, 47)}';
    const frame = await renderedBox(css, '<p>Receita de <strong>R$ 480 mi</strong> em 2025</p>');
    const { target } = convertBox(frame);
    frame.remove();
    assertEqual(target.style.fontSize, '16.5pt');
    assertEqual(target.style.color, 'rgb(34, 34, 34)');
    assertEqual(target.innerHTML, '<p data-list="none" data-level="1">Receita de ' +
        '<span style="color: rgb(204, 9, 47);"><b>R$ 480 mi</b></span> em 2025</p>');
});

test('text import: the box look is the one most of the text has', async () => {
    const css = '.el h1{margin:0;font-size:40px;font-weight:700}.el p{margin:0;font-size:16px}';
    const frame = await renderedBox(css, '<h1>Atlas</h1><p>Apresentação ao Comitê de Investimentos</p>');
    const { target } = convertBox(frame);
    frame.remove();
    assertEqual(target.style.fontSize, '12pt');
    assertEqual(target.style.fontWeight, 'normal');
    assertEqual(target.innerHTML,
        '<p data-list="none" data-level="1" style="font-size: 30pt; --marker-size: 30pt;"><span style="font-size: 30pt;"><b>Atlas</b></span></p>' +
        '<p data-list="none" data-level="1">Apresentação ao Comitê de Investimentos</p>');
});

test('text import: nested lists keep their levels; custom ::before bullets stay bullets', async () => {
    const css = '.el ul{margin:0}.el ul.check{list-style:none}.el ul.check li::before{content:"✓ "}' +
        '.el ul.plain{list-style:none}';
    const frame = await renderedBox(css, '<ul><li>Um<ul><li>Dois</li></ul></li></ul>' +
        '<ul class="check"><li>Feito</li></ul><ul class="plain"><li>Sem marcador</li></ul>');
    const { target } = convertBox(frame);
    frame.remove();
    assertEqual(App.text.getModel(target).map((p) => [p.list, p.level, p.text]),
        [['bullet', 1, 'Um'], ['bullet', 2, 'Dois'], ['bullet', 1, 'Feito'], ['none', 1, 'Sem marcador']]);
});

test('text import: per-word upper case is written out; sizes are scaled with the slide', async () => {
    const css = '.el p{margin:0;font-size:48px;letter-spacing:3px}.el .tag{text-transform:uppercase}';
    const frame = await renderedBox(css, '<p>Projeto <span class="tag">atlas</span> em revisão</p>');
    const { target } = convertBox(frame, { scale: 2 / 3 });
    frame.remove();
    assertEqual(target.style.fontSize, '24pt');
    assertEqual(target.style.letterSpacing, '2px');
    assertEqual(App.text.getModel(target)[0].text, 'Projeto ATLAS em revisão');
});

test('text import: side-by-side layouts are flattened and reported; a flex box keeps its vertical centring', async () => {
    const css = '.el .row{display:flex;gap:20px}.el p{margin:0}';
    const frame = await renderedBox(css, '<div class="row"><p>Esquerda</p><p>Direita</p></div>');
    const { target, result } = convertBox(frame);
    frame.remove();
    assert(result.layoutFlattened, 'reported');
    assertEqual(App.text.getModel(target).map((p) => p.text), ['Esquerda', 'Direita']);

    const centred = await renderedBox('.el p{margin:0}', '<p>Título</p>', ' display:flex; align-items:center;');
    const converted = convertBox(centred);
    centred.remove();
    assert(!converted.result.layoutFlattened, 'a centred title is not a layout problem');
    assertEqual(converted.target.style.display, 'flex');
    assertEqual(converted.target.style.flexDirection, 'column');
    assertEqual(converted.target.style.justifyContent, 'center');
});

test('text import: the converted text looks the same, even with deck CSS that targets <p>', async () => {
    const css = '.el p{margin:0 0 6px;font-size:18px;color:rgb(102, 102, 102)}' +
        '.el h2{margin:0 0 8px;font-size:30px;font-weight:700;color:rgb(31, 42, 68)}' +
        '.el li{font-size:20px}.el strong{color:rgb(204, 9, 47)}.el em{font-style:italic}';
    const inner = '<h2>Sumário</h2><p>Visão <em>geral</em> do <strong>Projeto Atlas</strong></p>' +
        '<ul><li>Receita de R$ 480 mi<ul><li>Crescimento de <strong>12%</strong></li></ul></li></ul>';
    const before = await renderedBox(css, inner);
    const expected = runLooks(before.contentDocument.querySelector('.el'));
    const { target } = convertBox(before);
    before.remove();
    const after = await rerendered(css, target);
    const actual = runLooks(after.contentDocument.querySelector('.el'));
    after.remove();
    assertEqual(actual, expected);
});

test('text import: theme fonts and colours are written as theme variables (rebranding keeps working)', async () => {
    const css = ':root{--font-heading:Georgia, serif;--font-body:Georgia, serif;--color-accent:#1F2A44;' +
        '--color-primary:#CC092F;--color-bg:#fff}' +
        '.el h2{margin:0;font-family:var(--font-heading);color:var(--color-accent)}' +
        '.el p{margin:0;font-family:var(--font-body);color:rgb(255, 255, 255)}.el b{color:var(--color-primary)}';
    const title = await renderedBox(css, '<h2>Sumário</h2>');
    const titleBox = convertBox(title).target;
    title.remove();
    assertEqual(titleBox.style.fontFamily, 'var(--font-heading)');
    assertEqual(titleBox.style.color, 'var(--color-accent)');

    const body = await renderedBox(css, '<p>Texto <b>forte</b></p>');
    const bodyBox = convertBox(body).target;
    body.remove();
    assertEqual(bodyBox.style.fontFamily, 'var(--font-body)', 'same font as the heading, but this is body text');
    assertEqual(bodyBox.style.color, 'rgb(255, 255, 255)', 'white text is not the background colour');
    assertIncludes(bodyBox.innerHTML, '<span style="color: var(--color-primary);"><b>forte</b></span>');
});

test('text import: a deck\'s own list indent and spacing stay on that text box', async () => {
    const css = '.el ul{margin:0;padding-left:28px}.el ul ul{padding-left:20px}.el li{margin:0}';
    const frame = await renderedBox(css, '<ul><li>Um<ul><li>Dois</li></ul></li><li>Três</li></ul>');
    const { target } = convertBox(frame);
    frame.remove();
    assertEqual(target.style.getPropertyValue('--list-1-indent'), '28px');
    assertEqual(target.style.getPropertyValue('--list-2-indent'), '48px');
    assertEqual(target.style.getPropertyValue('--list-1-space-before'), '0px');
    assertEqual(target.style.getPropertyValue('--list-3-indent'), '', 'levels the box does not use follow the theme');
});

// ---------------------------------------------------------------
// Editing helpers (step 3)
// ---------------------------------------------------------------

function placeCaret(doc, node, offset) {
    const range = doc.createRange();
    range.setStart(node, offset);
    range.collapse(true);
    doc.getSelection().removeAllRanges();
    doc.getSelection().addRange(range);
}

test('text editing: the cursor is remembered as line + character, so it survives a rebuilt slide', async () => {
    const frame = await renderedBox('', '<p data-list="bullet" data-level="1">Um</p>' +
        '<p data-list="bullet" data-level="1">Dois <b>tr</b>ês<br>quatro</p>');
    const doc = frame.contentDocument;
    let el = doc.querySelector('.el');
    placeCaret(doc, el.querySelectorAll('p')[1].childNodes[2], 1);   // inside "ês", after the "ê"
    assertEqual(App.text.getCaret(el), { anchor: { p: 1, o: 8 }, focus: { p: 1, o: 8 } });

    el.outerHTML = el.outerHTML;   // like undo: the element is rebuilt from HTML
    el = doc.querySelector('.el');
    App.text.setCaret(el, { anchor: { p: 1, o: 12 }, focus: { p: 1, o: 12 } });   // "Dois três" + line break + "qu"
    const range = doc.getSelection().getRangeAt(0);
    assertEqual([range.startContainer.textContent, range.startOffset], ['quatro', 2]);

    App.text.setCaret(el, { anchor: { p: 0, o: 1 }, focus: { p: 1, o: 3 } });
    const selected = doc.getSelection().getRangeAt(0);
    assertEqual([selected.startContainer.textContent, selected.startOffset, selected.endContainer.textContent, selected.endOffset],
        ['Um', 1, 'Dois ', 3]);
    App.text.setCaret(el, { anchor: { p: 9, o: 99 }, focus: { p: 9, o: 99 } });
    assertEqual(App.text.getCaret(el).focus, { p: 1, o: 16 }, 'out of range goes to the end of the text');
    frame.remove();
});

test('text editing: a cursor right after a line break or between elements is counted correctly', async () => {
    const frame = await renderedBox('', '<p data-list="none" data-level="1">ab<br>cd</p>');
    const doc = frame.contentDocument;
    const p = doc.querySelector('p');
    placeCaret(doc, p, 2);   // container = the <p>, after "ab" and the <br>
    assertEqual(App.text.getCaret(doc.querySelector('.el')).anchor, { p: 0, o: 3 });
    frame.remove();
});

test('text editing: a new text box is an empty plain line, positioned, that grows with its text', () => {
    const doc = parseDoc('<!DOCTYPE html><html><head></head><body><section class="slide"></section></body></html>');
    const el = App.text.createTextElement(doc, { left: 100, top: 200, width: 400 });
    assertEqual(el.getAttribute('class'), 'el');
    assertEqual(el.getAttribute('data-type'), 'text');
    assertEqual(el.getAttribute('data-autofit'), 'resize');
    assertEqual([el.style.left, el.style.top, el.style.width], ['100px', '200px', '400px']);
    assert(parseFloat(el.style.height) > 0, 'has a height');
    assertEqual(el.innerHTML, '<p data-list="none" data-level="1"><br></p>');
});

test('text editing: a "resize" box takes the height of its text, growing and shrinking', async () => {
    const frame = await renderedBox('.el p{margin:0}', '<p data-list="none" data-level="1">Um</p>', ' font-size:20px; line-height:30px; height:10px;');
    const el = frame.contentDocument.querySelector('.el');
    el.setAttribute('data-autofit', 'resize');
    App.text.fitHeight(el);
    assertEqual(el.style.height, '30px');
    el.insertAdjacentHTML('beforeend', '<p data-list="none" data-level="1">Dois</p><p data-list="none" data-level="1">Três</p>');
    App.text.fitHeight(el);
    assertEqual(el.style.height, '90px');
    el.removeAttribute('data-autofit');
    el.lastElementChild.remove();
    App.text.fitHeight(el);
    assertEqual(el.style.height, '90px', 'boxes without autofit keep their size');
    frame.remove();
});

// ---------------------------------------------------------------
// Bullet behavior: the key-sequence table (SPEC Phase 3, "Bullet behavior")
// ---------------------------------------------------------------
//
// A line is written "b2:Text": b = bullet, n = number, p = plain; the digit is
// the level; "n1@3:" = numbered, starting at 3. "|" is the cursor, "[" and "]"
// the start (anchor) and end (focus) of a selection. Steps are key names, or
// "type:…" to type text the way the browser does. When keyAction leaves a key
// to the browser, the runner does what the browser would (Backspace, Shift+Enter).

const LIST_CODES = { b: 'bullet', n: 'number', p: 'none' };

function lineHtml(line) {
    const match = /^([bnp])(\d)(?:@(\d+))?:(.*)$/s.exec(line);
    const text = match[4].replace(/[|[\]]/g, '');
    return '<p data-list="' + LIST_CODES[match[1]] + '" data-level="' + match[2] + '"' +
        (match[3] ? ' data-start="' + match[3] + '"' : '') + '>' + (text === '' ? '<br>' : text.replace(/\n/g, '<br>')) + '</p>';
}

function markerPosition(lines, marker) {
    for (let p = 0; p < lines.length; p++) {
        const text = lines[p].replace(/^[^:]*:/, '');
        const clean = text.replace(marker === '|' ? /[[\]]/g : marker === '[' ? /[|\]]/g : /[|[]/g, '');
        const o = clean.indexOf(marker);
        if (o !== -1) {
            return { p: p, o: o };
        }
    }
    return null;
}

function describeLines(element) {
    const caret = App.text.getCaret(element);
    return App.text.getModel(element).map((line, p) => {
        const code = { bullet: 'b', number: 'n', none: 'p' }[line.list] + line.level + (line.start ? '@' + line.start : '');
        let text = line.text.replace(/ /g, ' ');
        const marks = [];
        if (caret && caret.anchor.p === caret.focus.p && caret.anchor.o === caret.focus.o) {
            if (caret.focus.p === p) {
                marks.push([caret.focus.o, '|']);
            }
        } else if (caret) {
            if (caret.anchor.p === p) {
                marks.push([caret.anchor.o, '[']);
            }
            if (caret.focus.p === p) {
                marks.push([caret.focus.o, ']']);
            }
        }
        marks.sort((x, y) => y[0] - x[0]).forEach(([o, mark]) => { text = text.slice(0, o) + mark + text.slice(o); });
        return code + ':' + text;
    });
}

const KEY_NAMES = {
    'Tab': { key: 'Tab' }, 'Shift+Tab': { key: 'Tab', shiftKey: true },
    'Alt+Shift+Right': { key: 'ArrowRight', altKey: true, shiftKey: true },
    'Alt+Shift+Left': { key: 'ArrowLeft', altKey: true, shiftKey: true },
    'Enter': { key: 'Enter' }, 'Shift+Enter': { key: 'Enter', shiftKey: true },
    'Backspace': { key: 'Backspace' },
};

async function runKeys(startLines, steps) {
    const frame = await renderedBox('', startLines.map(lineHtml).join(''));
    const doc = frame.contentDocument;
    const el = doc.querySelector('.el');
    el.setAttribute('contenteditable', 'true');
    el.focus();
    const anchor = markerPosition(startLines, '[');
    const caret = anchor ? { anchor: anchor, focus: markerPosition(startLines, ']') }
        : { anchor: markerPosition(startLines, '|'), focus: markerPosition(startLines, '|') };
    App.text.setCaret(el, caret);
    for (const step of steps) {
        if (step.startsWith('cmd:')) {
            // A toolbar button: works on the selected lines.
            const action = App.text.listAction(el, step.slice(4), App.text.getCaret(el));
            if (action) {
                App.text.runAction(el, action);
            }
            continue;
        }
        if (step.startsWith('type:')) {
            for (const character of step.slice(5)) {
                doc.execCommand('insertText', false, character);
                const format = App.text.autoFormatAction(el);
                if (format) {
                    App.text.runAction(el, format);
                }
            }
            continue;
        }
        const action = App.text.keyAction(el, KEY_NAMES[step]);
        if (action && action.run) {
            App.text.runAction(el, action);
        } else if (!action) {
            // Left to the browser.
            if (step === 'Backspace') {
                doc.execCommand('delete');
            } else if (step === 'Shift+Enter') {
                doc.execCommand('insertLineBreak');
            }
        }
    }
    const result = describeLines(el);
    frame.remove();
    return result;
}

const KEY_TABLE = [
    // [what, start lines, steps, expected lines]
    ['Tab at the start of a line demotes it', ['b1:|Alfa'], ['Tab'], ['b2:|Alfa']],
    ['Tab never goes past level 5', ['b5:|Alfa'], ['Tab'], ['b5:|Alfa']],
    ['Tab in the middle of text does nothing (no tab character)', ['b1:Al|fa'], ['Tab'], ['b1:Al|fa']],
    ['Tab demotes every selected line, mixed types included', ['b1:Al[fa', 'n1:Beta', 'p1:Ga]ma'], ['Tab'],
        ['b2:Al[fa', 'n2:Beta', 'p2:Ga]ma']],
    ['Tab on a plain line at its start demotes it too', ['p1:|Texto'], ['Tab'], ['p2:|Texto']],
    ['Shift+Tab at the start promotes', ['b3:|Alfa'], ['Shift+Tab'], ['b2:|Alfa']],
    ['Shift+Tab never goes below level 1', ['n1:|Alfa'], ['Shift+Tab'], ['n1:|Alfa']],
    ['Shift+Tab promotes every selected line', ['b2:[Alfa', 'b3:Be]ta'], ['Shift+Tab'], ['b1:[Alfa', 'b2:Be]ta']],
    ['Shift+Tab in the middle of text does nothing', ['b2:Al|fa'], ['Shift+Tab'], ['b2:Al|fa']],
    ['Alt+Shift+Right demotes from anywhere in the line', ['b1:Al|fa'], ['Alt+Shift+Right'], ['b2:Al|fa']],
    ['Alt+Shift+Left promotes from anywhere in the line', ['n3:Al|fa'], ['Alt+Shift+Left'], ['n2:Al|fa']],
    ['Enter in a list line makes a new line with the same type and level', ['b2:Al|fa'], ['Enter'], ['b2:Al', 'b2:|fa']],
    ['Enter at the end of a numbered line continues the numbering', ['n1:Alfa|'], ['Enter', 'type:Beta'],
        ['n1:Alfa', 'n1:Beta|']],
    ['Enter does not copy a restart number', ['n1@3:Alfa|'], ['Enter'], ['n1@3:Alfa', 'n1:|']],
    ['Enter in an empty list line promotes it', ['b1:Alfa', 'b2:|'], ['Enter'], ['b1:Alfa', 'b1:|']],
    ['Enter in an empty level-1 list line makes it plain text', ['b1:Alfa', 'b1:|'], ['Enter'], ['b1:Alfa', 'p1:|']],
    ['Enter in plain text makes a new plain line', ['p1:Tí|tulo'], ['Enter'], ['p1:Tí', 'p1:|tulo']],
    ['Enter with a selection replaces it by the line break', ['b1:A[lf]a'], ['Enter'], ['b1:A', 'b1:|a']],
    ['Shift+Enter breaks the line inside the same paragraph (no new bullet)', ['b1:Al|fa'], ['Shift+Enter'], ['b1:Al\n|fa']],
    ['Backspace at the start of a level-2+ list line promotes it', ['b3:|Alfa'], ['Backspace'], ['b2:|Alfa']],
    ['Backspace at the start of a level-1 list line removes the bullet', ['n1:|Alfa'], ['Backspace'], ['p1:|Alfa']],
    ['Backspace at the start of a plain line merges it with the line above', ['b1:Alfa', 'p1:|Beta'], ['Backspace'],
        ['b1:Alfa|Beta']],
    ['Backspace at the start of an empty plain line removes it', ['p1:Alfa', 'p1:|'], ['Backspace'], ['p1:Alfa|']],
    ['Backspace at the start of the first plain line does nothing', ['p1:|Alfa'], ['Backspace'], ['p1:|Alfa']],
    ['Backspace inside text deletes a character', ['b1:Al|fa'], ['Backspace'], ['b1:A|fa']],
    ['Backspace twice: level 2 -> level 1 -> plain', ['b2:|Alfa'], ['Backspace', 'Backspace'], ['p1:|Alfa']],
    ['"- " at the start of a plain line starts a bullet', ['p1:|'], ['type:- Receita'], ['b1:Receita|']],
    ['"* " also starts a bullet', ['p1:|'], ['type:* Receita'], ['b1:Receita|']],
    ['"1. " starts numbering', ['p1:|'], ['type:1. Passo'], ['n1:Passo|']],
    ['"3. " starts numbering at 3', ['p1:|'], ['type:3. Passo'], ['n1@3:Passo|']],
    ['"- " in the middle of a line is just text', ['p1:Alfa|'], ['type: - b'], ['p1:Alfa - b|']],
    ['"- " in a line that already has a bullet is just text', ['b1:|'], ['type:- b'], ['b1:- b|']],
    ['A typical outline: Enter, Tab, Enter, Enter, Enter', ['b1:Receita|'],
        ['Enter', 'Tab', 'type:Crescimento', 'Enter', 'Enter', 'Enter'],
        ['b1:Receita', 'b2:Crescimento', 'p1:|']],
];

KEY_TABLE.forEach(([what, start, steps, expected]) => {
    test('bullet keys: ' + what, async () => {
        assertEqual(await runKeys(start, steps), expected);
    });
});

// ---------------------------------------------------------------
// Toolbar list buttons (SPEC Phase 3, "Bullet behavior", Toolbar rows)
// ---------------------------------------------------------------
//
// Steps "cmd:bullet", "cmd:number", "cmd:indent", "cmd:outdent", "cmd:restart",
// "cmd:continue" press the button with the lines and cursor as they are.

const TOOLBAR_TABLE = [
    ['Bullets on a plain line adds a bullet, from anywhere in the line', ['p1:Al|fa'], ['cmd:bullet'], ['b1:Al|fa']],
    ['Bullets on a bulleted line removes it (the level stays)', ['b2:Al|fa'], ['cmd:bullet'], ['p2:Al|fa']],
    ['Bullets on a numbered line switches it to a bullet', ['n1:Al|fa'], ['cmd:bullet'], ['b1:Al|fa']],
    ['Bullets on a mixed selection bullets every line', ['b1:Al[fa', 'n2:Beta', 'p1:Ga]ma'], ['cmd:bullet'],
        ['b1:Al[fa', 'b2:Beta', 'b1:Ga]ma']],
    ['Bullets on a selection that is all bullets removes them all', ['b1:[Alfa', 'b2:Be]ta'], ['cmd:bullet'],
        ['p1:[Alfa', 'p2:Be]ta']],
    ['Numbering on bulleted lines numbers them', ['b1:[Alfa', 'b1:Be]ta'], ['cmd:number'], ['n1:[Alfa', 'n1:Be]ta']],
    ['Numbering toggled off also drops a restart number', ['n1@3:Al|fa'], ['cmd:number'], ['p1:Al|fa']],
    ['Increase indent works from the middle of a line', ['b1:Al|fa'], ['cmd:indent'], ['b2:Al|fa']],
    ['Decrease indent promotes every selected line, mixed types included', ['b2:[Alfa', 'n3:Beta', 'p2:Ga]ma'],
        ['cmd:outdent'], ['b1:[Alfa', 'n2:Beta', 'p1:Ga]ma']],
    ['Restart numbering starts the line at 1', ['n1:Alfa', 'n1:Be|ta'], ['cmd:restart'], ['n1:Alfa', 'n1@1:Be|ta']],
    ['Continue numbering goes on from the previous numbered run', ['n1:Alfa', 'n1:Beta', 'p1:Texto', 'n1:|Gama'],
        ['cmd:continue'], ['n1:Alfa', 'n1:Beta', 'p1:Texto', 'n1@3:|Gama']],
    ['Continue counts from a restart number', ['n1@5:Alfa', 'b1:Texto', 'n1:|Gama'], ['cmd:continue'],
        ['n1@5:Alfa', 'b1:Texto', 'n1@6:|Gama']],
    ['Continue ignores deeper lines in between', ['n1:Alfa', 'n2:Sub', 'n2:Sub', 'b1:Texto', 'n1:|Beta'],
        ['cmd:continue'], ['n1:Alfa', 'n2:Sub', 'n2:Sub', 'b1:Texto', 'n1@2:|Beta']],
    ['Continue at level 2 goes on across a level-1 line', ['n2:Alfa', 'n2:Beta', 'b1:Tópico', 'n2:|Gama'],
        ['cmd:continue'], ['n2:Alfa', 'n2:Beta', 'b1:Tópico', 'n2@3:|Gama']],
    ['Restart / continue act on the first numbered line of the selection', ['n1:Alfa', 'b1:Texto', 'p1:[x', 'n1:Ga]ma'],
        ['cmd:continue'], ['n1:Alfa', 'b1:Texto', 'p1:[x', 'n1@2:Ga]ma']],
    ['An outline built with the buttons', ['p1:Receita|'], ['cmd:bullet', 'Enter', 'cmd:indent', 'type:Crescimento',
        'Enter', 'cmd:number'], ['b1:Receita', 'b2:Crescimento', 'n2:|']],
];

TOOLBAR_TABLE.forEach(([what, start, steps, expected]) => {
    test('list buttons: ' + what, async () => {
        assertEqual(await runKeys(start, steps), expected);
    });
});

async function listBox(lines) {
    const frame = await renderedBox('', lines.map(lineHtml).join(''));
    const el = frame.contentDocument.querySelector('.el');
    const anchor = markerPosition(lines, '[');
    const caret = anchor ? { anchor: anchor, focus: markerPosition(lines, ']') }
        : { anchor: markerPosition(lines, '|'), focus: markerPosition(lines, '|') };
    App.text.setCaret(el, caret);
    return { frame: frame, el: el, caret: caret };
}

test('list buttons: restart / continue are unavailable without a numbered line or an earlier run', async () => {
    let box = await listBox(['b1:Al|fa']);
    assertEqual(App.text.listAction(box.el, 'restart', box.caret), null, 'no numbered line');
    assertEqual(App.text.listAction(box.el, 'continue', box.caret), null, 'no numbered line');
    box.frame.remove();
    box = await listBox(['b1:Alfa', 'n2:Beta', 'n1:|Gama']);
    assertEqual(App.text.listAction(box.el, 'continue', box.caret), null, 'no earlier numbered line at level 1');
    assertEqual(App.text.listAction(box.el, 'restart', box.caret).label, 'Restart numbering');
    box.frame.remove();
});

test('list buttons: without a cursor (the box is selected) they act on every line', async () => {
    const box = await listBox(['p1:|Alfa', 'b2:Beta', 'n1:Gama']);
    App.text.runAction(box.el, App.text.listAction(box.el, 'bullet', null));
    assertEqual(describeLines(box.el).map((line) => line.replace('|', '')), ['b1:Alfa', 'b2:Beta', 'b1:Gama']);
    App.text.runAction(box.el, App.text.listAction(box.el, 'indent', null));
    assertEqual(App.text.getModel(box.el).map((line) => line.level), [2, 3, 2]);
    box.frame.remove();
});

test('list buttons: listState says whether every selected line is bulleted / numbered', async () => {
    let box = await listBox(['b1:[Alfa', 'b2:Be]ta', 'n1:Gama']);
    assertEqual(App.text.listState(box.el, box.caret), { bullet: true, number: false });
    assertEqual(App.text.listState(box.el, null), { bullet: false, number: false }, 'the whole box is mixed');
    box.frame.remove();
    box = await listBox(['n1:Al|fa']);
    assertEqual(App.text.listState(box.el, box.caret), { bullet: false, number: true });
    box.frame.remove();
});

test('bullet keys: nothing happens while an IME is composing a character', async () => {
    const frame = await renderedBox('', lineHtml('b1:Alfa'));
    const el = frame.contentDocument.querySelector('.el');
    App.text.setCaret(el, { anchor: { p: 0, o: 0 }, focus: { p: 0, o: 0 } });
    assertEqual(App.text.keyAction(el, { key: 'Tab', isComposing: true }), null);
    assertEqual(App.text.keyAction(el, { key: 'Enter', isComposing: true }), null);
    frame.remove();
});

// ---------------------------------------------------------------
// Character formatting (SPEC Phase 3, Toolbar): styleAction / styleState
// ---------------------------------------------------------------
//
// Lines are written as HTML with the selection marked in the text: "[" and "]"
// for anchor and focus, "|" for a cursor. Each line becomes a plain <p>.

function placeMarkers(el) {
    const doc = el.ownerDocument;
    const found = {};
    const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        nodes.push(node);
    }
    nodes.forEach((node) => {
        let index = node.data.search(/[[\]|]/);
        while (index !== -1) {
            found[node.data[index]] = { node: node, offset: index };
            node.data = node.data.slice(0, index) + node.data.slice(index + 1);
            index = node.data.search(/[[\]|]/);
        }
    });
    const anchor = found['['] || found['|'];
    const focus = found[']'] || found['|'];
    doc.getSelection().setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
    return App.text.getCaret(el);
}

async function formatBox(lines, elStyle) {
    const frame = await renderedBox('', lines.map((line) => '<p data-list="none" data-level="1">' + line + '</p>').join(''),
        elStyle);
    const el = frame.contentDocument.querySelector('.el');
    return { frame: frame, el: el, caret: placeMarkers(el) };
}

// Runs one formatting action; returns each line's HTML and the box's own style.
async function styled(lines, style, value, elStyle) {
    const box = await formatBox(lines, elStyle);
    const action = App.text.styleAction(box.el, style, value, box.caret);
    if (action) {
        App.text.runAction(box.el, action);
    }
    const result = {
        lines: Array.from(box.el.children).map((p) => p.innerHTML),
        weight: box.el.style.fontWeight, italic: box.el.style.fontStyle,
        caret: App.text.getCaret(box.el), action: action ? action.label : null,
    };
    box.frame.remove();
    return result;
}

test('formatting: Bold on a selection wraps it in <b>', async () => {
    const result = await styled(['Alfa [Beta]'], 'bold');
    assertEqual(result.lines, ['Alfa <b>Beta</b>']);
    assertEqual(result.action, 'Bold');
    assertEqual(result.caret, { anchor: { p: 0, o: 5 }, focus: { p: 0, o: 9 } }, 'the selection stays');
});

test('formatting: Bold on text that is all bold removes it', async () => {
    assertEqual((await styled(['<b>Alfa [Beta]</b>'], 'bold')).lines, ['<b>Alfa </b>Beta']);
});

test('formatting: Bold on a partly bold selection makes all of it bold', async () => {
    assertEqual((await styled(['A[lfa <b>Be]ta</b>'], 'bold')).lines, ['A<b>lfa Beta</b>']);
});

test('formatting: a selection over two lines formats both parts', async () => {
    assertEqual((await styled(['Al[fa', 'Be]ta'], 'italic')).lines, ['Al<i>fa</i>', '<i>Be</i>ta']);
});

test('formatting: a cursor inside a word formats the whole word', async () => {
    const result = await styled(['Alfa Be|ta Gama'], 'underline');
    assertEqual(result.lines, ['Alfa <u>Beta</u> Gama']);
    assertEqual(result.caret, { anchor: { p: 0, o: 7 }, focus: { p: 0, o: 7 } }, 'the cursor stays');
});

test('formatting: a cursor outside a word has no action here (it applies to what is typed next)', async () => {
    assertEqual((await styled(['Alfa |Beta'], 'bold')).action, null);
    assertEqual((await styled(['Alfa|'], 'bold')).action, null);
});

test('formatting: un-bolding part of a bold box moves the bold onto the rest of its text', async () => {
    const result = await styled(['Alfa [Beta]', 'Gama'], 'bold', null, 'font-weight: bold;');
    assertEqual(result.lines, ['<b>Alfa </b>Beta', '<b>Gama</b>']);
    assertEqual(result.weight, 'normal');
});

test('formatting: un-italicizing part of an italic box works the same way', async () => {
    const result = await styled(['[Alfa] Beta'], 'italic', null, 'font-style: italic;');
    assertEqual(result.lines, ['Alfa<i> Beta</i>']);
    assertEqual(result.italic, 'normal');
});

test('formatting: strikethrough, superscript and subscript', async () => {
    assertEqual((await styled(['Alfa [Beta]'], 'strikethrough')).lines, ['Alfa <s>Beta</s>']);
    assertEqual((await styled(['x[2]'], 'superscript')).lines, ['x<sup>2</sup>']);
    assertEqual((await styled(['x<sup>[2]</sup>'], 'subscript')).lines, ['x<sub>2</sub>'], 'subscript replaces superscript');
    assertEqual((await styled(['x<sub>[2]</sub>'], 'subscript')).lines, ['x2'], 'subscript again removes it');
});

test('formatting: other formatting, colours and links are kept', async () => {
    const result = await styled(['<a href="https://example.com"><span style="color: red">A[lf]a</span></a> Beta'], 'underline');
    assertEqual(result.lines, ['<a href="https://example.com"><span style="color: red;">A<u>lf</u>a</span></a> Beta']);
});

test('formatting: Clear formatting removes formatting, sizes and colours from the selection (links stay)', async () => {
    const result = await styled(['<b>Al[fa</b> <span style="font-size: 24pt; color: red">Beta</span> ' +
        '<a href="https://example.com"><i>Ga]ma</i></a>'], 'clear');
    assertEqual(result.lines, ['<b>Al</b>fa Beta <a href="https://example.com">Ga<i>ma</i></a>']);
    assertEqual(result.action, 'Clear formatting');
});

test('formatting: when all the text of the box gets the same bold, it goes on the box itself', async () => {
    const result = await styled(['[Alfa', 'Beta]'], 'bold');
    assertEqual(result.lines, ['Alfa', 'Beta']);
    assertEqual(result.weight, 'bold');
});

test('formatting: with the box selected (no cursor) Bold acts on all of its text', async () => {
    const box = await formatBox(['Al|fa', '<b>Beta</b>']);
    App.text.runAction(box.el, App.text.styleAction(box.el, 'bold', null, null));
    assertEqual(Array.from(box.el.children).map((p) => p.innerHTML), ['Alfa', 'Beta']);
    assertEqual(box.el.style.fontWeight, 'bold');
    App.text.runAction(box.el, App.text.styleAction(box.el, 'bold', null, null));
    assertEqual(Array.from(box.el.children).map((p) => p.innerHTML), ['Alfa', 'Beta']);
    assertEqual(box.el.style.fontWeight, 'normal', 'and again takes it off');
    box.frame.remove();
});

test('formatting: styleState says which formatting every selected character has', async () => {
    let box = await formatBox(['<b>[Alfa <i>Be]ta</i></b>']);
    let state = App.text.styleState(box.el, box.caret);
    assertEqual([state.bold, state.italic, state.underline], [true, false, false]);
    box.frame.remove();
    box = await formatBox(['Alfa B|eta'], 'font-weight: bold;');
    state = App.text.styleState(box.el, box.caret);
    assertEqual(state.bold, true, 'a bold box counts');
    box.frame.remove();
    box = await formatBox(['x<sup>[2]</sup>']);
    state = App.text.styleState(box.el, box.caret);
    assertEqual([state.superscript, state.subscript], [true, false]);
    box.frame.remove();
});

test('font size: a size on a selection goes on a span, in pt', async () => {
    const result = await styled(['Alfa [Beta]'], 'font-size', '24pt');
    assertEqual(result.lines, ['Alfa <span style="font-size: 24pt;">Beta</span>']);
    assertEqual(result.action, 'Font size');
});

test('font size: one size for all the text of the box goes on the box itself', async () => {
    const box = await formatBox(['Al|fa', '<span style="font-size: 30pt">Beta</span>'], 'font-size: 18pt;');
    App.text.runAction(box.el, App.text.styleAction(box.el, 'font-size', '24pt', null));
    assertEqual(Array.from(box.el.children).map((p) => p.innerHTML), ['Alfa', 'Beta']);
    assertEqual(box.el.style.fontSize, '24pt');
    box.frame.remove();
});

test('font size: an empty line gets the size itself (it keeps its height, and typing there uses it)', async () => {
    const box = await formatBox(['Alfa', '|']);
    App.text.runAction(box.el, App.text.styleAction(box.el, 'font-size', '32pt', box.caret));
    assertEqual(box.el.lastElementChild.style.fontSize, '32pt');
    assertEqual(box.el.firstElementChild.innerHTML, 'Alfa', 'the other line is unchanged');
    box.frame.remove();
});

test('font size: grow and shrink step through the size list, each piece from its own size', async () => {
    const result = await styled(['[Alfa <span style="font-size: 24pt">Beta</span>]'], 'grow', null, 'font-size: 18pt;');
    assertEqual(result.lines, ['<span style="font-size: 20pt;">Alfa </span><span style="font-size: 28pt;">Beta</span>']);
    const shrunk = await styled(['[Alfa <span style="font-size: 13pt">Beta</span>]'], 'shrink', null, 'font-size: 10.5pt;');
    assertEqual(shrunk.lines, ['<span style="font-size: 10pt;">Alfa </span><span style="font-size: 12pt;">Beta</span>']);
    const ends = await styled(['[Alfa]', 'Beta'], 'grow', null, 'font-size: 96pt;');
    assertEqual(ends.lines, ['Alfa', 'Beta'], 'nothing above 96');
    assertEqual(ends.action, null);
});

test('font size: px sizes count as pt (x 0.75, to the half point)', async () => {
    const result = await styled(['[Alfa]', 'Beta'], 'grow', null, 'font-size: 15px;');   // 11.25pt -> 11.5 -> next: 12
    assertEqual(result.lines, ['<span style="font-size: 12pt;">Alfa</span>', 'Beta']);
});

test('font: a font on a selection; a theme font is stored as its variable', async () => {
    assertEqual((await styled(['Alfa [Beta]'], 'font-family', 'Georgia, serif')).lines,
        ['Alfa <span style="font-family: Georgia, serif;">Beta</span>']);
    assertEqual((await styled(['Alfa [Beta]'], 'font-family', 'var(--font-heading)')).lines,
        ['Alfa <span style="font-family: var(--font-heading);">Beta</span>']);
});

test('font size and font: styleState shows one value, or null when the selection mixes them', async () => {
    let box = await formatBox(['[Alfa <span style="font-size: 24pt; font-family: Georgia, serif">Be]ta</span>'],
        'font-size: 18pt; font-family: var(--font-body);');
    let state = App.text.styleState(box.el, box.caret);
    assertEqual([state.fontSize, state.fontFamily], [null, null]);
    box.frame.remove();
    box = await formatBox(['Alfa <span style="font-size: 24pt; font-family: Georgia, serif">B|eta</span>'], 'font-size: 18pt;');
    state = App.text.styleState(box.el, box.caret);
    assertEqual([state.fontSize, state.fontFamily], [24, 'Georgia, serif']);
    box.frame.remove();
    box = await formatBox(['Al|fa'], 'font-size: 15px; font-family: var(--font-body);');
    state = App.text.styleState(box.el, box.caret);
    assertEqual([state.fontSize, state.fontFamily], [11.5, 'var(--font-body)'], 'the box look, px shown as pt');
    box.frame.remove();
    box = await formatBox(['x<sup>[2]</sup>'], 'font-size: 20pt;');
    assertEqual(App.text.styleState(box.el, box.caret).fontSize, 20, 'superscript shows the size of its text');
    box.frame.remove();
});

test('font size: when the size moves onto the box, an empty line outside the selection keeps its size', async () => {
    const box = await formatBox(['[Alfa]', '<br>'], 'font-size: 18pt;');
    App.text.runAction(box.el, App.text.styleAction(box.el, 'font-size', '24pt', box.caret));
    assertEqual(box.el.style.fontSize, '24pt');
    assertEqual(box.el.lastElementChild.style.fontSize, '18pt');
    box.frame.remove();
});

test('colour: a colour on a selection; a theme colour is stored as its variable', async () => {
    const result = await styled(['Alfa [Beta]'], 'color', 'var(--color-primary)');
    assertEqual(result.lines, ['Alfa <span style="color: var(--color-primary);">Beta</span>']);
    assertEqual(result.action, 'Font color');
    assertEqual((await styled(['Alfa [Beta]'], 'color', '#c00000')).lines, ['Alfa <span style="color: rgb(192, 0, 0);">Beta</span>']);
});

test('colour: one colour for all the text of the box goes on the box; an empty line takes it too', async () => {
    const box = await formatBox(['[Alfa', '<br>', 'Beta]']);
    App.text.runAction(box.el, App.text.styleAction(box.el, 'color', 'var(--color-accent)', box.caret));
    assertEqual(Array.from(box.el.children).map((p) => p.innerHTML), ['Alfa', '<br>', 'Beta']);
    assertEqual(box.el.style.color, 'var(--color-accent)');
    assertEqual(box.el.children[1].style.color, 'var(--color-accent)');
    box.frame.remove();
});

test('highlight: on a selection, and "No color" takes it off; it never goes on the box', async () => {
    assertEqual((await styled(['Alfa [Beta]'], 'background-color', '#ffff00')).lines,
        ['Alfa <span style="background-color: rgb(255, 255, 0);">Beta</span>']);
    const all = await styled(['[Alfa]'], 'background-color', '#ffff00');
    assertEqual(all.lines, ['<span style="background-color: rgb(255, 255, 0);">Alfa</span>']);
    assertEqual(all.action, 'Highlight');
    assertEqual((await styled(['<span style="background-color: yellow; color: red">Al[fa]</span> Beta'], 'background-color', null)).lines,
        ['<span style="color: red; background-color: yellow;">Al</span><span style="color: red;">fa</span> Beta']);
});

// ---------------------------------------------------------------
// Paragraph formatting: alignment, line spacing, space before / after
// ---------------------------------------------------------------

async function paragraphed(lines, property, value, elStyle, noCaret) {
    const box = await formatBox(lines, elStyle);
    const action = App.text.paragraphAction(box.el, property, value, noCaret ? null : box.caret);
    App.text.runAction(box.el, action);
    const result = { styles: Array.from(box.el.children).map((p) => p.getAttribute('style') || ''),
        label: action.label, caret: App.text.getCaret(box.el), html: box.el.innerHTML };
    box.frame.remove();
    return result;
}

test('paragraph: alignment goes on every selected line', async () => {
    const result = await paragraphed(['Alfa', 'Be[ta', 'Ga]ma'], 'text-align', 'center');
    assertEqual(result.styles, ['', 'text-align: center;', 'text-align: center;']);
    assertEqual(result.label, 'Center');
    assertEqual(result.caret, { anchor: { p: 1, o: 2 }, focus: { p: 2, o: 2 } }, 'the selection stays');
});

test('paragraph: a cursor aligns its line; a selected box aligns all its lines', async () => {
    assertEqual((await paragraphed(['Alfa', 'Be|ta'], 'text-align', 'right')).styles, ['', 'text-align: right;']);
    assertEqual((await paragraphed(['Alfa', 'Be|ta'], 'text-align', 'justify', '', true)).styles,
        ['text-align: justify;', 'text-align: justify;']);
});

test('paragraph: line spacing, space before and after on the line; normalize keeps them', async () => {
    const result = await paragraphed(['Al|fa'], 'line-height', '1.8');
    assertEqual(result.styles, ['line-height: 1.8;']);
    assertEqual(result.label, 'Line spacing');
    assertEqual((await paragraphed(['Al|fa'], 'margin-top', '12pt')).styles, ['margin-top: 12pt;']);
    assertEqual((await paragraphed(['Al|fa'], 'margin-bottom', '6pt')).label, 'Space after');
    assertEqual(normalized(result.html), result.html, 'normalize changes nothing');
});

test('paragraph: paragraphState shows the selected lines’ alignment, spacing and space (null when mixed)', async () => {
    let box = await formatBox(['<span style="font-size: 20pt">Al[fa</span>', 'Be]ta'], 'font-size: 20pt; text-align: center; line-height: 1.38;');
    let state = App.text.paragraphState(box.el, box.caret);
    assertEqual([state.align, state.lineHeight], ['center', 1.38]);
    box.frame.remove();
    box = await formatBox(['Al[fa', 'Be]ta'], 'font-size: 20px;');
    box.el.children[1].style.textAlign = 'right';
    box.el.children[0].style.marginTop = '12pt';
    box.el.children[0].style.marginBottom = '6pt';
    state = App.text.paragraphState(box.el, box.caret);
    assertEqual(state.align, null, 'left and right: mixed');
    assertEqual(state.spaceBefore, null, '12 and 0: mixed');
    state = App.text.paragraphState(box.el, { anchor: { p: 0, o: 1 }, focus: { p: 0, o: 1 } });
    assertEqual([state.align, state.spaceBefore, state.spaceAfter], ['left', 12, 6]);
    box.frame.remove();
});

// ---------------------------------------------------------------
// Paste (SPEC Phase 3, "Paste into text")
// ---------------------------------------------------------------
//
// Start lines in the bullet-table notation; clipboard = { html, text } or a
// fixture name (tests/fixtures/clipboard/). Returns the lines with the cursor
// and each line's HTML.

async function pasted(startLines, clipboard, mode) {
    const box = await listBox(startLines);
    const data = typeof clipboard === 'string' ? {
        html: clipboardFixture(clipboard).types['text/html'] || '',
        text: clipboardFixture(clipboard).types['text/plain'] || '',
    } : clipboard;
    const action = App.text.pasteAction(box.el, box.caret, data, mode || 'normal');
    if (action) {
        App.text.runAction(box.el, action);
    }
    const result = { lines: describeLines(box.el), html: Array.from(box.el.children).map((p) => p.innerHTML),
        label: action ? action.label : null };
    box.frame.remove();
    return result;
}

test('paste: Word bullets in three levels become flat paragraphs with levels, glyphs gone', async () => {
    const result = await pasted(['p1:|'], 'word-bullets-3-levels');
    assertEqual(result.lines, ['b1:Receita de R$ 480 mi', 'b2:Varejo forte no Sul', 'b3:Detalhe em vermelho|']);
    assertEqual(result.label, 'Paste');
});

test('paste: Ctrl+V keeps bold / italic but takes the deck’s fonts, sizes and colours', async () => {
    const result = await pasted(['p1:|'], 'word-bullets-3-levels');
    assertEqual(result.html.slice(1), ['Varejo <b>forte</b> no Sul', 'Detalhe em <i>vermelho</i>']);
});

test('paste: a Word numbered list keeps numbers and levels (1. / a. / i.)', async () => {
    const result = await pasted(['p1:|'], 'word-numbered');
    assertEqual(result.lines, ['p1:Próximos passos', 'n1:Diligência', 'n2:Financeira', 'n3:Capital de giro', 'n1:Assinatura|']);
    assertEqual(result.html[0], '<b>Próximos passos</b>');
});

test('paste: Outlook keeps its bullets and links', async () => {
    const result = await pasted(['p1:|'], 'outlook-bullets');
    assertEqual(result.lines, ['p1:Olá equipe,', 'b1:Ver o modelo', 'b2:Aba de premissas|']);
    assertEqual(result.html[1], 'Ver o <a href="https://example.com/modelo">modelo</a>');
});

test('paste (real capture): PowerPoint bullets in three levels, bold kept, highlight and colour dropped', async () => {
    const result = await pasted(['p1:|'], '3-level-bullet-powerpoint');
    assertEqual(result.lines, ['b1:Aaaa aaaaaa', 'b2:Aaa', 'b3:aaaa|']);
    assertEqual(result.html[0], '<b>Aaaa </b>aaaaaa');
});

test('paste (real capture): PowerPoint lines copied from level 2 keep their levels (class O1 = level 2)', async () => {
    const html = clipboardFixture('3-level-bullet-powerpoint').types['text/html'];
    const withoutFirst = html.replace(/<div style=[^>]*>[\s\S]*?<\/div>/, '');   // the level-1 line (the only one without a class)
    assertEqual((await pasted(['p1:|'], { html: withoutFirst, text: 'x' })).lines, ['b2:Aaa', 'b3:aaaa|']);
});

test('paste (real capture): PowerPoint formatted text: bold kept, Aptos 18pt, black and yellow dropped', async () => {
    const result = await pasted(['p1:|'], 'formatted-text-powerpoint');
    assertEqual(result.html, ['<b>Aaaa </b>aaaaaa']);
});

test('paste (real capture): Word bullets in three levels', async () => {
    assertEqual((await pasted(['p1:|'], '3-level-bullet-word')).lines, ['b1:Aaaaaaaaaaa', 'b2:Aaaa', 'b3:Aaa|']);
});

test('paste (real capture): Word formatted text: red and highlight dropped', async () => {
    assertEqual((await pasted(['p1:|'], 'formatted-text-word')).html, ['aaaaaaaaaaa']);
});

test('paste: Copilot’s chat (nested lists, a heading in bold)', async () => {
    const result = await pasted(['p1:|'], 'copilot-chat');
    assertEqual(result.lines, ['p1:Resumo do mercado', 'b1:Receita: R$ 480 mi em 2025', 'b2:Varejo: 60%', 'b3:Sul lidera',
        'b2:Atacado: 40%', 'b1:Margem: 18%|']);
    assertEqual([result.html[0], result.html[1]], ['<b>Resumo do mercado</b>', '<b>Receita</b>: R$ 480 mi em 2025']);
});

test('paste: a web page (heading, link, italic, numbered list), its look dropped', async () => {
    const result = await pasted(['p1:|'], 'web-page');
    assertEqual(result.lines, ['p1:Setor de alimentos', 'p1:O setor cresceu 8% segundo o relatório anual.', 'n1:Consolidação',
        'n1:Exportação|']);
    assertEqual(result.html[1], 'O setor cresceu <i>8%</i> segundo o <a href="https://example.com/relatorio">relatório anual</a>.');
});

test('paste: in the middle of a line, the first pasted line joins it and the rest of the line follows the last', async () => {
    assertEqual((await pasted(['p1:Al|fa'], { html: '', text: 'X\nY' })).lines, ['p1:AlX', 'p1:Y|fa']);
});

test('paste: plain lines pasted into a bullet become bullets at that level', async () => {
    assertEqual((await pasted(['b2:Alfa |'], { html: '<p>Um</p><p>Dois</p>', text: 'Um\nDois' })).lines,
        ['b2:Alfa Um', 'b2:Dois|']);
});

test('paste: the pasted text replaces the selection, also across lines', async () => {
    assertEqual((await pasted(['p1:A[lf]a'], { html: '', text: 'Z' })).lines, ['p1:AZ|a']);
    assertEqual((await pasted(['b1:A[lfa', 'p1:Be]ta'], { html: '', text: 'Z' })).lines, ['b1:AZ|ta']);
});

test('paste: pasted text takes the size and colour where it lands', async () => {
    const result = await pasted(['p1:|'], { html: '<span style="font-size: 9px; color: blue">Novo</span>', text: 'Novo' });
    assertEqual(result.html, ['Novo']);
    const box = await listBox(['p1:x|']);
    box.el.firstElementChild.innerHTML = '<span style="font-size: 24pt; color: red">Alfa</span>';
    App.text.setCaret(box.el, { anchor: { p: 0, o: 4 }, focus: { p: 0, o: 4 } });
    App.text.runAction(box.el, App.text.pasteAction(box.el, App.text.getCaret(box.el),
        { html: '<b style="color: blue">Novo</b>', text: 'Novo' }, 'normal'));
    assertEqual(box.el.firstElementChild.innerHTML, '<span style="font-size: 24pt; color: red;">Alfa<b>Novo</b></span>');
    box.frame.remove();
});

test('paste: Ctrl+Shift+V pastes the plain text, in the look where it lands', async () => {
    const result = await pasted(['p1:|'], 'word-numbered', 'plain');
    assertEqual(result.lines[1], 'p1:1.\tDiligência'.replace('\t', ' '));
    assertEqual(result.html[0], 'Próximos passos', 'no bold');
});

test('paste: text copied in the editor keeps all its formatting (theme values as variables)', async () => {
    const html = '<div data-deck-editor="text"><ul><li data-list="bullet" data-level="2"><span style="font-family: Calibri, ' +
        'Arial, sans-serif; font-size: 20pt; color: rgb(204, 9, 47);" data-theme-font="--font-body" ' +
        'data-theme-color="--color-primary">Alfa</span></li></ul></div>';
    const result = await pasted(['p1:|'], { html: html, text: 'Alfa' });
    assertEqual(result.lines, ['b2:Alfa|']);
    assertEqual(result.html, ['<span style="font-family: var(--font-body); font-size: 20pt; color: var(--color-primary);">Alfa</span>']);
});

test('paste: an empty clipboard does nothing', async () => {
    assertEqual((await pasted(['p1:Al|fa'], { html: '', text: '' })).label, null);
});

// ---------------------------------------------------------------
// Copy out of a text (SPEC Phase 3: nested <ul>/<ol> on the clipboard)
// ---------------------------------------------------------------

const THEME_CSS = ':root { --font-body: Calibri, Arial, sans-serif; --color-primary: #cc092f; }';

async function copied(lines, elStyle) {
    const frame = await renderedBox(THEME_CSS, lines.map(lineHtml).join(''), elStyle);
    const el = frame.contentDocument.querySelector('.el');
    const anchor = markerPosition(lines, '[');
    const caret = anchor ? { anchor: anchor, focus: markerPosition(lines, ']') }
        : { anchor: markerPosition(lines, '|'), focus: markerPosition(lines, '|') };
    App.text.setCaret(el, caret);
    const content = App.text.copyContent(el, caret);
    return { frame: frame, el: el, caret: caret, content: content,
        dom: content ? new DOMParser().parseFromString(content.html, 'text/html') : null };
}

test('copy: the selection as nested lists for Word / Outlook, and as plain lines', async () => {
    const box = await copied(['b1:Al[fa', 'b2:Beta', 'b2:Gama', 'n1:Del]ta', 'p1:Fim']);
    const dom = box.dom;
    assert(dom.querySelector('[data-deck-editor="text"]'), 'marked as the editor’s');
    // Each item: its list, its level, its own text (without the lists nested in it).
    const ownText = (li) => Array.from(li.childNodes).filter((node) => !/^(UL|OL)$/.test(node.nodeName))
        .map((node) => node.textContent).join('');
    assertEqual(Array.from(dom.querySelectorAll('li')).map((li) => [li.parentElement.tagName, li.getAttribute('data-level'), ownText(li)]),
        [['UL', '1', 'fa'], ['UL', '2', 'Beta'], ['UL', '2', 'Gama'], ['OL', '1', 'Del']]);
    assertEqual(dom.querySelector('li ul').parentElement.getAttribute('data-level'), '1', 'level 2 nested inside level 1');
    assertEqual(box.content.text, 'fa\nBeta\nGama\nDel');
    box.frame.remove();
});

test('copy: a cursor alone copies nothing (the browser does nothing either)', async () => {
    const box = await copied(['b1:Al|fa']);
    assertEqual(box.content, null);
    box.frame.remove();
});

test('copy: the text carries its full look, theme values written out with their names', async () => {
    const box = await copied(['p1:[Alfa]'], 'font-family: var(--font-body); font-size: 20pt; color: var(--color-primary); font-weight: bold;');
    const span = box.dom.querySelector('span');
    assertEqual([span.style.fontFamily, span.style.fontSize, span.style.color],
        ['Calibri, Arial, sans-serif', '20pt', 'rgb(204, 9, 47)'], 'real values for Word / Outlook');
    assertEqual([span.getAttribute('data-theme-font'), span.getAttribute('data-theme-color')], ['--font-body', '--color-primary']);
    assert(box.dom.querySelector('b'), 'the box’s bold is on the text');
    box.frame.remove();
});

test('copy then paste in another box: the text keeps its look, theme links included', async () => {
    const source = await copied(['b2:[Alfa ', 'n1:Be]ta'], 'font-family: var(--font-body); font-size: 20pt; color: var(--color-primary);');
    const result = await pasted(['p1:|'], source.content);
    assertEqual(result.lines, ['b2:Alfa', 'n1:Be|']);
    assertEqual(result.html[0], '<span style="font-family: var(--font-body); font-size: 20pt; color: var(--color-primary);">Alfa</span>');
    source.frame.remove();
});

test('copy: a numbered list copied from its middle keeps its numbers outside (ol start)', async () => {
    const box = await copied(['n1:Um', 'n1:Dois', 'n1:[Três', 'n1:Qua]tro']);
    assertEqual(box.dom.querySelector('ol').getAttribute('start'), '3');
    box.frame.remove();
});

test('cut: removes the selection as one action', async () => {
    const box = await copied(['b1:Al[fa', 'b1:Be]ta']);
    App.text.runAction(box.el, App.text.cutAction(box.el, box.caret));
    assertEqual(describeLines(box.el), ['b1:Al|ta']);
    box.frame.remove();
});

test('formatting: styleState of a selected box with an empty line or a line break (no cursor) works', async () => {
    const box = await formatBox(['<b>Al|fa</b><br>Beta', '<br>'], 'font-size: 20pt;');
    const state = App.text.styleState(box.el, null);
    assertEqual([state.bold, state.fontSize], [false, 20]);
    box.frame.remove();
});

test('paste as plain text (real capture): Word’s bullet symbols and tabs are not pasted as text', async () => {
    assertEqual((await pasted(['p1:|'], '3-level-bullet-word', 'plain')).lines, ['p1:Aaaaaaaaaaa', 'p1:Aaaa', 'p1:Aaa|']);
    assertEqual((await pasted(['b1:|'], '3-level-bullet-word', 'plain')).lines, ['b1:Aaaaaaaaaaa', 'b1:Aaaa', 'b1:Aaa|'],
        'into a bullet: one bullet each, the editor’s');
});

test('paste as plain text: numbers stay (they mean something), a tab after them becomes a space', async () => {
    assertEqual((await pasted(['p1:|'], { html: '', text: '1.\tUm\r\na.\tDois\r\n•\tTrês\r\no\tQuatro' }, 'plain')).lines,
        ['p1:1. Um', 'p1:a. Dois', 'p1:Três', 'p1:Quatro|']);
});

// ---------------------------------------------------------------
// Format painter (SPEC Phase 3): pickLook / lookAction
// ---------------------------------------------------------------

test('format painter: picks up the full look of the character at the cursor, and its line’s paragraph look', async () => {
    const box = await formatBox(['<b><span style="color: red; font-size: 24pt">Al|fa</span></b>'], 'font-family: Georgia, serif; text-align: center;');
    box.el.firstElementChild.style.lineHeight = '1.8';
    const look = App.text.pickLook(box.el, box.caret);
    assertEqual(look.formats, ['b']);
    assertEqual(look.styles, { 'font-size': '24pt', color: 'red', 'font-family': 'Georgia, serif' });
    assertEqual(look.paragraph, { 'line-height': '1.8', 'text-align': 'center' });
    box.frame.remove();
});

test('format painter: the look replaces the selection’s (other formatting goes)', async () => {
    const box = await formatBox(['Alfa <u>[Beta]</u> Gama']);
    const look = { formats: ['b', 'i'], styles: { 'font-size': '24pt', color: 'red' }, paragraph: { 'text-align': 'right' } };
    App.text.runAction(box.el, App.text.lookAction(box.el, box.caret, look));
    assertEqual(box.el.firstElementChild.innerHTML, 'Alfa <span style="font-size: 24pt; color: red;"><b><i>Beta</i></b></span> Gama');
    assertEqual(box.el.firstElementChild.style.textAlign, '', 'part of a line: no paragraph look');
    box.frame.remove();
});

test('format painter: a cursor inside a word paints the word; whole lines also get the paragraph look', async () => {
    let box = await formatBox(['Alfa Be|ta']);
    const look = { formats: ['i'], styles: {}, paragraph: { 'text-align': 'center', 'margin-top': '12pt' } };
    App.text.runAction(box.el, App.text.lookAction(box.el, box.caret, look));
    assertEqual(box.el.firstElementChild.innerHTML, 'Alfa <i>Beta</i>');
    box.frame.remove();
    box = await formatBox(['[Alfa', 'Beta]', 'Gama']);
    App.text.runAction(box.el, App.text.lookAction(box.el, box.caret, look));
    assertEqual(Array.from(box.el.children).map((p) => [p.innerHTML, p.style.textAlign, p.style.marginTop]),
        [['<i>Alfa</i>', 'center', '12pt'], ['<i>Beta</i>', 'center', '12pt'], ['Gama', '', '']]);
    box.frame.remove();
});

test('format painter: on a whole box (no cursor) every line takes the look; a not-bold look un-bolds a bold box', async () => {
    const box = await formatBox(['Al|fa', '<span style="color: blue">Beta</span>'], 'font-weight: bold; font-size: 18pt;');
    App.text.runAction(box.el, App.text.lookAction(box.el, null,
        { formats: [], styles: { 'font-size': '30pt', color: 'red' }, paragraph: { 'text-align': 'center' } }));
    assertEqual(Array.from(box.el.children).map((p) => [p.innerHTML, p.style.textAlign]), [['Alfa', 'center'], ['Beta', 'center']]);
    assertEqual([box.el.style.fontWeight, box.el.style.fontSize, box.el.style.color], ['normal', '30pt', 'red']);
    box.frame.remove();
});

test('format painter: values the target box already has are not repeated on the text', async () => {
    const box = await formatBox(['Alfa [Beta]'], 'font-family: var(--font-body); font-size: 16.5pt;');
    App.text.runAction(box.el, App.text.lookAction(box.el, box.caret,
        { formats: ['b'], styles: { 'font-family': 'var(--font-body)', 'font-size': '20pt' }, paragraph: {} }));
    assertEqual(box.el.firstElementChild.innerHTML, 'Alfa <span style="font-size: 20pt;"><b>Beta</b></span>');
    box.frame.remove();
});

// ---------------------------------------------------------------
// Autofit (SPEC Phase 3): data-autofit="shrink|resize|off"
// ---------------------------------------------------------------

async function autofitBox(lineCount, autofit) {
    const lines = [];
    for (let i = 0; i < lineCount; i++) {
        lines.push('<p data-list="bullet" data-level="1">Linha ' + (i + 1) + ' com algum texto</p>');
    }
    const frame = await renderedBox(App.text.deckTextCss(), lines.join(''), 'width: 300px; height: 120px; font-size: 20pt; line-height: 1.2;');
    const el = frame.contentDocument.querySelector('.el');
    if (autofit) {
        el.setAttribute('data-autofit', autofit);
    }
    return { frame: frame, el: el };
}

test('autofit: the text stylesheet shrinks the lines of a "shrink" box by its --autofit-scale', () => {
    assertIncludes(App.text.deckTextCss(), '.el[data-autofit="shrink"] > p { zoom: var(--autofit-scale, 1); }');
});

test('autofit: shrink scales the text down until it fits the box, and back to 100% when it fits again', async () => {
    const box = await autofitBox(6, 'shrink');
    assert(box.el.scrollHeight > box.el.clientHeight, 'it overflows at first');
    assertEqual(App.text.fitText(box.el), true);
    const scale = parseFloat(box.el.style.getPropertyValue('--autofit-scale'));
    assert(scale > 0.3 && scale < 1, 'scaled down: ' + scale);
    assert(box.el.scrollHeight <= box.el.clientHeight + 1, 'now it fits');
    assertEqual(String(scale), scale.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''), 'two decimals at most');
    while (box.el.children.length > 1) {   // one line (two on screen: it wraps) fits
        box.el.lastElementChild.remove();
    }
    App.text.fitText(box.el);
    assertEqual(box.el.style.getPropertyValue('--autofit-scale'), '', 'fits again: no scale');
    box.frame.remove();
});

test('autofit: "resize" grows the box; "off" (or none) leaves box and text alone', async () => {
    let box = await autofitBox(6, 'resize');
    App.text.fitText(box.el);
    assert(parseFloat(box.el.style.height) > 120 && box.el.scrollHeight <= box.el.clientHeight + 1, 'grown: ' + box.el.style.height);
    box.frame.remove();
    box = await autofitBox(6, 'off');
    assertEqual(App.text.fitText(box.el), false);
    assertEqual([box.el.style.height, box.el.style.getPropertyValue('--autofit-scale')], ['120px', '']);
    box.frame.remove();
});

test('autofit: autofitAction switches the mode and fits at once; leaving shrink drops the scale', async () => {
    const box = await autofitBox(6, null);
    let action = App.text.autofitAction(box.el, 'shrink');
    assertEqual(action.label, 'Shrink text on overflow');
    action.run();
    assertEqual(box.el.getAttribute('data-autofit'), 'shrink');
    assert(box.el.style.getPropertyValue('--autofit-scale') !== '', 'scaled');
    App.text.autofitAction(box.el, 'off').run();
    assertEqual([box.el.getAttribute('data-autofit'), box.el.style.getPropertyValue('--autofit-scale')], ['off', '']);
    assertEqual(App.text.autofitAction(box.el, 'off'), null, 'already off: nothing to do');
    box.frame.remove();
});
