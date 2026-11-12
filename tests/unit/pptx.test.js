/*
 * pptx.test.js - the PowerPoint export (Phase 8, SPEC 7.4): reading text as it shows
 * (text.exportParagraphs) and the pure conversions in pptx.js (inches, colours, fonts,
 * runs and paragraph options). Building a real .pptx and reading it back is in e2e_test.py.
 */

/* A text box in this page (computed styles need a shown element), with the deck's list CSS. */
function exportBox(html) {
    const style = document.createElement('style');
    style.textContent = ':root { ' + App.text.themeVariablesCss() + ' }\n' + App.text.deckTextCss();
    const box = document.createElement('div');
    box.className = 'el';
    box.setAttribute('data-type', 'text');
    box.style.cssText = 'position: absolute; left: -5000px; top: 0; width: 600px; font: 24px Arial, sans-serif; color: rgb(10, 20, 30)';
    box.innerHTML = html;
    document.head.appendChild(style);
    document.body.appendChild(box);
    return { box: box, done: () => { box.remove(); style.remove(); } };
}

test('pptx: exportParagraphs reads lists, shown numbers, bullets and runs with their look', () => {
    const made = exportBox(
        '<p data-list="bullet" data-level="1">Um  <b>dois</b><br>três</p>' +
        '<p data-list="number" data-level="1">A</p><p data-list="number" data-level="2">B</p>' +
        '<p data-list="number" data-level="1">C</p>' +
        '<p data-list="none" data-level="1"><u>x</u> <sup>2</sup> <span style="color: rgb(204, 9, 47)">red</span></p>' +
        '<p data-list="none" data-level="1"></p>');
    try {
        const paragraphs = App.text.exportParagraphs(made.box);
        assertEqual(paragraphs.map((p) => p.list), ['bullet', 'number', 'number', 'number', 'none', 'none']);
        assertEqual(paragraphs.map((p) => p.level), [1, 1, 2, 1, 1, 1]);
        assertEqual(paragraphs.map((p) => p.number), [null, 1, 1, 2, null, null], 'the numbers the slide shows');
        assertEqual(paragraphs[0].marker, '•');
        assertEqual(paragraphs[0].runs.map((r) => [r.text, r.breakBefore, r.look.bold]),
            [['Um ', false, false], ['dois', false, true], ['três', true, false]], 'spaces collapsed, <br> breaks, bold');
        const fancy = paragraphs[4].runs;
        assertEqual(fancy.map((r) => r.text), ['x', ' ', '2', ' ', 'red']);
        assertEqual([fancy[0].look.underline, fancy[2].look.superscript, fancy[4].look.color], [true, true, 'rgb(204, 9, 47)']);
        assertEqual([fancy[1].look.fontSize, fancy[1].look.color, fancy[1].look.fontFamily], [24, 'rgb(10, 20, 30)', 'Arial, sans-serif']);
        assertEqual([paragraphs[5].runs.length, paragraphs[5].emptyLook.fontSize], [0, 24], 'an empty line keeps its size');
        assertEqual(paragraphs[0].indent > 0 && paragraphs[2].indent > paragraphs[1].indent, true, 'deeper levels sit further in');
    } finally {
        made.done();
    }
});

test('pptx: slide px become inches (96 px = 1 in) and text px become points', () => {
    assertEqual(App.pptx.inches(1280), 13.333333);
    assertEqual(App.pptx.inches(96), 1);
    assertEqual(App.pptx.points(24), 18);
});

test('pptx: CSS colours become PowerPoint hex and transparency', () => {
    assertEqual(App.pptx.colorOf('rgb(204, 9, 47)'), { hex: 'CC092F', transparency: 0 });
    assertEqual(App.pptx.colorOf('rgba(0, 0, 0, 0.25)'), { hex: '000000', transparency: 75 });
    assertEqual(App.pptx.colorOf('rgba(0, 0, 0, 0)'), null, 'invisible: none');
    assertEqual(App.pptx.colorOf('transparent'), null);
    assertEqual(App.pptx.colorOf('color(srgb 0.5 1 0 / 0.5)'), { hex: '80FF00', transparency: 50 }, 'color-mix results');
    assertEqual(App.pptx.colorOf('#1f2a44'), { hex: '1F2A44', transparency: 0 });
});

test('pptx: the first font of a list, the turn of an element', () => {
    assertEqual(App.pptx.fontFace('"Segoe UI", Calibri, sans-serif'), 'Segoe UI');
    assertEqual(App.pptx.fontFace('Calibri, Arial'), 'Calibri');
    assertEqual(App.pptx.rotationOf('rotate(45deg)'), 45);
    assertEqual(App.pptx.rotationOf('rotate(-90deg)'), 270, 'PowerPoint turns 0-359');
    assertEqual(App.pptx.rotationOf(''), 0);
});

test('pptx: paragraphs become PptxGenJS text runs with paragraph options', () => {
    const look = { fontFamily: 'Calibri, sans-serif', fontSize: 24, color: 'rgb(31, 42, 68)', bold: true, italic: false,
        underline: true, strike: false, superscript: false, subscript: false, highlight: null, letterSpacing: 0, uppercase: false };
    const runs = App.pptx.textRuns([
        { list: 'bullet', level: 1, number: null, marker: '•', align: 'left', lineHeight: 34.56, fontSize: 24,
            spaceBefore: 8, spaceAfter: 0, indent: 24, runs: [{ text: 'Um', breakBefore: false, look: look },
                { text: 'dois', breakBefore: true, look: Object.assign({}, look, { bold: false, underline: false }) }] },
        { list: 'number', level: 2, number: 3, marker: '', align: 'center', lineHeight: null, fontSize: 24,
            spaceBefore: 0, spaceAfter: 0, indent: 56, runs: [{ text: 'três', breakBefore: false, look: look }] },
        { list: 'none', level: 1, number: null, marker: '', align: 'right', lineHeight: null, fontSize: 18,
            spaceBefore: 0, spaceAfter: 0, indent: 0, runs: [], emptyLook: Object.assign({}, look, { fontSize: 18 }) },
    ], { 2: 'alphaLcPeriod' });
    assertEqual(runs.map((r) => r.text), ['Um', 'dois', 'três', '']);
    const first = runs[0].options;
    assertEqual([first.bold, first.underline, first.color, first.fontSize, first.fontFace], [true, { style: 'sng' }, '1F2A44', 18, 'Calibri']);
    assertEqual([first.bullet.code, first.indentLevel, first.paraSpaceBefore, first.lineSpacingMultiple], ['2022', 0, 6, 1.2]);
    assertEqual(!!runs[1].options.softBreakBefore, true, 'a <br>: a new line in the same paragraph');
    assertEqual([!!runs[1].options.breakLine, !!runs[2].options.breakLine, !!runs[3].options.breakLine], [true, true, false],
        'every paragraph but the last ends with a break');
    assertEqual([runs[2].options.bullet.type, runs[2].options.bullet.style, runs[2].options.bullet.startAt, runs[2].options.indentLevel],
        ['number', 'alphaLcPeriod', 3, 1], 'numbered: the style of its level, the number it shows');
    assertEqual([runs[2].options.align, runs[3].options.align, runs[3].options.fontSize], ['center', 'right', 13.5]);
    assertEqual(runs[3].options.bullet, false, 'a plain line has no bullet');
});
