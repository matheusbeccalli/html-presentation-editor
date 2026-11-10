/*
 * groups.test.js - group / ungroup (Phase 7): the pure maths and the slide
 * operations of groups.js. The live commands (Ctrl+G, resize, typing inside) are in e2e_test.py.
 */

const GROUP_SLIDE = '<section class="slide" data-slide-id="s1">' +
    '<div class="el" data-type="text" data-id="e1" style="left: 64px; top: 56px; width: 120px; height: 40px; z-index: 1;"><p>Logo</p></div>' +
    '<div class="el" data-type="text" data-id="e2" style="left: 100px; top: 200px; width: 300px; height: 50px; z-index: 2;"><p>A</p></div>' +
    '<div class="el" data-type="shape" data-id="e3" style="left: 500px; top: 300px; width: 100px; height: 100px; z-index: 3;"></div>' +
    '<div class="el" data-type="text" data-id="e4" style="left: 0px; top: 600px; width: 50px; height: 20px; z-index: 4;"><p>B</p></div>' +
    '<aside class="notes">n</aside></section>';

function groupSlide() {
    return parseDoc('<html><head></head><body>' + GROUP_SLIDE + '</body></html>').querySelector('section');
}
const byId = (root, id) => root.querySelector('[data-id="' + id + '"]');
const rectText = (element) => ['left', 'top', 'width', 'height'].map((name) => parseFloat(element.style[name])).join(',');
const stackOf = (root) => App.transform.topLevelElements(root).map((element) => element.getAttribute('data-id')).join(',');

test('groups: the box around the parts, and the parts measured from its corner', () => {
    const out = App.groups.layout([{ left: 100, top: 200, width: 300, height: 50 }, { left: 500, top: 300, width: 100, height: 100 }]);
    assertEqual(out.bounds, { left: 100, top: 200, width: 500, height: 200 });
    assertEqual(out.inner, [{ left: 0, top: 0, width: 300, height: 50 }, { left: 400, top: 100, width: 100, height: 100 }]);
});

test('groups: resizing a group scales every part by the same factors', () => {
    assertEqual(App.groups.scaleRect({ left: 400, top: 100, width: 100, height: 100 }, 0.5, 2),
        { left: 200, top: 200, width: 50, height: 200 });
    assertEqual(App.groups.scaleRect({ left: 10, top: 0, width: 10, height: 10 }, 1 / 3, 1).left, 3.33, '1/100 px');
});

test('groups: grouping wraps the parts in one element where the topmost part was in the stack', () => {
    const slide = groupSlide();
    const group = App.groups.makeGroup(slide, [byId(slide, 'e3'), byId(slide, 'e2')], 'e9');
    assertEqual(group.className, 'el');
    assertEqual(group.getAttribute('data-type'), 'group');
    assertEqual(group.getAttribute('data-id'), 'e9');
    assertEqual(rectText(group), '100,200,500,200');
    assertEqual(rectText(byId(group, 'e2')), '0,0,300,50', 'measured from the group\'s corner');
    assertEqual(rectText(byId(group, 'e3')), '400,100,100,100');
    assertEqual(stackOf(slide), 'e1,e9,e4', 'the group sits where e3 was: under e4');
    assertEqual(Array.from(slide.children, (child) => child.style.zIndex || child.tagName).join(','), '1,2,3,ASIDE',
        'z-index renumbered; notes still last');
    assertEqual(stackOf(group), 'e2,e3', 'the parts keep their order inside');
    assertEqual([byId(group, 'e2').style.zIndex, byId(group, 'e3').style.zIndex].join(','), '1,2');
});

test('groups: ungrouping puts the parts back on the slide, in the group\'s place in the stack', () => {
    const slide = groupSlide();
    const group = App.groups.makeGroup(slide, [byId(slide, 'e1'), byId(slide, 'e3')], 'e9');
    group.style.left = '74px';   // the group (left 64) was moved 10 px right
    const parts = App.groups.breakGroup(group);
    assertEqual(parts.map((part) => part.getAttribute('data-id')).join(','), 'e1,e3');
    assert(!slide.querySelector('[data-type="group"]'), 'the group is gone');
    assertEqual(rectText(byId(slide, 'e1')), '74,56,120,40', 'back in slide pixels, moved with the group');
    assertEqual(rectText(byId(slide, 'e3')), '510,300,100,100');
    assertEqual(stackOf(slide), 'e2,e1,e3,e4', 'in the group\'s place (it was where e3 was)');
    assertEqual(slide.lastElementChild.tagName, 'ASIDE');
});

test('groups: a part inside groups belongs to the outermost group; the part under a point', () => {
    const slide = groupSlide();
    const inner = App.groups.makeGroup(slide, [byId(slide, 'e2'), byId(slide, 'e3')], 'e9');
    const outer = App.groups.makeGroup(slide, [inner, byId(slide, 'e4')], 'e10');
    assertEqual(App.groups.topOf(byId(slide, 'e2')), outer);
    assertEqual(App.groups.topOf(byId(slide, 'e1')), byId(slide, 'e1'), 'not in a group: itself');
    assertEqual(App.groups.childAt(outer, 550, 350).getAttribute('data-id'), 'e3', 'slide point in e3');
    assertEqual(App.groups.childAt(outer, 120, 210).getAttribute('data-id'), 'e2');
    assertEqual(App.groups.childAt(outer, 450, 500), null, 'inside the group\'s box, but on no part');
});
