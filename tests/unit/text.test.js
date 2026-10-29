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
