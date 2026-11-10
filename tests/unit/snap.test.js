/*
 * snap.test.js - smart guides and snapping (Phase 7): the pure maths in snap.js.
 * The live drag (guides drawn, Alt turns snapping off) is in e2e_test.py.
 */

const SNAP_SLIDE = { width: 1280, height: 720 };

function guideKeys(guides) {
    return guides.map((g) => g.axis + g.at).sort();
}

test('snap: the targets are the slide\'s edges and centre lines and the other elements\' edges and centres', () => {
    const targets = App.snap.targetsOf([{ left: 100, top: 200, width: 300, height: 50 }], SNAP_SLIDE);
    assertEqual(targets.x.map((t) => t.at), [0, 640, 1280, 100, 250, 400]);
    assertEqual(targets.y.map((t) => t.at), [0, 360, 720, 200, 225, 250]);
    assertEqual([targets.x[0].from, targets.x[0].to], [0, 720], 'a slide line runs the whole slide');
    assertEqual([targets.x[3].from, targets.x[3].to], [200, 250], 'an element line runs along the element');
});

test('snap: a moved box within the threshold snaps by its nearest edge or centre', () => {
    const targets = App.snap.targetsOf([{ left: 100, top: 200, width: 300, height: 50 }], SNAP_SLIDE);
    // Left edge 103 is 3 px from the other box's left (100); top 497 is far from everything.
    let result = App.snap.snapMove({ left: 103, top: 497, width: 80, height: 40 }, targets, 5);
    assertEqual([result.dx, result.dy], [-3, 0]);
    assertEqual(guideKeys(result.guides), ['x100']);
    // Centre 638 → the slide's centre line 640; bottom 718 → the slide's bottom.
    result = App.snap.snapMove({ left: 598, top: 678, width: 80, height: 40 }, targets, 5);
    assertEqual([result.dx, result.dy], [2, 2]);
    assertEqual(guideKeys(result.guides), ['x640', 'y720']);
});

test('snap: the nearest target wins; beyond the threshold nothing snaps', () => {
    const targets = App.snap.targetsOf([{ left: 100, top: 200, width: 300, height: 50 }], SNAP_SLIDE);
    // Right edge 404: 4 px from 400; left edge 254: 4 px from 250 too, but centre 329 is far. Equal: the first found.
    let result = App.snap.snapMove({ left: 252, top: 600, width: 150, height: 20 }, targets, 5);
    assertEqual(result.dx, -2, 'left 252 → 250 and right 402 → 400 are both 2 px: the same move');
    result = App.snap.snapMove({ left: 106, top: 600, width: 20, height: 20 }, targets, 5);
    assertEqual([result.dx, result.guides.length], [0, 0], '6 px: no snap');
});

test('snap: a guide is drawn for every line the box sits on after snapping, over both boxes', () => {
    const targets = App.snap.targetsOf([{ left: 100, top: 200, width: 300, height: 50 }], SNAP_SLIDE);
    // Same width as the other box: left and right both line up, so do the centres.
    const result = App.snap.snapMove({ left: 102, top: 400, width: 300, height: 60 }, targets, 5);
    assertEqual(result.dx, -2);
    assertEqual(guideKeys(result.guides), ['x100', 'x250', 'x400']);
    const left = result.guides.find((g) => g.at === 100);
    assertEqual([left.from, left.to], [200, 460], 'from the other box\'s top to the moved box\'s bottom');
});

test('snap: resizing snaps only the dragged edges', () => {
    const targets = App.snap.targetsOf([{ left: 100, top: 200, width: 300, height: 50 }], SNAP_SLIDE);
    // Dragging the right edge to 397: snaps to 400, the left edge stays.
    let result = App.snap.snapResize({ left: 50, top: 400, width: 347, height: 40 }, 'e', targets, 5);
    assertEqual(result.rect, { left: 50, top: 400, width: 350, height: 40 });
    assertEqual(guideKeys(result.guides), ['x400']);
    // The top-left corner to (98, 3): left → 100, top → 0; the right and bottom edges stay.
    result = App.snap.snapResize({ left: 98, top: 3, width: 202, height: 97 }, 'nw', targets, 5);
    assertEqual(result.rect, { left: 100, top: 0, width: 200, height: 100 });
    // The bottom edge (s) does not snap sideways even when the left edge is near a line.
    result = App.snap.snapResize({ left: 102, top: 300, width: 50, height: 47 }, 's', targets, 5);
    assertEqual(result.rect, { left: 102, top: 300, width: 50, height: 47 }, 'bottom 347: nothing near');
});

test('snap: the threshold is 5 screen pixels, so more slide pixels when zoomed out', () => {
    assertEqual(App.snap.threshold(1), 5);
    assertEqual(App.snap.threshold(0.5), 10);
    assertEqual(App.snap.threshold(2), 2.5);
});
