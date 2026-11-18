/*
 * selectionpane.test.js - the Selection Pane's model (Phase 10 step 5):
 * element names (data-name), hidden elements (data-hidden="true", saved, left
 * out of the show, print, pictures and PowerPoint, never picked on the slide),
 * reordering by dragging a row, and Tab / Shift+Tab stepping through a slide.
 */

function paneDeck() {
    return parseDoc('<!DOCTYPE html><html><head></head><body><section class="slide" data-slide-id="s1">' +
        '<div class="el" data-type="text" data-id="e1" style="left: 0px; top: 0px; width: 100px; height: 40px; z-index: 1;"><p>Receita líquida</p></div>' +
        '<img class="el" data-type="image" data-id="e2" alt="" src="data:image/png;base64,AAAA" style="left: 0px; top: 0px; width: 100px; height: 40px; z-index: 3;">' +
        '<div class="el" data-type="text" data-id="e3" style="left: 0px; top: 0px; width: 100px; height: 40px; z-index: 2;"><p>Margem</p></div>' +
        '</section></body></html>');
}

test('selection pane: an element\'s name is its own, else what it is (as the comments say)', () => {
    const doc = paneDeck();
    const e1 = doc.querySelector('[data-id="e1"]');
    assertEqual([App.elements.nameOf(e1), App.elements.nameOf(doc.querySelector('[data-id="e2"]'))], ['Text: Receita líquida', 'Picture']);
    App.elements.setName(e1, '  Título da receita  ');
    assertEqual([e1.getAttribute('data-name'), App.elements.nameOf(e1)], ['Título da receita', 'Título da receita']);
    App.elements.setName(e1, 'x'.repeat(100));
    assertEqual(e1.getAttribute('data-name').length, 60, 'at most 60 characters');
    App.elements.setName(e1, '   ');
    assertEqual([e1.hasAttribute('data-name'), App.elements.nameOf(e1)], [false, 'Text: Receita líquida'], 'empty: back to what it is');
    const triangle = App.shapes.createShape(doc, 'triangle', { left: 0, top: 0, width: 100, height: 80 }, 'e9');
    doc.querySelector('section').appendChild(triangle);
    assertEqual(App.elements.nameOf(triangle), 'Triangle', 'a shape without text: its kind');
});

test('selection pane: a hidden element is marked, never picked on the slide, and the deck\'s stylesheet hides it', () => {
    const doc = paneDeck();
    const slide = doc.querySelector('section');
    const e2 = doc.querySelector('[data-id="e2"]');
    App.elements.setHidden(e2, true);
    assertEqual([e2.getAttribute('data-hidden'), App.elements.isHidden(e2)], ['true', true]);
    assertEqual(App.elements.pickableElements(slide).map((el) => el.getAttribute('data-id')), ['e1', 'e3'], 'back to front, e2 left out');
    assertEqual(App.transform.topLevelElements(slide).length, 3, 'still in the stacking order');
    App.elements.setHidden(e2, false);
    assertEqual([e2.hasAttribute('data-hidden'), App.elements.isHidden(e2)], [false, false]);
    assert(App.text.deckTextCss().indexOf('.el[data-hidden="true"] { display: none !important; }') !== -1, 'the deck hides it everywhere');
});

test('selection pane: dragging a row moves the element in the stack (front first in the list)', () => {
    const move = App.elements.moveInOrder;
    assertEqual(move(['a', 'b', 'c', 'd'], 'd', 0), ['d', 'a', 'b', 'c']);
    assertEqual(move(['a', 'b', 'c', 'd'], 'a', 3), ['b', 'c', 'd', 'a']);
    assertEqual(move(['a', 'b', 'c', 'd'], 'b', 2), ['a', 'c', 'b', 'd']);
    assertEqual(move(['a', 'b'], 'x', 0), ['a', 'b'], 'not in the list: unchanged');
    const doc = paneDeck();
    const slide = doc.querySelector('section');
    App.elements.restackSlide(slide, ['e1', 'e2', 'e3']);   // front first
    assertEqual(App.transform.topLevelElements(slide).map((el) => el.getAttribute('data-id')), ['e3', 'e2', 'e1']);
    assertEqual(['e1', 'e2', 'e3'].map((id) => doc.querySelector('[data-id="' + id + '"]').style.zIndex), ['3', '2', '1']);
});

test('selection pane: Tab goes through the slide back to front and round; Shift+Tab the other way', () => {
    const step = App.elements.stepId;
    const order = ['e1', 'e3', 'e2'];
    assertEqual([step(order, null, 1), step(order, null, -1)], ['e1', 'e2'], 'nothing selected: the first / the last');
    assertEqual([step(order, 'e1', 1), step(order, 'e2', 1), step(order, 'e1', -1)], ['e3', 'e1', 'e2']);
    assertEqual(step([], null, 1), null);
});
