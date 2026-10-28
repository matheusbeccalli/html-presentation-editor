/*
 * icons.js - the editor's icons as inline SVG text (SPEC 2.1: no icon fonts,
 * no remote images). Drawn for this project, so there is no license to track.
 *
 * Each icon is a 20x20 drawing that uses "currentColor", so it takes the text
 * colour of the button it sits in (and works in light and dark themes).
 *
 * Usage:  button.innerHTML = App.icons.get('save');
 *
 * Talks to: ribbon.js, ui.js, dialogs.js (they place icons on buttons).
 */

(function () {
    'use strict';

    App.icons = {};

    const PATHS = {
        newDeck: '<path d="M5 2.5h7l3.5 3.5v11.5H5z"/><path d="M12 2.5V6h3.5"/>',
        open: '<path d="M2.5 5.5V15.5h13l2-7H5.5l-2 7"/><path d="M2.5 5.5V4h5l1.5 1.5h6V8.5"/>',
        save: '<path d="M3.5 3.5h10l3 3v10h-13z"/><path d="M6.5 3.5v4h6v-4"/><rect x="6" y="11" width="8" height="5.5"/>',
        saveAs: '<path d="M3.5 3.5h10l3 3v4"/><path d="M3.5 3.5v13h6"/><path d="M6.5 3.5v4h6v-4"/><path d="M12 17.5l1-3 4.5-4.5 2 2-4.5 4.5z"/>',
        undo: '<path d="M7.5 5L4 8.5 7.5 12"/><path d="M4 8.5h8a4 4 0 0 1 0 8H9"/>',
        redo: '<path d="M12.5 5L16 8.5 12.5 12"/><path d="M16 8.5H8a4 4 0 0 0 0 8h3"/>',
        previous: '<path d="M12.5 4.5L7 10l5.5 5.5"/>',
        next: '<path d="M7.5 4.5L13 10l-5.5 5.5"/>',
        warning: '<path d="M10 2.5l8 14.5H2z"/><path d="M10 8v4.5"/><circle cx="10" cy="14.8" r="0.4"/>',
        info: '<circle cx="10" cy="10" r="7.5"/><path d="M10 9v5"/><circle cx="10" cy="6.3" r="0.4"/>',
        check: '<path d="M4 10.5l4 4 8-9"/>',
        close: '<path d="M5 5l10 10M15 5L5 15"/>',
        slides: '<rect x="2.5" y="4" width="15" height="9.5"/><path d="M6 16.5h8"/>',
        hidden: '<path d="M2.5 10s3-5 7.5-5 7.5 5 7.5 5-3 5-7.5 5-7.5-5-7.5-5z"/><path d="M3.5 16.5l13-13"/>',
        file: '<path d="M5 2.5h7l3.5 3.5v11.5H5z"/><path d="M12 2.5V6h3.5"/><path d="M7.5 10h5M7.5 13h5"/>',
    };

    App.icons.get = function get(name) {
        const path = PATHS[name];
        if (!path) {
            throw new Error('Unknown icon: ' + name);
        }
        return '<svg class="icon" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor"' +
            ' stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg>';
    };
})();
