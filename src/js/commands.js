/*
 * commands.js - every action the user can trigger, in one list.
 *
 * A command has a name ('save'), a label for menus and a function. The
 * ribbon, menus and keyboard shortcuts all call App.commands.run(name), so an
 * action behaves the same however it is started, and errors are shown in one
 * consistent way.
 *
 * Talks to: fileio.js, history.js, deck.js, importer.js (the actions),
 *           shortcuts.js and ribbon.js (they run commands), ui.js.
 */

(function () {
    'use strict';

    App.commands = {};

    const registry = new Map();   // name -> { label, run, isEnabled }

    App.commands.define = function define(name, definition) {
        registry.set(name, {
            label: definition.label,
            run: definition.run,
            isEnabled: definition.isEnabled || (() => true),
        });
    };

    App.commands.isEnabled = function isEnabled(name) {
        const command = registry.get(name);
        return !!command && command.isEnabled();
    };

    App.commands.label = function label(name) {
        const command = registry.get(name);
        return command ? command.label : name;
    };

    /*
     * Run a command by name. Commands may be async (open, save); any error
     * ends up in one dialog instead of failing silently.
     */
    App.commands.run = function run(name) {
        const command = registry.get(name);
        if (!command) {
            throw new Error('Unknown command: ' + name);
        }
        if (!command.isEnabled()) {
            return Promise.resolve();
        }
        return Promise.resolve()
            .then(() => command.run())
            .catch((error) => {
                App.ui.setBusy(null);
                console.error(error);
                App.dialogs.alert(command.label + ' failed', error && error.message ? error.message : String(error));
            });
    };

    const hasDeck = () => App.state.hasDeck;

    App.commands.init = function init() {
        App.commands.define('newDeck', { label: 'New', run: () => App.fileio.newDeck() });
        App.commands.define('open', { label: 'Open…', run: () => App.fileio.open() });
        App.commands.define('save', { label: 'Save', run: () => App.fileio.save(), isEnabled: hasDeck });
        App.commands.define('saveAs', { label: 'Save As…', run: () => App.fileio.saveAs(), isEnabled: hasDeck });

        App.commands.define('undo', {
            label: 'Undo',
            isEnabled: () => hasDeck() && App.history.canUndo(),
            run: () => {
                const label = App.history.undoLabel();
                App.history.undo();
                App.ui.setStatus('Undid: ' + label);
            },
        });
        App.commands.define('redo', {
            label: 'Redo',
            isEnabled: () => hasDeck() && App.history.canRedo(),
            run: () => {
                const label = App.history.redoLabel();
                App.history.redo();
                App.ui.setStatus('Redid: ' + label);
            },
        });

        App.commands.define('nextSlide', { label: 'Next slide', run: () => App.deck.next(), isEnabled: hasDeck });
        App.commands.define('previousSlide', { label: 'Previous slide', run: () => App.deck.previous(), isEnabled: hasDeck });
        App.commands.define('firstSlide', { label: 'First slide', run: () => App.deck.first(), isEnabled: hasDeck });
        App.commands.define('lastSlide', { label: 'Last slide', run: () => App.deck.last(), isEnabled: hasDeck });

        App.commands.define('removeBlockedRefs', {
            label: 'Remove blocked references',
            isEnabled: hasDeck,
            run: () => {
                let count = 0;
                App.history.change('Remove blocked references', 'deck', () => {
                    count = App.importer.removeRemoteRefs(App.deck.getDocument());
                });
                App.ui.setStatus('Removed ' + count + ' blocked reference' + (count === 1 ? '' : 's'));
            },
        });
    };
})();
