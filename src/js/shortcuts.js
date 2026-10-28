/*
 * shortcuts.js - the one place that maps keys to actions (SPEC 4, Phase 1).
 *
 * A shortcut maps a key combination such as "Ctrl+S" to a command name such
 * as "save". The command itself lives in commands.js, so the same command can
 * be run from the ribbon, a menu or the keyboard.
 *
 * Rule: shortcuts are ignored while the user types in a text field, unless the
 * shortcut is registered with { whileTyping: true } (formatting keys like
 * Ctrl+B in Phase 3, and Save, which should work even mid-sentence).
 *
 * Talks to: commands.js (runs commands), deck.js (listens to the deck iframe,
 * because key presses inside an iframe do not reach the main window).
 */

(function () {
    'use strict';

    App.shortcuts = {};

    const MODIFIER_ORDER = ['Ctrl', 'Alt', 'Shift'];

    // Friendly names for keys whose `event.key` value is awkward to type.
    const KEY_ALIASES = {
        ' ': 'Space', space: 'Space', spacebar: 'Space',
        esc: 'Escape', escape: 'Escape', del: 'Delete', delete: 'Delete',
        pageup: 'PageUp', pagedown: 'PageDown', home: 'Home', end: 'End',
        arrowleft: 'ArrowLeft', arrowright: 'ArrowRight', arrowup: 'ArrowUp', arrowdown: 'ArrowDown',
        enter: 'Enter', tab: 'Tab', backspace: 'Backspace',
    };

    function normalizeKeyName(key) {
        const alias = KEY_ALIASES[key.toLowerCase()] || KEY_ALIASES[key];
        if (alias) {
            return alias;
        }
        if (key.length === 1) {
            return key.toUpperCase();          // "s" -> "S"
        }
        if (/^f\d{1,2}$/i.test(key)) {
            return key.toUpperCase();          // "f5" -> "F5"
        }
        return key;
    }

    // A printable symbol such as "?" already implies Shift, so "Shift+?" is written "?".
    function isSymbolKey(keyName) {
        return keyName.length === 1 && !/[A-Z0-9]/.test(keyName);
    }

    function buildCombo(modifiers, keyName) {
        const used = MODIFIER_ORDER.filter((mod) => modifiers.has(mod));
        const withoutShift = isSymbolKey(keyName) ? used.filter((mod) => mod !== 'Shift') : used;
        return withoutShift.concat([keyName]).join('+');
    }

    /* "shift+ctrl+s" -> "Ctrl+Shift+S" (the fixed spelling used as the registry key). */
    App.shortcuts.normalizeCombo = function normalizeCombo(text) {
        const parts = text.split('+');
        const keyName = normalizeKeyName(parts.pop());
        const modifiers = new Set(parts.map((p) => {
            const lower = p.toLowerCase();
            if (lower === 'cmd' || lower === 'meta' || lower === 'control') {
                return 'Ctrl';
            }
            return lower.charAt(0).toUpperCase() + lower.slice(1);
        }));
        return buildCombo(modifiers, keyName);
    };

    /* Turn a KeyboardEvent into the same spelling, e.g. Ctrl+Shift+S. Cmd counts as Ctrl. */
    App.shortcuts.comboFromEvent = function comboFromEvent(event) {
        const modifiers = new Set();
        if (event.ctrlKey || event.metaKey) {
            modifiers.add('Ctrl');
        }
        if (event.altKey) {
            modifiers.add('Alt');
        }
        if (event.shiftKey) {
            modifiers.add('Shift');
        }
        return buildCombo(modifiers, normalizeKeyName(event.key));
    };

    const TEXT_INPUT_TYPES = ['text', 'search', 'email', 'number', 'password', 'tel', 'url', ''];

    /* True when the element is somewhere the user types text. */
    App.shortcuts.isTypingTarget = function isTypingTarget(element) {
        if (!element || !element.tagName) {
            return false;
        }
        const tag = element.tagName.toLowerCase();
        if (tag === 'textarea' || tag === 'select') {
            return true;
        }
        if (tag === 'input') {
            return TEXT_INPUT_TYPES.indexOf((element.getAttribute('type') || '').toLowerCase()) !== -1;
        }
        return element.isContentEditable === true || element.getAttribute('contenteditable') === 'true';
    };

    /*
     * Create a registry. App.shortcuts.registry is the editor's real one; tests
     * create their own so they do not interfere with it.
     */
    App.shortcuts.createRegistry = function createRegistry() {
        const entries = new Map();   // combo -> { combo, command, whileTyping }

        function register(combo, command, options) {
            const key = App.shortcuts.normalizeCombo(combo);
            if (entries.has(key)) {
                throw new Error('Shortcut ' + key + ' is already used by "' + entries.get(key).command + '"');
            }
            entries.set(key, { combo: key, command: command, whileTyping: !!(options && options.whileTyping) });
        }

        function lookup(combo) {
            return entries.get(App.shortcuts.normalizeCombo(combo)) || null;
        }

        /*
         * Look up the event; if it matches, call runCommand(commandName) and stop
         * the browser's own action (e.g. Ctrl+S would otherwise save the web page).
         * Returns true if the key was handled.
         */
        function handle(event, runCommand) {
            if (event.isComposing) {
                return false;   // the user is composing a character with an IME (e.g. accents)
            }
            const entry = entries.get(App.shortcuts.comboFromEvent(event));
            if (!entry) {
                return false;
            }
            if (App.shortcuts.isTypingTarget(event.target) && !entry.whileTyping) {
                return false;
            }
            event.preventDefault();
            runCommand(entry.command);
            return true;
        }

        function list() {
            return Array.from(entries.values());
        }

        return { register: register, lookup: lookup, handle: handle, list: list };
    };

    /*
     * The editor's shortcuts. Browsers reserve some keys (Ctrl+N, Ctrl+T, Ctrl+W)
     * and never pass them to the page, so "New deck" is a menu item only.
     */
    App.shortcuts.DEFAULTS = [
        ['Ctrl+O', 'open', { whileTyping: true }],
        ['Ctrl+S', 'save', { whileTyping: true }],
        ['Ctrl+Shift+S', 'saveAs', { whileTyping: true }],
        ['Ctrl+Z', 'undo'],
        ['Ctrl+Y', 'redo'],
        ['Ctrl+Shift+Z', 'redo'],
        ['PageDown', 'nextSlide'],
        ['PageUp', 'previousSlide'],
        ['Home', 'firstSlide'],
        ['End', 'lastSlide'],
    ];

    App.shortcuts.init = function init() {
        App.shortcuts.registry = App.shortcuts.createRegistry();
        App.shortcuts.DEFAULTS.forEach(([combo, command, options]) => {
            App.shortcuts.registry.register(combo, command, options);
        });
        App.shortcuts.listenTo(window);
    };

    /*
     * Listen for keys on a window. Called for the editor window here, and by
     * deck.js for the deck iframe every time a deck loads.
     */
    App.shortcuts.listenTo = function listenTo(targetWindow) {
        targetWindow.addEventListener('keydown', (event) => {
            App.shortcuts.registry.handle(event, (command) => App.commands.run(command));
        });
    };
})();
