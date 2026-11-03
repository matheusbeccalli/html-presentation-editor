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

    const registry = new Map();   // name -> { label, run, isEnabled, isChecked, keepsEdit }

    /*
     * definition: { label, run, isEnabled?, isChecked?, keepsEdit? }. isChecked
     * makes a toggle button (shown "on" when it returns true); keepsEdit marks a
     * command that works on the text being edited, so its button does not end
     * text editing or take the cursor out of the text.
     */
    App.commands.define = function define(name, definition) {
        registry.set(name, {
            label: definition.label,
            run: definition.run,
            isEnabled: definition.isEnabled || (() => true),
            isChecked: definition.isChecked || null,
            keepsEdit: !!definition.keepsEdit,
        });
    };

    App.commands.isEnabled = function isEnabled(name) {
        const command = registry.get(name);
        return !!command && command.isEnabled();
    };

    /* true / false for a toggle command, null for a plain one. */
    App.commands.isChecked = function isChecked(name) {
        const command = registry.get(name);
        return command && command.isChecked ? !!command.isChecked() : null;
    };

    App.commands.keepsEdit = function keepsEdit(name) {
        const command = registry.get(name);
        return !!command && command.keepsEdit;
    };

    App.commands.label = function label(name) {
        const command = registry.get(name);
        return command ? command.label : name;
    };

    /*
     * Run a command by name. Commands may be async (open, save); any error
     * ends up in one dialog instead of failing silently.
     */
    App.commands.run = function run(name, value) {
        const command = registry.get(name);
        if (!command) {
            throw new Error('Unknown command: ' + name);
        }
        if (!command.isEnabled()) {
            return Promise.resolve();
        }
        return Promise.resolve()
            .then(() => command.run(value))
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
        App.commands.define('openRecent', {
            label: 'Open recent…', run: () => App.recent.openDialog(), isEnabled: () => App.recent.hasEntries(),
        });
        App.commands.define('settings', { label: 'Settings…', run: () => App.settings.openDialog() });
        App.commands.define('save', { label: 'Save', run: () => App.fileio.save(), isEnabled: hasDeck });
        App.commands.define('saveAs', { label: 'Save As…', run: () => App.fileio.saveAs(), isEnabled: hasDeck });

        App.commands.define('revertToOpened', {
            label: 'Revert to version opened',
            isEnabled: () => hasDeck() && !!App.state.openedHtml,
            run: async () => {
                const ok = await App.dialogs.confirm({
                    title: 'Revert to the version opened?',
                    message: 'The deck goes back to how it was when you opened it in this session, even if ' +
                        'AutoSave has already written newer changes to the file. You can undo this with Ctrl+Z.',
                    ok: 'Revert', danger: true,
                });
                if (!ok) {
                    return;
                }
                App.selection.clear();
                App.history.change('Revert to version opened', 'deck', () => App.deck.replaceContent(App.state.openedHtml));
                App.ui.setStatus('Reverted to the version opened');
            },
        });

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

        // ---- Text (text.js) ----
        // Enter / F2: type in the selected text box, or in the first cell of the selected table.
        const textToEdit = () => {
            const element = App.selection.getElement();
            const type = element && element.getAttribute('data-type');
            return type === 'text' ? element : type === 'table' ? App.tables.firstCell(element) : null;
        };
        App.commands.define('editText', {
            label: 'Edit text', isEnabled: () => !!textToEdit() && !App.text.isEditing(),
            run: () => App.text.enterEdit(textToEdit(), { caret: 'end' }),
        });
        // Character formatting (Home > Font): the selected text, or all the text of a selected box.
        [['bold', 'Bold'], ['italic', 'Italic'], ['underline', 'Underline'], ['strikethrough', 'Strikethrough'],
         ['superscript', 'Superscript'], ['subscript', 'Subscript']].forEach(([name, label]) => {
            App.commands.define(name, {
                label: label, keepsEdit: true, run: () => App.text.applyStyle(name),
                isEnabled: () => App.text.canStyle(),
                isChecked: () => !!App.text.currentStyleState()[name],
            });
        });
        // The font list and size box pass the chosen value (textcontrols.js).
        App.commands.define('setFontFamily', {
            label: 'Font', keepsEdit: true, run: (value) => App.text.applyStyle('font-family', value),
            isEnabled: () => App.text.canStyle(),
        });
        App.commands.define('setFontSize', {
            label: 'Font size', keepsEdit: true, run: (value) => App.text.applyStyle('font-size', value),
            isEnabled: () => App.text.canStyle(),
        });
        // Font color / Highlight: the split button applies its current colour, its list a chosen one.
        App.commands.define('fontColor', {
            label: 'Font color', keepsEdit: true, isEnabled: () => App.text.canStyle(),
            run: () => App.text.applyStyle('color', App.textControls.currentColor('color')),
        });
        App.commands.define('setFontColor', {
            label: 'Font color', keepsEdit: true, run: (value) => App.text.applyStyle('color', value),
            isEnabled: () => App.text.canStyle(),
        });
        App.commands.define('highlight', {
            label: 'Text highlight color', keepsEdit: true, isEnabled: () => App.text.canStyle(),
            run: () => App.text.applyStyle('background-color', App.textControls.currentColor('background-color')),
        });
        App.commands.define('setHighlight', {
            label: 'Text highlight color', keepsEdit: true, run: (value) => App.text.applyStyle('background-color', value),
            isEnabled: () => App.text.canStyle(),
        });
        App.commands.define('growFont', {
            label: 'Increase font size', keepsEdit: true, run: () => App.text.applyStyle('grow'),
            isEnabled: () => App.text.canStyle(),
        });
        App.commands.define('shrinkFont', {
            label: 'Decrease font size', keepsEdit: true, run: () => App.text.applyStyle('shrink'),
            isEnabled: () => App.text.canStyle(),
        });
        App.commands.define('clearFormatting', {
            label: 'Clear formatting', keepsEdit: true, run: () => App.text.applyStyle('clear'),
            isEnabled: () => App.text.canStyle(),
        });
        // Paragraph formatting (Home > Paragraph): alignment works like radio buttons.
        [['alignLeft', 'Align left', 'left'], ['alignCenter', 'Center', 'center'], ['alignRight', 'Align right', 'right'],
         ['alignJustify', 'Justify', 'justify']].forEach(([name, label, align]) => {
            App.commands.define(name, {
                label: label, keepsEdit: true, run: () => App.text.applyParagraph('text-align', align),
                isEnabled: () => App.text.canStyle(),
                isChecked: () => App.text.currentParagraphState().align === align,
            });
        });
        // The line spacing list passes the CSS value (textcontrols.js).
        [['setLineSpacing', 'Line spacing', 'line-height'], ['setSpaceBefore', 'Space before', 'margin-top'],
         ['setSpaceAfter', 'Space after', 'margin-bottom']].forEach(([name, label, property]) => {
            App.commands.define(name, {
                label: label, keepsEdit: true, run: (value) => App.text.applyParagraph(property, value),
                isEnabled: () => App.text.canStyle(),
            });
        });
        // The list buttons (Home > Paragraph): the selected lines, or every line of a selected box.
        [['bullets', 'Bullets', 'bullet', () => App.text.toggleList('bullet')],
         ['numbering', 'Numbering', 'number', () => App.text.toggleList('number')],
         ['decreaseIndent', 'Decrease indent', 'outdent', () => App.text.setLevel(-1)],
         ['increaseIndent', 'Increase indent', 'indent', () => App.text.setLevel(1)],
         ['restartNumbering', 'Restart numbering', 'restart', () => App.text.setNumbering('restart')],
         ['continueNumbering', 'Continue numbering', 'continue', () => App.text.setNumbering('continue')]]
            .forEach(([name, label, list, run]) => {
                App.commands.define(name, {
                    label: label, run: run, keepsEdit: true,
                    isEnabled: () => App.text.canRunList(list),
                    isChecked: list === 'bullet' || list === 'number' ? () => App.text.currentListState()[list] : null,
                });
            });
        App.commands.define('insertTextBox', {
            label: 'Text box', isEnabled: hasDeck,
            run: () => {
                App.text.exitEdit({ select: false });
                App.selection.clear();
                App.selection.armInsert((spot) => App.elements.insertTextBox(spot));
                App.ui.setStatus('Click on the slide to place the text box, or drag to set its width (Esc cancels)');
            },
        });
        // Table > Layout (tablecontrols.js): the selected cells, or the cell being typed in.
        ['insertRowAbove', 'insertRowBelow', 'insertColumnLeft', 'insertColumnRight', 'deleteRows', 'deleteColumns',
         'deleteTable', 'mergeCells', 'splitCells'].forEach((name) => {
            App.commands.define(name, {
                label: App.tableControls.layoutLabel(name), keepsEdit: true,
                isEnabled: () => App.tableControls.canLayout(name),
                run: () => App.tableControls.layout(name),
            });
        });
        // Table Design and Layout > Alignment (tabledesign.js): the selected cells, the cell typed in, or the whole table.
        const design = App.tableDesign.commands();
        Object.keys(design).forEach((name) => App.commands.define(name, design[name]));
        // Insert > Table: the grid picker (tablecontrols.js) passes the size it picked.
        App.commands.define('insertTable', {
            label: 'Table', isEnabled: hasDeck,
            run: (size) => {
                if (!size) {
                    return;
                }
                App.text.exitEdit({ select: false });
                App.elements.insertTable(size.rows, size.cols);
            },
        });
        // Format painter: a click picks up a look for one use; a double-click (formatPainterLocked) keeps it on.
        App.commands.define('formatPainter', {
            label: 'Format painter', keepsEdit: true,
            isEnabled: () => App.text.isPainting() || App.text.canStyle(),
            isChecked: () => App.text.isPainting(),
            run: () => (App.text.isPainting() ? App.text.stopPainter() : App.text.startPainter(false)),
        });
        App.commands.define('formatPainterLocked', {
            label: 'Format painter (stays on)', keepsEdit: true,
            isEnabled: () => App.text.isPainting() || App.text.canStyle(),
            run: () => {
                App.text.stopPainter();
                App.text.startPainter(true);
            },
        });
        // Find & replace across all slides (findreplace.js); the panel keeps typing in the text going.
        App.commands.define('find', { label: 'Find', keepsEdit: true, isEnabled: hasDeck, run: () => App.findReplace.open('find') });
        App.commands.define('replace', {
            label: 'Replace', keepsEdit: true, isEnabled: hasDeck, run: () => App.findReplace.open('replace'),
        });
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

        App.commands.define('contextMenu', {
            label: 'Show menu', isEnabled: () => App.state.hasDeck, run: () => App.contextMenu.openForSelection(),
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
