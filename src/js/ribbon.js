/*
 * ribbon.js - the PowerPoint-style ribbon: a File menu and tabs (SPEC 4).
 *
 * Tabs: Home, Insert, Arrange, Slide Show, Export. In Phase 1 only Home has
 * buttons (undo/redo, slide navigation); the other tabs say which phase
 * fills them. Buttons only name a command; commands.js does the work.
 *
 * Talks to: commands.js, icons.js, shortcuts.js (to show key hints in tooltips).
 */

(function () {
    'use strict';

    App.ribbon = {};

    const el = (...args) => App.util.el(...args);

    const TABS = [
        {
            id: 'home', label: 'Home',
            groups: [
                { label: 'Clipboard', commands: [['paste', 'paste'], ['cut', 'cut'], ['copy', 'copy'], ['duplicate', 'duplicate']] },
                { label: 'History', commands: [['undo', 'undo'], ['redo', 'redo']] },
                // Text groups: rows of small buttons (the name shows on hover), as in PowerPoint.
                {
                    label: 'Font',
                    rows: [[{ control: 'fontFamily' }, { control: 'fontSize' }, ['growFont', 'growFont'],
                        ['shrinkFont', 'shrinkFont'], ['clearFormatting', 'clearFormatting']],
                        [['bold', 'bold'], ['italic', 'italic'], ['underline', 'underline'],
                            ['strikethrough', 'strikethrough'], ['superscript', 'superscript'], ['subscript', 'subscript']]],
                },
                {
                    label: 'Paragraph',
                    rows: [[['bullets', 'bullets'], ['numbering', 'numbering'], ['decreaseIndent', 'outdent'],
                        ['increaseIndent', 'indent']],
                    [['restartNumbering', 'restartNumbering'], ['continueNumbering', 'continueNumbering']]],
                },
                { label: 'Slides', commands: [['previousSlide', 'previous'], ['nextSlide', 'next']] },
            ],
            note: 'Click an element to select it, drag to move it, drag a handle to resize (Shift keeps the proportions). ' +
                'Double-click a text box (or press Enter) to type in it; Esc stops typing. The Paragraph buttons work on the selected lines, or on the whole text box.',
        },
        {
            id: 'insert', label: 'Insert',
            groups: [{ label: 'Text', commands: [['insertTextBox', 'textBox']] }],
            note: 'Click Text box, then click on the slide (or drag to set its width). Tables, images, shapes and charts arrive in Phases 4 to 6.',
        },
        {
            id: 'arrange', label: 'Arrange',
            groups: [
                {
                    label: 'Order',
                    commands: [['bringToFront', 'front'], ['bringForward', 'forward'],
                        ['sendBackward', 'backward'], ['sendToBack', 'back']],
                },
            ],
            note: 'Align, distribute, group and rotate arrive in Phase 7.',
        },
        {
            id: 'slideshow', label: 'Slide Show',
            note: 'Presenting from the editor arrives in Phase 8. Saved decks already present on their own: open the saved file in the browser and use the arrow keys (F = full screen).',
        },
        { id: 'export', label: 'Export', note: 'PDF, PNG and PowerPoint export arrive in Phase 8.' },
    ];

    const FILE_MENU = [
        ['newDeck', 'newDeck', ''],
        ['open', 'open', 'Ctrl+O'],
        ['openRecent', 'recent', ''],
        ['save', 'save', 'Ctrl+S'],
        ['saveAs', 'saveAs', 'Ctrl+Shift+S'],
        ['revertToOpened', 'undo', ''],
        ['settings', 'settings', ''],
    ];

    let panel = null;
    let fileMenu = null;
    const buttons = [];   // [{ button, command }] so enabled states can be refreshed

    /* A ribbon button; small ones show only the icon (the name is in the tooltip). */
    function commandButton(command, iconName, small) {
        const keys = App.shortcuts.keysFor(command);
        const button = el('button', {
            type: 'button', class: 'ribbon-button' + (small ? ' small' : ''),
            'aria-label': App.commands.label(command),
            title: App.commands.label(command) + (keys ? ' (' + keys + ')' : ''),
            'data-command': command,
            onclick: () => App.commands.run(command),
        });
        if (App.commands.keepsEdit(command)) {
            // Works on the text being edited: pressing it must not end editing (text.js) or
            // take the focus, and with it the cursor, out of the text.
            button.setAttribute('data-keep-edit', '');
            button.addEventListener('mousedown', (event) => event.preventDefault());
        }
        button.innerHTML = App.icons.get(iconName);
        if (!small) {
            button.appendChild(el('span', { class: 'ribbon-button-label' }, [App.commands.label(command)]));
        }
        buttons.push({ button: button, command: command });
        return button;
    }

    function renderTab(tab) {
        panel.innerHTML = '';
        // Forget the buttons of the tab shown before (the File menu's stay).
        for (let i = buttons.length - 1; i >= 0; i--) {
            if (!buttons[i].button.isConnected) {
                buttons.splice(i, 1);
            }
        }
        (tab.groups || []).forEach((group) => {
            const groupNode = el('div', { class: 'ribbon-group' });
            let buttonsNode;
            if (group.rows) {
                buttonsNode = el('div', { class: 'ribbon-rows' }, group.rows.map((row) =>
                    el('div', { class: 'ribbon-row' }, row.map((item) => (item.control
                        ? App.fontControls.create(item.control) : commandButton(item[0], item[1], true))))));
            } else {
                buttonsNode = el('div', { class: 'ribbon-group-buttons' });
                group.commands.forEach(([command, icon]) => buttonsNode.appendChild(commandButton(command, icon)));
            }
            groupNode.append(buttonsNode, el('div', { class: 'ribbon-group-label' }, [group.label]));
            panel.appendChild(groupNode);
        });
        if (tab.note) {
            panel.appendChild(el('div', { class: 'ribbon-note' }, [tab.note]));
        }
        App.ribbon.refresh();
    }

    function selectTab(tabId) {
        document.querySelectorAll('.ribbon-tab').forEach((tabButton) => {
            const selected = tabButton.getAttribute('data-tab') === tabId;
            tabButton.classList.toggle('selected', selected);
            tabButton.setAttribute('aria-selected', selected ? 'true' : 'false');
        });
        renderTab(TABS.find((tab) => tab.id === tabId));
    }

    function buildFileMenu() {
        fileMenu = el('div', { class: 'menu file-menu', role: 'menu', hidden: true });
        FILE_MENU.forEach(([command, icon, keys]) => {
            const item = el('button', {
                type: 'button', class: 'menu-item', role: 'menuitem', 'data-command': command,
                onclick: () => {
                    closeFileMenu();
                    App.commands.run(command);
                },
            });
            item.innerHTML = App.icons.get(icon);
            item.append(el('span', { class: 'menu-label' }, [App.commands.label(command)]),
                el('span', { class: 'menu-keys' }, [keys]));
            buttons.push({ button: item, command: command });
            fileMenu.appendChild(item);
        });
        document.body.appendChild(fileMenu);
    }

    function openFileMenu(anchor) {
        const rect = anchor.getBoundingClientRect();
        fileMenu.style.left = rect.left + 'px';
        fileMenu.style.top = rect.bottom + 'px';
        fileMenu.hidden = false;
        App.ribbon.refresh();
        fileMenu.querySelector('button:not([disabled])').focus();
    }

    function closeFileMenu() {
        fileMenu.hidden = true;
    }

    App.ribbon.init = function init() {
        const tabRow = document.getElementById('ribbon-tabs');
        panel = document.getElementById('ribbon-panel');

        buildFileMenu();
        const fileButton = el('button', {
            type: 'button', class: 'ribbon-file-button', 'aria-haspopup': 'menu',
            onclick: (event) => {
                event.stopPropagation();   // otherwise the document click below closes it again
                if (fileMenu.hidden) {
                    openFileMenu(fileButton);
                } else {
                    closeFileMenu();
                }
            },
        }, ['File']);
        tabRow.appendChild(fileButton);

        TABS.forEach((tab) => {
            tabRow.appendChild(el('button', {
                type: 'button', class: 'ribbon-tab', role: 'tab', 'data-tab': tab.id,
                onclick: () => selectTab(tab.id),
            }, [tab.label]));
        });

        document.addEventListener('click', (event) => {
            if (!fileMenu.hidden && !fileMenu.contains(event.target)) {
                closeFileMenu();
            }
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && !fileMenu.hidden) {
                closeFileMenu();
            }
        });

        ['deck-loaded', 'history-changed', 'saved', 'selection-changed', 'slide-changed', 'clipboard-changed',
         'recent-changed', 'text-edit-changed', 'text-selection-changed']
            .forEach((name) => App.events.on(name, App.ribbon.refresh));
    };

    App.ribbon.showDefaultTab = function showDefaultTab() {
        selectTab('home');
    };

    /* Grey out buttons whose command cannot run right now (e.g. Undo with nothing to undo);
       toggle buttons (Bullets …) show whether they are on. */
    App.ribbon.refresh = function refresh() {
        buttons.forEach(({ button, command }) => {
            button.disabled = !App.commands.isEnabled(command);
            const checked = App.commands.isChecked(command);
            if (checked !== null) {
                button.setAttribute('aria-pressed', checked ? 'true' : 'false');
            }
        });
        App.fontControls.refresh();
    };
})();
