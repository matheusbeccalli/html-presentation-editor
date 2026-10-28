/*
 * commands.js - every action the user can trigger, in one list.
 *
 * A command has a name ('save'), a label for menus and a function. The
 * ribbon, menus and keyboard shortcuts all call App.commands.run(name), so an
 * action behaves the same however it is started, and errors are shown in one
 * consistent way.
 *
 * Talks to: fileio.js, history.js, deck.js, importer.js, selection.js, elements.js (the actions),
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

        // ---- Selected element (elements.js) ----
        const hasSelection = () => App.elements.hasSelection();
        [['Left', -1, 0], ['Right', 1, 0], ['Up', 0, -1], ['Down', 0, 1]].forEach(([name, dx, dy]) => {
            App.commands.define('nudge' + name, {
                label: 'Nudge ' + name.toLowerCase(), isEnabled: hasSelection, run: () => App.elements.nudge(dx, dy),
            });
            App.commands.define('nudge' + name + 'Far', {
                label: 'Nudge ' + name.toLowerCase() + ' 10 px', isEnabled: hasSelection,
                run: () => App.elements.nudge(dx * 10, dy * 10),
            });
        });
        App.commands.define('delete', { label: 'Delete', isEnabled: hasSelection, run: () => App.elements.remove() });
        App.commands.define('cut', { label: 'Cut', isEnabled: hasSelection, run: () => App.elements.cut() });
        App.commands.define('copy', { label: 'Copy', isEnabled: hasSelection, run: () => App.elements.copy() });
        App.commands.define('paste', { label: 'Paste', isEnabled: () => App.elements.canPaste(), run: () => App.elements.paste() });
        App.commands.define('duplicate', { label: 'Duplicate', isEnabled: hasSelection, run: () => App.elements.duplicate() });
        [['bringToFront', 'Bring to front', 'front'], ['bringForward', 'Bring forward', 'forward'],
         ['sendBackward', 'Send backward', 'backward'], ['sendToBack', 'Send to back', 'back']]
            .forEach(([name, label, action]) => {
                App.commands.define(name, {
                    label: label, isEnabled: () => App.elements.canArrange(action), run: () => App.elements.arrange(action),
                });
            });

        App.commands.define('deselect', {
            label: 'Deselect',
            isEnabled: () => !!App.selection.selectedId(),
            run: () => App.selection.clear(),
        });

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
