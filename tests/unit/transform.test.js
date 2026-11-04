/* Tests for src/js/transform.js: the maths of moving, resizing and hit-testing elements. */

const box = (left, top, width, height) => ({ left: left, top: top, width: width, height: height });

test('transform: moveRect shifts the box and rounds to whole pixels', () => {
    assertEqual(App.transform.moveRect(box(10, 20, 100, 50), 5.4, -3.6), box(15, 16, 100, 50));
});

test('transform: resizing from the east handle only changes the width', () => {
    assertEqual(App.transform.resizeRect(box(10, 10, 100, 50), 'e', 30, 99, false), box(10, 10, 130, 50));
});

test('transform: resizing from the north-west handle keeps the opposite corner in place', () => {
    assertEqual(App.transform.resizeRect(box(100, 100, 200, 100), 'nw', 20, 10, false), box(120, 110, 180, 90));
});

test('transform: every handle moves only its own edges', () => {
    const start = box(100, 100, 200, 100);
    assertEqual(App.transform.resizeRect(start, 'n', 50, 10, false), box(100, 110, 200, 90));
    assertEqual(App.transform.resizeRect(start, 's', 50, 10, false), box(100, 100, 200, 110));
    assertEqual(App.transform.resizeRect(start, 'w', 10, 50, false), box(110, 100, 190, 100));
    assertEqual(App.transform.resizeRect(start, 'ne', 10, 10, false), box(100, 110, 210, 90));
    assertEqual(App.transform.resizeRect(start, 'sw', 10, 10, false), box(110, 100, 190, 110));
    assertEqual(App.transform.resizeRect(start, 'se', 10, 10, false), box(100, 100, 210, 110));
});

test('transform: a box never shrinks below the minimum size or flips over', () => {
    const result = App.transform.resizeRect(box(100, 100, 50, 50), 'e', -500, 0, false);
    assertEqual(result, box(100, 100, App.transform.MIN_SIZE, 50));
    const fromLeft = App.transform.resizeRect(box(100, 100, 50, 50), 'w', 500, 0, false);
    assertEqual(fromLeft, box(150 - App.transform.MIN_SIZE, 100, App.transform.MIN_SIZE, 50));
});

test('transform: Shift on a corner keeps the aspect ratio, anchored at the opposite corner', () => {
    // 200x100 dragged 100 px right on the south-east corner -> 300x150
    assertEqual(App.transform.resizeRect(box(0, 0, 200, 100), 'se', 100, 0, true), box(0, 0, 300, 150));
    // north-west corner: the bottom-right corner stays at (200, 100)
    assertEqual(App.transform.resizeRect(box(0, 0, 200, 100), 'nw', 0, 50, true), box(100, 50, 100, 50));
});

test('transform: Shift on a side handle keeps the aspect ratio, centred on the other axis', () => {
    // 200x100, east handle +100 -> 300x150, grows 25 px up and 25 px down
    assertEqual(App.transform.resizeRect(box(0, 100, 200, 100), 'e', 100, 0, true), box(0, 75, 300, 150));
    assertEqual(App.transform.resizeRect(box(100, 0, 200, 100), 's', 0, 100, true), box(0, 0, 400, 200));
});

test('transform: hitTest returns the topmost element under the point', () => {
    const items = [
        { id: 'back', rect: box(0, 0, 500, 500), z: 1 },
        { id: 'front', rect: box(100, 100, 100, 100), z: 5 },
        { id: 'other', rect: box(400, 400, 50, 50), z: 2 },
    ];
    assertEqual(App.transform.hitTest(items, 150, 150), 'front');
    assertEqual(App.transform.hitTest(items, 50, 50), 'back');
    assertEqual(App.transform.hitTest(items, 425, 425), 'other');
    assertEqual(App.transform.hitTest(items, 900, 900), null);
});

test('transform: with equal z-index, the element later in the slide wins (it is drawn on top)', () => {
    const items = [
        { id: 'first', rect: box(0, 0, 100, 100), z: 1 },
        { id: 'second', rect: box(0, 0, 100, 100), z: 1 },
    ];
    assertEqual(App.transform.hitTest(items, 50, 50), 'second');
});

test('transform: readRect and writeRect use the inline left/top/width/height', () => {
    const doc = parseDoc('<div class="el" style="left:10px; top:20.5px; width:300px; height:40px"></div>');
    const element = doc.querySelector('.el');
    assertEqual(App.transform.readRect(element), box(10, 20.5, 300, 40));
    App.transform.writeRect(element, box(1, 2, 3, 4));
    assertEqual([element.style.left, element.style.top, element.style.width, element.style.height], ['1px', '2px', '3px', '4px']);
});

test('transform: topLevelElements lists the slide\'s own .el children in stacking order', () => {
    const doc = parseDoc('<section class="slide">' +
        '<div class="el" data-id="a" style="z-index:3"></div>' +
        '<div class="el" data-id="b" style="z-index:1"><div class="el" data-id="inner"></div></div>' +
        '<div class="el" data-id="c"></div>' +
        '<aside class="notes">n</aside></section>');
    const ids = App.transform.topLevelElements(doc.querySelector('.slide')).map((e) => e.getAttribute('data-id'));
    assertEqual(ids, ['c', 'b', 'a']);   // no z-index counts as 0
});

test('transform: a picture keeps its proportions by its corners; anything does with Shift', () => {
    assertEqual(['nw', 'se', 'e', 's'].map((handle) => App.transform.keepsAspect('image', handle, false)), [true, true, false, false]);
    assertEqual(App.transform.keepsAspect('text', 'se', false), false);
    assertEqual(App.transform.keepsAspect('text', 'e', true), true);
});
