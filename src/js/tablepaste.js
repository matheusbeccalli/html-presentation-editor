/*
 * tablepaste.js - paste from Excel (SPEC Phase 4): a table on the clipboard
 * becomes a native, editable table on the slide, or fills the cells of a
 * table from the cursor on.
 *
 * Excel puts a <table> in the clipboard's text/html, its look in a <style>
 * of classes. It is laid out in a hidden iframe that can neither run nor load
 * anything, and read as cells: the text each one shows (2.450, 9,8x, 19,5%),
 * bold, italic, merged cells, column widths. Without HTML, tab-separated
 * text/plain is read instead (with Excel's quotes around cells of several lines).
 *
 *   Ctrl+V on the slide, not typing: a new table, centred, selected.
 *     'destination' (default): the deck's table style; Excel's text with its
 *       bold and italic; its columns' proportions, as wide as in Excel at the
 *       deck's font size; a bold last row turns Total Row on; columns of
 *       numbers line up on the right.
 *     'source' (paste options: Keep source formatting): Excel's fills, lines,
 *       fonts, colours and widths (tables.fromRendered, as for older decks).
 *   Ctrl+V with cells selected, or typing in a cell (more than one cell
 *   copied): the cells from there on get the copied text, bold and italic;
 *   rows and columns are added when it does not fit; the pasted cells end up
 *   selected.
 * Each paste is one undo step.
 *
 * Talks to: tables.js, text.js (cell text: writeLines), elements.js (new
 * elements), tablecontrols.js (selected cells), history.js, selection.js.
 */

