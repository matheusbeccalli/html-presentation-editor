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
        '<p data-list="none" data-level="1" style="--marker-size: 24pt; --marker-color: rgb(204, 9, 47);">' +
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
        '<p data-list="none" data-level="1" style="text-align: right; --marker-size: 20pt; --marker-color: rgb(31, 42, 68);">' +
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
        '<p data-list="bullet" data-level="1" style="--marker-size: 28pt; --marker-color: red;">' +
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
