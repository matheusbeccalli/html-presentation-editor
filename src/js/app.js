/*
 * app.js - creates the shared `App` object and starts the editor.
 *
 * Why a global object: the editor runs from file://, where Chromium blocks
 * ES module imports between files (SPEC 2.4). So every file adds its part to
 * one shared object instead:  App.history = ..., App.deck = ..., and so on.
 * build.py pastes the files into editor.html in the order listed there.
 *
 * Rule for every file: define things at load time, but do not touch the page
 * until App.start() runs. That keeps the files loadable by tests/run-tests.html.
 *
 * Talks to: every module (start() wires them together).
 */

window.App = {
    // The deck format this editor writes (<meta name="deck-format">, SPEC 3.3).
    // 2 = text in the flat-paragraph model (Phase 3); older decks are migrated on open.
    DECK_FORMAT: 2,

    // Shared state that several modules read. Kept small on purpose.
    state: {
        fileName: null,      // name shown in the title bar, e.g. "deck.html"
        fileHandle: null,    // FileSystemFileHandle when opened via the File System Access API
        hasDeck: false,      // false while the welcome screen is shown
        openedHtml: null,    // the deck as it was when opened, for "Revert to version opened"
        diskLastModified: null,  // the file's date at open / our last save (AutoSave conflict check)
        isNew: false,        // a new or recovered deck that is not in any file yet
    },
};

/*
 * Wire the modules together. Called once from src/index.html after every
 * script has loaded. Order matters: the UI must exist before the deck loads.
 */
App.start = function start() {
    App.events = App.createEventBus();
    App.settings.init();   // before anything reads a setting
    App.history = App.createHistory({
        getDoc: () => App.deck.getDocument(),
        onChange: (info) => App.events.emit('history-changed', info),
    });

    App.commands.init();   // first: the ribbon and menus read command labels
    App.ui.init();
    App.ribbon.init();
    App.textControls.init();
    App.canvas.init();
    App.selection.init();
    App.formatPane.init();
    App.contextMenu.init();
    App.thumbnails.init();
    App.deck.init();
    App.text.init();
    App.fileio.init();
    App.autosave.init();
    App.drafts.init();
    App.recent.init();
    App.shortcuts.init();

    App.ui.showWelcome();
};