(function () {
    'use strict';

    App.tablePaste = {};

    // The hidden layout iframe may load nothing at all (Word's HTML points at local image files).
    const MEASURE_CSP = "default-src 'none'; style-src 'unsafe-inline'";
    const DECK_FONT_SIZE = 14 * 4 / 3;   // px: the deck table stylesheet's 14 pt
    const MAX_WIDTH = 1152;              // px: the slide less 64 px on each side
    const MIN_COLUMN = 24;               // px, as when dragging a column border

    let lastPaste = null;   // the last new table pasted: { element, clipboard, mode, state }, for the paste options

    function round2(value) {
        return Math.round(value * 100) / 100;
    }

    // ---------------------------------------------------------------
    // Reading the clipboard
    // ---------------------------------------------------------------

    function hasTable(html) {
        return /<table[\s>]/i.test(html || '');
    }

    /*
     * Lay `html` out in a hidden iframe and return fn(its document). The frame
     * is sandboxed without scripts and its policy loads nothing; it is removed
     * afterwards.
     */
    function withRendered(html, fn) {
        const frame = document.createElement('iframe');
        frame.setAttribute('sandbox', 'allow-same-origin');
        frame.setAttribute('aria-hidden', 'true');
        frame.setAttribute('tabindex', '-1');
        frame.style.cssText = 'position:fixed; left:-30000px; top:0; width:2400px; height:1600px; border:0; pointer-events:none';
        document.body.appendChild(frame);
        try {
            const doc = frame.contentDocument;
            doc.open();
            doc.write('<!DOCTYPE html><meta http-equiv="Content-Security-Policy" content="' + MEASURE_CSP + '">' + html);
            doc.close();
            return fn(doc);
        } finally {
            frame.remove();
        }
    }

    /* The first table that is not inside another one. */
    function sourceTable(doc) {
        return Array.from(doc.querySelectorAll('table')).find((table) => !table.parentElement.closest('table')) || null;
    }

    /* A cell's text as lines, without the empty lines and spaces around it ([''] when empty). */
    function linesOf(text) {
        const lines = text.replace(/\r\n?/g, '\n').split('\n').map((line) => line.trim());
        while (lines.length > 1 && lines[0] === '') {
            lines.shift();
        }
        while (lines.length > 1 && lines[lines.length - 1] === '') {
            lines.pop();
        }
        return lines;
    }

    function item(lines, look) {
        return Object.assign({ lines: lines, bold: false, italic: false, rowSpan: 1, colSpan: 1 }, look);
    }

    /* Whether every piece of text in `cell` passes test(its computed style); false for a cell without text. */
    function allText(cell, test) {
        const view = cell.ownerDocument.defaultView;
        const walker = cell.ownerDocument.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
        let found = false;
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (node.data.trim() === '') {
                continue;
            }
            found = true;
            if (!test(view.getComputedStyle(node.parentElement))) {
                return false;
            }
        }
        return found;
    }

    const isBold = (style) => parseInt(style.fontWeight, 10) >= 600;
    const isItalic = (style) => style.fontStyle === 'italic' || style.fontStyle === 'oblique';

    const PX_PER = { px: 1, pt: 4 / 3, in: 96, cm: 96 / 2.54, mm: 96 / 25.4 };

    /* "144pt" -> 192 (px); 0 when it is no length. */
    function lengthInPx(value) {
        const found = /^([\d.]+)(px|pt|in|cm|mm)$/.exec((value || '').trim());
        return found ? parseFloat(found[1]) * PX_PER[found[2]] : 0;
    }

    /* The widths Excel gives its columns (<col width>), in px, when every column has one; else null. */
    function declaredWidths(table, count) {
        const widths = [];
        table.querySelectorAll('col').forEach((col) => {
            const width = parseFloat(col.getAttribute('width')) || lengthInPx(col.style.width);
            for (let k = 0; k < Math.max(1, col.span); k++) {
                widths.push(round2(width));
            }
        });
        return widths.length === count && widths.every((width) => width > 0) ? widths : null;
    }

    function readHtml(html) {
        return withRendered(html, (doc) => {
            const table = sourceTable(doc);
            const boxes = table ? App.tables.cellBoxes(table) : [];
            if (boxes.length === 0) {
                return null;
            }
            const grid = App.tables.gridOf(table);
            // A slot a merged cell covers stays null; a hole in a short row is an empty cell.
            const cells = grid.cells.map((row) => row.map((cell) => (cell ? null : item(['']))));
            boxes.forEach((box) => {
                cells[box.row][box.col] = item(linesOf(box.cell.innerText), {
                    bold: allText(box.cell, isBold), italic: allText(box.cell, isItalic),
                    rowSpan: box.rowSpan, colSpan: box.colSpan,
                });
            });
            const fontSize = parseFloat(doc.defaultView.getComputedStyle(boxes[0].cell).fontSize);
            return { cells: cells, widths: declaredWidths(table, grid.cols) || App.tables.renderedColumnWidths(table), fontSize: fontSize };
        });
    }

    /* Tab-separated text, as Excel writes it: a cell holding a line break or a quote is in quotes. */
    function readTabbed(text) {
        const rows = [[]];
        let cell = '';
        let quoted = false;
        const chars = text.replace(/\r\n?/g, '\n');
        for (let i = 0; i < chars.length; i++) {
            const ch = chars[i];
            if (quoted) {
                if (ch === '"' && chars[i + 1] === '"') {
                    cell += '"';
                    i += 1;
                } else if (ch === '"') {
                    quoted = false;
                } else {
                    cell += ch;
                }
            } else if (ch === '"' && cell === '') {
                quoted = true;
            } else if (ch === '\t' || ch === '\n') {
                rows[rows.length - 1].push(cell);
                cell = '';
                if (ch === '\n') {
                    rows.push([]);
                }
            } else {
                cell += ch;
            }
        }
        rows[rows.length - 1].push(cell);
        while (rows.length > 1 && rows[rows.length - 1].every((text) => text === '')) {
            rows.pop();   // the line break Excel ends with
        }
        const cols = Math.max(...rows.map((row) => row.length));
        return {
            cells: rows.map((row) => Array.from({ length: cols }, (unused, c) => item(linesOf(row[c] || '')))),
            widths: null, fontSize: null,
        };
    }

    /*
     * The clipboard's table ({ html, text }) as { cells, widths, fontSize }:
     * cells[row][col] = { lines, bold, italic, rowSpan, colSpan } at the slot a
     * cell starts in (null where a merged cell covers it); widths in px (null for
     * text). null when there is no table of two cells or more.
     */
    App.tablePaste.readCells = function readCells(clipboard) {
        let grid = hasTable(clipboard.html) ? readHtml(clipboard.html) : null;
        if (!grid && !hasTable(clipboard.html) && !clipboard.html && /\t/.test(clipboard.text || '')) {
            grid = readTabbed(clipboard.text);
        }
        const count = grid ? grid.cells.reduce((sum, row) => sum + row.filter(Boolean).length, 0) : 0;
        return count > 1 ? grid : null;
    };

    // ---------------------------------------------------------------
    // Building a new table
    // ---------------------------------------------------------------

    /* The new table's width: as wide as in Excel at the deck's font size, within the slide. */
    function deckWidth(grid) {
        const cols = grid.cells[0].length;
        if (!grid.widths) {
            return App.tables.newTableRect(1, cols).width;
        }
        const source = grid.widths.reduce((a, b) => a + b, 0) * DECK_FONT_SIZE / (grid.fontSize || DECK_FONT_SIZE);
        return round2(Math.min(MAX_WIDTH, Math.max(MIN_COLUMN * cols, source)));
    }

    /* `widths` scaled to add up to `total` exactly (the last column takes the rest of the rounding). */
    function scaleWidths(widths, total) {
        const sum = widths.reduce((a, b) => a + b, 0) || 1;
        const scaled = widths.map((width) => round2(width * total / sum));
        scaled[scaled.length - 1] = round2(total - scaled.slice(0, -1).reduce((a, b) => a + b, 0));
        return scaled;
    }

    function inDeckLook(doc, grid, id) {
        const rows = grid.cells.length;
        const cols = grid.cells[0].length;
        const width = deckWidth(grid);
        const rect = Object.assign(App.tables.newTableRect(rows, cols), { width: width, left: round2((1280 - width) / 2) });
        const element = App.tables.createTable(doc, rows, cols, rect, id);
        const table = element.querySelector(':scope > table');
        if (grid.widths) {
            App.tables.setColumnWidths(table, scaleWidths(grid.widths, width));
        }
        grid.cells.forEach((row, r) => row.forEach((cell, c) => {
            if (cell) {
                App.text.writeLines(table.rows[r].cells[c], cell.lines, cell);
            }
        }));
        // Merge from the last one back: the slots of the ones before do not move.
        grid.cells.flatMap((row, r) => row.map((cell, c) => ({ cell: cell, r: r, c: c })))
            .filter((slot) => slot.cell && (slot.cell.rowSpan > 1 || slot.cell.colSpan > 1)).reverse()
            .forEach((slot) => App.tables.mergeCells(table, { top: slot.r, left: slot.c,
                bottom: slot.r + slot.cell.rowSpan - 1, right: slot.c + slot.cell.colSpan - 1 }));
        // A bold last row (Excel's "Total" or "Mediana") is the table style's Total Row.
        const last = grid.cells[rows - 1].filter((cell) => cell && cell.lines.join('') !== '');
        if (rows >= 3 && last.length > 0 && last.every((cell) => cell.bold)) {
            table.setAttribute('data-total-row', '');
        }
        return element;
    }

    function inSourceLook(doc, html, id) {
        return withRendered(html, (source) => {
            const sourceGrid = sourceTable(source);
            const width = sourceGrid.getBoundingClientRect().width;
            const element = doc.createElement('div');
            element.setAttribute('class', 'el');
            element.setAttribute('data-type', 'table');
            element.setAttribute('data-id', id);
            App.tables.fromRendered(sourceGrid, element, { scale: width > MAX_WIDTH ? MAX_WIDTH / width : 1 });
            const table = element.querySelector(':scope > table');
            const total = round2(App.tables.colWidths(table).reduce((a, b) => a + b, 0));
            const rect = App.tables.newTableRect(table.rows.length, 1);
            element.style.setProperty('left', round2((1280 - total) / 2) + 'px');
            element.style.setProperty('top', rect.top + 'px');
            element.style.setProperty('width', total + 'px');
            element.style.setProperty('height', rect.height + 'px');
            return element;
        });
    }

    /*
     * A new table element (not yet on a slide) from the clipboard, with id `id`:
     * mode 'destination' (the deck's look) or 'source' (Excel's look). Its numbers
     * line up on the right. null when the clipboard holds no table.
     */
    App.tablePaste.buildTable = function buildTable(doc, clipboard, mode, id) {
        const grid = App.tablePaste.readCells(clipboard);
        if (!grid) {
            return null;
        }
        const element = mode === 'source' && hasTable(clipboard.html) ? inSourceLook(doc, clipboard.html, id) : inDeckLook(doc, grid, id);
        App.tables.alignNumbers(element.querySelector(':scope > table'));
        return element;
    };

    // ---------------------------------------------------------------
    // Filling a table on the slide
    // ---------------------------------------------------------------

    /*
     * Write the grid's text into `table` from slot { row, col } on, adding rows
     * and columns (like the last ones) where it does not fit. A destination cell
     * merged over several slots gets the first text that lands in it. Returns
     * the block of cells written.
     */
    App.tablePaste.fillCells = function fillCells(table, slot, grid) {
        const rows = grid.cells.length;
        const cols = grid.cells[0].length;
        const before = App.tables.gridOf(table);
        if (slot.row + rows > before.rows) {
            App.tables.insertRows(table, before.rows, slot.row + rows - before.rows, before.rows - 1);
        }
        if (slot.col + cols > before.cols) {
            App.tables.insertColumns(table, before.cols, slot.col + cols - before.cols, before.cols - 1);
        }
        const after = App.tables.gridOf(table);
        const written = new Set();
        grid.cells.forEach((row, r) => row.forEach((cell, c) => {
            const target = cell && after.cells[slot.row + r][slot.col + c];
            if (target && !written.has(target)) {
                written.add(target);
                App.text.writeLines(target, cell.lines, cell);
            }
        }));
        return { top: slot.row, left: slot.col, bottom: slot.row + rows - 1, right: slot.col + cols - 1 };
    };

    // ---------------------------------------------------------------
    // Pasting
    // ---------------------------------------------------------------

    function slideScope(element) {
        return { slideId: element.closest('section.slide').getAttribute('data-slide-id') };
    }

    /* Fill table element `element` from `slot` on, as one undo step; the pasted cells end up selected. */
    function pasteInto(element, slot, grid) {
        const table = element.querySelector(':scope > table');
        App.text.exitEdit({ select: false });
        let block = null;
        App.history.change('Paste', slideScope(element), () => {
            block = App.tablePaste.fillCells(table, slot, grid);
            App.tableControls.widthFromColumns(element);
            App.tables.alignNumbers(table);
            App.tables.fitTable(element);
        });
        App.selection.select(element);
        const cells = App.tables.gridOf(table).cells;
        App.tableControls.selectCells(element, cells[block.top][block.left], cells[block.bottom][block.right]);
        App.selection.refresh();
    }

    /* Put a new table from the clipboard on the current slide, as one undo step, and select it. */
    function insertTable(clipboard, mode) {
        const slide = App.deck.getCurrentSlide();
        if (!slide) {
            return;
        }
        App.text.exitEdit({ select: false });
        let element = null;
        App.history.change('Paste table', { slideId: slide.getAttribute('data-slide-id') }, () => {
            element = App.tablePaste.buildTable(slide.ownerDocument, clipboard, mode, App.elements.freshId(slide.ownerDocument));
            App.elements.addOnTop(slide, element);
            App.tables.fitTable(element);
            const height = parseFloat(element.style.height) || 0;
            element.style.setProperty('top', Math.max(0, Math.round((720 - height) / 2)) + 'px');
        });
        App.selection.select(element);
        lastPaste = { element: element, clipboard: clipboard, mode: mode, state: App.history.stateId() };
        App.events.emit('table-pasted');
    }

    /*
     * Ctrl+V, not typing ({ html, text } from the paste event): into the selected
     * cells, else a new table. false when the clipboard holds no table.
     */
    App.tablePaste.paste = function paste(clipboard) {
        const grid = App.tablePaste.readCells(clipboard);
        if (!grid) {
            return false;
        }
        const target = App.tableControls.cellTarget();
        if (target) {
            pasteInto(target.element, { row: target.cells.top, col: target.cells.left }, grid);
        } else {
            insertTable(clipboard, 'destination');
        }
        return true;
    };

    /* Ctrl+V while typing in `cell` (text.js): several copied cells fill the table from it; one cell is text (false). */
    App.tablePaste.pasteIntoCell = function pasteIntoCell(cell, clipboard) {
        const grid = App.tablePaste.readCells(clipboard);
        if (!grid) {
            return false;
        }
        const box = App.tables.blockOf(cell);
        pasteInto(cell.closest('.el'), { row: box.top, col: box.left }, grid);
        return true;
    };

    /*
     * The paste options of the table just pasted, while it is still the last
     * step and selected: { current, options: [{ mode, label }], rect } (rect in
     * slide px, where the button goes), else null.
     */
    App.tablePaste.pasteOptions = function pasteOptions() {
        if (!lastPaste || !lastPaste.element.isConnected || App.history.isPending() ||
            App.history.stateId() !== lastPaste.state || App.selection.getElement() !== lastPaste.element ||
            !hasTable(lastPaste.clipboard.html)) {
            return null;
        }
        return {
            current: lastPaste.mode,
            options: [{ mode: 'destination', label: 'Use destination theme' }, { mode: 'source', label: 'Keep source formatting' }],
            rect: App.transform.readRect(lastPaste.element),
        };
    };

    /* Paste the last table again the other way: its step is undone and replaced. */
    App.tablePaste.repaste = function repaste(mode) {
        if (!App.tablePaste.pasteOptions() || mode === lastPaste.mode) {
            return;
        }
        const clipboard = lastPaste.clipboard;
        App.history.undo();
        insertTable(clipboard, mode);
    };
})();
