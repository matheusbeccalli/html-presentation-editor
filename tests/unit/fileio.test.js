/* Tests for src/js/fileio.js: the parts that do not need a real file dialog. */

// A stand-in for a FileSystemFileHandle: records what was written.
function fakeHandle(options) {
    options = options || {};
    const log = { written: null, closed: false, permissionAsked: false };
    const handle = {
        name: 'deck.html',
        log: log,
        queryPermission: async () => options.permission || 'granted',
        requestPermission: async () => {
            log.permissionAsked = true;
            return options.grant || 'granted';
        },
        createWritable: async () => ({
            write: async (data) => { log.written = data; },
            close: async () => { log.closed = true; },
        }),
        getFile: async () => ({ lastModified: 1234 }),
    };
    return handle;
}

test('fileio: writeToHandle writes the text and closes the stream', async () => {
    const handle = fakeHandle();
    await App.fileio.writeToHandle(handle, '<html></html>');
    assertEqual(handle.log.written, '<html></html>');
    assert(handle.log.closed, 'closed');
});

test('fileio: writeToHandle asks for write permission when needed', async () => {
    const handle = fakeHandle({ permission: 'prompt', grant: 'granted' });
    await App.fileio.writeToHandle(handle, 'x');
    assert(handle.log.permissionAsked, 'permission requested');
});

test('fileio: writeToHandle fails clearly when permission is refused', async () => {
    const handle = fakeHandle({ permission: 'prompt', grant: 'denied' });
    let message = '';
    try {
        await App.fileio.writeToHandle(handle, 'x');
    } catch (error) {
        message = error.message;
    }
    assertIncludes(message, 'permission');
    assertEqual(handle.log.written, null);
});

test('fileio: isHtmlFileName accepts .html and .htm only', () => {
    assert(App.fileio.isHtmlFileName('Deck.HTML'));
    assert(App.fileio.isHtmlFileName('a.htm'));
    assert(!App.fileio.isHtmlFileName('deck.pptx'));
});

test('fileio: windowTitle shows a dot when there are unsaved changes', () => {
    assertEqual(App.fileio.windowTitle('deck.html', true), '● deck.html — Deck Editor');
    assertEqual(App.fileio.windowTitle('deck.html', false), 'deck.html — Deck Editor');
    assertEqual(App.fileio.windowTitle(null, false), 'Deck Editor');
});
