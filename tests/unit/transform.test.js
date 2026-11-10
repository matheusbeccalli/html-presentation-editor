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

test('transform: the rubber band rect from its two corners, whichever way it was dragged', () => {
    assertEqual(App.transform.bandRect({ x: 100, y: 50 }, { x: 20, y: 80 }), { left: 20, top: 50, width: 80, height: 30 });
    assertEqual(App.transform.bandRect({ x: 10, y: 90 }, { x: 40, y: 20 }), { left: 10, top: 20, width: 30, height: 70 });
});

test('transform: an element is caught by the rubber band only when wholly inside it', () => {
    const band = { left: 100, top: 100, width: 300, height: 200 };
    assert(App.transform.containsRect(band, { left: 100, top: 120, width: 300, height: 50 }), 'touching the edges counts');
    assert(!App.transform.containsRect(band, { left: 90, top: 120, width: 50, height: 50 }), 'sticks out left');
    assert(!App.transform.containsRect(band, { left: 150, top: 250, width: 50, height: 60 }), 'sticks out below');
});

test('transform: the bounds of several rects', () => {
    assertEqual(App.transform.boundsOf([{ left: 10, top: 40, width: 20, height: 10 }, { left: 50, top: 5, width: 10, height: 10 }]),
        { left: 10, top: 5, width: 50, height: 45 });
    assertEqual(App.transform.boundsOf([]), null);
});

// ---- Align and distribute (Phase 7) ----

const ALIGN_RECTS = [
    { left: 100, top: 50, width: 200, height: 40 },
    { left: 400, top: 200, width: 100, height: 100 },
    { left: 250, top: 120, width: 50, height: 20 },
];
const SLIDE_AREA = { left: 0, top: 0, width: 1280, height: 720 };

function lefts(rects) { return rects.map((r) => r.left); }
function tops(rects) { return rects.map((r) => r.top); }

test('transform: align left / center / right lines the rects up on the area, keeping their size and height', () => {
    const area = App.transform.boundsOf(ALIGN_RECTS);   // 100..500 x 50..300
    let out = App.transform.alignRects(ALIGN_RECTS, 'left', area);
    assertEqual(lefts(out), [100, 100, 100]);
    assertEqual(tops(out), [50, 200, 120], 'tops untouched');
    assertEqual(out.map((r) => r.width + 'x' + r.height), ['200x40', '100x100', '50x20'], 'sizes untouched');
    out = App.transform.alignRects(ALIGN_RECTS, 'right', area);
    assertEqual(out.map((r) => r.left + r.width), [500, 500, 500]);
    out = App.transform.alignRects(ALIGN_RECTS, 'center', area);
    assertEqual(out.map((r) => r.left + r.width / 2), [300, 300, 300]);
    assert(ALIGN_RECTS[0].left === 100, 'the input is not changed');
});

test('transform: align top / middle / bottom', () => {
    const area = App.transform.boundsOf(ALIGN_RECTS);
    assertEqual(tops(App.transform.alignRects(ALIGN_RECTS, 'top', area)), [50, 50, 50]);
    assertEqual(App.transform.alignRects(ALIGN_RECTS, 'bottom', area).map((r) => r.top + r.height), [300, 300, 300]);
    assertEqual(App.transform.alignRects(ALIGN_RECTS, 'middle', area).map((r) => r.top + r.height / 2), [175, 175, 175]);
    assertEqual(lefts(App.transform.alignRects(ALIGN_RECTS, 'middle', area)), [100, 400, 250], 'lefts untouched');
});

test('transform: aligning to the slide uses the slide as the area', () => {
    const out = App.transform.alignRects([{ left: 10, top: 10, width: 280, height: 100 }], 'center', SLIDE_AREA);
    assertEqual(out[0].left, 500);
    assertEqual(App.transform.alignRects([{ left: 10, top: 10, width: 280, height: 100 }], 'bottom', SLIDE_AREA)[0].top, 620);
});

test('transform: distribute horizontally keeps the outer two and makes the gaps between equal', () => {
    const rects = [
        { left: 0, top: 0, width: 100, height: 10 },
        { left: 600, top: 30, width: 100, height: 10 },   // the right-most
        { left: 150, top: 60, width: 50, height: 10 },
        { left: 300, top: 90, width: 150, height: 10 },
    ];
    // Widths 100+50+150+100 = 400 inside 0..700: three gaps of 100.
    const out = App.transform.distributeRects(rects, 'horizontal', App.transform.boundsOf(rects));
    assertEqual(lefts(out), [0, 600, 200, 350], 'in the input order');
    assertEqual(tops(out), [0, 30, 60, 90], 'tops untouched');
});

test('transform: distribute vertically, and to the slide: the outer ones go to its edges', () => {
    const rects = [
        { left: 0, top: 100, width: 10, height: 40 },
        { left: 0, top: 120, width: 10, height: 40 },
        { left: 0, top: 300, width: 10, height: 40 },
    ];
    assertEqual(tops(App.transform.distributeRects(rects, 'vertical', App.transform.boundsOf(rects))), [100, 200, 300]);
    // 720 - 120 = 600 left over: two gaps of 300.
    assertEqual(tops(App.transform.distributeRects(rects, 'vertical', SLIDE_AREA)), [0, 340, 680]);
});

test('transform: distribute rounds to 1/100 px; ties keep their order; one rect is centred', () => {
    const rects = [
        { left: 0, top: 0, width: 10, height: 10 },
        { left: 50, top: 0, width: 10, height: 10 },
        { left: 50, top: 0, width: 10, height: 10 },
        { left: 100, top: 0, width: 10, height: 10 },
    ];
    // 110 wide, 40 of boxes: three gaps of 23.333...
    assertEqual(lefts(App.transform.distributeRects(rects, 'horizontal', App.transform.boundsOf(rects))), [0, 33.33, 66.67, 100]);
    assertEqual(lefts(App.transform.distributeRects([{ left: 0, top: 0, width: 280, height: 10 }], 'horizontal', SLIDE_AREA)), [500]);
});
