/* Tests for src/js/formatpane.js: reading the X / Y / W / H fields. */

test('formatpane: parseNumber accepts whole numbers, decimals with a dot or a comma (pt-BR)', () => {
    assertEqual(App.formatPane.parseNumber('120'), 120);
    assertEqual(App.formatPane.parseNumber(' 12,5 '), 12.5);
    assertEqual(App.formatPane.parseNumber('12.345'), 12.35);
    assertEqual(App.formatPane.parseNumber('-5'), -5);
    assertEqual(App.formatPane.parseNumber('120 px'), 120);
    assertEqual(App.formatPane.parseNumber('45°'), 45, 'the rotation field (Phase 7)');
});

test('formatpane: parseNumber returns null for text that is not a number', () => {
    assertEqual(App.formatPane.parseNumber(''), null);
    assertEqual(App.formatPane.parseNumber('abc'), null);
    assertEqual(App.formatPane.parseNumber('1,2,3'), null);
});

test('formatpane: withField changes one value; width and height never go below the minimum', () => {
    const rect = { left: 10, top: 20, width: 300, height: 40 };
    assertEqual(App.formatPane.withField(rect, 'left', -15), { left: -15, top: 20, width: 300, height: 40 });
    assertEqual(App.formatPane.withField(rect, 'height', 90), { left: 10, top: 20, width: 300, height: 90 });
    assertEqual(App.formatPane.withField(rect, 'width', 0).width, App.transform.MIN_SIZE);
});
