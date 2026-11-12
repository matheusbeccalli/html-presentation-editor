/*
 * comments.test.js - review comments (Phase 9): plain-text notes in each
 * slide's hidden <aside class="comments">, one <div class="comment"> each,
 * with the element they point at (none = the slide), initials and date.
 * They are saved with the deck (deck-format 4) and left out of everything
 * that is shown or sent: the show, print, pictures, PowerPoint, clean copy.
 */

const COMMENT_DATE = '2026-11-11T14:32:00.000Z';

function commentsDeck() {
    return parseDoc(
        '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>' +
        '<section class="slide" data-slide-id="s1"><div class="el" data-type="text" data-id="e1"><p>Receita</p></div>' +
        '<aside class="notes">Notas</aside></section>' +
        '<section class="slide" data-slide-id="s2"><div class="el" data-type="text" data-id="e2"><p>EBITDA</p></div></section>' +
        '</body></html>');
}

test('comments: adding one makes the slide\'s <aside class="comments"> (after the notes), plain text kept', () => {
    const doc = commentsDeck();
    const slide = doc.querySelector('[data-slide-id="s1"]');
    const id = App.comments.add(slide, { target: 'e1', author: 'MB', date: COMMENT_DATE, text: 'Checar <b>número</b>\nfonte?' });
    assertEqual(id, 'c1');
    assertEqual(slide.lastElementChild.outerHTML,
        '<aside class="comments"><div class="comment" data-comment-id="c1" data-target="e1" data-author="MB" ' +
        'data-date="' + COMMENT_DATE + '">Checar &lt;b&gt;número&lt;/b&gt;\nfonte?</div></aside>');
    assertEqual(App.comments.listOf(slide), [{ id: 'c1', target: 'e1', author: 'MB', date: COMMENT_DATE, text: 'Checar <b>número</b>\nfonte?' }]);
    // A comment on the slide itself has no target.
    App.comments.add(slide, { author: 'MB', date: COMMENT_DATE, text: 'Slide todo' });
    assertEqual(App.comments.listOf(slide)[1].target, null);
    assertEqual(slide.querySelectorAll('aside.comments').length, 1, 'one box per slide');
    assertEqual(App.comments.listOf(doc.querySelector('[data-slide-id="s2"]')), [], 'a slide without comments');
    assertEqual(App.comments.listOf(null), []);
});

test('comments: ids are unique in the whole deck; edit, remove (an empty box goes), count and remove all', () => {
    const doc = commentsDeck();
    const [s1, s2] = doc.querySelectorAll('section.slide');
    const a = App.comments.add(s1, { author: 'MB', date: COMMENT_DATE, text: 'a' });
    const b = App.comments.add(s2, { target: 'e2', author: 'JS', date: COMMENT_DATE, text: 'b' });
    App.comments.add(s2, { author: 'JS', date: COMMENT_DATE, text: 'c' });
    assertEqual([a, b], ['c1', 'c2']);
    assertEqual(App.comments.countIn(doc), 3);
    assert(App.comments.setText(doc, 'c2', 'b editado'), 'edited');
    assertEqual(App.comments.listOf(s2)[0].text, 'b editado');
    assert(!App.comments.setText(doc, 'c99', 'x'), 'no such comment');
    assert(App.comments.remove(doc, 'c1'), 'removed');
    assertEqual(s1.querySelector('aside.comments'), null, 'the slide\'s last comment takes its box along');
    assert(!App.comments.remove(doc, 'c1'), 'already gone');
    assertEqual(App.comments.add(s1, { author: 'MB', date: COMMENT_DATE, text: 'd' }), 'c1', 'a free id is used again');
    assertEqual(App.comments.removeAll(doc), 3);
    assertEqual(App.comments.countIn(doc), 0);
    assertEqual(doc.querySelectorAll('aside.comments').length, 0);
});

