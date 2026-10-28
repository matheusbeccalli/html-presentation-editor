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
            if (options.requestThrows) {
                throw options.requestThrows;
            }
            return options.grant || 'granted';
        },
        createWritable: async () => {
            if (options.writableThrows) {
                throw options.writableThrows;
            }
            return {
            write: async (data) => { log.written = data; },
            close: async () => { log.closed = true; },
            };
        },
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

// The exact error Edge gives on file:// pages when asked for write permission.
function thirdPartyError() {
    return new DOMException("Failed to execute 'requestPermission' on 'FileSystemHandle': " +
        'Not allowed to request permissions in a third-party context.', 'SecurityError');
}

test('fileio: writeOrReplaceHandle writes to the same file when allowed', async () => {
    const handle = fakeHandle();
    let asked = false;
    const used = await App.fileio.writeOrReplaceHandle(handle, 'x', async () => { asked = true; });
    assert(used === handle, 'same handle returned');
    assert(!asked, 'no replacement asked for');
    assertEqual(handle.log.written, 'x');
});

test('fileio: when Edge refuses write permission (file:// page), ask for a writable handle and save there', async () => {
    const readOnly = fakeHandle({ permission: 'prompt', requestThrows: thirdPartyError() });
    const writable = fakeHandle();
    let askedWith = null;
    const used = await App.fileio.writeOrReplaceHandle(readOnly, '<html>', async (old) => {
        askedWith = old;
        return writable;
    });
    assert(used === writable, 'the new handle is returned so later saves use it');
    assert(askedWith === readOnly, 'the old handle is passed on (to start in its folder)');
    assertEqual(writable.log.written, '<html>');
    assertEqual(readOnly.log.written, null);
});

test('fileio: a refused permission prompt also asks for a writable handle', async () => {
    const readOnly = fakeHandle({ permission: 'prompt', grant: 'denied' });
    const writable = fakeHandle();
    const used = await App.fileio.writeOrReplaceHandle(readOnly, 'x', async () => writable);
    assert(used === writable);
});

test('fileio: createWritable refused with NotAllowedError also asks for a writable handle', async () => {
    const readOnly = fakeHandle({ writableThrows: new DOMException('denied', 'NotAllowedError') });
    const writable = fakeHandle();
    const used = await App.fileio.writeOrReplaceHandle(readOnly, 'x', async () => writable);
    assert(used === writable);
});

test('fileio: cancelling the replacement writes nothing and returns null', async () => {
    const readOnly = fakeHandle({ permission: 'prompt', requestThrows: thirdPartyError() });
    const used = await App.fileio.writeOrReplaceHandle(readOnly, 'x', async () => null);
    assertEqual(used, null);
    assertEqual(readOnly.log.written, null);
});

test('fileio: other write errors are not hidden', async () => {
    const broken = fakeHandle({ writableThrows: new TypeError('disk full') });
    let message = '';
    try {
        await App.fileio.writeOrReplaceHandle(broken, 'x', async () => fakeHandle());
    } catch (error) {
        message = error.message;
    }
    assertEqual(message, 'disk full');
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
