/*
 * contextmenu.js - the right-click menu on the slide (SPEC 4, Phase 2), and on the
 * slide rail (openWith: New / Duplicate / Delete Slide, Phase 7, thumbnails.js).
 *
 * Right-click on an element: it is selected (selection.js does that on
 * pointerdown) and the menu lists the element actions. Right-click on empty
 * slide: only Paste. Shift+F10 or the Menu key opens it for the selection,
 * like PowerPoint. The items only name commands (commands.js), so they behave
 * exactly like the same action from the ribbon or the keyboard.
 *
 * Keyboard inside the menu: Up/Down move, Enter runs, Esc or Tab closes.
 *
 * Talks to: commands.js, shortcuts.js (key hints), selection.js, canvas.js.
 */

(function () {
    'use strict';

    App.contextMenu = {};

    const ELEMENT_ITEMS = ['cut', 'copy', 'paste', 'duplicate', 'delete', '-',
        'bringToFront', 'bringForward', 'sendBackward', 'sendToBack', '-', 'group', 'ungroup'];
    const PICTURE_ITEMS = ELEMENT_ITEMS.concat(['-', 'changePicture']);
    const EMPTY_SLIDE_ITEMS = ['paste'];

    let menu = null;

    App.contextMenu.init = function init() {
        // tabindex -1: the menu itself can hold the keyboard focus when no item is enabled.
        menu = App.util.el('div', { class: 'menu context-menu', role: 'menu', tabindex: '-1', hidden: true });
        menu.addEventListener('keydown', onMenuKey);
        document.body.appendChild(menu);

        const overlay = document.getElementById('overlay');
        overlay.addEventListener('contextmenu', (event) => {
            event.preventDefault();   // our menu instead of the browser's
            App.contextMenu.open(event.clientX, event.clientY);
        });

        // Anything else the user does closes the menu.
        document.addEventListener('pointerdown', (event) => {
            if (!menu.hidden && !menu.contains(event.target)) {
                App.contextMenu.close();
            }
        }, true);
        window.addEventListener('blur', () => App.contextMenu.close());
        window.addEventListener('resize', () => App.contextMenu.close());
        ['slide-changed', 'deck-loaded', 'zoom-changed'].forEach((name) => App.events.on(name, () => App.contextMenu.close()));
    };

    App.contextMenu.isOpen = function isOpen() {
        return !!menu && !menu.hidden;
    };

    /* Open the menu with its top-left corner at screen point (x, y). */
    App.contextMenu.open = function open(x, y) {
        const items = App.selection.count() === 0 ? EMPTY_SLIDE_ITEMS : App.images.isPictureSelected() ? PICTURE_ITEMS : ELEMENT_ITEMS;
        App.contextMenu.openWith(items, x, y);
    };

    /* Open the menu listing `commands` ('-' = a line) at screen point (x, y); the slide rail's menu. */
    App.contextMenu.openWith = function openWith(commands, x, y) {
        menu.innerHTML = '';
        commands.forEach((command) => menu.appendChild(command === '-' ? separator() : item(command)));
        menu.hidden = false;
        placeInsideWindow(x, y);
        const first = enabledItems()[0];
        (first || menu).focus();   // keys (Esc, arrows) must reach the menu either way
    };

    /* Shift+F10 / Menu key: open at the middle of the selected element (or of the slide). */
    App.contextMenu.openForSelection = function openForSelection() {
        const overlayRect = document.getElementById('overlay').getBoundingClientRect();
        const zoom = App.canvas.getZoom();
        const rect = App.transform.boundsOf(App.selection.getElements().map(App.transform.readRect)) ||
            { left: 0, top: 0, width: 1280, height: 720 };
        App.contextMenu.open(overlayRect.left + (rect.left + rect.width / 2) * zoom,
            overlayRect.top + (rect.top + rect.height / 2) * zoom);
    };

    App.contextMenu.close = function close() {
        if (menu && !menu.hidden) {
            menu.hidden = true;
            menu.innerHTML = '';
        }
    };

    function item(command) {
        const button = App.util.el('button', {
            type: 'button', class: 'menu-item', role: 'menuitem', 'data-command': command,
            disabled: !App.commands.isEnabled(command),
            onclick: () => {
                App.contextMenu.close();
                App.commands.run(command);
            },
        });
        // A toggle (Hide Slide) shows a tick while it is on.
        const checked = App.commands.isChecked(command);
        if (checked !== null) {
            button.setAttribute('role', 'menuitemcheckbox');
            button.setAttribute('aria-checked', checked ? 'true' : 'false');
        }
        button.append(App.util.el('span', { class: 'menu-label' }, [App.commands.label(command)]),
            App.util.el('span', { class: 'menu-keys' }, [App.shortcuts.keysFor(command)]));
        return button;
    }

    function separator() {
        return App.util.el('div', { class: 'menu-separator', role: 'separator' });
    }

    function enabledItems() {
        return Array.from(menu.querySelectorAll('.menu-item:not(:disabled)'));
    }

    // Open below-right of the mouse, but flip/shift so the menu never leaves the window.
    function placeInsideWindow(x, y) {
        const width = menu.offsetWidth;
        const height = menu.offsetHeight;
        const left = x + width > window.innerWidth ? Math.max(0, x - width) : x;
        const top = y + height > window.innerHeight ? Math.max(0, y - height) : y;
        menu.style.left = left + 'px';
        menu.style.top = top + 'px';
    }

    function onMenuKey(event) {
        const items = enabledItems();
        const index = items.indexOf(document.activeElement);
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            const step = event.key === 'ArrowDown' ? 1 : -1;
            const next = items[(index + step + items.length) % items.length];
            if (next) {
                next.focus();
            }
        } else if (event.key === 'Escape' || event.key === 'Tab') {
            App.contextMenu.close();
        } else {
            return;   // Enter / Space: the focused button clicks itself
        }
        // Keys used by the menu must not also reach the editor's shortcuts (Escape would deselect).
        event.preventDefault();
        event.stopPropagation();
    }
})();
