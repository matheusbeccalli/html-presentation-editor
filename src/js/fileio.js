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
 * AutoSave (autosave.js decides when) writes through autoSave() below, which
 * first checks that nobody changed the file on disk since we last read or
 * wrote it (SPEC 6.1). All writes go through one queue, so two saves never
 * write the same file at the same time.
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

    /*
     * True when the browser can write back into the file it opened (Edge,
     * Chrome). Firefox and Safari lack the File System Access API, so there
     * Save and Save As become plain downloads and AutoSave is impossible.
     */
    App.fileio.canSaveInPlace = function canSaveInPlace(win) {
        return typeof win.showSaveFilePicker === 'function' && typeof win.showOpenFilePicker === 'function';
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
            const error = new Error('The browser did not get permission to write to "' + handle.name + '".');
            error.name = 'NotAllowedError';
            throw error;
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

    /*
     * Has the file on disk changed since we recorded `knownLastModified`
     * (at open or at our last save)? Someone may have edited it elsewhere.
     */
    App.fileio.changedOnDisk = async function changedOnDisk(handle, knownLastModified) {
        if (knownLastModified === null || knownLastModified === undefined) {
            return false;
        }
        const file = await handle.getFile();
        return file.lastModified !== knownLastModified;
    };

    // "No permission to write", as opposed to a real failure such as a full disk.
    App.fileio.isPermissionError = isPermissionError;
    function isPermissionError(error) {
        return !!error && (error.name === 'SecurityError' || error.name === 'NotAllowedError');
    }

    /*
     * Write to `handle`; if the browser refuses write permission, call
     * pickReplacement(handle) to get a writable handle and write there instead.
     * Returns the handle that was written to (keep it for later saves), or
     * null when the user cancelled.
     *
     * Why: Edge and Chrome refuse requestPermission() on pages opened from disk
     * ("Not allowed to request permissions in a third-party context"), because
     * a file:// page has a "null" origin that never matches the origin of the
     * permission. A handle from the Save As window comes with write access
     * already, so choosing the same file there once makes later saves work.
     */
    App.fileio.writeOrReplaceHandle = async function writeOrReplaceHandle(handle, text, pickReplacement) {
        try {
            await App.fileio.writeToHandle(handle, text);
            return handle;
        } catch (error) {
            if (!isPermissionError(error)) {
                throw error;
            }
        }
        const replacement = await pickReplacement(handle);
        if (!replacement) {
            return null;
        }
        await App.fileio.writeToHandle(replacement, text);
        return replacement;
    };

    // ---------------------------------------------------------------
    // Setup
    // ---------------------------------------------------------------

    let fileInput = null;

    // While a write is in progress the status bar shows "Saving…" (ui.js).
    let writesInProgress = 0;
    async function writing(task) {
        writesInProgress += 1;
        App.events.emit('saving', { active: true });
        try {
            return await task();
        } finally {
            writesInProgress -= 1;
            App.events.emit('saving', { active: writesInProgress > 0 });
        }
    }

    App.fileio.isSaving = function isSaving() {
        return writesInProgress > 0;
    };

    // One write at a time: each task starts when the previous one has finished.
    let writeQueue = Promise.resolve();
    function exclusive(task) {
        const run = writeQueue.then(task, task);
        writeQueue = run.catch(() => {});   // a failed save must not block later ones
        return run;
    }

    // The file's date after we wrote it, so the next AutoSave can tell if someone else changed it.
    async function recordDiskVersion(handle, file) {
        try {
            App.state.diskLastModified = (file || await handle.getFile()).lastModified;
        } catch (error) {
            App.state.diskLastModified = null;   // cannot read it back: skip the check rather than fail
        }
    }

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
        await pickAndOpen(null);
    };

    /*
     * Recent files (recent.js): a page opened from disk may not ask to read a
     * remembered file again, so show the Open window in that file's folder.
     */
    App.fileio.openRecent = async function openRecent(handle) {
        if (!(await confirmDiscard())) {
            return;
        }
        if (!window.showOpenFilePicker) {
            fileInput.click();
            return;
        }
        await pickAndOpen(handle);
    };

    /* The Open window (optionally starting in the folder of handle `startIn`), then open the choice. */
    async function pickAndOpen(startIn) {
        const options = { types: HTML_TYPES, multiple: false };
        if (startIn) {
            options.startIn = startIn;
        }
        let handle;
        try {
            [handle] = await window.showOpenFilePicker(options);
        } catch (error) {
            if (error.name === 'AbortError') {
                return;   // the user closed the dialog
            }
            if (startIn && error.name === 'TypeError') {
                return pickAndOpen(null);   // the remembered place is no longer usable: open anywhere
            }
            throw error;
        }
        await App.fileio.openFile(await handle.getFile(), handle);
    }

    /* Import a File (from any of the three ways) and show it. */
    App.fileio.openFile = async function openFile(file, handle) {
        if (!App.fileio.isHtmlFileName(file.name)) {
            throw new Error('"' + file.name + '" is not an .html file. The editor opens HTML presentations.');
        }
        App.ui.setBusy('Opening ' + file.name + '…');
        const text = await file.text();
        const result = await App.importer.importDeck(text);
        await showDeck(result.html, file.name, handle);
        App.state.diskLastModified = handle ? file.lastModified : null;
        if (App.importer.reportHasChanges(result.report)) {
            App.history.markDirty();   // the deck now differs from the file on disk
        }
        App.ui.setBusy(null);
        App.ui.setStatus('Opened ' + file.name);
        if (App.importer.reportHasItems(result.report)) {
            await App.dialogs.showImportReport(result.report);
        }
        // drafts.js offers unsaved changes newer than this file (SPEC 6.2).
        App.events.emit('file-opened', { fileName: file.name, lastModified: file.lastModified, handle: handle || null });
        return result.report;
    };

    /*
     * Show a recovered draft (drafts.js) as an unsaved deck. There is no file
     * handle, so the first Save asks where to save, suggesting the old name.
     */
    App.fileio.openRecovered = async function openRecovered(html, fileName) {
        App.ui.setBusy('Recovering unsaved changes…');
        try {
            const result = await App.importer.importDeck(html);
            await showDeck(result.html, fileName || NEW_DECK_NAME, null, true);   // not in any file yet
            App.history.markDirty();
        } finally {
            App.ui.setBusy(null);
        }
        App.ui.setStatus('Recovered unsaved changes');
    };

    // isNew: the deck is in no file yet (File > New, recovered drafts). Set before
    // history.reset(), whose 'history-changed' event makes the UI read this state.
    async function showDeck(html, fileName, handle, isNew) {
        await App.deck.load(html);
        App.state.fileName = fileName;
        App.state.fileHandle = handle || null;
        App.state.openedHtml = html;          // for "Revert to version opened" (SPEC 6.1)
        App.state.diskLastModified = null;
        App.state.isNew = !!isNew;
        App.history.reset();
        App.ui.showDeck();
    }

    App.fileio.newDeck = async function newDeck() {
        if (!(await confirmDiscard())) {
            return;
        }
        // Through the importer like any deck, so there is only one way in.
        const result = await App.importer.importDeck(App.template.newDeckHtml());
        await showDeck(result.html, NEW_DECK_NAME, null, true);
        App.ui.setStatus('New deck');
    };

    /*
     * Drag and drop: pictures go on the current slide (images.js), an .html
     * file opens as a deck. getAsFileSystemHandle() must be called straight
     * away in the drop event (before any "await"), or the browser forgets the data.
     */
    App.fileio.listenForDrops = function listenForDrops(targetWindow) {
        const hasFiles = (event) => event.dataTransfer && Array.from(event.dataTransfer.types).indexOf('Files') !== -1;
        const forTheSlide = (event) => App.state.hasDeck && App.images.isPictureDrop(event.dataTransfer.items);

        targetWindow.addEventListener('dragover', (event) => {
            if (hasFiles(event)) {
                event.preventDefault();   // without this the browser would open the file itself
                event.dataTransfer.dropEffect = 'copy';
                App.ui.showDropZone(true, forTheSlide(event) ? 'pictures' : 'deck');
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
            if (forTheSlide(event)) {
                App.text.exitEdit({ select: false });
                App.images.insertFiles(event.dataTransfer.files);   // all of them: the others are named in the status bar
                return;
            }
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
        // The deck file keeps its review comments (Phase 9); exports and clean copies do not.
        return App.serialize.toHtml(App.deck.getDocument(), App.fileio.playerSource(), { keepComments: true });
    };

    /*
     * details: { stateId, toHandle, auto }. toHandle = written into a file we
     * can write again (not a download), which is what AutoSave needs.
     */
    function afterSave(fileName, details) {
        App.state.fileName = fileName;
        App.state.isNew = false;
        App.history.markSaved(details.stateId);
        App.ui.setStatus((details.auto ? 'AutoSaved ' : 'Saved ') + fileName);
        App.events.emit('saved', { fileName: fileName, toHandle: !!details.toHandle, auto: !!details.auto });
    }

    App.fileio.save = function save() {
        if (!App.state.hasDeck) {
            return Promise.resolve();
        }
        if (!App.state.fileHandle) {
            return App.fileio.saveAs();
        }
        return exclusive(async () => {
            App.text.commitTyping();   // typing so far becomes an undo step before the save
            const stateId = App.history.stateId();
            const used = await writing(() =>
                App.fileio.writeOrReplaceHandle(App.state.fileHandle, App.fileio.currentHtml(), askForWritableFile));
            if (!used) {
                App.ui.setStatus('Save cancelled');
                return;
            }
            App.state.fileHandle = used;
            await recordDiskVersion(used);
            afterSave(used.name, { stateId: stateId, toHandle: true });
        });
    };

    /*
     * One AutoSave write (autosave.js calls this). Never asks the user anything:
     * returns 'saved', 'nothing' (no file or no changes) or 'conflict' (the file
     * changed on disk; the caller asks what to do). options.force skips the
     * check, for "Overwrite". Permission errors are thrown to the caller.
     */
    App.fileio.autoSave = function autoSave(options) {
        return exclusive(async () => {
            const handle = App.state.fileHandle;
            if (!App.state.hasDeck || !handle || !App.history.isDirty()) {
                return 'nothing';
            }
            const force = !!(options && options.force);
            if (!force && await App.fileio.changedOnDisk(handle, App.state.diskLastModified)) {
                return 'conflict';
            }
            App.text.commitTyping();   // typing so far becomes an undo step before the save
            const stateId = App.history.stateId();
            await writing(() => App.fileio.writeToHandle(handle, App.fileio.currentHtml()));
            await recordDiskVersion(handle);
            afterSave(handle.name, { stateId: stateId, toHandle: true, auto: true });
            return 'saved';
        });
    };

    /* "Reload": open the file as it is now on disk, dropping the changes in the editor. */
    App.fileio.reloadFromDisk = async function reloadFromDisk() {
        const handle = App.state.fileHandle;
        if (handle) {
            await App.fileio.openFile(await handle.getFile(), handle);
        }
    };

    /*
     * Edge would not let us write to the opened file (see writeOrReplaceHandle),
     * so explain, then open Save As in the same folder with the same name.
     */
    async function askForWritableFile(readOnlyHandle) {
        const choice = await App.dialogs.show({
            title: 'Confirm where to save',
            body: 'Edge does not let a page opened from disk write to a file it opened. ' +
                'In the next window, choose "' + readOnlyHandle.name + '" and confirm Replace. ' +
                'Later saves in this session go straight to that file.',
            buttons: [{ label: 'Cancel', value: false }, { label: 'Choose file…', value: true, primary: true }],
        });
        if (choice !== true) {
            return null;
        }
        return pickSaveHandle(readOnlyHandle.name, readOnlyHandle);
    }

    /* Show the Save As window. Returns a writable handle, or null if cancelled. */
    async function pickSaveHandle(suggestedName, startIn) {
        const options = { suggestedName: suggestedName, types: HTML_TYPES };
        if (startIn) {
            options.startIn = startIn;   // a file handle opens the window in that file's folder
        }
        try {
            return await window.showSaveFilePicker(options);
        } catch (error) {
            if (error.name === 'AbortError') {
                return null;   // the user closed the window
            }
            throw error;
        }
    }

    App.fileio.saveAs = function saveAs() {
        if (!App.state.hasDeck) {
            return Promise.resolve();
        }
        return exclusive(async () => {
            App.text.commitTyping();   // typing so far becomes an undo step before the save
            const stateId = App.history.stateId();
            const html = App.fileio.currentHtml();
            const suggestedName = App.state.fileName || NEW_DECK_NAME;

            if (!window.showSaveFilePicker) {
                download(suggestedName, html);
                afterSave(suggestedName, { stateId: stateId, toHandle: false });
                return;
            }
            const handle = await pickSaveHandle(suggestedName, App.state.fileHandle);
            if (!handle) {
                return;
            }
            await writing(() => App.fileio.writeToHandle(handle, html));
            App.state.fileHandle = handle;
            await recordDiskVersion(handle);
            afterSave(handle.name, { stateId: stateId, toHandle: true });
        });
    };

    /* 'Projeto Atlas.html' → 'Projeto Atlas (clean copy).html'. */
    App.fileio.cleanCopyName = function cleanCopyName(fileName) {
        const name = (fileName || NEW_DECK_NAME).replace(/\.html?$/i, '');
        return name + ' (clean copy).html';
    };

    /*
     * File > Save a Clean Copy (SPEC 7.5): a copy to send, saved beside the deck under
     * another name. Hidden slides go when "Remove hidden slides" is ticked (ticked by
     * default, as decided in the Phase 8 Q&A); review comments will go too (Phase 9).
     * The editor stays on the original: its file, its unsaved changes and its recovery
     * drafts are left as they were.
     */
    App.fileio.saveCleanCopy = async function saveCleanCopy() {
        if (!App.state.hasDeck) {
            return;
        }
        const el = App.util.el;
        const hiddenCount = App.deck.getSlides().filter((slide) => App.slides.isHidden(slide)).length;
        const removeBox = el('input', { type: 'checkbox', id: 'clean-copy-remove-hidden', checked: true });
        const commentCount = App.comments.countIn(App.deck.getDocument());
        const body = el('div', { class: 'clean-copy-dialog' }, [
            el('p', {}, ['A copy to send: saved under another name; the deck you are editing stays as it is.']),
            el('label', {}, [removeBox, ' Remove hidden slides (' + hiddenCount + ')']),
            el('p', { class: 'clean-copy-note' }, [commentCount
                ? 'Its ' + App.ui.commentsText(commentCount).replace('comment', 'review comment') + ' ' +
                  (commentCount === 1 ? 'is' : 'are') + ' left out.'
                : 'Review comments are always left out.']),
        ]);
        const go = await App.dialogs.show({
            title: 'Save a Clean Copy', body: body,
            buttons: [{ label: 'Save…', value: true, primary: true }, { label: 'Cancel', value: false }],
        });
        if (!go) {
            return;
        }
        App.text.commitTyping();
        const html = App.serialize.toHtml(App.deck.getDocument(), App.fileio.playerSource(),
            { cleanCopy: true, removeHidden: removeBox.checked });
        const suggestedName = App.fileio.cleanCopyName(App.state.fileName);
        if (!window.showSaveFilePicker) {
            download(suggestedName, html);
            App.ui.setStatus('Saved a clean copy: ' + suggestedName + ' (your Downloads folder)');
            return;
        }
        const handle = await pickSaveHandle(suggestedName, App.state.fileHandle);
        if (!handle) {
            return;
        }
        await writing(() => App.fileio.writeToHandle(handle, html));
        App.ui.setStatus('Saved a clean copy: ' + handle.name);
    };

    function download(fileName, html) {
        App.fileio.downloadBlob(fileName, new Blob([html], { type: 'text/html' }));
    }

    /* Hand a file to the browser's downloads (Save As fallback, PNG / PowerPoint exports). */
    App.fileio.downloadBlob = function downloadBlob(fileName, blob) {
        const url = URL.createObjectURL(blob);
        const link = App.util.el('a', { href: url, download: fileName });
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
    };
})();
