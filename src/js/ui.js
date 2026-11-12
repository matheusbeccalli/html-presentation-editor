/*
 * ui.js - the window frame around the slide: title bar, status bar, welcome
 * screen, drop zone and the "busy" overlay (the notes under the slide: notes.js).
 *
 * It mostly listens to events and updates text; it never changes the deck.
 *
 * The status bar also counts the deck's review comments (a click opens the
 * Comments pane). It has two texts: the save state (always one of Saved ·
 * Saving… · Unsaved changes · AutoSave off, plus "Draft saved 14:32" or
 * "Recovery unavailable" when they apply, SPEC 6.4) and a message about the
 * last action ("Opened deck.html").
 *
 * Talks to: events (deck-loaded, slide-changed, history-changed, saved, saving,
 *           autosave-changed, drafts-changed), deck.js, fileio.js (window title),
 *           autosave.js, drafts.js, commands.js. (The zoom controls in the
 *           status bar belong to canvas.js.)
 */

(function () {
    'use strict';

    App.ui = {};

    const nodes = {};

    /*
     * The save-state text (tested in tests/unit/settings.test.js).
     * state = { hasDeck, saving, dirty, isNew, autosaveOff, draftAt, recoveryUnavailable }
     */
    const TOO_BIG = 20 * 1024 * 1024;   // Outlook refuses attachments of about 20-25 MB

    /* The deck size for the status bar: { text: "640 KB" | "3.4 MB", tooBig }. */
    App.ui.sizeText = function sizeText(bytes) {
        const text = bytes < 1024 * 1024
            ? Math.max(1, Math.round(bytes / 1024)) + ' KB'
            : (bytes / 1024 / 1024).toFixed(1) + ' MB';
        return { text: text, tooBig: bytes > TOO_BIG };
    };

    /* The status bar's comment count: '' (none), '1 comment', '3 comments'. */
    App.ui.commentsText = function commentsText(count) {
        return count ? count + (count === 1 ? ' comment' : ' comments') : '';
    };

    App.ui.statusText = function statusText(state) {
        const parts = [];
        if (state.hasDeck) {
            if (state.saving) {
                parts.push('Saving…');
            } else if (!state.dirty) {
                parts.push(state.isNew ? 'Not saved yet' : 'Saved');
            } else {
                parts.push(state.autosaveOff ? 'AutoSave off' : 'Unsaved changes');
            }
            if (state.dirty && !state.saving && state.draftAt) {
                parts.push('Draft saved ' + App.drafts.formatClock(state.draftAt));
            }
        }
        if (state.recoveryUnavailable) {
            parts.push('Recovery unavailable');
        }
        return parts.join(' · ');
    };

    function byId(id) {
        return document.getElementById(id);
    }

    App.ui.init = function init() {
        ['title-file', 'title-dirty', 'status-slide', 'status-save', 'status-message', 'status-size', 'status-comments',
         'welcome', 'canvas-stage-box', 'drop-zone', 'drop-zone-text', 'busy', 'busy-text', 'quick-access'].forEach((id) => {
            nodes[id] = byId(id);
        });

        buildQuickAccess();
        showBrowserBanner();
        byId('welcome-new').addEventListener('click', () => App.commands.run('newDeck'));
        byId('welcome-open').addEventListener('click', () => App.commands.run('open'));

        App.events.on('deck-loaded', () => {
            App.ui.updateTitle();
            updateSlideInfo();
        });
        App.events.on('slide-changed', updateSlideInfo);
        App.events.on('history-changed', () => {
            App.ui.updateTitle();
            updateSlideInfo();
        });
        App.events.on('saved', App.ui.updateTitle);
        ['deck-loaded', 'history-changed', 'saved', 'saving', 'autosave-changed', 'drafts-changed']
            .forEach((name) => App.events.on(name, updateSaveState));
        ['deck-loaded', 'history-changed'].forEach((name) => App.events.on(name, updateComments));
        nodes['status-comments'].addEventListener('click', () => App.commentsPane.open());
        const sizeLater = App.util.debounce(updateSize, 1000);   // a big deck takes a moment to measure
        App.events.on('deck-loaded', updateSize);
        App.events.on('history-changed', sizeLater);
    };

    /* The deck's size as saved, near enough: its HTML (pictures are data: URIs inside it). */
    function updateSize() {
        const doc = App.state.hasDeck ? App.deck.getDocument() : null;
        const node = nodes['status-size'];
        node.hidden = !doc;
        if (!doc) {
            return;
        }
        const size = App.ui.sizeText(doc.documentElement.outerHTML.length);
        node.textContent = 'Deck ' + size.text;
        node.classList.toggle('too-big', size.tooBig);
        node.title = size.tooBig ? 'Over 20 MB: the file may be too big to send by email. Pictures take most of the space.'
            : 'The deck file\'s size, pictures included';
    }

    /* How many review comments the deck holds (Phase 9): a reminder that they travel in the file. */
    function updateComments() {
        const count = App.state.hasDeck ? App.comments.countIn(App.deck.getDocument()) : 0;
        nodes['status-comments'].hidden = !count;
        nodes['status-comments'].textContent = App.ui.commentsText(count);
    }

    function updateSaveState() {
        nodes['status-save'].textContent = App.ui.statusText({
            hasDeck: App.state.hasDeck,
            saving: App.fileio.isSaving(),
            dirty: App.state.hasDeck && App.history.isDirty(),
            isNew: App.state.isNew,
            autosaveOff: App.autosave.isOff(),
            draftAt: App.drafts.lastDraftAt(),
            recoveryUnavailable: App.drafts.isUnavailable(),
        });
    }

    // Save / Undo / Redo in the title bar, like PowerPoint's Quick Access Toolbar.
    function buildQuickAccess() {
        [['save', 'save', 'Save (Ctrl+S)'], ['undo', 'undo', 'Undo (Ctrl+Z)'], ['redo', 'redo', 'Redo (Ctrl+Y)']]
            .forEach(([command, icon, title]) => {
                const button = App.util.el('button', {
                    type: 'button', class: 'quick-button', title: title, 'data-command': command,
                    onclick: () => App.commands.run(command),
                });
                button.innerHTML = App.icons.get(icon);
                nodes['quick-access'].appendChild(button);
            });
        const refresh = () => {
            nodes['quick-access'].querySelectorAll('button[data-command]').forEach((button) => {
                button.disabled = !App.commands.isEnabled(button.getAttribute('data-command'));
            });
        };
        ['deck-loaded', 'history-changed', 'saved'].forEach((name) => App.events.on(name, refresh));
        App.ui.refreshQuickAccess = refresh;
    }

    // Firefox (and any browser without the File System Access API) gets a warning,
    // so a Save that turns into a download does not look like a bug. Chromium only (SPEC 2.4).
    function showBrowserBanner() {
        const banner = byId('browser-banner');
        banner.hidden = App.fileio.canSaveInPlace(window);
        byId('browser-banner-close').addEventListener('click', () => {
            banner.hidden = true;
        });
    }

    App.ui.updateTitle = function updateTitle() {
        const dirty = App.state.hasDeck && App.history.isDirty();
        document.title = App.fileio.windowTitle(App.state.hasDeck ? App.state.fileName : null, dirty);
        nodes['title-file'].textContent = App.state.hasDeck ? App.state.fileName : 'Deck Editor';
        nodes['title-dirty'].hidden = !dirty;
    };

    function updateSlideInfo() {
        const slides = App.deck.getSlides();
        const index = App.deck.getCurrentIndex();
        const slide = slides[index];
        const hidden = slide && slide.getAttribute('data-hidden') === 'true';
        nodes['status-slide'].textContent = slides.length
            ? 'Slide ' + (index + 1) + ' of ' + slides.length + (hidden ? ' (hidden)' : '')
            : '';
    }

    App.ui.setStatus = function setStatus(text) {
        nodes['status-message'].textContent = text;
    };

    App.ui.showWelcome = function showWelcome() {
        nodes.welcome.hidden = false;
        nodes['canvas-stage-box'].hidden = true;
        App.ribbon.showDefaultTab();
        App.ui.refreshQuickAccess();
        App.ui.updateTitle();
    };

    App.ui.showDeck = function showDeck() {
        nodes.welcome.hidden = true;
        nodes['canvas-stage-box'].hidden = false;
        App.canvas.fit();
        App.ui.updateTitle();
        App.ribbon.refresh();
        App.ui.refreshQuickAccess();
    };

    /* The drop zone over the window while files are dragged in: `kind` 'deck' (to open) or 'pictures' (for the slide). */
    App.ui.showDropZone = function showDropZone(visible, kind) {
        nodes['drop-zone'].hidden = !visible;
        if (visible) {
            nodes['drop-zone-text'].textContent = kind === 'pictures' ? 'Drop to put the picture on this slide' : 'Drop the .html deck to open it';
        }
    };

    /* Show a "please wait" layer with a message; pass null to hide it. */
    App.ui.setBusy = function setBusy(text) {
        nodes.busy.hidden = !text;
        nodes['busy-text'].textContent = text || '';
    };
})();
