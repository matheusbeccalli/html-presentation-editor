/*
 * shapes.test.js - shapes (Phase 5): the drawing of each kind from its size
 * (inline SVG, in slide px), drawing a new shape with the mouse, and the
 * shape element.
 */

function pathsOf(kind, width, height, options) {
    return App.shapes.geometry(kind, width, height, options || {}).map((part) => part.part + ':' + part.d);
}

test('shapes: boxes are drawn in slide px from their size', () => {
    assertEqual(pathsOf('rect', 200, 80), ['fill:M0 0H200V80H0Z']);
    assertEqual(pathsOf('ellipse', 200, 80), ['fill:M0 40A100 40 0 1 1 200 40A100 40 0 1 1 0 40Z']);
    // Corners: a sixth of the shorter side, as PowerPoint draws them.
    assertEqual(pathsOf('roundRect', 120, 60),
        ['fill:M10 0H110A10 10 0 0 1 120 10V50A10 10 0 0 1 110 60H10A10 10 0 0 1 0 50V10A10 10 0 0 1 10 0Z']);
});

test('shapes: chevron and pentagon point by half their height (process steps)', () => {
    assertEqual(pathsOf('chevron', 200, 80), ['fill:M0 0H160L200 40L160 80H0L40 40Z']);
    assertEqual(pathsOf('pentagon', 200, 80), ['fill:M0 0H160L200 40L160 80H0Z']);
    assertEqual(pathsOf('chevron', 30, 80), ['fill:M0 0H15L30 40L15 80H0L15 40Z'], 'narrow: the point is half the shorter side');
});

test('shapes: a callout is a box with a tail pointing below it', () => {
    assertEqual(pathsOf('callout', 160, 120), ['fill:M0 0H160V120H53.33L33.33 150L26.67 120H0Z']);
});

test('shapes: a line goes corner to corner; flipped, the other way', () => {
    assertEqual(pathsOf('line', 200, 50), ['line:M0 0L200 50']);
    assertEqual(pathsOf('line', 200, 50, { flip: 'y' }), ['line:M0 50L200 0']);
    assertEqual(pathsOf('line', 200, 0, { flip: 'x' }), ['line:M200 0L0 0']);
});

test('shapes: an arrow has its head at the end, sized from the line width', () => {
    // Width 2: a 12 px head; the line stops inside it so its square end never shows past the point.
    assertEqual(pathsOf('arrow', 200, 0, { lineWidth: 2 }), ['line:M0 0L190 0', 'head:M200 0L188 5.4L188 -5.4Z']);
    assertEqual(pathsOf('arrow', 200, 0, { lineWidth: 2, flip: 'x' }), ['line:M200 0L10 0', 'head:M0 0L12 -5.4L12 5.4Z']);
});

test('shapes: drawing a box with the mouse, in any direction; Shift keeps it square', () => {
    assertEqual(App.shapes.drawnShape('rect', { x: 300, y: 200 }, { x: 100, y: 260 }, false),
        { rect: { left: 100, top: 200, width: 200, height: 60 }, flip: '' });
    assertEqual(App.shapes.drawnShape('ellipse', { x: 100, y: 100 }, { x: 160, y: 130 }, true),
        { rect: { left: 100, top: 100, width: 60, height: 60 }, flip: '' });
    assertEqual(App.shapes.drawnShape('ellipse', { x: 100, y: 100 }, { x: 70, y: 40 }, true),
        { rect: { left: 40, top: 40, width: 60, height: 60 }, flip: '' }, 'Shift dragging up-left');
});

test('shapes: drawing a line keeps its direction; Shift snaps it to 45 degrees', () => {
    assertEqual(App.shapes.drawnShape('line', { x: 100, y: 650 }, { x: 300, y: 600 }, false),
        { rect: { left: 100, top: 600, width: 200, height: 50 }, flip: 'y' });
    assertEqual(App.shapes.drawnShape('arrow', { x: 600, y: 650 }, { x: 400, y: 640 }, true),
        { rect: { left: 400, top: 650, width: 200, height: 0 }, flip: 'x' }, 'almost flat: flat');
    assertEqual(App.shapes.drawnShape('line', { x: 0, y: 0 }, { x: 100, y: 90 }, true),
        { rect: { left: 0, top: 0, width: 95, height: 95 }, flip: '' }, 'almost diagonal: diagonal');
});

test('shapes: a plain click gives the default size, its corner at the click, inside the slide', () => {
    assertEqual(App.shapes.clickedShape('rect', { x: 600, y: 450 }), { rect: { left: 600, top: 450, width: 160, height: 120 }, flip: '' });
    assertEqual(App.shapes.clickedShape('chevron', { x: 1200, y: 700 }), { rect: { left: 1080, top: 640, width: 200, height: 80 }, flip: '' });
    assertEqual(App.shapes.clickedShape('line', { x: 100, y: 300 }), { rect: { left: 100, top: 300, width: 200, height: 0 }, flip: '' });
});

test('shapes: the shape element follows the deck contract (accent fill, no outline)', () => {
    const doc = parseDoc('<section class="slide"></section>');
    const element = App.shapes.createShape(doc, 'pentagon', { left: 10, top: 20, width: 200, height: 80 }, 'e5', '');
    assertEqual(element.outerHTML, '<div class="el" data-type="shape" data-shape="pentagon" data-id="e5" ' +
        'style="left: 10px; top: 20px; width: 200px; height: 80px;">' +
        '<svg class="shape-svg" width="100%" height="100%" aria-hidden="true" style="position: absolute; left: 0; top: 0; overflow: visible;">' +
        '<path class="shape-fill" style="fill: var(--color-accent, #1F2A44); stroke: none;" d="M0 0H160L200 40L160 80H0Z"></path></svg></div>');
    const line = App.shapes.createShape(doc, 'arrow', { left: 0, top: 0, width: 200, height: 0 }, 'e6', 'x');
    assertEqual(line.getAttribute('data-flip'), 'x');
    assertEqual(Array.from(line.querySelectorAll('path'), (path) => path.getAttribute('style')),
        ['fill: none; stroke: var(--color-accent, #1F2A44); stroke-width: 2px;', 'fill: var(--color-accent, #1F2A44); stroke: none;']);
});

test('shapes: after a resize the drawing follows the new size, keeping its look', () => {
    const doc = parseDoc('<section class="slide"></section>');
    const element = App.shapes.createShape(doc, 'chevron', { left: 0, top: 0, width: 200, height: 80 }, 'e5', '');
    element.querySelector('path').style.fill = 'red';
    App.transform.writeRect(element, { left: 0, top: 0, width: 300, height: 80 });
    App.shapes.render(element);
    assertEqual(element.querySelector('path').getAttribute('d'), 'M0 0H260L300 40L260 80H0L40 40Z');
    assertEqual(element.querySelector('path').style.fill, 'red');
    const legacy = parseDoc('<div class="el accent" data-type="shape" style="width: 80px; height: 6px"></div>').body.firstChild;
    App.shapes.render(legacy);
    assertEqual(legacy.innerHTML, '', 'an older shape (a coloured box) is left as it is');
});

test('transform: a line as thin as 0 px can still be clicked (a few px either side)', () => {
    const items = [{ id: 'line', rect: { left: 100, top: 300, width: 200, height: 0 }, z: 1 }];
    assertEqual(App.transform.hitTest(items, 200, 303), 'line');
    assertEqual(App.transform.hitTest(items, 200, 297), 'line');
    assertEqual(App.transform.hitTest(items, 200, 310), null);
});
