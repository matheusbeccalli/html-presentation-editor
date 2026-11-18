/*
 * help.js - the Help tab: the keyboard shortcut cheat sheet (press ?) and the
 * About / Licenses window (SPEC Phase 9, 2.2).
 *
 * The cheat sheet is built from the shortcut table itself (shortcuts.js), so a
 * shortcut added there shows up here without anyone remembering to; every
 * command is put under a section by SECTIONS (a test fails when one is left
 * over). Keys that are handled elsewhere - while typing in text or a table
 * cell, during the slide show, with the mouse - are listed by hand in EXTRA.
 *
 * ? opens the sheet (also typed with AltGr, which Windows reports as Ctrl+Alt,
 * as on Brazilian keyboards); typing a ? into a text box types it.
 *
 * About lists every library copied into the editor (vendor/README.md), with
 * its version, license, source, SHA-256, full license text and the libraries
 * bundled inside it. build.py writes that list into the page as JSON
 * (<script type="application/json" id="about-data">), so it always matches
 * what was really built in.
 *
 * Talks to: shortcuts.js (the table), commands.js (labels), dialogs.js.
 */

(function () {
    'use strict';

    App.help = {};

    const el = (...args) => App.util.el(...args);

    // Which section each shortcut command goes under, in the order shown; the words where the command's
    // own label would be unclear out of context.
    const SECTIONS = [
        { title: 'File', commands: { open: 'Open a deck', save: 'Save', saveAs: 'Save As', exportPdf: 'Print / PDF' } },
        {
            title: 'Edit', commands: {
                undo: 'Undo', redo: 'Redo', cut: 'Cut', copy: 'Copy', paste: 'Paste', duplicate: 'Duplicate',
                delete: 'Delete the selection', selectAll: 'Select everything on the slide', deselect: 'Deselect / leave the text',
                find: 'Find', replace: 'Replace', contextMenu: 'Menu of the selection',
            },
        },
        {
            title: 'Move and arrange', commands: {
                nudgeLeft: 'Move 1 px left', nudgeRight: 'Move 1 px right', nudgeUp: 'Move 1 px up', nudgeDown: 'Move 1 px down',
                nudgeLeftFar: 'Move 10 px left', nudgeRightFar: 'Move 10 px right', nudgeUpFar: 'Move 10 px up',
                nudgeDownFar: 'Move 10 px down', group: 'Group', ungroup: 'Ungroup',
            },
        },
        {
            title: 'Text', commands: {
                editText: 'Type in the selected box', bold: 'Bold', italic: 'Italic', underline: 'Underline',
                alignLeft: 'Align left', alignCenter: 'Centre', alignRight: 'Align right', alignJustify: 'Justify',
                growFont: 'Bigger text', shrinkFont: 'Smaller text', cycleCase: 'Change case (lower, UPPER, Each Word)',
            },
        },
        { title: 'Tables', commands: {} },
        {
            title: 'Slides', commands: {
                newSlide: 'New slide', nextSlide: 'Next slide', previousSlide: 'Previous slide',
                firstSlide: 'First slide', lastSlide: 'Last slide',
            },
        },
        {
            title: 'Slide show', commands: {
                slideShowFromStart: 'From the beginning', slideShowFromCurrent: 'From this slide', presenterView: 'Presenter view',
            },
        },
        { title: 'Review', commands: { newComment: 'New comment' } },
        { title: 'View', commands: { toggleGridlines: 'Gridlines on / off' } },
        { title: 'Mouse', commands: {} },
        { title: 'Help', commands: { shortcuts: 'This list of shortcuts' } },
    ];

    // Keys handled outside the shortcut table: [section, keys, what they do].
    const EXTRA = [
        ['Text', 'Tab / Shift+Tab', 'At the start of a line or on several lines: indent / outdent the bullets'],
        ['Text', 'Alt+Shift+→ / Alt+Shift+←', 'Indent / outdent the bullets'],
        ['Text', 'Enter', 'New paragraph (on an empty bullet: ends the list or goes up a level)'],
        ['Text', 'Backspace', 'At the start of a bullet: removes the bullet or goes up a level'],
        ['Text', 'Ctrl+Shift+V', 'Paste as plain text (the look of the place you paste into)'],
        ['Text', 'Esc', 'Stop typing; the box stays selected'],
        ['Tables', 'Tab / Shift+Tab', 'Next / previous cell while typing in a table'],
        ['Tables', 'Delete', 'Clear the selected cells'],
        ['Slide show', '→ ↓ Space Enter Page Down N, or a click', 'Next slide'],
        ['Slide show', '← ↑ Backspace Page Up P', 'Previous slide'],
        ['Slide show', 'a number, then Enter', 'Go to that slide'],
        ['Slide show', 'Home / End', 'First / last slide'],
        ['Slide show', 'B or .', 'Black screen (again: back)'],
        ['Slide show', 'Esc', 'End the show'],
        ['Review', 'Ctrl+Enter', 'In the Comments pane: post the comment, keep an edit'],
        ['Review', 'Esc', 'In the Comments pane: drop the comment or the edit'],
        ['View', 'Ctrl+mouse wheel', 'Zoom in / out around the mouse'],
        ['Mouse', 'Shift+click or Ctrl+click', 'Add to the selection or take out of it'],
        ['Mouse', 'Double-click', 'Type in a text box, a shape or a table; on an empty spot: a new text box'],
        ['Mouse', 'Shift while resizing', 'Keep the proportions'],
        ['Mouse', 'Shift while turning', 'Turn in steps of 15°'],
        ['Mouse', 'Shift while drawing a line', 'Lines in steps of 45°'],
        ['Mouse', 'Alt while dragging', 'No snapping to the smart guides'],
        ['Mouse', 'Right-click', 'Menu of what is under the mouse'],
    ];

    /*
     * The cheat sheet from a shortcut list (registry.list()): [{ title, rows: [{ keys: [...], label }] }].
     * Every command gets one row with all its keys; a command no section names goes under "Other".
     */
    App.help.shortcutSections = function shortcutSections(entries) {
        const byCommand = new Map();
        entries.forEach((entry) => {
            if (!byCommand.has(entry.command)) {
                byCommand.set(entry.command, []);
            }
            byCommand.get(entry.command).push(entry.combo);
        });
        const used = new Set();
        const sections = SECTIONS.map((section) => {
            const rows = Object.keys(section.commands).filter((name) => byCommand.has(name)).map((name) => {
                used.add(name);
                return { keys: byCommand.get(name), label: section.commands[name] };
            });
            EXTRA.filter((extra) => extra[0] === section.title).forEach((extra) => rows.push({ keys: [extra[1]], label: extra[2] }));
            return { title: section.title, rows: rows };
        });
        const other = Array.from(byCommand.keys()).filter((name) => !used.has(name))
            .map((name) => ({ keys: byCommand.get(name), label: App.commands.label(name) }));
        if (other.length) {
            sections.push({ title: 'Other', rows: other });
        }
        return sections.filter((section) => section.rows.length);
    };

    /* The sections with only the rows whose keys or words hold `text` (any case); empty sections dropped. */
    App.help.filterSections = function filterSections(sections, text) {
        const wanted = String(text || '').trim().toLowerCase();
        if (!wanted) {
            return sections;
        }
        return sections.map((section) => ({
            title: section.title,
            rows: section.rows.filter((row) => (row.label + ' ' + row.keys.join(' ') + ' ' + row.keys.map(App.help.keyText).join(' ') +
                ' ' + section.title).toLowerCase().includes(wanted)),
        })).filter((section) => section.rows.length);
    };

    const KEY_NAMES = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Escape: 'Esc', ContextMenu: 'Menu key' };

    /* A combo as the sheet writes it: "Shift+ArrowLeft" -> "Shift+←", "Escape" -> "Esc". */
    App.help.keyText = function keyText(combo) {
        return combo.split(/\+(?=.)/).map((part) => KEY_NAMES[part] || part).join('+');
    };

    function keyCaps(keys) {
        // "Ctrl+Shift+S" -> <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd>; free text (Mouse, slide show) stays text.
        if (/\s/.test(keys)) {
            return [el('span', { class: 'shortcut-words' }, [keys])];
        }
        const parts = [];
        App.help.keyText(keys).split(/\+(?=.)/).forEach((part, index) => {
            if (index) {
                parts.push('+');
            }
            parts.push(el('kbd', {}, [part]));
        });
        return parts;
    }

    function drawSections(list, sections) {
        list.replaceChildren(...sections.map((section) => el('section', { class: 'shortcut-section' }, [
            el('h3', {}, [section.title]),
            el('table', { class: 'shortcut-table' }, [el('tbody', {}, section.rows.map((row) => el('tr', {}, [
                el('td', { class: 'shortcut-keys' }, [].concat(...row.keys.map((keys, i) =>
                    (i ? [el('span', { class: 'shortcut-or' }, [' or '])] : []).concat(keyCaps(keys))))),
                el('td', { class: 'shortcut-label' }, [row.label]),
            ])))]),
        ])));
        if (!sections.length) {
            list.appendChild(el('p', { class: 'panel-hint' }, ['No shortcut matches.']));
        }
    }

    /* Help > Keyboard Shortcuts, or ?: the sheet, with a box to filter it. */
    App.help.openShortcuts = function openShortcuts() {
        if (document.querySelector('dialog[open] .shortcut-sheet')) {
            return Promise.resolve();
        }
        const sections = App.help.shortcutSections(App.shortcuts.registry.list());
        const filter = el('input', {
            type: 'text', id: 'shortcut-filter', placeholder: 'Filter: a word or a key (e.g. bold, Ctrl+S)',
            'aria-label': 'Filter the shortcuts', autocomplete: 'off', spellcheck: 'false',
        });
        const list = el('div', { class: 'shortcut-list' });
        filter.addEventListener('input', () => drawSections(list, App.help.filterSections(sections, filter.value)));
        drawSections(list, sections);
        const shown = App.dialogs.show({
            title: 'Keyboard shortcuts',
            body: el('div', { class: 'shortcut-sheet' }, [filter, list]),
            buttons: [{ label: 'Close', value: true, primary: true }],
            className: 'dialog-shortcuts',
        });
        filter.focus();
        return shown;
    };

    // ---------------------------------------------------------------
    // About / Licenses
    // ---------------------------------------------------------------

    /* The About data build.py put in the page: { libraries: [...] } (empty when absent, e.g. in tests). */
    App.help.aboutData = function aboutData(doc) {
        const node = (doc || document).getElementById('about-data');
        try {
            return node ? JSON.parse(node.textContent) : { libraries: [] };
        } catch (error) {
            return { libraries: [] };
        }
    };

    App.help.libraryLine = function libraryLine(lib) {
        return lib.name + ' ' + lib.version + ' · ' + lib.license;
    };

    App.help.bundledLine = function bundledLine(lib) {
        return (lib.bundled || []).length
            // A version vendor/README.md gives as "as in JSZip 3.10.1" (not stated in the bundle) is left out here.
            ? 'Includes: ' + lib.bundled.map((inner) => inner.name + (/^\d/.test(inner.version) ? ' ' + inner.version : '') +
                ' (' + inner.license + ')').join(', ')
            : '';
    };

    /* Help > About: what this editor is, that it works offline, and every library in it with its license. */
    App.help.openAbout = function openAbout() {
        const data = App.help.aboutData();
        const libraries = data.libraries.map((lib) => el('section', { class: 'about-library' }, [
            el('h3', {}, [App.help.libraryLine(lib)]),
            App.help.bundledLine(lib) ? el('p', { class: 'about-bundled' }, [App.help.bundledLine(lib)]) : '',
            el('p', { class: 'about-source' }, ['Source: ', el('span', { class: 'about-url' }, [lib.url])]),
            el('p', { class: 'about-source' }, ['SHA-256: ', el('code', {}, [lib.sha256])]),
            el('details', { class: 'about-license' }, [
                el('summary', {}, ['License text']),
                el('pre', {}, [lib.licenseText]),
            ]),
        ]));
        const body = el('div', { class: 'about' }, [
            el('p', {}, ['Deck Editor: edit HTML presentations on this computer.']),
            el('p', { class: 'panel-hint' }, ['One file with everything inside it. The browser blocks all network access for this page ' +
                '(Content-Security-Policy), so nothing you open or type leaves the computer.']),
            el('h2', { class: 'about-heading' }, ['Open-source code inside']),
            libraries.length ? el('div', {}, libraries) : el('p', {}, ['None.']),
            el('p', { class: 'panel-hint' }, ['Each library is copied into the editor with its license (MIT and similar permissive licenses only); ' +
                'the list and the files\' SHA-256 are in vendor/README.md.']),
        ]);
        return App.dialogs.show({ title: 'About Deck Editor', body: body, wide: true,
            buttons: [{ label: 'Close', value: true, primary: true }] });
    };
})();
