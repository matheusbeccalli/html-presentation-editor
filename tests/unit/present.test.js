/*
 * present.test.js - the slideshow's rules (Phase 8, SPEC 7.1): where a show starts and
 * what each key or click does, in present.js's pure `startIndex` and `reduce`.
 * The real show (full screen, black bars, the keys in the browser) is in e2e_test.py.
 */

// Six slides, the fifth hidden: the contract sample's shape.
const SHOW_HIDDEN = [false, false, false, false, true, false];

function showAt(index, extra) {
    return Object.assign({ index: index, hidden: SHOW_HIDDEN, typed: '', black: false, end: false }, extra || {});
}

function pressAll(state, keys) {
    return keys.reduce((current, key) => App.present.reduce(current, { key: key }), state);
}

test('present: F5 starts on the first shown slide, Shift+F5 on the current one', () => {
    assertEqual(App.present.startIndex(SHOW_HIDDEN, 3, false), 0);
    assertEqual(App.present.startIndex([true, true, false], 0, false), 2, 'hidden first slides are skipped');
    assertEqual(App.present.startIndex(SHOW_HIDDEN, 3, true), 3);
    assertEqual(App.present.startIndex(SHOW_HIDDEN, 4, true), 5, 'from a hidden slide: the next shown one');
    assertEqual(App.present.startIndex([false, true], 1, true), 0, 'a hidden last slide: the shown one before it');
    assertEqual(App.present.startIndex([true, true], 0, false), -1, 'every slide hidden: nothing to show');
});

test('present: arrows, Space, Page Down and a click go forward; hidden slides are skipped', () => {
    ['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n'].forEach((key) => {
        assertEqual(App.present.reduce(showAt(0), { key: key }).index, 1, key);
    });
    assertEqual(App.present.reduce(showAt(0), { click: true }).index, 1, 'a click');
    assertEqual(App.present.reduce(showAt(3), { key: 'ArrowRight' }).index, 5, 'slide 5 is hidden: 4 → 6');
    assertEqual(App.present.reduce(showAt(5), { key: 'ArrowLeft' }).index, 3, 'and back 6 → 4');
});

test('present: arrows, Page Up and Backspace go back; the first slide stays', () => {
    ['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p'].forEach((key) => {
        assertEqual(App.present.reduce(showAt(2), { key: key }).index, 1, key);
    });
    assertEqual(App.present.reduce(showAt(0), { key: 'ArrowLeft' }).index, 0);
});

test('present: after the last slide comes the end screen; one more step ends the show, back returns', () => {
    let state = App.present.reduce(showAt(5), { key: 'ArrowRight' });
    assertEqual([state.index, state.end, !!state.exit], [5, true, false], 'the end screen');
    assertEqual(!!App.present.reduce(state, { key: ' ' }).exit, true, 'forward again: the show ends');
    assertEqual(!!App.present.reduce(state, { click: true }).exit, true, 'a click too');
    state = App.present.reduce(state, { key: 'ArrowLeft' });
    assertEqual([state.index, state.end], [5, false], 'back: the last slide again');
});

test('present: Home and End go to the first and last shown slides', () => {
    assertEqual(App.present.reduce(showAt(3), { key: 'Home' }).index, 0);
    assertEqual(App.present.reduce(showAt(0), { key: 'End' }).index, 5);
    assertEqual(App.present.reduce(showAt(0, { hidden: [false, false, true] }), { key: 'End' }).index, 1, 'a hidden last slide');
});

test('present: a number then Enter jumps to that slide (a hidden one too, as in PowerPoint)', () => {
    assertEqual(pressAll(showAt(0), ['3', 'Enter']).index, 2);
    assertEqual(pressAll(showAt(0), ['5', 'Enter']).index, 4, 'asked for by number: shown although hidden');
    const state = pressAll(showAt(0), ['1', '2', 'Enter']);
    assertEqual([state.index, state.typed], [0, ''], 'no slide 12: stays, the number is forgotten');
    assertEqual(pressAll(showAt(0), ['4', 'Backspace', '2', 'Enter']).index, 1, 'Backspace takes back a digit');
    assertEqual(pressAll(showAt(5, { end: true }), ['2', 'Enter']).end, false, 'from the end screen too');
});

test('present: B (or .) blacks the screen; B again, or any move key, brings the slide back without moving', () => {
    let state = App.present.reduce(showAt(1), { key: 'b' });
    assertEqual([state.black, state.index], [true, 1]);
    assertEqual(App.present.reduce(state, { key: 'B' }).black, false);
    assertEqual(App.present.reduce(showAt(1), { key: '.' }).black, true);
    state = App.present.reduce(state, { key: 'ArrowRight' });
    assertEqual([state.black, state.index], [false, 1], 'a move key only lifts the black screen');
});

test('present: Esc ends the show; other keys change nothing', () => {
    assertEqual(!!App.present.reduce(showAt(2), { key: 'Escape' }).exit, true);
    const state = App.present.reduce(showAt(2), { key: 'x' });
    assertEqual([state.index, state.black, state.end, !!state.exit, state.handled], [2, false, false, false, false]);
    assertEqual(App.present.reduce(showAt(2), { key: 'ArrowRight' }).handled, true, 'a used key is marked handled');
});

test('present: the presenter view\'s next slide skips hidden slides; none after the last', () => {
    assertEqual(App.present.nextShown(showAt(0)), 1);
    assertEqual(App.present.nextShown(showAt(3)), 5, 'slide 5 is hidden');
    assertEqual(App.present.nextShown(showAt(5)), -1, 'the last: the end of the show comes next');
    assertEqual(App.present.nextShown(showAt(5, { end: true })), -1);
});

test('present: the presenter view\'s timer reads h:mm:ss and the clock hh:mm', () => {
    assertEqual(App.present.elapsedText(0), '0:00:00');
    assertEqual(App.present.elapsedText(65 * 1000 + 999), '0:01:05', 'whole seconds');
    assertEqual(App.present.elapsedText((2 * 3600 + 3 * 60 + 4) * 1000), '2:03:04');
    assertEqual(App.present.clockText(new Date(2026, 10, 11, 9, 5)), '09:05');
    assertEqual(App.present.clockText(new Date(2026, 10, 11, 14, 32)), '14:32');
});
