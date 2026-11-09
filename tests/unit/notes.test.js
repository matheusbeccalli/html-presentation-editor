/*
 * notes.test.js - speaker notes (Phase 7): plain text in each slide's
 * <aside class="notes">, kept the last thing in the slide.
 */

test('notes: a slide\'s notes as plain text, line breaks kept', () => {
    const doc = parseDoc('<section class="slide"><div class="el"></div><aside class="notes">\n  Linha 1\nLinha 2  \n</aside></section>');
    assertEqual(App.notes.textOf(doc.querySelector('section')), 'Linha 1\nLinha 2');
    assertEqual(App.notes.textOf(parseDoc('<section class="slide"></section>').querySelector('section')), '');
    assertEqual(App.notes.textOf(null), '');
});

test('notes: writing notes; a slide without them gets an <aside class="notes"> at its end', () => {
    const doc = parseDoc('<section class="slide"><div class="el" data-id="e1"></div></section>');
    const slide = doc.querySelector('section');
    App.notes.write(slide, 'Abrir com o contexto.\nDepois os números.');
    assertEqual(slide.lastElementChild.outerHTML, '<aside class="notes">Abrir com o contexto.\nDepois os números.</aside>');
    App.notes.write(slide, '<b>não é HTML</b>');
    assertEqual(slide.querySelector('aside.notes').innerHTML, '&lt;b&gt;não é HTML&lt;/b&gt;', 'text, never markup');
    App.notes.write(slide, '');
    assertEqual(slide.querySelectorAll('aside.notes').length, 1, 'emptied, still there');
    assertEqual(App.notes.textOf(slide), '');
});
