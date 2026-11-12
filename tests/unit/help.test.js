/*
 * help.test.js - the keyboard shortcut cheat sheet (Phase 9): built from the
 * shortcut table itself, plus the keys handled elsewhere (text, tables, slide
 * show, mouse), so it can never miss a shortcut.
 */

function editorRegistry() {
    const registry = App.shortcuts.createRegistry();
    App.shortcuts.DEFAULTS.forEach(([combo, command, options]) => registry.register(combo, command, options));
    return registry;
}

test('help: every registered shortcut is on the cheat sheet, under a named section', () => {
    const sections = App.help.shortcutSections(editorRegistry().list());
    const shown = new Set();
    sections.forEach((section) => section.rows.forEach((row) => row.keys.forEach((keys) => shown.add(keys))));
    App.shortcuts.DEFAULTS.forEach(([combo]) => {
        const key = App.shortcuts.normalizeCombo(combo);
        assert(shown.has(key), key + ' is on the sheet');
    });
    assertEqual(sections.filter((section) => section.title === 'Other').length, 0,
        'every command has a section: ' + JSON.stringify(sections.filter((s) => s.title === 'Other')));
    sections.forEach((section) => section.rows.forEach((row) => assert(row.label && row.keys.length, JSON.stringify(row))));
});

test('help: one row per command (its keys together), and the keys handled elsewhere are listed too', () => {
    const sections = App.help.shortcutSections(editorRegistry().list());
    const rows = [].concat(...sections.map((section) => section.rows));
    const redo = rows.find((row) => row.label === 'Redo');
    assertEqual(redo.keys, ['Ctrl+Y', 'Ctrl+Shift+Z']);
    const titles = sections.map((section) => section.title);
    ['Text', 'Tables', 'Slide show', 'Mouse', 'Review'].forEach((title) => assert(titles.indexOf(title) !== -1, title));
    const all = JSON.stringify(rows);
    ['Ctrl+Shift+V', 'Shift+Tab', 'Ctrl+mouse wheel', 'Alt', 'Ctrl+Enter'].forEach((keys) => assertIncludes(all, keys));
});

test('help: ? opens the sheet, also typed with AltGr (Ctrl+Alt on Windows), never while typing', () => {
    const registry = editorRegistry();
    assertEqual(registry.lookup('?').command, 'shortcuts');
    const altGr = { key: '?', ctrlKey: true, altKey: true, shiftKey: false, metaKey: false };
    assertEqual(App.shortcuts.comboFromEvent(altGr), 'Ctrl+Alt+?');
    assertEqual(registry.lookup(App.shortcuts.comboFromEvent(altGr)).command, 'shortcuts');
    assert(!registry.lookup('?').whileTyping, 'typing a ? in a text box types it');
});

test('help: filtering the sheet keeps the rows whose keys or words match', () => {
    const sections = App.help.shortcutSections(editorRegistry().list());
    const filtered = App.help.filterSections(sections, 'comment');
    const rows = [].concat(...filtered.map((section) => section.rows));
    assert(rows.length >= 1 && rows.every((row) => (row.label + row.keys.join(' ')).toLowerCase().includes('comment')),
        JSON.stringify(rows));
    assertEqual(App.help.filterSections(sections, 'ctrl+s').some((s) => s.rows.some((r) => r.keys.indexOf('Ctrl+S') !== -1)), true);
    assertEqual(App.help.filterSections(sections, '').length, sections.length);
    assertEqual(App.help.filterSections(sections, 'zzzz'), []);
});

test('help: keys are written as on the keyboard (arrows, Esc)', () => {
    assertEqual(App.help.keyText('Shift+ArrowLeft'), 'Shift+←');
    assertEqual(App.help.keyText('Escape'), 'Esc');
    assertEqual(App.help.keyText('Ctrl+Shift+>'), 'Ctrl+Shift+>');
    assertEqual(App.help.keyText('Ctrl+]'), 'Ctrl+]');
});

test('help: the About data is read from the page; a page without it (tests) gives an empty list', () => {
    const doc = parseDoc('<html><body><script type="application/json" id="about-data">' +
        '{"built":"2026-11-11","libraries":[{"name":"PptxGenJS","version":"4.0.1","license":"MIT","url":"x","sha256":"ab",' +
        '"licenseText":"Permission <\\/b>","bundled":[{"name":"JSZip","version":"3.10.1","license":"MIT"}]}]}</script></body></html>');
    const data = App.help.aboutData(doc);
    assertEqual(data.built, '2026-11-11');
    assertEqual(data.libraries[0].licenseText, 'Permission </b>');
    assertEqual(App.help.libraryLine(data.libraries[0]), 'PptxGenJS 4.0.1 · MIT');
    assertEqual(App.help.bundledLine(data.libraries[0]), 'Includes: JSZip 3.10.1 (MIT)');
    assertEqual(App.help.aboutData(parseDoc('<html><body></body></html>')), { built: '', libraries: [] });
});

test('help: a bundled library without a version of its own is named without one', () => {
    assertEqual(App.help.bundledLine({ bundled: [{ name: 'JSZip', version: '3.10.1', license: 'MIT' },
        { name: 'pako', version: 'as in JSZip 3.10.1', license: 'MIT and zlib' }] }), 'Includes: JSZip 3.10.1 (MIT), pako (MIT and zlib)');
});
