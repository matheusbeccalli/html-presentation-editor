/* Tests for src/js/selection.js: the pure part of multi-select (Phase 7). */

test('selection: Shift+click adds an element to the selection, or takes it out', () => {
    assertEqual(App.selection.toggleId(['e1', 'e2'], 'e3'), ['e1', 'e2', 'e3']);
    assertEqual(App.selection.toggleId(['e1', 'e2', 'e3'], 'e2'), ['e1', 'e3']);
    assertEqual(App.selection.toggleId([], 'e1'), ['e1']);
});
