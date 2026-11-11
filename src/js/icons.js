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
        newSlide: '<rect x="2.5" y="4.5" width="13" height="9" rx="1"/><path d="M5 7.5h6M5 10h4M16 12v6M13 15h6"/>',
        duplicateSlide: '<rect x="2.5" y="3" width="11" height="7.5" rx="1"/><rect x="6.5" y="9.5" width="11" height="7.5" rx="1"/>',
        deleteSlide: '<rect x="2.5" y="3.5" width="13" height="9" rx="1"/><path d="M12 13l5 5M17 13l-5 5"/>',
        alignObjectsLeft: '<path d="M3 2.5v15"/><rect x="5" y="5" width="11" height="3.5"/><rect x="5" y="11.5" width="7" height="3.5"/>',
        alignObjectsCenter: '<path d="M10 2.5v15"/><rect x="4" y="5" width="12" height="3.5"/><rect x="6.5" y="11.5" width="7" height="3.5"/>',
        alignObjectsRight: '<path d="M17 2.5v15"/><rect x="4" y="5" width="11" height="3.5"/><rect x="8" y="11.5" width="7" height="3.5"/>',
        alignObjectsTop: '<path d="M2.5 3h15"/><rect x="5" y="5" width="3.5" height="11"/><rect x="11.5" y="5" width="3.5" height="7"/>',
        alignObjectsMiddle: '<path d="M2.5 10h15"/><rect x="5" y="4" width="3.5" height="12"/><rect x="11.5" y="6.5" width="3.5" height="7"/>',
        alignObjectsBottom: '<path d="M2.5 17h15"/><rect x="5" y="4" width="3.5" height="11"/><rect x="11.5" y="8" width="3.5" height="7"/>',
        distributeHorizontally: '<path d="M2.5 3v14M17.5 3v14"/><rect x="5" y="7" width="2.5" height="6"/><rect x="8.75" y="7" width="2.5" height="6"/><rect x="12.5" y="7" width="2.5" height="6"/>',
        distributeVertically: '<path d="M3 2.5h14M3 17.5h14"/><rect x="7" y="5" width="6" height="2.5"/><rect x="7" y="8.75" width="6" height="2.5"/><rect x="7" y="12.5" width="6" height="2.5"/>',
        group: '<rect x="2.5" y="2.5" width="15" height="15" stroke-dasharray="2 1.5"/><rect x="5" y="5" width="6" height="5"/><rect x="9" y="9" width="6" height="6" fill="currentColor" fill-opacity="0.25"/>',
        ungroup: '<rect x="2.5" y="2.5" width="7" height="6"/><rect x="10.5" y="11.5" width="7" height="6" fill="currentColor" fill-opacity="0.25"/><path d="M11 4.5l5 5M16 4.5l-5 5"/>',
        rotateRight90: '<rect x="3.5" y="9.5" width="9" height="7"/><path d="M8 5.5a7 7 0 0 1 8.5 4.5"/><path d="M13.5 9.5l3 .8.8-3"/>',
        rotateLeft90: '<rect x="7.5" y="9.5" width="9" height="7"/><path d="M12 5.5a7 7 0 0 0-8.5 4.5"/><path d="M6.5 9.5l-3 .8-.8-3"/>',
        grid: '<rect x="3" y="3" width="14" height="14"/><path d="M3 7.7h14M3 12.3h14M7.7 3v14M12.3 3v14"/>',
        ruler: '<rect x="2.5" y="6.5" width="15" height="7" rx="0.5"/><path d="M5.5 6.5v3M8.5 6.5v2M11.5 6.5v3M14.5 6.5v2"/>',
        alignToSlide: '<rect x="2.5" y="4" width="15" height="12" rx="1"/><rect x="7" y="8" width="6" height="4" fill="currentColor" fill-opacity="0.25"/>',
        warning: '<path d="M10 2.5l8 14.5H2z"/><path d="M10 8v4.5"/><circle cx="10" cy="14.8" r="0.4"/>',
        info: '<circle cx="10" cy="10" r="7.5"/><path d="M10 9v5"/><circle cx="10" cy="6.3" r="0.4"/>',
        check: '<path d="M4 10.5l4 4 8-9"/>',
        formatPainter: '<rect x="3" y="2.5" width="12" height="5" rx="1"/><path d="M15 5h2v4.5h-7.5V12"/><rect x="8" y="12" width="3" height="5.5" rx="0.5"/>',
        changePicture: '<rect x="2.5" y="3.5" width="11" height="10" rx="1"/><circle cx="6.5" cy="7.5" r="1.2"/>' +
            '<path d="M2.5 12l3.5-3 2.5 2 2-1.5M17.5 11.5a4 4 0 0 1-6.8 2.8M10.7 18v-3.7h3.7"/>',
        shapeFill: '<path d="M4 9.5L9.5 4l6 6-5.5 5.5z"/><path d="M15.5 12.5c0 1.2 1 2 1.6 2s1.4-.8 1.4-2c0-1-1.5-2.8-1.5-2.8s-1.5 1.8-1.5 2.8z"/>',
        shapeOutline: '<path d="M13 3.5l3.5 3.5-8.5 8.5H4.5V12z"/><path d="M11 5.5l3.5 3.5"/>',
        shadow: '<rect x="3" y="3" width="10" height="10"/><path d="M15.5 6v9.5H6" stroke-width="2.4"/>',
        chartColumn: '<path d="M3 17.5h14"/><rect x="4.5" y="9.5" width="3" height="8"/><rect x="8.5" y="5.5" width="3" height="12"/><rect x="12.5" y="2.5" width="3" height="15"/>',
        chartBar: '<path d="M2.5 3v14"/><rect x="2.5" y="4" width="8" height="3"/><rect x="2.5" y="8.5" width="12" height="3"/><rect x="2.5" y="13" width="15" height="3"/>',
        chartLine: '<path d="M3 17.5h14"/><path d="M3.5 14l4-5 3.5 3 5.5-7"/>',
        chartArea: '<path d="M3 17.5h14"/><path d="M3.5 17.5V13l4-5 3.5 3 5.5-6v12.5z"/>',
        chartCombo: '<path d="M3 17.5h14"/><rect x="4.5" y="11.5" width="3" height="6"/><rect x="12.5" y="8.5" width="3" height="9"/><path d="M3.5 8l6-3 7 1"/>',
        chartWaterfall: '<path d="M3 17.5h14"/><rect x="3.5" y="8.5" width="3" height="9"/><rect x="8.5" y="4.5" width="3" height="4"/><rect x="13.5" y="4.5" width="3" height="13"/>',
        chartDonut: '<circle cx="10" cy="10" r="7"/><circle cx="10" cy="10" r="3"/><path d="M10 3v4M16.2 13.2l-3.4-1.6"/>',
        chartScatter: '<path d="M3 3v14h14"/><circle cx="7" cy="12" r="1.5"/><circle cx="11" cy="8" r="2"/><circle cx="15" cy="5" r="1.3"/>',
        chartTitle: '<path d="M4 4h12M10 4v4"/><path d="M3 17.5h14"/><rect x="5" y="12" width="3" height="5.5"/><rect x="12" y="10" width="3" height="7.5"/>',
        dataLabels: '<path d="M3 17.5h14"/><rect x="4.5" y="11" width="4" height="6.5"/><rect x="11.5" y="8" width="4" height="9.5"/><path d="M5 7.5h3M12 4.5h3"/>',
        gridlines: '<path d="M3 4.5h14M3 9h14M3 13.5h14M3 17.5h14"/>',
        cagr: '<path d="M3 17.5h14"/><path d="M5 13V5h10v8"/><path d="M13 11l2 2.5 2-2.5"/>',
        shapes: '<rect x="2.5" y="9.5" width="8" height="8"/><circle cx="13" cy="7" r="4.5"/>',
        shapeRect: '<rect x="2.5" y="5.5" width="15" height="9"/>',
        shapeRoundRect: '<rect x="2.5" y="5.5" width="15" height="9" rx="2.5"/>',
        shapeEllipse: '<ellipse cx="10" cy="10" rx="7.5" ry="5"/>',
        shapeLine: '<path d="M3 16L17 4"/>',
        shapeArrow: '<path d="M3 16L16 5M10.5 5H16v5.5"/>',
        shapeChevron: '<path d="M2.5 5.5h10l4.5 4.5-4.5 4.5h-10l4.5-4.5z"/>',
        shapePentagon: '<path d="M2.5 5.5h10.5l4.5 4.5-4.5 4.5H2.5z"/>',
        shapeCallout: '<path d="M2.5 3.5h15v9h-9l-4 4v-4h-2z"/>',
        crop: '<path d="M5.5 1.5v13h13M1.5 5.5h13v13"/>',
        resetPictureSize: '<rect x="5.5" y="5.5" width="9" height="9"/><path d="M2.5 6V2.5H6M17.5 6V2.5H14M2.5 14v3.5H6M17.5 14v3.5H14"/>',
        picture: '<rect x="2.5" y="3.5" width="15" height="13" rx="1"/><circle cx="7" cy="8" r="1.5"/><path d="M2.5 14.5l4.5-4 3 2.5 3.5-3.5 4 4"/>',
        table: '<rect x="2.5" y="3.5" width="15" height="13"/><path d="M2.5 7.5h15M2.5 12h15M7.5 3.5v13M12.5 3.5v13"/>',
        insertRowAbove: '<rect x="3" y="9.5" width="14" height="8"/><path d="M3 13.5h14M10 2v5.5M7.25 4.75h5.5"/>',
        insertRowBelow: '<rect x="3" y="2.5" width="14" height="8"/><path d="M3 6.5h14M10 12.5V18M7.25 15.25h5.5"/>',
        insertColumnLeft: '<rect x="9.5" y="3" width="8" height="14"/><path d="M13.5 3v14M2 10h5.5M4.75 7.25v5.5"/>',
        insertColumnRight: '<rect x="2.5" y="3" width="8" height="14"/><path d="M6.5 3v14M12.5 10H18M15.25 7.25v5.5"/>',
        deleteRows: '<rect x="3" y="2.5" width="14" height="7"/><path d="M3 6h14M7.5 12l5 5.5M12.5 12l-5 5.5"/>',
        deleteColumns: '<rect x="2.5" y="3" width="7" height="14"/><path d="M6 3v14M12 7.5l5.5 5M17.5 7.5l-5.5 5"/>',
        deleteTable: '<rect x="2.5" y="2.5" width="11" height="10"/><path d="M2.5 6h11M8 2.5v10M12 12.5l5 5M17 12.5l-5 5"/>',
        mergeCells: '<rect x="2.5" y="4" width="15" height="12"/><path d="M5 10h10M12.5 7.5L15 10l-2.5 2.5M7.5 7.5L5 10l2.5 2.5"/>',
        splitCells: '<rect x="2.5" y="4" width="15" height="12"/><path d="M10 4v12M8 10H4.5M6.5 8L4.5 10l2 2M12 10h3.5M13.5 8l2 2-2 2"/>',
        textBox: '<rect x="2.5" y="4" width="15" height="12" stroke-dasharray="2 1.5"/><path d="M6.5 7.5h7M10 7.5v6"/>',
        close: '<path d="M5 5l10 10M15 5L5 15"/>',
        bold: '<path stroke-width="2" d="M6 3.5h4.8a3 3 0 0 1 0 6H6zM6 9.5h5.5a3.5 3.5 0 0 1 0 7H6z"/>',
        italic: '<path d="M8.5 3.5h6M5.5 16.5h6M12 3.5l-4 13"/>',
        underline: '<path d="M6 3v6.5a4 4 0 0 0 8 0V3"/><path d="M4.5 17.5h11"/>',
        strikethrough: '<path d="M14 5.5c-.8-1.3-2.3-2-4-2-2.2 0-4 1.2-4 3 0 1.4 1 2.3 2.6 2.9"/>' +
            '<path d="M6 14.5c.8 1.3 2.3 2 4 2 2.2 0 4-1.2 4-3 0-.8-.3-1.4-.8-2"/><path d="M3 10h14"/>',
        superscript: '<path d="M3 7l7 9M10 7l-7 9"/><path d="M13 4.5a1.5 1.5 0 1 1 2.5 1.1L13 8h3.5"/>',
        subscript: '<path d="M3 4l7 9M10 4l-7 9"/><path d="M13 13.5a1.5 1.5 0 1 1 2.5 1.1L13 17h3.5"/>',
        fontColor: '<path d="M5 13.5L10 2.5l5 11M7 9.5h6"/>',
        highlight: '<path d="M6.5 12.5l6.5-9.5 3 2-6.5 9.5h-3z"/><path d="M6.5 12.5L5 15h3"/>',
        growFont: '<path d="M2.5 16.5L7.5 4l5 12.5M4.5 12h6"/><path d="M14 7l2-2.5L18 7"/>',
        shrinkFont: '<path d="M2.5 16.5L7.5 4l5 12.5M4.5 12h6"/><path d="M14 4.5l2 2.5 2-2.5"/>',
        clearFormatting: '<path d="M5 4.5h10M10 4.5l-3 11"/><path d="M12 12l5 5M17 12l-5 5"/>',
        alignLeft: '<path d="M3 4.5h14M3 8.5h9M3 12.5h14M3 16.5h9"/>',
        alignCenter: '<path d="M3 4.5h14M5.5 8.5h9M3 12.5h14M5.5 16.5h9"/>',
        alignRight: '<path d="M3 4.5h14M8 8.5h9M3 12.5h14M8 16.5h9"/>',
        alignJustify: '<path d="M3 4.5h14M3 8.5h14M3 12.5h14M3 16.5h14"/>',
        // Table Design / Layout > Alignment (tabledesign.js).
        shading: '<path d="M4 9.5l5.5-5.5 5.5 5.5-5.5 5.5z"/><path d="M15 9.5c1 1.5 1.5 2.5 1.5 3.2a1.5 1.5 0 0 1-3 0c0-.7.5-1.7 1.5-3.2z"/><path d="M7 3l2.5 1"/>',
        penColor: '<path d="M5 13l8.5-8.5 2 2L7 15H5z"/><path d="M12 6l2 2"/>',
        cellAlignTop: '<rect x="2.5" y="2.5" width="15" height="15"/><path d="M6 6h8M6 9h8"/>',
        cellAlignMiddle: '<rect x="2.5" y="2.5" width="15" height="15"/><path d="M6 8.5h8M6 11.5h8"/>',
        cellAlignBottom: '<rect x="2.5" y="2.5" width="15" height="15"/><path d="M6 11h8M6 14h8"/>',
        cellMargins: '<rect x="2.5" y="2.5" width="15" height="15"/><rect x="6" y="6" width="8" height="8" stroke-dasharray="1.5 1.5"/>',
        lineSpacing: '<path d="M9 4.5h8.5M9 8.5h8.5M9 12.5h8.5M9 16.5h8.5"/><path d="M2.5 6L4.5 3.5 6.5 6M2.5 14l2 2.5 2-2.5M4.5 3.5v13"/>',
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
        find: '<circle cx="8.5" cy="8.5" r="5"/><path d="M12.2 12.2l5 5"/>',
        replace: '<path d="M3 6.5h9.5M9.5 3.5l3 3-3 3"/><path d="M17 13.5H7.5M10.5 10.5l-3 3 3 3"/>',
        back: '<rect x="8" y="8" width="9" height="9" stroke-dasharray="2 1.5"/><rect x="3" y="3" width="8" height="8" fill="currentColor" fill-opacity="0.25"/>',
    };

    // Table borders: a faint 2 x 2 grid of cells, the lines a kind draws in full (tabledesign.js).
    const GRID_LINES = { top: 'M3 3h14', bottom: 'M3 17h14', left: 'M3 3v14', right: 'M17 3v14', h: 'M3 10h14', v: 'M10 3v14' };
    const BORDER_KINDS = {
        all: ['top', 'bottom', 'left', 'right', 'h', 'v'], none: [], outside: ['top', 'bottom', 'left', 'right'],
        inside: ['h', 'v'], insideHorizontal: ['h'], insideVertical: ['v'],
        top: ['top'], bottom: ['bottom'], left: ['left'], right: ['right'],
    };
    Object.keys(BORDER_KINDS).forEach((kind) => {
        const drawn = BORDER_KINDS[kind];
        PATHS['borders-' + kind] = Object.keys(GRID_LINES).map((line) => (drawn.indexOf(line) === -1
            ? '<path d="' + GRID_LINES[line] + '" stroke-dasharray="1 2" stroke-width="1"/>'
            : '<path d="' + GRID_LINES[line] + '" stroke-width="2"/>')).join('');
    });

    /* Characters drawn as an icon (the number buttons): filled, in the UI font. */
    function glyphs(x, y, size, text, anchor) {
        return '<text x="' + x + '" y="' + y + '" font-size="' + size + '" text-anchor="' + (anchor || 'start') + '"' +
            ' fill="currentColor" stroke="none" font-family="Segoe UI, Arial, sans-serif" font-weight="600">' + text + '</text>';
    }

    // Table Design > Number (tabledesign.js), drawn as Excel draws them.
    PATHS.numberThousands = glyphs(10, 13.5, 8.5, '000', 'middle');
    PATHS.increaseDecimals = '<path d="M7 5H2.5M4.5 3L2.5 5l2 2"/>' + glyphs(8, 8, 7.5, '.0') + glyphs(5, 17.5, 7.5, '.00');
    PATHS.decreaseDecimals = glyphs(2, 8, 7.5, '.00') + '<path d="M2.5 14.5H7M5 12.5l2 2-2 2"/>' + glyphs(8.5, 17.5, 7.5, '.0');
    PATHS.numberPercent = glyphs(10, 15, 13, '%', 'middle');
    PATHS.negativeParens = glyphs(10, 14.5, 10.5, '(1)', 'middle');

    App.icons.get = function get(name) {
        const path = PATHS[name];
        if (!path) {
            throw new Error('Unknown icon: ' + name);
        }
        return '<svg class="icon" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor"' +
            ' stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg>';
    };
})();
