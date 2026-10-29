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
        textBox: '<rect x="2.5" y="4" width="15" height="12" stroke-dasharray="2 1.5"/><path d="M6.5 7.5h7M10 7.5v6"/>',
        close: '<path d="M5 5l10 10M15 5L5 15"/>',
        bullets: '<circle cx="4" cy="5" r="1" fill="currentColor"/><circle cx="4" cy="10" r="1" fill="currentColor"/>' +
            '<circle cx="4" cy="15" r="1" fill="currentColor"/><path d="M8 5h9.5M8 10h9.5M8 15h9.5"/>',
        numbering: '<path d="M3 3.5l1.5-1v5M2.8 7.5h3.4"/><path d="M2.8 12.2a1.6 1.6 0 1 1 2.6 1.2l-2.6 2.6h3.4"/>' +
            '<path d="M9 5h8.5M9 14h8.5"/>',
        outdent: '<path d="M2.5 3.5h15M9 8h8.5M9 12h8.5M2.5 16.5h15"/><path d="M6 7.5L3 10l3 2.5"/>',
        indent: '<path d="M2.5 3.5h15M9 8h8.5M9 12h8.5M2.5 16.5h15"/><path d="M3 7.5L6 10l-3 2.5"/>',
        restartNumbering: '<path d="M3 3.5l1.5-1v5M2.8 7.5h3.4"/><path d="M9 5h8.5"/>' +
            '<path d="M16 12.5a4 4 0 1 1-1.5-3"/><path d="M15 6.8l-.4 2.9 2.9.2"/>',
        continueNumbering: '<path d="M3 3.5l1.5-1v5M2.8 7.5h3.4"/><path d="M9 5h8.5"/>' +
            '<path d="M4.5 10.5v6M2.5 14.5l2 2 2-2"/><path d="M9 14h8.5"/>',
        slides: '<rect x="2.5" y="4" width="15" height="9.5"/><path d="M6 16.5h8"/>',
        hidden: '<path d="M2.5 10s3-5 7.5-5 7.5 5 7.5 5-3 5-7.5 5-7.5-5-7.5-5z"/><path d="M3.5 16.5l13-13"/>',
        file: '<path d="M5 2.5h7l3.5 3.5v11.5H5z"/><path d="M12 2.5V6h3.5"/><path d="M7.5 10h5M7.5 13h5"/>',
        cut: '<circle cx="6" cy="14.5" r="2.5"/><circle cx="14" cy="14.5" r="2.5"/><path d="M7.5 12.5L14 3M12.5 12.5L6 3"/>',
        copy: '<rect x="7" y="7" width="10" height="10.5" rx="1"/><path d="M13 7V3.5H3.5V14H7"/>',
        paste: '<rect x="4" y="4" width="12" height="13.5" rx="1"/><path d="M7.5 4V2.5h5V4"/><path d="M7 9h6M7 12h6"/>',
        duplicate: '<rect x="3" y="3" width="9.5" height="9.5"/><rect x="7.5" y="7.5" width="9.5" height="9.5"/>',
        front: '<rect x="3" y="3" width="8" height="8" stroke-dasharray="2 1.5"/><rect x="8" y="8" width="9" height="9" fill="currentColor" fill-opacity="0.25"/>',
        forward: '<rect x="3" y="3" width="8" height="8"/><rect x="8" y="8" width="9" height="9" fill="currentColor" fill-opacity="0.25"/>',
        backward: '<rect x="8" y="8" width="9" height="9"/><rect x="3" y="3" width="8" height="8" fill="currentColor" fill-opacity="0.25"/>',
        recent: '<circle cx="10" cy="10" r="7.5"/><path d="M10 5.5V10l3 2"/>',
        settings: '<circle cx="10" cy="10" r="2.5"/><path d="M10 2.5v2.5M10 15v2.5M2.5 10H5M15 10h2.5M4.7 4.7l1.8 1.8M13.5 13.5l1.8 1.8M4.7 15.3l1.8-1.8M13.5 6.5l1.8-1.8"/>',
        back: '<rect x="8" y="8" width="9" height="9" stroke-dasharray="2 1.5"/><rect x="3" y="3" width="8" height="8" fill="currentColor" fill-opacity="0.25"/>',
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
