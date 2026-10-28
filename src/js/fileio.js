/*
 * fileio.js - opening and saving decks (SPEC 4, Phase 1).
 *
 * Opening, three ways:
 *   1. File > Open (Ctrl+O) uses showOpenFilePicker (File System Access API).
 *      We keep the returned "file handle" so Save can write back to the same file.
 *   2. Fallback when that API is missing: a hidden <input type="file">.
 *   3. Drag and drop an .html file onto the window. Chromium also gives us a
 *      file handle for dropped files, so Save works for those too.
 *
 * Saving:
 *   Save (Ctrl+S)        -> write through the handle; no handle -> Save As
 *   Save As (Ctrl+Shift+S) -> showSaveFilePicker; fallback: a normal download
 *   createWritable() writes to a temporary file and replaces the original only
 *   when closed, so a crash mid-save cannot corrupt the deck (SPEC 6.1).
 *
 * Also: the unsaved-changes dot in the title and the warning on closing the tab.
 *
 * Talks to: importer.js, deck.js, serialize.js, history.js, dialogs.js, ui.js.
 */

(function () {
    'use strict';

    App.fileio = {};

    const HTML_TYPES = [{ description: 'HTML presentation', accept: { 'text/html': ['.html', '.htm'] } }];
    const NEW_DECK_NAME = 'Untitled deck.html';

    // ---------------------------------------------------------------
    // Small pure helpers (tested in tests/unit/fileio.test.js)
    // ---------------------------------------------------------------

    App.fileio.isHtmlFileName = function isHtmlFileName(name) {
        return /\.html?$/i.test(name || '');
    };

    App.fileio.windowTitle = function windowTitle(fileName, dirty) {
        if (!fileName) {
            return 'Deck Editor';
        }
        return (dirty ? '● ' : '') + fileName + ' — Deck Editor';
    };

    /*
     * Write text to a file handle, asking for write permission first if needed
     * (Chromium asks the user once per session).
     */
    App.fileio.writeToHandle = async function writeToHandle(handle, text) {
        const mode = { mode: 'readwrite' };
        let permission = await handle.queryPermission(mode);
        if (permission !== 'granted') {
            permission = await handle.requestPermission(mode);
        }
        if (permission !== 'granted') {
            throw new Error('The browser did not get permission to write to "' + handle.name + '".');
        }
        const writable = await handle.createWritable();
        try {
            await writable.write(text);
            await writable.close();
        } catch (error) {
            // abort() throws the temporary file away, leaving the original untouched.
            if (writable.abort) {
                await writable.abort();
            }
            throw error;
        }
    };

    // ---------------------------------------------------------------
    // Setup
    // ---------------------------------------------------------------

    let fileInput = null;

    App.fileio.init = function init() {
        fileInput = document.getElementById('file-input');
        fileInput.addEventListener('change', () => {
            const file = fileInput.files[0];
            fileInput.value = '';   // so choosing the same file again still fires "change"
            if (file) {
                App.fileio.openFile(file, null).catch(reportError('Could not open the file'));
            }
        });

        App.fileio.listenForDrops(window);

        // The browser shows its own "Leave site?" question; custom text is not allowed.
        window.addEventListener('beforeunload', (event) => {
            if (App.history.isDirty()) {
                event.preventDefault();
                event.returnValue = '';
            }
        });
    };

    function reportError(title) {
        return (error) => {
            App.ui.setBusy(null);
            console.error(error);
            App.dialogs.alert(title, error && error.message ? error.message : String(error));
        };
    }

    // ---------------------------------------------------------------
    // Opening
    // ---------------------------------------------------------------

    async function confirmDiscard() {
        if (!App.state.hasDeck || !App.history.isDirty()) {
            return true;
        }
        return App.dialogs.confirm({
            title: 'Discard unsaved changes?',
            message: 'The current deck has changes that are not saved. Open another deck anyway?',
            ok: 'Discard changes', danger: true,
        });
    }

    App.fileio.open = async function open() {
        if (!(await confirmDiscard())) {
            return;
        }
        if (!window.showOpenFilePicker) {
            fileInput.click();
            return;
        }
        let handle;
        try {
            [handle] = await window.showOpenFilePicker({ types: HTML_TYPES, multiple: false });
        } catch (error) {
            if (error.name === 'AbortError') {
                return;   // the user closed the dialog
            }
            throw error;
        }
        await App.fileio.openFile(await handle.getFile(), handle);
    };

    /* Import a File (from any of the three ways) and show it. */
    App.fileio.openFile = async function openFile(file, handle) {
        if (!App.fileio.isHtmlFileName(file.name)) {
            throw new Error('"' + file.name + '" is not an .html file. The editor opens HTML presentations.');
        }
        App.ui.setBusy('Opening ' + file.name + '…');
        const text = await file.text();
        const result = await App.importer.importDeck(text);
        await showDeck(result.html, file.name, handle);
        if (App.importer.reportHasChanges(result.report)) {
            App.history.markDirty();   // the deck now differs from the file on disk
        }
        App.ui.setBusy(null);
        App.ui.setStatus('Opened ' + file.name);
        if (App.importer.reportHasItems(result.report)) {
            await App.dialogs.showImportReport(result.report);
        }
        return result.report;
    };

    async function showDeck(html, fileName, handle) {
        await App.deck.load(html);
        App.state.fileName = fileName;
        App.state.fileHandle = handle || null;
        App.history.reset();
        App.ui.showDeck();
    }

    App.fileio.newDeck = async function newDeck() {
        if (!(await confirmDiscard())) {
            return;
        }
        // Through the importer like any deck, so there is only one way in.
        const result = await App.importer.importDeck(App.template.newDeckHtml());
        await showDeck(result.html, NEW_DECK_NAME, null);
        App.ui.setStatus('New deck');
    };

    /*
     * Drag and drop. getAsFileSystemHandle() must be called straight away in
     * the drop event (before any "await"), or the browser forgets the data.
     */
    App.fileio.listenForDrops = function listenForDrops(targetWindow) {
        const hasFiles = (event) => event.dataTransfer && Array.from(event.dataTransfer.types).indexOf('Files') !== -1;

        targetWindow.addEventListener('dragover', (event) => {
            if (hasFiles(event)) {
                event.preventDefault();   // without this the browser would open the file itself
                event.dataTransfer.dropEffect = 'copy';
                App.ui.showDropZone(true);
            }
        });
        targetWindow.addEventListener('dragleave', (event) => {
            if (event.relatedTarget === null) {
                App.ui.showDropZone(false);
            }
        });
        targetWindow.addEventListener('drop', (event) => {
            if (!hasFiles(event)) {
                return;
            }
            event.preventDefault();
            App.ui.showDropZone(false);
            const item = Array.from(event.dataTransfer.items).find((entry) => entry.kind === 'file');
            if (!item) {
                return;
            }
            const handlePromise = item.getAsFileSystemHandle ? item.getAsFileSystemHandle() : Promise.resolve(null);
            const file = item.getAsFile();
            openDropped(file, handlePromise).catch(reportError('Could not open the dropped file'));
        });
    };

    async function openDropped(file, handlePromise) {
        if (!(await confirmDiscard())) {
            return;
        }
        let handle = null;
        try {
            handle = await handlePromise;
        } catch (error) {
            handle = null;   // no handle: Save will ask where to save instead
        }
        await App.fileio.openFile(file, handle && handle.kind === 'file' ? handle : null);
    }

    // ---------------------------------------------------------------
    // Saving
    // ---------------------------------------------------------------

    App.fileio.playerSource = function playerSource() {
        return {
            playerJs: document.getElementById('deck-player-js').textContent.trim(),
            playerCss: document.getElementById('deck-player-css').textContent.trim(),
        };
    };

    App.fileio.currentHtml = function currentHtml() {
        return App.serialize.toHtml(App.deck.getDocument(), App.fileio.playerSource());
    };

    function afterSave(fileName) {
        App.state.fileName = fileName;
        App.history.markSaved();
        App.ui.setStatus('Saved ' + fileName);
        App.events.emit('saved', { fileName: fileName });
    }

    App.fileio.save = async function save() {
        if (!App.state.hasDeck) {
            return;
        }
        if (!App.state.fileHandle) {
            await App.fileio.saveAs();
            return;
        }
        App.ui.setStatus('Saving…');
        await App.fileio.writeToHandle(App.state.fileHandle, App.fileio.currentHtml());
        afterSave(App.state.fileHandle.name);
    };

    App.fileio.saveAs = async function saveAs() {
        if (!App.state.hasDeck) {
            return;
        }
        const html = App.fileio.currentHtml();
        const suggestedName = App.state.fileName || NEW_DECK_NAME;

        if (!window.showSaveFilePicker) {
            download(suggestedName, html);
            afterSave(suggestedName);
            return;
        }
        let handle;
        try {
            handle = await window.showSaveFilePicker({ suggestedName: suggestedName, types: HTML_TYPES });
        } catch (error) {
            if (error.name === 'AbortError') {
                return;
            }
            throw error;
        }
        App.ui.setStatus('Saving…');
        await App.fileio.writeToHandle(handle, html);
        App.state.fileHandle = handle;
        afterSave(handle.name);
    };

    function download(fileName, html) {
        const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
        const link = App.util.el('a', { href: url, download: fileName });
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
})();
