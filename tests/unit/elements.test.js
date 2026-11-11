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

test('elements: restackMany moves several ids together, keeping their own order', () => {
    const order = ['a', 'b', 'c', 'd', 'e'];
    assertEqual(App.elements.restackMany(order, ['b', 'd'], 'front'), ['a', 'c', 'e', 'b', 'd']);
    assertEqual(App.elements.restackMany(order, ['b', 'd'], 'back'), ['b', 'd', 'a', 'c', 'e']);
    assertEqual(App.elements.restackMany(order, ['b', 'd'], 'forward'), ['a', 'c', 'b', 'e', 'd']);
    assertEqual(App.elements.restackMany(order, ['b', 'd'], 'backward'), ['b', 'a', 'd', 'c', 'e']);
    assertEqual(App.elements.restackMany(order, ['d'], 'forward'), App.elements.restack(order, 'd', 'forward'), 'one id: as restack');
});

test('elements: restackMany - a block already at the top or bottom stays', () => {
    assertEqual(App.elements.restackMany(['a', 'b', 'c'], ['b', 'c'], 'forward'), ['a', 'b', 'c']);
    assertEqual(App.elements.restackMany(['a', 'b', 'c', 'd'], ['b', 'c'], 'forward'), ['a', 'd', 'b', 'c'], 'the block passes d');
    assertEqual(App.elements.restackMany(['a', 'b', 'c'], ['a', 'b'], 'backward'), ['a', 'b', 'c']);
});

test('elements: a locked element (data-locked) does not turn; its lock is its own, not its group\'s', () => {
    const doc = parseDoc('<html><body><section class="slide">' +
        '<div class="el" data-type="shape" data-shape="rect" data-id="a" data-locked="true"></div>' +
        '<div class="el" data-type="group" data-id="g"><div class="el" data-type="text" data-id="b" data-locked="true"></div></div>' +
        '</section></body></html>');
    const byId = (id) => doc.querySelector('[data-id="' + id + '"]');
    assertEqual([App.elements.isLocked(byId('a')), App.elements.isLocked(byId('g')), App.elements.isLocked(null)], [true, false, false]);
    assertEqual([App.elements.canRotateElement(byId('a')), App.elements.canRotateElement(byId('g'))], [false, true]);
});
