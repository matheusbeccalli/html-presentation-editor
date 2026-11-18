/*
 * flip.test.js - Flip Horizontal / Flip Vertical (Phase 10 step 1, deck-format 5).
 *
 * data-flip="x" | "y" | "xy" says an element is mirrored: a picture through its
 * CSS transform (after its turn), a shape through its drawing (the paths, so its
 * text and its shadow are not mirrored); a line's data-flip already said which
 * corners it joins, so flipping a line swaps them.
 */

function flipDeck() {
    return parseDoc(
        '<!DOCTYPE html><html><head></head><body><section class="slide" data-slide-id="s1">' +
        '<img class="el" data-type="image" data-id="e1" alt="" src="data:image/png;base64,AAAA" style="left: 10px; top: 10px; width: 100px; height: 50px;">' +
        '<div class="el" data-type="text" data-id="e2" style="left: 10px; top: 100px; width: 100px; height: 50px;"><p>A</p></div>' +
        '<div class="el" data-type="table" data-id="e3" style="left: 10px; top: 200px; width: 100px; height: 50px;"></div>' +
        '</section></body></html>');
}

test('flip: toggling an axis', () => {
    const toggle = App.transform.toggleFlip;
    assertEqual([toggle('', 'x'), toggle('x', 'x'), toggle('y', 'x'), toggle('xy', 'y'), toggle(null, 'y'), toggle('yx', 'x')],
        ['x', '', 'xy', 'x', 'y', 'y']);
});

test('flip: a picture is mirrored by its transform, after its turn, and keeps it when turned again', () => {
    const doc = flipDeck();
    const picture = doc.querySelector('[data-id="e1"]');
    App.transform.setFlip(picture, 'x');
    assertEqual(picture.getAttribute('data-flip'), 'x');
    assertEqual(picture.style.transform, 'scale(-1, 1)');
    App.transform.setRotation(picture, 30);
    assertEqual(picture.style.transform, 'rotate(30deg) scale(-1, 1)');
    assertEqual(App.transform.rotationOf(picture), 30);
    App.transform.setFlip(picture, 'xy');
    assertEqual(picture.style.transform, 'rotate(30deg) scale(-1, -1)');
    App.transform.setFlip(picture, '');
    assertEqual(picture.hasAttribute('data-flip'), false);
    assertEqual(picture.style.transform, 'rotate(30deg)');
    App.transform.setRotation(picture, 0);
    assertEqual(picture.style.transform, '', 'upright and not flipped: no transform at all');
});

test('flip: a shape is mirrored in its drawing, not its text', () => {
    const doc = flipDeck();
    const chevron = App.shapes.createShape(doc, 'chevron', { left: 0, top: 0, width: 200, height: 80 }, 'e9');
    doc.querySelector('section').appendChild(chevron);
    App.transform.setFlip(chevron, 'x');
    const path = chevron.querySelector('path.shape-fill');
    assertEqual(path.getAttribute('transform'), 'matrix(-1 0 0 1 200 0)');
    assertEqual(chevron.style.transform, '', 'the box itself is not mirrored (its text reads normally)');
    chevron.style.width = '300px';
    App.shapes.render(chevron);
    assertEqual(path.getAttribute('transform'), 'matrix(-1 0 0 1 300 0)', 'drawn again at the new width');
    App.transform.setFlip(chevron, 'y');
    assertEqual(path.getAttribute('transform'), 'matrix(1 0 0 -1 0 80)');
    App.transform.setFlip(chevron, '');
    assertEqual(path.hasAttribute('transform'), false);
    // In the geometry: the transform comes with the path.
    assertEqual(App.shapes.geometry('rect', 100, 40, { flip: 'xy' })[0].transform, 'matrix(-1 0 0 -1 100 40)');
    assertEqual(App.shapes.geometry('rect', 100, 40, {})[0].transform, undefined);
});

test('flip: a line joins the other corners', () => {
    const doc = flipDeck();
    const line = App.shapes.createShape(doc, 'line', { left: 0, top: 0, width: 200, height: 50 }, 'e9');
    App.transform.setFlip(line, 'x');
    assertEqual(line.querySelector('path.shape-line').getAttribute('d'), 'M200 0L0 50');
    assertEqual(line.querySelector('path.shape-line').hasAttribute('transform'), false, 'a line is drawn flipped, not mirrored');
});

test('flip: the yellow handle of a flipped shape is mirrored too, and dragging it back gives the same value', () => {
    const at = App.shapes.adjustHandle('chevron', 200, 80, 0.5, 'x');
    assertEqual(at, { x: 40, y: 0 }, 'the point is on the left now');
    assertEqual(App.shapes.adjustFrom('chevron', 200, 80, at, 'x'), 0.5);
    const tail = App.shapes.adjustHandle('callout', 160, 120, [0.2, 1.25], 'xy');
    assertEqual(tail, { x: 128, y: -30 });
    assertEqual(App.shapes.adjustFrom('callout', 160, 120, tail, 'xy'), [0.2, 1.25]);
});

test('flip: pictures and shapes flip; text, tables, charts, groups and locked elements do not', () => {
    const doc = flipDeck();
    const can = (id) => App.elements.canFlipElement(doc.querySelector('[data-id="' + id + '"]'));
    assertEqual([can('e1'), can('e2'), can('e3')], [true, false, false]);
    const chevron = App.shapes.createShape(doc, 'chevron', { left: 0, top: 0, width: 200, height: 80 }, 'e9');
    assertEqual(App.elements.canFlipElement(chevron), true);
    doc.querySelector('[data-id="e1"]').setAttribute('data-locked', 'true');
    assertEqual(can('e1'), false);
});

test('flip: flipping a turned element mirrors it on the slide (its turn goes the other way), as in PowerPoint', () => {
    const doc = flipDeck();
    const picture = doc.querySelector('[data-id="e1"]');
    App.transform.setRotation(picture, 30);
    App.elements.flipElement(picture, 'x');
    assertEqual([picture.getAttribute('data-flip'), App.transform.rotationOf(picture)], ['x', 330]);
    App.elements.flipElement(picture, 'y');
    assertEqual([picture.getAttribute('data-flip'), App.transform.rotationOf(picture)], ['xy', 30]);
    App.elements.flipElement(picture, 'x');
    App.elements.flipElement(picture, 'y');
    assertEqual([picture.hasAttribute('data-flip'), App.transform.rotationOf(picture)], [false, 30], 'back as it was');
});
