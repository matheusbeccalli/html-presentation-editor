/* Tests for src/js/elements.js: stacking order, fresh ids and paste position. */

test('elements: restack moves one id within the back-to-front order', () => {
    const order = ['a', 'b', 'c', 'd'];
    assertEqual(App.elements.restack(order, 'b', 'front'), ['a', 'c', 'd', 'b']);
    assertEqual(App.elements.restack(order, 'c', 'back'), ['c', 'a', 'b', 'd']);
    assertEqual(App.elements.restack(order, 'b', 'forward'), ['a', 'c', 'b', 'd']);
    assertEqual(App.elements.restack(order, 'c', 'backward'), ['a', 'c', 'b', 'd']);
});

test('elements: restack at the ends changes nothing (returns the same order)', () => {
    const order = ['a', 'b'];
    assertEqual(App.elements.restack(order, 'b', 'front'), ['a', 'b']);
    assertEqual(App.elements.restack(order, 'b', 'forward'), ['a', 'b']);
    assertEqual(App.elements.restack(order, 'a', 'back'), ['a', 'b']);
    assertEqual(App.elements.restack(order, 'a', 'backward'), ['a', 'b']);
});

test('elements: giveFreshIds renumbers the element and everything inside it with unused ids', () => {
    const doc = parseDoc('<div class="el" data-id="e1"><div class="el" data-id="e2"></div><span>x</span></div>');
    const element = doc.querySelector('[data-id="e1"]');
    const used = new Set(['e1', 'e2', 'e3']);
    App.elements.giveFreshIds(element, used);
    assertEqual(element.getAttribute('data-id'), 'e4');
    assertEqual(element.querySelector('.el').getAttribute('data-id'), 'e5');
    assert(used.has('e4') && used.has('e5'), 'new ids are reserved');
});

test('elements: pastePosition keeps the spot when it is free, else steps 10 px down-right', () => {
    const rect = { left: 100, top: 50, width: 200, height: 80 };
    assertEqual(App.elements.pastePosition(rect, []), rect);
    const taken = [{ left: 100, top: 50 }, { left: 110, top: 60 }];
    assertEqual(App.elements.pastePosition(rect, taken), { left: 120, top: 70, width: 200, height: 80 });
});
