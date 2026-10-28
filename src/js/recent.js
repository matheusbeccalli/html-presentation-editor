/*
 * recent.js - the Recent files list (SPEC 6.2), off by default.
 *
 * Only when the user turns on "Remember recent files" in File > Settings:
 * each deck opened from, or saved into, a file is remembered with its name
 * and its "file handle" (Chromium can keep a handle in IndexedDB; it points
 * at the file's place on disk, not at its content). The last 10 are kept.
 *
 * A page opened from disk may not ask for permission to read the file again,
 * so choosing a recent file shows the Open window already in that file's
 * folder; the user picks the file there (fileio.openRecent).
 *
 * Shown on the welcome screen and in File > Open recent….
 *
 * Talks to: storage.js, settings.js, fileio.js, dialogs.js, drafts.js (its
 *           start-up opens the database), events (file-opened, saved, ...).
 */

(function () {
    'use strict';

    App.recent = {};

    const MAX_ENTRIES = 10;

    // ---------------------------------------------------------------
    // Pure helpers (tested in tests/unit/recent.test.js)
    // ---------------------------------------------------------------

    App.recent.sorted = function sorted(list) {
        return list.slice().sort((a, b) => (b.openedAt - a.openedAt) || (b.id - a.id));
    };

    /* The ids beyond the newest `max` entries. */
    App.recent.idsToDrop = function idsToDrop(list, max) {
        return App.recent.sorted(list).slice(max).map((entry) => entry.id).sort((a, b) => a - b);
    };

    /*
     * The ids of entries for the same file as `handle`. isSameEntry() tells
     * two files with the same name in different folders apart; a handle
     * without it (or one that fails) is compared by name.
     */
    App.recent.duplicateIds = async function duplicateIds(list, handle) {
        const ids = [];
        for (const entry of list) {
            let same = entry.name === handle.name;
            if (same && entry.handle && typeof entry.handle.isSameEntry === 'function') {
                try {
                    same = await entry.handle.isSameEntry(handle);
                } catch (error) {
                    same = true;   // cannot tell: same name, so treat it as the same file
                }
            }
            if (same) {
                ids.push(entry.id);
            }
        }
        return ids;
    };

    // ---------------------------------------------------------------
    // The list in the editor
    // ---------------------------------------------------------------

    let entries = [];       // newest first, as last read from storage
    let welcomeList = null;

    App.recent.init = function init() {
        welcomeList = buildWelcomeList();

        App.events.on('file-opened', (info) => remember(info.handle));
        App.events.on('saved', (info) => {
            if (info.toHandle) {
                remember(App.state.fileHandle);
            }
        });
        App.events.on('settings-changed', async (info) => {
            if (info.before.rememberRecent && !info.after.rememberRecent) {
                await App.storage.clearRecent();   // turning it off forgets the list
            }
            refresh();
        });
        App.events.on('drafts-cleared', refresh);
        App.drafts.ready.then(refresh);
    };

    App.recent.hasEntries = function hasEntries() {
        return entries.length > 0;
    };

    async function remember(handle) {
        if (!handle || !App.settings.get().rememberRecent || !App.storage.isAvailable()) {
            return;
        }
        const list = await App.storage.listRecent();
        await App.storage.deleteRecent(await App.recent.duplicateIds(list, handle));
        await App.storage.addRecent({ name: handle.name, openedAt: Date.now(), handle: handle });
        await App.storage.deleteRecent(App.recent.idsToDrop(await App.storage.listRecent(), MAX_ENTRIES));
        await refresh();
    }

    async function refresh() {
        const on = App.settings.get().rememberRecent && App.storage.isAvailable();
        entries = on ? App.recent.sorted(await App.storage.listRecent()) : [];
        renderList(welcomeList.querySelector('ul'), entries, (entry) => App.recent.open(entry));
        welcomeList.hidden = entries.length === 0;
        App.events.emit('recent-changed');
    }

    function buildWelcomeList() {
        const section = App.util.el('section', { id: 'welcome-recent', hidden: true }, [
            App.util.el('h2', {}, ['Recent']),
            App.util.el('ul', { class: 'recent-list' }),
            App.util.el('p', { class: 'welcome-hint' }, ['Opens the Open window in the file\'s folder.']),
        ]);
        document.getElementById('welcome').appendChild(section);
        return section;
    }

    function renderList(list, items, onChoose) {
        list.innerHTML = '';
        items.forEach((entry) => {
            list.appendChild(App.util.el('li', {}, [App.util.el('button', {
                type: 'button', class: 'recent-item', title: 'Open "' + entry.name + '"',
                onclick: () => onChoose(entry),
            }, [
                App.util.el('span', { class: 'recent-name' }, [entry.name]),
                App.util.el('span', { class: 'recent-when' }, [App.drafts.formatTime(entry.openedAt)]),
            ])]));
        });
    }

    App.recent.open = function open(entry) {
        return App.fileio.openRecent(entry.handle).catch((error) => {
            App.ui.setBusy(null);
            console.error(error);
            App.dialogs.alert('Could not open the file', (error && error.message) || String(error));
        });
    };

    /* File > Open recent…: the same list in a dialog. */
    App.recent.openDialog = async function openDialog() {
        let chosen = null;
        const list = App.util.el('ul', { class: 'recent-list' });
        const body = App.util.el('div', {}, [
            list,
            App.util.el('p', { class: 'recent-note' }, ['Opens the Open window in the file\'s folder; choose the file there.']),
        ]);
        let close = null;
        renderList(list, entries, (entry) => {
            chosen = entry;
            close();
        });
        const shown = App.dialogs.show({ title: 'Open recent', body: body, buttons: [{ label: 'Cancel', value: null }] });
        close = () => body.closest('dialog').close();   // resolves the dialog (as Esc does)
        await shown;
        if (chosen) {
            await App.recent.open(chosen);
        }
    };
})();
