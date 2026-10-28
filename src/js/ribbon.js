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
                { label: 'History', commands: [['undo', 'undo'], ['redo', 'redo']] },
                { label: 'Slides', commands: [['previousSlide', 'previous'], ['nextSlide', 'next']] },
            ],
            note: 'Click an element to select it, drag to move it, drag a handle to resize (Shift keeps the proportions). Text formatting arrives in Phase 3.',
        },
        { id: 'insert', label: 'Insert', note: 'Text boxes, tables, images, shapes and charts arrive in Phases 3 to 6.' },
        { id: 'arrange', label: 'Arrange', note: 'Align, distribute, group and rotate arrive in Phase 7.' },
        {
            id: 'slideshow', label: 'Slide Show',
            note: 'Presenting from the editor arrives in Phase 8. Saved decks already present on their own: open the saved file in the browser and use the arrow keys (F = full screen).',
        },
        { id: 'export', label: 'Export', note: 'PDF, PNG and PowerPoint export arrive in Phase 8.' },
    ];

    const FILE_MENU = [
        ['newDeck', 'newDeck', ''],
        ['open', 'open', 'Ctrl+O'],
        ['save', 'save', 'Ctrl+S'],
        ['saveAs', 'saveAs', 'Ctrl+Shift+S'],
    ];

    let panel = null;
    let fileMenu = null;
    const buttons = [];   // [{ button, command }] so enabled states can be refreshed

    function shortcutFor(command) {
        const entry = App.shortcuts.DEFAULTS.find((item) => item[1] === command);
        return entry ? entry[0] : '';
    }

    function commandButton(command, iconName, extraClass) {
        const keys = shortcutFor(command);
        const button = el('button', {
            type: 'button', class: 'ribbon-button ' + (extraClass || ''),
            title: App.commands.label(command) + (keys ? ' (' + keys + ')' : ''),
            'data-command': command,
            onclick: () => App.commands.run(command),
        });
        button.innerHTML = App.icons.get(iconName);
        button.appendChild(el('span', { class: 'ribbon-button-label' }, [App.commands.label(command)]));
        buttons.push({ button: button, command: command });
        return button;
    }

    function renderTab(tab) {
        panel.innerHTML = '';
        (tab.groups || []).forEach((group) => {
            const groupNode = el('div', { class: 'ribbon-group' });
            const row = el('div', { class: 'ribbon-group-buttons' });
            group.commands.forEach(([command, icon]) => row.appendChild(commandButton(command, icon)));
            groupNode.append(row, el('div', { class: 'ribbon-group-label' }, [group.label]));
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
        fileMenu = el('div', { class: 'file-menu', role: 'menu', hidden: true });
        FILE_MENU.forEach(([command, icon, keys]) => {
            const item = el('button', {
                type: 'button', class: 'file-menu-item', role: 'menuitem', 'data-command': command,
                onclick: () => {
                    closeFileMenu();
                    App.commands.run(command);
                },
            });
            item.innerHTML = App.icons.get(icon);
            item.append(el('span', { class: 'file-menu-label' }, [App.commands.label(command)]),
                el('span', { class: 'file-menu-keys' }, [keys]));
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

        ['deck-loaded', 'history-changed', 'saved'].forEach((name) => App.events.on(name, App.ribbon.refresh));
    };

    App.ribbon.showDefaultTab = function showDefaultTab() {
        selectTab('home');
    };

    /* Grey out buttons whose command cannot run right now (e.g. Undo with nothing to undo). */
    App.ribbon.refresh = function refresh() {
        buttons.forEach(({ button, command }) => {
            button.disabled = !App.commands.isEnabled(command);
        });
    };
})();
