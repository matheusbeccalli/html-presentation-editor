/* Tests for src/js/storage.js: the IndexedDB wrapper for drafts (SPEC 6.2), on a throw-away database. */

const TEST_DB = 'deck-editor-unit-tests';

async function freshStorage() {
    App.storage.close();
    await new Promise((resolve) => {
        const request = indexedDB.deleteDatabase(TEST_DB);
        request.onsuccess = request.onerror = request.onblocked = () => resolve();
    });
    const ok = await App.storage.open({ name: TEST_DB });
    assert(ok, 'IndexedDB should open in the test page');
}

test('storage: a draft is stored, listed without its HTML, and read back', async () => {
    await freshStorage();
    const id = await App.storage.addDraft({ deckId: 'd1', session: 'a', fileName: 'x.html', savedAt: 100 }, '<html>one</html>');
    assert(id !== null, 'addDraft returns the new id');
    const list = await App.storage.listDrafts();
    assertEqual(list, [{ deckId: 'd1', session: 'a', fileName: 'x.html', savedAt: 100, id: id }]);
    assertEqual(await App.storage.getDraftHtml(id), '<html>one</html>');
    assertEqual(await App.storage.getDraftHtml(9999), null);
});

test('storage: deleteDrafts removes the listed drafts and their HTML only', async () => {
    await freshStorage();
    const a = await App.storage.addDraft({ deckId: 'd1', savedAt: 1 }, 'A');
    const b = await App.storage.addDraft({ deckId: 'd1', savedAt: 2 }, 'B');
    assert(await App.storage.deleteDrafts([a]));
    assertEqual((await App.storage.listDrafts()).map((d) => d.id), [b]);
    assertEqual(await App.storage.getDraftHtml(a), null);
    assertEqual(await App.storage.getDraftHtml(b), 'B');
    assert(await App.storage.deleteDrafts([]), 'deleting nothing is fine');
});

test('storage: clearAll empties every store', async () => {
    await freshStorage();
    await App.storage.addDraft({ deckId: 'd1', savedAt: 1 }, 'A');
    await App.storage.addDraft({ deckId: 'd2', savedAt: 2 }, 'B');
    assert(await App.storage.clearAll());
    assertEqual(await App.storage.listDrafts(), []);
    App.storage.close();
});

test('storage: a blocked IndexedDB makes open() return false, and every call stays safe', async () => {
    App.storage.close();
    const blocked = { open: () => { throw new DOMException('blocked by policy', 'SecurityError'); } };
    assertEqual(await App.storage.open({ name: TEST_DB, indexedDB: blocked }), false);
    assertEqual(App.storage.isAvailable(), false);
    assertEqual(await App.storage.addDraft({ deckId: 'd1', savedAt: 1 }, 'A'), null);
    assertEqual(await App.storage.listDrafts(), []);
    assertEqual(await App.storage.getDraftHtml(1), null);
    assertEqual(await App.storage.deleteDrafts([1]), false);
    assertEqual(await App.storage.clearAll(), false);
});

test('storage: a missing IndexedDB (undefined) also returns false', async () => {
    App.storage.close();
    assertEqual(await App.storage.open({ name: TEST_DB, indexedDB: null }), false);
});
