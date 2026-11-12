/*
 * commentanchors.test.js - what review comments point at as the deck changes
 * (Phase 9 step 3): an element's id is never handed out again while a comment
 * points at it, Duplicate Slide copies the comments onto the new elements, and
 * Previous / Next walk through every comment in the deck.
 */

function anchoredDeck() {
    const doc = parseDoc(
        '<!DOCTYPE html><html><head></head><body>' +
        '<section class="slide" data-slide-id="s1">' +
        '<div class="el" data-type="text" data-id="e1" style="left:10px; top:10px; width:100px; height:40px; z-index:1"><p>A</p></div>' +
        '<div class="el" data-type="group" data-id="e2" style="left:200px; top:100px; width:300px; height:200px; z-index:2">' +
        '<div class="el" data-type="shape" data-id="e3" style="left:50px; top:20px; width:100px; height:60px; z-index:1"></div></div>' +
        '<aside class="notes">Notas</aside></section>' +
        '<section class="slide" data-slide-id="s2"></section>' +
        '</body></html>');
    const s1 = doc.querySelector('[data-slide-id="s1"]');
    App.comments.add(s1, { target: 'e1', author: 'MB', date: COMMENT_DATE, text: 'no texto' });
    App.comments.add(s1, { target: 'e3', author: 'MB', date: COMMENT_DATE, text: 'na forma' });
    App.comments.add(s1, { author: 'MB', date: COMMENT_DATE, text: 'no slide' });
    return doc;
}

test('comment anchors: ids a comment points at count as used, so a new element never takes over a comment', () => {
    const doc = anchoredDeck();
    App.comments.add(doc.querySelector('[data-slide-id="s2"]'), { target: 'e4', author: 'MB', date: COMMENT_DATE, text: 'elemento apagado' });
    const used = App.elements.usedIds(doc);
    ['e1', 'e2', 'e3', 'e4'].forEach((id) => assert(used.has(id), id + ' is used'));
    assertEqual(App.elements.freshId(doc), 'e5', 'e4 is gone from the slide, but a comment still points at it');
    assertEqual(Array.from(App.comments.targetsIn(doc)).sort(), ['e1', 'e3', 'e4']);
});

test('comment anchors: Duplicate Slide copies the comments, pointing at the copies of their elements, with new ids', () => {
    const doc = anchoredDeck();
    const s1 = doc.querySelector('[data-slide-id="s1"]');
    const copy = App.slides.copyOf(s1, 's3');
    doc.body.appendChild(copy);
    const ids = (slide) => Array.from(slide.querySelectorAll('.el'), (el) => el.getAttribute('data-id'));
    const newIds = ids(copy);
    assertEqual(newIds.length, 3);
    const comments = App.comments.listOf(copy);
    assertEqual(comments.map((c) => c.text), ['no texto', 'na forma', 'no slide']);
    assertEqual(comments.map((c) => c.target), [newIds[0], newIds[2], null], 'each points at the copy of its element');
    assertEqual(comments.map((c) => c.id), ['c4', 'c5', 'c6'], 'comment ids stay unique in the deck');
    assertEqual(App.comments.listOf(s1).map((c) => c.target), ['e1', 'e3', null], 'the original slide is unchanged');
    assertEqual(copy.querySelector('aside.notes').textContent, 'Notas');
});

test('comment anchors: where a comment\'s marker goes (element top right, inside a group too; the slide top left)', () => {
    const doc = anchoredDeck();
    const slide = doc.querySelector('[data-slide-id="s1"]');
    assertEqual(App.comments.anchorBox(slide, 'e1'), { left: 10, top: 10, width: 100, height: 40 });
    assertEqual(App.comments.anchorBox(slide, 'e3'), { left: 250, top: 120, width: 100, height: 60 }, 'measured from the group');
    assertEqual(App.comments.anchorBox(slide, null), null);
    assertEqual(App.comments.anchorBox(slide, 'e99'), null, 'its element was deleted: on the slide');
    // Markers: one per thing commented on, in the order of their first comment.
    assertEqual(App.comments.markersOf(slide).map((m) => [m.target, m.ids]),
        [['e1', ['c1']], ['e3', ['c2']], [null, ['c3']]]);
    App.comments.add(slide, { target: 'e1', author: 'JD', date: COMMENT_DATE, text: 'outro' });
    App.comments.add(slide, { target: 'e99', author: 'JD', date: COMMENT_DATE, text: 'apagado' });
    assertEqual(App.comments.markersOf(slide).map((m) => [m.target, m.ids]),
        [['e1', ['c1', 'c4']], ['e3', ['c2']], [null, ['c3', 'c5']]], 'a deleted element\'s comment joins the slide\'s marker');
});

test('comment anchors: Previous / Next go through the deck\'s comments in slide order and wrap round', () => {
    const order = [{ slide: 0, id: 'c1' }, { slide: 0, id: 'c2' }, { slide: 2, id: 'c7' }];
    assertEqual(App.comments.step(order, 'c1', 1), order[1]);
    assertEqual(App.comments.step(order, 'c2', 1), order[2]);
    assertEqual(App.comments.step(order, 'c7', 1), order[0], 'after the last: the first');
    assertEqual(App.comments.step(order, 'c1', -1), order[2], 'before the first: the last');
    // No comment chosen yet: Next is the first on or after the slide shown, Previous the last before or on it.
    assertEqual(App.comments.step(order, null, 1, 1), order[2]);
    assertEqual(App.comments.step(order, null, -1, 1), order[1]);
    assertEqual(App.comments.step(order, null, 1, 0), order[0]);
    assertEqual(App.comments.step([], null, 1, 0), null);
    const doc = anchoredDeck();
    assertEqual(App.comments.orderIn(Array.from(doc.querySelectorAll('section.slide'))),
        [{ slide: 0, id: 'c1' }, { slide: 0, id: 'c2' }, { slide: 0, id: 'c3' }]);
});
