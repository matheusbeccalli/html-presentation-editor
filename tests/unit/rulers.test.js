/*
 * rulers.test.js - the rulers' marks (Phase 7). Showing them and the gridlines is in e2e_test.py.
 */

test('rulers: a mark every 10 slide px when they are far enough apart, a number every 100', () => {
    const marks = App.rulers.marks(1280, 1);
    assertEqual(marks.length, 129, '0, 10, ... 1280');
    assertEqual(marks.filter((m) => m.label !== null).map((m) => m.label).slice(0, 3), ['0', '100', '200']);
    assertEqual(marks[5], { at: 50, size: 'half', label: null });
    assertEqual(marks[3].size, 'small');
});

test('rulers: zoomed out, the small marks every 10 px go (closer than 5 screen px) and the half marks stay', () => {
    const marks = App.rulers.marks(720, 0.4);
    assert(marks.every((m) => m.at % 50 === 0), 'only every 50 px: ' + marks.slice(0, 4).map((m) => m.at));
    assertEqual(marks[marks.length - 1].at, 700);
});
