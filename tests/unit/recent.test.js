/* Tests for the pure parts of src/js/recent.js: the Recent files list (SPEC 6.2). */

test('recent: sorted newest first', () => {
    const list = [{ id: 1, openedAt: 10 }, { id: 2, openedAt: 30 }, { id: 3, openedAt: 20 }];
    assertEqual(App.recent.sorted(list).map((entry) => entry.id), [2, 3, 1]);
});

test('recent: idsToDrop keeps the newest entries', () => {
    const list = [1, 2, 3, 4, 5].map((n) => ({ id: n, openedAt: n }));
    assertEqual(App.recent.idsToDrop(list, 3), [1, 2]);
    assertEqual(App.recent.idsToDrop(list, 10), []);
});

test('recent: duplicates are found with isSameEntry, or by name when a handle cannot tell', async () => {
    const handle = (name, sameAs) => ({ kind: 'file', name: name, isSameEntry: async (other) => other.name === sameAs });
    const opened = { kind: 'file', name: 'deck.html' };
    const list = [
        { id: 1, name: 'deck.html', handle: handle('deck.html', 'deck.html') },   // the same file
        { id: 2, name: 'deck.html', handle: handle('deck.html', 'nothing') },     // same name, another folder
        { id: 3, name: 'deck.html', handle: { kind: 'file', name: 'deck.html' } }, // no isSameEntry: compare names
        { id: 4, name: 'other.html', handle: { kind: 'file', name: 'other.html' } },
    ];
    assertEqual(await App.recent.duplicateIds(list, opened), [1, 3]);
});