test('comments: Save keeps them; everything else made from the deck (show, print, pictures, clean copy) does not', () => {
    const doc = commentsDeck();
    App.comments.add(doc.querySelector('section.slide'), { target: 'e1', author: 'MB', date: COMMENT_DATE, text: 'SENTINELA' });
    assertIncludes(App.serialize.toHtml(doc, PLAYER, { keepComments: true }), 'SENTINELA', 'Save, AutoSave and drafts keep them');
    assertNotIncludes(App.serialize.toHtml(doc, PLAYER), 'SENTINELA', 'by default they are left out');
    assertNotIncludes(App.serialize.toHtml(doc, PLAYER, { cleanCopy: true }), 'SENTINELA', 'clean copy');
    assertNotIncludes(App.serialize.cleanCopy(doc).outerHTML, 'SENTINELA', 'show, print, pictures and PowerPoint start here');
    assertEqual(App.comments.countIn(doc), 1, 'the deck itself keeps them');
});

test('comments: hidden in the editor view, in a saved deck and in its print; never found by Find', () => {
    assertIncludes(App.deck.VIEW_CSS, 'aside.comments');   // the saved deck's player.css: tests/test_build.py
    const doc = commentsDeck();
    App.comments.add(doc.querySelector('section.slide'), { target: 'e1', author: 'MB', date: COMMENT_DATE, text: 'Receita' });
    const found = App.text.containersIn(doc.body);
    assertEqual(found.length, 2, 'only the two text boxes: ' + found.map((node) => node.outerHTML).join(' | '));
});

test('comments: a new element goes before the slide\'s notes and comments in the HTML', () => {
    const doc = commentsDeck();
    const slide = doc.querySelector('[data-slide-id="s2"]');
    App.comments.add(slide, { author: 'MB', date: COMMENT_DATE, text: 'x' });
    const element = doc.createElement('div');
    element.setAttribute('class', 'el');
    App.elements.addOnTop(slide, element);
    assertEqual(slide.lastElementChild.className, 'comments');
    assertEqual(slide.children[1], element);
});

const FORMAT_3_WITH_COMMENTS =
    '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="deck-format" content="4">' +
    '<style>.slide{position:relative;width:1280px;height:720px;overflow:hidden}.el{position:absolute}</style></head><body>' +
    '<section class="slide" data-slide-id="s1">' +
    '<div class="el" data-type="text" data-id="e1" style="left:64px; top:48px; width:600px; height:80px; z-index:1">' +
    '<p data-list="none" data-level="1">Título</p></div><aside class="notes">Notas</aside>' +
    '<aside class="comments"><div class="comment" data-comment-id="c1" data-target="e1" data-author="MB" ' +
    'data-date="' + COMMENT_DATE + '">Revisar título</div></aside></section></body></html>';

test('import: a saved deck\'s comments come back as comments (the slide stays a contract slide)', async () => {
    const result = await App.importer.importDeck(FORMAT_3_WITH_COMMENTS);
    assert(result.report.isContract, 'still a contract deck');
    assertEqual(result.report.elementsConverted, 0, 'the comment did not become a text box');
    const doc = parseDoc(result.html);
    assertEqual(App.comments.listOf(doc.querySelector('section.slide')),
        [{ id: 'c1', target: 'e1', author: 'MB', date: COMMENT_DATE, text: 'Revisar título' }]);
    assertEqual(doc.querySelectorAll('.el').length, 1);
});

test('import: a format-3 deck is upgraded to format 4 (it has no comments yet: nothing to convert or report)', async () => {
    const result = await App.importer.importDeck(FORMAT_3_WITH_COMMENTS
        .replace('content="4"', 'content="3"').replace(/<aside class="comments">.*?<\/aside>/, ''));
    assertEqual(parseDoc(result.html).querySelector('meta[name="deck-format"]').getAttribute('content'), '4');
    assert(!App.importer.reportHasChanges(result.report), 'nothing to report');
});

test('import: a deck that is normalized (not contract) keeps its slides\' comments', async () => {
    const html = FORMAT_3_WITH_COMMENTS.replace('<div class="el" data-type="text" data-id="e1"', '<div data-id="e1"');
    const result = await App.importer.importDeck(html);
    assert(!result.report.isContract, 'normalized');
    const doc = parseDoc(result.html);
    const slide = doc.querySelector('section.slide');
    assertEqual(App.comments.listOf(slide).map((comment) => comment.text), ['Revisar título']);
    assertNotIncludes(Array.from(slide.querySelectorAll('.el'), (el) => el.textContent).join('|'), 'Revisar');
});
