/*
 * pdf.test.js - PDF / printing (Phase 8, SPEC 7.2): the slide range typed in the
 * PDF dialog, which slides print, and the document that is printed.
 * The dialog and the printing itself are in e2e_test.py.
 */

test('pdf: a range like "1-3, 5" gives those slides (0-based, in order, once each)', () => {
    assertEqual(App.pdf.parseRange('1-3, 5', 6), { indexes: [0, 1, 2, 4] });
    assertEqual(App.pdf.parseRange(' 5;2 ,2-3 ', 6), { indexes: [1, 2, 4] }, 'commas or semicolons, repeats once');
    assertEqual(App.pdf.parseRange('4-2', 6), { indexes: [1, 2, 3] }, 'a backwards range is read forwards');
    assertEqual(App.pdf.parseRange('6', 6), { indexes: [5] });
});

test('pdf: a wrong range says what is wrong', () => {
    assertEqual(App.pdf.parseRange('', 6), { error: 'Type the slides to print, e.g. 1-3, 5.' });
    assertEqual(App.pdf.parseRange('9', 6), { error: 'There is no slide 9: the deck has 6 slides.' });
    assertEqual(App.pdf.parseRange('0-2', 6), { error: 'There is no slide 0: the deck has 6 slides.' });
    assertEqual(App.pdf.parseRange('1-a', 6), { error: '"1-a" is not a slide number or a range like 1-3.' });
});

test('pdf: which slides print: all / current / range, hidden ones only when asked', () => {
    const hidden = [false, false, false, false, true, false];
    const pick = (options) => App.pdf.pickSlides(Object.assign({ current: 2, hidden: hidden, includeHidden: false }, options));
    assertEqual(pick({ mode: 'all' }), [0, 1, 2, 3, 5]);
    assertEqual(pick({ mode: 'all', includeHidden: true }), [0, 1, 2, 3, 4, 5]);
    assertEqual(pick({ mode: 'current' }), [2]);
    assertEqual(pick({ mode: 'current', current: 4 }), [4], 'the current slide prints even when hidden: you asked for it');
    assertEqual(pick({ mode: 'range', range: [0, 4, 5] }), [0, 5]);
    assertEqual(pick({ mode: 'range', range: [0, 4, 5], includeHidden: true }), [0, 4, 5]);
});

test('pdf: the printed document holds only the chosen slides, shown, with the page size and no editor marks', () => {
    const doc = document.implementation.createHTMLDocument('deck');
    doc.body.innerHTML =
        '<section class="slide" data-slide-id="s1" data-editor-current=""><div class="el editor-selected">A</div>' +
        '<aside class="notes">notes</aside></section>' +
        '<section class="slide" data-slide-id="s2" data-hidden="true"><div class="el">B</div></section>' +
        '<section class="slide" data-slide-id="s3"><div class="el">C</div></section>';
    const html = App.pdf.printDocument(doc, [0, 1], 'Projeto Atlas', '@page { size: 13.333in 7.5in; margin: 0 }');
    const printed = new DOMParser().parseFromString(html, 'text/html');
    const ids = Array.from(printed.querySelectorAll('section.slide')).map((s) => s.getAttribute('data-slide-id'));
    assertEqual(ids, ['s1', 's2']);
    assertEqual(printed.querySelector('[data-slide-id="s2"]').hasAttribute('data-hidden'), false,
        'a hidden slide chosen to print is not hidden in the print');
    assertEqual(printed.querySelectorAll('[data-editor-current], .editor-selected').length, 0, 'no editor marks');
    assertEqual(printed.title, 'Projeto Atlas', 'the title names the PDF');
    assertEqual(html.indexOf('@page { size: 13.333in 7.5in; margin: 0 }') > 0, true, 'the print styles');
    assertEqual(doc.querySelectorAll('section.slide').length, 3, 'the deck itself is untouched');
});
